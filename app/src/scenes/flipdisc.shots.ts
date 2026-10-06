// Shot list for the flip-disc departure board (pure: imported by scenes/flipdisc.ts and by the edit gate).
// State = the camera on the board (`cam`), a structural framing change on every approved storyboard time:
//   wide   the whole board, frontal: line 21 above the rows of choices          (120.66, plate start)
//   close  twice the disc pitch, the camera steps along line 22 on each beat     (122.44, L22)
//   macro  one syllable fills the frame; the discs' rotation is readable         (123.389, extra: the downbeat)
//   side   oblique, down the length of the board: the rows are cleared           (124.16, W22.2)
import { beatTimes, type AudioLite, type PlateInfo, type Shot } from '../engine/shots';
import { sbShotTimes } from '../engine/storyboard';

export type Cam = 'wide' | 'close' | 'macro' | 'side';

export function shots(p: PlateInfo, au: AudioLite): Shot[] {
  const sb = sbShotTimes(p.id);
  // `years` (p09, the street ticker): one camera per storyboard shot, alternating
  if (p.variant === 'years') return (sb.length ? sb : [p.start]).map((t, i) => ({ t: i ? t : p.start, s: { id: `${p.id}#${i}`, cam: (['wide', 'close', 'side'] as const)[i % 3] } }));
  const t0 = sb[0] ?? p.start, tClose = sb[1] ?? p.start + (p.end - p.start) * 0.38, tSide = sb[2] ?? p.start + (p.end - p.start) * 0.76;
  const list: Shot[] = [
    { t: t0, s: { id: `${p.id}#wide`, cam: 'wide' } },
    { t: tClose, s: { id: `${p.id}#close`, cam: 'close' } },
  ];
  // the macro snaps in on the first beat of the close shot's second half (the downbeat in the approved grid)
  const mid = beatTimes(au, tClose + 0.5, tSide - 0.3);
  const tMacro = mid.find((b) => au.downbeats.some((d) => Math.abs(d - b) < 1e-3)) ?? mid[0];
  // `years` (p09, the street ticker): wide -> close -> side, no macro (there is no second line to snap onto)
  if (tMacro !== undefined && p.variant !== 'years') list.push({ t: tMacro, s: { id: `${p.id}#macro`, cam: 'macro' } });
  list.push({ t: tSide, s: { id: `${p.id}#side`, cam: 'side' } });
  return list;
}
