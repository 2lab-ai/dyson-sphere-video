// Shot list for the animatic (pure: imported by scenes/animatic.ts and, as the stand-in for every plate whose module
// or variant is not built yet, by the edit gate). One state per approved storyboard shot: the storyboard's camera
// (`cam`), which storyboard.py guarantees changes between consecutive shots. Nothing is added or moved.
import type { AudioLite, PlateInfo, Shot } from '../engine/shots';
import { sbPlate } from '../engine/storyboard';

export function shots(p: PlateInfo, _au: AudioLite): Shot[] {
  return sbPlate(p.id).shots.map((x, i) => ({ t: i === 0 ? p.start : x.t, s: { id: `${p.id}:${i}`, cam: x.cam } }));
}
