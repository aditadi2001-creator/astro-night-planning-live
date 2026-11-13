"""Fetch satellite orbit elements from CelesTrak for the site (every 6 hours).

CelesTrak asks clients not to download the same data more than once every two
hours and blocks addresses that do. Browsers therefore never call CelesTrak:
this script (run by the hourly GitHub job) downloads two small groups at most
every 6 hours and writes one JSON file that the data Worker serves from R2.

Usage:
  python orbits.py run --out out/orbits.json [--have-url URL] [--min-age-hours 5.5]

Exits 0 without writing when the published copy is still fresh, and refuses to
write a file that looks wrong (no ISS, too few bright satellites), so the last
good copy in R2 stays in place.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.request
from pathlib import Path

GP = "https://celestrak.org/NORAD/elements/gp.php"
UA = "astro-night-planning-live (github.com/aditadi2001-creator/astro-night-planning-live)"
# Space stations shown by name: ISS (ZARYA), Tiangong (CSS TIANHE).
STATIONS = {25544, 48274}
KEEP = (
    "OBJECT_NAME OBJECT_ID EPOCH MEAN_MOTION ECCENTRICITY INCLINATION RA_OF_ASC_NODE "
    "ARG_OF_PERICENTER MEAN_ANOMALY EPHEMERIS_TYPE CLASSIFICATION_TYPE NORAD_CAT_ID "
    "ELEMENT_SET_NO REV_AT_EPOCH BSTAR MEAN_MOTION_DOT MEAN_MOTION_DDOT"
).split()


def get_json(url: str, timeout: float = 60):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def slim(o: dict) -> dict:
    return {k: o[k] for k in KEEP if k in o}


def build(stations_raw: list, visual_raw: list, now: float) -> dict:
    stations = [slim(o) for o in stations_raw if int(o.get("NORAD_CAT_ID", 0)) in STATIONS]
    bright = [slim(o) for o in visual_raw if "NORAD_CAT_ID" in o and "MEAN_MOTION" in o]
    return {"fetched": int(now * 1000), "source": "CelesTrak", "stations": stations, "bright": bright}


def check(doc: dict) -> str | None:
    """Reason to refuse publishing, or None when the file looks right."""
    if not any(int(o["NORAD_CAT_ID"]) == 25544 for o in doc["stations"]):
        return "ISS missing from the stations group"
    if len(doc["bright"]) < 50:
        return f"only {len(doc['bright'])} bright satellites (expected ~150)"
    return None


def published_age_hours(url: str, now: float) -> float | None:
    try:
        doc = get_json(f"{url}?fresh={int(now)}", timeout=20)
        return (now * 1000 - float(doc["fetched"])) / 3600_000
    except Exception as e:  # missing (404) or unreadable: treat as stale
        print(f"no usable published copy ({e})")
        return None


def cmd_run(args) -> int:
    now = time.time()
    if args.have_url:
        age = published_age_hours(args.have_url, now)
        if age is not None and age < args.min_age_hours:
            print(f"published orbits are {age:.1f} h old (< {args.min_age_hours} h): nothing to do")
            return 0
    stations = get_json(f"{GP}?GROUP=stations&FORMAT=json")
    visual = get_json(f"{GP}?GROUP=visual&FORMAT=json")
    doc = build(stations, visual, now)
    reason = check(doc)
    if reason:
        print(f"REFUSED: {reason}; keeping the last published copy", file=sys.stderr)
        return 1
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(doc, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {out}: {len(doc['stations'])} stations, {len(doc['bright'])} bright, "
          f"{out.stat().st_size / 1000:.0f} kB")
    return 0


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run")
    r.add_argument("--out", required=True)
    r.add_argument("--have-url", default="")
    r.add_argument("--min-age-hours", type=float, default=5.5)
    args = p.parse_args()
    return cmd_run(args)


if __name__ == "__main__":
    sys.exit(main())
