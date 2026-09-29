// IMPACT — the giant impact, as claymation (p16-impact-theia; M2, Sledgehammer-era plasticine on a peach set).
// A proto-Earth of marbled orange/yellow clay floats in front of a seamless peach cyclorama dotted with pressed
// clay stars. Bar 1: on every beat one hand-rolled clay lump flies in and squashes onto it (the planet grows a
// step), while Theia — a smaller navy clay ball — swings in from the left. Bar 2 downbeat: Theia hits; the two
// clays smear together, a molten crown splashes up and throws droplets that settle, beat by beat, into a debris
// ring; a larger clump starts to gather on the ring (the Moon p17 will ink).
// Render: SDF raymarch of rounded primitives at half resolution (upscaled), key light + bounce fill from the peach
// set, soft shadows and AO. Everything moves on a 12 fps grid anchored to the latest beat (so hits land on the
// beat frame); the silhouette wobble and the thumbprint bump are re-seeded per step: the "boil".
import * as THREE from 'three';
import { Scene, type Frame, type PostOverrides } from '../engine/scene';
import { FSPass, makeRT, W, H } from '../engine/gl';
import { palette, plin, type NamedPalette } from '../engine/palette';
import { beatPulse, kickPulse, downbeatPulse, beatIndex } from '../engine/beat';
import { shotAt, type PlateInfo, type Shot } from '../engine/shots';
import { hash, lerp } from '../engine/util';
import { shots } from './impact.shots';

type V3 = [number, number, number];

/** Camera rigs per shot state (world units; the proto-Earth sits at the origin). */
const CAMS: Record<string, { e: V3; t: V3; fov: number; roll: number; push: number }> = {
  wide: { e: [1.0, 0.5, 8.2], t: [0.2, 0.3, 0.0], fov: 36, roll: 0.0, push: 0.07 },
  low: { e: [-3.6, 0.3, 3.9], t: [0.35, 0.1, 0.0], fov: 46, roll: -0.1, push: 0.06 },
  close: { e: [1.3, 1.25, 4.6], t: [-0.75, 0.55, 0.2], fov: 42, roll: 0.05, push: 0.05 },
  top: { e: [0.9, 6.2, 3.4], t: [0.25, 0.0, -0.2], fov: 42, roll: 0.0, push: 0.05 },
};

