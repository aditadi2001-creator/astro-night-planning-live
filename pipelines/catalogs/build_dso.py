"""Build Stellarium Web Engine deep-sky tiles from OpenNGC (CC BY-SA 4.0).

Output: ``<out>/dso/properties`` and ``Norder*/Dir*/Npix*.eph``.

* OpenNGC object types are mapped to SIMBAD object types, which is what the
  engine uses for symbols and descriptions. Duplicates, non-existent objects
  and single/double stars catalogued in NGC/IC are skipped.
* Sizes: OpenNGC MajAx/MinAx are full diameters in arcmin; the engine wants
  radians (same convention as its own data). Position angle is N through E.
* Tiling: same brightest-first hierarchical scheme as the stars (objects
  without a magnitude count as V = 16, the engine's own default).
"""

from __future__ import annotations

import argparse
import csv
import math
import shutil
from collections import defaultdict
from pathlib import Path

import numpy as np
from astropy import units as u
from astropy_healpix import HEALPix

from eph import EPH_RAD, EPH_VMAG, Column, encode_tile

HERE = Path(__file__).resolve().parent
RAW = HERE / "raw" / "openngc"
ARCMIN = math.pi / 180 / 60
DEFAULT_VMAG = 16.0

TYPE_MAP = {
    "G": "G", "GPair": "PaG", "GTrpl": "GrG", "GGroup": "GrG",
    "OCl": "OpC", "GCl": "GlC", "Cl+N": "HII", "*Ass": "As*",
    "PN": "PN", "HII": "HII", "EmN": "HII", "Neb": "ISM", "RfN": "RNe",
    "DrkN": "DNe", "SNR": "SNR",
}
# Skipped: Dup, NonEx, '*', '**', Nova, Other.

PREFIXES = [("NGC", "NGC "), ("IC", "IC "), ("ESO", "ESO "), ("UGC", "UGC "), ("PGC", "PGC "),
            ("HCG", "HCG "), ("MWSC", "MWSC "), ("Mel", "Mel "), ("Cl", "Cl "), ("B", "B "),
            ("C", "C "), ("H", "H "), ("M", "M ")]

COLUMNS = [
    Column("type", "s", size=4),
    Column("vmag", "f", EPH_VMAG),
    Column("bmag", "f", EPH_VMAG),
    Column("ra", "f", EPH_RAD),
    Column("de", "f", EPH_RAD),
    Column("smax", "f", EPH_RAD),
    Column("smin", "f", EPH_RAD),
    Column("angl", "f", EPH_RAD),
    Column("morp", "s", size=16),
    Column("ids", "s", size=200),
]


def fnum(s: str) -> float:
    s = (s or "").strip()
    try:
        return float(s)
    except ValueError:
        return math.nan


def hms(s: str) -> float:
    h, m, sec = s.split(":")
    return 15 * (int(h) + int(m) / 60 + float(sec) / 3600)


def dms(s: str) -> float:
    sign = -1 if s.startswith("-") else 1
    d, m, sec = s.lstrip("+-").split(":")
    return sign * (int(d) + int(m) / 60 + float(sec) / 3600)


def pretty_name(name: str) -> str:
    """NGC0224 -> 'NGC 224', IC0434 -> 'IC 434', B033 -> 'B 33'."""
    for pre, out in PREFIXES:
        if name.startswith(pre) and name[len(pre):len(pre) + 1].isdigit():
            rest = name[len(pre):]
            num = rest.rstrip("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_")
            suffix = rest[len(num):]
            try:
                return f"{out}{int(num)}{suffix}"
            except ValueError:
                return f"{out}{rest}"
    return name


