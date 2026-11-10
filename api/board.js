"use strict";
// GET /api/board — today/tomorrow departures, hall forecast and destination weather (no key in the response).
const { getBoard } = require("../lib/board");
const { handler } = require("../lib/http");

module.exports = handler(() => getBoard(), "public, max-age=0, s-maxage=300, stale-while-revalidate=300");
