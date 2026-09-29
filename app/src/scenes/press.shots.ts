// Shot list for the press plates (pure: imported by scenes/press.ts and by the edit gate).
// State = `frame` (camera framing) + `medium` (what the print surface is doing). Every approved storyboard shot
// (data/storyboard.json) is a state change at its exact time; the two drop plates (title, burst) add a half-bar
// sub-shot in every bar, so the frame keeps cutting on the beat inside the 1-bar cap.
import { beatTimes, type AudioLite, type PlateInfo, type Shot } from '../engine/shots';
import { sbShotTimes } from '../engine/storyboard';

/** Per variant: [frame, medium] of each storyboard shot, in order. */
const PLAN: Record<string, [string, string][]> = {
  dream: [['wide', 'poster'], ['crop', 'halftone'], ['raking', 'layers']],
  squeeze: [['side', 'web'], ['top', 'overprint'], ['macro', 'latch']],
  title: [['wide', 'stamp'], ['wide', 'disc'], ['wide', 'holes']],
  erase: [['wide', 'poster'], ['close', 'scrape'], ['raking', 'ghost']],
  burst: [['wide', 'shatter'], ['depth', 'fly'], ['wide', 'raster']],
  credits: [['title', 'stamp'], ['credit', 'stamp'], ['card', 'card']],
};
/** Half-bar sub-shot framings for the drop plates (same medium, different camera). */
const SUB: Record<string, string[]> = {
  title: ['tight', 'offset', 'push'],
  burst: ['tilt', 'orbit', 'tight'],
};

export function shots(p: PlateInfo, au: AudioLite): Shot[] {
  const plan = PLAN[p.variant];
  if (!plan) throw new Error(`press: unknown variant ${p.variant}`);
  const sb = sbShotTimes(p.id);
  const out: Shot[] = sb.map((t, i) => ({ t: i === 0 ? p.start : t, s: { id: `${p.id}#${i}`, frame: plan[i]![0], medium: plan[i]![1] } }));
  const sub = SUB[p.variant];
  if (sub) {
    // the third beat of every bar (2 beats after each storyboard shot): same medium, new framing
    sb.forEach((t, i) => {
      const bs = beatTimes(au, t - 1e-3, p.end - 1e-3);
      const b = bs[2];
      if (b !== undefined && (sb[i + 1] === undefined || b < sb[i + 1]! - 1e-3))
        out.push({ t: b, s: { id: `${p.id}#${i}b`, frame: sub[i]!, medium: plan[i]![1] } });
    });
  }
  return out.sort((a, b) => a.t - b.t);
}
