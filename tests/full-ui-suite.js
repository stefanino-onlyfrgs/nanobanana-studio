const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { chromium } = require("playwright");

const baseUrl = (process.env.NANOBANANA_BASE_URL || "http://127.0.0.1:5177").replace(/\/$/, "");
const fixtureDir = path.join(__dirname, "fixtures");
const poseFixture = path.join(fixtureDir, "pose-source.png");

if (!fs.existsSync(poseFixture)) {
  console.error(`Fixture mancante: ${poseFixture}`);
  process.exit(1);
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

const sceneFixture = path.join(fixtureDir, "scene.png");
fs.writeFileSync(sceneFixture, buildPng(256, 256, [53, 107, 95]));
const personFixture = path.join(fixtureDir, "person.png");
fs.writeFileSync(personFixture, buildPng(256, 256, [215, 99, 75]));

const checks = [];
function record(name, ok, detail) {
  checks.push({ name, ok, detail });
}

async function modalIsOpen(page) {
  return page.evaluate(() => document.querySelector("#imageModal")?.hidden === false);
}

async function modalIsClosed(page) {
  return page.evaluate(() => document.querySelector("#imageModal")?.hidden === true);
}

async function setupMockGenerate(page, { count, color }) {
  await page.unroute("**/api/generate").catch(() => {});
  await page.route("**/api/generate", async (route) => {
    const body = route.request().postDataJSON();
    const images = Array.from({ length: Number(body.imageCount) || count || 1 }).map(() => ({
      data: buildPng(192, 192, color).toString("base64"),
      mimeType: "image/png",
    }));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        images,
        text: "",
        model: body.model,
        requestedCount: images.length,
        attemptedRequests: images.length,
        provider: "Mock",
        providerAttempts: [],
        errors: [],
        raw: [],
      }),
    });
  });
}

