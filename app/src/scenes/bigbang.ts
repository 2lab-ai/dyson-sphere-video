// BIGBANG — M3 fluid cosmos (the Tree of Life creation sequence: dye and milk in a tank, backlit, slow billows).
// bang (p13, the drop): the frame is white-hot everywhere at once — no centre, no edge, no bomb — and then it cools.
// Cooling reads physically: the temperature steps down one notch per beat (white -> cream -> gold -> red) and the
// thin parts of the plasma fall to the dark ground first, so the uniform white curdles (dark ink blooms opening in
// white milk), then flips into gold/white ink-in-water plumes on black, frontal to the camera, and finally the
// plumes thin into filaments (the hand-off to the cosmic web).
// Expansion: every curl grows on every beat, and each depth layer grows about its own (off-frame) point, so no
// point in the frame is a centre. Deterministic: a two-phase flow map over a static curl field (no advection state).
// Structure comes from the pure shot list (./bigbang.shots) via stateAt(): cam flat/close/deep x stage
// white/cells/curls/filament.
import * as THREE from 'three';
import type { Frame, PostOverrides } from '../engine/scene';
import { palette, plin } from '../engine/palette';
import { beatPulse, kickPulse, downbeatPulse } from '../engine/beat';
import { shotAt, stateAt, type PlateInfo, type Shot } from '../engine/shots';
import { clamp, ease, hash } from '../engine/util';
import { ShaderScene } from './_shader';
import { shots, STAGES, type Stage } from './bigbang.shots';
import { HostedPass } from '../engine/hostedpass';

/** Temperature per beat of the plate (1 = white-hot). Beat 0 is the drop. */
const TEMP = [1.0, 0.9, 0.8, 0.7, 0.56, 0.5, 0.44, 0.38];

export default class Bigbang extends ShaderScene {
  /** v4 COSMOS: when a WorldHost hosts this plate, the photographic-space subject (HOSTED_GLSL) replaces the plate. */
  private hp: HostedPass | null = null;
  private list: Shot[] = [];
  private beats: number[] = [];

