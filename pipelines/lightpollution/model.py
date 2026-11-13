"""Artificial sky brightness from satellite night lights (pure functions, tested).

A light-propagation model in the style of Garstang (1986) and Cinzano &
Falchi (World Atlas 2001/2016), simplified to a distance kernel:

    R(x) = A · Σ_j L_j · a_j · K(d_xj)                      (zenith, ratio to natural)
    K(d) = (d² + d0²)^(−p/2) · e^(−d/D),   d ≤ R_MAX

L = upward radiance from NASA Black Marble VNP46A4 (nW cm⁻² sr⁻¹), a = pixel
area (km²), d = distance (km). p ≈ 2.5 is Walker's law (sky glow ∝ d^−2.5 at
10–100 km); d0 softens the near field (inside a city the glow levels off);
D adds extinction at long range. A, p and D are fitted to open Globe at Night
SQM readings (calibrate.py); the fit and its typical error go in the README.

Total zenith brightness relative to the natural sky (22.0 mag/arcsec² in V,
the moonless zenith at solar minimum used by the app elsewhere):

    SQM = 22.0 − 2.5 log10(1 + R)

Grid: VNP46A4 tiles are 10°×10°, 2400×2400 pixels of 15″ (1/240°), tile hHHvVV
covering lon −180+10·HH … and lat 90−10·VV … downwards.
"""

from __future__ import annotations

import math

import numpy as np

NATURAL_SQM = 22.0
PIX_DEG = 1 / 240  # 15 arc-seconds
TILE = 2400
KM_PER_DEG = 111.195  # mean Earth radius 6371 km
R_MAX_KM = 150.0


def kernel_value(d_km: np.ndarray, p: float, d0: float, D: float) -> np.ndarray:
    k = (d_km**2 + d0**2) ** (-p / 2) * np.exp(-d_km / D)
    return np.where(d_km <= R_MAX_KM, k, 0.0)


def pixel_size_km(lat_deg: float) -> tuple[float, float]:
    """(dx, dy) of a 15″ pixel at latitude lat, km."""
    dy = PIX_DEG * KM_PER_DEG
    return dy * math.cos(math.radians(lat_deg)), dy


def kernel_grid(lat_deg: float, p: float, d0: float, D: float, step: int = 1):
    """2-D kernel on the 15″ grid at a latitude (pixels `step`× coarser), times pixel area.

    Convolving radiance (nW cm⁻² sr⁻¹) with it gives the un-scaled sum S."""
    dx, dy = pixel_size_km(lat_deg)
    dx *= step
    dy *= step
    nx = int(math.ceil(R_MAX_KM / dx))
    ny = int(math.ceil(R_MAX_KM / dy))
    yy, xx = np.mgrid[-ny : ny + 1, -nx : nx + 1]
    d = np.hypot(xx * dx, yy * dy)
    return (kernel_value(d, p, d0, D) * dx * dy).astype(np.float32)


def fft_convolve(a: np.ndarray, k: np.ndarray) -> np.ndarray:
    """'same'-size linear convolution via real FFTs (a and k float32)."""
    sh = (a.shape[0] + k.shape[0] - 1, a.shape[1] + k.shape[1] - 1)
    fs = [int(2 ** math.ceil(math.log2(s))) if s < 4096 else s + (-s) % 64 for s in sh]
    out = np.fft.irfft2(np.fft.rfft2(a, fs) * np.fft.rfft2(k, fs), fs)
    oy = (k.shape[0] - 1) // 2
    ox = (k.shape[1] - 1) // 2
    return out[oy : oy + a.shape[0], ox : ox + a.shape[1]].astype(np.float32)


def point_sum(rad: np.ndarray, lat0: float, lon0: float, lat: float, lon: float,
              p: float, d0: float, D: float) -> float:
    """S at one place from a radiance mosaic whose top-left pixel corner is (lat0, lon0)."""
    dx, dy = pixel_size_km(lat)
    row = (lat0 - lat) / PIX_DEG
    col = (lon - lon0) / PIX_DEG
    ny = int(math.ceil(R_MAX_KM / dy))
    nx = int(math.ceil(R_MAX_KM / dx))
    r0, c0 = int(row) - ny, int(col) - nx
    r1, c1 = int(row) + ny + 1, int(col) + nx + 1
    sub = rad[max(0, r0) : max(0, r1), max(0, c0) : max(0, c1)]
    if not sub.size:
        return 0.0
    yy = np.arange(max(0, r0), max(0, r0) + sub.shape[0]) + 0.5 - row
    xx = np.arange(max(0, c0), max(0, c0) + sub.shape[1]) + 0.5 - col
    d = np.hypot(xx[None, :] * dx, yy[:, None] * dy)
    return float((sub * kernel_value(d, p, d0, D)).sum() * dx * dy)


def sqm_from_ratio(r: np.ndarray | float) -> np.ndarray | float:
    return NATURAL_SQM - 2.5 * np.log10(1 + np.asarray(r, dtype=np.float64))


# Bortle class from zenith SQM. The Bortle scale is visual, so any SQM mapping
# is approximate; these are the commonly quoted boundaries.
BORTLE_LIMITS = [(21.99, 1), (21.89, 2), (21.69, 3), (20.49, 4), (19.50, 5),
                 (18.94, 6), (18.38, 7), (17.80, 8)]


def bortle(sqm: float) -> int:
    for lim, b in BORTLE_LIMITS:
        if sqm >= lim:
            return b
    return 9


# ---- tile encodings (documented in data/lightpollution.json for the app) ----

LP_STEP_MAG = 1 / 40  # grey level = brightening in 1/40 mag (0 = natural sky)


def encode_brightening(r: np.ndarray) -> np.ndarray:
    """Ratio R → uint8 grey = round(40 · 2.5 log10(1 + R)), capped at 255 (6.4 mag)."""
    mag = 2.5 * np.log10(1 + np.maximum(r, 0))
    return np.clip(np.rint(mag / LP_STEP_MAG), 0, 255).astype(np.uint8)


def decode_brightening(v: np.ndarray | int) -> np.ndarray | float:
    return np.asarray(v, dtype=np.float64) * LP_STEP_MAG


RAD_SCALE = 64.0
RAD_REF = 0.5  # nW cm⁻² sr⁻¹


def encode_radiance(l: np.ndarray) -> np.ndarray:
    """Radiance → uint8 = round(64 log10(1 + L/0.5)), up to ~2,000 nW cm⁻² sr⁻¹."""
    return np.clip(np.rint(RAD_SCALE * np.log10(1 + np.maximum(l, 0) / RAD_REF)), 0, 255).astype(
        np.uint8)


def decode_radiance(v: np.ndarray | int) -> np.ndarray | float:
    return RAD_REF * (10 ** (np.asarray(v, dtype=np.float64) / RAD_SCALE) - 1)


def tile_bounds(h: int, v: int) -> tuple[float, float, float, float]:
    """(lon_west, lat_north, lon_east, lat_south) of VNP46 tile hHHvVV."""
    west = -180 + 10 * h
    north = 90 - 10 * v
    return west, north, west + 10, north - 10
