// ICN 체크보드 — browser app. Talks only to this site's /api/* (the service key never reaches the browser).
const $ = (id) => document.getElementById(id);
const fmt = (n) => Number(n).toLocaleString("ko-KR");
const hh = (h) => String(h).padStart(2, "0");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;
const WEEK = ["일", "월", "화", "수", "목", "금", "토"];
const TERM_LABEL = { P01: "제1터미널", P02: "탑승동", P03: "제2터미널" };
const TERM_SHORT = { P01: "T1", P02: "탑승동", P03: "T2" };
const termGroup = (tm) => (tm === "P03" ? "T2" : "T1"); // 탑승동(P02)은 T1에서 수속
const LV_TEXT = { low: "여유", mid: "보통", high: "혼잡", off: "미운영" };
const REFRESH_MS = 5 * 60 * 1000;
const DISCLAIMER = "참고용 · 공식 운항 정보는 항공사 안내 확인";

const store = {
  get(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage off */ } },
};

const state = {
  board: null, trends: null, dayIdx: 0, sel: null, cardAirline: "",
  term: "", airline: "", status: "", q: "", limit: 60, wxLimit: 12, trendBy: "airlines",
  th: store.get("icn.th", null), watch: store.get("icn.watch", []), travel: store.get("icn.travel", 60),
  lastStatus: store.get("icn.lastStatus", {}), openKey: null, firstPaint: true,
  pick: null, extra: {}, sort: "issue", trendDay: "all",
  ai: { key: null, loading: false, result: null, error: null, seq: 0 }, // AI analysis of the current selection // calendar date outside today/tomorrow and its loaded departures
};
const day = () => state.pick || state.board?.meta.days[state.dayIdx];
const boardDays = () => state.board?.meta.days || [];

// ---------- time helpers (KST wall clock carried in UTC fields)
const ts = (d, hm) => { const [y, m, dd] = d.split("-").map(Number); const [h, mi] = hm.split(":").map(Number); return Date.UTC(y, m - 1, dd, h, mi); };
const dayOf = (t) => new Date(t).toISOString().slice(0, 10);
const hmOf = (t) => new Date(t).toISOString().slice(11, 16);
const dayLabel = (d) => { const x = new Date(d + "T00:00:00Z"); return `${x.getUTCMonth() + 1}.${x.getUTCDate()} (${WEEK[x.getUTCDay()]})`; };
const stamp = (iso) => (iso ? `${iso.slice(5, 10).replace("-", ".")} ${iso.slice(11, 16)}` : "-");
const fKey = (f) => `${f.id}|${f.d}|${f.t}`;
const depMs = (f) => (f.e && !f.cx ? ts(f.ed || f.d, f.e) : ts(f.d, f.t));

// ---------- data
async function getJson(url) {
  const r = await fetch(url, { headers: { Accept: "application/json" } });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
  return body;
}

async function loadBoard({ manual = false } = {}) {
  const btn = $("refreshBtn");
  btn.classList.add("spin");
  try {
    const b = await getJson("/api/board");
    const prev = state.board;
    state.board = b;
    if (state.pick) { if (b.meta.range && (state.pick < b.meta.range.min || state.pick > b.meta.range.max || b.meta.days.includes(state.pick))) state.pick = null; else await loadExtra(state.pick, { quiet: true }); }
    mergeExtra();
    if (!prev || prev.meta.days[0] !== b.meta.days[0]) { state.sel = null; }
    checkWatchChanges();
    renderAll(state.firstPaint);
    state.firstPaint = false;
    // Fallback data because the API hiccupped (not a missing key): try again in a minute instead of five.
    const degraded = Object.values(b.meta.sources).filter((s) => s.status === "sample" || s.status === "missing" || s.status === "stale");
    clearTimeout(state.retryTimer);
    if (degraded.length && !degraded.every((s) => s.reason === "NO_KEY")) state.retryTimer = setTimeout(() => loadBoard(), 60 * 1000);
    if (manual) toast(`새로 불러왔어요 · ${stamp(b.meta.generatedAt)}`);
  } catch (e) {
    toast(`자료를 불러오지 못했어요. 잠시 후 다시 시도해 주세요. (${e.message})`);
    if (!state.board) $("notice").hidden = false, $("notice").textContent = "자료를 불러오지 못했어요. 서버가 실행 중인지 확인해 주세요.";
  } finally {
    btn.classList.remove("spin");
  }
}

// Calendar day outside today/tomorrow: departures from /api/day, merged into the board's flight list.
async function loadExtra(date, { quiet = false } = {}) {
  try { state.extra[date] = await getJson(`/api/day?date=${date}`); return true; }
  catch (e) { if (!quiet) toast(`${dayLabel(date)} 운항 자료를 불러오지 못했어요. (${e.message})`); return false; }
}
function mergeExtra() {
  const days = boardDays(), x = state.pick && state.extra[state.pick];
  state.board.flights = state.board.flights.filter((f) => days.includes(f.d)).concat(x ? x.flights.filter((f) => f.d === state.pick) : []);
}
function resetDayView() { state.sel = null; state.cardAirline = ""; state.airline = ""; state.limit = 60; state.wxLimit = 12; }
async function pickDate(date) {
  if (!date || !state.board) return;
  const days = boardDays();
  if (days.includes(date)) { state.pick = null; state.dayIdx = days.indexOf(date); }
  else {
    if (date === state.pick) return;
    const btn = $("calBtn"); btn.classList.add("busy");
    const ok = state.extra[date] || await loadExtra(date);
    btn.classList.remove("busy");
    if (!ok) { renderHeader(); return; }
    state.pick = date;
  }
  mergeExtra(); resetDayView(); renderAll(true);
}

async function loadTrends() {
  try { state.trends = await getJson("/api/trends"); } catch (e) { state.trends = { available: false, reason: "NETWORK" }; }
  renderTrends();
}

// ---------- congestion levels
function hallValues(d) {
  const c = state.board?.cong[d]; const vals = [];
  if (c) for (const t of Object.values(c)) for (const s of Object.values(t.halls)) for (const v of s) if (v > 0) vals.push(v);
  return vals.sort((a, b) => a - b);
}
const pct = (s, p) => { if (!s.length) return 0; const k = (s.length - 1) * p, lo = Math.floor(k), hi = Math.min(lo + 1, s.length - 1); return s[lo] + (s[hi] - s[lo]) * (k - lo); };
const autoTh = (d) => { const v = hallValues(d); return { mid: Math.round(pct(v, 0.5) / 10) * 10, high: Math.round(pct(v, 0.8) / 10) * 10 }; };
const th = (d) => state.th || autoTh(d);
const level = (v, t) => (!v ? "off" : v >= t.high ? "high" : v >= t.mid ? "mid" : "low");

// ---------- recommendation (권장 도착)
function recommend(f) {
  if (f.cx || !f.t) return null;
  const group = termGroup(f.tm);
  let arrive = ts(f.d, f.t) - (150 + (f.tm === "P02" ? 15 : 0)) * 60000;
  const aday = dayOf(arrive), hour = new Date(arrive).getUTCHours(), c = state.board.cong[aday];
  const out = { group, hall: null, lv: null, people: null, noData: !c, busy: false };
  if (c && c[group]) {
    let best = null;
    for (const [hall, s] of Object.entries(c[group].halls)) if (s[hour] > 0 && (!best || s[hour] < best[1])) best = [hall, s[hour]];
    if (best) {
      out.hall = best[0]; out.people = best[1]; out.lv = level(best[1], th(aday));
      if (out.lv === "high") { arrive -= 30 * 60000; out.busy = true; }
    }
  }
  out.ms = arrive; out.time = hmOf(arrive); out.prevDay = dayOf(arrive) !== f.d;
  return out;
}

// ---------- watch list
const watchMatch = (f) => state.watch.some((w) => f.q.split(" ").includes(w));
// Flights already gone for more than 2 hours drop out (e.g. "…Y" numbers: last night's flights that left after midnight).
function watchedFlights() {
  if (!state.board) return [];
  const g = state.board.meta.generatedAt;
  const now = Date.UTC(+g.slice(0, 4), +g.slice(5, 7) - 1, +g.slice(8, 10), +g.slice(11, 13), +g.slice(14, 16));
  const days = boardDays();
  return state.board.flights
    .filter((f) => days.includes(f.d) && watchMatch(f) && !((f.sg === "departed" || f.cx) && depMs(f) < now - 2 * 3600000))
    .sort((a, b) => (a.d + a.t).localeCompare(b.d + b.t));
}
function toggleWatch(id, on) {
  const set = new Set(state.watch);
  if (on) set.add(id); else set.delete(id);
  state.watch = [...set]; store.set("icn.watch", state.watch);
}
function statusText(f) {
  if (f.cx) return "결항";
  if (f.sg === "delayed") return "지연";
  if (f.sg === "departed") return f.dly ? "지연 출발" : "출발";
  return f.st || "예정";
}
function checkWatchChanges() {
  const next = {};
  for (const f of watchedFlights()) {
    const k = fKey(f), now = `${statusText(f)}|${f.e || ""}`;
    next[k] = now;
    const before = state.lastStatus[k];
    if (before && before !== now) {
      const [bs, be] = before.split("|");
      toast(`${f.id} ${f.dn}: ${bs}${be ? " " + be : ""} → ${statusText(f)}${f.e ? " " + f.e : ""}`);
      state.flash = k;
    }
  }
  state.lastStatus = next; store.set("icn.lastStatus", next);
}

// ---------- UI helpers
function toast(msg) {
  const el = document.createElement("div"); el.className = "toast"; el.textContent = msg;
  $("toasts").append(el); setTimeout(() => el.remove(), 4200);
}
const tip = $("tip");
function showTip(e, html) { tip.innerHTML = html; tip.hidden = false; moveTip(e); }
function moveTip(e) { const r = tip.getBoundingClientRect(); let x = e.clientX + 14, y = e.clientY + 14; if (x + r.width > innerWidth - 8) x = e.clientX - r.width - 14; if (y + r.height > innerHeight - 8) y = e.clientY - r.height - 14; tip.style.left = Math.max(8, x) + "px"; tip.style.top = Math.max(8, y) + "px"; }
const hideTip = () => { tip.hidden = true; };
function countUp(el, to, animate) {
  if (!animate || REDUCED) { el.textContent = fmt(to); return; }
  const start = performance.now(), dur = 900;
  const step = (now) => { const p = Math.min(1, (now - start) / dur); el.textContent = fmt(Math.round(to * (1 - Math.pow(1 - p, 3)))); if (p < 1) requestAnimationFrame(step); };
  el.textContent = "0"; requestAnimationFrame(step);
  // Background tabs pause animation frames: make sure the final number always lands.
  setTimeout(() => { el.textContent = fmt(to); }, dur + 150);
}
// Status = icon + label + colour (never colour alone).
const ICON = {
  ok: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  late: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
  cx: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M8.8 8.8l6.4 6.4M15.2 8.8l-6.4 6.4"/></svg>',
  board: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h11M11 7l5 5-5 5M20 5v14"/></svg>',
  plain: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3.2"/></svg>',
  all: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h10"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  bulb: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.6 10.8c.6.5 1 1.2 1 2V16h5.2v-.2c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z"/></svg>',
};
function pillKind(f) { return f.cx ? "cx" : f.sg === "delayed" ? "late" : f.sg === "departed" ? (f.dly ? "late" : "ok") : f.sg === "boarding" ? "board" : "plain"; }
function pill(f) {
  const k = pillKind(f);
  const label = f.cx ? "결항" : f.sg === "delayed" ? "지연" : f.sg === "departed" ? (f.dly ? "지연 출발" : "출발") : esc(f.st || "예정");
  return `<span class="pill ${k}">${ICON[k]}${label}</span>`;
}
// KST wall clock now, in the same "UTC fields = KST" frame as ts().
function nowMs() { const n = new Date(Date.now() + 9 * 3600000); return Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate(), n.getUTCHours(), n.getUTCMinutes()); }
function leftText(ms) { const m = Math.round((ms - nowMs()) / 60000); if (m <= 0) return null; const h = Math.floor(m / 60), mm = m % 60; return h ? `${h}시간 ${mm}분` : `${mm}분`; }
const flightsAt = () => (state.pick ? state.extra[state.pick]?.meta.source.at : state.board.meta.sources.flights?.at) || state.board.meta.generatedAt;
const wx = (code) => state.board.wx[code];
const wxShort = (code) => { const w = wx(code); return !w || w[1] == null ? "관측값 없음" : `${Math.round(w[1])}° · 습도 ${w[3] ?? "-"}%`; };
const estLabel = (f) => (f.cx ? "—" : (f.e || "—") + (f.ed && f.ed !== f.d ? (f.ed < f.d ? " (전날)" : " (다음날)") : ""));
const issueFirst = (a, b) => ((a.cx ? 0 : a.dly ? 1 : 2) - (b.cx ? 0 : b.dly ? 1 : 2)) || (a.d + a.t).localeCompare(b.d + b.t) || a.id.localeCompare(b.id);

