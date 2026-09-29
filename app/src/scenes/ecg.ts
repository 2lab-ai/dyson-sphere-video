// ECG — oscilloscope / pulse traces: crisp vector lines on ink (no phosphor glow), one bone graph-paper moment.
// Structure comes from the pure shot list (./ecg.shots) via stateAt(); every shot changes framing, layout or topology.
// Variants (data/edit.json, docs/STORYBOARD.md):
//   heart  (p02) a scrolling heart trace; each beat's R spike yanks the head, the two cursors and the letters 40 px
//                forward (the rope stretches behind the head). Line 2 rides the trace. Shots: wide scope → low crop →
//                3/4 tow-rope view with the letters in parallax → tight reticle on one cycle → the trace pulls taut
//                into a single bone line that floods the frame (match cut to bone paper).
//   twin   (p12) a two-channel chassis: two different pulses whose heads face across the gap, line 13 set in two
//                columns between them. The right channel falters and drops out, the left dies with it and returns
//                with it; then one screen, the two traces synced beat for beat with the line between them (never
//                merged); a thin connecting line forms on the last word, pulls taut and bends into the first orbit.
//   square (p28) a living irregular sine hardens into a square wave one beat at a time (line 29 riding it), then
//                every kick lays one raster line down the screen, the words written on the scanlines; flip to bone
//                graph paper: the heartbeat as a regulated spec drawing, the letters snapped to the cells; the pen stops.
import type * as THREE from 'three';
import { Scene, type Frame, type PostOverrides } from '../engine/scene';
import { Layer2D, clearRT, W, H } from '../engine/gl';
import { LIN, rgba, type PaletteKey } from '../engine/palette';
import { drawLyric, layoutLine, ownedLines, F, type CharState, type CharXform } from '../engine/lyric';
import { font } from '../engine/type';
import { beatPulse, kickPulse, downbeatPulse, beatIndex } from '../engine/beat';
import { stateAt, shotAt, type PlateInfo, type Shot } from '../engine/shots';
import { sbShotTimes } from '../engine/storyboard';
import { clamp, lerp, smoothstep, noise1, ease } from '../engine/util';
import type { Line } from '../engine/lyrics';
import { shots } from './ecg.shots';

type P = { x: number; y: number };
type Cam = { s: number; fx: number; fy: number; rot: number };
const CAM0: Cam = { s: 1, fx: W / 2, fy: H / 2, rot: 0 };
const TAU = Math.PI * 2;
const g = (x: number, s: number) => Math.exp(-0.5 * (x / s) * (x / s));

/** One PQRST complex, d = seconds from the R peak (positive = up). */
function pqrst(d: number): number {
  return 0.13 * g(d + 0.17, 0.028) - 0.14 * g(d + 0.02, 0.007) + g(d, 0.0085) - 0.32 * g(d - 0.021, 0.009) + 0.27 * g(d - 0.21, 0.045);
}
/** A biphasic pacing pulse with ringing (the other machine's heart), d = seconds from its leading edge. */
function pace(d: number): number {
  if (d < 0) return 0;
  if (d < 0.024) return 0.85;
  if (d < 0.052) return -0.42;
  const e = d - 0.052;
  return 0.24 * Math.exp(-e / 0.07) * Math.sin((TAU * e) / 0.046);
}

function applyCam(c: CanvasRenderingContext2D, k: Cam) {
  c.translate(W / 2, H / 2);
  c.rotate(k.rot);
  c.scale(k.s, k.s);
  c.translate(-k.fx, -k.fy);
}

/** Perspective camera: (X, Y, Z) around an origin → screen x, y, the scale k (zm at Z = 0 on the axis) and the local
 *  horizontal compression of a run along X (use it as the glyph scale so projected letters never overlap). */
function proj3(yaw: number, pitch: number, cx: number, cy: number, zm = 1, D = 1500) {
  const ca = Math.cos(yaw), sa = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  return (X: number, Y: number, Z: number): [number, number, number, number] => {
    const x1 = X * ca + Z * sa, z1 = -X * sa + Z * ca;
    const y2 = Y * cp - z1 * sp, z2 = Y * sp + z1 * cp;
    const kr = D / Math.max(60, z2 + D), k = kr * zm;
    return [cx + x1 * k, cy + y2 * k, k, k * kr * ca];
  };
}

/** A sampled trace, x ascending: y at x by interpolation (fallback outside). */
class Trace {
  xs: number[] = [];
  ys: number[] = [];
  push(x: number, y: number) { this.xs.push(x); this.ys.push(y); }
  yAt(x: number, fb: number): number {
    const xs = this.xs, n = xs.length;
    if (n < 2 || x < xs[0]! || x > xs[n - 1]!) return fb;
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (xs[m]! <= x) lo = m; else hi = m; }
    const u = (x - xs[lo]!) / Math.max(1e-6, xs[hi]! - xs[lo]!);
    return lerp(this.ys[lo]!, this.ys[hi]!, u);
  }
  stroke(c: CanvasRenderingContext2D) {
    c.beginPath();
    for (let i = 0; i < this.xs.length; i++) i ? c.lineTo(this.xs[i]!, this.ys[i]!) : c.moveTo(this.xs[i]!, this.ys[i]!);
    c.stroke();
  }
}

/** Glyph with an ink (or paper) keyline so the letters read over the trace. */
const keyline = (w: number, col: PaletteKey) => (c2d: CanvasRenderingContext2D, ch: string) => {
  c2d.save();
  c2d.lineJoin = 'round';
  c2d.strokeStyle = rgba(col);
  c2d.lineWidth = w;
  c2d.strokeText(ch, 0, 0);
  c2d.restore();
  c2d.fillText(ch, 0, 0);
};

/** A sub-line (a run of whole words) of an owned line, for column layouts. */
const subLine = (l: Line, a: number, b: number): Line => ({ ...l, words: l.words.slice(a, b), text: l.words.slice(a, b).map((w) => w.w).join(' ') });

