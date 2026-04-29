"use strict";

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const apiKey = process.env.NANOBANANA_API_KEY || "";
const base = process.env.PROD_URL || "https://nanobanana-studio-sage.vercel.app";

if (!apiKey) {
  console.error("Missing NANOBANANA_API_KEY env var.");
  process.exit(1);
}

const sanitize = (value) => String(value || "").split(apiKey).join("<redacted>");
const checks = [];
function record(name, ok, detail = "") {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` -- ${detail}` : ""}`);
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = -1;
  for (const b of buf) c = (c >>> 8) ^ crcTable[(c ^ b) & 255];
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const t = Buffer.from(type);
  const lb = Buffer.alloc(4);
  lb.writeUInt32BE(data.length);
  const cb = Buffer.alloc(4);
  cb.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([lb, t, data, cb]);
}
function buildPng(width, height, color) {
  const raw = [];
  for (let y = 0; y < height; y += 1) {
    raw.push(0);
    for (let x = 0; x < width; x += 1) {
      const stripe = ((x + y) >> 5) & 1;
      const c = stripe ? color : [255, 255, 255];
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
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(Buffer.from(raw))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

async function call(method, urlPath, body) {
  const url = `${base}${urlPath}`;
  const headers = body ? { "Content-Type": "application/json" } : {};
  const response = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  return { status: response.status, body: json };
}

(async () => {
  // 1. Static
  const homeResponse = await fetch(`${base}/`);
  record("Home /", homeResponse.status === 200, `status=${homeResponse.status}`);

  const appJs = await fetch(`${base}/app.js`).then((r) => r.text());
  const hasCompression = /smartCompress|MAX_INLINE_BYTES/.test(appJs);
  record("app.js contiene smartCompress (compressione attiva)", hasCompression);

  const stylesCss = await fetch(`${base}/styles.css`).then((r) => r.text());
  const hasMobileBreakpoint = /max-width:\s*480px/.test(stylesCss);
  record("styles.css ha breakpoint mobile 480px", hasMobileBreakpoint);

  // 2. API health
  const health = await call("GET", "/api/health");
  record("/api/health", health.status === 200 && health.body.ok === true, `status=${health.status}`);

  // 3. Validations
  const v1 = await call("POST", "/api/generate", {});
  record("/api/generate vuoto -> 400", v1.status === 400, `status=${v1.status} msg=${v1.body.error}`);

  const v2 = await call("POST", "/api/analyze-video", {
    apiKey: "x",
    video: { mimeType: "audio/wav", data: "AAAA" },
  });
  record(
    "/api/analyze-video bad mime -> 400",
    v2.status === 400 && /audio\/wav/.test(v2.body.error || ""),
    `status=${v2.status}`
  );

  // 4. Test key con chiave reale
  const testKey = await call("POST", "/api/test-key", {
    apiKey,
    apiEndpoint: "https://aiplatform.googleapis.com",
    providerMode: "auto",
    model: "gemini-3.1-flash-image-preview",
  });
  record(
    "/api/test-key con chiave reale -> Gemini API ok",
    testKey.status === 200 && testKey.body?.geminiApi?.ok === true,
    `vertex=${testKey.body?.vertex?.ok} gemini=${testKey.body?.geminiApi?.ok}`
  );

  // 5. Real generation con piccola immagine PNG (1 sola, 256x256)
  const png = buildPng(256, 256, [53, 107, 95]);
  const pngBase64 = png.toString("base64");
  const generateBody = {
    apiKey,
    apiEndpoint: "https://aiplatform.googleapis.com",
    providerMode: "auto",
    model: "gemini-3.1-flash-image-preview",
    prompt: "Take this striped pattern and make it more vivid with golden highlights.",
    images: [{ mimeType: "image/png", data: pngBase64 }],
    imageCount: 1,
    aspectRatio: "auto",
    outputMimeType: "image/png",
    imageSize: "auto",
    jpegQuality: 90,
  };
  console.log("\nLancio una vera richiesta /api/generate (puo' richiedere 15-30s)...");
  const generated = await call("POST", "/api/generate", generateBody);
  const gotImage =
    generated.status === 200 &&
    Array.isArray(generated.body.images) &&
    generated.body.images.length > 0;
  record(
    "/api/generate ritorna almeno 1 immagine reale",
    gotImage,
    `status=${generated.status} count=${generated.body?.images?.length || 0} provider=${generated.body?.provider || "?"} text="${(generated.body?.text || "").slice(0, 80)}"`
  );

  if (gotImage) {
    const outPath = path.join(__dirname, "..", "screenshots", "prod-generated.png");
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    const buf = Buffer.from(generated.body.images[0].data, "base64");
    fs.writeFileSync(outPath, buf);
    console.log(`Immagine generata salvata: ${outPath} (${buf.length} byte)`);
  }

  const total = checks.length;
  const passed = checks.filter((c) => c.ok).length;
  console.log(`\nTotale: ${passed}/${total}`);
  console.log(sanitize(JSON.stringify({ base, passed, total }, null, 2)));
  process.exit(passed === total ? 0 : 1);
})().catch((error) => {
  console.error(sanitize(error.stack || error.message));
  process.exit(1);
});
