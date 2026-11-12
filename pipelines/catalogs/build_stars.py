"""Build Stellarium Web Engine star tiles from Hipparcos + Gaia DR3.

Output: ``<out>/stars/properties`` and ``Norder*/Dir*/Npix*.eph``.

Method
------
* Hipparcos (ESA 1997, I/239) supplies every star it contains: bright stars
  that Gaia saturates on, Johnson V, B-V, HD numbers. Positions are ICRS at
  epoch J1991.25 with their proper motions; the engine propagates them.
* Gaia DR3 (ESA/Gaia/DPAC) supplies all *other* stars down to ``--vmax``.
  V comes from the published DR3 relation (Riello et al. 2021, A&A 649, A3,
  Table C.2):  G - V = -0.02704 + 0.01424 C - 0.2156 C^2 + 0.01426 C^3,
  C = BP - RP.  B-V is a cubic in BP-RP fitted to the Hipparcos/Gaia
  cross-match below (printed with its scatter).
* De-duplication: a Gaia source within 3" of a Hipparcos star (propagated to
  J2016.0) is dropped, and within 20" of stars brighter than V = 3, where
  Gaia has spurious detections in the glare.
* Tiling: stars are taken brightest first; each goes into the shallowest
  HEALPix (nested) tile on its line of sight that still has room
  (``--cap`` stars). So children only ever hold stars fainter than their
  parent, which is what the engine's renderer assumes when it decides to
  descend. Every tile carries a ``children_mask`` so the browser never asks
  for tiles that don't exist.
"""

from __future__ import annotations

import argparse
import csv
import math
import re
import shutil
from collections import defaultdict
from pathlib import Path

import numpy as np
from astropy import units as u
from astropy.coordinates import SkyCoord
from astropy_healpix import HEALPix

from eph import (
    EPH_ARCSEC,
    EPH_RAD,
    EPH_RAD_PER_YEAR,
    EPH_VMAG,
    EPH_YEAR,
    Column,
    encode_tile,
)

HERE = Path(__file__).resolve().parent
RAW = HERE / "raw"
MAS = math.pi / 180 / 3600 / 1000  # mas -> rad

GREEK = {
    "Alp": "alf", "Bet": "bet", "Gam": "gam", "Del": "del", "Eps": "eps", "Zet": "zet",
    "Eta": "eta", "The": "tet", "Iot": "iot", "Kap": "kap", "Lam": "lam", "Mu": "mu.",
    "Nu": "nu.", "Xi": "ksi", "Omi": "omi", "Pi": "pi.", "Rho": "rho", "Sig": "sig",
    "Tau": "tau", "Ups": "ups", "Phi": "phi", "Chi": "chi", "Psi": "psi", "Ome": "ome",
}

COLUMNS = [
    Column("hip", "i"),
    Column("gaia", "Q"),
    Column("vmag", "f", EPH_VMAG),
    Column("ra", "f", EPH_RAD),
    Column("de", "f", EPH_RAD),
    Column("plx", "f", EPH_ARCSEC),
    Column("pra", "f", EPH_RAD_PER_YEAR),
    Column("pde", "f", EPH_RAD_PER_YEAR),
    Column("epoc", "f", EPH_YEAR),
    Column("bv", "f"),
    Column("ids", "s", size=96),
]


def fnum(s: str) -> float:
    s = s.strip()
    return float(s) if s else math.nan


