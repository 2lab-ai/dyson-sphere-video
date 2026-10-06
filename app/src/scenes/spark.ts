// SPARK — the through-line motif: one signal-orange point of light and its hairline, on ink.
// Five plates (docs/STORYBOARD.md), one composition per variant, all driven by stateAt() of ./spark.shots:
//   write  (p01)  black -> the point ignites centre-left on beat 1 and pulls one hairline across. It then WRITES
//                 line 0: each syllable's real Black Han Sans outline (opentype.js contours, resampled) is traced
//                 with a dash offset, the pen being the point. While a stroke is fresh it is not yet a letter: on
//                 the first word it is a window frame on a street (contour projected onto its bbox), after the
//                 hard cut on the second word a circuit trace (contour snapped to a Manhattan grid) — each melts
//                 into the true glyph as its syllable ends, then fills bone. Line 1 is dragged in at speed (streaks
//                 that settle into letters) under a tight tracking camera; the camera finally whips past the point.
//   race   (p09)  a 3D timeline ruler with one year tick per beat. The point crosses a tick exactly on every beat
//                 (the tick flashes and jumps 14 px); each word of line 9 stands on the ruler where the point was
//                 at that word's own start. Side tracking -> head-on (it rushes at the lens) -> overhead vanishing
//                 strip -> locked camera, the point leaves frame right while the ticks keep flashing.
//   glint  (p21)  inside the pupil's reflection: a constellation; line 20 is spelled by points flying in from the
//                 stars (real glyph coverage samples). The points stand up as a table-top future-city model (the
//                 letters extruded into floors with lit windows), then flatten into p22's grid of buttons.
//   merge  (p27)  marks of different rhythm/length/tilt (the line's letters among them) jump one grid step closer
//                 per beat until they lock into a uniform grid with the line printed on it; the grid compresses
//                 and collapses into one point. Downbeats = full-frame signal flare (not a polarity swap).
//   outro  (p41)  the point alone on its hairline: one size step smaller per beat, the hairline undrawn at the
//                 beat rate, cut to black at size 0 on the last beat.
import type * as THREE from 'three';
import { Scene, type Frame, type PostOverrides } from '../engine/scene';
import { Layer2D, clearRT, W, H } from '../engine/gl';
import { LIN, rgba, type PaletteKey } from '../engine/palette';
import { drawLyric, ownedLines, layoutLine, F, type LineLayout, type CharState } from '../engine/lyric';
import { beatPulse, kickPulse, downbeatPulse } from '../engine/beat';
import { stateAt, shotAt, type PlateInfo, type Shot } from '../engine/shots';
import { ot, textPoints, font } from '../engine/type';
import { igniteRamp } from '../engine/prim';
import { hash, clamp, lerp, smoothstep, ease, prog, TAU } from '../engine/util';
import type { Line, Word } from '../engine/lyrics';
import { shots } from './spark.shots';

type P = { x: number; y: number };
type Aff = [number, number, number, number, number, number];
const FAM = F.slam();

// ------------------------------------------------------------------ glyph outlines (write)
/** One closed contour of a glyph, resampled to 2N points in em units (y down, baseline 0), in three shapes. */
interface Contour { g: Float32Array; rect: Float32Array; circ: Float32Array; bx: [number, number, number, number] }
const NRES = 40;
const outlineCache = new Map<string, Contour[]>();

function glyphContours(ch: string): Contour[] {
  const hit = outlineCache.get(ch);
  if (hit) return hit;
  const cmds = ot(FAM).charToGlyph(ch).getPath(0, 0, 1).commands;
  const polys: P[][] = [];
  let cur: P[] = [], px = 0, py = 0;
  for (const c of cmds) {
    if (c.type === 'M') { if (cur.length > 2) polys.push(cur); cur = [{ x: c.x, y: c.y }]; px = c.x; py = c.y; }
    else if (c.type === 'L') { cur.push({ x: c.x, y: c.y }); px = c.x; py = c.y; }
    else if (c.type === 'Q') {
      for (let i = 1; i <= 6; i++) { const t = i / 6, u = 1 - t; cur.push({ x: u * u * px + 2 * u * t * c.x1 + t * t * c.x, y: u * u * py + 2 * u * t * c.y1 + t * t * c.y }); }
      px = c.x; py = c.y;
    } else if (c.type === 'C') {
      for (let i = 1; i <= 8; i++) {
        const t = i / 8, u = 1 - t;
        cur.push({ x: u * u * u * px + 3 * u * u * t * c.x1 + 3 * u * t * t * c.x2 + t * t * t * c.x, y: u * u * u * py + 3 * u * u * t * c.y1 + 3 * u * t * t * c.y2 + t * t * t * c.y });
      }
      px = c.x; py = c.y;
    } else if (c.type === 'Z') { if (cur.length > 2) polys.push(cur); cur = []; }
  }
  if (cur.length > 2) polys.push(cur);
  const out: Contour[] = polys.map((poly) => {
    // resample the closed polyline to NRES points by arclength
    const n = poly.length, cum = [0];
    for (let i = 0; i < n; i++) { const a = poly[i]!, b = poly[(i + 1) % n]!; cum.push(cum[i]! + Math.hypot(b.x - a.x, b.y - a.y)); }
    const L = cum[n]!, pts: P[] = [];
    let k = 0;
    for (let i = 0; i < NRES; i++) {
      const s = (i / NRES) * L;
      while (k < n - 1 && cum[k + 1]! < s) k++;
      const a = poly[k]!, b = poly[(k + 1) % n]!, u = (s - cum[k]!) / Math.max(1e-6, cum[k + 1]! - cum[k]!);
      pts.push({ x: lerp(a.x, b.x, u), y: lerp(a.y, b.y, u) });
    }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, cx = 0, cy = 0;
    for (const p of pts) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); cx += p.x / NRES; cy += p.y / NRES; }
    const g = new Float32Array(NRES * 4), rect = new Float32Array(NRES * 4), circ = new Float32Array(NRES * 4);
    const Q = 0.075, snap = (v: number) => Math.round(v / Q) * Q;
    for (let i = 0; i < NRES; i++) {
      const a = pts[i]!, b = pts[(i + 1) % NRES]!;
      // doubled: even = sample, odd = midpoint (glyph) / Manhattan corner (circuit)
      g[4 * i] = a.x; g[4 * i + 1] = a.y; g[4 * i + 2] = (a.x + b.x) / 2; g[4 * i + 3] = (a.y + b.y) / 2;
      circ[4 * i] = snap(a.x); circ[4 * i + 1] = snap(a.y); circ[4 * i + 2] = snap(b.x); circ[4 * i + 3] = snap(a.y);
    }
    // window frame: every point pushed along its ray from the centroid onto the bbox
    for (let j = 0; j < NRES * 2; j++) {
      const dx = g[2 * j]! - cx, dy = g[2 * j + 1]! - cy;
      const tx = dx > 1e-6 ? (x1 - cx) / dx : dx < -1e-6 ? (x0 - cx) / dx : Infinity;
      const ty = dy > 1e-6 ? (y1 - cy) / dy : dy < -1e-6 ? (y0 - cy) / dy : Infinity;
      const tt = Math.min(tx, ty);
      rect[2 * j] = Number.isFinite(tt) ? cx + dx * tt : g[2 * j]!;
      rect[2 * j + 1] = Number.isFinite(tt) ? cy + dy * tt : g[2 * j + 1]!;
    }
    return { g, rect, circ, bx: [x0, y0, x1, y1] as [number, number, number, number] };
  });
  outlineCache.set(ch, out);
  return out;
}

