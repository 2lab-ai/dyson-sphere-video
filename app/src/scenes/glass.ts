// GLASS — H5 stained glass (Chartres / Harry Clarke: transmitted jewel light, thick lead cames, seeded glass).
// One plate, p35-glass-rose (religion, the Middle Ages): a dark nave; a rose window on the west wall lights up
// ring by ring from the centre outward, one ring per beat, and within each ring pane by pane (a clockwise sweep that
// starts ON the beat). The sun behind the glass throws the window's own image through the dust as coloured shafts
// and pools it on the stone floor: pools and shafts are the rose re-projected along the light, so every pane that
// lights on the beat lands on the floor and in the air in the same instant.
//   Rose     six rings: oculus (4 panes + a centre roundel), 8 vesica petals, 16 lancets with pointed heads and a
//            saddle bar, 16 roundels between them, 32 cusps at the rim, 48 border quarries. Stone tracery (rings and
//            spokes) is the structure; the background glass of every sector is cut by Voronoi lead cames.
//            A piece's colour, brightness and lighting onset are keyed to the piece (ring, sector, motif, cell),
//            never to the pixel — so each piece switches on whole, like glass.
//   Beat     beats 1–6: one ring lights per beat (pane-by-pane sweep); every beat also surges the sun behind the
//            glass (the shafts, the pool and the panes flare together); beat 7 (macro): the whole rose surges;
//            beat 8: the light turns to heat — amber and white-hot panes, the lead glowing ember, cobalt still left.
//   Shots    (./glass.shots) wide nave -> down at the floor pool -> up at the rose, ablaze -> macro on the panes.
// Rendering: one fragment shader (ray vs. the wall z = 0 and the floor y = 0, plus a 20-step march for the shafts
// with a cheap piece lookup — no Voronoi inside the march). Colours only from the `glass` palette (uniforms).
import * as THREE from 'three';
import { Scene, type Frame, type PostOverrides } from '../engine/scene';
import { FSPass, clearRT } from '../engine/gl';
import { palette, plin, type NamedPalette } from '../engine/palette';
import { beatPulse, downbeatPulse, kickPulse } from '../engine/beat';
import { shotAt, type PlateInfo, type Shot } from '../engine/shots';
import { clamp, smoothstep } from '../engine/util';
import { shots, type Cam } from './glass.shots';

/** Window centre (world metres) and radius of one window unit. */
const WC: [number, number, number] = [0, 11, 0];
const WR = 4.2;
/** Direction the sunlight travels through the window, into the nave (down, to the right, toward the camera). */
const LDIR = new THREE.Vector3(0.3, -0.9, 1).normalize();

