"""Deep deep-sky layer: OpenNGC + PGC galaxies + nebula catalogues, one PMTiles for R2.

Catalogues (all from VizieR, J2000 positions computed by VizieR):
  * OpenNGC (CC BY-SA 4.0) - NGC/IC/Messier and addendum, as in build_dso.py.
  * PGC / HyperLEDA, VII/237 (Paturel et al. 2003): ~983,000 galaxies with D25
    diameter, axis ratio and position angle. Galaxies already in OpenNGC (by
    their PGC number) are skipped.
  * Sharpless 2 H II regions, VII/20 (Sharpless 1959).
  * Lynds bright nebulae, VII/9 (Lynds 1965) and Lynds dark nebulae, VII/7A (Lynds 1962).
  * van den Bergh reflection nebulae, VII/21 (van den Bergh 1966).
  * Barnard dark nebulae, VII/220A (Barnard 1927).

The engine draws galaxies without a magnitude by their size, so the tiling puts
large objects first (ordering key: magnitude when known, else a size-based one).
Served by the data Worker at /hips/dso/ (key dso/deep-v1.pmtiles).

Usage: python build_dso_deep.py [--out out/dso-deep-v1.pmtiles]
"""

from __future__ import annotations

import argparse
import math
import time
from pathlib import Path

import numpy as np
import requests
from astropy import units as u
from astropy_healpix import HEALPix
from pmtiles.tile import Compression, TileType, zxy_to_tileid
from pmtiles.writer import Writer

from build_dso import COLUMNS, DEFAULT_VMAG, pretty_name, read_openngc
from eph import encode_tile

HERE = Path(__file__).resolve().parent
RAW = HERE / "raw" / "dso-deep"
ARCMIN = math.pi / 180 / 60
VIZIER = "https://vizier.cfa.harvard.edu/viz-bin/asu-tsv"
UA = {"User-Agent": "astro-night-planning-live pipeline (open source)"}


def vizier(source: str, cols: str) -> list[dict]:
    """Whole VizieR table as dicts, with J2000 decimal _RA/_DE (cached in raw/)."""
    RAW.mkdir(parents=True, exist_ok=True)
    cache = RAW / (source.replace("/", "_") + ".tsv")
    if not cache.exists():
        params = {"-source": source, "-out": cols, "-out.add": "_RAJ,_DEJ", "-oc.form": "d",
                  "-out.max": "unlimited"}
        for attempt in range(5):
            try:
                r = requests.get(VIZIER, params=params, headers=UA, timeout=1800)
                r.raise_for_status()
                cache.write_bytes(r.content)
                break
            except requests.RequestException as e:
                print(f"  {source}: {e}; retrying", flush=True)
                time.sleep(30 * (attempt + 1))
        else:
            raise SystemExit(f"{source}: download failed")
    lines = [l for l in cache.read_text(encoding="utf-8", errors="replace").splitlines()
             if l and not l.startswith("#")]
    head = lines[0].split("\t")
    rows = []
    for l in lines[3:]:  # header, units, dashes
        parts = l.split("\t")
        if len(parts) == len(head):
            rows.append({h.strip(): p.strip() for h, p in zip(head, parts, strict=True)})
    print(f"  {source}: {len(rows):,} rows")
    return rows


def f(s: str) -> float:
    try:
        return float(s)
    except (TypeError, ValueError):
        return math.nan


def ino(s: str) -> int | None:
    v = f(s)
    return int(v) if math.isfinite(v) else None


def obj(t, ra, de, ids, smax_am=None, smin_am=None, pa=None, vmag=math.nan, morp=""):
    return {"type": t, "vmag": vmag, "bmag": math.nan, "ra": ra, "de": de,
            "smax": smax_am * ARCMIN if smax_am and math.isfinite(smax_am) else None,
            "smin": smin_am * ARCMIN if smin_am and math.isfinite(smin_am) else None,
            "angl": math.radians(pa) if pa is not None and math.isfinite(pa) else None,
            "morp": morp[:15], "ids": "|".join(ids)[:199]}


