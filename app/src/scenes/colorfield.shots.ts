// Shot list for the colorfield plates (pure: imported by scenes/colorfield.ts and by the edit gate).
// A2 Ganzfeld (James Turrell): a wall with a knife-edged aperture of dawn light. Structure = camera (`cam`) + what the
// field is (`field`): the previous plate's ring still in frame -> the clean aperture in its wall -> pushing into the
// aperture while its edge dissolves -> the Ganzfeld (no edges at all). Every storyboard shot is a state change here.
import { type AudioLite, type PlateInfo, type Shot, type ShotState } from '../engine/shots';
import { sbShotTimes } from '../engine/storyboard';

/** Per variant: one state per storyboard shot, in storyboard order. */
const PLAN: Record<string, ShotState[]> = {
  // wide: aperture in a wall (the cage ring is shoved out) -> push: the edge vanishing -> flat: only dawn
  freedom: [
    { cam: 'wide', field: 'ring' },
    { cam: 'push', field: 'dissolve' },
    { cam: 'flat', field: 'ganzfeld' },
  ],
};

/** Extra (non-storyboard) shots: on the first downbeat after storyboard shot `after` (if before the next one). */
const EXTRA: Record<string, { after: number; s: ShotState }[]> = {
  // first downbeat: the ring is gone and the camera settles closer on the clean aperture (hold, then snap)
  freedom: [{ after: 0, s: { cam: 'wall', field: 'aperture' } }],
};

function sbTimes(p: PlateInfo): number[] {
  try {
    return sbShotTimes(p.id);
  } catch {
    return [p.start];
  }
}

export function shots(p: PlateInfo, au: AudioLite): Shot[] {
  const plan = PLAN[p.variant] ?? PLAN.freedom!;
  const ts = sbTimes(p);
  const out: Shot[] = ts.map((t, i) => ({ t: i === 0 ? p.start : t, s: { id: `${p.id}#${i}`, ...plan[Math.min(i, plan.length - 1)]! } }));
  for (const ex of EXTRA[p.variant] ?? []) {
    const a = out[ex.after]?.t ?? p.start, b = out[ex.after + 1]?.t ?? p.end;
    const d = au.downbeats.find((x) => x > a + 0.05 && x < b - 0.05);
    if (d !== undefined) out.push({ t: d, s: { id: `${p.id}#x${ex.after}`, ...ex.s } });
  }
  return out.sort((x, y) => x.t - y.t);
}