// ---------- header, notice, badges
function renderHeader() {
  const m = state.board.meta;
  $("updatedAt").textContent = `${stamp(m.generatedAt).slice(6)} 기준`;
  $("refreshBtn").title = `자료 기준 ${stamp(m.generatedAt)} (KST) · 누르면 새로 불러와요`;
  $("heroDate").textContent = `${dayLabel(day())} 출발`;
  const seg = $("daySeg"); seg.textContent = "";
  m.days.forEach((d, i) => {
    const b = document.createElement("button"); b.type = "button";
    b.innerHTML = `${i === 0 ? "오늘" : "내일"}<span class="seg-d"> ${dayLabel(d)}</span>`; b.title = dayLabel(d);
    b.setAttribute("aria-pressed", String(!state.pick && i === state.dayIdx));
    b.onclick = () => pickDate(d);
    seg.append(b);
  });
  const r = m.range, cal = $("calInput");
  if (r) { cal.min = r.min; cal.max = r.max; }
  cal.value = day();
  $("calBtn").setAttribute("aria-pressed", String(!!state.pick));
  $("calText").textContent = state.pick ? dayLabel(state.pick) : "날짜 선택";
  $("calBtn").title = r ? `${dayLabel(r.min)} ~ ${dayLabel(r.max)} 출발편을 볼 수 있어요` : "";
  const label = { live: "실시간", cache: "캐시", stale: "지난 자료", sample: "샘플", missing: "없음" };
  const names = { flights: "운항", passenger: "혼잡 예고", weather: "날씨" };
  $("sourceBadges").innerHTML = Object.entries(m.sources).map(([k, s]) => {
    const cls = s.status === "live" ? "live" : s.status === "cache" ? "cache" : s.status === "sample" || s.status === "missing" ? "sample" : "";
    return `<span class="badge ${cls}" title="${esc(names[k])} 자료 ${esc(stamp(s.at))}"><i></i>${esc(names[k])} ${label[s.status] || s.status}${s.at ? " · " + esc(stamp(s.at).slice(6)) : ""}</span>`;
  }).join("");
  const n = $("notice");
  const sampleSrc = Object.entries(m.sources).filter(([, s]) => s.status === "sample" || s.status === "missing");
  if (sampleSrc.length) {
    const reason = sampleSrc[0][1].reason;
    const why = reason === "NO_KEY" ? "서버에 인증키가 설정되지 않아"
      : reason === "HTTP_429" ? "공공데이터 API에 요청이 잠시 몰려"
      : "공공데이터 API 연결이 원활하지 않아";
    const retry = reason === "NO_KEY" ? "" : " 1분 뒤 자동으로 다시 불러올게요.";
    const at = sampleSrc.find(([, s]) => s.at)?.[1].at;
    n.hidden = false;
    n.innerHTML = `<b>샘플 자료로 보여주는 중</b><span>${why} 저장된 샘플 자료${at ? `(자료일 ${esc(at.slice(0, 10))})` : ""}를 보여주고 있어요. ${sampleSrc.map(([k]) => names[k]).join(" · ")} 자료가 해당돼요.${retry}</span>`;
  } else if (Object.values(m.sources).some((s) => s.status === "stale")) {
    n.hidden = false; n.innerHTML = `<b>최근 자료로 보여주는 중</b><span>새 자료를 받지 못해 마지막으로 받은 자료를 보여주고 있어요.</span>`;
  } else n.hidden = true;
  document.body.classList.toggle("has-notice", !n.hidden);
  $("lead").textContent = state.pick
    ? `${dayLabel(state.pick)} 인천공항 출발편과 지연·결항을 보고 있어요. 출국장 혼잡 예고는 공항이 오늘·내일만 제공해요.`
    : `내 출장 편 상태와 권장 도착, 출국장 혼잡, 지연 흐름, 목적지 날씨까지 — 공항 공식 자료로 정리했어요.`;
  $("footAsof").textContent = `최신 갱신 ${m.generatedAt.slice(0, 10)} ${m.generatedAt.slice(11, 16)} (KST) · 운항 ${stamp(m.sources.flights?.at).slice(6)} · 승객 예고 ${stamp(m.sources.passenger?.at).slice(6)} · 날씨 ${stamp(m.sources.weather?.at).slice(6)}`;
}

// ---------- KPIs
function peak(d) { const c = state.board.cong[d]; let h = 0, v = 0; if (c) for (let i = 0; i < 24; i++) { const s = (c.T1?.tot[i] || 0) + (c.T2?.tot[i] || 0); if (s > v) { v = s; h = i; } } return [h, v]; }
function renderKpis(animate) {
  const d = day(), days = boardDays(), fl = state.board.flights.filter((f) => f.d === d), c = state.board.cong[d];
  const delayed = fl.filter((f) => f.dly && !f.cx).length, cancelled = fl.filter((f) => f.cx).length;
  const dests = new Set(fl.map((f) => f.dc)).size;
  const perHour = new Array(24).fill(0); fl.forEach((f) => { const h = Number(f.t.slice(0, 2)); if (h >= 0 && h < 24) perHour[h]++; });
  const isToday = d === days[0], nowH = isToday ? Number(state.board.meta.generatedAt.slice(11, 13)) : -1, maxH = Math.max(1, ...perHour);
  const paxTot = c ? ["T1", "T2"].reduce((a, t) => a + (c[t] ? c[t].tot.reduce((x, y) => x + y, 0) : 0), 0) : 0;
  const [ph, pv] = peak(d);
  const nowPax = c && isToday ? (c.T1?.tot[nowH] || 0) + (c.T2?.tot[nowH] || 0) : null;
  const at = stamp(flightsAt()).slice(6);
  // hero: today's operational status (official data only)
  $("heroStats").innerHTML = `<li><span>출발</span><b>${fmt(fl.length)}</b>편</li><li class="late">${ICON.late}<span>지연</span><b>${fmt(delayed)}</b>편</li><li class="cx">${ICON.cx}<span>결항</span><b>${fmt(cancelled)}</b>편</li><li class="asof">${esc(dayLabel(d))} · 운항 자료 ${esc(at)} 기준 · 공항 공식 자료</li>`;
  $("snapSub").textContent = `${dayLabel(d)} · 운항 자료 ${at} 기준 (KST)`;
  const busiest = perHour.indexOf(Math.max(...perHour));
  $("kpis").innerHTML = `
    <article class="kpi k-main"><span class="lab">출발 예정 편수 <span class="src-tag off">공항 자료</span></span>
      <span class="val"><span data-n="${fl.length}">0</span><small>편</small></span>
      <span class="s">${esc(dayLabel(d))} · 공동운항은 1편으로 합침 · 목적지 ${fmt(dests)}곳</span>
      <div class="spark"><div class="spark-bars" role="img" aria-label="시간대별 출발 예정 편수. 가장 많은 시간 ${hh(busiest)}시 ${perHour[busiest]}편">${perHour.map((n, h) => `<i class="${h === nowH ? "now" : ""}" style="height:${Math.max(2, Math.round((n / maxH) * 100))}%" data-tip="${hh(h)}시 출발 예정 <b>${n}편</b>"></i>`).join("")}</div>
        <div class="spark-ax" aria-hidden="true"><span>00시</span><span>06시</span><span>12시</span><span>18시</span><span>23시</span></div>
        <span class="s">시간대별 출발 예정 편수${nowH >= 0 ? " · 민트색 막대가 지금 시각" : ""}</span></div></article>
    <article class="kpi k-issue"><span class="lab">지연 · 결항 <span class="src-tag off">공항 자료</span></span>
      <div class="issue-row"><div><span class="st late">${ICON.late}지연</span><span class="val"><span data-n="${delayed}">0</span><small>편</small></span></div>
        <div><span class="st cx">${ICON.cx}결항</span><span class="val"><span data-n="${cancelled}">0</span><small>편</small></span></div></div>
      <span class="s">${d <= days[0] ? "지연 = 15분 이상 늦거나 공항이 '지연'으로 표시 · 해당 편은 운항 현황 맨 위에 보여요" : "앞으로 출발할 편이라 변경 시각이 아직 적어요"}</span></article>
    <article class="kpi k-pax"><span class="lab">출국 예상 승객 <span class="src-tag off">공항 예고</span></span>
      ${c ? `<span class="val"><span data-n="${paxTot}">0</span><small>명</small></span><span class="s">T1+T2 출국장 하루 합계</span>` : `<span class="val">-</span><span class="s">이 날짜는 혼잡 예고가 없어요 (공항이 오늘·내일만 제공)</span>`}</article>
    <article class="kpi k-peak"><span class="lab">가장 붐비는 시간 <span class="src-tag off">공항 예고</span></span>
      ${pv ? `<span class="val">${hh(ph)}<small>시</small></span><span class="s">T1+T2 ${fmt(pv)}명 예상${nowPax != null ? ` · 지금 ${hh(nowH)}시 ${fmt(nowPax)}명` : ""}</span>` : `<span class="val">-</span><span class="s">혼잡 예고 없음</span>`}</article>`;
  $("kpis").querySelectorAll("[data-n]").forEach((el) => countUp(el, Number(el.dataset.n), animate));
  $("kpis").querySelectorAll("[data-tip]").forEach((el) => { el.onpointerenter = (e) => showTip(e, el.dataset.tip); el.onpointermove = moveTip; el.onpointerleave = hideTip; });
}

