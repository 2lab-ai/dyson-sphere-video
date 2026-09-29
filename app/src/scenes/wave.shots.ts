// Shot list for the wave plates (pure: imported by scenes/wave.ts and by the edit gate).
// State = camera view (`view`) + halftone screen (`screen`: the dot grid's geometry — pitch and angle family).
// tide (p05): the approved storyboard shots map in order to side → curl → top; one extra shot on the downbeat
// between curl and top tracks the crest close (the line in big type riding the back of the wave).
import { barTimes, type AudioLite, type PlateInfo, type Shot } from '../engine/shots';
import { sbShotTimes } from '../engine/storyboard';

export const VIEWS = ['side', 'curl', 'crest', 'top'] as const;
export type View = (typeof VIEWS)[number];

// the halftone screen per view: fine 45° print screen / huge dots / medium 45° / rows along the wave front
const SCREEN: Record<View, string> = { side: 'fine45', curl: 'huge45', crest: 'mid45', top: 'rows' };

export function shots(p: PlateInfo, au: AudioLite): Shot[] {
  const sb = sbShotTimes(p.id);
  const approved: View[] = ['side', 'curl', 'top'];
  const list: Shot[] = sb.map((t, i) => {
    const view = approved[Math.min(i, approved.length - 1)]!;
    return { t, s: { id: `${p.id}#${view}`, view, screen: SCREEN[view] } };
  });
  // extra: the first downbeat strictly inside the curl shot (≥ 1/60 s from both neighbours) cuts to the crest
  const a = sb[1], b = sb[2];
  if (a !== undefined && b !== undefined) {
    const d = barTimes(au, a + 1 / 30, b - 1 / 30)[0];
    if (d !== undefined) list.push({ t: d, s: { id: `${p.id}#crest`, view: 'crest', screen: SCREEN.crest } });
  }
  return list.sort((x, y) => x.t - y.t);
}
