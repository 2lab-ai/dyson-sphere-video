// Shot list for the split plates (pure: imported by scenes/split.ts and by the edit gate).
// State = camera framing (`frame`) + what the seam holds (`seam`: which letters sit in it), on the approved
// storyboard times exactly (bridge cap = 2 bars; the longest gap here is the 2.33 s tail, well inside it).
// The plate ends on the top-down shot: p-engrave opens on the same fibres, so the tension carries across the cut.
import { type AudioLite, type PlateInfo, type Shot } from '../engine/shots';
import { sbShotTimes } from '../engine/storyboard';

export const FRAMES = ['frontal', 'raking', 'gape', 'topdown'] as const;
export type Framing = (typeof FRAMES)[number];
/** split = glyphs straddle the seam, cut in two; wedged = sung letters are jammed into the gap. */
export type Seam = 'split' | 'wedged';

export function shots(p: PlateInfo, _au: AudioLite): Shot[] {
  const sb = sbShotTimes(p.id);
  // storyboard order: frontal (start) -> raking light (L15) -> the seam gapes (W15.2) -> top-down on the last fibres
  const plan: { frame: Framing; seam: Seam }[] = [
    { frame: 'frontal', seam: 'split' },
    { frame: 'raking', seam: 'split' },
    { frame: 'gape', seam: 'wedged' },
    { frame: 'topdown', seam: 'wedged' },
  ];
  const out: Shot[] = sb.map((t, i) => ({ t, s: { id: `${p.id}#${i}`, ...plan[Math.min(i, plan.length - 1)]! } }));
  return out;
}
