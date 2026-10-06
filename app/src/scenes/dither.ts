// DITHER — P8 1-bit ordered dither (Lucas Pope, Return of the Obra Dinn): two colours only, an 8x8 Bayer threshold at
// 640x360, a frozen 3D moment seen by a slowly orbiting camera.
// bomb (p37): the atomic bomb. A bar of silence first: a 1-bit desert under a low sun, mountains on the horizon, the
// test tower with its shed on top; the only thing that moves is the tower's lamp, blinking once per beat. On the
// downbeat the frame goes WHITE (the one large-area flash of the plate), burns back to a black sky lit by the
// fireball, and a dithered mushroom cloud rises one stage per beat (snap, then frozen while the camera orbits).
// Exit: in the last half-beat the 1-bit pixels coarsen into a grid of round lamps (the ENIAC panel that follows).
//
// Render: pass A raymarches the scene at 640x360 into a luminance buffer (tower, cloud and mountains as SDFs /
// direction-space silhouettes, ground analytic). Pass B thresholds it against a Bayer matrix locked to the screen: the
// orbit keeps the subject (tower, cloud) fixed in frame and the sky is a function of elevation only, so a screen-locked
// matrix is subject-locked (no swimming on the cloud); zoom and shake move the matrix with the image. It maps 0/1 to ink/paper
// and upscales with nearest sampling (zoom punch and shake happen here too, so the pixels stay crisp).
// Structure comes from the pure shot list (./dither.shots) via stateAt(): cam flat/close/wide/low x stage.
import * as THREE from 'three';
import { FSPass, makeRT } from '../engine/gl';
import { Scene, type Frame, type PostOverrides } from '../engine/scene';
import { palette, plin } from '../engine/palette';
import { beatPulse, kickPulse, downbeatPulse } from '../engine/beat';
import { shotAt, type PlateInfo, type Shot } from '../engine/shots';
import { clamp, ease, hash } from '../engine/util';
import { shots } from './dither.shots';

/** The 1-bit raster (Obra Dinn's own resolution). */
export const LW = 640, LH = 360;

type V3 = [number, number, number];
interface Cam { dist: number; h: number; target: V3; fov: number; yaw: number }
/** Framings of the frozen moment. yaw is the orbit angle at the shot start; the orbit keeps turning at OMEGA. */
const CAMS: Record<string, Cam> = {
  flat: { dist: 14, h: 1.1, target: [0, 1.7, 0], fov: 36, yaw: 0.35 },
  close: { dist: 2.5, h: 4.05, target: [0, 3.2, 0], fov: 52, yaw: 1.25 },
  wide: { dist: 30, h: 1.4, target: [0, 6.5, 0], fov: 46, yaw: 0.2 },
  low: { dist: 21, h: 0.22, target: [0, 9.5, 0], fov: 62, yaw: 0.75 },
};
const OMEGA = 0.075; // rad/s

/** Cloud stages per beat after the downbeat: [cap height, cap radius, cap flatness, torus, stem radius, stem on, skirt radius, skirt height]. */
const STAGES: number[][] = [
  [0.9, 3.6, 1.0, 0.0, 0.0, 0.0, 4.2, 0.8], // fireball dome on the ground
  [5.2, 3.2, 0.7, 0.5, 1.2, 1.0, 5.5, 0.9], // lifting, the stem draws up
  [10.0, 4.4, 0.52, 1.0, 1.25, 1.0, 8.0, 1.1], // the column
  [14.0, 5.6, 0.45, 1.0, 1.55, 1.0, 10.0, 1.2], // the mushroom
];

