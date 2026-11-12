"""Milky Way background survey from ESA's Gaia EDR3 all-sky colour map.

Source: "The colour of the sky from Gaia's Early Data Release 3",
ESA/Gaia/DPAC, CC BY-SA 3.0 IGO, acknowledgement A. Moitinho. The derived
tiles are distributed under the same license.

The source is a Hammer-Aitoff projection in galactic coordinates, centred on
the Galactic centre, with the ellipse filling the frame. That is exactly the
FITS ``AIT`` projection: the full width spans 4*sqrt(2) radians of the
projection plane and the height 2*sqrt(2). We attach that WCS, reproject to
an equatorial HiPS (512 px tiles) and save WebP tiles the engine can read.
"""

from __future__ import annotations

import argparse
import math
import shutil
import tempfile
from pathlib import Path

import numpy as np
from astropy.wcs import WCS
from PIL import Image
from reproject import reproject_interp
from reproject.hips import reproject_to_hips

HERE = Path(__file__).resolve().parent
RAW = HERE / "raw"
Image.MAX_IMAGE_PIXELS = None


def ait_wcs(width: int, height: int) -> WCS:
    w = WCS(naxis=2)
    w.wcs.ctype = ["GLON-AIT", "GLAT-AIT"]
    w.wcs.crval = [0.0, 0.0]
    w.wcs.crpix = [(width + 1) / 2, (height + 1) / 2]
    span_x = 4 * math.sqrt(2) * 180 / math.pi  # projection-plane degrees
    span_y = 2 * math.sqrt(2) * 180 / math.pi
    w.wcs.cdelt = [-span_x / width, span_y / height]  # longitude grows to the left
    return w


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--level", type=int, default=1, help="max HiPS order (0 = 12 tiles)")
    ap.add_argument("--quality", type=int, default=82)
    ap.add_argument("--out", default=str(HERE.parent.parent / "public" / "skydata" / "surveys" / "milkyway"))
    args = ap.parse_args()

    img = Image.open(RAW / "gaia_sky_colour_edr3.png").convert("RGB")
    # Order 1 tiles at 512 px resolve ~3.4', so 4000 px wide input is plenty.
    img = img.resize((4000, 2000), Image.LANCZOS)
    rgb = np.flipud(np.asarray(img, dtype=np.float32))  # FITS: row 0 is the bottom
    wcs = ait_wcs(rgb.shape[1], rgb.shape[0])

    out = Path(args.out)
    if out.exists():
        shutil.rmtree(out)
    with tempfile.TemporaryDirectory() as tmp:
        planes = []
        for ch in range(3):
            d = Path(tmp) / f"c{ch}"
            reproject_to_hips(
                (rgb[:, :, ch], wcs),
                coord_system_out="equatorial",
                level=args.level,
                reproject_function=reproject_interp,
                output_directory=d,
                tile_size=512,
                progress_bar=None,
                threads=True,
            )
            planes.append(d)
        n = 0
        for f in sorted(planes[0].rglob("Npix*.fits")):
            rel = f.relative_to(planes[0])
            from astropy.io import fits

            chans = [np.nan_to_num(fits.getdata(p / rel)) for p in planes]
            tile = np.clip(np.stack(chans, axis=-1), 0, 255).astype(np.uint8)
            tile = np.flipud(tile)  # FITS tiles are stored bottom-up
            dst = (out / rel).with_suffix(".webp")
            dst.parent.mkdir(parents=True, exist_ok=True)
            Image.fromarray(tile).save(dst, "WEBP", quality=args.quality, method=6)
            n += 1
    (out / "properties").write_text(
        "\n".join([
            "obs_title             = Milky Way (Gaia EDR3 colour map)",
            "obs_copyright         = ESA/Gaia/DPAC, CC BY-SA 3.0 IGO. Acknowledgement: A. Moitinho",
            "obs_description       = Reprojected from ESA's Gaia EDR3 all-sky colour map",
            "dataproduct_type      = image",
            "hips_frame            = equatorial",
            "hips_tile_format      = webp",
            "hips_tile_width       = 512",
            "hips_order_min        = 0",
            f"hips_order            = {args.level}",
            "hips_version          = 1.4",
            "hips_release_date     = 2026-11-12T00:00Z",
            "",
        ]),
        encoding="utf-8",
    )
    size = sum(p.stat().st_size for p in out.rglob("*.webp"))
    print(f"wrote {n} tiles, {size / 1e6:.2f} MB")


if __name__ == "__main__":
    main()
