// Shot list for the sign plates (pure: imported by scenes/sign.ts and by the edit gate).
// State = camera framing (`frame`) + what the object is doing structurally (`rig`).
//   neon (p06): the storyboard's three shots (wall frontal → tight on the igniting tubes → wide flood), plus an
//               oblique standoff view on the downbeat inside the tight shot (row 2 starts igniting there).
//   ring (p36): the storyboard's two bar shots (clamps lock on the equator → the ring cuts the shell), each split on
//               its half-bar beat so a drop-2 plate never holds one framing longer than two beats.
import { beatTimes, type AudioLite, type PlateInfo, type Shot } from '../engine/shots';
import { sbShotTimes } from '../engine/storyboard';

export type NeonFrame = 'front' | 'tight' | 'oblique' | 'flood';
export type RingFrame = 'equator' | 'orbit' | 'cut' | 'into';

const near = (a: number, b: number) => Math.abs(a - b) < 1 / 120;

export function shots(p: PlateInfo, au: AudioLite): Shot[] {
  const sb = sbShotTimes(p.id);
  if (p.variant === 'ring') {
    // sb = [bar 1 start (clamps lock), bar 2 start (the cut)]; the third beat of each bar gets its own framing
    const [b1, b2] = [sb[0] ?? p.start, sb[1] ?? p.start + (p.end - p.start) / 2];
    const beats1 = beatTimes(au, b1, b2), beats2 = beatTimes(au, b2, p.end);
    const mid1 = beats1[2] ?? (b1 + b2) / 2, mid2 = beats2[2] ?? (b2 + p.end) / 2;
    const list: [number, RingFrame, string][] = [
      [b1, 'equator', 'lock'],
      [mid1, 'orbit', 'lock'],
      [b2, 'cut', 'open'],
      [mid2, 'into', 'open'],
    ];
    return list.map(([t, frame, rig], i) => ({ t, s: { id: `${p.id}#${i}`, frame, rig } }));
  }
  // neon: storyboard times [frontal, tight, flood] + the downbeat between tight and flood
  const [s0, s1, s2] = [sb[0] ?? p.start, sb[1] ?? p.start, sb[2] ?? p.end];
  const extra = au.downbeats.find((d) => d > s1 + 0.25 && d < s2 - 0.25);
  const list: [number, NeonFrame][] = [[s0, 'front'], [s1, 'tight']];
  if (extra !== undefined && !near(extra, s2)) list.push([extra, 'oblique']);
  list.push([s2, 'flood']);
  return list.map(([t, frame], i) => ({ t, s: { id: `${p.id}#${i}`, frame, rig: frame === 'flood' ? 'lit' : 'wire' } }));
}