export interface BombU {
  camPos: V3; camR: V3; camU: V3; camF: V3; tanH: number;
  stage: number; // 0 desert, 1 cloud
  cap: [number, number, number, number]; stem: [number, number, number, number]; boil: number; heat: number;
  white: number; lamp: number;
  cell: number; dots: number; night: number; zoom: number; shift: [number, number];
  post: PostOverrides;
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const norm = (a: V3): V3 => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** Everything pass A/B need at time t (pure; the CPU proxy calls it too). */
export function bombFrame(t: number, list: Shot[], au: { beats: number[]; downbeats: number[]; bpm: number; onsets?: Record<string, [number, number][]> }, start: number, end: number): BombU {
  const sh = shotAt(list, t);
  const st = sh.shot.s;
  const camKey = String(st.cam), stageKey = String(st.stage);
  const cloud = stageKey !== 'desert';
  const c = CAMS[camKey] ?? CAMS.flat!;
  // the orbit: continuous through the plate; each framing has its own start angle
  // (the exit settles static: the orbit stops at the lamps shot)
  const yaw = c.yaw + (st.stage === 'lamps' ? 0 : OMEGA * (t - sh.t0));
  const pos: V3 = [Math.sin(yaw) * c.dist, c.h, Math.cos(yaw) * c.dist];
  const f = norm(sub(c.target, pos));
  const r = norm(cross(f, [0, 1, 0]));
  const u = cross(r, f);
  const tanH = Math.tan((c.fov * Math.PI) / 360);

  // the blast: the downbeat where the cloud stage starts
  const blast = list.find((s) => s.s.stage === 'cloud')?.t ?? (start + end) / 2;
  const beats = au.beats.filter((b) => b >= blast - 1e-3 && b < end - 1e-3);
  let g = 0;
  beats.forEach((b, i) => { if (i > 0 && t >= b) g = i - 1 + ease.outExpo(clamp((t - b) / 0.12)); });
  const k0 = Math.min(STAGES.length - 1, Math.floor(g)), k1 = Math.min(STAGES.length - 1, k0 + 1), fr = g - Math.floor(g);
  const S = STAGES[k0]!.map((v, i) => v + (STAGES[k1]![i]! - v) * fr);
  const bi = beats.filter((b) => b <= t).length; // beats landed since the blast (incl. the blast)
  const lt = t - blast;
  const white = cloud ? (lt < 0.1 ? 1 : Math.exp(-(lt - 0.1) / 0.13)) : 0;
  const heat = cloud ? 0.4 + 0.6 * Math.exp(-Math.max(0, lt) / 1.4) : 0;

  // the silent bar: the tower lamp is on for the first 0.26 s of each beat (hard 1-bit on/off)
  const bp = beatPulse(au, t, 0.12);
  const lamp = !cloud && beatPulse(au, t, 0.26) > Math.exp(-1) ? 1 : 0;

  // exit: 1-bit pixels -> lamps (3 px cells, then 6)
  const lamps = stageKey === 'lamps';
  const cell = lamps ? (t - sh.t0 < 0.13 ? 3 : 6) : 1;
  // night falls over the first 0.35 s of the exit and stays (the p38 lamp grid's residue)
  const night = lamps ? ease.outCubic(clamp((t - sh.t0) / 0.35)) : 0;

  // hits (cloud only; the desert bar stays still): zoom punch per beat, the shock arrives on the 2nd beat (shake)
  const kp = kickPulse(au, t, 0.1), db = downbeatPulse(au, t, 0.25);
  const cut = sh.t0 > start + 1e-3 ? Math.exp(-(t - sh.t0) / 0.1) : 0;
  const shock = cloud && beats[1] !== undefined && t >= beats[1]! ? Math.exp(-(t - beats[1]!) / 0.18) : 0;
  const zoom = cloud ? 1 + 0.045 * bp + 0.02 * kp + 0.05 * db * (lt < 0.6 ? 1 : 0) + 0.03 * cut : 1;
  const sk = 7 * shock + 2 * bp * (cloud ? 1 : 0);
  const shift: [number, number] = [Math.round((hash(bi, 3) - 0.5) * sk), Math.round((hash(bi, 7) - 0.5) * sk)];

  return {
    camPos: pos, camR: r, camU: u, camF: f, tanH,
    stage: cloud ? 1 : 0,
    cap: [S[0]!, S[1]!, S[2]!, S[3]!], stem: [S[4]!, S[5]!, S[6]!, S[7]!], boil: bi * 1.37, heat,
    white, lamp,
    cell, dots: lamps ? 1 : 0, night, zoom, shift,
    // 1-bit purity: no grain, no CA, no vignette, no bloom. The whiteout is drawn in pass B (paper -> hi).
    post: { grain: 0, ca: 0, vignette: 0, bloom: 0.7 * night, halation: 0, flash: 0, exposure: 1 },
  };
}

// ------------------------------------------------------------------ pass A: the scene -> luminance (640x360)
export const GLSL_A = /* glsl */ `
uniform vec3 uCamPos, uCamR, uCamU, uCamF;
uniform float uTanH, uStage, uBoil, uHeat, uWhite, uLamp;
uniform vec4 uCap, uStem;

const vec3 SUN = vec3(-0.84, 0.30, -0.45);   // low sun, from the left and behind (long shadows toward the camera)
const vec3 LAMP = vec3(0.3, 3.8, 0.3);
const float MR = 160.0;
const float LEGB = 0.9, LEGT = 0.32, PLAT = 0.62, SHED = 0.4; // tower half-widths (base, top, platform, shed)                        // mountain range distance

// ---- tower: four splayed legs, X-braced faces (folded by symmetry), a platform and a shed, a lamp mast
float sdTower(vec3 p) {
  vec3 q = vec3(abs(p.x), p.y, abs(p.z));
  float d = sdCapsule(q, vec3(LEGB, 0.0, LEGB), vec3(LEGT, 3.0, LEGT), 0.05);
  vec3 f = vec3(max(q.x, q.z), q.y, min(q.x, q.z));            // fold onto the +x face
  for (int k = 0; k < 4; k++) {
    float y0 = 0.75 * float(k), y1 = y0 + 0.75, ym = 0.5 * (y0 + y1);
    float w0 = mix(0.9, 0.32, y0 / 3.0), w1 = mix(0.9, 0.32, y1 / 3.0), wm = 0.5 * (w0 + w1);
    d = min(d, sdCapsule(f, vec3(w1, y1, 0.0), vec3(w1, y1, w1), 0.03));
    d = min(d, sdCapsule(f, vec3(w0, y0, w0), vec3(wm, ym, 0.0), 0.022));
    d = min(d, sdCapsule(f, vec3(wm, ym, 0.0), vec3(w1, y1, w1), 0.022));
  }
  d = min(d, sdBox3(p - vec3(0.0, 3.02, 0.0), vec3(PLAT, 0.03, PLAT)));
  d = min(d, sdBox3(p - vec3(0.0, 3.3, 0.0), vec3(SHED, 0.26, SHED)));
  d = min(d, sdCapsule(p, vec3(0.3, 3.5, 0.3), LAMP, 0.015));
  return d;
}

// ---- the cloud: a cap (ellipsoid + the torus rolling under it), a stem, a dust skirt; billowed by folded noise
float billow(vec3 p) {
  vec3 s = vec3(uBoil, 0.37 * uBoil, -0.61 * uBoil);
  float n1 = snoise(p + s), n2 = snoise(p * 2.13 + s.zxy + 7.1);
  return 0.62 * (1.0 - abs(n1)) + 0.3 * (1.0 - abs(n2));
}
float sdCloud(vec3 p) {
  float Hc = uCap.x, Rc = uCap.y, fl = uCap.z;
  vec3 c = p - vec3(0.0, Hc, 0.0);
  vec3 er = vec3(Rc, Rc * fl, Rc);
  float k = length(c / er);
  float cap = (k - 1.0) * min(er.y, Rc);
  vec2 tq = vec2(length(c.xz) - 0.7 * Rc, c.y + 0.22 * Rc * fl);
  float tor = length(tq) - 0.42 * Rc * fl + (1.0 - uCap.w) * Rc;
  cap = smin(cap, tor, 0.35 * Rc);
  float taper = 1.0 + 0.7 * sat(1.0 - p.y / max(0.3 * Hc, 0.1));
  float stem = sdCapsule(p, vec3(0.0, -0.5, 0.0), vec3(0.0, Hc - 0.4 * Rc, 0.0), uStem.x * taper) + (1.0 - uStem.y) * 60.0;
  vec3 sr = vec3(uStem.z, uStem.w, uStem.z);
  float skirt = (length(p / sr) - 1.0) * uStem.w;
  float d = smin(cap, stem, 0.9);
  d = smin(d, skirt, 1.3);
  float sc = 0.45 * Rc;
  return d - 0.34 * sc * billow(p / sc);
}

vec3 cloudN(vec3 p) {
  vec2 e = vec2(0.03 * uCap.y, 0.0);
  return normalize(vec3(sdCloud(p + e.xyy) - sdCloud(p - e.xyy), sdCloud(p + e.yxy) - sdCloud(p - e.yxy), sdCloud(p + e.yyx) - sdCloud(p - e.yyx)));
}
vec3 towerN(vec3 p) {
  vec2 e = vec2(0.004, 0.0);
  return normalize(vec3(sdTower(p + e.xyy) - sdTower(p - e.xyy), sdTower(p + e.yxy) - sdTower(p - e.yxy), sdTower(p + e.yyx) - sdTower(p - e.yyx)));
}

// ray / sphere entry and exit (x > y: miss)
vec2 sphere(vec3 ro, vec3 rd, vec3 c, float r) {
  vec3 oc = ro - c; float b = dot(oc, rd), h = b * b - dot(oc, oc) + r * r;
  if (h < 0.0) return vec2(1.0, 0.0);
  h = sqrt(h); return vec2(max(-b - h, 0.0), -b + h);
}

// mountains: a silhouette in direction space (elevation angle per azimuth)
float mountainTop(float az) {
  return (2.2 + 4.2 * (0.5 + 0.5 * snoise(vec2(az * 2.2, 3.1))) + 1.6 * snoise(vec2(az * 9.0, 1.7))) / MR;
}

float groundH(vec2 x) { return 0.05 * sin(dot(x, vec2(0.82, 0.57)) * 7.0 + 2.2 * snoise(x * 0.35)) + 0.04 * snoise(x * 1.7); }

float sky(vec3 rd) {
  float el = asin(clamp(rd.y, -1.0, 1.0));
  if (uStage < 0.5) return 0.93 - 0.42 * sat(el / 0.55);                 // bright horizon, darker zenith
  // after: the flash-lit sky stays overexposed (paper), dimming a little toward the zenith as it cools
  return 0.95 - (0.18 + 0.2 * (1.0 - uHeat)) * sat(el / 0.8);
}

float groundShade(vec3 p, float tg) {
  vec2 x = p.xz;
  float e = 0.05;
  float h0 = groundH(x);
  vec3 n = normalize(vec3(-(groundH(x + vec2(e, 0.0)) - h0) / e, 1.0, -(groundH(x + vec2(0.0, e)) - h0) / e));
  // scrub: a dark bush in some world cells
  vec2 cid = floor(x / 1.7), cp = x - (cid + 0.5) * 1.7;
  vec2 hj = hash22(cid) - 0.5;
  float bush = step(0.62, hash12(cid + 3.7)) * (1.0 - step(0.16, length(cp - hj * 1.1)));
  float l;
  if (uStage < 0.5) {
    vec3 L = normalize(SUN);
    l = 0.3 + 1.25 * sat(dot(n, L));
    // the tower's shadow (a short march toward the sun)
    vec2 sb = sphere(p, L, vec3(0.0, 1.9, 0.0), 2.45);
    if (sb.x < sb.y) {
      float s = 0.05, sh = 1.0;
      for (int i = 0; i < 40; i++) {
        float d = sdTower(p + L * s);
        if (d < 0.006) { sh = 0.0; break; }
        s += max(d, 0.03);
        if (s > 14.0) break;
      }
      l *= mix(0.3, 1.0, sh);
    }
    l = mix(l, 0.12, bush);
    l = mix(l, 0.86, sat(tg / MR));                                        // haze toward the horizon
  } else {
    vec3 F = vec3(0.0, max(0.6 * uCap.x, 0.8), 0.0);
    vec3 Ld = F - p;
    float r2 = dot(Ld, Ld);
    l = 0.22 + uHeat * 2.2 * sat(dot(n, normalize(Ld))) * 60.0 / (60.0 + r2);
    l = mix(l, 0.04, bush);
    l = mix(l, 0.8, sat(tg / MR));
  }
  return l;
}

float mountainShade(vec3 rd, float el, float top) {
  float az = atan(rd.x, rd.z);
  float ridge = snoise(vec2(az * 40.0, el * 90.0)) * 0.5 + snoise(vec2(az * 13.0, el * 30.0)) * 0.5;
  float up = sat(el / max(top, 1e-4));                                      // 0 at the base, 1 at the crest
  if (uStage < 0.5) return 0.36 + 0.14 * ridge + 0.12 * up;
  return 0.2 + 0.12 * ridge + 0.1 * (1.0 - up);                          // dark against the white sky
}

float cloudShade(vec3 p, vec3 rd) {
  vec3 n = cloudN(p);
  float Hc = uCap.x, Rc = uCap.y;
  // cheap AO: the billow creases go dark
  float h = 0.12 * Rc;
  float ao = sat(0.15 + 0.85 * sdCloud(p + n * h) / h);
  vec3 core = vec3(0.0, Hc - 0.25 * Rc * uCap.z, 0.0);
  float dc = length(p - core) / (1.15 * Rc);
  // the fire: under the cap, in the rolling torus and down into the stem top; hot pockets in the billows
  float under = sat(-n.y * 0.8 + 0.35);
  float pocket = smoothstep(0.25, 0.7, snoise(p / (0.35 * Rc) + uBoil * 0.7) * 0.5 + 0.5);
  float fire = 1.4 * uHeat * sat(1.3 - dc) * under * (0.35 + 0.8 * pocket);
  // the body: dust and smoke, lit from the upper left by the white sky; the creases go dark
  vec3 K = normalize(vec3(-0.5, 0.65, -0.35));
  float body = (0.05 + 0.8 * pow(sat(dot(n, K) * 0.6 + 0.4), 1.5)) * ao;
  body *= mix(0.5, 1.0, smoothstep(Hc - 0.7 * Rc, Hc, p.y));            // the stem and the skirt: a dirt column, darker
  // the fresh fireball: a white-hot skin, mottled, darkening at the limb
  float limb = sat(dot(n, -rd));
  float ball = (0.25 + 0.75 * pocket) * (0.35 + 0.65 * limb);
  return mix(body + fire, ball, sat(1.0 - (uCap.x - 0.9) / 3.0));
}

float scene(vec3 ro, vec3 rd) {
  float el = asin(clamp(rd.y, -1.0, 1.0));
  float l = sky(rd);
  float tBest = 1e9;
  // ground / mountains
  float tg = rd.y < -1e-4 ? -ro.y / rd.y : 1e9;
  float top = mountainTop(atan(rd.x, rd.z));
  if (tg < MR) { l = groundShade(ro + rd * tg, tg); tBest = tg; }
  else if (el < top) { l = mountainShade(rd, el, top); tBest = MR; }
  if (uStage < 0.5) {
    // the tower
    vec2 b = sphere(ro, rd, vec3(0.0, 1.9, 0.0), 2.45);
    if (b.x < b.y && b.x < tBest) {
      float s = b.x;
      for (int i = 0; i < 110; i++) {
        vec3 p = ro + rd * s;
        float d = sdTower(p);
        if (d < 0.0012 * s) {
          vec3 n = towerN(p);
          float lit = sat(dot(n, normalize(SUN)));
          l = 0.05 + 0.5 * lit;
          break;
        }
        s += d * 0.9;
        if (s > b.y || s > tBest) break;
      }
    }
    // the lamp and its halo (a hard 1-bit disc, dithered glow)
    vec3 ld = LAMP - ro;
    float lt = length(ld);
    float a = acos(clamp(dot(rd, ld / lt), -1.0, 1.0));
    float px = 2.0 * uTanH / ${LH.toFixed(1)};                           // radians per 1-bit pixel
    float disc = step(a, max(0.05 / lt, 2.5 * px));
    l = mix(l, 1.0, uLamp * max(disc, exp(-a / (12.0 * px)) * 0.9));
    l = mix(l, 0.0, (1.0 - uLamp) * disc * step(lt, 6.0));               // off: a dark bulb (only when close)
  } else {
    vec3 bc = vec3(0.0, 0.5 * (uCap.x + uCap.y), 0.0);
    float br = max(0.5 * uCap.x + 1.6 * uCap.y, uStem.z * 1.1) + 1.0;
    vec2 b = sphere(ro, rd, bc, br);
    if (b.x < b.y && b.x < tBest) {
      float s = b.x;
      for (int i = 0; i < 96; i++) {
        vec3 p = ro + rd * s;
        float d = sdCloud(p);
        if (d < 0.0015 * s) { l = cloudShade(p, rd); break; }
        s += d * 0.7;
        if (s > b.y || s > tBest) break;
      }
    }
  }
  return mix(l, 1.0, uWhite);
}

void main() {
  vec2 q = vUv * 2.0 - 1.0;
  vec3 rd = normalize(uCamF + q.x * uTanH * ${(LW / LH).toFixed(6)} * uCamR + q.y * uTanH * uCamU);
  fragColor = vec4(scene(uCamPos, rd), 0.0, 0.0, 1.0);
}
`;

// ------------------------------------------------------------------ pass B: 1-bit threshold + nearest upscale
export const GLSL_B = /* glsl */ `
uniform sampler2D uLo;
uniform vec3 uInk, uPaper, uHi;
uniform vec2 uShift;
uniform float uCell, uDots, uZoom, uWhiteB, uNight;

float bayer8(ivec2 p) {
  int x = p.x & 7, y = p.y & 7, xy = x ^ y;
  int v = ((xy & 1) << 5) | ((x & 1) << 4) | ((xy & 2) << 2) | ((x & 2) << 1) | ((xy & 4) >> 1) | ((x & 4) >> 2);
  return (float(v) + 0.5) / 64.0;
}

void main() {
  vec2 L = vec2(${LW.toFixed(1)}, ${LH.toFixed(1)});
  vec2 g = ((vUv - 0.5) / uZoom + 0.5) * L - uShift;                  // continuous 1-bit pixel coords
  vec2 cellC = floor(g / uCell);
  ivec2 src = ivec2(clamp(cellC * uCell + floor(0.5 * uCell), vec2(0.0), L - 1.0));
  float lum = texelFetch(uLo, src, 0).r;
  float on = step(bayer8(ivec2(cellC)), lum);                                    // 1 = paper, 0 = ink
  if (uDots > 0.5) {
    // lamps: every ink cell becomes a round lamp in its socket of paper
    vec2 f = fract(g / uCell) - 0.5;
    on = max(on, step(0.38, length(f)));
  }
  vec3 paper = mix(uPaper, uHi, uWhiteB);
  vec3 col = mix(uInk, paper, on);
  // night (the exit): the ground goes dark; every lit cell of the sky becomes a glowing round dot on the grid
  float lit = step(bayer8(ivec2(cellC)), lum) * (1.0 - step(0.3, length(fract(g / uCell) - 0.5)));
  col = mix(col, mix(uInk, uHi * 1.6, lit), uNight);
  fragColor = vec4(col, 1.0);
}
`;

export default class Dither extends Scene {
  private list: Shot[] = [];
  private passA!: FSPass;
  private passB!: FSPass;
  private rt!: THREE.WebGLRenderTarget;

