// SHELL — the Dyson shell as a heavy machined object: an analytic sphere tiled with hex panels (engine/prim
// shell helpers), raytraced in one fragment pass: bevelled plates with bolts and grooves, seams, the point of
// light inside, light shafts through the gaps, lock pins with shock rings, clip-plane cutaways with a hatched
// section, an empty cradle where the point was, and a starfield. A Canvas2D layer on top carries the etched
// lyric, wrapped glyph by glyph onto the panel surface through the same camera.
// Variants (data/edit.json):
//   partial  (p17) half-built shell; per beat a blast of rays from a different gap (30° sweep), per downbeat
//            panels clamp shut with a jolt; inside looking out through a gap; a panel slams shut, black.
//   seal     (p30) failed capture: panels close like fingers around the point, line 31 is etched syllable by
//            syllable on the last panels, the point escapes through the last gap and the 'could not hold'
//            letters slip out after it; the gap slams, lock pins drive in per kick with shock rings; outside
//            sealed, inside (cutaway) empty.
//   whole    (p35) the complete sphere with a ratcheting equator collar (silhouette steps per beat, 1-frame
//            jolt), the equator cutaway with its section, the empty cradle; exit: the equator seam glows.
//   pullback (p38) close on the sealed sphere (seams signal per beat), wide starfield (a star goes out every
//            2 s, the rest flare on the kick), the extinguished stars' afterimages projected onto the shell
//            and draining into its seams; the sphere dissolves into lines.
import * as THREE from 'three';
import { Scene, type Frame, type PostOverrides } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { rgba } from '../engine/palette';
import { drawLyric, layoutLine, ownedLines, F, type LineLayout } from '../engine/lyric';
import { beatPulse, kickPulse, downbeatPulse, beatIndex, barIndex } from '../engine/beat';
import { shotAt, type PlateInfo, type Shot } from '../engine/shots';
import { SHELL_GLSL } from '../engine/prim';
import { clamp, hash, smoothstep, ease, lerp } from '../engine/util';
import type { Line } from '../engine/lyrics';
import { shots, type Cam } from './shell.shots';

// ------------------------------------------------------------------ small vector kit
type V = [number, number, number];
const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: V, s: number): V => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: V) => Math.hypot(a[0], a[1], a[2]);
const norm = (a: V): V => mul(a, 1 / Math.max(1e-9, len(a)));
const UP: V = [0, 1, 0];

// the shell's panel tiling (must match the GLSL): cube-sphere faces, CELLS hex units per half face
const CELLS = 2.5;
const gmod = (x: number, y: number) => x - y * Math.floor(x / y);
function cubeUV(n: V): [number, number, number] {
  const ax = n.map(Math.abs) as V;
  let u: number, v: number, f: number;
  if (ax[0] >= ax[1] && ax[0] >= ax[2]) { u = n[1] / ax[0]; v = n[2] / ax[0]; f = n[0] > 0 ? 0 : 1; }
  else if (ax[1] >= ax[2]) { u = n[0] / ax[1]; v = n[2] / ax[1]; f = n[1] > 0 ? 2 : 3; }
  else { u = n[0] / ax[2]; v = n[1] / ax[2]; f = n[2] > 0 ? 4 : 5; }
  const k = (4 / Math.PI) * CELLS;
  return [Math.atan(u) * k, Math.atan(v) * k, f];
}
function hexCentre(px: number, py: number): [number, number] {
  const sx = 1, sy = 1.7320508;
  const ax = gmod(px, sx) - 0.5 * sx, ay = gmod(py, sy) - 0.5 * sy;
  const bx = gmod(px - 0.5 * sx, sx) - 0.5 * sx, by = gmod(py - 0.5 * sy, sy) - 0.5 * sy;
  const [gx, gy] = ax * ax + ay * ay < bx * bx + by * by ? [ax, ay] : [bx, by];
  return [px - gx, py - gy];
}
function cubeDir(u: number, v: number, f: number): V {
  const a = Math.tan((u / CELLS) * (Math.PI / 4)), b = Math.tan((v / CELLS) * (Math.PI / 4));
  const d: V[] = [[1, a, b], [-1, a, b], [a, 1, b], [a, -1, b], [a, b, 1], [a, b, -1]];
  return norm(d[f]!);
}
/** The panel cell containing direction n: [cx, cy, face] and its centre direction. */
function cellOf(n: V) {
  const [u, v, f] = cubeUV(n);
  const [cx, cy] = hexCentre(u, v);
  return { cx, cy, f, dir: cubeDir(cx, cy, f) };
}

// ------------------------------------------------------------------ camera
interface CamS { ro: V; ta: V; f: number; roll: number }
interface Basis { ro: V; u: V; v: V; w: V; f: number }
function basis(c: CamS): Basis {
  const w = norm(sub(c.ta, c.ro));
  let u = norm(cross(w, UP));
  let v = cross(u, w);
  if (c.roll) {
    const cs = Math.cos(c.roll), sn = Math.sin(c.roll);
    const u2 = add(mul(u, cs), mul(v, sn)), v2 = sub(mul(v, cs), mul(u, sn));
    u = u2; v = v2;
  }
  return { ro: c.ro, u, v, w, f: c.f };
}
/** World -> logical screen px (and depth). */
function project(b: Basis, x: V) {
  const d = sub(x, b.ro);
  const z = dot(d, b.w);
  const zz = Math.max(1e-4, z);
  return { x: W / 2 + (dot(d, b.u) / zz) * b.f * (H / 2), y: H / 2 - (dot(d, b.v) / zz) * b.f * (H / 2), z };
}

