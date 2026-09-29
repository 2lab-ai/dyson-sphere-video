// Shot list for the void plates (pure: imported by scenes/void.ts and by the edit gate).
// State = camera rig (`cam`) + which stone face carries the engraving (`face`). The approved storyboard times
// (sbShotTimes) are kept exactly; one extra shot lands on the plate's last beat for the exit (the last stone
// drops away), which also keeps every gap inside the climax's 1-bar cap.
import { beatTimes, type AudioLite, type PlateInfo, type Shot } from '../engine/shots';
import { sbShotTimes } from '../engine/storyboard';

export const CAMS = ['side', 'shoulder', 'top', 'plunge'] as const;
export type Cam = (typeof CAMS)[number];
export type Face = 'front' | 'top';

const RIG: Record<Cam, Face> = { side: 'front', shoulder: 'top', top: 'top', plunge: 'top' };

export function shots(p: PlateInfo, au: AudioLite): Shot[] {
  const sb = sbShotTimes(p.id);
  const order: Cam[] = ['side', 'shoulder', 'top'];
  const list: Shot[] = sb.map((t, i) => {
    const cam = order[Math.min(i, order.length - 1)]!;
    return { t, s: { id: `${p.id}#${i}`, cam, face: RIG[cam] } };
  });
  // exit: the plate's last beat (after the last storyboard shot) — steep plunge as the last stone falls
  const last = sb[sb.length - 1] ?? p.start;
  const bs = beatTimes(au, last + 0.05, p.end - 0.1);
  const exitT = bs[bs.length - 1];
  if (exitT !== undefined) list.push({ t: exitT, s: { id: `${p.id}#exit`, cam: 'plunge', face: RIG.plunge } });
  return list;
}
