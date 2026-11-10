"""ICN pre-trip check board - data collector.

- Service key comes ONLY from the DATA_GO_KR_KEY environment variable.
  It is never printed, logged, or written to any file (bodies and errors are scrubbed).
- Raw responses  -> data/raw/<YYYYMMDD>/<HHMMSS>_<api>_<target>_p<n>.json
- Run manifest   -> data/raw/<YYYYMMDD>/<HHMMSS>_manifest.json
- Screen values  -> data/summary.json
Standard library only.
"""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

KST = timezone(timedelta(hours=9))
BASE = "https://apis.data.go.kr/B551177"
ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = ROOT / "data" / "raw"
SUMMARY = ROOT / "data" / "summary.json"

FLIGHT_ROWS = 500
WEATHER_ROWS = 500
RETRIES = 3
DELAY_THRESHOLD_MIN = 15          # industry on-time threshold
BASE_BUFFER_MIN = 150             # arrive 2h30m before departure
SHUTTLE_EXTRA_MIN = 15            # P02 concourse shuttle (assumed, adjustable)
BUSY_EXTRA_MIN = 30               # arrive earlier when the best hall is still busy

TERMINALS = {"P01": "제1터미널", "P02": "탑승동", "P03": "제2터미널"}
# P02 passengers check in and pass security at T1.
TERMINAL_HALL_GROUP = {"P01": "T1", "P02": "T1", "P03": "T2"}
HALLS = {
    "T1": {"1": "t1dg1", "2": "t1dg2", "3": "t1dg3", "4": "t1dg4", "5": "t1dg5", "6": "t1dg6"},
    "T2": {"1": "t2dg1", "2": "t2dg2"},
}
HALL_SUM_FIELD = {"T1": "t1dgsum1", "T2": "t2dgsum2"}
EXCLUDED_HALLS = {("T1", "6"): "교통약자 우대 출구(혼잡도 대상 제외)"}
STATUS_GROUP = {
    "출발": "departed", "결항": "cancelled", "지연": "delayed",
    "탑승준비": "boarding", "탑승중": "boarding", "마감예정": "boarding", "탑승마감": "boarding",
}


# ---------------------------------------------------------------- key handling
def load_key() -> tuple[str, str]:
    key = os.environ.get("DATA_GO_KR_KEY", "")
    if not key:
        sys.exit("DATA_GO_KR_KEY is not set.")
    # data.go.kr issues an already-encoded key and a decoded key; encode only the decoded one.
    encoded = key if "%" in key else urllib.parse.quote(key, safe="")
    return key, encoded


KEY, ENC_KEY = load_key()


def scrub(text: str) -> str:
    for secret in (ENC_KEY, KEY, urllib.parse.quote(KEY, safe="")):
        if secret:
            text = text.replace(secret, "<key>")
    return text


# ---------------------------------------------------------------- http + raw save
class Run:
    def __init__(self) -> None:
        self.started = datetime.now(KST)
        self.day_dir = RAW_DIR / self.started.strftime("%Y%m%d")
        self.day_dir.mkdir(parents=True, exist_ok=True)
        self.prefix = self.started.strftime("%H%M%S")
        self.failures: list[dict] = []
        self.stats: list[dict] = []

    def call(self, api: str, path: str, params: dict, target: str, page: int) -> dict | None:
        query = urllib.parse.urlencode(params)
        url = f"{BASE}/{path}?serviceKey={ENC_KEY}&{query}"
        last_err = ""
        for attempt in range(1, RETRIES + 1):
            try:
                with urllib.request.urlopen(url, timeout=30) as resp:
                    body = resp.read().decode("utf-8")
            except (urllib.error.URLError, TimeoutError, ConnectionError) as exc:
                last_err = scrub(f"{type(exc).__name__}: {exc}")
                time.sleep(attempt)
                continue
            body = scrub(body)
            raw_file = self.day_dir / f"{self.prefix}_{api}_{target}_p{page}.json"
            raw_file.write_text(body, encoding="utf-8")
            try:
                data = json.loads(body)
                code = data["response"]["header"]["resultCode"]
            except (json.JSONDecodeError, KeyError, TypeError):
                last_err = "non-JSON or unexpected response: " + body[:200].replace("\n", " ")
                time.sleep(attempt)
                continue
            if code != "00":
                last_err = f"resultCode {code}: {data['response']['header'].get('resultMsg', '')}"
                time.sleep(attempt)
                continue
            return data
        self.failures.append({"api": api, "target": target, "page": page, "error": last_err})
        return None

    def fetch_all(self, api: str, path: str, params: dict, target: str, rows: int) -> list[dict]:
        """Page through until received == totalCount (or a page comes back empty/fails)."""
        items: list[dict] = []
        total = None
        page = 1
        pages_failed = 0
        while True:
            data = self.call(api, path, {**params, "numOfRows": rows, "pageNo": page}, target, page)
            if data is None:
                pages_failed += 1
                if total is None or page * rows >= total:
                    break
                page += 1
                continue
            body = data["response"]["body"]
            total = int(body.get("totalCount") or 0)
            batch = body.get("items") or []
            if isinstance(batch, dict):  # some services wrap as {"item": [...]}
                batch = batch.get("item") or []
            if isinstance(batch, dict):
                batch = [batch]
            items.extend(batch)
            if not batch or len(items) >= total:
                break
            page += 1
        self.stats.append({
            "api": api, "target": target, "total_count": total, "received": len(items),
            "matched": total is not None and len(items) == total,
            "pages": page, "failed_pages": pages_failed,
            "collected_at": datetime.now(KST).isoformat(timespec="seconds"),
        })
        return items


