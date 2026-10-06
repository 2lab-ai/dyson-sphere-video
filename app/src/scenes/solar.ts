// SOLAR — the Sun as NASA SDO/AIA sees it: 304 Å false colour. Every pixel is one emission intensity pushed through
// the observatory's 1D colour table (black -> deep red -> orange -> peach-white), so the plate reads as a tonal
// emissive plasma photograph, never as a drawing. Shots come from ./solar.shots via stateAt():
//   wide/nebula     a cold filamentary cloud around the anchor; every beat it collapses one step toward the point
//   infall/protostar tight on the anchor: the cloud has spun into a flat accretion disc; each beat it drops inward
//   close/disc      the downbeat ignites the Sun (flash, shock ring); chromospheric network boils on every kick,
//                   one prominence arcs off the limb on every beat (bigger on the downbeat)
//   limb/disc       the camera slides onto the limb: prominences against black; the limb flares out (exit)
// Variants (data/edit.json): sun (p15).
import * as THREE from 'three';
import { ShaderScene } from './_shader';
import { type Frame, type PostOverrides } from '../engine/scene';
import { palette, plin, type NamedPalette } from '../engine/palette';
import { beatPulse, kickPulse, downbeatPulse } from '../engine/beat';
import { shotAt, type PlateInfo, type Shot } from '../engine/shots';
import { clamp, ease } from '../engine/util';
import { shots } from './solar.shots';
import { HostedPass } from '../engine/hostedpass';

const NP = 6; // prominence slots

/** Camera per frame name: the sun centre on screen (px, y down) and the solar radius in px. */
const CAM: Record<string, { x: number; y: number; r: number }> = {
  wide: { x: 1187, y: 413, r: 300 },
  infall: { x: 1187, y: 413, r: 520 },
  close: { x: 1187, y: 486, r: 468 },
  limb: { x: 1760, y: -330, r: 1150 },
};
/** Stage index for the shader. */
const STAGE: Record<string, number> = { nebula: 0, protostar: 1, disc: 2 };

type Prom = { t: number; ang: number; h: number; w: number; k: number };

export default class Solar extends ShaderScene {
  /** v4 COSMOS: when a WorldHost hosts this plate, the photographic-space subject (HOSTED_GLSL) replaces the plate. */
  private hp: HostedPass | null = null;
  private list: Shot[] = [];
  private plate!: PlateInfo;
  private P!: NamedPalette;
  private beats: number[] = [];
  private kicks: number[] = [];
  private ign = 0;
  private proms: Prom[] = [];

  override init() {
    if (this.ctx.params.hosted) { this.hp = new HostedPass(this.ctx, HOSTED_GLSL); return; }
    this.plate = this.ctx.params as PlateInfo;
    this.P = palette(this.ctx.params.look?.palette ?? 'sdo');
    this.list = shots(this.plate, this.ctx.audio);
    const au = this.ctx.audio;
    this.beats = au.beats.filter((b) => b >= this.ctx.start - 1e-3 && b < this.ctx.end - 1e-3);
    this.kicks = (au.onsets?.kick ?? []).filter(([x, s]) => s >= 0.5 && x >= this.ctx.start - 0.05 && x < this.ctx.end).map(([x]) => x);
    // ignition = the first shot whose stage is the disc (the storyboard's +1B downbeat)
    this.ign = this.list.find((s) => s.s.stage === 'disc')?.t ?? this.ctx.start + (this.ctx.end - this.ctx.start) / 2;
    const limbT = this.list.find((s) => s.s.frame === 'limb')?.t ?? Infinity;
    // one prominence per beat from ignition on; angles chosen so the limb shot (visible arc ~95..160 deg) keeps some
    const angs = [138, 22, 118, 152, 64, 100];
    let i = 0;
    for (const b of this.beats) {
      if (b < this.ign - 1e-3) continue;
      const down = au.downbeats.some((d) => Math.abs(d - b) < 0.02), cut = Math.abs(b - limbT) < 0.02;
      this.proms.push({ t: b, ang: angs[i % angs.length]!, h: down || cut ? 0.3 : 0.17, w: down || cut ? 0.42 : 0.26, k: down || cut ? 1.0 : 0.7 });
      i++;
    }
    super.init();
  }

