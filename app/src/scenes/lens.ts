// LENS — optical instruments. Irises are mechanical aperture diaphragms: n blades pivoting in a turned housing over
// a disc of lens glass. Not a human eye, not a sci-fi eye: a machine that looks. v3: each plate its own material.
//   GL pass: the ground (film stock / studio cyclorama), the housing metal (brass / chrome), the glass
//   Canvas2D: the blades (projected wedge polygons), the wall and beams, and every lyric line via drawLyric
// Variants (data/edit.json; colours = the plate's named palette, look.palette):
//   gaze (p11, `film`)       bright, overexposed film stock: two brass irises face each other across a sunlit
//         plaster wall. Warm blown highlights, lifted milky shadows, a light leak that flares on downbeats, gate
//         weave and heavy grain. Line 11 is engraved on the left ring; line 12 exists only where the two eyes'
//         light overlaps inside the wall (burned to white). Beat: blades step 1/12 turn + an exposure pump.
//   ai   (p22, `chrome-eye`) a chrome machine iris on a white studio cyclorama: hard chrome reflections (softbox
//         strips, a dark horizon band), a black pupil. Line 18 rides the outer ring and is pulled, spiralling,
//         into the aperture; in the macros the pupil holds the stolen words and line 19 is the reflection on its
//         front glass. Beat: blades step + the softbox reflection snaps across the chrome. Exit: a glint flares.
import * as THREE from 'three';
import { Scene, type Frame, type PostOverrides } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { palette, pcss, plin, pmix, type NamedPalette } from '../engine/palette';
import { drawLyric, layoutLine, ownedLines, F, type CharState, type CharXform } from '../engine/lyric';
import { beatPulse, kickPulse, downbeatPulse, beatIndex } from '../engine/beat';
import { stateAt, shotAt, type PlateInfo, type Shot } from '../engine/shots';
import { EYE_GLSL } from '../engine/prim';
import { clamp, ease, hash, lerp, smoothstep, TAU } from '../engine/util';
import type { Line } from '../engine/lyrics';
import { shots } from './lens.shots';

type P = { x: number; y: number };
type Cam = { s: number; fx: number; fy: number; rot: number };
/** A ring/iris in world px: centre, radius, and the squash of a disc turned away from the camera. */
type Ring = { c: P; R: number; sx: number; sy: number };
type Iris = Ring & { n: number; ap: number; phi: number; hot: number; edge: number };
type Ink = { sung: string; unsung: string; unsungAlpha?: number; alpha?: number; lip?: string };

const proj = (cam: Cam, q: P): P => {
  const x = (q.x - cam.fx) * cam.s, y = (q.y - cam.fy) * cam.s;
  const c = Math.cos(cam.rot), s = Math.sin(cam.rot);
  return { x: W / 2 + c * x - s * y, y: H / 2 + s * x + c * y };
};
const onRing = (r: Ring, th: number, k = 1): P => ({ x: r.c.x + Math.cos(th) * r.R * k * r.sx, y: r.c.y + Math.sin(th) * r.R * k * r.sy });