  protected override glsl(): string {
    return /* glsl */ `
uniform vec3 uGround, uDeep, cPalMid, uHi, uSig;
uniform float uTemp;    // 0..1 temperature (per-beat steps)
uniform float uStage;   // 0 white, 1 cells, 2 curls, 3 filament
uniform float uCamD;    // 0 flat (one plane), 1 close (near + far planes), 2 deep (the far plane only)
uniform float uGrow;    // expansion factor (steps up per beat)
uniform float uFlowT;   // flow clock (s)
uniform float uSt;      // time since the current shot (s)
uniform float uBp, uKp; // beat / kick pulses
uniform float uThin;    // filament thinning 0..1

const float PER = 1.3; // flow-map period (s)

// one ink/plasma realisation at field point q: domain-warped fbm (soft billows, not marbled folds); oct = detail
float ink(vec2 q, float seed, int oct) {
  vec2 w = vec2(fbm(q + seed, 2), fbm(q + vec2(5.2, 1.3) - seed, 2));
  return fbm(q + 1.5 * w + 3.7 * seed, oct);
}

// two-phase flow map: static curl field, crossfaded triangle weights (seekable at any t)
float field(vec2 q, float seed, float amp, int oct) {
  vec2 fl = curl2(q * 0.45 + seed, seed * 1.7) * amp * 0.35;
  float ph = uFlowT / PER;
  float f1 = fract(ph), f2 = fract(ph + 0.5);
  float n1 = ink(q - fl * f1, seed, oct);
  float n2 = ink(q - fl * f2, seed + 0.37, oct);
  float w1 = 1.0 - abs(2.0 * f1 - 1.0);
  return mix(n2, n1, w1);
}

// density 0..1 -> emission: black ground -> red fringe -> gold body -> white core (runs over 1 in the core)
vec3 ramp(float h) {
  vec3 c = mix(uGround, uDeep * 0.4, smoothstep(0.04, 0.32, h));
  c = mix(c, cPalMid, smoothstep(0.26, 0.62, h));
  c = mix(c, uHi, smoothstep(0.62, 0.95, h));
  return c * (1.0 + 0.9 * smoothstep(0.85, 1.0, h));
}

// the colour of the plasma at temperature T (1 white-hot -> 0.4 red), for the flat field
vec3 tempCol(float T) {
  vec3 c = mix(uDeep, cPalMid, smoothstep(0.55, 0.8, T));
  c = mix(c, uHi, smoothstep(0.8, 0.97, T));
  return c * (0.75 + 0.5 * smoothstep(0.88, 1.0, T));
}

// one depth layer: expands about its own point o (off frame, so no point in the frame is a centre).
// Returns (density, glow): glow peaks where the dye is thin (a backlit translucent edge).
vec2 layer(vec2 p, vec2 o, float freq, float seed, float amp, int oct) {
  vec2 q = ((p - o) / uGrow + o) * freq;
  float n = field(q, seed, amp, oct);       // ~ -0.6..0.6
  float d = smoothstep(-0.12, 0.5, n);
  if (uStage > 2.5) {
    // filaments: thin ridges along the plume boundaries, only where some dye is left; thinning through the shot
    float r = 1.0 - abs(n * 3.0 - 0.15);
    float keep = smoothstep(-0.2, 0.25, fbm(q * 0.35 + seed * 2.1, 2));
    d = pow(clamp(r, 0.0, 1.0), mix(4.0, 12.0, uThin)) * keep * 1.2;
  }
  float glow = d * (1.0 - d) * 4.0;
  return vec2(d, glow);
}

vec3 plate(vec2 p) {
  float T = uTemp;
  vec3 col;
  if (uCamD < 0.5) {
    // FLAT: one plane of plasma filling the frame, lit just above clip at T=1 so the per-beat temperature steps and
    // exposure dips read. White: granulation only. Cells: dark blooms open where the plasma is thinnest.
    vec2 L = layer(p, vec2(2.6, -1.9), 1.6, 1.3, 0.35, 4);
    float open = uStage > 0.5 ? 0.35 + 0.65 * smoothstep(0.0, 0.45, uSt) : 0.0;          // how far the voids have opened
    float Tl = T - 0.1 * (1.0 - L.x) - 0.04 * open;                       // thin plasma runs cooler
    col = tempCol(Tl) * (0.86 + 0.3 * L.x + 0.08 * uBp);
    float voids = 1.0 - smoothstep(0.08, 0.4, L.x);                      // dark ink blooming into the white
    col = mix(col, uGround, voids * open * 0.96);
  } else {
    // CLOSE / DEEP: layered depth, frontal. Far: finer plumes, dimmer, behind. Near: huge soft billows (few octaves:
    // they read out of focus), backlit, in front. Deep (filament): the near layer is gone, the far plane is the web.
    float hot = 0.3 + 0.7 * T + 0.14 * uBp;                                   // re-heat on each beat
    vec3 edge = mix(cPalMid, uHi, 0.6);                                         // the backlit edge: gold-white
    bool deep = uCamD > 1.5;
    vec2 F = deep ? layer(p, vec2(-3.1, 2.2), 2.6, 4.1, 0.3, 3) : layer(p, vec2(-3.1, 2.2), 1.9, 4.1, 0.3, 5);
    vec3 far = ramp(clamp(F.x * hot * 0.8, 0.0, 1.0)) + edge * F.y * 0.12 * hot;
    if (!deep) {
      vec2 N = layer(p, vec2(3.4, 1.6), 0.75, 7.9, 0.42, 3);
      vec3 near = ramp(clamp(N.x * hot * 1.1, 0.0, 1.0)) + (edge * 0.35 + uSig * 0.25 * uKp) * N.y * hot;
      float a = smoothstep(0.1, 0.55, N.x);                                   // the near dye occludes the far plane
      col = mix(far * 0.7, near, a);
    } else {
      col = far;
    }
    col = max(col, uGround);
  }
  return col;
}
`;
  }

  protected override uniforms(): Record<string, THREE.IUniform> {
    const P = palette(this.ctx.params.look.palette);
    const v = (r: 'ground' | 'deep' | 'mid' | 'hi' | 'signal') => ({ value: new THREE.Vector3(...plin(P, r)) });
    return {
      uGround: v('ground'), uDeep: v('deep'), cPalMid: v('mid'), uHi: v('hi'), uSig: v('signal'),
      uTemp: { value: 1 }, uStage: { value: 0 }, uCamD: { value: 0 }, uGrow: { value: 1 }, uFlowT: { value: 0 },
      uSt: { value: 0 }, uBp: { value: 0 }, uKp: { value: 0 }, uThin: { value: 0 },
    };
  }

  override init() {
    if (this.ctx.params.hosted) { this.hp = new HostedPass(this.ctx, HOSTED_GLSL); return; }
    super.init();
    this.list = shots(this.ctx.params as PlateInfo, this.ctx.audio);
    this.beats = this.ctx.audio.beats.filter((b) => b >= this.ctx.start - 1e-3 && b < this.ctx.end - 1e-3);
  }

