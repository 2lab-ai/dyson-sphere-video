// Shot list for the xray plate (pure: imported by scenes/xray.ts and by the edit gate).
// Every storyboard shot is a structural change, in order. State = `frame` (camera on the film) + `film` (which
// radiograph is on the lightbox: a new sheet is a medium/topology change, the view changes from front to lateral).
//   heart: wide AP film on the lightbox (whole chest, ribs of gears, clockwork heart)
//          -> [extra, beat before 심장이] the camera snaps half-way in on the heart
//          -> a second film slides in: close on the heart pump, the letters as bone inside it
//          -> a third film (lateral): the gear train in profile, the letters stacked as vertebrae
import { beatTimes, type AudioLite, type PlateInfo, type Shot, type ShotState } from '../engine/shots';
import { sbShotTimes } from '../engine/storyboard';

const PLAN: Record<string, ShotState[]> = {
  heart: [
    { frame: 'wide', film: 'ap' },
    { frame: 'close', film: 'heart' },
    { frame: 'side', film: 'lateral' },
  ],
};

function sbTimes(p: PlateInfo): number[] {
  try {
    const ts = sbShotTimes(p.id);
    return ts.length ? ts : [p.start];
  } catch {
    return [p.start];
  }
}

export function shots(p: PlateInfo, au: AudioLite): Shot[] {
  const plan = PLAN[p.variant] ?? PLAN.heart!;
  const ts = sbTimes(p);
  const out: Shot[] = ts.map((t, i) => ({ t: i === 0 ? p.start : t, s: { id: `${p.id}#${i}`, ...plan[Math.min(i, plan.length - 1)]! } }));
  // extra: inside the long wide hold, the beat nearest its middle snaps the camera to a mid framing on the heart
  const a = out[0]!.t, b = out[1]?.t ?? p.end;
  const mid = beatTimes(au, a + 0.3, b - 0.3).sort((x, y) => Math.abs(x - (a + b) / 2) - Math.abs(y - (a + b) / 2))[0];
  if (mid !== undefined) out.push({ t: mid, s: { id: `${p.id}#x0`, frame: 'mid', film: 'ap' } });
  return out.sort((x, y) => x.t - y.t);
}