// ------------------------------------------------------------------ GLSL
const MAXPINS = 24, MAXSTARS = 16, MAXAFT = 6;
const FRAG = /* glsl */ `
uniform vec2 uRes; uniform float uT;
uniform vec3 uRo, uU, uV, uW; uniform float uF;
uniform float uMode, uCover, uSoft;
uniform vec3 uGapDir, uGapCell; uniform float uGapOn, uGapOpen;
uniform vec3 uP; uniform float uPI;
uniform vec4 uRay; uniform float uSpill;
uniform vec4 uCut; uniform float uCutAmb;
uniform float uSeam, uSection, uLeak, uShowQ, uDissolve, uCradle, uStarFlare, uStarDen;
uniform vec2 uCollar;
uniform vec4 uPins[${MAXPINS}];
uniform vec4 uStars[${MAXSTARS}];
uniform vec4 uAft[${MAXAFT}];
${SHELL_GLSL}
const float CELLS = ${CELLS.toFixed(1)};
const vec3 KEY = vec3(-0.5547, 0.6276, 0.5454);

vec3 cubeDir(vec2 uv, float f) {
  vec2 a = tan(uv * (PI / 4.0));
  if (f < 0.5) return normalize(vec3(1.0, a.x, a.y));
  if (f < 1.5) return normalize(vec3(-1.0, a.x, a.y));
  if (f < 2.5) return normalize(vec3(a.x, 1.0, a.y));
  if (f < 3.5) return normalize(vec3(a.x, -1.0, a.y));
  if (f < 4.5) return normalize(vec3(a.x, a.y, 1.0));
  return normalize(vec3(a.x, a.y, -1.0));
}
// 0 = gap (panel not yet in place) .. 1 = panel closed
float closedAmt(vec2 c, float face) {
  if (uGapOn > 0.5 && abs(face - uGapCell.z) < 0.5 && length(c - uGapCell.xy) < 0.2) return 1.0 - uGapOpen;
  float h = cellHash(c, face);
  float rank = h;
  if (uMode > 0.5) {
    // fingers: the cells farthest from the last gap close first, the ring around the gap last
    vec3 cd = cubeDir(c / CELLS, face);
    rank = 1.0 - acos(clamp(dot(cd, uGapDir), -1.0, 1.0)) / PI + 0.1 * (h - 0.5);
  }
  return sat((uCover - rank) / uSoft);
}
struct Cell { vec2 g; vec2 c; float face; float k; float d; };
Cell cellAt(vec3 n) {
  Cell o; vec3 cu = cubeUV(n, CELLS); vec4 hc = hexCell(cu.xy);
  o.g = hc.xy; o.c = hc.zw; o.face = cu.z; o.k = closedAmt(o.c, o.face); o.d = hexDist(o.g);
  return o;
}
float plateMask(Cell c, float aa) { return smoothstep(aa, -aa, c.d - (0.5 * c.k - 0.024)); }

// ---- machined panel, outside face
vec3 metal(vec3 n, vec3 rd, Cell c, out float dq) {
  vec2 q = c.g / max(c.k, 0.05);
  dq = hexDist(q);
  float dif = max(dot(n, KEY), 0.0);
  float h = cellHash(c.c, c.face);
  vec3 base = mix(C_INK2, C_GRAPHITE, 0.38 + 0.22 * h);
  float brushed = 0.86 + 0.14 * hash12(vec2(floor(q.y * 150.0), c.face * 7.0 + h * 31.0));
  vec3 col = base * brushed * (0.10 + 1.0 * dif);
  float bev = smoothstep(0.35, 0.46, dq);
  vec2 gd = q / max(length(q), 1e-4);
  col += bev * dot(gd, vec2(-0.66, 0.75)) * 0.16 * C_BONE * (0.25 + dif);
  col *= 1.0 - 0.75 * exp(-pow((dq - 0.29) / 0.007, 2.0)) - 0.55 * exp(-pow((dq - 0.455) / 0.006, 2.0));
  // centre boss with a stamped index bar
  col *= 1.0 - 0.35 * smoothstep(0.07, 0.06, length(q)) * (1.0 - smoothstep(0.045, 0.04, length(q)));
  for (int i = 0; i < 6; i++) {
    float a = (float(i) + 0.5) * PI / 3.0;
    vec2 bp = 0.39 * vec2(cos(a), sin(a));
    float db = length(q - bp);
    float bm = smoothstep(0.03, 0.022, db);
    col *= 1.0 - 0.55 * smoothstep(0.048, 0.03, db) * (1.0 - bm);
    col = mix(col, C_BONE * (0.06 + 0.4 * dif) + C_GRAPHITE * 0.05, bm);
  }
  vec3 hv = normalize(KEY - rd);
  col += C_BONE * pow(max(dot(n, hv), 0.0), 56.0) * 0.6 * (1.0 - 0.5 * bev);
  col += C_GRAPHITE * 0.05 * pow(1.0 - max(dot(n, -rd), 0.0), 3.0);
  return col;
}
vec3 pinsFx(vec3 n, vec3 col) {
  for (int i = 0; i < ${MAXPINS}; i++) {
    vec4 pn = uPins[i];
    if (pn.w <= 0.0) continue;
    float d = length(n - pn.xyz);
    if (d > 1.2) continue;
    float age = uT - pn.w;
    const float r = 0.018;
    if (age < 0.0) {
      if (uShowQ < 0.5) continue;
      // queued pin standing proud of the seam: cast shadow + unlit head
      float sh = smoothstep(r * 2.0, r * 1.1, length(n - pn.xyz + vec3(0.016, -0.016, 0.0)));
      col *= 1.0 - 0.6 * sh;
      col = mix(col, C_GRAPHITE * 0.35, smoothstep(r, r * 0.8, d));
      col += C_BONE * 0.35 * exp(-pow((d - r * 0.85) / 0.002, 2.0));
    } else {
      float head = smoothstep(r, r * 0.8, d);
      col *= 1.0 - 0.7 * exp(-pow((d - r) / 0.004, 2.0));
      col = mix(col, C_GRAPHITE * 0.3 + C_BONE * 0.1 + C_SIGNAL * 5.0 * exp(-age * 6.0), head);
      float rr = r + age * 0.7;
      float ring = exp(-pow((d - rr) / (0.005 + age * 0.03), 2.0)) * exp(-age * 7.0);
      col += (C_EMBER * 1.5 + C_SIGNAL) * ring * 1.1;
    }
  }
  return col;
}
vec3 afterFx(vec3 n, float plate, float dq, vec3 col) {
  for (int j = 0; j < ${MAXAFT}; j++) {
    vec4 a = uAft[j];
    if (a.w <= 0.0) continue;
    float age = uT - a.w;
    if (age < 0.0) continue;
    float d = length(n - a.xyz);
    float rad = 0.13 + 0.05 * age;
    float fade = exp(-age * 0.3);
    float drain = smoothstep(0.2, 1.5, age);
    float spot = exp(-pow(d / rad, 2.0)) * fade;
    float onPanel = plate * spot * (1.0 - drain) * mix(1.0, smoothstep(0.2, 0.5, dq), drain);
    float onSeam = (1.0 - plate) * exp(-pow(d / (rad * 2.2), 2.0)) * fade * (0.3 + drain);
    col += C_EMBER * onPanel * 1.6 + C_SIGNAL * onSeam * 4.0;
    col += C_BONE * exp(-pow(d / 0.02, 2.0)) * exp(-age * 2.5) * 4.0 * plate;
  }
  return col;
}
// ---- panel backs, seen from inside
vec3 innerShade(vec3 x, Cell c, float plate) {
  vec3 n = -x;
  vec2 q = c.g / max(c.k, 0.05);
  float dq = hexDist(q);
  float rib = smoothstep(0.39, 0.44, dq) + 0.7 * exp(-pow(q.y / 0.018, 2.0)) * step(dq, 0.4)
            + 0.7 * exp(-pow(dot(q, vec2(0.866, 0.5)) / 0.018, 2.0)) * step(dq, 0.4);
  vec3 lp = uP - x;
  float d2 = dot(lp, lp);
  float lit = uPI * max(dot(n, normalize(lp)), 0.0) / (1.0 + 5.0 * d2);
  vec3 col = C_INK2 * (0.35 + 0.6 * rib) + C_SIGNAL * lit * (0.25 + 0.7 * rib);
  col += C_GRAPHITE * uCutAmb * (0.12 + 0.55 * rib) * (0.35 + 0.65 * max(dot(n, KEY), 0.0));
  vec3 seam = C_INK * 0.3 + C_SIGNAL * uLeak * 0.3;
  return mix(seam, col, plate);
}
vec3 stars(vec3 rd) {
  vec3 col = vec3(0.0);
  float pxr = 1.0 / (uF * 0.5 * uRes.y);
  vec3 cu = cubeUV(rd, 70.0);
  vec2 cell = floor(cu.xy), f = fract(cu.xy);
  float h = hash12(cell + cu.z * 131.7);
  float pc = pxr * 89.0;
  if (h > 0.9) {
    vec2 j = 0.2 + 0.6 * hash22(cell + cu.z * 7.1);
    float d = length(f - j);
    float b = (h - 0.9) / 0.1;
    float fl = 1.0 + uStarFlare * 0.4 * step(0.4, hash12(cell * 1.31 + 2.0));
    col += mix(C_BONE, C_EMBER, step(0.975, h)) * smoothstep(1.4 * pc, 0.2 * pc, d) * (0.35 + 1.4 * b) * fl;
  }
  col *= uStarDen;
  for (int i = 0; i < ${MAXSTARS}; i++) {
    vec4 s = uStars[i];
    if (s.w <= 0.0) continue;
    float d = length(rd - s.xyz);
    float alive = uT < s.w ? 1.0 + 0.4 * uStarFlare : 0.0;
    float pop = uT >= s.w ? exp(-(uT - s.w) * 7.0) * 2.5 : 0.0;
    col += (C_BONE * smoothstep(3.2 * pxr, 0.6 * pxr, d) * 1.8 + C_EMBER * exp(-d / (7.0 * pxr)) * 0.3) * (alive + pop);
  }
  return col;
}
vec2 raySeg(vec3 ro, vec3 rd, vec3 a, vec3 b) {
  vec3 ba = b - a, oa = ro - a;
  float baba = dot(ba, ba), bard = dot(ba, rd), baoa = dot(ba, oa), rdoa = dot(rd, oa);
  float t = (baoa * bard - rdoa * baba) / max(baba - bard * bard, 1e-6);
  float s = clamp((baoa + t * bard) / baba, 0.0, 1.0);
  vec3 pa = a + ba * s;
  t = max(dot(pa - ro, rd), 0.0);
  return vec2(length(ro + rd * t - pa), t);
}
// the empty cradle at the centre: three struts down to the wall, a socket ring, three claws holding nothing
vec4 cradle(vec3 ro, vec3 rd, float tO) {
  vec4 hit = vec4(0.0, 0.0, 0.0, tO);
  for (int i = 0; i < 6; i++) {
    float a = float(i % 3) * TAU / 3.0 + 0.4;
    vec3 A, B; float rad;
    if (i < 3) { A = vec3(0.075 * cos(a), -0.01, 0.075 * sin(a)); B = 0.97 * normalize(vec3(0.62 * cos(a), -0.78, 0.62 * sin(a))); rad = 0.013; }
    else { A = vec3(0.078 * cos(a), 0.0, 0.078 * sin(a)); B = vec3(0.035 * cos(a), 0.075, 0.035 * sin(a)); rad = 0.008; }
    vec2 q = raySeg(ro, rd, A, B);
    if (q.x < rad && q.y < hit.w && q.y > 0.0) {
      vec3 x = ro + rd * q.y;
      vec3 ax = normalize(B - A);
      vec3 nn = normalize((x - A) - ax * dot(x - A, ax));
      float dif = max(dot(nn, KEY), 0.0);
      hit = vec4(mix(C_INK2, C_GRAPHITE, 0.5) * (0.15 + 0.9 * dif) + C_BONE * pow(max(dot(nn, normalize(KEY - rd)), 0.0), 40.0) * 0.5, q.y);
    }
  }
  if (abs(rd.y) > 1e-4) {
    float tp = -ro.y / rd.y;
    vec3 x = ro + rd * tp;
    float r = length(x.xz);
    if (tp > 0.0 && tp < hit.w && r > 0.05 && r < 0.088) {
      float dif = abs(dot(vec3(0.0, sign(ro.y), 0.0), KEY));
      vec3 c = mix(C_GRAPHITE, C_BONE, 0.15) * (0.2 + 0.7 * dif);
      c *= 1.0 - 0.6 * exp(-pow((r - 0.069) / 0.003, 2.0));
      hit = vec4(c, tp);
    }
  }
  return hit;
}

void main() {
  vec2 fc = vUv * uRes;
  vec2 p = (fc - 0.5 * uRes) / (0.5 * uRes.y);
  vec3 ro = uRo, rd = normalize(p.x * uU + p.y * uV + uF * uW);
  float pxw = 1.0 / (uF * 0.5 * uRes.y);
  vec3 bg = stars(rd);
  vec3 col = bg;
  float tO = 1e9;
  bool inside = dot(ro, ro) < 1.0;
  bool cutOn = uCut.w > 0.5;
  vec3 cn = uCut.xyz;
  vec2 hs = raySphere(ro, rd, 1.0);
  if (hs.y > 0.0) {
    // what lies behind the front face: the inner surface of the far side (or the sky through a gap / the cut)
    vec3 back = bg; float tb = 1e9;
    vec3 xb = ro + rd * hs.y;
    if (!(cutOn && dot(xb, cn) > 0.0)) {
      Cell cb = cellAt(xb);
      float aab = pxw * hs.y * 3.2 * 1.5;
      float plb = plateMask(cb, aab);
      float opb = max(plb, step(0.9, cb.k));
      if (opb > 0.0) { back = mix(bg, innerShade(xb, cb, plb), opb); tb = hs.y; }
    }
    if (!inside && hs.x > 0.0) {
      vec3 x = ro + rd * hs.x;
      vec3 n = x;
      if (cutOn && dot(x, cn) > 0.0) { col = back; tO = tb; }
      else {
        Cell c = cellAt(n);
        float graze = 1.0 / max(dot(n, -rd), 0.15);
        float aa = pxw * hs.x * 3.2 * graze;
        float plate = plateMask(c, aa);
        float seam = step(0.9, c.k);
        float op = max(plate, seam);
        float dq = 0.0;
        vec3 s = metal(n, rd, c, dq);
        float leak = uLeak * (1.0 + 2.5 * exp(-pow((c.d - 0.49) / 0.012, 2.0)));
        vec3 sc = C_INK * 0.25 + C_SIGNAL * (leak + uSeam * 1.6) + C_EMBER * uSeam * 0.6 * exp(-pow((c.d - 0.49) / 0.01, 2.0));
        s = mix(sc, s, plate);
        s = pinsFx(n, s);
        s = afterFx(n, plate, dq, s);
        // dissolve into lines: the fill goes, the panel outlines stay
        vec3 lines = C_BONE * 0.9 * exp(-pow((c.d - 0.47) / (aa * 0.8 + 0.004), 2.0)) + C_INK * 0.4;
        s = mix(s, lines, uDissolve);
        col = mix(back, s, op);
        tO = op > 0.5 ? hs.x : tb;
      }
    } else {
      col = back; tO = tb;
    }
  }
  // cut section: the shell's wall sliced by the clip plane (skins + hatched core), its seam can glow
  if (cutOn) {
    float dn = dot(rd, cn);
    if (abs(dn) > 1e-4) {
      float tp = -dot(ro, cn) / dn;
      vec3 xp = ro + rd * tp;
      float r = length(xp);
      if (tp > 0.0 && tp < tO && r > 0.952 && r < 1.0) {
        float u = (1.0 - r) / 0.048;
        vec3 sc;
        if (u < 0.2 || u > 0.82) sc = mix(C_GRAPHITE, C_BONE, 0.3) * 0.75;
        else sc = mix(C_INK2, C_GRAPHITE * 0.8, step(0.5, fract(dot(xp, vec3(1.0, 1.0, 1.0)) * 70.0)) * 0.7);
        sc *= 1.0 - 0.7 * exp(-pow((u - 0.2) / 0.03, 2.0)) - 0.7 * exp(-pow((u - 0.82) / 0.03, 2.0));
        sc += C_SIGNAL * uSection * 5.0 * exp(-pow((u - 0.5) / 0.14, 2.0)) + C_EMBER * uSection * 2.0 * exp(-pow((u - 0.5) / 0.05, 2.0));
        col = sc; tO = tp;
      }
    }
  }
  // equator collar: a flange with lugs that ratchet round (the silhouette steps)
  if (uCollar.x > 0.5 && abs(rd.y) > 1e-4) {
    float tc = -ro.y / rd.y;
    vec3 xc = ro + rd * tc;
    float r = length(xc.xz);
    float a = atan(xc.z, xc.x);
    float lug = fract(a / TAU * 32.0 + uCollar.y);
    bool fl = r > 0.99 && r < 1.075, lg = r >= 1.075 && r < 1.16 && lug < 0.42;
    if (tc > 0.0 && tc < tO && (fl || lg)) {
      float dif = abs(dot(vec3(0.0, sign(ro.y), 0.0), KEY));
      vec3 cc = mix(C_INK2, C_GRAPHITE, 0.55) * (0.15 + 0.9 * dif);
      cc *= 1.0 - 0.7 * exp(-pow((r - 1.075) / 0.004, 2.0));
      cc += C_BONE * 0.25 * smoothstep(0.012, 0.008, length(vec2(r - 1.118, (lug - 0.21) * TAU * r / 32.0))) * dif;
      cc += C_SIGNAL * uSection * 3.0 * exp(-pow((r - 0.995) / 0.01, 2.0));
      col = cc; tO = tc;
    }
  }
  if (uCradle > 0.5) {
    vec4 cr = cradle(ro, rd, tO);
    if (cr.w < tO) { col = cr.rgb; tO = cr.w; }
  }
  // the point of light and the shafts it throws through the gaps
  if (uPI > 0.001) {
    float tc = clamp(dot(uP - ro, rd), 0.0, tO);
    float d = length(ro + rd * tc - uP);
    col += uPI * (C_BONE * exp(-d * d / 0.00015) * 5.0 + C_EMBER * exp(-d * 24.0) * 1.3 + C_SIGNAL * exp(-d * 10.0) * 0.15);
    if (dot(uP, uP) < 0.9) {
      vec2 hb = raySphere(ro, rd, 3.4);
      float a0 = max(hb.x, 0.0), a1 = min(hb.y, tO);
      if (a1 > a0) {
        const int N = 22;
        float dt = (a1 - a0) / float(N);
        float j = hash12(fc);
        float acc = 0.0;
        for (int i = 0; i < N; i++) {
          vec3 x = ro + rd * (a0 + (float(i) + j) * dt);
          float r = length(x);
          if (r < 1.0) { acc += 0.05 * exp(-length(x - uP) * 4.0); continue; }
          vec3 dir = normalize(x - uP);
          float b = dot(uP, dir), cc = dot(uP, uP) - 1.0;
          vec3 e = uP + dir * (-b + sqrt(max(b * b - cc, 0.0)));
          Cell c = cellAt(e);
          float open = c.d > 0.5 * c.k - 0.024 ? (c.k < 0.9 ? 1.0 : 0.03) : 0.0;
          float cone = uSpill + uRay.w * pow(max(dot(dir, uRay.xyz), 0.0), 14.0);
          acc += open * cone / (1.0 + 4.0 * (r - 1.0) * (r - 1.0));
        }
        col += (C_SIGNAL * 0.8 + C_EMBER * 0.2) * acc * dt * uPI * 0.22;
      }
    }
  }
  fragColor = vec4(max(col, 0.0), 1.0);
}
`;

