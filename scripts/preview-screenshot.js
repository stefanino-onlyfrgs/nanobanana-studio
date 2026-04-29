const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const baseUrl = process.env.NANOBANANA_BASE_URL || "http://127.0.0.1:5177";
const imagePath = process.argv[2];
if (!imagePath || !fs.existsSync(imagePath)) {
  console.error("Usage: node scripts/preview-screenshot.js <image-path>");
  process.exit(1);
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  await page.goto(`${baseUrl}/`, { waitUntil: "networkidle" });

  // Workflow 1 — two slots
  await page.locator(".tab[data-tab='swap']").click();
  await page.locator("input[data-file='swapBase']").setInputFiles(imagePath);
  await page.locator("input[data-file='swapIdentity']").setInputFiles(imagePath);
  await page.waitForTimeout(400);
  await page.screenshot({ path: "preview-swap.png", fullPage: false });

  // Workflow 2 — single slot, full width
  await page.locator(".tab[data-tab='pose']").click();
  await page.locator("input[data-file='poseSource']").setInputFiles(imagePath);
  await page.waitForTimeout(400);
  await page.screenshot({ path: "preview-pose.png", fullPage: false });

  // Workflow 3 — two slots
  await page.locator(".tab[data-tab='background']").click();
  await page.locator("input[data-file='backgroundScene']").setInputFiles(imagePath);
  await page.locator("input[data-file='backgroundPerson']").setInputFiles(imagePath);
  await page.waitForTimeout(400);
  await page.screenshot({ path: "preview-background.png", fullPage: false });

  // Mobile-ish viewport
  await page.setViewportSize({ width: 720, height: 1100 });
  await page.locator(".tab[data-tab='pose']").click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: "preview-pose-mobile.png", fullPage: false });

  await browser.close();
  console.log("OK saved: preview-swap.png, preview-pose.png, preview-background.png, preview-pose-mobile.png");
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
