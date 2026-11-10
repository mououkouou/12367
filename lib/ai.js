"use strict";
// AI analysis of what the dashboard is showing right now.
// - OPENAI_API_KEY / OPENAI_MODEL come from the server environment only; nothing here reaches the browser except the answer.
// - Input is the screen's aggregates only (sanitised to a fixed shape, no flight lists).
// - Every number in the answer must already exist in the input; definitive punctuality / arrival-time wording is rejected.
const crypto = require("crypto");
const { cached } = require("./cache");
const { kstIso } = require("./time");
const { ApiError } = require("./client");

const AI = {
  model: () => (process.env.OPENAI_MODEL || "gpt-6-luna").trim(),
  key: () => (process.env.OPENAI_API_KEY || "").trim(),
  base: () => (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").trim().replace(/\/+$/, ""), // override only for local tests
  TTL: 10 * 60 * 1000, // same screen -> same answer for 10 min
  DEADLINE_MS: 19000, // the page gives up at 20 s
  MAX_INPUT_BYTES: 8 * 1024,
};

const SYSTEM_PROMPT = `너는 인천공항 출국 준비를 돕는 분석 도우미다. 사용자는 출장자와 총무 담당자다.
입력은 대시보드 화면에 보이는 집계값(JSON) 하나뿐이다.

[숫자]
1. 답에 쓰는 모든 숫자는 입력 JSON에 그대로 있는 값만 쓴다. 더하기·빼기·비율·평균·반올림으로 새 숫자를 만들지 않는다.
2. 값이 null이거나 없으면 "자료 없음"이라고 쓰고 추정하지 않는다.
3. 시간은 입력의 hour 값을 "16시"처럼만 쓴다. 분 단위 시각을 만들지 않는다.
4. 개수를 세는 말("3가지", "두 곳")도 입력에 없는 숫자라면 쓰지 않는다.

[운항·도착]
5. 운항 정보는 참고용이다. "정시 출발합니다", "지연되지 않습니다" 같은 확답을 하지 않는다.
6. "몇 시까지 도착하세요"처럼 공항 도착 시각을 단정하지 않는다. "혼잡 예고가 높은 시간대를 피하는 것을 고려" 수준으로만 말한다.
7. 운항 관련 팁에는 "항공사 안내 확인"을 함께 쓴다.

[내용]
8. 입력에 없는 사실(보안검색 소요 시간, 항공사 정책, 날씨 예보, 공항 시설)을 덧붙이지 않는다.
9. 기상은 "현재 관측값"이라고 표현한다. 도착 시점 날씨로 쓰지 않는다.
10. knownLimits의 내용과, 화면 집계만으로 알 수 없는 점을 "데이터 한계"에 쓴다.

[형식] 한국어 해요체, 각 항목 한 문장, 80자 이내.
- summary: 한 줄 요약 1개
- highlights: 눈에 띄는 점 정확히 3개
- tips: 출장 팁 정확히 2개
- limits: 데이터 한계 1~3개`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "highlights", "tips", "limits"],
  properties: {
    summary: { type: "string" },
    highlights: { type: "array", items: { type: "string" } },
    tips: { type: "array", items: { type: "string" } },
    limits: { type: "array", items: { type: "string" } },
  },
};

// ---------- input: rebuild a fixed shape from what the browser sent (anything else is dropped)
const bad = (msg) => new ApiError(msg, "BAD_INPUT");
const str = (v, max = 40) => (typeof v === "string" ? v.slice(0, max) : "");
const int = (v, lo = 0, hi = 1e6) => { const n = Number(v); if (!Number.isFinite(n) || n < lo || n > hi) throw bad("number out of range"); return Math.round(n); };
const num = (v) => (v === null || v === undefined || v === "" ? null : Number.isFinite(Number(v)) ? Math.round(Number(v) * 10) / 10 : null);
const hourOk = (v) => int(v, 0, 23);
const term = (v) => (["T1", "T2", "T1+T2"].includes(v) ? v : (() => { throw bad("terminal"); })());
const counts = (o) => ({ total: int(o?.total), delayed: int(o?.delayed), cancelled: int(o?.cancelled) });
const iso = (v) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\+09:00)?$/.test(v) ? v : null);

