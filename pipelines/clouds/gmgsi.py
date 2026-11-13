"""NOAA GMGSI hourly longwave-infrared mosaic -> one PMTiles file per hour.

Source: public AWS bucket `noaa-gmgsi-pds` (NOAA/NESDIS Global Mosaic of
Geostationary Satellite Imagery; GOES-East/West, Meteosat 0° and IODC,
Himawari). No account needed. Files are ~7 MB NetCDF, one per hour, published
about 40 minutes after the hour.

What the file holds (checked 2026-11-13):
- `data` (1, 3000, 4999) float: 0-255 counts, higher = colder. The counts follow
  the standard IR "brightness" scale T = (660 - count) / 2 kelvin
  (202.5 K at 255 ... 327.5 K at 0); clear-sky values come out a few kelvin
  below the model skin temperature, as water vapour makes them.
- The grid is already Mercator with square pixels: longitude steps 0.072°, and
  rows are uniform in Mercator y between 72.7° N and 72.7° S.

Output: Web Mercator 256 px WebP tiles, zoom 0-5, grey = count (so the client
can recover the temperature), alpha 0 where there is no data. Tiles with no data
are left out. Raw NetCDF files stay on the GitHub runner; only the PMTiles goes
to R2 (via pipelines/r2/r2.py).

Usage:
  python gmgsi.py run --out out/ [--have-url URL] [--max-new 3]
      download and convert the newest hours that are not already published
  python gmgsi.py build FILE.nc OUT.pmtiles     convert one file
"""

from __future__ import annotations

import argparse
import io
import json
import math
import re
import sys
import time
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np

BUCKET = "https://noaa-gmgsi-pds.s3.amazonaws.com"
PRODUCT = "GMGSI_LW"
MAX_ZOOM = 5
TILE = 256
WEBP_QUALITY = 90
UA = {"User-Agent": "astro-night-planning-live pipeline (open source)"}
KEY_RE = re.compile(r"GMGSI_LW/(\d{4})/(\d{2})/(\d{2})/(\d{2})/[^/]+\.nc$")


def count_to_kelvin(count: np.ndarray | float) -> np.ndarray | float:
    """GMGSI longwave count (0-255) -> brightness temperature in kelvin."""
    return (660.0 - np.asarray(count, dtype=np.float64)) / 2.0


# ---------------------------------------------------------------- reading


def read_gmgsi(path: str | Path) -> tuple[np.ndarray, np.ndarray, float, float]:
    """Returns (counts[rows, cols] float32 with NaN for no data,
    source Mercator y per row (radians), lon of column 0, lon step)."""
    import h5py

    with h5py.File(path, "r") as f:
        data = np.asarray(f["data"][0], dtype=np.float32)
        lat = np.asarray(f["lat"][:, 0], dtype=np.float64)
        lon_row = np.asarray(f["lon"][0, :], dtype=np.float64)
    data[(data < 0) | (data > 255)] = np.nan
    # Column 0 is written as +180 and the rest run from -179.93 upward.
    step = float(np.median(np.diff(lon_row[1:])))
    lon0 = float(lon_row[1] - step)
    ys = np.log(np.tan(np.pi / 4 + np.radians(lat) / 2))
    return data, ys, lon0, step


def hour_of(path_or_key: str) -> str:
    m = re.search(r"_s(\d{10})", path_or_key)
    if not m:
        raise ValueError(f"no start time in {path_or_key}")
    return m.group(1)


# ---------------------------------------------------------------- tiling


