// WAVE — a halftone print wave on bone paper. Dot size = wave height: a 45° print screen of ink dots samples the
// water's height field, so the swell reads as coarse black where it towers and a pale tint where the sea lies flat.
// Structure comes from the pure shot list (./wave.shots) via stateAt(): side / curl / crest / top, each its own
// camera and halftone screen. The beat: on every beat the crest snaps forward (80 ms), throws a row of signal dots
// ahead of itself and the whole screen fattens for an instant. The line rides the water surface (per-glyph on a
// path by arc length), knocked out to bone wherever the ink covers it. Exit: the front swallows the frame to ink.
// Variants (data/edit.json): tide (p05 — rolls in from the right, carries line 5 to the left).
import type * as THREE from 'three';
import { Scene, type Frame, type PostOverrides } from '../engine/scene';
import { Layer2D, clearRT } from '../engine/gl';
import { LIN, rgba, type PaletteKey } from '../engine/palette';
import { drawLyric, layoutLine, ownedLines, F } from '../engine/lyric';
import { beatPulse, kickPulse, downbeatPulse, beatIndex } from '../engine/beat';
import { shotAt, stateAt, type PlateInfo, type Shot } from '../engine/shots';
import { hash, clamp, smoothstep, ease } from '../engine/util';
import type { Line } from '../engine/lyrics';
import { shots, type View } from './wave.shots';

type P = { x: number; y: number };
type PathPt = { x: number; y: number; ang: number };
const W = 1920, H = 1080, SAFE = 96;

// per-variant wave: sea level, crest height, entry (world x at plate start → after the roll-in), drift, beat jump
const VARIANT: Record<string, { sea: number; amp: number; x0: number; x1: number; roll: number; drift: number; jump: number }> = {
  tide: { sea: 760, amp: 360, x0: 2150, x1: 640, roll: 1.1, drift: 50, jump: 46 },
};

/** A screen-space polyline with arc-length lookup (the lyric's baseline path). */
class Path {
  private cum: number[] = [0];
  constructor(private pts: P[]) {
    for (let i = 1; i < pts.length; i++) this.cum.push(this.cum[i - 1]! + Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y));
  }
  get length() { return this.cum[this.cum.length - 1]!; }
  at(s: number): PathPt {
    const n = this.pts.length, c = this.cum;
    let i = 1;
    while (i < n - 1 && c[i]! < s) i++;
    const a = this.pts[i - 1]!, b = this.pts[i]!;
    const seg = Math.max(1e-6, c[i]! - c[i - 1]!), k = (s - c[i - 1]!) / seg; // extrapolates past either end
    return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, ang: Math.atan2(b.y - a.y, b.x - a.x) };
  }
}

export default class Wave extends Scene {
  private layer!: Layer2D;
  private list: Shot[] = [];
  private plate!: PlateInfo;
  private lines: Line[] = [];
  private beats: number[] = [];
  private wordStarts: number[] = [];
  private cfg = VARIANT.tide!;

  override init() {
    this.plate = this.ctx.params as PlateInfo;
    this.cfg = VARIANT[this.ctx.params.variant as string] ?? VARIANT.tide!;
    this.list = shots(this.plate, this.ctx.audio);
    this.lines = ownedLines(this.ctx);
    this.beats = this.ctx.audio.beats.filter((b) => b >= this.ctx.start - 1e-3 && b < this.ctx.end);
    this.wordStarts = this.lines.flatMap((l) => l.words.map((w) => w.start));
    this.layer = new Layer2D();
  }

