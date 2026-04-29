const path = require("node:path");
const { chromium } = require("playwright");

const baseUrl = (process.env.NANOBANANA_BASE_URL || "http://127.0.0.1:5177").replace(/\/$/, "");
const outDir = process.argv[2] || "screenshots/mobile";

async function shoot(page, label) {
  const file = path.join(outDir, `${label}.png`);
  await page.screenshot({ path: file, fullPage: true });
  console.log(`Saved ${file}`);
}

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
  await page.goto(`${baseUrl}/`, { waitUntil: "networkidle" });
  await shoot(page, "01-swap");

  await page.click('[data-tab="pose"]');
  await page.waitForTimeout(200);
  await shoot(page, "02-pose");

  await page.click('[data-tab="background"]');
  await page.waitForTimeout(200);
  await shoot(page, "03-background");

  await page.click('[data-tab="video"]');
  await page.waitForTimeout(200);
  await shoot(page, "04-video");

  await browser.close();
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
