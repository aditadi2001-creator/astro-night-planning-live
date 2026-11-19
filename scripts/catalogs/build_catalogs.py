"""Build the app's static catalog shards (Cloudflare Pages assets, zero R2).

    python scripts/catalogs/build_catalogs.py            # download inputs if missing, then build
    python scripts/catalogs/build_catalogs.py --offline  # build from scripts/catalogs/raw only

Inputs (downloaded to scripts/catalogs/raw/, git-ignored, never uploaded anywhere):
  * Stellarium DSO catalog v3.23 (nebulae/default/catalog.txt + names.dat), GPL-2.0-or-later:
    94,899 objects with cross-identifications for 29 catalogs. GPL-2+ is usable under GPLv3 and
    therefore combinable with this AGPL-3.0 app (docs/RESEARCH.md §5).
  * Herschel 400 list: object numbers parsed from the Wikipedia article (a list of facts).
  * Curated notable objects (quasars/AGN, double and variable stars, exoplanet hosts): names only;
    coordinates and magnitudes are resolved with CDS Sesame (CfA mirror) at build time.
  * Bright stars: decoded from the star tiles already bundled in public/skydata/stars (orders 0–2,
    Hipparcos + Gaia, with Bayer/Flamsteed/HD/HIP ids) and the IAU names in the Western sky culture.

Outputs (public/catalog/, versioned file names so they can be cached as immutable):
  dso-core-v1.json      named objects and everything in a classic catalog (lazy-loaded by search)
  dso-galaxies-v1.json  the remaining PGC/UGC/ESO galaxies (loaded only when search needs them)
  stars-v1.json         bright stars to V 6.5 with designations
  notable-v1.json       curated quasars/AGN, doubles, variables, exoplanet hosts (Sesame positions)
  manifest-v1.json      sources, licences, row counts, bytes, per-catalog object counts
"""

from __future__ import annotations

import argparse
import json
import math
import re
import struct
import sys
import time
import urllib.parse
import urllib.request
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RAW = Path(__file__).resolve().parent / "raw"
OUT = ROOT / "public" / "catalog"
VERSION = 1
UA = "astro-night-planning catalog build (open-source, non-commercial)"

STEL = "https://raw.githubusercontent.com/Stellarium/stellarium/master/nebulae/default/"
H400_URL = "https://en.wikipedia.org/w/index.php?title=Herschel_400_Catalogue&action=raw"
SESAME = "https://vizier.cfa.harvard.edu/viz-bin/nph-sesame/-oxp/SNV?"

# Cross-index columns of catalog.txt (1-based column → our catalog prefix).
XCOLS = [
    (17, "NGC"), (18, "IC"), (19, "M"), (20, "C"), (21, "B"), (22, "Sh2"), (23, "vdB"),
    (24, "RCW"), (25, "LDN"), (26, "LBN"), (27, "Cr"), (28, "Mel"), (29, "PGC"), (30, "UGC"),
    (31, "Ced"), (32, "Arp"), (33, "VV"), (34, "PK"), (35, "PN G"), (36, "SNR G"), (37, "Abell"),
    (38, "HCG"), (39, "ESO"), (40, "vdBH"), (41, "DWB"), (42, "Tr"), (43, "St"), (44, "Ru"),
    (45, "vdB-Ha"),
]
# Display form of each designation.
FMT = {
    "NGC": "NGC {}", "IC": "IC {}", "M": "M {}", "C": "C {}", "B": "B {}", "Sh2": "Sh 2-{}",
    "vdB": "vdB {}", "RCW": "RCW {}", "LDN": "LDN {}", "LBN": "LBN {}", "Cr": "Cr {}",
    "Mel": "Mel {}", "PGC": "PGC {}", "UGC": "UGC {}", "Ced": "Ced {}", "Arp": "Arp {}",
    "VV": "VV {}", "PK": "PK {}", "PN G": "PN G{}", "SNR G": "SNR G{}", "Abell": "Abell {}",
    "HCG": "HCG {}", "ESO": "ESO {}", "vdBH": "vdBH {}", "DWB": "DWB {}", "Tr": "Tr {}",
    "St": "St {}", "Ru": "Ru {}", "vdB-Ha": "vdB-Ha {}",
}
# Preferred order for the primary designation shown to users.
PRIMARY = ["M", "C", "NGC", "IC", "Sh2", "B", "vdB", "LBN", "LDN", "RCW", "Cr", "Mel", "Tr", "St",
           "Ru", "Arp", "HCG", "Abell", "PN G", "PK", "SNR G", "Ced", "DWB", "vdBH", "vdB-Ha",
           "UGC", "PGC", "ESO", "VV"]
