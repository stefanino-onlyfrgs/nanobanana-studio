const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const key = process.env.NANOBANANA_API_KEY || "";
if (!key) {
  console.error("Missing NANOBANANA_API_KEY.");
  process.exit(1);
}

const sanitize = (value) => String(value || "").split(key).join("<redacted>");
const baseUrl = process.env.NANOBANANA_BASE_URL || "http://127.0.0.1:5177";
const outDir = path.join(__dirname, "..", "live-output");
fs.mkdirSync(outDir, { recursive: true });

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let c = -1;
  for (const byte of buffer) c = (c >>> 8) ^ crcTable[(c ^ byte) & 255];
  return (c ^ -1) >>> 0;
}

function chunkPng(type, data) {
  const typeBuffer = Buffer.from(type);
  const lengthBuffer = Buffer.alloc(4);
  lengthBuffer.writeUInt32BE(data.length);
  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])));
  return Buffer.concat([lengthBuffer, typeBuffer, data, crcBuffer]);
}

function buildPng(width, height, background, accent) {
  const raw = [];
  for (let y = 0; y < height; y += 1) {
    raw.push(0);
    for (let x = 0; x < width; x += 1) {
      const inAccent = (x - width / 2) ** 2 + (y - height / 2) ** 2 <
        (width * 0.3) ** 2;
      const c = inAccent ? accent : background;
      raw.push(c[0], c[1], c[2], 255);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunkPng("IHDR", ihdr),
    chunkPng("IDAT", zlib.deflateSync(Buffer.from(raw))),
    chunkPng("IEND", Buffer.alloc(0)),
  ]);
}

const SCENE = buildPng(256, 256, [238, 243, 242], [53, 107, 95]).toString("base64");
const PERSON = buildPng(256, 256, [255, 246, 230], [215, 99, 75]).toString("base64");

const PROMPTS = {
  swap:
    "Create a new edited image. Keep the exact same pose as the person in the first image. Keep the same background as the first image. Keep the same lighting and camera as the first image. Replace the person in the first image with the person from the second image. The facial and physical physiognomy must be perfectly identical in every detail and proportion to the person in the second image. Return only the generated image, with no text.",
  pose:
    "Create a new image from the reference image. Keep the exact same person in facial and physical physiognomy, keep the same background, but use a different pose and a different expression. Return only the generated image, with no text.",
  background:
    "Create a new edited image. Insert the person from the second image, identical in every detail of facial and physical physiognomy, and place them proportionally and coherently into the background of the first image. Return only the generated image, with no text.",
};

const WORKFLOWS = [
  {
    id: "swap",
    images: [
      { name: "scene.png", mimeType: "image/png", data: SCENE },
      { name: "person.png", mimeType: "image/png", data: PERSON },
    ],
  },
  {
    id: "pose",
    images: [{ name: "scene.png", mimeType: "image/png", data: SCENE }],
  },
  {
    id: "background",
    images: [
      { name: "scene.png", mimeType: "image/png", data: SCENE },
      { name: "person.png", mimeType: "image/png", data: PERSON },
    ],
  },
];

async function callGenerate(workflow, imageCount, providerMode) {
  const started = Date.now();
  const response = await fetch(`${baseUrl}/api/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      apiKey: key,
      model: "gemini-3.1-flash-image-preview",
      apiEndpoint: "https://aiplatform.googleapis.com",
      providerMode,
      prompt: PROMPTS[workflow.id],
      images: workflow.images,
      imageCount: String(imageCount),
      aspectRatio: "1:1",
      outputMimeType: "image/png",
      imageSize: "512",
      jpegQuality: "90",
    }),
  });
  const text = await response.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { raw: text };
  }
  const images = Array.isArray(parsed.images) ? parsed.images : [];
  images.forEach((image, index) => {
    if (!image?.data) return;
    const filePath = path.join(outDir, `${workflow.id}-${providerMode}-${index + 1}.png`);
    fs.writeFileSync(filePath, Buffer.from(image.data, "base64"));
  });
  return {
    workflow: workflow.id,
    providerMode,
    imageCount,
    status: response.status,
    ms: Date.now() - started,
    returnedImages: images.length,
    provider: parsed.provider || null,
    attempts: parsed.attemptedRequests || null,
    error: parsed.error || null,
    text: (parsed.text || "").slice(0, 200),
    errors: (parsed.errors || []).slice(0, 4).map((e) => ({
      request: e.request,
      message: e.message,
      status: e.status,
      provider: e.provider,
    })),
  };
}

async function main() {
  const results = [];
  for (const workflow of WORKFLOWS) {
    results.push(await callGenerate(workflow, 1, "gemini"));
  }
  results.push(await callGenerate(WORKFLOWS[0], 2, "gemini"));
  results.push(await callGenerate(WORKFLOWS[1], 1, "auto"));
  console.log(sanitize(JSON.stringify({ baseUrl, outDir, results }, null, 2)));
}

main().catch((error) => {
  console.error(sanitize(error.stack || error.message));
  process.exit(1);
});
