"""Independent check of the board numbers against data/raw (does not import collect.py).

Usage: python scripts/verify.py [artifact_html ...]
Prints a JSON report. The service key is only compared, never printed.
"""
from __future__ import annotations

import json
import os
import re
import sys
import urllib.parse
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
HOUR = 14


def latest_run() -> tuple[Path, str]:
    manifests = sorted(RAW.glob("*/*_manifest.json"))
    m = manifests[-1]
    return m.parent, m.name.split("_")[0]


def load_pages(day_dir: Path, prefix: str) -> dict:
    pages = defaultdict(list)  # (api, target) -> [(page, body)]
    for p in sorted(day_dir.glob(f"{prefix}_*_p*.json")):
        m = re.match(rf"{prefix}_(\w+?)_(\d{{8}})_p(\d+)\.json$", p.name)
        if not m:
            continue
        pages[(m.group(1), m.group(2))].append((int(m.group(3)), json.loads(p.read_text(encoding="utf-8"))))
    return pages


def items(body: dict) -> list:
    it = body["response"]["body"].get("items") or []
    if isinstance(it, dict):
        it = it.get("item") or []
    return it if isinstance(it, list) else [it]


def embedded(html_path: Path) -> dict:
    text = html_path.read_text(encoding="utf-8")
    m = re.search(r"const DATA = (\{.*?\});\n", text, re.S)
    return json.loads(m.group(1))


def dt(s: str) -> datetime:
    return datetime.strptime(s, "%Y%m%d%H%M")


