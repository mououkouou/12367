"use strict";
// Raw API rows -> compact screen data. Same rules as scripts/collect.py.
const { stampMinutes, isoDay } = require("./time");
const { DELAY_THRESHOLD_MIN } = require("./config");

const STATUS_GROUP = {
  "출발": "departed", "결항": "cancelled", "지연": "delayed",
  "탑승준비": "boarding", "탑승중": "boarding", "마감예정": "boarding", "탑승마감": "boarding",
};
const HALLS = {
  T1: { 1: "t1dg1", 2: "t1dg2", 3: "t1dg3", 4: "t1dg4", 5: "t1dg5", 6: "t1dg6" },
  T2: { 1: "t2dg1", 2: "t2dg2" },
};
const HALL_SUM = { T1: "t1dgsum1", T2: "t2dgsum2" };
const EXCLUDED = { T1: ["6"] }; // T1 6번: 교통약자 우대 출구, 혼잡도 대상 제외

const hm = (s) => (s && s.length === 12 ? `${s.slice(8, 10)}:${s.slice(10, 12)}` : null);
const num = (v) => (v === null || v === undefined || v === "" || v === "NA" || v === "-" ? null : Number.isFinite(+v) ? +v : null);

function aliases(id) {
  const out = new Set([id]);
  if (/\dY$/.test(id)) out.add(id.slice(0, -1)); // SQ605Y -> SQ605
  return [...out];
}

function makeFlight(r) {
  const s = r.scheduleDateTime, e = r.estimatedDateTime;
  const sm = stampMinutes(s), em = stampMinutes(e);
  // Both stamps include the date, so flights crossing midnight get an exact delay.
  const dl = sm !== null && em !== null ? em - sm : null;
  const st = (r.remark || "").trim();
  const sg = STATUS_GROUP[st] || (st ? "other" : "scheduled");
  const cx = sg === "cancelled";
  return {
    d: s ? isoDay(s) : null, t: hm(s), e: hm(e), ed: e ? isoDay(e) : null,
    dl, st, sg, cx,
    dly: !cx && (sg === "delayed" || (dl !== null && dl >= DELAY_THRESHOLD_MIN)),
    id: r.flightId, cs: [], q: aliases(r.flightId || ""),
    al: r.airline || "", dc: r.airportCode || "", dn: r.airport || "",
    tm: r.terminalid || "", ci: r.chkinrange || null, g: r.gatenumber || null,
  };
}

// One entry per operating (Master) flight; codeshare (Slave) numbers become cs + search aliases.
function buildFlights(rows) {
  const masters = new Map();
  const slaves = [];
  for (const r of rows) {
    if ((r.codeshare || "").toLowerCase() === "slave" && r.masterflightid) slaves.push(r);
    else {
      const k = `${r.flightId}|${r.scheduleDateTime}`;
      if (!masters.has(k)) masters.set(k, makeFlight(r));
    }
  }
  let orphans = 0;
  for (const s of slaves) {
    const k = `${s.masterflightid}|${s.scheduleDateTime}`;
    if (!masters.has(k)) { orphans++; masters.set(k, makeFlight({ ...s, flightId: s.masterflightid })); }
    const f = masters.get(k);
    if (!f.cs.includes(s.flightId)) f.cs.push(s.flightId);
    for (const a of aliases(s.flightId)) if (!f.q.includes(a)) f.q.push(a);
  }
  const flights = [...masters.values()].sort((a, b) => (a.d + a.t).localeCompare(b.d + b.t) || a.id.localeCompare(b.id));
  for (const f of flights) f.q = f.q.join(" ");
  return { flights, stats: { rows: rows.length, operating: flights.length, codeshareRows: slaves.length, orphans } };
}

function buildCongestion(rows) {
  const hours = rows.filter((r) => r.atime !== "합계").sort((a, b) => a.atime.localeCompare(b.atime));
  const totalRow = rows.find((r) => r.atime === "합계");
  const out = {};
  const checks = [];
  for (const [term, halls] of Object.entries(HALLS)) {
    const tot = hours.map((h) => Math.round(num(h[HALL_SUM[term]]) || 0));
    const t = { tot, halls: {}, off: [] };
    for (const [hall, field] of Object.entries(halls)) {
      const series = hours.map((h) => Math.round(num(h[field]) || 0));
      const excluded = (EXCLUDED[term] || []).includes(hall);
      if (!excluded && series.some((v) => v > 0)) t.halls[hall] = series;
      else t.off.push(hall);
    }
    const dailyOk = totalRow ? tot.reduce((a, b) => a + b, 0) === Math.round(num(totalRow[HALL_SUM[term]]) || 0) : null;
    checks.push({ term, hours: hours.length, dailyTotalMatches: dailyOk });
    out[term] = t;
  }
  return { cong: out, checks };
}

// One row per destination airport: keep the row with the most observed values. Current observations only.
function buildWeather(rows) {
  const out = {};
  const filled = (w) => w.slice(1).filter((v) => v !== null).length;
  for (const r of rows) {
    const code = r.airportCode;
    if (!code) continue;
    const w = [r.airport || "", num(r.temp), num(r.senstemp), num(r.himidity), num(r.wind)];
    if (!out[code] || filled(w) > filled(out[code])) out[code] = w;
  }
  return out;
}

// Delay stats over past days (already de-duplicated flights).
function buildTrends(flights) {
  const group = (keyFn, labelFn) => {
    const m = new Map();
    for (const f of flights) {
      const k = keyFn(f);
      if (!k) continue;
      const g = m.get(k) || { key: k, label: labelFn(f), n: 0, delayed: 0, cancelled: 0, delaySum: 0 };
      g.n++;
      if (f.cx) g.cancelled++;
      else {
        if (f.dly) g.delayed++;
        g.delaySum += Math.max(0, f.dl || 0);
      }
      m.set(k, g);
    }
    return [...m.values()].map((g) => ({
      key: g.key, label: g.label, n: g.n, delayed: g.delayed, cancelled: g.cancelled,
      rate: g.n ? (g.delayed + g.cancelled) / g.n : 0,
      avgDelay: g.n - g.cancelled ? Math.round(g.delaySum / (g.n - g.cancelled)) : 0,
    }));
  };
  const total = flights.length;
  const delayed = flights.filter((f) => f.dly).length;
  const cancelled = flights.filter((f) => f.cx).length;
  return {
    total, delayed, cancelled,
    rate: total ? (delayed + cancelled) / total : 0,
    airlines: group((f) => f.al, (f) => f.al),
    destinations: group((f) => f.dc, (f) => f.dn),
  };
}

module.exports = { buildFlights, buildCongestion, buildWeather, buildTrends };
