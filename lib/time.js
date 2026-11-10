"use strict";
// KST helpers. A "KST date" is a Date whose UTC fields hold Korean wall-clock time.
const KST_OFFSET = 9 * 60 * 60 * 1000;

const kstNow = () => new Date(Date.now() + KST_OFFSET);
const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
const isoDay = (s) => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`; // 20261110 -> 2026-11-10
const addDays = (d, n) => new Date(d.getTime() + n * 86400000);
const kstIso = (ms = Date.now()) => new Date(ms + KST_OFFSET).toISOString().slice(0, 19) + "+09:00";

// "202611100005" -> epoch-like minutes on the KST wall clock (timezone-free arithmetic)
function stampMinutes(s) {
  if (!s || !/^\d{12}$/.test(s)) return null;
  return Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(8, 10), +s.slice(10, 12)) / 60000;
}

module.exports = { kstNow, ymd, isoDay, addDays, kstIso, stampMinutes };
