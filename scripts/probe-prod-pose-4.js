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

  console.log(`Apro ${base}/ ...`);
  await page.goto(`${base}/`, { waitUntil: "networkidle" });

  await page.fill("#apiKey", apiKey);
  await page.selectOption("#providerMode", "gemini");
  await page.selectOption("#imageCount", "4");

  console.log("Tab pose + upload fixture...");
  await page.click('[data-tab="pose"]');
  await page.locator("input[data-file='poseSource']").setInputFiles(poseFixture);
  await page.waitForFunction(
    () => /aggiornata/i.test(document.querySelector("#status")?.textContent || ""),
    null,
    { timeout: 15000 },
  );

  console.log("Click Genera (4 immagini in parallelo)...");
  const t0 = Date.now();
  await page.click('[data-generate="pose"]');

  console.log("Attendo che si completi il flow (max 90s)...");
  await page.waitForFunction(
    () => {
      const status = document.querySelector("#status")?.textContent || "";
      return /Fatto:|fallit|errore|annullata/i.test(status);
    },
    null,
    { timeout: 90000 },
  );
  const elapsed = Date.now() - t0;

  const status = await page.$eval("#status", (el) => el.textContent);
  const resultCount = await page.$$eval(".result-card img", (els) => els.length);
  console.log(`\nElapsed: ${(elapsed / 1000).toFixed(1)}s`);
  console.log(`Risultati renderizzati: ${resultCount}`);
  console.log(`Status: "${status}"`);
  console.log(`Console errors: ${consoleErrors.length}`);
  consoleErrors.forEach((e) => console.log("  -", e));

  const screenshotPath = path.join(__dirname, "..", "screenshots", "prod-pose-4-real.png");
  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log(`Screenshot: ${screenshotPath}`);

  await browser.close();
  process.exit(resultCount >= 1 && consoleErrors.length === 0 ? 0 : 1);
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
