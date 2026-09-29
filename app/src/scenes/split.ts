// SPLIT / ascii — p20-split-ascii, lines 14–15, the boundary between virtual and real (E6 ASCII glyph raster,
// palette `ascii`: amber on near-black). ONE lit room (a globe lamp in front of a wall, a window's light on the wall)
// is torn vertically into two media:
//   left  = the room as an amber ASCII Hangul raster. The world is cut into 20 px cells; each cell's luminance picks
//           a glyph from a density ramp that is MEASURED at init: every candidate (a few jamo, then the syllables of
//           lines 14–15 themselves) is rasterised from its font outline into a 48x48 bitmap and ordered by filled-
//           pixel count. Cells inside a sung lyric letter are drawn with that letter's own syllable.
//   right = the same room as continuous light: a luminance field evaluated per frame, tone-mapped through the
//           palette (ground -> deep -> mid -> hi) and upscaled soft, with the lyric letters as solid, lit objects.
// The lyric strip ("가상과  현실 사이의 경계는 이제") slides right-to-left across the tear, one syllable per sung
// syllable: each syllable lights up (solid) on the real side as it is sung, drifts into the tear while it sounds,
// and comes out the other side as glyph cells. Unsung letters are dark, unlit shapes / dim cells, never early.
// Beat: the tear steps right and widens one step per beat (spring snap, its lip flares); the raster side re-rasters
// one density step on the kick (falls back to the beat grid); in the macro the swallowed cells flip over.
// Exit: the tear sweeps off the right edge on the last three beats and the raster swallows the frame.
// Shots (./split.shots): wide -> close on the tear -> dutch tilt, the tear gapes -> macro, the tear sweeps.
import type * as THREE from 'three';
import { Scene, type Frame, type PostOverrides } from '../engine/scene';
import { Layer2D, clearRT } from '../engine/gl';
import { palette, pcss, plin, pmix, type NamedPalette, type Role } from '../engine/palette';
import { drawLyric, layoutLine, ownedLines, F, type CharState, type LineLayout } from '../engine/lyric';
import { ot } from '../engine/type';
import { beatPulse, kickPulse, downbeatPulse, beatIndex } from '../engine/beat';
import { stateAt, shotAt, type PlateInfo, type Shot } from '../engine/shots';
import { hash, clamp, lerp, fbm1, ease, smoothstep } from '../engine/util';
import type { Line } from '../engine/lyrics';
import { shots, type Cam, type Tear, type Raster } from './split.shots';

const W = 1920, H = 1080;
// world grid: cells of CS world px over [OX, OX + GX*CS] x [OY, OY + GY*CS] (the tilt shows past the frame edges)
const CS = 18, OX = -400, OY = -400, GX = 152, GY = 105;
const SX = GX * 2, SY = GY * 2; // 2x2 coverage samples per cell
// the continuous (real) side is evaluated at RW x RH screen samples and upscaled smooth
const RW = 480, RH = 270;
// atlas: one glyph per AP x AP tile, TONES rows
const AP = 64, TONES = 5;
// the lyric strip
const LSIZE = 320, ROW_Y = 720, SEAM0 = 900, SEAM_STEP = 12;
// the room
const SPH = { x: 800, y: 330, r: 245 };
const LDIR = norm3(0.12, -0.55, 0.83);
const HDIR = norm3(LDIR[0], LDIR[1], LDIR[2] + 1);

function norm3(x: number, y: number, z: number): [number, number, number] {
  const l = Math.hypot(x, y, z);
  return [x / l, y / l, z / l];
}

