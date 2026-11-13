"""Download NASA Black Marble VNP46A4 (yearly night lights) and keep one layer.

Needs EARTHDATA_TOKEN (an Earthdata Login bearer token) in the environment:
a GitHub Actions secret in CI, or a git-ignored .env file locally. Tokens
expire after about 60 days; when it has expired this script stops with a
clear message and nothing is uploaded, so the site keeps its existing map.

Each tile is a 10°×10° HDF5 file (median ~75 MB, ~53 GB for the world). We
need one dataset of it, AllAngle_Composite_Snow_Free (uint16, 0.1 nW cm⁻² sr⁻¹
per count), so each file is read with HTTP range requests where the server
allows it, and downloaded whole otherwise. Only the extracted layer is kept,
as raw/<year>/hHHvVV.npz (radiance in nW cm⁻² sr⁻¹, float32). The HDF5 files
are deleted at once; nothing raw ever goes to R2.

Usage: python fetch.py --year 2025 [--tiles h17v03,h18v03] [--workers 6]
"""

from __future__ import annotations

import argparse
import concurrent.futures as cf
import json
import os
import re
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
BASE = "https://ladsweb.modaps.eosdis.nasa.gov/archive/allData/5200/VNP46A4"
LAYER = "AllAngle_Composite_Snow_Free"
FALLBACK = "AllAngle_Composite_Snow_Covered"
UA = "astro-night-planning-live pipeline (open source, yearly)"


class TokenError(SystemExit):
    pass


def token() -> str:
    t = os.environ.get("EARTHDATA_TOKEN", "").strip()
    if not t:
        env = HERE.parent.parent / ".env"
        if env.exists():
            for line in env.read_text(encoding="utf-8").splitlines():
                if line.startswith("EARTHDATA_TOKEN="):
                    t = line.split("=", 1)[1].strip().strip('"').strip("'")
    if not t:
        raise TokenError(
            "EARTHDATA_TOKEN is not set. Create one at https://urs.earthdata.nasa.gov "
            "(Generate Token) and save it as the GitHub secret EARTHDATA_TOKEN."
        )
    return t


def list_tiles(year: int) -> list[dict]:
    req = urllib.request.Request(f"{BASE}/{year}/001.json", headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.load(r)["content"]


def latest_year() -> int:
    req = urllib.request.Request(f"{BASE}.json", headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=120) as r:
        return max(int(i["name"]) for i in json.load(r)["content"] if i["name"].isdigit())


def tile_id(name: str) -> str:
    m = re.search(r"\.(h\d{2}v\d{2})\.", name)
    if not m:
        raise ValueError(name)
    return m.group(1)


def _read_layer(h5file) -> np.ndarray:
    import h5py

    found: dict[str, h5py.Dataset] = {}

    def visit(name, obj):
        if isinstance(obj, h5py.Dataset):
            leaf = name.rsplit("/", 1)[-1]
            if leaf in (LAYER, FALLBACK):
                found[leaf] = obj

    with h5py.File(h5file, "r") as f:
        f.visititems(visit)
        if LAYER not in found:
            raise RuntimeError(f"{LAYER} not found")

        def load(ds):
            raw = ds[()].astype(np.float32)
            fill = ds.attrs.get("_FillValue", 65535)
            scale = float(np.ravel(ds.attrs.get("scale_factor", [0.1]))[0])
            offset = float(np.ravel(ds.attrs.get("add_offset", [0.0]))[0])
            bad = raw == float(np.ravel(fill)[0])
            out = raw * scale + offset
            out[bad] = np.nan
            return out

        rad = load(found[LAYER])
        if FALLBACK in found and np.isnan(rad).any():
            alt = load(found[FALLBACK])
            rad = np.where(np.isnan(rad), alt, rad)
    return np.nan_to_num(rad, nan=0.0).clip(min=0)


def _check_auth(code: int) -> None:
    if code in (401, 403) or code in (301, 302, 303):
        raise TokenError(
            f"LAADS refused the download (HTTP {code}): EARTHDATA_TOKEN is wrong or has "
            "expired (they last ~60 days). Generate a new one at https://urs.earthdata.nasa.gov "
            "and update the GitHub secret. The site keeps showing the current map meanwhile."
        )


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):  # an auth problem shows up as a redirect
        return None


def fetch_one(name: str, year: int, tok: str, out: Path) -> tuple[str, str, float]:
    tid = tile_id(name)
    dest = out / f"{tid}.npz"
    if dest.exists():
        return tid, "cached", 0.0
    url = f"{BASE}/{year}/001/{name}"
    headers = {"Authorization": f"Bearer {tok}", "User-Agent": UA}
    t0 = time.time()
    rad = None
    how = "range"
    try:
        import fsspec

        fs = fsspec.filesystem("http", headers=headers, client_kwargs={"trust_env": True})
        with fs.open(url, "rb", block_size=4 * 2**20, cache_type="blockcache") as fh:
            rad = _read_layer(fh)
    except TokenError:
        raise
    except Exception as e:  # no range support or a hiccup: download the whole file
        how = f"full ({type(e).__name__})"
    if rad is None:
        opener = urllib.request.build_opener(_NoRedirect)
        req = urllib.request.Request(url, headers=headers)
        for attempt in range(4):
            try:
                with opener.open(req, timeout=600) as r, tempfile.NamedTemporaryFile(
                    suffix=".h5", delete=False, dir=out
                ) as tmp:
                    while chunk := r.read(8 * 2**20):
                        tmp.write(chunk)
                    path = tmp.name
                try:
                    rad = _read_layer(path)
                finally:
                    os.unlink(path)  # the HDF5 file never stays on disk
                break
            except urllib.error.HTTPError as e:
                _check_auth(e.code)
                if attempt == 3:
                    raise
                time.sleep(10 * (attempt + 1))
            except (urllib.error.URLError, TimeoutError):
                if attempt == 3:
                    raise
                time.sleep(10 * (attempt + 1))
    np.savez_compressed(dest, rad=rad.astype(np.float32))
    return tid, how, time.time() - t0


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--year", type=int, default=0, help="0 = newest available")
    ap.add_argument("--tiles", default="", help="comma list, e.g. h17v03,h18v03 (default: all)")
    ap.add_argument("--workers", type=int, default=6)
    a = ap.parse_args()
    year = a.year or latest_year()
    tok = token()
    files = list_tiles(year)
    want = {t.strip() for t in a.tiles.split(",") if t.strip()}
    if want:
        files = [f for f in files if tile_id(f["name"]) in want]
    out = HERE / "raw" / str(year)
    out.mkdir(parents=True, exist_ok=True)
    print(f"VNP46A4 {year}: {len(files)} tiles, "
          f"{sum(int(f['size']) for f in files) / 1e9:.1f} GB as HDF5")
    # Check the token on one tile before starting the pool.
    first = fetch_one(files[0]["name"], year, tok, out)
    print(f"  {first[0]}: {first[1]} {first[2]:.0f} s", flush=True)
    done = 1
    with cf.ThreadPoolExecutor(a.workers) as pool:
        futs = [pool.submit(fetch_one, f["name"], year, tok, out) for f in files[1:]]
        for fu in cf.as_completed(futs):
            tid, how, s = fu.result()
            done += 1
            if done % 25 == 0 or how.startswith("full"):
                print(f"  {done}/{len(files)} {tid}: {how} {s:.0f} s", flush=True)
    (out / "year.txt").write_text(str(year))
    print(f"done: {done} tiles in {out}")


if __name__ == "__main__":
    try:
        main()
    except TokenError as e:
        print(f"::error::{e}", file=sys.stderr)
        sys.exit(2)
