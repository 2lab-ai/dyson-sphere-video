// CAVE — p33-cave-fire (drop 2 climax, 1.75 bars; the first plate of the civilization history). Fire and speech:
// a limestone wall lit only by a fire on the floor, ochre animals (Lascaux / Chauvet: red and yellow ochre fills,
// charcoal contours), sprayed negative hands (Cueva de las Manos), and the first sounds as sparks that rise out of
// the fire and land on the rock as the first marks (rows of red dots and strokes, the signs before writing).
// Medium: faceted rock relief lit per facet by a flickering point light (the fire), pigment laid over it and dimmed
// by the same light. Palette `cave` only: ground (soot dark) -> deep (umber rock) -> text (tan limestone) -> hi
// (flame); mid = red ochre pigment; signal = the flame's orange.
// Beat (T3): every beat the fire flares (light radius + flame height), and the object itself is struck: a hand is
// sprayed onto the wall (wide / panel), the painted horse's legs snap to the next pose (proto-animation), a burst of
// sparks fans up (hand), a spark strikes the rock and leaves a mark (marks). Exit: a spark falls onto wet clay.
import type * as THREE from 'three';
import { Scene, type Frame, type PostOverrides } from '../engine/scene';
import { Layer2D, clearRT } from '../engine/gl';
import { palette, pcss, plin, pmix, type NamedPalette, type Role } from '../engine/palette';
import { beatPulse, kickPulse, downbeatPulse, beatIndex } from '../engine/beat';
import { stateAt, shotAt, type PlateInfo, type Shot } from '../engine/shots';
import { clamp, lerp, hash, ease, noise2 } from '../engine/util';
import { shots, type Cam } from './cave.shots';

const W = 1920, H = 1080;
/** The fire on the cave floor (world = the wide framing's pixels). */
const FX = 960, FY = 995;
/** Wall meets floor. */
const FLOOR = 1000;
/** The wet clay patch on the floor where the last spark lands. */
const CLAY = { x: 1470, y: 1034, rx: 150, ry: 24 };

interface Hand { x: number; y: number; s: number; rot: number; neg: boolean; a: number; t0: number; spread: number }
interface Spark { t0: number; ang: number; v: number; life: number; seed: number; burst: boolean }
interface Mark { x: number; y: number; kind: 'dot' | 'bar'; te: number; r: number }
interface Camera { cx: number; cy: number; z: number; rot: number; cell: number }

type V = [number, number];
/** Animals as unit outlines (facing left, width 1), legs as polylines, horns / antlers as polylines. */
const HORSE: V[] = [[0.0, 0.3], [0.03, 0.37], [0.12, 0.36], [0.2, 0.31], [0.22, 0.37], [0.25, 0.5], [0.4, 0.56], [0.65, 0.57], [0.8, 0.52], [0.93, 0.42], [0.96, 0.27], [0.8, 0.2], [0.55, 0.22], [0.35, 0.14], [0.24, 0.05], [0.17, 0.02], [0.16, -0.07], [0.12, 0.02], [0.07, 0.1], [0.02, 0.22]];
const HORSE_LEGS: V[][][] = [
  [[[0.29, 0.52], [0.27, 0.7], [0.29, 0.86]], [[0.38, 0.55], [0.42, 0.71], [0.41, 0.86]], [[0.8, 0.52], [0.84, 0.69], [0.8, 0.86]], [[0.9, 0.45], [0.95, 0.66], [0.94, 0.85]]],
  [[[0.29, 0.52], [0.18, 0.66], [0.1, 0.78]], [[0.38, 0.55], [0.5, 0.68], [0.56, 0.8]], [[0.8, 0.52], [0.72, 0.67], [0.63, 0.78]], [[0.9, 0.45], [1.03, 0.6], [1.1, 0.72]]],
];
const HORSE_TAIL: V[] = [[0.95, 0.27], [1.06, 0.36], [1.05, 0.56]];
const HORSE_MANE: V[] = [[0.17, 0.03], [0.27, 0.07], [0.36, 0.15]];
const BULL: V[] = [[0.0, 0.4], [0.05, 0.48], [0.12, 0.47], [0.18, 0.56], [0.22, 0.64], [0.45, 0.66], [0.7, 0.62], [0.84, 0.56], [0.96, 0.42], [0.97, 0.28], [0.8, 0.22], [0.55, 0.2], [0.33, 0.08], [0.2, 0.14], [0.13, 0.22], [0.06, 0.26], [0.02, 0.33]];
const BULL_HEAD: V[] = [[0.0, 0.4], [0.05, 0.48], [0.12, 0.47], [0.18, 0.54], [0.26, 0.42], [0.24, 0.2], [0.13, 0.22], [0.06, 0.26], [0.02, 0.33]];
const HORSE_HEAD: V[] = [[0.0, 0.3], [0.03, 0.37], [0.12, 0.36], [0.2, 0.31], [0.26, 0.22], [0.36, 0.15], [0.24, 0.05], [0.17, 0.02], [0.12, 0.02], [0.07, 0.1], [0.02, 0.22]];
const BULL_LEGS: V[][] = [[[0.24, 0.62], [0.23, 0.78], [0.25, 0.9]], [[0.33, 0.65], [0.36, 0.78], [0.35, 0.9]], [[0.8, 0.6], [0.83, 0.75], [0.8, 0.9]], [[0.9, 0.52], [0.95, 0.72], [0.94, 0.9]], [[0.97, 0.3], [1.02, 0.45], [1.0, 0.62]]];
const BULL_HORNS: V[][] = [[[0.12, 0.21], [0.08, 0.1], [0.12, -0.02], [0.21, -0.07]], [[0.15, 0.19], [0.2, 0.07], [0.29, 0.01]]];
const DEER: V[] = [[0.0, 0.18], [0.03, 0.24], [0.12, 0.26], [0.2, 0.34], [0.26, 0.5], [0.6, 0.52], [0.84, 0.46], [0.97, 0.32], [0.9, 0.22], [0.6, 0.24], [0.3, 0.2], [0.2, 0.08], [0.12, 0.04], [0.05, 0.1]];
const DEER_LEGS: V[][] = [[[0.28, 0.5], [0.27, 0.68], [0.3, 0.84]], [[0.36, 0.52], [0.39, 0.7], [0.37, 0.84]], [[0.78, 0.48], [0.82, 0.66], [0.79, 0.84]], [[0.88, 0.42], [0.93, 0.62], [0.92, 0.82]]];
const ANTLERS: V[][] = [[[0.12, 0.04], [0.14, -0.14], [0.26, -0.3], [0.34, -0.36]], [[0.14, -0.14], [0.04, -0.24]], [[0.2, -0.24], [0.16, -0.36]], [[0.16, 0.03], [0.24, -0.08], [0.36, -0.14]]];
/** Fingers: base (palm frame), angle (rad, -PI/2 = up), length, width. Thumb first. */
const FINGERS: [number, number, number, number, number][] = [
  [-0.34, 0.1, -2.35, 0.5, 0.2], [-0.24, -0.27, -1.8, 0.62, 0.19], [-0.07, -0.35, -1.62, 0.71, 0.2], [0.11, -0.32, -1.45, 0.65, 0.19], [0.27, -0.21, -1.25, 0.48, 0.17],
];