// ------------------------------------------------------------------ GL: ground, housing, glass
const FRAG = /* glsl */ `
uniform vec2 uRes;
uniform vec4 uI[2];     // iris: screen centre xy, housing radii xy (px)
uniform vec4 uJ[2];     // x ellipse rotation, y index-ring rotation, z glass glow, w present
uniform float uMode;    // 0 = film stock (gaze), 1 = chrome on a cyclorama (ai)
uniform float uBeat;    // beat pulse: the engraving / the rim catch the light
uniform float uExpo;    // film: exposure pump; chrome: softbox strip position (-1..1, snaps per beat)
uniform float uLeak;    // film: light-leak strength; chrome: floor-shadow strength
uniform vec4 uCyc;      // chrome: x horizon (screen y px), y px per world px, zw floor-shadow centre (screen px)
uniform float uGrainT;  // film: frame index for the stock's dye clouds
uniform vec3 uG, uD, uM, uHi, uSg;   // the plate's named palette (linear)
${EYE_GLSL}
float lensNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), f.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), f.x), f.y);
}
vec3 filmGround(vec2 fc) {
  vec2 uv = fc / uRes;
  // the sun pours in from the upper left: warm stock, blown toward white where it lands
  vec2 q = (fc - vec2(0.36, 0.30) * uRes) / (uRes * vec2(0.62, 0.72));
  float hot = exp(-dot(q, q));
  vec3 col = mix(uG, uHi, 0.75 * hot + 0.5 * uExpo);
  // lower right falls toward the brass of the stock's shoulder (still light: this is overexposed film)
  col = mix(col, mix(uG, uM, 0.55), 0.35 * smoothstep(0.35, 1.2, length(uv * vec2(1.0, 0.9))) * (1.0 - hot));
  // dye clouds: low-frequency density breathing, a new cloud every film frame
  col *= 0.97 + 0.06 * lensNoise(fc / 140.0 + uGrainT * 3.1);
  // light leak: the edge of the roll fogged orange, flaring on downbeats
  float lk = uLeak * exp(-fc.x / 300.0) * (0.55 + 0.45 * lensNoise(vec2(fc.y / 180.0, uGrainT * 0.7)));
  lk += 0.6 * uLeak * exp(-(uRes.x - fc.x) / 160.0) * smoothstep(0.4, 1.0, uv.y);
  col = mix(col, mix(uSg, uHi, 0.1 + 0.45 * lk * lk), sat(lk * 1.2));
  return col;
}
vec3 cycGround(vec2 fc) {
  // a seamless white cyclorama: wall -> cove -> floor, lit from above; the eye's soft contact shadow on the floor
  float y = fc.y, hz = uCyc.x, k = uCyc.y;
  vec3 wall = mix(uHi, uG, 0.35 + 0.45 * sat(y / uRes.y));
  vec3 floorC = mix(uG, uM, 0.22);
  vec3 col = mix(wall, floorC, smoothstep(hz - 140.0 * k, hz + 180.0 * k, y));
  col = mix(col, uHi, 0.25 * exp(-pow((y - hz + 40.0 * k) / (70.0 * k), 2.0)));   // the cove catches the key light
  vec2 d = (fc - uCyc.zw) / vec2(380.0 * k, 60.0 * k);
  col = mix(col, uD, uLeak * 0.30 * exp(-dot(d, d)));
  return col;
}
// chrome: reflect a studio (white wall above, grey floor below, a dark camera band at the horizon, softbox strips)
vec3 chromeEnv(vec2 n) {
  float ny = n.y;
  vec3 sky = mix(uHi, uG, sat(0.5 + 0.8 * ny));
  vec3 flo = mix(uM, uG, sat(ny - 0.2));
  vec3 e = ny < 0.08 ? sky : flo;
  e = mix(e, uD * 0.35, smoothstep(0.02, 0.06, ny) * smoothstep(0.26, 0.2, ny));      // the horizon: the dark crew band
  float strip = exp(-pow((n.x - uExpo) / 0.07, 2.0)) * smoothstep(0.2, -0.3, ny);       // the key softbox
  float strip2 = exp(-pow((n.x + 0.55) / 0.05, 2.0)) * smoothstep(0.1, -0.5, ny);       // the fill
  return e + uHi * (1.6 * strip + 0.7 * strip2);
}
void main() {
  vec2 fc = vec2(vUv.x, 1.0 - vUv.y) * uRes;
  bool film = uMode < 0.5;
  vec3 col = film ? filmGround(fc) : cycGround(fc);
  for (int i = 0; i < 2; i++) {
    if (uJ[i].w < 0.5) continue;
    vec2 d = rot2(uJ[i].x) * (fc - uI[i].xy);
    vec2 q = d / uI[i].zw;
    float r = length(q), a = atan(q.y, q.x);
    float aa = 1.6 / min(uI[i].z, uI[i].w);
    float hous = smoothstep(1.0 - aa, 1.0, r) * smoothstep(1.32 + aa, 1.32, r);
    float lathe = 0.5 + 0.5 * sin(r * 900.0 + hash11(floor(r * 60.0)) * 6.0);
    vec3 metal;
    if (film) {
      // brass, lit from the upper left, shadows lifted milky by the overexposure
      float lit = sat(0.5 - 0.5 * sin(a + 0.8));
      metal = mix(mix(uM, uD, 0.12), mix(uM, uHi, 0.45), lit) * (0.92 + 0.14 * lathe);
      metal = mix(metal, uD, 0.30 * segRing(r, a, 1.255, 1.315, 180.0, 0.42, uJ[i].y, aa));
      metal = mix(metal, uD, 0.45 * ringMask(r, 1.24, aa * 0.5, aa));
      metal = mix(metal, uHi, (0.35 + 0.6 * uBeat) * ringMask(r, 1.012, aa * 0.8, aa));
    } else {
      // chrome: a torus bevel across the annulus, reflecting the studio
      float b = clamp((r - 1.16) / 0.16, -1.0, 1.0);
      vec2 n = vec2(cos(a), sin(a)) * b * 0.92;
      metal = chromeEnv(n) * (0.97 + 0.05 * lathe);
      metal = mix(metal, uD * 0.3, 0.55 * segRing(r, a, 1.27, 1.315, 120.0, 0.5, uJ[i].y, aa));
      metal = mix(metal, uD * 0.2, 0.8 * ringMask(r, 1.012, aa * 0.6, aa));
      metal += uHi * 0.8 * uBeat * ringMask(r, 1.3, aa * 0.8, aa);
    }
    col = mix(col, metal, hous);
    // outside the housing: film halation (red-orange bleeding off the bright brass)
    if (film) col = mix(col, uSg, 0.18 * smoothstep(1.32, 1.34, r) * exp(-(r - 1.32) * 14.0));
    // glass
    float glass = smoothstep(1.0, 1.0 - aa, r);
    vec3 g;
    if (film) {
      g = mix(uD, uG, 0.38) + (uHi - uD) * 0.18 * smoothstep(0.3, 1.0, r);
      g += uJ[i].z * (uHi * 1.6 * exp(-r * r * 22.0) + uSg * 0.35 * exp(-r * r * 5.0));
    } else {
      g = uD * 0.12 + uD * 0.1 * smoothstep(0.4, 1.0, r);
      // the front glass reflects the softbox: a curved window, upper left
      vec2 w = (q - vec2(-0.34, -0.4)) / vec2(0.26, 0.13);
      g += uHi * 0.1 * smoothstep(1.0, 0.6, length(w)) * smoothstep(0.95, 0.9, r);
      g += uJ[i].z * (uHi * 1.2 * exp(-r * r * 90.0) + uSg * 0.05 * exp(-r * r * 14.0));
    }
    col = mix(col, g, glass);
  }
  fragColor = vec4(max(col, 0.0), 1.0);
}`;

