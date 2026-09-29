// CLAY — the birth of writing (p34-clay-tablet; idiom clay-tablet, lit matter). A pillow-shaped clay tablet lies on a
// table under one low raking lamp. Its left column is already full of cuneiform; the right column is being written.
// On every beat a reed stylus drives one wedge into the wet clay (the depth reaches full exactly on the beat, the
// displaced clay bulges into a lip, the fresh wedge stays wet and glints) and the lamp's direction snaps, so every
// shadow on the tablet jumps. The signs accumulate down the column. Bar 2's third beat hands the tablet to a
// window: an arched window-light patch (mullioned, uncoloured) slides over the clay as the lamp dies (exit to #35).
// Render: a heightfield (tablet body + ruled grooves + the one sign in the pixel's cell, each wedge a triangular pit
// with a vertical back wall) shaded with a hard raking key, a heightfield shadow march that also sees the stylus,
// and a bounce fill from the table. The stylus is an analytic capsule. Half resolution, upscaled.
import * as THREE from 'three';
import { Scene, type Frame, type PostOverrides } from '../engine/scene';
import { FSPass, makeRT, W, H } from '../engine/gl';
import { palette, plin, type NamedPalette } from '../engine/palette';
import { beatPulse, kickPulse, downbeatPulse, beatIndex, type BeatAudio } from '../engine/beat';
import { shotAt, type PlateInfo, type Shot } from '../engine/shots';
import { hash, lerp, smoothstep, clamp } from '../engine/util';
import { shots } from './clay.shots';

type V3 = [number, number, number];
type V2 = [number, number];

// ------------------------------------------------------------------ layout (shared by the shader and the stylus)
/** Tablet half extents (world units; the tablet lies in the z=0 plane, y away from the viewer, z up). */
export const TAB: V2 = [1.0, 1.3];
export const ROW_TOP = 1.16, ROW_H = 0.232, SLOT_W = 0.215, ROWS = 10, SLOTS = 4;
export const COLX: V2 = [-0.92, 0.06];
/** Wedge depth at full press. */
export const DEPTH = 0.03;
/** The sign where this plate's writing starts (column 2, row 6, slot 3): everything before it is already written. */
export const S0 = 62;
/**
 * Sign templates: up to 4 wedges each, [x, y, type] relative to the slot's left-centre. Types: 0 horizontal (head
 * left, tail right), 1 vertical (head top), 2 Winkelhaken (a short corner impression opening right), 3 diagonal.
 */
export const TPL: V3[][] = [
  [[0.02, 0.0, 0]],
  [[0.05, 0.07, 1], [0.11, 0.07, 1]],
  [[0.02, 0.04, 0], [0.02, -0.04, 0], [0.18, 0.07, 1]],
  [[0.09, 0.03, 2], [0.09, -0.04, 2], [0.17, 0.0, 2]],
  [[0.02, 0.0, 0], [0.1, 0.07, 1], [0.15, 0.07, 1]],
  [[0.02, 0.06, 3], [0.06, -0.03, 0], [0.19, 0.0, 2]],
  [[0.03, 0.07, 1], [0.07, 0.035, 0], [0.07, -0.04, 0]],
  [[0.06, 0.035, 2], [0.06, -0.04, 2], [0.08, 0.0, 0]],
];
/** [angle of head->tail, length, head half-width] per wedge type. */
export const WTYPE: V3[] = [[0, 0.13, 0.034], [-Math.PI / 2, 0.13, 0.032], [Math.PI, 0.055, 0.036], [-Math.PI / 4, 0.11, 0.03]];

