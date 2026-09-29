// Shot list for the black-marble plate (pure: imported by scenes/blackmarble.ts and by the edit gate).
// State = the orbital camera (`cam`) + what the lit continent is framed on (`frame`). Every approved storyboard shot
// time is a cut; one extra cut on the plate's last beat pulls back out to orbit for the exit (the dawn line sweeps
// the lights off), so the plate ends on a curved limb, not on a flat grid.
//   future: wide orbit (limb, cities) -> close oblique over the word continent -> straight down on the street grid
//           -> exit: tilted limb, the terminator sweeping the lights off
import { beatTimes, type AudioLite, type PlateInfo, type Shot, type ShotState } from '../engine/shots';
import { sbShotTimes } from '../engine/storyboard';

const FRAMES: Record<string, ShotState[]> = {
  future: [
    { cam: 'wide', frame: 'line' },
    { cam: 'close', frame: 'word' },
    { cam: 'top', frame: 'grid' },
  ],
};
const EXIT: ShotState = { cam: 'exit', frame: 'limb' };

export function shots(p: PlateInfo, au: AudioLite): Shot[] {
  const frames = FRAMES[p.variant];
  if (!frames) return [{ t: p.start, s: { id: `${p.id}#0`, cam: 'wide', frame: 'line' } }];
  const sb = sbShotTimes(p.id);
  const list: Shot[] = sb.map((t, i) => ({ t, s: { id: `${p.id}#sb${i}`, ...frames[Math.min(i, frames.length - 1)]! } }));
  // exit: the last beat of the plate (never within a frame of an approved cut)
  const bs = beatTimes(au, p.start, p.end);
  const tx = bs[bs.length - 1];
  if (tx !== undefined && tx > sb[sb.length - 1]! + 0.1) list.push({ t: tx, s: { id: `${p.id}#exit`, ...EXIT } });
  list.sort((a, b) => a.t - b.t);
  return list;
}
