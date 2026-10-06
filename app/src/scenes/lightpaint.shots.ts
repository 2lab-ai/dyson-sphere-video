// Shot list for the light-painting plate (pure: imported by scenes/lightpaint.ts and by the edit gate).
// Times come from the approved storyboard (engine/storyboard): every storyboard shot is a structural change, in order.
// State = `frame` (camera) + `stage` (what the exposure shows).
import { type AudioLite, type PlateInfo, type Shot, type ShotState } from '../engine/shots';
import { sbShotTimes } from '../engine/storyboard';

/** Per variant: one state per storyboard shot, in storyboard order. */
const PLAN: Record<string, ShotState[]> = {
  // black studio, the figure's pen swings the first trail -> tracking with the pen head along the line ->
  // the whole exposure at once, the figure a smeared ghost; the shutter closes on the plate's last frames
  time: [
    { frame: 'wide', stage: 'figure' },
    { frame: 'track', stage: 'pen' },
    { frame: 'flat', stage: 'exposure' },
  ],
  // p12 (hosted on FILM; the host owns the camera): the orbit tightens shot by shot, then collapses to the anchor point
  orbit: [
    { frame: 'wide', stage: 'orbit' },
    { frame: 'track', stage: 'orbit' },
    { frame: 'flat', stage: 'orbit' },
    { frame: 'wide', stage: 'tighten' },
    { frame: 'flat', stage: 'collapse' },
    { frame: 'wide', stage: 'point' },
  ],
};

function sbTimes(p: PlateInfo): number[] {
  try {
    return sbShotTimes(p.id);
  } catch {
    return [p.start];
  }
}

export function shots(p: PlateInfo, _au: AudioLite): Shot[] {
  const plan = PLAN[p.variant] ?? PLAN.time!;
  const ts = sbTimes(p);
  return ts.map((t, i) => ({ t: i === 0 ? p.start : t, s: { id: `${p.id}#${i}`, ...plan[Math.min(i, plan.length - 1)]! } }));
}
