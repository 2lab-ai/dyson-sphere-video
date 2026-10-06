// WALL — the v4 NIGHT world host (docs/PLAN-V4.md §C7: p01–p07 + the p29/p45 callbacks). A night street hardware wall
// photographed on film: dark brick, a cart with a dark scope CRT, a TV wall of dark tubes, an unlit neon script sign,
// a dead LED ribbon, bent tubes, a paper clock — all present and dark on every plate of the run. Each plate's subject
// (a child scene, engine/world.ts) lights ONE of them: the child is composited onto that piece.
// Camera class (kept): eye-level; a slow push inside every bar and, on alternate downbeats, a held cut-in (≈1.8×)
// onto the lit piece — a framing that stays the whole bar, never a flash. Layout (kept): hardware centre-right.
// p29 owns the unit's one whiteout: 142.035 s (held ~8 frames) + a cut-in that stays to the cut.
import type * as THREE from 'three';
import { WorldHost, type Slot } from '../engine/world';
import type { Frame, PostOverrides } from '../engine/scene';
import { Layer2D, clearRT, W, H } from '../engine/gl';
import { palette, pcss, pmix, type NamedPalette } from '../engine/palette';
import { beatPulse, downbeatPulse, barIndex } from '../engine/beat';
import { clamp, hash, smoothstep } from '../engine/util';

type P2 = [number, number];
/** World positions (wide framing = world px) of the hardware pieces. */
const PIECE: Record<string, P2> = {
  brick: [1180, 520], // the open brick between the pieces: the point writes here (p01, p29, p45)
  scope: [905, 640], // the cart's CRT
  tvwall: [1430, 480],
  neon: [1240, 175],
  ribbon: [1280, 335],
  tubes: [1690, 770],
  clock: [1035, 360],
};
const SUBJECT_PIECE: Record<string, string> = {
  'ecg/scope': 'scope', 'crt/wall': 'tvwall', 'sign/neon': 'neon', 'led/ribbon': 'ribbon', 'sign/tubes': 'tubes', 'press/clock': 'clock',
};
const ANCHOR: P2 = [1180, 540]; // where a cut-in puts the lit piece (centre-right)
const CUT = 1.8;
const KMAX = 1.3; // the subject's magnification on a cut-in (the world takes the full CUT)
const HIT = 142.035; // p29: the one whiteout of the unit

export default class Wall extends WorldHost {
  private L!: Layer2D;
  private P: NamedPalette = palette(this.ctx.params.look?.palette ?? 'wall');
  private cam = { z: 1, fx: ANCHOR[0], fy: ANCHOR[1], ax: ANCHOR[0], ay: ANCHOR[1] };

  protected override initWorld() { this.L = new Layer2D(); }

  private get piece(): P2 { return PIECE[SUBJECT_PIECE[this.subjectName.replace(/\/-$/, '')] ?? 'brick']!; }
  private get merge() { return this.subjectName.startsWith('spark/merge'); }

  /** The camera at t: world (x, y) → screen (ax + (x − fx)·z, ay + (y − fy)·z). */
  private camera(t: number) {
    const au = this.ctx.audio;
    const b0 = barIndex(au, this.ctx.start), bi = Math.max(0, barIndex(au, t) - b0);
    const d0 = au.downbeats[barIndex(au, t)] ?? this.ctx.start;
    const d1 = au.downbeats[barIndex(au, t) + 1] ?? d0 + 2;
    const inBar = clamp((t - Math.max(d0, this.ctx.start)) / Math.max(0.3, d1 - d0));
    let cut = bi % 2 === 1 ? 1 : 0; // alternate bars: the held cut-in
    if (this.merge) cut = t >= HIT ? 1 : 0; // p29: the hit cuts in and stays
    const [px, py] = this.piece;
    const z = (cut ? CUT : 1) * (1 + 0.045 * smoothstep(0, 1, inBar)); // the push inside the bar
    // wide: the world as laid out (focus = anchor); cut-in: the lit piece on the anchor
    this.cam = cut ? { z, fx: px, fy: py, ax: ANCHOR[0], ay: ANCHOR[1] } : { z, fx: ANCHOR[0], fy: ANCHOR[1], ax: ANCHOR[0], ay: ANCHOR[1] };
    return this.cam;
  }

