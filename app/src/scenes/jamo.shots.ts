// Shot list for the jamo plate (pure: imported by scenes/jamo.ts and by the edit gate).
// Storyboard times (engine/storyboard) are kept in order; extra shots land on the plate's other beats so the frame
// changes every beat. State = `frame` (camera) + `stage` (what the jamo are doing: the layout/topology).
import { type AudioLite, type PlateInfo, type Shot, type ShotState } from '../engine/shots';
import { sbShotTimes } from '../engine/storyboard';

/** One state per storyboard shot, in storyboard order. */
const PLAN: Record<string, ShotState[]> = {
  // the line assembled in geometric jamo on white -> close on 변화 while the jamo break apart
  ahn: [
    { frame: 'wide', stage: 'assemble' },
    { frame: 'close', stage: 'burst' },
  ],
};

/** Extra shots on beats that fall between storyboard shots: [beat index inside the plate, state]. */
const EXTRA: Record<string, { beat: number; s: ShotState }[]> = {
  ahn: [
    // downbeat: the assembled line locks, camera leans in on the first word
    { beat: 0, s: { frame: 'lean', stage: 'lock' } },
    // next beat: the first crack, mid framing
    { beat: 1, s: { frame: 'mid', stage: 'crack' } },
    // last beat: pull back, everything flies (the snap back to the block lands on the cut)
    { beat: 3, s: { frame: 'fly', stage: 'scatter' } },
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
  const plan = PLAN[p.variant] ?? PLAN.ahn!;
  const ts = sbTimes(p);
  const out: Shot[] = ts.map((t, i) => ({ t: i === 0 ? p.start : t, s: { id: `${p.id}/${i}`, ...plan[Math.min(i, plan.length - 1)]! } }));
  const beats = au.beats.filter((b) => b > p.start + 0.05 && b < p.end - 0.05);
  for (const ex of EXTRA[p.variant] ?? []) {
    const b = beats[ex.beat];
    if (b === undefined) continue;
    if (out.some((s) => Math.abs(s.t - b) < 0.05)) continue; // never move or shadow a storyboard shot
    out.push({ t: b, s: { id: `${p.id}/x${ex.beat}`, ...ex.s } });
  }
  return out.sort((x, y) => x.t - y.t);
}
