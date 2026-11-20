import { describe, expect, it } from 'vitest';
import { isOwnerRig, removeOwnerRigs } from '../src/lib/migrate';

function memStore(init: Record<string, string>): Storage {
  const m = new Map(Object.entries(init));
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: () => null,
    get length() {
      return m.size;
    },
  } as Storage;
}

const c925 = {
  kind: 'deepsky',
  telescope: 'Celestron C9.25 + 0.63× reducer',
  apertureMm: 235,
  focalMm: 1210,
  camera: 'ToupTek ATR585M',
};
const mineGeneric = {
  kind: 'deepsky',
  telescope: 'My 102 mm',
  apertureMm: 102,
  focalMm: 714,
  camera: 'ZWO ASI533MC Pro',
};

describe("removing the owner's old rigs from browsers", () => {
  it('recognises the rigs older builds shipped, not other equipment', () => {
    expect(isOwnerRig(c925)).toBe(true);
    expect(
      isOwnerRig({ telescope: 'Angeleyes 60 mm guide scope', camera: 'ZWO ASI585MC Pro' }),
    ).toBe(true);
    expect(isOwnerRig({ telescope: '11 mm f/1.8 lens', camera: 'Sony a6100', focalMm: 11 })).toBe(
      true,
    );
    expect(isOwnerRig(mineGeneric)).toBe(false);
    expect(isOwnerRig({ telescope: 'Celestron C8 (SCT)', camera: 'ZWO ASI462MC' })).toBe(false);
  });

  it('drops them from setups, My setup and the active profile, once, keeping the rest', () => {
    const planetary = {
      kind: 'planetary',
      telescope: 'C8',
      apertureMm: 203,
      focalMm: 2032,
      camera: 'ZWO ASI462MC',
    };
    const s = memStore({
      'anp.setups.v1': JSON.stringify({ deepsky: c925, planetary }),
      'anp.mysetup.v1': JSON.stringify(c925),
      'anp.profile.active.v1': 'mine',
      'anp.location.v1': '{"name":"Home","lat":1,"lon":2,"elevation":3}',
    });
    expect(removeOwnerRigs(s)).toBe(true);
    expect(JSON.parse(s.getItem('anp.setups.v1') as string)).toEqual({ planetary });
    expect(s.getItem('anp.mysetup.v1')).toBeNull();
    expect(s.getItem('anp.profile.active.v1')).toBeNull();
    expect(s.getItem('anp.location.v1')).not.toBeNull();
    // Runs once: equipment entered later (even a C9.25) is the visitor's own and stays.
    s.setItem('anp.mysetup.v1', JSON.stringify(c925));
    expect(removeOwnerRigs(s)).toBe(false);
    expect(s.getItem('anp.mysetup.v1')).not.toBeNull();
  });

  it("keeps a visitor's own setup and an old starter id falls back", () => {
    const s = memStore({
      'anp.mysetup.v1': JSON.stringify(mineGeneric),
      'anp.profile.active.v1': 'c925r',
    });
    removeOwnerRigs(s);
    expect(s.getItem('anp.mysetup.v1')).not.toBeNull();
    expect(s.getItem('anp.profile.active.v1')).toBeNull();
  });
});
