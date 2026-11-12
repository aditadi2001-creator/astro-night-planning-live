"""Reader/writer for Stellarium Web Engine's binary ``eph`` HiPS tile format.

Format (see stellarium-web-engine ``src/eph-file.c``), all little-endian:

    "EPHE"  uint32 file_version (=2)
    chunks: char[4] type, uint32 len, bytes[len] data, uint32 crc

A ``STAR`` / ``DSO `` chunk holds::

    uint32 tile_version (>=3), uint64 nuniq   (nuniq = 4*4**order + pix)
    table header: uint32 flags (1 = shuffled), uint32 row_size,
                  uint32 n_cols, uint32 n_rows,
                  n_cols * (char[4] name, char[4] type, uint32 unit,
                            uint32 start, uint32 size)
    compressed block: uint32 raw_size, uint32 comp_size, zlib bytes

An optional ``JSON`` chunk (before data chunks) may carry
``{"children_mask": m}``: bit i set means child i exists.
"""

from __future__ import annotations

import json
import struct
import zlib
from dataclasses import dataclass

FILE_VERSION = 2
TILE_VERSION = 3

# Units (eph-file.h). Values are stored in the data files: never change them.
EPH_RAD = 1 << 16
EPH_DEG = EPH_RAD | 1
EPH_ARCMIN = EPH_DEG | 2
EPH_ARCSEC = EPH_ARCMIN | 4
EPH_VMAG = 3 << 16
EPH_RAD_PER_YEAR = 6 << 16
EPH_YEAR = 7 << 16
EPH_KM_PER_SEC = 8 << 16


@dataclass(frozen=True)
class Column:
    name: str  # up to 4 chars
    type: str  # 'f' float32, 'i' int32, 'Q' uint64, 's' fixed string
    unit: int = 0
    size: int = 0  # bytes; derived for numeric types

    @property
    def nbytes(self) -> int:
        return {"f": 4, "i": 4, "Q": 8}.get(self.type, self.size)


def _name4(s: str) -> bytes:
    b = s.encode("ascii")
    assert len(b) <= 4
    return b.ljust(4, b"\0")


def _chunk(kind: str, data: bytes) -> bytes:
    crc = zlib.crc32(data) & 0xFFFFFFFF
    return _name4(kind) + struct.pack("<I", len(data)) + data + struct.pack("<I", crc)


def encode_tile(
    kind: str,
    order: int,
    pix: int,
    columns: list[Column],
    rows: list[tuple],
    children_mask: int | None = None,
) -> bytes:
    """Encode one tile. ``rows`` are tuples in column order."""
    starts = []
    off = 0
    for c in columns:
        starts.append(off)
        off += c.nbytes
    row_size = off

    raw = bytearray()
    for r in rows:
        for c, v in zip(columns, r, strict=True):
            if c.type == "f":
                raw += struct.pack("<f", float("nan") if v is None else v)
            elif c.type == "i":
                raw += struct.pack("<i", int(v or 0))
            elif c.type == "Q":
                raw += struct.pack("<Q", int(v or 0))
            elif c.type == "s":
                b = (v or "").encode("utf-8")[: c.size - 1]
                raw += b.ljust(c.size, b"\0")
            else:
                raise ValueError(c.type)

    # Byte shuffle (column-of-bytes layout) compresses much better.
    n = len(rows)
    shuffled = bytearray(len(raw))
    for j in range(row_size):
        shuffled[j * n : (j + 1) * n] = raw[j::row_size]
    comp = zlib.compress(bytes(shuffled), 9)

    head = struct.pack("<IQ", TILE_VERSION, 4 * 4**order + pix)
    table = struct.pack("<IIII", 1, row_size, len(columns), n)
    for c, s in zip(columns, starts, strict=True):
        table += _name4(c.name) + _name4(c.type) + struct.pack("<III", c.unit, s, c.nbytes)
    block = struct.pack("<II", len(shuffled), len(comp)) + comp

    out = b"EPHE" + struct.pack("<I", FILE_VERSION)
    if children_mask is not None:
        out += _chunk("JSON", json.dumps({"children_mask": children_mask}).encode())
    out += _chunk(kind, head + table + block)
    return out


