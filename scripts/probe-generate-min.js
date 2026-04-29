const fs = require("node:fs");
const path = require("node:path");

const baseUrl = (process.env.NANOBANANA_BASE_URL || "http://127.0.0.1:5178").replace(/\/$/, "");
const apiKey = process.env.NANOBANANA_API_KEY || "";
const fixture = path.join(__dirname, "..", "tests", "fixtures", "pose-source.png");
const data = fs.readFileSync(fixture).toString("base64");

const POSE_PROMPT =
  "Create a new image from the reference image. Keep the exact same person in facial and physical physiognomy, keep the same background, but use a different pose and a different expression. Return only the generated image, with no text.";

async function main() {
  const t0 = Date.now();
  const response = await fetch(`${baseUrl}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      apiKey,
      model: "gemini-3.1-flash-image-preview",
      apiEndpoint: "https://aiplatform.googleapis.com",
      providerMode: process.env.PROVIDER_MODE || "auto",
      aspectRatio: "auto",
      imageCount: 1,
      outputMimeType: "image/png",
      imageSize: "auto",
      prompt: POSE_PROMPT,
      images: [{ name: "pose-source.png", mimeType: "image/png", data }],
    }),
    signal: AbortSignal.timeout(8 * 60 * 1000),
  });
  const text = await response.text();
  let json = {};
  try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 800) }; }
  const summary = {
    elapsedSeconds: ((Date.now() - t0) / 1000).toFixed(1),
    httpStatus: response.status,
    provider: json.provider,
    imagesReturned: Array.isArray(json.images) ? json.images.length : 0,
    error: json.error,
    errors: (json.errors || []).map((e) => ({
      provider: e.provider,
      status: e.status,
      message: typeof e.message === "string" ? e.message.slice(0, 320) : e.message,
    })),
    providerAttempts: (json.providerAttempts || []).map((a) => ({
      provider: a.provider,
      status: a.status,
      reason: a.reason,
      message: typeof a.message === "string" ? a.message.slice(0, 320) : a.message,
    })),
  };
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