// heart geometry (scope coords = screen coords of the wide frame)
const HX = 1480, HBASE = 620, HAMP = 270, HV = 520;
// twin geometry
const T2 = { hl: 860, hr: 1060, base: 470, amp: 200, v: 420, sync: { hx: 1560, ya: 380, yb: 730 } };
// square geometry
const SQ = { base: 560, amp: 190, top: 245, bottom: 985, lam: 240 };

export default class Ecg extends Scene {
  private layer!: Layer2D;
  private tx!: Layer2D;
  private list: Shot[] = [];
  private plate!: PlateInfo;
  private lines: Line[] = [];
  private sb: number[] = [];
  /** p28: the kicks that lay raster lines. */
  private kicks: number[] = [];

  override init() {
    this.plate = this.ctx.params as PlateInfo;
    this.list = shots(this.plate, this.ctx.audio);
    this.lines = ownedLines(this.ctx);
    this.sb = sbShotTimes(this.plate.id);
    this.layer = new Layer2D();
    if (this.plate.variant === 'square') {
      this.tx = new Layer2D();
      const a = this.sb[1]!, b = this.sb[2]!;
      for (const [t, s] of this.ctx.audio.onsets.kick ?? []) {
        if (t < a || t >= b || s < 0.3) continue;
        if (this.kicks.length && t - this.kicks[this.kicks.length - 1]! < 0.07) continue;
        this.kicks.push(t);
      }
      if (this.kicks.length < 4) this.kicks = this.ctx.audio.beats.filter((t) => t >= a && t < b);
    }
  }

  private get au() { return this.ctx.audio; }

  /** Sum of PQRST complexes around the beat grid (shifted by `off` s). */
  private heart(tau: number, off = 0): number {
    const b = this.au.beats, i = beatIndex(this.au, tau - off);
    let v = 0;
    for (let k = i - 1; k <= i + 1; k++) if (b[k] !== undefined) v += pqrst(tau - off - b[k]!);
    return v;
  }
  private pacer(tau: number, off = 0): number {
    const b = this.au.beats, i = beatIndex(this.au, tau - off);
    let v = 0;
    for (let k = i - 1; k <= i; k++) if (b[k] !== undefined) v += pace(tau - off - b[k]!);
    return v;
  }
  /** Traction: each beat yanks the towed objects forward by 40 px (fast), then the camera catches up. */
  private tow(t: number, px = 40): number {
    const b = this.au.beats, i = beatIndex(this.au, t);
    let v = 0;
    for (let k = i; k >= Math.max(0, i - 2); k--) {
      const d = t - b[k]!;
      if (d >= 0) v += px * (1 - Math.exp(-d / 0.022)) * Math.exp(-d / 0.3);
    }
    return v;
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const st = stateAt(this.list, f.t);
    const L = this.layer;
    L.clear();
    const v = this.plate.variant;
    let post: PostOverrides;
    let ground: [number, number, number] = LIN.ink;
    if (v === 'heart') post = this.heartPlate(f, st);
    else if (v === 'twin') post = this.twinPlate(f, st);
    else {
      post = this.squarePlate(f, st);
      if (st.medium === 'bone') ground = LIN.bone;
    }
    L.upload();
    clearRT(this.ctx.renderer, out, ground);
    this.ctx.comp.draw(this.ctx.renderer, L.texture, out, { mode: 'normal' });
    return post;
  }