// ------------------------------------------------------------------ scene
type Pin = { dir: V; t: number };

export default class Shell extends Scene {
  private pass!: FSPass;
  private layer!: Layer2D;
  private list: Shot[] = [];
  private plate!: PlateInfo;
  private lines: Line[] = [];
  private kicks: number[] = [];
  private beats: number[] = [];
  private lay: LineLayout | null = null;
  /** seal: the last gap and its cell; partial: the gap the camera looks through. */
  private G: V = [0, 0, 1];
  private gapCell = { cx: 0, cy: 0, f: 4, dir: [0, 0, 1] as V };
  private ring: Pin[] = [];
  private loose: Pin[] = [];
  private hero: { dir: V; te: number; sx: number; sy: number }[] = [];

  override init() {
    this.plate = this.ctx.params as PlateInfo;
    this.list = shots(this.plate, this.ctx.audio);
    this.lines = ownedLines(this.ctx);
    this.layer = new Layer2D();
    const au = this.ctx.audio, { start, end } = this.ctx;
    this.beats = au.beats.filter((b) => b >= start - 1e-3 && b < end);
    // kicks inside the plate, thinned to >= 90 ms apart (one pin per kick)
    for (const [t, s] of au.onsets.kick ?? []) {
      if (t < start || t >= end || s < 0.25) continue;
      if (this.kicks.length && t - this.kicks[this.kicks.length - 1]! < 0.09) continue;
      this.kicks.push(t);
    }
    const v = this.plate.variant;
    this.G = v === 'partial' ? norm([-0.36, 0.3, 0.88]) : norm([0.42, 0.3, 0.86]);
    this.gapCell = cellOf(this.G);
    this.G = this.gapCell.dir; // aim at the centre of the gap panel
    this.buildPins();
    this.buildStars();

    const u: Record<string, THREE.IUniform> = {
      uRes: { value: new THREE.Vector2(W, H) }, uT: { value: 0 },
      uRo: { value: new THREE.Vector3() }, uU: { value: new THREE.Vector3() }, uV: { value: new THREE.Vector3() }, uW: { value: new THREE.Vector3() }, uF: { value: 2 },
      uMode: { value: 0 }, uCover: { value: 1 }, uSoft: { value: 0.03 },
      uGapDir: { value: new THREE.Vector3(...this.G) }, uGapCell: { value: new THREE.Vector3(this.gapCell.cx, this.gapCell.cy, this.gapCell.f) },
      uGapOn: { value: 0 }, uGapOpen: { value: 0 },
      uP: { value: new THREE.Vector3() }, uPI: { value: 0 },
      uRay: { value: new THREE.Vector4(0, 0, 1, 0) }, uSpill: { value: 0 },
      uCut: { value: new THREE.Vector4(0, 1, 0, 0) }, uCutAmb: { value: 0 },
      uSeam: { value: 0 }, uSection: { value: 0 }, uLeak: { value: 0 }, uShowQ: { value: 0 }, uDissolve: { value: 0 }, uCradle: { value: 0 },
      uStarFlare: { value: 0 }, uStarDen: { value: 1 }, uCollar: { value: new THREE.Vector2() },
      uPins: { value: Array.from({ length: MAXPINS }, () => new THREE.Vector4()) },
      uStars: { value: Array.from({ length: MAXSTARS }, () => new THREE.Vector4()) },
      uAft: { value: Array.from({ length: MAXAFT }, () => new THREE.Vector4()) },
    };
    this.pass = new FSPass(FRAG, u);
  }

