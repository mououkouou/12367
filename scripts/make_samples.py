"""Build the fallback data in data/samples/ from the latest raw collection (data/raw).

Output (no service key, no URLs):
  data/samples/departures.json  {collectedAt, days: {YYYYMMDD: rows[]}}
  data/samples/passenger.json   {collectedAt, days: {YYYYMMDD: rows[]}}
  data/samples/weather.json     {collectedAt, items: rows[]}
"""
from __future__ import annotations

import json
import re
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
OUT = ROOT / "data" / "samples"


def main() -> None:
    manifest = sorted(RAW.glob("*/*_manifest.json"))[-1]
    prefix = manifest.name.split("_")[0]
    meta = json.loads(manifest.read_text(encoding="utf-8"))
    collected = {s["api"]: s["collected_at"] for s in meta["sources"]}

    groups: dict = defaultdict(lambda: defaultdict(list))
    for p in sorted(manifest.parent.glob(f"{prefix}_*_p*.json")):
        m = re.match(rf"{prefix}_(\w+?)_(\d{{8}})_p(\d+)\.json$", p.name)
        if not m:
            continue
        body = json.loads(p.read_text(encoding="utf-8"))["response"]["body"]
        items = body.get("items") or []
        if isinstance(items, dict):
            items = items.get("item") or []
        groups[m.group(1)][m.group(2)].extend(items)

    files = {
        "departures.json": {"collectedAt": collected.get("flights"), "days": dict(groups["flights"])},
        "passenger.json": {"collectedAt": collected.get("passenger"), "days": dict(groups["passenger"])},
        "weather.json": {"collectedAt": collected.get("weather"),
                         "items": [r for rows in groups["weather"].values() for r in rows]},
    }
    for name, data in files.items():
        text = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
        if re.search(r"serviceKey|apis\.data\.go\.kr", text):
            raise SystemExit(f"refusing to write {name}: key-like content")
        (OUT / name).write_text(text, encoding="utf-8")
        counts = {k: len(v) for k, v in data.get("days", {}).items()} or len(data.get("items", []))
        print(f"{name}: {counts} ({len(text) // 1024} KB)")


if __name__ == "__main__":
    main()
