// p10 — LiDAR sweep (idiom S3, after Radiohead "House of Cards", 2008): a spinning range sensor scans the room
// "you and I made"; two figures come back as point returns. Everything on screen is a return of ONE sensor:
// 128 elevation rings x 1536 azimuth columns cast (once, at init) from the sensor origin against an analytic room
// (walls, floor, window and door holes, furniture, two figures). So the picture always carries the sensor's
// fingerprint: concentric floor rings around a blind circle under the head, scan rows on the walls, occlusion
// shadows (holes) behind every object, range jitter and dropout bursts. Never a free cloud.
//
// Beat: the head turns once per beat (the sweep front is a fresh, bright shell of returns that then settles), the
// ring banks come online over the first passes, kicks throw dropout bursts, downbeats punch the frame.
// Lyric: line 10 is retroreflective paint on the back wall. drawLyric renders it (per syllable) into a small mask
// canvas; the vertex shader reads the mask at each back-wall return, so the words exist only as brighter returns
// on the scanned surface, lit again every time the sweep passes.
// Figures: each figure return carries both hits (room behind / figure in front); a column shows the figure only
// from the first sweep pass after the figures' entrance, so they "arrive" as the sweep crosses them and cut their
// shadow into the wall and floor at the same moment.
import * as THREE from 'three';
import { Scene, type Frame, type PostOverrides } from '../engine/scene';
import { Layer2D, clearRT, rtScale } from '../engine/gl';
import { palette, plin, pcss, type NamedPalette } from '../engine/palette';
import { drawLyric, ownedLines, F } from '../engine/lyric';
import { beatPulse, kickPulse, downbeatPulse, beatIndex } from '../engine/beat';
import { shotAt, type PlateInfo, type Shot } from '../engine/shots';
import { clamp, ease, lerp, hash } from '../engine/util';
import type { Line } from '../engine/lyrics';
import { shots } from './lidar.shots';

// ------------------------------------------------------------------ the scanned world (metres, y up)
const RX0 = -5, RX1 = 5, RZ0 = -3, RZ1 = 4.5, RY1 = 3.4; // room box (open ceiling: rays above the walls are lost)
const SENSOR: V3 = [0, 1.1, 0.9];
const RINGS = 128, AZ = 1536;
/** Sign on the back wall (z = RZ0): the lyric's retroreflective paint. */
const SIGN = { x0: -4.2, x1: 3.0, y0: 2.3, y1: 3.0 };
const MASK_W = 2048, MASK_H = 200;
const T_FIG = 47.72; // storyboard W10.4: the figures appear as returns

type V3 = [number, number, number];
type Box = { lo: V3; hi: V3; refl: number };
type Cap = { a: V3; b: V3; r: number; refl: number };

/** Ring elevations (deg): sparse below the horizon, a dense band where the sign sits (real heads bunch beams). */
function ringElev(i: number): number {
  if (i < 56) return -30 + (i / 55) * 40.7; // -30 .. 10.7, ~0.74 deg
  if (i < 120) return 11 + ((i - 56) / 63) * 16; // 11 .. 27, ~0.25 deg
  return 27.6 + ((i - 120) / 7) * 5; // 27.6 .. 32.6
}
const ringStep = (i: number) => (i < 56 ? 0.74 : i < 120 ? 0.254 : 0.71);

