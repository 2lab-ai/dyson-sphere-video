// DEMO — the demo sequence (p38 boot -> p39 internet -> p40 ai): the computer era told in the taste of a 1990s
// intro. Everything is written into a low-res indexed buffer (one index per palette role of the plate's own named
// palette) and blown up nearest-neighbour. boot/internet: 320x180 (6x6 output px per pixel) with a scanline hint and
// an ordered dither on ramps; ai: 960x540 (2x2), no dither, no scanlines (crisp digital, Ikeda).
//   boot      eniac/corridor  one-point dolly down a corridor of ENIAC panels; the lamps count in binary per beat
//             eniac/lamps     flat on one accumulator: decade lamp columns + a binary register, +1 per beat, pan left
//             c64/ready       a C64-style boot screen: banner, READY., SYS typed, cursor blinks per beat, border flips
//             c64/raster      RUN: raster bars in the border, the stack jumps 14 px per beat, last beat floods the screen
//   internet  modem/dial      ATDT typed, the DTMF tone pairs as a chunky scrolling waveform; amplitude snaps per beat
//             modem/carrier   answer tone over the scrambled carrier, a screech burst per beat, CONNECT on beat 4
//             copper/scroll   full-frame copper bars (hop, land on the beat) + a sine scroller of jamo (squash per beat)
//             copper/mirror   big scroller over a horizon, the lower half a rippling mirror (ripple kicks per beat)
//             net/nodes       top view, slowly turning: the network lights node by node, one node per kick
//             net/flood       last beat: every node lights and pours data streams (hand-off to the flood)
//   ai        flood/bars      Ikeda barcode strips, full field; one re-roll per beat (<= 1 large change per beat)
//             flood/matrix    barcode over a bit matrix that steps one row per beat
//             face/condense   the flood condenses into a low-res face, a step per beat; its eye is a disc
//             face/eye        last beat: the face drops away, only the eye disc is left, at the storyboard anchor
// The eye disc (p40 -> p41 match-circle): centre = storyboard subject (1187, 413), a signal disc of radius 76 px
// (1080p; the p41 Sun's photosphere, contract from the orbit module) with a black pupil of 52 px.
// No lyric lines are owned (instrumental); the scroller carries jamo, not lyrics.
import * as THREE from 'three';
import { Scene, type Frame, type PostOverrides } from '../engine/scene';
import { Layer2D, clearRT } from '../engine/gl';
import { palette, pcss, plin, type NamedPalette, type Role } from '../engine/palette';
import { beatPulse, kickPulse, downbeatPulse, beatIndex, beatPhase } from '../engine/beat';
import { shotAt, type PlateInfo, type Shot } from '../engine/shots';
import { sbPlate } from '../engine/storyboard';
import { hash, clamp, smoothstep } from '../engine/util';
import { shots } from './demo.shots';

const ROLES: Role[] = ['ground', 'deep', 'mid', 'hi', 'text', 'signal'];
const G = 0, D = 1, M = 2, H = 3, S = 5; // palette-role indices in the buffer
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((b) => (b + 0.5) / 16);

