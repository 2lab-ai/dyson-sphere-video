// ENGRAVE — steel-engraving plates: everything on the frame is cut as parallel hatch lines on ink (banknote
// shading: the tone is the width of the line, never a fill). The hatch field flashes on every beat.
// Variant `hand` (p19): the last fibres of the paper seam snap on line 16's first syllable and the two
// slabs fall away; then an engraved mechanical steel hand (our own design: a riveted palm plate, a knuckle
// bar, four three-segment fingers and a two-segment thumb, modelled in 3D and projected orthographically)
// rakes line 17 off the floor into its palm, closes on it, lets the last word fall through its fingers,
// and locks into a fist on the last beat. The hand ratchets forward 14 px per beat.
// Structure comes from ./engrave.shots via stateAt (framing + topology); lines are drawn with drawLyric.
import type * as THREE from 'three';
import { Scene, type Frame, type PostOverrides } from '../engine/scene';
import { Layer2D, clearRT } from '../engine/gl';
import { LIN, rgba } from '../engine/palette';
import { drawLyric, layoutLine, ownedLines, F, type CharState, type CharXform } from '../engine/lyric';
import { beatPulse, kickPulse, downbeatPulse } from '../engine/beat';
import { shotAt, type PlateInfo, type Shot } from '../engine/shots';
import { hash, clamp, smoothstep, lerp, ease, pulse } from '../engine/util';
import type { Line } from '../engine/lyrics';
import { shots, type Framing, type Topo } from './engrave.shots';

const W = 1920, H = 1080;
type P = { x: number; y: number };
type V3 = [number, number, number];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const norm = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const pr = (a: V3): P => ({ x: a[0], y: a[1] }); // orthographic projection (z = towards the viewer)

// world geometry of the hand variant (px at camera scale 1)
const FLOOR = 250; // baseline of line 17 on the engraved floor
const L17 = { x: -800, y: FLOOR, size: 118, maxWidth: 1600 };
const HS = 1.35; // hand scale
const PALM = 230 * HS; // wrist -> knuckle bar
const FINGER_OFS = [-84, -28, 28, 84].map((v) => v * HS);
const FINGER_LEN = [0.9, 1, 0.96, 0.8];
const SEG = [95, 70, 52].map((v) => v * HS), SEG_R = [21, 19, 16].map((v) => v * HS), SEG_CURL = [1.05, 1.3, 1.15];

interface Pose { K: V3; a: V3; n: V3; l: V3; curl: number }
interface Glyph { i: number; cx: number; cy: number; ts: number; scoop: number; late: boolean }

export default class Engrave extends Scene {
  private layer!: Layer2D;
  private field: Layer2D | null = null;
  private hatch: CanvasPattern | null = null;
  private list: Shot[] = [];
  private T: number[] = [];
  private plate!: PlateInfo;
  private lines: Line[] = [];
  private tLock = 0;
  private glyphs: Glyph[] = [];
  private scoopKeys: [number, number][] = [];

  override init() {
    this.plate = this.ctx.params as PlateInfo;
    this.list = shots(this.plate, this.ctx.audio);
    this.T = this.list.map((s) => s.t);
    this.lines = ownedLines(this.ctx);
    this.layer = new Layer2D();
    // the fist locks on the last beat of the plate
    const bs = this.ctx.audio.beats.filter((b) => b > this.ctx.start && b < this.ctx.end - 0.05);
    this.tLock = bs[bs.length - 1] ?? this.ctx.end - 0.2;
  }

  private shotT(k: number) { return this.T[Math.min(k, this.T.length - 1)] ?? this.ctx.start; }

