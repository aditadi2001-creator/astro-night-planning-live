"""Names list for the sky search (public/skydata/dsonames.json): NGC, IC and Messier
designations from OpenNGC (CC BY-SA 4.0) with common name, position, size and type.

Usage: python build_dsonames.py   (run from pipelines/catalogs after fetch.py --only openngc)
"""

import json

from build_dso import ARCMIN, read_openngc

rows = []
for o in read_openngc():
    ids = o["ids"].split("|")
    names = [i for i in ids if i.split(" ")[0] in ("M", "NGC", "IC") and len(i.split(" ")) == 2]
    common = next((i[5:] for i in ids if i.startswith("NAME ")), "")
    if not names:
        continue
    size = round((o["smax"] or 0) / ARCMIN, 1)
    rows.append(["|".join(names), common, round(o["ra"], 4), round(o["de"], 4), size, o["type"]])
out = {"source": "OpenNGC by Mattia Verga (CC BY-SA 4.0)", "columns": ["names", "common", "ra", "dec", "sizeArcmin", "type"], "rows": rows}
open("../../public/skydata/dsonames.json", "w", encoding="utf-8", newline="\n").write(json.dumps(out, separators=(",", ":"), ensure_ascii=False))
print(len(rows))