export const GLASS_FRAG = /* glsl */ `
uniform vec2 uRes;
uniform float uT, uLt, uFocal, uSun, uSurge, uHeat, uGlow, uShaft, uWall;
uniform vec3 uPos, uFwd, uRight, uUp, uL, uWC;
uniform vec2 uSunQ;
uniform float uRing[6];
uniform float uThermal, uMach, uMachX, uSquare;
uniform vec3 uGround, uDeep, cPalMid, uHi, uText, uSignal;

const float WR = ${WR.toFixed(2)};
const float RB0 = 0.17, RB1 = 0.40, RB2 = 0.66, RB3 = 0.86, RB4 = 1.0, RB5 = 1.1, RF = 1.26;
const float VCELL = 0.075;   // Voronoi cell (window units)
const float SWEEP = 0.16;    // seconds for the pane-by-pane sweep around one ring

float vn3(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = mix(hash13(i), hash13(i + vec3(1.0, 0.0, 0.0)), f.x);
  float b = mix(hash13(i + vec3(0.0, 1.0, 0.0)), hash13(i + vec3(1.0, 1.0, 0.0)), f.x);
  float c = mix(hash13(i + vec3(0.0, 0.0, 1.0)), hash13(i + vec3(1.0, 0.0, 1.0)), f.x);
  float d = mix(hash13(i + vec3(0.0, 1.0, 1.0)), hash13(i + vec3(1.0, 1.0, 1.0)), f.x);
  return mix(mix(a, b, f.y), mix(c, d, f.y), f.z);
}

// One piece of the rose at window coords q (units of WR). ring: 0..5 glass, 6 stone frame, -1 wall.
// stoneD: distance to the stone tracery (rings/spokes); leadD: distance to the nearest lead came.
struct Pc { float ring; float sec; float n; float motif; float cls; float h; float stoneD; float leadD; };

Pc piece(vec2 q, bool detail) {
  Pc o;
  o.ring = -1.0; o.sec = 0.0; o.n = 1.0; o.motif = 0.0; o.cls = 0.0; o.h = 0.0; o.stoneD = -1.0; o.leadD = 1.0;
  float r = length(q);
  if (r >= RB5) { o.ring = r < RF ? 6.0 : -1.0; return o; }
  float ang = atan(q.x, q.y);
  if (ang < 0.0) ang += TAU;
  float ri, ro, off;
  if (r < RB0) { o.ring = 0.0; ri = -1.0; ro = RB0; o.n = 4.0; off = 0.5; }
  else if (r < RB1) { o.ring = 1.0; ri = RB0; ro = RB1; o.n = 8.0; off = 0.0; }
  else if (r < RB2) { o.ring = 2.0; ri = RB1; ro = RB2; o.n = 16.0; off = 0.0; }
  else if (r < RB3) { o.ring = 3.0; ri = RB2; ro = RB3; o.n = 16.0; off = 0.5; }
  else if (r < RB4) { o.ring = 4.0; ri = RB3; ro = RB4; o.n = 32.0; off = 0.0; }
  else { o.ring = 5.0; ri = RB4; ro = RB5; o.n = 48.0; off = 0.0; }
  float s = TAU / o.n;
  float k = floor(ang / s - off + 0.5);
  float da = ang - (k + off) * s;
  o.sec = mod(k, o.n);
  float u = r * sin(da), v = r * cos(da);
  float dRing = o.ring < 0.5 ? ro - r : min(r - ri, ro - r);
  float dSpoke = r * sin(max(s * 0.5 - abs(da), 0.0));
  // stone: the ring circles everywhere, the spokes in rings 1..4 (ring 0's cross and ring 5's joints are lead)
  o.stoneD = (o.ring > 0.5 && o.ring < 4.5) ? min(dRing, dSpoke) : dRing;
  float dm;
  float au = abs(u);
  if (o.ring < 0.5) dm = r - 0.065;
  else if (o.ring < 1.5) dm = max(length(vec2(u - 0.05, v - 0.29)), length(vec2(u + 0.05, v - 0.29))) - 0.13;
  else if (o.ring < 2.5) dm = max(v < 0.56 ? au - 0.065 : length(vec2(au + 0.0108, v - 0.56)) - 0.0758, 0.435 - v);
  else if (o.ring < 3.5) dm = length(vec2(u, v - 0.76)) - 0.072;
  else if (o.ring < 4.5) dm = length(vec2(u, v - 1.0)) - 0.075;
  else dm = mod(o.sec, 2.0) < 0.5 ? -1.0 : 1.0;
  o.motif = dm < 0.0 ? 1.0 : 0.0;
  float lead = o.ring > 4.5 ? dSpoke : abs(dm);
  if (o.ring < 0.5) lead = min(lead, dSpoke);
  if (o.ring > 1.5 && o.ring < 2.5 && dm < 0.0) lead = min(lead, abs(v - 0.50));
  if (o.ring > 2.5 && o.ring < 3.5) lead = min(lead, abs(length(vec2(u, v - 0.76)) - 0.03));
  float cell = 0.0;
  if (detail && o.motif < 0.5 && o.ring > 0.5 && o.ring < 4.5) {
    vec2 gp = q / VCELL, ip = floor(gp), fp = fract(gp);
    float f1 = 9.0, f2 = 9.0;
    vec2 c1 = ip;
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
      vec2 oc = vec2(float(i), float(j));
      vec2 pt = oc + 0.15 + 0.7 * hash22(ip + oc);
      float d = length(pt - fp);
      if (d < f1) { f2 = f1; f1 = d; c1 = ip + oc; } else if (d < f2) { f2 = d; }
    }
    lead = min(lead, 0.5 * (f2 - f1) * VCELL);
    cell = hash12(c1 * 1.37 + 5.1);
  }
  o.h = hash12(vec2(o.ring * 37.0 + o.sec, o.motif * 11.0 + cell * 97.0));
  o.leadD = lead;
  // colour class: 0 cobalt, 1 ruby, 2 amber, 3 emerald
  float h = o.h, m = o.motif, e = mod(o.sec, 2.0);
  if (o.ring < 0.5) o.cls = m > 0.5 ? 2.0 : 1.0;
  else if (o.ring < 1.5) o.cls = m > 0.5 ? (e < 0.5 ? 1.0 : 2.0) : (h < 0.8 ? 0.0 : 3.0);
  else if (o.ring < 2.5) o.cls = m > 0.5 ? (e < 0.5 ? 1.0 : 3.0) : (h < 0.72 ? 0.0 : h < 0.85 ? 1.0 : 2.0);
  else if (o.ring < 3.5) o.cls = m > 0.5 ? (e < 0.5 ? 2.0 : 1.0) : (h < 0.85 ? 0.0 : 3.0);
  else if (o.ring < 4.5) o.cls = m > 0.5 ? 1.0 : (h < 0.7 ? 0.0 : 3.0);
  else o.cls = mod(o.sec, 3.0) < 0.5 ? 2.0 : mod(o.sec, 3.0) < 1.5 ? 3.0 : 1.0;
  return o;
}

// limestone: a grey albedo with a little of the amber in it (so coloured light keeps its colour on the stone)
vec3 stoneAlb() { return mix(vec3(0.32), uHi * 0.45, 0.2); }

// transmitted colour of a piece, luminance-normalised (cobalt is dark in linear, so it gets the largest gain)
vec3 jewel(float cls) {
  return cls < 0.5 ? uDeep * 3.2 : cls < 1.5 ? cPalMid * 2.3 : cls < 2.5 ? uHi * 1.4 : uText * 2.4;
}

// 0 before the piece's onset; on the onset a fast rise and a flash that settles to 1
float lit(Pc pc) {
  int ri = int(pc.ring + 0.5);
  float on = uRing[ri] + pc.sec / pc.n * SWEEP + pc.h * 0.03;
  float x = uLt - on;
  if (x < 0.0) return 0.0;
  return sat(x / 0.035) * (1.0 + 1.1 * exp(-x / 0.12));
}

// the light a piece passes (what reaches the air and the floor)
vec3 passed(Pc pc) {
  vec3 c = jewel(pc.cls);
  // heat: amber and white-hot, the ruby goes ember; the cobalt stays (the lattice still reads as glass)
  vec3 hot = pc.h < 0.5 ? uSignal * 1.6 : uHi * 2.1;
  float hk = uHeat * (pc.cls < 0.5 ? 0.0 : 0.9);
  c = mix(c, hot, hk);
  return c * lit(pc) * (0.62 + 0.6 * pc.h) * uSun * (1.0 + uSurge);
}

// p36 thermal: machines passing BEHIND the glass (window-plane coords, q in window radii) — a gear train, then a loco
float gearM(vec2 p, float r, float teeth, float rot) {
  float a = atan(p.y, p.x) + rot, d = length(p);
  float rr = r * (0.82 + 0.18 * step(0.0, sin(a * teeth)));
  return step(d, rr) * step(r * 0.28, d) + step(d, r * 0.12);
}
float boxM(vec2 p, vec2 c, vec2 h) { vec2 d = abs(p - c) - h; return step(max(d.x, d.y), 0.0); }
float machine(vec2 q) {
  float x = q.x - uMachX;
  // gears: two meshed wheels counter-rotating as they slide across
  float g = max(gearM(vec2(x + 0.55, q.y + 0.1), 0.42, 12.0, uMachX * 3.0), gearM(vec2(x + 1.3, q.y - 0.42), 0.3, 9.0, -uMachX * 4.2));
  // the locomotive, a gear-length behind: boiler, cab, chimney, wheels
  float lx = x + 3.2;
  float l = max(boxM(vec2(lx, q.y), vec2(0.0, -0.05), vec2(0.62, 0.2)), boxM(vec2(lx, q.y), vec2(-0.5, 0.18), vec2(0.2, 0.24)));
  l = max(l, boxM(vec2(lx, q.y), vec2(0.42, 0.28), vec2(0.07, 0.14)));
  for (int i = 0; i < 3; i++) l = max(l, gearM(vec2(lx + 0.45 - 0.42 * float(i), q.y + 0.34), 0.16, 8.0, uMachX * 6.0));
  return max(g, l);
}
// ironbow: luminance through the thermal palette (ground → deep → mid → hi → text)
vec3 ironbow(vec3 c) {
  float x = clamp(pow((0.299 * c.r + 0.587 * c.g + 0.114 * c.b) * 1.6, 0.7), 0.0, 1.0) * 4.0;
  vec3 a = mix(uGround, uDeep, clamp(x, 0.0, 1.0));
  a = mix(a, cPalMid, clamp(x - 1.0, 0.0, 1.0));
  a = mix(a, uHi, clamp(x - 2.0, 0.0, 1.0));
  return mix(a, uText, clamp(x - 3.0, 0.0, 1.0));
}

// the rose seen from inside the nave
vec3 shadeWindow(vec2 q, float pxq) {
  Pc pc = piece(q, true);
  vec3 sa = stoneAlb();
  if (pc.ring > 5.5) {
    // the stone frame: roll mouldings, lit by the glass beside it
    float rr = (length(q) - RB5) / (RF - RB5);
    float roll = 0.55 + 0.45 * sin(rr * 3.0 * TAU);
    return sa * (0.02 + 0.16 * uGlow * (1.0 - rr)) * roll;
  }
  float LW = max(0.0075, 1.5 * pxq), SW = max(0.016, 2.0 * pxq);
  float stoneM = smoothstep(SW - pxq, SW + pxq, pc.stoneD);
  float leadM = smoothstep(LW - pxq, LW + pxq, pc.leadD);
  // glass texture: streaks along a per-piece direction, seeds (bubbles), refraction of the sun behind
  float ang = pc.h * TAU;
  vec2 dir = vec2(cos(ang), sin(ang));
  vec2 sq = vec2(dot(q, dir), dot(q, vec2(-dir.y, dir.x)));
  float streak = vn3(vec3(sq.x * 9.0, sq.y * 80.0, pc.h * 31.0));
  vec2 bq = q / 0.014;
  vec2 bc = floor(bq);
  float bh = hash12(bc + pc.h * 7.0);
  float bd = length(fract(bq) - 0.5 - (hash22(bc) - 0.5) * 0.5);
  float seed = bh > 0.9 ? 1.0 - smoothstep(0.12, 0.22, bd) : 0.0;
  vec2 nrm = vec2(vn3(vec3(q * 26.0, 3.0)), vn3(vec3(q * 26.0, 9.0))) - 0.5;
  vec2 sd = q + nrm * 0.12 - uSunQ;
  float hot = exp(-dot(sd, sd) / 0.06);
  vec3 glass = passed(pc) * (0.72 + 0.5 * streak) * (1.0 + 1.3 * hot) * (1.0 - 0.45 * seed) + jewel(pc.cls) * seed * 0.5 * lit(pc) * uSun;
  glass += jewel(pc.cls) * 0.045 * (0.6 + 0.8 * streak);           // unlit: dark glass, just readable
  // the first pane: the tablet's window light, a lit square at the centre (residue from p34), held until ring 0 takes over
  float sqD = max(abs(q.x), abs(q.y));
  glass = mix(glass, uHi * (1.1 + 0.4 * streak) * uSun, uSquare * (1.0 - smoothstep(0.105, 0.115, sqD)));
  // p36: the machines eclipse the glass from behind (the window stays the subject: the lead and stone stay drawn)
  glass *= 1.0 - 0.94 * uMach * machine(q);
  // grisaille: the painted shading that darkens each piece toward its lead
  glass *= mix(0.42, 1.0, smoothstep(LW, LW + 0.035, min(pc.leadD, pc.stoneD - SW + LW)));
  vec3 leadC = uGround * 0.35 + uSignal * uHeat * uHeat * 0.9 + passed(pc) * 0.03;
  float bevel = smoothstep(0.0, SW * 0.9, SW - pc.stoneD);
  vec3 stoneC = sa * (0.018 + 0.12 * uGlow) * (0.65 + 0.35 * bevel);
  return mix(stoneC, mix(leadC, glass, leadM), stoneM);
}

vec3 shadeWall(vec3 P, float pxw) {
  vec2 q = (P.xy - uWC.xy) / WR;
  float r = length(q);
  if (r < RF) return shadeWindow(q, pxw / WR);
  // ashlar courses, dark, warmed by the window's light
  float row = floor(P.y / 0.62);
  float bx = P.x / 1.3 + 0.5 * mod(row, 2.0);
  float joint = smoothstep(0.465, 0.49, max(abs(fract(bx) - 0.5), abs(fract(P.y / 0.62) - 0.5)));
  float tone = 0.75 + 0.35 * hash12(vec2(floor(bx), row)) + 0.2 * (vn3(P * 3.0) - 0.5);
  vec3 alb = stoneAlb() * tone * (1.0 - 0.5 * joint);
  float dw = max(r - RF, 0.0) * WR;
  float spill = uGlow * 0.14 / (1.0 + dw * dw / 5.0);
  float vault = 1.0 - smoothstep(17.0, 24.0, P.y);
  return alb * (0.009 + spill) * vault * uWall;
}

vec3 shadeFloor(vec3 P) {
  float row = floor(P.z / 0.95);
  float bx = P.x / 1.35 + 0.5 * mod(row, 2.0);
  float jx = abs(fract(bx) - 0.5) * 1.35, jz = abs(fract(P.z / 0.95) - 0.5) * 0.95;
  float joint = 1.0 - smoothstep(0.012, 0.03, min(0.675 - jx, 0.475 - jz));
  float wear = vn3(P * 2.3) * 0.6 + vn3(P * 9.0) * 0.4;
  vec3 alb = stoneAlb() * (0.7 + 0.45 * hash12(vec2(floor(bx), row)) + 0.3 * (wear - 0.5)) * (1.0 - 0.75 * joint);
  // the window re-projected along the light: the pool
  vec3 Q = P - uL * (P.z / uL.z);
  vec2 q = (Q.xy - uWC.xy) / WR;
  vec3 pool = vec3(0.0);
  if (P.z > 0.0 && dot(q, q) < RB5 * RB5) {
    Pc pc = piece(q, true);
    float stoneM = smoothstep(0.012, 0.04, pc.stoneD), leadM = smoothstep(0.004, 0.02, pc.leadD);
    pool = passed(pc) * stoneM * mix(0.35, 1.0, leadM);
  }
  float amb = 0.016 + 0.03 * uGlow * exp(-P.z / 10.0);
  return alb * (amb + pool * 0.6);
}

// the shafts: the window's light through the dust, marched along the view ray (cheap piece lookup, no Voronoi)
vec3 shafts(vec3 ro, vec3 rd, float tMax, vec2 fc) {
  const int N = 20;
  float dt = tMax / float(N);
  float jit = fract(52.9829189 * fract(dot(fc, vec2(0.06711056, 0.00583715)))); // interleaved-gradient dither
  vec3 acc = vec3(0.0);
  vec3 drift = vec3(0.1, -0.22, 0.05) * uT;
  for (int i = 0; i < N; i++) {
    float t = (float(i) + jit) * dt;
    vec3 S = ro + rd * t;
    if (S.z < 0.05 || S.y < 0.0) continue;
    vec3 Q = S - uL * (S.z / uL.z);
    vec2 q = (Q.xy - uWC.xy) / WR;
    if (dot(q, q) > RB5 * RB5) continue;
    Pc pc = piece(q, false);
    float stoneM = smoothstep(0.01, 0.035, pc.stoneD);
    float dn = vn3(S * 0.6 + drift) * 0.65 + vn3(S * 2.1 - drift * 1.7) * 0.35;
    acc += passed(pc) * stoneM * (0.2 + 1.1 * dn * dn) * dt;
  }
  float ph = 0.5 + 0.7 * pow(max(dot(rd, -uL), 0.0), 5.0);
  return acc * uShaft * ph;
}

void main() {
  vec2 fc = vUv * uRes;
  vec2 s = (fc - 0.5 * uRes) / (0.5 * uRes.y);
  vec3 rd = normalize(uFwd * uFocal + uRight * s.x + uUp * s.y);
  vec3 ro = uPos;
  float tHit = 60.0;
  int what = 0;
  if (rd.z < -1e-4) { float tw = -ro.z / rd.z; if (tw > 0.0 && tw < tHit) { tHit = tw; what = 1; } }
  if (rd.y < -1e-4) { float tf = -ro.y / rd.y; if (tf > 0.0 && tf < tHit) { tHit = tf; what = 2; } }
  vec3 P = ro + rd * tHit;
  float pxw = tHit * 2.0 / (uRes.y * uFocal);
  vec3 col = uGround * 0.4;
  if (what == 1) col = shadeWall(P, pxw);
  else if (what == 2) col = shadeFloor(P);
  col += shafts(ro, rd, min(tHit, 40.0), fc);
  col = max(col, 0.0);
  if (uThermal > 0.5) col = ironbow(col);
  fragColor = vec4(col, 1.0);
}`;

