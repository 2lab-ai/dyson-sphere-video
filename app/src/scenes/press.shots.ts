// Shot list for the press plates (pure: imported by scenes/press.ts and by the edit gate).
// State = `frame` (camera on the print) + `stage` (what the print job is doing). Every approved storyboard shot
// (data/storyboard.json) is a state change at its exact time; each variant adds its own extra shots on beats.
import { beatTimes, type AudioLite, type PlateInfo, type Shot } from '../engine/shots';
import { sbShotTimes } from '../engine/storyboard';

/** Per variant: [frame, stage] of each storyboard shot, in order. */
const PLAN: Record<string, [string, string][]> = {
  // p04: wide poster → macro on the misregistered word → the sheet tilted on the tray
  riso: [['wide', 'pull'], ['macro', 'pull'], ['tilt', 'tray']],
  // p44: wedge drives in + title → credit along the wedge → full card
  credits: [['wide', 'title'], ['tilt', 'credit'], ['flat', 'card']],
};

/** Extra shots: [beat index inside the plate, frame, stage]. */
const EXTRA: Record<string, [number, string, string][]> = {
  // beat 3: the camera moves onto the first row as it is sung; last beat: the sheet is pulled off the tray
  riso: [[2, 'row', 'pull'], [7, 'tilt', 'exit']],
  // last bar: the wedge pierces the disc
  credits: [[12, 'push', 'pierce']],
};

export function shots(p: PlateInfo, au: AudioLite): Shot[] {
  const plan = PLAN[p.variant];
  if (!plan) throw new Error(`press: unknown variant ${p.variant}`);
  const sb = sbShotTimes(p.id);
  const out: Shot[] = sb.map((t, i) => ({ t: i === 0 ? p.start : t, s: { id: `${p.id}#${i}`, frame: plan[i]![0], stage: plan[i]![1] } }));
  const beats = beatTimes(au, p.start - 1e-3, p.end - 1e-3);
  for (const [k, frame, stage] of EXTRA[p.variant] ?? []) {
    const t = beats[k];
    if (t !== undefined) out.push({ t, s: { id: `${p.id}#x${k}`, frame, stage } });
  }
  return out.sort((a, b) => a.t - b.t);
}