def world_image(data: np.ndarray, ys: np.ndarray, lon0: float, step: float, z: int):
    """Bilinear resample onto the Web Mercator world image at zoom z.

    Returns (row0, image[rows, N]) for the band of rows that has data;
    NaN where there is none."""
    n = TILE * 2**z
    nrow, ncol = data.shape
    y_top, y_bot = ys[0], ys[-1]
    # Output rows whose centre falls inside the source latitude band.
    py = np.arange(n)
    merc_y = np.pi * (1 - 2 * (py + 0.5) / n)
    rows = py[(merc_y <= y_top) & (merc_y >= y_bot)]
    row0 = int(rows[0])
    my = np.pi * (1 - 2 * (rows + 0.5) / n)
    # Source row (fractional) for each output row; ys decreases with row index.
    src_r = np.interp(-my, -ys, np.arange(nrow, dtype=np.float64))
    lon = (np.arange(n) + 0.5) / n * 360.0 - 180.0
    src_c = (lon - lon0) / step
    r0 = np.clip(np.floor(src_r).astype(np.int64), 0, nrow - 2)
    fr = (src_r - r0)[:, None]
    c0 = np.floor(src_c).astype(np.int64)
    fc = (src_c - c0)[None, :]
    c0 %= ncol
    c1 = (c0 + 1) % ncol
    a = data[r0][:, c0]
    b = data[r0][:, c1]
    c = data[r0 + 1][:, c0]
    d = data[r0 + 1][:, c1]
    top = a * (1 - fc) + b * fc
    bot = c * (1 - fc) + d * fc
    img = top * (1 - fr) + bot * fr
    return row0, img.astype(np.float32)