  // ================================================================== p02 heart
  private heartPlate(f: Frame, st: Record<string, any>): PostOverrides {
    const c = this.layer.ctx, t = f.t, au = this.au;
    const bp = beatPulse(au, t, 0.14), db = downbeatPulse(au, t, 0.3);
    const { t0 } = shotAt(this.list, t);
    const taut = st.topo === 'line' ? 1 - Math.exp(-(t - t0) / 0.06) : 0;
    const env = 1 - taut;
    const towNow = this.tow(t);

    // the trace in scope coords; the stretch near the head is the rope being pulled
    const tr = new Trace();
    const span = (HX + 260) / HV;
    for (let tau = t - span; tau <= t + 1e-6; tau += 1 / 420) {
      const x = HX - HV * (t - tau) + towNow * Math.exp(-(t - tau) / 0.35);
      tr.push(x, HBASE - HAMP * env * this.heart(tau));
    }
    tr.push(HX + towNow, HBASE - HAMP * env * this.heart(t));
    const head = { x: HX + towNow, y: tr.ys[tr.ys.length - 1]! };
    const lineW = 3 + 3 * bp + 4 * taut;
    const trCol: PaletteKey = taut > 0.5 ? 'bone' : 'signal';

    const layout = st.layout as string;
    const lyric = this.lines[0]!;
    const t3 = st.frame === 'three-quarter';
    const P3 = proj3(0.42 + 0.08 * (t - t0), -0.1, 1420, 520, 1.15, 2600);

    if (!t3) {
      const cam: Cam = st.frame === 'low' ? { s: 1.35, fx: HX - 420, fy: HBASE - 80, rot: -0.06 }
        : st.frame === 'reticle' ? { s: 2.2, fx: this.cycleX(t, t0), fy: HBASE - 110, rot: 0 } : CAM0;
      c.save();
      applyCam(c, cam);
      // graticule: 100 px divisions, the vertical ones travel with the paper; a luminance hit on downbeats
      c.lineWidth = 1 / cam.s;
      const off = (HV * t) % 100;
      c.strokeStyle = rgba('graphite', (0.28 + 0.35 * db) * env);
      c.beginPath();
      for (let x = -off - 300; x < W + 300; x += 100) { c.moveTo(x, 40); c.lineTo(x, H - 40); }
      for (let y = HBASE - 500; y < H; y += 100) { c.moveTo(-300, y); c.lineTo(W + 300, y); }
      c.stroke();
      if (st.frame === 'reticle') {
        c.strokeStyle = rgba('graphite', 0.3);
        c.beginPath();
        for (let x = -off - 300; x < W + 300; x += 20) { c.moveTo(x, HBASE - 400); c.lineTo(x, HBASE + 200); }
        for (let y = HBASE - 400; y < HBASE + 200; y += 20) { c.moveTo(-300, y); c.lineTo(W + 300, y); }
        c.stroke();
      }
      // cursors: two scope markers towed by the head, riding the trace
      if (env > 0.02) this.cursors(c, t, tr, cam.s, env);
      // the trace + head
      c.strokeStyle = rgba(trCol);
      c.lineWidth = lineW / Math.sqrt(cam.s);
      c.lineJoin = 'round';
      if (taut > 0) {
        // pulled taut: the whole width, straight, drawn as one line
        const hh = 2 + lineW + 1300 * ease.inQuad(smoothstep(f.end - 0.13, f.end - 0.015, t));
        c.fillStyle = rgba('bone', lerp(0.6, 1, taut));
        c.fillRect(-400, HBASE - hh / 2, W + 800, hh);
      }
      tr.stroke(c);
      c.fillStyle = rgba('bone');
      c.beginPath(); c.arc(head.x, head.y, (5 + 3 * bp) / Math.sqrt(cam.s), 0, TAU); c.fill();
      c.restore();
      if (st.frame === 'reticle') this.reticle(c, cam, t, t0);

      // lyric riding the trace
      if (layout === 'ride-tight') {
        // screen space over the zoomed trace
        const y0 = 540 + (HBASE - cam.fy) * cam.s - 34;
        const ride = (x: number) => 540 + (tr.yAt(cam.fx + (x - 960) / cam.s, HBASE) - cam.fy) * cam.s - (540 + (HBASE - cam.fy) * cam.s);
        this.heartLyric(c, lyric, t, 150, y0, 118, 1620, ride, 1);
      } else {
        c.save();
        applyCam(c, cam);
        const lo = layout === 'ride-low';
        const x0 = lo ? 440 : 170, mw = lo ? 980 : 1240, sz = lo ? 90 : 104;
        this.heartLyric(c, lyric, t, x0, HBASE - 40, sz, mw, (x) => tr.yAt(x, HBASE) - HBASE, 1);
        c.restore();
      }
    } else {
      // 3/4: the trace as a tow rope receding to the left, cursors behind it, the letters in front (parallax)
      const pr = (x: number, y: number, z: number) => P3(x - HX, y - HBASE, z);
      c.strokeStyle = rgba('graphite', 0.7);
      c.lineWidth = 1.2;
      c.beginPath();
      const off = (HV * t) % 100;
      for (let x = HX + 200 - off; x > -400; x -= 100) {
        const [ax, ay] = pr(x, HBASE + 150, 0), [bx, by] = pr(x, HBASE + (Math.round((x + off) / 100) % 5 === 0 ? 205 : 180), 0);
        c.moveTo(ax, ay); c.lineTo(bx, by);
      }
      const [r0x, r0y] = pr(-400, HBASE + 150, 0), [r1x, r1y] = pr(HX + 260, HBASE + 150, 0);
      c.moveTo(r0x, r0y); c.lineTo(r1x, r1y);
      c.stroke();
      for (let k = 1; k <= 2; k++) {
        const mx = HX - 230 * k + this.tow(t - 0.07 * k);
        const [ax, ay] = pr(mx, HBASE - 380, 120), [bx, by] = pr(mx, HBASE + 260, 120);
        c.strokeStyle = rgba('graphite', 0.9);
        c.setLineDash([8, 8]);
        c.beginPath(); c.moveTo(ax, ay); c.lineTo(bx, by); c.stroke();
        c.setLineDash([]);
        const [mx2, my2, mk] = pr(mx, tr.yAt(mx, HBASE), 0);
        c.strokeStyle = rgba('ember');
        c.lineWidth = 2.5;
        c.beginPath(); c.arc(mx2, my2, 11 * mk * (1 + 0.3 * bp), 0, TAU); c.stroke();
        c.lineWidth = 1.2;
      }
      c.strokeStyle = rgba('signal');
      c.lineJoin = 'round';
      c.beginPath();
      for (let i = 0; i < tr.xs.length; i++) {
        const [x, y] = pr(tr.xs[i]!, tr.ys[i]!, 0);
        i ? c.lineTo(x, y) : c.moveTo(x, y);
      }
      c.lineWidth = lineW;
      c.stroke();
      const [hx, hy, hk] = pr(head.x, head.y, 0);
      c.fillStyle = rgba('bone');
      c.beginPath(); c.arc(hx, hy, (6 + 3 * bp) * hk, 0, TAU); c.fill();
      this.heartLyric(c, lyric, t, 170, HBASE - 40, 104, 1240, (x) => tr.yAt(x, HBASE) - HBASE, 1, (cx, cy) => pr(cx, cy, -170));
    }

    const flash = 0.45 * smoothstep(f.end - 0.06, f.end - 0.005, t);
    return { bloom: 0, shake: [-4 * bp, 0], zoom: 1 + 0.012 * db, flash };
  }

  /** x (scope) of the complex the reticle holds: the R spike of the beat at/after the shot start, travelling left. */
  private cycleX(t: number, t0: number): number {
    const b = this.au.beats[Math.max(0, beatIndex(this.au, t0 + 1e-3))]!;
    return HX - HV * (t - b) + this.tow(t) * Math.exp(-(t - b) / 0.35) - 40;
  }