function sanitize(raw) {
  if (!raw || typeof raw !== "object") throw bad("body must be a JSON object");
  const v = raw.view || {}, s = v.selection || {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v.date || "")) throw bad("view.date");
  const col = s.type === "column";
  const out = {
    view: {
      date: v.date,
      dayLabel: str(v.dayLabel, 20),
      selection: { type: col ? "column" : "cell", terminal: term(col ? "T1+T2" : s.terminal), hall: col ? null : str(s.hall, 4) || null, hour: hourOk(s.hour) },
    },
    asOf: { flights: iso(raw.asOf?.flights), passenger: iso(raw.asOf?.passenger), weather: iso(raw.asOf?.weather) },
    flights: {
      day: counts(raw.flights?.day),
      selectedHour: { terminal: term(raw.flights?.selectedHour?.terminal), hour: hourOk(raw.flights?.selectedHour?.hour), ...counts(raw.flights?.selectedHour) },
      delayRule: "15분 이상 늦거나 '지연' 표시",
      codeshareMerged: true,
    },
    passengerForecast: null,
    weather: [],
    knownLimits: Array.isArray(raw.knownLimits) ? raw.knownLimits.slice(0, 5).map((x) => str(x, 80)).filter(Boolean) : [],
  };
  const p = raw.passengerForecast;
  if (p && typeof p === "object") {
    const hourly = {};
    for (const t of ["T1", "T2"]) if (Array.isArray(p.hourly?.[t])) {
      if (p.hourly[t].length !== 24) throw bad("hourly must have 24 values");
      hourly[t] = p.hourly[t].map((x) => int(x));
    }
    const byHall = {};
    for (const [k, x] of Object.entries(p.selectedHourByHall || {}).slice(0, 12)) if (/^T[12]-\d{1,2}$/.test(k)) byHall[k] = int(x);
    const pk = (o) => (o ? { hour: hourOk(o.hour), people: int(o.people), ...(o.terminal ? { terminal: term(o.terminal) } : {}) } : null);
    out.passengerForecast = {
      hourly,
      selectedHourByHall: byHall,
      levelThresholds: { busyFrom: int(p.levelThresholds?.busyFrom), veryBusyFrom: int(p.levelThresholds?.veryBusyFrom) },
      peak: pk(p.peak),
      peakAll: pk(p.peakAll),
    };
  }
  if (Array.isArray(raw.weather)) {
    out.weather = raw.weather.slice(0, 5).filter((w) => /^[A-Z0-9]{3,4}$/.test(w?.code || "")).map((w) => ({
      code: w.code, name: str(w.name, 30), flights: int(w.flights, 0, 500),
      tempC: num(w.tempC), feelsC: num(w.feelsC), humidity: num(w.humidity), windMs: num(w.windMs),
    }));
  }
  return out;
}

// ---------- answer checks
// Numbers allowed in the answer: every number that appears anywhere in the input (values, hours, dates, hall keys) + terminal names.
function allowedNumbers(input) {
  const set = new Set([1, 2]); // 제1·제2터미널, T1/T2
  const walk = (x) => {
    if (x == null) return;
    if (typeof x === "number") { set.add(x); return; }
    if (typeof x === "string") { for (const m of x.match(/\d+(\.\d+)?/g) || []) set.add(Number(m)); return; }
    if (Array.isArray(x)) return x.forEach(walk);
    if (typeof x === "object") for (const [k, v] of Object.entries(x)) { walk(k); walk(v); }
  };
  walk(input);
  return set;
}
const NUM_RE = /\d[\d,]*(?:\.\d+)?/g;
const BANNED = [
  /정시\s*(출발|운항|이륙)(합니다|해요|할\s*거|할\s*것|이\s*확실|은\s*확실|이\s*보장|을\s*보장)/,
  /지연(되지|은|이)\s*없을\s*(거|것)|지연되지\s*않(습니다|아요|을)/,
  /(\d{1,2}\s*시|\d{1,2}:\d{2})\s*(전|까지)(에|는)?\s*(공항에\s*)?(도착|오)(하세요|하셔야|하면\s*(됩|돼)|셔야)/,
  /도착하셔야\s*(합니다|해요)/,
];

function check(ans, input) {
  const problems = [];
  const lists = { highlights: 3, tips: 2 };
  if (typeof ans?.summary !== "string" || !ans.summary.trim()) problems.push("summary가 비어 있음");
  for (const [k, n] of Object.entries(lists)) if (!Array.isArray(ans?.[k]) || ans[k].filter((x) => String(x).trim()).length < n) problems.push(`${k}는 ${n}개여야 함`);
  if (!Array.isArray(ans?.limits) || !ans.limits.length) problems.push("limits가 비어 있음");
  if (problems.length) return problems;
  const allowed = allowedNumbers(input);
  const texts = [ans.summary, ...ans.highlights, ...ans.tips, ...ans.limits].map(String);
  const unknown = new Set();
  for (const t of texts) for (const m of t.match(NUM_RE) || []) { const n = Number(m.replace(/,/g, "")); if (!allowed.has(n)) unknown.add(m); }
  if (unknown.size) problems.push(`입력에 없는 숫자: ${[...unknown].join(", ")}`);
  for (const t of texts) for (const re of BANNED) if (re.test(t)) problems.push(`단정 표현: "${t.match(re)[0]}"`);
  return problems;
}

