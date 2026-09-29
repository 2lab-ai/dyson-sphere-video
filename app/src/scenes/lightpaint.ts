// LIGHTPAINT — long-exposure light painting after Gjon Mili's 1949 LIFE session with Picasso: a black studio, a
// strobe-lit figure, and a pen of light whose whole path stays on the film. Time is the subject and the medium:
// every trail is the pen's position integrated over the open shutter, computed analytically (no accumulation
// buffer): a trail point drawn at song time τ is on the film for every t >= τ, so each frame redraws the path up
// to the pen head, with the last ~0.2 s "hot" (white core, sparkler head) and older light settling warmer.
//
// variant `time` (p08), driven by stateAt() of ./lightpaint.shots:
//   wide  (34.24)  black studio, the flash-lit figure behind the frame; on beat 1 the pen swings the first trail
//                  out of the figure's hand across the top of frame to where the line will start.
//   track (34.98)  the camera rides the pen head as it writes line 8 in light: each syllable's real glyph outline
//                  (Do Hyeon contours, hand-wobbled, in rough jamo order) is traced during exactly that syllable;
//                  the pen stays lit between contours and letters, so thin hop lines join them as in a real exposure.
//   flat  (36.57)  the full exposure, frontal: the whole line and the surviving gestures at once, the figure a
//                  smear of ghosts along the path it walked; a focal-plane curtain closes the shutter to black.
// Beat: every beat the pen adds one gesture (entry swoop, a lasso around the line, an underline wave, a whirl,
// an infinity sign, a rising swash) and the oldest of the five on the film fades out; the studio strobe fires on
// every beat (harder on downbeats), lighting the figure. Colour: the `lightpaint` palette only.
import type * as THREE from 'three';
import { Scene, type Frame, type PostOverrides } from '../engine/scene';
import { Layer2D, clearRT, W, H } from '../engine/gl';
import { palette, pcss, plin, pmix, type NamedPalette } from '../engine/palette';
import { drawLyric, ownedLines, layoutLine, F, type LineLayout, type CharState } from '../engine/lyric';
import { beatPulse, kickPulse, downbeatPulse } from '../engine/beat';
import { stateAt, shotAt, type PlateInfo, type Shot } from '../engine/shots';
import { ot } from '../engine/type';
import { hash, clamp, lerp, smoothstep, ease, noise1, TAU } from '../engine/util';
import type { Line, Word } from '../engine/lyrics';
import { shots } from './lightpaint.shots';

type Pt = { x: number; y: number };
type Aff = [number, number, number, number, number, number];
const FAM = F.hangul();
const SIZE = 150;
const ROT = 0.04;
const KEEP = 4; // gestures on the film at once: the 5th fades the oldest

// ------------------------------------------------------------------ pen paths
/** A pen path: uniformly resampled polyline (index ~ arclength) with hop flags (segment i-1 -> i is a pen move). */
interface PenPath { x: Float32Array; y: Float32Array; hop: Uint8Array; n: number }

const STEP = 0.011; // em per sample
const glyphCache = new Map<string, PenPath | null>();

function contoursOf(ch: string): Pt[][] {
  const cmds = ot(FAM).charToGlyph(ch).getPath(0, 0, 1).commands;
  const polys: Pt[][] = [];
  let cur: Pt[] = [], px = 0, py = 0;
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
    } else if (c.type === 'Z') { if (cur.length > 2) { cur.push({ ...cur[0]! }); polys.push(cur); } cur = []; }
  }
  if (cur.length > 2) polys.push(cur);
  return polys;
}

/** Resample a polyline at STEP; returns points (first included). */
function resample(poly: Pt[], step: number): Pt[] {
  const out: Pt[] = [poly[0]!];
  let carry = 0;
  for (let i = 1; i < poly.length; i++) {
    const a = poly[i - 1]!, b = poly[i]!;
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    let s = step - carry;
    while (s <= d) { const u = s / d; out.push({ x: lerp(a.x, b.x, u), y: lerp(a.y, b.y, u) }); s += step; }
    carry = d - (s - step);
  }
  const last = poly[poly.length - 1]!;
  if (Math.hypot(last.x - out[out.length - 1]!.x, last.y - out[out.length - 1]!.y) > step * 0.3) out.push(last);
  return out;
}

