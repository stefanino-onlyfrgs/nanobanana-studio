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
const sceneFixture = path.join(fixtureDir, "scene.png");
const personFixture = path.join(fixtureDir, "person.png");
if (!fs.existsSync(sceneFixture) || !fs.existsSync(personFixture)) {
  console.error("Fixtures mancanti. Lancia prima la full-ui-suite per generarle.");
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

  console.log(`Apro ${base}/ in viewport iPhone (390x844)...`);
  await page.goto(`${base}/`, { waitUntil: "networkidle" });

  console.log("Imposto API key e modalita Auto...");
  await page.fill("#apiKey", apiKey);
  await page.selectOption("#providerMode", "auto");
  await page.selectOption("#imageCount", "1");

  console.log("Carico fixture come Persona 1 (swap base)...");
  await page.locator("input[data-file='swapBase']").setInputFiles(sceneFixture);
  await page.waitForFunction(
    () => /aggiornata/i.test(document.querySelector("#status")?.textContent || ""),
    null,
    { timeout: 15000 }
  );
  console.log(`Status dopo upload 1: "${await page.$eval("#status", (el) => el.textContent)}"`);

  console.log("Carico fixture come Persona 2 (swap identity)...");
  await page.locator("input[data-file='swapIdentity']").setInputFiles(personFixture);
  await page.waitForFunction(
    () => /aggiornata.*Persona 2|Persona 2.*aggiornata/i.test(document.querySelector("#status")?.textContent || ""),
    null,
    { timeout: 15000 }
  );
  console.log(`Status dopo upload 2: "${await page.$eval("#status", (el) => el.textContent)}"`);

  console.log("Clicco Genera dal pannello swap...");
  await page.click('[data-generate="swap"]');

  console.log("Attendo risultato (max 60s)...");
  await page.waitForSelector(".result-card img", { timeout: 60000 });

  const resultCount = await page.$$eval(".result-card img", (els) => els.length);
  console.log(`Risultati renderizzati: ${resultCount}`);

  const screenshotPath = path.join(__dirname, "..", "screenshots", "prod-mobile-end-to-end.png");
  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log(`Screenshot salvato: ${screenshotPath}`);

  console.log(`Console errors: ${consoleErrors.length}`);
  consoleErrors.forEach((e) => console.log("  -", e));

  await browser.close();
  process.exit(resultCount > 0 && consoleErrors.length === 0 ? 0 : 1);
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