export default class Cave extends Scene {
  /** v4: composited by the AMBER host — the rock wall (dark) is replaced by the host's light haze. */
  private get hosted() { return !!this.ctx.params.hosted; }
  private layer!: Layer2D;
  private list: Shot[] = [];
  private plate!: PlateInfo;
  private P!: NamedPalette;
  private beats: number[] = [];
  private hands: Hand[] = [];
  private closeHand!: Hand;
  private sparks: Spark[] = [];
  private marks: Mark[] = [];
  private markShots: { te: number; x: number; y: number }[] = [];
  // per-frame light
  private lf = { x: FX, y: FY - 60, z: 240, R: 620, k: 1 };

  override init() {
    this.plate = this.ctx.params as PlateInfo;
    this.P = palette(this.ctx.params.look?.palette ?? 'cave');
    this.list = shots(this.plate, this.ctx.audio);
    this.layer = new Layer2D();
    const { start, end, audio } = this.ctx;
    this.beats = audio.beats.filter((b) => b >= start - 0.02 && b < end - 0.02);
    const B = (i: number) => this.beats[i] ?? start + i * 0.583;
    const kicks = (audio.onsets?.kick ?? []).filter(([t, v]) => t > start && t < end - 0.15 && v >= 0.9 && this.beats.every((b) => Math.abs(b - t) > 0.12)).map(([t]) => t);

    // hands: old ones already on the wall (faded), then one sprayed on each beat of the wide / panel shots
    const old: [number, number, number, number, boolean, number][] = [
      [320, 300, 52, -0.25, true, 0.42], [215, 500, 46, 0.3, false, 0.38], [880, 215, 44, 0.12, true, 0.36], [1770, 610, 50, -0.35, true, 0.4],
      [1060, 640, 42, 0.22, false, 0.34], [640, 690, 48, 0.1, true, 0.36], [1560, 170, 40, -0.1, true, 0.3], [150, 250, 40, 0.4, true, 0.3],
    ];
    this.hands = old.map(([x, y, s, rot, neg, a]) => ({ x, y, s, rot, neg, a, t0: -Infinity, spread: 1 }));
    const fresh: [number, number, number, number][] = [[560, 320, 60, -0.18], [770, 455, 58, 0.22], [1005, 330, 56, -0.12]];
    fresh.forEach(([x, y, s, rot], i) => this.hands.push({ x, y, s, rot, neg: true, a: 0.95, t0: B(i), spread: 1.15 }));
    // the hand of the close shot: sprayed on the drop (storyboard shot 2 = beat 3)
    this.closeHand = { x: 430, y: 610, s: 62, rot: 0.14, neg: true, a: 1, t0: B(3), spread: 1.2 };
    this.hands.push(this.closeHand);

    // sparks: a steady trickle out of the fire, a burst on every beat, a smaller one on the loud kicks
    const sp: Spark[] = [];
    let n = 0;
    for (let t = start - 1.6; t < end; t += 0.022) {
      n++;
      sp.push({ t0: t + 0.02 * hash(n, 1), ang: -Math.PI / 2 + (hash(n, 2) - 0.5) * 0.9, v: lerp(180, 420, hash(n, 3)), life: lerp(0.8, 1.7, hash(n, 4)), seed: hash(n, 5), burst: false });
    }
    const burst = (t0: number, k: number, big: boolean) => {
      for (let j = 0; j < k; j++) {
        n++;
        const u = (j + 0.5) / k - 0.5;
        sp.push({ t0: t0 + 0.012 * hash(n, 6), ang: -Math.PI / 2 + u * (big ? 1.5 : 1.0) + (hash(n, 7) - 0.5) * 0.12, v: lerp(big ? 520 : 380, big ? 900 : 640, hash(n, 8)), life: lerp(0.7, 1.3, hash(n, 9)), seed: hash(n, 10), burst: true });
      }
    };
    this.beats.forEach((b) => burst(b, 22, true));
    kicks.forEach((k) => burst(k, 10, false));
    this.sparks = sp;

    // marks: on the beats of the marks shot and the loud kicks between them, a spark strikes the rock
    const tm = this.list.find((s) => s.s.cam === 'marks')?.t ?? B(5);
    const ev = [...this.beats.filter((b) => b >= tm - 0.01), ...kicks.filter((k) => k > tm)].sort((a, b) => a - b).slice(0, 5);
    const rows: [number, number][] = [[1340, 762], [1480, 768], [1340, 820], [1480, 826], [1340, 878]];
    const marks: Mark[] = [];
    const flights: { te: number; x: number; y: number }[] = [];
    ev.forEach((te, i) => {
      const [x0, y0] = rows[i % rows.length]!;
      const kind: Mark['kind'] = i % 2 === 0 ? 'dot' : 'bar';
      const k = kind === 'dot' ? 4 : 3;
      for (let j = 0; j < k; j++) {
        const x = x0 + j * (kind === 'dot' ? 32 : 24) + 4 * (hash(i, j, 1) - 0.5), y = y0 + 5 * (hash(i, j, 2) - 0.5);
        const tj = te + j * 0.028;
        marks.push({ x, y, kind, te: tj, r: kind === 'dot' ? lerp(10, 13, hash(i, j, 3)) : 30 });
        flights.push({ te: tj, x, y });
      }
    });
    this.marks = marks;
    this.markShots = flights;
  }