def read_openngc() -> list[dict]:
    objs = []
    for fname in ("NGC.csv", "addendum.csv"):
        with open(RAW / fname, encoding="utf-8") as f:
            for row in csv.DictReader(f, delimiter=";"):
                t = TYPE_MAP.get(row["Type"])
                if not t or not row["RA"] or not row["Dec"]:
                    continue
                ids = []
                for cn in filter(None, (row.get("Common names") or "").split(",")):
                    ids.append(f"NAME {cn.strip()}")
                if row.get("M"):
                    ids.append(f"M {int(row['M'])}")
                ids.append(pretty_name(row["Name"]))
                for extra in filter(None, (row.get("Identifiers") or "").split(",")):
                    if len("|".join(ids)) + len(extra) < 190:
                        ids.append(extra.strip())
                vmag, bmag = fnum(row["V-Mag"]), fnum(row["B-Mag"])
                maj, mnr = fnum(row["MajAx"]), fnum(row["MinAx"])
                pa = fnum(row["PosAng"])
                objs.append({
                    "type": t, "vmag": vmag, "bmag": bmag,
                    "ra": hms(row["RA"]), "de": dms(row["Dec"]),
                    "smax": maj * ARCMIN if math.isfinite(maj) else None,
                    "smin": mnr * ARCMIN if math.isfinite(mnr) else None,
                    "angl": math.radians(pa) if math.isfinite(pa) else None,
                    "morp": (row.get("Hubble") or "")[:15],
                    "ids": "|".join(ids),
                })
    return objs


def display_mag(o: dict) -> float:
    if math.isfinite(o["vmag"]):
        return o["vmag"]
    if math.isfinite(o["bmag"]):
        return o["bmag"]
    return DEFAULT_VMAG


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--cap", type=int, default=512)
    ap.add_argument("--max-order", type=int, default=3)
    ap.add_argument("--out", default=str(HERE.parent.parent / "public" / "skydata" / "dso"))
    args = ap.parse_args()

    objs = read_openngc()
    objs.sort(key=display_mag)
    print(f"{len(objs)} deep-sky objects")

    hp = HEALPix(nside=2**args.max_order, order="nested")
    deep = hp.lonlat_to_healpix(np.array([o["ra"] for o in objs]) * u.deg,
                                np.array([o["de"] for o in objs]) * u.deg)
    tiles: dict[tuple[int, int], list[dict]] = defaultdict(list)
    for o, p in zip(objs, deep, strict=True):
        for order in range(args.max_order + 1):
            pix = int(p) >> (2 * (args.max_order - order))
            if len(tiles[(order, pix)]) < args.cap or order == args.max_order:
                tiles[(order, pix)].append(o)
                break
    tiles = {k: v for k, v in tiles.items() if v}

    out = Path(args.out)
    if out.exists():
        shutil.rmtree(out)
    size = 0
    for (order, pix), rows in sorted(tiles.items()):
        mask = sum(1 << i for i in range(4) if (order + 1, pix * 4 + i) in tiles)
        enc = encode_tile(
            "DSO ", order, pix, COLUMNS,
            [(o["type"], o["vmag"] if math.isfinite(o["vmag"]) else None,
              o["bmag"] if math.isfinite(o["bmag"]) else None,
              math.radians(o["ra"]), math.radians(o["de"]),
              o["smax"], o["smin"], o["angl"], o["morp"], o["ids"]) for o in rows],
            children_mask=mask,
        )
        d = out / f"Norder{order}" / f"Dir{(pix // 10000) * 10000}"
        d.mkdir(parents=True, exist_ok=True)
        (d / f"Npix{pix}.eph").write_bytes(enc)
        size += len(enc)
    (out / "properties").write_text(
        "\n".join([
            "obs_title                = Deep-sky objects: OpenNGC",
            "obs_description          = OpenNGC by Mattia Verga (CC BY-SA 4.0)",
            "type                     = dso",
            "hips_tile_format         = eph",
            "hips_order_min           = 0",
            f"hips_order               = {max(o for o, _ in tiles)}",
            "hips_release_date        = 2026-11-12T00:00Z",
            "",
        ]),
        encoding="utf-8",
    )
    print(f"wrote {len(tiles)} tiles, {size / 1e6:.2f} MB")


if __name__ == "__main__":
    main()
