// Shots: the structural state of a plate over time, as a pure list. NO runtime imports (bun runs every
// `scenes/<module>.shots.ts` in the edit gate without three.js or a DOM).
//
// API (stable — plate authors code against this):
//   type Shot = { t: number; s: ShotState }     t = SONG time (s); s = STRUCTURAL state only:
//                                               camera framing, layout, medium, topology. Key 'id' is a free
//                                               label and is ignored when counting transitions.
//                                               Zooms, flashes, colour, highlights, bloom are NOT state —
//                                               author them per frame from the shot you are in (post overrides).
//   stateAt(shots, t): ShotState                the last shot with shot.t <= t (the first shot if t is before it)
//   shotAt(shots, t): { shot, index, t0, t1 }   same, with the shot's index and window (t1 = next shot's t or +Inf)
//   sameState(a, b): boolean                    structural equality ignoring 'id' (what the gate counts)
//   barTimes(au, from, to, every = 1)           downbeats in [from, to), every Nth (starting with the first)
//   beatTimes(au, from, to, every = 1)          beats in [from, to), every Nth
//   downbeatAt(au, t)                           the last downbeat <= t (the first downbeat if t is before it)
//   barLen(au)                                  seconds per bar (4 beats at au.bpm)
//   gapCap(au, a, b)                            max seconds allowed between two transitions spanning [a, b):
//                                               the strictest SECTION_GAP_BARS among the sections it touches
//                                               (drop1/drop2/climax 1 bar, vocal sections 2, intro/outro 4)
//
// Contract for `scenes/<module>.shots.ts` (pure; imports only from '../engine/shots'):
//   export function shots(p: PlateInfo, au: AudioLite): Shot[]
// called once per plate that uses the module (p = that plate from data/edit.json). Return shots sorted by t;
// the first should sit at p.start. The scene imports the same function and calls stateAt(list, f.t) per frame.
// The gate (scripts/edit-gate.ts) counts a transition whenever consecutive states differ (sameState false),
// plus every plate start; events within one frame (1/60 s) are one event.

export type ShotValue = string | number | boolean;
export type ShotState = Record<string, ShotValue>;
export type Shot = { t: number; s: ShotState };

/** One plate of data/edit.json. */
export interface PlateInfo {
  id: string;
  module: string;
  variant: string;
  /** Owned lyric line indices (data/lyrics.json); [] for instrumental plates. */
  lines: number[];
  /** Instrumental plates planned in bars (null otherwise). */
  bars: number | null;
  /** Bright (bone paper) plate. */
  light: boolean;
  /** The on-screen event this plate must show. */
  event: string;
  start: number;
  end: number;
  anchor: string;
  dur?: number;
  /** The only plates allowed to use the 'accent' palette token. */
  accent?: boolean;
  /** v3: PLAN-V3 row number (#36 does not exist). */
  n?: number;
  /** v3 look: canonical idiom (adjacency/uniqueness), family, named palette (engine/palette.ts), ground, legacy B/C/O palette. */
  look?: PlateLook;
  /** v3: plate-ID-scoped sequence exception (popup-life, demo). */
  sequence?: string;
  /** v3: the cut to the next plate is a gated circle match cut. */
  match_circle_next?: boolean;
  /** v3: the PLAN-V3 start time before snapping. */
  plan?: number;
}

export interface PlateLook {
  idiom: string;
  family: 'E' | 'S' | 'H' | 'M' | 'P' | 'A' | string;
  palette: string;
  ground: 'dark' | 'mid' | 'light';
  bco: boolean;
}

/** The slice of data/audio.json a shot list may depend on. */
export interface AudioLite {
  bpm: number;
  beats: number[];
  downbeats: number[];
  sections: { name: string; start: number; end: number }[];
  duration: number;
}

function indexAt(shots: readonly Shot[], t: number): number {
  if (shots.length === 0) throw new Error('stateAt: empty shot list');
  // not assuming sorted input: the latest shot at or before t; ties keep the later entry in the list
  let best = -1;
  for (let i = 0; i < shots.length; i++) if (shots[i]!.t <= t && (best < 0 || shots[i]!.t >= shots[best]!.t)) best = i;
  if (best >= 0) return best;
  let first = 0;
  for (let i = 1; i < shots.length; i++) if (shots[i]!.t < shots[first]!.t) first = i;
  return first;
}

/** Structural state at song time t. Pure and deterministic. */
export function stateAt(shots: readonly Shot[], t: number): ShotState {
  return shots[indexAt(shots, t)]!.s;
}

/** The shot in effect at t, its index in `shots`, and its window [t0, t1). */
export function shotAt(shots: readonly Shot[], t: number): { shot: Shot; index: number; t0: number; t1: number } {
  const index = indexAt(shots, t);
  const shot = shots[index]!;
  let t1 = Infinity;
  for (const s of shots) if (s.t > shot.t && s.t < t1) t1 = s.t;
  return { shot, index, t0: shot.t, t1 };
}

/** Structural equality, ignoring the 'id' label. */
export function sameState(a: ShotState, b: ShotState): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  keys.delete('id');
  for (const k of keys) if (a[k] !== b[k]) return false;
  return true;
}

export const barLen = (au: AudioLite) => (4 * 60) / au.bpm;

const EPS = 1e-6;
const pick = (xs: number[], from: number, to: number, every: number) =>
  xs.filter((x) => x >= from - EPS && x < to - EPS).filter((_, i) => i % Math.max(1, Math.round(every)) === 0);

/** Downbeats in [from, to), every Nth. */
export function barTimes(au: AudioLite, from: number, to: number, every = 1): number[] {
  return pick(au.downbeats, from, to, every);
}

/** Beats in [from, to), every Nth. */
export function beatTimes(au: AudioLite, from: number, to: number, every = 1): number[] {
  return pick(au.beats, from, to, every);
}

/** The last downbeat at or before t (the first downbeat if t precedes them all). */
export function downbeatAt(au: AudioLite, t: number): number {
  let d = au.downbeats[0] ?? 0;
  for (const x of au.downbeats) if (x <= t + EPS) d = x;
  return d;
}

/** Max bars without a structural transition, per section (docs/EDIT-SPEC.md §Plates and shots). */
export const SECTION_GAP_BARS: Record<string, number> = {
  intro: 4, verse1: 2, pre1: 2, drop1: 1, bridge: 2, verse2: 2, pre2: 2, climax: 1, drop2: 1, outro: 4,
};

/** Max seconds between two transitions at a and b: the strictest section cap over [a, b) (unknown sections: 2 bars). */
export function gapCap(au: AudioLite, a: number, b: number): number {
  let bars = Infinity;
  for (const s of au.sections) if (s.end > a + EPS && s.start < b - EPS) bars = Math.min(bars, SECTION_GAP_BARS[s.name] ?? 2);
  return (bars === Infinity ? 2 : bars) * barLen(au);
}