/** Join polylines into one pen path; the moves between them are resampled hops. */
function penPath(polys: Pt[][], step: number): PenPath {
  const xs: number[] = [], ys: number[] = [], hop: number[] = [];
  polys.forEach((p, k) => {
    const r = resample(p, step);
    if (k > 0) {
      const a = { x: xs[xs.length - 1]!, y: ys[ys.length - 1]! };
      const h = resample([a, r[0]!], step);
      for (let i = 1; i < h.length; i++) { xs.push(h[i]!.x); ys.push(h[i]!.y); hop.push(1); }
    }
    r.forEach((q, i) => { xs.push(q.x); ys.push(q.y); hop.push(k > 0 && i === 0 ? 1 : 0); });
  });
  return { x: Float32Array.from(xs), y: Float32Array.from(ys), hop: Uint8Array.from(hop), n: xs.length };
}

/** A syllable glyph as one hand-drawn pen path, em units (y down, baseline 0), contours in rough jamo order. */
function glyphPen(ch: string): PenPath | null {
  if (glyphCache.has(ch)) return glyphCache.get(ch)!;
  let polys = contoursOf(ch);
  if (!polys.length) { glyphCache.set(ch, null); return null; }
  const box = (p: Pt[]) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const q of p) { x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x); y1 = Math.max(y1, q.y); }
    return { x0, y0, x1, y1, a: (x1 - x0) * (y1 - y0) };
  };
  let gy0 = Infinity, gy1 = -Infinity;
  for (const p of polys) { const b = box(p); gy0 = Math.min(gy0, b.y0); gy1 = Math.max(gy1, b.y1); }
  // holes follow their outer contour; outers: top band left -> right, then the bottom band (the final consonant)
  const info = polys.map((p) => ({ p, b: box(p) }));
  const outers = info.filter((o) => !info.some((q) => q !== o && q.b.a > o.b.a && q.b.x0 <= o.b.x0 && q.b.y0 <= o.b.y0 && q.b.x1 >= o.b.x1 && q.b.y1 >= o.b.y1));
  const key = (o: { b: { x0: number; y0: number } }) => (o.b.y0 > gy0 + (gy1 - gy0) * 0.55 ? 10 : 0) + o.b.x0 + o.b.y0 * 0.35;
  outers.sort((a, b) => key(a) - key(b));
  const ordered: Pt[][] = [];
  for (const o of outers) {
    ordered.push(o.p);
    for (const h of info) if (!outers.includes(h) && h.b.x0 >= o.b.x0 && h.b.y0 >= o.b.y0 && h.b.x1 <= o.b.x1 && h.b.y1 <= o.b.y1) ordered.push(h.p);
  }
  for (const h of info) if (!ordered.includes(h.p)) ordered.push(h.p);
  polys = ordered;
  const pp = penPath(polys, STEP);
  // the hand: a slow drift plus a fine tremor, along x and y independently (deterministic per glyph)
  const seed = ch.codePointAt(0)! % 997;
  for (let i = 0; i < pp.n; i++) {
    const s = i * STEP;
    pp.x[i]! += 0.013 * noise1(s * 2.2, seed) + 0.004 * noise1(s * 14, seed + 3);
    pp.y[i]! += 0.013 * noise1(s * 2.2, seed + 7) + 0.004 * noise1(s * 14, seed + 11);
  }
  glyphCache.set(ch, pp);
  return pp;
}

/** A free gesture: f(u) for u in 0..1, in line-local px, wobbled; n samples. */
function gesture(n: number, seed: number, f: (u: number) => Pt): PenPath {
  const xs = new Float32Array(n), ys = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1), p = f(u);
    xs[i] = p.x + 9 * noise1(u * 7, seed) + 2.5 * noise1(u * 60, seed + 1);
    ys[i] = p.y + 9 * noise1(u * 7, seed + 2) + 2.5 * noise1(u * 60, seed + 3);
  }
  return { x: xs, y: ys, hop: new Uint8Array(n), n };
}

// ------------------------------------------------------------------ drawing light
interface Glow { halo: number; glow: number; core: number; warm: number; w: number }