# ---------------------------------------------------------------- helpers
def parse_ts(value: str | None) -> datetime | None:
    if not value or len(value) != 12 or not value.isdigit():
        return None
    return datetime.strptime(value, "%Y%m%d%H%M").replace(tzinfo=KST)


def num(value) -> float | None:
    if value in (None, "", "NA", "-"):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def search_aliases(flight_id: str) -> list[str]:
    aliases = {flight_id}
    if flight_id.endswith("Y") and flight_id[:-1][-1:].isdigit():
        aliases.add(flight_id[:-1])  # e.g. SQ605Y -> SQ605
    return sorted(aliases)


def percentile(sorted_vals: list[float], p: float) -> float:
    if not sorted_vals:
        return 0.0
    k = (len(sorted_vals) - 1) * p
    lo, hi = int(k), min(int(k) + 1, len(sorted_vals) - 1)
    return sorted_vals[lo] + (sorted_vals[hi] - sorted_vals[lo]) * (k - lo)


# ---------------------------------------------------------------- transforms
def build_flights(rows: list[dict]) -> tuple[list[dict], dict]:
    """Collapse codeshare duplicates: one entry per operating (Master) flight."""
    masters: dict[tuple, dict] = {}
    slaves: list[dict] = []
    for r in rows:
        if (r.get("codeshare") or "").lower() == "slave" and r.get("masterflightid"):
            slaves.append(r)
        else:
            key = (r.get("flightId"), r.get("scheduleDateTime"))
            masters.setdefault(key, r)

    flights: dict[tuple, dict] = {}
    for key, r in masters.items():
        flights[key] = make_flight(r)
    orphans = 0
    for s in slaves:
        key = (s["masterflightid"], s.get("scheduleDateTime"))
        if key not in flights:  # operating flight missing from the feed: keep one entry for it
            orphans += 1
            flights[key] = make_flight({**s, "flightId": s["masterflightid"], "codeshare": "Master(inferred)"})
        f = flights[key]
        if s["flightId"] not in f["codeshare_flights"]:
            f["codeshare_flights"].append(s["flightId"])
            f["search"] = sorted(set(f["search"]) | set(search_aliases(s["flightId"])))

    out = sorted(flights.values(), key=lambda f: (f["scheduled"] or "", f["flight_id"]))
    return out, {"rows": len(rows), "operating": len(out), "codeshare_rows": len(slaves), "orphan_codeshare": orphans}