// ------------------------------------------------------------------ pure outline rasteriser (nonzero winding)
type Poly = number[]; // flat x,y pairs
/** Flatten an opentype path's commands into closed polygons. */
function flatten(cmds: { type: string; x?: number; y?: number; x1?: number; y1?: number; x2?: number; y2?: number }[]): Poly[] {
  const out: Poly[] = [];
  let cur: Poly = [], px = 0, py = 0;
  const N = 6;
  for (const c of cmds) {
    if (c.type === 'M') { if (cur.length > 4) out.push(cur); cur = [c.x!, c.y!]; px = c.x!; py = c.y!; }
    else if (c.type === 'L') { cur.push(c.x!, c.y!); px = c.x!; py = c.y!; }
    else if (c.type === 'Q') {
      for (let i = 1; i <= N; i++) { const u = i / N, v = 1 - u; cur.push(v * v * px + 2 * v * u * c.x1! + u * u * c.x!, v * v * py + 2 * v * u * c.y1! + u * u * c.y!); }
      px = c.x!; py = c.y!;
    } else if (c.type === 'C') {
      for (let i = 1; i <= N; i++) {
        const u = i / N, v = 1 - u;
        cur.push(v * v * v * px + 3 * v * v * u * c.x1! + 3 * v * u * u * c.x2! + u * u * u * c.x!, v * v * v * py + 3 * v * v * u * c.y1! + 3 * v * u * u * c.y2! + u * u * u * c.y!);
      }
      px = c.x!; py = c.y!;
    } else if (c.type === 'Z') { if (cur.length > 4) out.push(cur); cur = []; }
  }
  if (cur.length > 4) out.push(cur);
  return out;
}

/** Fill polygons (already in sample space: sample (i, j) sits at (i, j)) into a w x h grid; calls hit(i, j). */
function scanFill(polys: Poly[], w: number, h: number, hit: (i: number, j: number) => void) {
  let y0 = Infinity, y1 = -Infinity;
  for (const p of polys) for (let k = 1; k < p.length; k += 2) { y0 = Math.min(y0, p[k]!); y1 = Math.max(y1, p[k]!); }
  const ja = Math.max(0, Math.ceil(y0)), jb = Math.min(h - 1, Math.floor(y1));
  const xs: number[] = [], ds: number[] = [];
  for (let j = ja; j <= jb; j++) {
    xs.length = 0; ds.length = 0;
    for (const p of polys) {
      const n = p.length >> 1;
      for (let k = 0; k < n; k++) {
        const ax = p[2 * k]!, ay = p[2 * k + 1]!, bx = p[(2 * k + 2) % p.length]!, by = p[(2 * k + 3) % p.length]!;
        if ((ay <= j && by > j) || (by <= j && ay > j)) { xs.push(ax + ((j - ay) / (by - ay)) * (bx - ax)); ds.push(by > ay ? 1 : -1); }
      }
    }
    const ord = xs.map((_, i) => i).sort((a, b) => xs[a]! - xs[b]!);
    let wind = 0;
    for (let q = 0; q < ord.length - 1; q++) {
      wind += ds[ord[q]!]!;
      if (wind === 0) continue;
      const ia = Math.max(0, Math.ceil(xs[ord[q]!]!)), ib = Math.min(w - 1, Math.floor(xs[ord[q + 1]!]!));
      for (let i = ia; i <= ib; i++) hit(i, j);
    }
  }
}

