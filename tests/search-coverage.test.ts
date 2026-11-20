import { describe, expect, it } from 'vitest';
import {
  dsoEntries,
  engineEntries,
  norm,
  onlineCatalogEntries,
  search,
  starEntries,
  surveyEntries,
  tidyDesignation,
  type Shard,
} from '../src/lib/search/index';
import { parseSdssTsv } from '../src/lib/search/client';
import { SURVEYS } from '../src/lib/sky/surveys';
import { bestSurveys, covers } from '../src/lib/sky/survey-pick';
import coreJson from '../public/catalog/dso-core-v1.json';
import galJson from '../public/catalog/dso-galaxies-v1.json';
import starsJson from '../public/catalog/stars-v1.json';
import ngc from '../public/skydata/dsonames.json';
import neb from '../public/skydata/nebulae.json';

describe('everything the sky draws can be searched', () => {
  const core = dsoEntries(coreJson as unknown as Shard);
  const gal = dsoEntries(galJson as unknown as Shard);
  const base = [...core, ...gal, ...starEntries(starsJson as unknown as Shard)];
  const known = new Set(base.flatMap((e) => e.ids));
  const extra = engineEntries(known, ngc, neb);
  const all = [...onlineCatalogEntries(), ...surveyEntries(SURVEYS), ...base, ...extra];
  const ids = new Set(all.flatMap((e) => e.ids));

  it('indexes every OpenNGC and nebula name the engine draws', () => {
    // The engine's name field joins designations and names with "|" ("M 31|NGC 224|Andromeda
    // Galaxy"): every designation in it must be searchable.
    for (const r of ngc.rows)
      for (const d of String(r[0])
        .split('|')
        .filter((x) => /\d/.test(x)))
        expect(ids.has(norm(d)), d).toBe(true);
    for (const r of neb.rows) expect(ids.has(norm(String(r[0]))), String(r[0])).toBe(true);
    // Objects missing from the Stellarium-based shards (NGC 3184, NGC 5907, IC 27…), and no
    // duplicates of ones already there (M 31 stays a single entry).
    expect(extra.length).toBeGreaterThan(1000);
    expect(extra.some((e) => e.ids.includes('m31'))).toBe(false);
  });
  it('finds objects that used to be missing', () => {
    for (const q of ['NGC 3184', 'NGC 5907', 'IC 27', 'LDN 1630'])
      expect(search(all, q, 3)[0]?.entry.label.split(' · ')[0]).toBe(q);
  });
  it('tidies OpenNGC-style designations', () => {
    expect(tidyDesignation('ESO056-115')).toBe('ESO 56-115');
    expect(tidyDesignation('PGC088608')).toBe('PGC 88608');
    expect(tidyDesignation('Mel071')).toBe('Mel 71');
    expect(tidyDesignation('NGC 7000')).toBe('NGC 7000');
  });
  it('no longer answers short designations with unrelated bright stars', () => {
    const hits = search(all, 'MCG+07-23-019', 5).map((h) => h.entry.label);
    expect(hits).not.toContain('Sirius');
    expect(search(all, 'Mrk 421', 5).map((h) => h.entry.label)).not.toContain('Sirius');
  });
  it('lists SDSS objects before the SDSS survey for "sdss"', () => {
    const top = search(all, 'sdss', 3);
    expect(top[0]?.entry.ref).toBe('online:sdss');
    expect(top.some((h) => h.entry.kind === 'survey')).toBe(true);
  });
});

describe('SDSS from VizieR', () => {
  it('parses the TSV reply, skipping duplicates', () => {
    const tsv = [
      '#Table V/154/sdss16',
      'SDSS16\tRA_ICRS\tDE_ICRS\trmag\tzsp\tspCl',
      '------\t---',
      'SDSS J133103.20+470707.7\t202.763353\t+47.118828\t16.789\t 0.10639\tGALAXY',
      'SDSS J133103.20+470707.7\t202.763353\t+47.118828\t16.789\t 0.10639\tGALAXY',
      'SDSS J132924.50+470032.5\t202.352084\t+47.009032\t18.154\t 1.83232\tQSO',
    ].join('\n');
    const r = parseSdssTsv(tsv);
    expect(r).toHaveLength(2);
    expect(r[0]?.ra).toBeCloseTo(202.763, 3);
    expect(r[0]?.sub).toMatch(/Galaxy.*redshift 0.1064/);
    expect(r[1]?.sub).toMatch(/Quasar/);
  });
});

describe('best surveys for an object', () => {
  it('suits the survey to the object and its place in the sky', () => {
    // M 51 (galaxy, north Galactic cap): deep galaxy surveys first.
    const m51 = bestSurveys('galaxy', 202.47, 47.195, 11).map((p) => p.survey.id);
    expect(m51[0]).toBe('legacy');
    expect(m51).toContain('sdss');
    // M 31 is outside Legacy DR10 and SDSS's main footprint.
    const m31 = bestSurveys('galaxy', 10.68, 41.27, 190).map((p) => p.survey.id);
    expect(m31).not.toContain('legacy');
    expect(m31[0]).toBe('panstarrs');
    // North America Nebula: hydrogen-alpha first; it is large (2°+), so the whole-sky map leads.
    const nan = bestSurveys('emission', 314.7, 44.5, 120).map((p) => p.survey.id);
    expect(nan.slice(0, 2)).toEqual(['vtss', 'dss']);
    expect(bestSurveys('emission', 314.7, 44.5, 240)[0]?.survey.id).toBe('halpha');
    // Carina Nebula (dec −60): no Pan-STARRS or VTSS there; SHASSA instead.
    const car = bestSurveys('emission', 161.26, -59.87, 120).map((p) => p.survey.id);
    expect(car).not.toContain('panstarrs');
    expect(car[0]).toBe('shassa');
  });
  it('knows rough footprints', () => {
    expect(covers('panstarrs', 0, -40)).toBe(false);
    expect(covers('skymapper', 0, 40)).toBe(false);
    expect(covers('dss', 0, -89)).toBe(true);
  });
});
