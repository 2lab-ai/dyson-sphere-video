// Shot list for the cosmic-web plate (pure: imported by scenes/cosmicweb.ts and by the edit gate).
// Powers-of-Ten idiom applied to metric expansion. The camera is LOCKED between downbeats (the fixed Eames square
// is the scale reference) while the separations grow one step per beat; the only camera move is the power-of-ten
// push on the downbeat. State = `decade` (the scale of the fixed square, 10^decade m) + `stage` (what the field is).
//   #0  69.781  wide  decade 25: fog condenses into the web on beat 1, then the gaps grow per beat
//   #x  70.947  wide  decade 25: the next decade is marked: a 1/10 inset square opens on one filament knot
//   #1  72.112  tilt  decade 24: pushed through the inset: galaxy groups strung along one filament, still separating
//   #x  last beat     decade 24: exit, one galaxy brightens into a nebula (hand-off to the Sun plate)
import { beatTimes, type AudioLite, type PlateInfo, type Shot, type ShotState } from '../engine/shots';
import { sbShotTimes } from '../engine/storyboard';

const PLAN: ShotState[] = [
  { cam: 'wide', stage: 'web', decade: 25 },
  { cam: 'tilt', stage: 'groups', decade: 24 },
];

function sbTimes(p: PlateInfo): number[] {
  try {
    return sbShotTimes(p.id);
  } catch {
    return [p.start];
  }
}

export function shots(p: PlateInfo, au: AudioLite): Shot[] {
  const ts = sbTimes(p);
  const out: Shot[] = ts.map((t, i) => ({ t: i === 0 ? p.start : t, s: { id: `${p.id}#${i}`, ...PLAN[Math.min(i, PLAN.length - 1)]! } }));
  // extra 1: the 3rd beat of bar 1 — the inset square (the next decade) opens
  const t1 = out[1]?.t ?? p.end;
  const b1 = beatTimes(au, p.start + 0.05, t1 - 0.05);
  if (b1.length >= 2) out.push({ t: b1[1]!, s: { id: `${p.id}#inset`, cam: 'wide', stage: 'inset', decade: 25 } });
  // extra 2: the last beat of the plate — one galaxy flares into a nebula
  const b2 = beatTimes(au, t1 + 0.05, p.end - 0.05);
  const last = b2[b2.length - 1];
  if (last !== undefined) out.push({ t: last, s: { id: `${p.id}#nebula`, cam: 'tilt', stage: 'nebula', decade: 24 } });
  return out.sort((x, y) => x.t - y.t);
}