type Pose = { pos: THREE.Vector3; look: THREE.Vector3; focal: number };

export default class Glass extends Scene {
  private P!: NamedPalette;
  pass!: FSPass;
  private list: Shot[] = [];
  private beats: number[] = [];
  /** p36 'thermal': the same window, camera and layout under the thermal LUT; machines pass behind it on bar 4. */
  private thermal = false;

  override init() {
    const plate = this.ctx.params as PlateInfo;
    this.thermal = this.ctx.params.variant === 'thermal';
    this.P = palette(this.ctx.params.look.palette);
    this.list = shots(plate, this.ctx.audio);
    const { start, end } = this.ctx;
    this.beats = this.ctx.audio.beats.filter((b) => b >= start - 1e-3 && b < end - 0.05);
    const v3 = (c: [number, number, number]) => new THREE.Vector3(...c);
    const P = this.P;
    this.pass = new FSPass(GLASS_FRAG, {
      uRes: { value: new THREE.Vector2(1920, 1080) },
      uT: { value: 0 }, uLt: { value: 0 }, uFocal: { value: 1.7 }, uSun: { value: 1 }, uSurge: { value: 0 }, uHeat: { value: 0 }, uGlow: { value: 0 }, uShaft: { value: 0.03 }, uWall: { value: 1 },
      uThermal: { value: this.thermal ? 1 : 0 }, uMach: { value: 0 }, uMachX: { value: 0 }, uSquare: { value: 0 },
      uPos: { value: new THREE.Vector3() }, uFwd: { value: new THREE.Vector3() }, uRight: { value: new THREE.Vector3() }, uUp: { value: new THREE.Vector3() },
      uL: { value: LDIR.clone() }, uWC: { value: v3(WC) }, uSunQ: { value: new THREE.Vector2() },
      uRing: { value: [999, 999, 999, 999, 999, 999] },
      uGround: { value: v3(plin(P, 'ground')) }, uDeep: { value: v3(plin(P, 'deep')) }, cPalMid: { value: v3(plin(P, 'mid')) },
      uHi: { value: v3(plin(P, 'hi')) }, uText: { value: v3(plin(P, 'text')) }, uSignal: { value: v3(plin(P, 'signal')) },
    });
  }