  // ------------------------------------------------------------------ the wave (side-view world, px)
  /** Beat jumps so far: a staircase, each step snapping in over `tau` s. */
  private jumps(t: number, tau: number): number {
    let s = 0;
    for (const b of this.beats) if (b <= t) s += ease.outExpo(clamp((t - b) / tau));
    return s;
  }
  private crestBase(t: number): number {
    const { x0, x1, roll, drift } = this.cfg, lt = t - this.ctx.start;
    return x0 - (x0 - x1) * ease.outCubic(clamp(lt / roll)) - drift * lt;
  }
  /** Crest x: snaps forward on every beat (80 ms). */
  private crestX(t: number) { return this.crestBase(t) - this.cfg.jump * this.jumps(t, 0.08); }
  private amp(t: number) { return this.cfg.amp * (1 + 0.07 * beatPulse(this.ctx.audio, t, 0.14)); }
  /** Normalised height 0..1 of the water at world x. */
  private hn(x: number, X: number): number {
    const u = x - X;
    return u < 0 ? Math.exp(-((u / 125) ** 2)) : 0.16 + 0.84 * Math.exp(-u / 540);
  }
  private surfY(x: number, X: number, A: number, t: number): number {
    const h = this.hn(x, X);
    return this.cfg.sea - A * h - 9 * Math.sin(x * 0.021 - t * 2.3) * (1 - h);
  }
  /** The lip: an annulus sector overhanging ahead of the crest (centre, inner radius, thickness). */
  private lip(X: number, A: number) { return { cx: X - 112, cy: this.cfg.sea - 0.6 * A, rin: 0.25 * A, th: 0.3 * A }; }
  /** Ink density 0..1 at world point (x, y). */
  private densWorld(x: number, y: number, X: number, A: number, t: number): number {
    const L = this.lip(X, A);
    const dx = x - L.cx, dy = y - L.cy, r = Math.hypot(dx, dy);
    if (r < L.rin && x < X) return 0; // the hollow of the tube
    if (r < L.rin + L.th) {
      const a = Math.atan2(dy, dx);
      if (a >= 2.0 || a <= -1.05) return 0.92;
    }
    const ys = this.surfY(x, X, A, t);
    if (y < ys) return 0;
    return clamp(0.1 + 0.8 * this.hn(x, X) + 0.12 * smoothstep(0, 260, y - ys));
  }

  // ------------------------------------------------------------------ cameras (world → screen)
  private camera(view: View, t: number) {
    // crest: tracks the crest top with a lag (the camera eases over 0.4 s, the crest snaps in 0.08 s)
    const fx = view === 'crest' ? this.crestBase(t) - this.cfg.jump * this.jumps(t, 0.4) + 360 : W / 2;
    const fy = view === 'crest' ? 463 : H / 2;
    const s = view === 'crest' ? 1.75 : 1, rot = view === 'crest' ? -0.06 : 0;
    const c = Math.cos(rot), sn = Math.sin(rot);
    return {
      s,
      to: (q: P): P => { const x = (q.x - fx) * s, y = (q.y - fy) * s; return { x: W / 2 + c * x - sn * y, y: H / 2 + sn * x + c * y }; },
      from: (sx: number, sy: number): P => { const x = sx - W / 2, y = sy - H / 2; return { x: fx + (c * x + sn * y) / s, y: fy + (-sn * x + c * y) / s }; },
    };
  }

  // ------------------------------------------------------------------ halftone
  /** One ink pass: a rotated dot lattice (pitch `pitch`, angle `ang`) sampling `dens` in screen space. */
  private halftone(c: CanvasRenderingContext2D, pitch: number, ang: number, dens: (x: number, y: number) => number, gain: number, color: PaletteKey) {
    const ca = Math.cos(ang), sa = Math.sin(ang), N = Math.ceil(1102 / pitch) + 1, rmax = pitch * 0.72;
    c.fillStyle = rgba(color);
    c.beginPath();
    for (let j = -N; j <= N; j++) {
      for (let i = -N; i <= N; i++) {
        const x = W / 2 + (i * ca - j * sa) * pitch, y = H / 2 + (i * sa + j * ca) * pitch;
        if (x < -pitch || x > W + pitch || y < -pitch || y > H + pitch) continue;
        const d = dens(x, y);
        if (d <= 0.004) continue;
        const r = rmax * Math.sqrt(clamp(d)) * gain;
        c.moveTo(x + r, y);
        c.arc(x, y, r, 0, Math.PI * 2);
      }
    }
    c.fill();
  }