// ---------- my flights
// Why a watched flight has no card: it already left (hidden 2h after departure) or it does not fly today/tomorrow.
function missingText(w) {
  const past = state.board.flights.filter((f) => state.board.meta.days.includes(f.d) && f.q.split(" ").includes(w)).sort((a, b) => (b.d + b.t).localeCompare(a.d + a.t))[0];
  const days = state.board.meta.days;
  if (past) {
    const other = days.filter((d) => d !== past.d).map(dayLabel).join("·");
    const how = past.cx ? "결항됐어요" : `출발했어요${past.dly && past.dl > 0 ? ` (${past.dl}분 지연)` : ""}`;
    const real = past.id !== w ? ` · 실제 운항편 ${esc(past.id)}` : "";
    return `${esc(dayLabel(past.d))} ${past.t} ${esc(past.dn)}행은 이미 ${how}${real}. ${esc(other)}에는 운항 예정이 없어요.`;
  }
  return `${days.map(dayLabel).join("·")} 인천 출발편에 이 편명이 없어요. 운항하지 않는 요일이거나 편명이 다를 수 있어요.`;
}
function renderMine() {
  const box = $("mineList"), list = watchedFlights();
  if (!state.watch.length) {
    box.innerHTML = `<div class="spot-empty"><img src="/icn/empty-flight.svg" width="400" height="260" alt="" aria-hidden="true" loading="lazy">
      <div><h3>아직 등록한 출장 편이 없어요</h3><p>편명을 넣으면 출발 상태, 권장 공항 도착 시각(자체 계산), 출발 전 체크리스트를 이곳에 크게 보여드려요.</p>
      <ol><li>위 입력칸에 편명 입력 — 공동운항 편명(예: KE5951)도 실제 운항편을 찾아줘요</li><li>또는 운항 현황 표에서 ☆ 누르기</li></ol>
      <button class="btn primary" type="button" data-focus-add>편명 입력하기</button></div></div>`;
    return;
  }
  const missing = state.watch.filter((w) => !list.some((f) => f.q.split(" ").includes(w)));
  const now = nowMs();
  const lead = list.find((f) => !f.cx && f.sg !== "departed" && depMs(f) >= now - 10 * 60000) || list[0];
  const rest = list.filter((f) => f !== lead);
  const others = rest.map(miniCard).join("") + missing.map((w) => `<div class="empty-mine"><b>${esc(w)}</b><span>${missingText(w)}</span><button class="btn ghost" type="button" data-unwatch="${esc(w)}">목록에서 빼기</button></div>`).join("");
  box.innerHTML = (lead ? spotlight(lead) : "") + (others ? `<div class="others">${others}</div>` : "");
  state.flash = null;
}
function miniCard(f) {
  const r = recommend(f), k = fKey(f);
  const where = r && r.hall ? `${r.group} ${r.hall}번` : r ? r.group : "-";
  return `<article class="mf${state.flash === k ? " flash" : ""}" data-key="${esc(k)}" tabindex="0" aria-label="${esc(f.id)} ${esc(f.dn)} 출발 플래너 열기">
    <div class="mf-top"><div><div class="mf-id">${esc(f.id)}</div><div class="mf-route">${esc(dayLabel(f.d))} ${f.t} · ICN → ${esc(f.dc)} ${esc(f.dn)}</div></div>${pill(f)}</div>
    <div class="mf-grid"><div><span>권장 도착</span><b>${r ? r.time : "-"}</b>${r && r.prevDay ? "<small>전날 밤</small>" : ""}</div><div><span>출국장</span><b>${esc(where)}</b></div>
      <div><span>${f.e && f.e !== f.t && !f.cx ? "변경 출발" : "체크인"}</span><b>${f.e && f.e !== f.t && !f.cx ? esc(estLabel(f)) : esc(f.ci || "-")}</b></div></div>
    <button class="icon-btn mf-x" type="button" data-unwatch="${esc(f.q.split(" ").find((x) => state.watch.includes(x)))}" aria-label="${esc(f.id)} 내 출장 편에서 빼기"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
  </article>`;
}
function spotlight(f) {
  const r = recommend(f), k = fKey(f), dep = depMs(f), now = nowMs(), w = wx(f.dc);
  const changed = f.e && f.e !== f.t && !f.cx;
  const left = f.cx ? null : leftText(dep);
  const cd = f.cx ? `<div class="countdown"><span>상태</span><b>결항 · 항공사 안내 확인</b></div>`
    : f.sg === "departed" ? `<div class="countdown"><span>상태</span><b>출발했어요</b></div>`
    : left ? `<div class="countdown"><span>출발까지 · ${changed ? "변경" : "예정"} 시각 기준</span><b>${left}</b></div>`
    : `<div class="countdown"><span>출발 시각</span><b>지났어요 · 상태 확인 중</b></div>`;
  const where = r && r.hall ? `${r.group} ${r.hall}번 출국장` : r ? `${r.group} · 출국장 예고 없음` : "";
  const travel = state.travel, arrive = r ? r.ms : dep - 150 * 60000;
  const steps = f.cx ? [] : [
    [arrive - travel * 60000, "집 · 회사에서 출발", `공항까지 ${travel}분 기준`],
    [arrive, "공항 도착 (권장)", r && r.hall ? `${r.group} ${r.hall}번 출국장 · ${LV_TEXT[r.lv]}${r.busy ? " · 혼잡해서 30분 일찍" : ""}` : "출국장 예고 없음 · 출발 2시간 30분 전"],
    [dep - 60 * 60000, "체크인 · 수하물 마감 무렵", `일반적 기준 · 카운터 ${f.ci || "-"}`],
    [dep - 40 * 60000, "탑승 시작 무렵", `일반적 기준 · 탑승구 ${f.g || "-"}`],
    [dep, changed ? "출발 (변경 시각)" : "출발", `${f.dn} ${f.dc}행`],
  ];
  let next = steps.findIndex((s) => s[0] > now); if (next < 0) next = steps.length;
  const items = steps.map((s, i) => {
    const st = i < next ? "done" : i === next ? "next" : "";
    const dsh = dayOf(s[0]) !== f.d ? (dayOf(s[0]) < f.d ? "전날" : "다음날") : "";
    return `<li class="${st}"><span class="mk">${ICON.check}</span><span class="ct"><b>${s[1]}${st === "done" ? '<span class="sr"> (지난 단계)</span>' : st === "next" ? '<span class="sr"> (다음 단계)</span>' : ""}</b><span>${esc(s[2])}</span></span><span class="tm">${hmOf(s[0])}${dsh ? `<small>${dsh}</small>` : ""}</span></li>`;
  }).join("");
  const unwatch = esc(f.q.split(" ").find((x) => state.watch.includes(x)) || f.id);
  return `<article class="spot${state.flash === k ? " flash" : ""}" data-spot="${esc(k)}" aria-label="대표 출장 편 ${esc(f.id)}">
    <div class="spot-main">
      <div class="spot-top"><span class="fid">${esc(f.id)}</span><span class="al">${esc(f.al)}${f.cs.length ? ` · 공동운항 ${esc(f.cs.slice(0, 3).join(", "))}${f.cs.length > 3 ? " 외" : ""}` : ""}</span>${pill(f)}</div>
      <div class="route"><div class="ap"><b>ICN</b><span>인천 · ${esc(TERM_LABEL[f.tm] || f.tm)}</span></div><div class="path" aria-hidden="true"></div>
        <div class="ap to"><b>${esc(f.dc)}</b><span>${esc(f.dn)}${w && w[1] != null ? ` · 현재 ${Math.round(w[1])}°` : ""}</span></div></div>
      <div class="times"><div class="${changed ? "was" : ""}"><span>${esc(dayLabel(f.d))} 예정</span><b>${f.t}</b></div>${changed ? `<div class="chg"><span>변경 출발</span><b>${esc(estLabel(f))}</b></div>` : ""}${cd}</div>
      <div class="facts">
        <div><span>터미널</span><b>${esc(TERM_SHORT[f.tm] || f.tm)}</b><small>${f.tm === "P02" ? "T1 수속 후 셔틀" : esc(TERM_LABEL[f.tm] || "")}</small></div>
        <div><span>체크인 카운터</span><b>${esc(f.ci || "-")}</b><small>공항 자료</small></div>
        <div><span>탑승구</span><b>${esc(f.g || "-")}</b><small>공항 자료</small></div>
        <div class="key"><span>권장 공항 도착 <span class="calc">자체 계산</span></span><b>${r ? r.time : "-"}</b><small>${r ? `${r.prevDay ? "전날 · " : ""}${esc(where)}` : "결항"}</small></div>
      </div>
      <div class="spot-act"><button class="btn primary" type="button" data-open="${esc(k)}">출발 플래너 열기</button><button class="btn ghost" type="button" data-unwatch="${unwatch}">내 출장 편에서 빼기</button><span class="fine">${DISCLAIMER}</span></div>
    </div>
    <aside class="spot-side" aria-label="출발 전 체크리스트">
      <h3>출발 전 체크리스트 <small>지금 ${hmOf(now)} 기준</small></h3>
      ${f.cx ? `<p>결항된 편이에요. 대체편·환불은 항공사 안내를 확인해 주세요.</p>` : `<ol class="check">${items}</ol>
      <label class="travel-in">공항까지 이동 시간 <select data-travel>${[30, 45, 60, 75, 90, 120].map((m) => `<option value="${m}" ${m === travel ? "selected" : ""}>${m}분</option>`).join("")}</select></label>`}
      <p class="fine">권장 도착 = 출발 2시간 30분 전 기준의 자체 계산이에요. 체크인 마감·탑승 시작은 일반적인 기준이며 항공사 안내가 우선이에요.</p>
    </aside>
  </article>`;
}

