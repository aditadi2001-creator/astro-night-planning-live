"""Download the raw open catalogs used to build the sky data.

Everything goes into ``pipelines/catalogs/raw/`` (git-ignored, never uploaded
to R2). Each source is openly licensed and needs no account:

- Hipparcos main catalogue (ESA 1997), CDS VizieR I/239 via the CfA mirror
- Yale Bright Star Catalogue 5th rev. (Hoffleit & Warren 1991), public domain
- IAU Catalog of Star Names (IAU WGSN)
- Gaia DR3 (ESA/Gaia/DPAC) bright subset via the GAVO Data Center TAP service
- OpenNGC (Mattia Verga, CC BY-SA 4.0)
- "western" sky culture + Moon/Sun textures from Stellarium Web Engine at the
  pinned commit (CC BY-SA / CC BY 4.0)

Usage: python fetch.py [--gaia-gmax 10.6] [--only name,...]
"""

from __future__ import annotations

import argparse
import gzip
import io
import sys
import time
from pathlib import Path

import requests

HERE = Path(__file__).resolve().parent
RAW = HERE / "raw"
ROOT = HERE.parent.parent
UA = {"User-Agent": "astro-night-planning-live catalog pipeline (open source, non-commercial)"}

VIZIER = "https://vizier.cfa.harvard.edu/viz-bin/asu-tsv"
GAVO_TAP = "https://dc.g-vo.org/tap/sync"
SWE_COMMIT = (ROOT / "engine" / "SWE_COMMIT").read_text().strip()
SWE_RAW = f"https://raw.githubusercontent.com/Stellarium/stellarium-web-engine/{SWE_COMMIT}"
OPENNGC_RAW = "https://raw.githubusercontent.com/mattiaverga/OpenNGC/master/database_files"


def get(url: str, *, params: dict | None = None, data: dict | None = None, tries: int = 4) -> bytes:
    for attempt in range(tries):
        try:
            if data is not None:
                r = requests.post(url, data=data, headers=UA, timeout=900)
            else:
                r = requests.get(url, params=params, headers=UA, timeout=900)
            r.raise_for_status()
            return r.content
        except requests.RequestException as e:
            wait = 5 * 2**attempt
            print(f"  {url}: {e} — retry in {wait}s", file=sys.stderr)
            time.sleep(wait)
    raise RuntimeError(f"giving up on {url}")


def save(name: str, content: bytes) -> None:
    path = RAW / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)
    print(f"  wrote {path.relative_to(HERE)} ({len(content) / 1e6:.1f} MB)")


def fetch_hipparcos() -> None:
    print("Hipparcos (I/239/hip_main)…")
    content = get(
        VIZIER,
        params={
            "-source": "I/239/hip_main",
            "-out": "HIP,RAICRS,DEICRS,Vmag,Plx,pmRA,pmDE,B-V,HD,SpType",
            "-out.max": "unlimited",
        },
    )
    save("hip_main.tsv", content)


def fetch_bsc() -> None:
    print("Yale Bright Star Catalogue…")
    save("bsc5.dat", gzip.decompress(get("http://tdc-www.harvard.edu/catalogs/bsc5.dat.gz")))


def fetch_iau_names() -> None:
    print("IAU Catalog of Star Names…")
    save("IAU-CSN.txt", get("https://www.pas.rochester.edu/~emamajek/WGSN/IAU-CSN.txt"))


def tap_async(query: str, max_wait_s: int = 3600) -> bytes:
    """Run an ADQL query as an async UWS job (GAVO's sync endpoint stops at ~20 s)."""
    r = requests.post(
        GAVO_TAP.replace("/sync", "/async"),
        data={"REQUEST": "doQuery", "LANG": "ADQL", "FORMAT": "csv", "MAXREC": "5000000",
              "QUERY": query, "PHASE": "RUN"},
        headers=UA, timeout=120, allow_redirects=False,
    )
    job = r.headers.get("Location")
    if r.status_code not in (200, 303) or not job:
        raise RuntimeError(f"TAP async submit failed: {r.status_code} {r.text[:300]}")
    print(f"  job {job}", flush=True)
    # Some services (GAVO) ignore PHASE=RUN on creation and leave the job PENDING.
    requests.post(f"{job}/phase", data={"PHASE": "RUN"}, headers=UA, timeout=60)
    start = time.time()
    while True:
        phase = requests.get(f"{job}/phase", headers=UA, timeout=60).text.strip()
        if phase == "COMPLETED":
            break
        if phase in ("ERROR", "ABORTED"):
            err = requests.get(f"{job}/error", headers=UA, timeout=60).text[:500]
            raise RuntimeError(f"TAP job {phase}: {err}")
        if time.time() - start > max_wait_s:
            raise RuntimeError("TAP job did not finish in time")
        time.sleep(10)
    print(f"  finished in {time.time() - start:.0f}s")
    content = get(f"{job}/results/result")
    requests.delete(job, headers=UA, timeout=60)  # free the server-side result
    return content


