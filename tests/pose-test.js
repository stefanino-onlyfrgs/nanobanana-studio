const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const baseUrl = (process.env.NANOBANANA_BASE_URL || "http://127.0.0.1:5177").replace(/\/$/, "");
const apiKey = process.env.NANOBANANA_API_KEY || "";
const mode = (process.env.NANOBANANA_TEST_MODE || (apiKey ? "live" : "mock")).toLowerCase();
const fixturePath = path.join(__dirname, "fixtures", "pose-source.png");

if (!fs.existsSync(fixturePath)) {
  console.error(`Fixture mancante: ${fixturePath}`);
  process.exit(1);
}

function buildMockPng(label, color) {
  const zlib = require("node:zlib");
  const width = 256;
  const height = 256;
  const raw = [];
  for (let y = 0; y < height; y += 1) {
    raw.push(0);
    for (let x = 0; x < width; x += 1) {
      const stripe = ((x + y) >> 5) & 1;
      const c = stripe ? color : [255, 255, 255];
      raw.push(c[0], c[1], c[2], 255);
    }
  }
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
    lengthBuffer.writeUInt32BE(data.length);
    const crcBuffer = Buffer.alloc(4);
    crcBuffer.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])));
    return Buffer.concat([lengthBuffer, typeBuffer, data, crcBuffer]);
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
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  let capturedRequest = null;

  if (mode === "mock") {
    await page.route("**/api/generate", async (route) => {
      const body = route.request().postDataJSON();
      capturedRequest = body;
      const colors = [
        [215, 99, 75],
        [53, 107, 95],
        [201, 149, 53],
        [39, 111, 138],
      ];
      const images = colors.map((color, index) => ({
        data: buildMockPng(`mock-${index + 1}`, color).toString("base64"),
        mimeType: "image/png",
      }));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          images,
          text: "",
          model: body.model,
          requestedCount: Number(body.imageCount) || images.length,
          attemptedRequests: images.length,
          provider: "Mock",
          providerAttempts: [],
          errors: [],
          raw: [],
        }),
      });
    });
  }

  await page.goto(`${baseUrl}/`, { waitUntil: "networkidle" });

  await page.locator("#apiKey").fill(apiKey || "mock-key-not-real");
  const liveProviderMode = (process.env.NANOBANANA_PROVIDER_MODE || "gemini").toLowerCase();
  await page
    .locator("#providerMode")
    .selectOption(mode === "live" ? liveProviderMode : "auto");
  await page.locator("#imageCount").selectOption("4");
  await page.locator("#aspectRatio").selectOption("auto");
  await page.locator("#outputMimeType").selectOption("image/png");
  await page.locator("#imageSize").selectOption("4K");

  await page.locator(".tab[data-tab='pose']").click();
  await page.waitForSelector(".panel[data-panel='pose'].is-active");
  await page.locator("input[data-file='poseSource']").setInputFiles(fixturePath);

  const previewImg = page.locator(".preview[data-preview='poseSource'] img");
  await previewImg.waitFor({ state: "visible", timeout: 15000 });
  const previewBox = await previewImg.boundingBox();

  await page.locator("button[data-generate='pose']").click();

  const liveTimeout = 12 * 60 * 1000;
  const mockTimeout = 30 * 1000;
  const waitTimeout = mode === "live" ? liveTimeout : mockTimeout;

  await page.locator(".result-card").nth(3).waitFor({ state: "visible", timeout: waitTimeout });
  const resultCount = await page.locator(".result-card").count();
  const status = (await page.locator("#status").innerText()).trim();
  const downloads = await page.locator(".result-card a.download").count();

  await page.locator(".result-card .image-open").first().click();
  await page.waitForFunction(() => document.querySelector("#imageModal")?.hidden === false, null, {
    timeout: 5000,
  });
  await page.locator("#zoomIn").click();
  await page.locator("#zoomReset").click();
  const zoomLabel = (await page.locator("#zoomReset").innerText()).trim();
  await page.locator("#imageModal button[data-close-modal]").click();
  await page.waitForFunction(() => document.querySelector("#imageModal")?.hidden === true, null, {
    timeout: 5000,
  });

  const screenshotPath = path.join(__dirname, "..", `pose-${mode}-result.png`);
  await page.screenshot({ path: screenshotPath, fullPage: false });

  const summary = {
    mode,
    baseUrl,
    resultCount,
    expected: 4,
    downloads,
    statusSnippet: status.slice(0, 240),
    zoomLabelAfterReset: zoomLabel,
    previewWidth: previewBox?.width || null,
    previewHeight: previewBox?.height || null,
    screenshot: path.relative(process.cwd(), screenshotPath),
    consoleErrors,
  };
  if (capturedRequest) {
    summary.requestPayload = {
      model: capturedRequest.model,
      imageCount: capturedRequest.imageCount,
      imageSize: capturedRequest.imageSize,
      aspectRatio: capturedRequest.aspectRatio,
      providerMode: capturedRequest.providerMode,
      images: (capturedRequest.images || []).map((image) => ({
        name: image.name,
        mimeType: image.mimeType,
        bytes: image.data ? Math.floor(image.data.length * 0.75) : null,
        fileUri: image.fileUri || null,
      })),
      promptSnippet: String(capturedRequest.prompt || "").slice(0, 80),
    };
  }

  await browser.close();
  console.log(JSON.stringify(summary, null, 2));

  const failures = [];
  if (resultCount !== 4) failures.push(`expected 4 result cards, got ${resultCount}`);
  if (downloads !== 4) failures.push(`expected 4 download buttons, got ${downloads}`);
  if (consoleErrors.length) failures.push(`console errors: ${consoleErrors.join(" | ")}`);
  if (failures.length) {
    console.error("FAIL", failures);
    process.exit(2);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
