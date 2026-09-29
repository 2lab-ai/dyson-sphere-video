// Shot list for the gauge plates (pure: imported by scenes/gauge.ts and by the edit gate).
// State = camera framing (`frame`) + the drawn medium (`medium`: the dial face, the ratchet mechanism behind it,
// or the dial case seen edge-on). Built on the approved storyboard shot times (sbShotTimes), plus one extra cut
// per plate on the hit that the storyboard names in its exit/beat (the stop impact, the needle snapping off).
import { beatTimes, barTimes, type AudioLite, type PlateInfo, type Shot } from '../engine/shots';
import { sbShotTimes } from '../engine/storyboard';

export type Framing = 'dial' | 'sprocket' | 'wheel' | 'side' | 'macro' | 'snap' | 'wide' | 'close' | 'words' | 'tilt' | 'tear';

// storyboard order per variant: countdown = full dial / sprocket macro / side view; exp = dial / needle macro
// bass (v3 p07, Saul Bass cut paper) = wide clock / close on the hands at the stop / tilt with the pinning arrow
const PLAN: Record<string, Framing[]> = { countdown: ['dial', 'sprocket', 'side'], exp: ['dial', 'macro'], bass: ['wide', 'close', 'tilt'] };
const MEDIUM: Record<Framing, string> = {
  dial: 'face', wheel: 'face', snap: 'face', macro: 'face', sprocket: 'ratchet', side: 'case',
  wide: 'clock', close: 'hands', words: 'type-card', tilt: 'arrow', tear: 'torn',
};

/** p07: the downbeat on which the needle reaches the stop (the last downbeat inside the plate). */
export function stopTime(p: PlateInfo, au: AudioLite): number {
  const d = barTimes(au, p.start, p.end);
  return d[d.length - 1] ?? p.end;
}

/** p23: the beat on which the needle snaps off (the last beat inside the plate). */
export function snapTime(p: PlateInfo, au: AudioLite): number {
  const b = beatTimes(au, p.start + 0.05, p.end - 1 / 60);
  return b[b.length - 1] ?? p.end - 0.1;
}

export function shots(p: PlateInfo, au: AudioLite): Shot[] {
  const plan = PLAN[p.variant] ?? PLAN.countdown!;
  const ts = sbShotTimes(p.id);
  const list: { t: number; f: Framing }[] = ts.map((t, i) => ({ t: i === 0 ? p.start : t, f: plan[Math.min(i, plan.length - 1)]! }));
  // extra cut: the stop impact (countdown) / the snap (exp), unless it coincides with a storyboard shot
  // bass: the stop impact re-frames onto the type card; the last beat tears the paper clock away (the exit)
  const extras: { t: number; f: Framing }[] = p.variant === 'exp' ? [{ t: snapTime(p, au), f: 'snap' }]
    : p.variant === 'bass' ? [{ t: stopTime(p, au), f: 'words' }, { t: snapTime(p, au), f: 'tear' }]
    : [{ t: stopTime(p, au), f: 'wheel' }];
  for (const extra of extras) if (extra.t > p.start + 0.1 && extra.t < p.end - 1 / 60 && list.every((s) => Math.abs(s.t - extra.t) > 0.1)) list.push(extra);
  list.sort((a, b) => a.t - b.t);
  return list.map((s, i) => ({ t: s.t, s: { id: `${p.id}#${i}`, frame: s.f, medium: MEDIUM[s.f] } }));
}