def make_flight(r: dict) -> dict:
    sched = parse_ts(r.get("scheduleDateTime"))
    est = parse_ts(r.get("estimatedDateTime"))
    # Both stamps carry the date, so flights crossing midnight are handled by full datetimes.
    delay = int((est - sched).total_seconds() // 60) if sched and est else None
    remark = (r.get("remark") or "").strip()
    group = STATUS_GROUP.get(remark, "scheduled" if not remark else "other")
    tid = r.get("terminalid") or ""
    return {
        "date": sched.strftime("%Y-%m-%d") if sched else None,
        "flight_id": r.get("flightId"),
        "airline": r.get("airline"),
        "codeshare_flights": [],
        "search": search_aliases(r.get("flightId") or ""),
        "dest_code": r.get("airportCode"),
        "dest_name": r.get("airport"),
        "scheduled": sched.isoformat() if sched else None,
        "estimated": est.isoformat() if est else None,
        "delay_min": delay,
        "status": remark or None,
        "status_group": group,
        "is_delayed": group == "delayed" or (delay is not None and delay >= DELAY_THRESHOLD_MIN and group != "cancelled"),
        "is_cancelled": group == "cancelled",
        "terminal": tid,
        "terminal_name": TERMINALS.get(tid, tid),
        "shuttle_needed": tid == "P02",
        "checkin": r.get("chkinrange") or None,
        "gate": r.get("gatenumber") or None,
        "international": r.get("typeOfFlight") == "I",
        "recommendation": None,
    }


def build_congestion(rows: list[dict], date_key: str, checks: list[dict]) -> dict:
    hours = [r for r in rows if r.get("atime") != "합계"]
    total_row = next((r for r in rows if r.get("atime") == "합계"), None)
    hours.sort(key=lambda r: r["atime"])
    result: dict = {"date": date_key, "hours": [h["atime"].replace("_", "-") for h in hours], "terminals": {}}

    open_values: list[float] = []
    for term, halls in HALLS.items():
        tdata = {"total": [int(num(h.get(HALL_SUM_FIELD[term])) or 0) for h in hours], "halls": {}}
        for hall, field in halls.items():
            series = [int(num(h.get(field)) or 0) for h in hours]
            excluded = EXCLUDED_HALLS.get((term, hall))
            operating = sum(series) > 0 and not excluded
            tdata["halls"][hall] = {"counts": series, "operating": operating, "excluded_reason": excluded}
            if operating:
                open_values.extend(v for v in series if v > 0)
        # integrity: hall sum == terminal sum per hour, and hours sum == 합계 row
        mism = [h["atime"] for h in hours
                if sum(int(num(h.get(f)) or 0) for f in halls.values()) != int(num(h.get(HALL_SUM_FIELD[term])) or 0)]
        tot_ok = None
        if total_row:
            tot_ok = sum(tdata["total"]) == int(num(total_row.get(HALL_SUM_FIELD[term])) or 0)
        checks.append({"check": f"passenger {date_key} {term}", "hour_sum_mismatch": mism, "daily_total_matches": tot_ok})
        result["terminals"][term] = tdata

    vals = sorted(open_values)
    p50, p80 = percentile(vals, 0.5), percentile(vals, 0.8)
    result["thresholds"] = {"basis": "그날 운영 출국장·시간대 예상 인원 분포", "normal_from": round(p50), "busy_from": round(p80)}
    for tdata in result["terminals"].values():
        for hd in tdata["halls"].values():
            hd["levels"] = [
                None if not hd["operating"] else
                ("미운영" if v == 0 else "혼잡" if v >= p80 else "보통" if v >= p50 else "여유")
                for v in hd["counts"]
            ]
    return result


def recommend(flight: dict, congestion_by_date: dict) -> dict | None:
    if not flight["scheduled"] or flight["is_cancelled"]:
        return None
    group = TERMINAL_HALL_GROUP.get(flight["terminal"])
    if not group:
        return None
    dep = datetime.fromisoformat(flight["scheduled"])
    buffer = BASE_BUFFER_MIN + (SHUTTLE_EXTRA_MIN if flight["shuttle_needed"] else 0)
    arrive = dep - timedelta(minutes=buffer)
    cong = congestion_by_date.get(arrive.strftime("%Y-%m-%d"))
    rec = {"arrive_by": arrive.isoformat(), "hall_group": group, "hall": None, "level": None,
           "expected_people": None, "note": None}
    if not cong:
        rec["note"] = "해당 날짜 승객예고 없음"
        return rec
    idx = arrive.hour
    best = None
    for hall, hd in cong["terminals"][group]["halls"].items():
        if not hd["operating"] or hd["counts"][idx] == 0:
            continue
        if best is None or hd["counts"][idx] < best[1]:
            best = (hall, hd["counts"][idx], hd["levels"][idx])
    if best is None:
        rec["note"] = "해당 시간대 운영 출국장 없음"
        return rec
    rec.update(hall=best[0], expected_people=best[1], level=best[2])
    if best[2] == "혼잡":
        rec["arrive_by"] = (arrive - timedelta(minutes=BUSY_EXTRA_MIN)).isoformat()
        rec["note"] = f"가장 한산한 출국장도 혼잡 - {BUSY_EXTRA_MIN}분 일찍"
    return rec


def build_weather(rows: list[dict], observed_at: str) -> dict:
    out: dict[str, dict] = {}
    for r in rows:
        code = r.get("airportCode")
        if not code:
            continue
        cur = out.get(code)
        cand = {
            "name": r.get("airport"), "temp_c": num(r.get("temp")), "feels_c": num(r.get("senstemp")),
            "humidity_pct": num(r.get("himidity")), "wind_ms": num(r.get("wind")),
            "icon": r.get("wimage") or None, "weekday": r.get("yoil") or None,
            "observed_at": observed_at, "kind": "현재 관측(예보 아님)",
        }
        # one row per airport: keep the row with the most observed values
        if cur is None or filled_count(cand) > filled_count(cur):
            out[code] = cand
    return dict(sorted(out.items()))


def filled_count(w: dict) -> int:
    return sum(w[k] is not None for k in ("temp_c", "feels_c", "humidity_pct", "wind_ms"))


# ---------------------------------------------------------------- main
def main() -> None:
    run = Run()
    today = run.started.date()
    days = [today, today + timedelta(days=1)]
    checks: list[dict] = []

    # 1) departures, today + tomorrow, scheduled-time basis, all pages
    flight_rows: list[dict] = []
    for d in days:
        ds = d.strftime("%Y%m%d")
        flight_rows += run.fetch_all(
            "flights", "StatusOfPassengerFlightsDeOdp/getPassengerDeparturesDeOdp",
            {"type": "json", "searchday": ds, "from_time": "0000", "to_time": "2400",
             "inqtimechcd": "S", "lang": "K"},
            ds, FLIGHT_ROWS)

    # 2) passenger forecast, departure halls, today (0) + tomorrow (1)
    congestion: dict[str, dict] = {}
    for sel, d in enumerate(days):
        ds = d.strftime("%Y%m%d")
        rows = run.fetch_all("passenger", "passgrAnncmt/getPassgrAnncmt",
                             {"type": "json", "selectdate": sel}, ds, 30)
        if rows:
            congestion[d.isoformat()] = build_congestion(rows, d.isoformat(), checks)

    # 3) weather for departure destinations (service returns current observations only)
    wx_rows = run.fetch_all("weather", "StatusOfPassengerWorldWeatherInfo/getPassengerDeparturesWorldWeather",
                            {"type": "json", "from_time": "0000", "to_time": "2400", "lang": "K"},
                            today.strftime("%Y%m%d"), WEATHER_ROWS)
    wx_stat = next(s for s in run.stats if s["api"] == "weather")
    weather = build_weather(wx_rows, wx_stat["collected_at"])

    # transforms
    flights, dedupe = build_flights(flight_rows)
    for f in flights:
        f["recommendation"] = recommend(f, congestion)
        f["has_weather"] = f["dest_code"] in weather
    dest_codes = {f["dest_code"] for f in flights if f["dest_code"]}
    weather = {k: v for k, v in weather.items() if k in dest_codes}

    by_day: dict[str, dict] = {}
    for f in flights:
        s = by_day.setdefault(f["date"], {"flights": 0, "delayed": 0, "cancelled": 0, "status": {}})
        s["flights"] += 1
        s["delayed"] += f["is_delayed"]
        s["cancelled"] += f["is_cancelled"]
        key = f["status"] or "(없음)"
        s["status"][key] = s["status"].get(key, 0) + 1

    summary = {
        "generated_at": datetime.now(KST).isoformat(timespec="seconds"),
        "timezone": "Asia/Seoul (+09:00)",
        "rules": {
            "delay_min": "estimated - scheduled (full YYYYMMDDHHmm, so midnight crossings are exact)",
            "delayed_if": f"remark == 지연 or delay_min >= {DELAY_THRESHOLD_MIN}",
            "codeshare": "one entry per operating (Master) flight; marketing numbers in codeshare_flights",
            "arrive_by": f"scheduled - {BASE_BUFFER_MIN}min (+{SHUTTLE_EXTRA_MIN} for P02, "
                         f"+{BUSY_EXTRA_MIN} if best hall is 혼잡)",
            "congestion_levels": "혼잡 >= p80, 보통 >= p50, else 여유, over operating hall-hours of that day",
        },
        "sources": run.stats,
        "failures": run.failures,
        "checks": checks + [{"check": "flight codeshare dedupe", **dedupe}],
        "daily": dict(sorted(by_day.items())),
        "flights": flights,
        "congestion": congestion,
        "weather": weather,
    }
    SUMMARY.write_text(json.dumps(summary, ensure_ascii=False, indent=1), encoding="utf-8")
    manifest = {"started_at": run.started.isoformat(timespec="seconds"), "sources": run.stats,
                "failures": run.failures, "checks": summary["checks"]}
    (run.day_dir / f"{run.prefix}_manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")

    # report (no URLs, no key)
    print("| API | 대상일 | totalCount | 수신 | 일치 | 페이지 | 실패 페이지 | 수집 시각 |")
    print("|---|---|---|---|---|---|---|---|")
    for s in run.stats:
        print(f"| {s['api']} | {s['target']} | {s['total_count']} | {s['received']} | "
              f"{'O' if s['matched'] else 'X'} | {s['pages']} | {s['failed_pages']} | {s['collected_at']} |")
    print(f"\nfailures: {len(run.failures)}")
    for f in run.failures:
        print(f"  - {f['api']} {f['target']} p{f['page']}: {f['error']}")
    print(f"dedupe: {dedupe}")
    print(f"daily: {json.dumps(summary['daily'], ensure_ascii=False)}")
    print(f"weather airports: {len(weather)} / destinations {len(dest_codes)}")
    print(f"checks: {json.dumps(checks, ensure_ascii=False)}")
    print(f"raw dir: {run.day_dir.relative_to(ROOT)}  prefix: {run.prefix}")


if __name__ == "__main__":
    main()