/** Stroke samples [i0, i1] of a pen path (scaled by s) as light: halo, glow, white core. Hops: one thin dim line. */
function light(c: CanvasRenderingContext2D, P: NamedPalette, pp: PenPath, s: number, i0: number, i1: number, g: Glow) {
  const a = Math.max(0, Math.floor(i0)), b = Math.min(pp.n - 1, Math.ceil(i1));
  if (b <= a) return;
  const path = (hops: boolean) => {
    c.beginPath();
    let open = false;
    for (let i = a; i <= b; i++) {
      const isHop = i > a && pp.hop[i] === 1;
      const x = pp.x[i]! * s, y = pp.y[i]! * s;
      if (isHop !== hops) { open = false; continue; }
      if (!open) {
        if (i > a) { c.moveTo(pp.x[i - 1]! * s, pp.y[i - 1]! * s); c.lineTo(x, y); } else c.moveTo(x, y);
        open = true;
      } else c.lineTo(x, y);
    }
  };
  path(false);
  if (g.halo > 0) { c.strokeStyle = pcss(P, 'mid', g.halo); c.lineWidth = 15 * g.w; c.stroke(); }
  if (g.glow > 0) { c.strokeStyle = pmix(P, 'hi', 'mid', g.warm, g.glow); c.lineWidth = 6.5 * g.w; c.stroke(); }
  if (g.core > 0) { c.strokeStyle = pmix(P, 'text', 'hi', g.warm * 0.8, g.core); c.lineWidth = 2.2 * g.w; c.stroke(); }
  path(true);
  if (g.glow > 0) { c.strokeStyle = pcss(P, 'hi', g.glow * 0.55); c.lineWidth = 1.3 * g.w; c.stroke(); }
}

/** The sparkler at the pen head: white core, amber bloom, a burst of short sparks (deterministic per 1/30 s). */
function sparkler(c: CanvasRenderingContext2D, P: NamedPalette, x: number, y: number, amp: number, t: number, seed: number) {
  if (amp <= 0.01) return;
  const R = 46 * (0.7 + 0.3 * amp);
  const g = c.createRadialGradient(x, y, 0, x, y, R);
  g.addColorStop(0, pcss(P, 'text', amp));
  g.addColorStop(0.1, pcss(P, 'hi', 0.9 * amp));
  g.addColorStop(0.35, pcss(P, 'mid', 0.3 * amp));
  g.addColorStop(1, pcss(P, 'mid', 0));
  c.fillStyle = g;
  c.beginPath(); c.arc(x, y, R, 0, TAU); c.fill();
  const fr = Math.floor(t * 30);
  c.lineCap = 'round';
  for (let k = 0; k < 16; k++) {
    const an = hash(fr, k, seed) * TAU, r0 = 6 + 10 * hash(fr, k, seed + 1), len = 14 + 48 * hash(fr, k, seed + 2) ** 2;
    c.strokeStyle = pmix(P, 'text', 'hi', hash(fr, k, seed + 3), amp * (0.35 + 0.6 * hash(fr, k, seed + 4)));
    c.lineWidth = 1.1 + 1.2 * hash(fr, k, seed + 5);
    c.beginPath();
    c.moveTo(x + Math.cos(an) * r0, y + Math.sin(an) * r0);
    c.lineTo(x + Math.cos(an) * (r0 + len), y + Math.sin(an) * (r0 + len) + 0.004 * len * len);
    c.stroke();
  }
}

const affine = (s: number, rot: number, fx: number, fy: number, cx = W / 2, cy = H / 2): Aff => {
  const a = s * Math.cos(rot), b = s * Math.sin(rot);
  return [a, b, -b, a, cx - (a * fx - b * fy), cy - (b * fx + a * fy)];
};

function sylWin(line: Line, st: CharState): [number, number] {
  const w: Word = line.words[st.word]!;
  const s = w.syl && w.syl.length ? w.syl : ([[w.start, w.end]] as [number, number][]);
  return s[Math.min(st.syl, s.length - 1)]!;
}

// ------------------------------------------------------------------ scene
export default class Lightpaint extends Scene {
  private L!: Layer2D;
  private P!: NamedPalette;
  private list: Shot[] = [];
  private plate!: PlateInfo;
  private line!: Line;
  private lay!: LineLayout;
  private beats: number[] = [];
  private downs: number[] = [];
  private gest: PenPath[] = [];
  /** Per character: syllable window and centre x (line-local). */
  private cw: { a0: number; a1: number; cx: number; x0: number; x1: number }[] = [];

