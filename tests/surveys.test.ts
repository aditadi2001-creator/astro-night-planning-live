import { beforeEach, describe, expect, it } from 'vitest';
import {
  parseHipsProperties,
  pickServer,
  propertiesMatch,
  resetServerChoice,
  SURVEYS,
  surveyById,
  type Fetcher,
  type Survey,
} from '../src/lib/sky/surveys';
import { CREDITS } from '../src/lib/credits';
// The engine patch, as text: its galactic rotation is checked below.
import patch0003 from '../engine/patches/0003-optional-sky-surveys.patch?raw';

const dss = surveyById('dss') as Survey;
const halpha = surveyById('halpha') as Survey;

const props = (did: string, frame = 'equatorial') =>
  `# HiPS properties\r\ncreator_did          = ivo://${did}\r\nhips_order = 9\r\nhips_frame = ${frame}\r\n`;

function fakeFetch(table: Record<string, () => Response | Promise<Response>>): {
  fetcher: Fetcher;
  calls: string[];
} {
  const calls: string[] = [];
  return {
    calls,
    fetcher: (url) => {
      calls.push(url);
      const f = table[url];
      return f ? Promise.resolve(f()) : Promise.reject(new TypeError('Failed to fetch'));
    },
  };
}

describe('survey list', () => {
  it('has the surveys from the spec, each with servers and a survey credit', () => {
    expect(SURVEYS.map((s) => s.id)).toEqual([
      'dss',
      'halpha',
      '2mass',
      'allwise',
      'panstarrs',
      'gaia',
      'sdss',
      'hst-acs',
      'hst-wfc3',
      'jwst-nircam',
      'jwst-miri',
    ]);
    for (const s of SURVEYS) {
      expect(s.servers.length).toBeGreaterThan(0);
      for (const u of s.servers) expect(u).toMatch(/^https:\/\/[^ ]+[^/]$/);
      const credit = CREDITS.find((c) => c.id === s.creditId);
      expect(credit?.kind).toBe('survey');
    }
  });

  it('marks DSS as non-commercial in its credit', () => {
    const c = CREDITS.find((x) => x.id === 'survey-dss');
    expect(c?.license).toMatch(/non-commercial/i);
  });
});

describe('HiPS properties', () => {
  it('parses key = value lines, skipping comments and blank lines', () => {
    const p = parseHipsProperties(props('CDS/P/DSS2/color'));
    expect(p.creator_did).toBe('ivo://CDS/P/DSS2/color');
    expect(p.hips_order).toBe('9');
    expect(Object.keys(p)).toHaveLength(3);
  });

  it('accepts only the requested survey in the requested frame', () => {
    expect(propertiesMatch(parseHipsProperties(props('CDS/P/DSS2/color')), dss)).toBe(true);
    expect(propertiesMatch(parseHipsProperties(props('CDS/P/2MASS/color')), dss)).toBe(false);
    expect(
      propertiesMatch(parseHipsProperties(props('CDS/P/Finkbeiner', 'galactic')), halpha),
    ).toBe(true);
    expect(propertiesMatch(parseHipsProperties(props('CDS/P/Finkbeiner')), halpha)).toBe(false);
    // An HTML error page served with 200 is not a properties file.
    expect(propertiesMatch(parseHipsProperties('<!doctype html><title>x</title>'), dss)).toBe(
      false,
    );
  });
});

describe('server choice', () => {
  beforeEach(() => resetServerChoice());

  it('skips servers that are down, refuse, or serve something else', async () => {
    const [cds, esa, mast, irsa] = dss.servers;
    const { fetcher, calls } = fakeFetch({
      [`${cds}/properties`]: () => new Response('<html>404</html>', { status: 404 }),
      [`${esa}/properties`]: () => new Response(props('CDS/P/2MASS/color')),
      // mast: network error (not in table)
      [`${irsa}/properties`]: () => new Response(props('CDS/P/DSS2/color')),
    });
    const src = await pickServer(dss, { fetcher });
    expect(src?.url).toBe(irsa);
    expect(src?.host).toBe('irsa.ipac.caltech.edu');
    expect(calls).toEqual([cds, esa, mast, irsa].map((u) => `${u}/properties`));
    // Remembered for the session: no new requests.
    expect((await pickServer(dss, { fetcher }))?.url).toBe(irsa);
    expect(calls).toHaveLength(4);
  });

  it('returns null when no server answers', async () => {
    const { fetcher } = fakeFetch({});
    expect(await pickServer(dss, { fetcher })).toBeNull();
  });

  it('gives up on a server that hangs', async () => {
    const [first, second] = halpha.servers;
    const fetcher: Fetcher = (url, init) =>
      url === `${first}/properties`
        ? new Promise((_, reject) =>
            init.signal?.addEventListener('abort', () => reject(new DOMException('aborted'))),
          )
        : Promise.resolve(new Response(props('CDS/P/Finkbeiner', 'galactic')));
    const src = await pickServer(halpha, { fetcher, timeoutMs: 20 });
    expect(src?.url).toBe(second);
  });
});

/** Read the GAL2ICRS matrix from the engine patch (column-major mat4). */
function patchMatrix(): number[][] {
  const block = /GAL2ICRS\[4\]\[4\] = \{([\s\S]*?)\};/.exec(patch0003)?.[1] ?? '';
  const nums = (
    block.replace(/^[-+ ]?\s*\/\/.*$/gm, '').match(/[-+]?\d*\.\d+(?:e[-+]?\d+)?|\b[01]\b/g) ?? []
  ).map(Number);
  expect(nums).toHaveLength(16);
  return [0, 1, 2, 3].map((j) => nums.slice(j * 4, j * 4 + 4));
}

/** Engine convention: out[i] = sum_j m[j][i] * v[j]. */
function apply(m: number[][], v: number[]): number[] {
  return [0, 1, 2].map(
    (i) =>
      (m[0]?.[i] ?? 0) * (v[0] ?? 0) +
      (m[1]?.[i] ?? 0) * (v[1] ?? 0) +
      (m[2]?.[i] ?? 0) * (v[2] ?? 0),
  );
}

function radec(v: number[]): [number, number] {
  const [x = 0, y = 0, z = 0] = v;
  const ra = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  return [ra, (Math.asin(z) * 180) / Math.PI];
}

describe('engine galactic rotation (patch 0003)', () => {
  const m = patchMatrix();

  it('puts the galactic centre at RA 266.405°, Dec −28.936° (ICRS)', () => {
    const [ra, dec] = radec(apply(m, [1, 0, 0]));
    expect(ra).toBeCloseTo(266.40499, 3);
    expect(dec).toBeCloseTo(-28.93617, 3);
  });

  it('puts the north galactic pole at RA 192.859°, Dec +27.128° (ICRS)', () => {
    const [ra, dec] = radec(apply(m, [0, 0, 1]));
    expect(ra).toBeCloseTo(192.85948, 3);
    expect(dec).toBeCloseTo(27.12825, 3);
  });

  it('is a pure rotation', () => {
    for (const v of [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ]) {
      expect(Math.hypot(...apply(m, v))).toBeCloseTo(1, 12);
    }
  });
});
