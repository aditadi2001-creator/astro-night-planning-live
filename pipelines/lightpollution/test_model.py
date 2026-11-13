"""Tests for the sky-glow model (run: python -m unittest test_model). Synthetic data only."""

import math
import unittest

import numpy as np

from model import (
    NATURAL_SQM,
    PIX_DEG,
    bortle,
    decode_brightening,
    decode_radiance,
    encode_brightening,
    encode_radiance,
    fft_convolve,
    kernel_grid,
    kernel_value,
    pixel_size_km,
    point_sum,
    sqm_from_ratio,
    tile_bounds,
)

P, D0, DD = 2.5, 0.5, 100.0


class Kernel(unittest.TestCase):
    def test_walkers_law_slope(self) -> None:
        # Between 10 and 40 km (D = ∞) the kernel falls as d^-2.5.
        k = kernel_value(np.array([10.0, 40.0]), 2.5, 0.0, 1e12)
        self.assertAlmostEqual(math.log(k[0] / k[1]) / math.log(4), 2.5, places=6)

    def test_cut_off_beyond_r_max(self) -> None:
        self.assertEqual(float(kernel_value(np.array([151.0]), P, D0, DD)[0]), 0.0)

    def test_pixel_shrinks_east_west_with_latitude(self) -> None:
        dx0, dy0 = pixel_size_km(0)
        dx60, dy60 = pixel_size_km(60)
        self.assertAlmostEqual(dy0, 0.4633, places=3)
        self.assertAlmostEqual(dx60 / dx0, 0.5, places=6)
        self.assertAlmostEqual(dy60, dy0, places=9)

    def test_fft_matches_direct_sum(self) -> None:
        rng = np.random.default_rng(3)
        rad = np.zeros((700, 700), np.float32)
        rad[300:340, 320:350] = rng.uniform(5, 50, (40, 30))  # a small "town"
        k = kernel_grid(45.0, P, D0, DD)
        conv = fft_convolve(rad, k)
        lat0, lon0 = 46.0, 10.0  # top-left corner of the mosaic
        for (r, c) in [(320, 335), (100, 600), (500, 150)]:  # all within 150 km
            lat = lat0 - (r + 0.5) * PIX_DEG
            lon = lon0 + (c + 0.5) * PIX_DEG
            direct = point_sum(rad, lat0, lon0, lat, lon, P, D0, DD)
            self.assertAlmostEqual(float(conv[r, c]) / direct, 1.0, delta=0.02)


class Brightness(unittest.TestCase):
    def test_sqm(self) -> None:
        self.assertEqual(float(sqm_from_ratio(0)), NATURAL_SQM)
        self.assertAlmostEqual(float(sqm_from_ratio(9)), NATURAL_SQM - 2.5, places=9)

    def test_bortle(self) -> None:
        self.assertEqual(bortle(22.0), 1)
        self.assertEqual(bortle(21.3), 4)
        self.assertEqual(bortle(19.0), 6)
        self.assertEqual(bortle(17.0), 9)

    def test_encodings_round_trip(self) -> None:
        r = np.array([0, 0.1, 1, 10, 100])
        mag = 2.5 * np.log10(1 + r)
        back = decode_brightening(encode_brightening(r))
        self.assertTrue(np.all(np.abs(back - mag) <= 1 / 80 + 1e-9))
        self.assertEqual(int(encode_brightening(np.array([1e9]))[0]), 255)
        l = np.array([0, 1, 10, 100, 1000])
        rel = decode_radiance(encode_radiance(l)) / np.maximum(l, 1e-9)
        self.assertTrue(np.all(np.abs(rel[1:] - 1) < 0.04))

    def test_tile_bounds(self) -> None:
        self.assertEqual(tile_bounds(17, 3), (-10, 60, 0, 50))
        self.assertEqual(tile_bounds(0, 0), (-180, 90, -170, 80))


if __name__ == "__main__":
    unittest.main()
