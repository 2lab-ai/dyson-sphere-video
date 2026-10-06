// Shot list for the dither plates (pure: imported by scenes/dither.ts and by the edit gate).
// bomb (p37): P8 1-bit ordered dither (Obra Dinn). State = `cam` (framing of the frozen 3D moment) + `stage` (what the
// world is: the desert before, the cloud after).
//   181.659  flat   desert   a 1-bit desert and the test tower, eye level, silence (only the tower lamp blinks per beat)
//   +2 beats close  desert   extra: up at the shed on top of the tower, the lamp large, the desert far below
//   183.989  wide   cloud    WHITEOUT on the downbeat, then the dithered mushroom cloud rises one band per beat
//   185.155  low    cloud    low: from the ground, the column towering
//   +1.5 b   low    lamps    extra (exit): the cloud's 1-bit pixels coarsen into a grid of round lamps (-> ENIAC)
import { beatTimes, type AudioLite, type PlateInfo, type Shot, type ShotState } from '../engine/shots';
import { sbShotTimes } from '../engine/storyboard';

/** Storyboard shots, in order. */
const PLAN: ShotState[] = [
  { cam: 'flat', stage: 'desert' },
  { cam: 'wide', stage: 'cloud' },
  { cam: 'low', stage: 'cloud' },
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
  const sb = out.map((x) => x.t);
  // extra 1: the half-bar of the silent bar (beat 3), close on the tower top
  const a = sb[0]!, b = sb[1] ?? p.end;
  const bt = beatTimes(au, a + 0.05, b - 0.05);
  const half = bt[1];
  if (half !== undefined) out.push({ t: half, s: { id: `${p.id}#x0`, cam: 'close', stage: 'desert' } });
  // extra 2 (exit): the last beat of the plate, the lamps (the off-beat half, so the cloud's last band still lands)
  const last = beatTimes(au, (sb[2] ?? a) + 0.05, p.end - 0.05);
  // v4: the exit is the last half-bar (beats 7–8): night falls, the dots glow as a grid above the horizon, camera static
  const lb = last[last.length - 2] ?? last[last.length - 1];
  if (lb !== undefined) out.push({ t: lb, s: { id: `${p.id}#x1`, cam: 'low', stage: 'lamps' } });
  return out.sort((x, y) => x.t - y.t);
}
