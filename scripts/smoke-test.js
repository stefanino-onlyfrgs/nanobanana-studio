const HOST = process.env.NANOBANANA_HOST || "127.0.0.1";
const port = Number.parseInt(process.env.PORT || "5177", 10);
const baseUrl =
  process.env.NANOBANANA_BASE_URL || `http://${HOST}:${port}`;

async function main() {
  const url = `${baseUrl.replace(/\/$/, "")}/api/health`;
  const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
  const text = await response.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    console.error(JSON.stringify({ ok: false, url, error: "Risposta non JSON", snippet: text.slice(0, 120) }));
    process.exit(1);
  }
  if (!response.ok || !body.ok) {
    console.error(JSON.stringify({ ok: false, url, status: response.status, body }));
    process.exit(1);
  }
  console.log(JSON.stringify({ ok: true, url, body }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