  /** The row of dots each beat throws ahead of the wave (signal), for a launch point + direction in screen px. */
  private thrown(c: CanvasRenderingContext2D, t: number, launch: (b: number) => { o: P; dir: P; s: number }) {
    c.fillStyle = rgba('signal');
    c.beginPath();
    for (const b of this.beats) {
      const age = t - b;
      if (age < 0 || age > 0.62) continue;
      const { o, dir, s } = launch(b), k = 1 - age / 0.62;
      for (let n = 0; n < 9; n++) {
        const sp = (520 + n * 120) * s, dist = sp * age - 0.5 * 700 * s * age * age * (n / 9);
        const x = o.x + dir.x * dist, y = o.y + dir.y * dist + 0.5 * 900 * s * age * age;
        const r = (17 - n * 1.1) * s * k * (0.7 + 0.3 * hash(n, b * 7));
        if (r < 0.4) continue;
        c.moveTo(x + r, y);
        c.arc(x, y, r, 0, Math.PI * 2);
      }
    }
    c.fill();
  }

  // ------------------------------------------------------------------ print furniture
  private furniture(c: CanvasRenderingContext2D, label: string) {
    c.strokeStyle = rgba('graphite', 0.7);
    c.lineWidth = 1.2;
    const m = 44, l = 30;
    c.beginPath();
    for (const [x, y, sx, sy] of [[m, m, 1, 1], [W - m, m, -1, 1], [m, H - m, 1, -1], [W - m, H - m, -1, -1]] as const) {
      c.moveTo(x - sx * 12, y); c.lineTo(x + sx * l, y);
      c.moveTo(x, y - sy * 12); c.lineTo(x, y + sy * l);
    }
    // registration target, top centre
    c.moveTo(W / 2 + 11, 36); c.arc(W / 2, 36, 11, 0, Math.PI * 2);
    c.moveTo(W / 2 - 18, 36); c.lineTo(W / 2 + 18, 36);
    c.moveTo(W / 2, 18); c.lineTo(W / 2, 54);
    c.stroke();
    c.font = `14px "${F.mono(500)}"`;
    c.fillStyle = rgba('graphite', 0.85);
    c.textAlign = 'left';
    c.fillText(label, m + 44, m + 5);
  }