export const tplOf = (s: number) => (s * 5 + Math.floor(s / 3) * 3 + Math.floor(s / 7)) % 8;
export function slotOrigin(s: number): V2 {
  const col = Math.floor(s / (ROWS * SLOTS)), r = Math.floor((s % (ROWS * SLOTS)) / SLOTS), k = s % SLOTS;
  return [COLX[col]! + k * SLOT_W, ROW_TOP - (r + 0.5) * ROW_H];
}
/** The n-th wedge written from sign S0 on: its sign, its index in the sign, its head and its angle. */
export function nthWedge(n: number): { s: number; j: number; head: V2; ang: number } {
  let s = S0, j = n;
  while (j >= TPL[tplOf(s)]!.length) { j -= TPL[tplOf(s)]!.length; s++; }
  const w = TPL[tplOf(s)]![j]!, o = slotOrigin(s);
  return { s, j, head: [o[0] + w[0], o[1] + w[1]], ang: WTYPE[w[2]]![0] };
}
/** Tablet body: rounded-rect distance (slightly hand-made) and the pillow height. */
export function bodyD(x: number, y: number): number {
  const r = 0.22, qx = Math.abs(x) - TAB[0] + r, qy = Math.abs(y) - TAB[1] + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r + 0.012 * Math.sin(x * 5 + 1.3) * Math.sin(y * 4 + 0.7);
}
export function bodyH(x: number, y: number): number {
  const pil = 1 - 0.5 * ((x * x) / (TAB[0] * TAB[0]) + (y * y) / (TAB[1] * TAB[1]));
  return (0.1 + 0.03 * pil) * (1 - smoothstep(-0.09, 0.03, bodyD(x, y)));
}

const f3 = (x: number) => x.toFixed(4);
const TW_GLSL = `const vec3 TW[32] = vec3[32](${TPL.flatMap((t) => [0, 1, 2, 3].map((i) => (t[i] ? `vec3(${f3(t[i]![0])}, ${f3(t[i]![1])}, ${f3(t[i]![2])})` : 'vec3(0.0, 0.0, -1.0)'))).join(', ')});`;
const WT_GLSL = `const vec3 WT[4] = vec3[4](${WTYPE.map((w) => `vec3(${f3(w[0])}, ${f3(w[1])}, ${f3(w[2])})`).join(', ')});`;