def read_pgc(known: set[int]) -> list[dict]:
    out = []
    for r in vizier("VII/237/pgc", "PGC,OType,MType,logD25,logR25,PA,ANames"):
        pgc = int(f(r["PGC"])) if math.isfinite(f(r["PGC"])) else None
        ra, de = f(r["_RAJ2000"]), f(r["_DEJ2000"])
        if pgc is None or pgc in known or not (math.isfinite(ra) and math.isfinite(de)):
            continue
        d25 = 0.1 * 10 ** f(r["logD25"]) if math.isfinite(f(r["logD25"])) else math.nan
        ratio = 10 ** f(r["logR25"]) if math.isfinite(f(r["logR25"])) else 1.0
        ids = [f"PGC {pgc}"]
        for a in (r.get("ANames") or "").split():
            if len("|".join(ids)) + len(a) < 150:
                ids.append(pretty_name(a))
        t = "G" if (r.get("OType") or "G").startswith("G") else "G"
        out.append(obj(t, ra, de, ids, d25, d25 / max(ratio, 1.0) if math.isfinite(d25) else None,
                       f(r["PA"]), morp=r.get("MType", "")))
    return out


def read_nebulae(known_ids: set[str]) -> list[dict]:
    out = []
    for r in vizier("VII/20/catalog", "Sh2,Diam"):
        num = ino(r["Sh2"])
        if num is None:
            continue
        name = f"Sh 2-{num}"
        if name not in known_ids:
            out.append(obj("HII", f(r["_RAJ2000"]), f(r["_DEJ2000"]), [name], f(r["Diam"]), f(r["Diam"])))
    for r in vizier("VII/9/catalog", "Seq,Diam1,Diam2"):
        num = ino(r["Seq"])
        if num is None:
            continue
        name = f"LBN {num}"
        if name not in known_ids:
            out.append(obj("ISM", f(r["_RAJ2000"]), f(r["_DEJ2000"]), [name], f(r["Diam1"]), f(r["Diam2"])))
    for r in vizier("VII/7A/ldn", "LDN,Area"):
        num = ino(r["LDN"])
        if num is None:
            continue
        name = f"LDN {num}"
        area = f(r["Area"])
        d = 2 * math.sqrt(area / math.pi) * 60 if math.isfinite(area) and area > 0 else math.nan
        if name not in known_ids:
            out.append(obj("DNe", f(r["_RAJ2000"]), f(r["_DEJ2000"]), [name], d, d))
    for r in vizier("VII/21/catalog", "VdB,BRadMax"):
        num = ino(r["VdB"])
        if num is None:
            continue
        name = f"vdB {num}"
        rad = f(r["BRadMax"])
        if name not in known_ids:
            out.append(obj("RNe", f(r["_RAJ2000"]), f(r["_DEJ2000"]), [name], 2 * rad, 2 * rad))
    for r in vizier("VII/220A/barnard", "Barn,Diam"):
        num = "".join(ch for ch in r["Barn"] if ch.isdigit())
        name = f"B {int(num)}" if num else ""
        if name and name not in known_ids:
            out.append(obj("DNe", f(r["_RAJ2000"]), f(r["_DEJ2000"]), [name], f(r["Diam"]), f(r["Diam"])))
    return [o for o in out if math.isfinite(o["ra"]) and math.isfinite(o["de"])]


