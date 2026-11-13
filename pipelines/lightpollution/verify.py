"""Check a freshly uploaded light-pollution year through the data Worker before
the site switches to it (and before the previous year is deleted).

Reads the new year's tiles at a few places with well-known skies and fails
unless they look sane: big-city centres strongly brightened, the deep Sahara
and mid-Pacific at (or very near) natural darkness.

Usage: python verify.py --year 2025 --base https://<worker>.workers.dev
"""

from __future__ import annotations

import argparse
import io
import math
import sys
import urllib.error
import urllib.request

from model import decode_brightening

UA = {"User-Agent": "astro-night-planning-live pipeline (open source)"}

# (name, lat, lon, min brightening mag, max brightening mag)
CHECKS = [
    ("London centre", 51.507, -0.128, 3.0, 6.4),
    ("Delhi centre", 28.613, 77.209, 3.0, 6.4),
    ("New York (Manhattan)", 40.758, -73.986, 3.0, 6.4),
    ("Central Sahara", 23.0, 12.0, 0.0, 0.1),
    ("Mid-Pacific", 0.0, -150.0, 0.0, 0.05),
]


def brightening(base: str, year: int, lat: float, lon: float, z: int = 8) -> float:
    from PIL import Image

    n = 256 * 2**z
    x = (lon + 180) / 360 * n
    y = (1 - math.log(math.tan(math.pi / 4 + math.radians(lat) / 2)) / math.pi) / 2 * n
    url = f"{base}/tiles/lightpollution-{year}/{z}/{int(x // 256)}/{int(y // 256)}.webp"
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
            img = Image.open(io.BytesIO(r.read())).convert("L")
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return 0.0  # no tile = natural sky
        raise
    return float(decode_brightening(img.getpixel((int(x % 256), int(y % 256)))))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--year", type=int, required=True)
    ap.add_argument("--base", required=True)
    a = ap.parse_args()
    bad = 0
    for name, lat, lon, lo, hi in CHECKS:
        b = brightening(a.base.rstrip("/"), a.year, lat, lon)
        ok = lo <= b <= hi
        bad += not ok
        print(f"{'ok ' if ok else 'BAD'} {name}: {b:.2f} mag brighter than natural "
              f"(SQM {22.0 - b:.2f}; expected {lo}–{hi})")
    if bad:
        sys.exit(f"{bad} check(s) failed: the site keeps the previous map.")
    print("all checks passed")


if __name__ == "__main__":
    main()
