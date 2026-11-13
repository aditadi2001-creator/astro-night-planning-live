"""End-to-end test of glow + tiles on a synthetic city (run: python -m unittest test_pipeline).

Checks that the published map tiles decode to the same brightness as the
direct model sum, and that the radiance tiles keep the city's radiance."""

import io
import json
import math
import shutil
import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image

import skyglow
from model import PIX_DEG, TILE, decode_brightening, decode_radiance, point_sum

P, D0, DD, A = 2.5, 0.5, 100.0, 0.02
CITY = (51.5, 2.0)  # lat, lon inside tile h18v03 (lon 0..10, lat 60..50)


def merc_pixel(lat, lon, z):
    n = 256 * 2**z
    x = (lon + 180) / 360 * n
    y = (1 - math.log(math.tan(math.pi / 4 + math.radians(lat) / 2)) / math.pi) / 2 * n
    return int(x // 256), int(y // 256), int(x % 256), int(y % 256)


class Pipeline(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.tmp = Path(tempfile.mkdtemp())
        skyglow.HERE = cls.tmp
        skyglow.OUT = cls.tmp / "out"
        raw = cls.tmp / "raw" / "2099"
        raw.mkdir(parents=True)
        rad = np.zeros((TILE, TILE), np.float32)
        r = int((60 - CITY[0]) / PIX_DEG)
        c = int((CITY[1] - 0) / PIX_DEG)
        yy, xx = np.mgrid[-30:31, -45:46]
        rad[r - 30 : r + 31, c - 45 : c + 46] = 60.0 * np.exp(-(yy**2 + (xx * 0.62) ** 2) / 400)
        cls.rad = rad
        np.savez_compressed(raw / "h18v03.npz", rad=rad)
        skyglow.OUT.mkdir()
        (skyglow.OUT / "calibration.json").write_text(json.dumps(
            {"best": {"p": P, "d0": D0, "D": DD, "A": A}, "by_brightness": {}}))
        skyglow.cmd_glow(2099)
        skyglow.cmd_tiles(2099)

    @classmethod
    def tearDownClass(cls) -> None:
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def tile(self, name, z, x, y):
        from pmtiles.reader import MmapSource, Reader

        with open(skyglow.OUT / name, "rb") as f:
            b = Reader(MmapSource(f)).get(z, x, y)
        return None if b is None else np.asarray(Image.open(io.BytesIO(b)).convert("L"))

    def test_sky_brightness_matches_direct_sum(self) -> None:
        for lat, lon in [CITY, (51.5, 2.6), (52.2, 1.0)]:  # centre, ~40 km E, ~110 km NW
            expect = 2.5 * math.log10(1 + A * point_sum(self.rad, 60.0, 0.0, lat, lon, P, D0, DD))
            tx, ty, px, py = merc_pixel(lat, lon, 8)
            img = self.tile("lp-2099.pmtiles", 8, tx, ty)
            # A missing tile means "natural sky" (no brightening stored).
            got = 0.0 if img is None else float(decode_brightening(img[py, px]))
            self.assertAlmostEqual(got, expect, delta=0.06, msg=f"{lat},{lon}")

    def test_far_away_is_natural_sky(self) -> None:
        tx, ty, _, _ = merc_pixel(40.0, -60.0, 8)
        self.assertIsNone(self.tile("lp-2099.pmtiles", 8, tx, ty))

    def test_radiance_tiles_keep_the_city(self) -> None:
        tx, ty, px, py = merc_pixel(*CITY, 6)
        img = self.tile("lprad-2099.pmtiles", 6, tx, ty)
        peak = float(decode_radiance(img[max(0, py - 2) : py + 3, max(0, px - 2) : px + 3].max()))
        self.assertGreater(peak, 25)  # 60 at the core, averaged over ~2 km pixels
        self.assertLess(peak, 65)

    def test_metadata(self) -> None:
        info = json.loads((skyglow.OUT / "lightpollution.json").read_text())
        self.assertEqual(info["lp"]["maxzoom"], 8)
        self.assertEqual(info["model"]["A"], A)


if __name__ == "__main__":
    unittest.main()
