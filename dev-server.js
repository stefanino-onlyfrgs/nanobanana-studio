"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");

const {
  handleHealth,
  handleGenerate,
  handleTestKey,
  handleAnalyzeVideo,
} = require("./lib/handlers");

const HOST = process.env.HOST || (process.env.PORT ? "0.0.0.0" : "127.0.0.1");
const START_PORT = Number(process.env.PORT || 5177);
const PUBLIC_DIR = path.join(__dirname, "public");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("error", reject);
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

async function readJsonPayload(req) {
  const text = await readRequestBody(req);
  if (!text) return {};
  return JSON.parse(text);
}

async function dispatch(req, res, handler) {
  let payload = {};
  try {
    payload = await readJsonPayload(req);
  } catch {
    sendJson(res, 400, { error: "Richiesta JSON non valida." });
    return;
  }
  try {
    const result = await handler(payload);
    sendJson(res, result.status, result.body);
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Errore interno." });
  }
}

function serveStatic(req, res) {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = decodeURIComponent(requestUrl.pathname);
  const relativePath = pathname === "/" ? "index.html" : pathname.slice(1);
  const filePath = path.resolve(PUBLIC_DIR, relativePath);
  const fileRelativePath = path.relative(PUBLIC_DIR, filePath);

  if (fileRelativePath.startsWith("..") || path.isAbsolute(fileRelativePath)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    const contentType = MIME_TYPES[path.extname(filePath).toLowerCase()] ||
      "application/octet-stream";
    res.writeHead(200, { "Content-Type": contentType });
    res.end(data);
  });
}

function createServer() {
  return http.createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/api/health") {
      const result = await handleHealth();
      sendJson(res, result.status, result.body);
      return;
    }
    if (req.method === "POST" && req.url === "/api/generate") {
      dispatch(req, res, handleGenerate);
      return;
    }
    if (req.method === "POST" && req.url === "/api/test-key") {
      dispatch(req, res, handleTestKey);
      return;
    }
    if (req.method === "POST" && req.url === "/api/analyze-video") {
      dispatch(req, res, handleAnalyzeVideo);
      return;
    }
    if (req.method === "GET") {
      serveStatic(req, res);
      return;
    }
    sendJson(res, 405, { error: "Metodo non supportato." });
  });
}

function listen(port, attemptsLeft = 20) {
  const server = createServer();
  server.on("error", (error) => {
    if (error.code === "EADDRINUSE" && attemptsLeft > 0) {
      listen(port + 1, attemptsLeft - 1);
      return;
    }
    console.error(error.message);
    process.exit(1);
  });
  server.listen(port, HOST, () => {
    console.log("");
    console.log("Nano Banana 2 Tool avviato.");
    console.log(`Apri: http://${HOST}:${port}`);
    console.log("Premi CTRL+C per fermare il server.");
    console.log("");
  });
}

if (require.main === module) {
  listen(START_PORT);
}

module.exports = { createServer };
