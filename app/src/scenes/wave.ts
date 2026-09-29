// WAVE — M3 ink-in-water (the Tree of Life creation sequence: dye poured into a tank, backlit, billowing), ocean
// palette. ocean (p05): a side-on cross-section of a breaking wave flowing LEFT through dark clear water. The wave is
// not a solid: it is a mass of teal dye whose surface billows (two-phase flow map over a static curl field, so it is
// seekable), whose lip curls over a hollow barrel, and whose leading face sheds plumes ahead of itself. Amber light
// runs through it in thin threads. Line 5 is carried INSIDE the water, just under the back of the wave, on two rows
// that follow the surface; the letters are drawn into a texture that the shader diffuses like dye at their edges.
// Unlike p13 (frontal, gold/white, expanding everywhere) this plate is lateral: profile camera, mid-dark teal, and
// the motion is one direction (right to left).
// Beat: every beat the crest snaps forward (left) and swells, the amber threads and the backlit rim flare, and a curl
// of amber light breaks off the lip and is flung ahead. Structure from ./wave.shots via stateAt(): side / low / surge
// / close. Exit: the sea rises through the frame until it is all teal.
import * as THREE from 'three';
import type { Frame, PostOverrides } from '../engine/scene';
import { Layer2D } from '../engine/gl';
import { palette, plin, pcss, pmix, type NamedPalette } from '../engine/palette';
import { drawLyric, layoutLine, ownedLines, F, type CharState } from '../engine/lyric';
import { beatPulse, kickPulse, downbeatPulse, beatIndex } from '../engine/beat';
import { shotAt, stateAt, type PlateInfo, type Shot } from '../engine/shots';
import { clamp, ease, hash, smoothstep } from '../engine/util';
import type { Line } from '../engine/lyrics';
import { ShaderScene } from './_shader';
import { shots, type Cam } from './wave.shots';

type P2 = { x: number; y: number };
const W = 1920, H = 1080, SAFE = 96, HALF = H / 2;

// ---- the wave, in world units (= shader p units at zoom 1: the short side spans -1..1, y up)
export const WAVE = {
  sea: -0.46,  // still-water level
  amp: 0.66,   // crest height above the sea at the plate start
  grow: 0.03,  // + per beat (the tide builds)
  face: 0.2,   // gaussian width of the steep leading face
  back: 1.25,  // exp decay of the long back slope
  x0: 3.3, x1: -0.2, roll: 0.5, // roll-in: crest x at the plate start -> after `roll` s
  drift: 0.08, // continuous leftward travel (world/s)
  jump: 0.055, // leftward snap per beat
};

/** Camera per shot: centre relative to the (lagged) crest / sea, zoom, roll. */
const CAM: Record<Cam, { dx: number; ay: number; zoom: number; rot: number; push: number; size: number; thread: number; diff: number }> = {
  side: { dx: 0.15, ay: 0.7, zoom: 1.0, rot: 0.0, push: 0.05, size: 92, thread: 0.3, diff: 0.25 },
  low: { dx: 0.25, ay: 0.42, zoom: 1.75, rot: -0.07, push: 0.06, size: 100, thread: 1.9, diff: 0.35 },
  surge: { dx: 0.8, ay: 0.4, zoom: 1.3, rot: 0.05, push: 0.05, size: 124, thread: 0.8, diff: 0.3 },
  close: { dx: 0.5, ay: 0.7, zoom: 2.3, rot: 0.38, push: 0.2, size: 150, thread: 0.9, diff: 1.0 },
};

/** A screen-space polyline with arc-length lookup. */
class Path {
  private cum: number[] = [0];
  constructor(private pts: P2[]) {
    for (let i = 1; i < pts.length; i++) this.cum.push(this.cum[i - 1]! + Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y));
  }
  at(s: number): { x: number; y: number; ang: number } {
    const n = this.pts.length, c = this.cum;
    let i = 1;
    while (i < n - 1 && c[i]! < s) i++;
    const a = this.pts[i - 1]!, b = this.pts[i]!;
    const k = (s - c[i - 1]!) / Math.max(1e-6, c[i]! - c[i - 1]!);
    return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, ang: Math.atan2(b.y - a.y, b.x - a.x) };
  }
}

export default class Wave extends ShaderScene {
  private P: NamedPalette = palette(this.ctx.params.look?.palette ?? 'ocean');
  private list: Shot[] = [];
  private lines: Line[] = [];
  private beats: number[] = [];
  private wordStarts: number[] = [];
  private T!: Layer2D;

