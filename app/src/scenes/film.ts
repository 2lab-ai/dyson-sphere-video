// FILM run host (p08–p12): the NIGHT hardware wall (scenes/wall.ts — same brick, cart CRT, 3×3 TV wall, script sign,
// LED ribbon, bent tubes, paper clock, at the same world positions) plus the shop window, photographed on blown-out
// daylight stock (palette 'film'). The stock is light; the hardware prints as HARD INK silhouettes with hard ink
// shadows thrown down-right, glass faces blown to the stock, grain + halation on the highlights. Only the exposure
// flips at p08; from then on only the subject changes (docs/BUILD-V4.md, engine/world.ts).
//
//   Camera  eye-level; a held step cut-in per bar (eased 0.1 s) pivoting on the anchor point.
//   Subject developed into DARK INK on white (a levels curve: mids go to ink, white stays the stock), composited with
//           'multiply' into the wall. Every plate also carries a held per-beat ink mark drawn by the host on its object
//           (docs/FIX-V4-R1.md: a held state change moving ≥4 % of the frame):
//   p08     thick ink headlight trails across the clock wall, one more per beat (held); the paper clock's hand steps.
//   p09     the flip-board mounted on the shop front (its own panel, scaled so the line stays whole); the flip-card
//           year counter at street level: the years overtaken per beat, the cards flip ink <-> stock (held).
//   p10     the room behind the shop window (walls, table, lamp, two figures) swept by a light bar that jumps one
//           position per beat and holds; the line is lettered on the window glass. The host draws the whole subject.
//   p11     the other figure's iris across the wall; its pupil steps (held) per beat.
//   p12     lightpaint/orbit collapses to FILM_ANCHOR_CHILD, which the slot maps onto the screen anchor (1187, 413)
//           independent of the push (the push pivots on the anchor) — p13's residue.
import * as THREE from 'three';
import { WorldHost, type Slot } from '../engine/world';
import { type Frame, type PostOverrides } from '../engine/scene';
import { FSPass, Layer2D, makeRT, clearRT, W, H } from '../engine/gl';
import { palette, pcss, plin, type NamedPalette } from '../engine/palette';
import { barIndex, beatIndex, downbeatPulse } from '../engine/beat';
import { drawLyric, ownedLines, F } from '../engine/lyric';
import type { Line } from '../engine/lyrics';
import { clamp, ease, hash, TAU } from '../engine/util';

/** The screen anchor (p13's residue) and the subject-frame point the slot maps onto it. */
export const FILM_ANCHOR: [number, number] = [1187, 413];
export const FILM_ANCHOR_CHILD: [number, number] = [1007, 413];
const SUBJECT_SCALE = 0.86; // subject frame -> screen, before the push
const PUSH = 0.035; // per bar (held step)

type P2 = [number, number];
/** World positions of the NIGHT hardware (copied from scenes/wall.ts PIECE, wide framing = world px). */
const PIECE: Record<string, P2> = {
  scope: [905, 640], tvwall: [1430, 480], neon: [1240, 175], ribbon: [1280, 335], tubes: [1690, 770], clock: [1035, 360],
};
/** The shop window (left of the hardware; the cart stands on the pavement in front of its lower-right corner). */
const WIN = { x0: 80, y0: 300, x1: 1000, y1: 880 };
const SHADOW: P2 = [26, 30];
/** p09: the flip-board mounted on the shop front — its panel (world px) and the board's centre in the subject frame. */
const BOARD = { cx: 600, cy: 650, w: 1130, h: 540, child: [917, 689] as P2, s: 0.6 }; // the daylight's hard shadow offset (sun upper-left)