def order_key(o: dict) -> float:
    """Magnitude when known; otherwise bigger objects first (15 for 10', 20 for 0.1')."""
    if math.isfinite(o["vmag"]):
        return o["vmag"]
    if math.isfinite(o["bmag"]):
        return o["bmag"]
    s = (o["smax"] or 0) / ARCMIN
    return 17.5 - 2.5 * math.log10(max(s, 0.01)) if s else DEFAULT_VMAG + 4


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--cap", type=int, default=512)
    ap.add_argument("--max-order", type=int, default=7)
    ap.add_argument("--out", default=str(HERE / "out" / "dso-deep-v1.pmtiles"))
    args = ap.parse_args()

    base = read_openngc()
    known_pgc = set()
    known_ids = set()
    for o in base:
        for i in o["ids"].split("|"):
            known_ids.add(i)
            if i.startswith("PGC "):
                try:
                    known_pgc.add(int(i[4:]))
                except ValueError:
                    pass
    print(f"OpenNGC: {len(base):,} objects ({len(known_pgc):,} with PGC numbers)")
    objs = base + read_nebulae(known_ids) + read_pgc(known_pgc)
    objs.sort(key=order_key)
    print(f"{len(objs):,} deep-sky objects in total")

    hp = HEALPix(nside=2**args.max_order, order="nested")
    deep = np.asarray(hp.lonlat_to_healpix(np.array([o["ra"] for o in objs]) * u.deg,
                                           np.array([o["de"] for o in objs]) * u.deg), np.int64)
    tiles: dict[tuple[int, int], list[dict]] = {}
    for o, p in zip(objs, deep, strict=True):
        for order in range(args.max_order + 1):
            pix = int(p) >> (2 * (args.max_order - order))
            lst = tiles.setdefault((order, pix), [])
            if len(lst) < args.cap or order == args.max_order:
                lst.append(o)
                break
    entries = []
    for (order, pix), rows in tiles.items():
        mask = sum(1 << i for i in range(4) if (order + 1, pix * 4 + i) in tiles)
        enc = encode_tile(
            "DSO ", order, pix, COLUMNS,
            [(o["type"], o["vmag"] if math.isfinite(o["vmag"]) else None,
              o["bmag"] if math.isfinite(o["bmag"]) else None,
              math.radians(o["ra"]), math.radians(o["de"]),
              o["smax"], o["smin"], o["angl"], o["morp"], o["ids"]) for o in rows],
            children_mask=mask,
        )
        z = order + 2
        entries.append((zxy_to_tileid(z, pix % (1 << z), pix // (1 << z)), enc))
    entries.sort(key=lambda e: e[0])
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    with open(out, "wb") as fh:
        w = Writer(fh)
        for tid, data in entries:
            w.write_tile(tid, data)
        w.finalize(
            {"tile_type": TileType.UNKNOWN, "tile_compression": Compression.NONE,
             "min_lon_e7": -1800000000, "min_lat_e7": -900000000,
             "max_lon_e7": 1800000000, "max_lat_e7": 900000000,
             "center_zoom": 2, "center_lon_e7": 0, "center_lat_e7": 0},
            {"name": "Deep-sky objects: OpenNGC + PGC + nebula catalogues",
             "format": "stellarium-web-engine eph, HEALPix nested; z=order+2, x=pix%2^z, y=pix//2^z",
             "objects": len(objs)},
        )
    max_order = max(o for o, _ in tiles)
    out.with_suffix(".properties").write_text(
        "\n".join([
            "obs_title                = Deep-sky objects: OpenNGC, PGC, Sharpless, LBN, LDN, vdB, Barnard",
            "obs_description          = OpenNGC (CC BY-SA 4.0); HyperLEDA PGC; Sharpless 1959; Lynds 1962, 1965; van den Bergh 1966; Barnard 1927 (via VizieR)",
            "type                     = dso",
            "hips_tile_format         = eph",
            "hips_order_min           = 0",
            f"hips_order               = {max_order}",
            "hips_release_date        = 2026-11-14T00:00Z",
            "",
        ]),
        encoding="utf-8",
    )
    size = out.stat().st_size
    print(f"wrote {out.name}: {len(entries):,} tiles, {size / 1e6:.1f} MB, max order {max_order}")


if __name__ == "__main__":
    main()