  private sb(i: number) {
    // the shot list's storyboard anchors, by camera name
    return this.list.find((s) => s.s.cam === (['fingers', 'etch', 'escape', 'pins', 'sealed'] as Cam[])[i])?.t ?? this.ctx.start;
  }

  /** seal: 18 lock pins on the seams around the last gap (driven one per kick from the pins shot), plus loose
   * pins on random seams for every other kick; whole: one lock per beat on a random visible panel seam. */
  private buildPins() {
    const v = this.plate.variant;
    const around = (centre: V, spread: number, i: number): V => {
      const t1 = norm(cross(centre, UP)), t2 = cross(t1, centre);
      const a = hash(i, 11) * Math.PI * 2, r = Math.sqrt(hash(i, 12)) * spread;
      const d = norm(add(centre, add(mul(t1, r * Math.cos(a)), mul(t2, r * Math.sin(a)))));
      // snap to the nearest seam corner of that cell
      const c = cellOf(d);
      const k = Math.floor(hash(i, 13) * 6), ang = ((k + 0.5) * Math.PI) / 3;
      return cubeDir(c.cx + 0.577 * Math.cos(ang), c.cy + 0.577 * Math.sin(ang), c.f);
    };
    if (v === 'seal') {
      const { cx, cy, f } = this.gapCell;
      const slots: [number, number][] = [];
      for (let k = 0; k < 6; k++) slots.push([0.577, ((k + 0.5) * Math.PI) / 3]);
      for (let k = 0; k < 6; k++) slots.push([0.5, (k * Math.PI) / 3]);
      for (let k = 0; k < 6; k++) slots.push([1.0, ((k + 0.5) * Math.PI) / 3]);
      const t0 = this.sb(3) - 0.02;
      const ringKicks = this.kicks.filter((k) => k >= t0);
      slots.forEach(([r, a], i) => {
        this.ring.push({ dir: cubeDir(cx + r * Math.cos(a), cy + r * Math.sin(a), f), t: ringKicks[i] ?? 1e6 });
      });
      this.kicks.forEach((k, i) => {
        if (k >= t0 && i - this.kicks.findIndex((x) => x >= t0) < slots.length) return;
        this.loose.push({ dir: around(norm(add(this.G, [-0.25, -0.15, 0.3])), 0.9, i), t: k });
      });
    } else if (v === 'whole') {
      this.beats.forEach((b, i) => this.loose.push({ dir: around(norm([0.35, 0.4, 0.85]), 0.8, i + 40), t: b }));
    } else if (v === 'partial') {
      this.beats.forEach((b, i) => this.loose.push({ dir: around(norm([0.2, 0.35, 0.9]), 0.8, i + 80), t: b }));
    }
  }