// 5x7 font, 5 column bytes per glyph (bit 0 = top row); drawn bold (each column doubled right) like the C64 set.
const FONT: Record<string, number[]> = {
  A: [0x7c, 0x12, 0x11, 0x12, 0x7c], B: [0x7f, 0x49, 0x49, 0x49, 0x36], C: [0x3e, 0x41, 0x41, 0x41, 0x22],
  D: [0x7f, 0x41, 0x41, 0x22, 0x1c], E: [0x7f, 0x49, 0x49, 0x49, 0x41], F: [0x7f, 0x09, 0x09, 0x09, 0x01],
  G: [0x3e, 0x41, 0x49, 0x49, 0x7a], H: [0x7f, 0x08, 0x08, 0x08, 0x7f], I: [0x00, 0x41, 0x7f, 0x41, 0x00],
  J: [0x20, 0x40, 0x41, 0x3f, 0x01], K: [0x7f, 0x08, 0x14, 0x22, 0x41], L: [0x7f, 0x40, 0x40, 0x40, 0x40],
  M: [0x7f, 0x02, 0x0c, 0x02, 0x7f], N: [0x7f, 0x04, 0x08, 0x10, 0x7f], O: [0x3e, 0x41, 0x41, 0x41, 0x3e],
  P: [0x7f, 0x09, 0x09, 0x09, 0x06], Q: [0x3e, 0x41, 0x51, 0x21, 0x5e], R: [0x7f, 0x09, 0x19, 0x29, 0x46],
  S: [0x46, 0x49, 0x49, 0x49, 0x31], T: [0x01, 0x01, 0x7f, 0x01, 0x01], U: [0x3f, 0x40, 0x40, 0x40, 0x3f],
  V: [0x1f, 0x20, 0x40, 0x20, 0x1f], W: [0x3f, 0x40, 0x38, 0x40, 0x3f], X: [0x63, 0x14, 0x08, 0x14, 0x63],
  Y: [0x07, 0x08, 0x70, 0x08, 0x07], Z: [0x61, 0x51, 0x49, 0x45, 0x43],
  0: [0x3e, 0x51, 0x49, 0x45, 0x3e], 1: [0x00, 0x42, 0x7f, 0x40, 0x00], 2: [0x42, 0x61, 0x51, 0x49, 0x46],
  3: [0x21, 0x41, 0x45, 0x4b, 0x31], 4: [0x18, 0x14, 0x12, 0x7f, 0x10], 5: [0x27, 0x45, 0x45, 0x45, 0x39],
  6: [0x3c, 0x4a, 0x49, 0x49, 0x30], 7: [0x01, 0x71, 0x09, 0x05, 0x03], 8: [0x36, 0x49, 0x49, 0x49, 0x36],
  9: [0x06, 0x49, 0x49, 0x29, 0x1e], '*': [0x14, 0x08, 0x3e, 0x08, 0x14], '.': [0x00, 0x60, 0x60, 0x00, 0x00],
  '-': [0x08, 0x08, 0x08, 0x08, 0x08], ':': [0x00, 0x36, 0x36, 0x00, 0x00],
};
// the 14 basic consonant jamo as 7x7 rows (the scroller's alphabet)
const JAMO = [
  '#######|......#|......#|......#|......#|......#|......#', // ㄱ
  '#......|#......|#......|#......|#......|#......|#######', // ㄴ
  '#######|#......|#......|#......|#......|#......|#######', // ㄷ
  '#######|......#|......#|#######|#......|#......|#######', // ㄹ
  '#######|#.....#|#.....#|#.....#|#.....#|#.....#|#######', // ㅁ
  '#.....#|#.....#|#######|#.....#|#.....#|#.....#|#######', // ㅂ
  '...#...|...#...|..#.#..|..#.#..|.#...#.|#.....#|#.....#', // ㅅ
  '..###..|.#...#.|#.....#|#.....#|#.....#|.#...#.|..###..', // ㅇ
  '#######|...#...|...#...|..#.#..|.#...#.|#.....#|#.....#', // ㅈ
  '...#...|#######|...#...|..#.#..|.#...#.|#.....#|#.....#', // ㅊ
  '#######|......#|......#|#######|......#|......#|......#', // ㅋ
  '#######|#......|#......|#######|#......|#......|#######', // ㅌ
  '#######|.#...#.|.#...#.|.#...#.|.#...#.|.#...#.|#######', // ㅍ
  '...#...|#######|.......|..###..|.#...#.|.#...#.|..###..', // ㅎ
].map((g) => g.split('|').map((r) => [...r].map((c) => c === '#')));
// 3x5 digits for the data readouts
const DIG = ['111101101101111', '010110010010111', '111001111100111', '111001111001111', '101101111001001',
  '111100111001111', '111100111101111', '111001010010010', '111101111101111', '111101111001111'];