// ------------------------------------------------------------------ scene
export default class Lens extends Scene {
  private layer!: Layer2D;
  private pass!: FSPass;
  private list: Shot[] = [];
  private plate!: PlateInfo;
  private lines: Line[] = [];
  private P!: NamedPalette;

  override init() {
    this.plate = this.ctx.params as PlateInfo;
    this.P = palette(this.ctx.params.look.palette);
    this.list = shots(this.plate, this.ctx.audio);
    this.lines = ownedLines(this.ctx);
    this.layer = new Layer2D();
    const v4 = () => new THREE.Vector4();
    const v3 = (role: 'ground' | 'deep' | 'mid' | 'hi' | 'signal') => ({ value: new THREE.Vector3(...plin(this.P, role)) });
    this.pass = new FSPass(FRAG, {
      uRes: { value: new THREE.Vector2(W, H) },
      uI: { value: [v4(), v4()] },
      uJ: { value: [v4(), v4()] },
      uMode: { value: this.plate.variant === 'ai' ? 1 : 0 },
      uBeat: { value: 0 },
      uExpo: { value: 0 },
      uLeak: { value: 0 },
      uCyc: { value: v4() },
      uGrainT: { value: 0 },
      uG: v3('ground'), uD: v3('deep'), uM: v3('mid'), uHi: v3('hi'), uSg: v3('signal'),
    });
  }

  // ---------------------------------------------------------------- timing helpers
  /** Beats since the plate's first beat, with an eased snap into each beat (outBack: a mechanical step). */
  private step(t: number, snap = 0.11, fn: (x: number) => number = ease.outBack) {
    const au = this.ctx.audio;
    const i0 = beatIndex(au, this.ctx.start + 1e-3), i = beatIndex(au, t);
    if (i < 0) return 0;
    return i - i0 + fn(clamp((t - au.beats[i]!) / snap)) - 1;
  }

