const zlib = require("node:zlib");
const fs = require("node:fs");

const key = process.env.NANOBANANA_API_KEY || "";
if (!key) {
  console.error("Missing NANOBANANA_API_KEY.");
  process.exit(1);
}

const sanitize = (value) => String(value || "").split(key).join("<redacted>");

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return c >>> 0;
});

function crc32(buffer) {
  let c = -1;
  for (const byte of buffer) {
    c = (c >>> 8) ^ crcTable[(c ^ byte) & 255];
  }
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type);
  const lengthBuffer = Buffer.alloc(4);
  lengthBuffer.writeUInt32BE(data.length);
  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])));
  return Buffer.concat([lengthBuffer, typeBuffer, data, crcBuffer]);
}

function createPng(width, height, background, circle) {
  const raw = [];
  for (let y = 0; y < height; y += 1) {
    raw.push(0);
    for (let x = 0; x < width; x += 1) {
      const inCircle =
        (x - width / 2) ** 2 + (y - height / 2) ** 2 <
        (width * 0.28) ** 2;
      const color = inCircle ? circle : background;
      raw.push(color[0], color[1], color[2], 255);
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

async function post(name, url, payload) {
  const started = Date.now();
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": key,
      },
      body: JSON.stringify(payload),
    });

    const text = await response.text();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { raw: text };
    }

    const parts = parsed?.candidates?.[0]?.content?.parts || [];
    const images = parts
      .filter((part) => part.inlineData || part.inline_data)
      .map((part) => part.inlineData || part.inline_data);

    if (images[0]?.data) {
      const safeName = name.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
      fs.writeFileSync(
        `diagnostic-${safeName}.png`,
        Buffer.from(images[0].data, "base64")
      );
    }

    return {
      name,
      ok: response.ok,
      status: response.status,
      ms: Date.now() - started,
      imageCount: images.length,
      textParts: parts
        .filter((part) => part.text)
        .map((part) => part.text)
        .join(" ")
        .slice(0, 300),
      error: parsed.error ? parsed.error.message : null,
    };
  } catch (error) {
    return {
      name,
      ok: false,
      status: null,
      ms: Date.now() - started,
      imageCount: 0,
      error: error.message,
    };
  }
}

async function main() {
  const img1 = createPng(128, 128, [238, 243, 242], [215, 99, 75]).toString(
    "base64"
  );
  const img2 = createPng(128, 128, [255, 246, 230], [53, 107, 95]).toString(
    "base64"
  );

  const geminiConfig = {
    responseModalities: ["TEXT", "IMAGE"],
    imageConfig: { aspectRatio: "1:1", imageSize: "512" },
  };
  const vertexConfig = {
    responseModalities: ["TEXT", "IMAGE"],
    imageConfig: { aspectRatio: "1:1", imageSize: "512" },
  };

  const tests = [];
  tests.push(
    await post(
      "gemini-text-to-image",
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image-preview:generateContent",
      {
        contents: [
          {
            role: "user",
            parts: [
              {
                text: "Create a simple clean 512px icon of a red circle on a pale background. No text.",
              },
            ],
          },
        ],
        generationConfig: geminiConfig,
      }
    )
  );
  tests.push(
    await post(
      "gemini-edit",
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image-preview:generateContent",
      {
        contents: [
          {
            role: "user",
            parts: [
              { inline_data: { mime_type: "image/png", data: img1 } },
              { inline_data: { mime_type: "image/png", data: img2 } },
              {
                text: "Create a simple edited image inspired by the two reference images. Keep it abstract. No text.",
              },
            ],
          },
        ],
        generationConfig: geminiConfig,
      }
    )
  );
  tests.push(
    await post(
      "vertex-text-to-image",
      "https://aiplatform.googleapis.com/v1/publishers/google/models/gemini-3.1-flash-image-preview:generateContent",
      {
        contents: [
          {
            role: "user",
            parts: [
              {
                text: "Create a simple clean 512px icon of a red circle on a pale background. No text.",
              },
            ],
          },
        ],
        generationConfig: vertexConfig,
      }
    )
  );
  tests.push(
    await post(
      "vertex-edit",
      "https://aiplatform.googleapis.com/v1/publishers/google/models/gemini-3.1-flash-image-preview:generateContent",
      {
        contents: [
          {
            role: "user",
            parts: [
              { inlineData: { mimeType: "image/png", data: img1 } },
              { inlineData: { mimeType: "image/png", data: img2 } },
              {
                text: "Create a simple edited image inspired by the two reference images. Keep it abstract. No text.",
              },
            ],
          },
        ],
        generationConfig: vertexConfig,
      }
    )
  );

  console.log(sanitize(JSON.stringify(tests, null, 2)));
}

main().catch((error) => {
  console.error(sanitize(error.stack || error.message));
  process.exit(1);
});
