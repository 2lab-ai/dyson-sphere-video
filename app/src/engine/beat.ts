// Beat visibility. Pure (no DOM / three.js): usable from scenes and from bun.
//
// RULE (docs/EDIT-SPEC.md): the beat must always be visible on screen. Every plate module MUST drive a
// clearly visible per-beat response from these functions — a scale/position snap, a luminance hit, a line
// weight, a stamp — authored by the plate in its own idiom. There is no global beat overlay or beat FX.
// The edit gate checks that every module used by a plate calls beatPulse, kickPulse or downbeatPulse
// (a named import from '../engine/beat').
//
// API (stable):
//   beatPulse(au, t, decay = 0.12)     1 at each beat, exp-decays with time constant `decay` s (0 before the first)
//   downbeatPulse(au, t, decay = 0.2)  same on bar downbeats
//   kickPulse(au, t, decay = 0.12)     same on detected kicks (au.onsets.kick, scaled by strength);
//                                      falls back to beatPulse when the analysis has no kick onsets
//   beatIndex(au, t)                   integer index of the last beat <= t (-1 before the first)
//   barIndex(au, t)                    integer index of the last downbeat <= t (-1 before the first)
//   beatPhase(au, t)                   0..1 through the current beat
// `au` is anything with beats/downbeats (AudioData, or AudioLite in .shots.ts files).

export interface BeatAudio {
  bpm: number;
  beats: number[];
  downbeats: number[];
  onsets?: Record<string, [number, number][]>;
}

/** Index of the last x in sorted xs with x <= t (-1 if none). */
function lastAtOrBefore(xs: readonly number[], t: number): number {
  let lo = 0, hi = xs.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (xs[m]! <= t + 1e-9) lo = m + 1; else hi = m; }
  return lo - 1;
}

const decayFrom = (t0: number, t: number, decay: number) => Math.exp(-(t - t0) / Math.max(1e-4, decay));

export function beatIndex(au: BeatAudio, t: number): number { return lastAtOrBefore(au.beats, t); }
export function barIndex(au: BeatAudio, t: number): number { return lastAtOrBefore(au.downbeats, t); }

export function beatPulse(au: BeatAudio, t: number, decay = 0.12): number {
  const i = beatIndex(au, t);
  return i < 0 ? 0 : decayFrom(au.beats[i]!, t, decay);
}

export function downbeatPulse(au: BeatAudio, t: number, decay = 0.2): number {
  const i = barIndex(au, t);
  return i < 0 ? 0 : decayFrom(au.downbeats[i]!, t, decay);
}

export function kickPulse(au: BeatAudio, t: number, decay = 0.12): number {
  const ks = au.onsets?.kick;
  if (!ks || ks.length === 0) return beatPulse(au, t, decay);
  let lo = 0, hi = ks.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (ks[m]![0] <= t + 1e-9) lo = m + 1; else hi = m; }
  let v = 0;
  for (let i = lo - 1; i >= 0 && t - ks[i]![0] < decay * 8; i--) v = Math.max(v, ks[i]![1] * decayFrom(ks[i]![0], t, decay));
  return v;
}

export function beatPhase(au: BeatAudio, t: number): number {
  const i = beatIndex(au, t);
  const b = au.beats;
  if (i < 0 || i + 1 >= b.length) return 0;
  return (t - b[i]!) / Math.max(1e-6, b[i + 1]! - b[i]!);
}