  // ---------------------------------------------------------------- drawing: iris blades
  private blades(c: CanvasRenderingContext2D, cam: Cam, ir: Iris, chrome: boolean) {
    const P = this.P;
    const n = ir.n, al = TAU / n, R = ir.R, a = Math.max(ir.ap, 0);
    const S = (u: number, v: number) => proj(cam, { x: ir.c.x + u * ir.sx, y: ir.c.y + v * ir.sy });
    const unit = (k: number) => ({ x: Math.cos(ir.phi + k * al), y: Math.sin(ir.phi + k * al) });
    const V = (k: number) => { const u = unit(k); return { x: u.x * a, y: u.y * a }; };
    const ext = (k: number) => {
      // edge k runs V_k -> V_{k+1} (direction from the unit polygon, so a = 0 is well defined); extend to the circle
      const u0 = unit(k), u1 = unit(k + 1);
      let dx = u1.x - u0.x, dy = u1.y - u0.y; const L = Math.hypot(dx, dy); dx /= L; dy /= L;
      const v = V(k + 1), b = v.x * dx + v.y * dy, cc = v.x * v.x + v.y * v.y - R * R;
      const tt = -b + Math.sqrt(Math.max(0, b * b - cc));
      return { x: v.x + dx * tt, y: v.y + dy * tt };
    };
    const C = proj(cam, ir.c);
    const rs = R * cam.s * Math.max(ir.sx, ir.sy);
    for (let k = 0; k < n; k++) {
      const v0 = V(k), v1 = V(k + 1), e = ext(k), thE = Math.atan2(e.y, e.x);
      c.beginPath();
      let q = S(v0.x, v0.y); c.moveTo(q.x, q.y);
      q = S(v1.x, v1.y); c.lineTo(q.x, q.y);
      q = S(e.x, e.y); c.lineTo(q.x, q.y);
      for (let j = 1; j <= 10; j++) { const th = thE - (al * j) / 10; q = S(Math.cos(th) * R, Math.sin(th) * R); c.lineTo(q.x, q.y); }
      c.closePath();
      if (chrome) {
        // polished steel: a hard horizon across each blade (sky above, the dark band, the floor below)
        const mid = S((v0.x + e.x) / 2, (v0.y + e.y) / 2);
        const up = k % 2 ? 1 : -1;
        const g = c.createLinearGradient(mid.x, mid.y - up * rs * 0.45, mid.x, mid.y + up * rs * 0.45);
        g.addColorStop(0, pcss(P, 'hi'));
        g.addColorStop(0.42, pmix(P, 'hi', 'mid', 0.55));
        g.addColorStop(0.47, pmix(P, 'deep', 'mid', 0.2));
        g.addColorStop(0.56, pcss(P, 'deep'));
        g.addColorStop(1, pmix(P, 'mid', 'ground', 0.4));
        c.fillStyle = g; c.fill();
      } else {
        // blackened steel shot on overexposed stock: milky, lifted, warm toward the rim
        c.fillStyle = pmix(P, 'deep', 'ground', 0.34); c.fill();
        const g = c.createRadialGradient(C.x, C.y, 0, C.x, C.y, rs);
        const tone = k % 2 ? 0.1 : 0.2;
        g.addColorStop(0, pcss(P, 'hi', tone * 0.4));
        g.addColorStop(0.6, pcss(P, 'hi', tone));
        g.addColorStop(1, pcss(P, 'mid', tone * 1.6));
        c.fillStyle = g; c.fill();
      }
      // leading edge (V_k -> E_k): the machined edge that catches the beat
      const hot = k === ir.hot;
      c.lineCap = 'round';
      c.strokeStyle = hot ? pcss(P, 'signal', 0.95) : pcss(P, 'hi', 0.45 + 0.5 * ir.edge);
      c.lineWidth = hot ? 3.2 : 1.2 + 2.6 * ir.edge;
      c.beginPath(); q = S(v0.x, v0.y); c.moveTo(q.x, q.y); q = S(e.x, e.y); c.lineTo(q.x, q.y); c.stroke();
      // pivot pin near the housing
      const thp = thE - al * 0.55, pin = S(Math.cos(thp) * R * 0.9, Math.sin(thp) * R * 0.9);
      const pr = Math.max(1.5, 4.5 * cam.s * Math.min(1, ir.sx * 3));
      c.fillStyle = chrome ? pcss(P, 'deep') : pcss(P, 'mid');
      c.beginPath(); c.arc(pin.x, pin.y, pr, 0, TAU); c.fill();
      c.strokeStyle = pcss(P, 'hi', 0.6 + 0.4 * ir.edge); c.lineWidth = 1;
      c.stroke();
    }
  }

  /** The aperture opening as a path (for clipping to the pupil). */
  private aperturePath(c: CanvasRenderingContext2D, cam: Cam, ir: Iris, grow = 1) {
    const al = TAU / ir.n;
    c.beginPath();
    for (let k = 0; k < ir.n; k++) {
      const q = proj(cam, { x: ir.c.x + Math.cos(ir.phi + k * al) * ir.ap * grow * ir.sx, y: ir.c.y + Math.sin(ir.phi + k * al) * ir.ap * grow * ir.sy });
      if (k) c.lineTo(q.x, q.y); else c.moveTo(q.x, q.y);
    }
    c.closePath();
  }

  private setIrisGL(i: number, cam: Cam, ir: Iris | null, glow: number, knurl: number) {
    const I = (this.pass.u.uI!.value as THREE.Vector4[])[i]!, J = (this.pass.u.uJ!.value as THREE.Vector4[])[i]!;
    if (!ir) { J.set(0, 0, 0, 0); return; }
    const C = proj(cam, ir.c);
    I.set(C.x, C.y, ir.R * cam.s * ir.sx, ir.R * cam.s * ir.sy);
    J.set(cam.rot, knurl, glow, 1);
  }