  // ------------------------------------------------------------------ render
  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, audio } = this.ctx;
    const t = f.t;
    const st = stateAt(this.list, t);
    const sh = shotAt(this.list, t);
    const view = st.view as View;
    const L = this.layer, c = L.ctx;
    L.clear();

    const bp = beatPulse(audio, t, 0.1);
    const gain = 1 + 0.16 * bp + 0.06 * kickPulse(audio, t, 0.08);
    const X = this.crestX(t), A = this.amp(t);
    const end = this.ctx.end, lastBeat = this.beats[this.beats.length - 1] ?? end;
    // exit: the swallow runs from ~24.6 s and lands full coverage on the plate's last beat
    const sw = view === 'top' ? smoothstep(lastBeat - 0.32, lastBeat, t) : 0;

    let dens: (x: number, y: number) => number;
    let pitch = 16, ang = Math.PI / 4;
    let path: Path;
    let size = 96, maxW = 1300;
    let launch: (b: number) => { o: P; dir: P; s: number };

    if (view === 'curl') {
      // low, inside the barrel: the lip arcs overhead from right to left, huge dots; trough below
      const cx = 920, cy = 720 + 10 * Math.sin((t - sh.t0) * 2.2), rin = 545 - 48 * bp - 50 * (t - sh.t0);
      const trough = 985 - 14 * bp;
      pitch = 64;
      dens = (x, y) => {
        const dx = x - cx, dy = y - cy, r = Math.hypot(dx, dy), a = Math.atan2(dy, dx);
        let d = 0;
        if (r > rin && (a < 0.28 || a > 2.86)) d = (0.34 + 0.66 * smoothstep(rin, rin + 380, r)) * (0.84 + 0.16 * Math.sin(a * 7 + (t - sh.t0) * 7));
        const ty = trough + 16 * Math.sin(x * 0.012 + t * 3);
        if (y > ty) d = Math.max(d, 0.22 + 0.5 * smoothstep(ty, H, y));
        return d;
      };
      size = 104;
      const rp = rin - 70;
      const pts: P[] = [];
      for (let k = 0; k <= 96; k++) { const a = Math.PI - 0.22 + (Math.PI + 0.44) * (k / 96); pts.push({ x: cx + rp * Math.cos(a), y: cy + rp * Math.sin(a) }); }
      path = new Path(pts);
      maxW = path.length - 20;
      launch = (b) => { const a = 2.9, r0 = 545 - 50 * (b - sh.t0); return { o: { x: cx + r0 * Math.cos(a), y: cy + r0 * Math.sin(a) }, dir: { x: -0.86, y: 0.5 }, s: 2.2 }; };
    } else if (view === 'top') {
      // overhead: the front is a line of dot rows marching down-frame; the swallow sweeps it over everything
      const al = -0.16, dv = { x: Math.cos(al), y: Math.sin(al) }, nv = { x: Math.sin(al), y: -Math.cos(al) }; // nv points up, into the wave
      const lt = t - sh.t0, jumpT = this.jumps(t, 0.08) - this.jumps(sh.t0, 0.08);
      const Fc = 120 - 55 * lt - 38 * jumpT; // front offset along nv (decreasing = moving down)
      const Fs = Fc - sw * 1500;
      pitch = 26; ang = al;
      dens = (x, y) => {
        const u = (x - W / 2) * nv.x + (y - H / 2) * nv.y - Fs;
        let d: number;
        if (u < 0) d = 0.05 + 0.05 * smoothstep(-160, 0, u);
        else d = u < 30 ? 1 : (0.3 + 0.62 * Math.exp(-u / 420)) * (0.55 + 0.45 * (0.5 + 0.5 * Math.cos((u / 110) * Math.PI * 2)));
        return d + (1 - d) * sw;
      };
      size = 104;
      const off = Fc - size * 0.95; // the text rides just ahead of the front (not swept: the swallow overtakes it)
      const base = { x: W / 2 + nv.x * off, y: H / 2 + nv.y * off };
      maxW = 1560;
      const half = layoutLine(c, this.lines[0]!, F.slam(), size, maxW).width / 2; // centred on the frame along the front
      path = new Path([{ x: base.x - dv.x * half, y: base.y - dv.y * half }, { x: base.x + dv.x * (half + 400), y: base.y + dv.y * (half + 400) }]);
      launch = (b) => {
        const Fb = 120 - 55 * (b - sh.t0) - 38 * (this.jumps(b + 0.1, 0.08) - this.jumps(sh.t0, 0.08));
        return { o: { x: W / 2 + nv.x * Fb, y: H / 2 + nv.y * Fb }, dir: { x: -nv.x, y: -nv.y }, s: 1 };
      };
    } else {
      // side / crest: the world wave through a camera
      const cam = this.camera(view, t);
      pitch = view === 'crest' ? 30 : 16;
      dens = (x, y) => { const w = cam.from(x, y); return this.densWorld(w.x, w.y, X, A, t); };
      size = view === 'crest' ? 118 : 92;
      maxW = view === 'crest' ? 1380 : 1300;
      const fs = layoutLine(c, this.lines[0]!, F.slam(), size, maxW).size;
      const lift = fs * 0.58;
      const pts: P[] = [];
      if (view === 'crest') {
        for (let x = X - 10; x < X + 1400; x += 8) { const q = cam.to({ x, y: this.surfY(x, X, A, t) }); pts.push({ x: q.x, y: q.y - lift }); }
      } else {
        const x0 = Math.min(X - 20, W - SAFE - maxW);
        for (let x = Math.max(SAFE, x0); x < W + 200; x += 8) pts.push({ x, y: this.surfY(x, X, A, t) - lift });
      }
      path = new Path(pts);
      launch = (b) => {
        const Xb = this.crestX(b + 0.08), Ab = this.cfg.amp * 1.07, Lb = this.lip(Xb, Ab), a = 2.05, r0 = Lb.rin + Lb.th * 0.5;
        return { o: cam.to({ x: Lb.cx + r0 * Math.cos(a), y: Lb.cy + r0 * Math.sin(a) }), dir: { x: -0.94, y: -0.34 }, s: cam.s };
      };
    }

    // ink: the halftone, then the thrown row of signal dots
    this.halftone(c, pitch, ang, dens, gain, 'ink');
    this.thrown(c, t, launch);
    this.furniture(c, `WAVE/${this.plate.variant.toUpperCase()}  ${view.toUpperCase()}  ${st.screen}  ${(t - this.ctx.start).toFixed(2)}s`);

    // the line: glyphs on the path by arc length; bob with the wave height on each beat; knocked out over ink
    const db = downbeatPulse(audio, t, 0.25);
    this.lines.forEach((line) => {
      const fs = layoutLine(c, line, F.slam(), size, maxW).size;
      const under = new Map<number, boolean>();
      drawLyric(c, line, t, {
        x: 0, y: 0, size, maxWidth: maxW, align: 'left', family: F.slam(),
        sungColor: 'ink', unsungColor: 'graphite', unsungAlpha: 0.6,
        charTransform: (_ch, idx, s) => {
          const b = s.box, sc = b.x + b.w / 2;
          const p = path.at(sc);
          const bi = beatIndex(audio, t);
          // bob: each beat kicks the letters up (outward on the curl) by an amount that falls along the line
          const kick = (18 + 10 * db) * bp * (0.6 + 0.4 * Math.sin(sc * 0.01 + bi));
          const nx = Math.sin(p.ang), ny = -Math.cos(p.ang);
          const px = p.x + nx * kick, py = p.y + ny * kick;
          under.set(idx, dens(px, py) > 0.45 || t >= lastBeat);
          return { dx: px - sc, dy: py + 0.35 * fs, rot: p.ang + (s.sung ? 0 : 0.06 * Math.sin(idx * 1.7 + t * 5)) };
        },
        drawChar: (c2d, ch, s) => {
          const ko = under.get(s.box.index) ?? false;
          c2d.lineJoin = 'round';
          c2d.lineWidth = fs * 0.12;
          c2d.strokeStyle = rgba(ko ? 'ink' : 'bone');
          c2d.strokeText(ch, 0, 0);
          c2d.fillStyle = rgba(s.sung && s.frac < 1 ? 'signal' : ko ? 'bone' : s.sung ? 'ink' : 'graphite');
          c2d.fillText(ch, 0, 0);
        },
      });
    });
    L.upload();

    clearRT(renderer, out, t >= lastBeat && view === 'top' ? LIN.ink : LIN.bone);
    this.ctx.comp.draw(renderer, L.texture, out, { mode: 'normal' });

    // hits (T1): per-beat zoom punch + ≤ 6 px shake, a harder punch on each cut, a small one on word starts
    const bi = beatIndex(audio, t);
    let ws = 0;
    for (const w of this.wordStarts) if (t >= w) ws = Math.max(ws, Math.exp(-(t - w) / 0.1));
    const cut = sh.t0 > this.ctx.start + 1e-3 ? Math.exp(-(t - sh.t0) / 0.12) : 0;
    return {
      bloom: 0,
      zoom: 1 + 0.022 * bp + 0.05 * cut + 0.018 * ws,
      shake: [(hash(bi, 1) - 0.5) * 11 * bp, (hash(bi, 2) - 0.5) * 11 * bp],
      vignette: 0.12,
    };
  }

  override dispose() { this.layer?.texture.dispose(); }
}
