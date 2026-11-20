/**
 * One-time clean-up of browser storage from builds that shipped the owner's own equipment
 * (C9.25 + ATR585M, Angeleyes 60 mm guide scope, Sony a6100 + 11 mm). Those builds copied the
 * C9.25 into every visitor's deep-sky setup on the first visit, so it still drew in the camera
 * frame. The owner asked for it to be removed (2026-11-20): matching setups go back to the
 * generic defaults, once per browser. Everything else the visitor saved is kept.
 */
const DONE_KEY = 'anp.migrate.ownerRig.v1';
const SETUPS_KEY = 'anp.setups.v1';
const MINE_KEY = 'anp.mysetup.v1';
const ACTIVE_KEY = 'anp.profile.active.v1';
const OLD_PROFILE_IDS = ['c925r', 'c925', 'guide60', 'a6100w'];

interface RigLike {
  telescope?: unknown;
  camera?: unknown;
  apertureMm?: unknown;
  focalMm?: unknown;
}

/** One of the owner's rigs that older builds shipped. Exported for tests. */
export function isOwnerRig(s: RigLike | null | undefined): boolean {
  if (!s || typeof s !== 'object') return false;
  const t = String(s.telescope ?? '');
  const c = String(s.camera ?? '');
  if (/C\s?9\.25|Angeleyes/i.test(t)) return true;
  if (/ATR585M/i.test(c)) return true;
  if (/a6100/i.test(c) && Number(s.focalMm) === 11) return true;
  return false;
}

/** Drop the owner's rigs from storage once; returns true when something was removed. */
export function removeOwnerRigs(store: Storage = localStorage): boolean {
  try {
    if (store.getItem(DONE_KEY)) return false;
    let changed = false;
    const raw = store.getItem(SETUPS_KEY);
    if (raw) {
      const all = JSON.parse(raw) as Record<string, RigLike>;
      // A kind left out is filled with the generic default by loadSetups.
      const kept = Object.fromEntries(Object.entries(all).filter(([, s]) => !isOwnerRig(s)));
      if (Object.keys(kept).length !== Object.keys(all).length) {
        store.setItem(SETUPS_KEY, JSON.stringify(kept));
        changed = true;
      }
    }
    const mine = store.getItem(MINE_KEY);
    if (mine && isOwnerRig(JSON.parse(mine) as RigLike)) {
      store.removeItem(MINE_KEY);
      changed = true;
    }
    const active = store.getItem(ACTIVE_KEY);
    if (
      active &&
      (OLD_PROFILE_IDS.includes(active) || (active === 'mine' && !store.getItem(MINE_KEY)))
    ) {
      store.removeItem(ACTIVE_KEY);
      changed = true;
    }
    store.setItem(DONE_KEY, '1');
    return changed;
  } catch {
    return false; // private mode or unreadable data: nothing to clean
  }
}
