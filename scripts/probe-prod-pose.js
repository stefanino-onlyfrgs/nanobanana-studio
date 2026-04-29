"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const apiKey = process.env.NANOBANANA_API_KEY || "";
const base = (process.env.PROD_URL || "https://nanobanana-studio-sage.vercel.app").replace(/\/$/, "");
if (!apiKey) {
  console.error("Missing NANOBANANA_API_KEY env var.");
  process.exit(1);
}

const fixtureDir = path.join(__dirname, "..", "tests", "fixtures");
const poseFixture = path.join(fixtureDir, "pose-source.png");
if (!fs.existsSync(poseFixture)) {
  console.error("Fixture pose-source.png mancante.");
  process.exit(1);
}

const consoleErrors = [];

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
  });
  const page = await context.newPage();
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  console.log(`Apro ${base}/ in viewport iPhone 14 (390x844)...`);
  await page.goto(`${base}/`, { waitUntil: "networkidle" });

  await page.fill("#apiKey", apiKey);
  await page.selectOption("#providerMode", "auto");
  await page.selectOption("#imageCount", "1");

  console.log("Clicco tab 02 - Nuova posa...");
  await page.click('[data-tab="pose"]');
  const panelActive = await page.evaluate(
    () => document.querySelector('[data-panel="pose"]')?.classList.contains("is-active") ?? false,
  );
  console.log(`Panel pose attivo: ${panelActive}`);

  console.log("Carico fixture come Immagine sorgente...");
  await page.locator("input[data-file='poseSource']").setInputFiles(poseFixture);
  await page.waitForFunction(
    () => /aggiornata/i.test(document.querySelector("#status")?.textContent || ""),
    null,
    { timeout: 15000 },
  );
  const uploadStatus = await page.$eval("#status", (el) => el.textContent);
  console.log(`Status post-upload: "${uploadStatus}"`);

  console.log("Clicco Genera dal pannello pose...");
  await page.click('[data-generate="pose"]');

  console.log("Attendo immagine generata reale (max 60s)...");
  await page.waitForSelector(".result-card img", { timeout: 60000 });

  const resultCount = await page.$$eval(".result-card img", (els) => els.length);
  const provider = await page.$$eval(
    ".result-badges span",
    (els) => els.map((el) => el.textContent.trim()).join(" | "),
  );
  console.log(`Risultati: ${resultCount}`);
  console.log(`Badges: ${provider}`);

  const screenshotPath = path.join(__dirname, "..", "screenshots", "prod-mobile-pose-real.png");
  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log(`Screenshot: ${screenshotPath}`);

  console.log(`Console errors: ${consoleErrors.length}`);
  consoleErrors.forEach((e) => console.log("  -", e));

  // Estraggo anche l'immagine generata per ispezione
  const dataUrl = await page.$eval(".result-card img", (img) => img.src);
  if (dataUrl.startsWith("data:")) {
    const match = dataUrl.match(/^data:image\/[a-z]+;base64,(.*)$/);
    if (match) {
      const out = path.join(__dirname, "..", "screenshots", "prod-pose-generated.png");
      fs.writeFileSync(out, Buffer.from(match[1], "base64"));
      console.log(`Immagine PNG generata salvata: ${out}`);
    }
  }

  await browser.close();
  process.exit(resultCount > 0 && consoleErrors.length === 0 ? 0 : 1);
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
