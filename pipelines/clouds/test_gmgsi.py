"""Tests for the GMGSI tiler (run: python -m unittest test_gmgsi). Synthetic data, no download."""

import io
import math
import unittest

import numpy as np
from PIL import Image

from gmgsi import count_to_kelvin, downsample, encode_tile, world_image


def synthetic(nrow=600, ncol=1000, lat_max=72.7):
    """A Mercator grid like GMGSI's whose value encodes its own longitude band."""
    y_max = math.log(math.tan(math.pi / 4 + math.radians(lat_max) / 2))
    ys = np.linspace(y_max, -y_max, nrow)
    step = 360.0 / ncol
    lon0 = -180.0
    lon = lon0 + step * np.arange(ncol)
    data = np.tile(((lon + 180) / 360 * 250).astype(np.float32), (nrow, 1))
    return data, ys, lon0, step


class Tiler(unittest.TestCase):
    def test_scale(self) -> None:
        self.assertAlmostEqual(count_to_kelvin(74), 293.0)
        self.assertAlmostEqual(count_to_kelvin(255), 202.5)

    def test_resample_keeps_longitude_and_latitude_band(self) -> None:
        data, ys, lon0, step = synthetic()
        row0, img = world_image(data, ys, lon0, step, 2)  # 1024 px world
        n = 1024
        # Rows cover only the data's latitude band (72.7° N-S), symmetric.
        last = row0 + img.shape[0] - 1
        self.assertAlmostEqual(row0, n - 1 - last, delta=1)
        lat_top = math.degrees(2 * math.atan(math.exp(math.pi * (1 - 2 * (row0 + 0.5) / n))) - math.pi / 2)
        self.assertLess(lat_top, 72.8)
        self.assertGreater(lat_top, 72.0)
        # Value at the column for lon = 90° E matches the source encoding.
        col = int((90 + 180) / 360 * n)
        self.assertAlmostEqual(float(img[img.shape[0] // 2, col]), (90 + 180) / 360 * 250, delta=0.5)

    def test_downsample_averages_valid_pixels_only(self) -> None:
        img = np.array([[10, np.nan], [30, np.nan]], np.float32)
        row0, out = downsample(img, 0)
        self.assertEqual(row0, 0)
        self.assertAlmostEqual(float(out[0, 0]), 20.0)

    def test_tile_alpha_marks_no_data(self) -> None:
        t = np.full((256, 256), 120, np.float32)
        t[:100] = np.nan
        im = np.asarray(Image.open(io.BytesIO(encode_tile(t))).convert("RGBA"))
        self.assertTrue((im[:100, :, 3] == 0).all())
        self.assertTrue((im[100:, :, 3] == 255).all())
        self.assertLessEqual(abs(int(np.median(im[150:, :, 0])) - 120), 2)
        self.assertIsNone(encode_tile(np.full((256, 256), np.nan, np.float32)))


if __name__ == "__main__":
    unittest.main()