def main() -> None:
    day_dir, prefix = latest_run()
    pages = load_pages(day_dir, prefix)
    html_paths = [Path(p) for p in sys.argv[1:]] or [ROOT / "output" / "icn-check-board.html"]
    data = embedded(html_paths[0])
    report: dict = {"raw_run": f"{day_dir.name}/{prefix}", "checked_html": [p.name for p in html_paths]}

    # 2) paging complete
    paging = []
    for (api, target), pg in sorted(pages.items()):
        pg.sort()
        totals = {int(b["response"]["body"]["totalCount"]) for _, b in pg}
        got = sum(len(items(b)) for _, b in pg)
        seq_ok = [n for n, _ in pg] == list(range(1, len(pg) + 1))
        rows = [r for _, b in pg for r in items(b)]
        dup = 0
        if api == "flights":
            c = Counter((r.get("fid"), r.get("flightId")) for r in rows)
            dup = sum(v - 1 for v in c.values() if v > 1)
        paging.append({"api": api, "target": target, "totalCount": sorted(totals), "received": got,
                       "pages": len(pg), "pages_sequential": seq_ok, "duplicate_rows": dup,
                       "ok": len(totals) == 1 and got == totals.pop() and seq_ok and dup == 0})
    report["paging"] = paging

    flights_by_day = {d: [] for d in data["meta"]["days"]}
    for f in data["flights"]:
        flights_by_day.setdefault(f["d"], []).append(f)

    # 3) codeshare dedupe
    dedupe = []
    for (api, target), pg in sorted(pages.items()):
        if api != "flights":
            continue
        rows = [r for _, b in pg for r in items(b)]
        day = f"{target[:4]}-{target[4:6]}-{target[6:]}"
        masters = {(r["flightId"], r["scheduleDateTime"]) for r in rows if r.get("codeshare") != "Slave"}
        slaves = [r for r in rows if r.get("codeshare") == "Slave"]
        orphan = {(r["masterflightid"], r["scheduleDateTime"]) for r in slaves} - masters
        expected = len(masters | orphan)
        shown = flights_by_day.get(day, [])
        shown_ids = {(f["id"], f["t"]) for f in shown}
        slave_as_main = sum(1 for r in slaves if (r["flightId"], r["scheduleDateTime"][8:10] + ":" + r["scheduleDateTime"][10:]) in shown_ids)
        cs_listed = {c for f in shown for c in f["cs"]}
        slaves_missing = sum(1 for r in slaves if r["flightId"] not in cs_listed)
        dedupe.append({"day": day, "raw_rows": len(rows), "slave_rows": len(slaves), "expected_flights": expected,
                       "board_flights": len(shown), "slave_shown_as_own_flight": slave_as_main,
                       "slave_not_listed_under_master": slaves_missing,
                       "ok": expected == len(shown) and slave_as_main == 0 and slaves_missing == 0})
    report["codeshare"] = dedupe

    # 1) 14시 departures, delayed, cancelled (raw recount vs embedded data)
    hour = []
    for (api, target), pg in sorted(pages.items()):
        if api != "flights":
            continue
        day = f"{target[:4]}-{target[4:6]}-{target[6:]}"
        rows = [r for _, b in pg for r in items(b)
                if r.get("codeshare") != "Slave" and r["scheduleDateTime"][:8] == target and int(r["scheduleDateTime"][8:10]) == HOUR]
        cx = [r for r in rows if r.get("remark") == "결항"]
        late = [r for r in rows if r.get("remark") != "결항" and (r.get("remark") == "지연" or
                (r.get("estimatedDateTime") and (dt(r["estimatedDateTime"]) - dt(r["scheduleDateTime"])).total_seconds() >= 15 * 60))]
        board = [f for f in flights_by_day.get(day, []) if int(f["t"][:2]) == HOUR]
        hour.append({"day": day, "raw_flights": len(rows), "board_flights": len(board),
                     "raw_delayed": len(late), "board_delayed": sum(1 for f in board if f["dly"] and not f["cx"]),
                     "raw_cancelled": len(cx), "board_cancelled": sum(1 for f in board if f["cx"]),
                     "raw_remark": dict(Counter(r.get("remark") or "(없음)" for r in rows))})
    for h in hour:
        h["ok"] = (h["raw_flights"], h["raw_delayed"], h["raw_cancelled"]) == (h["board_flights"], h["board_delayed"], h["board_cancelled"])
    report[f"hour_{HOUR}"] = hour

    # 4) midnight crossings
    board_by_key = {(f["id"], f["d"], f["t"]): f for f in data["flights"]}
    cross = []
    for (api, target), pg in sorted(pages.items()):
        if api != "flights":
            continue
        for _, b in pg:
            for r in items(b):
                s, e = r.get("scheduleDateTime"), r.get("estimatedDateTime")
                if r.get("codeshare") == "Slave" or not s or not e or s[:8] == e[:8]:
                    continue
                raw_delay = int((dt(e) - dt(s)).total_seconds() // 60)
                naive = (int(e[8:10]) * 60 + int(e[10:])) - (int(s[8:10]) * 60 + int(s[10:]))
                f = board_by_key.get((r["flightId"], f"{s[:4]}-{s[4:6]}-{s[6:8]}", f"{s[8:10]}:{s[10:]}"))
                cross.append({"flight": r["flightId"], "scheduled": s, "estimated": e, "raw_delay_min": raw_delay,
                              "time_only_would_give": naive, "board_delay_min": f["dl"] if f else None,
                              "ok": f is not None and f["dl"] == raw_delay})
    report["midnight"] = cross

    # 5) passenger hourly sum == daily total
    pax = []
    fields = {"T1": [f"t1dg{i}" for i in range(1, 7)] + ["t1dgsum1"], "T2": ["t2dg1", "t2dg2", "t2dgsum2"]}
    for (api, target), pg in sorted(pages.items()):
        if api != "passenger":
            continue
        rows = [r for _, b in pg for r in items(b)]
        hours = [r for r in rows if r.get("atime") != "합계"]
        total = next((r for r in rows if r.get("atime") == "합계"), None)
        day = f"{target[:4]}-{target[4:6]}-{target[6:]}"
        for term, fs in fields.items():
            for fld in fs:
                s = sum(float(r[fld]) for r in hours)
                t = float(total[fld]) if total else None
                pax.append({"day": day, "field": fld, "hours": len(hours), "hour_sum": int(s),
                            "daily_total": int(t) if t is not None else None, "ok": t is not None and int(s) == int(t)})
            board_tot = sum(data["cong"].get(day, {}).get(term, {}).get("tot", []))
            raw_tot = int(float(total[fs[-1]])) if total else None
            pax.append({"day": day, "field": f"board {term} total", "hour_sum": board_tot, "daily_total": raw_tot,
                        "ok": board_tot == raw_tot})
    report["passenger"] = pax

    # 6) key not present
    key = os.environ.get("DATA_GO_KR_KEY", "")
    variants = {v for v in (key, urllib.parse.quote(key, safe=""), urllib.parse.unquote(key)) if len(v) >= 8}
    scan = []
    # this script's own regex text would match the serviceKey pattern, so it is scanned only for the key itself
    targets = html_paths + sorted((ROOT / "data").rglob("*.json")) + sorted((ROOT / "scripts").glob("*")) + [ROOT / "DESIGN.md"]
    me = Path(__file__).resolve()
    for p in targets:
        t = p.read_text(encoding="utf-8", errors="ignore")
        scan.append({"file": p.name, "key_found": any(v in t for v in variants),
                     "serviceKey_param": p.resolve() != me and bool(re.search(r"serviceKey=[^<{$&\s]", t))})
    report["key_scan"] = {"key_available_for_check": bool(variants), "files": len(scan),
                          "files_with_key": [s["file"] for s in scan if s["key_found"]],
                          "files_with_literal_serviceKey_value": [s["file"] for s in scan if s["serviceKey_param"]]}
    # all embedded copies equal?
    if len(html_paths) > 1:
        report["html_data_identical"] = all(embedded(p) == data for p in html_paths[1:])
    print(json.dumps(report, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
