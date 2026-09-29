// BLUEPRINT — engineering drawings on bone paper: ink hairlines, dimension lines with arrowheads, section
// hatching, a title block, mono annotations. The idiom the song returns to whenever the structure is being
// *planned* rather than seen. One module, five sheets (data/edit.json variants):
//   room      (p10) two points draw a room; lyric line 10 is the dimension label of the wall they draw.
//                    elevation → isometric (→ close on the label) → plan → section; a wall snaps on per beat,
//                    the door shuts on the closing downbeat.
//   orbits    (p14) the orbit sheets: plan, elevation, detail callout of one panel; ink lines draw in per
//                    beat (8 frames), a REV stamp per downbeat, crops on the 3rd beat; the sheet flips to ink.
//   stamp     (p31) a cutaway of the sphere with an EMPTY interior; SEALED slams on beat 1 (paper drops,
//                    splatter), then an inspection line sweeps the empty interior per beat.
//   exploded  (p34) a shell-panel assembly: assembled → exploded → latch detail; one part unlatches per beat,
//                    dimension numbers restamp WRONG on every strong kick; the sheet folds away.
//   return    (p39) the sphere as a blueprint, erased one line per beat until only the orbit ellipses
//                    remain, then those too: a blank sheet.
// Structure comes from ./blueprint.shots (stateAt): `view` = the drawing, `frame` = the camera on it.
import type * as THREE from 'three';
import { Scene, type Frame, type PostOverrides } from '../engine/scene';
import { Layer2D, clearRT } from '../engine/gl';
import { LIN, rgba, type PaletteKey } from '../engine/palette';
import { drawLyric, ownedLines, F } from '../engine/lyric';
import { font } from '../engine/type';
import { beatPulse, kickPulse, downbeatPulse, beatIndex } from '../engine/beat';
import { shotAt, type PlateInfo, type Shot } from '../engine/shots';
import { hash, clamp, smoothstep, lerp, TAU } from '../engine/util';
import type { Line } from '../engine/lyrics';
import { shots, type Framing } from './blueprint.shots';

type P = { x: number; y: number };
const W = 1920, H = 1080;
const DRAW_IN = 8 / 60; // a new ink line draws in over 8 frames

// ------------------------------------------------------------------ drafting primitives
function ink(c: CanvasRenderingContext2D, lw: number, key: PaletteKey = 'ink', a = 1) {
  c.strokeStyle = rgba(key, a);
  c.lineWidth = lw;
  c.setLineDash([]);
}
function seg(c: CanvasRenderingContext2D, a: P, b: P) {
  c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke();
}
/** A segment drawn from its middle outwards up to fraction k (the two pens move apart). */
function segGrow(c: CanvasRenderingContext2D, a: P, b: P, k: number): [P, P] {
  const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const p0 = { x: lerp(m.x, a.x, k), y: lerp(m.y, a.y, k) }, p1 = { x: lerp(m.x, b.x, k), y: lerp(m.y, b.y, k) };
  seg(c, p0, p1);
  return [p0, p1];
}
/** A slender drafting arrowhead at p pointing along (dx, dy). */
function arrow(c: CanvasRenderingContext2D, p: P, dx: number, dy: number, len = 20, half = 4.5) {
  const l = Math.hypot(dx, dy) || 1, ux = dx / l, uy = dy / l;
  c.beginPath();
  c.moveTo(p.x, p.y);
  c.lineTo(p.x - ux * len - uy * half, p.y - uy * len + ux * half);
  c.lineTo(p.x - ux * len + uy * half, p.y - uy * len - ux * half);
  c.closePath();
  c.fill();
}
/** Readable angle of a line (text never upside down). */
function readable(a: P, b: P) {
  let ang = Math.atan2(b.y - a.y, b.x - a.x);
  if (ang > Math.PI / 2) ang -= Math.PI;
  if (ang < -Math.PI / 2) ang += Math.PI;
  return ang;
}
/**
 * Dimension a→b, offset `off` px along the left normal: extension lines, the dimension line with arrowheads,
 * a gap of `gap` px in the middle for the label. Returns the label anchor (middle of the dimension line) and angle.
 */
function dim(c: CanvasRenderingContext2D, a: P, b: P, off: number, gap: number, lw = 1.2, key: PaletteKey = 'ink', al = 1) {
  const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1;
  const nx = -dy / l, ny = dx / l, ux = dx / l, uy = dy / l;
  const A = { x: a.x + nx * off, y: a.y + ny * off }, B = { x: b.x + nx * off, y: b.y + ny * off };
  const sgn = Math.sign(off) || 1;
  ink(c, Math.max(0.8, lw * 0.75), key, al * 0.8);
  seg(c, { x: a.x + nx * 8 * sgn, y: a.y + ny * 8 * sgn }, { x: A.x + nx * 14 * sgn, y: A.y + ny * 14 * sgn });
  seg(c, { x: b.x + nx * 8 * sgn, y: b.y + ny * 8 * sgn }, { x: B.x + nx * 14 * sgn, y: B.y + ny * 14 * sgn });
  ink(c, lw, key, al);
  const g = Math.min(gap, l - 60) / 2;
  const M = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 };
  if (g > 0) {
    seg(c, A, { x: M.x - ux * g, y: M.y - uy * g });
    seg(c, { x: M.x + ux * g, y: M.y + uy * g }, B);
  } else seg(c, A, B);
  c.fillStyle = rgba(key, al);
  arrow(c, A, -ux, -uy);
  arrow(c, B, ux, uy);
  return { m: M, ang: readable(a, b) };
}
/** Mono annotation. */
function note(c: CanvasRenderingContext2D, s: string, x: number, y: number, size = 20, key: PaletteKey = 'ink', align: CanvasTextAlign = 'left', a = 1, rot = 0, weight = 400) {
  c.save();
  c.translate(x, y);
  if (rot) c.rotate(rot);
  c.font = font(F.mono(weight), size);
  c.textAlign = align;
  c.textBaseline = 'middle';
  c.fillStyle = rgba(key, a);
  c.fillText(s, 0, 0);
  c.restore();
}
/** 45° section hatching inside the current path (call after building the path). */
function hatch(c: CanvasRenderingContext2D, bx: number, by: number, bw: number, bh: number, step = 11, lw = 1, a = 0.85, ang = 1) {
  c.save();
  c.clip();
  ink(c, lw, 'ink', a);
  c.beginPath();
  for (let s = -bh; s < bw; s += step) {
    if (ang > 0) { c.moveTo(bx + s, by + bh); c.lineTo(bx + s + bh, by); }
    else { c.moveTo(bx + s, by); c.lineTo(bx + s + bh, by + bh); }
  }
  c.stroke();
  c.restore();
}
/** Dash-dot centreline. */
function centre(c: CanvasRenderingContext2D, a: P, b: P, lw = 1) {
  ink(c, lw, 'graphite', 0.9);
  c.setLineDash([34, 7, 5, 7]);
  seg(c, a, b);
  c.setLineDash([]);
}
function circle(c: CanvasRenderingContext2D, x: number, y: number, r: number, a0 = 0, a1 = TAU) {
  c.beginPath(); c.arc(x, y, Math.max(0.1, r), a0, a1); c.stroke();
}
function ellipse(c: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, rot: number, a0 = 0, a1 = TAU) {
  c.beginPath(); c.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), rot, a0, a1); c.stroke();
}
/** A rubber stamp: double border + Archivo, in signal ink with deterministic ink voids. */
function stamp(c: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, rot: number, scale: number, a: number, seed: number) {
  if (a <= 0.01) return;
  c.save();
  c.translate(x, y);
  c.rotate(rot);
  c.scale(scale, scale);
  c.font = font(F.archivo(125, 900), size);
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  const w = c.measureText(text).width + size * 0.7, h = size * 1.25;
  c.globalAlpha = a;
  c.strokeStyle = rgba('signal', 0.95);
  c.lineWidth = size * 0.07;
  c.strokeRect(-w / 2, -h / 2, w, h);
  c.lineWidth = size * 0.025;
  c.strokeRect(-w / 2 + size * 0.12, -h / 2 + size * 0.12, w - size * 0.24, h - size * 0.24);
  c.fillStyle = rgba('signal', 0.95);
  c.fillText(text, 0, size * 0.04);
  // ink voids: the rubber doesn't take ink everywhere
  c.fillStyle = rgba('bone', 0.9);
  for (let i = 0; i < 60; i++) {
    const vx = (hash(seed, i, 1) - 0.5) * w, vy = (hash(seed, i, 2) - 0.5) * h, r = 1 + 3.5 * hash(seed, i, 3) ** 2;
    c.beginPath(); c.arc(vx, vy, r, 0, TAU); c.fill();
  }
  c.restore();
}

