// Shot list for the clay plate (p34-clay-tablet: cuneiform pressed into a wet clay tablet under raking light; drop2,
// so at most 1 bar between structural changes). Storyboard: wide tablet + stylus (plate start) -> macro on the wedges'
// shadows (+1 bar). Two extra camera rigs on beat 3 of each bar keep the structure moving every half bar:
//   bar 1 beat 3: `rake` — a low grazing side camera at the writing head, the stylus looming, long wedge shadows
//   bar 2 beat 3: `window` — the camera rises to look straight down on the tablet as the lamp light becomes a window's
import { beatTimes, type AudioLite, type PlateInfo, type Shot, type ShotState } from '../engine/shots';
import { sbShotTimes } from '../engine/storyboard';

/** One state per storyboard shot, in storyboard order. */
const PLAN: ShotState[] = [
  { cam: 'wide', light: 'lamp' },
  { cam: 'macro', light: 'lamp-low' },
];

function sbTimes(p: PlateInfo): number[] {
  try {
    return sbShotTimes(p.id);
  } catch {
    return [p.start, p.start + (p.end - p.start) / 2];
  }
}

export function shots(p: PlateInfo, au: AudioLite): Shot[] {
  const ts = sbTimes(p);
  const out: Shot[] = ts.map((t, i) => ({ t: i === 0 ? p.start : t, s: { id: `${p.id}#${i}`, ...PLAN[Math.min(i, PLAN.length - 1)]! } }));
  const macro = out[1]?.t ?? p.start + (p.end - p.start) / 2;
  const b1 = beatTimes(au, p.start, macro)[2];
  const b2 = beatTimes(au, macro, p.end)[2];
  if (b1 !== undefined) out.push({ t: b1, s: { id: `${p.id}#rake`, cam: 'rake', light: 'back' } });
  if (b2 !== undefined) out.push({ t: b2, s: { id: `${p.id}#window`, cam: 'window', light: 'window' } });
  return out.sort((x, y) => x.t - y.t);
}