  protected override uniforms(): Record<string, THREE.IUniform> {
    const P = this.P, v = (r: 'ground' | 'deep' | 'mid' | 'hi' | 'signal') => ({ value: new THREE.Vector3(...plin(P, r)) });
    return {
      uGr: v('ground'), uDe: v('deep'), uMi: v('mid'), uHi: v('hi'), uSi: v('signal'),
      uCam: { value: new THREE.Vector3(1187, 413, 300) },
      uStage: { value: 0 }, uCollapse: { value: 0 }, uHit: { value: 0 }, uKickP: { value: 0 }, uBoil: { value: 0 },
      uIgnT: { value: -1 }, uFlare: { value: 0 }, uRotT: { value: 0 },
      uPA: { value: Array.from({ length: NP }, () => new THREE.Vector4(0, -1, 0, 0)) },
      uPK: { value: new Array(NP).fill(0) },
    };
  }

  /** Beat-stepped collapse 0..1 over the pre-ignition window: each beat snaps one step (outExpo over 90 ms). */
  private collapse(t: number): number {
    const pre = this.beats.filter((b) => b < this.ign - 1e-3);
    let s = 0;
    for (const b of pre) if (b <= t) s += ease.outExpo(clamp((t - b) / 0.09));
    return clamp((s + 0.35 * clamp((t - this.ctx.start) / (this.ign - this.ctx.start))) / (pre.length + 0.35));
  }

  protected override frame(f: Frame): PostOverrides {
    const au = this.ctx.audio, t = f.t, u = this.pass.u;
    const { shot, t0 } = shotAt(this.list, t);
    const st = shot.s, cam = CAM[st.frame as string] ?? CAM.wide!;
    const beat = beatPulse(au, t, 0.14), kick = kickPulse(au, t, 0.11), down = downbeatPulse(au, t, 0.22);
    const since = t - t0, ignT = t - this.ign;

    // camera: holds, snaps on the shot boundary; a slow push-in while holding, and a beat-driven punch in the shader
    const push = 1 + 0.035 * since;
    (u.uCam!.value as THREE.Vector3).set(cam.x, cam.y, cam.r * push);
    u.uStage!.value = STAGE[st.stage as string] ?? 0;
    u.uCollapse!.value = this.collapse(t);
    u.uHit!.value = beat;
    u.uKickP!.value = kick;
    let boil = 0;
    for (const k of this.kicks) if (k <= t) boil += ease.outExpo(clamp((t - k) / 0.06));
    u.uBoil!.value = boil;
    u.uIgnT!.value = ignT;
    u.uRotT!.value = t - this.ctx.start;
    // exit: the limb flares over the last beat
    const lastBeat = this.beats[this.beats.length - 1] ?? this.ctx.end - 0.5;
    const flare = clamp((t - lastBeat) / Math.max(0.1, this.ctx.end - lastBeat));
    u.uFlare!.value = flare * flare;

    const PA = u.uPA!.value as THREE.Vector4[], PK = u.uPK!.value as number[];
    for (let i = 0; i < NP; i++) {
      const p = this.proms[i];
      if (!p || t < p.t) { PA[i]!.set(0, -1, 0, 0); PK[i] = 0; continue; }
      PA[i]!.set((p.ang * Math.PI) / 180, t - p.t, p.h, p.w);
      PK[i] = p.k;
    }

    // hits (authored per shot): collapse steps punch the frame; ignition = whiteout + shake; limb cut punch; exit flash
    const ov: PostOverrides = { vignette: 0.32, grain: 0.05, ca: 0.8 };
    if (st.stage === 'nebula' || st.stage === 'protostar') {
      ov.zoom = 1 + 0.018 * beat + 0.01 * down;
      ov.bloom = 0.35; ov.bloomThreshold = 0.55;
    } else {
      const ig = ignT >= 0 ? Math.exp(-ignT / 0.16) : 0;
      ov.flash = 1.1 * Math.exp(-ignT / 0.1) * (ignT >= 0 ? 1 : 0) + 0.12 * flare * flare;
      ov.zoom = 1 + 0.07 * ig + 0.014 * kick + (st.frame === 'limb' ? 0.05 * Math.exp(-since / 0.14) : 0);
      const sh = 14 * ig + 3 * kick;
      ov.shake = [sh * Math.sin(t * 91.0), sh * Math.cos(t * 73.0)];
      ov.bloom = 0.55 + 0.35 * flare; ov.bloomThreshold = 0.7; ov.halation = 0.25 + 0.3 * flare;
    }
    return ov;
  }

