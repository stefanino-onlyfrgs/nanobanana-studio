"use strict";

const { handleHealth } = require("../lib/handlers");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Metodo non supportato." });
    return;
  }
  const result = await handleHealth();
  res.status(result.status).json(result.body);
};
