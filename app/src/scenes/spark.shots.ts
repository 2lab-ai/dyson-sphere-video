// Shot list for the spark plates (pure: imported by scenes/spark.ts and by the edit gate).
// State = camera framing (`frame`) + lyric layout (`layout`). A cut lands on downbeats: every bar inside
// drop/climax sections, otherwise as rarely as keeps every gap within the section's cap (gapCap).
import { barTimes, gapCap, type AudioLite, type PlateInfo, type Shot } from '../engine/shots';

export const FRAMES = ['wide', 'close', 'tilt', 'offset', 'high'] as const;
export const LAYOUTS = ['center', 'left', 'vertical', 'right', 'low', 'stack'] as const;
export type Framing = (typeof FRAMES)[number];
export type Layout = (typeof LAYOUTS)[number] | 'none';

// per-variant starting offsets into the cycles, so the five spark plates don't open alike
const SEED: Record<string, number> = { write: 0, race: 3, glint: 1, merge: 2, outro: 4 };

export function shots(p: PlateInfo, au: AudioLite): Shot[] {
  const frame = 1 / 60;
  const downs = barTimes(au, p.start + frame, p.end - frame);
  // greedy: keep a downbeat when skipping it would leave a gap longer than the cap at that point
  const cuts = [p.start];
  for (let i = 0; i < downs.length; i++) {
    const next = downs[i + 1] ?? p.end;
    const last = cuts[cuts.length - 1]!;
    if (next - last > gapCap(au, last, next) - 1e-3) cuts.push(downs[i]!);
  }
  const k0 = SEED[p.variant] ?? 0;
  const vocal = p.lines.length > 0;
  return cuts.map((t, i) => ({
    t,
    s: {
      id: `${p.id}#${i}`,
      frame: FRAMES[(k0 + i) % FRAMES.length]!,
      layout: vocal ? LAYOUTS[(k0 + 2 * i) % LAYOUTS.length]! : 'none',
    },
  }));
}