# names.dat prefixes → our prefixes.
NAME_PREFIX = {
    "NGC": "NGC", "IC": "IC", "M": "M", "C": "C", "B": "B", "SH2": "Sh2", "VDB": "vdB",
    "RCW": "RCW", "LDN": "LDN", "LBN": "LBN", "CR": "Cr", "MEL": "Mel", "PGC": "PGC",
    "UGC": "UGC", "CED": "Ced", "ARP": "Arp", "VV": "VV", "PK": "PK", "PNG": "PN G",
    "SNRG": "SNR G", "ACO": "Abell", "HCG": "HCG", "ESO": "ESO", "VDBH": "vdBH", "DWB": "DWB",
    "TR": "Tr", "ST": "St", "RU": "Ru", "VDBHA": "vdB-Ha",
}
# Stellarium object type codes (case-sensitive, nebula.cpp) → our kinds
# (src/lib/catalog/types.ts mirrors this). "?" suffixes are candidates.
KIND = {
    "Gx": "galaxy", "G": "galaxy", "AGx": "galaxy", "rG": "radio-galaxy", "IG": "galaxy-pair",
    "IG2": "galaxy-pair", "IG3": "galaxy-group", "ClG": "galaxy-cluster", "PoG": "galaxy-part",
    "QSO": "quasar", "Q?": "quasar", "Bla": "quasar", "BLL": "quasar",
    "GC": "globular", "OC": "open", "Cl": "cluster", "CL": "cluster", "C+N": "cluster-nebula",
    "SA": "association", "HII": "emission", "EmO": "emission", "GNe": "nebula", "ISM": "nebula",
    "REG": "nebula", "RN": "reflection", "RNe": "reflection", "DN": "dark", "MoC": "dark",
    "PN": "planetary", "PN?": "planetary", "SNR": "remnant", "SR?": "remnant", "BN": "bipolar",
    "*": "star", "**": "double", "Sy*": "star", "Em*": "star", "pA*": "star", "Mi*": "star",
}

CURATED = {
    # Notable quasars, blazars and AGN (the whole Milliquas catalogue is ~1 M rows: too big).
    "quasar": ["3C 273", "3C 48", "3C 279", "OJ 287", "Mrk 421", "Mrk 501", "BL Lac",
               "PKS 2155-304", "QSO B0957+561", "QSO J2240+0321", "3C 345", "S5 0716+714",
               "Ton 618", "APM 08279+5255", "PG 1159-035"],
    # Classic double stars for telescopes.
    "double": ["Albireo", "Mizar", "eps01 Lyr", "Castor", "gam And", "gam Ari", "zet Ori",
               "sig Ori", "iot Cas", "eta Cas", "del Cep", "bet Mon", "61 Cyg", "alf Cen",
               "gam Vir", "xi UMa", "24 Com", "alf CVn", "eps Boo", "bet Sco", "nu Dra",
               "theta1 Ori", "alf Her", "zet UMa", "bet Cyg"],
    # Bright variable stars.
    "variable": ["Mira", "Algol", "del Cep", "eta Aql", "R CrB", "chi Cyg", "R Leo", "R Hya",
                 "eta Car", "bet Lyr", "Betelgeuse", "Antares", "mu Cep", "R Sct", "RR Lyr",
                 "T CrB", "SS Cyg", "U Gem", "gam Cas", "rho Cas", "VY CMa", "R Lep", "W Cyg",
                 "alf Ori", "omi Cet"],
    # Well-known exoplanet host stars.
    "exoplanet-host": ["51 Peg", "HD 209458", "HD 189733", "TRAPPIST-1", "Proxima Cen",
                       "tau Boo", "55 Cnc", "ups And", "eps Eri", "WASP-12", "Kepler-22",
                       "Kepler-186", "GJ 581", "GJ 1214", "HR 8799", "bet Pic", "Fomalhaut",
                       "HD 80606", "WASP-121", "KELT-9"],
}