  // v4 camera = the nave, tilt-up; layout = the rose centred (x = 0 on every framing, no pan)
  private pose(cam: Cam, k: number): Pose {
    const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    switch (cam) {
      // bar 1: tight on the centre of the rose (the first pane), widening as the rings light
      case 'wide': return { pos: V(0, 2.2, 27), look: V(0, 11, 0), focal: 4.1 + 9.5 * Math.exp(-k / 0.9) };
      // beat 3: the camera drops to the pool on the flagstones and tilts up the nave to the rose
      case 'floor': {
        const e = smoothstep(0, 1.1, k);
        return { pos: V(0, 2.2, 27), look: V(0, 1.2 + 9.8 * e, 13 - 13 * e), focal: 2.6 + 1.5 * e };
      }
      // bar 2: the rose centred, ablaze, a slow push
      case 'up': return { pos: V(0, 2.2, 27 - 1.2 * k), look: V(0, 11, 0), focal: 4.1 };
      // beat 7: tight on the centre panes (still centred), the light turning to heat
      case 'macro': return { pos: V(0, 2.2, 24 - 0.4 * k), look: V(0, 11, 0), focal: 9.0 + 0.6 * k };
    }
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, audio, start, end } = this.ctx;
    const t = f.t, lt = t - start;
    const sh = shotAt(this.list, t), cam = sh.shot.s.cam as Cam;
    const k = t - sh.t0;
    const B = this.beats;
    const u = this.pass.u;

