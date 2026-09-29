// Shot list for the wave plates (pure: imported by scenes/wave.ts and by the edit gate).
// ocean (p05, M3 ink-in-water): state = camera (`cam`) + what the frame is made of (`frame`).
// The approved storyboard shots map in order to side -> low -> close; one extra shot on the downbeat inside the low
// shot cuts to `surge`: the camera rides the back of the grown wave with the line large inside it.
import { barTimes, type AudioLite, type PlateInfo, type Shot } from '../engine/shots';
import { sbShotTimes } from '../engine/storyboard';

export const CAMS = ['side', 'low', 'surge', 'close'] as const;
export type Cam = (typeof CAMS)[number];

// side: the whole wave in profile under dark clear water / low: at the waterline, the curl overhead, amber threads /
// surge: tracking the back of the grown wave, water fills two thirds / close: the crest fills the frame, then the sea
const FRAME: Record<Cam, string> = { side: 'profile', low: 'barrel', surge: 'body', close: 'crest' };

export function shots(p: PlateInfo, au: AudioLite): Shot[] {
  const sb = sbShotTimes(p.id);
  const approved: Cam[] = ['side', 'low', 'close'];
  const list: Shot[] = sb.map((t, i) => {
    const cam = approved[Math.min(i, approved.length - 1)]!;
    return { t, s: { id: `${p.id}#${cam}`, cam, frame: FRAME[cam] } };
  });
  // extra: the first downbeat strictly inside the low shot (>= 1/30 s from both neighbours) cuts to the surge
  const a = sb[1], b = sb[2];
  if (a !== undefined && b !== undefined) {
    const d = barTimes(au, a + 1 / 30, b - 1 / 30)[0];
    if (d !== undefined) list.push({ t: d, s: { id: `${p.id}#surge`, cam: 'surge', frame: FRAME.surge } });
  }
  return list.sort((x, y) => x.t - y.t);
}
