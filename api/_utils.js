"use strict";

const MAX_BODY_BYTES = 25 * 1024 * 1024;

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    if (req.body && (typeof req.body === "string" || Buffer.isBuffer(req.body))) {
      resolve(typeof req.body === "string" ? req.body : req.body.toString("utf8"));
      return;
    }
    if (req.body && typeof req.body === "object") {
      try {
        resolve(JSON.stringify(req.body));
      } catch {
        resolve("");
      }
      return;
    }
    let total = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        req.destroy();
        reject(new Error("Payload troppo grande."));
        return;
      }
      chunks.push(chunk);
    });
    req.on("error", reject);
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

async function parseJsonBody(req) {
  const text = await readRawBody(req);
  if (!text) return {};
  return JSON.parse(text);
}

function sendJson(res, status, payload) {
  if (typeof res.status === "function" && typeof res.json === "function") {
    res.status(status).json(payload);
    return;
  }
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function methodNotAllowed(res) {
  return sendJson(res, 405, { error: "Metodo non supportato." });
}

module.exports = {
  readRawBody,
  parseJsonBody,
  sendJson,
  methodNotAllowed,
  MAX_BODY_BYTES,
};