// ---------- congestion strip + linked card
function defaultSel(d) {
  const c = state.board.cong[d]; if (!c || !c.T1) return null;
  const nowH = Number(state.board.meta.generatedAt.slice(11, 13));
  const h = d === boardDays()[0] ? nowH : peak(d)[0];
  let best = null;
  for (const [hall, s] of Object.entries(c.T1.halls)) if (!best || s[h] > best[1]) best = [hall, s[h]];
  return best ? { term: "T1", hall: best[0], h } : { col: true, h };
}
function renderStrip(animate) {
  const strip = $("strip"); strip.textContent = "";
  const d = day(), c = state.board.cong[d], t = th(d);
  if (!c) { strip.innerHTML = `<p class="empty" style="grid-column:1/-1">${state.pick ? `출국장 혼잡 예고는 공항이 오늘·내일 것만 제공해요. ${esc(dayLabel(d))}에는 출발편과 지연·결항만 볼 수 있어요.` : "이 날짜의 출국장 혼잡 예고가 없어요."}</p>`; state.sel = null; renderCard(); drawLink(); return; }
  if (!state.sel) state.sel = defaultSel(d);
  strip.append(Object.assign(document.createElement("div"), { className: "rl", textContent: "시간" }));
  for (let h = 0; h < 24; h++) {
    const b = document.createElement("button"); b.type = "button"; b.className = "hr"; b.textContent = hh(h); b.dataset.h = h;
    b.setAttribute("aria-label", `${hh(h)}시 전체 출국장 선택`); b.onclick = () => select({ col: true, h }); strip.append(b);
  }
  const fills = [];
  const maxTot = Math.max(1, ...["T1", "T2"].flatMap((k) => (c[k] ? c[k].tot : [0])));
  for (const term of ["T1", "T2"]) {
    const tc = c[term]; if (!tc) continue;
    strip.append(Object.assign(document.createElement("div"), { className: "grp", textContent: term === "T1" ? "제1터미널 · 탑승동 출발편 포함" : "제2터미널" }));
    strip.append(Object.assign(document.createElement("div"), { className: "rl term", textContent: `${term} 전체` }));
    tc.tot.forEach((v, h) => {
      const el = document.createElement("div"); el.className = "bars"; el.dataset.term = term; el.dataset.h = h;
      const i = document.createElement("i"); el.append(i);
      el.onpointerenter = (e) => showTip(e, `${term} 전체 · ${hh(h)}~${hh((h + 1) % 24)}시<br><b>${fmt(v)}명</b> 예상`);
      el.onpointermove = moveTip; el.onpointerleave = hideTip;
      strip.append(el);
      const set = () => { i.style.height = Math.round((v / maxTot) * 100) + "%"; };
      if (animate && !REDUCED) fills.push([h, set]); else set();
    });
    const halls = [...Object.keys(tc.halls).map((k) => [k, false]), ...tc.off.map((k) => [k, true])].sort((a, b) => a[0] - b[0]);
    for (const [hall, off] of halls) {
      const excluded = term === "T1" && hall === "6";
      const label = `${term} ${hall}번` + (off ? (excluded ? " · 제외" : " · 미운영") : "");
      strip.append(Object.assign(document.createElement("div"), { className: "rl" + (off ? " off" : ""), textContent: label, title: label }));
      for (let h = 0; h < 24; h++) {
        if (off) {
          const el = document.createElement("div"); el.className = "cell off";
          el.onpointerenter = (e) => showTip(e, `${term} ${hall}번 출국장<br>${excluded ? "교통약자 우대 출구라 혼잡도 대상에서 제외" : "이날 예상 인원 0명 · 미운영"}`);
          el.onpointermove = moveTip; el.onpointerleave = hideTip; strip.append(el); continue;
        }
        const v = tc.halls[hall][h], lv = level(v, t);
        const b = document.createElement("button"); b.type = "button"; b.className = "cell" + (animate && !REDUCED ? "" : " " + lv);
        Object.assign(b.dataset, { term, hall, h });
        b.setAttribute("aria-label", `${term} ${hall}번 출국장 ${hh(h)}시 ${fmt(v)}명 ${LV_TEXT[lv]}`);
        b.onpointerenter = (e) => showTip(e, `${term} ${hall}번 출국장 · ${hh(h)}~${hh((h + 1) % 24)}시<br><b>${fmt(v)}명</b> 예상 · ${LV_TEXT[lv]}`);
        b.onpointermove = moveTip; b.onpointerleave = hideTip;
        b.onclick = () => select({ term, hall, h });
        strip.append(b);
        if (animate && !REDUCED) fills.push([h, () => b.classList.add(lv)]);
      }
    }
  }
  if (fills.length) requestAnimationFrame(() => requestAnimationFrame(() => fills.forEach(([h, f]) => setTimeout(f, 60 + h * 40))));
  markSel(); renderCard(); drawLink();
}
function markSel() {
  const s = state.sel, col = !!(s && s.col);
  document.querySelectorAll("#strip button.cell").forEach((b) => {
    const h = Number(b.dataset.h);
    b.setAttribute("aria-pressed", String(!!s && !col && s.term === b.dataset.term && s.hall === b.dataset.hall && s.h === h));
    b.classList.toggle("colsel", col && h === s.h);
  });
  document.querySelectorAll("#strip .hr").forEach((b) => b.setAttribute("aria-pressed", String(col && Number(b.dataset.h) === s.h)));
  document.querySelectorAll("#strip .bars").forEach((el) => el.classList.toggle("on", !!s && Number(el.dataset.h) === s.h && (col || el.dataset.term === s.term)));
}
function select(sel) { state.sel = sel; state.cardAirline = ""; markSel(); renderCard(); drawLink(); }

function renderCard() {
  const card = $("card");
  if (!state.sel) { card.hidden = true; renderSelbar(); aiSync(); return; }
  card.hidden = false;
  const { term, hall, h, col } = state.sel, d = day(), c = state.board.cong[d];
  const inSlot = state.board.flights.filter((f) => f.d === d && (col || termGroup(f.tm) === term) && Number(f.t.slice(0, 2)) === h);
  const airlines = [...new Set(inSlot.map((f) => f.al))].sort((a, b) => a.localeCompare(b, "ko"));
  if (state.cardAirline && !airlines.includes(state.cardAirline)) state.cardAirline = "";
  const list = inSlot.filter((f) => !state.cardAirline || f.al === state.cardAirline).sort(issueFirst);
  $("cardTitle").textContent = col ? `${hh(h)}시 · 전체 출발편` : `${hh(h)}시 · ${term} 출발편`;
  $("tFlights").textContent = `${fmt(inSlot.length)}편`;
  $("tFlightsS").textContent = `${col ? "T1+T2" : term} · ${hh(h)}:00~${hh(h)}:59 예정`;
  const dl = inSlot.filter((f) => f.dly && !f.cx).length, cx = inSlot.filter((f) => f.cx).length;
  $("tIssue").textContent = `${dl} · ${cx}`; $("tIssue").className = dl + cx ? "alert" : "";
  const t1 = c?.T1?.tot[h] ?? 0, t2 = c?.T2?.tot[h] ?? 0;
  if (col) { $("tPaxL").textContent = "예상 승객"; $("tPax").textContent = `${fmt(t1 + t2)}명`; $("tPaxS").textContent = `T1 ${fmt(t1)} · T2 ${fmt(t2)}명`; }
  else { $("tPaxL").textContent = `예상 승객 · ${hall}번`; $("tPax").textContent = `${fmt(c?.[term]?.halls[hall]?.[h] ?? 0)}명`; $("tPaxS").textContent = `${term} 전체 ${fmt(term === "T1" ? t1 : t2)}명`; }
  $("miniBody").innerHTML = list.length ? list.map((f) => `<tr data-key="${esc(fKey(f))}"><td class="fid">${esc(f.id)}${f.tm === "P02" ? "<small>탑승동</small>" : ""}</td><td class="dest">${esc(f.dn)}</td><td class="tm">${f.t} → ${esc(estLabel(f))}</td><td>${pill(f)}</td><td class="wxc">${wxShort(f.dc)}</td></tr>`).join("")
    : `<tr><td colspan="5" class="empty">이 시간 ${col ? "" : term + " "}출발편이 없어요.</td></tr>`;
  const sel = $("cardAirline");
  sel.innerHTML = `<option value="">전체 (${inSlot.length})</option>` + airlines.map((a) => `<option value="${esc(a)}">${esc(a)} (${inSlot.filter((f) => f.al === a).length})</option>`).join("");
  sel.value = state.cardAirline;
  renderSelbar();
  aiSync();
}
// Selected hour/hall summary above the heatmap (text + level label, not colour alone).
function renderSelbar() {
  const el = $("selbar"), s = state.sel, d = day(), c = state.board.cong[d];
  if (!s || !c) { el.hidden = true; return; }
  el.hidden = false;
  const t = th(d), [ph, pv] = peak(d), t1 = c.T1?.tot[s.h] ?? 0, t2 = c.T2?.tot[s.h] ?? 0;
  const tag = (lv) => `<span class="lvtag ${lv}"><i></i>${LV_TEXT[lv]}</span>`;
  let pick;
  if (s.col) {
    let best = null;
    for (const term of ["T1", "T2"]) for (const [hall, v] of Object.entries(c[term]?.halls || {})) if (v[s.h] > 0 && (!best || v[s.h] > best[2])) best = [term, hall, v[s.h]];
    pick = best ? `<div><span>가장 붐비는 출국장 · ${hh(s.h)}시</span><b>${best[0]} ${best[1]}번 ${fmt(best[2])}명 ${tag(level(best[2], t))}</b></div>` : `<div><span>출국장</span><b>운영 출국장 없음</b></div>`;
  } else {
    const v = c[s.term]?.halls[s.hall]?.[s.h] ?? 0;
    pick = `<div><span>선택한 출국장 · 예상 승객</span><b>${fmt(v)}명 ${tag(level(v, t))}</b></div>`;
  }
  el.innerHTML = `<div><span>선택</span><b>${hh(s.h)}시 · ${s.col ? "T1+T2 전체" : `${s.term} ${s.hall}번 출국장`}</b></div>${pick}
    <div><span>같은 시간 터미널 전체</span><b>T1 ${fmt(t1)} · T2 ${fmt(t2)}명</b></div>
    <div><span>하루 중 가장 붐비는 시간</span><b>${pv ? `${hh(ph)}시 · ${fmt(pv)}명` : "-"}</b><small>공항 승객예고 · 색 구간은 자체 기준</small></div>`;
}
function drawLink() {
  const svg = $("link"), view = $("hourview"), card = $("card"), box = $("stripBox");
  svg.innerHTML = "";
  const from = document.querySelector('#strip button.cell[aria-pressed="true"]') || document.querySelector('#strip .hr[aria-pressed="true"]');
  if (!from || card.hidden) return;
  const v = view.getBoundingClientRect(), a = from.getBoundingClientRect(), b = card.getBoundingClientRect(), sb = box.getBoundingClientRect();
  if (b.left < a.right + 16) return; // stacked layout
  if (a.right < sb.left || a.left > sb.right) return; // scrolled out of view
  svg.setAttribute("width", v.width); svg.setAttribute("height", v.height); svg.setAttribute("viewBox", `0 0 ${v.width} ${v.height}`);
  const x1 = Math.min(a.right, sb.right) - v.left + 3, y1 = a.top + a.height / 2 - v.top;
  const x2 = b.left - v.left - 4, y2 = Math.min(Math.max(y1, b.top - v.top + 30), b.bottom - v.top - 30);
  svg.innerHTML = `<defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="var(--primary)"/></marker></defs>` +
    `<circle cx="${x1}" cy="${y1}" r="3" fill="var(--primary)"/><line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="var(--primary)" stroke-width="1.75" marker-end="url(#ah)"/>`;
}

