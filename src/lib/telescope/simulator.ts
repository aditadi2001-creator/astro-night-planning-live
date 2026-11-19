/**
 * A simulated German equatorial mount for trying the HUD without hardware (and for tests). It
 * starts parked at the celestial pole, tracks, slews at 4°/s along a great circle and takes the
 * pier side a real GEM would. Clearly labelled "Simulator" everywhere it appears.
 */
import {
  altAzNow,
  expectedPier,
  hourAngleH,
  hoursToMeridian,
  j2000ToNow,
  localSiderealH,
  nowToJ2000,
} from './coords';
import type { MountState, PierSide, TelescopeAdapter } from './types';

const D2R = Math.PI / 180;
const RATE_DEG_S = 4;

function toVec(ra: number, dec: number): [number, number, number] {
  return [
    Math.cos(dec * D2R) * Math.cos(ra * D2R),
    Math.cos(dec * D2R) * Math.sin(ra * D2R),
    Math.sin(dec * D2R),
  ];
}
function fromVec(v: [number, number, number]) {
  const ra = (Math.atan2(v[1], v[0]) / D2R + 360) % 360;
  const dec = Math.asin(Math.max(-1, Math.min(1, v[2]))) / D2R;
  return { ra, dec };
}
/** Point a fraction t of the way from a to b along the great circle (slerp). */
export function slerp(ra1: number, dec1: number, ra2: number, dec2: number, t: number) {
  const a = toVec(ra1, dec1);
  const b = toVec(ra2, dec2);
  const dot = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
  const om = Math.acos(dot);
  if (om < 1e-9) return { ra: ra2, dec: dec2, sepDeg: 0 };
  const s1 = Math.sin((1 - t) * om) / Math.sin(om);
  const s2 = Math.sin(t * om) / Math.sin(om);
  const p = fromVec([a[0] * s1 + b[0] * s2, a[1] * s1 + b[1] * s2, a[2] * s1 + b[2] * s2]);
  return { ...p, sepDeg: om / D2R };
}

export function simulatorAdapter(
  site: { lat: number; lon: number },
  now: () => Date = () => new Date(),
): TelescopeAdapter {
  const t0 = now();
  const poleDec = site.lat >= 0 ? 89.9 : -89.9;
  /** Park position: on the meridian next to the visible pole, fixed in altitude/azimuth. */
  const parkAt = (d: Date) => nowToJ2000(localSiderealH(d, site.lon) * 15, poleDec, d);
  let { ra, dec } = parkAt(t0);
  let target: { ra: number; dec: number } | null = null;
  let parked = true;
  let pier: PierSide = 'unknown';
  let last = t0.getTime();

  function step(date: Date) {
    const dt = Math.max(0, (date.getTime() - last) / 1000);
    last = date.getTime();
    if (parked) {
      ({ ra, dec } = parkAt(date));
      return;
    }
    if (!target) return;
    const sep = slerp(ra, dec, target.ra, target.dec, 0).sepDeg;
    const move = RATE_DEG_S * dt;
    if (move >= sep) {
      ({ ra, dec } = target);
      target = null;
      const lst = localSiderealH(date, site.lon);
      pier = expectedPier(hourAngleH(lst, j2000ToNow(ra, dec, date).ra));
    } else {
      ({ ra, dec } = slerp(ra, dec, target.ra, target.dec, move / sep));
    }
  }

  return {
    kind: 'simulator',
    label: 'the simulator',
    read() {
      const date = now();
      step(date);
      const p = j2000ToNow(ra, dec, date);
      const lst = localSiderealH(date, site.lon);
      const { alt, az } = altAzNow(p.ra, p.dec, site.lat, lst);
      const ha = hourAngleH(lst, p.ra);
      const s: MountState = {
        connected: true,
        ra2000: ra,
        dec2000: dec,
        raNow: p.ra,
        decNow: p.dec,
        epoch: 'J2000',
        alt,
        az,
        pier: parked ? 'unknown' : pier,
        tracking: !parked,
        slewing: target != null,
        atPark: parked,
        lstH: lst,
        // A real mount flips when the meridian is crossed on the west side of the pier.
        flipInH: !parked && pier === 'west' && ha < 0 ? hoursToMeridian(ha) : null,
        rotatorDeg: null,
        at: date.getTime(),
      };
      return Promise.resolve(s);
    },
    slew(r, d) {
      step(now());
      parked = false;
      last = now().getTime();
      target = { ra: r, dec: d };
      return Promise.resolve();
    },
    sync(r, d) {
      ra = r;
      dec = d;
      target = null;
      return Promise.resolve();
    },
    stop() {
      step(now());
      target = null;
      return Promise.resolve();
    },
  };
}