  protected glsl(): string {
    return /* glsl */ `
uniform vec3 uGr, uDe, uMi, uHi, uSi;
uniform vec3 uCam;          // sun centre on screen (px, y down), solar radius in px
uniform float uStage;       // 0 nebula, 1 protostar, 2 disc
uniform float uCollapse, uHit, uKickP, uBoil, uIgnT, uFlare, uRotT;
uniform vec4 uPA[${NP}];     // prominence: angle (rad, y down), age (s, <0 = off), height, half-width (rad)
uniform float uPK[${NP}];    // prominence brightness

// the AIA 304 colour table: one emission intensity -> ground / deep / mid / hi (HDR above 1)
vec3 lut(float x) {
  x = max(x, 0.0);
  if (x < 0.28) return mix(uGr, uDe, x / 0.28);
  if (x < 0.62) return mix(uDe, uMi, (x - 0.28) / 0.34);
  if (x < 0.92) return mix(uMi, uHi, (x - 0.62) / 0.30);
  return uHi * (1.0 + 1.6 * (x - 0.92));
}

// F1 and F2 of a cellular (Worley) field
vec2 worley(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  float d1 = 8.0, d2 = 8.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(float(x), float(y));
    vec2 o = hash22(i + g);
    float d = length(g + o - f);
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
  }
  return vec2(d1, d2);
}

float ridged(vec2 p, int oct) { float s = 0.0, a = 0.5; for (int i = 0; i < 6; i++) { if (i >= oct) break; s += a * (1.0 - abs(snoise(p))); p = rot2(0.7) * p * 2.1 + 5.3; a *= 0.5; } return s; }

// ---- the cold cloud: a billowing emission cloud with dust lanes, bounded, spiralling into the anchor; c = beat-stepped collapse
float nebula(vec2 w, float c) {
  float r = length(w);
  float k = 1.0 + 4.5 * c * c + 1.2 * c;                   // the cloud contracts toward the anchor
  float tw = (0.4 + 2.4 * c) / (r * k * 0.7 + 0.45);        // differential rotation: inner parts wind faster
  vec2 u = rot2(tw + 0.08 * uRotT) * w * k;
  float dens = smoothstep(0.38, 0.95, fbm(u * 0.62 + 2.0, 5) * 0.5 + 0.5 + 0.25 * exp(-dot(u, u) * 0.6));
  float rim = pow(ridged(u * 1.3 + 3.1, 4), 4.0) * 0.9;     // bright ionisation fronts on the billows
  float env = exp(-dot(u, u) / 3.6);                       // bounded: the cloud has an edge
  float dust = smoothstep(0.05, 0.5, fbm(u * 1.5 - 7.0, 3)); // dark lanes
  float I = (0.62 * dens + rim * dens) * env * (1.0 - 0.75 * dust) * (0.8 + 0.4 * uHit);
  // the point at the anchor: grows with the collapse, flares on each beat
  I += (0.004 + 0.03 * c + 0.03 * uHit * c) / (r * r * 6.0 + 0.004 + 0.02 * (1.0 - c));
  return I;
}

// ---- the accretion disc seen at an angle, spiral arms falling inward
float protostar(vec2 w, float c) {
  vec2 q = rot2(-0.38) * w;
  float k = 1.0 + 2.2 * c;
  q *= k;
  vec2 d = vec2(q.x, q.y / 0.32);                          // flattened: the disc plane
  float r = length(d), a = atan(d.y, d.x);
  float arms = 0.55 + 0.45 * sin(2.0 * a - 5.0 * log(r + 0.05) + 2.6 * uRotT + 1.3 * c);
  float fil = pow(ridged(vec2(a * 1.6, log(r + 0.05) * 3.0 - 1.1 * uRotT), 4), 2.4);
  float I = exp(-r * 1.25) * arms * (0.35 + 1.25 * fil) * 1.15 * (0.85 + 0.3 * uHit);
  // the disc's shadow lane across the core
  I *= 1.0 - 0.55 * exp(-(q.y * q.y) / (0.035 * 0.035)) * smoothstep(0.05, 0.3, abs(q.x));
  // cold outer envelope (what is left of the cloud)
  I += 0.22 * pow(ridged(w * 1.3 + 9.0, 4), 3.0) * exp(-length(w) * 0.9);
  float rq = length(q);
  I += (0.012 + 0.05 * c + 0.05 * uHit) / (rq * rq * 5.0 + 0.004);
  return I;
}

// ---- the solar disc in 304 A: chromospheric network, active regions, filaments, spicule limb
float disc(vec2 q, float R) {
  float r = length(q) / R;
  float I = 0.0;
  if (r < 1.0) {
    vec2 s = q / R;
    float z = sqrt(max(1.0 - r * r, 0.0));
    // spherical coordinates (the texture foreshortens toward the limb), slow rotation
    vec2 uv = vec2(atan(s.x, z) + 0.03 * uRotT, asin(clamp(s.y, -1.0, 1.0)));
    float boil = 0.21 * uBoil + 0.12 * uRotT;
    vec2 wp = uv + 0.03 * vec2(snoise(uv * 7.0 + 1.7), snoise(uv * 7.0 - 4.1)); // curl the cell walls (no straight edges)
    vec2 n1 = worley(wp * 11.0 + vec2(0.0, boil));
    vec2 n2 = worley(wp * 29.0 + vec2(boil * 1.7, 3.0));
    float net = 1.0 - smoothstep(0.0, 0.34, n1.y - n1.x);   // the soft bright network lanes between supergranules
    float gran = 1.0 - smoothstep(0.0, 0.4, n2.y - n2.x);
    float cellMid = smoothstep(0.1, 0.7, n1.x);             // cell interiors a touch darker
    float large = fbm(uv * 2.2 + 4.0, 4);
    float actv = smoothstep(0.18, 0.55, large);            // plage: bright active regions
    float fil = smoothstep(0.84, 0.97, ridged(uv * vec2(3.2, 5.0) + 17.0, 3)); // dark filaments
    float kick = uKickP;
    I = 0.5 + 0.08 * large
      + (0.14 + 0.3 * kick) * net
      + (0.07 + 0.14 * kick) * gran
      - 0.1 * cellMid
      + 0.38 * actv * (0.7 + 0.5 * net)
      - 0.34 * fil;
    // limb: slight brightening in 304, then the edge falls off into the spicule fringe
    I += 0.12 * smoothstep(0.82, 0.995, r);
    I *= mix(0.84, 1.0, pow(z, 0.25));
  } else {
    float a = atan(q.y, q.x);
    float h = r - 1.0;
    // spicule forest and the thin transition-region fringe
    float sp = 0.5 + 0.5 * snoise(vec2(a * 180.0, uRotT * 0.6));
    I = (0.55 + 0.35 * sp) * exp(-h / (0.012 + 0.012 * sp));
    // faint corona haze, radial streaks
    I += 0.16 * exp(-h * 5.0) * (0.7 + 0.3 * snoise(vec2(a * 9.0, h * 2.0 - 0.1 * uRotT)));
  }
  return I;
}

// one prominence: a squat arch of plasma rising off the limb (circle through two footpoints). Not a thin line: a thick
// ragged band, brightest along its outer edge, with flame texture streaming along the arch (SDO 304 hedgerow look).
float prominence(vec2 q, float R, vec4 pa, float k) {
  if (pa.y < 0.0) return 0.0;
  float age = pa.y;
  float grow = 1.0 - pow(1.0 - clamp(age / 0.34, 0.0, 1.0), 3.0);
  float h = pa.z * grow + 0.04 * age;                      // keeps drifting up
  vec2 p = rot2(pa.x) * (q / R);                           // local frame: the apex along +x
  float rp = length(p);
  if (rp < 1.0) return 0.0;
  float hw = pa.w;
  float c = ((1.0 + h) * (1.0 + h) - 1.0) / (2.0 * (1.0 + h - cos(hw)));
  float rho = 1.0 + h - c;
  vec2 d = p - vec2(c, 0.0);
  float ang = atan(d.y, d.x);
  float s = length(d) / max(rho, 1e-3);                    // 1 = the outer edge of the arch
  float band = 0.55;                                       // band thickness as a fraction of the radius
  float flame = fbm(vec2(ang * 3.2 - age * 0.9, s * 4.0 + age * 0.4), 4) * 0.5 + 0.5;
  float edge = s + 0.12 * (flame - 0.5);                   // ragged outer edge
  float inBand = smoothstep(1.0, 0.94, edge) * smoothstep(1.0 - band, 1.0 - band * 0.35, s);
  float I = inBand * (0.35 + 0.95 * pow(flame, 1.6)) * (0.6 + 0.6 * smoothstep(1.0 - band, 1.0, s));
  I += 0.22 * exp(-max(edge - 1.0, 0.0) * 18.0) * step(1.0, edge);   // soft glow just outside the edge
  I *= smoothstep(1.0, 1.02, rp);                          // rooted at the limb
  float fade = exp(-age / 1.8);
  return k * fade * I * (1.0 + 0.6 * exp(-age / 0.12));
}

vec3 plate(vec2 _p) {
  vec2 fc = vec2(vUv.x * uRes.x, (1.0 - vUv.y) * uRes.y);   // logical px, y down
  vec2 q = fc - uCam.xy;
  float I;
  if (uStage < 0.5) {
    I = nebula(q / uCam.z, uCollapse);
  } else if (uStage < 1.5) {
    I = protostar(q / uCam.z, uCollapse);
  } else {
    // ignition: the disc blasts out from the point, a shock ring runs ahead
    float g = 1.0 - exp2(-10.0 * clamp(uIgnT / 0.3, 0.0, 1.0));
    float R = uCam.z * max(g, 0.002);
    I = disc(q, R);
    float r = length(q) / uCam.z;
    float ring = 1.0 + uIgnT * 2.6;
    I += 1.6 * exp(-((r - ring) * (r - ring)) / 0.0025) * exp(-uIgnT / 0.35);
    for (int i = 0; i < ${NP}; i++) I += prominence(q, R, uPA[i], uPK[i]);
    // exit: the limb flares out
    float rr = length(q) / R;
    I += uFlare * (3.2 * exp(-abs(rr - 1.0) * 30.0) + 0.7 * exp(-max(rr - 1.0, 0.0) * 5.0) * step(1.0, rr));
  }
  return lut(I);
}
`;
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget) {
    if (this.hp) { this.hp.render(f, out); return {}; }
    return super.render(f, out);
  }
}