  override init() {
    this.T = new Layer2D();
    this.list = shots(this.ctx.params as PlateInfo, this.ctx.audio);
    this.lines = ownedLines(this.ctx);
    this.beats = this.ctx.audio.beats.filter((b) => b >= this.ctx.start - 1e-3 && b < this.ctx.end - 1e-3);
    this.wordStarts = this.lines.flatMap((l) => l.words.map((w) => w.start));
    super.init();
  }

  protected override uniforms(): Record<string, THREE.IUniform> {
    const v = (r: 'ground' | 'deep' | 'mid' | 'hi' | 'signal') => ({ value: new THREE.Vector3(...plin(this.P, r)) });
    const v4 = () => ({ value: new THREE.Vector4() });
    return {
      uText: { value: this.T.texture },
      cGround: v('ground'), cDeep: v('deep'), cMid: v('mid'), cHi: v('hi'), cSig: v('signal'),
      uCam: v4(), uWave: v4(), uK0: v4(), uK1: v4(), uK2: v4(),
      uFlowT: { value: 0 }, uBp: { value: 0 }, uThread: { value: 1 }, uDiff: { value: 0 }, uExit: { value: 0 },
    };
  }

  protected override glsl(): string {
    return /* glsl */ `
uniform sampler2D uText;
uniform vec3 cGround, cDeep, cMid, cHi, cSig;
uniform vec4 uCam;   // centre x, y (world), zoom, roll
uniform vec4 uWave;  // crest x, amplitude, sea level, rise (exit)
uniform vec4 uK0, uK1, uK2; // amber curls: centre x, y (world), age (s), strength
uniform float uFlowT, uBp, uThread, uDiff, uExit;

const float W_FACE = ${WAVE.face.toFixed(4)};
const float W_BACK = ${WAVE.back.toFixed(4)};
const float FLOW_PER = 1.6;
const float LIP_L = 3.3; // arc length of the lip (rad)
// smoothstep that accepts reversed edges (GLSL leaves edge0 >= edge1 undefined)
float sstep(float a, float b, float x) { float t = clamp((x - a) / (b - a), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }

float surfY(float x) {
  float u = x - uWave.x;
  float h = u < 0.0 ? exp(-(u * u) / (W_FACE * W_FACE)) : exp(-u / W_BACK);
  return uWave.z + uWave.y * h + 0.018 * sin(x * 3.1 - uFlowT * 2.2) * (1.0 - h) + uWave.w;
}

// one dye realisation: domain-warped fbm (soft billows)
float dyeN(vec2 q, float seed, int oct) {
  vec2 w = vec2(fbm(q + seed, 2), fbm(q + vec2(5.2, 1.3) - seed, 2));
  return fbm(q + 1.0 * w, oct);
}
// static flow: rotated gradient of one noise (divergence-free) + the water streaming back through the moving wave
vec2 flowV(vec2 q) {
  float e = 0.06, n = snoise(q * 0.5);
  vec2 g = vec2(snoise(q * 0.5 + vec2(e, 0.0)) - n, snoise(q * 0.5 + vec2(0.0, e)) - n) / e;
  return vec2(g.y, -g.x) * 0.22 + vec2(0.3, -0.04);
}
// two-phase flow map (seekable at any t)
float dyeF(vec2 q, float seed, int oct) {
  vec2 fl = flowV(q + seed);
  float ph = uFlowT / FLOW_PER;
  float f1 = fract(ph), f2 = fract(ph + 0.5);
  float n1 = dyeN(q - fl * f1, seed, oct);
  float n2 = dyeN(q - fl * f2, seed + 0.37, oct);
  return mix(n2, n1, 1.0 - abs(2.0 * f1 - 1.0));
}

// a curl of amber light: a log spiral that opens and fades as it flies
float curlA(vec2 w, vec4 k) {
  if (k.w <= 0.0) return 0.0;
  vec2 d = w - k.xy;
  float R = 0.07 + 0.3 * k.z;
  float rr = length(d) / R;
  if (rr > 1.4) return 0.0;
  float a = atan(d.y, d.x);
  float s = sin(a + log(max(rr, 0.05)) * 2.6 - k.z * 7.0 + 0.8 * snoise(d * 14.0));
  float band = sstep(0.35, 0.95, s) * sstep(1.3, 0.25, rr) * sstep(0.05, 0.3, rr);
  return band * (1.0 - sstep(0.15, 0.65, k.z)) * k.w;
}

vec3 plate(vec2 p) {
  float cr = cos(uCam.w), sr = sin(uCam.w);
  vec2 w = uCam.xy + vec2(cr * p.x + sr * p.y, -sr * p.x + cr * p.y) / uCam.z;
  float X = uWave.x, A = uWave.y, sea = uWave.z + uWave.w;
  vec2 q = (w - vec2(X, sea)) * 1.4;

  // ---- geometry: water below the surface, the lip (annulus sector), the barrel carved out under it
  float d = w.y - surfY(w.x);                       // > 0 above the water
  vec2 Lc = vec2(X - 0.26 * A, sea + 0.6 * A);
  float rin = 0.25 * A, th = 0.2 * A;
  vec2 dl = w - Lc;
  float r = length(dl), ang = atan(dl.y, dl.x);
  // the lip: a tube along the ring from the crest (0.6 rad) over the top to its tip, tapering to a point
  float rc = rin + 0.5 * th, arc = mod(ang - 0.6, 2.0 * PI);
  vec2 tip = Lc + rc * vec2(cos(0.6 + LIP_L), sin(0.6 + LIP_L));
  float lipD = arc < LIP_L ? abs(r - rc) - 0.5 * th * (1.0 - sstep(0.45 * LIP_L, LIP_L, arc)) : length(w - tip);
  float carve = sstep(X + 0.03, X - 0.12, w.x) * sstep(sea, sea + 0.2 * A, w.y); // the barrel, soft-edged
  d = mix(d, max(d, rin - r), carve);
  float dist = min(d, lipD);

  // ---- clear water above: near-black teal with faint suspended dye
  float far = sstep(0.45, 0.0, dist);          // only pay for the fluid near/inside the dye
  float hz = fbm(q * 0.6 + vec2(uFlowT * 0.3, 0.0), 2);
  vec3 air = cGround * (1.0 + 0.35 * sstep(-1.0, 1.0, -p.y)) + cDeep * 0.3 * sstep(-0.1, 0.5, hz);
  if (far <= 0.0 && uExit <= 0.0) return air;

  float n = dyeF(q, 1.3, 3);                       // ~ -0.6..0.6
  // the billowing boundary: the dye surface is a plume edge, not a line (stronger where the wave breaks)
  float wob = 0.09 + 0.08 * sstep(0.6, -0.2, (w.x - X) / max(A, 0.1));
  float b = dist + wob * n;
  float wet = sstep(0.035, -0.05, b);
  // the travelling front: plumes shed ahead of the face, streaming left along the sea surface
  float ahead = X - 0.18 * A - w.x;
  if (ahead > 0.0) {
    float pl = sstep(0.05, 0.4, n + 0.2) * exp(-ahead / 0.5) * sstep(0.42 * A, 0.0, w.y - sea - 0.04);
    wet = max(wet, pl * 0.85);
  }

  float depth = clamp(-b, 0.0, 0.8) * (1.0 - 0.7 * uExit);
  float nb = 0.5 + 0.9 * n;
  vec3 water = mix(cDeep, cMid, clamp(0.22 + 0.9 * nb - 1.4 * depth, 0.0, 1.0));
  float rim = wet * (1.0 - wet) * 4.0;             // the thin backlit edge of the dye
  water += (cMid * 0.8 + cHi * 0.1) * rim * (1.0 + 1.6 * uBp);

  vec3 col = mix(air, water, wet);

  // ---- the line: diffused like dye at its edges (warp + an 8-tap halo), inked into the water
  vec2 uv = vec2(p.x * 0.5 * uRes.y / uRes.x + 0.5, p.y * 0.5 + 0.5);
  vec2 wv = vec2(snoise(w * 9.0 + vec2(uFlowT * 0.8, 0.0)), snoise(w * 9.0 + vec2(3.1, -uFlowT * 0.8)));
  uv += wv * (0.6 + 2.2 * uDiff) / uRes;
  vec4 tc = texture(uText, uv);
  float halo = 0.0, rad = 4.0 + 16.0 * uDiff;
  for (int i = 0; i < 8; i++) {
    float a = float(i) * 0.785398 + 0.3;
    halo += texture(uText, uv + vec2(cos(a), sin(a)) * rad / uRes).a;
  }
  halo *= 0.125;
  // ---- amber light threads inside the teal, flowing with it
  if (wet > 0.05 && uThread > 0.0) {
    float m = dyeF(q * 1.2 + vec2(7.1, -3.3), 4.4, 3);
    float stream = sstep(-0.12, 0.2, fbm(q * 0.35 + vec2(1.7, uFlowT * 0.1), 2)); // threads run in a few streams
    stream = max(stream, clamp(uThread - 1.0, 0.0, 0.8));                   // the low shot: threads everywhere
    float thr = pow(clamp(1.0 - abs(m) * 7.0, 0.0, 1.0), 5.0) * stream * sstep(0.0, 0.2, depth + 0.04) * wet;
    thr *= 1.0 - sstep(0.0, 0.35, halo + tc.a);                            // the threads part around the letters
    col += cHi * thr * uThread * (0.8 + 1.6 * uBp);
  }
  // ---- curls breaking off the lip
  float ca = curlA(w, uK0) + curlA(w, uK1) + curlA(w, uK2);
  col += cHi * 1.4 * ca;

  col *= 1.0 - 0.4 * halo;                          // the dye parts around the letters
  col += cHi * halo * (0.05 + 0.2 * uDiff);         // and their pigment bleeds into it
  col = mix(col, tc.rgb, tc.a);
  return col;
}
`;
  }