/** Trace `rev` (0..1) of a blended contour with a dash; returns the pen head. */
function traceContour(c: CanvasRenderingContext2D, ct: Contour, pre: Float32Array, m: number, s: number, rev: number): P {
  const n = NRES * 2;
  let L = 0, lx = 0, ly = 0;
  c.beginPath();
  for (let j = 0; j <= n; j++) {
    const k = j % n;
    const x = lerp(pre[2 * k]!, ct.g[2 * k]!, m) * s, y = lerp(pre[2 * k + 1]!, ct.g[2 * k + 1]!, m) * s;
    if (j === 0) c.moveTo(x, y); else { c.lineTo(x, y); L += Math.hypot(x - lx, y - ly); }
    lx = x; ly = y;
  }
  c.setLineDash([Math.max(0.01, L * rev), L + 10]);
  c.lineDashOffset = 0;
  c.stroke();
  c.setLineDash([]);
  // head position at arclength rev*L
  let acc = 0, hx = lerp(pre[0]!, ct.g[0]!, m) * s, hy = lerp(pre[1]!, ct.g[1]!, m) * s;
  const target = L * rev;
  for (let j = 1; j <= n && acc < target; j++) {
    const k = j % n;
    const x = lerp(pre[2 * k]!, ct.g[2 * k]!, m) * s, y = lerp(pre[2 * k + 1]!, ct.g[2 * k + 1]!, m) * s;
    const d = Math.hypot(x - hx, y - hy);
    if (acc + d >= target) { const u = (target - acc) / Math.max(1e-6, d); return { x: lerp(hx, x, u), y: lerp(hy, y, u) }; }
    acc += d; hx = x; hy = y;
  }
  return { x: hx, y: hy };
}

// ------------------------------------------------------------------ small helpers
const affine = (s: number, rot: number, fx: number, fy: number, cx = W / 2, cy = H / 2): Aff => {
  const a = s * Math.cos(rot), b = s * Math.sin(rot);
  return [a, b, -b, a, cx - (a * fx - b * fy), cy - (b * fx + a * fy)];
};
const apply = (m: Aff, p: P): P => ({ x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] });

/** Sum of eased 0->1 steps, one per event time <= t (each step takes `dur`). */
function steps(times: readonly number[], t: number, dur: number, fn: (x: number) => number = ease.outCubic): number {
  let v = 0;
  for (const x of times) { if (x > t) break; v += fn(clamp((t - x) / dur)); }
  return v;
}

/** Syllable window [a0, a1] of a character. */
function sylWin(line: Line, st: CharState): [number, number] {
  const w: Word = line.words[st.word]!;
  const s = w.syl && w.syl.length ? w.syl : ([[w.start, w.end]] as [number, number][]);
  return s[Math.min(st.syl, s.length - 1)]!;
}

/** The glowing point (screen px). amp scales alpha, r = core radius. */
function drawPoint(c: CanvasRenderingContext2D, x: number, y: number, r: number, amp = 1) {
  if (r <= 0.05 || amp <= 0.01) return;
  const R = r * 6;
  const g = c.createRadialGradient(x, y, 0, x, y, R);
  g.addColorStop(0, rgba('bone', amp));
  g.addColorStop(0.12, rgba('ember', amp));
  g.addColorStop(0.3, rgba('signal', 0.55 * amp));
  g.addColorStop(1, rgba('signal', 0));
  c.fillStyle = g;
  c.beginPath(); c.arc(x, y, R, 0, TAU); c.fill();
  c.fillStyle = rgba('bone', amp);
  c.beginPath(); c.arc(x, y, Math.max(0.6, r * 0.55), 0, TAU); c.fill();
}

// ------------------------------------------------------------------ scene
export default class Spark extends Scene {
  private L!: Layer2D;
  private S!: Layer2D; // scratch for the whip smear
  private list: Shot[] = [];
  private plate!: PlateInfo;
  private lines: Line[] = [];
  private beats: number[] = [];
  private downs: number[] = [];

  override init() {
    this.plate = this.ctx.params as PlateInfo;
    this.list = shots(this.plate, this.ctx.audio);
    this.lines = ownedLines(this.ctx);
    this.L = new Layer2D();
    if (this.plate.variant === 'write') this.S = new Layer2D();
    const au = this.ctx.audio;
    this.beats = au.beats.filter((b) => b >= this.ctx.start - 1e-3 && b < this.ctx.end + 1e-3);
    this.downs = au.downbeats.filter((b) => b >= this.ctx.start - 1e-3 && b < this.ctx.end + 1e-3);
    // warm the outline cache so the first frame of the plate doesn't parse
    if (this.plate.variant === 'write') for (const l of this.lines) for (const ch of Array.from(l.text ?? '')) if (/[가-힣]/.test(ch)) glyphContours(ch);
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const L = this.L, c = L.ctx;
    L.clear();
    let post: PostOverrides;
    switch (this.plate.variant) {
      case 'race': post = this.race(c, f); break;
      case 'glint': post = this.glint(c, f); break;
      case 'merge': post = this.merge(c, f); break;
      case 'outro': post = this.outro(c, f); break;
      default: post = this.write(c, f);
    }
    c.setTransform(1, 0, 0, 1, 0, 0);
    L.upload();
    // hosted (v4 NIGHT, scenes/wall.ts): transparent ground — the wall host owns the brick
    const hosted = !!this.ctx.params.hosted;
    clearRT(this.ctx.renderer, out, hosted ? [0, 0, 0] : LIN.ink, hosted ? 0 : 1);
    this.ctx.comp.draw(this.ctx.renderer, L.texture, out, { mode: 'normal' });
    return post;
  }

