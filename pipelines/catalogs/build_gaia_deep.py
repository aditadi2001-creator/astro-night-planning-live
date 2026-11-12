"""Deep star layer (Gaia DR3, V 10 → 14) packed into ONE PMTiles file for R2.

Why one file: R2 charges a Class A operation per upload and per 1,000 objects
listed, so ~16,000 tiny tiles would be wasteful. The data Worker reads single
tiles out of this archive with range requests and serves each at its own
HiPS URL (/hips/gaia/Norder*/Dir*/Npix*.eph), which the sky engine loads as
its "gaia" survey above the V = 10 layer that ships with the site.

Per star: Gaia source id, V, RA, Dec at epoch 2026.0 (proper motion applied at
build time and then dropped: for these faint stars that costs well under 0.2″
over the next couple of decades), and B−V. V and B−V use the same relations as
build_stars.py (Riello et al. 2021; cubic fit to the Hipparcos cross-match).

HEALPix (order, pix) → PMTiles z/x/y: z = order + 2, x = pix mod 2^z,
y = pix div 2^z (same mapping as worker/src/routes.ts).

Usage: python build_gaia_deep.py [--vmin 10] [--vmax 14] [--cap 1024]
"""

from __future__ import annotations

import argparse
import glob
import math
from collections import defaultdict
from pathlib import Path

import astropy.units as u
import numpy as np
from astropy.io import fits
from astropy_healpix import HEALPix
from pmtiles.tile import Compression, TileType, zxy_to_tileid
from pmtiles.writer import Writer

from eph import EPH_RAD, EPH_VMAG, Column, encode_tile_np

HERE = Path(__file__).resolve().parent
RAW = HERE / "raw"
OUT = HERE / "out"

# B−V as a cubic in BP−RP, fitted by build_stars.py on 103,762 Hipparcos/Gaia
# matches (rms 0.093 mag). numpy.polyval order (highest power first).
BV_COEF = [-0.0343, 0.0329, 0.8923, -0.0461]
EPOCH_FROM = 2016.0
EPOCH_TO = 2026.0
MAS_DEG = 1 / 3.6e6

COLUMNS = [
    Column("gaia", "Q"),
    Column("vmag", "f", EPH_VMAG),
    Column("ra", "f", EPH_RAD),
    Column("de", "f", EPH_RAD),
    Column("bv", "f"),
]


def gaia_v(g, c):
    return g - (-0.02704 + 0.01424 * c - 0.2156 * c**2 + 0.01426 * c**3)


def load(files: list[str], vmin: float, vmax: float) -> dict[str, np.ndarray]:
    parts = defaultdict(list)
    for f in files:
        with fits.open(f, memmap=True) as h:
            d = h[1].data
            g = np.asarray(d["phot_g_mean_mag"], dtype=np.float64)
            c = np.asarray(d["phot_bp_mean_mag"], dtype=np.float64) - np.asarray(
                d["phot_rp_mean_mag"], dtype=np.float64)
            has_c = np.isfinite(c)
            v = np.where(has_c, gaia_v(g, np.clip(c, -0.5, 2.75)), g)
            keep = (v > vmin) & (v <= vmax) & np.isfinite(d["ra"]) & np.isfinite(d["dec"])
            ra = np.asarray(d["ra"], dtype=np.float64)[keep]
            de = np.asarray(d["dec"], dtype=np.float64)[keep]
            pmra = np.nan_to_num(np.asarray(d["pmra"], dtype=np.float64)[keep])
            pmde = np.nan_to_num(np.asarray(d["pmdec"], dtype=np.float64)[keep])
            dt = EPOCH_TO - EPOCH_FROM
            de2 = de + pmde * dt * MAS_DEG
            ra2 = ra + pmra * dt * MAS_DEG / np.maximum(1e-6, np.cos(np.radians(de)))
            parts["gaia"].append(np.asarray(d["source_id"], dtype=np.uint64)[keep])
            parts["vmag"].append(v[keep].astype(np.float32))
            parts["ra"].append(np.mod(ra2, 360.0))
            parts["de"].append(np.clip(de2, -90, 90))
            bv = np.where(has_c, np.polyval(BV_COEF, np.clip(c, -0.5, 3.0)), np.nan)
            parts["bv"].append(bv[keep].astype(np.float32))
            print(f"  {Path(f).name}: kept {int(keep.sum()):,} of {len(g):,}")
    return {k: np.concatenate(v) for k, v in parts.items()}