const DEVELOP = /* glsl */ `
uniform sampler2D tex;
uniform float uMode;          // 0: levels to ink (white = the stock); 1: exposure -> ink (light-on-dark subjects)
uniform vec3 uWhite, uDeep, uSig;
void main() {
  vec3 c = texture(tex, vUv).rgb;
  if (uMode < 0.5) {
    vec3 n = min(c / uWhite, vec3(1.0));
    float l = 0.2126 * n.r + 0.7152 * n.g + 0.0722 * n.b;
    float sat = (max(n.r, max(n.g, n.b)) - min(n.r, min(n.g, n.b))) / max(max(n.r, max(n.g, n.b)), 1e-3);
    float k = smoothstep(0.3, 0.97, l);      // pale grey -> ink, white stays white
    vec3 ink = mix(uDeep, uSig, smoothstep(0.35, 0.7, sat));
    fragColor = vec4(mix(ink, vec3(1.0), k), 1.0); return;
  }
  float mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b));
  float l = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  vec3 ink = mix(uDeep, uSig, smoothstep(0.35, 0.7, (mx - mn) / max(mx, 1e-3)));
  fragColor = vec4(mix(vec3(1.0), ink, clamp(l * 6.0, 0.0, 1.0)), 1.0);
}`;

export default class Film extends WorldHost {
  private P!: NamedPalette;
  private L!: Layer2D;
  private dev!: FSPass;
  private devRT: THREE.WebGLRenderTarget | null = null;
  private bar0 = 0;
  private beat0 = 0;
  private line: Line | null = null;

  override async init() {
    // the subject reads the anchor from its params (scenes never import each other)
    this.ctx.params = { ...this.ctx.params, filmAnchor: FILM_ANCHOR_CHILD };
    await super.init();
  }

  protected override initWorld() {
    this.P = palette('film');
    this.L = new Layer2D();
    this.devRT = makeRT();
    const v3 = (role: 'hi' | 'deep' | 'signal') => ({ value: new THREE.Vector3(...plin(this.P, role)) });
    this.dev = new FSPass(DEVELOP, { tex: { value: null }, uMode: { value: this.subjectName.startsWith('lidar/') ? 1 : 0 }, uWhite: v3('hi'), uDeep: v3('deep'), uSig: v3('signal') });
    this.bar0 = barIndex(this.ctx.audio, this.ctx.start + 0.05);
    this.beat0 = beatIndex(this.ctx.audio, this.ctx.start + 0.05);
    this.line = ownedLines(this.ctx)[0] ?? null;
  }

  private get is() { const s = this.subjectName; return { time: s.startsWith('lightpaint/time'), years: s.startsWith('flipdisc/'), room: s.startsWith('lidar/'), gaze: s.startsWith('lens/') }; }

  /** Push: a held step per bar since the plate start (eased over 0.1 s), pivoting on the anchor. */
  private push(t: number): number {
    const au = this.ctx.audio, b = barIndex(au, t), n = Math.max(0, b - this.bar0);
    const d = au.downbeats[b] ?? this.ctx.start;
    const k = b >= this.bar0 && n > 0 ? ease.outCubic(clamp((t - d) / 0.1)) : 1;
    return 1 + PUSH * (n - 1 + k) * (n > 0 ? 1 : 0);
  }

  /** Beats since the plate start (k) and the eased arrival (0..1 over 0.08 s) of the current beat's held state. */
  private beat(t: number): { k: number; e: number } {
    const au = this.ctx.audio, bi = beatIndex(au, t), k = Math.max(0, bi - this.beat0);
    return { k, e: k > 0 ? ease.outCubic(clamp((t - (au.beats[bi] ?? t)) / 0.08)) : 1 };
  }

  renderWorld(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const r = this.ctx.renderer, c = this.L.ctx, P = this.P, t = f.t;
    const z = this.push(t), [ax, ay] = FILM_ANCHOR, is = this.is, bt = this.beat(t);

    // develop the subject into ink on white (then swap: the slot composites the developed target)
    if (this.childRT && this.devRT) {
      this.dev.u.tex!.value = this.childRT.texture;
      this.dev.render(r, this.devRT);
      [this.childRT, this.devRT] = [this.devRT, this.childRT];
    }

    this.L.clear(pcss(P, 'hi'));
    c.setTransform(z, 0, 0, z, ax * (1 - z), ay * (1 - z));
    this.brick(c);
    this.window(c, t, bt);
    this.hardware(c, t, bt.k);
    if (is.time) this.trails(c, bt);
    if (is.years) { this.panel(c); this.cards(c, bt); }
    if (is.gaze) this.iris(c, bt);
    if (is.room) this.glassLine(c, t);
    this.L.upload();
    clearRT(r, out, [1, 1, 1]);
    this.ctx.comp.draw(r, this.L.texture, out, { mode: 'normal' });

    const dp = downbeatPulse(this.ctx.audio, t, 0.25);
    return { bloom: 0.5, bloomThreshold: 0.82, bloomRadius: 0.9, halation: 0.12 + 0.05 * dp, ca: 0.4, grain: 0.11, vignette: 0.1, flash: 0 };
  }