def encode_tile_np(
    kind: str,
    order: int,
    pix: int,
    columns: list[Column],
    arrays: dict,
    children_mask: int | None = None,
) -> bytes:
    """Vectorised encode_tile for numeric columns ('f', 'i', 'Q') given numpy arrays.

    Produces byte-for-byte the same layout as encode_tile (tested)."""
    import numpy as np

    fmt = {"f": "<f4", "i": "<i4", "Q": "<u8"}
    dtype = np.dtype([(c.name, fmt[c.type]) for c in columns])
    n = len(next(iter(arrays.values())))
    rec = np.zeros(n, dtype=dtype)
    for c in columns:
        rec[c.name] = arrays[c.name]
    raw = rec.tobytes()
    row_size = dtype.itemsize
    shuffled = np.frombuffer(raw, dtype=np.uint8).reshape(n, row_size).T.tobytes()
    comp = zlib.compress(shuffled, 9)

    starts = [dtype.fields[c.name][1] for c in columns]
    head = struct.pack("<IQ", TILE_VERSION, 4 * 4**order + pix)
    table = struct.pack("<IIII", 1, row_size, len(columns), n)
    for c, s in zip(columns, starts, strict=True):
        table += _name4(c.name) + _name4(c.type) + struct.pack("<III", c.unit, s, c.nbytes)
    block = struct.pack("<II", len(shuffled), len(comp)) + comp
    out = b"EPHE" + struct.pack("<I", FILE_VERSION)
    if children_mask is not None:
        out += _chunk("JSON", json.dumps({"children_mask": children_mask}).encode())
    out += _chunk(kind, head + table + block)
    return out


def decode_tile(data: bytes) -> dict:
    """Decode a tile (used for tests and for inspecting upstream files)."""
    assert data[:4] == b"EPHE", "bad magic"
    (ver,) = struct.unpack_from("<I", data, 4)
    assert ver == FILE_VERSION
    p = 8
    result: dict = {"json": None, "chunks": []}
    while p < len(data):
        kind = data[p : p + 4].decode("ascii")
        (ln,) = struct.unpack_from("<I", data, p + 4)
        body = data[p + 8 : p + 8 + ln]
        p += 12 + ln
        if kind == "JSON":
            result["json"] = json.loads(body)
            continue
        tver, nuniq = struct.unpack_from("<IQ", body, 0)
        order = 0
        while 4 * 4 ** (order + 1) <= nuniq:
            order += 1
        pix = nuniq - 4 * 4**order
        flags, row_size, ncol, nrow = struct.unpack_from("<IIII", body, 12)
        cols = []
        q = 28
        for _ in range(ncol):
            name = body[q : q + 4].rstrip(b"\0").decode()
            typ = body[q + 4 : q + 5].decode()
            unit, start, size = struct.unpack_from("<III", body, q + 8)
            cols.append((name, typ, unit, start, size))
            q += 20
        raw_size, comp_size = struct.unpack_from("<II", body, q)
        raw = zlib.decompress(body[q + 8 : q + 8 + comp_size])
        assert len(raw) == raw_size
        if flags & 1:
            un = bytearray(len(raw))
            for j in range(row_size):
                un[j::row_size] = raw[j * nrow : (j + 1) * nrow]
            raw = bytes(un)
        rows = []
        for i in range(nrow):
            r = {}
            base = i * row_size
            for name, typ, _unit, start, size in cols:
                o = base + start
                if typ == "f":
                    r[name] = struct.unpack_from("<f", raw, o)[0]
                elif typ == "i":
                    r[name] = struct.unpack_from("<i", raw, o)[0]
                elif typ == "Q":
                    r[name] = struct.unpack_from("<Q", raw, o)[0]
                else:
                    r[name] = raw[o : o + size].split(b"\0", 1)[0].decode("utf-8", "replace")
            rows.append(r)
        result["chunks"].append(
            {"type": kind, "version": tver, "order": order, "pix": pix,
             "columns": cols, "rows": rows}
        )
    return result
