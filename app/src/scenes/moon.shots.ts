// Shot list for the moon plate (pure: imported by scenes/moon.ts and by the edit gate).
// p17 (1 bar, T3): four beats, four ink strokes. Each beat one stroke of the debris ring gathers into the
// moon, and the framing snaps to a new composition on that beat:
//   beat 1  wide    the tilted debris ring over the mountains; stroke 1 sweeps in
//   beat 2  centre  the moon centred and closer; half the halo washed in
//   beat 3  close   tight on the moon's lit edge, the bleed front filling the frame
//   beat 4  exit    back to the exit framing (moon at the storyboard subject position), full moon, red seal
// State = framing (`cam`) + topology (`topo`: how many strokes have gathered) + the seal.
import { beatTimes, type AudioLite, type PlateInfo, type Shot } from '../engine/shots';
import { sbShotTimes } from '../engine/storyboard';

export const CAMS = ['wide', 'centre', 'close', 'exit'] as const;
export const TOPOS = ['ring', 'half', 'gibbous', 'full'] as const;
export type Cam = (typeof CAMS)[number];
export type Topo = (typeof TOPOS)[number];

function sbTimes(id: string): number[] {
  try { return sbShotTimes(id); } catch { return []; }
}

export function shots(p: PlateInfo, au: AudioLite): Shot[] {
  // the plate start, then every beat inside the plate (the storyboard shot times are kept as they are)
  const ts = [p.start, ...beatTimes(au, p.start + 1 / 60, p.end - 1 / 60)];
  for (const t of sbTimes(p.id)) if (!ts.some((x) => Math.abs(x - t) < 1 / 60)) ts.push(t);
  ts.sort((a, b) => a - b);
  const n = ts.length;
  return ts.map((t, i) => {
    // the last shot is always the exit framing with the full moon and the seal
    const k = i === n - 1 ? 3 : Math.min(i, 2);
    return { t, s: { id: `${p.id}#${i}`, cam: CAMS[k]!, topo: TOPOS[k]!, gathered: i + 1, seal: i === n - 1 && n > 1 } };
  });
}
