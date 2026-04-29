const fs = require("node:fs");
const path = require("node:path");

const key = process.env.NANOBANANA_API_KEY || "";
if (!key) {
  console.error("Missing NANOBANANA_API_KEY.");
  process.exit(1);
}
const sanitize = (value) => String(value || "").split(key).join("<redacted>");

const imagePath = process.argv[2];
if (!imagePath || !fs.existsSync(imagePath)) {
  console.error("Usage: node scripts/probe-pose-via-server.js <image-path>");
  process.exit(1);
}

const baseUrl = process.env.NANOBANANA_BASE_URL || "http://127.0.0.1:5177";
const outDir = path.join(__dirname, "..", "live-output");
fs.mkdirSync(outDir, { recursive: true });

const buffer = fs.readFileSync(imagePath);
const base64 = buffer.toString("base64");
const lower = imagePath.toLowerCase();
const mimeType =
  lower.endsWith(".jpg") || lower.endsWith(".jpeg")
    ? "image/jpeg"
    : "image/png";

const POSE_PROMPT =
  "Create a new image from the reference image. Keep the exact same person in facial and physical physiognomy, keep the same background, but use a different pose and a different expression. Return only the generated image, with no text.";

async function callServer(label, body) {
  const started = Date.now();
  const response = await fetch(`${baseUrl}/api/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { raw: text };
  }
  const images = Array.isArray(parsed.images) ? parsed.images : [];
  images.forEach((image, i) => {
    if (!image?.data) return;
    const safe = label.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    fs.writeFileSync(
      path.join(outDir, `via-server-${safe}-${i + 1}.png`),
      Buffer.from(image.data, "base64")
    );
  });
  return {
    label,
    status: response.status,
    ms: Date.now() - started,
    returnedImages: images.length,
    provider: parsed.provider || null,
    attempts: parsed.attemptedRequests || null,
    error: parsed.error || null,
    text: (parsed.text || "").slice(0, 400),
    errors: (parsed.errors || []).map((e) => ({
      request: e.request,
      message: e.message,
      status: e.status,
      provider: e.provider,
    })),
  };
}

async function main() {
  const baseBody = {
    apiKey: key,
    model: "gemini-3.1-flash-image-preview",
    apiEndpoint: "https://aiplatform.googleapis.com",
    providerMode: "gemini",
    prompt: POSE_PROMPT,
    images: [{ name: path.basename(imagePath), mimeType, data: base64 }],
    aspectRatio: "auto",
    outputMimeType: "image/png",
    jpegQuality: "90",
  };

  const tests = [];
  tests.push(
    await callServer("count1-4K", { ...baseBody, imageCount: "1", imageSize: "4K" })
  );
  tests.push(
    await callServer("count1-auto", { ...baseBody, imageCount: "1", imageSize: "auto" })
  );
  tests.push(
    await callServer("count4-4K", { ...baseBody, imageCount: "4", imageSize: "4K" })
  );
  tests.push(
    await callServer("count4-1K", { ...baseBody, imageCount: "4", imageSize: "1K" })
  );

  console.log(
    sanitize(
      JSON.stringify(
        { baseUrl, imagePath, fileBytes: buffer.length, mimeType, tests },
        null,
        2
      )
    )
  );
}

main().catch((error) => {
  console.error(sanitize(error.stack || error.message));
  process.exit(1);
});