  // ------------------------------------------------------------------ the wave (TS mirror of the shader's surface)
  /** Beat steps so far, each snapping in over `tau` s. */
  private steps(t: number, tau: number): number {
    let s = 0;
    for (const b of this.beats) if (b <= t) s += ease.outExpo(clamp((t - b) / tau));
    return s;
  }
  private crestX(t: number, tau = 0.08): number {
    const lt = t - this.ctx.start;
    return WAVE.x0 - (WAVE.x0 - WAVE.x1) * ease.outCubic(clamp(lt / WAVE.roll)) - WAVE.drift * lt - WAVE.jump * this.steps(t, tau);
  }
  private amp(t: number): number {
    return (WAVE.amp + WAVE.grow * this.steps(t, 0.1)) * (1 + 0.06 * beatPulse(this.ctx.audio, t, 0.14));
  }
  private surfY(x: number, X: number, A: number, flowT: number, rise: number): number {
    const u = x - X;
    const h = u < 0 ? Math.exp(-(u * u) / (WAVE.face * WAVE.face)) : Math.exp(-u / WAVE.back);
    return WAVE.sea + A * h + 0.018 * Math.sin(x * 3.1 - flowT * 2.2) * (1 - h) + rise;
  }

  // ------------------------------------------------------------------ frame
  protected override frame(f: Frame): PostOverrides {
    const { audio } = this.ctx;
    const t = f.t, u = this.pass.u, P = this.P;
    const st = stateAt(this.list, t);
    const sh = shotAt(this.list, t);
    const cam = st.cam as Cam;
    const cf = CAM[cam] ?? CAM.side;
    const lt = t - sh.t0;
    const bp = beatPulse(audio, t, 0.11), kp = kickPulse(audio, t, 0.09), db = downbeatPulse(audio, t, 0.25);
    const flowT = t - this.ctx.start + 2.3;
    const X = this.crestX(t), A = this.amp(t);
    const exit = smoothstep(this.ctx.end - 0.3, this.ctx.end - 0.02, t);
    const rise = 2.6 * ease.inCubic(exit);

    // camera: follows the crest with a lag (the crest snaps in 80 ms, the camera eases over 0.4 s)
    const Xl = cam === 'side' ? WAVE.x1 - WAVE.drift * 0.5 : this.crestX(t, 0.4);
    const zoom = cf.zoom * (1 + cf.push * lt);
    const cx = Xl + cf.dx, cy = WAVE.sea + cf.ay * A;
    u.uCam!.value.set(cx, cy, zoom, cf.rot);
    u.uWave!.value.set(X, A, WAVE.sea, rise);
    u.uFlowT!.value = flowT;
    u.uBp!.value = bp;
    u.uThread!.value = cf.thread;
    u.uDiff!.value = cf.diff + 1.2 * exit;
    u.uExit!.value = exit;

    // world -> screen px (y down), the exact inverse of the shader's mapping
    const c = Math.cos(cf.rot), s = Math.sin(cf.rot);
    const toS = (x: number, y: number): P2 => {
      const dx = (x - cx) * zoom, dy = (y - cy) * zoom;
      return { x: W / 2 + (c * dx - s * dy) * HALF, y: H / 2 - (s * dx + c * dy) * HALF };
    };

    // amber curls: one breaks off the top of the lip on each of the last three beats, flung ahead and falling
    const ks = [u.uK0!, u.uK1!, u.uK2!];
    const recent = this.beats.filter((b) => b >= this.ctx.start + WAVE.roll && b <= t && t - b < 0.7).slice(-3).reverse();
    ks.forEach((k, i) => {
      const b = recent[i];
      if (b === undefined) { k.value.set(0, 0, 0, 0); return; }
      const age = t - b, Xb = this.crestX(b + 0.08), Ab = this.amp(b + 0.02);
      const ox = Xb - 0.2 * Ab, oy = WAVE.sea + 0.97 * Ab; // the top of the lip
      k.value.set(ox - 0.38 * age, oy + 0.22 * age - 0.45 * age * age, age, 0.8 + 0.4 * hash(b, 11));
    });

    // ---- the line: two rows inside the water, under the back of the wave, following its surface
    const L = this.T, c2 = L.ctx;
    L.clear();
    const line = this.lines[0];
    if (line) {
      const fam = F.slam();
      const full = layoutLine(c2, line, fam, cf.size);
      // split into two rows at the word boundary nearest the middle
      let split = 1, best = Infinity;
      full.words.forEach((wb, i) => { if (i > 0 && Math.abs(wb.x - full.width / 2) < best) { best = Math.abs(wb.x - full.width / 2); split = i; } });
      const rowX0 = [0, full.words[split]!.x];
      const rowW = Math.max(full.words[split - 1]!.x + full.words[split - 1]!.w, full.width - rowX0[1]!);
      // the path: the surface from just behind the crest, in screen px
      const pts: P2[] = [];
      for (let x = X + 0.03; x < X + 7; x += 0.012) pts.push(toS(x, this.surfY(x, X, A, flowT, 0)));
      const path = new Path(pts);
      const start = pts[0]!;
      const avail = W - SAFE - Math.max(SAFE, start.x + 30);
      const size = Math.min(cf.size, (cf.size * avail) / Math.max(1, rowW));
      const k = size / cf.size;
      const s0 = 30 + Math.max(0, SAFE - start.x);
      const bi = beatIndex(audio, t);
      drawLyric(c2, line, t, {
        x: 0, y: 0, size, family: fam, align: 'left', unsungAlpha: 0.6,
        charTransform: (_ch: string, _idx: number, cs: CharState) => {
          const b = cs.box, row = cs.word >= split ? 1 : 0;
          const sc = s0 + b.x - rowX0[row]! * k + b.w / 2;
          const pp = path.at(sc);
          const nx = -Math.sin(pp.ang), ny = Math.cos(pp.ang); // into the water
          const depth = size * (1.08 + 1.18 * row);
          // bob: each beat lifts the letters toward the surface, more at the head of the line
          const bob = (10 + 8 * db) * bp * (0.6 + 0.4 * Math.sin(sc * 0.01 + bi));
          const gx = pp.x + nx * (depth - bob), gy = pp.y + ny * (depth - bob); // the baseline point
          // the glyph centre sits 0.35 size above its baseline, measured in the rotated frame
          const cxg = gx + Math.sin(pp.ang) * 0.35 * size, cyg = gy - Math.cos(pp.ang) * 0.35 * size;
          // ink bloom: a syllable opens slightly large and settles in 150 ms
          const bloom = cs.sung ? 1 + 0.18 * (1 - ease.outCubic(clamp(cs.frac * 4))) : 1;
          return { dx: cxg - (b.x + b.w / 2), dy: cyg - (b.y - 0.35 * size), rot: pp.ang, scale: bloom };
        },
        drawChar: (cc: CanvasRenderingContext2D, ch: string, cs: CharState) => {
          cc.fillStyle = !cs.sung ? pcss(P, 'ground') : cs.frac < 1 ? pcss(P, 'signal') : pcss(P, 'text');
          cc.fillText(ch, 0, 0);
        },
      });
    }
    L.upload();

    // ---- hits: beat zoom punch + small shake, a harder punch on each cut, a nudge on word starts, exposure on the beat
    let ws = 0;
    for (const w0 of this.wordStarts) if (t >= w0) ws = Math.max(ws, Math.exp(-(t - w0) / 0.1));
    const cut = sh.t0 > this.ctx.start + 1e-3 ? Math.exp(-lt / 0.12) : 0;
    const bI = beatIndex(audio, t);
    return {
      bloom: 0.28,
      bloomThreshold: 0.75,
      exposure: 1 + 0.2 * bp + 0.08 * kp,
      flash: 0.12 * cut,
      zoom: 1 + 0.02 * bp + 0.05 * cut + 0.015 * ws,
      shake: [(hash(bI, 1) - 0.5) * 8 * bp, (hash(bI, 2) - 0.5) * 8 * bp],
      vignette: 0.22,
      grain: 0.04,
    };
  }

  override dispose() { this.T?.texture.dispose(); }
}