  // ------------------------------------------------------------------ colour
  /** The rock / light ramp: 0 = ground (soot), 1 = deep (umber), 2 = text (tan limestone), 3 = hi (flame). */
  private ramp(v: number, a = 1): string {
    const P = this.P;
    const x = clamp(v, 0, 3);
    if (x < 1) return pmix(P, 'ground', 'deep', x, a);
    if (x < 2) return pmix(P, 'deep', 'text', x - 1, a);
    return pmix(P, 'text', 'hi', x - 2, a);
  }
  private col(r: Role, a = 1) { return pcss(this.P, r, a); }

  // ------------------------------------------------------------------ light
  private setLight(t: number, bp: number, kp: number) {
    const fl = 0.86 + 0.07 * Math.sin(t * 23.1) + 0.05 * Math.sin(t * 37.7 + 1.3) + 0.04 * noise2(t * 9, 0.5, 3);
    this.lf = {
      x: FX + 14 * Math.sin(t * 17.3) + 8 * noise2(t * 5, 1.5, 4),
      y: FY - 70 - 40 * bp,
      z: 240,
      R: 600 * (1 + 0.32 * bp + 0.1 * kp),
      k: fl * (1 + 0.55 * bp + 0.2 * kp) * (1 - 0.72 * ease.inOutCubic(clamp((t - (this.ctx.end - 0.36)) / 0.26))),
    };
  }
  /** Attenuated fire light at a wall point (height h out of the wall). */
  private att(x: number, y: number, h = 0) {
    const L = this.lf;
    const d2 = (x - L.x) ** 2 + (y - L.y) ** 2 + (L.z - h) ** 2;
    return L.k / (1 + d2 / (L.R * L.R));
  }
  /** Rock tone on the ramp from a light amount (soft saturation: never burns past lit limestone). */
  private tone(l: number) { return 0.25 + 2.05 * (1 - Math.exp(-l * 1.35)); }
  /** Pigment visibility: what the fire lets you see of the paint at (x, y). */
  private seen(x: number, y: number) { return clamp(0.18 + 1.25 * this.att(x, y)); }

  // ------------------------------------------------------------------ camera
  private camera(cam: Cam, lt: number): Camera {
    if (cam === 'wide') return { cx: 960, cy: 555 - 8 * lt, z: 1 + 0.025 * lt, rot: 0, cell: 60 };
    if (cam === 'panel') return { cx: 1420 - 60 * lt, cy: 395, z: 1.9, rot: -0.035, cell: 60 / 1.9 };
    if (cam === 'hand') return { cx: 438, cy: 600 - 6 * lt, z: 5.4 + 0.25 * lt, rot: 0.07, cell: 60 / 5.4 };
    // the camera tips down to the floor for the last spark (the exit onto wet clay)
    const tip = ease.inOutCubic(clamp((lt - 0.62) / 0.4));
    return { cx: 1450 + 14 * lt + 20 * tip, cy: 815 + 36 * lt + 130 * tip, z: 2.75, rot: -0.1 + 0.04 * tip, cell: 60 / 2.75 };
  }
  private apply(c: CanvasRenderingContext2D, k: Camera) {
    c.translate(W / 2, H / 2); c.rotate(k.rot); c.scale(k.z, k.z); c.translate(-k.cx, -k.cy);
  }
  /** World bbox the camera sees (with a margin). */
  private view(k: Camera) {
    const hw = (W / 2) / k.z, hh = (H / 2) / k.z;
    const cs = Math.abs(Math.cos(k.rot)), sn = Math.abs(Math.sin(k.rot));
    const ex = hw * cs + hh * sn, ey = hw * sn + hh * cs;
    return { x0: k.cx - ex, x1: k.cx + ex, y0: k.cy - ey, y1: k.cy + ey };
  }

  // ------------------------------------------------------------------ the wall
  private height(x: number, y: number) {
    return 70 * noise2(x / 330, y / 330, 11) + 28 * noise2(x / 128, y / 128, 12) + 11 * noise2(x / 52, y / 52, 13) + 4.5 * noise2(x / 21, y / 21, 14);
  }

