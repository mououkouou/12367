"use strict";
// POST /api/log — batched usage events from the page (fetch or sendBeacon) → Airtable UsageLogs.
// Never reads or stores the client IP. Always answers 202 quickly so logging can never affect the board.
const { logEvents } = require("../lib/usage");
const { sendJson } = require("../lib/http");

const MAX_BYTES = 16 * 1024;

function readBody(req) {
  if (req.body !== undefined) return Promise.resolve(typeof req.body === "string" ? req.body : JSON.stringify(req.body));
  return new Promise((resolve) => {
    let size = 0; const chunks = [];
    req.on("data", (c) => { size += c.length; if (size <= MAX_BYTES) chunks.push(c); });
    req.on("end", () => resolve(size > MAX_BYTES ? "" : Buffer.concat(chunks).toString("utf8")));
    req.on("error", () => resolve(""));
  });
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return sendJson(res, 405, { error: "POST only" });
  let body = {};
  try { body = JSON.parse((await readBody(req)) || "{}"); } catch (e) { body = {}; }
  let out;
  try { out = await logEvents(body); } catch (e) { out = { written: 0, error: "LOG_FAILED" }; }
  sendJson(res, 202, out, "no-store");
};