  // ================================================================ p01 write
  private write(c: CanvasRenderingContext2D, f: Frame): PostOverrides {
    const au = this.ctx.audio, t = f.t;
    const st = stateAt(this.list, t), stage = st.stage as string, frame = st.frame as string;
    const [l0, l1] = this.lines as [Line, Line | undefined];
    const size0 = 176, size1 = 150;
    const lay0 = layoutLine(c, l0, FAM, size0);
    const o0: P = { x: -lay0.width / 2, y: 40 }; // line 0 baseline origin (world)
    const lay1 = l1 ? layoutLine(c, l1, FAM, size1) : null;
    const o1: P = { x: o0.x + 140, y: o0.y + 430 };
    const tIgn = this.beats[0] ?? this.ctx.start + 0.44;
    const l0start = l0.start;

    // ---- where the point is (world)
    const beatsBefore = this.beats.filter((b) => b < l0start);
    const hairY = o0.y + 34;
    const x0 = o0.x - 120, x1 = o0.x + lay0.width + 60;
    const snap = 24 * steps(beatsBefore, t, 0.05);
    const glide = (t: number) => x0 + (x1 - x0 - 24 * beatsBefore.length) * ease.inOutQuad(clamp((t - tIgn) / Math.max(0.1, l0start - 0.12 - tIgn)));
    let pen: P = { x: glide(t) + snap, y: hairY };
    // the latest started character's pen head, per line
    const heads: (P | null)[] = [null, null];

    // ---- camera
    const lead1 = lay1 ? this.lineHeadX(l1!, lay1, t) : 0;
    const penLine1: P = { x: o1.x + lead1 + 26, y: o1.y - size1 * 0.36 };
    const sh = shotAt(this.list, t);
    let M: Aff;
    let smear = 0;
    if (frame === 'wide') M = affine(0.92, 0, 0, 40);
    else if (frame === 'write') M = affine(1.12, 0, lerp(0, pen.x, 0.05), 0);
    else if (frame === 'macro') {
      // hard cut in: tilted, tighter, sliding with the pen of the second word
      const w1 = lay0.words[1]!, cx = o0.x + w1.x + w1.w * 0.45;
      M = affine(1.5, -0.075, cx + (t - sh.t0) * 40, o0.y - 70);
    } else if (frame === 'track') {
      M = affine(1.95, 0.02, penLine1.x - 180, penLine1.y + 10);
    } else {
      // whip: the camera overtakes the point (slow start, then a violent pan right)
      const u = clamp((t - sh.t0) / (this.ctx.end - sh.t0));
      // inExpo: the letters stay legible for the first ~2/3 of the whip, then the pan tears the frame
      const Tw = this.ctx.end - sh.t0, PAN = 2200;
      const pan = PAN * ease.inExpo(u);
      M = affine(1.95 + 0.3 * u, 0.02 - 0.1 * ease.inCubic(u), penLine1.x - 180 + pan, penLine1.y + 10);
      smear = ((PAN * 6.93 * ease.inExpo(u)) / Tw) * (1 / 60) * 2.1 * 2.5; // screen px the pan covers in ~2.5 frames
    }
    const setM = () => c.setTransform(M[0], M[1], M[2], M[3], M[4], M[5]);
    const sc = Math.hypot(M[0], M[1]);

    // ---- hairline under line 0 (the point's first trace), snapping forward per beat
    const ign = igniteRamp(t, tIgn - 0.02, 0.35);
    setM();
    c.lineCap = 'round';
    const hairEnd = t < l0start ? pen.x : x1 + 24 * steps(this.beats.filter((b) => b >= l0start), t, 0.05);
    if (ign > 0) {
      c.strokeStyle = rgba(stage === 'ignite' ? 'ember' : 'graphite', stage === 'ignite' ? 0.95 : 0.7);
      c.lineWidth = (1.4 + 1.6 * kickPulse(au, t, 0.1)) / sc;
      c.beginPath(); c.moveTo(x0, hairY); c.lineTo(Math.max(x0, hairEnd), hairY); c.stroke();
    }

    // ---- whip: the trace runs on ahead of the point (into p03's trace), speed hairlines everywhere
    if (frame === 'whip') {
      const u = clamp((t - sh.t0) / (this.ctx.end - sh.t0));
      c.strokeStyle = rgba('ember', 0.9); c.lineWidth = 2.2 / sc;
      c.beginPath(); c.moveTo(penLine1.x, penLine1.y); c.lineTo(penLine1.x + 6000, penLine1.y); c.stroke();
      for (let k = 0; k < 46; k++) {
        const yy = penLine1.y + (hash(k, 31) - 0.5) * 700, xx = penLine1.x - 1500 + hash(k, 32) * 5000;
        c.strokeStyle = rgba(k % 4 === 0 ? 'signal' : 'graphite', (0.3 + 0.6 * hash(k, 33)) * smoothstep(0, 0.3, u));
        c.lineWidth = (1 + 2 * hash(k, 34)) / sc;
        c.beginPath(); c.moveTo(xx, yy); c.lineTo(xx + 200 + 900 * hash(k, 35), yy); c.stroke();
      }
    }

    // ---- structure ghosts: every written character leaves its window / circuit behind
    const ghostA = stage === 'street' ? 0.85 : stage === 'circuit' ? 0.75 : stage === 'streak' ? 0.16 : 0;
    const beatJ = 24 * steps(this.beats.filter((b) => b >= l0start), t, 0.05) % 96;
    if (ghostA > 0) this.writeGhosts(c, l0, lay0, o0, t, stage === 'street' ? 'street' : 'circuit', ghostA, hairY, beatJ, sc);

    // ---- line 0: traced outlines (the pen is the point)
    drawLyric(c, l0, t, {
      x: o0.x, y: o0.y, size: size0, family: FAM, align: 'left', lead: 0, unsungAlpha: 0,
      sungColor: 'bone',
      drawChar: (cc, ch, s) => {
        const [a0, a1] = sylWin(l0, s);
        const cons = /[가-힣]/.test(ch) ? glyphContours(ch) : [];
        const fill = smoothstep(a1 + 0.02, a1 + 0.28, t);
        if (!cons.length) { cc.fillText(ch, 0, 0); return; }
        const m = smoothstep(a1 - 0.04, a1 + 0.22, t);
        // the shape a fresh stroke takes before it is a letter: decided by the stage the syllable was sung in
        const preKind = a0 < (this.list.find((x) => x.s.stage === 'circuit')?.t ?? Infinity) ? 'rect' : 'circ';
        const n = cons.length, rv = s.frac * n;
        cc.lineJoin = 'round';
        cc.strokeStyle = rgba('signal', 1 - 0.75 * fill);
        cc.lineWidth = (2.4 + 2 * beatPulse(au, t, 0.1)) / sc;
        let head: P | null = null;
        for (let j = 0; j < n; j++) {
          const rev = clamp(rv - j);
          if (rev <= 0) break;
          const ct = cons[j]!;
          const hp = traceContour(cc, ct, preKind === 'rect' ? ct.rect : ct.circ, m, size0, rev);
          if (rev < 1 || j === n - 1) head = head ?? hp;
        }
        if (fill > 0) {
          cc.save(); cc.globalAlpha *= fill; cc.fillStyle = rgba('bone'); cc.fillText(ch, 0, 0); cc.restore();
        }
        // chars draw in order: the last one to report is the latest sung (the pen rests at its end when done)
        if (head) heads[0] = { x: o0.x + s.box.x + head.x, y: o0.y + head.y };
      },
    });

    // ---- line 1: dragged in at speed, streaks settling into letters
    if (l1 && lay1) {
      drawLyric(c, l1, t, {
        x: o1.x, y: o1.y, size: size1, family: FAM, align: 'left', lead: 0, unsungAlpha: 0,
        sungColor: 'bone',
        drawChar: (cc, ch, s) => {
          const [a0] = sylWin(l1, s);
          const age = t - a0;
          const len = 40 + 520 * Math.exp(-age / 0.22) + 60 * kickPulse(au, t, 0.1);
          const w = s.box.w;
          // speed streaks: horizontal hairlines out of the glyph's rows
          for (let k = 0; k < 7; k++) {
            const yy = -size1 * (0.1 + 0.11 * k) + (hash(k, s.box.index) - 0.5) * 8;
            const l = len * (0.5 + hash(s.box.index, k, 3));
            cc.strokeStyle = rgba(k % 3 === 0 ? 'signal' : 'graphite', 0.8);
            cc.lineWidth = (1 + 2.5 * hash(k, 9, s.box.index)) / sc;
            cc.beginPath(); cc.moveTo(w * 0.2 - l, yy); cc.lineTo(w * 0.4, yy); cc.stroke();
          }
          // motion-smear copies, then the letter
          for (let k = 5; k >= 1; k--) {
            cc.save(); cc.globalAlpha *= 0.14 * (1 - k / 6) * clamp(len / 160); cc.fillStyle = rgba('ember');
            cc.fillText(ch, -len * (k / 5) * 0.6, 0); cc.restore();
          }
          const settle = ease.outExpo(clamp(age / 0.18));
          cc.save(); cc.transform(1, 0, -0.25 * (1 - settle), 1, 0, 0); cc.fillText(ch, (1 - settle) * -60, 0); cc.restore();
        },
      });
      if (t >= l1.start) heads[1] = penLine1;
    }

    // ---- the point
    if (heads[1]) pen = heads[1];
    else if (heads[0]) pen = heads[0];
    c.setTransform(1, 0, 0, 1, 0, 0);
    const sp = apply(M, pen);
    const kick = Math.max(kickPulse(au, t, 0.09), beatPulse(au, t, 0.09));
    drawPoint(c, sp.x, sp.y, (6 + 2.4 * kick) * Math.min(1.6, sc) * ign, ign); // 1.4x flare on the kick/beat

    // whip: smear the whole frame along the pan
    if (smear > 2) this.smearX(smear);

    const hardCut = st.stage === 'circuit' ? Math.exp(-(t - sh.t0) / 0.05) : 0;
    return {
      bloom: 0.55, bloomThreshold: 0.72,
      shake: [hash(Math.floor(t * 60)) * 4 * kick - 2 * kick, 0],
      flash: 0.12 * hardCut,
    };
  }

