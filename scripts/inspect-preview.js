const { chromium } = require("playwright");
const path = require("node:path");

const baseUrl = process.env.NANOBANANA_BASE_URL || "http://127.0.0.1:5177";
const fixture = path.resolve("tests/fixtures/pose-source.png");

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  await page.goto(`${baseUrl}/`, { waitUntil: "networkidle" });
  await page.locator(".tab[data-tab='pose']").click();
  await page.locator("input[data-file='poseSource']").setInputFiles(fixture);
  await page.waitForTimeout(500);

  const data = await page.evaluate(() => {
    const preview = document.querySelector("[data-preview='poseSource']");
    const img = preview?.querySelector("img");
    const previewBox = preview?.getBoundingClientRect();
    const imgBox = img?.getBoundingClientRect();
    const previewStyle = preview ? getComputedStyle(preview) : null;
    const imgStyle = img ? getComputedStyle(img) : null;
    return {
      hasPreview: !!preview,
      hasImg: !!img,
      previewBox,
      imgBox,
      previewClass: preview?.className,
      previewStyle: previewStyle && {
        width: previewStyle.width,
        height: previewStyle.height,
        display: previewStyle.display,
        overflow: previewStyle.overflow,
        placeItems: previewStyle.placeItems,
        alignItems: previewStyle.alignItems,
        justifyItems: previewStyle.justifyItems,
      },
      imgStyle: imgStyle && {
        width: imgStyle.width,
        height: imgStyle.height,
        objectFit: imgStyle.objectFit,
        objectPosition: imgStyle.objectPosition,
        maxWidth: imgStyle.maxWidth,
        maxHeight: imgStyle.maxHeight,
        display: imgStyle.display,
      },
      imgNaturalWidth: img?.naturalWidth,
      imgNaturalHeight: img?.naturalHeight,
    };
  });

  console.log(JSON.stringify(data, null, 2));
  await browser.close();
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
