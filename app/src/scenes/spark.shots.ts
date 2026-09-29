// Shot list for the spark plates (pure: imported by scenes/spark.ts and by the edit gate).
// Times come from the approved storyboard (docs/STORYBOARD.md via engine/storyboard): every storyboard shot is a
// structural change here, in order. State = `frame` (camera) + `stage` (what the marks are: medium/topology).
// A few extra shots land on downbeats where the storyboard leaves a long hold (EXTRA below).
import { type AudioLite, type PlateInfo, type Shot, type ShotState } from '../engine/shots';
import { sbShotTimes } from '../engine/storyboard';

/** Per variant: one state per storyboard shot, in storyboard order. */
const PLAN: Record<string, ShotState[]> = {
  // black; ignition + one hairline -> street/window strokes -> circuit (hard cut) -> tight tracking, speed streaks -> whip
  write: [
    { frame: 'wide', stage: 'ignite' },
    { frame: 'write', stage: 'street' },
    { frame: 'macro', stage: 'circuit' },
    { frame: 'track', stage: 'streak' },
    { frame: 'whip', stage: 'streak' },
  ],
  // side tracking on the ruler -> head-on (the point rushes at the camera) -> overhead vanishing strip -> locked, exit right
  race: [
    { frame: 'side', stage: 'ruler' },
    { frame: 'headon', stage: 'ruler' },
    { frame: 'overhead', stage: 'strip' },
    { frame: 'locked', stage: 'ruler' },
  ],
  // constellation in the pupil reflection -> the points stand up as a city model -> flattened into a button grid
  glint: [
    { frame: 'pupil', stage: 'constellation' },
    { frame: 'model', stage: 'city' },
    { frame: 'front', stage: 'buttons' },
  ],
  // different marks -> uniform grid with the line printed on it -> the grid compresses -> one point
  merge: [
    { frame: 'field', stage: 'marks' },
    { frame: 'field', stage: 'grid' },
    { frame: 'close', stage: 'compress' },
    { frame: 'void', stage: 'point' },
  ],
  // the point alone with its hairline -> hairline undrawing
  outro: [
    { frame: 'wide', stage: 'hairline' },
    { frame: 'close', stage: 'undraw' },
  ],
};

/** Extra (non-storyboard) shots: on the first downbeat after storyboard shot `after` (if before the next one). */
const EXTRA: Record<string, { after: number; s: ShotState }[]> = {
  // climax downbeat (first flare): the camera leans in on the marks before they are forced into line
  merge: [{ after: 0, s: { frame: 'lean', stage: 'marks' } }],
  // outro: the second downbeat tightens the wide frame to a mid frame while the point keeps shrinking
  outro: [{ after: 0, s: { frame: 'mid', stage: 'hairline' } }],
};

function sbTimes(p: PlateInfo): number[] {
  try {
    return sbShotTimes(p.id);
  } catch {
    return [p.start];
  }
}

export function shots(p: PlateInfo, au: AudioLite): Shot[] {
  const plan = PLAN[p.variant] ?? PLAN.write!;
  const ts = sbTimes(p);
  const out: Shot[] = ts.map((t, i) => ({ t: i === 0 ? p.start : t, s: { id: `${p.id}#${i}`, ...plan[Math.min(i, plan.length - 1)]! } }));
  for (const ex of EXTRA[p.variant] ?? []) {
    const a = out[ex.after]?.t ?? p.start, b = out[ex.after + 1]?.t ?? p.end;
    const d = au.downbeats.find((x) => x > a + 0.05 && x < b - 0.05);
    if (d !== undefined) out.push({ t: d, s: { id: `${p.id}#x${ex.after}`, ...ex.s } });
  }
  return out.sort((x, y) => x.t - y.t);
}