  /** pullback: 16 named stars placed in the wide shot's frame; one goes out every 2 s. */
  private buildStars() {
    if (this.plate.variant !== 'pullback') return;
    const b = basis(this.camera('wide', this.ctx.start));
    const pos: [number, number][] = [
      [-1.25, 0.55], [1.1, -0.45], [-0.62, -0.62], [0.72, 0.66], [1.5, 0.2], [-1.55, -0.2], [0.3, -0.78], [-0.28, 0.8],
      [1.38, 0.75], [-1.1, 0.12], [0.95, 0.05], [-0.9, -0.78], [1.62, -0.72], [-1.62, 0.78], [0.5, 0.42], [-0.45, 0.4],
    ];
    pos.forEach(([sx, sy], i) => {
      const dir = norm(add(add(mul(b.u, sx), mul(b.v, sy)), mul(b.w, b.f)));
      const te = i < 5 ? this.ctx.start + 1.0 + 2.0 * i : 1e6;
      this.hero.push({ dir, te, sx, sy });
    });
  }

  private camera(cam: Cam, t: number): CamS {
    const G = this.G, lt = t - this.ctx.start;
    const east = norm(cross(UP, G));
    switch (cam) {
      // partial
      case 'wideA': return { ro: [2.3 - 0.05 * lt, 1.05, 3.1], ta: [0, 0.05, 0], f: 2.25, roll: 0.06 };
      case 'wideB': return { ro: [-2.9, -0.95, 2.1 + 0.05 * lt], ta: [0.1, 0.1, 0], f: 2.9, roll: -0.12 };
      case 'inA': return { ro: add(mul(G, -0.45), [0.05 * Math.sin(lt), 0.1, 0]), ta: G, f: 1.25, roll: 0 };
      case 'inB': return { ro: [0.5, -0.45, -0.25], ta: add(G, [0.1, 0.05, 0]), f: 1.6, roll: 0.35 };
      case 'slamIn': return { ro: add(mul(G, 1.5), mul(east, 0.12)), ta: G, f: 1.8, roll: -0.08 };
      // seal
      case 'fingers': return { ro: mul(norm([-0.45, 0.2, 1.0]), 3.7 - 0.12 * lt), ta: [0.1, 0, 0], f: 2.7, roll: 0.04 };
      case 'etch': return { ro: add(mul(G, 1.42), add(mul(east, -0.2), [0, -0.12, 0])), ta: add(mul(G, 0.98), add(mul(east, -0.12), [0, -0.1, 0])), f: 1.7, roll: 0.05 };
      case 'escape': return { ro: add(mul(G, 1.62), add(mul(east, 0.5), [0, 0.08, 0])), ta: add(sub(mul(G, 1.02), mul(east, 0.3)), [0, 0.04, 0]), f: 1.6, roll: -0.08 };
      case 'slam': return { ro: add(mul(G, 1.9), [0, 0.05, 0]), ta: G, f: 1.9, roll: 0.12 };
      case 'pins': return { ro: add(mul(G, 1.4), [0, -0.06, 0]), ta: add(G, [0, -0.06, 0]), f: 1.55, roll: -0.04 };
      case 'pins2': return { ro: add(mul(G, 1.25), mul(east, 0.08)), ta: add(G, mul(east, 0.02)), f: 1.9, roll: 0.42 };
      case 'sealed': return { ro: [2.6, 0.9, 2.3], ta: [-0.12, 0, 0], f: 2.5, roll: 0 };
      // whole
      case 'ext': return { ro: [2.7 - 0.06 * lt, 1.35, 2.4], ta: [0, -0.05, 0], f: 3.0, roll: 0.05 };
      case 'extLow': return { ro: [-1.3, -0.32, 3.3], ta: [0, 0.05, 0], f: 3.0, roll: -0.16 };
      case 'cutSide': return { ro: [3.0, 1.9, 1.5], ta: [0, -0.1, 0], f: 2.45, roll: 0 };
      case 'cutSeam': return { ro: [1.45, 0.42, 0.85], ta: [0.86, -0.02, 0.42], f: 2.1, roll: 0.1 };
      case 'empty': return { ro: [0.55, 1.35, 0.95], ta: [0, -0.02, 0], f: 1.9, roll: 0 };
      case 'overhead': return { ro: [0.02, 3.7, 0.35], ta: [0, 0, 0], f: 2.3, roll: 0.3 };
      // pullback
      case 'close': return { ro: [1.05, 0.5, 1.85 - 0.03 * lt], ta: [0.25, 0.12, 0], f: 1.9, roll: 0.04 };
      case 'graze': return { ro: [-1.35, 0.1, 0.62], ta: [0.2, 0.25, -0.5], f: 2.0, roll: -0.2 };
      case 'wide': return { ro: [0, 0.3, 9.0 + 0.25 * (t - 207.3)], ta: [0, 0, 0], f: 2.4, roll: 0 };
      case 'screen': return { ro: [0, 0.2, 3.3], ta: [0, 0, 0], f: 2.35, roll: 0 };
    }
  }