  override init() {
    const plate = this.ctx.params as PlateInfo;
    this.list = shots(plate, this.ctx.audio);
    const P = palette(this.ctx.params.look.palette);
    const v3 = (c: V3) => ({ value: new THREE.Vector3(...c) });
    this.passA = new FSPass(GLSL_A, {
      uCamPos: v3([0, 1, 10]), uCamR: v3([1, 0, 0]), uCamU: v3([0, 1, 0]), uCamF: v3([0, 0, -1]),
      uTanH: { value: 0.3 }, uStage: { value: 0 }, uBoil: { value: 0 }, uHeat: { value: 0 }, uWhite: { value: 0 }, uLamp: { value: 0 },
      uCap: { value: new THREE.Vector4() }, uStem: { value: new THREE.Vector4() },
    });
    this.passB = new FSPass(GLSL_B, {
      uLo: { value: null },
      uInk: v3(plin(P, 'deep')), uPaper: v3(plin(P, 'ground')), uHi: v3(plin(P, 'hi')),
      uShift: { value: new THREE.Vector2() },
      uCell: { value: 1 }, uDots: { value: 0 }, uZoom: { value: 1 }, uWhiteB: { value: 0 }, uNight: { value: 0 },
    });
    this.rt = makeRT(LW, LH, { pxScale: 1, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const U = bombFrame(f.t, this.list, this.ctx.audio, this.ctx.start, this.ctx.end);
    const a = this.passA.u, b = this.passB.u;
    (a.uCamPos!.value as THREE.Vector3).set(...U.camPos);
    (a.uCamR!.value as THREE.Vector3).set(...U.camR);
    (a.uCamU!.value as THREE.Vector3).set(...U.camU);
    (a.uCamF!.value as THREE.Vector3).set(...U.camF);
    a.uTanH!.value = U.tanH; a.uStage!.value = U.stage; a.uBoil!.value = U.boil; a.uHeat!.value = U.heat;
    a.uWhite!.value = U.white; a.uLamp!.value = U.lamp;
    (a.uCap!.value as THREE.Vector4).set(...U.cap);
    (a.uStem!.value as THREE.Vector4).set(...U.stem);
    this.passA.render(this.ctx.renderer, this.rt);
    b.uLo!.value = this.rt.texture;
    (b.uShift!.value as THREE.Vector2).set(...U.shift);
    b.uCell!.value = U.cell; b.uDots!.value = U.dots; b.uZoom!.value = U.zoom; b.uWhiteB!.value = U.white; b.uNight!.value = U.night;
    this.passB.render(this.ctx.renderer, out);
    return U.post;
  }

  override dispose() {
    this.rt?.dispose();
  }
}
