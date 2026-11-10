"use strict";
// One extra day picked from the calendar (outside today/tomorrow): departures only.
// The hall forecast exists only for today/tomorrow and weather is a current observation, so they are not repeated here.
const { TTL, DAY_RANGE } = require("./config");
const { kstNow, ymd, isoDay, addDays, kstIso } = require("./time");
const { buildFlights } = require("./transform");
const { loadDepartures } = require("./board");
const { ApiError } = require("./client");

function dayRange() {
  const now = kstNow();
  return { min: isoDay(ymd(addDays(now, -DAY_RANGE.past))), max: isoDay(ymd(addDays(now, DAY_RANGE.future))), today: isoDay(ymd(now)) };
}

async function getDay(date) {
  const range = dayRange();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) throw new ApiError("date must be YYYY-MM-DD", "BAD_DATE");
  if (date < range.min || date > range.max) throw new ApiError(`date must be between ${range.min} and ${range.max}`, "OUT_OF_RANGE");
  // Past days no longer change much: keep them longer. Today and later follow the 5-minute flight cache.
  const ttl = date < range.today ? TTL.trends : TTL.flights;
  const r = await loadDepartures(date.replace(/-/g, ""), ttl);
  const { flights } = buildFlights(r.value);
  return {
    meta: { generatedAt: kstIso(), date, range, source: { status: r.cache === "miss" ? "live" : r.cache === "hit" ? "cache" : "stale", at: kstIso(r.at), rows: r.value.length } },
    flights,
  };
}

module.exports = { getDay, dayRange };