  // ---------------------------------------------------------------- the world (blown stock, ink hardware)
  private brick(c: CanvasRenderingContext2D) {
    const P = this.P, bw = 118, bh = 40;
    c.fillStyle = pcss(P, 'hi'); c.fillRect(-400, -300, W + 800, H + 600);
    for (let r = -8; r < 24; r++) {
      const y = r * bh, off = r % 2 ? bw / 2 : 0;
      for (let i = -4; i < 22; i++) {
        const h = hash(i, r, 11);
        if (h > 0.62) { c.fillStyle = pcss(P, 'deep', 0.05 + 0.1 * (h - 0.62)); c.fillRect(i * bw + off + 3, y + 3, bw - 6, bh - 6); }
      }
    }
    c.strokeStyle = pcss(P, 'deep', 0.16); c.lineWidth = 3; c.beginPath(); // mortar: a faint ink on the stock
    for (let r = -8; r < 24; r++) {
      const y = r * bh, off = r % 2 ? bw / 2 : 0;
      c.moveTo(-400, y); c.lineTo(W + 400, y);
      for (let i = -4; i < 22; i++) { c.moveTo(i * bw + off, y); c.lineTo(i * bw + off, y + bh); }
    }
    c.stroke();
    // the pavement + the kerb (the wall stops at 930 as in NIGHT)
    c.fillStyle = pcss(P, 'ground', 0.55); c.fillRect(-400, 930, W + 800, 500);
    c.fillStyle = pcss(P, 'deep', 0.85); c.fillRect(-400, 926, W + 800, 10);
  }

  /** The shop window: ink frame + mullion; the room behind it is drawn only on p10 (otherwise blown glass). */
  private window(c: CanvasRenderingContext2D, t: number, bt: { k: number; e: number }) {
    const P = this.P, { x0, y0, x1, y1 } = WIN;
    c.fillStyle = pcss(P, 'deep', 0.6); c.fillRect(x0 + SHADOW[0], y0 + SHADOW[1], x1 - x0, y1 - y0);
    c.fillStyle = pcss(P, 'hi'); c.fillRect(x0, y0, x1 - x0, y1 - y0);
    if (this.is.room) this.room(c, t, bt);
    c.strokeStyle = pcss(P, 'deep'); c.lineWidth = 22; c.strokeRect(x0, y0, x1 - x0, y1 - y0);
    c.lineWidth = 10; c.beginPath(); c.moveTo((x0 + x1) / 2, y0); c.lineTo((x0 + x1) / 2, y1); c.stroke();
    c.fillStyle = pcss(P, 'deep'); c.fillRect(x0 - 30, y0 - 46, x1 - x0 + 60, 34); // the awning rail
  }