  /** Faceted rock relief, each facet lit by the fire (Lambert x falloff); the floor below FLOOR is darker. */
  private rock(c: CanvasRenderingContext2D, k: Camera) {
    const v = this.view(k), s = k.cell;
    const i0 = Math.floor(v.x0 / s) - 1, i1 = Math.ceil(v.x1 / s) + 1, j0 = Math.floor(v.y0 / s) - 1, j1 = Math.ceil(v.y1 / s) + 1;
    const nx = i1 - i0 + 1, ny = j1 - j0 + 1;
    const key = Math.round(s * 10);
    const P: number[][] = [];
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const gi = i0 + i, gj = j0 + j;
      const x = (gi + 0.7 * (hash(gi, gj, key, 1) - 0.5)) * s, y = (gj + 0.7 * (hash(gi, gj, key, 2) - 0.5)) * s;
      P.push([x, y, this.height(x, y)]);
    }
    const L = this.lf;
    const tri = (a: number[], b: number[], d: number[], alb: number) => {
      const ux = b[0]! - a[0]!, uy = b[1]! - a[1]!, uz = b[2]! - a[2]!, vx = d[0]! - a[0]!, vy = d[1]! - a[1]!, vz = d[2]! - a[2]!;
      let nX = uy * vz - uz * vy, nY = uz * vx - ux * vz, nZ = ux * vy - uy * vx;
      if (nZ < 0) { nX = -nX; nY = -nY; nZ = -nZ; }
      const nl = Math.hypot(nX, nY, nZ) || 1;
      const cx = (a[0]! + b[0]! + d[0]!) / 3, cy = (a[1]! + b[1]! + d[1]!) / 3, cz = (a[2]! + b[2]! + d[2]!) / 3;
      const lx = L.x - cx, ly = L.y - cy, lz = L.z - cz, ll = Math.hypot(lx, ly, lz) || 1;
      const lam = Math.max(0, (nX * lx + nY * ly + nZ * lz) / (nl * ll));
      const floor = cy > FLOOR ? 0.5 : 1;
      const big = 0.82 + 0.32 * (noise2(cx / 420, cy / 420, 21) * 0.5 + 0.5);
      const val = this.tone(this.att(cx, cy, cz) * (0.7 + 0.3 * lam) * alb * floor * big);
      c.fillStyle = this.ramp(val);
      c.beginPath(); c.moveTo(a[0]!, a[1]!); c.lineTo(b[0]!, b[1]!); c.lineTo(d[0]!, d[1]!); c.closePath(); c.fill();
    };
    for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
      const a = P[j * nx + i]!, b = P[j * nx + i + 1]!, d = P[(j + 1) * nx + i]!, e = P[(j + 1) * nx + i + 1]!;
      const gi = i0 + i, gj = j0 + j;
      const alb = 0.98 + 0.03 * hash(gi, gj, key, 3);
      if (hash(gi, gj, key, 4) < 0.5) { tri(a, b, e, alb); tri(a, e, d, alb * 0.97); }
      else { tri(a, b, d, alb); tri(b, e, d, alb * 0.97); }
    }
    // flowstone: calcite runs down the wall in long soft bands, lighter or darker than the rock around them
    c.lineCap = 'round';
    for (let i = 0; i < 22; i++) {
      const x = -300 + hash(i, 41) * 2600, y0 = -200 + hash(i, 42) * 500, len = lerp(300, 900, hash(i, 43));
      if (x < v.x0 - 80 || x > v.x1 + 80 || y0 > v.y1 || y0 + len < v.y0) continue;
      const lit = this.tone(this.att(x, y0 + len / 2) * 0.8) + (hash(i, 44) < 0.5 ? 0.35 : -0.3);
      c.strokeStyle = this.ramp(lit, 0.22);
      c.lineWidth = lerp(14, 46, hash(i, 45));
      c.beginPath();
      for (let k = 0; k <= 8; k++) { const yy = y0 + (len * k) / 8, xx = x + 18 * Math.sin(k * 1.3 + i); if (k === 0) c.moveTo(xx, yy); else c.lineTo(xx, Math.min(yy, FLOOR - 20)); }
      c.stroke();
    }
    // the seam where the wall meets the floor: a soot shadow
    const sg = c.createLinearGradient(0, FLOOR - 30, 0, FLOOR + 14);
    sg.addColorStop(0, this.col('ground', 0));
    sg.addColorStop(0.7, this.col('ground', 0.75));
    sg.addColorStop(1, this.col('ground', 0.2));
    c.fillStyle = sg;
    c.fillRect(v.x0 - 50, FLOOR - 30, v.x1 - v.x0 + 100, 44);
  }

  /** The wet clay patch on the floor: darker, with the fire's sheen on it. */
  private clay(c: CanvasRenderingContext2D, t: number, hit: number) {
    const { x, y, rx, ry } = CLAY;
    c.fillStyle = this.ramp(0.25, 0.9);
    c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); c.fill();
    const sheen = clamp(0.25 + 1.4 * this.att(x, y)) * (0.55 + 0.45 * Math.sin(t * 11));
    c.fillStyle = this.ramp(2.6, 0.35 * sheen);
    c.beginPath(); c.ellipse(x - 30, y - 6, rx * 0.55, ry * 0.18, -0.02, 0, Math.PI * 2); c.fill();
    if (hit > 0) {
      c.strokeStyle = this.ramp(2.8, 0.7 * (1 - hit));
      c.lineWidth = 2.2;
      c.beginPath(); c.ellipse(x, y, 10 + 70 * hit, 2 + 12 * hit, 0, 0, Math.PI * 2); c.stroke();
    }
  }

  // ------------------------------------------------------------------ pigment
  private smooth(c: CanvasRenderingContext2D, pts: V[], x: number, y: number, w: number, flip: number) {
    const X = (p: V) => x + (p[0] - 0.5) * w * flip, Y = (p: V) => y + (p[1] - 0.35) * w;
    const n = pts.length;
    const m = (i: number): V => { const a = pts[i % n]!, b = pts[(i + 1) % n]!; return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; };
    c.beginPath();
    const s0 = m(n - 1);
    c.moveTo(X(s0), Y(s0));
    for (let i = 0; i < n; i++) { const p = pts[i]!, q = m(i); c.quadraticCurveTo(X(p), Y(p), X(q), Y(q)); }
    c.closePath();
  }
  private poly(c: CanvasRenderingContext2D, pts: V[], x: number, y: number, w: number, flip: number) {
    c.beginPath();
    pts.forEach((p, i) => { const X = x + (p[0] - 0.5) * w * flip, Y = y + (p[1] - 0.35) * w; if (i === 0) c.moveTo(X, Y); else c.lineTo(X, Y); });
    c.stroke();
  }

  /** One painted animal: ochre fill, charcoal contour, charcoal legs / horns. `ghost` = a faint second leg pose. */
  private animal(c: CanvasRenderingContext2D, o: {
    body: V[]; legs: V[][]; ghost?: V[][]; head?: V[]; extra?: V[][]; x: number; y: number; w: number; flip: number; fill: Role | null; fillMix?: number; bp: number;
  }) {
    const vis = this.seen(o.x, o.y);
    c.lineCap = 'round'; c.lineJoin = 'round';
    if (o.fill) {
      c.fillStyle = o.fillMix !== undefined ? pmix(this.P, 'mid', 'text', o.fillMix, 0.66 * vis) : this.col(o.fill, 0.66 * vis);
      this.smooth(c, o.body, o.x, o.y, o.w, o.flip); c.fill();
    }
    if (o.head) {
      // Lascaux: the head and the forequarters laid in charcoal over the ochre
      c.fillStyle = this.ramp(0.08, 0.72 * clamp(vis + 0.1));
      this.smooth(c, o.head, o.x, o.y, o.w, o.flip); c.fill();
    }
    const char = this.ramp(0.08, 0.9 * clamp(vis + 0.15));
    c.strokeStyle = char;
    c.lineWidth = o.w * (0.022 + 0.006 * o.bp);
    this.smooth(c, o.body, o.x, o.y, o.w, o.flip); c.stroke();
    if (o.ghost) {
      c.strokeStyle = this.ramp(0.08, 0.35 * vis);
      c.lineWidth = o.w * 0.036;
      for (const l of o.ghost) this.poly(c, l, o.x, o.y, o.w, o.flip);
    }
    c.strokeStyle = char;
    c.lineWidth = o.w * 0.042;
    for (const l of o.legs) this.poly(c, l, o.x, o.y, o.w, o.flip);
    c.lineWidth = o.w * 0.03;
    for (const l of o.extra ?? []) this.poly(c, l, o.x, o.y, o.w, o.flip);
  }

  /** The painted panel: a bull, two horses (one mid-gallop, its legs snapping pose on the beat), a stag. */
  private paintings(c: CanvasRenderingContext2D, t: number, bp: number) {
    const bi = Math.max(0, beatIndex(this.ctx.audio, t));
    const pose = bi % 2, other = 1 - pose;
    this.animal(c, { body: BULL, head: BULL_HEAD, legs: BULL_LEGS, extra: BULL_HORNS, x: 1470, y: 280, w: 430, flip: 1, fill: 'mid', bp });
    this.animal(c, { body: HORSE, head: HORSE_HEAD, legs: HORSE_LEGS[pose]!, ghost: HORSE_LEGS[other]!, extra: [HORSE_TAIL, HORSE_MANE], x: 1235, y: 450, w: 300, flip: 1, fill: 'mid', fillMix: 0.55, bp });
    this.animal(c, { body: HORSE, legs: HORSE_LEGS[other]!, extra: [HORSE_TAIL, HORSE_MANE], x: 1345, y: 505, w: 250, flip: 1, fill: null, bp });
    this.animal(c, { body: DEER, legs: DEER_LEGS, extra: ANTLERS, x: 1690, y: 470, w: 210, flip: -1, fill: 'mid', fillMix: 0.3, bp });
    // a row of old red dots under the bull (the signs were always there)
    c.fillStyle = this.col('mid', 0.7 * this.seen(1500, 590));
    for (let i = 0; i < 6; i++) { c.beginPath(); c.arc(1400 + i * 30, 590 + 3 * Math.sin(i * 2.1), 7, 0, Math.PI * 2); c.fill(); }
  }

  private handShape(c: CanvasRenderingContext2D, col: string, spread: number) {
    c.fillStyle = col; c.strokeStyle = col; c.lineCap = 'round'; c.lineJoin = 'round';
    // palm + wrist: one rounded outline, wider at the knuckles, narrowing to the wrist, the forearm fading out
    c.beginPath();
    c.moveTo(-0.36, -0.2);
    c.quadraticCurveTo(-0.02, -0.42, 0.34, -0.22);
    c.quadraticCurveTo(0.44, 0.1, 0.3, 0.42);
    c.quadraticCurveTo(0.24, 0.62, 0.26, 1.05);
    c.lineTo(-0.28, 1.05);
    c.quadraticCurveTo(-0.26, 0.6, -0.34, 0.42);
    c.quadraticCurveTo(-0.46, 0.1, -0.36, -0.2);
    c.closePath(); c.fill();
    // fingers: tapered, round tips, a slight bend at the middle joint
    for (const [bx, by, ang, len, w] of FINGERS) {
      const a = -Math.PI / 2 + (ang + Math.PI / 2) * spread;
      const ca = Math.cos(a), sa = Math.sin(a), px = -sa, py = ca;
      const mx = bx + ca * len * 0.5 + px * 0.02, my = by + sa * len * 0.5 + py * 0.02;
      const tx = bx + ca * len, ty = by + sa * len;
      const w0 = w * 0.55, w1 = w * 0.4;
      c.beginPath();
      c.moveTo(bx + px * w0, by + py * w0);
      c.quadraticCurveTo(mx + px * w * 0.5, my + py * w * 0.5, tx + px * w1, ty + py * w1);
      c.arc(tx, ty, w1, a + Math.PI / 2, a - Math.PI / 2, true);
      c.quadraticCurveTo(mx - px * w * 0.5, my - py * w * 0.5, bx - px * w0, by - py * w0);
      c.closePath(); c.fill();
    }
  }

  /** A hand on the wall. Negative: pigment sprayed around it, bare rock inside. Sprayed at h.t0 with a puff. */
  private hand(c: CanvasRenderingContext2D, h: Hand, t: number, bp: number) {
    const k = t - h.t0;
    if (k < 0) return;
    const fresh = Number.isFinite(h.t0);
    const pop = fresh ? ease.outCubic(clamp(k / 0.1)) : 1;
    const puff = fresh ? Math.exp(-k / 0.1) : 0;
    const vis = this.seen(h.x, h.y);
    const a = h.a * vis;
    const s = h.s;
    if (h.neg) {
      const R = s * (1.25 + 0.75 * pop) * (1 + 0.04 * bp);
      const g = c.createRadialGradient(h.x, h.y - 0.2 * s, s * 0.3, h.x, h.y - 0.2 * s, R);
      g.addColorStop(0, this.col('mid', 0.85 * a * pop));
      g.addColorStop(0.55, this.col('mid', 0.6 * a * pop));
      g.addColorStop(1, this.col('mid', 0));
      c.fillStyle = g;
      c.beginPath(); c.arc(h.x, h.y - 0.2 * s, R, 0, Math.PI * 2); c.fill();
      // splatter
      c.fillStyle = this.col('mid', 0.8 * a * pop);
      for (let i = 0; i < 26; i++) {
        const an = hash(h.x, i, 1) * Math.PI * 2, rr = s * lerp(1.05, 2.1, hash(h.x, i, 2)) * (0.7 + 0.3 * pop);
        c.beginPath(); c.arc(h.x + Math.cos(an) * rr, h.y - 0.2 * s + Math.sin(an) * rr, lerp(1.2, 3.6, hash(h.x, i, 3)) * s / 60, 0, Math.PI * 2); c.fill();
      }
    }
    c.save();
    c.translate(h.x, h.y); c.rotate(h.rot); c.scale(s, s);
    if (h.neg) {
      // bare rock inside the stencil (the local wall tone)
      this.handShape(c, this.ramp(this.tone(this.att(h.x, h.y) * 1.15) + 0.12, 0.95), h.spread);
    } else {
      this.handShape(c, this.col('mid', 0.85 * a), h.spread);
    }
    c.restore();
    if (puff > 0.01) {
      // the spray cloud catching the firelight
      const pg = c.createRadialGradient(h.x, h.y - 0.2 * s, 0, h.x, h.y - 0.2 * s, s * 2.4);
      pg.addColorStop(0, this.ramp(2.4, 0.22 * puff));
      pg.addColorStop(1, this.ramp(2.2, 0));
      const op = c.globalCompositeOperation;
      c.globalCompositeOperation = 'lighter';
      c.fillStyle = pg;
      c.beginPath(); c.arc(h.x, h.y - 0.2 * s, s * 2.4, 0, Math.PI * 2); c.fill();
      c.globalCompositeOperation = op;
    }
  }

  /** The shadow of the one at the fire, thrown huge on the wall; its arm snaps to each new hand. */
  private shadow(c: CanvasRenderingContext2D, t: number, bp: number) {
    const fresh = this.hands.filter((h) => Number.isFinite(h.t0) && h !== this.closeHand);
    let cur = fresh[0]!, prev = fresh[0]!;
    for (const h of fresh) if (h.t0 <= t) { prev = cur; cur = h; }
    const k = ease.outBack(clamp((t - cur.t0) / 0.12));
    const tx = lerp(prev.x, cur.x, k) - 28, ty = lerp(prev.y, cur.y, k) + 70;
    const wob = 1 + 0.03 * Math.sin(t * 19) - 0.04 * bp; // the shadow breathes with the flame
    const sx = 520, sy = 660;
    c.save();
    c.translate(sx, FLOOR); c.scale(wob, wob); c.translate(-sx, -FLOOR);
    const col = this.col('ground', 0.72);
    c.fillStyle = col; c.strokeStyle = col; c.lineCap = 'round'; c.lineJoin = 'round';
    // body
    c.beginPath();
    c.moveTo(sx - 210, FLOOR + 20); c.quadraticCurveTo(sx - 220, sy + 30, sx - 110, sy - 20);
    c.lineTo(sx + 90, sy - 20); c.quadraticCurveTo(sx + 200, sy + 30, sx + 190, FLOOR + 20); c.closePath(); c.fill();
    // head, turned to the wall
    c.beginPath(); c.ellipse(sx - 14, sy - 118, 78, 94, -0.18, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.moveTo(sx - 10, sy - 50); c.lineTo(sx - 10, sy); c.lineWidth = 84; c.stroke();
    // the arm to the new hand
    c.lineWidth = 66;
    c.beginPath(); c.moveTo(sx + 60, sy + 10); c.quadraticCurveTo(lerp(sx + 60, tx, 0.5) + 40, lerp(sy + 10, ty, 0.5) + 50, tx, ty); c.stroke();
    c.restore();
    c.save();
    c.translate(tx, ty); c.rotate(-0.45); c.scale(62 * wob, 62 * wob);
    this.handShape(c, col, 1.1);
    c.restore();
  }

  // ------------------------------------------------------------------ fire and sparks
  private fire(c: CanvasRenderingContext2D, t: number, bp: number, kp: number) {
    const op = c.globalCompositeOperation;
    // logs
    c.strokeStyle = this.col('ground', 1); c.lineCap = 'round';
    c.lineWidth = 16;
    c.beginPath(); c.moveTo(FX - 90, FY + 16); c.lineTo(FX + 70, FY - 8); c.moveTo(FX + 95, FY + 14); c.lineTo(FX - 60, FY - 10); c.stroke();
    // the glow on everything near it
    const R = 760 * (1 + 0.35 * bp);
    const g = c.createRadialGradient(FX, FY - 40, 0, FX, FY - 40, R);
    g.addColorStop(0, this.col('signal', 0.2 * (1 + 0.8 * bp)));
    g.addColorStop(0.3, this.col('signal', 0.06 * (1 + bp)));
    g.addColorStop(1, this.col('signal', 0));
    c.globalCompositeOperation = 'lighter';
    c.fillStyle = g;
    // hosted: the AMBER haze is the firelight (a clipped glow would print the frame's edge)
    if (!this.hosted) c.fillRect(FX - R, FY - 40 - R, 2 * R, 2 * R);
    // tongues of flame
    const tongue = (x: number, w: number, h: number, sway: number, col: string) => {
      c.fillStyle = col;
      c.beginPath();
      c.moveTo(x - w, FY);
      c.quadraticCurveTo(x - w * 0.9, FY - h * 0.55, x + sway, FY - h);
      c.quadraticCurveTo(x + w * 0.9, FY - h * 0.55, x + w, FY);
      c.closePath(); c.fill();
    };
    const up = 1 + 0.7 * bp + 0.25 * kp;
    for (let i = 0; i < 7; i++) {
      const x = FX + (i - 3) * 22 + 6 * Math.sin(t * 7 + i);
      const h = (lerp(90, 190, hash(i, 31)) * (0.75 + 0.35 * (noise2(t * 6 + i * 3.1, i, 32) * 0.5 + 0.5))) * up * (i === 3 ? 1.3 : 1);
      const sw = 26 * noise2(t * 4 + i, i * 2, 33);
      tongue(x, 40, h, sw, this.col('signal', 0.5));
      tongue(x, 24, h * 0.7, sw * 0.8, this.col('hi', 0.32));
      tongue(x, 12, h * 0.4, sw * 0.5, this.ramp(2.9, 0.3));
    }
    c.globalCompositeOperation = op;
  }

  private sparkPos(s: Spark, a: number, ox: number, oy: number, sc: number) {
    const rise = s.v * a * (1 - 0.32 * a);
    const drift = 22 * Math.sin(a * 5 + s.seed * 20) * a;
    return [ox + (Math.cos(s.ang) * rise + drift) * sc, oy + Math.sin(s.ang) * rise * sc] as const;
  }

  /** Sparks from (ox, oy): streaks along their path, brightest when young. `only` limits to bursts. */
  private drawSparks(c: CanvasRenderingContext2D, t: number, ox: number, oy: number, sc: number, only: 'all' | 'burst', width: number) {
    const op = c.globalCompositeOperation;
    c.globalCompositeOperation = 'lighter';
    c.lineCap = 'round';
    for (const s of this.sparks) {
      if (only === 'burst' && !s.burst) continue;
      const a = t - s.t0;
      if (a < 0 || a > s.life) continue;
      const life = 1 - a / s.life;
      const [x1, y1] = this.sparkPos(s, a, ox, oy, sc);
      const [x0, y0] = this.sparkPos(s, Math.max(0, a - (s.burst ? 0.07 : 0.04)), ox, oy, sc);
      c.strokeStyle = this.col('signal', 0.8 * life);
      c.lineWidth = width * (s.burst ? 1.4 : 1);
      c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke();
      c.strokeStyle = this.ramp(2.9, life);
      c.lineWidth = width * 0.45;
      c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke();
    }
    c.globalCompositeOperation = op;
  }

  /** The first marks: sparks fly from the fire to the rock; where they strike, a red dot or stroke stays. */
  private drawMarks(c: CanvasRenderingContext2D, t: number) {
    const op = c.globalCompositeOperation;
    for (const m of this.marks) {
      const k = t - m.te;
      if (k < 0) continue;
      const pop = 1 + 0.7 * Math.exp(-k / 0.06);
      const a = 0.92 * this.seen(m.x, m.y) + 0.08;
      c.fillStyle = this.col('mid', a); c.strokeStyle = this.col('mid', a); c.lineCap = 'round';
      if (m.kind === 'dot') { c.beginPath(); c.ellipse(m.x, m.y, m.r * pop, m.r * 0.85 * pop, 0.3, 0, Math.PI * 2); c.fill(); }
      else { c.lineWidth = 8 * pop; c.beginPath(); c.moveTo(m.x, m.y - m.r / 2 * pop); c.lineTo(m.x + 3, m.y + m.r / 2 * pop); c.stroke(); }
    }
    c.globalCompositeOperation = 'lighter';
    c.lineCap = 'round';
    for (const f of this.markShots) {
      const k = t - f.te;
      if (k < -0.2 || k > 0.25) continue;
      if (k < 0) {
        // in flight: an arc from the fire
        const u = 1 + k / 0.2, u0 = Math.max(0, u - 0.18);
        const at = (q: number) => [lerp(FX, f.x, q), lerp(FY - 60, f.y, q) - 170 * Math.sin(Math.PI * q) * (1 - q * 0.4)] as const;
        const [x0, y0] = at(u0), [x1, y1] = at(u);
        c.strokeStyle = this.col('signal', 0.9); c.lineWidth = 5;
        c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke();
        c.strokeStyle = this.ramp(2.95, 1); c.lineWidth = 2;
        c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke();
      } else {
        // the strike
        const e = Math.exp(-k / 0.07);
        const g = c.createRadialGradient(f.x, f.y, 0, f.x, f.y, 46);
        g.addColorStop(0, this.ramp(3, 0.9 * e));
        g.addColorStop(1, this.ramp(2.5, 0));
        c.fillStyle = g;
        c.beginPath(); c.arc(f.x, f.y, 46, 0, Math.PI * 2); c.fill();
      }
    }
    c.globalCompositeOperation = op;
  }

  /** The exit: one last spark falls onto the wet clay. Returns the landing ripple (0..1, 0 before landing). */
  private lastSpark(c: CanvasRenderingContext2D, t: number): number {
    const t1 = this.ctx.end - 0.1, t0 = t1 - 0.34;
    if (t < t0) return 0;
    const u = clamp((t - t0) / (t1 - t0));
    const x = lerp(1512, CLAY.x + 6, u), y = lerp(640, CLAY.y - 2, ease.inQuad(u));
    const op = c.globalCompositeOperation;
    c.globalCompositeOperation = 'lighter';
    if (u < 1) {
      const py = lerp(640, CLAY.y - 2, ease.inQuad(Math.max(0, u - 0.08)));
      c.strokeStyle = this.col('signal', 0.95); c.lineWidth = 6; c.lineCap = 'round';
      c.beginPath(); c.moveTo(x - 3, py); c.lineTo(x, y); c.stroke();
      c.strokeStyle = this.ramp(3, 1); c.lineWidth = 2.5;
      c.beginPath(); c.moveTo(x - 3, py); c.lineTo(x, y); c.stroke();
    } else {
      // the hiss: a dying ember on the wet clay
      const e = Math.exp(-(t - t1) / 0.08);
      const g = c.createRadialGradient(x, y, 0, x, y, 30);
      g.addColorStop(0, this.col('signal', 0.9 * e + 0.15));
      g.addColorStop(1, this.col('signal', 0));
      c.fillStyle = g;
      c.beginPath(); c.arc(x, y, 30, 0, Math.PI * 2); c.fill();
    }
    c.globalCompositeOperation = op;
    return t > t1 ? clamp((t - t1) / 0.12) : 0;
  }

  // ------------------------------------------------------------------ render
  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, audio } = this.ctx;
    const t = f.t;
    const st = stateAt(this.list, t);
    const sh = shotAt(this.list, t);
    const cam = st.cam as Cam;
    const lt = t - sh.t0;
    const L = this.layer, c = L.ctx;
    if (this.hosted) L.clear(); else L.clear(pcss(this.P, 'ground'));
    const bp = beatPulse(audio, t, 0.14), kp = kickPulse(audio, t, 0.12), dp = downbeatPulse(audio, t, 0.25);
    this.setLight(t, bp, kp);
    const k = this.camera(cam, lt);

    c.save();
    // hosted: the host scales this frame down, so keep a transparent 4 px border (the edge texels clamp outward)
    if (this.hosted) { c.beginPath(); c.rect(4, 4, W - 8, H - 8); c.clip(); }
    this.apply(c, k);
    if (!this.hosted) this.rock(c, k);
    // hosted: the clay patch would float over the host's fire (the cave floor is not drawn) — the host owns the ground
    if (!this.hosted && (cam === 'wide' || cam === 'marks')) this.clay(c, t, cam === 'marks' ? this.lastSparkHit(t) : 0);
    if (cam !== 'hand' && !this.hosted) this.paintings(c, t, bp);
    for (const h of this.hands) if (h !== this.closeHand || cam === 'hand' || cam === 'marks') this.hand(c, h, t, bp);
    if (cam === 'wide') this.shadow(c, t, bp);
    if (cam === 'marks') this.drawMarks(c, t);
    if (cam !== 'hand') { this.fire(c, t, bp, kp); this.drawSparks(c, t, FX, FY - 30, 1, 'all', 4); }
    if (cam === 'marks') this.lastSpark(c, t);
    c.restore();
    if (cam === 'hand') {
      // the fire is below the frame: its light floods up from the bottom edge, the sparks fly up across the hand
      const op = c.globalCompositeOperation;
      c.globalCompositeOperation = 'lighter';
      const g = c.createLinearGradient(0, H, 0, H * 0.35);
      g.addColorStop(0, this.col('signal', 0.12 * (1 + 0.9 * bp)));
      g.addColorStop(1, this.col('signal', 0));
      c.fillStyle = g;
      if (!this.hosted) c.fillRect(0, 0, W, H);
      c.globalCompositeOperation = op;
      this.drawSparks(c, t, 1010, H + 60, 1.5, 'all', 10);
    }

    L.upload();
    clearRT(renderer, out, this.hosted ? [0, 0, 0] : plin(this.P, 'ground'), this.hosted ? 0 : 1);
    this.ctx.comp.draw(renderer, L.texture, out, { mode: 'normal' });

    // hits: a push-in and an exposure punch on every cut (the drop cut flashes: storyboard D1), the firelight
    // swelling on the kick, a jolt on the downbeat
    const cut = sh.index > 0 ? Math.exp(-lt / 0.1) : 0;
    const drop = cam === 'hand' ? cut : 0;
    const sd = hash(Math.floor(f.bar), 5) * Math.PI * 2;
    const jolt = cam === 'hand' ? 10 : 6;
    return {
      exposure: 1 + 0.12 * kp + 0.08 * bp + 0.2 * cut,
      flash: 0.06 * drop,
      zoom: 1 + 0.06 * cut + 0.022 * bp,
      shake: [Math.cos(sd) * jolt * dp, Math.sin(sd) * jolt * dp],
      bloom: 0.4,
      bloomThreshold: 0.7,
      ca: 0,
      grain: 0.07,
      vignette: 0.5,
    };
  }

  /** The ripple of the last spark on the clay (0 until it lands). */
  private lastSparkHit(t: number) {
    const t1 = this.ctx.end - 0.1;
    return t > t1 ? clamp((t - t1) / 0.12) : 0;
  }

  override dispose() { this.layer?.texture.dispose(); }
}
