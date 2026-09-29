// Shot list for the sodium plate (p32-sodium-sun; pure: imported by scenes/sodium.ts and by the edit gate).
// The Weather Project: a mono-frequency half-sun on the end wall of a hazy hall, completed by a mirror ceiling.
// State = camera (`cam`) + what carries the line (`surf`): etched into the disc, or spelled by the crowd lying on
// the floor as seen in the mirror ceiling. Every storyboard shot time is kept; one extra shot lands on the downbeat
// inside the long 'up' hold (the crowd, scattered, snaps into the word as the camera turns tight onto it).
import { barTimes, type AudioLite, type PlateInfo, type Shot, type ShotState } from '../engine/shots';
import { sbShotTimes } from '../engine/storyboard';

export type Cam = 'wide' | 'low' | 'close' | 'up' | 'uptight' | 'flat';
export type Surf = 'disc' | 'crowd';

/** One state per storyboard shot, in storyboard order. */
const PLAN: ShotState[] = [
  { cam: 'wide', surf: 'disc' }, // the hall in amber haze, the sun, silhouettes on the floor
  { cam: 'low', surf: 'disc' }, // low from the floor: silhouettes reaching up at the disc
  { cam: 'close', surf: 'disc' }, // close on the disc: the etched line, the last words slip out through the rim
  { cam: 'up', surf: 'crowd' }, // straight up at the mirror ceiling: the crowd reflected, lying in the word
  { cam: 'flat', surf: 'disc' }, // the sun alone in the haze, dimming to an ember
];

export function shots(p: PlateInfo, au: AudioLite): Shot[] {
  let ts: number[];
  try {
    ts = sbShotTimes(p.id);
  } catch {
    ts = [p.start];
  }
  const out: Shot[] = ts.map((t, i) => ({ t: i === 0 ? p.start : t, s: { id: `${p.id}#${i}`, ...PLAN[Math.min(i, PLAN.length - 1)]! } }));
  // extra: first downbeat inside the 'up' shot (the up hold is a hair over one bar in the climax)
  const iu = out.findIndex((s) => s.s.cam === 'up');
  if (iu >= 0) {
    const a = out[iu]!.t, b = out[iu + 1]?.t ?? p.end;
    const d = barTimes(au, a + 0.05, b - 0.05)[0];
    if (d !== undefined) out.push({ t: d, s: { id: `${p.id}#xu`, cam: 'uptight', surf: 'crowd' } });
  }
  return out.sort((x, y) => x.t - y.t);
}