def downsample(img: np.ndarray, row0: int) -> tuple[int, np.ndarray]:
    """Halve resolution, averaging only valid (non-NaN) pixels."""
    if row0 % 2:
        img = np.vstack([np.full((1, img.shape[1]), np.nan, np.float32), img])
        row0 -= 1
    if img.shape[0] % 2:
        img = np.vstack([img, np.full((1, img.shape[1]), np.nan, np.float32)])
    h, w = img.shape
    blocks = img.reshape(h // 2, 2, w // 2, 2)
    with np.errstate(invalid="ignore"):
        out = np.nanmean(blocks, axis=(1, 3))
    return row0 // 2, out.astype(np.float32)


def encode_tile(tile: np.ndarray) -> bytes | None:
    from PIL import Image

    valid = np.isfinite(tile)
    if not valid.any():
        return None
    grey = np.where(valid, np.clip(np.rint(tile), 0, 255), 0).astype(np.uint8)
    if valid.all():
        im = Image.fromarray(np.dstack([grey, grey, grey]), "RGB")
    else:
        alpha = (valid * 255).astype(np.uint8)
        im = Image.fromarray(np.dstack([grey, grey, grey, alpha]), "RGBA")
    buf = io.BytesIO()
    # libwebp stores the alpha plane losslessly, so alpha 0 reliably marks
    # "no data". Quality 90: 95 % of pixels within 3 counts (1.5 K) of the
    # resampled source, ~4.3 MB per hour for zoom 0-5.
    im.save(buf, "WEBP", quality=WEBP_QUALITY, method=4)
    return buf.getvalue()


def build_pmtiles(nc_path: str | Path, out_path: str | Path) -> dict:
    from pmtiles.tile import Compression, TileType, zxy_to_tileid
    from pmtiles.writer import Writer

    t0 = time.time()
    data, ys, lon0, step = read_gmgsi(nc_path)
    hour = hour_of(str(nc_path))
    entries: list[tuple[int, bytes]] = []
    row0, img = world_image(data, ys, lon0, step, MAX_ZOOM)
    for z in range(MAX_ZOOM, -1, -1):
        if z < MAX_ZOOM:
            row0, img = downsample(img, row0)
        n = 2**z
        for ty in range(n):
            a, b = ty * TILE, (ty + 1) * TILE
            lo, hi = max(a, row0), min(b, row0 + img.shape[0])
            if lo >= hi:
                continue
            band = np.full((TILE, n * TILE), np.nan, np.float32)
            band[lo - a : hi - a] = img[lo - row0 : hi - row0]
            for tx in range(n):
                blob = encode_tile(band[:, tx * TILE : (tx + 1) * TILE])
                if blob:
                    entries.append((zxy_to_tileid(z, tx, ty), blob))
    entries.sort(key=lambda e: e[0])
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    lat_n = math.degrees(2 * math.atan(math.exp(ys[0])) - math.pi / 2)
    lat_s = math.degrees(2 * math.atan(math.exp(ys[-1])) - math.pi / 2)
    with open(out_path, "wb") as f:
        w = Writer(f)
        for tid, blob in entries:
            w.write_tile(tid, blob)
        w.finalize(
            {
                "tile_type": TileType.WEBP,
                "tile_compression": Compression.NONE,
                "min_zoom": 0,
                "max_zoom": MAX_ZOOM,
                "min_lon_e7": -1800000000,
                "max_lon_e7": 1800000000,
                "min_lat_e7": int(lat_s * 1e7),
                "max_lat_e7": int(lat_n * 1e7),
                "center_zoom": 1,
                "center_lon_e7": 0,
                "center_lat_e7": 0,
            },
            {
                "name": f"GMGSI longwave IR {hour}",
                "attribution": "NOAA/NESDIS GMGSI",
                "description": "grey = GMGSI count; T(K) = (660 - grey) / 2; alpha 0 = no data",
                "hour": hour,
            },
        )
    info = {
        "hour": hour,
        "tiles": len(entries),
        "bytes": out_path.stat().st_size,
        "seconds": round(time.time() - t0, 1),
    }
    print(f"built {out_path.name}: {info['tiles']} tiles, {info['bytes'] / 1e6:.1f} MB "
          f"in {info['seconds']} s")
    return info


# ---------------------------------------------------------------- fetching


def list_keys(day: datetime) -> list[str]:
    prefix = f"{PRODUCT}/{day:%Y/%m/%d}/"
    with urllib.request.urlopen(
        urllib.request.Request(f"{BUCKET}/?list-type=2&prefix={prefix}", headers=UA), timeout=60
    ) as r:
        xml = r.read().decode()
    return sorted(k for k in re.findall(r"<Key>([^<]+)</Key>", xml) if KEY_RE.search(k))


def published_hours(url: str | None) -> set[str]:
    if not url:
        return set()
    # A unique query string bypasses the Worker's cache: the list must be fresh
    # so a second run in the same hour sees that the hour is already published.
    url = f"{url}{'&' if '?' in url else '?'}fresh={int(time.time())}"
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
            return {h["hour"] for h in json.load(r).get("hours", [])}
    except Exception as e:  # first run, or the Worker is down: just rebuild
        print(f"could not read {url}: {e}")
        return set()


def cmd_run(out: Path, have_url: str | None, max_new: int, keep_hours: int) -> None:
    now = datetime.now(timezone.utc)
    keys = list_keys(now - timedelta(days=1)) + list_keys(now)
    cutoff = (now - timedelta(hours=keep_hours)).strftime("%Y%m%d%H")
    have = published_hours(have_url)
    todo = [k for k in reversed(keys) if hour_of(k) >= cutoff and hour_of(k) not in have]
    todo = todo[:max_new]
    if not todo:
        print("nothing new: the latest GMGSI hours are already published")
        return
    raw = out / "raw"
    raw.mkdir(parents=True, exist_ok=True)
    for key in todo:
        local = raw / key.rsplit("/", 1)[1]
        print(f"download {key}")
        with urllib.request.urlopen(
            urllib.request.Request(f"{BUCKET}/{key}", headers=UA), timeout=300
        ) as r:
            local.write_bytes(r.read())
        build_pmtiles(local, out / f"{hour_of(key)}.pmtiles")
        local.unlink()  # raw files never leave the runner


def main() -> None:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run")
    r.add_argument("--out", default="out")
    r.add_argument("--have-url", help="published latest.json (skip hours already in R2)")
    r.add_argument("--max-new", type=int, default=3)
    r.add_argument("--keep-hours", type=int, default=24)
    b = sub.add_parser("build")
    b.add_argument("nc")
    b.add_argument("out")
    a = ap.parse_args()
    if a.cmd == "run":
        cmd_run(Path(a.out), a.have_url, a.max_new, a.keep_hours)
    else:
        build_pmtiles(a.nc, a.out)


if __name__ == "__main__":
    sys.exit(main())
