"""Assemble the self-hosted sky culture and solar-system textures.

* ``skycultures/western``: constellation lines, names and boundaries from the
  Stellarium "western" sky culture (CC BY-SA), without the illustrations, plus
  ``common_names`` filled from the IAU Catalog of Star Names (IAU WGSN), keyed
  "HIP n" as the engine expects.
* ``surveys/sso/moon``: Moon texture (Oleg Pluton, CC BY 4.0, from NASA
  public-domain data).
"""

from __future__ import annotations

import json
import re
import shutil
from pathlib import Path

HERE = Path(__file__).resolve().parent
RAW = HERE / "raw"
OUT = HERE.parent.parent / "public" / "skydata"


def read_iau_names() -> dict[int, str]:
    """HIP -> IAU WGSN proper name. Columns are parsed from the right because
    designations ('HR 8353') contain spaces."""
    out: dict[int, str] = {}
    tail = re.compile(r"(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+\d{4}-\d\d-\d\d\s*\*?\s*$")
    with open(RAW / "IAU-CSN.txt", encoding="utf-8") as f:
        for ln in f:
            if ln.startswith("#") or not ln.strip():
                continue
            m = tail.search(ln.rstrip())
            if m and m.group(1).isdigit():
                out.setdefault(int(m.group(1)), ln.split()[0])
    return out


def main() -> None:
    src = RAW / "swe" / "skycultures" / "western"
    dst = OUT / "skycultures" / "western"
    if dst.exists():
        shutil.rmtree(dst)
    dst.mkdir(parents=True)

    doc = json.loads((src / "index.json").read_text(encoding="utf-8"))
    for c in doc.get("constellations", []):
        c.pop("image", None)  # illustrations not shipped
    names = read_iau_names()
    doc["common_names"] = {f"HIP {hip}": [{"english": n}] for hip, n in sorted(names.items())}
    doc["fallback_to_international_names"] = True
    (dst / "index.json").write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")),
                                    encoding="utf-8")
    desc = (src / "description.md").read_text(encoding="utf-8")
    desc += ("\n\nStar names: IAU Catalog of Star Names, IAU Working Group on Star Names (WGSN).\n")
    (dst / "description.md").write_text(desc, encoding="utf-8")
    print(f"western sky culture: {len(doc['constellations'])} constellations, "
          f"{len(names)} IAU star names")

    moon_src = RAW / "swe" / "surveys" / "sso" / "moon"
    moon_dst = OUT / "surveys" / "sso" / "moon"
    if moon_dst.exists():
        shutil.rmtree(moon_dst)
    shutil.copytree(moon_src, moon_dst)
    print("moon texture copied")

    # The engine asks its flat "zero" landscape for a description; ship one so
    # the request does not fall through to the site's index.html.
    zero = OUT / "landscapes" / "zero"
    zero.mkdir(parents=True, exist_ok=True)
    (zero / "description.en.utf8").write_text(
        "Flat mathematical horizon. The real terrain silhouette is drawn from the "
        "Copernicus DEM where available.\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