    // rose: the plate opens on ONE lit square pane (p34's window light), rings 0..5 then light on beats 2..7 and stay lit;
    // thermal: rings 0..5 light on beats 1..6 (the same window, re-lit under the LUT)
    const off = this.thermal ? 0 : 1;
    const ring = u.uRing!.value as number[];
    for (let i = 0; i < 6; i++) ring[i] = B[i + off] !== undefined ? B[i + off]! - start : 999;
    const litRings = B.slice(off, off + 6).filter((b) => b <= t).length;
    u.uSquare!.value = this.thermal ? 0 : 1 - smoothstep((B[1] ?? end) - start, (B[1] ?? end) - start + 0.35, lt);
    // bar 4 of the plate (its last quarter, beats 7–8): a gear train, then a locomotive, slide behind the panes
    const tm = B[6] ?? end;
    u.uMach!.value = this.thermal ? smoothstep(tm, tm + 0.08, t) * (1 - smoothstep(end - 0.08, end, t)) : 0;
    u.uMachX!.value = -2.0 + 6.6 * clamp((t - tm) / Math.max(0.1, end - tm));
    // the sun behind the glass surges on every beat (the shafts, the pool and the panes flare together)
    const bp = beatPulse(audio, t, 0.14), db = downbeatPulse(audio, t, 0.22), kp = kickPulse(audio, t, 0.08);
    u.uSun!.value = 0.85 + 0.75 * bp + 0.45 * db + 0.15 * kp;
    const b7 = B[6] ?? end, b8 = B[7] ?? end;
    u.uSurge!.value = t >= b7 ? 0.25 + 0.55 * Math.exp(-(t - b7) / 0.18) : 0;
    u.uHeat!.value = smoothstep(b8, end - 0.04, t);
    u.uGlow!.value = clamp(litRings / 6) * (0.7 + 0.5 * bp);
    u.uSunQ!.value.set(0.35 - 0.08 * lt, 0.42 - 0.03 * lt);
    u.uT!.value = t; u.uLt!.value = lt;