const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, refl = 0.9): Box => ({ lo: [x0, y0, z0], hi: [x1, y1, z1], refl });
const FURNITURE: Box[] = [
  // table + legs
  box(-2.6, 0.72, -1.2, -1.2, 0.77, -0.4),
  box(-2.55, 0, -1.15, -2.49, 0.72, -1.09), box(-1.31, 0, -1.15, -1.25, 0.72, -1.09),
  box(-2.55, 0, -0.51, -2.49, 0.72, -0.45), box(-1.31, 0, -0.51, -1.25, 0.72, -0.45),
  // two chairs
  box(-3.15, 0.43, -1.0, -2.75, 0.47, -0.6), box(-3.15, 0.47, -1.0, -3.1, 0.98, -0.6),
  box(-3.12, 0, -0.97, -3.08, 0.43, -0.93), box(-2.82, 0, -0.67, -2.78, 0.43, -0.63),
  box(-1.05, 0.43, -1.0, -0.65, 0.47, -0.6), box(-0.7, 0.47, -1.0, -0.65, 0.98, -0.6),
  box(-1.02, 0, -0.97, -0.98, 0.43, -0.93), box(-0.72, 0, -0.67, -0.68, 0.43, -0.63),
  // sofa against the left wall
  box(-4.95, 0, -2.6, -4.1, 0.44, -0.3, 0.8), box(-4.98, 0.44, -2.6, -4.72, 0.92, -0.3, 0.8),
  box(-4.95, 0.44, -2.6, -4.1, 0.66, -2.42, 0.8), box(-4.95, 0.44, -0.48, -4.1, 0.66, -0.3, 0.8),
  // shelf on the back wall, left (four boards and two sides)
  box(-4.6, 0, -3, -4.56, 1.8, -2.66), box(-3.44, 0, -3, -3.4, 1.8, -2.66),
  box(-4.6, 0.02, -3, -3.4, 0.05, -2.66), box(-4.6, 0.6, -3, -3.4, 0.63, -2.66),
  box(-4.6, 1.2, -3, -3.4, 1.23, -2.66), box(-4.6, 1.77, -3, -3.4, 1.8, -2.66),
  // low cabinet, right front
  box(3.4, 0, 1.6, 4.9, 0.7, 2.3),
];
const PROPS: Cap[] = [
  { a: [-1.9, 2.25, -0.8], b: [-1.9, 2.25, -0.8], r: 0.22, refl: 1 }, // pendant shade
  { a: [3.9, 0, -2.3], b: [3.9, 1.5, -2.3], r: 0.03, refl: 0.7 }, // floor lamp pole
  { a: [3.9, 1.62, -2.3], b: [3.9, 1.62, -2.3], r: 0.2, refl: 1 }, // its shade
];

/** One standing figure, facing +x (dir 1) or -x (dir -1); `hand` = the point where the inner hand meets the other's. */
function figure(cx: number, cz: number, dir: number, h: number, hand: V3): Cap[] {
  const k = h / 1.72, y = (v: number) => v * k;
  const sh = 0.2 * k;
  return [
    { a: [cx, y(0.08), cz - 0.1 * k], b: [cx + dir * 0.02, y(0.86), cz - 0.09 * k], r: 0.075 * k, refl: 1 },
    { a: [cx - dir * 0.04, y(0.08), cz + 0.1 * k], b: [cx, y(0.86), cz + 0.09 * k], r: 0.075 * k, refl: 1 },
    { a: [cx, y(0.96), cz], b: [cx + dir * 0.02, y(1.36), cz], r: 0.165 * k, refl: 1 },
    { a: [cx + dir * 0.02, y(1.4), cz], b: [cx + dir * 0.03, y(1.5), cz], r: 0.05 * k, refl: 1 },
    { a: [cx + dir * 0.04, y(1.6), cz], b: [cx + dir * 0.04, y(1.6), cz], r: 0.105 * k, refl: 1 },
    { a: [cx, y(1.4), cz - sh], b: [cx + dir * 0.05, y(0.84), cz - sh - 0.05 * k], r: 0.048 * k, refl: 1 },
    { a: [cx, y(1.4), cz + sh], b: hand, r: 0.048 * k, refl: 1 },
  ];
}
const FIG_Z = -1.3;
const HANDS: V3 = [1.37, 1.0, FIG_Z + 0.2];
const FIGURES: Cap[] = [...figure(1.0, FIG_Z, 1, 1.74, HANDS), ...figure(1.75, FIG_Z, -1, 1.62, HANDS)];

// ------------------------------------------------------------------ ray casting (analytic, CPU, once)
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

type Hit = { t: number; n: V3; refl: number; wall: boolean };

