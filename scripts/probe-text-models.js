const key = process.env.NANOBANANA_API_KEY || "";
if (!key) {
  console.error("Missing NANOBANANA_API_KEY.");
  process.exit(1);
}
const sanitize = (value) => String(value || "").split(key).join("<redacted>");

async function main() {
  const url = "https://generativelanguage.googleapis.com/v1beta/models";
  const response = await fetch(url, { headers: { "x-goog-api-key": key } });
  const text = await response.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { raw: text };
  }
  const models = (parsed.models || [])
    .filter((m) => {
      const methods = (m.supportedGenerationMethods || []).join(",");
      return /generateContent/.test(methods) && !/image|imagen/.test(m.name);
    })
    .map((m) => ({ name: m.name, displayName: m.displayName }));
  console.log(sanitize(JSON.stringify({ status: response.status, chatModels: models }, null, 2)));
}

main().catch((error) => {
  console.error(sanitize(error.stack || error.message));
  process.exit(1);
});