def fetch(url: str, dest: Path) -> None:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=120) as r:
        dest.write_bytes(r.read())


def ensure_inputs(offline: bool) -> None:
    RAW.mkdir(parents=True, exist_ok=True)
    for name in ("catalog.txt", "names.dat"):
        if not (RAW / name).exists():
            if offline:
                sys.exit(f"missing {RAW / name} (run without --offline)")
            print(f"download {name}")
            fetch(STEL + name, RAW / name)
    if not (RAW / "h400.wiki").exists():
        if offline:
            sys.exit("missing raw/h400.wiki")
        print("download Herschel 400 list")
        fetch(H400_URL, RAW / "h400.wiki")


def num(s: str) -> float | None:
    try:
        v = float(s)
    except ValueError:
        return None
    return v


def read_names() -> dict[tuple[str, str], list[str]]:
    out: dict[tuple[str, str], list[str]] = {}
    for line in (RAW / "names.dat").read_text(encoding="utf-8").splitlines():
        if line.startswith("#") or len(line) < 21:
            continue
        pre = line[0:5].strip().upper()
        oid = line[5:20].strip()
        m = re.search(r'_\("([^"]+)"\)', line[20:])
        if not pre or not oid or not m:
            continue
        p = NAME_PREFIX.get(pre)
        if not p:
            continue
        out.setdefault((p, oid), [])
        if m.group(1) not in out[(p, oid)]:
            out[(p, oid)].append(m.group(1))
    return out


def read_h400() -> set[int]:
    t = (RAW / "h400.wiki").read_text(encoding="utf-8")
    sec = t[t.index("==Herschel 400 objects=="):]
    rows = re.split(r"\n\|-[^\n]*", sec)
    ngc: set[int] = set()
    rows_found = 0
    for r in rows:
        cells = [c.strip() for c in re.split(r"\n\|(?!\|)", r)]
        if len(cells) < 3:
            continue
        head = " ".join(cells[1:3])
        nums = re.findall(r"NGC (\d+)(?:[-/](?:NGC )?(\d+))?", head)
        if not nums:
            continue
        rows_found += 1
        a, b = nums[0]
        ngc.add(int(a))
        if b:
            # "NGC 2371-2" means 2371 and 2372; "NGC 4038/4039" both numbers.
            bb = int(b) if len(b) >= len(a) else int(a[: len(a) - len(b)] + b)
            ngc.add(bb)
    read_h400.rows = rows_found  # type: ignore[attr-defined]
    return ngc