  override init() {
    this.plate = this.ctx.params as PlateInfo;
    this.P = palette(this.ctx.params.look?.palette ?? 'lightpaint');
    this.list = shots(this.plate, this.ctx.audio);
    this.line = ownedLines(this.ctx)[0]!;
    this.L = new Layer2D();
    const au = this.ctx.audio;
    this.beats = au.beats.filter((b) => b >= this.ctx.start - 1e-3 && b < this.ctx.end - 1e-3);
    this.downs = au.downbeats.filter((b) => b >= this.ctx.start - 1e-3 && b < this.ctx.end - 1e-3);
    this.lay = layoutLine(this.L.ctx, this.line, FAM, SIZE, 1560);
    const lay = this.lay, ox = -lay.width / 2;
    for (const b of lay.chars) {
      const w = this.line.words[b.word]!;
      const s = w.syl && w.syl.length ? w.syl : ([[w.start, w.end]] as [number, number][]);
      const [a0, a1] = s[Math.min(b.syl, s.length - 1)]!;
      this.cw.push({ a0, a1, cx: ox + b.x + b.w / 2, x0: ox + b.x, x1: ox + b.x + b.w });
      if (/[가-힣]/.test(b.ch)) glyphPen(b.ch);
    }
    // the gestures, one per beat (line-local px: origin = baseline centre, glyph middle at y ~ -0.36 SIZE)
    const hw = lay.width / 2, my = -SIZE * 0.36, N = 260;
    const hand = this.handAt(this.ctx.start);
    const G: ((u: number) => Pt)[] = [
      // 0: out of the figure's hand, a big arc over the top of frame, landing where the line starts
      (u) => {
        const p0 = hand, p1 = { x: hw * 0.9, y: -520 }, p2 = { x: -hw * 0.6, y: -560 }, p3 = { x: -hw - 40, y: my };
        const v = 1 - u;
        return { x: v * v * v * p0.x + 3 * v * v * u * p1.x + 3 * v * u * u * p2.x + u * u * u * p3.x, y: v * v * v * p0.y + 3 * v * v * u * p1.y + 3 * v * u * u * p2.y + u * u * u * p3.y };
      },
      // 1: a lasso round the whole line (a clock face), overshooting its own start
      (u) => { const a = Math.PI + u * TAU * 1.12; const r = 1 + 0.06 * Math.sin(u * 9); return { x: Math.cos(a) * (hw + 120) * r, y: my + Math.sin(a) * 200 * r }; },
      // 2: an underline wave, damping out to the right
      (u) => ({ x: lerp(-hw - 70, hw + 70, u), y: 95 + 34 * Math.sin(u * 3.5 * TAU) * (1 - 0.6 * u) }),
      // 3: a whirl, top left, spiralling out
      (u) => { const a = u * TAU * 2.3; const r = 12 + 120 * u; return { x: -hw * 0.55 + Math.cos(a) * r * 1.25, y: -330 + Math.sin(a) * r }; },
      // 4: an infinity sign above the right half
      (u) => { const a = u * TAU * 1.02 - Math.PI / 2; const d = 1 + Math.sin(a) ** 2; return { x: hw * 0.4 + (230 * Math.cos(a)) / d, y: -320 + (140 * Math.sin(a) * Math.cos(a)) / d }; },
      // 5: a rising swash from under the line out past its end
      (u) => ({ x: lerp(-hw * 0.5, hw + 170, u), y: lerp(260, -340, ease.inCubic(u)) + 60 * Math.sin(u * Math.PI) }),
    ];
    this.gest = G.map((f, k) => gesture(N, 40 + k * 13, f));
  }

  /** Where the figure's pen hand rests at the plate start (line-local). */
  private handAt(_t: number): Pt { return { x: this.lay.width * 0.21 - 361, y: -380 }; }