const GLSL = /* glsl */ `
uniform vec3 uCamE, uCamT;
uniform float uFov, uRoll, uAspect;
uniform vec3 uL;        // toward the lamp
uniform float uLi;      // lamp intensity
uniform vec2 uPool;     // lamp pool centre (tablet plane)
uniform float uWin;     // window light 0..1
uniform vec2 uWinC;     // window patch centre
uniform float uSign, uK, uPress, uS0; // writing head: current sign, wedge within it, its press 0..1; first new sign
uniform vec3 uTip, uDir; // stylus tip and shaft direction
uniform float uStyl;    // stylus present
uniform float uBp;      // beat pulse
uniform vec3 uGround, uDeep, uMid, uHi, uSig;

const vec2 TAB = vec2(${f3(TAB[0])}, ${f3(TAB[1])});
const float ROW_TOP = ${f3(ROW_TOP)}, ROW_H = ${f3(ROW_H)}, SLOT_W = ${f3(SLOT_W)};
const float COL0 = ${f3(COLX[0])}, COL1 = ${f3(COLX[1])};
const float DEP = ${f3(DEPTH)};
const float STY_R = 0.034, STY_L = 2.6;
${TW_GLSL}
${WT_GLSL}

int tplOf(int s) { return (s * 5 + (s / 3) * 3 + s / 7) % 8; }

float bodyD(vec2 p) {
  float r = 0.22;
  vec2 q = abs(p) - TAB + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r + 0.012 * sin(p.x * 5.0 + 1.3) * sin(p.y * 4.0 + 0.7);
}
float bodyH(vec2 p) {
  float pil = 1.0 - 0.5 * (p.x * p.x / (TAB.x * TAB.x) + p.y * p.y / (TAB.y * TAB.y));
  return (0.1 + 0.03 * pil) * (1.0 - smoothstep(-0.09, 0.03, bodyD(p)));
}

// one wedge: (depth, lip). A triangular pit: vertical back wall at the head, V cross-section tapering to the tail.
vec2 wedge(vec2 p, vec2 hd, float ang, float L, float w) {
  vec2 dir = vec2(cos(ang), sin(ang)), pr = vec2(-dir.y, dir.x);
  vec2 q = p - hd;
  float u = dot(q, dir), v = dot(q, pr);
  float f = clamp(1.0 - u / L, 0.0, 1.0);
  float hw = w * f;
  float a = max(1.0 - abs(v) / max(hw, 1e-4), 0.0);
  float wall = smoothstep(-0.004, 0.001, u);
  float dep = DEP * a * sqrt(f) * wall * step(u, L);
  float e = max(max(-u, abs(v) - hw), u - L);
  float lip = 0.14 * DEP * exp(-max(e, 0.0) / 0.012) * smoothstep(0.0, 0.004, e);
  return vec2(dep, lip);
}

// the tablet height; pit = 0..1 wedge depth here, fresh = 1 on this plate's new signs
float hgt(vec2 p, out float pit, out float fresh) {
  pit = 0.0; fresh = 0.0;
  float h = bodyH(p);
  if (bodyD(p) > 0.0) return h;
  if (abs(p.y) < ROW_TOP + 0.01 && abs(p.x) < -COL0 + 0.01) {
    float yy = (ROW_TOP - p.y) / ROW_H;
    float dy = (fract(yy + 0.5) - 0.5) * ROW_H + 0.003 * sin(p.x * 9.0 + floor(yy + 0.5) * 1.7);
    float g = exp(-dy * dy / (0.0045 * 0.0045));
    float dx = p.x + 0.004 * sin(p.y * 6.0);
    g = max(g, exp(-dx * dx / (0.005 * 0.005)));
    h -= 0.006 * g;
  }
  int col = p.x < 0.0 ? 0 : 1;
  float x0 = col == 0 ? COL0 : COL1;
  float fs = floor((p.x - x0) / SLOT_W), fr = floor((ROW_TOP - p.y) / ROW_H);
  if (fs < 0.0 || fs > 3.0 || fr < 0.0 || fr > 9.0) return h;
  int s = col * 40 + int(fr) * 4 + int(fs);
  float sf = float(s);
  if (sf > uSign + 0.5) return h;
  vec2 o = vec2(x0 + fs * SLOT_W, ROW_TOP - (fr + 0.5) * ROW_H);
  int tp = tplOf(s);
  float dep = 0.0, lip = 0.0;
  for (int j = 0; j < 4; j++) {
    vec3 wd = TW[tp * 4 + j];
    if (wd.z < -0.5) break;
    float fj = float(j);
    float vis = sf < uSign - 0.5 ? 1.0 : (fj < uK - 0.5 ? 1.0 : (abs(fj - uK) < 0.5 ? uPress : 0.0));
    if (vis <= 0.0) continue;
    vec3 wt = WT[int(wd.z + 0.5)];
    float hj = hash11(sf * 4.0 + fj + 0.5);
    vec2 r = wedge(p, o + wd.xy + (vec2(hj, fract(hj * 7.3)) - 0.5) * 0.008, wt.x + (fract(hj * 3.1) - 0.5) * 0.08, wt.y, wt.z);
    dep = max(dep, r.x * vis);
    lip = max(lip, r.y * vis);
  }
  pit = dep / DEP;
  fresh = sf > uS0 - 0.5 ? 1.0 : 0.0;
  return h + lip * max(0.0, 1.0 - dep / (0.2 * DEP)) - dep;
}
float hgt(vec2 p) { float a, b; return hgt(p, a, b); }

float styD(vec3 q) {
  vec3 pa = q - uTip, ba = uDir * STY_L;
  float k = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * k) - STY_R;
}

float shadow(vec3 P, vec3 L) {
  float res = 1.0, t = 0.006;
  for (int i = 0; i < 18; i++) {
    vec3 q = P + L * t;
    res = min(res, clamp(10.0 * (q.z - hgt(q.xy)) / t, 0.0, 1.0));
    if (uStyl > 0.5) res = min(res, clamp(6.0 * styD(q) / t, 0.0, 1.0));
    if (res < 0.01 || q.z > 0.3) break;
    t *= 1.28;
  }
  return res;
}

// ray vs capsule (iq); returns t or -1
float capHit(vec3 ro, vec3 rd, vec3 pa, vec3 pb, float r) {
  vec3 ba = pb - pa, oa = ro - pa;
  float baba = dot(ba, ba), bard = dot(ba, rd), baoa = dot(ba, oa), rdoa = dot(rd, oa), oaoa = dot(oa, oa);
  float a = baba - bard * bard, b = baba * rdoa - baoa * bard, c = baba * oaoa - baoa * baoa - r * r * baba;
  float h = b * b - a * c;
  if (h >= 0.0) {
    float t = (-b - sqrt(h)) / a;
    float y = baoa + t * bard;
    if (y > 0.0 && y < baba) return t;
    vec3 oc = y <= 0.0 ? oa : ro - pb;
    b = dot(rd, oc); c = dot(oc, oc) - r * r;
    h = b * b - c;
    if (h > 0.0) return -b - sqrt(h);
  }
  return -1.0;
}

// smooth wet clay: broad thumb smears + a faint fine tooth (normal only)
float clayTooth(vec2 p) { return 0.0012 * snoise(p * 11.0) + 0.0004 * snoise(p * 55.0) + 0.00012 * snoise(p * 160.0); }

float winMask(vec2 p) {
  vec2 q = p - uWinC;
  q.x -= 0.35 * q.y;                     // the patch falls in at an angle
  float d = min(sdBox(q + vec2(0.0, 0.25), vec2(0.42, 0.55)), length(q - vec2(0.0, 0.3)) - 0.42);
  float m = 1.0 - smoothstep(-0.03, 0.03, d);
  float bars = max(1.0 - smoothstep(0.018, 0.03, abs(q.x)), 1.0 - smoothstep(0.018, 0.03, abs(q.y + 0.05)));
  return m * (1.0 - bars);
}

vec3 plate(vec2 uv) {
  vec3 E = uCamE, T = uCamT;
  vec3 f = normalize(T - E);
  vec3 r = normalize(cross(f, vec3(0.0, 0.0, 1.0)));
  vec3 u = cross(r, f);
  float cr = cos(uRoll), sr = sin(uRoll);
  vec3 r2 = r * cr + u * sr, u2 = u * cr - r * sr;
  float fl = 1.0 / tan(radians(uFov) * 0.5);
  vec3 rd = normalize(uv.x * r2 + uv.y * u2 + f * fl);
  vec3 Lc = mix(vec3(1.0), uHi, 0.45);
  // rays at or above the horizon: the far table fading into the dark
  if (rd.z > -0.02) return uGround * 0.35 * (1.0 - smoothstep(-0.02, 0.1, rd.z));

  // the tablet top plane, falling back to the table
  float tp = (0.11 - E.z) / rd.z;
  vec2 p = (E + rd * tp).xy;
  if (bodyD(p) > 0.02) {
    tp = -E.z / rd.z; p = (E + rd * tp).xy;
    // a grazing ray that passes the top but lands under the tablet sees its side wall
    if (bodyD(p) < 0.02) {
      vec2 gd = vec2(bodyD(p + vec2(0.01, 0.0)) - bodyD(p - vec2(0.01, 0.0)), bodyD(p + vec2(0.0, 0.01)) - bodyD(p - vec2(0.0, 0.01)));
      vec3 ns = normalize(vec3(normalize(gd), 0.15));
      vec3 alb = mix(uMid, uDeep, 0.3);
      return alb * (uGround * 0.3 + max(dot(ns, uL), 0.0) * uLi * 0.7 * Lc);
    }
  }

  // the stylus in front?
  if (uStyl > 0.5) {
    float ts = capHit(E, rd, uTip, uTip + uDir * STY_L, STY_R);
    if (ts > 0.0 && ts < tp) {
      vec3 q = E + rd * ts;
      vec3 pa = q - uTip;
      float k = clamp(dot(pa, uDir) / STY_L, 0.0, 1.0);
      vec3 n = normalize(pa - uDir * STY_L * k);
      vec3 a1 = normalize(cross(uDir, vec3(0.0, 0.0, 1.0))), a2 = cross(a1, uDir);
      float ang = atan(dot(n, a2), dot(n, a1));
      float fib = 0.82 + 0.18 * sin(ang * 16.0 + 2.0 * snoise(vec2(k * 30.0, ang)));
      vec3 alb = mix(uDeep, uMid, 0.5) * fib;
      float dif = max(dot(n, uL), 0.0);
      vec3 hv = normalize(uL - rd);
      float sp = pow(max(dot(n, hv), 0.0), 24.0) * 0.25;
      return alb * (uGround * 0.3 * (0.5 + 0.5 * n.z) + dif * uLi * Lc) + Lc * sp * uLi;
    }
  }

  float pit, fresh;
  float h0 = hgt(p, pit, fresh);
  // normal: heightfield + fine clay grain (grain only here, never in the shadow march)
  const float e = 0.0025;
  float g0 = clayTooth(p);
  float hx = hgt(p + vec2(e, 0.0)) + clayTooth(p + vec2(e, 0.0));
  float hy = hgt(p + vec2(0.0, e)) + clayTooth(p + vec2(0.0, e));
  vec3 n = normalize(vec3(-(hx - h0 - g0) / e, -(hy - h0 - g0) / e, 1.0));
  vec3 P = vec3(p, h0 + 0.0008);

  bool onTab = bodyD(p) < 0.0;
  vec3 alb;
  if (onTab) {
    alb = mix(uMid, uHi, 0.16 + 0.1 * snoise(p * 3.0));
    alb = mix(alb, uMid * 0.85, 0.35 * pit);
    alb *= 1.0 - 0.16 * fresh * smoothstep(0.0, 0.2, pit);   // wet clay is darker
  } else {
    alb = uGround * (0.82 + 0.1 * snoise(p * 2.5) + 0.04 * snoise(p * 40.0));
  }
  float pool = 0.4 + 0.6 * exp(-dot(p - uPool, p - uPool) / 1.3);
  float dif = max(dot(n, uL), 0.0);
  float sh = dif > 0.0 ? shadow(P, uL) : 0.0;
  float occ = 1.0 - 0.45 * pit;
  vec3 col = alb * (uGround * 0.34 * (0.55 + 0.45 * n.z) * occ + dif * sh * uLi * pool * Lc);
  // wet glint on the fresh wedges (and a little around them)
  vec3 hv = normalize(uL - rd);
  float wet = fresh * (0.25 + 0.75 * smoothstep(0.05, 0.3, pit));
  col += Lc * uLi * pool * sh * wet * 0.9 * pow(max(dot(n, hv), 0.0), 60.0);
  // the window light (exit)
  if (uWin > 0.0) {
    vec3 Lw = normalize(vec3(-0.35, 0.55, 0.75));
    float m = winMask(p) * uWin;
    col += alb * m * (0.35 + 1.6 * max(dot(n, Lw), 0.0)) * uHi * 1.3;
  }
  return col;
}

void main() {
  vec2 p = (vUv - 0.5) * 2.0;
  p.x *= uAspect;
  fragColor = vec4(max(plate(p), 0.0), 1.0);
}
`;