  renderWorld(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const t = f.t, au = this.ctx.audio, P = this.P, c = this.L.ctx;
    const cam = this.camera(t);
    const bp = beatPulse(au, t, 0.14), db = downbeatPulse(au, t, 0.3);
    this.L.clear(pcss(P, 'ground'));
    c.save();
    c.translate(cam.ax, cam.ay); c.scale(cam.z, cam.z); c.translate(-cam.fx, -cam.fy);
    this.brick(c);
    this.hardware(c, bp);
    c.restore();
    // the street light: a sodium-warm wash from the upper left (falls off into the dark)
    const g = c.createRadialGradient(W * 0.18, -H * 0.2, 60, W * 0.18, -H * 0.2, W * 0.95);
    g.addColorStop(0, pcss(P, 'hi', 0.16)); g.addColorStop(0.5, pcss(P, 'mid', 0.05)); g.addColorStop(1, pcss(P, 'ground', 0));
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    this.L.upload();
    clearRT(this.ctx.renderer, out, [0, 0, 0], 1);
    this.ctx.comp.draw(this.ctx.renderer, this.L.texture, out, { mode: 'normal' });
    // film: grain + halation every plate; p29's hit is the only flash (held ≥6 frames, then decays)
    const hit = this.merge && t >= HIT ? (t < HIT + 0.135 ? 1.15 : 1.15 * Math.exp(-(t - HIT - 0.135) / 0.12)) : 0;
    return { grain: 0.09, vignette: 0.42, halation: 0.35 + 0.15 * db, bloom: 0.35, bloomThreshold: 0.6, ca: 0.6, flash: hit, zoom: 1, fade: 0 };
  }

  /** The subject sits on its piece, magnified with the camera (never below 1:1, so the lyric keeps ≥120 px). */
  slot(_f: Frame): Slot {
    const cam = this.cam, [px, py] = this.piece;
    // the subject follows the camera but its magnification is capped (KMAX) so a long line still fits the frame
    const cut = cam.z > 1.2, k = cut ? KMAX * (cam.z / CUT) : cam.z;
    // screen position of the piece, held inside the centre-right band so the child's frame (and its line) stays on screen
    const sx = cut ? W * 0.5 : clamp(cam.ax + (px - cam.fx) * cam.z, W * 0.42, W * 0.6), sy = clamp(cam.ay + (py - cam.fy) * cam.z, H * 0.42, H * 0.58);
    const u = sx / W, v = 1 - sy / H;
    return { scale: [1 / k, 1 / k], offset: [-(u - 0.5) / k, -(v - 0.5) / k], mode: 'screen' };
  }

  // ---------------------------------------------------------------- the world
  private brick(c: CanvasRenderingContext2D) {
    const P = this.P, bw = 118, bh = 40;
    c.fillStyle = pmix(P, 'ground', 'deep', 0.55); c.fillRect(-400, -300, W + 800, 1230 + 300);
    for (let r = -8; r < 24; r++) {
      const y = r * bh, off = r % 2 ? bw / 2 : 0;
      for (let i = -4; i < 22; i++) {
        const x = i * bw + off, h = hash(i, r, 11);
        c.fillStyle = pmix(P, 'ground', 'deep', 0.55 + 0.4 * h); c.fillRect(x + 3, y + 3, bw - 6, bh - 6);
      }
    }
    // the pavement: wet, darker, one warm streak of reflected street light
    c.fillStyle = pcss(P, 'ground', 1); c.fillRect(-400, 930, W + 800, 500);
    c.fillStyle = pcss(P, 'mid', 0.08); c.fillRect(-400, 940, W + 800, 6);
  }

