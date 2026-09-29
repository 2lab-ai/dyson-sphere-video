// Shot list for the bigbang plates (pure: imported by scenes/bigbang.ts and by the edit gate).
// State = `cam` (framing: flat uniform field vs close, layered plumes) + `stage` (what the matter is: a uniform
// white-hot plasma, a granulating plasma with voids opening, ink-in-water curls, thinning filaments).
// bang (p13): the two storyboard shots (65.12 flat white-hot, 67.451 close gold curls) plus two extras on beats:
// the half-bar of the white bar where the plasma breaks into cells, and the half-bar of the curl bar where the curls
// thin into filaments (the storyboard exit).
import { beatTimes, type AudioLite, type PlateInfo, type Shot, type ShotState } from '../engine/shots';
import { sbShotTimes } from '../engine/storyboard';

export const STAGES = ['white', 'cells', 'curls', 'filament'] as const;
export type Stage = (typeof STAGES)[number];

/** Storyboard shots, in order. */
const PLAN: ShotState[] = [
  { cam: 'flat', stage: 'white' },
  { cam: 'close', stage: 'curls' },
];
/** Extras: on the 3rd beat after storyboard shot `after` (the half-bar), if before the next shot. */
const EXTRA: { after: number; s: ShotState }[] = [
  { after: 0, s: { cam: 'flat', stage: 'cells' } },
  { after: 1, s: { cam: 'deep', stage: 'filament' } },
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
  for (const ex of EXTRA) {
    const a = sb[ex.after] ?? p.start, b = sb[ex.after + 1] ?? p.end;
    const bt = beatTimes(au, a + 0.05, b - 0.05);
    const d = bt[1] ?? bt[0]; // the half-bar beat (beat 3 of 4)
    if (d !== undefined) out.push({ t: d, s: { id: `${p.id}#x${ex.after}`, ...ex.s } });
  }
  return out.sort((x, y) => x.t - y.t);
}
