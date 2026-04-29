const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { chromium } = require("playwright");

const key = process.env.NANOBANANA_API_KEY || "";
if (!key) {
  console.error("Missing NANOBANANA_API_KEY.");
  process.exit(1);
}

const baseUrl = process.env.NANOBANANA_BASE_URL || "http://127.0.0.1:5177";

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return c >>> 0;
});

function crc32(buffer) {
  let c = -1;
  for (const byte of buffer) c = (c >>> 8) ^ crcTable[(c ^ byte) & 255];
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

async function main() {
  const inputA = path.join(__dirname, "diagnostic-input-a.png");
  const inputB = path.join(__dirname, "diagnostic-input-b.png");
  fs.writeFileSync(inputA, createPng(128, 128, [238, 243, 242], [215, 99, 75]));
  fs.writeFileSync(inputB, createPng(128, 128, [255, 246, 230], [53, 107, 95]));

  const browser = await chromium.launch({
    headless: true,
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  await page.goto(`${baseUrl.replace(/\/$/, "")}/`, { waitUntil: "networkidle" });
  await page.locator("#apiKey").fill(key);
  await page.locator("#providerMode").selectOption("gemini");
  await page.locator("#imageCount").selectOption("1");
  await page.locator("#aspectRatio").selectOption("1:1");
  await page.locator("#outputMimeType").selectOption("image/png");
  await page.locator("#imageSize").selectOption("512");
  await page.locator("input[data-file='swapBase']").setInputFiles(inputA);
  await page.locator("input[data-file='swapIdentity']").setInputFiles(inputB);
  await page.locator("button[data-generate='swap']").click();
  await page.locator(".result-card img").first().waitFor({
    state: "visible",
    timeout: 180000,
  });

  const resultCount = await page.locator(".result-card").count();
  const status = await page.locator("#status").innerText();
  await page.screenshot({ path: "e2e-ui-test.png", fullPage: false });
  await browser.close();

  console.log(
    JSON.stringify(
      {
        ok: resultCount > 0,
        resultCount,
        status,
        consoleErrors,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