// ---------- AI analysis (screen aggregates only -> /api/analyze; the key never leaves the server)
function aiPayload() {
  const s = state.sel; if (!state.board || !s) return null;
  const m = state.board.meta, d = day(), c = state.board.cong[d];
  const fl = state.board.flights.filter((f) => f.d === d);
  const inSlot = fl.filter((f) => (s.col || termGroup(f.tm) === s.term) && Number(f.t.slice(0, 2)) === s.h);
  const count = (a) => ({ total: a.length, delayed: a.filter((f) => f.dly && !f.cx).length, cancelled: a.filter((f) => f.cx).length });
  const terms = s.col ? ["T1", "T2"] : [s.term];
  let pf = null;
  if (c) {
    const hourly = {}, byHall = {};
    for (const t of terms) if (c[t]) {
      hourly[t] = c[t].tot;
      for (const [hall, v] of Object.entries(c[t].halls)) if (s.col || hall === s.hall || v[s.h] > 0) byHall[`${t}-${hall}`] = v[s.h] || 0;
    }
    const pkOf = (arr) => arr.reduce((b, v, i) => (v > b[1] ? [i, v] : b), [0, -1]);
    const one = !s.col && c[s.term] ? pkOf(c[s.term].tot) : null;
    const [ah, av] = peak(d), t = th(d);
    pf = { hourly, selectedHourByHall: byHall, levelThresholds: { busyFrom: Math.round(t.mid), veryBusyFrom: Math.round(t.high) },
      peak: one ? { terminal: s.term, hour: one[0], people: one[1] } : null, peakAll: av ? { hour: ah, people: av } : null };
  }
  const dest = new Map(); inSlot.forEach((f) => { const e = dest.get(f.dc) || { name: f.dn, n: 0 }; e.n++; dest.set(f.dc, e); });
  const weather = [...dest.entries()].sort((a, b) => b[1].n - a[1].n || a[0].localeCompare(b[0])).slice(0, 5).map(([code, e]) => {
    const w = wx(code) || []; return { code, name: e.name, flights: e.n, tempC: w[1] ?? null, feelsC: w[2] ?? null, humidity: w[3] ?? null, windMs: w[4] ?? null };
  });
  const limits = [];
  if (!c) limits.push("이 날짜는 출국장 혼잡 예고가 없음 (공항이 오늘·내일만 제공)");
  else limits.push("혼잡 예고는 공항 승객예고 자료이며 실제 대기와 다를 수 있음");
  limits.push("기상은 현재 관측값이며 예보가 아님");
  if (d >= boardDays()[0]) limits.push("아직 출발 전인 편의 지연은 반영되지 않았을 수 있음");
  const days = boardDays();
  const fAt = state.pick ? state.extra[state.pick]?.meta.source.at : m.sources.flights?.at;
  return {
    view: { date: d, dayLabel: d === days[0] ? "오늘" : d === days[1] ? "내일" : dayLabel(d),
      selection: s.col ? { type: "column", terminal: "T1+T2", hall: null, hour: s.h } : { type: "cell", terminal: s.term, hall: s.hall, hour: s.h } },
    asOf: { flights: fAt || null, passenger: c ? m.sources.passenger?.at || null : null, weather: m.sources.weather?.at || null },
    flights: { day: count(fl), selectedHour: { terminal: s.col ? "T1+T2" : s.term, hour: s.h, ...count(inSlot) } },
    passengerForecast: pf, weather, knownLimits: limits,
  };
}
// Same screen = same key (data timestamps excluded so a 5-minute refresh with unchanged numbers keeps the answer).
const aiKeyOf = (p) => (p ? JSON.stringify({ ...p, asOf: null }) : null);
function aiScopeText() {
  const s = state.sel; if (!s) return "혼잡 띠에서 시간대나 출국장을 고르면 분석할 수 있어요.";
  return `${dayLabel(day())} · ${hh(s.h)}시 · ${s.col ? "T1+T2 전체" : `${s.term} ${s.hall}번 출국장`} 기준`;
}
function aiSync() {
  const key = aiKeyOf(aiPayload());
  if (key !== state.ai.key) { state.ai.key = key; state.ai.result = null; state.ai.error = null; state.ai.loading = false; state.ai.seq++; }
  renderAi();
}
function renderAi() {
  const a = state.ai, body = $("aiBody"), btn = $("aiBtn");
  $("aiScope").textContent = aiScopeText();
  btn.disabled = a.loading || !state.sel; btn.classList.toggle("loading", a.loading);
  $("aiBtnText").textContent = a.loading ? "분석 중…" : a.result ? "다시 분석" : "AI 분석";
  if (a.loading) {
    body.innerHTML = `<div class="ai-skel sum"><i></i><i></i></div>` + [1, 2, 3].map(() => `<div class="ai-skel"><i></i><i></i><i></i></div>`).join("") + `<p class="sr-only">AI가 화면 값을 분석하고 있어요. 최대 20초 걸려요.</p>`;
  } else if (a.error) {
    body.innerHTML = `<div class="ai-err" role="alert"><b>AI 분석을 보여드리지 못했어요</b>${esc(a.error)}</div>`;
  } else if (a.result) {
    const r = a.result.analysis, li = (xs) => `<ul>${xs.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`;
    body.innerHTML = `<div class="ai-cell sum"><h4><i>1</i>한 줄 요약</h4><p>${esc(r.summary)}</p></div>
      <div class="ai-cell"><h4><i>2</i>눈에 띄는 점</h4>${li(r.highlights)}</div>
      <div class="ai-cell"><h4><i>3</i>출장 팁</h4>${li(r.tips)}</div>
      <div class="ai-cell lim" style="grid-column:1/-1"><h4><i>4</i>데이터 한계</h4>${li(r.limits)}</div>`;
  } else {
    body.innerHTML = `<p class="ai-empty">${state.sel ? "지금 화면에 보이는 집계값(선택 시간대·출국장, 편수, 지연·결항, 예상 승객, 목적지 기상)만 보내 요약해요. 항공편 목록은 보내지 않아요." : "혼잡 띠에서 시간대나 출국장을 먼저 골라 주세요."}</p>`;
  }
  const basis = a.result ? a.result.meta : null;
  $("aiFoot").textContent = `AI 생성 · 참고용 · 공식 운항 정보는 항공사 안내 확인 · 기준일 ${day() || "-"}${basis?.asOf?.flights ? ` (운항 자료 ${stamp(basis.asOf.flights).slice(6)})` : ""}${basis ? ` · ${basis.model}${basis.cache === "hit" ? " · 10분 캐시" : ""}` : ""}`;
}
async function runAi() {
  const a = state.ai; if (a.loading) return; // no double submit
  const payload = aiPayload(); if (!payload) return;
  const seq = ++a.seq; a.key = aiKeyOf(payload); a.loading = true; a.error = null; a.result = null; renderAi();
  const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const r = await fetch("/api/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: ctrl.signal });
    const body = await r.json().catch(() => ({}));
    if (seq !== a.seq) return; // selection changed while waiting: drop the old answer
    if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
    a.result = body;
  } catch (e) {
    if (seq !== a.seq) return;
    a.error = e.name === "AbortError" ? "20초 안에 답이 오지 않아 중단했어요. 잠시 후 다시 눌러 주세요." : navigator.onLine === false ? "인터넷 연결을 확인해 주세요." : e.message;
  } finally {
    clearTimeout(timer);
    if (seq === a.seq) { a.loading = false; renderAi(); }
  }
}

