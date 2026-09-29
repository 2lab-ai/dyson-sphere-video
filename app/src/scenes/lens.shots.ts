// Shot list for the lens plates (pure: imported by scenes/lens.ts and by the edit gate).
// State = camera framing (`frame`) + which surface carries the words (`surface`). Every approved storyboard shot
// time (sbShotTimes) is a cut; extra cuts sit on beats so no gap reaches the section cap.
//   gaze: two-shot → tight left iris → ring macro (extra, downbeat) → overlap zone → tight right iris
//         → both irises again as the apertures close (extra, last beat)
//   ai:   full-frame eye → pupil macro → oblique macro on the glass reflection (extra, the downbeat inside line 19)
//   star: observation face → aperture push-in (extra, first blade beat) → side view → side macro (extra, last blade)
import { barTimes, beatTimes, type AudioLite, type PlateInfo, type Shot, type ShotState } from '../engine/shots';
import { sbShotTimes } from '../engine/storyboard';

type Plan = { frames: ShotState[]; extra: { at: (p: PlateInfo, au: AudioLite) => number; s: ShotState }[] };

/** The beat `k` beats after the plate start (k may be negative: counted back from the plate end). */
const beatAt = (p: PlateInfo, au: AudioLite, k: number) => {
  const bs = beatTimes(au, p.start, p.end);
  return k >= 0 ? bs[k]! : bs[bs.length + k]!;
};

const PLANS: Record<string, Plan> = {
  gaze: {
    frames: [
      { frame: 'two', surface: 'ringL' },
      { frame: 'tightL', surface: 'ringL' },
      { frame: 'overlap', surface: 'wall' },
      { frame: 'tightR', surface: 'wall' },
    ],
    extra: [
      { at: (p, au) => beatAt(p, au, 4), s: { frame: 'ring', surface: 'ringL' } },
      { at: (p, au) => beatAt(p, au, -1), s: { frame: 'shut', surface: 'wall' } },
    ],
  },
  ai: {
    frames: [
      { frame: 'full', surface: 'aperture' },
      { frame: 'pupil', surface: 'glass' },
    ],
    extra: [{ at: (p, au) => barTimes(au, p.start + 1.2, p.end)[0] ?? beatAt(p, au, -2), s: { frame: 'reflect', surface: 'glass' } }],
  },
  star: {
    frames: [
      { frame: 'face', surface: 'none' },
      { frame: 'side', surface: 'none' },
    ],
    extra: [
      { at: (p, au) => beatAt(p, au, 2), s: { frame: 'push', surface: 'none' } },
      { at: (p, au) => beatAt(p, au, 6), s: { frame: 'sideMacro', surface: 'none' } },
    ],
  },
};

export function shots(p: PlateInfo, au: AudioLite): Shot[] {
  const plan = PLANS[p.variant];
  if (!plan) return [{ t: p.start, s: { id: `${p.id}#0`, frame: 'none', surface: 'none' } }];
  const sb = sbShotTimes(p.id);
  const list: Shot[] = sb.map((t, i) => ({ t, s: { id: `${p.id}#sb${i}`, ...plan.frames[Math.min(i, plan.frames.length - 1)]! } }));
  for (const [i, e] of plan.extra.entries()) {
    const t = e.at(p, au);
    // never within a frame of an approved cut
    if (sb.some((x) => Math.abs(x - t) < 1 / 30)) continue;
    list.push({ t, s: { id: `${p.id}#x${i}`, ...e.s } });
  }
  list.sort((a, b) => a.t - b.t);
  return list;
}
