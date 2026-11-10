"use strict";
// Delay trend over the last 3 days (D-1..D-3). Past days do not change, so cache for 6 hours.
const { TTL } = require("./config");
const { kstNow, ymd, isoDay, addDays, kstIso } = require("./time");
const { buildFlights, buildTrends } = require("./transform");
const { loadDepartures } = require("./board");

async function getTrends() {
  const days = [1, 2, 3].map((n) => ymd(addDays(kstNow(), -n))).reverse();
  try {
    const rs = [];
    for (const d of days) rs.push(await loadDepartures(d, TTL.trends)); // sequential: avoid upstream 429
    const { flights } = buildFlights(rs.flatMap((r) => r.value));
    const t = buildTrends(flights);
    // At least 5 flights in 3 days, so one late flight does not dominate the ranking.
    const keep = (list) => list.filter((g) => g.n >= 5).sort((a, b) => b.rate - a.rate || b.n - a.n);
    return {
      available: true,
      days: days.map(isoDay),
      at: kstIso(Math.min(...rs.map((r) => r.at))),
      overall: { total: t.total, delayed: t.delayed, cancelled: t.cancelled, rate: t.rate },
      // only the 3 requested days (a few late-night rows of other dates can come along)
      byDay: days.map(isoDay).map((d) => ({ day: d, ...(t.days[d] || { total: { total: 0, delayed: 0, cancelled: 0 }, hours: [] }) })),
      airlines: keep(t.airlines),
      destinations: keep(t.destinations),
    };
  } catch (err) {
    return { available: false, days: days.map(isoDay), reason: err.code || "API_ERROR" };
  }
}

module.exports = { getTrends };