// ---------- band setter
function renderSetter() {
  const d = day(), vals = hallValues(d), t = th(d), svg = $("hist");
  const maxV = vals.length ? Math.ceil(vals[vals.length - 1] / 100) * 100 : 1000;
  for (const id of ["thMid", "thHigh"]) { $(id).min = 0; $(id).max = maxV; }
  $("thMid").value = t.mid; $("thHigh").value = t.high;
  $("thMidV").textContent = `${fmt(t.mid)}명 이상`; $("thHighV").textContent = `${fmt(t.high)}명 이상`;
  $("thSummary").textContent = `보통 ${fmt(t.mid)}명~ · 혼잡 ${fmt(t.high)}명~ ${state.th ? "(직접 정함)" : "(분포 기준)"}`;
  $("histCap").textContent = `${dayLabel(d)} 운영 출국장 × 시간대 ${vals.length}칸의 예상 승객 수(명/시간) 분포예요. 막대 색은 지금 구간 기준이에요.`;
  const counts = { low: 0, mid: 0, high: 0 }; vals.forEach((v) => counts[level(v, t)]++);
  $("thCount").innerHTML = ["low", "mid", "high"].map((l) => `<span><i class="sw ${l}"></i>${LV_TEXT[l]} <b>${counts[l]}</b>칸</span>`).join("");
  const W = Math.max(280, svg.clientWidth || 600), H = 160, pl = 28, pr = 8, pt = 12, pb = 22;
  const bin = 100, nb = Math.max(1, maxV / bin), bins = new Array(nb).fill(0);
  vals.forEach((v) => { bins[Math.min(nb - 1, Math.floor(v / bin))]++; });
  const ymax = Math.max(1, ...bins), bw = (W - pl - pr) / nb;
  const x = (v) => pl + (v / maxV) * (W - pl - pr), y = (n) => pt + (1 - n / ymax) * (H - pt - pb);
  let g = `<line x1="${pl}" x2="${W - pr}" y1="${H - pb}" y2="${H - pb}" stroke="var(--line)"/>`;
  [0, ymax].forEach((n) => { g += `<text x="${pl - 6}" y="${y(n) + 4}" text-anchor="end">${n}</text>`; });
  bins.forEach((n, i) => { if (n) g += `<rect x="${pl + i * bw + 1}" y="${y(n)}" width="${Math.max(1, bw - 2)}" height="${H - pb - y(n)}" rx="2" fill="var(--lv-${level(i * bin + bin / 2, t)})"><title>${fmt(i * bin)}~${fmt(i * bin + bin - 1)}명: ${n}칸</title></rect>`; });
  const step = maxV > 2000 ? 500 : 250;
  for (let v = 0; v <= maxV; v += step) g += `<text x="${x(v)}" y="${H - 6}" text-anchor="middle">${v >= 1000 ? (v / 1000).toFixed(v % 1000 ? 1 : 0) + "k" : v}</text>`;
  for (const [v, lab] of [[t.mid, "보통"], [t.high, "혼잡"]]) g += `<line x1="${x(v)}" x2="${x(v)}" y1="${pt}" y2="${H - pb}" stroke="var(--ink)" stroke-width="1.5"/><text x="${x(v) + 4}" y="${pt + 8}" style="fill:var(--ink)">${lab}</text>`;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`); svg.innerHTML = g;
}
function onTh(which) {
  let mid = Number($("thMid").value), high = Number($("thHigh").value);
  if (which === "mid" && mid >= high) high = mid + 10;
  if (which === "high" && high <= mid) mid = Math.max(0, high - 10);
  state.th = { mid, high }; store.set("icn.th", state.th);
  renderSetter(); renderStrip(false); renderFlights(); renderMine();
}

// ---------- flights table
function filtered() {
  const q = state.q.trim().toLowerCase(), d = day();
  return state.board.flights.filter((f) => {
    if (f.d !== d) return false;
    if (state.term && f.tm !== state.term) return false;
    if (state.airline && f.al !== state.airline) return false;
    if (!statusMatch(f, state.status)) return false;
    if (q && !`${f.dn} ${f.dc} ${f.q} ${f.al}`.toLowerCase().includes(q)) return false;
    return true;
  }).sort(SORTS[state.sort] || issueFirst);
}
function statusMatch(f, s) {
  if (s === "issue") return f.dly || f.cx;
  if (s === "before") return f.sg !== "departed" && !f.cx;
  if (s === "boarding") return f.sg === "boarding";
  if (s === "departed") return f.sg === "departed";
  return true;
}
const byTime = (a, b) => (a.d + a.t).localeCompare(b.d + b.t) || a.id.localeCompare(b.id);
const SORTS = {
  issue: issueFirst,
  time: byTime,
  id: (a, b) => a.id.localeCompare(b.id) || byTime(a, b),
  dest: (a, b) => a.dn.localeCompare(b.dn, "ko") || byTime(a, b),
};
function recCell(f) {
  const r = recommend(f);
  if (!r) return `<span class="fine">-</span>`;
  const when = `<b>${r.time}</b>까지${r.prevDay ? ' <span class="fine">(전날)</span>' : ""}`;
  if (r.noData) return `${when}<br><span class="fine">혼잡 예고 없음</span>`;
  if (!r.hall) return `${when}<br><span class="fine">${r.group} · 운영 출국장 없음</span>`;
  return `${when}<br><span class="fine"><i class="lvdot ${r.lv}"></i>${r.group} ${r.hall}번 · ${LV_TEXT[r.lv]}</span>`;
}
function renderFlights() {
  const rows = filtered(), all = state.board.flights.filter((f) => f.d === day());
  const q = state.q.trim().toUpperCase();
  $("flightCount").textContent = `${dayLabel(day())} · ${fmt(rows.length)}편 / 전체 ${fmt(all.length)}편 · 행을 누르면 출발 플래너가 열려요`;
  const sortTh = { time: "thTime", id: "thId", dest: "thDest" };
  for (const id of ["thTime", "thId", "thDest"]) $(id).removeAttribute("aria-sort");
  if (sortTh[state.sort]) $(sortTh[state.sort]).setAttribute("aria-sort", "ascending");
  const tb = $("tbody");
  if (!rows.length) {
    const why = state.q ? `'${esc(state.q)}'에 맞는 출발편이 없어요. 편명·목적지·공항 코드·항공사로 다시 검색해 보세요.` : "조건에 맞는 출발편이 없어요. 필터를 바꿔 보세요.";
    tb.innerHTML = `<tr><td colspan="9" class="empty">${why}</td></tr>`; $("moreBox").hidden = true;
  } else {
    tb.innerHTML = rows.slice(0, state.limit).map((f) => {
      const cls = f.cx ? "cx" : f.dly ? "dl" : f.sg === "departed" ? "gone" : "";
      const changed = f.e && f.e !== f.t && !f.cx;
      const d = !f.cx && f.dl ? (f.dl > 0 ? `<span class="dly ${f.dl >= 15 ? "late" : ""}">+${f.dl}분</span>` : `<span class="dly early">${f.dl}분 (일찍)</span>`) : "";
      const viaCs = q && q.length >= 3 && f.cs.some((c) => c.startsWith(q)) && !f.id.startsWith(q) ? `<span class="hit">검색한 ${esc(f.cs.find((c) => c.startsWith(q)))} → 실제 운항편</span>` : "";
      const watched = watchMatch(f);
      const w = wx(f.dc);
      return `<tr class="${cls}" data-key="${esc(fKey(f))}" tabindex="0" aria-label="${esc(f.id)} ${esc(f.dn)} ${f.t} ${esc(statusText(f))}">
        <td><button class="star" type="button" data-star="${esc(f.id)}" aria-pressed="${watched}" aria-label="${esc(f.id)} 내 출장 편${watched ? "에서 빼기" : "에 담기"}">${watched ? "★" : "☆"}</button></td>
        <td class="t">${f.t}</td><td class="t ${changed ? "chg" : ""}">${changed ? esc(estLabel(f)) : ""}</td>
        <td><span class="fid">${esc(f.id)}</span><div class="al">${esc(f.al)}</div>${f.cs.length ? `<div class="cs">${esc(f.cs.join(" · "))}</div>` : ""}${viaCs}</td>
        <td>${esc(f.dn)}<span class="code">${esc(f.dc)}</span></td>
        <td>${esc(TERM_SHORT[f.tm] || f.tm)}${f.tm === "P02" ? ' <span class="fine">셔틀</span>' : ""}<div class="fine">${esc(f.ci || "")}${f.g ? " · 탑승구 " + esc(f.g) : ""}</div></td>
        <td>${pill(f)}${d}</td><td class="rec">${recCell(f)}</td>
        <td>${!w || w[1] == null ? '<span class="fine">관측값 없음</span>' : `${Math.round(w[1])}° <span class="fine">습도 ${w[3] ?? "-"}%</span>`}</td></tr>`;
    }).join("");
    const left = rows.length - state.limit;
    $("moreBox").hidden = left <= 0; if (left > 0) $("moreBtn").textContent = `${fmt(Math.min(60, left))}편 더 보기 (남은 ${fmt(left)}편)`;
  }
  $("clearAll").hidden = !(state.term || state.airline || state.status || state.q);
  $("fSort").value = state.sort;
  renderOps();
}
// Status-first summary above the dense table: chips (filter shortcuts) + flights that need attention.
function renderOps() {
  const d = day(), all = state.board.flights.filter((f) => f.d === d);
  const chips = [["", "전체", "all"], ["issue", "지연 · 결항", "late"], ["before", "출발 전", "plain"], ["boarding", "탑승 관련", "board"], ["departed", "출발 완료", "ok"]];
  $("statusChips").innerHTML = chips.map(([v, lab, ic]) => `<button class="chip" type="button" data-status="${v}" aria-pressed="${state.status === v}">${ICON[ic]}${lab} <b>${fmt(all.filter((f) => statusMatch(f, v)).length)}</b></button>`).join("");
  const now = nowMs(), isToday = d === boardDays()[0];
  const watch = all.filter((f) => (f.dly || f.cx) && f.sg !== "departed" && (!isToday || depMs(f) >= now - 30 * 60000)).sort((a, b) => depMs(a) - depMs(b));
  const box = $("opsPreview");
  if (!all.length) { box.innerHTML = ""; return; }
  if (d < boardDays()[0]) { box.innerHTML = `<p class="fine" style="grid-column:1/-1">지난 날짜라 모든 편이 출발했거나 결항됐어요. 지연·결항 편은 위 '지연 · 결항' 버튼으로 모아 볼 수 있어요.</p>`; return; }
  if (!watch.length) { box.innerHTML = `<div class="ops-ok" style="grid-column:1/-1">${ICON.ok}출발 전인 편 중 지연 · 결항으로 표시된 편이 없어요. (${esc(dayLabel(d))} · 운항 자료 ${esc(stamp(flightsAt()).slice(6))} 기준)</div>`; return; }
  box.innerHTML = `<p class="fine" style="grid-column:1/-1">주의가 필요한 출발 전 편 · 출발 시각순 ${watch.length > 8 ? `(8편 / 전체 ${watch.length}편)` : `(${watch.length}편)`}</p>` +
    watch.slice(0, 8).map((f) => `<button class="wl ${f.cx ? "cx" : ""}" type="button" data-open="${esc(fKey(f))}"><span class="t">${f.cx ? f.t : esc(estLabel(f))}<small>${f.cx ? "결항" : f.dl > 0 ? `+${f.dl}분` : "지연"}</small></span><span class="i">${esc(f.id)} · ${esc(f.dn)}</span><span class="d">${esc(f.al)} · ${esc(TERM_SHORT[f.tm] || f.tm)} · 예정 ${f.t}</span>${pill(f)}</button>`).join("");
}
function renderFilters() {
  const seg = $("termSeg"); seg.textContent = "";
  for (const [v, lab] of [["", "전체"], ["P01", "T1"], ["P02", "탑승동"], ["P03", "T2"]]) {
    const b = document.createElement("button"); b.type = "button"; b.textContent = lab; b.setAttribute("aria-pressed", String(state.term === v));
    b.onclick = () => { state.term = v; state.limit = 60; renderFilters(); renderFlights(); renderWeather(); }; seg.append(b);
  }
  const counts = {}; state.board.flights.forEach((f) => { if (f.d === day()) counts[f.al] = (counts[f.al] || 0) + 1; });
  $("fAirline").innerHTML = `<option value="">항공사 전체</option>` + Object.keys(counts).sort((a, b) => a.localeCompare(b, "ko")).map((a) => `<option value="${esc(a)}">${esc(a)} (${counts[a]})</option>`).join("");
  $("fAirline").value = state.airline; $("fStatus").value = state.status; $("fSearch").value = state.q;
}

// ---------- trends
function renderTrends() {
  const t = state.trends, box = $("trendBox"), seg = $("trendSeg");
  seg.textContent = "";
  if (!t) return;
  if (!t.available) {
    $("trendCap").textContent = "지난 3일 운항 자료를 받지 못했어요.";
    box.innerHTML = `<div class="panel tr-sum" style="grid-column:1/-1"><b>지연 분석을 보여줄 수 없어요</b><span class="fine">${t.reason === "NO_KEY" ? "서버에 인증키가 설정되면 지난 3일 출발편으로 시간대·항공사·목적지별 지연을 집계해요. 샘플 자료에는 지난 날짜가 없어요." : "공공데이터 API 연결이 원활하지 않아요. 30분마다 다시 시도해요."}</span></div>`;
    return;
  }
  const days = t.days;
  $("trendCap").textContent = `${dayLabel(days[0])} ~ ${dayLabel(days[days.length - 1])} 인천 출발편 · 출발 예정 시각 1시간 단위 집계 · 지난 자료이며 예측이 아니에요`;
  for (const [v, lab] of [["airlines", "항공사별"], ["destinations", "목적지별"]]) {
    const b = document.createElement("button"); b.type = "button"; b.textContent = lab; b.setAttribute("aria-pressed", String(state.trendBy === v));
    b.onclick = () => { state.trendBy = v; renderTrends(); }; seg.append(b);
  }
  if (!state.trendDay || (state.trendDay !== "all" && !days.includes(state.trendDay))) state.trendDay = "all";
  const byDay = t.byDay || [];
  const pickDays = state.trendDay === "all" ? byDay : byDay.filter((x) => x.day === state.trendDay);
  const hours = Array.from({ length: 24 }, (_, h) => pickDays.reduce((a, x) => { const c = x.hours[h] || {}; a.total += c.total || 0; a.delayed += c.delayed || 0; a.cancelled += c.cancelled || 0; return a; }, { total: 0, delayed: 0, cancelled: 0 }));
  const sum = hours.reduce((a, c) => ({ total: a.total + c.total, delayed: a.delayed + c.delayed, cancelled: a.cancelled + c.cancelled }), { total: 0, delayed: 0, cancelled: 0 });
  const maxT = Math.max(1, ...hours.map((c) => c.total));
  let top = -1, topBad = 0;
  hours.forEach((c, h) => { const bad = c.delayed + c.cancelled; if (c.total >= 5 && bad > topBad) { topBad = bad; top = h; } });
  const scope = state.trendDay === "all" ? `지난 3일` : dayLabel(state.trendDay);
  const daySeg = `<div class="seg" role="group" aria-label="집계 날짜">${[["all", "3일 합계"], ...days.map((x) => [x, dayLabel(x)])].map(([v, lab]) => `<button type="button" data-tday="${v}" aria-pressed="${state.trendDay === v}">${esc(lab)}</button>`).join("")}</div>`;
  const rate = sum.total ? Math.round(((sum.delayed + sum.cancelled) / sum.total) * 100) : 0;
  const bars = hours.map((c, h) => {
    const th = Math.round((c.total / maxT) * 100), dl = c.total ? (c.delayed / c.total) * 100 : 0, cx = c.total ? (c.cancelled / c.total) * 100 : 0;
    const lab = `${hh(h)}시 출발 예정 ${c.total}편 중 지연 ${c.delayed}편, 결항 ${c.cancelled}편`;
    return `<button class="hbar${h === top ? " top" : ""}" type="button" aria-label="${lab}" data-tip="${hh(h)}~${hh((h + 1) % 24)}시 출발 예정 <b>${c.total}편</b><br>지연 ${c.delayed}편 · 결항 ${c.cancelled}편"><span class="tot" style="height:${Math.max(c.total ? 2 : 0, th)}%"><span class="bad c" style="height:${cx}%"></span><span class="bad" style="height:${dl}%"></span></span></button>`;
  }).join("");
  const insight = top >= 0
    ? `${scope} 출발 예정 시각 기준으로 지연·결항이 가장 많았던 시간대는 <b>${hh(top)}시</b>예요 — ${hours[top].total}편 중 ${topBad}편. 지난 자료 집계이며 앞으로의 지연을 예측하지 않아요.`
    : `${scope}에는 5편 이상 출발한 시간대 중 지연·결항 편이 없어요.`;
  const list = t[state.trendBy].slice(0, 8);
  const maxRate = Math.max(0.01, ...list.map((g) => g.rate));
  box.innerHTML = `<div class="panel tr-chart">
      <div class="tr-chart-h"><div class="tr-nums">
        <div><span>${esc(scope)} 출발편</span><b>${fmt(sum.total)}<small>편</small></b></div>
        <div><span>지연</span><b style="color:var(--late)">${fmt(sum.delayed)}<small>편</small></b></div>
        <div><span>결항</span><b style="color:var(--cx)">${fmt(sum.cancelled)}<small>편</small></b></div>
        <div><span>지연·결항 비율 <span class="calc">자체 계산</span></span><b>${rate}<small>%</small></b></div></div>${daySeg}</div>
      <div><div class="hbars" role="group" aria-label="${esc(scope)} 출발 시간대별 편수와 지연·결항">${bars}</div>
        <div class="hax" aria-hidden="true">${hours.map((_, h) => `<span>${hh(h)}</span>`).join("")}</div></div>
      <div class="chart-legend"><span><i style="background:var(--surface-3)"></i>출발 예정 편수</span><span><i style="background:var(--late)"></i>지연</span><span><i style="background:var(--cx)"></i>결항</span><span><i style="background:transparent;box-shadow:0 0 0 2px var(--ink)"></i>지연·결항 최다 시간대 (5편 이상)</span></div>
      <p class="insight">${ICON.bulb}<span>${insight}</span></p>
      <p class="fine">자료 ${esc(stamp(t.at))} · 6시간마다 새로 받아요 · 지연 = 15분 이상 늦거나 '지연' 표시</p>
    </div>
    <div class="panel tr-side"><div class="tr-side-h"><h3>${state.trendBy === "airlines" ? "항공사별" : "목적지별"} 지연·결항 비율</h3><span class="fine">3일 · 5편 이상</span></div>
      ${list.map((g) => `<div class="tr-row"><span class="tr-name" title="${esc(g.label)}">${esc(g.label)}${state.trendBy === "destinations" ? `<span class="code">${esc(g.key)}</span>` : ""}</span>
        <span class="tr-bar" aria-hidden="true"><i class="${g.rate >= 0.3 ? "warn" : ""}" style="width:${Math.round((g.rate / maxRate) * 100)}%"></i></span>
        <span class="tr-v"><b>${Math.round(g.rate * 100)}%</b> · ${g.n}편 · 평균 ${g.avgDelay}분</span></div>`).join("") || '<p class="empty">5편 이상 운항한 곳이 없어요.</p>'}
      <p class="fine">평균 = 결항을 뺀 편의 평균 늦어진 시간 (자체 계산)</p></div>`;
  box.querySelectorAll("[data-tday]").forEach((b) => { b.onclick = () => { state.trendDay = b.dataset.tday; renderTrends(); }; });
  box.querySelectorAll(".hbar").forEach((el) => { el.onpointerenter = (e) => showTip(e, el.dataset.tip); el.onpointermove = moveTip; el.onpointerleave = hideTip; el.onfocus = () => { const r = el.getBoundingClientRect(); showTip({ clientX: r.right, clientY: r.top }, el.dataset.tip); }; el.onblur = hideTip; });
}
const trendOf = (kind, key) => state.trends?.available ? state.trends[kind].find((g) => g.key === key) : null;

// ---------- weather
function renderWeather() {
  const byDest = new Map();
  for (const f of filtered()) { const e = byDest.get(f.dc) || { n: 0, name: f.dn }; e.n++; byDest.set(f.dc, e); }
  const list = [...byDest.entries()].sort((a, b) => b[1].n - a[1].n || a[0].localeCompare(b[0]));
  const at = state.board.meta.sources.weather?.at, src = state.board.meta.sources.weather?.status;
  $("wxSub").textContent = `현재 관측값 · 예보 아님 · 날씨 자료 ${at ? stamp(at).slice(6) : "-"} 수신 (KST)${src === "sample" ? " · 샘플 자료" : ""} · 운항 현황 조건에 맞는 목적지, 편 수가 많은 순`;
  $("wx").innerHTML = list.slice(0, state.wxLimit).map(([code, e]) => {
    const w = wx(code);
    const foot = `<div class="dt"><span>${esc(dayLabel(day()))} 출발 ${e.n}편</span><span>관측 자료 ${at ? esc(stamp(at).slice(6)) : "-"}</span></div>`;
    if (!w || w[1] == null) return `<div class="wxcard na"><div class="nm"><span>${esc(e.name)}</span><span class="code">${esc(code)}</span></div><div class="tp">관측값 없음</div><p class="fine">공항 자료에 이 목적지 값이 비어 있어요.</p>${foot}</div>`;
    return `<div class="wxcard"><div class="nm"><span>${esc(w[0] || e.name)}</span><span class="code">${esc(code)}</span></div>
      <div class="tp">${Math.round(w[1])}°<small>현재 관측</small></div>
      <dl><dt>체감</dt><dd>${w[2] == null ? "-" : Math.round(w[2]) + "°"}</dd><dt>습도</dt><dd>${w[3] ?? "-"}%</dd><dt>바람</dt><dd>${w[4] ?? "-"}m/s</dd></dl>${foot}</div>`;
  }).join("") || `<p class="empty">조건에 맞는 목적지가 없어요. 운항 현황 필터를 바꿔 보세요.</p>`;
  const left = list.length - state.wxLimit;
  $("wxMoreBox").hidden = left <= 0; if (left > 0) $("wxMore").textContent = `목적지 ${left}곳 더 보기`;
}

// ---------- drawer: flight planner
function findByKey(k) { return state.board?.flights.find((f) => fKey(f) === k); }
function openDrawer(k) {
  const f = findByKey(k); if (!f) return;
  state.openKey = k;
  renderDrawer(f);
  $("scrim").hidden = false;
  const d = $("drawer"); d.classList.add("open"); d.setAttribute("aria-hidden", "false");
  $("dClose").focus();
}
function closeDrawer() {
  state.openKey = null; $("scrim").hidden = true;
  const d = $("drawer"); d.classList.remove("open"); d.setAttribute("aria-hidden", "true");
}
function tItem(ms, f, title, note, cls = "") {
  const dshift = dayOf(ms) !== f.d ? (dayOf(ms) < f.d ? "전날" : "다음날") : "";
  return `<li class="${cls}"><span class="tt">${hmOf(ms)}${dshift ? `<small>${dshift}</small>` : ""}</span><span class="dot"></span><span class="tl"><b>${title}</b><span>${note}</span></span></li>`;
}
function summaryText(f, r) {
  const parts = [`[출장 체크] ${f.id} 인천→${f.dn}(${f.dc})`, `${dayLabel(f.d)} 예정 ${f.t}${f.e && f.e !== f.t && !f.cx ? ` → 변경 ${estLabel(f)}` : ""}`, `상태 ${statusText(f)}${f.dl > 0 && !f.cx ? ` (${f.dl}분 늦음)` : ""}`,
    `${TERM_LABEL[f.tm] || f.tm}${f.ci ? ` · 체크인 ${f.ci}` : ""}${f.g ? ` · 탑승구 ${f.g}` : ""}`];
  if (r) parts.push(`권장 공항 도착 ${r.time}${r.prevDay ? "(전날)" : ""}${r.hall ? ` · ${r.group} ${r.hall}번 출국장` : ""}`);
  if (f.cs.length) parts.push(`공동운항 ${f.cs.join(", ")}`);
  parts.push(DISCLAIMER);
  return parts.join("\n");
}
function renderDrawer(f) {
  const r = recommend(f), dep = depMs(f), w = wx(f.dc);
  const q = state.q.trim().toUpperCase();
  $("dEyebrow").textContent = `${dayLabel(f.d)} · ${TERM_LABEL[f.tm] || f.tm}`;
  $("dTitle").textContent = `${f.id} · ${f.dn}`;
  $("dSub").textContent = `${f.al}${f.cs.length ? ` · 공동운항 ${f.cs.join(", ")}` : ""}`;
  const callouts = [];
  if (f.cx) callouts.push(`<div class="d-callout warn"><b>결항된 편이에요.</b> 대체편과 환불은 항공사 안내를 확인해 주세요.</div>`);
  else if (f.dly) callouts.push(`<div class="d-callout warn"><b>${f.dl > 0 ? `${f.dl}분 늦어졌어요.` : "지연 안내가 있어요."}</b> 변경 시각 ${esc(estLabel(f))} 기준으로 일정을 다시 잡아 보세요.</div>`);
  const viaCs = f.cs.find((c) => q && c.startsWith(q));
  if (viaCs || f.cs.length) callouts.push(`<div class="d-callout">${viaCs ? `<b>${esc(viaCs)}</b>은(는) ` : "이 편은 "}<b>${esc(f.al)} ${esc(f.id)}</b>${viaCs ? "의 공동운항 편명이에요." : "이 실제로 운항해요."} 수속은 <b>${esc(TERM_LABEL[f.tm] || f.tm)}</b>${f.tm === "P02" ? "(제1터미널에서 수속 후 셔틀트레인으로 이동)" : ""}에서 해요.</div>`);
  else if (f.tm === "P02") callouts.push(`<div class="d-callout">탑승동 출발편이에요. 제1터미널에서 수속한 뒤 셔틀트레인으로 이동해요.</div>`);

  const travel = state.travel;
  let tl = "";
  if (!f.cx) {
    const arrive = r ? r.ms : dep - 150 * 60000;
    tl = `<ol class="timeline">
      ${tItem(arrive - travel * 60000, f, "집 · 회사에서 출발", `공항까지 ${travel}분 기준`)}
      ${tItem(arrive, f, "공항 도착 권장", r && r.hall ? `${r.group} ${r.hall}번 출국장 · ${LV_TEXT[r.lv]}${r.busy ? " · 혼잡해서 30분 일찍" : ""}` : "출국장 예고 없음 · 출발 2시간 30분 전 기준", "key")}
      ${tItem(dep - 60 * 60000, f, "체크인 · 수하물 마감 무렵", `일반적으로 출발 60분 전${f.ci ? ` · 카운터 ${esc(f.ci)}` : ""}`)}
      ${tItem(dep - 40 * 60000, f, "탑승 시작 무렵", `일반적으로 출발 40분 전${f.g ? ` · 탑승구 ${esc(f.g)}` : ""}`)}
      ${tItem(dep, f, f.e && f.e !== f.t ? "출발 (변경 시각)" : "출발", `${esc(f.dn)} ${esc(f.dc)}행`, "dep")}
    </ol>`;
  }
  const trA = trendOf("airlines", f.al), trD = trendOf("destinations", f.dc);
  const trendHtml = state.trends?.available
    ? `<div class="d-facts"><div><span>${esc(f.al)} 지난 3일</span><b>${trA ? `지연·결항 ${Math.round(trA.rate * 100)}% · ${trA.n}편` : "5편 미만"}</b></div><div><span>${esc(f.dn)}행 지난 3일</span><b>${trD ? `지연·결항 ${Math.round(trD.rate * 100)}% · ${trD.n}편` : "5편 미만"}</b></div></div>`
    : `<p class="fine">지난 3일 자료가 없어 지연 경향을 보여줄 수 없어요.</p>`;

  $("dBody").innerHTML = `
    <div class="d-status">${pill(f)}<span class="fine">예정 ${f.t}${f.e && f.e !== f.t && !f.cx ? ` → 변경 ${esc(estLabel(f))}` : ""}</span></div>
    ${callouts.join("")}
    <div class="d-facts">
      <div><span>터미널</span><b>${esc(TERM_LABEL[f.tm] || f.tm)}</b></div>
      <div><span>체크인 카운터</span><b>${esc(f.ci || "-")}</b></div>
      <div><span>탑승구</span><b>${esc(f.g || "-")}</b></div>
      <div><span>권장 도착</span><b>${r ? `${r.time}${r.prevDay ? " (전날)" : ""}` : "-"}</b></div>
    </div>
    ${f.cx ? "" : `<div class="d-block"><h3>출발 플래너</h3>
      <div class="travel"><label for="travelSel">공항까지 이동 시간</label><select id="travelSel">${[30, 45, 60, 75, 90, 120].map((m) => `<option value="${m}" ${m === travel ? "selected" : ""}>${m}분</option>`).join("")}</select></div>
      ${tl}<p class="fine">체크인 마감·탑승 시작은 일반적인 기준이에요. 항공사 안내가 우선이에요.</p></div>`}
    <div class="d-block"><h3>목적지 날씨 · 현재 관측</h3>
      <div class="d-facts"><div><span>${esc(f.dn)}</span><b>${w && w[1] != null ? `${Math.round(w[1])}°${w[2] != null ? ` (체감 ${Math.round(w[2])}°)` : ""}` : "관측값 없음"}</b></div><div><span>습도 · 바람</span><b>${w && w[1] != null ? `${w[3] ?? "-"}% · ${w[4] ?? "-"}m/s` : "-"}</b></div></div></div>
    <div class="d-block"><h3>최근 3일 지연 경향</h3>${trendHtml}</div>
    <div class="d-actions">
      <button class="btn primary" type="button" id="dWatch">${watchMatch(f) ? "내 출장 편에서 빼기" : "내 출장 편에 담기"}</button>
      <button class="btn" type="button" id="dCopy">요약 복사</button>
    </div>
    <p class="fine">${DISCLAIMER}</p>`;
  $("travelSel")?.addEventListener("change", (e) => { state.travel = Number(e.target.value); store.set("icn.travel", state.travel); renderDrawer(f); });
  $("dWatch").onclick = () => { const on = !watchMatch(f); if (on) toggleWatch(f.id, true); else f.q.split(" ").forEach((a) => toggleWatch(a, false)); checkWatchChanges(); renderMine(); renderFlights(); renderDrawer(f); toast(on ? `${f.id}을(를) 내 출장 편에 담았어요` : `${f.id}을(를) 뺐어요`); };
  $("dCopy").onclick = () => copy(summaryText(f, r));
}
async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast("요약을 복사했어요. 메신저에 붙여 넣으세요."); }
  catch (e) {
    const ta = Object.assign(document.createElement("textarea"), { value: text }); document.body.append(ta); ta.select();
    try { document.execCommand("copy"); toast("요약을 복사했어요."); } catch (e2) { toast("복사하지 못했어요. 직접 선택해 복사해 주세요."); }
    ta.remove();
  }
}

// ---------- render all + wiring
function renderAll(animate) {
  renderHeader(); renderKpis(animate); renderMine(); renderStrip(animate); renderSetter(); renderFilters(); renderFlights(); renderTrends(); renderWeather();
  if (state.openKey) { const f = findByKey(state.openKey); if (f) renderDrawer(f); else closeDrawer(); }
}

$("refreshBtn").onclick = () => loadBoard({ manual: true });
$("aiBtn").onclick = runAi;
$("calBtn").onclick = () => { const c = $("calInput"); try { c.showPicker(); } catch (e) { c.focus(); c.click(); } };
$("calInput").onchange = (e) => pickDate(e.target.value);
$("thMid").oninput = () => onTh("mid"); $("thHigh").oninput = () => onTh("high");
$("thReset").onclick = () => { state.th = null; store.set("icn.th", null); renderSetter(); renderStrip(false); renderFlights(); renderMine(); };
$("cardAirline").onchange = (e) => { state.cardAirline = e.target.value; renderCard(); drawLink(); };
$("fAirline").onchange = (e) => { state.airline = e.target.value; state.limit = 60; renderFlights(); renderWeather(); };
$("fStatus").onchange = (e) => { state.status = e.target.value; state.limit = 60; renderFlights(); renderWeather(); };
$("fSort").onchange = (e) => { state.sort = e.target.value; renderFlights(); };
$("statusChips").addEventListener("click", (e) => { const b = e.target.closest("[data-status]"); if (!b) return; state.status = b.dataset.status; state.limit = 60; $("fStatus").value = state.status; renderFlights(); renderWeather(); });
$("opsPreview").addEventListener("click", (e) => { const b = e.target.closest("[data-open]"); if (b) openDrawer(b.dataset.open); });
$("tbody").addEventListener("keydown", (e) => { if (e.key !== "Enter" && e.key !== " ") return; const tr = e.target.closest("tr[data-key]"); if (tr && e.target === tr) { e.preventDefault(); openDrawer(tr.dataset.key); } });
$("menuBtn").onclick = () => { const open = !$("gnav").classList.contains("open"); $("gnav").classList.toggle("open", open); $("menuBtn").setAttribute("aria-expanded", String(open)); $("menuBtn").setAttribute("aria-label", open ? "메뉴 닫기" : "메뉴 열기"); };
$("gnav").addEventListener("click", (e) => { if (e.target.closest("a")) { $("gnav").classList.remove("open"); $("menuBtn").setAttribute("aria-expanded", "false"); } });
if (window.IntersectionObserver) {
  const links = [...document.querySelectorAll("#gnav a")];
  const io = new IntersectionObserver((ents) => { for (const en of ents) if (en.isIntersecting) links.forEach((a) => a.setAttribute("aria-current", String(a.getAttribute("href") === "#" + en.target.id))); }, { rootMargin: "-45% 0px -50% 0px" });
  links.forEach((a) => { const t = document.querySelector(a.getAttribute("href")); if (t) io.observe(t); });
}
let qT; $("fSearch").oninput = (e) => { clearTimeout(qT); qT = setTimeout(() => { state.q = e.target.value; state.limit = 60; renderFlights(); renderWeather(); }, 140); };
$("clearAll").onclick = () => { Object.assign(state, { term: "", airline: "", status: "", q: "", limit: 60 }); renderFilters(); renderFlights(); renderWeather(); };
$("moreBtn").onclick = () => { state.limit += 60; renderFlights(); };
$("wxMore").onclick = () => { state.wxLimit += 12; renderWeather(); };
$("stripBox").addEventListener("scroll", drawLink, { passive: true });
$("dClose").onclick = closeDrawer; $("scrim").onclick = closeDrawer;
addEventListener("keydown", (e) => { if (e.key === "Escape" && state.openKey) closeDrawer(); });
let rT; addEventListener("resize", () => { clearTimeout(rT); rT = setTimeout(() => { if (state.board) { renderSetter(); drawLink(); } }, 120); });
if (window.ResizeObserver) new ResizeObserver(drawLink).observe($("hourview"));

$("tbody").addEventListener("click", (e) => {
  const star = e.target.closest("[data-star]");
  if (star) {
    e.stopPropagation();
    const f = findByKey(star.closest("tr").dataset.key);
    const on = star.getAttribute("aria-pressed") !== "true";
    if (on) toggleWatch(f.id, true); else f.q.split(" ").forEach((a) => toggleWatch(a, false));
    checkWatchChanges(); renderMine(); renderFlights();
    toast(on ? `${f.id}을(를) 내 출장 편에 담았어요` : `${f.id}을(를) 뺐어요`);
    return;
  }
  const tr = e.target.closest("tr[data-key]"); if (tr) openDrawer(tr.dataset.key);
});
$("miniBody").addEventListener("click", (e) => { const tr = e.target.closest("tr[data-key]"); if (tr) openDrawer(tr.dataset.key); });
$("mineList").addEventListener("click", (e) => {
  const un = e.target.closest("[data-unwatch]");
  if (un) { e.stopPropagation(); const f = state.board.flights.find((x) => x.q.split(" ").includes(un.dataset.unwatch)); (f ? f.q.split(" ") : [un.dataset.unwatch]).forEach((a) => toggleWatch(a, false)); renderMine(); renderFlights(); return; }
  const op = e.target.closest("[data-open]"); if (op) { openDrawer(op.dataset.open); return; }
  if (e.target.closest("[data-focus-add]")) { scrollTo({ top: 0, behavior: REDUCED ? "auto" : "smooth" }); $("addInput").focus({ preventScroll: true }); return; }
  if (e.target.closest("select")) return;
  const card = e.target.closest(".mf[data-key]"); if (card) openDrawer(card.dataset.key);
});
$("mineList").addEventListener("change", (e) => { if (e.target.matches("[data-travel]")) { state.travel = Number(e.target.value); store.set("icn.travel", state.travel); renderMine(); } });
$("mineList").addEventListener("keydown", (e) => { if (e.key === "Enter") { const card = e.target.closest(".mf[data-key]"); if (card) openDrawer(card.dataset.key); } });
$("addForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const id = $("addInput").value.trim().toUpperCase().replace(/\s+/g, "");
  if (!/^[A-Z0-9]{2}\d{1,5}[A-Z]?$/.test(id)) { toast("편명 형식을 확인해 주세요. 예: KE017, OZ6783"); return; }
  const hit = state.board?.flights.find((f) => f.q.split(" ").includes(id));
  toggleWatch(id, true);
  $("addInput").value = "";
  checkWatchChanges(); renderMine(); renderFlights();
  const viaCs = hit && hit.id.replace(/Y$/, "") !== id;
  toast(hit ? (viaCs ? `${id}은(는) ${hit.al} ${hit.id.replace(/Y$/, "")} 공동운항이에요. 실제 운항편으로 보여드려요.` : `${id}을(를) 담았어요`) : `${id}은(는) 오늘·내일 출발편에 없어요. 목록에 남겨 둘게요.`);
});

loadBoard();
loadTrends();
setInterval(() => { if (document.visibilityState === "visible") loadBoard(); }, REFRESH_MS);
setInterval(() => { if (document.visibilityState === "visible") loadTrends(); }, 30 * 60 * 1000);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && state.board && Date.now() - Date.parse(state.board.meta.generatedAt) > REFRESH_MS) loadBoard();
});
