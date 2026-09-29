// Shot list for the LiDAR plate (pure: imported by scenes/lidar.ts and by the edit gate).
// Times come from the approved storyboard (engine/storyboard): every storyboard shot is a structural change here,
// in order. State = `cam` (camera framing) + `scan` (what the sensor is doing: the medium/topology of the returns).
// Two extra shots land on downbeats inside the long holds (the overhead and the side angle each get a second angle).
import { type AudioLite, type PlateInfo, type Shot, type ShotState } from '../engine/shots';
import { sbShotTimes } from '../engine/storyboard';

/** Per variant: one state per storyboard shot, in storyboard order. */
const PLAN: Record<string, ShotState[]> = {
  // black room, sensor spins up (sparse ring banks) -> overhead plan fills in -> side, the figures come back as
  // returns -> close on the figures, depth-coded, the scanner stops
  room: [
    { cam: 'wide', scan: 'spinup' },
    { cam: 'top', scan: 'plan' },
    { cam: 'side', scan: 'figures' },
    { cam: 'close', scan: 'depth' },
  ],
};

/** Extra shots: on the first downbeat after storyboard shot `after` (if it is before the next one). */
const EXTRA: Record<string, { after: number; s: ShotState }[]> = {
  room: [
    // overhead, second angle: the camera swings round behind the sensor, still high
    { after: 1, s: { cam: 'top2', scan: 'plan' } },
    // side, second angle: the opposite side of the pair, lower
    { after: 2, s: { cam: 'side2', scan: 'figures' } },
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
  const plan = PLAN[p.variant] ?? PLAN.room!;
  const ts = sbTimes(p);
  const out: Shot[] = ts.map((t, i) => ({ t: i === 0 ? p.start : t, s: { id: `${p.id}#${i}`, ...plan[Math.min(i, plan.length - 1)]! } }));
  for (const ex of EXTRA[p.variant] ?? []) {
    const a = ts[ex.after] ?? p.start, b = ts[ex.after + 1] ?? p.end;
    const d = au.downbeats.find((x) => x > a + 0.05 && x < b - 0.05);
    if (d !== undefined) out.push({ t: d, s: { id: `${p.id}#x${ex.after}`, ...ex.s } });
  }
  return out.sort((x, y) => x.t - y.t);
}