const hexRgb = (h: string): [number, number, number] => {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

// the eye disc at 1080p: outer radius 76 px (= the p41 Sun's photosphere), black pupil 52 px; buffer px are 2x2
const EYE_R2 = 38, EYE_R1 = 26;

type Node = { x: number; y: number; parent: number };

export default class Demo extends Scene {
  private P!: NamedPalette;
  private variant = 'boot';
  private W = 320;
  private H = 180;
  private low!: Layer2D;
  private scan: Layer2D | null = null;
  private img!: ImageData;
  private buf!: Uint8Array;
  private rgb: [number, number, number][] = [];
  private list: Shot[] = [];
  private plate!: PlateInfo;
  private nodes: Node[] = []; // network, in light order (Prim from the centre)
  private kicks: number[] = []; // strong kicks inside the plate (one node per kick)
  private eye = { x: 0, y: 0 }; // eye anchor, buffer px

  override init() {
    this.plate = this.ctx.params as PlateInfo;
    this.variant = this.plate.variant;
    this.P = palette(this.ctx.params.look.palette);
    this.rgb = ROLES.map((r) => hexRgb(this.P[r]));
    this.list = shots(this.plate, this.ctx.audio);
    const ai = this.variant === 'ai';
    this.W = ai ? 960 : 320;
    this.H = ai ? 540 : 180;
    const px = 1080 / this.H;
    this.low = new Layer2D(this.W, this.H, 1);
    this.low.texture.magFilter = THREE.NearestFilter;
    this.low.texture.minFilter = THREE.NearestFilter;
    this.img = this.low.ctx.createImageData(this.W, this.H);
    this.buf = new Uint8Array(this.W * this.H);
    if (!ai) {
      // scanline hint: the bottom two output rows of every buffer row are darkened
      this.scan = new Layer2D(1920, 1080, 1);
      const s = this.scan.ctx;
      s.clearRect(0, 0, 1920, 1080);
      s.fillStyle = pcss(this.P, 'ground', 0.42);
      for (let y = 0; y < this.H; y++) s.fillRect(0, (y + 1) * px - 2, 1920, 2);
      this.scan.upload();
    }
    const subj = sbPlate(this.plate.id).subject;
    this.eye = { x: subj.x / px, y: subj.y / px };
    if (this.variant === 'internet') this.buildNet();
  }

  /** A network: 30 spread nodes, lit in Prim order from the node nearest the centre (parent = the tree edge). */
  private buildNet() {
    const pts: { x: number; y: number }[] = [];
    for (let i = 0; pts.length < 30 && i < 600; i++) {
      const x = 22 + hash(i, 11) * 276, y = 18 + hash(i, 12) * 144;
      if (pts.every((p) => (p.x - x) ** 2 + (p.y - y) ** 2 > 26 ** 2)) pts.push({ x, y });
    }
    let root = 0;
    pts.forEach((p, i) => { if ((p.x - 160) ** 2 + (p.y - 90) ** 2 < (pts[root]!.x - 160) ** 2 + (pts[root]!.y - 90) ** 2) root = i; });
    const inT = new Set([root]);
    this.nodes = [{ ...pts[root]!, parent: -1 }];
    const idx = [root];
    while (inT.size < pts.length) {
      let best = -1, bp = -1, bd = Infinity;
      idx.forEach((a, ia) => pts.forEach((q, b) => {
        if (inT.has(b)) return;
        const d = (pts[a]!.x - q.x) ** 2 + (pts[a]!.y - q.y) ** 2;
        if (d < bd) { bd = d; best = b; bp = ia; }
      }));
      inT.add(best); idx.push(best);
      this.nodes.push({ ...pts[best]!, parent: bp });
    }
    const ks = this.ctx.audio.onsets?.kick ?? [];
    this.kicks = ks.filter(([t, v]: [number, number]) => v >= 0.4 && t >= this.plate.start && t < this.plate.end).map(([t]: [number, number]) => t);
  }

  // ---------------------------------------------------------------- buffer primitives
  private put(x: number, y: number, i: number) {
    x = Math.floor(x); y = Math.floor(y);
    if (x >= 0 && x < this.W && y >= 0 && y < this.H) this.buf[y * this.W + x] = i;
  }
  private rect(x: number, y: number, w: number, h: number, i: number) {
    const x0 = Math.max(0, Math.floor(x)), y0 = Math.max(0, Math.floor(y));
    const x1 = Math.min(this.W, Math.floor(x + w)), y1 = Math.min(this.H, Math.floor(y + h));
    for (let yy = y0; yy < y1; yy++) this.buf.fill(i, yy * this.W + x0, yy * this.W + Math.max(x0, x1));
  }
  /** Ordered dither of v (0..1) across the listed palette indices. */
  private ramp(x: number, y: number, v: number, stops: number[]) {
    const l = clamp(v) * (stops.length - 1);
    let k = Math.floor(l);
    if (k < stops.length - 1 && l - k > BAYER[(y & 3) * 4 + (x & 3)]!) k++;
    this.buf[y * this.W + x] = stops[k]!;
  }
  private disc(cx: number, cy: number, r: number, i: number) {
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++)
      if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r) this.put(x, y, i);
  }
  private line(x0: number, y0: number, x1: number, y1: number, i: number, dash = 0) {
    const n = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1));
    for (let k = 0; k <= n; k++) if (!dash || k % dash === 0) this.put(x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n, i);
  }
  private text(s: string, x: number, y: number, i: number, sc = 1, adv = 8) {
    for (let k = 0; k < s.length; k++) {
      const g = FONT[s[k]!];
      if (!g) continue;
      for (let c = 0; c < 5; c++) for (let r = 0; r < 7; r++) if ((g[c]! >> r) & 1) this.rect(x + k * adv * sc + c * sc, y + r * sc, sc * 2, sc, i);
    }
  }
  private digits(s: string, x: number, y: number, i: number, sc: number) {
    for (let k = 0; k < s.length; k++) {
      const g = DIG[+s[k]!]!;
      for (let r = 0; r < 5; r++) for (let c = 0; c < 3; c++) if (g[r * 3 + c] === '1') this.rect(x + (k * 4 + c) * sc, y + r * sc, sc, sc, i);
    }
  }
  /** Beats elapsed since t0 as a stepped value: +1 per beat, snapping in over ~50 ms. */
  private steps(t: number, t0: number): number {
    const au = this.ctx.audio, i0 = beatIndex(au, t0 + 1e-3), i = beatIndex(au, t);
    return i - i0 + smoothstep(0, 0.05, t - (au.beats[i] ?? t0));
  }
  private nb(t: number, t0: number) { const au = this.ctx.audio; return beatIndex(au, t) - beatIndex(au, t0 + 1e-3); }

  // ---------------------------------------------------------------- boot (p38)
  private corridor(t: number, t0: number) {
    const au = this.ctx.audio, lt = t - t0, W = this.W, Hh = this.H;
    const cam = lt * 0.9 + this.steps(t, t0) * 0.35; // dolly forward, a snap per beat
    const vx = 160, vy = 76, f = 150, HW = 1.25, CEIL = 1.5, FLOOR = 1.1;
    const count = beatIndex(au, t), bp = beatPulse(au, t, 0.1);
    this.buf.fill(G);
    // floor tiles and ceiling light strips
    for (let y = 0; y < Hh; y++) {
      const dy = y + 0.5 - vy;
      if (Math.abs(dy) < 2) continue;
      const z = (f * (dy > 0 ? FLOOR : CEIL)) / Math.abs(dy), fog = clamp(1 - z / 12);
      for (let x = 0; x < W; x++) {
        const X = ((x + 0.5 - vx) * z) / f;
        if (dy > 0) { if (((z + cam) / 1.2) % 1 < 0.05 || Math.abs(X) < 0.03) this.ramp(x, y, fog * 0.9, [G, D, M]); }
        else if (Math.abs(X) < 0.28 && ((z + cam) / 1.8) % 1 < 0.22) this.ramp(x, y, 0.3 + fog * 0.7, [G, D, M, H]);
      }
    }
    // the two walls of panels
    for (let x = 0; x < W; x++) {
      const sx = x + 0.5 - vx;
      if (Math.abs(sx) < 1) continue;
      const z = (f * HW) / Math.abs(sx);
      if (z > 13) continue;
      const side = sx < 0 ? 0 : 1, u = (z + cam) / 0.9, k = Math.floor(u), pu = u - k, fog = clamp(1 - z / 12);
      const yT = Math.max(0, Math.floor(vy - (f * CEIL) / z)), yB = Math.min(Hh - 1, Math.ceil(vy + (f * FLOOR) / z));
      const value = count + k * 5 + side * 11; // this panel's register: +1 per beat
      for (let y = yT; y <= yB; y++) {
        const Y = ((vy - (y + 0.5)) * z) / f;
        if (pu < 0.05 || pu > 0.95 || Y > 1.42 || Y < -1.0) { this.buf[y * W + x] = G; continue; }
        let v = 0.08 + 0.22 * fog; // panel face, dark blue-black metal
        let lamp = -1;
        if (Y > 0.3 && Y < 1.3) {
          const cu = (pu - 0.1) / 0.8 * 5, cv = (Y - 0.3) / 1.0 * 8, ci = Math.floor(cu), ri = Math.floor(cv);
          if (ci >= 0 && ci < 5 && (cu - ci - 0.5) ** 2 + (cv - ri - 0.5) ** 2 < 0.12) lamp = (value >> ((ri * 5 + ci) % 11)) & 1;
        } else if (Y < 0.05 && Y > -0.8) {
          const cu = pu * 4, cv = (Y + 0.8) / 0.85 * 3;
          if ((cu - Math.floor(cu) - 0.5) ** 2 + (cv - Math.floor(cv) - 0.5) ** 2 < 0.06) v = 0.55 * fog + 0.2; // knobs
        }
        if (lamp === 1) this.buf[y * W + x] = fog > 0.2 ? (bp > 0.45 && z < 5 ? S : H) : M;
        else if (lamp === 0) this.buf[y * W + x] = fog > 0.3 ? M : D;
        else this.ramp(x, y, v, [G, D, M]);
      }
    }
  }

  private accumulator(t: number, t0: number) {
    const au = this.ctx.audio, lt = t - t0, W = this.W, Hh = this.H;
    const n = 1946 + this.nb(t, this.plate.start), bp = beatPulse(au, t, 0.12), kp = kickPulse(au, t, 0.08);
    const pan = Math.round(-3 * this.steps(t, t0)); // v4: static camera, only a jolt per beat
    // residue: until the first beat after the cut every lamp is lit — p37's glowing dot grid — then they settle to digits
    const grid = t < (au.beats.find((b) => b > this.plate.start + 0.05) ?? this.plate.start + 0.58);
    for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) this.ramp(x, y, 0.32 + 0.12 * Math.sin((x - pan) * 0.02), [G, D]);
    // panel seams
    for (let s = -1; s < 3; s++) { const xs = 8 + s * 150 + pan; this.rect(xs, 0, 3, Hh, G); }
    // decade lamp columns: one lit lamp per column shows a digit (ENIAC accumulator), rows 0..9 top to bottom
    const dec = String(n).padStart(10, '0');
    for (let c = 0; c < 10; c++) {
      const x = 30 + c * 26 + pan, d = +dec[c]!;
      for (let r = 0; r < 10; r++) {
        const y = 14 + r * 10, on = r === d || grid;
        this.disc(x, y, 3.6, on ? H : G);
        if (on) { this.disc(x, y, 1.6, bp > 0.4 ? S : H); if (bp > 0.3) for (const [dx, dy] of [[-6, 0], [6, 0], [0, -6], [0, 6]]) this.put(x + dx!, y + dy!, S); }
        else this.put(x - 1, y - 1, M);
      }
    }
    // the binary register below: 16 lamps, n in binary, +1 per beat
    for (let b = 0; b < 16; b++) {
      const x = 22 + b * 17 + pan, y = 124, on = (n >> (15 - b)) & 1;
      this.rect(x - 5, y - 5, 11, 11, G);
      this.disc(x, y, 4.2 + (on ? 0.8 * kp : 0), on ? H : D);
      if (on && bp > 0.4) this.disc(x, y, 2, S);
    }
    // patch cords sagging across the bottom
    for (let k = 0; k < 4; k++) {
      const x0 = -20 + k * 90 + pan, x1 = x0 + 150, sag = 16 + 6 * k;
      for (let i = 0; i <= 160; i++) {
        const u = i / 160, x = x0 + (x1 - x0) * u, y = 146 + sag * 4 * u * (1 - u) - 4 * k;
        this.rect(x, y, 1.5, 2, k % 2 ? M : D);
      }
      this.rect(x0 - 2, 142 - 4 * k, 5, 5, H);
      this.rect(x1 - 2, 142 - 4 * k, 5, 5, H);
    }
  }

  private c64(t: number, t0: number, raster: boolean, tRaster: number) {
    const au = this.ctx.audio, W = this.W, Hh = this.H;
    const bp = beatPulse(au, t, 0.07), ph = beatPhase(au, t);
    const SX = 40, SY = 22, SW = 240, SH = 136; // 30 x 17 character cells
    const border = bp > 0.35 ? H : M; // POKE 53280: the border flips on every beat
    this.buf.fill(border);
    this.rect(SX, SY, SW, SH, D);
    const lines = ['**** SENTIENT 64 BASIC V2 ****', '', '64K RAM SYSTEM 38911 FREE', '', 'READY.'];
    lines.forEach((s, r) => this.text(s, SX + ((30 - s.length) >> 1) * 8 * (r === 0 || r === 2 ? 1 : 0), SY + 8 + r * 8, M));
    const ready = t0; // the ready shot start
    const cmd = 'SYS 49152', typed = Math.min(cmd.length, Math.max(0, Math.floor((t - ready - 0.2) / 0.08)));
    this.text(cmd.slice(0, raster ? cmd.length : typed), SX, SY + 8 + 5 * 8, M);
    let row = 6, col = raster ? 0 : typed;
    if (raster) { this.text('RUN', SX, SY + 8 + 6 * 8, M); row = 7; col = 3; }
    if (ph < 0.5) this.rect(SX + col * 8, SY + 8 + row * 8, 8, 8, M); // cursor: on for the first half of every beat
    if (!raster) return;
    // raster bars: a stack of three, bobbing on a sine, jumping 14 px per beat; in the border, then (last beat) everywhere
    const lt = t - tRaster, jump = 14 * this.steps(t, tRaster);
    const BAR = [G, D, M, H, S, H, M, D, G];
    const flood = smoothstep(0, 0.12, t - (au.beats[beatIndex(au, this.ctx.end - 0.05)] ?? this.ctx.end));
    for (let k = 0; k < 3; k++) {
      const yc = 40 + 24 * Math.sin(lt * 3.1 + k * 1.3) + k * 34 + jump;
      for (let d = -4; d <= 4; d++) {
        const y = Math.round(((yc + d * 2) % Hh + Hh) % Hh), c = BAR[d + 4]!;
        if (c === G) continue;
        for (const yy of [y, y + 1]) {
          if (yy < 0 || yy >= Hh) continue;
          const inScreen = yy >= SY && yy < SY + SH;
          if (!inScreen) this.buf.fill(c, yy * W, yy * W + W);
          else {
            const reach = Math.round(SX + (SW / 2) * flood);
            this.buf.fill(c, yy * W, yy * W + Math.min(W, reach));
            this.buf.fill(c, yy * W + Math.max(0, W - reach), yy * W + W);
          }
        }
      }
    }
  }

  // ---------------------------------------------------------------- internet (p39)
  private modem(t: number, t0: number, carrier: boolean) {
    const au = this.ctx.audio, lt = t - t0, W = this.W;
    const bp = beatPulse(au, t, 0.1), dp = t - this.plate.start;
    this.buf.fill(G);
    this.text('ATZ', 14, 10, M);
    this.text('OK', 14, 20, M);
    const num = 'ATDT 1969-1989', n = Math.min(num.length, 5 + Math.max(0, Math.floor((dp - 0.1) / 0.1)));
    this.text(num.slice(0, n), 14, 30, H);
    if (!carrier) {
      // DTMF: one tone pair per digit (a 30 ms gap between digits), a chunky scrolling waveform with a copper fill
      const di = Math.floor(dp / 0.13), gap = di > 0 && dp % 0.13 < 0.03;
      const f1 = [0.7, 0.77, 0.85, 0.94][Math.floor(hash(di, 1) * 4)]!, f2 = [1.21, 1.34, 1.48][Math.floor(hash(di, 2) * 3)]!;
      const A = gap ? 2 : 30 * (1 + 0.45 * bp), yc = 104;
      for (let x = 0; x < W; x++) {
        const u = (x + lt * 140) * 0.06;
        const y = yc - A * 0.5 * (Math.sin(u * f1 * 3.1) + Math.sin(u * f2 * 3.1 + 1));
        const y0 = Math.min(y, yc), y1 = Math.max(y, yc);
        for (let yy = Math.floor(y0); yy <= y1; yy++) this.ramp(x, yy, 0.25 + 0.5 * Math.abs(yy - yc) / 34, [G, D, M]);
        this.rect(x, y - 1, 1, 2 + (bp > 0.4 ? 1 : 0), bp > 0.4 ? S : H);
      }
      this.rect(0, yc, W, 1, D);
      return;
    }
    // carrier: the answer tone (upper lane) over the scrambled handshake (lower lane)
    const q = Math.floor(t * 30);
    for (let x = 0; x < W; x++) {
      const y1 = 70 - 14 * Math.sin((x + lt * 400) * 0.55);
      this.rect(x, y1, 1, 2, M);
      let v = 0;
      for (let k = 0; k < 4; k++) v += (hash(Math.floor((x + lt * 260) / (2 + k * 3)), k, q) - 0.5) * (1.4 - k * 0.25);
      const A = 22 * (1 + 0.8 * bp), y2 = 140 - A * v;
      const a = Math.min(y2, 140), b = Math.max(y2, 140);
      for (let yy = Math.floor(a); yy <= b; yy++) this.ramp(x, yy, 0.35 + 0.4 * Math.abs(yy - 140) / 30, [G, D, M]);
      this.rect(x, y2, 1, 2, H);
    }
    // a screech burst on every beat: an inverted band at a new place
    if (bp > 0.3) { const bx = Math.floor(hash(beatIndex(au, t), 9) * 260) + 20; this.rect(bx, 110, 18, 60, H); }
    const connect = au.beats[beatIndex(au, t0 + 1e-3) + 1] ?? t0 + 0.58;
    if (t >= connect) this.text('CONNECT 14400', 56, 88, t - connect < 0.06 ? S : H, 2, 8);
  }

  /** The sine scroller of jamo: glyphs 7x7 at scale sc (bold), advance 10*sc; returns nothing, writes the buffer. */
  private scroller(t: number, lt: number, yBase: number, sc: number, amp: number, squash: number, clipY = this.H) {
    const W = this.W, adv = 10 * sc, sx0 = Math.floor(lt * 150 + 40);
    for (let x = 0; x < W; x++) {
      const xs = x + sx0, gi = Math.floor(xs / adv), gx = xs - gi * adv, c = Math.floor(gx / sc);
      const g = JAMO[((gi % 14) + 14) % 14]!;
      const yo = yBase + amp * Math.sin(xs * 0.03 + lt * 3.2);
      for (let r = 0; r < 7; r++) {
        const on = (c < 7 && g[r]![c]) || (c > 0 && c < 8 && g[r]![c - 1]); // bold
        if (!on) continue;
        const y0 = yo + r * sc * squash, h = Math.max(1, sc * squash);
        for (const [dx, dy, col] of [[2, 2, D], [0, 0, r < 4 ? H : S]] as const)
          for (let yy = Math.floor(y0 + dy); yy < y0 + dy + h; yy++) if (yy >= 0 && yy < clipY && x + dx < W) this.buf[yy * W + x + dx] = col;
      }
    }
  }

  private copperBars(t: number, lt: number, yMid: number, spread: number, n: number, clipY: number) {
    const au = this.ctx.audio, W = this.W;
    const ph = beatPhase(au, t), hop = 4 * ph * (1 - ph); // the stack hops and lands on the beat
    const BAR = [H, S, M, M, D, D];
    const order = Array.from({ length: n }, (_, k) => k).sort((a, b) => Math.cos(lt * 2.2 + a * 0.9) - Math.cos(lt * 2.2 + b * 0.9));
    for (const k of order) {
      const back = Math.cos(lt * 2.2 + k * 0.9) < 0;
      const yc = yMid + spread * Math.sin(lt * 2.2 + k * 0.9) - 16 * hop;
      for (let d = -6; d <= 6; d++) {
        const y = Math.round(yc + d);
        if (y < 0 || y >= clipY) continue;
        const c = BAR[Math.min(5, Math.abs(d) + (back ? 1 : 0))]!;
        this.buf.fill(c, y * W, y * W + W);
      }
    }
  }

  private copper(t: number, t0: number, mirror: boolean) {
    const au = this.ctx.audio, lt = t - t0, W = this.W, Hh = this.H;
    const squash = 1 - 0.3 * beatPulse(au, t, 0.07), bp = beatPulse(au, t, 0.1);
    this.buf.fill(G);
    if (!mirror) {
      this.copperBars(t, lt, 84, 62, 6, Hh);
      this.scroller(t, lt, 112, 3, 16 + 8 * bp, squash);
      return;
    }
    const HZ = 112;
    this.copperBars(t, lt, 44, 30, 3, HZ);
    this.scroller(t, lt + 1.2, 34, 5, 10 + 6 * bp, squash, HZ);
    this.buf.fill(bp > 0.4 ? H : M, HZ * W, HZ * W + W);
    // the lower half mirrors the upper, darker and rippling (the ripple kicks on the beat)
    const DARK = [G, D, D, M, M, M];
    for (let y = HZ + 1; y < Hh; y++) {
      const dy = y - HZ, ripple = (1.5 + 3 * bp) * Math.sin(dy * 0.5 - lt * 9);
      const sy = Math.round(HZ - dy * 1.3 + ripple);
      for (let x = 0; x < W; x++) {
        const sxp = Math.round(x + 2.5 * Math.sin(dy * 0.35 + lt * 6));
        const src = sy >= 0 && sxp >= 0 && sxp < W ? this.buf[sy * W + sxp]! : G;
        this.buf[y * W + x] = (x + y) & 1 && dy > 30 ? G : DARK[src]!;
      }
    }
  }

  private net(t: number, t0: number, flood: boolean, tFlood: number) {
    const au = this.ctx.audio, lt = t - this.list.find((s) => s.s.fx === 'net')!.t;
    const W = this.W, Hh = this.H, bp = beatPulse(au, t, 0.1);
    this.buf.fill(G);
    const ang = 0.12 * lt, sc = 1 + 0.05 * lt, ca = Math.cos(ang), sa = Math.sin(ang);
    const pos = this.nodes.map((n) => { const x = (n.x - 160) * sc, y = (n.y - 90) * sc; return { x: 160 + x * ca - y * sa, y: 90 + x * sa + y * ca }; });
    const netStart = this.list.find((s) => s.s.fx === 'net')!.t;
    const ks = this.kicks.filter((k) => k >= netStart - 1e-3);
    let lit = 1 + ks.filter((k) => k <= t).length;
    if (flood) lit = this.nodes.length;
    const litAt = (i: number) => (i === 0 ? netStart : flood && i > ks.length ? tFlood : ks[i - 1] ?? tFlood);
    // the tree: dotted when dark, solid once the child is lit; a packet runs down each new edge
    this.nodes.forEach((n, i) => {
      if (n.parent < 0) return;
      const a = pos[n.parent]!, b = pos[i]!;
      if (i < lit) {
        const u = clamp((t - litAt(i)) / 0.1);
        this.line(a.x, a.y, a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u, M);
        if (u < 1) this.rect(a.x + (b.x - a.x) * u - 1, a.y + (b.y - a.y) * u - 1, 3, 3, S);
      } else this.line(a.x, a.y, b.x, b.y, D, 3);
    });
    pos.forEach((p, i) => {
      if (i >= lit) { this.rect(p.x - 1, p.y - 1, 2, 2, D); return; }
      const age = t - litAt(i), r = 1 + (bp > 0.3 ? 1 : 0);
      if (age < 0.18) { const rr = 2 + age * 40; for (let a = 0; a < 16; a++) this.put(p.x + rr * Math.cos(a * 0.39), p.y + rr * Math.sin(a * 0.39), S); }
      this.rect(p.x - r, p.y - r, 2 * r + 1, 2 * r + 1, age < 0.1 ? S : H);
    });
    if (!flood) return;
    // the nodes flood into data: streams pour up and down from every node, growing through the last beat
    const u = clamp((t - tFlood) / Math.max(0.1, this.ctx.end - tFlood));
    const q = Math.floor(t * 20);
    pos.forEach((p, i) => {
      const len = u * (60 + 120 * hash(i, 3));
      for (let s = -2; s <= 2; s++) {
        const x = Math.round(p.x + s * 2);
        if (x < 0 || x >= W) continue;
        for (let d = 3; d < len; d++) for (const y of [Math.round(p.y + d), Math.round(p.y - d)])
          if (y >= 0 && y < Hh && hash(x, Math.floor(y / 3), q) < 0.55) this.buf[y * W + x] = d < 8 ? S : H;
      }
    });
  }

  // ---------------------------------------------------------------- ai (p40)
  /** Ikeda barcode strips across [y0, y1): each strip holds for the beat and re-rolls once per beat (hold, then cut). */
  private barcode(t: number, _lt: number, y0: number, y1: number, strips: number, seed: number) {
    const W = this.W, bi = beatIndex(this.ctx.audio, t);
    let y = y0;
    for (let j = 0; j < strips; j++) {
      const hgt = j === strips - 1 ? y1 - y : Math.round(((y1 - y0) / strips) * (0.6 + 0.8 * hash(j, bi, seed)));
      const w = 1 + Math.floor(hash(j, bi, 2, seed) * 5), dens = 0.3 + 0.35 * hash(j, bi, 3, seed);
      const off = Math.floor(hash(j, bi, 6, seed) * 997); // holds for the beat, jumps on the next (no strobe)
      const yb = Math.min(y1, y + hgt);
      for (let x = 0; x < W; x++) {
        if (hash(Math.floor((x + off) / w), j, bi, seed) >= dens) continue;
        for (let yy = y; yy < yb - 2; yy++) this.buf[yy * W + x] = D;
      }
      y = yb;
      if (y >= y1) break;
    }
  }

  private flood(t: number, t0: number, matrix: boolean) {
    const au = this.ctx.audio, lt = t - t0, W = this.W, Hh = this.H, bi = beatIndex(au, t);
    this.buf.fill(G);
    const q = Math.floor(t * 24); // readouts tick on a fine clock (a thin strip only)
    if (!matrix) {
      this.barcode(t, lt, 28, Hh - 28, 6, 1);
      for (let k = 0; k < 40; k++) this.digits(String(Math.floor(hash(k, q) * 10)), 12 + k * 24, 10, D, 2);
      for (let k = 0; k < 40; k++) this.digits(String(Math.floor(hash(k, q, 5) * 10)), 12 + k * 24, Hh - 20, M, 2);
    } else {
      this.barcode(t, lt, 0, 300, 3, 7);
      // bit matrix: 6 px squares on an 8 px pitch, steps one row per beat (a 50 ms slide)
      const shift = this.steps(t, t0), top = 316;
      for (let r = -1; r < 28; r++) {
        const y = top + Math.round((r - (shift % 1)) * 8);
        if (y < top || y + 6 > Hh) continue;
        const row = r + Math.floor(shift);
        for (let c = 0; c < 120; c++) if (hash(c, row, 13) < 0.45) this.rect(c * 8, y, 6, 6, hash(c, row, 14) < 0.04 ? M : D);
      }
      this.rect(0, 306, W, 2, M);
    }
    // motion inside the beat: a thin inverted scan band sweeps down once per beat (small area, not a flash)
    const sy = Math.floor(beatPhase(au, t) * (Hh - 10));
    for (let y = sy; y < sy + 8; y++) for (let x = 0; x < W; x++) { const o = y * W + x; this.buf[o] = this.buf[o] === G ? D : G; }
    // the one accent: a signal line that jumps once per beat
    this.rect(Math.floor(hash(bi, 21) * (W - 40)) + 20, 0, 3, Hh, S);
  }

  /** Face darkness 0..1 at buffer point (x, y): a close-up, lit from the left, the right eye at the anchor. */
  private faceD(x: number, y: number): number {
    // measured in eye-disc units: k = 1 at a 66 px disc; the disc is 38 px, so the whole face fits the frame
    const k = EYE_R2 / 66, ex = this.eye.x, ey = this.eye.y, lx = ex - 290 * k, cx = (ex + lx) / 2;
    const u = (x - cx) / k, v = (y - ey) / k; // face space, origin between the eyes at eye height
    const hx = u / 340, hy = (v - 120) / 460, rr = hx * hx + hy * hy;
    if (rr > 1) return 0.05;
    let d = 0.2 + 0.2 * clamp(u / 340); // skin, darker on the shadow side
    if (rr > 0.86) d = 0.62; // jaw and cheek contour
    if (v < -150 + 40 * hx * hx) d = 0.86; // hair
    for (const bu of [-145, 145]) if (Math.abs(v - (-100 + 0.08 * (u - bu))) < 13 && Math.abs(u - bu) < 92) d = 0.82; // brows
    const dl = Math.hypot(u + 145, v);
    if (dl < 84) d = dl < 58 ? 0.95 : 0.5; // the other eye and its socket
    if (Math.hypot(u - 145, v) < 92) d = 0.45; // socket around the disc
    if (u > 6 && u < 30 && v > 20 && v < 175) d = Math.max(d, 0.5); // nose bridge shadow
    for (const nu of [-36, 44]) if (Math.hypot(u - nu, v - 188) < 17) d = 0.88; // nostrils
    if (v > 272 && v < 298 && Math.abs(u) < 118 - 0.002 * (v - 285) ** 2) d = 0.9; // mouth
    if (v > 304 && v < 318 && Math.abs(u) < 76) d = Math.max(d, 0.5); // under the lip
    return d;
  }

  private face(t: number, t0: number, eyeOnly: boolean, tEye: number) {
    const au = this.ctx.audio, W = this.W, Hh = this.H, B = 12;
    const faceStart = this.list.find((s) => s.s.fx === 'face')!.t;
    const step = Math.min(3, this.nb(t, faceStart) + 1), cond = step / 3; // condenses a step per beat
    const bi = beatIndex(au, t), bp = beatPulse(au, t, 0.1);
    this.buf.fill(G);
    const R1 = EYE_R1, R2 = EYE_R2;
    for (let by = 0; by < Hh / B; by++) for (let bx = 0; bx < W / B; bx++) {
      const cxb = bx * B + B / 2, cyb = by * B + B / 2;
      if (Math.hypot(cxb - this.eye.x, cyb - this.eye.y) < R2 + 8) continue; // a clear ring around the disc
      if (eyeOnly && t >= tEye + 0.03 + 0.3 * hash(bx, by, 31)) continue; // the face drops away through the last beat
      const locked = hash(bx, by, 7) < cond;
      const dens = locked ? this.faceD(cxb, cyb) : 0.8 * hash(bx, by, bi);
      const seed = locked ? 0 : bi;
      for (let x = bx * B; x < bx * B + B; x++) if (hash(x, by, seed, 3) < dens) for (let y = by * B; y < by * B + B - 1; y++) this.buf[y * W + x] = D;
    }
    // the eye: a black pupil inside a signal annulus; the annulus' inner edge pulses on the beat, the outer edge holds
    this.disc(this.eye.x, this.eye.y, R2, S);
    this.disc(this.eye.x, this.eye.y, R1 - 4 * bp * (eyeOnly ? 0 : 1), D);
    if (!eyeOnly) this.disc(this.eye.x - 9, this.eye.y - 9, 4, H); // catch-light
  }

  // ---------------------------------------------------------------- frame
  private paint() {
    const B = this.buf, Dd = this.img.data, C = this.rgb;
    for (let o = 0, n = B.length; o < n; o++) {
      const c = C[B[o]!]!;
      Dd[o * 4] = c[0]; Dd[o * 4 + 1] = c[1]; Dd[o * 4 + 2] = c[2]; Dd[o * 4 + 3] = 255;
    }
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, audio } = this.ctx;
    const t = f.t, sh = shotAt(this.list, t), s = sh.shot.s;
    const fx = s.fx as string, stage = s.stage as string;
    const tOf = (st: string) => this.list.find((x) => x.s.stage === st)?.t ?? sh.t0;
    if (fx === 'eniac') stage === 'corridor' ? this.corridor(t, sh.t0) : this.accumulator(t, sh.t0);
    else if (fx === 'c64') this.c64(t, tOf('ready'), stage === 'raster', tOf('raster'));
    else if (fx === 'modem') this.modem(t, sh.t0, stage === 'carrier');
    else if (fx === 'copper') this.copper(t, tOf('scroll'), stage === 'mirror');
    else if (fx === 'net') this.net(t, sh.t0, stage === 'flood', tOf('flood'));
    else if (fx === 'flood') this.flood(t, tOf('bars'), stage === 'matrix');
    else this.face(t, sh.t0, stage === 'eye', tOf('eye'));
    this.paint();
    this.low.ctx.putImageData(this.img, 0, 0);
    this.low.upload();

    clearRT(renderer, out, plin(this.P, 'ground'));
    this.ctx.comp.draw(renderer, this.low.texture, out, { mode: 'normal' });
    if (this.scan) this.ctx.comp.draw(renderer, this.scan.texture, out, { mode: 'normal' });

    const db = downbeatPulse(audio, t, 0.16), kp = kickPulse(audio, t, 0.08), bp = beatPulse(audio, t, 0.08);
    const px = 1080 / this.H;
    if (this.variant === 'ai') {
      // crisp: no grain/vignette/aberration; the last beat holds still so the disc sits exactly on the anchor
      const still = stage === 'eye';
      return { zoom: still ? 1 : 1 + 0.05 * db, flash: 0, shake: [0, 0], ca: 0, grain: 0.015, vignette: 0 };
    }
    const push = fx === 'c64' ? 0.05 * clamp((t - tOf('ready')) / 2.3) : 0; // the close-up keeps pushing in
    const land = fx === 'copper' ? bp : 0;
    return {
      zoom: 1 + push + 0.08 * db + 0.02 * kp,
      flash: 0.18 * downbeatPulse(audio, t, 0.03),
      shake: [px * Math.round(1.5 * land * Math.sin(t * 97)), px * Math.round(1.5 * land * Math.cos(t * 83))],
      ca: 0,
      grain: 0.03,
      vignette: 0.3,
    };
  }

  override dispose() { this.low?.texture.dispose(); this.scan?.texture.dispose(); }
}