function rgb8(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

interface Cap { m: DOMMatrix; ch: string; sung: boolean; frac: number }
interface CamT { s: number; rot: number; fx: number; fy: number }
interface Anchor { t: number; x: number; w: number }

export default class Split extends Scene {
  private P!: NamedPalette;
  private layer!: Layer2D;
  private list: Shot[] = [];
  private plate!: PlateInfo;
  private lines: Line[] = [];
  private lay: (LineLayout | null)[] = [];
  private lineX: number[] = [0, 0];
  private anchors: Anchor[] = [];
  private beat0 = 0;
  private tMacro = 0;
  private tTilt = 0;
  private edgeR = new Float32Array(0); // tear jag, raster lip
  private edgeS = new Float32Array(0); // tear jag, solid lip
  // raster
  private ramp: string[] = [];
  private rampD: number[] = [];
  private gIndex = new Map<string, number>();
  private atlas!: HTMLCanvasElement;
  private cov = new Float32Array(GX * GY);
  private covCh = new Int16Array(GX * GY);
  private caps: Cap[] = [];
  private polyCache = new Map<string, Poly[]>();
  // the continuous side
  private field!: HTMLCanvasElement;
  private fctx!: CanvasRenderingContext2D;
  private img!: ImageData;
  private lut = new Uint8ClampedArray(256 * 3);

  override init() {
    this.plate = this.ctx.params as PlateInfo;
    // one composition: 'ascii' is the only split variant in the v3 cut list
    if (this.plate.variant !== 'ascii') console.warn(`split: unknown variant ${this.plate.variant}, rendering 'ascii'`);
    this.P = palette(this.ctx.params.look?.palette ?? 'ascii');
    this.list = shots(this.plate, this.ctx.audio);
    this.tTilt = this.list.find((s) => s.s.cam === 'tilt')?.t ?? this.ctx.start + 3.7;
    this.tMacro = this.list.find((s) => s.s.cam === 'macro')?.t ?? this.ctx.start + 5.8;
    this.lines = ownedLines(this.ctx);
    this.layer = new Layer2D();
    this.beat0 = beatIndex(this.ctx.audio, this.ctx.start + 1e-3);

    // torn lips: a shared low-frequency tear + an independent fine tooth per side (they almost fit together)
    const n = Math.ceil((GY * CS) / 5) + 2;
    this.edgeR = new Float32Array(n);
    this.edgeS = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const y = OY + i * 5;
      const base = 34 * fbm1(y * 0.0035, 3, 41) + 9 * fbm1(y * 0.03, 2, 42);
      this.edgeR[i] = base + 5 * (hash(i, 43) - 0.5);
      this.edgeS[i] = base + 6 * (hash(i, 44) - 0.5) + 4 * fbm1(y * 0.2, 1, 45);
    }

    // the lyric strip: line 14, a word gap, line 15 on one baseline
    const c = this.layer.ctx;
    this.lay = this.lines.map((l) => layoutLine(c, l, F.slam(), LSIZE));
    this.lineX = [0, (this.lay[0]?.width ?? 0) + LSIZE * 0.55];
    // anchors: one per syllable (first char of it): its start time and centre on the strip
    this.lines.forEach((line, li) => {
      const lay = this.lay[li];
      if (!lay) return;
      for (const b of lay.chars) {
        const s0 = line.words[b.word]?.syl?.[b.syl]?.[0] ?? line.words[b.word]!.start;
        if (!this.anchors.some((a) => Math.abs(a.t - s0) < 1e-4)) this.anchors.push({ t: s0, x: this.lineX[li]! + b.x + b.w / 2, w: b.w });
      }
    });
    this.anchors.sort((a, b) => a.t - b.t);

    this.buildRamp();
    this.buildAtlas();

    // the continuous side: a small canvas the field is written into, upscaled smooth on draw
    this.field = document.createElement('canvas');
    this.field.width = RW; this.field.height = RH;
    this.fctx = this.field.getContext('2d')!;
    this.img = this.fctx.createImageData(RW, RH);
    // tone LUT: ground -> deep -> mid -> hi (piecewise, the knees where the photographic tone sits)
    const G = rgb8(this.P.ground), D = rgb8(this.P.deep), M = rgb8(this.P.mid), Hh = rgb8(this.P.hi);
    for (let i = 0; i < 256; i++) {
      const v = i / 255;
      let a: number[], b: number[], k: number;
      if (v < 0.4) { a = G; b = D; k = v / 0.4; } else if (v < 0.82) { a = D; b = M; k = (v - 0.4) / 0.42; } else { a = M; b = Hh; k = (v - 0.82) / 0.18; }
      for (let q = 0; q < 3; q++) this.lut[i * 3 + q] = a[q]! + (b[q]! - a[q]!) * k;
    }
  }

  /** Outline of one character (glyph-local, y down, baseline at 0) at `size`, flattened, cached. */
  private glyphPolys(family: string, ch: string, size: number): Poly[] {
    const key = `${family}|${ch}|${size}`;
    let p = this.polyCache.get(key);
    if (!p) {
      p = flatten(ot(family).getPath(ch, 0, 0, size).commands as never);
      this.polyCache.set(key, p);
    }
    return p;
  }

  /** The density ramp, measured: rasterise each candidate into a 48x48 bitmap and count filled pixels. */
  private buildRamp() {
    const fam = F.hangul(), font = ot(fam);
    const lyr = Array.from(new Set(this.lines.map((l) => l.text).join('').replace(/\s/g, '')));
    const cands = ['.', ':', '-', '=', 'ㆍ', 'ㅡ', 'ㄱ', 'ㄴ', 'ㅅ', 'ㅁ', 'ㅂ', ...lyr, '를', '뭘', '뷁', '쀍', '뾟', '홟'];
    const N = 48;
    const meas: { ch: string; d: number }[] = [];
    for (const ch of cands) {
      if (font.charToGlyph(ch).index === 0) continue; // not in the face: never trust a .notdef box
      // em box: baseline at 0.82 N, glyph centred by advance
      const size = N * 0.9, adv = font.getAdvanceWidth(ch, size);
      const polys = this.glyphPolys(fam, ch, size).map((p) => p.map((v, i) => (i % 2 ? v + N * 0.82 : v + (N - adv) / 2)));
      let n = 0;
      scanFill(polys, N, N, () => { n++; });
      meas.push({ ch, d: n / (N * N) });
    }
    meas.sort((a, b) => a.d - b.d);
    // drop levels whose density is within 1.2 % of the previous kept one (prefer the lyric's own syllables)
    const kept: { ch: string; d: number }[] = [];
    for (const m of meas) {
      const last = kept[kept.length - 1];
      if (last && m.d - last.d < 0.012) { if (lyr.includes(m.ch) && !lyr.includes(last.ch)) kept[kept.length - 1] = m; continue; }
      kept.push(m);
    }
    this.ramp = kept.map((k) => k.ch);
    this.rampD = kept.map((k) => k.d);
    // lyric syllables not kept on the ramp still need atlas tiles (letter cells draw their own syllable)
    const all = [...this.ramp, ...lyr.filter((ch) => !this.ramp.includes(ch))];
    all.forEach((ch, i) => this.gIndex.set(ch, i));
    (globalThis as { __splitRamp?: unknown }).__splitRamp = kept.map((k) => `${k.ch}:${(k.d * 100).toFixed(1)}`).join(' ');
  }

  private buildAtlas() {
    const n = this.gIndex.size, fam = F.hangul();
    this.atlas = document.createElement('canvas');
    this.atlas.width = n * AP; this.atlas.height = TONES * AP;
    const a = this.atlas.getContext('2d')!;
    // tones 0..3 = dim -> hi glyphs on the ground; tone 4 = ground-coloured glyph (inverse video on a lit cell)
    const tones: [Role, Role, number][] = [['deep', 'mid', 0.55], ['mid', 'mid', 0], ['mid', 'hi', 0.5], ['hi', 'hi', 0], ['ground', 'ground', 0]];
    a.font = `${AP * 0.9}px "${fam}"`;
    a.textBaseline = 'alphabetic';
    a.textAlign = 'left';
    for (const [ch, i] of this.gIndex) {
      const adv = a.measureText(ch).width;
      tones.forEach(([r0, r1, k], ti) => {
        a.fillStyle = pmix(this.P, r0, r1, k);
        a.fillText(ch, i * AP + (AP - adv) / 2, ti * AP + AP * 0.82);
      });
    }
  }

  // ------------------------------------------------------------------ the room (one luminance field, both media)
  /** Luminance 0..1 of the lit room at world (x, y). */
  private lum(x: number, y: number): number {
    // back wall: a slow vertical falloff; the floor below a soft skirting line
    let L = 0.24 - 0.08 * (y / H);
    const floor = smoothstep(915, 945, y);
    L = lerp(L, 0.1 + 0.25 * Math.exp(-(((x - 1250) / 520) ** 2) - (((y - 1010) / 90) ** 2)), floor);
    // the window's light on the wall: a sheared quad with soft edges and the mullion shadows
    const u = (x - 1000 + 0.32 * (y - 110)) / 600, v = (y - 110) / 540;
    if (u > -0.05 && u < 1.05 && v > -0.05 && v < 1.05 && floor < 1) {
      const soft = smoothstep(-0.03, 0.03, u) * smoothstep(1.03, 0.97, u) * smoothstep(-0.03, 0.03, v) * smoothstep(1.03, 0.97, v);
      const mull = 1 - 0.8 * (1 - smoothstep(0.012, 0.03, Math.abs(u - 0.5))) - 0.8 * (1 - smoothstep(0.012, 0.03, Math.abs(v - 0.42)));
      L += (1 - floor) * soft * Math.max(0, mull) * (0.3 + 0.16 * (1 - v) + 0.12 * u * (1 - v));
    }
    // the globe's soft shadow on the wall (down-right: the key light is up-left, in front)
    const sx = (x - SPH.x - 70) / (SPH.r * 1.15), sy = (y - SPH.y - 150) / (SPH.r * 1.05);
    L *= 1 - 0.6 * (1 - smoothstep(0.55, 1.15, Math.hypot(sx, sy))) * (1 - floor);
    // the globe
    const dx = (x - SPH.x) / SPH.r, dy = (y - SPH.y) / SPH.r, r2 = dx * dx + dy * dy;
    if (r2 < 1.02) {
      const nz = Math.sqrt(Math.max(0, 1 - r2));
      const dif = Math.max(0, dx * LDIR[0] + dy * LDIR[1] + nz * LDIR[2]);
      const spec = Math.pow(Math.max(0, dx * HDIR[0] + dy * HDIR[1] + nz * HDIR[2]), 36);
      const rim = 0.1 * Math.pow(1 - nz, 3) * smoothstep(-0.2, 0.6, dx); // bounce from the lit wall, right rim
      const g = 0.05 + 0.8 * Math.pow(dif, 1.5) + 0.45 * spec + rim;
      L = lerp(L, g, 1 - smoothstep(0.97, 1.02, r2));
    }
    return clamp(L);
  }

  // ------------------------------------------------------------------ time
  /** Beats since the plate start, as a spring-snapped continuous count (steps land exactly on the beat). */
  private steps(t: number, from = this.beat0): number {
    const au = this.ctx.audio, bi = beatIndex(au, t), k = bi - from;
    if (k < 0) return 0;
    const tau = t - au.beats[bi]!;
    const snap = 1 - Math.exp(-tau / 0.04) * Math.cos(tau * 34);
    return Math.max(0, k - 1 + snap);
  }

  /** Where the tear is (world x) before the sweep: one step right per beat. */
  private seamBase(t: number): number { return SEAM0 + SEAM_STEP * this.steps(Math.min(t, this.tMacro)); }

  /** The exit sweep: the last three beats throw the tear off the right edge of the macro. */
  private sweep(t: number, tear: Tear): number {
    if (tear !== 'sweep') return 0;
    const au = this.ctx.audio, b = beatIndex(au, this.tMacro + 1e-3), k = beatIndex(au, t) - b;
    const X = [0, 120, 250, 470, 470];
    if (k <= 0) return 0;
    const tau = t - au.beats[beatIndex(au, t)]!;
    const snap = 1 - Math.exp(-tau / 0.05) * Math.cos(tau * 26);
    return lerp(X[Math.min(k - 1, 4)]!, X[Math.min(k, 4)]!, snap);
  }

  /** Width of the torn gap (world px). */
  private gap(t: number, tear: Tear): number {
    if (tear === 'gape') return 64 + 14 * (this.steps(t) - this.steps(this.tTilt));
    if (tear === 'sweep') return 46;
    return 8 + 4 * this.steps(t);
  }

  /** Strip position of the point that sits on the tear: the sung syllable snaps onto the real side as it starts,
   *  then drifts into the tear while it sounds. */
  private anchorX(t: number): number {
    const A = this.anchors;
    if (!A.length) return 0;
    let k = -1;
    for (let i = 0; i < A.length; i++) if (t >= A[i]!.t) k = i;
    const onReal = (a: Anchor) => a.x - 0.22 * a.w; // just started: centre right of the tear
    const inTear = (a: Anchor) => a.x + 0.12 * a.w; // at its end: centre just past the tear
    if (k < 0) return A[0]!.x - 0.75 * A[0]!.w;
    const a = A[k]!, end = A[k + 1]?.t ?? a.t + 0.6;
    const drift = lerp(onReal(a), inTear(a), ease.inOutQuad(clamp((t - a.t) / Math.max(0.1, end - a.t))));
    const prev = k > 0 ? inTear(A[k - 1]!) : A[0]!.x - 0.75 * A[0]!.w;
    return lerp(prev, drift, ease.outCubic(clamp((t - a.t) / 0.1)));
  }

  private camera(cam: Cam, t: number, t0: number, seam: number): CamT {
    const dt = t - t0;
    switch (cam) {
      case 'close': return { s: 1.75, rot: 0, fx: seam + 60 - dt * 10, fy: 650 };
      case 'tilt': return { s: 1.42, rot: -0.2, fx: seam + 30 + dt * 8, fy: 640 };
      case 'macro': return { s: 2.5, rot: 0, fx: this.seamBase(this.tMacro) + 20 + dt * 6, fy: ROW_Y };
      default: return { s: 1, rot: 0, fx: 960 + dt * 6, fy: 540 };
    }
  }

  private edgeAt(arr: Float32Array, y: number): number {
    const f = (y - OY) / 5, i = clamp(Math.floor(f), 0, arr.length - 2);
    return lerp(arr[i]!, arr[i + 1]!, clamp(f - i));
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, audio } = this.ctx;
    const P = this.P, t = f.t;
    const st = stateAt(this.list, t), sh = shotAt(this.list, t);
    const camK = st.cam as Cam, tear = st.tear as Tear, raster = st.raster as Raster;
    const bp = beatPulse(audio, t, 0.12), kp = kickPulse(audio, t, 0.14), dp = downbeatPulse(audio, t, 0.22);

    const seam = this.seamBase(t) + this.sweep(t, tear);
    const g = this.gap(t, tear);
    const cam = this.camera(camK, t, sh.t0, this.seamBase(t));
    const cs = Math.cos(cam.rot), sn = Math.sin(cam.rot);
    const toScreen = (x: number, y: number): [number, number] => {
      const X = (x - cam.fx) * cam.s, Y = (y - cam.fy) * cam.s;
      return [W / 2 + X * cs - Y * sn, H / 2 + X * sn + Y * cs];
    };
    const toWorld = (u: number, v: number): [number, number] => {
      const X = (u - W / 2) / cam.s, Y = (v - H / 2) / cam.s;
      return [cam.fx + X * cs + Y * sn, cam.fy - X * sn + Y * cs];
    };
    const rEdge = (y: number) => seam - g / 2 + this.edgeAt(this.edgeR, y);
    const sEdge = (y: number) => seam + g / 2 + this.edgeAt(this.edgeS, y);
    const stripX = this.seamBase(t) - this.anchorX(t);

    const L = this.layer, c = L.ctx;
    L.clear(pcss(P, 'ground'));

    // ---- 1. capture pass: where each lyric character lands in the world, and whether it is sung (drawn nowhere)
    this.caps.length = 0;
    c.save();
    c.setTransform(1, 0, 0, 1, 0, 0);
    this.lines.forEach((line, li) => {
      drawLyric(c, line, t, {
        x: stripX + this.lineX[li]!, y: ROW_Y + LSIZE * 0.35, size: LSIZE, align: 'left', family: F.slam(),
        unsungAlpha: 1, lead: li === 0 ? 0.4 : 3,
        drawChar: (cc, ch, s) => { this.caps.push({ m: cc.getTransform(), ch, sung: s.sung, frac: s.frac }); },
      });
    });
    c.restore();

    // ---- 2. the letters into the coverage grid (2x2 samples per cell)
    this.cov.fill(0);
    this.covCh.fill(-1);
    this.caps.forEach((cp, ci) => {
      const m = cp.m;
      const polys = this.glyphPolys(F.slam(), cp.ch, LSIZE).map((p) => {
        const q: Poly = new Array(p.length);
        for (let k = 0; k < p.length; k += 2) {
          const x = m.a * p[k]! + m.c * p[k + 1]! + m.e, y = m.b * p[k]! + m.d * p[k + 1]! + m.f;
          q[k] = (x - OX) / (CS / 2) - 0.5; q[k + 1] = (y - OY) / (CS / 2) - 0.5;
        }
        return q;
      });
      scanFill(polys, SX, SY, (i, j) => {
        const cell = (j >> 1) * GX + (i >> 1);
        this.cov[cell] += 0.25;
        this.covCh[cell] = ci;
      });
    });

    // ---- 3. the raster side: glyph cells from the atlas
    // visible world bbox
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const [u, v] of [[0, 0], [W, 0], [0, H], [W, H]] as const) {
      const [x, y] = toWorld(u, v);
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
    const ia = clamp(Math.floor((x0 - OX) / CS) - 1, 0, GX - 1), ib = clamp(Math.ceil((x1 - OX) / CS) + 1, 0, GX - 1);
    const ja = clamp(Math.floor((y0 - OY) / CS) - 1, 0, GY - 1), jb = clamp(Math.ceil((y1 - OY) / CS) + 1, 0, GY - 1);
    const nR = this.ramp.length;
    // the kick re-rasters the whole side one density step up (the beat grid stands in when there are no kicks)
    const lift = kp > 0.45 ? 1 : 0;
    // cells swallowed on the latest sweep step flip over (macro)
    const au = audio, bi = beatIndex(au, t), tauB = bi >= 0 ? t - au.beats[bi]! : 9;
    const seamPrev = this.seamBase(t) + this.sweep(bi >= 0 ? au.beats[bi]! - 1e-3 : t, tear);
    // lit cell of a sung letter: mid -> hi, a step brighter on the beat
    const cellFill = pmix(P, 'mid', 'hi', 0.35 + 0.5 * bp);
    c.save();
    c.translate(W / 2, H / 2);
    c.rotate(cam.rot);
    c.scale(cam.s, cam.s);
    c.translate(-cam.fx, -cam.fy);
    for (let j = ja; j <= jb; j++) {
      const y = OY + (j + 0.5) * CS;
      const edge = rEdge(y);
      for (let i = ia; i <= ib; i++) {
        const x = OX + (i + 0.5) * CS;
        if (x > edge) break;
        const cell = j * GX + i, cv = this.cov[cell]!;
        let gi: number, tone: number, inverse = false;
        if (cv >= 0.5) {
          const cp = this.caps[this.covCh[cell]!]!;
          if (cp.sung) {
            // a sung letter: inverse video, a lit cell with its own syllable cut out of it (the word is the raster)
            gi = this.gIndex.get(cp.ch) ?? nR - 1;
            tone = 4;
            inverse = true;
          } else {
            gi = Math.round((nR - 1) * 0.3); tone = 0; // unsung: a dim, low-density shape, never lit early
          }
        } else {
          const l = this.lum(x, y);
          const lv = clamp(Math.round(Math.pow(l, 1.25) * (nR - 1)) + lift + (cv > 0 ? 1 : 0), 0, nR - 1);
          if (lv <= 0) continue;
          gi = lv;
          tone = l < 0.3 ? 0 : l < 0.5 ? 1 : l < 0.72 ? 2 : 3;
        }
        let sy = 1;
        if (raster === 'flip' && x > rEdge(y) - (seam - seamPrev) - CS && tauB < 0.2) {
          // the swallowed band flips over on the beat: edge-on, then face-on with a small overshoot
          sy = clamp(ease.outBack(clamp(tauB / 0.2)), 0.06, 1.1);
        }
        if (inverse) {
          c.fillStyle = cellFill;
          c.fillRect(x - CS / 2 + 1, y - (CS / 2 - 1) * sy, CS - 2, (CS - 2) * sy);
        }
        c.drawImage(this.atlas, gi * AP, tone * AP, AP, AP, x - CS / 2, y - (CS / 2) * sy, CS, CS * sy);
      }
    }
    c.restore();

    // ---- 4. the real side: the same room as continuous light, clipped to the right of the solid lip
    const data = this.img.data, lut = this.lut;
    // the screen->world map is affine: walk it with a per-column step instead of a call per sample
    const [ox0, oy0] = toWorld((0.5 * W) / RW, (0.5 * H) / RH);
    const [ux, uy] = toWorld((1.5 * W) / RW, (0.5 * H) / RH), [vx, vy] = toWorld((0.5 * W) / RW, (1.5 * H) / RH);
    const dux = ux - ox0, duy = uy - oy0, dvx = vx - ox0, dvy = vy - oy0;
    for (let v = 0; v < RH; v++) {
      let x = ox0 + v * dvx, y = oy0 + v * dvy;
      for (let u = 0; u < RW; u++, x += dux, y += duy) {
        const l = this.lum(x, y);
        const q = Math.min(255, (l * 255) | 0) * 3, o = (v * RW + u) * 4;
        data[o] = lut[q]!; data[o + 1] = lut[q + 1]!; data[o + 2] = lut[q + 2]!; data[o + 3] = 255;
      }
    }
    this.fctx.putImageData(this.img, 0, 0);
    const lipPts: [number, number][] = [];
    for (let y = y0 - 40; y <= y1 + 40; y += 5) lipPts.push(toScreen(sEdge(y), y));
    c.save();
    c.beginPath();
    lipPts.forEach(([u, v], i) => (i ? c.lineTo(u, v) : c.moveTo(u, v)));
    const [fx1, fy1] = toScreen(x1 + 400, y1 + 40), [fx0, fy0] = toScreen(x1 + 400, y0 - 40);
    c.lineTo(fx1, fy1); c.lineTo(fx0, fy0);
    c.closePath();
    c.clip();
    c.imageSmoothingEnabled = true;
    c.drawImage(this.field, 0, 0, W, H);
    // the letters as solid objects in the lit room: sung ones lit from above, unsung ones dark cut-outs
    c.translate(W / 2, H / 2);
    c.rotate(cam.rot);
    c.scale(cam.s, cam.s);
    c.translate(-cam.fx, -cam.fy);
    this.lines.forEach((line, li) => {
      drawLyric(c, line, t, {
        x: stripX + this.lineX[li]!, y: ROW_Y + LSIZE * 0.35, size: LSIZE, align: 'left', family: F.slam(),
        unsungAlpha: 1, lead: li === 0 ? 0.4 : 3,
        charTransform: (_ch, _i, s: CharState) => (s.sung ? { dy: -6 * Math.pow(1 - s.frac, 3) } : undefined),
        drawChar: (cc, ch, s) => {
          const a0 = cc.globalAlpha;
          if (s.sung) {
            // lit: a soft cast shadow on the wall, then a face lit from above; it switches on as it is sung
            const on = clamp(s.frac * 6);
            cc.fillStyle = pcss(P, 'ground', 0.5 * on);
            cc.fillText(ch, 14, 18);
            cc.fillStyle = pcss(P, 'ground', 0.35 * on);
            cc.fillText(ch, 24, 30);
            const gr = cc.createLinearGradient(0, -LSIZE * 0.8, 0, LSIZE * 0.05);
            gr.addColorStop(0, pcss(P, 'hi'));
            gr.addColorStop(0.55, pcss(P, 'mid'));
            gr.addColorStop(1, pmix(P, 'mid', 'deep', 0.5));
            cc.fillStyle = pcss(P, 'deep');
            cc.fillText(ch, 0, 0);
            cc.globalAlpha = a0 * on;
            cc.fillStyle = gr;
            cc.fillText(ch, 0, 0);
            cc.globalAlpha = a0;
          } else {
            // unlit: a dark shape standing off the wall, only its rim catches the room light
            cc.fillStyle = pcss(P, 'ground', 0.85);
            cc.fillText(ch, 0, 0);
            cc.strokeStyle = pmix(P, 'deep', 'mid', 0.45, 0.9);
            cc.lineWidth = 2.5;
            cc.strokeText(ch, 0, 0);
          }
        },
      });
    });
    c.restore();

    // ---- 5. the solid lip of the tear catches the light; it flares on every beat as the tear steps
    c.save();
    c.beginPath();
    lipPts.forEach(([u, v], i) => (i ? c.lineTo(u, v) : c.moveTo(u, v)));
    c.strokeStyle = pcss(P, 'hi', 0.35 + 0.6 * bp);
    c.lineWidth = (1.5 + 3 * bp) * Math.max(1, cam.s * 0.7);
    c.stroke();
    c.restore();

    L.upload();
    clearRT(renderer, out, plin(P, 'ground'));
    this.ctx.comp.draw(renderer, L.texture, out, { mode: 'normal' });

    // hits (T2): a lateral jolt on every beat (the tear steps), a downbeat punch, an exposure kick on each cut
    const cut = Math.exp(-(t - sh.t0) / 0.12) * (sh.index > 0 ? 1 : 0);
    const sign = bi % 2 ? 1 : -1;
    return {
      zoom: 1 + Math.min(0.06, 0.03 * dp + 0.035 * cut),
      shake: [clamp(sign * (6 * bp + 4 * cut), -9, 9), clamp(-3 * dp, -6, 6)],
      exposure: 1 + 0.22 * cut + 0.08 * bp,
      vignette: camK === 'macro' ? 0.35 : 0.28,
      grain: 0.05,
      bloom: camK === 'macro' ? 0.18 : 0.08,
      bloomThreshold: 0.6,
    };
  }

  override dispose() { this.layer?.texture.dispose(); }
}
