// Shot list for the pop-up book plate (pure: imported by scenes/popup.ts and by the edit gate).
// State = camera set-up (`cam`) + book topology (`book`: open spread / slamming shut).
// Times come from the approved storyboard (sbShotTimes) plus two extra cuts taken from the beat grid:
//   the downbeat between the opening and line 27 (a low track over the printed floor), and the last beat
//   of the plate (the book slams shut).
import { barTimes, beatTimes, type AudioLite, type PlateInfo, type Shot } from '../engine/shots';
import { sbShotTimes } from '../engine/storyboard';

export type Cam = 'threeq' | 'floor' | 'low' | 'overhead' | 'slam';

export function shots(p: PlateInfo, au: AudioLite): Shot[] {
  const sb = sbShotTimes(p.id);
  const frame = 1 / 60;
  const out: { t: number; cam: Cam; book: 'open' | 'shut' }[] = [];
  // storyboard: (s) three-quarter book, (L27) low angle between buildings, (+8b) overhead as the last tower rises
  const [t0, tLow, tOver] = [sb[0] ?? p.start, sb[1] ?? p.start + 3, sb[2] ?? p.start + 4.6];
  out.push({ t: t0, cam: 'threeq', book: 'open' });
  const floorT = barTimes(au, t0 + frame, tLow - frame)[0];
  if (floorT !== undefined) out.push({ t: floorT, cam: 'floor', book: 'open' });
  out.push({ t: tLow, cam: 'low', book: 'open' });
  out.push({ t: tOver, cam: 'overhead', book: 'open' });
  const beats = beatTimes(au, tOver + frame, p.end - frame);
  const slamT = beats[beats.length - 1];
  if (slamT !== undefined) out.push({ t: slamT, cam: 'slam', book: 'shut' });
  return out.map((s, i) => ({ t: s.t, s: { id: `${p.id}#${i}`, cam: s.cam, book: s.book } }));
}