async function setupMockTestKey(page, payload) {
  await page.unroute("**/api/test-key").catch(() => {});
  await page.route("**/api/test-key", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(payload),
    });
  });
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

  await page.goto(`${baseUrl}/`, { waitUntil: "networkidle" });

  await page.locator("#apiKey").fill("mock-api-key-1234");
  await page.locator("#imageCount").selectOption("4");
  await page.locator("#aspectRatio").selectOption("auto");
  await page.locator("#outputMimeType").selectOption("image/png");
  await page.locator("#imageSize").selectOption("4K");

  const generateLabel = (await page.locator("button[data-generate='swap']").innerText()).trim();
  record(
    "Etichetta bottone Genera aggiornata con il numero richieste",
    generateLabel === "Genera 4 immagini",
    `label="${generateLabel}"`
  );

  await page.locator("#outputMimeType").selectOption("image/jpeg");
  const jpegEnabled = await page.locator("#jpegQuality").isEnabled();
  record(
    "Slider qualita JPEG abilitato quando output e' JPEG",
    jpegEnabled === true,
    `enabled=${jpegEnabled}`
  );
  await page.locator("#outputMimeType").selectOption("image/png");
  const pngLabel = (await page.locator("#jpegQualityValue").innerText()).trim();
  const jpegDisabled = await page.locator("#jpegQuality").isDisabled();
  record(
    "Slider JPEG disabilitato + label PNG quando output e' PNG",
    jpegDisabled === true && pngLabel === "PNG",
    `disabled=${jpegDisabled}, label=${pngLabel}`
  );

  await page.locator(".tab[data-tab='swap']").click();
  await page.waitForSelector(".panel[data-panel='swap'].is-active");
  await page.locator("input[data-file='swapBase']").setInputFiles(sceneFixture);
  await page.locator("input[data-file='swapIdentity']").setInputFiles(personFixture);

  await setupMockGenerate(page, { count: 4, color: [201, 149, 53] });
  await page.locator("button[data-generate='swap']").click();
  await page.locator(".result-card").nth(3).waitFor({ state: "visible", timeout: 15000 });
  const swapCount = await page.locator(".result-card").count();
  record("Swap: 4 risultati renderizzati", swapCount === 4, `count=${swapCount}`);

  await page.locator(".tab[data-tab='pose']").click();
  await page.waitForSelector(".panel[data-panel='pose'].is-active");
  await page.locator("input[data-file='poseSource']").setInputFiles(poseFixture);

  await setupMockGenerate(page, { count: 4, color: [215, 99, 75] });
  await page.locator("button[data-generate='pose']").click();
  await page.locator(".result-card").nth(3).waitFor({ state: "visible", timeout: 15000 });
  const poseCount = await page.locator(".result-card").count();
  const poseDownloads = await page.locator(".result-card a.download").count();
  record(
    "Pose: 4 risultati e 4 download (con immagine reale)",
    poseCount === 4 && poseDownloads === 4,
    `cards=${poseCount}, downloads=${poseDownloads}`
  );

  await page.locator(".result-card .image-open").first().click();
  await page.waitForFunction(() => document.querySelector("#imageModal")?.hidden === false, null, { timeout: 5000 });
  const focusOnClose = await page.evaluate(() => {
    const active = document.activeElement;
    return active ? active.textContent?.trim() : "";
  });
  record(
    "Modale: focus iniziale sul bottone Chiudi",
    /chiudi/i.test(focusOnClose || ""),
    `activeText="${focusOnClose}"`
  );
  await page.locator("#zoomIn").click();
  await page.locator("#zoomIn").click();
  const zoomLabelAfterPlus = (await page.locator("#zoomReset").innerText()).trim();
  await page.locator("#zoomReset").click();
  const zoomLabelAfterReset = (await page.locator("#zoomReset").innerText()).trim();
  record(
    "Modale zoom: +/+/reset porta a 100%",
    zoomLabelAfterPlus !== "100%" && zoomLabelAfterReset === "100%",
    `after+=${zoomLabelAfterPlus}, reset=${zoomLabelAfterReset}`
  );
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => document.querySelector("#imageModal")?.hidden === true, null, { timeout: 5000 });
  record("Modale: chiusura con Escape", await modalIsClosed(page), "");

  await page.locator(".tab[data-tab='background']").click();
  await page.waitForSelector(".panel[data-panel='background'].is-active");
  const bgLibraryOptions = await page
    .locator("select[data-library='backgroundScene'] option")
    .count();
  record(
    "Libreria condivisa popolata tra workflow",
    bgLibraryOptions > 1,
    `option_count=${bgLibraryOptions}`
  );
  await page
    .locator("select[data-library='backgroundScene']")
    .selectOption({ label: /scene\.png|swap.*generata|Sostituzione/i })
    .catch(async () => {
      const values = await page
        .locator("select[data-library='backgroundScene'] option")
        .evaluateAll((nodes) => nodes.map((n) => n.value).filter(Boolean));
      if (values.length) {
        await page.locator("select[data-library='backgroundScene']").selectOption(values[0]);
      }
    });
  await page.locator("input[data-file='backgroundPerson']").setInputFiles(personFixture);
  await setupMockGenerate(page, { count: 4, color: [39, 111, 138] });
  await page.locator("button[data-generate='background']").click();
  await page.locator(".result-card").nth(3).waitFor({ state: "visible", timeout: 15000 });
  const bgCount = await page.locator(".result-card").count();
  record("Background: 4 risultati renderizzati", bgCount === 4, `count=${bgCount}`);

  await page.locator(".tab[data-tab='pose']").click();
  await page.waitForSelector(".panel[data-panel='pose'].is-active");
  await page.locator("input[data-uri-input='poseSource']").fill("invalid-uri");
  await page.locator("button[data-uri-button='poseSource']").click();
  const statusUriError = (await page.locator("#status").innerText()).trim();
  const statusClass = await page.locator("#status").getAttribute("class");
  record(
    "URI invalido mostra errore",
    /gs:\/\//.test(statusUriError) && statusClass.includes("error"),
    `status=${statusUriError}`
  );

  await page.locator("input[data-uri-input='poseSource']").fill("https://example.com/foo.jpg");
  await page.locator("button[data-uri-button='poseSource']").click();
  const optionsAfterUri = await page
    .locator("select[data-library='poseSource'] option")
    .count();
  record(
    "URI valido aggiunto in libreria",
    optionsAfterUri > 1,
    `option_count=${optionsAfterUri}`
  );

  await page.locator("#clearLibrary").click();
  const libraryClassAfterClear = await page.locator("#assetList").getAttribute("class");
  const optionsAfterClear = await page
    .locator("select[data-library='poseSource'] option")
    .count();
  record(
    "Svuota libreria reimposta tutto",
    libraryClassAfterClear?.includes("empty") && optionsAfterClear === 1,
    `class=${libraryClassAfterClear}, options=${optionsAfterClear}`
  );

  await page.locator("#clearResults").click();
  const resultClass = await page.locator("#results").getAttribute("class");
  record(
    "Pulsante 'Pulisci' azzera la griglia risultati",
    resultClass?.includes("empty"),
    `class=${resultClass}`
  );

  await setupMockTestKey(page, {
    vertex: { ok: true, status: 200, message: "Vertex Express risponde.", reason: null },
    selectedModel: { ok: true, status: 200, message: "Modello OK.", reason: null },
    geminiApi: { ok: false, status: 403, message: "API non abilitata.", reason: "SERVICE_DISABLED", activationUrl: "https://console.cloud.google.com/apis" },
  });
  await page.locator("#testApiKey").click();
  await page.locator("#apiDiagnostics .diagnostic-item").nth(2).waitFor({ timeout: 5000 });
  const diagnosticsClass = await page.locator("#apiDiagnostics").getAttribute("class");
  const diagnosticTexts = await page
    .locator("#apiDiagnostics .diagnostic-item")
    .evaluateAll((nodes) => nodes.map((node) => node.className.trim()));
  record(
    "Test API mostra 3 righe diagnostica con stati corretti",
    diagnosticsClass.includes("is-visible") &&
      diagnosticTexts.length === 3 &&
      diagnosticTexts[0].includes("ok") &&
      diagnosticTexts[1].includes("ok") &&
      (diagnosticTexts[2].includes("error") || diagnosticTexts[2].includes("warn")),
    JSON.stringify(diagnosticTexts)
  );

  const initialKeyType = await page.locator("#apiKey").getAttribute("type");
  await page.locator("#toggleApiKey").click();
  const toggledKeyType = await page.locator("#apiKey").getAttribute("type");
  await page.locator("#toggleApiKey").click();
  const finalKeyType = await page.locator("#apiKey").getAttribute("type");
  record(
    "Toggle visibilita' API key (password ↔ text)",
    initialKeyType === "password" && toggledKeyType === "text" && finalKeyType === "password",
    `${initialKeyType}->${toggledKeyType}->${finalKeyType}`
  );

  let formSubmitFiredReload = false;
  page.on("framenavigated", () => {
    formSubmitFiredReload = true;
  });
  await page.locator("#apiEndpoint").click();
  await page.keyboard.press("Enter");
  await page.waitForTimeout(500);
  record(
    "Invio nei campi del form non ricarica la pagina",
    formSubmitFiredReload === false,
    `navigated=${formSubmitFiredReload}`
  );

  await page.locator("#imageSize").selectOption("2K");
  await page.locator("#aspectRatio").selectOption("16:9");
  await page.reload({ waitUntil: "networkidle" });
  const persistedSize = await page.locator("#imageSize").inputValue();
  const persistedAspect = await page.locator("#aspectRatio").inputValue();
  record(
    "Settings persistiti su localStorage dopo reload",
    persistedSize === "2K" && persistedAspect === "16:9",
    `size=${persistedSize}, aspect=${persistedAspect}`
  );

  const screenshotPath = path.join(__dirname, "..", "full-ui-suite.png");
  await page.screenshot({ path: screenshotPath, fullPage: false });

  await browser.close();

  const summary = {
    baseUrl,
    total: checks.length,
    passed: checks.filter((c) => c.ok).length,
    failed: checks.filter((c) => !c.ok).length,
    consoleErrors,
    checks,
    screenshot: path.relative(process.cwd(), screenshotPath),
  };

  console.log(JSON.stringify(summary, null, 2));

  if (summary.failed > 0 || consoleErrors.length > 0) {
    process.exit(2);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
