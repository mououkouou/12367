"use strict";
// Usage logging → Airtable "UsageLogs". Field names match the table exactly (read via the Airtable connector).
// - AIRTABLE_TOKEN / AIRTABLE_BASE_ID / AIRTABLE_TABLE come from the server environment only.
// - Only whitelisted event types and values pass; everything else is dropped. No IP, name or contact is ever written.
// - Logging must never break the board: callers get a summary, never an exception.
const crypto = require("crypto");
const { kstIso } = require("./time");

const ENV = process.env.VERCEL ? "prod" : "local";
const APP_VERSION = process.env.VERCEL_GIT_COMMIT_SHA ? process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 7) : "local";
const API = (process.env.AIRTABLE_API_BASE || "https://api.airtable.com/v0").replace(/\/+$/, ""); // override only for local tests
// AIRTABLE_BASE_ID / AIRTABLE_TABLE are the names set in Vercel; BASE_ID / TABLE are accepted as fallbacks.
const env = (...names) => names.map((n) => (process.env[n] || "").trim()).find(Boolean) || "";
const cfg = () => ({ token: env("AIRTABLE_TOKEN"), base: env("AIRTABLE_BASE_ID", "BASE_ID"), table: env("AIRTABLE_TABLE", "TABLE") });
const configured = () => { const c = cfg(); return Boolean(c.token && c.base && c.table); };

const MAX_EVENTS = 30; // per request from one page
const BATCH = 10; // Airtable create limit per call
const TYPES = { congestion_select: true, filter_change: true, ai_analyze: true };
const TERMINALS = ["T1", "T2", "Concourse", "All"];
const MODES = ["live", "cache", "stale", "sample"];
const DEVICES = ["desktop", "tablet", "mobile"];
const FILTERS = ["terminal", "airline", "card_airline"];

const pick = (v, list) => (list.includes(v) ? v : undefined);
const date = (v) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
const hour = (v) => (Number.isInteger(v) && v >= 0 && v <= 23 ? v : undefined);
const airline = (v) => (typeof v === "string" && /^[가-힣A-Za-z0-9 .&()·-]{1,30}$/.test(v) ? v.trim() : undefined);
const session = (v) => (typeof v === "string" && /^[a-z0-9-]{8,40}$/i.test(v) ? v : undefined);

// One browser event → one Airtable record (fields by name), or null if it does not pass the whitelist.
function toRecord(ev, sessionId, now = Date.now()) {
  if (!ev || typeof ev !== "object" || !TYPES[ev.type]) return null;
  const at = Date.parse(ev.at);
  const when = Number.isFinite(at) && Math.abs(at - now) < 10 * 60000 ? at : now; // client clock only if plausible
  const notes = [`env=${ENV}`];
  const f = {
    EventId: `${when.toString(36)}-${crypto.randomBytes(4).toString("hex")}`,
    EventTime: new Date(when).toISOString(),
    EventType: ev.type,
    ViewDate: date(ev.viewDate),
    Terminal: pick(ev.terminal, TERMINALS),
    DataMode: pick(ev.dataMode, MODES),
    Device: pick(ev.device, DEVICES),
    SessionId: sessionId,
    AppVersion: APP_VERSION,
  };
  if (ev.type === "congestion_select") {
    f.SelectedHour = hour(ev.hour);
    if (f.SelectedHour === undefined) return null;
    notes.push(`select=${ev.scope === "column" ? "column" : "cell"}`);
    if (ev.scope !== "column" && /^\d{1,2}$/.test(String(ev.hall ?? ""))) notes.push(`hall=${ev.hall}`);
  } else if (ev.type === "filter_change") {
    const filter = pick(ev.filter, FILTERS);
    if (!filter) return null;
    notes.push(`filter=${filter}`);
    if (filter !== "terminal") notes.push(`airline=${airline(ev.airline) || "전체"}`);
    if (hour(ev.hour) !== undefined) f.SelectedHour = ev.hour;
  } else if (ev.type === "ai_analyze") {
    if (hour(ev.hour) !== undefined) f.SelectedHour = ev.hour;
    notes.push(`ai=${ev.ok === true ? "success" : "fail"}`);
    const ms = Number(ev.ms);
    if (Number.isFinite(ms) && ms >= 0 && ms < 120000) notes.push(`ms=${Math.round(ms)}`);
    if (typeof ev.code === "string" && /^[A-Z0-9_]{2,30}$/.test(ev.code)) notes.push(`code=${ev.code}`);
    if (ev.cache === "hit" || ev.cache === "miss") notes.push(`cache=${ev.cache}`);
  }
  f.Notes = notes.join("; ");
  for (const k of Object.keys(f)) if (f[k] === undefined) delete f[k];
  return { fields: f };
}

async function postBatch(records) {
  const c = cfg();
  const url = `${API}/${encodeURIComponent(c.base)}/${encodeURIComponent(c.table)}`;
  const send = () => fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${c.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ records, typecast: false }),
    signal: AbortSignal.timeout(8000),
  });
  let res = await send();
  if (res.status === 429) { // rate limited: wait a moment, retry once, then give up
    await new Promise((r) => setTimeout(r, 1500));
    res = await send();
  }
  if (!res.ok) { const why = `HTTP_${res.status}`; await res.text().catch(() => ""); throw Object.assign(new Error(why), { code: why }); }
  return (await res.json()).records?.length || 0;
}

async function logEvents(body) {
  const sessionId = session(body?.sessionId);
  const events = Array.isArray(body?.events) ? body.events.slice(0, MAX_EVENTS) : [];
  const records = sessionId ? events.map((e) => toRecord(e, sessionId)).filter(Boolean) : [];
  const out = { received: events.length, accepted: records.length, written: 0, dropped: events.length - records.length, env: ENV, at: kstIso() };
  if (!configured()) return { ...out, skipped: "NOT_CONFIGURED" };
  for (let i = 0; i < records.length; i += BATCH) {
    const chunk = records.slice(i, i + BATCH);
    try { out.written += await postBatch(chunk); }
    catch (e) { out.dropped += chunk.length; out.error = e.code || (e.name === "TimeoutError" ? "TIMEOUT" : "NETWORK"); }
  }
  return out;
}

module.exports = { logEvents, toRecord, configured, ENV };
