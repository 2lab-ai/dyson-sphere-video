// Shot list for the screen plates (pure: imported by scenes/screen.ts and by the edit gate).
// Built on the approved storyboard times (sbShotTimes) — one named view per storyboard shot — plus one extra
// snap on the middle beat between the second and third storyboard shots (hold, then snap).
//   hidden: front (three nested windows) → dolly (through the stack) → [deep: 3/4 view, off-axis] → core
//   choice: dialog (full dialog) → cursor (close-up, hovering) → [grid: tilted button grid] → ring (timer ring)
import { beatTimes, type AudioLite, type PlateInfo, type Shot } from '../engine/shots';
import { sbShotTimes } from '../engine/storyboard';

export type View = 'front' | 'dolly' | 'deep' | 'core' | 'dialog' | 'cursor' | 'grid' | 'ring';

const PLAN: Record<string, { sb: View[]; extra: View }> = {
  hidden: { sb: ['front', 'dolly', 'core'], extra: 'deep' },
  choice: { sb: ['dialog', 'cursor', 'ring'], extra: 'grid' },
};

export function shots(p: PlateInfo, au: AudioLite): Shot[] {
  const plan = PLAN[p.variant] ?? PLAN.hidden!;
  const ts = sbShotTimes(p.id);
  const list: Shot[] = ts.map((t, i) => ({ t, s: { id: `${p.id}#${plan.sb[i] ?? 'x'}`, view: plan.sb[Math.min(i, plan.sb.length - 1)]! } }));
  if (ts.length >= 3) {
    const bs = beatTimes(au, ts[1]! + 0.1, ts[2]! - 0.1);
    const t = bs[Math.floor(bs.length / 2)];
    if (t !== undefined) list.push({ t, s: { id: `${p.id}#${plan.extra}`, view: plan.extra } });
  }
  return list.sort((a, b) => a.t - b.t);
}