  /** Line-local x of line 1's pen: the right edge of the latest sung character, advanced by its syllable progress. */
  private lineHeadX(line: Line, lay: LineLayout, t: number): number {
    let x = 0;
    for (const b of lay.chars) {
      const w = line.words[b.word]!;
      const s = w.syl && w.syl.length ? w.syl : ([[w.start, w.end]] as [number, number][]);
      const [a0, a1] = s[Math.min(b.syl, s.length - 1)]!;
      if (t >= a0) x = b.x + b.w * ease.outCubic(clamp((t - a0) / Math.max(0.05, a1 - a0)));
    }
    return x;
  }

  private writeGhosts(c: CanvasRenderingContext2D, line: Line, lay: LineLayout, o: P, t: number, kind: 'street' | 'circuit', A: number, hairY: number, beatJ: number, sc: number) {
    c.lineWidth = 1.2 / sc;
    for (const b of lay.chars) {
      const w = line.words[b.word]!;
      const s = w.syl && w.syl.length ? w.syl : ([[w.start, w.end]] as [number, number][]);
      const [a0] = s[Math.min(b.syl, s.length - 1)]!;
      if (t < a0 || !/[가-힣]/.test(b.ch)) continue;
      const cons = glyphContours(b.ch), S = lay.size, gx = o.x + b.x, gy = o.y;
      const age = t - a0;
      const a = A * (0.55 + 0.45 * Math.exp(-age / 0.6));
      if (kind === 'street') {
        // window frames + the building's verticals down to the street, the street receding in two curbs
        c.strokeStyle = rgba('ember', a * 0.7);
        for (const ct of cons) {
          const [x0, y0, x1, y1] = ct.bx;
          c.strokeRect(gx + x0 * S - 6, gy + y0 * S - 6, (x1 - x0) * S + 12, (y1 - y0) * S + 12);
          // mullions: each window split into panes
          c.beginPath(); c.moveTo(gx + ((x0 + x1) / 2) * S, gy + y0 * S - 6); c.lineTo(gx + ((x0 + x1) / 2) * S, gy + y1 * S + 6); c.stroke();
        }
        c.strokeStyle = rgba('graphite', a);
        const [bx0, , bx1] = [Math.min(...cons.map((k) => k.bx[0])), 0, Math.max(...cons.map((k) => k.bx[2]))];
        c.beginPath();
        c.moveTo(gx + bx0 * S - 10, gy - S * 0.95); c.lineTo(gx + bx0 * S - 10, hairY);
        c.moveTo(gx + bx1 * S + 10, gy - S * 0.95); c.lineTo(gx + bx1 * S + 10, hairY);
        c.stroke();
        // street: two curb lines converging below the text, dashes marching one step per beat
        c.strokeStyle = rgba('ember', a * 0.6);
        c.setLineDash([28, 68]); c.lineDashOffset = -beatJ;
        c.beginPath(); c.moveTo(gx - 40, hairY + 60); c.lineTo(gx + b.w + 40, hairY + 60); c.stroke();
        c.setLineDash([]);
      } else {
        // circuit: Manhattan traces, pads at every contour start, a bus down to a rail
        c.strokeStyle = rgba('ember', a * 0.8);
        c.fillStyle = rgba('ember', a);
        for (const ct of cons) {
          c.beginPath();
          for (let j = 0; j <= NRES * 2; j++) {
            const k = j % (NRES * 2), x = gx + ct.circ[2 * k]! * S + 9, y = gy + ct.circ[2 * k + 1]! * S + 9;
            if (j === 0) c.moveTo(x, y); else c.lineTo(x, y);
          }
          c.stroke();
          const px = gx + ct.circ[0]! * S + 9, py = gy + ct.circ[1]! * S + 9;
          c.beginPath(); c.arc(px, py, 5, 0, TAU); c.fill();
          c.beginPath(); c.moveTo(px, py); c.lineTo(px, hairY + 70 + (hash(b.index, px) * 3 | 0) * 16); c.stroke();
        }
        c.strokeStyle = rgba('graphite', a);
        c.setLineDash([10, 14]); c.lineDashOffset = -beatJ;
        for (let r = 0; r < 3; r++) { c.beginPath(); c.moveTo(gx - 30, hairY + 70 + r * 16); c.lineTo(gx + b.w + 30, hairY + 70 + r * 16); c.stroke(); }
        c.setLineDash([]);
      }
    }
  }