const HOSTED_GLSL = /* glsl */ `
// hosted (COSMOS p15): the Sun ignites at the centre, SDO 304-style — a granulated orange disc, limb-bright, a
// corona. Each beat is a held step: the disc swells 6 % and stays, the surface boils one notch (a new granulation slice,
// more active plage), the corona reaches one notch further, and one more flare loop erupts on the limb and stays.
vec3 plate(vec2 p) {
  float nb = uNb, R0 = min(0.3 * pow(1.06, nb), 0.5);
  float r = length(p), ign = smoothstep(0.0, 0.3, uLt);
  vec3 n; float cov = sphere(p, vec2(0.0), R0, n);
  vec3 sp = n * 3.0 + vec3(0.0, 0.0, 0.05 * uLt + 0.55 * nb);
  float gran = fbm(sp * 4.0, 5) * 0.5 + 0.5;
  float act = smoothstep(0.55 - 0.015 * nb, 0.85 - 0.015 * nb, fbm(sp * 1.2 + 4.0, 4) * 0.5 + 0.5);
  float limb = pow(1.0 - n.z, 2.0);
  float lum = (0.42 + 0.4 * gran + 0.5 * act + 0.35 * limb) * 0.5 * mix(0.3, 1.0, ign);
  vec3 c = spaceHeat(lum) * cov;
  float cr = max(r - R0, 0.0);
  c += spaceHeat(0.55) * exp(-cr / (0.03 + 0.01 * nb)) * (1.0 - cov) * (0.35 + 0.04 * nb) * ign
       * (1.0 - smoothstep(R0 + 0.15, R0 + 0.45, r));                              // corona (ends well inside the slot)
  for (int k = 0; k < 24; k++) {
    if (float(k) >= nb - 0.5) break;
    float a = 6.2832 * (0.13 + 0.382 * float(k)), h = R0 * (0.2 + 0.12 * hash11(float(k) * 3.7 + 2.0));
    vec2 rd = vec2(cos(a), sin(a)), ctr = R0 * rd, q = p - ctr;
    float d = abs(length(vec2(dot(q, vec2(-rd.y, rd.x)), dot(q, rd) / 0.6)) - h);   // a low arch, wider than tall
    float out_ = smoothstep(R0 - 0.004, R0 + 0.006, r);
    float fresh = float(k) >= nb - 1.0 ? 1.0 + 0.6 * uBp : 1.0;
    float fade = 1.0 - 0.6 * smoothstep(R0, R0 + 1.4 * h, r);                                 // loops thin out with height
    c += spaceHeat(0.75) * (exp(-d * d / (0.012 * 0.012)) + 0.3 * exp(-d * d / (0.035 * 0.035))) * out_ * fade * fresh;
    c += spaceHeat(0.95) * 0.5 * exp(-dot(p - ctr * 0.96, p - ctr * 0.96) / 0.003) * cov * fresh;   // its footpoint
  }
  return c;
}
`;
