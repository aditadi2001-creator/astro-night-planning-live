"""Build public/skydata/targets.json: imaging targets for the "best tonight" list.

From OpenNGC (CC BY-SA 4.0, Mattia Verga): every Messier object, plus galaxies,
nebulae, planetary nebulae, supernova remnants and clusters that are bright
(V or B ≤ 11.5) and at least 2′ across, or simply large (≥ 15′). Each row:
  [name, common name, kind, ra°, dec°, mag, major′, minor′, surface brightness, constellation]
Surface brightness is OpenNGC's (mag/arcsec²) when given, otherwise estimated
from the magnitude spread over the ellipse.

Usage: python build_targets.py   (reads raw/openngc/*.csv, writes ../../public/skydata/targets.json)
"""
from __future__ import annotations

import csv
import json
import math
from pathlib import Path

HERE = Path(__file__).resolve().parent
RAW = HERE / "raw" / "openngc"
OUT = HERE.parent.parent / "public" / "skydata" / "targets.json"

KIND = {
    "G": "galaxy", "GPair": "galaxy", "GTrpl": "galaxy", "GGroup": "galaxy",
    "PN": "planetary", "SNR": "remnant",
    "EmN": "nebula", "RfN": "nebula", "HII": "nebula", "Neb": "nebula", "Cl+N": "nebula",
    "OCl": "cluster", "GCl": "globular", "*Ass": "cluster",
}


def fnum(s: str) -> float:
    try:
        return float((s or "").strip())
    except ValueError:
        return math.nan


def hms(s: str) -> float:
    h, m, sec = s.split(":")
    return 15 * (int(h) + int(m) / 60 + float(sec) / 3600)


def dms(s: str) -> float:
    sign = -1 if s.startswith("-") else 1
    d, m, sec = s.lstrip("+-").split(":")
    return sign * (int(d) + int(m) / 60 + float(sec) / 3600)


def pretty(name: str) -> str:
    for pre, out in (("NGC", "NGC "), ("IC", "IC ")):
        if name.startswith(pre) and name[len(pre):len(pre) + 1].isdigit():
            rest = name[len(pre):]
            num = rest.rstrip("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_")
            try:
                return f"{out}{int(num)}{rest[len(num):]}"
            except ValueError:
                return f"{out}{rest}"
    return name


def surface_brightness(mag: float, maj: float, mnr: float) -> float:
    """Mean surface brightness (mag/arcsec²) of an ellipse of the given axes (arcmin)."""
    area = math.pi / 4 * (maj * 60) * ((mnr if mnr > 0 else maj) * 60)
    return mag + 2.5 * math.log10(area)


def build() -> list[list]:
    rows: dict[str, list] = {}
    for fname in ("NGC.csv", "addendum.csv"):
        with open(RAW / fname, encoding="utf-8") as f:
            for r in csv.DictReader(f, delimiter=";"):
                kind = KIND.get(r["Type"])
                if not kind or not r["RA"] or not r["Dec"]:
                    continue
                messier = r.get("M", "").strip()
                v, b = fnum(r["V-Mag"]), fnum(r["B-Mag"])
                mag = v if math.isfinite(v) else b
                maj, mnr = fnum(r["MajAx"]), fnum(r["MinAx"])
                big = math.isfinite(maj) and maj >= 15
                bright = math.isfinite(mag) and mag <= 11.5 and math.isfinite(maj) and maj >= 2
                if not (messier or big or bright):
                    continue
                name = f"M {int(messier)}" if messier else pretty(r["Name"])
                if name in rows:
                    continue
                sb = fnum(r["SurfBr"])
                if not math.isfinite(sb) and math.isfinite(mag) and math.isfinite(maj):
                    sb = surface_brightness(mag, maj, mnr)
                common = (r.get("Common names") or "").split(",")[0].strip()
                alt = pretty(r["Name"]) if messier else ""
                rows[name] = [
                    name,
                    common or alt,
                    kind,
                    round(hms(r["RA"]), 4),
                    round(dms(r["Dec"]), 4),
                    round(mag, 1) if math.isfinite(mag) else None,
                    round(maj, 1) if math.isfinite(maj) else None,
                    round(mnr, 1) if math.isfinite(mnr) else None,
                    round(sb, 1) if math.isfinite(sb) else None,
                    r.get("Const") or "",
                ]
    return sorted(rows.values(), key=lambda x: (x[5] if x[5] is not None else 99))


def main() -> None:
    rows = build()
    doc = {
        "source": "OpenNGC by Mattia Verga, CC BY-SA 4.0",
        "columns": ["name", "common", "kind", "ra", "dec", "mag", "maj", "min", "sb", "con"],
        "rows": rows,
    }
    OUT.write_text(json.dumps(doc, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
    print(f"wrote {OUT}: {len(rows)} targets, {OUT.stat().st_size / 1000:.0f} kB")


if __name__ == "__main__":
    main()