  // ------------------------------------------------------------------ materials
  /** Static engraved ground: wavy horizontal hatch whose line width carries the tone (cached once). */
  private ensureField() {
    if (this.field) return this.field;
    const L = new Layer2D(), c = L.ctx;
    L.clear();
    c.fillStyle = rgba('bone');
    const step = 24;
    for (let y = -10, k = 0; y < H + 10; y += 6.5, k++) {
      c.beginPath();
      const top: P[] = [], bot: P[] = [];
      for (let x = -step; x <= W + step; x += step) {
        const u = (x - W / 2) / (W / 2), v = (y - H / 2) / (H / 2);
        const r = Math.min(1.4, Math.hypot(u * 0.9, v * 1.1));
        const wy = y + 3.2 * Math.sin(x / 150 + k * 0.23) + 2 * Math.sin(x / 57 - k * 0.11);
        const w = 0.25 + 1.5 * r * r + 0.35 * (0.5 + 0.5 * Math.sin(x / 90 + y / 70));
        top.push({ x, y: wy - w / 2 }); bot.push({ x, y: wy + w / 2 });
      }
      c.moveTo(top[0]!.x, top[0]!.y);
      for (const p of top) c.lineTo(p.x, p.y);
      for (let i = bot.length - 1; i >= 0; i--) c.lineTo(bot[i]!.x, bot[i]!.y);
      c.closePath();
      c.fill();
    }
    this.field = L;
    return L;
  }

  private hatchPattern(c: CanvasRenderingContext2D) {
    if (this.hatch) return this.hatch;
    const cv = document.createElement('canvas');
    cv.width = cv.height = 8;
    const g = cv.getContext('2d')!;
    g.strokeStyle = rgba('bone');
    g.lineWidth = 2.2;
    g.beginPath();
    for (let k = -1; k <= 1; k++) { g.moveTo(k * 8, 8); g.lineTo(k * 8 + 8, 0); }
    g.stroke();
    this.hatch = c.createPattern(cv, 'repeat');
    return this.hatch!;
  }

  /** Engraved capsule p->q: ink body, hatch lines along the axis whose width is the shading, bone contour. */
  private capsule(c: CanvasRenderingContext2D, p: P, q: P, r: number, flash: number, n = 7) {
    const dx = q.x - p.x, dy = q.y - p.y, L = Math.hypot(dx, dy), ang = Math.atan2(dy, dx);
    c.save();
    c.translate(p.x, p.y);
    c.rotate(ang);
    c.beginPath();
    c.moveTo(0, -r); c.lineTo(L, -r); c.arc(L, 0, r, -Math.PI / 2, Math.PI / 2); c.lineTo(0, r); c.arc(0, 0, r, Math.PI / 2, Math.PI * 1.5);
    c.closePath();
    c.fillStyle = rgba('ink');
    c.fill();
    // light from the upper left: the side whose normal points down-right takes the heavy lines
    const side = -Math.sin(ang) * 0.6 + Math.cos(ang) * 0.8;
    c.strokeStyle = rgba('bone', 0.6 + 0.4 * flash);
    for (let k = 0; k < n; k++) {
      const v = -r + ((k + 0.5) * 2 * r) / n, e = Math.sqrt(Math.max(0, r * r - v * v));
      const shade = clamp(0.5 + 0.5 * side * (v / r));
      c.lineWidth = 0.35 + 2.6 * shade ** 1.4 + 0.6 * flash;
      c.beginPath(); c.moveTo(-e * 0.7, v); c.lineTo(L + e * 0.7, v); c.stroke();
    }
    c.lineWidth = 1.8;
    c.strokeStyle = rgba('bone', 0.95);
    c.beginPath();
    c.moveTo(0, -r); c.lineTo(L, -r); c.arc(L, 0, r, -Math.PI / 2, Math.PI / 2); c.lineTo(0, r); c.arc(0, 0, r, Math.PI / 2, Math.PI * 1.5);
    c.stroke();
    c.restore();
  }

  /** Riveted joint: ink disc, engraved rings, a hot centre on kicks. */
  private rivet(c: CanvasRenderingContext2D, p: P, r: number, kick: number) {
    c.fillStyle = rgba('ink');
    c.beginPath(); c.arc(p.x, p.y, r, 0, Math.PI * 2); c.fill();
    c.strokeStyle = rgba('bone', 0.9);
    for (let k = 0; k < 3; k++) {
      c.lineWidth = k === 0 ? 1.8 : 0.9;
      c.beginPath(); c.arc(p.x, p.y, r * (1 - k * 0.3), 0, Math.PI * 2); c.stroke();
    }
    c.fillStyle = rgba(kick > 0.3 ? 'ember' : 'bone', 0.4 + 0.6 * kick);
    c.beginPath(); c.arc(p.x, p.y, r * 0.18 + r * 0.14 * kick, 0, Math.PI * 2); c.fill();
  }