function rayRoom(o: V3, d: V3): Hit | null {
  let best: Hit | null = null;
  const take = (t: number, n: V3, refl: number, wall: boolean) => { if (t > 1e-4 && (!best || t < best.t)) best = { t, n, refl, wall }; };
  // walls / floor (inside the box: the exit distance per axis)
  if (d[0] > 0) take((RX1 - o[0]) / d[0], [-1, 0, 0], 0.8, false); else if (d[0] < 0) take((RX0 - o[0]) / d[0], [1, 0, 0], 0.8, false);
  if (d[2] > 0) take((RZ1 - o[2]) / d[2], [0, 0, -1], 0.8, false); else if (d[2] < 0) take((RZ0 - o[2]) / d[2], [0, 0, 1], 0.8, true);
  if (d[1] < 0) take(-o[1] / d[1], [0, 1, 0], 0.7, false);
  if (best) {
    const b = best as Hit, p: V3 = [o[0] + d[0] * b.t, o[1] + d[1] * b.t, o[2] + d[2] * b.t];
    if (p[1] > RY1) best = null; // over the wall top: open sky, no return
    else if (b.n[0] === -1 && p[2] > -2.2 && p[2] < -0.6 && p[1] > 0.9 && p[1] < 2.3) best = null; // window: the beam leaves
    else if (b.n[0] === 1 && p[2] > 1.0 && p[2] < 2.0 && p[1] < 2.1) best = null; // open door
  }
  for (const bx of FURNITURE) {
    let t0 = -Infinity, t1 = Infinity, ax = 0, sg = 0;
    for (let i = 0; i < 3; i++) {
      if (Math.abs(d[i]!) < 1e-9) { if (o[i]! < bx.lo[i]! || o[i]! > bx.hi[i]!) { t0 = Infinity; break; } continue; }
      let a = (bx.lo[i]! - o[i]!) / d[i]!, c = (bx.hi[i]! - o[i]!) / d[i]!;
      let s = -1;
      if (a > c) { const tmp = a; a = c; c = tmp; s = 1; }
      if (a > t0) { t0 = a; ax = i; sg = s; }
      if (c < t1) t1 = c;
    }
    if (t0 < t1 && t0 > 1e-4) { const n: V3 = [0, 0, 0]; n[ax] = sg; take(t0, n, bx.refl, false); }
  }
  for (const c of PROPS) { const r = capHit(o, d, c); if (r) take(r.t, r.n, c.refl, false); }
  return best;
}

function rayFigures(o: V3, d: V3): Hit | null {
  let best: Hit | null = null;
  for (const c of FIGURES) { const r = capHit(o, d, c); if (r && (!best || r.t < best.t)) best = { t: r.t, n: r.n, refl: c.refl, wall: false }; }
  return best;
}

/** Ray vs capsule (a sphere when a == b); returns distance + normal (Quilez's capsule intersector). */
function capHit(ro: V3, rd: V3, c: Cap): { t: number; n: V3 } | null {
  const ba = sub(c.b, c.a), oa = sub(ro, c.a);
  const baba = dot(ba, ba), bard = dot(ba, rd), baoa = dot(ba, oa), rdoa = dot(rd, oa), oaoa = dot(oa, oa);
  const r = c.r;
  let t = -1;
  if (baba > 1e-9) {
    const a = baba - bard * bard, b = baba * rdoa - baoa * bard, cc = baba * oaoa - baoa * baoa - r * r * baba;
    const h = b * b - a * cc;
    if (h >= 0) {
      const tt = (-b - Math.sqrt(h)) / a, yy = baoa + tt * bard;
      if (yy > 0 && yy < baba) t = tt;
      else {
        const oc = yy <= 0 ? oa : sub(ro, c.b);
        const b2 = dot(rd, oc), c2 = dot(oc, oc) - r * r, h2 = b2 * b2 - c2;
        if (h2 > 0) t = -b2 - Math.sqrt(h2);
      }
    }
  } else {
    const b2 = dot(rd, oa), c2 = oaoa - r * r, h2 = b2 * b2 - c2;
    if (h2 > 0) t = -b2 - Math.sqrt(h2);
  }
  if (t <= 1e-4) return null;
  const p: V3 = [ro[0] + rd[0] * t, ro[1] + rd[1] * t, ro[2] + rd[2] * t];
  const pa = sub(p, c.a), hh = baba > 1e-9 ? clamp(dot(pa, ba) / baba, 0, 1) : 0;
  const n = sub(pa, [ba[0] * hh, ba[1] * hh, ba[2] * hh]);
  const l = Math.hypot(n[0], n[1], n[2]) || 1;
  return { t, n: [n[0] / l, n[1] / l, n[2] / l] };
}

