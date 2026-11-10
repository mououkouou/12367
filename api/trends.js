"use strict";
// GET /api/trends — delay rates by airline and destination over the last 3 days.
const { getTrends } = require("../lib/trends");
const { handler } = require("../lib/http");

module.exports = handler(() => getTrends(), "public, max-age=0, s-maxage=3600, stale-while-revalidate=3600");