const GLSL = /* glsl */ `
uniform float uTq;      // stepped local time (s since plate start, 12 fps grid anchored to the latest beat)
uniform float uImp;     // local impact time
uniform float uStep;    // step index (boil seed)
uniform float uBeat;    // beat pulse at the stepped time
uniform float uKick;
uniform vec4 uLand;     // local landing times of the 4 accreting lumps
uniform vec3 uCamE, uCamT;
uniform float uFov, uRoll, uAspect;
uniform vec3 uGround, uDeep, cPalMid, uHi, uSig;

const vec3 BC = vec3(0.0, 0.0, -2.0);   // cyclorama centre
const float BR = 11.0;                  // cyclorama radius
const int ND = 16;                      // splash droplets

vec3 dirT() { return normalize(vec3(-1.0, 0.5, 0.45)); }
vec3 ringN() { return normalize(vec3(0.4, 2.0, 0.5)); }
vec3 lumpDir(int i) {
  if (i == 0) return normalize(vec3(1.6, 1.1, 1.3));
  if (i == 1) return normalize(vec3(-0.3, -1.6, 1.4));
  if (i == 2) return normalize(vec3(0.7, 1.9, -0.4));
  return normalize(vec3(1.9, -0.7, 0.6));
}
void basis(vec3 n, out vec3 a, out vec3 b) {
  a = normalize(cross(n, abs(n.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
  b = cross(n, a);
}

float landed(int i) { return step(uLand[i], uTq); }
float earthR() {
  float r = 0.8;
  for (int i = 0; i < 4; i++) r += 0.045 * landed(i);
  return r + 0.12 * smoothstep(uImp, uImp + 0.5, uTq);
}
float ti() { return uTq - uImp; }

vec3 theiaC(float R, out float rT, out float k) {
  vec3 d = dirT();
  float t = uTq;
  if (t < uImp) {
    float u = (uImp - t) / uImp;                   // 1 at plate start, 0 at contact
    vec3 a, b; basis(d, a, b);
    rT = 0.5; k = 0.02;
    return d * (R + 0.47 + 2.2 * pow(u, 1.35)) + b * 1.1 * u * u - a * 0.4 * u * u;
  }
  float s = smoothstep(0.0, 0.5, t - uImp);
  rT = mix(0.5, 0.3, s); k = mix(0.12, 0.5, s);
  return d * mix(R + 0.4, R * 0.5, s);
}

vec3 dropPos(int i, float tt, vec3 cp, out float r) {
  float h1 = hash11(float(i) * 7.31 + 1.7), h2 = hash11(float(i) * 3.17 + 9.1), h3 = hash11(float(i) * 5.03 + 4.4);
  vec3 d = dirT(), a, b; basis(d, a, b);
  float ang = float(i) * 6.2831853 / float(ND) + h1 * 0.5;
  vec3 v = normalize(d * (0.8 + h2) + (a * cos(ang) + b * sin(ang)) * (0.9 + h3));
  vec3 pb = cp + v * 2.3 * (1.0 - exp(-tt * 3.0));
  vec3 n = ringN(), e1, e2; basis(n, e1, e2);
  float th = ang + 0.7 * tt + 2.4;
  // late: the ring clumps toward the gathering Moon (angular pull, wrapped)
  float thm = 3.9 + 0.7 * tt;
  th += atan(sin(thm - th), cos(thm - th)) * 0.4 * smoothstep(1.3, 2.3, tt);
  float rr = 1.95 + 0.35 * (h2 - 0.5);
  vec3 pr = (e1 * cos(th) + e2 * sin(th)) * rr + n * 0.1 * (h3 - 0.5);
  float s = smoothstep(0.15, 1.3, tt);
  r = (0.06 + 0.09 * h1) * (1.0 + 0.5 * uBeat) * smoothstep(0.0, 0.08, tt);
  return mix(pb, pr, s);
}

vec3 moonletPos(float tt) {
  vec3 n = ringN(), e1, e2; basis(n, e1, e2);
  float th = 3.9 + 0.7 * tt;
  return (e1 * cos(th) + e2 * sin(th)) * 1.95;
}

// the silhouette boil: a cheap wobble re-seeded every 12 fps step
float boil(vec3 p) {
  vec3 s = hash33(vec3(uStep, 3.1, 7.7)) * 6.2831853;
  return 0.007 * sin(p.x * 9.0 + s.x) * sin(p.y * 8.0 + s.y) * sin(p.z * 10.0 + s.z);
}

// planets only (no set): returns distance, id in .y
vec2 mapObj(vec3 p) {
  float R = earthR();
  float tt = ti();
  // the proto-Earth squashes on every beat
  vec3 sq = vec3(1.0 + 0.06 * uBeat, 1.0 - 0.08 * uBeat, 1.0 + 0.06 * uBeat);
  vec3 q = p / sq;
  float de = (length(q) - R) * min(sq.x, sq.y);
  if (tt > 0.0) {
    // impact ripple running away from the contact point
    float an = acos(clamp(dot(normalize(p), dirT()), -1.0, 1.0));
    de += 0.06 * exp(-tt * 2.2) * sin(an * 9.0 - tt * 22.0) * smoothstep(0.0, 0.05, tt);
  }
  vec2 res = vec2(de, 1.0);
  float d = de;
  // accreting lumps
  for (int i = 0; i < 4; i++) {
    float L = uLand[i];
    float u = clamp((uTq - (L - 0.5)) / 0.5, 0.0, 1.0);
    if (u <= 0.0) continue;
    vec3 dir = lumpDir(i);
    float s = smoothstep(L, L + 0.25, uTq);
    vec3 c = dir * mix(mix(4.6, R + 0.14, u * u), R + 0.1 - 0.13 * s, step(L, uTq));
    // squash: flatten along the surface normal after landing
    vec3 lq = p - c;
    float fl = 1.0 - 0.45 * s;
    lq = lq + dir * dot(lq, dir) * (1.0 / fl - 1.0);
    float dl = (length(lq) - 0.2) * fl;
    if (dl < res.x) res = vec2(dl, 2.0 + float(i));
    d = smin(d, dl, 0.03 + 0.1 * s);
  }
  // Theia
  float rT, k;
  vec3 tc = theiaC(R, rT, k);
  float dt = length(p - tc) - rT;
  if (dt < res.x) res.y = 6.0;
  d = smin(d, dt, k);
  if (tt > 0.0) {
    vec3 dn = dirT(), a, b; basis(dn, a, b);
    vec3 cp = dn * (R + 0.02);
    // molten crown: a widening, thinning torus lifting off the contact point
    float cr = 0.1 + 0.7 * smoothstep(0.0, 0.45, tt);
    float cm = 0.14 * (1.0 - smoothstep(0.25, 0.8, tt));
    if (cm > 0.001) {
      vec3 lq = p - cp - dn * (0.08 + 0.3 * tt);
      vec2 tq = vec2(length(vec2(dot(lq, a), dot(lq, b))) - cr, dot(lq, dn));
      float dc = length(tq) - cm;
      if (dc < d) res.y = 7.0;
      d = smin(d, dc, 0.08);
    }
    // droplets -> debris ring
    for (int i = 0; i < ND; i++) {
      float r;
      vec3 c = dropPos(i, tt, cp, r);
      float dd = length(p - c) - r;
      if (dd < d) res.y = 8.0 + float(i);
      d = min(d, dd);
    }
    // the gathering clump (the Moon to be)
    float mr = 0.32 * smoothstep(1.0, 2.2, tt) * (1.0 + 0.25 * uBeat);
    if (mr > 0.001) {
      float dm = length(p - moonletPos(tt)) - mr;
      if (dm < d) res.y = 30.0;
      d = min(d, dm);
    }
  }
  res.x = d + boil(p);
  return res;
}

vec2 map(vec3 p) {
  vec2 o = mapObj(p);
  float db = BR - length(p - BC);
  return db < o.x ? vec2(db, 0.0) : o;
}

vec3 calcN(vec3 p) {
  const vec2 e = vec2(0.002, -0.002);
  return normalize(e.xyy * map(p + e.xyy).x + e.yyx * map(p + e.yyx).x + e.yxy * map(p + e.yxy).x + e.xxx * map(p + e.xxx).x);
}

// thumbprints: concentric ridges around a few per-step print centres + fine plasticine grain
float thumb(vec3 p) {
  float v = 0.35 * snoise(p * 7.0 + hash33(vec3(uStep, 1.0, 2.0)) * 40.0);
  for (int k = 0; k < 3; k++) {
    vec3 c = normalize(hash33(vec3(uStep * 0.37, float(k), 5.0)) * 2.0 - 1.0) * earthR();
    float r = length(p - c);
    v += sin(r * 150.0) * exp(-r * r * 9.0);
  }
  return v;
}

float shadow(vec3 ro, vec3 rd) {
  float res = 1.0, t = 0.03;
  for (int i = 0; i < 28; i++) {
    float h = mapObj(ro + rd * t).x;
    res = min(res, 10.0 * h / t);
    t += clamp(h, 0.03, 0.5);
    if (res < 0.01 || t > 12.0) break;
  }
  return clamp(res, 0.0, 1.0);
}

float ao(vec3 p, vec3 n) {
  float o = 0.0, w = 1.0;
  for (int i = 1; i <= 4; i++) {
    float h = 0.06 * float(i);
    o += w * (h - mapObj(p + n * h).x);
    w *= 0.6;
  }
  return clamp(1.0 - 2.2 * o, 0.0, 1.0);
}

vec3 albedo(float id, vec3 p, out float emit) {
  emit = 0.0;
  float tt = ti();
  if (id < 1.5) {
    float m = fbm(p * 1.5 + vec3(0.0, uTq * 0.2, 0.0), 3);
    vec3 c = mix(cPalMid, uHi, smoothstep(0.05, 0.45, m));
    if (tt > 0.0) {
      float mix2 = smoothstep(0.0, 0.8, tt);
      float sw = fbm(p * 2.1 + dirT() * tt * 1.5, 3);
      float near = smoothstep(-0.2, 0.9, dot(normalize(p), dirT()));
      c = mix(c, uDeep, smoothstep(0.05, 0.35, sw) * mix2 * mix(0.35, 1.0, near));
      emit = smoothstep(0.42, 0.5, abs(sw) + 0.3 * near) * exp(-tt * 0.9) * mix2;
    }
    return c;
  }
  if (id < 5.5) {
    int i = int(id - 2.0);
    return i == 0 ? uHi : i == 1 ? uDeep : i == 2 ? mix(cPalMid, uGround, 0.4) : uDeep;
  }
  if (id < 6.5) {
    float m = fbm(p * 2.4, 2);
    return mix(uDeep, mix(uDeep, uGround, 0.35), smoothstep(0.2, 0.6, m));
  }
  if (id < 7.5) { emit = 0.5; return mix(cPalMid, uHi, 0.45); }
  if (id < 29.5) {
    float h = hash11((id - 8.0) * 1.37 + 0.5);
    vec3 c = h < 0.4 ? cPalMid : h < 0.75 ? uDeep : uHi;
    emit = h < 0.4 ? 0.35 * exp(-tt * 1.2) : 0.0;
    return mix(c, cPalMid, 0.3 * smoothstep(0.0, 0.5, fbm(p * 5.0, 2)));
  }
  // the gathering clump: mottled grey-navy clay
  return mix(uDeep, uGround, 0.45 + 0.2 * fbm(p * 4.0, 2));
}

vec3 setCol(vec3 p) {
  vec3 dir = normalize(p - BC);
  vec3 col = uGround;
  // pressed clay stars on the cyclorama
  vec2 sp = vec2(atan(dir.x, dir.z), asin(clamp(dir.y, -1.0, 1.0))) * 7.0;
  vec2 cell = floor(sp), f = fract(sp) - 0.5;
  float h = hash12(cell + 3.0);
  if (h > 0.72) {
    vec2 o = (hash22(cell) - 0.5) * 0.5;
    float r = 0.07 + 0.08 * hash12(cell + 9.0);
    float q = length(f - o) / r;
    if (q < 1.0) {
      vec3 sc = h > 0.9 ? uDeep : h > 0.82 ? cPalMid : uHi;
      float dome = sqrt(1.0 - q * q);
      vec2 g = (f - o) / r;
      float lit = clamp(0.55 + 0.45 * dot(normalize(vec3(g.x, g.y, dome)), normalize(vec3(-0.7, 0.8, 1.0))), 0.0, 1.2);
      return sc * lit;
    }
  }
  return col;
}

vec3 plate(vec2 uv) {
  vec3 E = uCamE, T = uCamT;
  vec3 f = normalize(T - E);
  vec3 r = normalize(cross(f, vec3(0.0, 1.0, 0.0)));
  vec3 u = cross(r, f);
  float cr = cos(uRoll), sr = sin(uRoll);
  vec3 r2 = r * cr + u * sr, u2 = u * cr - r * sr;
  float fl = 1.0 / tan(radians(uFov) * 0.5);
  vec3 rd = normalize(uv.x * r2 + uv.y * u2 + f * fl);
  vec3 L = normalize(vec3(-1.2, 1.5, 1.3));

  float t = 0.0; vec2 h = vec2(0.0);
  for (int i = 0; i < 96; i++) {
    h = map(E + rd * t);
    if (h.x < 0.0015 * t || t > 24.0) break;
    t += h.x * 0.9;
  }
  vec3 p = E + rd * t;
  if (h.y < 0.5) {
    // the set: peach cyclorama, lit, with the planets' soft shadows falling on it
    vec3 c = setCol(p);
    float sh = shadow(p + (BC - p) * 0.002, L);
    float spot = 0.9 + 0.12 * smoothstep(-0.2, 0.9, dot(normalize(p - BC), normalize(vec3(-0.4, 0.3, 1.2))));
    return c * spot * mix(0.72, 1.0, sh);
  }
  vec3 n = calcN(p);
  // thumbprint bump (normal perturbation, re-seeded per step)
  float e = 0.004;
  float t0 = thumb(p);
  vec3 g = vec3(thumb(p + vec3(e, 0.0, 0.0)) - t0, thumb(p + vec3(0.0, e, 0.0)) - t0, thumb(p + vec3(0.0, 0.0, e)) - t0) / e;
  n = normalize(n - 0.012 * (g - dot(g, n) * n));
  float emit;
  vec3 alb = albedo(h.y, p, emit);
  float dif = clamp(dot(n, L), 0.0, 1.0);
  float sh = shadow(p + n * 0.01, L);
  float oc = ao(p, n);
  vec3 hv = normalize(L - rd);
  float spec = pow(clamp(dot(n, hv), 0.0, 1.0), 28.0) * 0.16;
  float fres = pow(1.0 - clamp(dot(n, -rd), 0.0, 1.0), 3.0);
  vec3 col = alb * (1.15 * dif * sh + uGround * 0.55 * oc * (0.6 + 0.4 * n.y) + 0.12);
  col += vec3(spec * sh);
  col += uGround * fres * 0.3 * oc;
  col += uSig * emit * 1.4;
  return col;
}

void main() {
  vec2 p = (vUv - 0.5) * 2.0;
  p.x *= uAspect;
  fragColor = vec4(max(plate(p), 0.0), 1.0);
}
`;

