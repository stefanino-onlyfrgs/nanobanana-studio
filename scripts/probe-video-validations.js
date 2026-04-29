const base = process.env.BASE_URL || "http://127.0.0.1:5177";

async function call(name, payload) {
  const response = await fetch(`${base}/api/analyze-video`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }
  console.log(`[${name}] ${response.status} ${JSON.stringify(body)}`);
  return { status: response.status, body };
}

async function main() {
  await call("missing key", {});
  await call("missing video", { apiKey: "test" });
  await call("bad mime", {
    apiKey: "test",
    video: { mimeType: "audio/wav", data: "AAAA" },
  });

  const health = await fetch(`${base}/api/health`);
  console.log(`[health] ${health.status} ${await health.text()}`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
