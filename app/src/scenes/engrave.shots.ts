// Shot list for the engrave plates (pure: imported by scenes/engrave.ts and by the edit gate).
// State = camera framing (`frame`) + topology of the engraved subject (`topo`). Built on the approved
// storyboard times (sbShotTimes); the hand variant adds one beat-snapped shot for the closing fist.
import { beatTimes, barTimes, gapCap, type AudioLite, type PlateInfo, type Shot } from '../engine/shots';
import { sbShotTimes } from '../engine/storyboard';

export const FRAMES = ['seam', 'drop', 'wide', 'close', 'under', 'fist'] as const;
export const TOPOS = ['fibres', 'collapse', 'sweep', 'grip', 'fall', 'fist'] as const;
export type Framing = (typeof FRAMES)[number];
export type Topo = (typeof TOPOS)[number];

function sbTimes(id: string): number[] | null {
  try { return sbShotTimes(id); } catch { return null; }
}

export function shots(p: PlateInfo, au: AudioLite): Shot[] {
  const sb = sbTimes(p.id);
  let ts: number[];
  if (sb && sb.length) {
    ts = [p.start, ...sb.filter((t) => t > p.start + 1 / 60)];
    if (p.variant === 'hand') {
      // the fist gets its own framing on the last beat before the final syllable run (hold, then snap)
      const last = ts[ts.length - 1]!;
      const beats = beatTimes(au, last + 0.3, p.end - 0.4);
      if (beats.length) ts.push(beats[0]!);
    }
  } else {
    // no storyboard entry: cut on downbeats within the section cap
    ts = [p.start];
    const downs = barTimes(au, p.start + 1 / 60, p.end - 1 / 60);
    for (let i = 0; i < downs.length; i++) {
      const next = downs[i + 1] ?? p.end, prev = ts[ts.length - 1]!;
      if (next - prev > gapCap(au, prev, next) - 1e-3) ts.push(downs[i]!);
    }
  }
  return ts.map((t, i) => ({
    t,
    s: { id: `${p.id}#${i}`, frame: FRAMES[i % FRAMES.length]!, topo: TOPOS[i % TOPOS.length]! },
  }));
}
