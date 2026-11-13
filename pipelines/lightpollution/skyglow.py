"""Light-pollution pipeline: calibrate the sky-glow model, compute it worldwide,
and write the map tiles. Input: raw/<year>/hHHvVV.npz from fetch.py.

    python skyglow.py calibrate --year 2025   # fit to Globe at Night SQM readings
    python skyglow.py glow      --year 2025   # artificial brightness, every land tile
    python skyglow.py tiles     --year 2025   # PMTiles: lp-<year> (SQM), lprad-<year> (radiance)
    python skyglow.py all       --year 2025

Outputs in out/: lp-<year>.pmtiles, lprad-<year>.pmtiles, lightpollution.json
(parameters, encodings, validation numbers; uploaded as data/lightpollution.json).
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import math
import sys
import time
import urllib.request
from collections import OrderedDict
from pathlib import Path

import numpy as np

from model import (
    NATURAL_SQM,
    PIX_DEG,
    R_MAX_KM,
    TILE,
    encode_brightening,
    encode_radiance,
    fft_convolve,
    kernel_grid,
    kernel_value,
    pixel_size_km,
    sqm_from_ratio,
    tile_bounds,
)

HERE = Path(__file__).resolve().parent
OUT = HERE / "out"
GAN_FILES = {  # Globe at Night yearly CSVs (CC BY 4.0)
    2022: "https://globeatnight.org/documents/662/GaN2022.csv",
    2023: "https://globeatnight.org/documents/661/GaN2023.csv",
    2024: "https://globeatnight.org/documents/926/GaN2024.csv",
    2025: "https://globeatnight.org/documents/1190/GaN2025.csv",
}
UA = {"User-Agent": "astro-night-planning-live pipeline (open source)"}
WORLD_ROWS = 180 * 240
WORLD_COLS = 360 * 240


# ------------------------------------------------------------------ mosaic


class Mosaic:
    """Lazy world mosaic of 15″ tiles (zeros where no tile exists: open ocean)."""

    def __init__(self, folder: Path, key: str = "rad", cache: int = 48):
        self.folder = folder
        self.key = key
        self.have = {p.stem for p in folder.glob("h??v??.npz")}
        self.cache: OrderedDict[str, np.ndarray] = OrderedDict()
        self.size = cache

    def tile(self, h: int, v: int) -> np.ndarray | None:
        tid = f"h{h:02d}v{v:02d}"
        if tid not in self.have:
            return None
        if tid in self.cache:
            self.cache.move_to_end(tid)
            return self.cache[tid]
        a = np.load(self.folder / f"{tid}.npz")[self.key]
        self.cache[tid] = a
        while len(self.cache) > self.size:
            self.cache.popitem(last=False)
        return a

    def window(self, row0: int, col0: int, rows: int, cols: int, dtype=np.float32) -> np.ndarray:
        """World pixels [row0, row0+rows) × [col0, col0+cols); columns wrap at 180°."""
        out = np.zeros((rows, cols), dtype)
        r = max(0, row0)
        while r < min(WORLD_ROWS, row0 + rows):
            v, rr = divmod(r, TILE)
            r_end = min((v + 1) * TILE, row0 + rows, WORLD_ROWS)
            c = col0
            while c < col0 + cols:
                cw = c % WORLD_COLS
                h, cc = divmod(cw, TILE)
                c_end = min(c + (TILE - cc), col0 + cols)
                t = self.tile(h, v)
                if t is not None:
                    out[r - row0 : r_end - row0, c - col0 : c_end - col0] = t[
                        rr : rr + (r_end - r), cc : cc + (c_end - c)
                    ]
                c = c_end
            r = r_end
        return out


def world_rc(lat: float, lon: float) -> tuple[float, float]:
    return (90 - lat) / PIX_DEG, (lon + 180) / PIX_DEG


# ------------------------------------------------------------------ calibration

BIN_EDGES = np.r_[0, np.geomspace(0.05, R_MAX_KM, 160)]
BIN_MID = np.r_[0.02, np.sqrt(BIN_EDGES[1:-1] * BIN_EDGES[2:])]


def radial_profile(m: Mosaic, lat: float, lon: float) -> np.ndarray:
    """Σ radiance × area (nW cm⁻² sr⁻¹ km²) in distance rings around a place."""
    dx, dy = pixel_size_km(lat)
    row, col = world_rc(lat, lon)
    ny = int(math.ceil(R_MAX_KM / dy)) + 1
    nx = min(int(math.ceil(R_MAX_KM / max(dx, 1e-3))) + 1, WORLD_COLS // 2)
    r0, c0 = int(row) - ny, int(col) - nx
    win = m.window(r0, c0, 2 * ny + 1, 2 * nx + 1)
    if not win.any():
        return np.zeros(len(BIN_MID))
    yy = (np.arange(win.shape[0]) + r0 + 0.5 - row) * dy
    xx = (np.arange(win.shape[1]) + c0 + 0.5 - col) * dx
    d = np.hypot(xx[None, :], yy[:, None]).ravel()
    w = win.ravel() * dx * dy
    keep = (w > 0) & (d <= R_MAX_KM)
    idx = np.clip(np.searchsorted(BIN_EDGES, d[keep], side="right") - 1, 0, len(BIN_MID) - 1)
    return np.bincount(idx, weights=w[keep], minlength=len(BIN_MID))


def load_gan(folder: Path) -> list[tuple[float, float, float]]:
    """Clear-sky SQM readings (lat, lon, sqm) from Globe at Night."""
    folder.mkdir(parents=True, exist_ok=True)
    out = []
    for year, url in GAN_FILES.items():
        f = folder / f"GaN{year}.csv"
        if not f.exists():
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120) as r:
                f.write_bytes(r.read())
        for row in csv.DictReader(io.StringIO(f.read_text(encoding="utf-8", errors="replace"))):
            try:
                sqm = float(row.get("SQMReading") or "nan")
                lat = float(row["Latitude"])
                lon = float(row["Longitude"])
            except (KeyError, ValueError):
                continue
            cloud = (row.get("CloudCover") or "").strip().lower()
            if not (15.0 <= sqm <= 22.6) or abs(lat) > 72 or not (-180 <= lon <= 180):
                continue
            if cloud and cloud != "clear":
                continue
            out.append((lat, lon, sqm))
    return out


def fit_scale(S: np.ndarray, obs: np.ndarray) -> tuple[float, np.ndarray]:
    """A minimising a Huber loss (δ = 0.5 mag) of SQM residuals; returns (A, residuals)."""
    best = (math.inf, 1.0)
    for logA in np.linspace(-5, 3, 801):
        res = obs - sqm_from_ratio(10**logA * S)
        a = np.abs(res)
        loss = np.where(a < 0.5, 0.5 * a * a, 0.5 * (a - 0.25)).sum()
        if loss < best[0]:
            best = (loss, logA)
    A = 10 ** best[1]
    return A, obs - sqm_from_ratio(A * S)


def stats(res: np.ndarray) -> dict:
    a = np.abs(res)
    core = res[a <= 1.5]
    return {
        "n": int(len(res)),
        "median_abs_mag": round(float(np.median(a)), 3),
        "rms_mag": round(float(np.sqrt(np.mean(res**2))), 3),
        "rms_mag_without_outliers": round(float(np.sqrt(np.mean(core**2))), 3),
        "outliers_over_1_5_mag": int((a > 1.5).sum()),
        "bias_mag": round(float(np.median(res)), 3),
    }


def cmd_calibrate(year: int) -> dict:
    m = Mosaic(HERE / "raw" / str(year))
    # Sorted by tile so the mosaic cache keeps hitting the same tiles.
    pts = sorted(load_gan(HERE / "raw" / "gan"), key=lambda p: (int((90 - p[0]) // 10), int((p[1] + 180) // 10)))
    print(f"{len(pts)} clear-sky Globe at Night SQM readings")
    t0 = time.time()
    prof = np.array([radial_profile(m, la, lo) for la, lo, _ in pts])
    obs = np.array([s for _, _, s in pts])
    print(f"radial profiles in {time.time() - t0:.0f} s")
    results = []
    # First full fit (2026) landed on the grid edge at p = 2.0, D = 300 km, so the
    # grid reaches past both (Walker's law p = 2.5 stays inside).
    for p in (1.6, 1.8, 2.0, 2.2, 2.5, 2.8):
        for d0 in (0.25, 0.5, 1.0):
            for D in (100.0, 300.0, 1000.0):
                S = prof @ kernel_value(BIN_MID, p, d0, D)
                A, res = fit_scale(S, obs)
                st = stats(res)
                results.append({"p": p, "d0": d0, "D": D, "A": A, **st})
    results.sort(key=lambda r: (r["median_abs_mag"], r["rms_mag_without_outliers"]))
    best = results[0]
    S = prof @ kernel_value(BIN_MID, best["p"], best["d0"], best["D"])
    res = obs - sqm_from_ratio(best["A"] * S)
    bands = {}
    for name, lo, hi in (("SQM < 19", 0, 19), ("19–21", 19, 21), ("> 21", 21, 99)):
        sel = (obs >= lo) & (obs < hi)
        if sel.any():
            bands[name] = stats(res[sel])
    calib = {"year": year, "best": best, "by_brightness": bands, "top5": results[:5]}
    OUT.mkdir(exist_ok=True)
    (OUT / "calibration.json").write_text(json.dumps(calib, indent=1))
    print(json.dumps({"best": best, "by_brightness": bands}, indent=1))
    return calib


# ------------------------------------------------------------------ worldwide glow

STRIP = 600


def cmd_glow(year: int) -> None:
    calib = json.loads((OUT / "calibration.json").read_text())["best"]
    p, d0, D, A = calib["p"], calib["d0"], calib["D"], calib["A"]
    m = Mosaic(HERE / "raw" / str(year))
    dst = HERE / "glow" / str(year)
    dst.mkdir(parents=True, exist_ok=True)
    tiles = sorted(m.have)
    # Every tile within reach of a lit tile gets a glow tile (sea near coasts too).
    todo = set()
    for tid in tiles:
        h, v = int(tid[1:3]), int(tid[4:6])
        lat = 90 - 10 * v - 5
        reach = 1 if abs(lat) < 60 else 3
        if m.tile(h, v) is not None and m.tile(h, v).any():
            for dv in (-1, 0, 1):
                for dh in range(-reach, reach + 1):
                    vv, hh = v + dv, (h + dh) % 36
                    if 0 <= vv < 18:
                        todo.add((hh, vv))
    print(f"{len(todo)} glow tiles to compute")
    t0 = time.time()
    for n, (h, v) in enumerate(sorted(todo), 1):
        out = dst / f"h{h:02d}v{v:02d}.npz"
        if out.exists():
            continue
        mag = np.zeros((TILE, TILE), np.uint16)
        for s in range(0, TILE, STRIP):
            row0 = v * TILE + s
            lat_c = 90 - (row0 + STRIP / 2) * PIX_DEG
            dx, dy = pixel_size_km(lat_c)
            ny = int(math.ceil(R_MAX_KM / dy)) + 1
            nx = min(int(math.ceil(R_MAX_KM / dx)) + 1, 3 * TILE)
            win = m.window(row0 - ny, h * TILE - nx, STRIP + 2 * ny, TILE + 2 * nx)
            if not win.any():
                continue
            conv = fft_convolve(win, kernel_grid(lat_c, p, d0, D))[ny : ny + STRIP, nx : nx + TILE]
            r = A * np.maximum(conv, 0)
            mag[s : s + STRIP] = np.clip(np.rint(2500 * np.log10(1 + r)), 0, 65535)
        rad60 = m.window(v * TILE, h * TILE, TILE, TILE).reshape(600, 4, 600, 4).mean(axis=(1, 3))
        np.savez_compressed(out, mag=mag, rad60=rad60.astype(np.float32))
        if n % 20 == 0:
            print(f"  {n}/{len(todo)} ({time.time() - t0:.0f} s)", flush=True)
    print(f"glow done in {time.time() - t0:.0f} s")


# ------------------------------------------------------------------ tiles

def merc_lat(y_frac: np.ndarray) -> np.ndarray:
    return np.degrees(np.arctan(np.sinh(np.pi * (1 - 2 * y_frac))))


def bilinear(a: np.ndarray, r: np.ndarray, c: np.ndarray) -> np.ndarray:
    r0 = np.clip(np.floor(r).astype(np.int64), 0, a.shape[0] - 2)
    c0 = np.clip(np.floor(c).astype(np.int64), 0, a.shape[1] - 2)
    fr = np.clip(r - r0, 0, 1)
    fc = np.clip(c - c0, 0, 1)
    return (a[r0, c0] * (1 - fr) * (1 - fc) + a[r0, c0 + 1] * (1 - fr) * fc
            + a[r0 + 1, c0] * fr * (1 - fc) + a[r0 + 1, c0 + 1] * fr * fc)


def webp_lossless(grey: np.ndarray) -> bytes:
    from PIL import Image

    buf = io.BytesIO()
    Image.fromarray(grey, "L").save(buf, "WEBP", lossless=True, quality=100, method=4)
    return buf.getvalue()


class Pyramid:
    """Collects tiles, builds lower zooms by 2×2 averaging in linear units."""

    def __init__(self, encode, top: int):
        self.encode = encode
        self.top = top
        self.entries: list[tuple[int, int, int, bytes]] = []
        self.level: dict[tuple[int, int], np.ndarray] = {}

    def add(self, z: int, x: int, y: int, lin: np.ndarray) -> None:
        g = self.encode(lin)
        if g.any():
            self.entries.append((z, x, y, webp_lossless(g)))

    def block(self, z: int, x0: int, y0: int, lin: np.ndarray, stop: int) -> None:
        """lin covers 2^k × 2^k tiles at zoom z from (x0, y0); emit down to zoom `stop`."""
        while True:
            n = lin.shape[0] // 256
            for j in range(n):
                for i in range(n):
                    self.add(z, x0 + i, y0 + j, lin[j * 256 : (j + 1) * 256, i * 256 : (i + 1) * 256])
            if z == stop:
                self.level[(x0, y0)] = lin.astype(np.float32)
                return
            lin = lin.reshape(lin.shape[0] // 2, 2, lin.shape[1] // 2, 2).mean(axis=(1, 3))
            z, x0, y0 = z - 1, x0 // 2, y0 // 2

    def finish(self, stop: int) -> None:
        """Assemble the kept `stop`-zoom tiles into the world and emit zooms below it."""
        n = 2**stop
        world = np.zeros((n * 256, n * 256), np.float32)
        for (x, y), a in self.level.items():
            world[y * 256 : y * 256 + a.shape[0], x * 256 : x * 256 + a.shape[1]] = a
        z = stop
        while z > 0:
            world = world.reshape(world.shape[0] // 2, 2, world.shape[1] // 2, 2).mean(axis=(1, 3))
            z -= 1
            m = 2**z
            for y in range(m):
                for x in range(m):
                    self.add(z, x, y, world[y * 256 : (y + 1) * 256, x * 256 : (x + 1) * 256])

    def write(self, path: Path, meta: dict, maxzoom: int) -> int:
        from pmtiles.tile import Compression, TileType, zxy_to_tileid
        from pmtiles.writer import Writer

        items = sorted((zxy_to_tileid(z, x, y), b) for z, x, y, b in self.entries)
        with open(path, "wb") as f:
            w = Writer(f)
            for tid, b in items:
                w.write_tile(tid, b)
            w.finalize(
                {"tile_type": TileType.WEBP, "tile_compression": Compression.NONE,
                 "min_zoom": 0, "max_zoom": maxzoom,
                 "min_lon_e7": -1800000000, "max_lon_e7": 1800000000,
                 "min_lat_e7": -850000000, "max_lat_e7": 850000000,
                 "center_zoom": 2, "center_lon_e7": 0, "center_lat_e7": 0},
                meta,
            )
        return len(items)


def merc_grid(z: int, x0: int, y0: int, size: int):
    """lat, lon (degrees) of pixel centres of a size×size block at zoom z."""
    n = 256 * 2**z
    px = (x0 * 256 + np.arange(size) + 0.5) / n
    py = (y0 * 256 + np.arange(size) + 0.5) / n
    return merc_lat(py), px * 360 - 180


def cmd_tiles(year: int) -> None:
    calib = json.loads((OUT / "calibration.json").read_text())
    g = Mosaic(HERE / "glow" / str(year), key="mag", cache=24)
    have = {(int(t[1:3]), int(t[4:6])) for t in g.have}
    t0 = time.time()

    # --- sky brightness, zoom 0–8 (blocks of 8×8 zoom-8 tiles = one zoom-5 tile)
    lp = Pyramid(lambda r: encode_brightening(r), 8)
    for Y in range(32):
        for X in range(32):
            lat, lon = merc_grid(5, X, Y, 256)
            lat_n, lat_s = float(lat[0]), float(lat[-1])
            hs = {int((l + 180) // 10) % 36 for l in (lon[0], lon[-1])}
            vs = {int((90 - l) // 10) for l in (lat_n, lat_s) if -90 < l < 90}
            if not any((h, v) in have for h in range(min(hs), max(hs) + 1) for v in vs):
                continue
            la, lo = merc_grid(8, X * 8, Y * 8, 2048)
            rr = (90 - la) / PIX_DEG
            cc = (lo + 180) / PIX_DEG
            r0 = int(max(0, math.floor(rr.min()) - 1))
            c0 = int(math.floor(cc.min()) - 1)
            win = g.window(r0, c0, int(math.ceil(rr.max())) - r0 + 3, int(math.ceil(cc.max())) - c0 + 3,
                           np.uint16).astype(np.float32)
            if not win.any():
                continue
            R, C = np.meshgrid(rr - r0 - 0.5, cc - c0 - 0.5, indexing="ij")
            # stored: 1000 × mag brightening = 2500 · log10(1 + R)
            lin = 10 ** (bilinear(win, R, C) / 2500.0) - 1
            lp.block(8, X * 8, Y * 8, lin, stop=5)
        print(f"  lp row {Y + 1}/32 ({time.time() - t0:.0f} s, {len(lp.entries)} tiles)", flush=True)
    lp.finish(5)

    # --- upward radiance for light domes, zoom 0–6 (blocks of 8×8 zoom-6 = one zoom-3 tile)
    r60 = Mosaic(HERE / "glow" / str(year), key="rad60", cache=24)
    rad = Pyramid(lambda l: encode_radiance(l), 6)
    step = 1 / 60  # degrees per rad60 pixel
    for Y in range(8):
        for X in range(8):
            la, lo = merc_grid(6, X * 8, Y * 8, 2048)
            # integral image box mean over the rad60 grid (600 px per 10° tile)
            rows = (90 - la) / step
            cols = (lo + 180) / step
            r0 = int(max(0, math.floor(rows.min()) - 2))
            c0 = int(math.floor(cols.min()) - 2)
            nr = int(math.ceil(rows.max())) - r0 + 4
            nc = int(math.ceil(cols.max())) - c0 + 4
            win = np.zeros((nr, nc), np.float32)
            for v in range(max(0, r0 // 600), min(18, (r0 + nr) // 600 + 1)):
                for hh in range(c0 // 600, (c0 + nc) // 600 + 1):
                    t = r60.tile(hh % 36, v)
                    if t is None:
                        continue
                    ar0, ac0 = v * 600 - r0, hh * 600 - c0
                    sr = slice(max(0, ar0), min(nr, ar0 + 600))
                    sc = slice(max(0, ac0), min(nc, ac0 + 600))
                    win[sr, sc] = t[sr.start - ar0 : sr.stop - ar0, sc.start - ac0 : sc.stop - ac0]
            if not win.any():
                continue
            ii = np.pad(win.cumsum(0).cumsum(1), ((1, 0), (1, 0)))
            # pixel edges
            n = 256 * 2**6
            ye = merc_lat((Y * 8 * 256 + np.arange(2049)) / n)
            xe = (X * 8 * 256 + np.arange(2049)) / n * 360 - 180
            re = np.clip((90 - ye) / step - r0, 0, nr)
            ce = np.clip((xe + 180) / step - c0, 0, nc)
            ri = np.rint(re).astype(int)
            ci = np.rint(ce).astype(int)
            ri[1:] = np.maximum(ri[1:], ri[:-1] + 1)
            ci[1:] = np.maximum(ci[1:], ci[:-1] + 1)
            ri = np.minimum(ri, nr)
            ci = np.minimum(ci, nc)
            A_, B_ = ri[:-1, None], ri[1:, None]
            C_, D_ = ci[None, :-1], ci[None, 1:]
            box = ii[B_, D_] - ii[A_, D_] - ii[B_, C_] + ii[A_, C_]
            area = np.maximum((B_ - A_) * (D_ - C_), 1)
            rad.block(6, X * 8, Y * 8, box / area, stop=3)
    rad.finish(3)

    OUT.mkdir(exist_ok=True)
    meta = {"name": f"Artificial sky brightness {year}",
            "attribution": "Model by astro-night-planning-live from NASA Black Marble VNP46A4"}
    n_lp = lp.write(OUT / f"lp-{year}.pmtiles", {**meta, "encoding": "grey/40 = mag brighter than 22.0"}, 8)
    n_rad = rad.write(OUT / f"lprad-{year}.pmtiles",
                      {**meta, "encoding": "L = 0.5 (10^(grey/64) − 1) nW cm-2 sr-1"}, 6)
    best = calib["best"]
    info = {
        "year": year,
        "naturalSqm": NATURAL_SQM,
        "model": {"p": best["p"], "d0Km": best["d0"], "DKm": best["D"], "A": best["A"],
                  "rMaxKm": R_MAX_KM},
        "lp": {"tiles": f"/tiles/lightpollution-{year}/{{z}}/{{x}}/{{y}}.webp", "maxzoom": 8,
               "magPerStep": 0.025},
        "rad": {"tiles": f"/tiles/lprad-{year}/{{z}}/{{x}}/{{y}}.webp", "maxzoom": 6,
                "scale": 64, "ref": 0.5},
        "validation": {k: calib[k] for k in ("best", "by_brightness")},
    }
    (OUT / "lightpollution.json").write_text(json.dumps(info, indent=1))
    for f in (f"lp-{year}.pmtiles", f"lprad-{year}.pmtiles"):
        print(f"{f}: {(OUT / f).stat().st_size / 1e6:.1f} MB")
    print(f"tiles: {n_lp} lp, {n_rad} lprad in {time.time() - t0:.0f} s")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["calibrate", "glow", "tiles", "all"])
    ap.add_argument("--year", type=int, required=True)
    a = ap.parse_args()
    if a.cmd in ("calibrate", "all"):
        cmd_calibrate(a.year)
    if a.cmd in ("glow", "all"):
        cmd_glow(a.year)
    if a.cmd in ("tiles", "all"):
        cmd_tiles(a.year)


if __name__ == "__main__":
    sys.exit(main())
