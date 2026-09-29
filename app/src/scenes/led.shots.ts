// Shot list for the LED-wall plates (pure: imported by scenes/led.ts and by the edit gate).
// Times come from the approved storyboard (engine/storyboard): every storyboard shot is a structural change here,
// in order. State = `cam` (where the camera stands relative to the curved stadium ribbon) + `rig` (static on the
// sign vs tracking the racing point) + `tiers` (how many ribbon tiers are in frame).
import { type AudioLite, type PlateInfo, type Shot, type ShotState } from '../engine/shots';
import { sbShotTimes } from '../engine/storyboard';

const PLAN: Record<string, ShotState[]> = {
  // wide on the curved ribbon (two tiers) -> low under it, dots huge, tracking the point -> down the length of the
  // ribbon, tracking -> close on the LEDs, static, the counter overtaken; the ribbon then dies column by column
  ticker: [
    { cam: 'wide', rig: 'static', tiers: 2 },
    { cam: 'low', rig: 'track', tiers: 1 },
    { cam: 'side', rig: 'track', tiers: 1 },
    { cam: 'close', rig: 'static', tiers: 1 },
  ],
};

function sbTimes(p: PlateInfo): number[] {
  try {
    return sbShotTimes(p.id);
  } catch {
    return [p.start];
  }
}

export function shots(p: PlateInfo, _au: AudioLite): Shot[] {
  const plan = PLAN[p.variant] ?? PLAN.ticker!;
  const ts = sbTimes(p);
  return ts.map((t, i) => ({ t: i === 0 ? p.start : t, s: { id: `${p.id}#${i}`, ...plan[Math.min(i, plan.length - 1)]! } }));
}
