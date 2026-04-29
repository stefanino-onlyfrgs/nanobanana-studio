"use strict";

const base = process.env.PROD_URL || "https://nanobanana-studio.onrender.com";

async function tryDuration(seconds) {
  const ms = seconds * 1000;
  const start = Date.now();
  console.log(`\n>>> Provo sleep di ${seconds}s ...`);
  try {
    const response = await fetch(`${base}/api/sleep`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ms }),
    });
    const text = await response.text();
    const elapsed = (Date.now() - start) / 1000;
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text.slice(0, 200) };
    }
    console.log(`    HTTP ${response.status} dopo ${elapsed.toFixed(1)}s`);
    console.log(`    Body: ${JSON.stringify(body).slice(0, 200)}`);
    return { seconds, ok: response.status === 200, elapsed, status: response.status, body };
  } catch (error) {
    const elapsed = (Date.now() - start) / 1000;
    console.log(`    ERRORE dopo ${elapsed.toFixed(1)}s: ${error.message}`);
    return { seconds, ok: false, elapsed, error: error.message };
  }
}

(async () => {
  const targets = [
    Number(process.argv[2]) || 70,
    Number(process.argv[3]) || 150,
    Number(process.argv[4]) || 300,
  ];
  const results = [];
  for (const sec of targets) {
    const r = await tryDuration(sec);
    results.push(r);
  }
  console.log("\n=== RIASSUNTO ===");
  for (const r of results) {
    console.log(`  ${r.seconds}s -> ${r.ok ? "OK" : "FAIL"} (elapsed=${r.elapsed.toFixed(1)}s${r.error ? ", err=" + r.error : ""})`);
  }
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