    const pose = this.pose(cam, k);
    const fwd = pose.look.clone().sub(pose.pos).normalize();
    const right = fwd.clone().cross(new THREE.Vector3(0, 1, 0)).normalize();
    const up = right.clone().cross(fwd).normalize();
    u.uPos!.value.copy(pose.pos); u.uFwd!.value.copy(fwd); u.uRight!.value.copy(right); u.uUp!.value.copy(up);
    u.uFocal!.value = pose.focal;
    u.uShaft!.value = cam === 'wide' ? 0.05 : cam === 'floor' ? 0.045 : cam === 'up' ? 0.012 : 0.01;
    u.uWall!.value = cam === 'up' ? 0.4 : 1; // the rose ablaze in a near-black wall

    clearRT(renderer, out, plin(this.P, 'ground'));
    this.pass.render(renderer, out);

    // hits: a punch on every cut and downbeat, a small jolt on each kick, bloom breathing with the beat
    const cut = Math.exp(-Math.max(0, k) / 0.11);
    const glow = cam === 'up' ? 0.6 : cam === 'macro' ? 0.4 : 0.25;
    return {
      zoom: 1 + 0.05 * cut + 0.035 * db + 0.012 * kp,
      shake: [3 * kp * Math.sin(t * 91), 4 * kp],
      flash: cam === 'up' ? 0.12 * downbeatPulse(audio, t, 0.07) : 0,
      bloom: glow + 0.3 * bp,
      bloomThreshold: 0.9,
      halation: 0,
      ca: 0.3, grain: 0.04, vignette: 0.55,
    };
  }
}