  /** Line-local x of the pen as the voice moves along the line (continuous: char centres interpolated by time). */
  private penX(t: number): number {
    const cw = this.cw;
    if (!cw.length) return 0;
    if (t <= cw[0]!.a0) return cw[0]!.x0;
    for (let i = 0; i < cw.length; i++) {
      const c = cw[i]!, nx = cw[i + 1];
      if (t < c.a1) return lerp(c.x0, c.x1, clamp((t - c.a0) / Math.max(1e-3, c.a1 - c.a0)));
      if (nx && t < nx.a0) return lerp(c.x1, nx.x0, clamp((t - c.a1) / Math.max(1e-3, nx.a0 - c.a1)));
    }
    return cw[cw.length - 1]!.x1;
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const L = this.L, c = L.ctx, P = this.P, au = this.ctx.audio, t = f.t;
    L.clear();
    const st = stateAt(this.list, t), frame = st.frame as string;
    const sh = shotAt(this.list, t);
    const lay = this.lay, hw = lay.width / 2, my = -SIZE * 0.36;
    const bp = beatPulse(au, t, 0.14), kp = kickPulse(au, t, 0.12), dp = downbeatPulse(au, t, 0.22);

    // ---- camera (maps line-local coordinates to the screen)
    const u = clamp((t - sh.t0) / Math.max(0.1, (sh.t1 === Infinity ? this.ctx.end : sh.t1) - sh.t0));
    let M: Aff;
    if (frame === 'wide') {
      M = affine(0.7 + 0.06 * ease.inOutQuad(u), 0.012, 120 - 40 * u, -150);
    } else if (frame === 'track') {
      const px = this.penX(t + 0.12);
      M = affine(1.5 + 0.08 * u, -0.045, clamp(px - 60, -hw + 480, hw - 420), my - 10);
    } else {
      M = affine(0.84, 0, 0, -70 - 14 * u);
    }
    const sc = Math.hypot(M[0], M[1]);
    const setM = () => {
      c.setTransform(M[0], M[1], M[2], M[3], M[4], M[5]);
      c.rotate(ROT);
    };

    // ---- bokeh: out-of-focus practicals in the studio, parallax at half the camera
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalCompositeOperation = 'lighter';
    for (let k = 0; k < 9; k++) {
      const bx = hash(k, 1) * 2600 - 340, by = hash(k, 2) * 1400 - 160;
      const x = bx + (M[4] - W / 2) * 0.35, y = by + (M[5] - H / 2) * 0.35;
      const r = (12 + 34 * hash(k, 3)) * (0.7 + 0.5 * sc);
      const a = (0.02 + 0.035 * hash(k, 4)) * (1 + 1.2 * kp);
      c.fillStyle = pcss(P, k % 3 === 0 ? 'hi' : 'mid', a);
      c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill();
      c.strokeStyle = pcss(P, 'hi', a * 0.9); c.lineWidth = 1.5;
      c.stroke();
    }

    // ---- the figure: strobe-lit on every beat; in the full exposure a smear of ghosts along its walk
    c.globalCompositeOperation = 'source-over';
    setM();
    const strobe = 0.16 + 0.84 * Math.max(bp, dp);
    const figX = (tt: number) => clamp(this.pen(tt - 0.25).x + 380, -hw + 200, hw + 360);
    const ghosts = frame === 'flat' ? 9 : frame === 'track' ? 2 : 1;
    for (let g = ghosts - 1; g >= 0; g--) {
      // the full exposure: the figure over its last 0.4 s of walking, overlapping dim ghosts = a smear
      const tg = frame === 'flat' ? t - 0.4 * (g / (ghosts - 1)) : t - g * 0.2;
      const a = frame === 'flat' ? 0.26 : frame === 'track' ? (g === 0 ? 0.6 : 0.25) : 1;
      this.figure(c, figX(tg), this.pen(tg), a, strobe);
    }

    // ---- the gestures: one per beat, drawn in 0.32 s behind a sparkler head; the 5th fades the oldest
    c.globalCompositeOperation = 'lighter';
    c.lineCap = 'round'; c.lineJoin = 'round';
    this.beats.forEach((b, k) => {
      if (t < b) return;
      const gp = this.gest[k % this.gest.length]!;
      const prog = ease.outCubic(clamp((t - b) / 0.32));
      const kill = this.beats[k + KEEP];
      const alive = kill === undefined ? 1 : 1 - smoothstep(kill, kill + 0.4, t);
      if (alive <= 0.01) return;
      const age = t - b;
      const head = prog * (gp.n - 1);
      const hot = 1 - smoothstep(0.3, 0.6, age);
      const flare = 1 + 0.5 * kp;
      light(c, P, gp, 1, 0, head, { halo: 0.1 * alive * flare, glow: 0.42 * alive * flare, core: 0.55 * alive, warm: smoothstep(0.3, 2, age), w: 1.05 / Math.sqrt(sc) });
      if (hot > 0) {
        const tail = head - (gp.n - 1) * 0.16;
        light(c, P, gp, 1, tail, head, { halo: 0.18 * hot, glow: 0.5 * hot, core: 0.9 * hot, warm: 0, w: 1.5 / Math.sqrt(sc) });
        const i = Math.min(gp.n - 1, Math.round(head));
        sparkler(c, P, gp.x[i]!, gp.y[i]!, hot * (prog < 1 ? 1 : 0.5), t, 50 + k);
      }
    });

    // ---- line 8, written in light: each syllable's outline traced during exactly that syllable
    const penHead: { p: Pt | null } = { p: null };
    // the hop between letters: the pen stays lit while it travels to the next letter
    for (let i = 1; i < this.cw.length; i++) {
      const a = this.cw[i - 1]!, b = this.cw[i]!;
      if (t < b.a0) break;
      const ch0 = lay.chars[i - 1]!.ch, ch1 = lay.chars[i]!.ch;
      const g0 = glyphPen(ch0), g1 = glyphPen(ch1);
      if (!g0 || !g1) continue;
      const e = { x: a.x0 + g0.x[g0.n - 1]! * SIZE, y: g0.y[g0.n - 1]! * SIZE };
      const s = { x: b.x0 + g1.x[0]! * SIZE, y: g1.y[0]! * SIZE };
      const k = clamp((t - b.a0) / 0.06);
      c.strokeStyle = pcss(P, 'hi', 0.32);
      c.lineWidth = 1.4 / Math.sqrt(sc);
      c.beginPath(); c.moveTo(e.x, e.y);
      c.quadraticCurveTo((e.x + s.x) / 2, Math.min(e.y, s.y) - 40 - 30 * hash(i, 9), lerp(e.x, s.x, k), lerp(e.y, s.y, k));
      c.stroke();
    }
    drawLyric(c, this.line, t, {
      x: 0, y: 0, size: lay.size, family: FAM, align: 'center', lead: 0, unsungAlpha: 0, maxWidth: 1560,
      drawChar: (cc, ch, s) => {
        const [a0, a1] = sylWin(this.line, s);
        const pp = /[가-힣]/.test(ch) ? glyphPen(ch) : null;
        if (!pp) return;
        const rev = clamp(s.frac) * (pp.n - 1);
        const age = t - a1;
        const hot = 1 - smoothstep(0.02, 0.3, age);
        const flare = 1 + 0.45 * kp;
        light(cc, P, pp, lay.size, 0, rev, {
          halo: 0.12 * flare, glow: 0.5 * flare, core: 0.95 - 0.25 * smoothstep(0.4, 2.2, age), warm: smoothstep(0.2, 2.2, age), w: 1.0 / Math.sqrt(sc),
        });
        if (hot > 0) {
          const span = (pp.n - 1) * Math.min(1, 0.2 / Math.max(0.05, a1 - a0));
          light(cc, P, pp, lay.size, rev - span, rev, { halo: 0.2 * hot, glow: 0.55 * hot, core: hot, warm: 0, w: 1.6 / Math.sqrt(sc) });
          const i = Math.min(pp.n - 1, Math.round(rev));
          // glyph-local -> line-local: drawLyric placed this glyph at its box (no char transform)
          penHead.p = { x: -hw + s.box.x + pp.x[i]! * lay.size, y: pp.y[i]! * lay.size };
        }
      },
    });
    if (penHead.p) sparkler(c, P, penHead.p.x, penHead.p.y, 1, t, 7);

    // ---- exit: a focal-plane curtain closes the shutter over the last 0.22 s
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalCompositeOperation = 'source-over';
    const close = ease.inQuad(clamp((t - (this.ctx.end - 0.22)) / 0.2));
    if (close > 0) {
      c.fillStyle = pcss(P, 'ground', 1);
      c.fillRect(0, 0, W, H * close);
      c.fillStyle = pcss(P, 'hi', 0.5 * (1 - close));
      c.fillRect(0, H * close - 2, W, 3);
    }

    L.upload();
    clearRT(this.ctx.renderer, out, plin(P, 'ground'));
    this.ctx.comp.draw(this.ctx.renderer, L.texture, out, { mode: 'normal' });

    // ---- hits: the studio strobe on beats (harder on downbeats and on the cuts), a punch-in on the downbeat
    const cut = this.list.slice(1).reduce((m, s) => Math.max(m, t >= s.t ? Math.exp(-(t - s.t) / 0.09) : 0), 0);
    return {
      bloom: 0.85, bloomThreshold: 0.55, bloomRadius: 0.8, halation: 0.35, ca: 0.8, grain: 0.06, vignette: 0.45,
      flash: 0.02 * bp + 0.05 * dp + 0.06 * cut,
      zoom: 1 + 0.018 * bp + 0.035 * dp + 0.05 * cut,
      shake: [2.5 * dp * Math.sin(t * 91), 2.5 * dp * Math.cos(t * 77)],
    };
  }

