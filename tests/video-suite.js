const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const baseUrl = (process.env.NANOBANANA_BASE_URL || "http://127.0.0.1:5177").replace(/\/$/, "");
const fixtureDir = path.join(__dirname, "fixtures");
if (!fs.existsSync(fixtureDir)) fs.mkdirSync(fixtureDir, { recursive: true });

const tinyVideo = path.join(fixtureDir, "tiny.mp4");
if (!fs.existsSync(tinyVideo)) {
  fs.writeFileSync(tinyVideo, Buffer.from([0, 0, 0, 0, 0, 0, 0, 0]));
}

const FIXTURE_ANALYSIS = {
  summary: "A young woman sprints down a wet alley while neon signs reflect on the puddles.",
  subjects: ["young woman in red jacket", "wet asphalt alley", "neon signage"],
  actions: ["sprinting", "splashing puddles", "looking back over shoulder"],
  environment: "narrow alley at night, after rain, Hong Kong style",
  lighting: "magenta and cyan neon key light, low ambient",
  mood: "tense, cinematic, kinetic",
  cameraMovements: ["handheld tracking", "low-angle dolly"],
  durationSeconds: 6.4,
  style: "cinematic 35mm, Roger Deakins-inspired contrast",
  audioNotes: "synth-wave score, footstep splashes",
  bestFrameTimestamp: 1.7,
  bestFrameRationale: "subject faces camera in sharp light",
  seedancePrompt:
    "A young woman in a red jacket sprints, splashing puddles, in a neon-lit Hong Kong alley after rain, camera handheld tracking shot from low angle, style cinematic 35mm with magenta-cyan key light, avoid blurry faces and distorted limbs.",
  klingPrompt:
    "Subject anchor: young woman in red jacket. Low-angle handheld tracking shot, sprinting through puddles. Narrow neon-lit alley at night, magenta and cyan reflections, Hong Kong vibe. Style Bible: cinematic 35mm film, high contrast, kinetic motion.",
};

const checks = [];
const consoleErrors = [];

function record(name, ok, detail = "") {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();

  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  await page.route("**/api/analyze-video", async (route) => {
    const request = route.request();
    let body;
    try {
      body = JSON.parse(request.postData() || "{}");
    } catch {
      body = {};
    }
    if (!body.apiKey) {
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ error: "Inserisci una API key Gemini valida." }),
      });
      return;
    }
    if (!body.video || !body.video.data) {
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ error: "Carica un video da analizzare." }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        analysis: FIXTURE_ANALYSIS,
        model: body.model || "gemini-3.1-pro-preview",
        provider: "Gemini API",
      }),
    });
  });

  await page.goto(`${baseUrl}/`, { waitUntil: "networkidle" });

  await page.click('[data-tab="video"]');
  const panelActive = await page.evaluate(() => {
    const panel = document.querySelector('[data-panel="video"]');
    return panel?.classList.contains("is-active") ?? false;
  });
  record("Tab Video Studio attiva il pannello", panelActive);

  const defaultModel = await page.$eval("#videoAnalysisModel", (el) => el.value);
  record(
    "Modello default = gemini-3.1-pro-preview",
    defaultModel === "gemini-3.1-pro-preview",
    `value=${defaultModel}`,
  );

  const analyzeDisabledInitial = await page.$eval("#analyzeVideo", (el) => el.disabled);
  record(
    "Analizza disabilitato senza video",
    analyzeDisabledInitial === true,
    `disabled=${analyzeDisabledInitial}`,
  );

  await page.fill("#apiKey", "TEST_KEY_FAKE");
  await page.setInputFiles("#videoFile", tinyVideo);

  await page.waitForFunction(() => !document.querySelector("#analyzeVideo").disabled, null, {
    timeout: 5000,
  });
  const analyzeEnabledAfter = await page.$eval("#analyzeVideo", (el) => el.disabled);
  record(
    "Analizza si abilita dopo upload video",
    analyzeEnabledAfter === false,
    `disabled=${analyzeEnabledAfter}`,
  );

  await page.click("#analyzeVideo");
  await page.waitForSelector("#promptPair:not([hidden])", { timeout: 8000 });

  const seedanceText = await page.$eval("#seedancePrompt", (el) => el.value);
  record(
    "Seedance prompt popolato",
    seedanceText.includes("camera handheld tracking"),
    `len=${seedanceText.length}`,
  );

  const klingText = await page.$eval("#klingPrompt", (el) => el.value);
  record(
    "Kling prompt popolato",
    klingText.includes("Style Bible"),
    `len=${klingText.length}`,
  );

  const summaryText = await page.$eval("#videoAnalysisText", (el) => el.textContent);
  record(
    "Summary mostrato nella card analisi",
    summaryText.includes("neon signs"),
    `summary="${summaryText.slice(0, 60)}..."`,
  );

  const tagsCount = await page.$$eval("#videoAnalysisTags li", (els) => els.length);
  record("Tag analisi >= 6", tagsCount >= 6, `tags=${tagsCount}`);

  const bestFrameDisabled = await page.$eval("#seekBestFrame", (el) => el.disabled);
  record(
    "Bottone 'Vai al frame consigliato' abilitato dopo analisi",
    bestFrameDisabled === false,
    `disabled=${bestFrameDisabled}`,
  );

  const sendButtonsCount = await page.$$eval("[data-send-frame]", (els) => els.length);
  record(
    "Bottoni 'Usa frame nel workflow' presenti (5 slot)",
    sendButtonsCount === 5,
    `count=${sendButtonsCount}`,
  );

  await page.click('[data-tab="swap"]');
  const swapActive = await page.evaluate(() =>
    document.querySelector('[data-panel="swap"]')?.classList.contains("is-active") ?? false,
  );
  record("Tab Swap riattivabile dopo Video Studio", swapActive);

  await page.click('[data-tab="video"]');
  const videoActiveAgain = await page.evaluate(() =>
    document.querySelector('[data-panel="video"]')?.classList.contains("is-active") ?? false,
  );
  record("Tab Video Studio riattivabile", videoActiveAgain);

  const screenshotPath = path.join(__dirname, "video-suite.png");
  await page.screenshot({ path: screenshotPath, fullPage: true });

  await browser.close();

  const total = checks.length;
  const passed = checks.filter((c) => c.ok).length;
  const failed = total - passed;

  const summary = {
    baseUrl,
    total,
    passed,
    failed,
    consoleErrors,
    checks,
    screenshot: path.relative(process.cwd(), screenshotPath),
  };

  console.log(JSON.stringify(summary, null, 2));
  process.exit(failed === 0 ? 0 : 1);
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