def fetch_gaia(gmax: float) -> None:
    """Gaia DR3 down to G < gmax in one async job."""
    print(f"Gaia DR3, G < {gmax} (GAVO gaia.dr3lite)…")
    q = (
        "SELECT source_id, ra, dec, parallax, pmra, pmdec, phot_g_mean_mag, "
        "phot_bp_mean_mag, phot_rp_mean_mag FROM gaia.dr3lite "
        f"WHERE phot_g_mean_mag < {gmax}"
    )
    content = tap_async(q)
    if not content.startswith(b"source_id"):
        raise RuntimeError(f"unexpected TAP result: {content[:200]!r}")
    print(f"  {content.count(b'\n') - 1} rows")
    save(f"gaia_dr3_g{gmax}.csv", content)


def fetch_openngc() -> None:
    print("OpenNGC…")
    for f in ("NGC.csv", "addendum.csv"):
        save(f"openngc/{f}", get(f"{OPENNGC_RAW}/{f}"))


def fetch_swe_assets() -> None:
    print(f"Stellarium Web Engine assets @ {SWE_COMMIT[:10]}…")
    base = f"{SWE_RAW}/apps/test-skydata"
    for f in ("skycultures/western/index.json", "skycultures/western/description.md"):
        save(f"swe/{f}", get(f"{base}/{f}"))
    # Moon texture only: CC BY 4.0 (Oleg Pluton, from NASA public-domain data).
    # The Sun texture carries no stated license, so we don't use it; the engine
    # still renders the solar disc and glare without it.
    moon = f"{base}/surveys/sso/moon"
    save("swe/surveys/sso/moon/properties", get(f"{moon}/properties"))
    save("swe/surveys/sso/moon/Norder0/Allsky.webp", get(f"{moon}/Norder0/Allsky.webp"))
    for pix in range(12):
        save(f"swe/surveys/sso/moon/Norder0/Dir0/Npix{pix}.webp",
             get(f"{moon}/Norder0/Dir0/Npix{pix}.webp"))


GAIA_SKY_PNG = (
    "https://media.esa.int/legacy/web/images/esa_multimedia/images/2020/12/"
    "the_colour_of_the_sky_from_gaia_s_early_data_release_3/22358050-1-eng-GB/"
    "The_colour_of_the_sky_from_Gaia_s_Early_Data_Release_3.png"
)


def fetch_milkyway() -> None:
    """ESA/Gaia/DPAC all-sky colour map (EDR3), CC BY-SA 3.0 IGO, ack. A. Moitinho.
    Hammer-Aitoff projection in galactic coordinates."""
    print("Gaia EDR3 all-sky colour map (60 MB)…")
    save("gaia_sky_colour_edr3.png", get(GAIA_SKY_PNG))


SOURCES = {
    "milkyway": fetch_milkyway,
    "hipparcos": fetch_hipparcos,
    "bsc": fetch_bsc,
    "iau": fetch_iau_names,
    "openngc": fetch_openngc,
    "swe": fetch_swe_assets,
}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--gaia-gmax", type=float, default=10.6)
    ap.add_argument("--only", default="", help="comma-separated subset: " + ",".join([*SOURCES, "gaia"]))
    args = ap.parse_args()
    only = set(filter(None, args.only.split(",")))
    for name, fn in SOURCES.items():
        if not only or name in only:
            fn()
    if not only or "gaia" in only:
        fetch_gaia(args.gaia_gmax)


if __name__ == "__main__":
    main()
