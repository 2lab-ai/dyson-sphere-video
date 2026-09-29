// ECG — two signal plates, each its own idiom (docs/PLAN-V3.md; look = data/edit.json `look`).
// Structure comes from the pure shot list (./ecg.shots) via stateAt(); every shot changes framing, layout or topology.
//   xy    (p12, palette `scope`)  A green-phosphor XY oscilloscope (Fenderson, Oscilloscope Music): two Lissajous
//         figures, one electron beam. Brightness ∝ 1/beam speed; persistence is analytic (the curve re-drawn at t−kΔ
//         with exponential decay, no feedback buffer). Every beat steps both phases and brightens the beam. The right
//         figure falters and the left dims with it; they recover, lock to one ratio, slide into one figure, open into
//         a circle (the first orbit) and collapse to a dot. Line 13 is written by the same beam as outline strokes.
//   ridge (p30, palette `ridge`)  Unknown Pleasures (Saville 1979, pulsar CP 1919): stacked ridgelines, white on black,
//         each filled black below for occlusion. Every beat a new row enters at the front and the stack moves back one
//         row; rows born later in the line are more regular, so irregular heartbeats harden into identical machine
//         pulses row by row. Line 29 rides the back ridge. Cover → close → oblique → grazing → top: flat lines.
import type * as THREE from 'three';
import { Scene, type Frame, type PostOverrides } from '../engine/scene';
import { Layer2D, clearRT, W, H } from '../engine/gl';
import { palette, pcss, plin, type NamedPalette } from '../engine/palette';
import { drawLyric, layoutLine, ownedLines, F, type CharState } from '../engine/lyric';
import { beatPulse, kickPulse, downbeatPulse, beatIndex } from '../engine/beat';
import { stateAt, shotAt, type PlateInfo, type Shot } from '../engine/shots';
import { clamp, lerp, smoothstep, noise1, hash, ease } from '../engine/util';
import type { Line } from '../engine/lyrics';
import { shots } from './ecg.shots';

type Pt = { x: number; y: number };
type Cam = { s: number; fx: number; fy: number; rot: number };
const TAU = Math.PI * 2;
const g = (x: number, s: number) => Math.exp(-0.5 * (x / s) * (x / s));
const SAFE = 104;

/** The machine pulse (world units): a narrow spike, a dip and a low tail — exactly the same every time. */
function pulseM(d: number): number {
  return 0.22 * g(d + 34, 11) + g(d, 8) - 0.3 * g(d - 17, 8) + 0.26 * g(d - 58, 16);
}

function applyCam(c: CanvasRenderingContext2D, k: Cam) {
  c.translate(W / 2, H / 2);
  c.rotate(k.rot);
  c.scale(k.s, k.s);
  c.translate(-k.fx, -k.fy);
}

/** Perspective camera around an origin: (X, Y down, Z far) → screen x, y and the scale at that depth. */
function proj3(yaw: number, pitch: number, cx: number, cy: number, zm: number, D: number) {
  const ca = Math.cos(yaw), sa = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  return (X: number, Y: number, Z: number): [number, number, number] => {
    const x1 = X * ca + Z * sa, z1 = -X * sa + Z * ca;
    const y2 = Y * cp - z1 * sp, z2 = Y * sp + z1 * cp;
    const k = (D / Math.max(60, z2 + D)) * zm;
    return [cx + x1 * k, cy + y2 * k, k];
  };
}

// ------------------------------------------------------------------ xy geometry
/** One Lissajous figure: x = sin(a·u + φ), y = sin(b·u), centred at (cx, cy) with radius r. */
type Fig = { cx: number; cy: number; r: number; a: number; b: number; ph: number; amp: number; lum: number };
const NSEG = 900;
/** Speed buckets: segments are grouped by beam speed and stroked together (brightness ∝ 1/speed). */
const LEVELS = [1, 0.62, 0.38, 0.22];