/** Beam direction of a column (az01 0..1: the head starts at the left wall, turns across the back wall, right, front). */
function beamDir(ring: number, az01: number): V3 {
  const el = (ringElev(ring) * Math.PI) / 180, ph = -Math.PI / 2 + az01 * Math.PI * 2;
  return [Math.sin(ph) * Math.cos(el), Math.sin(el), -Math.cos(ph) * Math.cos(el)];
}

// ------------------------------------------------------------------ shaders
const VERT = /* glsl */ `
uniform vec3 uSensor;
uniform float uRev, uBeatDur, uT, uTFig, uLive, uKick, uFade, uNear, uFar, uMode, uPx, uPxMin, uPxMax, uSignOn;
uniform vec3 cSig, cHi, cMid, cDeep;
uniform sampler2D uMask;
attribute vec4 aFig;   // figure hit xyz, 1 if this column's beam hits a figure
attribute vec4 aInfo;  // ring, az01, intensity (room), intensity (figure)
attribute vec2 aUV;    // sign uv on the back wall (-1 when off the sign)
varying vec3 vCol;
varying float vA;
float h1(vec3 p) { return fract(sin(mod(p.x, 97.0) * 12.9898 + mod(p.y, 89.0) * 78.233 + mod(p.z, 61.0) * 37.719) * 43758.5453); }
void hide() { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; vA = 0.0; vCol = vec3(0.0); }
void main() {
  float ring = aInfo.x, az = aInfo.y;
  float since = uRev - az;                 // revolutions since this column was first swept
  if (since < 0.0) { hide(); return; }
  float age = fract(since), pass = floor(since);
  float tPass = uT - age * uBeatDur;
  float stride = pass < 0.5 ? 4.0 : (pass < 1.5 ? 2.0 : 1.0);   // ring banks come online pass by pass
  if (mod(ring, stride) > 0.5) { hide(); return; }
  bool fig = aFig.w > 0.5 && tPass >= uTFig;
  vec3 p = fig ? aFig.xyz : position;
  float I = fig ? aInfo.w : aInfo.z;
  if (I <= 0.0) { hide(); return; }
  float slot = floor(uT * 12.0);
  float col = floor(az * 1536.0 + 0.5);
  // dropout: a floor of lost returns, plus sector bursts on kicks
  float burst = step(h1(vec3(floor(az * 18.0), slot, 7.0)), uKick * 0.55);
  if (h1(vec3(ring, col, slot)) < 0.05 + burst * 0.7) { hide(); return; }
  vec3 dir = normalize(p - uSensor);
  p += dir * (h1(vec3(col, ring, slot + 3.0)) - 0.5) * (0.018 + burst * 0.12);   // range noise
  float fresh = exp(-age * uBeatDur / 0.085) * uLive;
  float m = (!fig && aUV.x >= 0.0) ? texture2D(uMask, aUV).a * uSignOn : 0.0;
  float lum = I * (0.3 + 1.5 * fresh);
  lum = mix(lum * (1.0 - 0.45 * uSignOn * step(0.0, aUV.x)), 0.95 + 2.2 * fresh, m);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float dcam = -mv.z;
  // depth code: near warm (signal) -> white -> far blue. Mode 0: range from the sensor; mode 1: from the camera.
  float dr = mix(distance(p, uSensor), dcam, uMode);
  float k = mix(smoothstep(1.4, 7.0, dr), smoothstep(uNear, uFar, dcam), uMode);
  vec3 c = k < 0.3 ? mix(cSig, cHi, k / 0.3) : (k < 0.6 ? mix(cHi, cMid, (k - 0.3) / 0.3) : mix(cMid, cDeep, (k - 0.6) / 0.4));
  c = mix(c, cHi, m * 0.85);
  // exit: the scanner has stopped, the returns die far to near
  float fk = clamp((dcam - uNear) / max(0.1, uFar - uNear), 0.0, 1.0);
  float alive = 1.0 - smoothstep(1.0 - uFade * 1.15, 1.08 - uFade * 1.15, fk);
  vCol = c * lum * alive;
  vA = alive;
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(uPx * (0.011 + 0.006 * m) / max(0.05, dcam), uPxMin, uPxMax) * (1.0 + 0.5 * fresh);
}`;
const FRAG = /* glsl */ `
varying vec3 vCol;
varying float vA;
void main() {
  vec2 q = gl_PointCoord - 0.5;
  float r = length(q);
  float a = smoothstep(0.5, 0.18, r);
  if (a <= 0.0 || vA <= 0.0) discard;
  gl_FragColor = vec4(vCol * a, 1.0);
}`;
const FLAT_VERT = /* glsl */ `
attribute float aK;
varying float vK;
void main() { vK = aK; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const FLAT_FRAG = /* glsl */ `
uniform vec3 uCol;
uniform float uA;
varying float vK;
void main() { gl_FragColor = vec4(uCol * uA * vK, 1.0); }`;
const CORE_VERT = /* glsl */ `
uniform float uSize;
void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = uSize / max(0.2, -mv.z); }`;
const CORE_FRAG = /* glsl */ `
uniform vec3 uCol;
uniform vec3 uHot;
void main() {
  float r = length(gl_PointCoord - 0.5);
  float core = smoothstep(0.16, 0.05, r), halo = smoothstep(0.5, 0.0, r);
  if (halo <= 0.0) discard;
  gl_FragColor = vec4(uHot * core * 2.5 + uCol * halo * halo * 0.9, 1.0);
}`;

// ------------------------------------------------------------------ cameras (per shot: from -> to over the shot)
type CamKey = { pos: V3; look: V3; fov: number };
const CAMS: Record<string, [CamKey, CamKey]> = {
  wide: [{ pos: [-0.5, 1.5, 4.2], look: [-0.5, 1.9, -3], fov: 62 }, { pos: [-0.4, 1.45, 3.5], look: [-0.45, 1.9, -3], fov: 62 }],
  top: [{ pos: [0.6, 7.6, 4.3], look: [-0.3, 0.2, -1.0], fov: 56 }, { pos: [-0.2, 7.3, 3.9], look: [-0.3, 0.25, -1.0], fov: 56 }],
  top2: [{ pos: [-3.6, 6.4, 3.6], look: [0.0, 0.3, -1.2], fov: 56 }, { pos: [-3.1, 6.1, 3.3], look: [0.0, 0.35, -1.2], fov: 56 }],
  side: [{ pos: [-3.9, 1.35, 1.6], look: [1.2, 1.35, -1.9], fov: 58 }, { pos: [-3.5, 1.3, 1.3], look: [1.25, 1.3, -1.9], fov: 58 }],
  side2: [{ pos: [4.1, 1.0, 1.9], look: [0.6, 1.4, -2.0], fov: 56 }, { pos: [3.8, 1.05, 1.6], look: [0.65, 1.4, -2.0], fov: 56 }],
  close: [{ pos: [1.05, 1.4, 0.55], look: [1.38, 1.15, -1.3], fov: 46 }, { pos: [1.1, 1.38, 0.3], look: [1.38, 1.15, -1.3], fov: 44 }],
};

export default class Lidar extends Scene {
  private plate!: PlateInfo;
  private list: Shot[] = [];
  private lines: Line[] = [];
  private P!: NamedPalette;
  private scene3 = new THREE.Scene();
  private cam = new THREE.PerspectiveCamera(60, 16 / 9, 0.05, 100);
  private mat!: THREE.ShaderMaterial;
  private fanMat!: THREE.ShaderMaterial;
  private coreMat!: THREE.ShaderMaterial;
  private fan!: THREE.LineSegments;
  private fanPos!: Float32Array;
  private fanK!: Float32Array;
  private hit0!: Float32Array; // per (ring, column): room hit xyz (NaN = no return)
  private hit1!: Float32Array; // per (ring, column): figure hit xyz (NaN = none)
  private mask!: Layer2D;

  override init() {
    this.plate = this.ctx.params as PlateInfo;
    this.P = palette(this.ctx.params.look?.palette ?? 'lidar');
    this.list = shots(this.plate, this.ctx.audio);
    this.lines = ownedLines(this.ctx);
    this.mask = new Layer2D(MASK_W, MASK_H, 1);

    // cast every beam once
    const n = RINGS * AZ;
    this.hit0 = new Float32Array(n * 3).fill(NaN);
    this.hit1 = new Float32Array(n * 3).fill(NaN);
    const pos: number[] = [], fig: number[] = [], info: number[] = [], uv: number[] = [];
    for (let r = 0; r < RINGS; r++) {
      const w = Math.pow(ringStep(r) / 0.74, 0.6); // dense rings return a little fainter each: even surface density
      for (let a = 0; a < AZ; a++) {
        const az = a / AZ, d = beamDir(r, az);
        const h0 = rayRoom(SENSOR, d), h1 = rayFigures(SENSOR, d);
        const fg = h1 && (!h0 || h1.t < h0.t) ? h1 : null;
        if (!h0 && !fg) continue;
        const inten = (h: Hit) => h.refl * (0.3 + 0.7 * Math.pow(Math.abs(dot(h.n, d)), 0.8)) * (1.0 / (1 + 0.04 * h.t * h.t) + 0.35);
        const p0: V3 = h0 ? [SENSOR[0] + d[0] * h0.t, SENSOR[1] + d[1] * h0.t, SENSOR[2] + d[2] * h0.t] : [0, 0, 0];
        const p1: V3 = fg ? [SENSOR[0] + d[0] * fg.t, SENSOR[1] + d[1] * fg.t, SENSOR[2] + d[2] * fg.t] : p0;
        const k = (r * AZ + a) * 3;
        if (h0) this.hit0.set(p0, k);
        if (fg) this.hit1.set(p1, k);
        pos.push(...(h0 ? p0 : p1));
        fig.push(p1[0], p1[1], p1[2], fg ? 1 : 0);
        info.push(r, az, h0 ? inten(h0) * w : 0, fg ? inten(fg) * w * 1.15 : 0);
        const onSign = h0 && h0.wall && p0[0] > SIGN.x0 && p0[0] < SIGN.x1 && p0[1] > SIGN.y0 && p0[1] < SIGN.y1;
        uv.push(onSign ? (p0[0] - SIGN.x0) / (SIGN.x1 - SIGN.x0) : -1, onSign ? (p0[1] - SIGN.y0) / (SIGN.y1 - SIGN.y0) : -1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aFig', new THREE.Float32BufferAttribute(fig, 4));
    g.setAttribute('aInfo', new THREE.Float32BufferAttribute(info, 4));
    g.setAttribute('aUV', new THREE.Float32BufferAttribute(uv, 2));
    const P = this.P, v3 = (c: [number, number, number]) => new THREE.Vector3(...c);
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uSensor: { value: v3(SENSOR) }, uRev: { value: 0 }, uBeatDur: { value: 0.58 }, uT: { value: 0 }, uTFig: { value: T_FIG },
        uLive: { value: 1 }, uKick: { value: 0 }, uFade: { value: 0 }, uNear: { value: 1 }, uFar: { value: 10 }, uMode: { value: 0 },
        uPx: { value: 1000 }, uPxMin: { value: 1 }, uPxMax: { value: 5 }, uSignOn: { value: 1 }, uMask: { value: this.mask.texture },
        cSig: { value: v3(plin(P, 'signal')) }, cHi: { value: v3(plin(P, 'hi')) }, cMid: { value: v3(plin(P, 'mid')) }, cDeep: { value: v3(plin(P, 'deep')) },
      },
      vertexShader: VERT, fragmentShader: FRAG,
      blending: THREE.AdditiveBlending, transparent: true, depthTest: false, depthWrite: false,
    });
    const pts = new THREE.Points(g, this.mat);
    pts.frustumCulled = false;
    this.scene3.add(pts);

    // the laser fan of the current column (faint), and the tripod
    this.fanPos = new Float32Array(RINGS * 2 * 3);
    this.fanK = new Float32Array(RINGS * 2);
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.BufferAttribute(this.fanPos, 3));
    fg.setAttribute('aK', new THREE.BufferAttribute(this.fanK, 1));
    this.fanMat = new THREE.ShaderMaterial({
      uniforms: { uCol: { value: v3(plin(P, 'signal')) }, uA: { value: 0.1 } }, vertexShader: FLAT_VERT, fragmentShader: FLAT_FRAG,
      blending: THREE.AdditiveBlending, transparent: true, depthTest: false, depthWrite: false,
    });
    this.fan = new THREE.LineSegments(fg, this.fanMat);
    this.fan.frustumCulled = false;
    this.scene3.add(this.fan);

    const legs: number[] = [], lk: number[] = [];
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.4;
      legs.push(SENSOR[0], SENSOR[1] - 0.12, SENSOR[2], SENSOR[0] + Math.cos(a) * 0.45, 0, SENSOR[2] + Math.sin(a) * 0.45);
      lk.push(1, 0.25);
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(legs, 3));
    lg.setAttribute('aK', new THREE.Float32BufferAttribute(lk, 1));
    const legMat = new THREE.ShaderMaterial({
      uniforms: { uCol: { value: v3(plin(P, 'mid')) }, uA: { value: 0.35 } }, vertexShader: FLAT_VERT, fragmentShader: FLAT_FRAG,
      blending: THREE.AdditiveBlending, transparent: true, depthTest: false, depthWrite: false,
    });
    const legObj = new THREE.LineSegments(lg, legMat);
    legObj.frustumCulled = false;
    this.scene3.add(legObj);

    const cg = new THREE.BufferGeometry();
    cg.setAttribute('position', new THREE.Float32BufferAttribute([...SENSOR], 3));
    this.coreMat = new THREE.ShaderMaterial({
      uniforms: { uCol: { value: v3(plin(P, 'signal')) }, uHot: { value: v3(plin(P, 'hi')) }, uSize: { value: 60 } },
      vertexShader: CORE_VERT, fragmentShader: CORE_FRAG,
      blending: THREE.AdditiveBlending, transparent: true, depthTest: false, depthWrite: false,
    });
    const core = new THREE.Points(cg, this.coreMat);
    core.frustumCulled = false;
    this.scene3.add(core);
  }

  /** The sign: line 10 drawn per syllable into the mask the returns read. */
  private drawMask(t: number) {
    const c = this.mask.ctx, P = this.P;
    this.mask.clear();
    for (const line of this.lines) {
      drawLyric(c, line, t, {
        x: MASK_W / 2, y: 168, size: 158, family: F.slam(), align: 'center', maxWidth: MASK_W - 60, unsungAlpha: 0.14, lead: 0.5,
        charTransform: (_ch, _i, s) => (s.sung ? { scale: 1 + 0.1 * Math.exp(-s.frac * 4) } : {}),
        drawChar: (cc, ch) => { cc.fillStyle = pcss(P, 'hi'); cc.fillText(ch, 0, 0); },
      });
    }
    this.mask.upload();
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, audio } = this.ctx;
    const t = f.t, P = this.P, pl = this.plate;
    const { shot, t0, t1 } = shotAt(this.list, t);
    const s = shot.s as { cam: string; scan: string };
    const u = clamp((t - t0) / Math.max(0.1, Math.min(t1, pl.end) - t0));

    // head rotation: one turn per beat (continuous through the beat grid); starts a third into a turn so frame one
    // already shows the swept left wall; stops for the exit
    const T_STOP = pl.end - 0.3;
    const tr = Math.min(t, T_STOP);
    const bi = beatIndex(audio, tr), b0 = audio.beats[bi] ?? pl.start, b1 = audio.beats[bi + 1] ?? b0 + 0.583;
    const startBeat = beatIndex(audio, pl.start + 1e-3);
    const beatDur = Math.max(0.2, b1 - b0);
    const rev = 0.34 + (bi - startBeat) + clamp((tr - b0) / beatDur, 0, 1.5);
    const live = t < T_STOP ? 1 : Math.exp(-(t - T_STOP) / 0.06);
    const fade = clamp((t - T_STOP) / (pl.end - T_STOP - 0.02));

    const kick = kickPulse(audio, t, 0.1), beat = beatPulse(audio, t, 0.1), db = downbeatPulse(audio, t, 0.18);

    // camera
    const [ca, cb] = CAMS[s.cam] ?? CAMS.wide!;
    const e = ease.inOutQuad(u);
    const cp = ca.pos.map((v, i) => lerp(v, cb.pos[i]!, e)) as V3;
    const cl = ca.look.map((v, i) => lerp(v, cb.look[i]!, e)) as V3;
    const jig = kick * 0.012; // the rig jolts with the kick
    this.cam.position.set(cp[0] + (hash(t * 60, 1) - 0.5) * jig, cp[1] + (hash(t * 60, 2) - 0.5) * jig, cp[2]);
    this.cam.fov = lerp(ca.fov, cb.fov, e);
    this.cam.aspect = 16 / 9;
    this.cam.lookAt(cl[0], cl[1], cl[2]);
    this.cam.updateProjectionMatrix();
    this.cam.updateMatrixWorld();

    // mask + uniforms
    this.drawMask(t);
    const sc = rtScale(out), H = out.height;
    const U = this.mat.uniforms;
    U.uRev!.value = rev; U.uBeatDur!.value = beatDur; U.uT!.value = t; U.uLive!.value = live; U.uKick!.value = kick;
    U.uFade!.value = fade;
    U.uMode!.value = s.scan === 'depth' ? 1 : 0;
    U.uNear!.value = s.scan === 'depth' ? 1.2 : 1.0;
    U.uFar!.value = s.scan === 'depth' ? 5.2 : 11;
    U.uPx!.value = H / (2 * Math.tan((this.cam.fov * Math.PI) / 360));
    U.uPxMin!.value = 1.1 * sc; U.uPxMax!.value = (s.cam === 'close' ? 7 : 4.5) * sc;
    U.uSignOn!.value = 1;

    // laser fan: the current column, rays from the head to their returns
    const col = Math.floor((((rev % 1) + 1) % 1) * AZ) % AZ;
    const figOn = t >= T_FIG;
    for (let r = 0; r < RINGS; r++) {
      const k = (r * AZ + col) * 3;
      let x = this.hit0[k]!, y = this.hit0[k + 1]!, z = this.hit0[k + 2]!;
      if (figOn && !Number.isNaN(this.hit1[k]!)) { x = this.hit1[k]!; y = this.hit1[k + 1]!; z = this.hit1[k + 2]!; }
      const ok = !Number.isNaN(x) && r % 3 === 0;
      const o = r * 6;
      this.fanPos[o] = SENSOR[0]; this.fanPos[o + 1] = SENSOR[1]; this.fanPos[o + 2] = SENSOR[2];
      this.fanPos[o + 3] = ok ? x : SENSOR[0]; this.fanPos[o + 4] = ok ? y : SENSOR[1]; this.fanPos[o + 5] = ok ? z : SENSOR[2];
      this.fanK[r * 2] = 0.2; this.fanK[r * 2 + 1] = 1;
    }
    (this.fan.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    this.fanMat.uniforms.uA!.value = (s.cam === 'close' ? 0.05 : 0.12) * live * (0.6 + 0.8 * beat);
    this.coreMat.uniforms.uSize!.value = (5 + 7 * beat) * (H / 1080) * 6 * (0.35 + 0.65 * live);

    clearRT(renderer, out, plin(P, 'ground'));
    renderer.setRenderTarget(out);
    renderer.render(this.scene3, this.cam);

    // hits (T2: shake <= 14 px, flare <= 2x, downbeat punch <= 1.06)
    const cut = Math.exp(-(t - t0) / 0.07);
    return {
      bloom: s.cam === 'close' ? 0.45 : 0.28, bloomThreshold: 0.9, bloomRadius: 0.6,
      flash: 0.1 * cut,
      zoom: 1 + 0.045 * db + 0.015 * beat,
      shake: [(hash(t * 60, 3) - 0.5) * 14 * kick, (hash(t * 60, 4) - 0.5) * 10 * kick],
      grain: 0.05, vignette: 0.35, ca: 0.8,
      fade: 0,
    };
  }

  override dispose() {
    this.scene3.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      (m.material as THREE.Material | undefined)?.dispose?.();
    });
    this.mask.texture.dispose();
  }
}
