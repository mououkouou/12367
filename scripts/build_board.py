"""Build the check-board page: slim data/summary.json and inject it into the HTML template.

Only screen values go in. No service key, no request URLs, no external image URLs.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SUMMARY = ROOT / "data" / "summary.json"
TEMPLATE = ROOT / "output" / "board.template.html"
OUT = ROOT / "output" / "icn-check-board.html"


def hhmm(iso: str | None) -> str | None:
    return iso[11:16] if iso else None


def main() -> None:
    s = json.loads(SUMMARY.read_text(encoding="utf-8"))

    collected = {}
    for src in s["sources"]:
        collected.setdefault(src["api"], []).append(src["collected_at"])
    meta = {
        "generated": s["generated_at"],
        "collected": {k: max(v) for k, v in collected.items()},
        "days": sorted(s["congestion"].keys()) or sorted(s["daily"].keys()),
    }

    flights = []
    for f in s["flights"]:
        flights.append({
            "d": f["date"], "t": hhmm(f["scheduled"]), "e": hhmm(f["estimated"]),
            "ed": f["estimated"][:10] if f["estimated"] else None,
            "dl": f["delay_min"], "st": f["status"] or "", "sg": f["status_group"],
            "dly": f["is_delayed"], "cx": f["is_cancelled"],
            "id": f["flight_id"], "cs": f["codeshare_flights"], "q": " ".join(f["search"]),
            "al": f["airline"], "dc": f["dest_code"], "dn": f["dest_name"],
            "tm": f["terminal"], "ci": f["checkin"], "g": f["gate"],
        })

    cong = {}
    for day, c in s["congestion"].items():
        out = {}
        for term, t in c["terminals"].items():
            out[term] = {
                "tot": t["total"],
                "halls": {h: v["counts"] for h, v in t["halls"].items() if v["operating"]},
                "off": [h for h, v in t["halls"].items() if not v["operating"]],
            }
        cong[day] = out

    wx = {code: [w["name"], w["temp_c"], w["feels_c"], w["humidity_pct"], w["wind_ms"]]
          for code, w in s["weather"].items()}

    data = {"meta": meta, "flights": flights, "cong": cong, "wx": wx}
    blob = json.dumps(data, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")

    if re.search(r"serviceKey|apis\.data\.go\.kr|https?://", blob):
        raise SystemExit("refusing to build: data contains a URL or key-like field")

    html = TEMPLATE.read_text(encoding="utf-8").replace("/*__BOARD_DATA__*/null", blob)
    OUT.write_text(html, encoding="utf-8")
    print(f"flights={len(flights)} days={meta['days']} wx={len(wx)} -> {OUT.relative_to(ROOT)} "
          f"({OUT.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