def tile_assign(ra: np.ndarray, de: np.ndarray, vmag: np.ndarray, cap: int, max_order: int):
    """Brightest first, each star goes into the shallowest tile with room.

    Vectorised per order: sort by (deep pixel, magnitude); within each tile at
    order o, the first `cap` stars that are not yet placed stay there."""
    order_idx = np.argsort(vmag, kind="stable")
    hp = HEALPix(nside=2**max_order, order="nested")
    deep = hp.lonlat_to_healpix(ra[order_idx] * u.deg, de[order_idx] * u.deg)
    deep = np.asarray(deep, dtype=np.int64)
    assigned_order = np.full(len(deep), -1, dtype=np.int8)
    remaining = np.arange(len(deep))
    for o in range(max_order + 1):
        pix = deep[remaining] >> (2 * (max_order - o))
        # Rank within each pixel, keeping brightness order (remaining is sorted by mag).
        sort = np.argsort(pix, kind="stable")
        sp = pix[sort]
        starts = np.r_[0, np.flatnonzero(np.diff(sp)) + 1]
        rank = np.arange(len(sp)) - np.repeat(starts, np.diff(np.r_[starts, len(sp)]))
        take = rank < cap if o < max_order else np.ones(len(sp), dtype=bool)
        chosen = remaining[sort[take]]
        assigned_order[chosen] = o
        remaining = np.sort(remaining[sort[~take]])
        print(f"  order {o}: {len(chosen):,} stars")
        if not len(remaining):
            break
    pix_at = deep >> (2 * (max_order - assigned_order.astype(np.int64)))
    return order_idx, assigned_order, pix_at


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--vmin", type=float, default=10.0)
    ap.add_argument("--vmax", type=float, default=14.0)
    ap.add_argument("--cap", type=int, default=1024)
    ap.add_argument("--max-order", type=int, default=8)
    ap.add_argument("--inputs", default=str(RAW / "gaia_deep_*.fits"))
    ap.add_argument("--out", default=str(OUT / "gaia-deep-v1.pmtiles"))
    args = ap.parse_args()

    files = sorted(glob.glob(args.inputs))
    if not files:
        raise SystemExit("No input FITS files: run fetch.py --only gaia-deep first.")
    print(f"Reading {len(files)} file(s)…")
    s = load(files, args.vmin, args.vmax)
    n = len(s["vmag"])
    print(f"{n:,} stars with {args.vmin} < V <= {args.vmax}")

    print("Tiling…")
    idx, orders, pixs = tile_assign(s["ra"], s["de"], s["vmag"], args.cap, args.max_order)
    keyed = orders.astype(np.int64) * (1 << 40) + pixs
    sort = np.argsort(keyed, kind="stable")  # groups tiles, keeps brightness order inside
    keyed_sorted = keyed[sort]
    bounds = np.r_[0, np.flatnonzero(np.diff(keyed_sorted)) + 1, len(sort)]
    tile_keys = {(int(k >> 40), int(k & ((1 << 40) - 1))) for k in keyed_sorted[bounds[:-1]]}

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    entries = []
    for a, b in zip(bounds[:-1], bounds[1:], strict=True):
        sel = idx[sort[a:b]]
        k = int(keyed_sorted[a])
        order, pix = k >> 40, k & ((1 << 40) - 1)
        mask = sum(1 << i for i in range(4) if (order + 1, pix * 4 + i) in tile_keys)
        data = encode_tile_np(
            "GAIA", order, pix, COLUMNS,
            {"gaia": s["gaia"][sel], "vmag": s["vmag"][sel],
             "ra": np.radians(s["ra"][sel]), "de": np.radians(s["de"][sel]),
             "bv": s["bv"][sel]},
            children_mask=mask,
        )
        z = order + 2
        entries.append((zxy_to_tileid(z, pix % (1 << z), pix // (1 << z)), data))
    entries.sort(key=lambda e: e[0])

    with open(out, "wb") as f:
        w = Writer(f)
        for tid, data in entries:
            w.write_tile(tid, data)
        w.finalize(
            {
                "tile_type": TileType.UNKNOWN,
                "tile_compression": Compression.NONE,
                "min_lon_e7": -1800000000, "min_lat_e7": -900000000,
                "max_lon_e7": 1800000000, "max_lat_e7": 900000000,
                "center_zoom": 2, "center_lon_e7": 0, "center_lat_e7": 0,
            },
            {"name": "Gaia DR3 deep star layer", "attribution": "ESA/Gaia/DPAC",
             "format": "stellarium-web-engine eph, HEALPix nested; z=order+2, x=pix%2^z, y=pix//2^z",
             "vmin": args.vmin, "vmax": args.vmax, "stars": n},
        )
    max_order = max(o for o, _ in tile_keys)
    props = out.with_suffix(".properties")
    props.write_text(
        "\n".join([
            "obs_title                = Stars: Gaia DR3 deep layer",
            f"obs_description          = ESA/Gaia/DPAC Gaia DR3, {args.vmin} < V <= {args.vmax}",
            "type                     = stars",
            "hips_tile_format         = eph",
            "hips_order_min           = 0",
            f"hips_order               = {max_order}",
            f"min_vmag                 = {args.vmin}",
            f"max_vmag                 = {args.vmax}",
            "hips_release_date        = 2026-11-12T00:00Z",
            "",
        ]),
        encoding="utf-8",
    )
    size = out.stat().st_size
    print(f"wrote {out.name}: {len(entries):,} tiles, {size / 1e6:.1f} MB "
          f"({size / max(1, n):.1f} bytes/star), max order {max_order}")
    if size > 450e6:
        print("WARNING: above 450 MB; lower --vmax to stay inside the 0.5 GB catalog budget.")


if __name__ == "__main__":
    main()