# --------------------------------------------------------------------------- inputs
def read_hipparcos() -> list[dict]:
    rows = []
    with open(RAW / "hip_main.tsv", encoding="utf-8") as f:
        lines = [ln for ln in f if ln.strip() and not ln.startswith("#")]
    header = lines[0].rstrip("\n").split("\t")
    for ln in lines[3:]:  # skip header, units, dashes
        v = dict(zip(header, ln.rstrip("\n").split("\t"), strict=False))
        ra, de, vmag = fnum(v["RAICRS"]), fnum(v["DEICRS"]), fnum(v["Vmag"])
        if math.isnan(ra) or math.isnan(de) or math.isnan(vmag):
            continue  # 263 entries without astrometry
        hd = v.get("HD", "").strip()
        rows.append({
            "hip": int(v["HIP"]), "hd": int(hd) if hd else 0, "vmag": vmag,
            "ra": ra, "de": de, "plx": fnum(v["Plx"]), "pmra": fnum(v["pmRA"]),
            "pmde": fnum(v["pmDE"]), "bv": fnum(v["B-V"]), "epoch": 1991.25,
        })
    return rows


def read_bsc_designations() -> dict[int, list[str]]:
    """HD number -> SIMBAD-style Bayer / Flamsteed designations from the BSC."""
    out: dict[int, list[str]] = {}
    with open(RAW / "bsc5.dat", encoding="latin-1") as f:
        for ln in f:
            name, hd = ln[4:14], ln[25:31].strip()
            if not hd:
                continue
            flam, greek, sup, con = name[0:3].strip(), name[3:6].strip(), name[6:7].strip(), name[7:10].strip()
            ids = []
            if greek and con:
                g = GREEK.get(greek)
                if g:
                    if sup:
                        g = g.rstrip(".") + f"{int(sup):02d}"
                    ids.append(f"* {g} {con}")
            if flam and con:
                ids.append(f"* {int(flam)} {con}")
            if ids:
                out[int(hd)] = ids
    return out


def read_iau_names() -> dict[int, str]:
    """HIP -> IAU WGSN proper name."""
    out = {}
    pat = re.compile(r"(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+\d{4}-\d\d-\d\d\s*\*?\s*$")
    with open(RAW / "IAU-CSN.txt", encoding="utf-8") as f:
        for ln in f:
            if ln.startswith("#") or not ln.strip():
                continue
            m = pat.search(ln.rstrip())
            if not m or not m.group(1).isdigit():
                continue
            name = ln.split()[0]
            out.setdefault(int(m.group(1)), name)
    return out


def gaia_v(g: np.ndarray, c: np.ndarray) -> np.ndarray:
    """Johnson V from Gaia G and BP-RP (Riello et al. 2021, Table C.2)."""
    g_minus_v = -0.02704 + 0.01424 * c - 0.2156 * c**2 + 0.01426 * c**3
    return g - g_minus_v


def read_gaia(path: Path) -> dict[str, np.ndarray]:
    cols = defaultdict(list)
    with open(path, encoding="utf-8") as f:
        for row in csv.DictReader(f):
            for k, v in row.items():
                cols[k].append(v)
    as_f = lambda k: np.array([float(x) if x else np.nan for x in cols[k]])  # noqa: E731
    return {
        "source_id": np.array([int(x) for x in cols["source_id"]], dtype=np.uint64),
        "ra": as_f("ra"), "dec": as_f("dec"), "plx": as_f("parallax"),
        "pmra": as_f("pmra"), "pmdec": as_f("pmdec"), "g": as_f("phot_g_mean_mag"),
        "bp": as_f("phot_bp_mean_mag"), "rp": as_f("phot_rp_mean_mag"),
    }