  /** Clip to a polygon and cut parallel lines at `ang`, widths from shade(line centre) (0..1). */
  private hatchPoly(c: CanvasRenderingContext2D, pts: P[], ang: number, gap: number, shade: (x: number, y: number) => number, color: 'bone' | 'graphite', alpha: number) {
    let cx = 0, cy = 0, R = 0;
    for (const p of pts) { cx += p.x / pts.length; cy += p.y / pts.length; }
    for (const p of pts) R = Math.max(R, Math.hypot(p.x - cx, p.y - cy));
    c.save();
    c.beginPath();
    pts.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)));
    c.closePath();
    c.fillStyle = rgba('ink');
    c.fill();
    c.clip();
    c.strokeStyle = rgba(color, alpha);
    const ux = Math.cos(ang), uy = Math.sin(ang), vx = -uy, vy = ux;
    for (let v = -R; v <= R; v += gap) {
      const mx = cx + vx * v, my = cy + vy * v;
      c.lineWidth = 0.3 + 3.2 * clamp(shade(mx, my));
      c.beginPath(); c.moveTo(mx - ux * R, my - uy * R); c.lineTo(mx + ux * R, my + uy * R); c.stroke();
    }
    c.restore();
  }

  // ------------------------------------------------------------------ the hand
  private pose(t: number): Pose {
    const [, , T2, T3, T4, T5] = [0, 1, 2, 3, 4, 5].map((k) => this.shotT(k)) as number[];
    const au = this.ctx.audio;
    // sweep: the knuckle bar reaches each floor glyph at its scoop time; +14 px ratchet per beat
    let x = this.scoopKeys[0]?.[1] ?? -1250;
    for (let i = 0; i + 1 < this.scoopKeys.length; i++) {
      const [ta, xa] = this.scoopKeys[i]!, [tb, xb] = this.scoopKeys[i + 1]!;
      if (t >= ta) x = t >= tb ? xb : lerp(xa, xb, ease.inOutQuad((t - ta) / Math.max(1e-3, tb - ta)));
    }
    const bs = au.beats.filter((b) => b > T2! - 1e-3 && b <= t);
    if (bs.length) x += 14 * (bs.length - 1) + 14 * ease.outCubic(clamp((t - bs[bs.length - 1]!) / 0.05));
    let y = FLOOR - 200 * HS;
    const lift = ease.inOutCubic(clamp((t - T4!) / 0.5));
    y -= 210 * lift;
    let tilt = lerp(-0.36, -0.12, ease.inOutQuad(clamp((t - T3!) / 0.6)));
    tilt = lerp(tilt, 0.05, lift);
    let curl = 0.14;
    curl = lerp(curl, 0.52, ease.inOutCubic(clamp((t - T3!) / (T4! - T3!))));
    curl = lerp(curl, 0.68, ease.outCubic(clamp((t - T4!) / (T5! - T4!))));
    if (t >= T5!) curl = lerp(0.68, 1, ease.inCubic(clamp((t - T5!) / Math.max(0.05, this.tLock - T5!))));
    const a = norm([Math.sin(tilt), Math.cos(tilt), 0]);
    const beta = 1.22; // palm faces mostly towards the viewer, a little into the sweep
    const n = norm(add(mul([a[1], -a[0], 0], -Math.cos(beta)), [0, 0, Math.sin(beta)]));
    const l = norm(cross(a, n));
    return { K: [x, y, 0], a, n, l, curl };
  }

  /** Joint positions of finger k (0..3) at the given pose. */
  private finger(ps: Pose, k: number): V3[] {
    const base = add(ps.K, mul(ps.l, FINGER_OFS[k]!));
    const pts: V3[] = [base];
    let phi = 0.1 + 0.05 * k;
    for (let j = 0; j < 3; j++) {
      phi += ps.curl * SEG_CURL[j]! * (1 + 0.06 * (k - 1.5));
      const d = add(mul(ps.a, Math.cos(phi)), mul(ps.n, Math.sin(phi)));
      pts.push(add(pts[j]!, mul(d, SEG[j]! * FINGER_LEN[k]!)));
    }
    return pts;
  }

  private thumb(ps: Pose): V3[] {
    const wrist = add(ps.K, mul(ps.a, -PALM));
    const base = add(add(wrist, mul(ps.a, 85 * HS)), mul(ps.l, -118 * HS));
    const d0 = norm(add(mul(ps.a, 0.5), mul(ps.l, -0.86)));
    const d1 = norm(add(mul(ps.l, 0.55), mul(ps.n, 0.8)));
    const p1 = 0.3 + ps.curl * 0.95, p2 = p1 + 0.25 + ps.curl * 0.75;
    const j1 = add(base, mul(add(mul(d0, Math.cos(p1)), mul(d1, Math.sin(p1))), 88 * HS));
    const j2 = add(j1, mul(add(mul(d0, Math.cos(p2)), mul(d1, Math.sin(p2))), 66 * HS));
    return [base, j1, j2];
  }

  private palmPoly(ps: Pose): P[] {
    const wrist = add(ps.K, mul(ps.a, -PALM));
    return [
      pr(add(wrist, mul(ps.l, -100 * HS))), pr(add(wrist, mul(ps.l, 100 * HS))),
      pr(add(add(ps.K, mul(ps.l, 122 * HS)), mul(ps.a, 10))), pr(add(add(ps.K, mul(ps.l, -122 * HS)), mul(ps.a, 10))),
    ];
  }

  private drawHandBack(c: CanvasRenderingContext2D, ps: Pose, flash: number, kick: number) {
    const wrist = add(ps.K, mul(ps.a, -PALM));
    // forearm: a hatched cylinder with piston collars, running out of frame
    const far = add(wrist, mul(ps.a, -1300));
    this.capsule(c, pr(far), pr(wrist), 74 * HS, flash, 17);
    c.strokeStyle = rgba('bone', 0.8);
    c.lineWidth = 1.4;
    for (let k = 1; k < 7; k++) {
      const m = pr(add(wrist, mul(ps.a, (-60 - k * 95) * HS))), lv = mul([ps.a[1], -ps.a[0], 0], 74 * HS);
      c.beginPath(); c.moveTo(m.x - lv[0], m.y - lv[1]); c.lineTo(m.x + lv[0], m.y + lv[1]); c.stroke();
    }
    // palm plate: hatch along the hand axis, heavier towards the shadowed edge
    const poly = this.palmPoly(ps);
    const ang = Math.atan2(ps.a[1], ps.a[0]);
    const K = pr(ps.K), l2 = pr(ps.l);
    this.hatchPoly(c, poly, ang, 7, (x, y) => 0.25 + 0.55 * clamp(0.5 + ((x - K.x) * l2.x + (y - K.y) * l2.y) / 240) + 0.3 * flash, 'bone', 0.75 + 0.25 * flash);
    c.strokeStyle = rgba('bone', 0.95);
    c.lineWidth = 2;
    c.beginPath(); poly.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y))); c.closePath(); c.stroke();
    // panel seam + rivets
    const s0 = pr(add(add(wrist, mul(ps.a, PALM * 0.42)), mul(ps.l, -108 * HS))), s1 = pr(add(add(wrist, mul(ps.a, PALM * 0.42)), mul(ps.l, 110 * HS)));
    c.lineWidth = 1.2;
    c.beginPath(); c.moveTo(s0.x, s0.y); c.lineTo(s1.x, s1.y); c.stroke();
    for (const q of poly) this.rivet(c, { x: lerp(q.x, K.x, 0.12), y: lerp(q.y, K.y, 0.12) }, 9 * HS, kick);
    this.rivet(c, pr(wrist), 30 * HS, kick); // wrist ball
  }

  private drawHandFront(c: CanvasRenderingContext2D, ps: Pose, flash: number, kick: number) {
    // knuckle bar across the palm end
    this.capsule(c, pr(add(ps.K, mul(ps.l, -128 * HS))), pr(add(ps.K, mul(ps.l, 128 * HS))), 22 * HS, flash, 6);
    for (let k = 0; k < 4; k++) {
      const f = this.finger(ps, k);
      for (let j = 0; j < 3; j++) this.capsule(c, pr(f[j]!), pr(f[j + 1]!), SEG_R[j]! * FINGER_LEN[k]!, flash, 6);
      for (let j = 0; j < 3; j++) this.rivet(c, pr(f[j]!), SEG_R[j]! * 0.8, kick);
    }
    const th = this.thumb(ps);
    this.capsule(c, pr(th[0]!), pr(th[1]!), 24 * HS, flash, 7);
    this.capsule(c, pr(th[1]!), pr(th[2]!), 20 * HS, flash, 6);
    this.rivet(c, pr(th[0]!), 18 * HS, kick);
    this.rivet(c, pr(th[1]!), 15 * HS, kick);
  }

  // ------------------------------------------------------------------ line 17 choreography
  /** Floor glyph layout (same params as the drawLyric call) + scoop schedule. */
  private prepGlyphs(c: CanvasRenderingContext2D, line: Line) {
    const T2 = this.shotT(2), T3 = this.shotT(3), T4 = this.shotT(4);
    const lay = layoutLine(c, line, F.slam(), L17.size, L17.maxWidth);
    this.glyphs = lay.chars.map((b) => {
      const w = line.words[b.word]!;
      const ts = w.syl && w.syl.length ? w.syl[b.syl]![0] : w.start;
      const late = ts >= T4 - 1e-3;
      return { i: b.index, cx: L17.x + b.x + b.w / 2, cy: L17.y - lay.size * 0.35, ts, scoop: late ? Infinity : ts + (ts < T3 ? 0.7 : 0.33), late };
    });
    const keys: [number, number][] = [[T2, -1250]];
    for (const g of this.glyphs) if (!g.late) keys.push([g.scoop, g.cx]);
    this.scoopKeys = keys;
  }

  private heldPos(g: Glyph, t: number): { p: P; s: number; rot: number; a: number } {
    const held = this.glyphs.filter((h) => !h.late && h.scoop <= t);
    const j = held.indexOf(g), nRows = Math.ceil(held.length / 3);
    const row = Math.floor(j / 3), col = j % 3, age = nRows - 1 - row;
    const ps = this.pose(t);
    const shrink = 1 - 0.3 * ps.curl;
    const q = add(add(add(ps.K, mul(ps.a, -(62 + 88 * age) * shrink)), mul(ps.l, (col - 1) * 96 * shrink)), mul(ps.n, 8));
    // the stack disappears into the fist as it locks
    const hide = 1 - smoothstep(0.8, 1, ps.curl);
    return { p: pr(q), s: 0.72 * 0.9 ** age, rot: Math.atan2(ps.l[1], ps.l[0]) + (hash(g.i, 5) - 0.5) * 0.2, a: clamp(1.4 - age * 0.3) * hide };
  }

  /** Gap between fingertips k and k+1 (letters fall through here). */
  private gapPoint(t: number, k: number): P {
    const ps = this.pose(t);
    const a = this.finger(ps, k)[2]!, b = this.finger(ps, k + 1)[2]!;
    return pr(mul(add(a, b), 0.5));
  }

  private glyphXform(g: Glyph, s: CharState, t: number): CharXform {
    const T4 = this.shotT(4);
    const g0 = this.glyphs[s.box.index] ?? g;
    const base = { x: g0.cx, y: g0.cy };
    const to = (p: P, extra: CharXform = {}): CharXform => ({ dx: p.x - base.x, dy: p.y - base.y, ...extra });
    const G = 1150;
    if (g0.late) {
      // the last word waits between the fingertips and drops through them as it is sung
      const k = g0.i % 3;
      if (t < T4) return {};
      if (!s.sung) return to(this.gapPoint(t, k), { scale: 0.8 });
      const dt = t - g0.ts, p0 = this.gapPoint(g0.ts, k);
      return to({ x: p0.x + (hash(g0.i, 9) - 0.5) * 140 * dt, y: p0.y + 95 + 0.5 * G * dt * dt }, { scale: 0.82, rot: (hash(g0.i, 4) - 0.5) * 1.1 * dt });
    }
    if (t < g0.scoop) return {};
    const drop = hash(g0.i, 7) < 0.55;
    const droppers = this.glyphs.filter((h) => !h.late && hash(h.i, 7) < 0.55);
    const td = T4 + 0.1 + 0.12 * droppers.indexOf(g0);
    if (drop && t >= td) {
      const h = this.heldPos(g0, td), dt = t - td;
      // older letters slip out sideways and recede (smaller, dimmer) so the falling last word stays the read
      const side = h.p.x < this.gapPoint(td, 1).x ? -1 : 1;
      return to({ x: h.p.x + side * (120 + 160 * hash(g0.i, 3)) * dt, y: h.p.y + 0.5 * G * dt * dt },
        { scale: h.s * Math.max(0.35, 1 - 0.6 * dt), rot: h.rot + (hash(g0.i, 4) - 0.5) * 1.4 * dt, alpha: 0.5 });
    }
    const h = this.heldPos(g0, t);
    const u = ease.outCubic(clamp((t - g0.scoop) / 0.2));
    const arc = -90 * Math.sin(Math.PI * u);
    return to({ x: lerp(base.x, h.p.x, u), y: lerp(base.y, h.p.y, u) + arc }, { scale: lerp(1, h.s, u), rot: lerp(0, h.rot, u), alpha: lerp(1, h.a, u) });
  }

  // ------------------------------------------------------------------ seam (line 16)
  private drawSeam(c: CanvasRenderingContext2D, t: number, flash: number, kick: number) {
    const T1 = this.shotT(1);
    const col = ease.inCubic(clamp((t - T1) / 1.1));
    const au = this.ctx.audio;
    const nb = au.beats.filter((b) => b >= this.ctx.start - 1e-3 && b <= Math.min(t, T1)).length;
    const gap = 34 + 7 * nb + 3 * kick * Math.sin(t * 90);
    const edge = (y: number, side: number) => side * (gap / 2 + 9 * (hash(Math.floor(y / 22), side > 0 ? 3 : 4) - 0.5));
    for (const side of [-1, 1]) {
      c.save();
      // top-down: after the snap each slab hinges on its outer edge and falls away (shrinks, turns, slides out)
      c.translate(side * 280 * col, 90 * col);
      c.rotate(side * 0.22 * col);
      c.scale(1 - 0.38 * col, 1 - 0.38 * col);
      const pts: P[] = [];
      for (let y = -760; y <= 760; y += 22) pts.push({ x: edge(y, side), y });
      pts.push({ x: side * 1500, y: 760 }, { x: side * 1500, y: -760 });
      this.hatchPoly(c, pts, Math.PI / 2 - side * 0.28, 12, (x) => 0.7 - 0.6 * clamp(Math.abs(x) / 900) + 0.2 * flash, 'bone', (0.4 + 0.35 * flash) * (1 - 0.45 * col));
      c.strokeStyle = rgba('bone', 0.9 * (1 - 0.3 * col));
      c.lineWidth = 2;
      c.beginPath();
      for (let y = -760; y <= 760; y += 22) (y === -760 ? c.moveTo(edge(y, side), y) : c.lineTo(edge(y, side), y));
      c.stroke();
      c.restore();
    }
    // fibres: four already broken (dangling curls), two straining until the first syllable of line 16
    c.lineCap = 'round';
    for (let k = 0; k < 6; k++) {
      const y = -330 + k * 128 + 20 * hash(k, 1);
      const intact = k === 2 || k === 4 ? t < T1 : false;
      const left = edge(y, -1), right = edge(y, 1);
      if (intact) {
        const tr = 2.5 * Math.sin(t * 70 + k) * (0.4 + kick);
        c.strokeStyle = rgba('bone', 0.95);
        for (let s = -1; s <= 1; s++) {
          c.lineWidth = s === 0 ? 3 : 1.4;
          c.beginPath(); c.moveTo(left, y + s * 3); c.quadraticCurveTo(0, y + s * 3 + tr + 6 * s, right, y + s * 2); c.stroke();
        }
        c.fillStyle = rgba('signal', 0.5 + 0.5 * kick);
        c.beginPath(); c.arc(0, y + tr, 5 + 5 * kick, 0, Math.PI * 2); c.fill();
      } else {
        const recoil = t >= T1 && (k === 2 || k === 4) ? ease.outCubic(clamp((t - T1) / 0.25)) : 1;
        c.strokeStyle = rgba('bone', 0.8 * (1 - col * 0.6));
        c.lineWidth = 1.1;
        for (const side of [-1, 1]) {
          const x0 = side < 0 ? left : right, len = gap / 2 * (1 - 0.4 * recoil) + 10;
          c.beginPath(); c.moveTo(x0, y);
          c.bezierCurveTo(x0 - side * len * 0.6, y + 8 * recoil, x0 - side * len, y + 22 * recoil, x0 - side * len * 0.7, y + 34 * recoil);
          c.stroke();
        }
      }
    }
    // debris: engraved shards falling out of the seam after the snap
    if (t >= T1) {
      for (let k = 0; k < 22; k++) {
        const dt = t - T1 - hash(k, 2) * 0.3;
        if (dt < 0) continue;
        const x = (hash(k, 3) - 0.5) * gap * 3 + (hash(k, 4) - 0.5) * 380 * dt, y = (hash(k, 5) - 0.5) * 1000 + 160 * dt;
        const s = (12 + 26 * hash(k, 6)) * Math.max(0.1, 1 - 0.55 * dt);
        c.save(); c.translate(x, y); c.rotate(hash(k, 8) * 6 + dt * (hash(k, 9) - 0.5) * 8);
        this.hatchPoly(c, [{ x: -s, y: -s * 0.4 }, { x: s, y: -s * 0.6 }, { x: s * 0.2, y: s }], 0.8, 4, () => 0.4, 'bone', 0.85);
        c.restore();
      }
    }
  }

  private drawFloor(c: CanvasRenderingContext2D, flash: number) {
    // an engraved plane: lines crowd towards the horizon (the baseline), heavier near the viewer
    c.fillStyle = rgba('ink2');
    c.fillRect(-4000, FLOOR + 18, 8000, 3000);
    c.strokeStyle = rgba('bone', 0.3 + 0.35 * flash);
    for (let k = 0; k < 44; k++) {
      const y = FLOOR + 20 + 2.2 * k ** 1.6;
      c.lineWidth = 0.5 + 0.07 * k + 0.8 * flash;
      c.beginPath(); c.moveTo(-4000, y); c.lineTo(4000, y); c.stroke();
    }
    c.strokeStyle = rgba('bone', 0.9);
    c.lineWidth = 2;
    c.beginPath(); c.moveTo(-4000, FLOOR + 18); c.lineTo(4000, FLOOR + 18); c.stroke();
  }

  // ------------------------------------------------------------------ render
  private camera(fr: Framing, t: number): { s: number; fx: number; fy: number; rot: number } {
    if (fr === 'seam') return { s: 1.25, fx: 0, fy: 30, rot: 0.1 };
    if (fr === 'drop') return { s: 1.0, fx: 0, fy: 20, rot: -0.035 };
    if (fr === 'wide') return { s: 0.88, fx: 0, fy: -40, rot: 0 };
    const K = pr(this.pose(t).K);
    if (fr === 'close') return { s: 1.5, fx: K.x + 90, fy: K.y + 40, rot: -0.06 };
    if (fr === 'under') return { s: 1.1, fx: K.x + 40, fy: K.y + 130, rot: 0.08 };
    return { s: 1.55, fx: K.x, fy: K.y + 110, rot: -0.04 };
  }

  private drawChar = (c: CanvasRenderingContext2D, ch: string, s: CharState) => {
    c.lineJoin = 'round';
    if (!s.sung) {
      c.strokeStyle = rgba('bone', 0.8);
      c.lineWidth = 2.4;
      c.strokeText(ch, 0, 0);
      return;
    }
    if (s.frac < 1) {
      c.fillStyle = rgba('signal');
      c.fillText(ch, 0, 0);
      c.strokeStyle = rgba('ember');
    } else {
      c.fillStyle = rgba('ink');
      c.fillText(ch, 0, 0);
      c.fillStyle = this.hatchPattern(c);
      c.fillText(ch, 0, 0);
      c.strokeStyle = rgba('bone');
    }
    c.lineWidth = 2.2;
    c.strokeText(ch, 0, 0);
  };

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, audio } = this.ctx;
    const t = f.t;
    const sh = shotAt(this.list, t);
    const fr = sh.shot.s.frame as Framing, topo = sh.shot.s.topo as Topo;
    const L = this.layer, c = L.ctx;
    L.clear();
    const bp = beatPulse(audio, t, 0.13), kick = kickPulse(audio, t, 0.1), db = downbeatPulse(audio, t, 0.22);
    const hand = this.plate.variant === 'hand';

    // engraved ground: the hatch field flashes on every beat
    c.globalAlpha = 0.1 + 0.34 * bp;
    c.drawImage(this.ensureField().canvas, 0, 0, W, H);
    c.globalAlpha = 1;

    const [l16, l17] = this.lines;
    if (hand && l17) this.prepGlyphs(c, l17); // per frame: the layout needs the loaded font
    const cam = this.camera(fr, t);
    c.save();
    c.translate(W / 2, H / 2);
    c.rotate(cam.rot);
    c.scale(cam.s, cam.s);
    c.translate(-cam.fx, -cam.fy);

    const early = topo === 'fibres' || topo === 'collapse';
    if (hand) {
      if (early) this.drawSeam(c, t, bp, kick);
      else this.drawFloor(c, bp);
    }

    // line 16: held across the seam, each syllable sags as it is sung; in the wide shot it lies as rubble up-left
    if (l16) {
      const T2 = this.shotT(2);
      const big = !hand || early;
      drawLyric(c, l16, t, {
        x: big ? 0 : -800, y: big ? 90 : -330, size: big ? 270 : 104, maxWidth: big ? 1200 : 700,
        align: big ? 'center' : 'left', rotation: big ? 0 : -0.06, family: F.slam(),
        sungColor: 'bone', unsungColor: 'graphite', unsungAlpha: 0.55, lead: 0.4,
        alpha: big ? 1 : 1 - smoothstep(T2 + 0.9, T2 + 1.5, t),
        drawChar: this.drawChar,
        charTransform: (_ch, i, s) => {
          if (!s.sung) return { dy: 0 };
          const col = ease.outBack(clamp(s.frac * 1.6));
          const side = i % 2 ? 1 : -1;
          return big ? { dy: 60 * col + 14 * db, rot: side * 0.09 * col, dx: side * 10 * col } : { dy: 10 * side, rot: side * 0.07 };
        },
      });
    }

    const ps = hand && !early ? this.pose(t) : null;
    if (ps) this.drawHandBack(c, ps, bp, kick);
    if (l17) {
      drawLyric(c, l17, t, {
        x: L17.x, y: L17.y, size: L17.size, maxWidth: L17.maxWidth, align: 'left', family: F.slam(),
        sungColor: 'bone', unsungColor: 'graphite', unsungAlpha: 0.6, lead: hand ? 0 : 0.4,
        drawChar: (cc, ch, s) => {
          const g = this.glyphs[s.box.index];
          if (!hand || !g || !(t >= g.scoop || (g.late && s.sung && s.frac >= 1))) return this.drawChar(cc, ch, s);
          // in the steel palm: stamped solid, ink-cut contour (reads against the palm's hatch)
          cc.lineJoin = 'round';
          cc.strokeStyle = rgba('ink');
          cc.lineWidth = 7;
          cc.strokeText(ch, 0, 0);
          cc.fillStyle = rgba('bone');
          cc.fillText(ch, 0, 0);
        },
        charTransform: (_ch, _i, s) => (hand ? this.glyphXform(this.glyphs[s.box.index]!, s, t) : { dy: -8 * bp }),
      });
    }
    if (ps) this.drawHandFront(c, ps, bp, kick);
    c.restore();
    L.upload();

    clearRT(renderer, out, LIN.ink);
    this.ctx.comp.draw(renderer, L.texture, out, { mode: 'normal' });

    // authored hits (T2: shake <= 14 px, downbeat punch <= 1.06)
    const T = (k: number) => this.shotT(k);
    // hit envelope: full for 2 frames, then an outExpo-like decay over ~6 frames
    const hit = (t0: number) => (t < t0 ? 0 : t - t0 < 2 / 60 ? 1 : pulse(t, t0 + 2 / 60, 0.025));
    const hSnap = hit(T(1)), hEnter = hit(T(2)), hClose = hit(T(3)), hFall = hit(T(4)), hLock = hit(this.tLock);
    const sk = Math.min(14, 14 * hSnap + 9 * hEnter + 6 * hFall + 12 * hLock + 3 * kick);
    const ang = hash(Math.floor(t * 60), 11) * Math.PI * 2;
    const zoom = Math.min(1.06, 1 + 0.035 * db + 0.03 * hSnap + 0.025 * hClose + 0.03 * hLock);
    return {
      shake: [sk * Math.cos(ang), sk * Math.sin(ang)],
      zoom,
      flash: 0.3 * hSnap + 0.08 * hClose + 0.06 * hFall + 0.16 * hLock,
      vignette: 0.4,
      bloom: 0,
    };
  }

  override dispose() {
    this.layer?.texture.dispose();
    this.field?.texture.dispose();
  }
}