  private cursors(c: CanvasRenderingContext2D, t: number, tr: Trace, s: number, a: number) {
    const au = this.au, bp = beatPulse(au, t, 0.14);
    const xs: number[] = [];
    for (let k = 1; k <= 2; k++) {
      const mx = HX - 230 * k + this.tow(t - 0.07 * k);
      xs.push(mx);
      c.strokeStyle = rgba('graphite', 0.9 * a);
      c.lineWidth = 1.2 / s;
      c.setLineDash([8 / s, 8 / s]);
      c.beginPath(); c.moveTo(mx, 150); c.lineTo(mx, 930); c.stroke();
      c.setLineDash([]);
      c.fillStyle = rgba('ember', a);
      c.beginPath(); c.moveTo(mx - 12, 128); c.lineTo(mx + 12, 128); c.lineTo(mx, 150); c.closePath(); c.fill();
      c.font = font(F.mono(500), 20);
      c.textAlign = 'center';
      c.fillText(`M${k}`, mx, 116);
      const my = tr.yAt(mx, HBASE);
      c.strokeStyle = rgba('ember', a);
      c.lineWidth = 2.5 / s;
      c.beginPath(); c.arc(mx, my, 11 * (1 + 0.3 * bp), 0, TAU); c.stroke();
    }
    c.fillStyle = rgba('graphite', a);
    c.font = font(F.mono(400), 20);
    c.fillText(`Δt ${(60 / au.bpm).toFixed(3)} s`, (xs[0]! + xs[1]!) / 2, 140);
    c.textAlign = 'left';
  }

