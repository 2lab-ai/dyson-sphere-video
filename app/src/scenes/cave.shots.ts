// Shot list for the cave plate (p33-cave-fire; pure: imported by scenes/cave.ts and by the edit gate).
// Fire and speech: a cave wall in firelight, ochre hands stamped on the beat, the first sounds as sparks that
// fly up out of the fire and land on the rock as the first marks. State = camera (`cam`): the four framings
// are four different compositions of one wall (wall + fire + shadow / the animal panel / one hand / the marks
// over the wet clay floor). Both storyboard shots are kept; one extra cut lands on a beat inside each of them
// (the climax cap is one bar, and the second storyboard shot is exactly one bar long).
import { beatTimes, type AudioLite, type PlateInfo, type Shot, type ShotState } from '../engine/shots';
import { sbShotTimes } from '../engine/storyboard';

export type Cam = 'wide' | 'panel' | 'hand' | 'marks';

/** One state per storyboard shot, in storyboard order. */
const PLAN: ShotState[] = [
  { cam: 'wide' }, // the wall in firelight, a shadow at the fire presses ochre hands onto the rock
  { cam: 'hand' }, // drop 2: close on one sprayed hand, sparks (the first sounds) fly up across it
];

export function shots(p: PlateInfo, au: AudioLite): Shot[] {
  let ts: number[];
  try {
    ts = sbShotTimes(p.id);
  } catch {
    ts = [p.start];
  }
  const out: Shot[] = ts.map((t, i) => ({ t: i === 0 ? p.start : t, s: { id: `${p.id}#${i}`, ...PLAN[Math.min(i, PLAN.length - 1)]! } }));
  // extra cuts: the last beat of the wide shot (the animal panel), the second beat of the hand shot (the marks)
  const base = out.map((o) => o.t);
  const add = (i: number, pickIdx: (bs: number[]) => number | undefined, s: ShotState) => {
    const a = base[i], b = base[i + 1] ?? p.end;
    if (a === undefined) return;
    const x = pickIdx(beatTimes(au, a + 0.05, b - 0.05));
    if (x !== undefined) out.push({ t: x, s: { id: `${p.id}#x${i}`, ...s } });
  };
  add(0, (bs) => bs[bs.length - 1], { cam: 'panel' });
  add(1, (bs) => bs[1] ?? bs[0], { cam: 'marks' });
  return out.sort((x, y) => x.t - y.t);
}