  /** The pen tip (line-local): the entry swoop's head until the first syllable, then the writing head. */
  private pen(t: number): Pt {
    const a0 = this.cw[0]?.a0 ?? this.ctx.end, b0 = this.beats[0] ?? this.ctx.start;
    const g = this.gest[0]!;
    if (t < a0) {
      const i = Math.round(ease.outCubic(clamp((t - b0) / 0.32)) * (g.n - 1));
      return { x: g.x[i]!, y: g.y[i]! };
    }
    return { x: this.penX(t), y: -SIZE * 0.4 };
  }

  /**
   * The figure behind the exposure (line-local), lit only by the studio strobe: head, shoulders, a torso that
   * falls off into the dark, and the drawing arm reaching (two bones) for the pen tip.
   */
  private figure(c: CanvasRenderingContext2D, x: number, tip: Pt, a: number, strobe: number) {
    const P = this.P, A = a * strobe;
    if (A <= 0.01) return;
    const hy = -450, shy = -335;
    const body = c.createLinearGradient(0, hy - 70, 0, 380);
    body.addColorStop(0, pmix(P, 'deep', 'mid', 0.1 + 0.3 * strobe, A));
    body.addColorStop(0.45, pmix(P, 'deep', 'mid', 0.05 + 0.15 * strobe, 0.8 * A));
    body.addColorStop(1, pcss(P, 'deep', 0));
    c.fillStyle = body;
    c.beginPath(); c.ellipse(x, hy, 50, 63, 0.06, 0, TAU); c.fill();
    c.beginPath();
    c.moveTo(x - 20, hy + 55); c.lineTo(x + 22, hy + 55); c.lineTo(x + 26, shy - 10);
    c.quadraticCurveTo(x + 118, shy - 6, x + 128, shy + 50);
    c.lineTo(x + 100, 380); c.lineTo(x - 100, 380);
    c.lineTo(x - 126, shy + 50);
    c.quadraticCurveTo(x - 116, shy - 6, x - 24, shy - 10);
    c.closePath(); c.fill();
    // the drawing arm: shoulder -> elbow -> hand at the pen (clamped to reach), elbow bent down
    const sx = x - 112, sy = shy + 20, l1 = 230, l2 = 220;
    let dx = tip.x - sx, dy = tip.y - sy;
    const d = Math.min(Math.hypot(dx, dy), l1 + l2 - 1);
    const n = Math.hypot(dx, dy) || 1; dx /= n; dy /= n;
    const hx = sx + dx * d, hyy = sy + dy * d;
    const ca = clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1), ang = Math.acos(ca);
    const base = Math.atan2(dy, dx), side = dx < 0 ? -1 : 1;
    const ex = sx + Math.cos(base + side * ang) * l1, ey = sy + Math.sin(base + side * ang) * l1;
    c.strokeStyle = pmix(P, 'deep', 'mid', 0.1 + 0.3 * strobe, 0.9 * A);
    c.lineCap = 'round';
    c.lineWidth = 44; c.beginPath(); c.moveTo(sx, sy); c.lineTo(ex, ey); c.stroke();
    c.lineWidth = 32; c.beginPath(); c.moveTo(ex, ey); c.lineTo(hx, hyy); c.stroke();
    // rim light: the strobe catches the edge facing the pen
    c.strokeStyle = pmix(P, 'mid', 'hi', 0.5, 0.35 * A);
    c.lineWidth = 2.5;
    c.beginPath(); c.ellipse(x, hy, 50, 63, 0.06, Math.PI * 0.6, Math.PI * 1.4); c.stroke();
    c.beginPath(); c.moveTo(x - 24, shy - 10); c.quadraticCurveTo(x - 116, shy - 6, x - 126, shy + 50); c.lineTo(x - 118, shy + 260); c.stroke();
    c.beginPath(); c.moveTo(sx, sy - 22); c.lineTo(ex, ey - 20); c.lineTo(hx, hyy - 14); c.stroke();
  }
}