def build_dso(names: dict, h400: set[int]) -> tuple[list[list], dict[str, int]]:
    rows = []
    per_cat: dict[str, int] = {}
    for line in (RAW / "catalog.txt").read_text(encoding="utf-8").splitlines():
        if not line or line.startswith("#"):
            continue
        c = line.split("\t")
        if len(c) < 45:
            c += [""] * (45 - len(c))
        get = lambda i: c[i - 1].strip()  # noqa: E731
        ra, dec = num(get(2)), num(get(3))
        if ra is None or dec is None:
            continue
        bmag, vmag = num(get(4)), num(get(5))
        mag = vmag if vmag is not None and vmag < 90 else (bmag if bmag is not None and bmag < 90 else None)
        typ = get(6)
        kind = KIND.get(typ, "other")
        maj, mnr, pa = num(get(8)), num(get(9)), num(get(10))
        z = num(get(11))
        dist = num(get(15))
        ids: dict[str, str] = {}
        for col, pre in XCOLS:
            v = get(col)
            if v and v not in ("0", "0.0"):
                ids[pre] = v
        if not ids:
            continue
        for pre in ids:
            per_cat[pre] = per_cat.get(pre, 0) + 1
        ngc_n = int(ids["NGC"]) if ids.get("NGC", "").isdigit() else None
        h4 = ngc_n is not None and ngc_n in h400
        if h4:
            per_cat["H400"] = per_cat.get("H400", 0) + 1
        common: list[str] = []
        for pre, v in ids.items():
            for n in names.get((pre, v), []):
                if n not in common:
                    common.append(n)
        primary = next(p for p in PRIMARY if p in ids)
        designations = [FMT[primary].format(ids[primary])] + [
            FMT[p].format(ids[p]) for p in PRIMARY if p in ids and p != primary
        ]
        if h4:
            designations.append("H400")
        rows.append([
            int(get(1)),
            round(ra, 5),
            round(dec, 5),
            kind,
            None if mag is None else round(mag, 2),
            None if not maj else round(maj, 2),
            None if not mnr else round(mnr, 2),
            None if pa is None or (pa == 0 and not mnr) else int(pa),
            "|".join(designations),
            "|".join(common),
            None if z is None or z >= 90 or z == 0 else z,
            None if not dist else dist,
            get(7) or None,
        ])
    return rows, per_cat


CLASSIC = {"NGC", "IC", "M", "C", "B", "Sh 2", "vdB", "RCW", "LDN", "LBN", "Cr", "Mel", "Arp",
           "HCG", "PK", "PN", "SNR", "Ced", "Tr", "St", "Ru", "DWB", "vdBH", "vdB-Ha", "Abell"}


def is_core(r: list) -> bool:
    if r[9]:
        return True  # has a common name
    for d in r[8].split("|"):
        pre = d.split(" ")[0] if not d.startswith(("Sh 2", "PN G", "SNR G")) else d[:4].strip()
        if pre in CLASSIC or d.startswith(("Sh 2-", "PN G", "SNR G", "H400")):
            return True
    return r[4] is not None and r[4] <= 13.0


# ---- bright stars from the bundled eph tiles ---------------------------------------------

def decode_tile(data: bytes) -> list[dict]:
    """Minimal reader for Stellarium Web Engine 'eph' star tiles (see pipelines/catalogs/eph.py)."""
    assert data[:4] == b"EPHE"
    p = 8
    out: list[dict] = []
    while p < len(data):
        kind = data[p : p + 4].decode("ascii")
        (ln,) = struct.unpack_from("<I", data, p + 4)
        body = data[p + 8 : p + 8 + ln]
        p += 12 + ln
        if kind == "JSON":
            continue
        flags, row_size, ncol, nrow = struct.unpack_from("<IIII", body, 12)
        cols = []
        q = 28
        for _ in range(ncol):
            name = body[q : q + 4].rstrip(b"\0").decode()
            typ = body[q + 4 : q + 5].decode()
            _unit, start, size = struct.unpack_from("<III", body, q + 8)
            cols.append((name, typ, start, size))
            q += 20
        raw_size, comp_size = struct.unpack_from("<II", body, q)
        raw = zlib.decompress(body[q + 8 : q + 8 + comp_size])
        if flags & 1:
            un = bytearray(len(raw))
            for j in range(row_size):
                un[j::row_size] = raw[j * nrow : (j + 1) * nrow]
            raw = bytes(un)
        for i in range(nrow):
            r = {}
            base = i * row_size
            for name, typ, start, size in cols:
                o = base + start
                if typ == "f":
                    r[name] = struct.unpack_from("<f", raw, o)[0]
                elif typ == "i":
                    r[name] = struct.unpack_from("<i", raw, o)[0]
                elif typ == "Q":
                    r[name] = struct.unpack_from("<Q", raw, o)[0]
                elif typ == "s":
                    r[name] = raw[o : o + size].split(b"\0")[0].decode("utf-8", "replace")
            out.append(r)
    return out


