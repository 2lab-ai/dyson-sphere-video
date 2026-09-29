// Shot list for the demo plates (pure: imported by scenes/demo.ts and by the edit gate).
// State = the effect on screen (`fx`, a medium change: copper+scroller / rotozoomer / vector balls / wireframe)
// plus the scroller/texture `layout`. One effect per bar, hard cut on each downbeat (the approved storyboard
// times), and one extra cut on the last beat: the finished ball sphere turns into its wireframe drawing,
// which hands off to the next plate's exploded drawing.
import { beatTimes, type AudioLite, type PlateInfo, type Shot } from '../engine/shots';
import { sbShotTimes } from '../engine/storyboard';

export const FX = ['copper', 'roto', 'balls'] as const;
export type Fx = (typeof FX)[number] | 'wire';

export function shots(p: PlateInfo, au: AudioLite): Shot[] {
  const sb = sbShotTimes(p.id);
  const times = sb.length ? sb : [p.start];
  const list: Shot[] = times.map((t, i) => ({ t, s: { id: `${p.id}#${i}`, fx: FX[Math.min(i, FX.length - 1)]! } }));
  // the last beat of the plate: the assembled sphere becomes a drawing (exit)
  const beats = beatTimes(au, times[times.length - 1]! + 1 / 60, p.end - 1 / 60);
  const last = beats[beats.length - 1];
  if (last !== undefined && list.length >= FX.length) list.push({ t: last, s: { id: `${p.id}#wire`, fx: 'wire' } });
  return list;
}
