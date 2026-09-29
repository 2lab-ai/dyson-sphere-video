// Shot list for the impact plate (p16-impact-theia, claymation, drop1: max 1 bar between structural changes).
// Storyboard: wide accretion + Theia approaching (plate start) -> close on the impact downbeat (+1 bar).
// Extra shots on beat 3 of each bar keep the structure moving every half bar:
//   bar 1 beat 3: a low camera under the proto-Earth, Theia looming in the foreground (the near-collision)
//   bar 2 beat 3: the camera cranes up over the planets; the splash has become a debris ring seen from above
import { beatTimes, type AudioLite, type PlateInfo, type Shot, type ShotState } from '../engine/shots';
import { sbShotTimes } from '../engine/storyboard';

/** One state per storyboard shot, in storyboard order. */
const PLAN: ShotState[] = [
  { cam: 'wide', stage: 'accrete' },
  { cam: 'close', stage: 'impact' },
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
  const impact = out[1]?.t ?? p.start + (p.end - p.start) / 2;
  // beat 3 (index 2) of each half: the extra structural shots
  const b1 = beatTimes(au, p.start, impact)[2];
  const b2 = beatTimes(au, impact, p.end)[2];
  if (b1 !== undefined) out.push({ t: b1, s: { id: `${p.id}#low`, cam: 'low', stage: 'approach' } });
  if (b2 !== undefined) out.push({ t: b2, s: { id: `${p.id}#top`, cam: 'top', stage: 'ring' } });
  return out.sort((x, y) => x.t - y.t);
}