GREEK = {"alf": "α", "bet": "β", "gam": "γ", "del": "δ", "eps": "ε", "zet": "ζ", "eta": "η",
         "tet": "θ", "iot": "ι", "kap": "κ", "lam": "λ", "mu.": "μ", "mu": "μ", "nu.": "ν",
         "nu": "ν", "ksi": "ξ", "xi": "ξ", "omi": "ο", "pi.": "π", "pi": "π", "rho": "ρ",
         "sig": "σ", "tau": "τ", "ups": "υ", "phi": "φ", "chi": "χ", "psi": "ψ", "ome": "ω"}


def build_stars() -> list[list]:
    sky = json.loads((ROOT / "public/skydata/skycultures/western/index.json").read_text("utf-8"))
    iau = {int(k.split()[1]): v[0].get("english") for k, v in sky["common_names"].items()
           if k.startswith("HIP ")}
    rows = []
    seen = set()
    for order in (0, 1, 2):
        for f in sorted((ROOT / "public/skydata/stars" / f"Norder{order}").rglob("*.eph")):
            for s in decode_tile(f.read_bytes()):
                vmag = s.get("vmag")
                if vmag is None or not math.isfinite(vmag) or vmag > 6.5:
                    continue
                hip = s.get("hip") or 0
                key = hip or s.get("gaia")
                if key in seen:
                    continue
                seen.add(key)
                ids = [i for i in (s.get("ids") or "").split("|") if i]
                pretty = []
                for i in ids:
                    m = re.match(r"^\* (\w+\.?)(\d*) (\w{3})$", i)
                    if m and m.group(1).lower() in GREEK:
                        pretty.append(f"{GREEK[m.group(1).lower()]}{m.group(2)} {m.group(3)}")
                pretty_ids = [i.lstrip("* ").strip() for i in ids]
                name = iau.get(hip, "")
                rows.append([
                    hip or None,
                    round(s["ra"] * 180 / 3.141592653589793 % 360, 5),
                    round(s["de"] * 180 / 3.141592653589793, 5),
                    round(vmag, 2),
                    None if s.get("bv") is None or not math.isfinite(s["bv"]) or abs(s["bv"]) > 5 else round(s["bv"], 2),
                    "|".join(pretty + pretty_ids),
                    name or "",
                ])
    rows.sort(key=lambda r: r[3])
    # A proper name given to several stars in the source (e.g. "Polaris" also on sig Oct) stays
    # only on the brightest one; the others are still found by their designations.
    used: set[str] = set()
    for r in rows:
        if r[6] and r[6] in used:
            r[6] = ""
        elif r[6]:
            used.add(r[6])
    return rows


# ---- curated objects resolved with Sesame ----------------------------------------------------

def sesame(name: str) -> dict | None:
    url = SESAME + urllib.parse.quote(name)
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                x = r.read().decode("utf-8", "replace")
            break
        except Exception:  # noqa: BLE001
            time.sleep(2 * (attempt + 1))
    else:
        return None
    ra = re.search(r"<jradeg>([-\d.]+)</jradeg>", x)
    de = re.search(r"<jdedeg>([-\d.]+)</jdedeg>", x)
    if not ra or not de:
        return None
    oname = re.search(r"<oname>([^<]+)</oname>", x)
    otype = re.search(r"<otype>([^<]+)</otype>", x)
    vmag = re.search(r'<mag band="V">\s*<v>([-\d.]+)</v>', x)
    return {
        "ra": round(float(ra.group(1)), 6),
        "dec": round(float(de.group(1)), 6),
        "simbad": oname.group(1).strip() if oname else None,
        "otype": otype.group(1).strip() if otype else None,
        "vmag": float(vmag.group(1)) if vmag else None,
    }


