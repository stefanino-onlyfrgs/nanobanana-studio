const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { chromium } = require("playwright");

const baseUrl = process.env.NANOBANANA_BASE_URL || "http://127.0.0.1:5177";

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

function chunk(type, data) {
  const typeBuffer = Buffer.from(type);
  const lengthBuffer = Buffer.alloc(4);
  const crcBuffer = Buffer.alloc(4);
  lengthBuffer.writeUInt32BE(data.length);
  crcBuffer.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])));
  return Buffer.concat([lengthBuffer, typeBuffer, data, crcBuffer]);
}

function createPng(width, height, colorA, colorB) {
  const raw = [];
  for (let y = 0; y < height; y += 1) {
    raw.push(0);
    for (let x = 0; x < width; x += 1) {
      const border = x < 12 || y < 12 || x > width - 13 || y > height - 13;
      const color = border ? colorB : colorA;
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
  const tall = path.join(__dirname, "preview-tall.png");
  const wide = path.join(__dirname, "preview-wide.png");
  fs.writeFileSync(tall, createPng(240, 900, [238, 243, 242], [215, 99, 75]));
  fs.writeFileSync(wide, createPng(900, 240, [255, 246, 230], [53, 107, 95]));

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(`${baseUrl.replace(/\/$/, "")}/`, { waitUntil: "networkidle" });
  await page.locator("input[data-file='swapBase']").setInputFiles(tall);
  await page.locator("input[data-file='swapIdentity']").setInputFiles(wide);
  await page.screenshot({ path: "preview-fit-test.png", fullPage: false });
  const previews = await page.locator(".preview img").count();
  await browser.close();
  console.log(JSON.stringify({ previews, screenshot: "preview-fit-test.png" }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
