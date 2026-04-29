"use strict";

const { Readable } = require("node:stream");

const handlers = {
  health: require("../api/health"),
  generate: require("../api/generate"),
  testKey: require("../api/test-key"),
  analyzeVideo: require("../api/analyze-video"),
};

function makeReq({ method = "POST", body = "" } = {}) {
  const stream = Readable.from([Buffer.from(body, "utf8")]);
  stream.method = method;
  stream.headers = { "content-type": "application/json" };
  return stream;
}

function makeRes() {
  const captured = { status: 0, body: null, headers: {} };
  const res = {};
  res.status = function (code) {
    captured.status = code;
    return res;
  };
  res.json = function (payload) {
    captured.body = payload;
    return res;
  };
  res.writeHead = function (code, headers) {
    captured.status = code;
    Object.assign(captured.headers, headers || {});
  };
  res.end = function (data) {
    if (typeof data === "string" && !captured.body) {
      try {
        captured.body = JSON.parse(data);
      } catch {
        captured.body = data;
      }
    }
  };
  return { res, captured };
}

async function run() {
  const cases = [
    { name: "health GET", fn: handlers.health, req: makeReq({ method: "GET" }), expectStatus: 200 },
    { name: "health POST -> 405", fn: handlers.health, req: makeReq({ method: "POST" }), expectStatus: 405 },
    { name: "generate empty body -> 400", fn: handlers.generate, req: makeReq({ body: "{}" }), expectStatus: 400 },
    { name: "generate bad JSON -> 400", fn: handlers.generate, req: makeReq({ body: "not json" }), expectStatus: 400 },
    { name: "test-key empty body -> 400", fn: handlers.testKey, req: makeReq({ body: "{}" }), expectStatus: 400 },
    { name: "analyze-video empty body -> 400", fn: handlers.analyzeVideo, req: makeReq({ body: "{}" }), expectStatus: 400 },
    { name: "analyze-video bad mime -> 400", fn: handlers.analyzeVideo, req: makeReq({ body: JSON.stringify({ apiKey: "x", video: { mimeType: "audio/wav", data: "AAAA" } }) }), expectStatus: 400 },
  ];

  let pass = 0;
  let fail = 0;
  for (const test of cases) {
    const { res, captured } = makeRes();
    try {
      await test.fn(test.req, res);
      const ok = captured.status === test.expectStatus;
      console.log(
        `${ok ? "PASS" : "FAIL"} ${test.name} -> status=${captured.status} body=${JSON.stringify(captured.body).slice(0, 90)}`
      );
      if (ok) pass += 1;
      else fail += 1;
    } catch (error) {
      console.log(`FAIL ${test.name} -> threw: ${error.message}`);
      fail += 1;
    }
  }

  console.log(`\nTotal: ${pass}/${pass + fail}`);
  process.exit(fail === 0 ? 0 : 1);
}

run();