function tidy(ans) {
  const s = (x) => String(x).trim().slice(0, 160);
  return { summary: s(ans.summary), highlights: ans.highlights.slice(0, 3).map(s), tips: ans.tips.slice(0, 2).map(s), limits: ans.limits.slice(0, 3).map(s) };
}

// ---------- OpenAI Responses API
async function callOpenAI(input, extra, deadline) {
  const left = deadline - Date.now();
  if (left < 1500) throw new ApiError("deadline", "TIMEOUT");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), left);
  const messages = [{ role: "user", content: JSON.stringify(input) }];
  if (extra) messages.push({ role: "user", content: extra });
  let res;
  try {
    res = await fetch(`${AI.base()}/responses`, {
      method: "POST",
      signal: ctrl.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${AI.key()}` },
      body: JSON.stringify({
        model: AI.model(),
        instructions: SYSTEM_PROMPT,
        input: messages,
        text: { format: { type: "json_schema", name: "icn_board_analysis", strict: true, schema: SCHEMA } },
        max_output_tokens: 900,
        store: false,
      }),
    });
  } catch (e) {
    throw new ApiError(e.name === "AbortError" ? "OpenAI timeout" : "OpenAI network error", e.name === "AbortError" ? "TIMEOUT" : "AI_NETWORK");
  } finally {
    clearTimeout(timer);
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(`OpenAI HTTP ${res.status}${body?.error?.code ? " " + body.error.code : ""}`, res.status === 429 ? "AI_RATE_LIMIT" : res.status === 401 ? "AI_AUTH" : "AI_HTTP_" + res.status);
  if (body?.status && body.status !== "completed") throw new ApiError(`OpenAI response ${body.status}`, "AI_INCOMPLETE");
  const text = body?.output_text
    ?? (body?.output || []).flatMap((o) => o.content || []).filter((c) => c.type === "output_text").map((c) => c.text).join("");
  try { return JSON.parse(text); } catch (e) { throw new ApiError("OpenAI returned non-JSON text", "AI_BAD_RESPONSE"); }
}

async function generate(input) {
  const deadline = Date.now() + AI.DEADLINE_MS;
  let extra = null, problems = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const ans = await callOpenAI(input, extra, deadline);
    problems = check(ans, input);
    if (!problems.length) return tidy(ans);
    // one retry with the exact reasons; never "fix" the text on the server
    extra = `직전 답이 규칙을 어겼어요: ${problems.join(" / ")}. 입력 JSON에 있는 숫자만 쓰고, 확답·도착 시각 단정 없이 같은 형식으로 다시 답하세요.`;
  }
  throw new ApiError(`answer failed checks: ${problems.join(" / ")}`, "CHECK_FAILED");
}

// ---------- entry
const lastCall = new Map(); // client ip -> ms (button mashing / scripted bursts)
async function analyze(raw, clientId = "local") {
  if (!AI.key()) throw new ApiError("OPENAI_API_KEY is not set", "NO_AI_KEY");
  const input = sanitize(raw);
  const hash = crypto.createHash("sha256").update(JSON.stringify(input)).digest("hex").slice(0, 32);
  const key = `ai_${hash}`;
  const r = await cached(key, AI.TTL, async () => {
    const now = Date.now();
    if (now - (lastCall.get(clientId) || 0) < 4000) throw new ApiError("too many requests", "TOO_FAST");
    lastCall.set(clientId, now);
    if (lastCall.size > 2000) lastCall.clear();
    return { analysis: await generate(input), model: AI.model(), generatedAt: kstIso() };
  });
  if (r.cache === "stale") throw r.error; // never serve an expired answer for a new request
  return {
    analysis: r.value.analysis,
    meta: { model: r.value.model, generatedAt: r.value.generatedAt, cache: r.cache === "hit" ? "hit" : "miss", basisDate: input.view.date, asOf: input.asOf, key: hash },
  };
}

module.exports = { analyze, sanitize, check, allowedNumbers, SYSTEM_PROMPT, AI };