const XY_CAM: Record<string, Cam> = {
  wide: { s: 1, fx: 960, fy: 520, rot: 0 },
  close: { s: 1.38, fx: 1180, fy: 480, rot: 0 },
  gap: { s: 1.22, fx: 960, fy: 540, rot: 0 },
  macro: { s: 2.05, fx: 1040, fy: 470, rot: 0 },
  pair: { s: 1.3, fx: 960, fy: 450, rot: -0.09 },
  orbit: { s: 1, fx: 960, fy: 510, rot: 0 },
  bezel: { s: 0.8, fx: 960, fy: 540, rot: 0 },
};

// ------------------------------------------------------------------ ridge geometry
const NROW = 46, DZ = 17, XR = 560, NS = 240;
/** hk: height scale per camera (steeper views need less height for the same read). */
type RCam = { yaw: number; pitch: number; cx: number; cy: number; zm: number; D: number; tz: number; hk: number };
const R_CAM: Record<string, RCam> = {
  cover: { yaw: 0, pitch: 1.05, cx: 960, cy: 600, zm: 1.0, D: 2600, tz: 0, hk: 1 },
  close: { yaw: 0, pitch: 0.92, cx: 960, cy: 540, zm: 1.85, D: 2000, tz: -250, hk: 0.8 },
  tilt: { yaw: 0.62, pitch: 0.6, cx: 900, cy: 620, zm: 1.12, D: 1900, tz: 0, hk: 0.6 },
  low: { yaw: -0.2, pitch: 0.2, cx: 960, cy: 760, zm: 1.55, D: 1000, tz: -330, hk: 0.45 },
  top: { yaw: 0, pitch: 1.5, cx: 960, cy: 610, zm: 1.0, D: 2600, tz: 0, hk: 1 },
  'top-wide': { yaw: 0.0, pitch: 1.53, cx: 960, cy: 630, zm: 0.8, D: 2600, tz: 0, hk: 1 },
};

export default class Ecg extends Scene {
  private layer!: Layer2D;
  private list: Shot[] = [];
  private plate!: PlateInfo;
  private lines: Line[] = [];
  private P!: NamedPalette;
  /** Shot start time per topo name. */
  private at: Record<string, number> = {};

  override init() {
    this.plate = this.ctx.params as PlateInfo;
    this.list = shots(this.plate, this.ctx.audio);
    this.lines = ownedLines(this.ctx);
    this.P = palette(this.ctx.params.look?.palette ?? (this.plate.variant === 'xy' ? 'scope' : 'ridge'));
    for (const s of this.list) if (this.at[s.s.topo as string] === undefined) this.at[s.s.topo as string] = s.t;
    this.layer = new Layer2D();
  }