# --------------------------------------------------------------------------- merge
def merge(hip: list[dict], gaia: dict[str, np.ndarray], vmax: float) -> list[dict]:
    # Fainter Hipparcos stars belong to the deeper Gaia layer (min_vmag = vmax),
    # so both layers stay duplicate-free.
    hip = [s for s in hip if s["vmag"] <= vmax]
    # Propagate Hipparcos to Gaia's epoch J2016.0 (linear is fine over 25 yr for matching).
    dt = 2016.0 - 1991.25
    h_ra = np.array([s["ra"] for s in hip])
    h_de = np.array([s["de"] for s in hip])
    h_pmra = np.nan_to_num(np.array([s["pmra"] for s in hip]))
    h_pmde = np.nan_to_num(np.array([s["pmde"] for s in hip]))
    h_v = np.array([s["vmag"] for s in hip])
    h_de16 = h_de + h_pmde * dt / 3.6e6
    h_ra16 = h_ra + h_pmra * dt / 3.6e6 / np.cos(np.radians(h_de))
    hip_c = SkyCoord(h_ra16 * u.deg, h_de16 * u.deg)

    color = gaia["bp"] - gaia["rp"]
    has_color = np.isfinite(color)
    v = np.where(has_color, gaia_v(gaia["g"], np.clip(color, -0.5, 2.75)), gaia["g"])
    gaia_c = SkyCoord(gaia["ra"] * u.deg, gaia["dec"] * u.deg)

    # Nearest Hipparcos star for each Gaia source.
    idx, sep, _ = gaia_c.match_to_catalog_sky(hip_c)
    sep_as = sep.arcsec
    dup = (sep_as < 3.0) | ((sep_as < 20.0) & (h_v[idx] < 3.0))

    # Fit B-V(BP-RP) on clean 1:1 matches (both catalogues single, good colours).
    m = (sep_as < 1.0) & has_color & np.isfinite([hip[i]["bv"] for i in idx])
    m &= np.abs(v - h_v[idx]) < 0.3
    bv_hip = np.array([hip[i]["bv"] for i in idx])[m]
    coef = np.polyfit(color[m], bv_hip, 3)
    resid = bv_hip - np.polyval(coef, color[m])
    print(f"  B-V(BP-RP) cubic fit on {m.sum()} matches: coef={np.round(coef, 4).tolist()}, "
          f"rms={resid.std():.3f} mag")
    dv = (v - h_v[idx])[m]
    print(f"  V(Gaia relation) - V(Hipparcos) on matches: median {np.median(dv):+.3f}, "
          f"robust sigma {1.4826 * np.median(np.abs(dv - np.median(dv))):.3f} mag")
    bv = np.where(has_color, np.polyval(coef, np.clip(color, -0.5, 3.0)), np.nan)

    keep = (~dup) & (v <= vmax) & np.isfinite(gaia["ra"]) & np.isfinite(gaia["dec"])
    print(f"  Gaia: {len(v)} sources, {dup.sum()} duplicates of Hipparcos, "
          f"{keep.sum()} kept with V <= {vmax}")

    stars = [dict(s, gaia=0) for s in hip]
    for i in np.nonzero(keep)[0]:
        stars.append({
            "hip": 0, "hd": 0, "gaia": int(gaia["source_id"][i]), "vmag": float(v[i]),
            "ra": float(gaia["ra"][i]), "de": float(gaia["dec"][i]),
            "plx": float(gaia["plx"][i]), "pmra": float(gaia["pmra"][i]),
            "pmde": float(gaia["pmdec"][i]), "bv": float(bv[i]), "epoch": 2016.0,
        })
    return stars


# --------------------------------------------------------------------------- tiles
def build_tiles(stars: list[dict], cap: int, max_order: int) -> dict[tuple[int, int], list[dict]]:
    stars.sort(key=lambda s: s["vmag"])
    hp_deep = HEALPix(nside=2**max_order, order="nested")
    ra = np.array([s["ra"] for s in stars]) * u.deg
    de = np.array([s["de"] for s in stars]) * u.deg
    deep_pix = hp_deep.lonlat_to_healpix(ra, de)
    tiles: dict[tuple[int, int], list[dict]] = defaultdict(list)
    dropped = 0
    for s, p in zip(stars, deep_pix, strict=True):
        for order in range(max_order + 1):
            pix = int(p) >> (2 * (max_order - order))
            t = tiles[(order, pix)]
            if len(t) < cap or order == max_order:
                if order == max_order and len(t) >= cap * 4:
                    dropped += 1  # pathological crowding; never happens at our limits
                    break
                t.append(s)
                break
    if dropped:
        print(f"  warning: {dropped} stars dropped in over-full deepest tiles")
    # Remove empty placeholders created by defaultdict lookups.
    return {k: v for k, v in tiles.items() if v}