  /** p10: the room behind the glass, swept by a light bar that jumps one position per beat and holds. */
  private room(c: CanvasRenderingContext2D, _t: number, bt: { k: number; e: number }) {
    const P = this.P, { x0, y0, x1, y1 } = WIN, bx0 = 300, by0 = 420, bx1 = 780, by1 = 700;
    c.save(); c.beginPath(); c.rect(x0, y0, x1 - x0, y1 - y0); c.clip();
    const quad = (pts: number[], fill: string) => { c.fillStyle = fill; c.beginPath(); c.moveTo(pts[0]!, pts[1]!); for (let i = 2; i < pts.length; i += 2) c.lineTo(pts[i]!, pts[i + 1]!); c.closePath(); c.fill(); };
    quad([x0, y0, x1, y0, bx1, by0, bx0, by0], pcss(P, 'deep', 0.62)); // ceiling
    quad([x0, y0, bx0, by0, bx0, by1, x0, y1], pcss(P, 'deep', 0.5)); // left wall
    quad([x1, y0, bx1, by0, bx1, by1, x1, y1], pcss(P, 'deep', 0.56)); // right wall
    quad([bx0, by0, bx1, by0, bx1, by1, bx0, by1], pcss(P, 'deep', 0.4)); // back wall
    quad([bx0, by1, bx1, by1, x1, y1, x0, y1], pcss(P, 'deep', 0.68)); // floor
    // the light bar: a blown vertical band, one position per beat (eased 0.08 s, then held)
    const pos = (k: number) => [0.14, 0.42, 0.7, 0.9, 0.56, 0.28][k % 6]!;
    const u = pos(Math.max(0, bt.k - 1)) + (pos(bt.k) - pos(Math.max(0, bt.k - 1))) * bt.e, bw = 150;
    const lx = x0 + u * (x1 - x0) - bw / 2;
    const g = c.createLinearGradient(lx - 40, 0, lx + bw + 40, 0);
    g.addColorStop(0, pcss(P, 'hi', 0)); g.addColorStop(0.2, pcss(P, 'hi', 1)); g.addColorStop(0.8, pcss(P, 'hi', 1)); g.addColorStop(1, pcss(P, 'hi', 0));
    c.fillStyle = g; c.fillRect(lx - 40, y0, bw + 80, y1 - y0);
    // the furniture and the two figures: hard ink silhouettes (the light bar passes behind them)
    c.fillStyle = pcss(P, 'deep');
    c.fillRect(420, 640, 260, 22); c.fillRect(436, 660, 14, 120); c.fillRect(650, 660, 14, 120); // table
    c.fillRect(214, 430, 8, 330); c.beginPath(); c.moveTo(170, 470); c.lineTo(266, 470); c.lineTo(244, 410); c.lineTo(192, 410); c.closePath(); c.fill(); // lamp
    c.fillRect(176, 752, 84, 12);
    for (const [fx, s] of [[350, 1], [760, -1]] as const) { // two figures facing each other across the table
      c.beginPath(); c.ellipse(fx, 520, 34, 42, 0, 0, TAU); c.fill();
      c.beginPath(); c.moveTo(fx - 58, 800); c.lineTo(fx - 62, 600); c.quadraticCurveTo(fx, 556, fx + 62, 600); c.lineTo(fx + 58, 800); c.closePath(); c.fill();
      c.fillRect(fx + s * 40, 620, s * 70, 20); // the arm toward the table
    }
    c.restore();
  }

  /** p10: the line lettered on the window glass (ink, ≥120 px), an orange stamp under each word as it is sung. */
  private glassLine(c: CanvasRenderingContext2D, t: number) {
    const line = this.line;
    if (!line) return;
    const P = this.P, rows = [line.words.slice(0, 2), line.words.slice(2)].filter((w) => w.length);
    rows.forEach((words, i) => {
      const sub: Line = { ...line, words, start: words[0]!.start };
      const x = WIN.x0 + 90, y = WIN.y0 + 210 + i * 170;
      c.save(); c.shadowColor = pcss(P, 'hi'); c.shadowBlur = 0; c.lineJoin = 'round';
      const lay = drawLyric(c, sub, t, { x, y, size: 132, family: F.hangul(), align: 'left', sungColor: 'ink', unsungColor: 'graphite', unsungAlpha: 0.3, lead: 0.4, maxWidth: 900 });
      c.restore();
      if (!lay) return;
      for (const wb of lay.words) if (t >= wb.word.start) { c.fillStyle = pcss(P, 'signal'); c.fillRect(x + wb.x, y + 18, wb.w, 16); }
    });
  }

