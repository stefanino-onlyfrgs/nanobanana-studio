const key = process.env.NANOBANANA_API_KEY || "";
if (!key) {
  console.error("Missing NANOBANANA_API_KEY.");
  process.exit(1);
}

const sanitize = (value) => String(value || "").split(key).join("<redacted>");

async function main() {
  const url = "https://generativelanguage.googleapis.com/v1beta/models";
  const response = await fetch(url, {
    headers: { "x-goog-api-key": key },
  });
  const text = await response.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { raw: text };
  }
  if (!response.ok) {
    console.log(sanitize(JSON.stringify({ status: response.status, body: parsed }, null, 2)));
    return;
  }
  const models = (parsed.models || [])
    .filter((m) => /image/i.test(m.name) || /image/i.test((m.supportedGenerationMethods || []).join(",")))
    .map((m) => ({
      name: m.name,
      displayName: m.displayName,
      supportedGenerationMethods: m.supportedGenerationMethods,
    }));
  console.log(sanitize(JSON.stringify({ status: response.status, imageModels: models }, null, 2)));
}

main().catch((error) => {
  console.error(sanitize(error.stack || error.message));
  process.exit(1);
});
