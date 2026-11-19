"""Dev-time only: deep-sky alt/az reference values from Astropy for tests/accuracy.test.ts.

    python -m pip install astropy
    python scripts/accuracy/astropy_dso.py

Apparent alt/az with refraction for 1010 hPa and 10 °C (the conditions the app's standard
refraction assumes), observer = the Bangalore preset (public city centre, 0.01° rounding).
Nothing from this script ships in the app.
"""

import json
from pathlib import Path

import astropy.units as u
from astropy.coordinates import AltAz, EarthLocation, SkyCoord
from astropy.time import Time
from astropy.utils import iers

# Offline-friendly: no IERS download (DUT1 error < 1 s ≈ 15″ of azimuth, far below 0.1°).
iers.conf.auto_download = False
iers.conf.iers_degraded_accuracy = "warn"

SITE = EarthLocation(lon=77.59 * u.deg, lat=12.97 * u.deg, height=920 * u.m)
TIME = "2026-11-19T16:00:00"  # 21:30 IST

OBJECTS = {
    "M 31": ("00h42m44.3s", "+41d16m09s"),
    "M 33": ("01h33m50.9s", "+30d39m37s"),
    "M 42": ("05h35m17.3s", "-05d23m28s"),
    "M 45": ("03h47m24s", "+24d07m00s"),
    "M 1": ("05h34m31.9s", "+22d00m52s"),
    "NGC 253": ("00h47m33.1s", "-25d17m18s"),
    "NGC 7000": ("20h58m47s", "+44d19m48s"),
    "M 15": ("21h29m58.3s", "+12d10m01s"),
}

frame = AltAz(
    obstime=Time(TIME, scale="utc"),
    location=SITE,
    pressure=1010 * u.hPa,
    temperature=10 * u.deg_C,
    relative_humidity=0,
    obswl=0.55 * u.micron,
)

out = {
    "source": "Astropy " + __import__("astropy").__version__ + ", scripts/accuracy/astropy_dso.py",
    "time": TIME + "Z",
    "site": {"lat": 12.97, "lon": 77.59, "m": 920},
    "objects": [],
}
for name, (ra, dec) in OBJECTS.items():
    c = SkyCoord(ra, dec, frame="icrs")
    aa = c.transform_to(frame)
    out["objects"].append(
        {
            "name": name,
            "ra": round(c.ra.deg, 6),
            "dec": round(c.dec.deg, 6),
            "alt": round(aa.alt.deg, 6),
            "az": round(aa.az.deg, 6),
        }
    )

dest = Path(__file__).resolve().parents[2] / "tests" / "fixtures" / "astropy-dso-bangalore.json"
dest.write_text(json.dumps(out, indent=1) + "\n", encoding="utf-8")
print("wrote", dest)
for o in out["objects"]:
    print(f"  {o['name']:9s} alt {o['alt']:7.3f}  az {o['az']:7.3f}")
