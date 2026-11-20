/**
 * Reader for Stellarium Web Engine "eph" tiles (the format of our deep-sky layer in R2, served
 * by the data Worker at /hips/dso2): chunks of zlib-compressed tables, optionally byte-shuffled.
 * Same layout as scripts/catalogs/build_catalogs.py decode_tile and pipelines/catalogs/eph.py.
 */
export type EphRow = Record<string, number | string>;

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate');
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function decodeEph(buf: ArrayBuffer): Promise<EphRow[]> {
  const data = new Uint8Array(buf);
  const dv = new DataView(buf);
  const ascii = (o: number, n: number) => String.fromCharCode(...data.subarray(o, o + n));
  if (ascii(0, 4) !== 'EPHE') throw new Error('not an eph tile');
  const out: EphRow[] = [];
  let p = 8;
  while (p + 8 <= data.length) {
    const kind = ascii(p, 4);
    const ln = dv.getUint32(p + 4, true);
    const b = p + 8;
    p += 12 + ln;
    if (kind === 'JSON') continue;
    const flags = dv.getUint32(b + 12, true);
    const rowSize = dv.getUint32(b + 16, true);
    const ncol = dv.getUint32(b + 20, true);
    const nrow = dv.getUint32(b + 24, true);
    const cols: { name: string; typ: string; start: number; size: number }[] = [];
    let q = b + 28;
    for (let i = 0; i < ncol; i++) {
      const name = ascii(q, 4).replace(/\0+$/, '');
      const typ = ascii(q + 4, 1);
      cols.push({ name, typ, start: dv.getUint32(q + 12, true), size: dv.getUint32(q + 16, true) });
      q += 20;
    }
    const comp = dv.getUint32(q + 4, true);
    let raw = await inflate(data.subarray(q + 8, q + 8 + comp));
    if (flags & 1) {
      const un = new Uint8Array(raw.length);
      for (let j = 0; j < rowSize; j++)
        for (let i = 0; i < nrow; i++) un[i * rowSize + j] = raw[j * nrow + i] as number;
      raw = un;
    }
    const rv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    const dec = new TextDecoder();
    for (let i = 0; i < nrow; i++) {
      const r: EphRow = {};
      const base = i * rowSize;
      for (const c of cols) {
        const o = base + c.start;
        if (c.typ === 'f') r[c.name] = rv.getFloat32(o, true);
        else if (c.typ === 'i') r[c.name] = rv.getInt32(o, true);
        else if (c.typ === 'Q') r[c.name] = Number(rv.getBigUint64(o, true));
        else if (c.typ === 's') {
          const s = raw.subarray(o, o + c.size);
          const z = s.indexOf(0);
          r[c.name] = dec.decode(z < 0 ? s : s.subarray(0, z));
        }
      }
      out.push(r);
    }
  }
  return out;
}
