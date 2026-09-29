// Shot list for the ecg plates (pure: imported by scenes/ecg.ts and by the edit gate).
// State = camera (`frame`) + lyric layout (`layout`) + what the figures are doing (`topo`) + medium.
// Every approved storyboard shot (engine/storyboard) is kept at its exact time; the extra cuts sit on beats/downbeats.
import { beatTimes, barTimes, type AudioLite, type PlateInfo, type Shot, type ShotState } from '../engine/shots';
import { sbShotTimes } from '../engine/storyboard';

type St = Omit<ShotState, 'id'> & { frame: string; layout: string; topo: string; medium: string };

/** Approved storyboard states per variant, in storyboard order (index 0 = the plate start). */
const SB: Record<string, St[]> = {
  // p12: two Lissajous figures on a green-phosphor XY scope
  xy: [
    { frame: 'wide', layout: 'under', topo: 'apart', medium: 'phosphor' },
    { frame: 'close', layout: 'over', topo: 'falter', medium: 'phosphor' },
    { frame: 'macro', layout: 'across', topo: 'lock', medium: 'phosphor' },
    { frame: 'bezel', layout: 'bezel', topo: 'collapse', medium: 'tube' },
  ],
  // p30: pulsar ridgelines, white on black
  ridge: [
    { frame: 'cover', layout: 'ride', topo: 'pulse', medium: 'ridge' },
    { frame: 'tilt', layout: 'ride-slant', topo: 'machine', medium: 'ridge' },
    { frame: 'top', layout: 'ride-flat', topo: 'regular', medium: 'ridge' },
  ],
};

/** Extra cuts: [time, state]. Times come from the beat grid only. */
function extras(p: PlateInfo, au: AudioLite): [number, St][] {
  const beats = beatTimes(au, p.start + 1e-3, p.end - 1e-3);
  const downs = barTimes(au, p.start + 1e-3, p.end - 1e-3);
  const sb = sbShotTimes(p.id);
  const out: [number, St][] = [];
  if (p.variant === 'xy') {
    // the figure recovers: the camera pulls back to the gap where the beam writes the words
    const b1 = beats.find((x) => x > sb[1]! + 0.8);
    if (b1 !== undefined) out.push([b1, { frame: 'gap', layout: 'between', topo: 'recover', medium: 'phosphor' }]);
    // the locked pair slides into one figure, seen from a canted frame
    const b2 = beats.find((x) => x > sb[2]! + 1.0);
    if (b2 !== undefined) out.push([b2, { frame: 'pair', layout: 'top', topo: 'merge', medium: 'phosphor' }]);
    // the one figure opens into a circle: the first orbit, the words written around it
    const d = downs.find((x) => x > (b2 ?? sb[2]!) + 0.5 && x < sb[3]! - 0.5);
    if (d !== undefined) out.push([d, { frame: 'orbit', layout: 'ring', topo: 'orbit', medium: 'phosphor' }]);
  } else if (p.variant === 'ridge') {
    // tight on the front peaks as the first heartbeats enter
    const d0 = downs.find((x) => x > sb[0]! + 0.8 && x < sb[1]! - 0.3);
    if (d0 !== undefined) out.push([d0, { frame: 'close', layout: 'ride-close', topo: 'pulse', medium: 'ridge' }]);
    // grazing along the rows: identical peaks marching to the horizon
    const b1 = beats.find((x) => x > sb[1]! + 0.9 && x < sb[2]! - 0.3);
    if (b1 !== undefined) out.push([b1, { frame: 'low', layout: 'ride-low', topo: 'machine', medium: 'ridge' }]);
    // the lines go flat
    const b2 = beats.find((x) => x > sb[2]! + 0.5);
    if (b2 !== undefined) out.push([b2, { frame: 'top-wide', layout: 'ride-flat', topo: 'flat', medium: 'ridge' }]);
  }
  return out;
}

export function shots(p: PlateInfo, au: AudioLite): Shot[] {
  const sb = SB[p.variant];
  if (!sb) throw new Error(`ecg: unknown variant ${p.variant}`);
  const times = sbShotTimes(p.id);
  const list: [number, St][] = times.map((t, i) => [i === 0 ? p.start : t, sb[Math.min(i, sb.length - 1)]!]);
  list.push(...extras(p, au));
  list.sort((a, b) => a[0] - b[0]);
  return list.map(([t, s], i) => ({ t, s: { id: `${p.id}#${i}`, ...s } }));
}