// ------------------------------------------------------------------ per-frame state (pure; the proxy runs this too)
/** Camera rigs per shot state. `at` = target mode: tablet centre, the writing head at a given wedge, or fixed. */
const CAMS: Record<string, { off: V3; tgt: V3 | number[]; fov: number; roll: number; push: number }> = {
  wide: { off: [0.35, -1.85, 2.3], tgt: [0.22, -0.1, 0.1], fov: 40, roll: 0.0, push: 0.07 },
  rake: { off: [0.55, 0.85, 0.52], tgt: [2, 3], fov: 40, roll: -0.06, push: 0.08 },
  macro: { off: [0.14, -0.3, 0.6], tgt: [4, 5, 6, 7], fov: 38, roll: -0.05, push: 0.08 },
  window: { off: [0.0, -0.25, 2.5], tgt: [0.2, -0.25, 0.1], fov: 42, roll: -0.08, push: 0.05 },
};
/** Lamp azimuth offsets (deg), one per beat: the press snaps the raking light. */
const FLICK = [0, 34, -22, 40, -12, 28, -34, 16];
const LAMP_AZ: Record<string, number> = { lamp: 158, back: 232, 'lamp-low': 158, window: 158 };
const LAMP_EL: Record<string, number> = { lamp: 17, back: 13, 'lamp-low': 11, window: 20 };

