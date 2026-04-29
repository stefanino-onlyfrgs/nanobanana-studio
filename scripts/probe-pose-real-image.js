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
  console.error("Usage: node scripts/probe-pose-real-image.js <image-path>");
  process.exit(1);
}

const outDir = path.join(__dirname, "..", "live-output");
fs.mkdirSync(outDir, { recursive: true });

const buffer = fs.readFileSync(imagePath);
const base64 = buffer.toString("base64");
const mimeType = imagePath.toLowerCase().endsWith(".jpg") || imagePath.toLowerCase().endsWith(".jpeg")
  ? "image/jpeg"
  : "image/png";

const POSE_PROMPT =
  "Create a new image from the reference image. Keep the exact same person in facial and physical physiognomy, keep the same background, but use a different pose and a different expression. Return only the generated image, with no text.";

async function callGemini(label, payload) {
  const started = Date.now();
  const url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image-preview:generateContent";
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    return { label, ok: false, error: error.message, ms: Date.now() - started };
  }
  const text = await response.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { raw: text };
  }
  const candidates = Array.isArray(parsed.candidates) ? parsed.candidates : [];
  const summary = candidates.map((c, i) => {
    const parts = c?.content?.parts || [];
    const images = parts
      .filter((p) => p.inlineData || p.inline_data)
      .map((p) => p.inlineData || p.inline_data);
    const texts = parts.filter((p) => p.text).map((p) => p.text);
    images.forEach((image, j) => {
      if (!image?.data) return;
      const safe = label.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
      fs.writeFileSync(path.join(outDir, `pose-real-${safe}-c${i}-i${j}.png`), Buffer.from(image.data, "base64"));
    });
    return {
      finishReason: c.finishReason,
      safetyRatings: c.safetyRatings,
      imageCount: images.length,
      textParts: texts,
    };
  });
  return {
    label,
    ok: response.ok,
    status: response.status,
    ms: Date.now() - started,
    promptFeedback: parsed.promptFeedback || null,
    candidates: summary,
    error: parsed.error ? parsed.error.message : null,
  };
}

async function main() {
  const tests = [];
  // Test 1: identico a quello che farebbe la UI in Workflow 2 con imageSize=4K
  tests.push(
    await callGemini("workflow2-4K", {
      contents: [
        {
          role: "user",
          parts: [
            { inline_data: { mime_type: mimeType, data: base64 } },
            { text: POSE_PROMPT },
          ],
        },
      ],
      generationConfig: {
        responseModalities: ["TEXT", "IMAGE"],
        candidateCount: 1,
        imageConfig: { imageSize: "4K" },
      },
    })
  );

  // Test 2: senza imageSize/aspect (auto)
  tests.push(
    await callGemini("workflow2-auto", {
      contents: [
        {
          role: "user",
          parts: [
            { inline_data: { mime_type: mimeType, data: base64 } },
            { text: POSE_PROMPT },
          ],
        },
      ],
      generationConfig: {
        responseModalities: ["TEXT", "IMAGE"],
        candidateCount: 1,
      },
    })
  );

  // Test 3: imageSize=1K
  tests.push(
    await callGemini("workflow2-1K", {
      contents: [
        {
          role: "user",
          parts: [
            { inline_data: { mime_type: mimeType, data: base64 } },
            { text: POSE_PROMPT },
          ],
        },
      ],
      generationConfig: {
        responseModalities: ["TEXT", "IMAGE"],
        candidateCount: 1,
        imageConfig: { imageSize: "1K" },
      },
    })
  );

  console.log(sanitize(JSON.stringify({ imagePath, mimeType, fileBytes: buffer.length, tests }, null, 2)));
}

main().catch((error) => {
  console.error(sanitize(error.stack || error.message));
  process.exit(1);
});
