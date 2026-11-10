"use strict";
// GET /api/day?date=YYYY-MM-DD — departures for one calendar day (3 days back ~ 6 days ahead). No key in the response.
const { getDay } = require("../lib/day");
const { handler } = require("../lib/http");

module.exports = handler((req) => getDay(new URL(req.url, "http://local").searchParams.get("date")),
  (body) => (body.meta.date < body.meta.range.today
    ? "public, max-age=0, s-maxage=3600, stale-while-revalidate=3600"
    : "public, max-age=0, s-maxage=300, stale-while-revalidate=300"));
