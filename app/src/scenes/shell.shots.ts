// Shot list for the shell plates (pure: imported by scenes/shell.ts and by the edit gate).
// State = the camera preset (`cam`). Built on the approved storyboard times (engine/storyboard) plus an extra cut
// every second beat, so each plate changes framing four or five times in its two bars.
//   dancheong (p42)  up -> tilt -> close (storyboard +1 bar) -> rake -> seal (the medallion lands, back on the anchor)
//   pullback  (p43)  close -> graze -> pull (storyboard +1 bar) -> wide
import { beatTimes, type AudioLite, type PlateInfo, type Shot } from '../engine/shots';
import { sbShotTimes } from '../engine/storyboard';

export type Cam = 'up' | 'tilt' | 'close' | 'rake' | 'seal' | 'graze' | 'pull' | 'wide';

export function shots(p: PlateInfo, au: AudioLite): Shot[] {
  const sb = sbShotTimes(p.id);
  const bs = beatTimes(au, p.start, p.end); // 8 beats: k0 = the plate start
  const k = (i: number, fb: number) => bs[i] ?? fb;
  const at = (i: number) => sb[i] ?? p.start;
  const list: [number, Cam][] =
    p.variant === 'dancheong'
      ? [[at(0), 'up'], [k(2, at(0) + 1.17), 'tilt'], [at(1), 'close'], [k(6, at(1) + 1.17), 'rake'], [k(7, at(1) + 1.75), 'seal']]
      : [[at(0), 'close'], [k(2, at(0) + 1.17), 'graze'], [at(1), 'pull'], [k(6, at(1) + 1.17), 'wide']];
  return list
    .filter(([t]) => t >= p.start - 1e-6 && t < p.end)
    .sort((a, b) => a[0] - b[0])
    .map(([t, cam], i) => ({ t, s: { id: `${p.id}#${i}`, cam } }));
}