export default class Impact extends Scene {
  private list: Shot[] = [];
  private plate!: PlateInfo;
  private P!: NamedPalette;
  private pass!: FSPass;
  private rt!: THREE.WebGLRenderTarget;
  private impT = 0;
  private land: number[] = [];

  override init() {
    this.plate = this.ctx.params as PlateInfo;
    this.P = palette(this.ctx.params.look?.palette ?? 'clay');
    this.list = shots(this.plate, this.ctx.audio);
    this.impT = (this.list.find((s) => s.s.stage === 'impact')?.t ?? (this.plate.start + this.plate.end) / 2) - this.plate.start;
    const beats = this.ctx.audio.beats.filter((b) => b >= this.plate.start - 1e-3 && b < this.plate.start + this.impT - 1e-3);
    this.land = [0, 1, 2, 3].map((i) => (beats[i] ?? this.plate.start + 99) - this.plate.start);
    const v3 = (c: [number, number, number]) => ({ value: new THREE.Vector3(...c) });
    const u: Record<string, THREE.IUniform> = {
      uTq: { value: 0 }, uImp: { value: this.impT }, uStep: { value: 0 }, uBeat: { value: 0 }, uKick: { value: 0 },
      uLand: { value: new THREE.Vector4(...this.land) },
      uCamE: v3([0, 0, 8]), uCamT: v3([0, 0, 0]), uFov: { value: 40 }, uRoll: { value: 0 }, uAspect: { value: W / H },
      uGround: v3(plin(this.P, 'ground')), uDeep: v3(plin(this.P, 'deep')), cPalMid: v3(plin(this.P, 'mid')),
      uHi: v3(plin(this.P, 'hi')), uSig: v3(plin(this.P, 'signal')),
    };
    this.pass = new FSPass(GLSL, u);
    this.rt = makeRT(W / 2, H / 2, { depthBuffer: false });
  }