  private hardware(c: CanvasRenderingContext2D, _t: number, k: number) {
    const P = this.P, ink = pcss(P, 'deep'), shade = pcss(P, 'deep', 0.55), glass = pcss(P, 'hi');
    const box = (x: number, y: number, w: number, h: number, r = 10) => {
      c.fillStyle = shade; c.beginPath(); c.roundRect(x + SHADOW[0], y + SHADOW[1], w, h, r); c.fill();
      c.fillStyle = ink; c.beginPath(); c.roundRect(x, y, w, h, r); c.fill();
    };
    const stroke = (w: number, path: () => void) => {
      c.lineCap = 'round'; c.lineWidth = w;
      c.save(); c.translate(...SHADOW); c.strokeStyle = shade; c.beginPath(); path(); c.stroke(); c.restore();
      c.strokeStyle = ink; c.beginPath(); path(); c.stroke();
    };
    // TV wall: a 3×3 rack of tubes, glass faces blown to the stock
    const [tx, ty] = PIECE.tvwall!;
    box(tx - 270, ty - 210, 540, 420, 6);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      const x = tx - 255 + i * 172, y = ty - 195 + j * 132;
      c.fillStyle = glass; c.beginPath(); c.roundRect(x + 16, y + 16, 136, 96, 22); c.fill();
      c.fillStyle = pcss(P, 'deep', 0.18); c.beginPath(); c.ellipse(x + 112, y + 86, 30, 12, -0.4, 0, TAU); c.fill();
    }
    // the cart + the scope CRT
    const [sx, sy] = PIECE.scope!;
    stroke(8, () => { c.moveTo(sx - 150, 920); c.lineTo(sx - 150, sy + 130); c.moveTo(sx + 150, 920); c.lineTo(sx + 150, sy + 130); });
    box(sx - 180, sy + 120, 360, 22, 4); box(sx - 180, sy + 260, 360, 18, 4);
    for (const wx of [sx - 150, sx + 150]) { c.fillStyle = ink; c.beginPath(); c.arc(wx, 925, 16, 0, TAU); c.fill(); }
    box(sx - 160, sy - 120, 320, 236, 14);
    c.fillStyle = glass; c.beginPath(); c.roundRect(sx - 132, sy - 98, 220, 168, 34); c.fill();
    for (let q = 0; q < 3; q++) { c.fillStyle = glass; c.beginPath(); c.arc(sx + 122, sy - 70 + q * 46, 9, 0, TAU); c.fill(); }
    // the script sign: the tube on its rail
    const [nx, ny] = PIECE.neon!;
    stroke(5, () => { c.moveTo(nx - 330, ny - 70); c.lineTo(nx + 330, ny - 70); });
    stroke(11, () => { for (let i = 0; i <= 80; i++) { const u = i / 80, x = nx - 300 + 600 * u, y = ny + 40 * Math.sin(u * 19) * Math.sin(u * 3.1) - 18 * Math.cos(u * 37); if (i) c.lineTo(x, y); else c.moveTo(x, y); } });
    // the LED ribbon: an ink strip, its dots blown
    const [rx, ry] = PIECE.ribbon!;
    box(rx - 590, ry - 22, 1180, 44, 6);
    c.fillStyle = glass;
    for (let i = 0; i < 74; i++) for (let j = 0; j < 2; j++) { c.beginPath(); c.arc(rx - 576 + i * 15.8, ry - 8 + j * 16, 3.4, 0, TAU); c.fill(); }
    // the bent tubes on the brick
    const [bx, by] = PIECE.tubes!;
    stroke(12, () => { c.moveTo(bx - 120, by - 120); c.quadraticCurveTo(bx - 40, by + 140, bx + 40, by - 60); c.quadraticCurveTo(bx + 90, by - 160, bx + 140, by + 40); });
    // the paper clock pasted on the brick (printed in daylight); its hand steps one hour per beat (held)
    const [cx, cy] = PIECE.clock!;
    c.save(); c.translate(cx, cy); c.rotate(-0.035);
    c.fillStyle = shade; c.fillRect(-105 + SHADOW[0] * 0.4, -105 + SHADOW[1] * 0.4, 210, 210);
    c.fillStyle = glass; c.fillRect(-105, -105, 210, 210);
    c.strokeStyle = ink; c.lineWidth = 3; c.strokeRect(-105, -105, 210, 210);
    c.lineWidth = 7; c.beginPath(); c.arc(0, 0, 82, 0, TAU); c.stroke();
    c.lineWidth = 6; c.beginPath();
    for (let h = 0; h < 12; h++) { const a = (h / 12) * TAU; c.moveTo(Math.cos(a) * 66, Math.sin(a) * 66); c.lineTo(Math.cos(a) * 78, Math.sin(a) * 78); }
    c.stroke();
    const ha = ((k % 12) / 12) * TAU - Math.PI / 2;
    c.lineCap = 'round'; c.lineWidth = 12; c.beginPath(); c.moveTo(0, 0); c.lineTo(Math.cos(ha) * 60, Math.sin(ha) * 60); c.stroke();
    c.lineWidth = 7; c.beginPath(); c.moveTo(0, 0); c.lineTo(0, -72); c.stroke();
    c.restore();
  }

  // ---------------------------------------------------------------- the held per-beat marks
  /** p08: thick ink headlight trails across the clock wall, one more per beat (written on in 0.08 s, then held). */
  private trails(c: CanvasRenderingContext2D, bt: { k: number; e: number }) {
    const P = this.P, ys = [250, 790, 450, 860, 190, 720, 400, 820];
    for (let j = 0; j <= Math.min(bt.k, ys.length - 1); j++) {
      const y = ys[j]!, dir = j % 2 ? -1 : 1, w = j === bt.k ? bt.e : 1;
      const xa = dir > 0 ? -60 : W + 60, xb = xa + dir * (W + 120) * w;
      c.lineCap = 'round';
      c.strokeStyle = pcss(P, 'deep', 0.92); c.lineWidth = 64;
      c.beginPath(); c.moveTo(xa, y); c.quadraticCurveTo((xa + xb) / 2, y - 60 * dir, xb, y + 24); c.stroke();
      c.strokeStyle = pcss(P, 'signal', 0.9); c.lineWidth = 8; // the hot core of the trail
      c.beginPath(); c.moveTo(xa, y); c.quadraticCurveTo((xa + xb) / 2, y - 60 * dir, xb, y + 24); c.stroke();
    }
  }

  /** p09: the board's panel on the shop front: opaque stock over the bricks, an ink frame, a hard shadow. */
  private panel(c: CanvasRenderingContext2D) {
    const P = this.P, x = BOARD.cx - BOARD.w / 2, y = BOARD.cy - BOARD.h / 2;
    c.fillStyle = pcss(P, 'deep', 0.55); c.fillRect(x + SHADOW[0], y + SHADOW[1], BOARD.w, BOARD.h);
    c.fillStyle = pcss(P, 'hi'); c.fillRect(x, y, BOARD.w, BOARD.h);
    c.strokeStyle = pcss(P, 'deep'); c.lineWidth = 14; c.strokeRect(x, y, BOARD.w, BOARD.h);
  }

  /** p09: the flip-card year counter at street level (over the tubes), overtaken per beat; the cards flip ink <-> stock (held). */
  private cards(c: CanvasRenderingContext2D, bt: { k: number; e: number }) {
    const P = this.P, year = String(2026 + Math.round(bt.k * bt.k * 2.5 + bt.k * 6)).padStart(4, '0').slice(-4);
    const inv = bt.k % 2 === 1, x0 = 1240, y0 = 690, cw = 130, ch = 240;
    c.font = `700 ${ch * 0.82}px ${F.slam()}`; c.textAlign = 'center'; c.textBaseline = 'middle';
    for (let i = 0; i < year.length; i++) {
      const x = x0 + i * (cw + 14), sq = i === 3 - (bt.k % 4) ? 1 - 0.85 * (1 - bt.e) : 1; // the flipping card folds in
      c.fillStyle = pcss(P, 'deep', 0.5); c.fillRect(x + SHADOW[0], y0 + SHADOW[1], cw, ch);
      c.save(); c.translate(x + cw / 2, y0 + ch / 2); c.scale(1, sq);
      c.fillStyle = inv ? pcss(P, 'deep') : pcss(P, 'hi'); c.fillRect(-cw / 2, -ch / 2, cw, ch);
      c.strokeStyle = pcss(P, 'deep'); c.lineWidth = 6; c.strokeRect(-cw / 2, -ch / 2, cw, ch);
      c.fillStyle = inv ? pcss(P, 'hi') : pcss(P, 'deep'); c.fillText(year[i]!, 0, 6);
      c.fillStyle = pcss(P, 'signal'); c.fillRect(-cw / 2, -3, cw, 6); // the hinge: an orange stamp line
      c.restore();
    }
  }

  /** p11: the other figure's iris across the wall; the pupil steps (held) per beat between three apertures. */
  private iris(c: CanvasRenderingContext2D, bt: { k: number; e: number }) {
    const P = this.P, ex = 430, ey = 560, R = 290;
    const ap = (k: number) => [0.26, 0.7, 0.45][k % 3]!;
    const pr = R * (ap(Math.max(0, bt.k - 1)) + (ap(bt.k) - ap(Math.max(0, bt.k - 1))) * bt.e);
    c.fillStyle = pcss(P, 'deep', 0.5); c.beginPath(); c.arc(ex + SHADOW[0], ey + SHADOW[1], R, 0, TAU); c.fill();
    c.fillStyle = pcss(P, 'hi'); c.beginPath(); c.arc(ex, ey, R, 0, TAU); c.fill();
    c.strokeStyle = pcss(P, 'deep', 0.75); c.lineWidth = 7; c.beginPath();
    for (let q = 0; q < 48; q++) { const a = (q / 48) * TAU; c.moveTo(ex + Math.cos(a) * R * 0.3, ey + Math.sin(a) * R * 0.3); c.lineTo(ex + Math.cos(a) * R * 0.95, ey + Math.sin(a) * R * 0.95); }
    c.stroke();
    c.strokeStyle = pcss(P, 'deep'); c.lineWidth = 16; c.beginPath(); c.arc(ex, ey, R, 0, TAU); c.stroke();
    c.fillStyle = pcss(P, 'deep'); c.beginPath(); c.arc(ex, ey, pr, 0, TAU); c.fill();
    c.fillStyle = pcss(P, 'signal'); c.beginPath(); c.arc(ex - pr * 0.32, ey - pr * 0.34, Math.max(10, pr * 0.12), 0, TAU); c.fill();
  }

  /** The subject frame scaled by SUBJECT_SCALE * push, FILM_ANCHOR_CHILD pinned to FILM_ANCHOR (uv space, y up). */
  slot(f: Frame): Slot {
    const z = this.push(f.t), [ax, ay] = FILM_ANCHOR;
    // child point C lands on screen point Q at magnification s·z
    const map = (C: P2, Q: P2, s: number): [number, number] => [C[0] / W - 0.5 - (Q[0] / W - 0.5) / (s * z), 1 - C[1] / H - 0.5 - (0.5 - Q[1] / H) / (s * z)];
    // p09: the board onto its panel on the shop front (the panel rides the world push about the anchor)
    if (this.is.years) return { scale: [1 / (BOARD.s * z), 1 / (BOARD.s * z)], offset: map(BOARD.child, [ax + (BOARD.cx - ax) * z, ay + (BOARD.cy - ay) * z], BOARD.s), mode: 'multiply' };
    const S = 1 / (SUBJECT_SCALE * z);
    const A = [FILM_ANCHOR[0] / W, 1 - FILM_ANCHOR[1] / H], Ac = [FILM_ANCHOR_CHILD[0] / W, 1 - FILM_ANCHOR_CHILD[1] / H];
    // p10: the host draws the swept room and the lettered glass itself; the lidar render is not composited
    return { scale: [S, S], offset: [Ac[0]! - 0.5 - (A[0]! - 0.5) * S, Ac[1]! - 0.5 - (A[1]! - 0.5) * S], mode: 'multiply', opacity: this.is.room ? 0 : 1 };
  }

  override dispose() { super.dispose(); this.devRT?.dispose(); this.L?.texture.dispose(); }
}