  /** Temperature: a staircase, each beat snaps one notch down in 70 ms. */
  private temp(t: number): number {
    let T = TEMP[0]!;
    this.beats.forEach((b, i) => {
      if (i === 0 || t < b) return;
      const prev = TEMP[Math.min(i - 1, TEMP.length - 1)]!, next = TEMP[Math.min(i, TEMP.length - 1)]!;
      T = prev + (next - prev) * ease.outExpo(clamp((t - b) / 0.07));
    });
    return T;
  }

  /** Expansion: every beat every curl grows one step (snap 120 ms), plus a slow continuous stretch. */
  private grow(t: number): number {
    let s = 0;
    for (const b of this.beats) if (b <= t) s += ease.outExpo(clamp((t - b) / 0.12));
    return Math.pow(1.07, s) * (1 + 0.035 * (t - this.ctx.start));
  }

  protected override frame(f: Frame): PostOverrides {
    const { audio } = this.ctx;
    const t = f.t;
    const st = stateAt(this.list, t);
    const sh = shotAt(this.list, t);
    const stage = STAGES.indexOf(st.stage as Stage);
    const cam = st.cam as string;
    const bp = beatPulse(audio, t, 0.1), kp = kickPulse(audio, t, 0.09), db = downbeatPulse(audio, t, 0.22);
    const u = this.pass.u;
    const T = this.temp(t);
    const sinceShot = t - sh.t0;
    u.uTemp!.value = T;
    u.uStage!.value = stage;
    u.uCamD!.value = cam === 'flat' ? 0 : cam === 'close' ? 1 : 2;
    u.uGrow!.value = this.grow(t);
    u.uFlowT!.value = t - this.ctx.start + 3.1;
    u.uSt!.value = sinceShot;
    u.uBp!.value = bp;
    u.uKp!.value = kp;
    u.uThin!.value = stage === 3 ? clamp(sinceShot / 1.1) : 0;

    // hits
    const lt = t - this.ctx.start;
    const drop = Math.exp(-lt / 0.22);                                              // the drop itself
    const cut = sh.t0 > this.ctx.start + 1e-3 ? Math.exp(-sinceShot / 0.12) : 0;
    const bi = this.beats.findIndex((b) => b > t + 1e-6);
    const k = bi < 0 ? this.beats.length : bi;
    const white = stage <= 1;
    return {
      bloom: white ? 0.55 : 0.38,
      bloomThreshold: 0.8,
      halation: white ? 0 : 0.08, // small: halation is signal-orange and the curls are highlight-heavy
      flash: 1.1 * drop + (stage === 2 ? 0.35 : 0.1) * cut,
      // white phase: each beat is an exposure dip (a clipped white frame cannot get brighter); curls: a luminance hit
      exposure: white ? 1 - 0.28 * bp + 0.4 * drop : 1 + 0.35 * bp + 0.15 * kp,
      zoom: 1 + 0.07 * drop + 0.06 * cut + 0.022 * bp + 0.012 * db,
      shake: [(hash(k, 3) - 0.5) * (14 * drop + 8 * bp), (hash(k, 5) - 0.5) * (14 * drop + 8 * bp)],
      vignette: white ? 0 : 0.18, // no vignette while white: an edge would read as a centre
      grain: 0.05,
      ca: 0.4,
    };
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget) {
    if (this.hp) { this.hp.render(f, out); return {}; }
    return super.render(f, out);
  }
}

const HOSTED_GLSL = /* glsl */ `
// hosted (COSMOS p13): the residue point at the centre, then gold plasma curls growing out of it. The front grows one
// step per beat and stays (the beat mark); the plasma cools one notch per beat (white-hot -> gold -> red fringe).
vec3 plate(vec2 p) {
  float r = length(p);
  float grow = uNb < 0.5 ? 0.0 : uNb - 1.0 + smoothstep(0.0, 0.35, uBeatPh);
  float R = min(0.05 + 0.075 * grow, 0.62);
  vec2 w = p * 2.6;
  for (int i = 0; i < 3; i++) w += 0.38 * vec2(fbm(w + 0.12 * uLt, 4), fbm(w + vec2(5.2, 1.3) - 0.1 * uLt, 4));
  float fil = pow(1.0 - abs(fbm(w * 1.4, 5)), 3.0);
  float env = exp(-pow(r / R, 2.0) * 2.4);
  float T = clamp(1.25 - 0.09 * uNb, 0.55, 1.25);
  vec3 c = spaceHeat(fil * env * T * 1.5) * (1.0 + 0.4 * uBp);
  c += spaceHeat(1.1) * exp(-r * r / (0.016 * 0.016));            // the singular point: hot core
  c += cSig * 0.6 * exp(-r / 0.045);                         // its orange halo
  return c;
}
`;
