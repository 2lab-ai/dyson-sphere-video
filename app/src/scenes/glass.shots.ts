// Shot list for the stained-glass rose (pure: imported by scenes/glass.ts and by the edit gate).
// State = where the camera stands in the dark nave (`cam`); every change is a real framing change:
//   wide   the nave: the rose high on the west wall, shafts through the dust, a coloured pool on the flagstones
//          (plate start = storyboard shot 1: "a dark rose window, panes lighting from the centre")
//   floor  looking down at the flagstones: the window's image pools there, each new ring lands in the pool (beat 3)
//   up     looking up at the window, the whole rose ablaze (storyboard shot 2, the bar-2 downbeat)
//   macro  tight on a few panes: thick lead, seeds and streaks in the glass; the light turns to heat (beat 7)
import { beatTimes, type AudioLite, type PlateInfo, type Shot } from '../engine/shots';
import { sbShotTimes } from '../engine/storyboard';

export type Cam = 'wide' | 'floor' | 'up' | 'macro';

export function shots(p: PlateInfo, au: AudioLite): Shot[] {
  const sb = sbShotTimes(p.id);
  const t0 = sb[0] ?? p.start, tUp = sb[1] ?? p.start + (p.end - p.start) / 2;
  const b1 = beatTimes(au, t0 + 0.05, tUp - 0.05), b2 = beatTimes(au, tUp + 0.05, p.end - 0.05);
  const list: Shot[] = [{ t: t0, s: { id: `${p.id}#wide`, cam: 'wide' } }];
  const tFloor = b1[1] ?? b1[0]; // the second beat after the start (beat 3 of the plate)
  if (tFloor !== undefined) list.push({ t: tFloor, s: { id: `${p.id}#floor`, cam: 'floor' } });
  list.push({ t: tUp, s: { id: `${p.id}#up`, cam: 'up' } });
  const tMacro = b2[1] ?? b2[0]; // beat 7
  if (tMacro !== undefined) list.push({ t: tMacro, s: { id: `${p.id}#macro`, cam: 'macro' } });
  return list;
}