export interface ClayState {
  camE: V3; camT: V3; fov: number; roll: number;
  L: V3; li: number; pool: V2; win: number; winC: V2;
  sign: number; k: number; press: number; s0: number;
  tip: V3; dir: V3; styl: number; bp: number;
  post: PostOverrides;
}

export function clayState(t: number, au: BeatAudio, plate: PlateInfo, list: Shot[]): ClayState {
  const beats = au.beats.filter((b) => b >= plate.start - 1e-3 && b < plate.end - 1e-3);
  const N = beats.length;
  const W8 = beats.map((_, i) => nthWedge(i));
  const PRESS = 0.1, HOLD = 0.07;
  // the writing head: the latest wedge whose press has begun
  let i = -1;
  for (let n = 0; n < N; n++) if (t >= beats[n]! - PRESS) i = n;
  const cur = W8[Math.max(0, i)]!;
  const press = i < 0 ? 0 : smoothstep(beats[i]! - PRESS, beats[i]!, t);

  // stylus pose
  const z0 = (x: V2) => bodyH(x[0], x[1]);
  const dirOf = (ang: number): V3 => {
    const hx = Math.cos(ang) * 0.4 + 0.6 * 0.94, hy = Math.sin(ang) * 0.4 + 0.6 * 0.33;
    const l = Math.hypot(hx, hy);
    const c = 0.72; // horizontal share
    const v: V3 = [(hx / l) * c, (hy / l) * c, Math.sqrt(1 - c * c)];
    return v;
  };
  const tipAt = (w: { head: V2; ang: number }): V2 => [w.head[0] + Math.cos(w.ang) * 0.012, w.head[1] + Math.sin(w.ang) * 0.012];
  let tip: V3, dir: V3;
  if (i < 0) {
    const w = W8[0]!, p = tipAt(w);
    tip = [p[0], p[1], z0(w.head) + 0.2]; dir = dirOf(w.ang);
  } else {
    const w = W8[i]!, p = tipAt(w), bt = beats[i]!;
    if (t <= bt + HOLD) {
      tip = [p[0], p[1], z0(w.head) + 0.03 * (1 - press) - DEPTH * 0.85 * press]; dir = dirOf(w.ang);
    } else if (i + 1 < N) {
      const w2 = W8[i + 1]!, p2 = tipAt(w2), t2 = beats[i + 1]! - PRESS;
      const s = clamp((t - bt - HOLD) / Math.max(0.05, t2 - bt - HOLD));
      const e = s * s * (3 - 2 * s);
      const hz = lerp(z0(w.head), z0(w2.head), e) + 0.03 * e + 0.16 * Math.sin(Math.PI * s);
      tip = [lerp(p[0], p2[0], e), lerp(p[1], p2[1], e), hz];
      const d1 = dirOf(w.ang), d2 = dirOf(w2.ang);
      const d: V3 = [lerp(d1[0], d2[0], e), lerp(d1[1], d2[1], e), lerp(d1[2], d2[2], e)];
      const dl = Math.hypot(...d);
      dir = [d[0] / dl, d[1] / dl, d[2] / dl];
    } else {
      // the last wedge is in: the stylus lifts away
      const s = clamp((t - bt - HOLD) / 0.45);
      tip = [p[0] + 0.5 * s * s, p[1] - 0.3 * s * s, z0(w.head) + 1.4 * s * s]; dir = dirOf(w.ang);
    }
  }

  // camera
  const sh = shotAt(list, t);
  const camK = String(sh.shot.s.cam);
  const cam = CAMS[camK] ?? CAMS.wide!;
  let T: V3;
  if (cam.tgt.length === 3 && camK !== 'rake' && camK !== 'macro') T = cam.tgt as V3;
  else {
    const ids = (cam.tgt as number[]).map((n) => Math.min(n, N - 1)).filter((n) => n >= 0);
    const hs = ids.map((n) => W8[n]!.head);
    T = [hs.reduce((a, h) => a + h[0], 0) / hs.length + 0.06, hs.reduce((a, h) => a + h[1], 0) / hs.length - 0.02, 0.1];
  }
  const sp = clamp((t - sh.t0) / Math.max(0.1, Math.min(sh.t1, plate.end) - sh.t0));
  const drift = (sp - 0.5) * 0.12;
  const E0: V3 = [T[0] + cam.off[0] + drift, T[1] + cam.off[1], T[2] + cam.off[2]];
  const E: V3 = [lerp(E0[0], T[0], cam.push * sp), lerp(E0[1], T[1], cam.push * sp), lerp(E0[2], T[2], cam.push * sp)];

  // the lamp: azimuth snaps on every beat, the elevation dips with the hit (shadows lengthen), intensity punches
  const bi = beatIndex(au, t);
  const k0 = beats.length ? au.beats.indexOf(beats[0]!) : bi;
  const kk = Math.max(0, bi - k0);
  const bp = beatPulse(au, t, 0.14);
  const lightK = String(sh.shot.s.light ?? 'lamp');
  const az = (((LAMP_AZ[lightK] ?? 158) + FLICK[kk % FLICK.length]!) * Math.PI) / 180;
  const el = (((LAMP_EL[lightK] ?? 17) * (1 - 0.3 * bp)) * Math.PI) / 180;
  const L: V3 = [Math.cos(el) * Math.cos(az), Math.cos(el) * Math.sin(az), Math.sin(el)];
  const win = lightK === 'window' ? 0.3 + 0.7 * smoothstep(sh.t0, plate.end - 0.05, t) : 0;
  const li = (0.78 / Math.sin((17 * Math.PI) / 180)) * (1 + 0.15 * bp) * (1 - 0.72 * win);

  // hits: the press lands on the beat (zoom punch + a short table jolt); the downbeat pushes harder
  const db = downbeatPulse(au, t, 0.2);
  const kp = kickPulse(au, t, 0.1);
  const jolt = bp * 9 + kp * 3;
  const post: PostOverrides = {
    zoom: 1 + 0.035 * bp + 0.03 * db,
    shake: [(hash(bi, 3) - 0.5) * jolt, (hash(bi, 4) - 0.5) * jolt],
    exposure: 1,
    bloom: win > 0 ? 0.12 * win : 0,
    bloomThreshold: 1.2,
    ca: 0.15,
    grain: 0.035,
    vignette: 0.3,
  };
  return {
    camE: E, camT: T, fov: cam.fov, roll: cam.roll,
    L, li, pool: [cur.head[0] - 0.15, cur.head[1] + 0.05], win, winC: [0.2, -0.05],
    sign: i < 0 ? S0 - 1 : cur.s, k: i < 0 ? 99 : cur.j, press: i < 0 ? 1 : press, s0: S0,
    tip, dir, styl: tip[2] < 1.5 ? 1 : 0, bp, post,
  };
}