def designations(s: dict, bsc: dict[int, list[str]]) -> str:
    ids = []
    if s["hd"] and s["hd"] in bsc:
        ids += bsc[s["hd"]]
    if s["hd"]:
        ids.append(f"HD {s['hd']}")
    if s["hip"]:
        ids.append(f"HIP {s['hip']}")
    if s["gaia"]:
        ids.append(f"Gaia DR3 {s['gaia']}")
    return "|".join(ids)


def write(tiles: dict, out: Path, bsc: dict[int, list[str]], vmax: float) -> None:
    if out.exists():
        shutil.rmtree(out)
    max_order = max(o for o, _ in tiles)
    total_bytes = 0
    for (order, pix), rows in sorted(tiles.items()):
        mask = sum(1 << i for i in range(4) if (order + 1, pix * 4 + i) in tiles)
        enc = encode_tile(
            "STAR", order, pix, COLUMNS,
            [(
                s["hip"], s["gaia"], s["vmag"], math.radians(s["ra"]), math.radians(s["de"]),
                (s["plx"] / 1000) if math.isfinite(s["plx"]) and s["plx"] > 0 else None,
                s["pmra"] * MAS if math.isfinite(s["pmra"]) else None,
                s["pmde"] * MAS if math.isfinite(s["pmde"]) else None,
                s["epoch"], s["bv"] if math.isfinite(s["bv"]) else None,
                designations(s, bsc),
            ) for s in rows],
            children_mask=mask,
        )
        d = out / f"Norder{order}" / f"Dir{(pix // 10000) * 10000}"
        d.mkdir(parents=True, exist_ok=True)
        (d / f"Npix{pix}.eph").write_bytes(enc)
        total_bytes += len(enc)
    (out / "properties").write_text(
        "\n".join([
            "obs_title                = Stars: Hipparcos + Gaia DR3 subset",
            f"obs_description          = Hipparcos (ESA 1997) and Gaia DR3 (ESA/Gaia/DPAC) to V {vmax}",
            "type                     = stars",
            "hips_tile_format         = eph",
            "hips_order_min           = 0",
            f"hips_order               = {max_order}",
            "min_vmag                 = -2",
            f"max_vmag                 = {vmax}",
            "hips_release_date        = 2026-11-12T00:00Z",
            "",
        ]),
        encoding="utf-8",
    )
    n = sum(len(v) for v in tiles.values())
    print(f"  wrote {len(tiles)} tiles, {n} stars, {total_bytes / 1e6:.1f} MB, max order {max_order}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--gaia", default=str(RAW / "gaia_dr3_g10.6.csv"))
    ap.add_argument("--vmax", type=float, default=10.0)
    ap.add_argument("--cap", type=int, default=1024)
    ap.add_argument("--max-order", type=int, default=5)
    ap.add_argument("--out", default=str(HERE.parent.parent / "public" / "skydata" / "stars"))
    args = ap.parse_args()

    print("Reading Hipparcos, BSC, IAU names…")
    hip = read_hipparcos()
    bsc = read_bsc_designations()
    print(f"  {len(hip)} Hipparcos stars, {len(bsc)} BSC designations")
    if args.gaia:
        print("Reading Gaia…")
        gaia = read_gaia(Path(args.gaia))
        print("Merging…")
        stars = merge(hip, gaia, args.vmax)
    else:
        print("No Gaia file: Hipparcos only (test build)")
        stars = [dict(s, gaia=0) for s in hip if s["vmag"] <= args.vmax]
    print("Tiling…")
    tiles = build_tiles(stars, args.cap, args.max_order)
    write(tiles, Path(args.out), bsc, args.vmax)


if __name__ == "__main__":
    main()