def build_notable(offline: bool) -> list[list]:
    cache = RAW / "sesame.json"
    known = json.loads(cache.read_text("utf-8")) if cache.exists() else {}
    rows = []
    for group, names in CURATED.items():
        for n in names:
            if known.get(n) is None:
                if offline:
                    continue
                known[n] = sesame(n)
                time.sleep(0.4)  # stay far below Sesame's rate limits
            r = known.get(n)
            if not r:
                print(f"  Sesame could not resolve {n!r}: left out")
                continue
            rows.append([n, group, r["ra"], r["dec"], r["vmag"], r["simbad"] or "", r["otype"] or ""])
    cache.write_text(json.dumps(known, indent=1), encoding="utf-8")
    return rows


def write(name: str, doc: dict) -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    # allow_nan=False: NaN is not JSON; fail the build instead of shipping a broken file.
    data = json.dumps(doc, separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode("utf-8")
    (OUT / name).write_bytes(data)
    return len(data)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--offline", action="store_true")
    a = ap.parse_args()
    ensure_inputs(a.offline)

    names = read_names()
    h400 = read_h400()
    dso, per_cat = build_dso(names, h400)
    core = [r for r in dso if is_core(r)]
    gal = [r for r in dso if not is_core(r)]
    stars = build_stars()
    notable = build_notable(a.offline)

    cols = ["id", "ra", "dec", "kind", "mag", "maj", "min", "pa", "ids", "names", "z", "distKpc", "morph"]
    stel_src = "Stellarium DSO catalog v3.23 (GPL-2.0-or-later), github.com/Stellarium/stellarium"
    sizes = {
        f"dso-core-v{VERSION}.json": write(f"dso-core-v{VERSION}.json",
                                           {"v": VERSION, "source": stel_src, "columns": cols, "rows": core}),
        f"dso-galaxies-v{VERSION}.json": write(f"dso-galaxies-v{VERSION}.json",
                                               {"v": VERSION, "source": stel_src, "columns": cols, "rows": gal}),
        f"stars-v{VERSION}.json": write(f"stars-v{VERSION}.json", {
            "v": VERSION,
            "source": "Hipparcos (ESA 1997) + Gaia DR3 (ESA/Gaia/DPAC) from the bundled star tiles; "
                      "Bayer/Flamsteed from the Yale BSC5 (public domain); names: IAU WGSN",
            "columns": ["hip", "ra", "dec", "vmag", "bv", "ids", "name"],
            "rows": stars,
        }),
        f"notable-v{VERSION}.json": write(f"notable-v{VERSION}.json", {
            "v": VERSION,
            "source": "Curated list; positions and V magnitudes from CDS Sesame (SIMBAD) via the CfA mirror, "
                      "resolved " + time.strftime("%Y-%m-%d"),
            "columns": ["name", "group", "ra", "dec", "vmag", "simbad", "otype"],
            "rows": notable,
        }),
    }
    counts = dict(sorted(per_cat.items(), key=lambda kv: -kv[1]))
    manifest = {
        "v": VERSION,
        "built": time.strftime("%Y-%m-%d"),
        "files": {k: {"bytes": v} for k, v in sizes.items()},
        "rows": {"dso-core": len(core), "dso-galaxies": len(gal), "stars": len(stars), "notable": len(notable)},
        "catalogs": counts,
        "herschel400Rows": getattr(read_h400, "rows", None),
        "notableGroups": {g: sum(1 for r in notable if r[1] == g) for g in CURATED},
        "sources": {
            "dso": stel_src,
            "h400": "Herschel 400 list (Ancient City Astronomy Club, c. 1980), object numbers from Wikipedia",
            "stars": "Hipparcos / Gaia DR3 / BSC5 / IAU WGSN",
            "notable": "CDS Sesame / SIMBAD (CfA mirror)",
        },
        "missing": {"Gum": "no machine-readable Gum catalogue found (VizieR has none); not included"},
    }
    write(f"manifest-v{VERSION}.json", manifest)
    print(json.dumps({"files": sizes, "rows": manifest["rows"], "herschel400Rows": manifest["herschel400Rows"]}, indent=1))
    print("per catalog:", counts)


if __name__ == "__main__":
    main()