  private get au() { return this.ctx.audio; }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const st = stateAt(this.list, f.t);
    const L = this.layer;
    L.clear(pcss(this.P, 'ground'));
    const post = this.plate.variant === 'xy' ? this.xyPlate(f, st) : this.ridgePlate(f, st);
    L.upload();
    clearRT(this.ctx.renderer, out, plin(this.P, 'ground'));
    this.ctx.comp.draw(this.ctx.renderer, L.texture, out, { mode: 'normal' });
    return post;
  }

  // ================================================================== p12 xy
  /** Eased count of beats so far: each beat is a phase step that lands in ~70 ms. */
  private steps(t: number): number {
    const b = this.au.beats, i = beatIndex(this.au, t);
    if (i < 0) return 0;
    return i + ease.outCubic(clamp((t - b[i]!) / 0.07));
  }

  /** The two figures at time t (pure function of t: used for the live curve and its afterglow). */
  private figs(t: number): [Fig, Fig] {
    const A = this.at;
    const s = this.steps(t);
    const tF = A.falter!, tR = A.recover!, tL = A.lock!, tM = A.merge!, tO = A.orbit!, tC = A.collapse!;
    // falter: the right figure loses amplitude in stutters, the left dims with it; both come back on `recover`
    const fall = smoothstep(tF, tF + 0.25, t) * (1 - smoothstep(tR, tR + 0.3, t));
    const stut = 0.55 + 0.45 * Math.abs(noise1(t * 9, 3));
    const ampB = 1 - fall * (0.82 * stut);
    const lock = ease.inOutCubic(clamp((t - tL) / 0.55));
    const merge = ease.inOutCubic(clamp((t - tM) / 0.7));
    const orbit = ease.inOutCubic(clamp((t - tO) / 0.6));
    const coll = ease.inCubic(clamp((t - tC) / 0.5));
    // ratios: A 3:2, B 5:4 (wobbling while it falters) → both 3:2 on lock → 1:1 (a circle) on orbit
    const bA = lerp(2, 1, orbit), aA = lerp(3, 1, orbit);
    const aB = lerp(lerp(5 + 0.35 * fall * noise1(t * 5, 7), 3, lock), 1, orbit);
    const bB = lerp(lerp(4, 2, lock), 1, orbit);
    // phases: free drift + a step per beat; B converges to A on lock; the circle needs φ = π/2
    const phA = 0.42 * t + 0.34 * s;
    const phB0 = -0.61 * t + 0.52 * s + 1.3;
    const phB = lerp(phB0, phA, lock);
    const phO = Math.PI / 2;
    const xA = lerp(560, 960, merge), xB = lerp(1360, 960, merge);
    const r0 = lerp(250, 290, merge), r = lerp(r0, 320, orbit) * (1 - coll);
    const cy = lerp(490, 570, orbit);
    return [
      { cx: xA, cy, r, a: aA, b: bA, ph: lerp(phA, phO, orbit), amp: 1, lum: lerp(1, 0.3, fall * (1 - 0.45 * stut)) },
      { cx: xB, cy, r, a: aB, b: bB, ph: lerp(phB, phO, orbit), amp: ampB, lum: 1 },
    ];
  }

  private figPts(fg: Fig): Pt[] {
    const pts: Pt[] = [];
    const R = fg.r * fg.amp;
    for (let i = 0; i <= NSEG; i++) {
      const u = (i / NSEG) * TAU;
      pts.push({ x: fg.cx + R * Math.sin(fg.a * u + fg.ph), y: fg.cy - R * Math.sin(fg.b * u) });
    }
    return pts;
  }

  /** Stroke a beam path with brightness ∝ 1/speed: 4 buckets, each as one path per pass. */
  private beam(c: CanvasRenderingContext2D, pts: Pt[], lum: number, glow: number, core: number, zoom: number) {
    const P = this.P;
    const n = pts.length - 1;
    const sp = new Float32Array(n);
    let mx = 1e-6;
    for (let i = 0; i < n; i++) { sp[i] = Math.hypot(pts[i + 1]!.x - pts[i]!.x, pts[i + 1]!.y - pts[i]!.y); mx = Math.max(mx, sp[i]!); }
    const lv = new Uint8Array(n);
    for (let i = 0; i < n; i++) { const q = sp[i]! / mx; lv[i] = q < 0.3 ? 0 : q < 0.55 ? 1 : q < 0.8 ? 2 : 3; }
    const passes: [number, 'mid' | 'hi', number][] = [
      [14 / zoom, 'mid', 0.07 * glow],
      [4.2 / Math.sqrt(zoom), 'mid', 0.5 * core],
      [1.6 / Math.sqrt(zoom), 'hi', 0.85 * core],
    ];
    for (const [lw, role, a0] of passes) {
      if (a0 <= 0.003) continue;
      c.lineWidth = lw;
      for (let L = 0; L < 4; L++) {
        const a = a0 * LEVELS[L]! * lum;
        if (a <= 0.003) continue;
        c.strokeStyle = pcss(P, role, Math.min(1, a));
        c.beginPath();
        let open = false;
        for (let i = 0; i < n; i++) {
          if (lv[i] !== L) { open = false; continue; }
          if (!open) { c.moveTo(pts[i]!.x, pts[i]!.y); open = true; }
          c.lineTo(pts[i + 1]!.x, pts[i + 1]!.y);
        }
        c.stroke();
      }
    }
  }

  private xyPlate(f: Frame, st: Record<string, any>): PostOverrides {
    const c = this.layer.ctx, t = f.t, au = this.au, P = this.P;
    const bp = beatPulse(au, t, 0.05); // the 3-frame beam brightening
    const bpl = beatPulse(au, t, 0.16);
    const db = downbeatPulse(au, t, 0.25);
    const { t0 } = shotAt(this.list, t);
    const cam0 = XY_CAM[st.frame as string] ?? XY_CAM.wide!;
    // hold the framing, drift in slowly; a small snap-in on every beat
    const cam: Cam = { ...cam0, s: cam0.s * (1 + 0.018 * (t - t0) + 0.012 * bpl) };
    const coll = clamp((t - this.at.collapse!) / 0.5);

    c.save();
    c.globalCompositeOperation = 'lighter';
    c.lineCap = 'round';
    c.lineJoin = 'round';
    applyCam(c, cam);
    if (st.medium === 'tube') {
      // the tube face and its dark rim, seen once the camera pulls back
      c.fillStyle = pcss(P, 'deep', 0.16);
      c.beginPath();
      this.rrect(c, 70, 60, W - 140, H - 120, 120);
      c.fill();
      c.strokeStyle = pcss(P, 'deep', 0.9);
      c.lineWidth = 26;
      c.beginPath();
      this.rrect(c, 40, 30, W - 80, H - 60, 140);
      c.stroke();
    }
    // afterglow: the same pure figure function at t − kΔ, decaying (P31 persistence)
    for (let k = 5; k >= 1; k--) {
      const fg = this.figs(t - k * 0.04);
      const decay = Math.pow(0.5, k);
      for (const q of fg) if (q.r * q.amp > 1) this.beam(c, this.figPts(q), q.lum * decay, 0, 0.55, cam.s);
    }
    const figs = this.figs(t);
    const hit = 1 + 0.9 * bp;
    for (const q of figs) {
      if (q.r * q.amp > 1) this.beam(c, this.figPts(q), q.lum * hit, 1 + bpl, 1, cam.s);
    }
    // the beam spot: where the single beam is right now on each figure
    for (const q of figs) {
      const u = ((t * 0.9) % 1) * TAU;
      const R = q.r * q.amp;
      const x = q.cx + R * Math.sin(q.a * u + q.ph), y = q.cy - R * Math.sin(q.b * u);
      const sig = coll > 0.7;
      const rad = (sig ? 9 + 26 * smoothstep(0.7, 1, coll) : 5) / Math.sqrt(cam.s);
      c.fillStyle = sig ? pcss(P, 'signal', 0.9) : pcss(P, 'hi', 0.55 * q.lum * hit);
      c.beginPath();
      c.arc(x, y, rad, 0, TAU);
      c.fill();
      if (sig) break; // one dot: the singularity before the drop
    }
    c.restore();

    // line 13: written by the beam as outline strokes, in screen space
    this.xyLyric(c, t, st, figs, cam, bpl);

    const cut = Math.exp(-(t - t0) / 0.12);
    return {
      bloom: 0.75 + 0.5 * bp + 1.2 * smoothstep(0.6, 1, coll),
      bloomThreshold: 0.32,
      bloomRadius: 0.6,
      zoom: 1 + 0.03 * cut + 0.012 * db,
      exposure: 1 + 0.25 * bp,
      shake: [0, 0],
      vignette: 0.45,
      grain: 0.05,
      ca: 0.3,
    };
  }

  private rrect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
    c.moveTo(x + r, y);
    c.lineTo(x + w - r, y);
    c.arc(x + w - r, y + r, r, -Math.PI / 2, 0);
    c.lineTo(x + w, y + h - r);
    c.arc(x + w - r, y + h - r, r, 0, Math.PI / 2);
    c.lineTo(x + r, y + h);
    c.arc(x + r, y + h - r, r, Math.PI / 2, Math.PI);
    c.lineTo(x, y + r);
    c.arc(x + r, y + r, r, Math.PI, Math.PI * 1.5);
  }

  private xyLyric(c: CanvasRenderingContext2D, t: number, st: Record<string, any>, figs: [Fig, Fig], cam: Cam, bp: number) {
    const P = this.P, line = this.lines[0];
    if (!line) return;
    const layout = st.layout as string;
    const family = F.slam();
    const spec: Record<string, { x: number; y: number; size: number; max: number; align: 'left' | 'center' }> = {
      under: { x: 960, y: 935, size: 104, max: 1560, align: 'center' },
      over: { x: 960, y: 205, size: 116, max: 1600, align: 'center' },
      between: { x: 960, y: 880, size: 132, max: 1680, align: 'center' },
      across: { x: SAFE + 20, y: 905, size: 122, max: 1660, align: 'left' },
      top: { x: 960, y: 200, size: 96, max: 1500, align: 'center' },
      ring: { x: 960, y: 540, size: 84, max: 1400, align: 'center' },
      bezel: { x: 960, y: 900, size: 76, max: 1300, align: 'center' },
    };
    const sp = spec[layout] ?? spec.under!;
    const lay = layoutLine(c, line, family, sp.size, sp.max);
    const ox = sp.align === 'center' ? -lay.width / 2 : 0;
    // ring: the words wrap the top of the orbit (screen-space circle of the camera-projected figure)
    const fg = figs[0];
    const ringR = fg.r * cam.s + 62;
    const ringC = { x: W / 2 + (fg.cx - cam.fx) * cam.s, y: H / 2 + (fg.cy - cam.fy) * cam.s };
    const coll = clamp((t - this.at.collapse!) / 0.5);
    c.save();
    c.globalCompositeOperation = 'lighter';
    c.lineJoin = 'round';
    drawLyric(c, line, t, {
      x: sp.x, y: sp.y, size: sp.size, maxWidth: sp.max, family, align: sp.align, unsungAlpha: 0.22, lead: 0.3,
      alpha: 1 - 0.8 * coll,
      charTransform: (_ch, _i, s: CharState) => {
        if (layout !== 'ring') return;
        const bx = sp.x + ox + s.box.x + s.box.w / 2;
        const th = -Math.PI / 2 + (bx - sp.x) / ringR;
        // glyph centre onto the circle (drawLyric puts the centre at (bx, sp.y − 0.35·size) before dx/dy)
        const px = ringC.x + ringR * Math.cos(th), py = ringC.y + ringR * Math.sin(th);
        return { dx: px - bx, dy: py - (sp.y - lay.size * 0.35), rot: th + Math.PI / 2 };
      },
      drawChar: (cc, ch, s: CharState) => {
        if (!s.sung) {
          cc.strokeStyle = pcss(P, 'mid', 0.9);
          cc.lineWidth = 1.4;
          cc.strokeText(ch, 0, 0);
          return;
        }
        // the beam writes the glyph outline while its syllable is sung, then it holds at full phosphor
        const Lg = lay.size * 9;
        const w = s.frac < 1 ? s.frac : 1;
        if (w < 1) cc.setLineDash([Lg * w, Lg * 2]);
        cc.strokeStyle = pcss(P, 'mid', 0.16);
        cc.lineWidth = 12;
        cc.strokeText(ch, 0, 0);
        cc.strokeStyle = pcss(P, 'mid', 0.75);
        cc.lineWidth = 4 + 2 * bp;
        cc.strokeText(ch, 0, 0);
        cc.strokeStyle = pcss(P, 'hi', 0.95);
        cc.lineWidth = 1.6;
        cc.strokeText(ch, 0, 0);
        cc.setLineDash([]);
      },
    });
    c.restore();
  }

  // ================================================================== p30 ridge
  /** Height profile of the row born on beat k (world units, up), at X. reg = 0 heart … 1 machine. */
  private rowH(k: number, X: number, t: number, reg: number): number {
    const u = X / XR; // -1..1
    const band = smoothstep(0.66, 0.28, Math.abs(u));
    // the heart: 3–5 irregular rounded peaks, each its own width and height, alive (they wobble)
    let heart = 0;
    const n = 3 + Math.floor(hash(k, 1) * 3);
    for (let i = 0; i < n; i++) {
      const x0 = (hash(k, i, 2) - 0.5) * 330 + 22 * noise1(t * 0.9 + k * 0.7 + i, 4);
      const w = 14 + 34 * hash(k, i, 3);
      const a = 55 + 150 * hash(k, i, 4) * (1 + 0.3 * noise1(t * 1.3 + k, 8));
      heart += a * g(X - x0, w) - 0.25 * a * g(X - x0 - 2.2 * w, 1.4 * w);
    }
    heart += 14 * noise1(X * 0.05 + k * 3.1 + t * 2.2, 5) * band;
    // the machine: one pulse shape repeated three times, identical in every row
    let mach = 0;
    for (const x0 of [-175, 0, 175]) mach += 200 * pulseM(X - x0);
    const edge = 4 * noise1(X * 0.08 + k * 1.7, 6) * (1 - reg);
    return lerp(heart * band, mach * band, reg) + edge;
  }

  private ridgePlate(f: Frame, st: Record<string, any>): PostOverrides {
    const c = this.layer.ctx, t = f.t, au = this.au, P = this.P;
    const bp = beatPulse(au, t, 0.12), kp = kickPulse(au, t, 0.1), db = downbeatPulse(au, t, 0.25);
    const { t0 } = shotAt(this.list, t);
    const rc = R_CAM[st.frame as string] ?? R_CAM.cover!;
    const b = au.beats, bi = beatIndex(au, t);
    const S = bi + ease.outCubic(clamp((t - (b[bi] ?? t)) / 0.14));
    const line = this.lines[0];
    const l0 = line ? line.start : this.plate.start, l1 = line ? line.end : this.plate.end;
    // the regularity front: on every beat of the line it sweeps a band of rows, front to back
    const lb = b.filter((x) => x >= l0 + 0.1 && x <= l1 - 0.2);
    let fs = 0;
    for (const x of lb) fs += ease.outCubic(clamp((t - x) / 0.12));
    const front = (fs * (NROW + 4)) / Math.max(1, lb.length) - 1;
    const flat = 1 - ease.inOutCubic(clamp((t - (this.at.flat ?? this.plate.end)) / 0.45));
    const push = 1 + 0.025 * (t - t0);
    const proj = proj3(rc.yaw, rc.pitch, rc.cx, rc.cy, rc.zm * push * (1 + 0.012 * bp), rc.D);
    const z0 = (NROW / 2) * DZ;

    // rows far → near; each: fill black below the ridge (occlusion), then the white ridge on top
    const kMax = bi, kMin = Math.floor(S) - NROW - 1;
    let ride: [number, number][] | null = null;
    const rideSlot = NROW - 3;
    c.lineJoin = 'round';
    for (let k = kMin; k <= kMax; k++) {
      const d = S - k - 1; // depth slot: the newest row enters at −1 and eases to 0
      if (d > NROW || d < -1) continue;
      const reg = smoothstep(-0.5, 1.5, front - d);
      const Z = d * DZ - z0 - rc.tz;
      const near = Math.exp(-Math.max(0, d) / 3.5);
      const amp = flat * rc.hk * (1 + 0.35 * kp * near);
      const fadeFar = smoothstep(NROW, NROW - 4, d), fadeIn = smoothstep(-1, -0.2, d);
      const a = fadeFar * fadeIn;
      if (a <= 0.01) continue;
      const pts: [number, number][] = [];
      for (let i = 0; i <= NS; i++) {
        const X = -XR + (2 * XR * i) / NS;
        const h = this.rowH(k, X, t * (1 - reg), reg) * amp;
        const [sx, sy] = proj(X, -h, Z);
        pts.push([sx, sy]);
      }
      if (Math.abs(d - rideSlot) <= 0.5) ride = pts;
      // occlusion: the area below the ridge down to the row's floor
      c.fillStyle = pcss(P, 'ground', 1);
      c.beginPath();
      c.moveTo(pts[0]![0], pts[0]![1]);
      for (const [x, y] of pts) c.lineTo(x, y);
      const [ex, ey] = proj(XR, 40, Z), [sx0, sy0] = proj(-XR, 40, Z);
      c.lineTo(ex, ey);
      c.lineTo(sx0, sy0);
      c.closePath();
      c.fill();
      const [, , kz] = proj(0, 0, Z);
      c.strokeStyle = pcss(P, 'hi', a * (0.78 + 0.22 * near * (0.5 + bp)));
      c.lineWidth = Math.max(1, 2.3 * kz * (1 + 0.6 * bp * near));
      c.beginPath();
      c.moveTo(pts[0]![0], pts[0]![1]);
      for (const [x, y] of pts) c.lineTo(x, y);
      c.stroke();
    }

    this.ridgeLyric(c, t, st, ride, bp);

    const cut = Math.exp(-(t - t0) / 0.1);
    const onTop = st.frame === 'top' ? Math.exp(-(t - t0) / 0.09) : 0;
    return {
      zoom: 1 + 0.035 * cut + 0.01 * db,
      shake: [0, 3 * db * Math.sin(t * 90)],
      invert: 0.85 * onTop,
      vignette: 0.3,
      grain: 0.06,
      ca: 0.2,
    };
  }

  private ridgeLyric(c: CanvasRenderingContext2D, t: number, st: Record<string, any>, ride: [number, number][] | null, bp: number) {
    const P = this.P, line = this.lines[0];
    if (!line) return;
    const family = F.slam();
    const layout = st.layout as string;
    const size = layout === 'ride-close' ? 118 : layout === 'ride-low' ? 104 : 96;
    const max = 1500;
    const lay = layoutLine(c, line, family, size, max);
    // ridge y at screen x (the highest point under the glyph, so letters sit ON the peaks), and its slope
    const yAt = (x0: number, x1: number): [number, number] => {
      if (!ride) return [300, 0];
      let m = Infinity, sum = 0, cnt = 0, yl = NaN, yr = NaN;
      for (let i = 0; i + 1 < ride.length; i++) {
        const [ax, ay] = ride[i]!, [bx, by] = ride[i + 1]!;
        const lo = Math.min(ax, bx), hi = Math.max(ax, bx);
        if (hi < x0 || lo > x1) continue;
        m = Math.min(m, ay, by);
        sum += ay; cnt++;
        if (Number.isNaN(yl)) yl = ay;
        yr = by;
      }
      if (m === Infinity) {
        // beyond the ridge's ends: continue its end height
        const e = x0 < ride[0]![0] ? ride[0]! : ride[ride.length - 1]!;
        return [e[1], 0];
      }
      // between the peak and the mean under the glyph: letters lift on the peaks without leaping
      return [0.5 * m + (0.5 * sum) / cnt, Math.atan2(yr - yl, Math.max(1, x1 - x0))];
    };
    const base = ride ? ride.reduce((s, p) => s + p[1], 0) / ride.length : 300;
    const y = clamp(base - 26, SAFE + lay.size, H - SAFE);
    const ox = -lay.width / 2;
    c.save();
    drawLyric(c, line, t, {
      x: 960, y, size, maxWidth: max, family, align: 'center', unsungAlpha: 0.3, lead: 0.3,
      charTransform: (_ch, _i, s: CharState) => {
        const x0 = 960 + ox + s.box.x, x1 = x0 + s.box.w;
        const [ry, slope] = yAt(x0, x1);
        const target = Math.max(SAFE + lay.size, y - 1.1 * lay.size, ry - 18);
        const hop = s.sung ? -10 * bp * (1 - s.frac) : 0;
        return { dy: target - y + hop, rot: clamp(slope, -0.35, 0.35) * 0.6 };
      },
      drawChar: (cc, ch, s: CharState) => {
        cc.lineJoin = 'round';
        cc.strokeStyle = pcss(P, 'ground', 1);
        cc.lineWidth = 10;
        cc.strokeText(ch, 0, 0);
        cc.fillStyle = s.sung ? pcss(P, 'text', 1) : pcss(P, 'mid', 0.9);
        cc.fillText(ch, 0, 0);
      },
    });
    c.restore();
  }
}
