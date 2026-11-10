"use strict";
// Assembles everything the screen needs: today/tomorrow departures, hall forecast, destination weather.
// Each source falls back to data/samples when the live API cannot be reached.
const { TTL, FLIGHT_ROWS, WEATHER_ROWS } = require("./config");
const { fetchAll } = require("./client");
const { cached, prune } = require("./cache");
const { kstNow, ymd, isoDay, addDays, kstIso } = require("./time");
const { buildFlights, buildCongestion, buildWeather } = require("./transform");
const samples = require("./samples");

const PATH = {
  departures: "StatusOfPassengerFlightsDeOdp/getPassengerDeparturesDeOdp",
  passenger: "passgrAnncmt/getPassgrAnncmt",
  weather: "StatusOfPassengerWorldWeatherInfo/getPassengerDeparturesWorldWeather",
};
const STATUS = { miss: "live", hit: "cache", stale: "stale" };

function loadDepartures(day, ttl = TTL.flights) {
  return cached(`flights_${day}`, ttl, async () =>
    (await fetchAll(PATH.departures, { searchday: day, from_time: "0000", to_time: "2400", inqtimechcd: "S", lang: "K" }, FLIGHT_ROWS)).items,
  { persist: true });
}

function sourceInfo(results) {
  const worst = results.some((r) => r.cache === "stale") ? "stale" : results.some((r) => r.cache === "miss") ? "live" : "cache";
  return { status: worst, at: kstIso(Math.min(...results.map((r) => r.at))), ttlMin: null };
}

async function getBoard() {
  let days = [ymd(kstNow()), ymd(addDays(kstNow(), 1))];
  const sources = {};

  // 1) departures (5 min)
  let flightRows;
  let flightsFromSample = false;
  try {
    const rs = await Promise.all(days.map((d) => loadDepartures(d)));
    flightRows = rs.flatMap((r) => r.value);
    sources.flights = { ...sourceInfo(rs), ttlMin: TTL.flights / 60000, rows: flightRows.length };
  } catch (err) {
    const s = samples.departures();
    if (!s) throw err;
    flightsFromSample = true;
    days = Object.keys(s.days).sort().slice(0, 2);
    flightRows = days.flatMap((d) => s.days[d]);
    sources.flights = { status: "sample", at: s.collectedAt, reason: err.code || "API_ERROR", rows: flightRows.length };
  }

  // 2) passenger forecast — only today (0) and tomorrow (1), persisted
  const cong = {};
  const congChecks = [];
  const putCong = (day, rows) => {
    const { cong: c, checks } = buildCongestion(rows);
    cong[isoDay(day)] = c;
    congChecks.push(...checks.map((x) => ({ day: isoDay(day), ...x })));
  };
  const fromSamplePassenger = (reason) => {
    const s = samples.passenger();
    const usable = s ? days.filter((d) => s.days[d]) : [];
    usable.forEach((d) => putCong(d, s.days[d]));
    sources.passenger = usable.length
      ? { status: "sample", at: s.collectedAt, reason }
      : { status: "missing", reason };
  };
  if (flightsFromSample) fromSamplePassenger(sources.flights.reason);
  else {
    try {
      const keys = days.map((d) => `passenger_${d}`);
      const rs = await Promise.all(days.map((d, i) =>
        cached(keys[i], TTL.passenger, async () => (await fetchAll(PATH.passenger, { selectdate: i }, 30)).items, { persist: true })));
      prune("passenger_", keys); // store today + tomorrow only
      rs.forEach((r, i) => putCong(days[i], r.value));
      sources.passenger = { ...sourceInfo(rs), ttlMin: TTL.passenger / 60000 };
    } catch (err) {
      fromSamplePassenger(err.code || "API_ERROR");
    }
  }

  // 3) destination weather (30 min) — current observations, not forecasts
  let wxRows;
  try {
    const r = await cached("weather", TTL.weather, async () =>
      (await fetchAll(PATH.weather, { from_time: "0000", to_time: "2400", lang: "K" }, WEATHER_ROWS)).items, { persist: true });
    wxRows = r.value;
    sources.weather = { ...sourceInfo([r]), ttlMin: TTL.weather / 60000 };
  } catch (err) {
    const s = samples.weather();
    wxRows = s ? s.items : [];
    sources.weather = s ? { status: "sample", at: s.collectedAt, reason: err.code || "API_ERROR" } : { status: "missing", reason: err.code };
  }

  const { flights, stats } = buildFlights(flightRows);
  const wx = buildWeather(wxRows);
  const usesSample = Object.values(sources).some((s) => s.status === "sample" || s.status === "missing");

  return {
    meta: {
      generatedAt: kstIso(),
      days: days.map(isoDay),
      mode: usesSample ? "sample" : "live",
      sources,
      checks: { dedupe: stats, passenger: congChecks },
    },
    flights,
    cong,
    wx,
  };
}

module.exports = { getBoard, loadDepartures };