  // ---------------------------------------------------------------- drawing: text on a ring
  /**
   * Draw a lyric line along a ring (world), centred at angle th0, reading in direction dir (+1 = clockwise on
   * screen, the top arc; -1 = the bottom arc). Glyphs keep their size; positions and tangents follow the ellipse.
   * `ink.lip` engraves: a lit lip offset under each glyph, the cut face over it.
   */
  private ringLyric(c: CanvasRenderingContext2D, line: Line, t: number, cam: Cam, ring: Ring, k: number, th0: number, dir: number,
    sizeW: number, ink: Ink, extra?: (st: CharState, p: P, ang: number) => CharXform | null) {
    const fam = F.slam();
    const layW = layoutLine(c, line, fam, sizeW);
    // arc-length table over a full turn centred on th0
    const N = 240, th: number[] = [], len: number[] = [];
    let acc = 0, prev = onRing(ring, th0 - dir * Math.PI, k);
    for (let i = 0; i <= N; i++) {
      const a = th0 - dir * Math.PI + (dir * TAU * i) / N, p = onRing(ring, a, k);
      acc += Math.hypot(p.x - prev.x, p.y - prev.y); prev = p;
      th.push(a); len.push(acc);
    }
    const s0 = len[N / 2]! - layW.width / 2;
    const at = (s: number) => {
      let lo = 0, hi = N;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (len[m]! < s) lo = m; else hi = m; }
      const f = clamp((s - len[lo]!) / Math.max(1e-6, len[hi]! - len[lo]!));
      return lerp(th[lo]!, th[hi]!, f);
    };
    const sizeS = sizeW * cam.s;
    drawLyric(c, line, t, {
      x: 0, y: 0, align: 'left', size: sizeS, family: fam, unsungAlpha: ink.unsungAlpha ?? 0.3, alpha: ink.alpha ?? 1,
      charTransform: (_ch, _i, st) => {
        const b = st.box;
        const a = at(s0 + (b.x + b.w / 2) / cam.s);
        const p = proj(cam, onRing(ring, a, k)), p2 = proj(cam, onRing(ring, a + dir * 0.01, k));
        const ang = Math.atan2(p2.y - p.y, p2.x - p.x);
        const base: CharXform = { dx: p.x - (b.x + b.w / 2), dy: p.y - (b.y - sizeS * 0.35), rot: ang };
        const x = extra?.(st, p, ang);
        if (!x) return base;
        return { dx: (base.dx ?? 0) + (x.dx ?? 0), dy: (base.dy ?? 0) + (x.dy ?? 0), rot: x.rot ?? ang, scale: x.scale, alpha: x.alpha };
      },
      drawChar: (cc, ch, st) => {
        if (ink.lip) { cc.fillStyle = ink.lip; cc.fillText(ch, sizeS * 0.035, sizeS * 0.035); }
        cc.fillStyle = st.sung ? ink.sung : ink.unsung;
        cc.fillText(ch, 0, 0);
      },
    });
  }

  // ---------------------------------------------------------------- variants
  private cam(frame: string, t0: number, t: number): Cam {
    const drift = 1 + 0.018 * (t - t0);
    const C: Record<string, Cam> = {
      // gaze
      two: { s: 1.12, fx: 960, fy: 540, rot: 0 },
      tightL: { s: 1.75, fx: 447, fy: 640, rot: 0 },
      ring: { s: 2.5, fx: 470, fy: 700, rot: 0.06 },
      overlap: { s: 2.2, fx: 960, fy: 540, rot: 0 },
      tightR: { s: 1.6, fx: 1230, fy: 540, rot: 0 },
      shut: { s: 0.82, fx: 960, fy: 560, rot: 0 },
      // ai
      full: { s: 1.0, fx: 960, fy: 480, rot: 0 },
      pupil: { s: 2.4, fx: 960, fy: 540, rot: 0 },
      reflect: { s: 3.3, fx: 945, fy: 520, rot: 0.14 },
    };
    const k = C[frame] ?? C.two!;
    return { ...k, s: k.s * drift };
  }

  private gaze(c: CanvasRenderingContext2D, f: Frame, frame: string, cam: Cam): PostOverrides {
    const au = this.ctx.audio, t = f.t, P = this.P;
    const [l11, l12] = this.lines;
    const face = frame === 'two' || frame === 'shut' ? 0.84 : 1;
    const shutT = this.list.find((s) => s.s.frame === 'shut')?.t ?? this.ctx.end;
    const close = smoothstep(shutT, shutT + 0.45, t);
    const bp = beatPulse(au, t, 0.14), db = downbeatPulse(au, t, 0.35);
    const turn = (TAU / 12) * this.step(t);
    const ap = 230 * (0.4 + 0.03 * Math.sin(t * 1.3)) * (1 - close);
    const L: Iris = { c: { x: 470, y: 540 }, R: 230, sx: face, sy: 1, n: 9, ap, phi: 0.2 + turn, hot: -1, edge: bp };
    const Rr: Iris = { c: { x: 1450, y: 540 }, R: 230, sx: face, sy: 1, n: 9, ap, phi: 0.5 - turn, hot: -1, edge: bp };
    const glow = 0.8 * (1 - close) + 0.5 * bp * (1 - close);
    this.setIrisGL(0, cam, L, glow, turn * 0.25);
    this.setIrisGL(1, cam, Rr, glow, -turn * 0.25);
    const u = this.pass.u;
    u.uExpo!.value = 0.55 * bp;
    u.uLeak!.value = 0.12 + 0.75 * db;
    u.uGrainT!.value = Math.floor(t * 24);

    // the closed room's wall: a sunlit plaster slab between the eyes, its shadow raking to the right
    const quad = (x0: number, x1: number) => {
      const w0 = proj(cam, { x: x0, y: -400 }), w1 = proj(cam, { x: x1, y: -400 }), w2 = proj(cam, { x: x1, y: 1500 }), w3 = proj(cam, { x: x0, y: 1500 });
      c.beginPath(); c.moveTo(w0.x, w0.y); c.lineTo(w1.x, w1.y); c.lineTo(w2.x, w2.y); c.lineTo(w3.x, w3.y); c.closePath();
      return [w0, w1] as const;
    };
    let [a0, a1] = quad(995, 1150);
    const sh = c.createLinearGradient(a0.x, a0.y, a1.x, a1.y);
    sh.addColorStop(0, pcss(P, 'deep', 0.22)); sh.addColorStop(1, pcss(P, 'deep', 0));
    c.fillStyle = sh; c.fill();
    [a0, a1] = quad(925, 995);
    const pl = c.createLinearGradient(a0.x, a0.y, a1.x, a1.y);
    pl.addColorStop(0, pcss(P, 'hi')); pl.addColorStop(0.25, pmix(P, 'ground', 'hi', 0.5)); pl.addColorStop(1, pmix(P, 'ground', 'mid', 0.45));
    c.fillStyle = pl; c.fill();

    // the irises
    this.blades(c, cam, L, false);
    this.blades(c, cam, Rr, false);

    // halation: the blown aperture bleeds red-orange onto the blades (the film's own glow), pulsing with the beat
    for (const ir of [L, Rr]) {
      if (ir.ap < 1) continue;
      const C = proj(cam, ir.c), r0 = ir.ap * cam.s * 0.8, r1 = ir.ap * cam.s * (1.9 + 0.3 * bp);
      const hg = c.createRadialGradient(C.x, C.y, r0, C.x, C.y, r1);
      hg.addColorStop(0, pcss(P, 'signal', 0.55 * (1 - close))); hg.addColorStop(0.35, pcss(P, 'signal', 0.22 * (1 - close))); hg.addColorStop(1, pcss(P, 'signal', 0));
      c.fillStyle = hg; c.beginPath(); c.arc(C.x, C.y, r1, 0, TAU); c.fill();
    }

    // line 11 engraved around the left ring (bottom arc reads left to right), in the brass
    const onRingL = stateAt(this.list, t).surface === 'ringL';
    this.ringLyric(c, l11!, t, cam, L, 1.16, Math.PI / 2, -1, 44,
      { sung: pcss(P, 'text'), unsung: pcss(P, 'deep'), unsungAlpha: 0.4, alpha: onRingL ? 1 : 0, lip: pcss(P, 'hi', 0.8) });

    // each eye's light: a cone that reaches just past the wall; the words live only where both cones meet
    const lit = (1 - close) * (0.75 + 0.25 * bp);
    const beam = (ir: Iris, xEnd: number) => {
      const half = Math.tan(0.62) * Math.abs(xEnd - ir.c.x) * (ir.ap / (230 * 0.4) || 0);
      const a = proj(cam, ir.c), b = proj(cam, { x: xEnd, y: 540 - half }), d = proj(cam, { x: xEnd, y: 540 + half });
      c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.lineTo(d.x, d.y); c.closePath();
      return { a, b: proj(cam, { x: xEnd, y: 540 }) };
    };
    for (const [ir, xe] of [[L, 1000], [Rr, 920]] as const) {
      const g = beam(ir, xe);
      const gr = c.createLinearGradient(g.a.x, g.a.y, g.b.x, g.b.y);
      gr.addColorStop(0, pcss(P, 'hi', 0));
      gr.addColorStop(0.3, pcss(P, 'hi', 0.22 * lit));
      gr.addColorStop(1, pcss(P, 'hi', 0.5 * lit));
      c.fillStyle = gr; c.fill();
    }
    // the overlap: clip to both cones, burned to white; line 12 is printed only there
    c.save();
    beam(L, 1000); c.clip();
    beam(Rr, 920); c.clip();
    c.fillStyle = pcss(P, 'hi', 0.92 * lit); c.fillRect(0, 0, W, H);
    c.fillStyle = pcss(P, 'signal', 0.12 * bp * lit); c.fillRect(0, 0, W, H);
    const lay = layoutLine(c, l12!, F.slam(), 50, undefined, true);
    const top = proj(cam, { x: 960, y: 540 - lay.height / 2 });
    drawLyric(c, l12!, t, {
      x: top.x, y: top.y, size: 50 * cam.s, vertical: true, rotation: cam.rot, family: F.slam(), unsungAlpha: 0.3, alpha: lit,
      charTransform: (_ch, _i, st) => ({ scale: st.sung ? 1 + 0.12 * (1 - st.frac) : 1 }),
      drawChar: (cc, ch, st) => { cc.fillStyle = st.sung ? pcss(P, 'text') : pcss(P, 'mid'); cc.fillText(ch, 0, 0); },
    });
    c.restore();

    // gate weave: the film frame wanders a pixel or two, a new offset each film frame
    const fr = Math.floor(t * 24);
    const weave: [number, number] = [(hash(fr, 3) - 0.5) * 3, (hash(fr, 7) - 0.5) * 4];
    return {
      zoom: 1 + 0.05 * db,
      shake: [weave[0], weave[1] + 5 * bp * (1 - close)],
      flash: 0.07 * bp * (1 - close),
      bloom: 0.3, bloomThreshold: 0.9, bloomRadius: 0.5,
      halation: 0.45,
      grain: 0.09,
      vignette: 0,
    };
  }

  private ai(c: CanvasRenderingContext2D, f: Frame, frame: string, cam: Cam): PostOverrides {
    const au = this.ctx.audio, t = f.t, P = this.P;
    const [l18, l19] = this.lines;
    const bp = beatPulse(au, t, 0.12), kp = kickPulse(au, t, 0.1);
    // a gulp per syllable of line 18: the aperture dilates as it takes each word in
    let gulp = 0;
    for (const w of l18!.words) for (const [a] of w.syl ?? [[w.start, w.end]]) if (t >= a) gulp = Math.max(gulp, Math.exp(-(t - a) / 0.25));
    const R = 280;
    const full = frame === 'full';
    const ap = R * (full ? 0.34 + 0.14 * gulp - 0.035 * bp : 0.62 - 0.035 * bp);
    const ir: Iris = { c: { x: 960, y: 540 }, R, sx: 1, sy: 1, n: 7, ap, phi: (TAU / 14) * this.step(t, 0.09), hot: -1, edge: bp };
    const glint = smoothstep(this.ctx.end - 0.5, this.ctx.end - 0.05, t);
    this.setIrisGL(0, cam, ir, (full ? 0.3 : 0.12) + 0.35 * gulp + 0.9 * glint, this.step(t) * 0.12);
    this.setIrisGL(1, cam, null, 0, 0);
    // the cyc: horizon (world y 880) and the eye's soft contact shadow on the floor
    const hz = proj(cam, { x: 960, y: 880 }), shc = proj(cam, { x: 960, y: 960 });
    const u = this.pass.u;
    (u.uCyc!.value as THREE.Vector4).set(hz.y, cam.s, shc.x, shc.y);
    u.uLeak!.value = 1;
    // the key softbox's reflection snaps to a new place on the chrome every beat
    const bi = beatIndex(au, t);
    u.uExpo!.value = lerp(-0.2 + 0.9 * (hash(bi, 5) - 0.5), 0.35 + 0.5 * (hash(bi + 1, 5) - 0.5), 1 - ease.outExpo(clamp((t - (au.beats[bi] ?? t)) / 0.09)));
    this.blades(c, cam, ir, true);

    const suck = (st: CharState): number => {
      const w = l18!.words[st.word]!, a0 = (w.syl ?? [[w.start, w.end]])[st.syl]![0];
      return ease.inCubic(clamp((t - a0 - 0.2) / 0.55));
    };
    if (full) {
      // line 18 on the cyc just outside the chrome rim; each word, once sung, is pulled spiralling into the aperture
      this.ringLyric(c, l18!, t, cam, ir, 1.45, -Math.PI / 2, 1, 84, { sung: pcss(P, 'text'), unsung: pcss(P, 'mid'), unsungAlpha: 0.6 }, (st, p, ang) => {
        const k = suck(st);
        if (k <= 0) return null;
        const C = proj(cam, ir.c);
        const dx = p.x - C.x, dy = p.y - C.y, r = Math.hypot(dx, dy) * (1 - k), th = Math.atan2(dy, dx) + 1.6 * k;
        return { dx: C.x + Math.cos(th) * r - p.x, dy: C.y + Math.sin(th) * r - p.y, rot: ang + 2.2 * k, scale: 1 - 0.8 * k, alpha: 1 - smoothstep(0.75, 1, k) };
      });
    } else {
      // inside the pupil: the stolen words drift in the black glass, and line 19 is the reflection on its front
      c.save();
      this.aperturePath(c, cam, ir, 1.001); c.clip();
      const C = proj(cam, ir.c);
      const size = 15 * cam.s;
      drawLyric(c, l18!, t, {
        x: C.x, y: C.y + ap * cam.s * 0.42, size, align: 'center', family: F.slam(),
        charTransform: (_ch, i) => {
          // kept in reading order, suspended in the glass: a slow bob and tilt, a twitch on the kick
          const ph = hash(i, 11) * TAU, lt = t - this.ctx.start;
          return { dx: 6 * cam.s * Math.sin(lt * 1.3 + ph), dy: 7 * cam.s * Math.sin(lt * 1.7 + ph), rot: 0.12 * Math.sin(lt * 1.1 + ph), scale: 0.95 + 0.25 * kp };
        },
        drawChar: (cc, ch) => { cc.fillStyle = pcss(P, 'signal'); cc.fillText(ch, 0, 0); },
      });
      // the reflection: line 19 on a shallow arc across the pupil glass (a big ring centred below)
      const glass: Ring = { c: { x: 960, y: 540 + ap * 2.6 }, R: ap * 2.75, sx: 1, sy: 1 };
      this.ringLyric(c, l19!, t, cam, glass, 1, -Math.PI / 2, 1, 30, { sung: pcss(P, 'hi'), unsung: pcss(P, 'hi'), unsungAlpha: 0.25, alpha: 0.96 }, (st) => (
        st.sung ? { scale: 1 + 0.15 * (1 - st.frac) } : null));
      c.restore();
    }
    // exit: a glint in the pupil flares
    if (glint > 0) {
      const g = proj(cam, { x: 960 + 0.2 * ap, y: 540 - 0.24 * ap });
      for (const a of [0, Math.PI / 2, Math.PI / 4, -Math.PI / 4]) {
        const Lg = (a === 0 || a === Math.PI / 2 ? 520 : 170) * glint * cam.s;
        const gr = c.createLinearGradient(g.x - Math.cos(a) * Lg, g.y - Math.sin(a) * Lg, g.x + Math.cos(a) * Lg, g.y + Math.sin(a) * Lg);
        gr.addColorStop(0, pcss(P, 'hi', 0)); gr.addColorStop(0.5, pcss(P, 'hi', glint)); gr.addColorStop(1, pcss(P, 'hi', 0));
        c.strokeStyle = gr; c.lineWidth = 3 * cam.s;
        c.beginPath(); c.moveTo(g.x - Math.cos(a) * Lg, g.y - Math.sin(a) * Lg); c.lineTo(g.x + Math.cos(a) * Lg, g.y + Math.sin(a) * Lg); c.stroke();
      }
    }
    return {
      zoom: 1 + 0.025 * kp,
      shake: [0, -4 * bp],
      flash: 0.05 * glint * glint,
      bloom: 0.1 + 0.3 * glint, bloomThreshold: 1.0, bloomRadius: 0.35,
      grain: 0.02,
      vignette: 0,
    };
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer } = this.ctx;
    const sh = shotAt(this.list, f.t);
    const st = stateAt(this.list, f.t);
    const frame = String(st.frame);
    const cam = this.cam(frame, sh.t0, f.t);
    const L = this.layer, c = L.ctx;
    L.clear();
    this.pass.u.uBeat!.value = beatPulse(this.ctx.audio, f.t, 0.15);
    const post = this.plate.variant === 'ai' ? this.ai(c, f, frame, cam) : this.gaze(c, f, frame, cam);
    L.upload();
    this.pass.render(renderer, out);
    this.ctx.comp.draw(renderer, L.texture, out, { mode: 'normal' });
    return post;
  }

  override dispose() { this.layer?.texture.dispose(); }
}