  private smearX(px: number) {
    const src = this.L, dst = this.S, n = 9;
    dst.clear();
    dst.ctx.drawImage(src.canvas, 0, 0, W, H);
    const c = src.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, W, H);
    c.globalCompositeOperation = 'lighter';
    for (let i = 0; i < n; i++) { c.globalAlpha = 1.35 / n; c.drawImage(dst.canvas, -px * (i / (n - 1)), 0, W, H); }
    c.globalAlpha = 1;
    c.globalCompositeOperation = 'source-over';
  }

  // ================================================================ p09 race
  private race(c: CanvasRenderingContext2D, f: Frame): PostOverrides {
    const au = this.ctx.audio, t = f.t;
    const st = stateAt(this.list, t), frame = st.frame as string;
    const sh = shotAt(this.list, t);
    const line = this.lines[0]!;
    const SP = 360; // world units per beat = one year
    const B = au.beats;
    const bf = (tt: number) => {
      let i = 0;
      while (i + 1 < B.length && B[i + 1]! <= tt) i++;
      const a = B[i]!, b = B[i + 1] ?? a + 60 / au.bpm;
      return i + (tt - a) / (b - a);
    };
    const bf0 = Math.floor(bf(this.ctx.start));
    const tExit = this.list.find((x) => x.s.frame === 'locked')?.t ?? this.ctx.end;
    const X = (tt: number) => SP * (bf(tt) - bf0) + (tt > tExit ? 4200 * Math.pow((tt - tExit) / (this.ctx.end - tExit), 2) : 0);
    const Xp = X(t);

    // ---- camera (pinhole): eye E, target T, focal Fo
    let E: [number, number, number], T: [number, number, number], Fo = 1400;
    if (frame === 'side') { E = [Xp - 260, 170, -1450]; T = [Xp - 260, 110, 0]; }
    else if (frame === 'headon') {
      const X0 = X(sh.t0);
      const u = clamp((t - sh.t0) / (sh.t1 - sh.t0));
      E = [X0 + 1150 + 0.1 * (Xp - X0), 200, -1000]; T = [Xp - 320, 110, 0]; Fo = lerp(1150, 1700, ease.inQuad(u)); // closing in + a creeping zoom: it rushes at the lens
    } else if (frame === 'overhead') { E = [Xp - 1000, 1150, -1150]; T = [Xp + 250, 0, 0]; Fo = 1150; }
    else { const Xl = X(sh.t0); E = [Xl - 100, 170, -1450]; T = [Xl - 100, 110, 0]; }
    const fw = norm3(sub3(T, E)), rt = norm3(cross3([0, 1, 0], fw)), up = cross3(fw, rt);
    const proj = (p: [number, number, number]): { x: number; y: number; z: number } => {
      const d = sub3(p, E), z = dot3(d, fw);
      return { x: W / 2 + (Fo * dot3(d, rt)) / z, y: H / 2 - (Fo * dot3(d, up)) / z, z };
    };
    const seg = (a: [number, number, number], b: [number, number, number]) => {
      let pa = proj(a), pb = proj(b);
      const NEAR = 60;
      if (pa.z < NEAR && pb.z < NEAR) return;
      if (pa.z < NEAR || pb.z < NEAR) {
        const za = dot3(sub3(a, E), fw), zb = dot3(sub3(b, E), fw), u = (NEAR - za) / (zb - za);
        const m: [number, number, number] = [lerp(a[0], b[0], u), lerp(a[1], b[1], u), lerp(a[2], b[2], u)];
        if (pa.z < NEAR) pa = proj(m); else pb = proj(m);
      }
      c.beginPath(); c.moveTo(pa.x, pa.y); c.lineTo(pb.x, pb.y); c.stroke();
    };

    // ---- the ruler: strip edges, minor ticks, one year tick per beat
    c.lineCap = 'butt';
    const kLo = Math.floor((Xp - 5200) / SP), kHi = Math.ceil((Xp + 5200) / SP);
    c.strokeStyle = rgba('bone', 0.55); c.lineWidth = 1.5;
    seg([kLo * SP, 0, -34], [kHi * SP, 0, -34]);
    c.strokeStyle = rgba('graphite', 0.8); c.lineWidth = 1;
    seg([kLo * SP, 0, 34], [kHi * SP, 0, 34]);
    for (let k = kLo; k <= kHi; k++) {
      for (let q = 1; q < 4; q++) seg([k * SP + (q * SP) / 4, 0, -34], [k * SP + (q * SP) / 4, 22, -34]);
    }
    for (let k = kLo; k <= kHi; k++) {
      const tb = B[bf0 + k]; // this tick is passed at beat bf0+k
      const fl = tb !== undefined && t >= tb ? Math.exp(-(t - tb) / 0.16) : 0;
      const jump = 14 * (tb !== undefined && t >= tb ? Math.exp(-(t - tb) / 0.09) : 0);
      const passed = tb !== undefined && t >= tb;
      c.strokeStyle = fl > 0.05 ? rgba('signal', 0.35 + 0.65 * fl) : rgba(passed ? 'bone' : 'graphite', passed ? 0.75 : 0.9);
      c.lineWidth = 2 + 5 * fl;
      seg([k * SP, jump, -34], [k * SP, 70 + jump + 40 * fl, -34]);
      // year label (Latin furniture)
      const lp = proj([k * SP + 10, -34 + 0, -60]);
      if (lp.z > 80) {
        const s = clamp(Fo / lp.z, 0.2, 3);
        c.font = font(F.mono(500), 30 * s);
        c.fillStyle = fl > 0.05 ? rgba('ember', 0.5 + 0.5 * fl) : rgba('graphite', 0.9);
        c.fillText(String(2025 + k), lp.x, lp.y + 26 * s);
      }
    }

    // ---- the point's trail + the point
    const kick = kickPulse(au, t, 0.08);
    c.strokeStyle = rgba('signal', 0.9); c.lineCap = 'round';
    for (let i = 0; i < 18; i++) {
      c.globalAlpha = 1 - i / 18;
      c.lineWidth = 2 + 3 * kick;
      seg([Xp - i * 90, 48, 0], [Xp - (i + 1) * 90, 48, 0]);
    }
    c.globalAlpha = 1;
    const pp = proj([Xp, 48, 0]);

    // ---- line 9: each word stands on the ruler where the point was at the word's start
    const size = 150;
    const lay = layoutLine(c, line, FAM, size);
    const wordX = line.words.map((w) => X(w.start));
    drawLyric(c, line, t, {
      x: 0, y: 0, size, family: FAM, align: 'left', lead: 0, unsungAlpha: 0, sungColor: 'bone',
      charTransform: (_ch, _i, s) => {
        const b = s.box, wb = lay.words[s.word]!;
        const wx = wordX[s.word]! + (b.x - wb.x) + b.w / 2;
        const [a0] = sylWin(line, s);
        const drop = ease.outBack(clamp((t - a0) / 0.16));
        const q = proj([wx, 150 + 60 * (1 - drop), -34]);
        if (q.z < 120) return { alpha: 0 };
        const sc = clamp(Fo / q.z, 0.15, 1.7);
        // looking along the ruler, words far behind the point would pile up in perspective: let them go
        const far = frame === 'headon' || frame === 'overhead' ? 1 - smoothstep(650, 1150, Xp - wx) : 1;
        return { dx: q.x - (b.x + b.w / 2), dy: q.y - (-size * 0.35), scale: sc * (0.6 + 0.4 * drop), alpha: far };
      },
    });

    if (pp.z > 60) drawPoint(c, pp.x, pp.y, clamp(Fo / pp.z, 0.3, 3.2) * (7 + 3 * kick));

    const db = downbeatPulse(au, t, 0.14);
    return {
      bloom: 0.5, bloomThreshold: 0.75,
      zoom: 1 + 0.05 * db,
      shake: [0, -10 * db * (hash(Math.floor(t * 30)) - 0.5)],
    };
  }

  // ================================================================ p21 glint
  private dotCache = new Map<string, { x: number; y: number }[]>();
  private dots(ch: string, size: number) {
    const k = ch + size;
    let d = this.dotCache.get(k);
    if (!d) { d = textPoints(ch, FAM, size, 6, ch.charCodeAt(0)); this.dotCache.set(k, d); }
    return d;
  }

  private glint(c: CanvasRenderingContext2D, f: Frame): PostOverrides {
    const au = this.ctx.audio, t = f.t;
    const st = stateAt(this.list, t), stage = st.stage as string;
    const sh = shotAt(this.list, t);
    const line = this.lines[0]!;
    const kick = kickPulse(au, t, 0.035); // star radius 3 -> 9 on the kick, back within ~4 frames
    const bp = beatPulse(au, t, 0.1);
    const cx = W / 2, cy = H / 2, PR = 600;
    const push = 1 + 0.05 * (t - this.ctx.start);

    // ---- the eye: iris fibres, pupil, the reflection's window arc
    c.fillStyle = rgba('ink2'); c.fillRect(0, 0, W, H);
    c.lineWidth = 1;
    for (let i = 0; i < 220; i++) {
      const a = (i / 220) * TAU + hash(i) * 0.02, r0 = PR * push * (1.0 + 0.02 * hash(i, 2)), r1 = r0 + 200 + 400 * hash(i, 3);
      c.strokeStyle = rgba(i % 7 === 0 ? 'ember' : 'graphite', i % 7 === 0 ? 0.18 : 0.35);
      c.beginPath(); c.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0); c.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); c.stroke();
    }
    c.fillStyle = rgba('ink');
    c.beginPath(); c.arc(cx, cy, PR * push, 0, TAU); c.fill();
    c.strokeStyle = rgba('graphite', 0.6); c.lineWidth = 2;
    c.beginPath(); c.arc(cx, cy, PR * push, 0, TAU); c.stroke();
    // the reflected window: a curved pane, split in four
    c.save();
    c.beginPath(); c.arc(cx, cy, PR * push - 4, 0, TAU); c.clip();
    c.fillStyle = rgba('bone', 0.045);
    c.beginPath(); c.ellipse(cx - 60, cy - 40, PR * 0.95 * push, PR * 0.7 * push, -0.25, 0, TAU); c.fill();
    c.strokeStyle = rgba('bone', 0.07); c.lineWidth = 3;
    c.beginPath(); c.arc(cx + 900, cy + 1100, 1500, Math.PI * 1.1, Math.PI * 1.45); c.stroke();

    // ---- constellation
    for (let i = 0; i < 150; i++) {
      const a = hash(i, 1) * TAU, r = Math.sqrt(hash(i, 2)) * PR * 0.95 * push;
      const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r * (stage === 'city' ? 0.55 : 1) - (stage === 'city' ? 120 : 0);
      const tw = 0.35 + 0.65 * Math.pow(0.5 + 0.5 * Math.sin(t * (2 + 5 * hash(i, 3)) + i), 3);
      const rr = (1.2 + 1.8 * hash(i, 4)) * (1 + 2 * kick); // 3 -> 9 px on the kick for the big ones
      c.fillStyle = rgba(i % 5 === 0 ? 'ember' : 'bone', tw * (stage === 'buttons' ? 0.35 : 0.85));
      c.fillRect(x - rr / 2, y - rr / 2, rr, rr);
    }

    // ---- line 20: plane layout in rows (word 0 / words 1-2)
    const size = 150;
    const lay = layoutLine(c, line, FAM, size);
    const rows = [[0], line.words.slice(1).map((_, i) => i + 1)];
    const gap = size * 0.32;
    const planePos: P[] = [];
    rows.forEach((ws, r) => {
      const wsum = ws.reduce((s, wi) => s + lay.words[wi]!.w, 0) + gap * (ws.length - 1);
      let x = -wsum / 2;
      for (const wi of ws) {
        const wb = lay.words[wi]!;
        for (const b of wb.chars) planePos[b.index] = { x: x + (b.x - wb.x) + b.w / 2, y: (r - 0.5) * size * 1.3 };
        x += wb.w + gap;
      }
    });
    // button grid (p22): 6 x 3 cells, words on rows 0 and 1
    const CW = 190, CH = 170;
    const cell = (col: number, row: number): P => ({ x: (col - 2.5) * CW, y: (row - 1) * CH });
    const gridPos: P[] = [];
    let gi = 0;
    const cellOf: [number, number][] = [];
    line.words.forEach((w, wi) => {
      const n = lay.words[wi]!.chars.length;
      const row = wi === 0 ? 0 : 1, col0 = wi === 0 ? 1 : wi === 1 ? 0 : 3;
      for (let k = 0; k < n; k++) { gridPos[gi] = cell(col0 + k, row); cellOf[gi] = [col0 + k, row]; gi++; }
    });

    // plane -> screen per stage
    const cityT0 = this.list.find((x) => x.s.stage === 'city')?.t ?? Infinity;
    const btnT0 = this.list.find((x) => x.s.stage === 'buttons')?.t ?? Infinity;
    const flat = ease.outExpo(clamp((t - btnT0) / 0.12));
    let M: Aff;
    if (stage === 'constellation') M = [push, 0, 0, push, cx, cy - 10];
    else if (stage === 'city') { const k = 0.7 + 0.05 * clamp((t - sh.t0) / 1); M = [1.22, 0, 0, k, cx, cy + 150]; }
    else M = [1, 0, 0, 1, cx, cy + 20];
    const rise = stage === 'city' ? ease.outBack(clamp((t - cityT0) / 0.35)) : 0;

    // ---- buttons (behind the letters)
    if (stage === 'buttons') {
      const bi = Math.floor(f.beat);
      for (let row = 0; row < 3; row++) for (let col = 0; col < 6; col++) {
        const p = apply(M, cell(col, row));
        const pressed = hash(bi, 7) * 18 | 0;
        const pr = pressed === row * 6 + col ? bp : 0;
        const w = (CW - 26) * (1 - 0.06 * pr) * flat, h = (CH - 26) * (1 - 0.06 * pr) * flat;
        c.fillStyle = rgba(pr > 0.2 ? 'graphite' : 'ink2', 0.95);
        c.strokeStyle = rgba('graphite', 0.9); c.lineWidth = 2;
        c.beginPath(); c.roundRect(p.x - w / 2, p.y - h / 2, w, h, 22); c.fill(); c.stroke();
      }
    }

    // ---- extrusions (city): floors of the letter stacked up, lit windows
    const heightOf = (i: number) => (i < lay.words[0]!.chars.length ? 90 + 110 * hash(i, 11) : 26 + 40 * hash(i, 11)) * rise * (1 + 0.12 * bp);
    const posOf = (i: number): P => {
      const pl = planePos[i]!, gp = gridPos[i]!;
      return stage === 'buttons' ? { x: lerp(pl.x, gp.x, flat), y: lerp(pl.y, gp.y, flat) } : pl;
    };
    if (stage === 'city') {
      c.font = font(FAM, size);
      for (const b of lay.chars) {
        const [a0] = sylWin(line, { word: b.word, syl: b.syl } as CharState);
        if (t < a0) continue;
        const hgt = heightOf(b.index) * ease.outCubic(clamp((t - Math.max(a0, cityT0)) / 0.3));
        const p = posOf(b.index);
        for (let y = 0; y < hgt; y += 4) {
          c.setTransform(M[0], M[1], M[2], M[3], M[4], M[5] - y);
          // stacked letterforms: dark core, a lit slab every floor
          const floor = Math.round(y) % 20 < 4;
          c.fillStyle = floor ? rgba('bone', 0.55) : rgba('graphite', 0.55);
          c.fillText(b.ch, p.x - b.w / 2, p.y + size * 0.35);
        }
        // windows: ember points on the front face
        c.setTransform(1, 0, 0, 1, 0, 0);
        const base = apply(M, { x: p.x, y: p.y + size * 0.35 });
        for (let k = 0; k < 10; k++) {
          const yy = base.y - hgt * hash(b.index, k, 5), xx = base.x + (hash(k, b.index, 6) - 0.5) * b.w * 0.8;
          if (hash(b.index, k, Math.floor(f.beat)) < 0.6) { c.fillStyle = rgba('ember', 0.9); c.fillRect(xx - 2, yy - 3, 4, 6); }
        }
      }
    }

    // ---- the letters themselves: points flying in from the stars, assembling the glyph
    c.setTransform(M[0], M[1], M[2], M[3], M[4], M[5]);
    drawLyric(c, line, t, {
      x: 0, y: 0, size, family: FAM, align: 'left', lead: 0, unsungAlpha: 0, sungColor: 'bone',
      charTransform: (_ch, i, s) => {
        const b = s.box, p = posOf(i);
        const lift = stage === 'city' ? heightOf(i) * ease.outCubic(clamp((t - Math.max(sylWin(line, s)[0], cityT0)) / 0.3)) / M[3] : 0;
        return { dx: p.x - (b.x + b.w / 2), dy: p.y - lift - (-size * 0.35), scale: stage === 'buttons' ? lerp(1, 0.9, flat) : 1 };
      },
      drawChar: (cc, ch, s) => {
        const [a0] = sylWin(line, s);
        const u = ease.outCubic(clamp((t - a0) / 0.3));
        const d = this.dots(ch, size);
        const hot = s.frac < 1 ? 1 : 0;
        cc.fillStyle = rgba(hot ? 'ember' : 'bone');
        const solid = stage === 'buttons' ? flat : 0;
        if (solid < 1) {
          for (let k = 0; k < d.length; k++) {
            const q = d[k]!;
            // from a star position (plane coords around the glyph) to the glyph sample
            const a = hash(k, s.box.index) * TAU, r = 300 + 500 * hash(s.box.index, k);
            const x = lerp(q.x + Math.cos(a) * r, q.x, u), y = lerp(q.y + Math.sin(a) * r, q.y, u);
            const sz = (u < 1 ? 2.2 : 3.4 + 1.6 * kick) * (stage === 'city' ? 1.25 : 1);
            cc.globalAlpha = (1 - solid) * (0.35 + 0.65 * u);
            cc.fillRect(x - sz / 2, y - sz / 2, sz, sz);
          }
          cc.globalAlpha = 1;
        }
        // once assembled, the glyph's face fills in faintly under its points (legibility), solid on the buttons
        const face = Math.max(solid, 0.3 * u * u);
        if (face > 0) { cc.globalAlpha = face; cc.fillStyle = rgba('bone'); cc.fillText(ch, 0, 0); cc.globalAlpha = 1; }
      },
    });
    c.setTransform(1, 0, 0, 1, 0, 0);
    // the button holding the sung syllable is outlined in signal
    if (stage === 'buttons') {
      for (const b of lay.chars) {
        const w = line.words[b.word]!;
        const ss = w.syl && w.syl.length ? w.syl : ([[w.start, w.end]] as [number, number][]);
        const [a0, a1] = ss[Math.min(b.syl, ss.length - 1)]!;
        if (t < a0 || t > a1 + 0.1) continue;
        const [col, row] = cellOf[b.index]!, p = apply(M, cell(col, row));
        c.strokeStyle = rgba('signal', 1); c.lineWidth = 3 + 3 * bp;
        c.beginPath(); c.roundRect(p.x - (CW - 26) / 2, p.y - (CH - 26) / 2, CW - 26, CH - 26, 22); c.stroke();
      }
    }
    c.restore(); // pupil clip

    // one glint on the downbeat (upper left of the pupil)
    const db = downbeatPulse(au, t, 0.18);
    const gx = cx - PR * 0.45, gy = cy - PR * 0.5;
    drawPoint(c, gx, gy, 5 + 6 * db, 0.6 + 0.4 * db);
    c.strokeStyle = rgba('bone', 0.5 * db + 0.1); c.lineWidth = 1.5;
    const gl = 40 + 160 * db;
    c.beginPath(); c.moveTo(gx - gl, gy); c.lineTo(gx + gl, gy); c.moveTo(gx, gy - gl * 0.6); c.lineTo(gx, gy + gl * 0.6); c.stroke();

    return { bloom: 0.45, bloomThreshold: 0.78, zoom: 1 + 0.02 * db, shake: [3 * kick * (hash(Math.floor(t * 60)) - 0.5), 0] };
  }

  // ================================================================ p27 merge
  private merge(c: CanvasRenderingContext2D, f: Frame): PostOverrides {
    const au = this.ctx.audio, t = f.t;
    const st = stateAt(this.list, t), stage = st.stage as string, frame = st.frame as string;
    const line = this.lines[0]!;
    const tGrid = this.list.find((x) => x.s.stage === 'grid')?.t ?? Infinity;
    const tComp = this.list.find((x) => x.s.stage === 'compress')?.t ?? Infinity;
    const tPoint = this.list.find((x) => x.s.stage === 'point')?.t ?? Infinity;
    const bp = beatPulse(au, t, 0.1);
    const flare = downbeatPulse(au, t, 0.13);

    // ---- quantization: one grid step per beat until the grid locks
    const pre = this.beats.filter((b) => b < tGrid - 0.01);
    const q = t >= tGrid ? 1 : Math.min(0.85, steps(pre, t, 0.07, ease.outBack) / (pre.length + 1));
    // compression: the grid spacing drops per beat after tComp, to 0 at tPoint
    const cb = this.beats.filter((b) => b > tComp + 0.01 && b < tPoint - 0.01);
    const cmp = t < tComp ? 1 : t >= tPoint ? 0 : Math.max(0.04, 1 - (0.12 + steps(cb, t, 0.06, ease.outBack) * 0.3 + 0.35 * prog(t, tComp, tPoint)));

    const COLS = 12, ROWS = 7, CS = 128;
    const cxy = (col: number, row: number): P => ({ x: (col - (COLS - 1) / 2) * CS, y: (row - (ROWS - 1) / 2) * CS });
    // the line's cells: row 2 = 감정은 희미해지고, row 4 = 모두가 하나되네
    const size = 104;
    const lay = layoutLine(c, line, FAM, size);
    const charCell: [number, number][] = [];
    const rowsW = [[0, 1], [2, 3]];
    const taken = new Set<number>();
    rowsW.forEach((ws, r) => {
      const n = ws.reduce((s, wi) => s + lay.words[wi]!.chars.length, 0) + ws.length - 1;
      let col = Math.floor((COLS - n) / 2);
      const row = r === 0 ? 2 : 4;
      for (const wi of ws) {
        for (const b of lay.words[wi]!.chars) { charCell[b.index] = [col, row]; taken.add(row * COLS + col); col++; }
        col++;
      }
    });
    const lastWord = line.words.length - 1;

    // ---- camera
    let M: Aff;
    if (frame === 'lean') M = affine(1.12, -0.05, -40, 20);
    else if (frame === 'close') M = affine(1.2, 0, 0, 0);
    else M = affine(1, 0, 0, 0);
    const setM = () => c.setTransform(M[0], M[1], M[2], M[3], M[4], M[5]);

    // ---- downbeat: full-frame signal flare
    // (hosted: no per-downbeat full-frame flare — the wall host times the one whiteout at 142.035 and the cut-in)
    if (flare > 0.01 && !this.ctx.params.hosted) { c.fillStyle = rgba('signal', 0.92 * flare); c.fillRect(0, 0, W, H); }
    const inkOn = flare > 0.45 && !this.ctx.params.hosted;
    const markC: PaletteKey = inkOn ? 'ink' : 'bone';

    setM();
    // ---- marks
    c.lineCap = 'round';
    if (t < tPoint) {
      for (let row = 0; row < ROWS; row++) for (let col = 0; col < COLS; col++) {
        const id = row * COLS + col;
        if (taken.has(id)) continue;
        const g = cxy(col, row);
        const rx = (hash(id, 1) - 0.5) * 1800, ry = (hash(id, 2) - 0.5) * 960;
        const per = [0.5, 1, 1.5, 2, 3][hash(id, 3) * 5 | 0]! * (60 / au.bpm);
        const rhythm = 0.5 + 0.5 * Math.cos((t / per + hash(id, 4)) * TAU);
        const len0 = 18 + 150 * hash(id, 5) * (0.4 + 0.6 * rhythm), tilt0 = (hash(id, 6) - 0.5) * 2.8, wt0 = 1 + 7 * hash(id, 7);
        const len = lerp(len0, 44, q) * Math.max(0.25, cmp), tilt = lerp(tilt0, 0, q), wt = lerp(wt0, 3.5, q);
        const x = lerp(rx, g.x, q) * cmp, y = lerp(ry, g.y, q) * cmp;
        c.strokeStyle = rgba(markC, lerp(0.35 + 0.6 * hash(id, 8), 0.75, q) * (0.9 + 0.1 * bp));
        c.lineWidth = wt * (1 + 0.5 * bp);
        const dx = Math.sin(tilt) * len / 2, dy = Math.cos(tilt) * len / 2;
        c.beginPath(); c.moveTo(x - dx, y - dy); c.lineTo(x + dx, y + dy); c.stroke();
      }
    }

    // ---- the line, printed into the grid; the last word survives the collapse as a row under the point
    const rowY = 250;
    const lw = lay.words[lastWord]!;
    drawLyric(c, line, t, {
      x: 0, y: 0, size, family: FAM, align: 'left', lead: 0, unsungAlpha: 0, sungColor: markC,
      charTransform: (_ch, i, s) => {
        const b = s.box, [col, row] = charCell[i]!, g = cxy(col, row);
        const rx = (hash(i, 21) - 0.5) * 1500, ry = (hash(i, 22) - 0.5) * 820;
        const rot0 = (hash(i, 23) - 0.5) * 1.3, sc0 = 0.55 + 1.1 * hash(i, 24);
        let x = lerp(rx, g.x, q), y = lerp(ry, g.y, q), rot = lerp(rot0, 0, q), sc = lerp(sc0, 1, q), alpha = 1;
        if (s.word === lastWord && t >= tComp) {
          // 하나되네 slides out of the collapsing grid into one row
          const u = ease.outCubic(clamp((t - tComp) / 0.3));
          const rx2 = (b.x - lw.x) + b.w / 2 - lw.w / 2 * 1.2;
          x = lerp(x * cmp, rx2 * 1.2, u); y = lerp(y * cmp, rowY, u); sc = lerp(sc, 1.2, u);
        } else if (t >= tComp) {
          x *= cmp; y *= cmp; sc *= Math.max(0.05, cmp); alpha = t >= tPoint ? 0 : 1;
        }
        // per-beat snap: a 3-frame jolt on each beat while the marks are forced into line
        const jolt = t < tComp ? 8 * bp * (hash(i, Math.floor(f.beat)) - 0.5) : 0;
        return { dx: x - (b.x + b.w / 2) + jolt, dy: y - (-size * 0.35), rot, scale: sc, alpha };
      },
    });

    // ---- one point: the compressed grid
    c.setTransform(1, 0, 0, 1, 0, 0);
    const pc = apply(M, { x: 0, y: 0 });
    const pAmt = t >= tComp ? smoothstep(tComp, tPoint, t) : 0;
    const exitFlare = smoothstep(this.ctx.end - 0.3, this.ctx.end, t);
    if (pAmt > 0) drawPoint(c, pc.x, pc.y, (4 + 8 * pAmt) * (1 + 0.5 * bp) * (1 + 6 * exitFlare), 0.4 + 0.6 * pAmt);
    if (t >= tPoint) {
      c.strokeStyle = rgba('ember', 0.6 * bp); c.lineWidth = 2;
      c.beginPath(); c.arc(pc.x, pc.y, 30 + 220 * (1 - bp), 0, TAU); c.stroke();
    }

    // T3: every beat a structural hit (punch + shake), downbeats flare
    const ph = hash(Math.floor(f.beat), 3) - 0.5;
    return {
      bloom: 0.5 + 1.2 * flare + 1.5 * exitFlare, bloomThreshold: 0.7,
      zoom: 1 + 0.07 * bp + 0.03 * flare,
      shake: [16 * bp * ph, 10 * bp * (hash(Math.floor(f.beat), 4) - 0.5)],
      flash: 0.7 * smoothstep(this.ctx.end - 0.07, this.ctx.end, t), // the flare whites out only in the last frames
    };
  }

  // ================================================================ p41 outro
  private outro(c: CanvasRenderingContext2D, f: Frame): PostOverrides {
    const au = this.ctx.audio, t = f.t;
    const st = stateAt(this.list, t), frame = st.frame as string;
    const beats = this.beats;
    const last = beats[beats.length - 1] ?? this.ctx.end;
    const n = Math.max(1, beats.length - 1);
    // one size step per beat (the plate's kicks aren't detected here: the beat grid is the kick), 0 on the last beat
    const k = t >= last ? n : steps(beats.slice(1), t, 0.06);
    const r0 = 16, r = r0 * (1 - k / n);
    const tUn = this.list.find((x) => x.s.stage === 'undraw')?.t ?? Infinity;
    const unBeats = beats.filter((b) => b >= tUn - 1e-3);
    const pt: P = { x: 380, y: 0 };
    // the close frame sees ~300 units of hairline behind the point: that visible run is undrawn, one beat at a time
    const full = 2400, vis = 300;
    const hl = t < tUn ? full : vis * (1 - steps(unBeats, t, 0.06) / Math.max(1, unBeats.length));
    let M: Aff;
    if (frame === 'wide') M = affine(1, 0, 0, 0);
    else if (frame === 'mid') M = affine(1.7, 0, pt.x - 120, pt.y);
    else M = affine(2.8, 0, pt.x - 60, pt.y);
    const sc = M[0];
    const bp = beatPulse(au, t, 0.12);
    const dead = t >= last + 1 / 60;
    if (!dead) {
      c.setTransform(M[0], M[1], M[2], M[3], M[4], M[5]);
      c.strokeStyle = rgba('ember', 0.8 + 0.2 * bp);
      c.lineWidth = (2.2 + 2.5 * bp) / sc;
      c.lineCap = 'butt';
      if (hl > 1) { c.beginPath(); c.moveTo(pt.x - hl, pt.y); c.lineTo(pt.x, pt.y); c.stroke(); }
      c.setTransform(1, 0, 0, 1, 0, 0);
      const p = apply(M, pt);
      drawPoint(c, p.x, p.y, r * (sc > 1 ? Math.sqrt(sc) : 1) * (1 + 0.4 * bp), 1);
    }
    return { bloom: dead ? 0 : 0.45, bloomThreshold: 0.75, shake: [0, 0] };
  }

  override dispose() {
    this.L?.texture.dispose();
    this.S?.texture.dispose();
  }
}

// ------------------------------------------------------------------ tiny vec3
type V3 = [number, number, number];
const sub3 = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot3 = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm3 = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