  private hardware(c: CanvasRenderingContext2D, bp: number) {
    const P = this.P;
    const body = pmix(P, 'ground', 'deep', 0.3), edge = pcss(P, 'mid', 0.35), glass = pmix(P, 'ground', 'deep', 0.85);
    const box = (x: number, y: number, w: number, h: number, r = 10) => { c.fillStyle = body; c.beginPath(); c.roundRect(x, y, w, h, r); c.fill(); c.strokeStyle = edge; c.lineWidth = 2; c.stroke(); };
    // TV wall: 3×3 dark tubes in a rack
    const [tx, ty] = PIECE.tvwall!;
    box(tx - 270, ty - 210, 540, 420, 6);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      const x = tx - 255 + i * 172, y = ty - 195 + j * 132;
      c.fillStyle = glass; c.beginPath(); c.roundRect(x + 10, y + 10, 148, 108, 22); c.fill();
      c.fillStyle = pcss(P, 'hi', 0.05); c.beginPath(); c.ellipse(x + 60, y + 40, 30, 14, -0.4, 0, Math.PI * 2); c.fill(); // glass reflection
    }
    // the cart + the scope CRT
    const [sx, sy] = PIECE.scope!;
    c.strokeStyle = edge; c.lineWidth = 6;
    c.beginPath(); c.moveTo(sx - 150, 920); c.lineTo(sx - 150, sy + 130); c.moveTo(sx + 150, 920); c.lineTo(sx + 150, sy + 130); c.stroke();
    box(sx - 180, sy + 120, 360, 22, 4); box(sx - 180, sy + 260, 360, 18, 4);
    for (const wx of [sx - 150, sx + 150]) { c.fillStyle = body; c.beginPath(); c.arc(wx, 925, 14, 0, Math.PI * 2); c.fill(); }
    box(sx - 160, sy - 120, 320, 236, 14);
    c.fillStyle = glass; c.beginPath(); c.roundRect(sx - 132, sy - 98, 220, 168, 34); c.fill();
    for (let k = 0; k < 3; k++) { c.fillStyle = pcss(P, 'mid', 0.3); c.beginPath(); c.arc(sx + 122, sy - 70 + k * 46, 9, 0, Math.PI * 2); c.fill(); }
    // the neon script sign: unlit glass tube on a backing rail
    const [nx, ny] = PIECE.neon!;
    c.strokeStyle = pcss(P, 'mid', 0.25); c.lineWidth = 4; c.beginPath(); c.moveTo(nx - 330, ny - 70); c.lineTo(nx + 330, ny - 70); c.stroke();
    c.strokeStyle = pmix(P, 'deep', 'mid', 0.35); c.lineWidth = 9; c.lineCap = 'round'; c.beginPath();
    for (let i = 0; i <= 80; i++) { const u = i / 80, x = nx - 300 + 600 * u, y = ny + 40 * Math.sin(u * 19) * Math.sin(u * 3.1) - 18 * Math.cos(u * 37); if (i) c.lineTo(x, y); else c.moveTo(x, y); }
    c.stroke();
    // the dead LED ribbon: a strip of unlit dots across the hardware
    const [rx, ry] = PIECE.ribbon!;
    box(rx - 590, ry - 22, 1180, 44, 6);
    c.fillStyle = pmix(P, 'deep', 'mid', 0.25);
    for (let i = 0; i < 74; i++) for (let j = 0; j < 2; j++) { c.beginPath(); c.arc(rx - 576 + i * 15.8, ry - 8 + j * 16, 3.2, 0, Math.PI * 2); c.fill(); }
    // bent tubes on the brick (unlit)
    const [bx, by] = PIECE.tubes!;
    c.strokeStyle = pmix(P, 'deep', 'mid', 0.3); c.lineWidth = 10;
    c.beginPath(); c.moveTo(bx - 120, by - 120); c.quadraticCurveTo(bx - 40, by + 140, bx + 40, by - 60); c.quadraticCurveTo(bx + 90, by - 160, bx + 140, by + 40); c.stroke();
    // the paper clock pasted on the brick (unprinted dark paper until p07 prints it)
    const [cx, cy] = PIECE.clock!;
    c.save(); c.translate(cx, cy); c.rotate(-0.035);
    c.fillStyle = pmix(P, 'ground', 'mid', 0.22); c.fillRect(-105, -105, 210, 210);
    c.strokeStyle = pmix(P, 'deep', 'mid', 0.4); c.lineWidth = 4; c.beginPath(); c.arc(0, 0, 82, 0, Math.PI * 2); c.stroke();
    c.restore();
    // a breath of street light on the hardware edges with the beat (the world keeps time even when dark)
    c.fillStyle = pcss(P, 'hi', 0.025 * bp); c.fillRect(tx - 270, ty - 210, 540, 420);
  }

  protected override afterSubject(_f: Frame, _out: THREE.WebGLRenderTarget) {}
}
