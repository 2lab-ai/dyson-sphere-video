// Shot list for the CRT video-wall plate (pure: imported by scenes/crt.ts and by the edit gate).
// Times come from the approved storyboard (engine/storyboard): every storyboard shot is a structural change here.
// State = `cam` (framing) + `block` (which tubes the camera holds). One extra shot lands on the downbeat inside the
// long close hold, where the camera snaps to the block that holds the dark tube.
import { type AudioLite, type PlateInfo, type Shot, type ShotState } from '../engine/shots';
import { sbShotTimes } from '../engine/storyboard';

const PLAN: Record<string, ShotState[]> = {
  // the whole 6x4 wall -> 4 tubes around the voice -> the one dark tube, the warm dot inside its glass
  wall: [
    { cam: 'wide', block: 'all' },
    { cam: 'close', block: 'voice' },
    { cam: 'macro', block: 'dark' },
  ],
};

/** Extra shots: on the first downbeat after storyboard shot `after` (if it falls before the next one). */
const EXTRA: Record<string, { after: number; s: ShotState }[]> = {
  // the close hold is ~4 beats: on the bar the camera slides right and tilts onto the row that holds the voice and the dark tube
  wall: [{ after: 1, s: { cam: 'tilt', block: 'edge' } }],
};

function sbTimes(p: PlateInfo): number[] {
  try {
    return sbShotTimes(p.id);
  } catch {
    return [p.start];
  }
}

export function shots(p: PlateInfo, au: AudioLite): Shot[] {
  const plan = PLAN[p.variant] ?? PLAN.wall!;
  const ts = sbTimes(p);
  const out: Shot[] = ts.map((t, i) => ({ t: i === 0 ? p.start : t, s: { id: `${p.id}#${i}`, ...plan[Math.min(i, plan.length - 1)]! } }));
  for (const ex of EXTRA[p.variant] ?? []) {
    const a = out[ex.after]?.t ?? p.start, b = out[ex.after + 1]?.t ?? p.end;
    const d = au.downbeats.find((x) => x > a + 0.05 && x < b - 0.05);
    if (d !== undefined) out.push({ t: d, s: { id: `${p.id}#x${ex.after}`, ...ex.s } });
  }
  return out.sort((x, y) => x.t - y.t);
}