  private reticle(c: CanvasRenderingContext2D, cam: Cam, t: number, t0: number) {
    const au = this.au, bp = beatPulse(au, t, 0.14);
    const cx = 960, cy = 480, r = 300 + 16 * bp;
    c.save();
    c.strokeStyle = rgba('bone', 0.85);
    c.lineWidth = 1.5;
    c.beginPath(); c.arc(cx, cy, r, 0, TAU); c.stroke();
    c.beginPath(); c.arc(cx, cy, r * 0.25, 0, TAU); c.stroke();
    c.beginPath();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      c.moveTo(cx + dx * r * 0.3, cy + dy * r * 0.3); c.lineTo(cx + dx * (r + 40), cy + dy * (r + 40));
    }
    for (let i = -8; i <= 8; i++) {
      const L = i % 4 === 0 ? 16 : 8;
      c.moveTo(cx + i * r / 8, cy - L); c.lineTo(cx + i * r / 8, cy + L);
    }
    c.stroke();
    c.font = font(F.mono(500), 24);
    c.fillStyle = rgba('bone', 0.9);
    c.fillText('R', cx + 14, cy - r - 14);
    c.fillStyle = rgba('graphite');
    c.fillText(`${au.bpm.toFixed(1)} BPM`, cx + r + 30, cy - 20);
    c.fillText(`${((t - t0) * 1000).toFixed(0).padStart(3, '0')} ms`, cx + r + 30, cy + 16);
    c.restore();
  }

  /** Line 2 riding the trace: towed forward per beat (a wave of traction back along the train), new syllables tugged in. */
  private heartLyric(
    c: CanvasRenderingContext2D, line: Line, t: number, x0: number, y0: number, size: number, maxWidth: number,
    ride: (x: number) => number, towK: number, project?: (cx: number, cy: number) => [number, number, number, number],
  ) {
    drawLyric(c, line, t, {
      x: x0, y: y0, size, maxWidth, align: 'left', family: F.slam(),
      sungColor: 'bone', unsungColor: 'bone', unsungAlpha: 0.26,
      drawChar: keyline(size * 0.14, 'ink'),
      charTransform: (_ch, _i, s: CharState): CharXform => {
        const cx = x0 + s.box.x + s.box.w / 2;
        const lag = (HX - cx) / 2600;
        const dx = towK * this.tow(t - lag) + (s.sung ? 30 * (1 - s.frac) ** 3 : 30);
        const dy = 0.55 * clamp(ride(cx + dx), -130, 30);
        if (!project) return { dx, dy };
        const cy = y0 - size * 0.35;
        const [px, py, , sx] = project(cx + dx, cy + dy);
        return { dx: px - cx, dy: py - cy, scale: sx };
      },
    });
  }

  // ================================================================== p12 twin
  private twinEnv(tau: number): { l: number; r: number } {
    // falter window: the right channel skips, then drops out; the left dies with it and returns with it
    const s1 = this.sb[1]!, back = this.sb[1]! + 1.46;
    const drop0 = s1 + 0.3;
    let r = 1;
    if (tau >= s1 && tau < drop0) r = 0.35 + 0.65 * Math.abs(Math.sin(tau * 23.0));
    if (tau >= drop0 && tau < back) r = 0;
    if (tau >= back) r = smoothstep(back, back + 0.12, tau);
    const l = 1 - smoothstep(drop0 + 0.04, drop0 + 0.3, tau) * (1 - smoothstep(back, back + 0.2, tau));
    return { l: Math.max(0.07, l), r: Math.max(0.07, r) };
  }

  private twinPlate(f: Frame, st: Record<string, any>): PostOverrides {
    const c = this.layer.ctx, t = f.t, au = this.au;
    const bp = beatPulse(au, t, 0.14), db = downbeatPulse(au, t, 0.3);
    const { t0 } = shotAt(this.list, t);
    const syncT = this.sb[2]!;
    const offR = (tau: number) => (tau < syncT ? 0.29 : 0);
    const line = this.lines[0]!;
    const lastW = line.words[line.words.length - 1]!;
    const topo = st.topo as string;
    const fr = st.frame as string;
    const dropping = topo === 'falter' ? 1 - this.twinEnv(t).r : 0;
    const w0 = 2.6 + 3.2 * bp + 2.5 * dropping * bp;

    if (topo === 'apart' || topo === 'falter') {
      const cam: Cam = fr === 'tight-gap' ? { s: 1.5, fx: 960, fy: 490, rot: 0 } : fr === 'tight-left' ? { s: 1.5, fx: 760, fy: 490, rot: 0 } : CAM0;
      c.save();
      applyCam(c, cam);
      this.chassis(c, t, bp, db);
      const SL = { x: 140, y: 190, w: 730, h: 600 }, SR = { x: 1050, y: 190, w: 730, h: 600 };
      // left: heart, history scrolls left from the head at the gap
      const trL = new Trace(), trR = new Trace();
      for (let tau = t - SL.w / T2.v - 0.1; tau <= t + 1e-6; tau += 1 / 420) {
        trL.push(T2.hl - T2.v * (t - tau), T2.base - T2.amp * this.twinEnv(tau).l * this.heart(tau));
      }
      for (let tau = t; tau >= t - SR.w / T2.v - 0.1; tau -= 1 / 420) {
        trR.push(T2.hr + T2.v * (t - tau), T2.base - T2.amp * 0.9 * this.twinEnv(tau).r * this.pacer(tau, offR(tau)));
      }
      c.lineJoin = 'round';
      c.lineWidth = w0;
      for (const [tr, S, col] of [[trL, SL, 'signal'], [trR, SR, 'ember']] as const) {
        c.save();
        c.beginPath(); c.rect(S.x, S.y, S.w, S.h); c.clip();
        c.strokeStyle = rgba(col);
        tr.stroke(c);
        c.restore();
      }
      c.fillStyle = rgba('bone');
      for (const tr of [trL, trR]) {
        const i = tr === trL ? tr.xs.length - 1 : 0;
        c.beginPath(); c.arc(tr.xs[i]!, tr.ys[i]!, 5 + 3 * bp, 0, TAU); c.fill();
      }
      // line 13 in two columns in the gap, between the facing heads
      const a = subLine(line, 0, 3), b = subLine(line, 3, line.words.length);
      for (const [sl, x] of [[a, 918], [b, 1002]] as const) {
        drawLyric(c, sl, t, {
          x, y: 215, size: 72, vertical: true, maxWidth: 550, family: F.slam(),
          sungColor: 'bone', unsungColor: 'bone', unsungAlpha: 0.25,
          charTransform: (_ch, _i, s) => ({ scale: s.sung ? 1 + 0.08 * bp : 1 }),
        });
      }
      c.restore();
    } else {
      // one screen, two traces running together: A spikes up, B spikes down, the line between them
      const S = T2.sync;
      const depth = fr === 'depth';
      const cam: Cam = fr === 'screen-heads' ? { s: 1.28, fx: S.hx - 560, fy: (S.ya + S.yb) / 2, rot: 0 } : CAM0;
      const P3 = proj3(0.5 - 0.06 * (t - t0), -0.12, 1360, 540, 1.12, 2600);
      const pr = (x: number, y: number, z: number) => depth ? P3(x - S.hx, y - (S.ya + S.yb) / 2, z) : [x, y, 1, 1] as [number, number, number, number];
      c.save();
      if (!depth) applyCam(c, cam);
      const sw = 1 / cam.s;
      // screen bezel + division ticks
      c.strokeStyle = rgba('graphite', 0.8);
      c.lineWidth = 1.5 * sw;
      const box = [[140, 170], [1780, 170], [1780, 930], [140, 930]] as const;
      c.beginPath();
      box.forEach(([x, y], i) => { const [px, py] = pr(x, y, 0); i ? c.lineTo(px, py) : c.moveTo(px, py); });
      c.closePath(); c.stroke();
      c.strokeStyle = rgba('graphite', 0.3 + 0.4 * db);
      c.beginPath();
      const off = (T2.v * t) % 110;
      for (let x = S.hx - off; x > 150; x -= 110) {
        for (const y of [S.ya + 150, S.yb - 150]) {
          const [ax, ay] = pr(x, y - 10, 0), [bx, by] = pr(x, y + 10, 0);
          c.moveTo(ax, ay); c.lineTo(bx, by);
        }
      }
      c.stroke();
      const trA = new Trace(), trB = new Trace();
      for (let tau = t - (S.hx - 150) / T2.v; tau <= t + 1e-6; tau += 1 / 420) {
        const x = S.hx - T2.v * (t - tau);
        trA.push(x, S.ya - T2.amp * 0.85 * this.heart(tau));
        trB.push(x, S.yb + T2.amp * 0.85 * this.pacer(tau, offR(tau)));
      }
      c.lineJoin = 'round';
      c.lineWidth = w0 * sw;
      for (const [tr, col] of [[trA, 'signal'], [trB, 'ember']] as const) {
        c.strokeStyle = rgba(col);
        c.beginPath();
        for (let i = 0; i < tr.xs.length; i++) {
          const [x, y] = pr(tr.xs[i]!, tr.ys[i]!, 0);
          i ? c.lineTo(x, y) : c.moveTo(x, y);
        }
        c.stroke();
      }
      const ha = pr(S.hx, trA.ys[trA.ys.length - 1]!, 0), hb = pr(S.hx, trB.ys[trB.ys.length - 1]!, 0);
      c.fillStyle = rgba('bone');
      for (const h of [ha, hb]) { c.beginPath(); c.arc(h[0], h[1], (5 + 3 * bp) * h[2] * sw, 0, TAU); c.fill(); }

      // the connecting line: forms on the last word, slack; pulls taut on the storyboard shot; bends into the orbit
      const form = smoothstep(lastW.start, lastW.start + 0.5, t);
      if (form > 0) {
        const tautT = this.sb[3]!;
        const taut = smoothstep(tautT - 0.02, tautT + 0.1, t);
        const m = ease.inOutCubic(smoothstep(f.end - 0.3, f.end - 0.02, t));
        const midY = (S.ya + S.yb) / 2, half = (S.yb - S.ya) / 2 - 40;
        const slack = (1 - taut) * 70 * Math.sin(t * 5.3);
        c.strokeStyle = rgba(taut > 0.5 ? 'bone' : 'ember', form);
        c.lineWidth = (lerp(1, 3, taut) + 7 * m) * sw * (1 + 0.8 * bp);
        c.beginPath();
        for (let i = 0; i <= 96; i++) {
          const u = i / 96;
          const th = -Math.PI / 2 + u * Math.PI * (1 + m);
          let x = S.hx + slack * Math.sin(Math.PI * u) + 560 * m * Math.cos(th);
          let y = midY + half * (1 + 0.1 * m) * Math.sin(th) * (1 - 0.55 * m);
          const rot = -0.22 * m, dx = x - S.hx, dy = y - midY;
          x = S.hx - 300 * m + dx * Math.cos(rot) - dy * Math.sin(rot);
          y = midY + dx * Math.sin(rot) + dy * Math.cos(rot);
          const [px, py] = pr(x, y, 0);
          i ? c.lineTo(px, py) : c.moveTo(px, py);
        }
        c.stroke();
      }
      // line 13 between the two traces
      const heads = fr === 'screen-heads';
      const x0 = heads ? S.hx - 1180 : 220, mw = heads ? 1000 : 1260, sz = heads ? 92 : 112;
      const yL = (S.ya + S.yb) / 2 + sz * 0.36;
      drawLyric(c, line, t, {
        x: x0, y: yL, size: sz, maxWidth: mw, align: 'left', family: F.slam(),
        sungColor: 'bone', unsungColor: 'bone', unsungAlpha: 0.25,
        charTransform: (_ch, _i, s) => {
          const sc = s.sung ? 1 + 0.07 * bp : 1;
          if (!depth) return { scale: sc };
          const cx = x0 + s.box.x + s.box.w / 2, cy = yL - sz * 0.35;
          const [px, py, , sx] = pr(cx, cy, -90);
          return { dx: px - cx, dy: py - cy, scale: sx * sc };
        },
      });
      c.restore();
    }
    const orbit = smoothstep(f.end - 0.3, f.end - 0.02, t);
    return {
      bloom: 0.55 * orbit, bloomThreshold: 0.6,
      zoom: 1 + 0.05 * db, shake: [0, 6 * bp],
      flash: 0.1 * smoothstep(f.end - 0.08, f.end, t),
    };
  }

  private chassis(c: CanvasRenderingContext2D, t: number, bp: number, db: number) {
    c.fillStyle = rgba('ink2');
    c.strokeStyle = rgba('graphite', 0.9);
    c.lineWidth = 2;
    c.beginPath(); c.roundRect(80, 110, 1760, 860, 18); c.fill(); c.stroke();
    for (const [x, y] of [[106, 136], [1814, 136], [106, 944], [1814, 944]] as const) {
      c.beginPath(); c.arc(x, y, 7, 0, TAU); c.stroke();
      c.beginPath(); c.moveTo(x - 5, y); c.lineTo(x + 5, y); c.stroke();
    }
    for (const [S, lab, led] of [[{ x: 140, y: 190 }, 'CH A', 190], [{ x: 1050, y: 190 }, 'CH B', 1730]] as const) {
      c.fillStyle = rgba('ink');
      c.fillRect(S.x, S.y, 730, 600);
      c.strokeStyle = rgba('graphite', 0.9);
      c.lineWidth = 2;
      c.strokeRect(S.x, S.y, 730, 600);
      c.strokeStyle = rgba('graphite', 0.22 + 0.3 * db);
      c.lineWidth = 1;
      c.beginPath();
      for (let i = 1; i < 10; i++) { c.moveTo(S.x + i * 73, S.y); c.lineTo(S.x + i * 73, S.y + 600); }
      for (let i = 1; i < 8; i++) { c.moveTo(S.x, S.y + i * 75); c.lineTo(S.x + 730, S.y + i * 75); }
      c.stroke();
      c.fillStyle = rgba('graphite');
      c.font = font(F.mono(500), 22);
      c.fillText(lab, S.x, 168);
      c.fillStyle = rgba('signal', 0.2 + 0.8 * bp);
      c.beginPath(); c.arc(led, 852, 12, 0, TAU); c.fill();
      c.strokeStyle = rgba('graphite');
      for (let k = 0; k < 3; k++) {
        const kx = S.x + 170 + k * 150;
        c.beginPath(); c.arc(kx, 858, 26, 0, TAU); c.stroke();
        const a = -Math.PI / 2 + 0.9 * Math.sin(k * 2.1 + 1);
        c.beginPath(); c.moveTo(kx, 858); c.lineTo(kx + 22 * Math.cos(a), 858 + 22 * Math.sin(a)); c.stroke();
      }
    }
  }

  // ================================================================== p28 square
  private squarePlate(f: Frame, st: Record<string, any>): PostOverrides {
    const c = this.layer.ctx, t = f.t, au = this.au;
    const bp = beatPulse(au, t, 0.13), db = downbeatPulse(au, t, 0.3), kp = kickPulse(au, t, 0.08);
    const line = this.lines[0]!;
    const topo = st.topo as string;

    if (topo === 'sine') {
      // hardness steps up on each beat of bar 1 (the wave locks), fully square by the raster cut
      const b0 = beatIndex(au, this.plate.start);
      const n = beatIndex(au, t) - b0;
      const snap = ease.outExpo(clamp((t - (au.beats[beatIndex(au, t)] ?? t)) / 0.1));
      const hard = clamp((Math.max(0, n - 1) + (n >= 1 ? snap : 0)) / 3);
      const amp = SQ.amp * (1 + 0.32 * bp);
      const k = 1 + 40 * hard * hard;
      const wave = (x: number) => {
        const irr = 1 - hard;
        const ph = (x / 360) * TAU - t * 4.2 + irr * 1.8 * noise1(x / 420 + t * 0.6, 3);
        const s = Math.sin(ph);
        const sq = hard > 0.995 ? Math.sign(s) : Math.tanh(k * s) / Math.tanh(k);
        return SQ.base - amp * sq * (1 + irr * 0.45 * noise1(x / 300 - t, 9));
      };
      const close = st.frame === 'close';
      const cam: Cam = close ? { s: 1.55, fx: 1150, fy: SQ.base - 30, rot: -0.07 } : CAM0;
      c.save();
      applyCam(c, cam);
      const tr = new Trace();
      for (let x = -300; x <= W + 300; x += 2) tr.push(x, wave(x));
      c.strokeStyle = rgba('graphite', 0.5);
      c.lineWidth = 1 / cam.s;
      c.beginPath(); c.moveTo(-300, SQ.base); c.lineTo(W + 300, SQ.base); c.stroke();
      c.strokeStyle = rgba('signal');
      c.lineWidth = (3 + 7 * bp + 2 * kp) / cam.s;
      c.lineJoin = 'miter';
      tr.stroke(c);
      const x0 = close ? 620 : 140, mw = close ? 1060 : 1640, sz = close ? 110 : 150;
      const lay = layoutLine(c, line, F.slam(), sz, mw);
      const wordMid = lay.words.map((w) => x0 + w.x + w.w / 2);
      drawLyric(c, line, t, {
        x: x0, y: SQ.base - 24, size: sz, maxWidth: mw, align: 'left', family: F.slam(),
        sungColor: 'bone', unsungColor: 'bone', unsungAlpha: 0.25,
        drawChar: keyline(sz * 0.14, 'ink'),
        charTransform: (_ch, _i, s) => {
          // whole words ride the wave (the word's centre), so the square steps the words, not the letters
          const wc = wordMid[s.word] ?? x0 + s.box.x;
          return { dy: 0.3 * (tr.yAt(wc, SQ.base) - SQ.base), scale: s.sung ? 1 + 0.1 * bp : 1 };
        },
      });
      c.restore();
      return { bloom: 0, zoom: 1 + 0.07 * bp + 0.06 * db, shake: [0, 10 * bp] };
    }

    if (topo === 'raster') {
      const K = this.kicks, N = K.length;
      const pitch = (SQ.bottom - SQ.top) / Math.max(1, N - 1);
      const rowY = (i: number) => SQ.top + i * pitch;
      let laid = 0;
      while (laid < N && K[laid]! <= t) laid++;
      // raster lines: square waves, alternate rows tear sideways on each beat and lock back (h-sync)
      for (let i = 0; i < laid; i++) {
        const age = t - K[i]!;
        const sweep = clamp(age / 0.07);
        const tear = (i % 2 ? 1 : -1) * 70 * bp * (1 - 0.5 * (i / N));
        const y = rowY(i), a = 12;
        c.strokeStyle = i === laid - 1 && age < 0.18 ? rgba('bone') : rgba('signal', lerp(0.95, 0.55, clamp((laid - 1 - i) / 8)));
        c.lineWidth = i === laid - 1 ? 3 + 2 * kp : 2;
        c.beginPath();
        const xEnd = -20 + (W + 40) * sweep;
        let x = -20 + tear - SQ.lam;
        let hi = true;
        c.moveTo(x, y - a);
        while (x < xEnd) {
          const nx = Math.min(xEnd, x + SQ.lam / 2);
          c.lineTo(nx, y + (hi ? -a : a));
          if (nx < xEnd) { hi = !hi; c.lineTo(nx, y + (hi ? -a : a)); }
          x = nx;
        }
        c.stroke();
        if (sweep < 1) {
          c.fillStyle = rgba('bone');
          c.beginPath(); c.arc(xEnd, y + (hi ? -a : a), 6, 0, TAU); c.fill();
        }
      }
      // line 29 written on the scanlines: each word sits on the line the beam was laying when it was sung
      const tx = this.tx, tc = tx.ctx;
      tx.clear();
      const x0 = 140, sz = 120;
      const rowOf = (ws: number) => { let r = 0; while (r < N && K[r]! <= ws) r++; return Math.max(0, r - 1); };
      drawLyric(tc, line, t, {
        x: x0, y: SQ.top - 14, size: sz, maxWidth: 1640, align: 'left', family: F.slam(),
        sungColor: 'bone', unsungColor: 'bone', unsungAlpha: 0.3,
        charTransform: (_ch, _i, s) => {
          const w = line.words[s.word]!;
          const row = s.sung || w.start <= t ? rowOf(w.start) : Math.min(N - 1, laid);
          return { dy: rowY(row) - SQ.top, scale: s.sung ? 1 + 0.08 * bp : 1 };
        },
      });
      // scan gaps through the letters
      tc.globalCompositeOperation = 'destination-out';
      tc.fillStyle = rgba('ink');
      for (let y = 0; y < H; y += 7) tc.fillRect(0, y, W, 2);
      tc.globalCompositeOperation = 'source-over';
      c.drawImage(tx.canvas, 0, 0, W, H);
      return { bloom: 0, zoom: 1 + 0.06 * bp + 0.08 * db, shake: [14 * bp * (beatIndex(au, t) % 2 ? 1 : -1), 0] };
    }

    // spec: bone graph paper, the heartbeat as a regulated drawing; the pen stops (the clock stops)
    const close = st.frame === 'sheet-close';
    const flipT = this.sb[2]!;
    const lam = SQ.lam, wy = 690, wa = 120, x00 = 240;
    const bi0 = beatIndex(au, flipT);
    const bi = beatIndex(au, t);
    const steps = Math.max(0, bi - bi0);
    const stepE = steps > 0 ? ease.outExpo(clamp((t - au.beats[bi]!) / 0.12)) : 0;
    const periods = 3 + Math.max(0, steps - 1) + stepE;
    const penX = x00 + lam * periods;
    const cam: Cam = close ? { s: 1.7, fx: penX - lam * 0.6, fy: 560, rot: 0 } : CAM0;
    c.save();
    c.translate(0, 9 * bp);
    applyCam(c, cam);
    const sw = 1 / cam.s;
    // graph paper: 24 px cells, a heavier rule every 5
    c.lineWidth = sw;
    c.strokeStyle = rgba('graphite', 0.2);
    c.beginPath();
    for (let x = 0; x <= W; x += 24) { c.moveTo(x, 0); c.lineTo(x, H); }
    for (let y = 0; y <= H; y += 24) { c.moveTo(0, y); c.lineTo(W, y); }
    c.stroke();
    c.strokeStyle = rgba('graphite', 0.5 + 0.3 * db);
    c.beginPath();
    for (let x = 0; x <= W; x += 120) { c.moveTo(x, 0); c.lineTo(x, H); }
    for (let y = 0; y <= H; y += 120) { c.moveTo(0, y); c.lineTo(W, y); }
    c.stroke();
    // the regulated pulse
    c.strokeStyle = rgba('ink');
    c.lineWidth = 3.2 * sw * (1 + 0.5 * bp);
    c.lineJoin = 'miter';
    c.beginPath();
    c.moveTo(x00 - 120, wy);
    c.lineTo(x00, wy);
    let hi = true, x = x00;
    c.lineTo(x, wy - wa);
    while (x < penX) {
      const nx = Math.min(penX, x + lam / 2);
      c.lineTo(nx, wy + (hi ? -wa : wa));
      if (nx < penX) { hi = !hi; c.lineTo(nx, wy + (hi ? -wa : wa)); }
      x = nx;
    }
    c.stroke();
    c.fillStyle = rgba('signal');
    c.beginPath(); c.arc(penX, wy + (hi ? -wa : wa), 7 * sw * (1 + 0.6 * bp), 0, TAU); c.fill();
    // dimensions: period and amplitude callouts, stamped on each beat
    c.strokeStyle = rgba('ink', 0.85);
    c.fillStyle = rgba('ink', 0.85);
    c.lineWidth = 1.4 * sw;
    const dimY = wy + wa + 60, pa = x00 + lam, pb = pa + lam;
    const arrow = (ax: number, ay: number, bx: number, by: number) => {
      c.beginPath(); c.moveTo(ax, ay); c.lineTo(bx, by); c.stroke();
      const an = Math.atan2(by - ay, bx - ax);
      for (const [px, py, s] of [[ax, ay, 1], [bx, by, -1]] as const) {
        c.beginPath();
        c.moveTo(px, py);
        c.lineTo(px + s * 14 * Math.cos(an) - 5 * Math.sin(an), py + s * 14 * Math.sin(an) + 5 * Math.cos(an));
        c.lineTo(px + s * 14 * Math.cos(an) + 5 * Math.sin(an), py + s * 14 * Math.sin(an) - 5 * Math.cos(an));
        c.closePath(); c.fill();
      }
    };
    c.beginPath(); c.moveTo(pa, wy + wa + 10); c.lineTo(pa, dimY + 16); c.moveTo(pb, wy + wa + 10); c.lineTo(pb, dimY + 16); c.stroke();
    arrow(pa, dimY, pb, dimY);
    c.font = font(F.mono(500), 22);
    c.textAlign = 'center';
    c.fillText(`T = ${(60 / au.bpm).toFixed(3)} s`, (pa + pb) / 2, dimY + 34);
    arrow(x00 - 60, wy - wa, x00 - 60, wy + wa);
    c.save(); c.translate(x00 - 76, wy); c.rotate(-Math.PI / 2); c.fillText('A = 1.000', 0, 0); c.restore();
    c.textAlign = 'left';
    // title block: the clock readout stops with the pen
    const stopT = Math.min(t, au.beats[bi0 + 2] ?? t);
    c.strokeStyle = rgba('ink');
    c.lineWidth = 2 * sw;
    c.strokeRect(1320, 850, 480, 120);
    c.beginPath(); c.moveTo(1320, 890); c.lineTo(1800, 890); c.stroke();
    c.font = font(F.mono(700), 22);
    c.fillText('SPEC 29 · PULSE, REGULATED', 1336, 878);
    c.font = font(F.mono(400), 22);
    c.fillText(`${au.bpm.toFixed(2)} BPM   t = ${stopT.toFixed(2)} s`, 1336, 924);
    c.fillText(t >= stopT && t > (au.beats[bi0 + 2] ?? Infinity) ? 'CLOCK: STOPPED' : 'CLOCK: RUNNING', 1336, 954);
    // line 29 typeset on the sheet at a fixed pitch: every letter owns a whole number of cells, two rows
    const pitch = close ? 72 : 96, sz = close ? 64 : 88;
    const x0 = close ? Math.round((cam.fx - 470) / 24) * 24 : 240, y0 = close ? 360 : 264;
    const split = Math.min(3, line.words.length - 1);
    // per word: its first cell in its row, and the line index of its first letter
    const cell: number[] = [], first: number[] = [];
    let col = 0, idx = 0;
    line.words.forEach((w, wi) => {
      if (wi === split) col = 0;
      cell.push(col);
      first.push(idx);
      const n = Array.from(w.w).length;
      col += n + 1;
      idx += n;
    });
    drawLyric(c, line, t, {
      x: x0, y: y0, size: sz, align: 'left', family: F.slam(),
      sungColor: 'ink', unsungColor: 'graphite', unsungAlpha: 0.6,
      charTransform: (_ch, _i, s) => {
        const row = s.word >= split ? 1 : 0;
        const tx = x0 + (cell[s.word]! + s.box.index - first[s.word]! + 0.5) * pitch, ty = y0 + row * pitch * 1.25 - sz * 0.35;
        const cx = x0 + s.box.x + s.box.w / 2, cy = y0 - sz * 0.35;
        return { dx: tx - cx, dy: ty - cy, scale: s.sung ? 1 + 0.12 * bp : 1 };
      },
    });
    c.restore();
    return { bloom: 0, zoom: 1 + 0.05 * bp + 0.06 * db, flash: t >= flipT ? 0.12 * Math.exp(-(t - flipT) / 0.04) : 0 };
  }

  override dispose() {
    this.layer?.texture.dispose();
    this.tx?.texture.dispose();
  }
}
