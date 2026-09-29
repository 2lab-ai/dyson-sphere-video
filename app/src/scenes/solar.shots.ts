// Shot list for the solar plate (pure: imported by scenes/solar.ts and by the edit gate).
// p15 `sun`: the storyboard fixes two shots (wide nebula collapse at the plate start, close ignition on the next
// downbeat). Each bar is split once more on its third beat, so the camera never holds longer than half a bar:
//   wide/nebula  -> infall/protostar (tight on the anchor, the cloud spun into a disc)
//   close/disc   -> limb (the camera slides onto the limb: prominences against black, the exit flare)
import { type AudioLite, type PlateInfo, type Shot, type ShotState } from '../engine/shots';
import { beatTimes } from '../engine/shots';
import { sbShotTimes } from '../engine/storyboard';

/** One state per storyboard shot, in storyboard order. */
const PLAN: Record<string, ShotState[]> = {
  sun: [
    { frame: 'wide', stage: 'nebula' },
    { frame: 'close', stage: 'disc' },
  ],
};

/** Extra shot after storyboard shot `after`: on its third beat (the half bar), if before the next shot. */
const EXTRA: Record<string, { after: number; s: ShotState }[]> = {
  sun: [
    { after: 0, s: { frame: 'infall', stage: 'protostar' } },
    { after: 1, s: { frame: 'limb', stage: 'disc' } },
  ],
};

function sbTimes(p: PlateInfo): number[] {
  try {
    return sbShotTimes(p.id);
  } catch {
    return [p.start];
  }
}

export function shots(p: PlateInfo, au: AudioLite): Shot[] {
  const plan = PLAN[p.variant] ?? PLAN.sun!;
  const ts = sbTimes(p);
  const out: Shot[] = ts.map((t, i) => ({ t: i === 0 ? p.start : t, s: { id: `${p.id}#${i}`, ...plan[Math.min(i, plan.length - 1)]! } }));
  const sb = out.map((s) => s.t); // storyboard shots only (extras are appended below)
  for (const ex of EXTRA[p.variant] ?? []) {
    const a = sb[ex.after] ?? p.start, b = sb[ex.after + 1] ?? p.end;
    const third = beatTimes(au, a + 0.05, b - 0.05)[1]; // beats after `a`: [2nd, 3rd, ...] -> the 3rd beat of the bar
    if (third !== undefined) out.push({ t: third, s: { id: `${p.id}#x${ex.after}`, ...ex.s } });
  }
  return out.sort((x, y) => x.t - y.t);
}