// ------------------------------------------------------------------ the scene
export default class Blueprint extends Scene {
  private layer!: Layer2D;
  private list: Shot[] = [];
  private plate!: PlateInfo;
  private lines: Line[] = [];
  /** Strong kicks in the plate (times) — the exploded sheet restamps its numbers on these. */
  private kicks: number[] = [];

  override init() {
    this.plate = this.ctx.params as PlateInfo;
    this.list = shots(this.plate, this.ctx.audio);
    this.lines = ownedLines(this.ctx);
    this.layer = new Layer2D();
    const ks = this.ctx.audio.onsets?.kick ?? [];
    this.kicks = ks.filter(([t, s]) => s >= 0.5 && t >= this.ctx.start - 0.05 && t < this.ctx.end).map(([t]) => t);
    if (this.kicks.length === 0) this.kicks = this.ctx.audio.beats.filter((b) => b >= this.ctx.start - 0.01 && b < this.ctx.end);
  }

  /** Beats of the plate at or before t: index since the plate's first beat (-1 before it) and its time. */
  private beatSince(t: number, from = this.ctx.start): { n: number; t0: number } {
    const au = this.ctx.audio;
    const i0 = beatIndex(au, from + 1e-3), i = beatIndex(au, t);
    return { n: i - i0, t0: au.beats[Math.max(0, i)] ?? from };
  }

  // ---------------------------------------------------------------- sheet furniture
  private paper(c: CanvasRenderingContext2D) {
    c.fillStyle = rgba('bone');
    c.fillRect(-200, -200, W + 400, H + 400);
    // drafting grid
    ink(c, 1, 'graphite', 0.07);
    c.beginPath();
    for (let x = 0; x <= W; x += 40) { c.moveTo(x, 0); c.lineTo(x, H); }
    for (let y = 0; y <= H; y += 40) { c.moveTo(0, y); c.lineTo(W, y); }
    c.stroke();
    ink(c, 1, 'graphite', 0.13);
    c.beginPath();
    for (let x = 0; x <= W; x += 200) { c.moveTo(x, 0); c.lineTo(x, H); }
    for (let y = 0; y <= H; y += 200) { c.moveTo(0, y); c.lineTo(W, y); }
    c.stroke();
  }

  /** Border with zone ticks + the title block (bottom right). */
  private border(c: CanvasRenderingContext2D, rows: string[], lw: number, alpha = 1) {
    const m = 60;
    ink(c, 2 * lw, 'ink', alpha);
    c.strokeRect(m, m, W - 2 * m, H - 2 * m);
    ink(c, 1, 'ink', alpha);
    c.strokeRect(m - 12, m - 12, W - 2 * m + 24, H - 2 * m + 24);
    for (let i = 1; i < 8; i++) {
      const x = m + ((W - 2 * m) * i) / 8;
      seg(c, { x, y: m - 12 }, { x, y: m });
      seg(c, { x, y: H - m }, { x, y: H - m + 12 });
      note(c, String(i), x - (W - 2 * m) / 16, m - 6, 11, 'graphite', 'center', alpha);
    }
    for (let i = 1; i < 4; i++) {
      const y = m + ((H - 2 * m) * i) / 4;
      seg(c, { x: m - 12, y }, { x: m, y });
      seg(c, { x: W - m, y }, { x: W - m + 12, y });
      note(c, 'ABCD'[i - 1]!, m - 6, y - (H - 2 * m) / 8, 11, 'graphite', 'center', alpha);
    }
    // title block
    const bw = 460, rh = 34, bx = W - m - bw, by = H - m - rh * rows.length;
    ink(c, 1.5, 'ink', alpha);
    c.strokeRect(bx, by, bw, rh * rows.length);
    rows.forEach((r, i) => {
      if (i) { ink(c, 1, 'ink', alpha); seg(c, { x: bx, y: by + i * rh }, { x: bx + bw, y: by + i * rh }); }
      note(c, r, bx + 14, by + i * rh + rh / 2, i === 0 ? 19 : 15, 'ink', 'left', alpha, 0, i === 0 ? 700 : 400);
    });
    ink(c, 1, 'ink', alpha);
    seg(c, { x: bx + 300, y: by + rh }, { x: bx + 300, y: by + rh * rows.length });
  }

