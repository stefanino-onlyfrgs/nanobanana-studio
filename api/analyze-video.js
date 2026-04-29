"use strict";

const { handleAnalyzeVideo } = require("../lib/handlers");
const { parseJsonBody, sendJson, methodNotAllowed } = require("./_utils");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return methodNotAllowed(res);
  let payload;
  try {
    payload = await parseJsonBody(req);
  } catch {
    return sendJson(res, 400, { error: "Richiesta JSON non valida." });
  }
  try {
    const result = await handleAnalyzeVideo(payload);
    return sendJson(res, result.status, result.body);
  } catch (error) {
    return sendJson(res, 500, { error: error.message || "Errore interno." });
  }
};

module.exports.config = {
  api: {
    bodyParser: false,
  },
  maxDuration: 60,
};
