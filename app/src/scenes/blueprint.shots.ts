// Shot list for the blueprint plates (pure: imported by scenes/blueprint.ts and by the edit gate).
// State = the drawing on the sheet (`view`: which projection / which sheet) + the camera on it (`frame`).
// Every approved storyboard shot (engine/storyboard) opens a new view; the drop plates (orbits, exploded) add a
// crop onto a detail of the current drawing on the 3rd beat of each bar, so the frame re-cuts every half bar.
// The stamp plate adds a push into the empty interior on its 2nd beat; the room plate a close-up on the
// dimension label on the downbeat where "공간" lands.
import { beatTimes, barTimes, type AudioLite, type PlateInfo, type Shot } from '../engine/shots';
import { sbShotTimes } from '../engine/storyboard';

/** Views per variant, one per approved storyboard shot (in order). */
export const VIEWS: Record<string, string[]> = {
  room: ['elev', 'iso', 'plan', 'section'],
  orbits: ['plan', 'elev', 'detail'],
  stamp: ['cutaway'],
  exploded: ['assembled', 'exploded', 'latch'],
  return: ['blueprint', 'erasing', 'orbits'],
};

export type Framing = 'sheet' | 'crop' | 'close' | 'interior' | 'wide';

export function shots(p: PlateInfo, au: AudioLite): Shot[] {
  const sb = sbShotTimes(p.id);
  const views = VIEWS[p.variant] ?? ['sheet'];
  const base: Shot[] = sb.map((t, i) => ({
    t: i === 0 ? p.start : t,
    s: { id: `${p.id}#${i}`, view: views[Math.min(i, views.length - 1)]!, frame: p.variant === 'return' && i === 2 ? 'wide' : 'sheet' },
  }));
  const extra: Shot[] = [];
  const frameEps = 1 / 60;
  if (p.variant === 'orbits' || p.variant === 'exploded') {
    // a crop onto a detail on the 3rd beat of every shot (half a bar after each storyboard cut)
    base.forEach((b, i) => {
      const t1 = base[i + 1]?.t ?? p.end;
      const bt = beatTimes(au, b.t - frameEps, t1 - frameEps);
      const at = bt[2];
      if (at !== undefined && at < p.end - 0.1) extra.push({ t: at, s: { ...b.s, id: `${b.s.id}c`, frame: 'crop' } });
    });
  } else if (p.variant === 'stamp') {
    const bt = beatTimes(au, p.start + frameEps, p.end - frameEps);
    if (bt[0] !== undefined) extra.push({ t: bt[0], s: { ...base[0]!.s, id: `${p.id}#i`, frame: 'interior' } });
  } else if (p.variant === 'room') {
    // close on the dimension label from the downbeat inside the isometric shot
    const iso = base[1];
    if (iso) {
      const t1 = base[2]?.t ?? p.end;
      const d = barTimes(au, iso.t + frameEps, t1 - frameEps)[0];
      if (d !== undefined) extra.push({ t: d, s: { ...iso.s, id: `${iso.s.id}c`, frame: 'close' } });
    }
  }
  return [...base, ...extra].sort((a, b) => a.t - b.t);
}