  /** Camera on the sheet: scale s about focus (fx, fy), placed at the frame centre. */
  private camera(c: CanvasRenderingContext2D, s: number, fx: number, fy: number, rot = 0) {
    c.translate(W / 2, H / 2);
    if (rot) c.rotate(rot);
    c.scale(s, s);
    c.translate(-fx, -fy);
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer } = this.ctx;
    const sh = shotAt(this.list, f.t);
    const view = String(sh.shot.s.view), frame = sh.shot.s.frame as Framing;
    const L = this.layer, c = L.ctx;
    L.clear();
    c.fillStyle = rgba('ink');
    c.fillRect(0, 0, W, H);
    c.save();
    let post: PostOverrides;
    switch (this.plate.variant) {
      case 'room': post = this.room(c, f, view, frame, sh.t0); break;
      case 'orbits': post = this.orbits(c, f, view, frame, sh.t0); break;
      case 'stamp': post = this.stampSheet(c, f, frame, sh.t0); break;
      case 'exploded': post = this.exploded(c, f, view, frame, sh.t0); break;
      default: post = this.returnSheet(c, f, view, frame, sh.t0); break;
    }
    c.restore();
    L.upload();
    clearRT(renderer, out, LIN.ink);
    this.ctx.comp.draw(renderer, L.texture, out, { mode: 'normal' });
    return { bloom: 0, vignette: 0.12, grain: 0.035, ca: 0.3, ...post };
  }

  /** The shot-start punch (zoom) shared by the sheets. */
  private punch(t: number, t0: number, amt: number) {
    return t >= t0 ? amt * Math.exp(-(t - t0) / 0.11) : 0;
  }

  // ================================================================ p10 room
  private room(c: CanvasRenderingContext2D, f: Frame, view: string, frame: Framing, t0: number): PostOverrides {
    const au = this.ctx.audio, t = f.t;
    const bp = beatPulse(au, t, 0.14);
    // box 8 x 3 x 5 (x width, y height, z depth), door in the front wall (z = 0) at x 5.2..6.4, 2.1 high
    type V3 = [number, number, number];
    const E: [V3, V3][] = [
      [[0, 0, 0], [8, 0, 0]], [[0, 0, 0], [0, 3, 0]], [[8, 0, 0], [8, 3, 0]], [[0, 3, 0], [8, 3, 0]],
      [[5.2, 0, 0], [5.2, 2.1, 0]], [[6.4, 0, 0], [6.4, 2.1, 0]], [[5.2, 2.1, 0], [6.4, 2.1, 0]],
      [[0, 0, 0], [0, 0, 5]], [[8, 0, 0], [8, 0, 5]], [[0, 0, 5], [8, 0, 5]],
      [[0, 0, 5], [0, 3, 5]], [[8, 0, 5], [8, 3, 5]], [[0, 3, 0], [0, 3, 5]], [[8, 3, 0], [8, 3, 5]], [[0, 3, 5], [8, 3, 5]],
    ];
    const cx = 960, cy = 520;
    const cos30 = Math.cos(Math.PI / 6), sin30 = 0.5, PS = 120;
    const proj = (v: V3): P => {
      const [x, y, z] = v;
      if (view === 'elev') return { x: cx + (x - 4) * 150, y: cy + 60 - (y - 1.5) * 150 };
      if (view === 'iso') return { x: cx - 100 + (x - z) * cos30 * 80, y: 850 - y * 80 - (x + z) * sin30 * 80 };
      return { x: cx + (x - 4) * PS, y: 470 - (z - 2.5) * PS };
    };
    // how many walls are down: one more snaps on per beat (the first on the plate's first beat); the newest
    // draws in over 8 frames from its middle, the two points riding its two ends
    const { n, t0: tb } = this.beatSince(t);
    const count = Math.min(E.length, 1 + Math.max(0, n));
    const grow = n < 0 ? 1 : clamp((t - tb) / DRAW_IN);
    const plan = view === 'plan' || view === 'section';
    const lwNew = 1 + 2 * (1 - grow) + 2 * bp; // 1 -> 3 px pulse on the newest wall

    c.save();
    const d0 = proj(E[0]![0]), d1 = proj(E[0]![1]);
    // the close frame sits on the dimension label of the front wall
    if (frame === 'close') this.camera(c, 1.45, (d0.x + d1.x) / 2 + 30, (d0.y + d1.y) / 2 + 60, -readable(d0, d1) * 0.4);
    this.paper(c);

    // floor fill once its edges are down (iso) / always in plan
    if ((view === 'iso' && count >= 8) || plan) {
      const fl = [proj([0, 0, 0]), proj([8, 0, 0]), proj([8, 0, 5]), proj([0, 0, 5])];
      const path = () => { c.beginPath(); fl.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y))); c.closePath(); };
      path(); c.fillStyle = rgba('paper2', 0.5); c.fill();
      path(); hatch(c, Math.min(...fl.map((p) => p.x)), Math.min(...fl.map((p) => p.y)), 1500, 800, 24, 1, 0.18);
    }

    let pens: P[] = [];
    if (plan) {
      // the closed room: four walls with thickness; per beat the inner face of the next wall snaps on
      const T = 0.28;
      const { n: ns, t0: ts } = this.beatSince(t, t0);
      const walls: [number, number, number, number][] = [[-T, -T, 5.2, 0], [6.4, -T, 8 + T, 0], [8, 0, 8 + T, 5], [-T, 5, 8 + T, 5 + T], [-T, 0, 0, 5]];
      walls.forEach(([x0, z0, x1, z1], k) => {
        const a = proj([x0, 0, z0]), b = proj([x1, 0, z1]);
        const bx = Math.min(a.x, b.x), by = Math.min(a.y, b.y), bw = Math.abs(b.x - a.x), bh = Math.abs(b.y - a.y);
        const on = view === 'section' || k <= ns;
        const newest = k === ns && view === 'plan';
        const g = newest ? clamp((t - ts) / DRAW_IN) : 1;
        if (on) {
          c.beginPath(); c.rect(bx, by, bw, bh); c.fillStyle = rgba('bone'); c.fill();
          if (view === 'section') { c.beginPath(); c.rect(bx, by, bw, bh); hatch(c, bx, by, bw, bh, 9, 1.1 + bp, 0.9); }
          else { c.fillStyle = rgba('ink', 0.85); c.fillRect(bx, by, bw * (bw > bh ? g : 1), bh * (bw > bh ? 1 : g)); }
        }
        ink(c, on ? (newest ? lwNew : 1.6 + 1.2 * bp) : 1.2, 'ink', on ? 1 : 0.5);
        c.strokeRect(bx, by, bw, bh);
        if (newest && g < 1) pens = bw > bh ? [{ x: bx, y: by + bh / 2 }, { x: bx + bw * g, y: by + bh / 2 }] : [{ x: bx + bw / 2, y: by }, { x: bx + bw / 2, y: by + bh * g }];
      });
      // the door leaf: hinged at x 6.4, swings shut on the closing downbeat
      const h = proj([6.4, 0, 0]), Ld = 1.2 * PS, th = -Math.PI + this.doorAngle(t);
      ink(c, 4 + 4 * downbeatPulse(au, t, 0.2));
      seg(c, h, { x: h.x + Math.cos(th) * Ld, y: h.y + Math.sin(th) * Ld });
      ink(c, 1, 'graphite', 0.9);
      c.setLineDash([6, 6]); c.beginPath(); c.arc(h.x, h.y, Ld, -Math.PI, -Math.PI / 2); c.stroke(); c.setLineDash([]);
      if (view === 'section') {
        // the two points, inside the closed room
        pens = [
          proj([3.1 + 0.15 * Math.sin(t * 2.1), 0, 2.5 + 0.25 * Math.sin(t * 1.3)]),
          proj([4.9 - 0.15 * Math.sin(t * 2.1), 0, 2.5 - 0.25 * Math.sin(t * 1.3 + 1)]),
        ];
        const cut = proj([-1, 0, 3.6]), cut2 = proj([9, 0, 3.6]);
        ink(c, 2.5, 'ink'); c.setLineDash([40, 8, 6, 8]); seg(c, cut, cut2); c.setLineDash([]);
        note(c, 'B', cut.x - 22, cut.y, 26, 'ink', 'center', 1, 0, 700); note(c, 'B', cut2.x + 22, cut2.y, 26, 'ink', 'center', 1, 0, 700);
      }
    } else {
      for (let i = 0; i < count; i++) {
        const a = proj(E[i]![0]), b = proj(E[i]![1]);
        const newest = i === count - 1 && n >= 0;
        const back = view === 'iso' && (i === 9 || i === 10 || i === 14);
        ink(c, newest ? lwNew + 0.8 : 2 + 1 * bp, 'ink', back ? 0.45 : 1);
        if (back) c.setLineDash([10, 7]);
        if (newest && grow < 1) pens = segGrow(c, a, b, grow);
        else { seg(c, a, b); if (newest) pens = [a, b]; }
        c.setLineDash([]);
      }
      if (count > 6) {
        // the door opening: a hatched leaf
        const q = [proj([5.2, 0, 0]), proj([6.4, 0, 0]), proj([6.4, 2.1, 0]), proj([5.2, 2.1, 0])];
        const path = () => { c.beginPath(); q.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y))); c.closePath(); };
        path(); c.fillStyle = rgba('paper2', 0.9); c.fill();
        path(); hatch(c, Math.min(...q.map((p) => p.x)), Math.min(...q.map((p) => p.y)), 400, 400, 14, 1, 0.35, -1);
      }
    }

    if (view === 'elev') {
      // level datums: ±0.000 and +3.000, with the drafting triangle
      for (const [yy, lab] of [[0, '±0.000'], [3, '+3.000'], [2.1, '+2.100']] as const) {
        if (yy === 3 && count < 4) continue;
        if (yy === 2.1 && count < 7) continue;
        const p = proj([8, yy, 0]);
        ink(c, 1, 'graphite', 0.9); c.setLineDash([12, 6]); seg(c, { x: p.x + 20, y: p.y }, { x: p.x + 190, y: p.y }); c.setLineDash([]);
        c.fillStyle = rgba('ink');
        c.beginPath(); c.moveTo(p.x + 120, p.y); c.lineTo(p.x + 110, p.y - 16); c.lineTo(p.x + 130, p.y - 16); c.closePath(); c.fill();
        note(c, lab, p.x + 140, p.y - 16, 18, 'ink', 'left', 1, 0, 700);
      }
      if (count >= 2) {
        const d = dim(c, proj([0, 0, 0]), proj([0, 3, 0]), -90, 120, 1.2);
        note(c, '3 000', d.m.x, d.m.y, 20, 'ink', 'center', 1, d.ang, 700);
      }
    }
    // the lyric: the dimension label of the front wall, riding the line the two points are drawing
    const k0 = count === 1 && n >= 0 ? grow : 1;
    const a = proj(E[0]![0]), b = proj(E[0]![1]);
    const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const A = { x: lerp(m.x, a.x, k0), y: lerp(m.y, a.y, k0) }, B = { x: lerp(m.x, b.x, k0), y: lerp(m.y, b.y, k0) };
    const off = plan ? 120 : 110;
    const ang = readable(a, b), len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const nx = -(b.y - a.y) / len, ny = (b.x - a.x) / len;
    const size = view === 'elev' ? 86 : 80;
    // anchor = baseline; shift down (in the text's frame) so the glyphs' centre sits on the dimension line
    const lx = m.x + nx * off - Math.sin(ang) * size * 0.35, ly = m.y + ny * off + Math.cos(ang) * size * 0.35;
    let gap = 0;
    this.lines.forEach((line) => {
      const lay = drawLyric(c, line, t, {
        x: lx, y: ly, size, align: 'center', rotation: ang, maxWidth: Math.max(240, len - 190),
        family: F.hangul(), sungColor: 'ink', unsungColor: 'graphite', unsungAlpha: 0.3, lead: 0.5,
        charTransform: (_ch, _i, s) => (s.sung ? { scale: 1 + 0.4 * (1 - smoothstep(0, 0.22, s.frac)), dy: -4 * bp } : undefined),
      });
      if (lay) gap = lay.width + 56;
    });
    dim(c, A, B, off, gap, 1.3 + 1.7 * bp);

    // the two points (the voice): signal pens
    for (const p of pens) {
      const r = 8 + 9 * bp;
      c.fillStyle = rgba('signal', 0.22); c.beginPath(); c.arc(p.x, p.y, r * 2.3, 0, TAU); c.fill();
      c.fillStyle = rgba('signal'); c.beginPath(); c.arc(p.x, p.y, r, 0, TAU); c.fill();
    }
    if (view === 'section' && pens.length === 2) {
      note(c, 'A', pens[0]!.x - 36, pens[0]!.y - 32, 22, 'ink', 'center', 1, 0, 700);
      note(c, 'B', pens[1]!.x + 36, pens[1]!.y - 32, 22, 'ink', 'center', 1, 0, 700);
    }
    const label = { elev: 'ELEVATION  A', iso: 'ISOMETRIC', plan: 'PLAN  +0.000', section: 'SECTION  B—B   CUT AT +1.200' }[view] ?? '';
    note(c, label, 150, 150, 22, 'ink', 'left', 1, 0, 700);
    this.border(c, ['ROOM  A/B', `SHEET 10   ${view.toUpperCase()}`, 'SCALE 1:50   DWN  A+B'], 1 + bp);
    c.restore();

    // hits: punch on each cut, a kick nudge, the door slam on the closing downbeat
    const slam = Math.exp(-Math.max(0, t - (this.ctx.end - 0.04)) / 0.05) * (t >= this.ctx.end - 0.04 ? 1 : 0);
    const k = kickPulse(au, t, 0.08);
    return {
      zoom: 1 + this.punch(t, t0, 0.07) + 0.014 * bp + 0.05 * slam,
      shake: [0, 2.5 * k + 8 * slam],
    };
  }

  /** Door swing (rad, 0 = shut): 90° open, swings shut over the final beat, slamming on the closing downbeat. */
  private doorAngle(t: number) {
    const e = this.ctx.end;
    const k = smoothstep(e - 0.5, e - 0.04, t);
    return (Math.PI / 2) * (1 - k * k);
  }

  // ================================================================ p14 orbits
  private orbits(c: CanvasRenderingContext2D, f: Frame, view: string, frame: Framing, t0: number): PostOverrides {
    const au = this.ctx.audio, t = f.t;
    const bp = beatPulse(au, t, 0.14), db = downbeatPulse(au, t, 0.18);
    const { n: nb, t0: tb } = this.beatSince(t, t0); // beats since this shot started
    const grow = (k: number) => (k < nb ? 1 : k === nb ? clamp((t - tb) / DRAW_IN) : 0); // element k draws in on beat k (k < 0: already on the sheet)
    const lwNew = (k: number) => (k === nb ? 1 + 2.5 * (1 - clamp((t - tb) / 0.25)) : 1.3);
    const cx = 900, cy = 540;

    // exit: the sheet flips over (about the horizontal axis) to its ink back
    const flip = smoothstep(this.ctx.end - 0.38, this.ctx.end - 0.03, t) * Math.PI;
    c.save();
    c.translate(0, H / 2);
    c.scale(1, Math.max(0.002, Math.abs(Math.cos(flip))));
    c.translate(0, -H / 2);
    if (flip > Math.PI / 2) {
      c.fillStyle = rgba('ink2');
      c.fillRect(0, 0, W, H);
      c.restore();
      return { zoom: 1.04, shake: [0, 0] };
    }

    // crop: the camera goes in on a detail of the current sheet
    if (frame === 'crop') {
      const fc = view === 'plan' ? [cx + 330, cy - 250, 0.06] : view === 'elev' ? [cx - 160, cy - 40, -0.05] : [1380, 330, 0.04];
      this.camera(c, 1.75, fc[0]!, fc[1]!, fc[2]!);
    }
    this.paper(c);
    const ringR = [150, 225, 300, 375, 450];
    const star = () => {
      ink(c, 2 + bp);
      circle(c, cx, cy, 56);
      c.save(); c.beginPath(); c.arc(cx, cy, 56, 0, TAU); c.fillStyle = rgba('signal', 0.15 + 0.35 * bp); c.fill(); c.restore();
      centre(c, { x: cx - 560, y: cy }, { x: cx + 560, y: cy });
      centre(c, { x: cx, y: cy - 500 }, { x: cx, y: cy + 500 });
    };

    if (view === 'plan') {
      star();
      ringR.forEach((r, k) => {
        const g = grow(k - 2);
        if (g <= 0) return;
        ink(c, k < 2 ? 1.5 : lwNew(k - 2));
        circle(c, cx, cy, r, -Math.PI / 2, -Math.PI / 2 + TAU * g);
        // panels on the ring
        const np = 6 + k * 4, rot = t * (0.35 / (1 + k * 0.6));
        for (let i = 0; i < np * g; i++) {
          const a = rot + (i / np) * TAU;
          c.save(); c.translate(cx + Math.cos(a) * r, cy + Math.sin(a) * r); c.rotate(a);
          c.fillStyle = rgba('bone'); c.fillRect(-5, -13, 10, 26);
          ink(c, 1.2); c.strokeRect(-5, -13, 10, 26);
          c.restore();
        }
        // radius leader + value
        if (g >= 1) {
          const la = -0.5 - k * 0.42;
          const p = { x: cx + Math.cos(la) * r, y: cy + Math.sin(la) * r };
          ink(c, 1); seg(c, { x: cx, y: cy }, p);
          c.fillStyle = rgba('ink'); arrow(c, p, Math.cos(la), Math.sin(la), 16, 4);
          note(c, `R ${(0.4 + k * 0.17).toFixed(2)} AU`, p.x + 16, p.y - 14, 18);
        }
      });
      const gd = grow(3);
      if (gd > 0) {
        const r = ringR[4]!;
        const d = dim(c, { x: cx - r * gd, y: cy + r + 40 }, { x: cx + r * gd, y: cy + r + 40 }, 0, 170, 1.3);
        note(c, 'Ø 2.14 AU', d.m.x, d.m.y, 20, 'ink', 'center', 1, 0, 700);
      }
      note(c, 'PLAN  —  ORBITAL SHELLS 1–5', 150, 150, 22, 'ink', 'left', 1, 0, 700);
    } else if (view === 'elev') {
      star();
      const inc = [-0.3, -0.12, 0.05, 0.18, 0.34];
      ringR.forEach((r, k) => {
        const g = grow(k - 2);
        if (g <= 0) return;
        ink(c, k < 2 ? 1.5 : lwNew(k - 2));
        ellipse(c, cx, cy, r * 1.15, r * 0.09, inc[k]!, 0, TAU * g);
        if (g >= 1) {
          // inclination arc + value
          const ra = 170 + k * 70;
          ink(c, 1, 'ink', 0.9);
          const a0 = Math.min(0, inc[k]!), a1 = Math.max(0, inc[k]!);
          circle(c, cx, cy, ra, a0 - 0.0001, a1 + 0.0001);
          const pe = { x: cx + Math.cos(inc[k]!) * ra, y: cy + Math.sin(inc[k]!) * ra };
          c.fillStyle = rgba('ink'); arrow(c, pe, -Math.sin(inc[k]!) * Math.sign(inc[k]!), Math.cos(inc[k]!) * Math.sign(inc[k]!), 14, 3.5);
          note(c, `i ${(inc[k]! * 57.3).toFixed(1)}°`, cx + Math.cos(inc[k]! / 2) * (ra + 20) + 10, cy + Math.sin(inc[k]! / 2) * (ra + 20), 17);
        }
      });
      // overall width dimension
      const g = grow(3);
      if (g > 0) {
        const r = ringR[4]! * 1.15;
        const d = dim(c, { x: cx - r * g, y: cy + 260 }, { x: cx + r * g, y: cy + 260 }, -80, 170, 1.3);
        note(c, 'Ø 2.14 AU', d.m.x, d.m.y, 20, 'ink', 'center', 1, d.ang, 700);
      }
      note(c, 'ELEVATION  —  INCLINATIONS', 150, 150, 22, 'ink', 'left', 1, 0, 700);
    } else {
      // detail callout of one panel
      const sx = 340, sy = 560;
      ink(c, 1.2);
      circle(c, sx, sy, 190);
      c.save(); c.beginPath(); c.arc(sx, sy, 190, 0, TAU); c.clip();
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * TAU + t * 0.1;
        c.save(); c.translate(sx + Math.cos(a) * 130, sy + Math.sin(a) * 130); c.rotate(a);
        ink(c, 1); c.strokeRect(-6, -16, 12, 32); c.restore();
      }
      c.restore();
      // callout circle on one panel + leader to the big drawing
      const pa = t * 0.1, pp = { x: sx + Math.cos(pa) * 130, y: sy + Math.sin(pa) * 130 };
      ink(c, 2, 'signal'); circle(c, pp.x, pp.y, 34 + 6 * bp);
      ink(c, 1.2, 'signal'); seg(c, { x: pp.x + 34, y: pp.y }, { x: 720, y: 360 });
      note(c, 'DETAIL A', sx, sy + 230, 20, 'ink', 'center', 1, 0, 700);
      // the panel, large
      const px = 760, py = 260, pw = 760, ph = 400;
      const g0 = 1, g1 = grow(0), g2 = grow(1), g3 = grow(2), g4 = grow(3);
      ink(c, 2.5 + bp * 0 + (nb < 0 ? 0 : 0)); c.strokeRect(px, py, pw * g0, ph);
      ink(c, 1); c.strokeRect(px + 18, py + 18, pw - 36, ph - 36);
      if (g1 > 0) {
        ink(c, lwNew(0) * 0.7, 'graphite');
        c.beginPath();
        for (let i = 1; i < 8; i++) { const x = px + 18 + ((pw - 36) * i) / 8; c.moveTo(x, py + 18); c.lineTo(x, py + 18 + (ph - 36) * g1); }
        for (let j = 1; j < 4; j++) { const y = py + 18 + ((ph - 36) * j) / 4; c.moveTo(px + 18, y); c.lineTo(px + 18 + (pw - 36) * g1, y); }
        c.stroke();
      }
      if (g2 > 0) {
        // section A-A under the panel: hatched strip
        const sy2 = py + ph + 110;
        c.beginPath(); c.rect(px, sy2, pw * g2, 34);
        hatch(c, px, sy2, pw, 34, 9, 1.1);
        ink(c, lwNew(1)); c.strokeRect(px, sy2, pw * g2, 34);
        note(c, 'SECTION A—A', px, sy2 + 62, 17, 'ink', 'left', 1, 0, 700);
      }
      if (g3 > 0) {
        const d = dim(c, { x: px, y: py }, { x: px + pw * g3, y: py }, 60, 150, lwNew(2) * 0.9);
        note(c, '2 400', d.m.x, d.m.y, 22, 'ink', 'center', 1, d.ang, 700);
      }
      if (g4 > 0) {
        const d = dim(c, { x: px + pw, y: py }, { x: px + pw, y: py + ph * g4 }, -70, 110, lwNew(3) * 0.9);
        note(c, '1 200', d.m.x, d.m.y, 22, 'ink', 'center', 1, d.ang, 700);
      }
      note(c, 'DETAIL A  —  COLLECTOR PANEL  SCALE 1:2 000', 150, 150, 22, 'ink', 'left', 1, 0, 700);
    }
    // the pen tip of whatever is drawing in right now
    if (nb >= 0 && t - tb < DRAW_IN) {
      const ph = clamp((t - tb) / DRAW_IN), rr = ringR[Math.min(4, nb + 2)]!;
      const q = view === 'detail' ? { x: 760 + 760 * ph, y: 260 } : { x: cx + rr * Math.cos(-Math.PI / 2 + TAU * ph), y: cy + rr * Math.sin(-Math.PI / 2 + TAU * ph) * (view === 'elev' ? 0.09 : 1) };
      c.fillStyle = rgba('signal'); c.beginPath(); c.arc(q.x, q.y, 7, 0, TAU); c.fill();
    }
    const rev = 'ABC'[Math.max(0, ['plan', 'elev', 'detail'].indexOf(view))]!;
    this.border(c, ['ORBITS  1–5', `SHEET 14   ${view.toUpperCase()}`, `REV ${rev}   DO NOT SCALE`], 1 + 0.5 * bp);
    // downbeat stamp: REV letter slams at the top right on every downbeat
    const dbAge = t - (au.downbeats[Math.max(0, this.barIdx(t))] ?? 0);
    const sc = 1 + 1.3 * Math.max(0, 1 - dbAge / (4 / 60)) ** 2;
    stamp(c, `REV ${rev}`, 1560, 190, 64, -0.12, sc, dbAge >= 0 ? 1 : 0, 14 + rev.charCodeAt(0));
    c.restore();
    return {
      zoom: 1 + this.punch(t, t0, 0.09) + 0.035 * db + 0.012 * bp,
      shake: [4 * db * Math.sin(t * 91), 6 * db],
    };
  }

  private barIdx(t: number) {
    const d = this.ctx.audio.downbeats;
    let i = -1;
    for (let k = 0; k < d.length; k++) if (d[k]! <= t + 1e-9) i = k;
    return i;
  }

  // ================================================================ p31 stamp
  private stampSheet(c: CanvasRenderingContext2D, f: Frame, frame: Framing, t0: number): PostOverrides {
    const au = this.ctx.audio, t = f.t, s0 = this.ctx.start;
    const age = t - s0;
    const land = 4 / 60; // the stamp falls for 4 frames, then lands
    const hit = age >= land ? Math.exp(-(age - land) / 0.09) : 0;
    const bp = beatPulse(au, t, 0.12);
    const drop = age >= land ? 6 : 0; // the paper drops 6 px on impact and stays down
    c.save();
    if (frame === 'interior') this.camera(c, 1.55, 930, 560, 0.03);
    c.translate(0, drop);
    this.paper(c);
    const cx = 820, cy = 560, R = 360, T = 34;
    // exterior half (left): outline, latitudes, panel meridians
    ink(c, 2.2);
    circle(c, cx, cy, R, Math.PI / 2, (3 * Math.PI) / 2);
    c.save(); c.beginPath(); c.rect(cx - R - 4, cy - R - 4, R + 4, 2 * R + 8); c.clip();
    ink(c, 1.1, 'ink', 0.8);
    for (const lat of [-0.9, -0.55, -0.2, 0.2, 0.55, 0.9]) {
      const y = cy + Math.sin(lat) * R, rx = Math.cos(lat) * R;
      ellipse(c, cx, y, rx, rx * 0.16, 0);
    }
    for (const lon of [0.25, 0.55, 0.85]) ellipse(c, cx, cy, R * Math.cos(lon) * 1, R, 0, Math.PI / 2, (3 * Math.PI) / 2);
    c.restore();
    // section half (right): the shell cut, hatched; the interior EMPTY
    c.beginPath();
    c.arc(cx, cy, R, -Math.PI / 2, Math.PI / 2);
    c.arc(cx, cy, R - T, Math.PI / 2, -Math.PI / 2, true);
    c.closePath();
    c.fillStyle = rgba('bone'); c.fill();
    c.beginPath();
    c.arc(cx, cy, R, -Math.PI / 2, Math.PI / 2);
    c.arc(cx, cy, R - T, Math.PI / 2, -Math.PI / 2, true);
    c.closePath();
    hatch(c, cx, cy - R, R + 4, 2 * R, 9, 1.2, 0.9);
    ink(c, 2.2);
    circle(c, cx, cy, R, -Math.PI / 2, Math.PI / 2);
    circle(c, cx, cy, R - T, -Math.PI / 2, Math.PI / 2);
    seg(c, { x: cx, y: cy - R }, { x: cx, y: cy + R });
    // centre where the point was: a dashed empty circle, a crosshair
    centre(c, { x: cx - R - 40, y: cy }, { x: cx + R + 40, y: cy });
    centre(c, { x: cx, y: cy - R - 40 }, { x: cx, y: cy + R + 40 });
    ink(c, 1.3, 'graphite');
    c.setLineDash([5, 6]); circle(c, cx + 150, cy, 26); c.setLineDash([]);
    ink(c, 1, 'ink'); seg(c, { x: cx + 170, y: cy - 18 }, { x: cx + 250, y: cy - 110 }); seg(c, { x: cx + 250, y: cy - 110 }, { x: cx + 420, y: cy - 110 });
    note(c, 'INTERIOR: EMPTY', cx + 256, cy - 128, 20, 'ink', 'left', 1, 0, 700);
    note(c, 'CONTENT  0.000', cx + 256, cy - 92, 17, 'graphite');
    const d = dim(c, { x: cx - R, y: cy + R }, { x: cx + R, y: cy + R }, -70, 150, 1.3);
    note(c, 'Ø 2.00 AU', d.m.x, d.m.y, 20, 'ink', 'center', 1, 0, 700);

    // inspection line: from beat 2 on, sweeps the empty interior once per beat, ticking
    const { n, t0: tb } = this.beatSince(t);
    if (n >= 1) {
      const ph = clamp((t - tb) / 0.5);
      const x = cx + 6 + (R - T - 12) * ph;
      const hh = Math.sqrt(Math.max(0, (R - T) ** 2 - (x - cx) ** 2));
      ink(c, 2 + 2 * bp, 'signal');
      seg(c, { x, y: cy - hh }, { x, y: cy + hh });
      ink(c, 1.2, 'signal');
      for (let k = -8; k <= 8; k++) {
        const y = cy + k * 36;
        if (Math.abs(y - cy) > hh) continue;
        seg(c, { x: x - (k % 4 === 0 ? 14 : 7), y }, { x, y });
      }
      // ticks left behind along the diameter, one per swept beat
      for (let k = 1; k <= n; k++) { ink(c, 1.5, 'ink'); seg(c, { x: cx + 40 * k, y: cy - 12 }, { x: cx + 40 * k, y: cy + 12 }); }
      note(c, `SCAN ${String(n).padStart(2, '0')}  x=${((x - cx) / (R - T)).toFixed(3)}  NIL`, x + 14, cy - hh - 20, 16, 'signal', 'left', 1, 0, 700);
    }
    this.border(c, ['SHELL  —  SEALED', 'SHEET 31   CUTAWAY', 'INSPECTED   0 / 0 FOUND'], 1 + bp);

    // the stamp: falls for 4 frames from 2.2x, lands with splatter (radius 80 px)
    const sc = age < land ? lerp(2.4, 1, (age / land) ** 2) : 1 + 0.04 * hit;
    const sx = 1000, sy = 770, rot = -0.14;
    if (age >= land) {
      c.fillStyle = rgba('signal', 0.85);
      for (let i = 0; i < 70; i++) {
        const side = hash(i, 11), a = hash(i, 12) * TAU, dist = 60 + 80 * hash(i, 13) ** 1.6;
        const bx = sx + Math.cos(a) * (side > 0.5 ? 330 : 120) * 1 + Math.cos(a) * dist * 0.3, by = sy + Math.sin(a) * dist;
        const r = 1 + 5 * hash(i, 14) ** 3;
        c.beginPath(); c.arc(bx, by, r, 0, TAU); c.fill();
      }
    }
    stamp(c, 'SEALED', sx, sy, 150, rot, sc, age >= 0 ? 1 : 0, 31);
    c.restore();
    // exit: drop 2 blast — a bone flash + punch on the last frames
    const blast = smoothstep(this.ctx.end - 0.14, this.ctx.end, t);
    return {
      zoom: 1 + 0.1 * hit + this.punch(t, t0, t0 > s0 ? 0.08 : 0) + 0.015 * bp + 0.12 * blast,
      shake: [10 * hit * Math.sin(age * 140), 12 * hit],
      flash: 0.9 * blast,
    };
  }

  // ================================================================ p34 exploded
  private exploded(c: CanvasRenderingContext2D, f: Frame, view: string, frame: Framing, t0: number): PostOverrides {
    const au = this.ctx.audio, t = f.t;
    const bp = beatPulse(au, t, 0.14), db = downbeatPulse(au, t, 0.18), kp = kickPulse(au, t, 0.09);
    const { n: nb, t0: tb } = this.beatSince(t);
    const pop = nb >= 0 ? Math.exp(-(t - tb) / 0.09) : 0;
    // wrong numbers: restamped on every strong kick
    let ki = -1;
    for (let i = 0; i < this.kicks.length; i++) if (this.kicks[i]! <= t) ki = i;
    const kAge = ki >= 0 ? t - this.kicks[ki]! : 9;
    const kStamp = 1 + 0.6 * Math.max(0, 1 - kAge / (3 / 60));
    const wrong = (d: number, base: number) => (ki < 0 ? base : base * (0.35 + 1.6 * hash(ki, d, 34))).toFixed(ki < 0 ? 1 : 2);

    // exit: the sheet folds in half (right over left) and slides away
    const fold = smoothstep(this.ctx.end - 0.45, this.ctx.end - 0.12, t) * Math.PI;
    const away = smoothstep(this.ctx.end - 0.16, this.ctx.end, t);
    const draw = (cc: CanvasRenderingContext2D) => {
      cc.save();
      if (frame === 'crop') {
        const fc = view === 'latch' ? [1000, 560] : [560, 470];
        this.camera(cc, 1.7, fc[0]!, fc[1]!, -0.04);
      }
      this.paper(cc);
      if (view === 'latch') this.latch(cc, t, nb, tb, bp, wrong, kStamp);
      else this.assembly(cc, t, view === 'exploded', nb, tb, pop, bp, wrong, kStamp);
      this.border(cc, ['SHELL PANEL  ASSY', `SHEET 34   ${view.toUpperCase()}`, 'DIMENSIONS UNVERIFIED'], 1 + bp);
      cc.restore();
    };
    c.save();
    if (away > 0) { c.translate(W / 2, H / 2 + away * 900); c.scale(1 - 0.3 * away, 1 - 0.3 * away); c.rotate(0.2 * away); c.translate(-W / 2, -H / 2); }
    if (fold <= 0) draw(c);
    else {
      // left half flat
      c.save(); c.beginPath(); c.rect(0, 0, W / 2, H); c.clip(); draw(c); c.restore();
      // right half hinged on the centre line
      const k = Math.cos(fold);
      c.save();
      c.translate(W / 2, 0); c.scale(k >= 0 ? Math.max(0.002, k) : Math.min(-0.002, k), 1); c.translate(-W / 2, 0);
      c.beginPath(); c.rect(W / 2, 0, W / 2, H); c.clip();
      if (k >= 0) { draw(c); c.fillStyle = rgba('ink', 0.35 * (1 - k)); c.fillRect(W / 2, 0, W / 2, H); }
      else { c.fillStyle = rgba('paper2'); c.fillRect(W / 2, 0, W / 2, H); ink(c, 1, 'graphite', 0.4); c.strokeRect(W / 2 + 40, 40, W / 2 - 80, H - 80); }
      c.restore();
    }
    c.restore();
    return {
      zoom: 1 + this.punch(t, t0, 0.09) + 0.03 * db + 0.014 * bp,
      shake: [3 * kp * Math.sin(t * 77), 5 * db + 3 * kp],
    };
  }

  /** Hexagonal prism in axonometric (top face ellipse-squashed), bottom-up visible faces. */
  private hexPart(c: CanvasRenderingContext2D, x: number, y: number, R: number, T: number, lw: number, hatchTop = false, hole = 0) {
    const sq = 0.42;
    const v = Array.from({ length: 6 }, (_, i) => { const a = (i / 6) * TAU + Math.PI / 6; return { x: x + Math.cos(a) * R, y: y + Math.sin(a) * R * sq }; });
    // sides (front-facing: sin > 0)
    for (let i = 0; i < 6; i++) {
      const a = v[i]!, b = v[(i + 1) % 6]!;
      if ((a.y + b.y) / 2 < y) continue;
      c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.lineTo(b.x, b.y + T); c.lineTo(a.x, a.y + T); c.closePath();
      c.fillStyle = rgba('paper2'); c.fill();
      ink(c, lw); c.stroke();
    }
    c.beginPath(); v.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y))); c.closePath();
    c.fillStyle = rgba('bone'); c.fill();
    if (hatchTop) {
      c.save();
      c.beginPath(); v.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y))); c.closePath(); c.clip();
      ink(c, 1, 'graphite', 0.8);
      c.beginPath();
      for (let k = -6; k <= 6; k++) { c.moveTo(x + k * R * 0.16 - R * 0.3, y - R); c.lineTo(x + k * R * 0.16 + R * 0.3, y + R); }
      for (let k = -4; k <= 4; k++) { c.moveTo(x - R, y + k * R * 0.1); c.lineTo(x + R, y + k * R * 0.1); }
      c.stroke();
      c.restore();
    }
    c.beginPath(); v.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y))); c.closePath();
    ink(c, lw); c.stroke();
    if (hole > 0) { ink(c, lw); ellipse(c, x, y, hole, hole * sq, 0); }
  }

  private assembly(c: CanvasRenderingContext2D, t: number, exploded: boolean, nb: number, tb: number, pop: number, bp: number, wrong: (d: number, b: number) => string, kStamp: number) {
    const x = 760;
    // parts, top to bottom: [label, R, T, hatchTop, hole]
    const parts: [string, number, number, boolean, number][] = [
      ['CAP', 120, 26, false, 40], ['LATCH RING', 250, 18, false, 190], ['COLLECTOR', 330, 30, true, 0],
      ['FRAME', 350, 44, false, 300], ['MOUNT', 170, 36, false, 60], ['PIN SET', 60, 70, false, 0],
    ];
    // stacked positions
    const ys: number[] = [];
    let y = exploded ? 190 : 330;
    parts.forEach(([, R, T], i) => {
      const unl = nb > i || (nb >= 0 && nb % 6 === i);
      const newest = nb >= 0 && nb % 6 === i;
      const lift = exploded ? 0 : unl ? 22 + (newest ? 30 * pop : 0) : 0;
      const kick = exploded && newest ? -44 * pop : 0;
      ys.push(y - lift + kick);
      y += (exploded ? 118 : T + 8) + (exploded ? 0 : 0) + R * 0.0;
    });
    // centreline
    centre(c, { x, y: 110 }, { x, y: 1000 });
    // draw bottom-up so the upper parts overlap the lower
    for (let i = parts.length - 1; i >= 0; i--) {
      const [, R, T, ht, hole] = parts[i]!;
      const newest = nb >= 0 && nb % 6 === i;
      this.hexPart(c, x, ys[i]!, R, T, 1.4 + (newest ? 2.4 * bp : 0), ht, hole);
    }
    // balloons to the right
    parts.forEach(([label, R], i) => {
      const py = ys[i]!, bx = 1240, by = 200 + i * 118;
      const newest = nb >= 0 && nb % 6 === i;
      ink(c, 1, 'ink'); seg(c, { x: x + R * 0.8, y: py + 4 }, { x: bx - 26, y: by });
      c.fillStyle = rgba('ink'); c.beginPath(); c.arc(x + R * 0.8, py + 4, 3.5, 0, TAU); c.fill();
      ink(c, newest ? 2.5 : 1.4, newest ? 'signal' : 'ink'); circle(c, bx, by, 24 + (newest ? 5 * bp : 0));
      note(c, String(i + 1), bx, by + 1, 22, newest ? 'signal' : 'ink', 'center', 1, 0, 700);
      note(c, label + (nb > i ? '  — UNLATCHED' : ''), bx + 40, by, 17, 'ink', 'left');
    });
    // dimensions on the left: the gaps / heights, restamped wrong on every strong kick
    for (let i = 0; i < parts.length - 1; i++) {
      const a = { x: x - parts[i]![1] - 20, y: ys[i]! }, b = { x: x - parts[i]![1] - 20, y: ys[i + 1]! };
      const xl = 250 - (i % 2) * 70;
      const A = { x: xl, y: a.y }, B = { x: xl, y: b.y };
      ink(c, 0.8, 'graphite', 0.8); seg(c, a, A); seg(c, b, B);
      if (Math.abs(B.y - A.y) > 44) {
        const d = dim(c, A, B, 0, 0, 1.1);
        c.save(); c.translate(d.m.x - 16, d.m.y); c.rotate(-Math.PI / 2); c.scale(kStamp, kStamp);
        c.fillStyle = rgba('bone'); c.fillRect(-44, -13, 88, 26);
        c.restore();
        note(c, wrong(i, 12 + i * 8), d.m.x - 16, d.m.y, 19, kStamp > 1.01 ? 'signal' : 'ink', 'center', 1, -Math.PI / 2, 700);
      }
    }
    // overall height
    const top = ys[0]! - 50, bot = ys[5]! + 80;
    const d = dim(c, { x: 120, y: bot }, { x: 120, y: top }, 0, 130, 1.2);
    c.save(); c.translate(d.m.x, d.m.y); c.scale(kStamp, kStamp); c.translate(-d.m.x, -d.m.y);
    note(c, wrong(9, 210), d.m.x, d.m.y, 22, 'signal', 'center', 1, -Math.PI / 2, 700);
    c.restore();
    note(c, exploded ? 'EXPLODED VIEW  —  6 PARTS' : 'ASSEMBLY  —  LATCHED', 150, 150, 22, 'ink', 'left', 1, 0, 700);
    void tb;
  }

  private latch(c: CanvasRenderingContext2D, t: number, nb: number, tb: number, bp: number, wrong: (d: number, b: number) => string, kStamp: number) {
    // the hook opens one step per beat (snaps), around its pivot
    const since = Math.max(0, nb - 8);
    const snap = nb >= 0 ? 1 - Math.exp(-(t - tb) / 0.05) : 1;
    const ang = -0.12 * (since - 1 + snap) - 0.05;
    c.save();
    c.translate(900, 540); c.scale(1.35, 1.35); c.translate(-900, -560);
    const px = 820, py = 520;
    // detail circle + label
    ink(c, 1.2, 'ink', 0.9); c.setLineDash([22, 8]); circle(c, px + 120, py + 40, 400); c.setLineDash([]);
    // housing (fixed): hatched L-section
    c.beginPath();
    c.moveTo(px - 300, py + 150); c.lineTo(px + 420, py + 150); c.lineTo(px + 420, py + 230); c.lineTo(px - 300, py + 230); c.closePath();
    c.fillStyle = rgba('bone'); c.fill();
    c.beginPath();
    c.moveTo(px - 300, py + 150); c.lineTo(px + 420, py + 150); c.lineTo(px + 420, py + 230); c.lineTo(px - 300, py + 230); c.closePath();
    hatch(c, px - 300, py + 150, 720, 80, 10, 1.1, 0.9);
    ink(c, 2.2); c.strokeRect(px - 300, py + 150, 720, 80);
    // catch pin
    const cp = { x: px + 330, y: py + 110 };
    ink(c, 2); circle(c, cp.x, cp.y, 22); c.fillStyle = rgba('ink'); c.beginPath(); c.arc(cp.x, cp.y, 5, 0, TAU); c.fill();
    // hook, rotated about the pivot
    c.save();
    c.translate(px, py); c.rotate(ang);
    const hook = new Path2D();
    hook.moveTo(-60, -40); hook.lineTo(300, -40); hook.lineTo(370, 10); hook.lineTo(370, 110); hook.lineTo(310, 110);
    hook.lineTo(310, 40); hook.lineTo(260, 20); hook.lineTo(-60, 20); hook.closePath();
    c.fillStyle = rgba('bone'); c.fill(hook);
    c.save(); c.clip(hook); ink(c, 1.1 + bp, 'ink', 0.85);
    c.beginPath(); for (let s = -200; s < 600; s += 11) { c.moveTo(-80 + s, 130); c.lineTo(-80 + s + 190, -60); } c.stroke(); c.restore();
    ink(c, 2.4 + 1.5 * bp); c.stroke(hook);
    c.restore();
    // pivot
    ink(c, 2); circle(c, px, py, 26); circle(c, px, py, 9);
    centre(c, { x: px - 70, y: py }, { x: px + 70, y: py }); centre(c, { x: px, y: py - 70 }, { x: px, y: py + 70 });
    // spring zigzag from the housing to the hook tail
    const tail = { x: px + Math.cos(ang) * -40 - Math.sin(ang) * 20, y: py + Math.sin(ang) * -40 + Math.cos(ang) * 20 };
    ink(c, 1.6);
    c.beginPath(); c.moveTo(px - 200, py + 150);
    for (let i = 1; i <= 10; i++) {
      const k = i / 10, xx = lerp(px - 200, tail.x - 40, k), yy = lerp(py + 150, tail.y + 20, k);
      c.lineTo(xx + (i % 2 ? 14 : -14), yy);
    }
    c.lineTo(tail.x, tail.y); c.stroke();
    // dimensions, wrong on every kick
    const d1 = dim(c, { x: px, y: py }, { x: cp.x, y: cp.y }, -120, 140, 1.2);
    c.save(); c.translate(d1.m.x, d1.m.y); c.scale(kStamp, kStamp); c.translate(-d1.m.x, -d1.m.y);
    note(c, wrong(20, 36), d1.m.x, d1.m.y, 24, kStamp > 1.01 ? 'signal' : 'ink', 'center', 1, d1.ang, 700); c.restore();
    const d2 = dim(c, { x: px - 300, y: py + 230 }, { x: px + 420, y: py + 230 }, -70, 140, 1.2);
    c.save(); c.translate(d2.m.x, d2.m.y); c.scale(kStamp, kStamp); c.translate(-d2.m.x, -d2.m.y);
    note(c, wrong(21, 90), d2.m.x, d2.m.y, 24, 'signal', 'center', 1, 0, 700); c.restore();
    note(c, `OPEN  ${(-ang * 57.3).toFixed(1)}°`, px + 60, py - 150, 20, 'signal', 'left', 1, 0, 700);
    ink(c, 1, 'signal'); circle(c, px, py, 120, Math.min(ang, 0), 0);
    c.restore();
    note(c, 'DETAIL C  —  LATCH   SCALE 4:1', 150, 150, 22, 'ink', 'left', 1, 0, 700);
  }

  // ================================================================ p39 return
  private returnSheet(c: CanvasRenderingContext2D, f: Frame, view: string, frame: Framing, t0: number): PostOverrides {
    const au = this.ctx.audio, t = f.t;
    const bp = beatPulse(au, t, 0.18);
    const cx = 900, cy = 540, R = 280;
    // the drawing's lines, in erase order; the last three are the orbit ellipses
    const sphere: ((c: CanvasRenderingContext2D, a0: number, a1: number) => void)[] = [];
    for (const lon of [0.35, 0.8, 1.2]) sphere.push((cc, a0, a1) => ellipse(cc, cx, cy, R * Math.cos(lon), R, 0, a0, a1));
    for (const lat of [-0.95, -0.5, 0, 0.5, 0.95]) sphere.push((cc, a0, a1) => ellipse(cc, cx, cy + Math.sin(lat) * R, Math.cos(lat) * R, Math.cos(lat) * R * 0.2, 0, a0, a1));
    sphere.push((cc, a0, a1) => circle(cc, cx, cy, R, a0, a1));
    const orbits: ((c: CanvasRenderingContext2D, a0: number, a1: number) => void)[] = [
      (cc, a0, a1) => ellipse(cc, cx, cy, 640, 120, -0.2, a0, a1),
      (cc, a0, a1) => ellipse(cc, cx, cy, 560, 150, 0.12, a0, a1),
      (cc, a0, a1) => ellipse(cc, cx, cy, 720, 90, 0.34, a0, a1),
    ];
    // erasures: one line per beat from the "lines erasing" cut; at "only the orbits" the sphere is gone and the
    // orbits go one per beat after its first beat
    const sEr = this.list.find((s) => s.s.view === 'erasing')?.t ?? t;
    const sOr = this.list.find((s) => s.s.view === 'orbits')?.t ?? t;
    const { n: nE, t0: tbE } = this.beatSince(t, sEr);
    const { n: nO, t0: tbO } = this.beatSince(t, sOr);
    const erased = (i: number): number => {
      // 0 = intact, 1 = gone; the eraser runs along the line over 0.22 s after its beat
      if (view === 'blueprint') return 0;
      if (i < sphere.length) {
        if (view === 'orbits') return 1;
        return i < nE ? 1 : i === nE ? clamp((t - tbE) / 0.22) : 0;
      }
      if (view !== 'orbits') return 0;
      const j = i - sphere.length + 1; // first orbit goes on the 2nd beat of the shot
      return j < nO ? 1 : j === nO ? clamp((t - tbO) / 0.22) : 0;
    };
    c.save();
    if (frame === 'wide') this.camera(c, 0.86, 960, 560);
    else if (view === 'erasing') this.camera(c, 1.32, cx + 60, cy - 10, 0.02);
    this.paper(c);
    const all = [...sphere, ...orbits];
    const titleA = view === 'orbits' ? 1 - smoothstep(this.ctx.end - 0.9, this.ctx.end - 0.3, t) : 1;
    all.forEach((fn, i) => {
      const e = erased(i);
      const orbit = i >= sphere.length;
      // ghost: erased graphite never fully leaves the paper
      if (e > 0) { ink(c, 1, 'graphite', 0.1 * titleA); fn(c, 0, TAU); }
      if (e >= 1) return;
      const lw = (orbit ? 1.6 : 1.3) + 1.6 * bp;
      ink(c, lw, orbit ? 'ink' : 'ink', orbit ? 1 : 0.9);
      if (orbit) c.setLineDash([]);
      fn(c, TAU * e, TAU);
      if (e > 0) {
        // the eraser head
        const a = TAU * e;
        c.save();
        c.fillStyle = rgba('paper2', 0.9);
        const pt = this.ellPoint(i, a, cx, cy, R);
        c.translate(pt.x, pt.y); c.rotate(a);
        c.fillRect(-16, -9, 32, 18);
        ink(c, 1, 'graphite', 0.7); c.strokeRect(-16, -9, 32, 18);
        c.restore();
      }
    });
    // furniture that goes with the sphere: centre marks, diameter
    if (erased(sphere.length - 1) < 1) {
      const a = 1 - erased(sphere.length - 1);
      centre(c, { x: cx - R - 50, y: cy }, { x: cx + R + 50, y: cy });
      centre(c, { x: cx, y: cy - R - 50 }, { x: cx, y: cy + R + 50 });
      const d = dim(c, { x: cx - R, y: cy - R }, { x: cx + R, y: cy - R }, 70, 160, 1.2, 'ink', a);
      note(c, 'Ø 2.00 AU', d.m.x, d.m.y, 20, 'ink', 'center', a, 0, 700);
    }
    const label = { blueprint: 'SPHERE  —  AS DRAWN', erasing: 'SPHERE  —  ERASED', orbits: 'ORBITS  1–3' }[view] ?? '';
    note(c, label, 150, 150, 22, 'ink', 'left', titleA, 0, 700);
    this.border(c, ['DYSON SPHERE', `SHEET 39   ${view.toUpperCase()}`, 'REV 0   RETURNED'], 1 + 0.6 * bp, titleA);
    // pencil registration tick on every beat (the beat stays visible even on the quiet sheet)
    const k = kickPulse(au, t, 0.1);
    ink(c, 1.5 + 2 * bp, 'signal', 0.4 + 0.6 * bp);
    seg(c, { x: cx - 16 - 10 * bp, y: cy }, { x: cx + 16 + 10 * bp, y: cy });
    seg(c, { x: cx, y: cy - 16 - 10 * bp }, { x: cx, y: cy + 16 + 10 * bp });
    c.restore();
    return { zoom: 1 + this.punch(t, t0, 0.035) + 0.01 * bp, shake: [0, 1.5 * k] };
  }

  /** Point on line i of the return sheet at parameter a (matches the ellipse definitions above). */
  private ellPoint(i: number, a: number, cx: number, cy: number, R: number): P {
    const lons = [0.35, 0.8, 1.2], lats = [-0.95, -0.5, 0, 0.5, 0.95];
    const e = (x: number, y: number, rx: number, ry: number, rot: number) => {
      const ex = Math.cos(a) * rx, ey = Math.sin(a) * ry;
      return { x: x + ex * Math.cos(rot) - ey * Math.sin(rot), y: y + ex * Math.sin(rot) + ey * Math.cos(rot) };
    };
    if (i < 3) return e(cx, cy, R * Math.cos(lons[i]!), R, 0);
    if (i < 8) { const l = lats[i - 3]!; return e(cx, cy + Math.sin(l) * R, Math.cos(l) * R, Math.cos(l) * R * 0.2, 0); }
    if (i === 8) return e(cx, cy, R, R, 0);
    const o = [[640, 120, -0.2], [560, 150, 0.12], [720, 90, 0.34]][i - 9]!;
    return e(cx, cy, o[0]!, o[1]!, o[2]!);
  }

  override dispose() { this.layer?.texture.dispose(); }
}
