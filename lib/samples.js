"use strict";
// Fallback data saved in data/samples (built by scripts/make_samples.py). Used when the API is unreachable.
const fs = require("fs");
const path = require("path");
const { SAMPLE_DIR } = require("./config");

const memo = {};
function load(name) {
  if (!(name in memo)) {
    try { memo[name] = JSON.parse(fs.readFileSync(path.join(SAMPLE_DIR, name), "utf8")); }
    catch (e) { memo[name] = null; }
  }
  return memo[name];
}

module.exports = {
  departures: () => load("departures.json"), // { collectedAt, days: { YYYYMMDD: rows[] } }
  passenger: () => load("passenger.json"), // { collectedAt, days: { YYYYMMDD: rows[] } }
  weather: () => load("weather.json"), // { collectedAt, items: rows[] }
};