  /** seal: where the point of light is. */
  private point(t: number): V {
    const t0 = this.sb(2) + 0.02, t1 = this.sb(2) + 0.45;
    if (t < t0) return [0, 0, 0];
    if (t < t1) return mul(this.G, ease.inOutCubic((t - t0) / (t1 - t0)));
    return this.outPath(t - t1);
  }
  private outPath(tau: number): V { return add(add(mul(this.G, 1 + 1.6 * tau), mul(norm(cross(UP, this.G)), -1.4 * tau)), [0, 0.5 * tau * tau, 0]); }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, audio: au } = this.ctx;
    const t = f.t, v = this.plate.variant;
    const { shot, t0: s0 } = shotAt(this.list, t);
    const st = shot.s, cam = st.cam as Cam, since = t - s0;
    const camS = this.camera(cam, t);
    const b = basis(camS);
    const u = this.pass.u;
    const set3 = (k: string, x: V) => (u[k]!.value as THREE.Vector3).set(x[0], x[1], x[2]);
    set3('uRo', b.ro); set3('uU', b.u); set3('uV', b.v); set3('uW', b.w);
    u.uF!.value = b.f; u.uT!.value = t;

    const bp = beatPulse(au, t, 0.14), kp = kickPulse(au, t, 0.1), dp = downbeatPulse(au, t, 0.12);
    const bi = beatIndex(au, t), lastBeat = au.beats[bi] ?? 0;
    // defaults: sealed complete sphere, no light inside
    let mode = 0, cover = 1.2, soft = 0.02, gapOn = 0, gapOpen = 0, P: V = [0, 0, 0], PI = 0;
    let ray: [number, number, number, number] = [0, 0, 1, 0], spill = 0, cut: [number, number, number, number] = [0, 1, 0, 0];
    let cutAmb = 0, seam = 0, section = 0, leak = 0, showQ = 0, dissolve = 0, cradle = 0, starFlare = kp, starDen = 1;
    let collar: [number, number] = [0, 0];
    let aft: [V, number][] = [];
    const post: PostOverrides = { bloom: 0, shake: [0, 0], zoom: 1, flash: 0, fade: 0 };
    const jolt = (amp: number, seed: number, k: number) => {
      post.shake = [amp * k * (hash(seed, 1) < 0.5 ? -1 : 1), amp * 0.6 * k * (hash(seed, 2) < 0.5 ? -1 : 1)];
    };

    if (v === 'partial') {
      const di = barIndex(au, t), dStart = au.downbeats.findIndex((d) => d >= this.ctx.start - 1e-3);
      const steps = Math.max(0, di - dStart), lastDown = au.downbeats[di] ?? 0;
      // per downbeat a few panels clamp shut (70 ms clamp)
      cover = 0.5 + 0.035 * (steps - 1 + clamp((t - lastDown) / 0.07));
      soft = 0.012; gapOn = 1; gapOpen = 1; PI = 2.6; spill = 0.28; leak = 0.25;
      // per beat the blast leaves through a different gap: its direction sweeps 30° per beat
      const a = (bi * Math.PI) / 6, ax = norm([0.2, 1, 0.15]);
      const b0 = norm([0.55, 0.35, 0.75]);
      const rot = add(add(mul(b0, Math.cos(a)), mul(cross(ax, b0), Math.sin(a))), mul(ax, dot(ax, b0) * (1 - Math.cos(a))));
      ray = [rot[0], rot[1], rot[2], 3.2 * beatPulse(au, t, 0.2)];
      if (cam === 'slamIn') {
        const k = clamp(since / 0.085);
        gapOpen = 1 - ease.outBack(k);
        PI = 2.6 * (1 - smoothstep(0.02, 0.1, since));
        post.zoom = 1 + 0.14 * Math.exp(-since / 0.12);
        jolt(22, 97, Math.exp(-since / 0.07));
        post.fade = smoothstep(this.ctx.end - 0.33, this.ctx.end - 0.02, t);
      } else {
        post.zoom = 1 + 0.07 * beatPulse(au, t, 0.1);
        if (t - lastDown < 0.25) jolt(18, di, Math.exp(-(t - lastDown) / 0.06));
      }
      post.flash = 0.1 * beatPulse(au, t, 0.06);
      post.bloom = 0.4; post.bloomThreshold = 0.95;
      this.setPins(t, this.loose.filter((p) => p.t <= t).slice(-6), []);
    } else if (v === 'seal') {
      mode = 1; gapOn = 1; soft = 0.05;
      const sb = [0, 1, 2, 3, 4].map((i) => this.sb(i));
      // fingers: the shell closes toward the last gap in steps, one per beat
      const nb = this.beats.filter((x) => x <= t).length;
      const lb = this.beats.filter((x) => x <= t).pop() ?? this.ctx.start;
      const stepped = nb - 1 + clamp((t - lb) / 0.08);
      cover = t >= sb[1]! ? 1.3 : Math.min(1.0, 0.6 + 0.1 * Math.max(0, stepped));
      const slamT = this.list.find((s) => s.s.cam === 'slam')?.t ?? sb[3]!;
      gapOpen = t < slamT ? 1 : 1 - ease.outBack(clamp((t - slamT) / 0.09));
      P = this.point(t);
      PI = 3.2 * (1 - smoothstep(slamT - 0.2, slamT + 0.4, t));
      const inside = len(P) < 0.95;
      leak = inside ? 0.35 + 0.4 * kp : 0;
      spill = inside ? 0.45 : 0;
      const ki = this.kicks.filter((k) => k <= t).length;
      const rd = norm([hash(ki, 3) - 0.3, hash(ki, 4) - 0.4, 0.8]);
      ray = [rd[0], rd[1], rd[2], inside ? 3.0 * kickPulse(au, t, 0.14) : 0];
      showQ = cam === 'pins' || cam === 'pins2' ? 1 : 0;
      this.setPins(t, this.loose.filter((p) => p.t <= t && t < sb[3]!).slice(-6), this.ring);
      if (cam === 'sealed') { cut = [1, 0, 0, 1]; cutAmb = 1; cradle = 1; PI = 0; }
      // hits
      post.bloom = inside || PI > 0.1 ? 0.45 : 0.3; post.bloomThreshold = 0.85;
      post.zoom = 1 + 0.06 * dp + 0.03 * bp;
      jolt(cam === 'pins' || cam === 'pins2' ? 12 : 7, ki, kickPulse(au, t, 0.05));
      if (cam === 'fingers') post.flash = 0.35 * Math.exp(-since / 0.12);
      if (cam === 'escape') post.zoom = (post.zoom ?? 1) * (1 + 0.1 * Math.exp(-since / 0.15));
      if (cam === 'slam') { post.zoom = 1 + 0.16 * Math.exp(-since / 0.1); jolt(26, 7, Math.exp(-since / 0.08)); post.flash = 0.2 * Math.exp(-since / 0.05); }
      if (cam === 'sealed') post.zoom = 1 + 0.08 * Math.exp(-since / 0.1);
      post.fade = smoothstep(this.ctx.end - 0.3, this.ctx.end - 0.02, t);
    } else if (v === 'whole') {
      // collar lugs ratchet half a lug per beat (the silhouette changes), 1-frame camera jolt on the beat
      const k = clamp((t - lastBeat) / 0.06);
      collar = [1, (bi + ease.outBack(k)) / 64];
      if (t - lastBeat < 1 / 60 + 1e-3) post.shake = [hash(bi, 5) < 0.5 ? -16 : 16, hash(bi, 6) < 0.5 ? -10 : 10];
      post.zoom = 1 + 0.05 * dp;
      this.setPins(t, this.loose.filter((p) => p.t <= t).slice(-6), []);
      if (st.cut) { cut = [0, 1, 0, 1]; cutAmb = 1; cradle = 1; }
      const exit = smoothstep(this.ctx.end - 0.9, this.ctx.end - 0.05, t);
      section = 0.12 * bp + 1.6 * exit;
      seam = 0.8 * exit;
      post.bloom = 0.2 + 0.6 * exit; post.bloomThreshold = 0.85;
    } else {
      // pullback
      seam = 0.14 + 1.3 * beatPulse(au, t, 0.16);
      starFlare = kickPulse(au, t, 0.1);
      post.shake = [3 * kp * (bi % 2 ? 1 : -1), 0];
      post.zoom = 1 + 0.015 * dp;
      post.bloom = 0.35; post.bloomThreshold = 0.8;
      if (cam === 'screen') {
        const sb = b;
        let k = 0;
        for (const h of this.hero) {
          if (h.te > this.ctx.end) continue;
          const n = norm(add(add(mul(sb.u, h.sx * 0.52), mul(sb.v, h.sy * 0.62)), mul(sb.w, -0.75)));
          aft.push([n, Math.max(h.te + 0.1, s0 + 0.2 + 0.4 * k)]);
          k++;
        }
      }
      dissolve = smoothstep(this.ctx.end - 0.85, this.ctx.end - 0.1, t);
      starDen = 1 - 0.8 * dissolve;
    }

    u.uMode!.value = mode; u.uCover!.value = cover; u.uSoft!.value = soft;
    u.uGapOn!.value = gapOn; u.uGapOpen!.value = gapOpen;
    set3('uP', P); u.uPI!.value = PI;
    (u.uRay!.value as THREE.Vector4).set(...ray); u.uSpill!.value = spill;
    (u.uCut!.value as THREE.Vector4).set(...cut); u.uCutAmb!.value = cutAmb;
    u.uSeam!.value = seam; u.uSection!.value = section; u.uLeak!.value = leak; u.uShowQ!.value = showQ;
    u.uDissolve!.value = dissolve; u.uCradle!.value = cradle; u.uStarFlare!.value = starFlare; u.uStarDen!.value = starDen;
    (u.uCollar!.value as THREE.Vector2).set(...collar);
    const stars = u.uStars!.value as THREE.Vector4[];
    for (let i = 0; i < MAXSTARS; i++) {
      const h = this.hero[i];
      if (h) stars[i]!.set(h.dir[0], h.dir[1], h.dir[2], h.te); else stars[i]!.set(0, 0, 0, 0);
    }
    const av = u.uAft!.value as THREE.Vector4[];
    for (let i = 0; i < MAXAFT; i++) {
      const a = aft[i];
      if (a) av[i]!.set(a[0][0], a[0][1], a[0][2], a[1]); else av[i]!.set(0, 0, 0, 0);
    }
    this.pass.render(renderer, out);

    // ---- the etched lyric (seal): drawn over the shader through the same camera, glyph by glyph on the shell
    const L = this.layer, c = L.ctx;
    L.clear();
    if (this.lines.length) this.drawEtch(c, t, cam, b);
    L.upload();
    this.ctx.comp.draw(renderer, L.texture, out, { mode: 'normal' });
    return post;
  }

  private setPins(_t: number, loose: Pin[], ring: Pin[]) {
    const pv = this.pass.u.uPins!.value as THREE.Vector4[];
    const all = [...ring, ...loose].slice(0, MAXPINS);
    for (let i = 0; i < MAXPINS; i++) {
      const p = all[i];
      if (p) pv[i]!.set(p.dir[0], p.dir[1], p.dir[2], p.t); else pv[i]!.set(0, 0, 0, 0);
    }
  }

  /** Line 31 engraved on the panels: each glyph sits on the sphere (great-circle wrap from an anchor), hot
   * when its syllable is sung, cooling to bone; the 'could not hold' words slip out through the last gap. */
  private drawEtch(c: CanvasRenderingContext2D, t: number, cam: Cam, b: Basis) {
    const line = this.lines[0]!;
    const SIZE = 100;
    if (!this.lay) this.lay = layoutLine(c, line, F.slam(), SIZE);
    const lay = this.lay;
    const wc = (i: number) => { const w = lay.words[Math.min(i, lay.words.length - 1)]!; return w.x + w.w / 2; };
    const span = (i: number, j: number) => (lay.words[i]!.x + lay.words[j]!.x + lay.words[j]!.w) / 2;
    const G = this.G, east = norm(cross(UP, G));
    const sb = [0, 1, 2, 3, 4].map((i) => this.sb(i));
    // anchor per shot: a direction on the shell, the text position that sits on it, radians per text px
    let A: V, uA: number, sc: number;
    switch (cam) {
      case 'fingers': A = norm([-0.52, -0.3, 1]); uA = span(0, 1); sc = 0.0019; break;
      case 'etch': A = norm(add(G, add(mul(east, -0.14), [0, -0.13, 0]))); uA = wc(2); sc = 0.001; break;
      case 'escape': A = norm(add(G, add(mul(east, -0.1), [0, -0.2, 0]))); uA = wc(3); sc = 0.0016; break;
      case 'slam': A = norm(add(G, [0, -0.22, 0])); uA = wc(4); sc = 0.0011; break;
      case 'pins': A = norm(add(G, [0, -0.12, 0])); uA = wc(4); sc = 0.00056; break;
      case 'pins2': {
        A = norm(add(G, [0, -0.09, 0]));
        const w4 = lay.words[4]!, w5 = lay.words[5]!;
        const p = smoothstep(line.words[4]!.start, line.words[5]!.end, t);
        uA = lerp(w4.x + w4.w * 0.3, w5.x + w5.w * 0.5, p); sc = 0.00048; break;
      }
      default: A = norm([-0.2, 0.02, 1]); uA = span(4, 5); sc = 0.0016; break;
    }
    const T = norm(cross(UP, A));
    const onShell = (uu: number): V => { const th = (uu - uA) * sc; return mul(add(mul(A, Math.cos(th)), mul(T, Math.sin(th))), 1.004); };
    const slipSet = new Set([2, 3]);
    const gapS = project(b, G);
    let slipK = 0;
    const slipOrder = new Map<number, number>();
    lay.chars.forEach((ch) => { if (slipSet.has(ch.word)) slipOrder.set(ch.index, slipK++); });
    const cutOn = cam === 'sealed';

    drawLyric(c, line, t, {
      x: 0, y: 0, size: SIZE, family: F.slam(), align: 'left',
      sungColor: 'bone', unsungColor: 'graphite', unsungAlpha: 0.55, lead: 0.3,
      charTransform: (_ch, idx, s) => {
        const cxT = s.box.x + s.box.w / 2;
        const X = onShell(cxT), X2 = onShell(cxT + 4);
        const P1 = project(b, X), P2 = project(b, X2);
        const facing = dot(X, norm(sub(b.ro, X)));
        let alpha = smoothstep(0.04, 0.3, facing) * (P1.z > 0.05 ? 1 : 0);
        if (cutOn && X[0] > 0) alpha = 0;
        let x = P1.x, y = P1.y;
        let rot = Math.atan2(P2.y - P1.y, P2.x - P1.x);
        let scale = Math.hypot(P2.x - P1.x, P2.y - P1.y) / 4;
        // the words that could not hold: after the escape they slide into the last gap and out after the point
        const k = slipOrder.get(idx);
        if (k !== undefined && t >= sb[2]!) {
          const w = line.words[s.word]!, syl = (w.syl ?? [[w.start, w.end]])[s.syl]!;
          const ts = Math.max(sb[2]! + 0.08 * k, syl[0] + 0.18);
          const age = t - ts;
          if (age > 0) {
            const a1 = clamp(age / 0.35);
            if (age < 0.35) {
              const e = ease.inCubic(a1);
              x = lerp(x, gapS.x, e); y = lerp(y, gapS.y, e); scale *= 1 - 0.1 * e;
            } else {
              const q = project(b, this.outPath((age - 0.35) * 0.9));
              x = q.x; y = q.y; scale *= 0.95 * (1 - 0.3 * clamp(age - 0.35));
              rot += (age - 0.35) * (hash(idx, 9) - 0.5) * 4;
            }
            alpha = 1 - smoothstep(0.7, 1.5, age);
          }
        }
        return { dx: x - cxT, dy: y + SIZE * 0.35, rot, scale, alpha };
      },
      drawChar: (cc, ch, s) => {
        if (!s.sung) {
          cc.lineWidth = 2.2;
          cc.strokeStyle = rgba('graphite', 1);
          cc.strokeText(ch, 0, 0);
          return;
        }
        const w = line.words[s.word]!, syl = (w.syl ?? [[w.start, w.end]])[s.syl]!;
        const heat = 1 - smoothstep(syl[0], syl[0] + 1.1, t);
        // the groove: a dark offset under the cut, then the cut metal, then the hot etch on top
        cc.fillStyle = rgba('ink', 0.9);
        cc.fillText(ch, 3, 4);
        cc.fillStyle = rgba('bone', 1);
        cc.fillText(ch, 0, 0);
        if (heat > 0.01) {
          cc.shadowColor = rgba('signal', heat);
          cc.shadowBlur = 26 * heat;
          cc.fillStyle = rgba('ember', heat);
          cc.fillText(ch, 0, 0);
          cc.shadowBlur = 0;
        }
      },
    });
  }

  override dispose() { this.layer?.texture.dispose(); this.pass?.mat.dispose(); }
}