export default class Clay extends Scene {
  private list: Shot[] = [];
  private plate!: PlateInfo;
  private P!: NamedPalette;
  pass!: FSPass;
  private rt!: THREE.WebGLRenderTarget;

  override init() {
    this.plate = this.ctx.params as PlateInfo;
    this.P = palette(this.ctx.params.look?.palette ?? 'tablet');
    this.list = shots(this.plate, this.ctx.audio);
    const v3 = (c: V3) => ({ value: new THREE.Vector3(...c) });
    const v2 = (c: V2) => ({ value: new THREE.Vector2(...c) });
    const u: Record<string, THREE.IUniform> = {
      uCamE: v3([0, -2, 3]), uCamT: v3([0, 0, 0]), uFov: { value: 40 }, uRoll: { value: 0 }, uAspect: { value: W / H },
      uL: v3([-1, 0.3, 0.3]), uLi: { value: 1 }, uPool: v2([0, 0]), uWin: { value: 0 }, uWinC: v2([0, 0]),
      uSign: { value: S0 }, uK: { value: 0 }, uPress: { value: 0 }, uS0: { value: S0 },
      uTip: v3([0, 0, 1]), uDir: v3([0, 0, 1]), uStyl: { value: 1 }, uBp: { value: 0 },
      uGround: v3(plin(this.P, 'ground')), uDeep: v3(plin(this.P, 'deep')), uMid: v3(plin(this.P, 'mid')),
      uHi: v3(plin(this.P, 'hi')), uSig: v3(plin(this.P, 'signal')),
    };
    this.pass = new FSPass(GLSL, u);
    this.rt = makeRT(W / 2, H / 2, { depthBuffer: false });
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const s = clayState(f.t, this.ctx.audio, this.plate, this.list);
    const u = this.pass.u;
    (u.uCamE!.value as THREE.Vector3).set(...s.camE);
    (u.uCamT!.value as THREE.Vector3).set(...s.camT);
    u.uFov!.value = s.fov; u.uRoll!.value = s.roll;
    (u.uL!.value as THREE.Vector3).set(...s.L);
    u.uLi!.value = s.li;
    (u.uPool!.value as THREE.Vector2).set(...s.pool);
    u.uWin!.value = s.win;
    (u.uWinC!.value as THREE.Vector2).set(...s.winC);
    u.uSign!.value = s.sign; u.uK!.value = s.k; u.uPress!.value = s.press; u.uS0!.value = s.s0;
    (u.uTip!.value as THREE.Vector3).set(...s.tip);
    (u.uDir!.value as THREE.Vector3).set(...s.dir);
    u.uStyl!.value = s.styl; u.uBp!.value = s.bp;
    this.pass.render(this.ctx.renderer, this.rt);
    this.ctx.comp.draw(this.ctx.renderer, this.rt.texture, out, { mode: 'replace' });
    return s.post;
  }

  override dispose() {
    this.rt?.dispose();
  }
}
