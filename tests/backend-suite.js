const baseUrl = (process.env.NANOBANANA_BASE_URL || "http://127.0.0.1:5177").replace(/\/$/, "");

const checks = [];
function record(name, ok, detail) {
  checks.push({ name, ok, detail });
}

async function postJson(pathname, body) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  return { status: response.status, json };
}

async function main() {
  const health = await fetch(`${baseUrl}/api/health`).then((r) => r.json());
  record("/api/health risponde ok", health.ok === true, JSON.stringify(health));

  const malformed = await fetch(`${baseUrl}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{not-json",
  });
  const malformedBody = await malformed.json().catch(() => ({}));
  record(
    "JSON malformato -> 400 con errore in italiano",
    malformed.status === 400 && /JSON non valida/i.test(malformedBody.error || ""),
    `${malformed.status} ${malformedBody.error}`
  );

  const noKey = await postJson("/api/generate", {
    apiKey: "",
    model: "gemini-3.1-flash-image-preview",
    prompt: "x",
    images: [{ data: "x" }],
  });
  record(
    "Generate senza API key -> 400",
    noKey.status === 400 && /API key/i.test(noKey.json.error || ""),
    `${noKey.status} ${noKey.json.error}`
  );

  const noPrompt = await postJson("/api/generate", {
    apiKey: "x",
    model: "x",
    prompt: "",
    images: [{ data: "x" }],
  });
  record(
    "Generate senza prompt -> 400",
    noPrompt.status === 400 && /Prompt/i.test(noPrompt.json.error || ""),
    `${noPrompt.status} ${noPrompt.json.error}`
  );

  const noImages = await postJson("/api/generate", {
    apiKey: "x",
    model: "x",
    prompt: "p",
    images: [],
  });
  record(
    "Generate senza immagini -> 400",
    noImages.status === 400 && /immagine/i.test(noImages.json.error || ""),
    `${noImages.status} ${noImages.json.error}`
  );

  const badAspect = await postJson("/api/generate", {
    apiKey: "x",
    model: "x",
    prompt: "p",
    images: [{ data: "x" }],
    aspectRatio: "999:1",
  });
  record(
    "Aspect ratio non supportato -> 400",
    badAspect.status === 400 && /Formato immagine/i.test(badAspect.json.error || ""),
    `${badAspect.status} ${badAspect.json.error}`
  );

  const badMime = await postJson("/api/generate", {
    apiKey: "x",
    model: "x",
    prompt: "p",
    images: [{ data: "x" }],
    outputMimeType: "image/gif",
  });
  record(
    "Output MIME non supportato -> 400",
    badMime.status === 400 && /Formato file/i.test(badMime.json.error || ""),
    `${badMime.status} ${badMime.json.error}`
  );

  const badSize = await postJson("/api/generate", {
    apiKey: "x",
    model: "x",
    prompt: "p",
    images: [{ data: "x" }],
    imageSize: "8K",
  });
  record(
    "Image size non supportata -> 400",
    badSize.status === 400 && /Dimensione/i.test(badSize.json.error || ""),
    `${badSize.status} ${badSize.json.error}`
  );

  const badProvider = await postJson("/api/generate", {
    apiKey: "x",
    model: "x",
    prompt: "p",
    images: [{ data: "x" }],
    providerMode: "openai",
  });
  record(
    "Provider mode non supportato -> 400",
    badProvider.status === 400 && /Provider/i.test(badProvider.json.error || ""),
    `${badProvider.status} ${badProvider.json.error}`
  );

  const badEndpoint = await postJson("/api/generate", {
    apiKey: "x",
    model: "x",
    prompt: "p",
    images: [{ data: "x" }],
    apiEndpoint: "http://insecure.example.com",
  });
  record(
    "Endpoint non https -> 400",
    badEndpoint.status === 400 && /https/i.test(badEndpoint.json.error || ""),
    `${badEndpoint.status} ${badEndpoint.json.error}`
  );

  const traversal = await fetch(`${baseUrl}/../package.json`);
  const traversalText = await traversal.text();
  record(
    "Path traversal bloccato (no leak di package.json)",
    !traversalText.includes("nanobanana-vertex-tool") || traversal.status !== 200,
    `status=${traversal.status}`
  );

  const notFound = await fetch(`${baseUrl}/non-esistente.txt`);
  record(
    "File mancante -> 404",
    notFound.status === 404,
    `status=${notFound.status}`
  );

  const wrongMethod = await fetch(`${baseUrl}/api/generate`, { method: "PUT" });
  const wrongMethodText = await wrongMethod.text();
  let wrongMethodJson = {};
  try { wrongMethodJson = JSON.parse(wrongMethodText); } catch {}
  record(
    "Metodo non supportato -> 405",
    wrongMethod.status === 405 && /supportato/i.test(wrongMethodJson.error || ""),
    `${wrongMethod.status} ${wrongMethodJson.error}`
  );

  const indexResponse = await fetch(`${baseUrl}/`);
  const indexBody = await indexResponse.text();
  record(
    "GET / serve index.html con CSS e app.js linkati",
    indexResponse.status === 200 &&
      /Nano Banana 2 Studio/.test(indexBody) &&
      /\/styles\.css/.test(indexBody) &&
      /\/app\.js/.test(indexBody),
    `status=${indexResponse.status}`
  );

  console.log(JSON.stringify({
    baseUrl,
    total: checks.length,
    passed: checks.filter((c) => c.ok).length,
    failed: checks.filter((c) => !c.ok).length,
    checks,
  }, null, 2));

  if (checks.some((c) => !c.ok)) process.exit(2);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
