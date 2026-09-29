// Shot list for the thermal plate (pure: imported by scenes/thermal.ts and by the edit gate).
// State = `frame` (camera) + `subject` (what the thermal camera is pointed at). One idiom; the subject changes.
//   steam (p36):
//     close   / gears    clockwork gear train, tight, heat in the meshing teeth (escapement ticks on the beat)
//     train   / linkage  [extra, beat 3 of bar 1] pull back: the gear train drives a crank, the linkage carries the
//                        motion across the frame into a cylinder
//     side    / pistons  [storyboard +1 bar] side on the drive: cylinders, piston rods, crossheads, main rods on the
//                        driving wheels; pistons flare white-hot on every beat (one stroke end per beat)
//     wide    / loco     [extra, beat 3 of bar 2] the whole locomotive thunders through the frame, chimney chuffing
import { beatTimes, type AudioLite, type PlateInfo, type Shot, type ShotState } from '../engine/shots';
import { sbShotTimes } from '../engine/storyboard';

const PLAN: Record<string, ShotState[]> = {
  steam: [
    { frame: 'close', subject: 'gears' },
    { frame: 'side', subject: 'pistons' },
  ],
};
const EXTRA: Record<string, ShotState[]> = {
  steam: [
    { frame: 'train', subject: 'linkage' },
    { frame: 'wide', subject: 'loco' },
  ],
};

function sbTimes(p: PlateInfo): number[] {
  try {
    const ts = sbShotTimes(p.id);
    return ts.length ? ts : [p.start];
  } catch {
    return [p.start];
  }
}

export function shots(p: PlateInfo, au: AudioLite): Shot[] {
  const v = PLAN[p.variant] ? p.variant : 'steam';
  const plan = PLAN[v]!, extra = EXTRA[v]!;
  const ts = sbTimes(p);
  const out: Shot[] = ts.map((t, i) => ({ t: i === 0 ? p.start : t, s: { id: `${p.id}#${i}`, ...plan[Math.min(i, plan.length - 1)]! } }));
  // extras: the third beat of each storyboard shot's bar (the hold is split on a beat, never a zoom pulse)
  const bounds = [...out.map((s) => s.t), p.end];
  for (let i = 0; i < out.length && i < extra.length; i++) {
    const bs = beatTimes(au, bounds[i]! + 0.05, bounds[i + 1]! - 0.3);
    const tb = bs[1];
    if (tb !== undefined) out.push({ t: tb, s: { id: `${p.id}#x${i}`, ...extra[i]! } });
  }
  return out.sort((x, y) => x.t - y.t);
}