  /** The 12 fps stop-motion grid, anchored to the latest beat so every beat lands on a frame. */
  private stepped(t: number): { tq: number; step: number } {
    const au = this.ctx.audio;
    const bi = beatIndex(au, t);
    const tb = bi >= 0 ? au.beats[bi]! : this.plate.start;
    const k = Math.floor((t - tb) * 12 + 1e-6);
    return { tq: tb + k / 12, step: bi * 16 + k };
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const au = this.ctx.audio, t = f.t, st = this.plate.start;
    const { tq, step } = this.stepped(t);
    const sh = shotAt(this.list, t);
    const cam = CAMS[String(sh.shot.s.cam)] ?? CAMS.wide!;
    // camera: a slow stepped push inside the shot + an animator's nudge per stop-motion step
    const sp = Math.min(1, (tq - sh.t0) / Math.max(0.1, Math.min(sh.t1, this.plate.end) - sh.t0));
    const bp = beatPulse(au, tq, 0.15);
    const jig = (s: number) => (hash(step, s) - 0.5) * 0.035;
    const e: V3 = [0, 1, 2].map((i) => lerp(cam.e[i]!, cam.t[i]!, cam.push * sp) + jig(i)) as V3;
    const u = this.pass.u;
    u.uTq!.value = tq - st;
    u.uStep!.value = step;
    u.uBeat!.value = bp;
    u.uKick!.value = kickPulse(au, tq, 0.12);
    (u.uCamE!.value as THREE.Vector3).set(...e);
    (u.uCamT!.value as THREE.Vector3).set(...cam.t);
    u.uFov!.value = cam.fov;
    u.uRoll!.value = cam.roll;
    this.pass.render(this.ctx.renderer, this.rt);
    this.ctx.comp.draw(this.ctx.renderer, this.rt.texture, out, { mode: 'replace' });

    // hits: the impact downbeat is the punch (zoom + flash + stepped shake); every beat nudges the frame
    const impAbs = st + this.impT;
    const hit = t >= impAbs ? Math.exp(-(t - impAbs) / 0.22) : 0;
    const hitQ = tq >= impAbs ? Math.exp(-(tq - impAbs) / 0.35) : 0;
    const db = downbeatPulse(au, t, 0.18);
    const beatNow = beatPulse(au, t, 0.1);
    const shake: [number, number] = [(hash(step, 11) - 0.5) * 40 * hitQ, (hash(step, 12) - 0.5) * 40 * hitQ];
    return {
      zoom: 1 + 0.14 * hit + 0.03 * beatNow + 0.01 * db,
      flash: 0.45 * Math.exp(-Math.max(0, t - impAbs) / 0.07) * (t >= impAbs ? 1 : 0),
      shake,
      exposure: 1 + (hash(step, 21) - 0.5) * 0.035, // stop-motion exposure flicker per step
      bloom: t >= impAbs ? 0.18 : 0,
      bloomThreshold: 1.0,
      ca: 0.3,
      grain: 0.03,
      vignette: 0.16,
    };
  }

  override dispose() {
    this.rt?.dispose();
  }
}
