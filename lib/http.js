"use strict";
// Works with both Vercel's Node runtime and the plain http server in server.js.
const { scrub } = require("./key");

function sendJson(res, status, body, cacheControl) {
  const text = scrub(JSON.stringify(body)); // last line of defence: never let the key leave the server
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", cacheControl || "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.end(text);
}

function handler(fn, cacheControl) {
  return async (req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD") return sendJson(res, 405, { error: "GET only" });
    try {
      sendJson(res, 200, await fn(req), cacheControl);
    } catch (err) {
      sendJson(res, 502, { error: "자료를 불러오지 못했어요.", code: err.code || "ERROR", detail: scrub(err.message) });
    }
  };
}

module.exports = { sendJson, handler };
