"use strict";
// GET /api/board — today/tomorrow departures, hall forecast and destination weather (no key in the response).
const { getBoard } = require("../lib/board");
const { handler } = require("../lib/http");

// Live data: CDN may reuse it for 5 min (= flight cache). Fallback/stale data: only 30 s, so a recovered API shows up quickly.
module.exports = handler(() => getBoard(), (body) => {
  const degraded = Object.values(body.meta.sources).some((s) => s.status !== "live" && s.status !== "cache");
  return degraded
    ? "public, max-age=0, s-maxage=30, stale-while-revalidate=30"
    : "public, max-age=0, s-maxage=300, stale-while-revalidate=300";
});
