// SIGN — real hand-bent neon on a dark wall: glass tubes with a plasma core and a tight glow, electrodes, standoff
// clips, GTO wire to a transformer. A concrete object, never ambient neon haze.
// Variants (data/edit.json):
//   neon (p06): the owned line is the sign. Every glyph contour is one tube; a character's tubes flicker on stroke by
//               stroke at its own syllable start (1 on-frame, 2 off-frames, then on; plasma 2→8 px). The border tubes
//               ignite one segment per beat and every lit tube surges on the beat. Shots (./sign.shots): wall frontal
//               → tight on the igniting word (electrode buzz) → oblique standoff view → wide flood; all tubes cut
//               out at the plate end.
//   ring (p36): a Dyson shell drawn as a painter-sorted panel mesh. Bar 1: four clamps slam onto the equator per
//               beat and that quarter of the neon ring ignites. Bar 2: the ring cuts the shell and the four upper
//               sections hinge open one per beat, exposing the star. The ring dies at the end.
// Accent (cyan) only behind ctx.params.accent: the Latin words' tubes (neon) and the ring tube (ring).
import type * as THREE from 'three';
import { Scene, type Frame, type PostOverrides } from '../engine/scene';
import { Layer2D, clearRT } from '../engine/gl';
import { LIN, rgba, type PaletteKey } from '../engine/palette';
import { drawLyric, layoutLine, ownedLines, F, type LineLayout } from '../engine/lyric';
import { ot } from '../engine/type';
import { beatPulse, kickPulse, downbeatPulse } from '../engine/beat';
import { beatTimes, stateAt, type PlateInfo, type Shot } from '../engine/shots';
import { hash, clamp, lerp, smoothstep, ease } from '../engine/util';
import type { Line } from '../engine/lyrics';
import { shots, type NeonFrame, type RingFrame } from './sign.shots';

const W = 1920, H = 1080;
const FR = 1 / 60;
type C2 = CanvasRenderingContext2D;
type P = { x: number; y: number };

/** Neon ignition: 1 frame on, 2 frames off, then on (0 before t0). */
function flickerOn(tt: number): number {
  if (tt < 0) return 0;
  if (tt < FR) return 0.75;
  if (tt < 3 * FR) return 0.04;
  return 1;
}
/** Plasma width 2→8 px over the first 0.18 s after ignition. */
const plasmaW = (tt: number) => lerp(2, 8, ease.outCubic(clamp((tt - 3 * FR) / 0.18)));

/** One tube: wall shadow, glass, and (lit > 0) the plasma core with a tight glow. */
function tube(c: C2, path: Path2D, col: PaletteKey, w: number, lit: number, sh: P, glass = 9, cap: CanvasLineCap = 'round') {
  c.lineJoin = 'round'; c.lineCap = cap;
  c.save(); c.translate(sh.x, sh.y); c.strokeStyle = rgba('ink', 0.75); c.lineWidth = glass + 5; c.stroke(path); c.restore();
  c.strokeStyle = rgba('graphite', 0.55 - 0.25 * clamp(lit)); c.lineWidth = glass + 2; c.stroke(path);
  c.strokeStyle = rgba('ink2', 1); c.lineWidth = glass - 1; c.stroke(path);
  if (lit > 0.01) {
    c.globalCompositeOperation = 'lighter';
    c.strokeStyle = rgba(col, 0.045 * lit); c.lineWidth = w * 9; c.stroke(path);
    c.strokeStyle = rgba(col, 0.16 * lit); c.lineWidth = w * 3.6; c.stroke(path);
    c.strokeStyle = rgba(col, Math.min(1, 0.9 * lit)); c.lineWidth = w * 1.3; c.stroke(path);
    c.strokeStyle = rgba('bone', Math.min(1, 0.7 * lit)); c.lineWidth = Math.max(1, w * 0.38); c.stroke(path);
    c.globalCompositeOperation = 'source-over';
  }
  // glass reflection
  c.save(); c.translate(-glass * 0.22, -glass * 0.26);
  c.strokeStyle = rgba('bone', 0.14 + 0.1 * clamp(lit)); c.lineWidth = 1; c.stroke(path);
  c.restore();
}

type Contour = { path: Path2D; p0: P };
const glyphCache = new Map<string, Contour[]>();
/** Glyph outline split into contours (one tube each), at the origin (left edge, baseline). */
function contours(family: string, size: number, ch: string): Contour[] {
  const key = `${family}|${size.toFixed(2)}|${ch}`;
  let cs = glyphCache.get(key);
  if (cs) return cs;
  cs = [];
  let cur: Path2D | null = null;
  for (const m of ot(family).charToGlyph(ch).getPath(0, 0, size).commands as any[]) {
    if (m.type === 'M') { cur = new Path2D(); cur.moveTo(m.x, m.y); cs.push({ path: cur, p0: { x: m.x, y: m.y } }); }
    else if (!cur) continue;
    else if (m.type === 'L') cur.lineTo(m.x, m.y);
    else if (m.type === 'Q') cur.quadraticCurveTo(m.x1, m.y1, m.x, m.y);
    else if (m.type === 'C') cur.bezierCurveTo(m.x1, m.y1, m.x2, m.y2, m.x, m.y);
    else if (m.type === 'Z') cur.closePath();
  }
  // stroke order: top-left first, as a sign bender would run them
  cs.sort((a, b) => a.p0.y + a.p0.x * 0.5 - (b.p0.y + b.p0.x * 0.5));
  glyphCache.set(key, cs);
  return cs;
}

// ---------------------------------------------------------------- neon plate geometry (world = 1920x1080 wall)
const ROW_Y = [470, 735];
const SIZE = 205;

export default class Sign extends Scene {
  private layer!: Layer2D;
  private list: Shot[] = [];
  private plate!: PlateInfo;
  private rows: Line[] = [];
  private lays: LineLayout[] = [];
  private beats: number[] = [];

  override init() {
    this.plate = this.ctx.params as PlateInfo;
    this.list = shots(this.plate, this.ctx.audio);
    this.layer = new Layer2D();
    this.beats = beatTimes(this.ctx.audio, this.ctx.start - 1e-3, this.ctx.end + 0.5);
    const lines = ownedLines(this.ctx);
    // the sign is bent in two rows: each owned line splits at its middle word
    for (const l of lines) {
      const k = Math.ceil(l.words.length / 2);
      for (const ws of [l.words.slice(0, k), l.words.slice(k)]) {
        if (!ws.length) continue;
        this.rows.push({ ...l, words: ws, text: ws.map((w) => w.w).join(' '), start: ws[0]!.start, end: ws[ws.length - 1]!.end });
      }
    }
  }

  private accentOr(fallback: PaletteKey): PaletteKey {
    return this.ctx.params.accent ? 'accent' : fallback;
  }

  // ============================================================== neon
  private layouts(c: C2) {
    if (!this.lays.length) this.lays = this.rows.map((r) => layoutLine(c, r, F.hangul(), SIZE, 1480));
    return this.lays;
  }

  /** Centre (world) of word wi of row ri. */
  private wordCentre(ri: number, wi: number): P {
    const lay = this.lays[ri]!, wb = lay.words[wi]!;
    return { x: W / 2 - lay.width / 2 + wb.x + wb.w / 2, y: ROW_Y[ri % 2]! - lay.size * 0.35 };
  }

  /** Camera focus for the tight/oblique shots: eases from word to word as each one starts. */
  private focus(t: number): P {
    const all: { t: number; p: P }[] = [];
    this.rows.forEach((r, ri) => r.words.forEach((w, wi) => all.push({ t: w.start, p: this.wordCentre(ri, wi) })));
    let i = 0;
    for (let k = 0; k < all.length; k++) if (all[k]!.t <= t) i = k;
    const a = all[Math.max(0, i - 1)]!.p, b = all[i]!.p;
    const u = ease.inOutCubic(clamp((t - all[i]!.t) / 0.28));
    return { x: lerp(a.x, b.x, u), y: lerp(a.y, b.y, u) };
  }

  private wall(c: C2) {
    c.fillStyle = rgba('ink2', 1);
    c.fillRect(-900, -700, W + 1800, H + 1400);
    const bw = 132, bh = 46;
    for (let r = -16; r < 40; r++) {
      const off = r % 2 ? bw / 2 : 0;
      for (let q = -8; q < 23; q++) {
        const v = hash(q, r, 5);
        c.fillStyle = rgba(v > 0.5 ? 'ink' : 'graphite', v > 0.5 ? 0.12 + 0.35 * (v - 0.5) : 0.03 + 0.08 * v);
        c.fillRect(q * bw + off, r * bh, bw, bh);
      }
    }
  }

  private mortar(c: C2) {
    const bw = 132, bh = 46;
    c.strokeStyle = rgba('ink', 0.7);
    c.lineWidth = 3;
    c.beginPath();
    for (let r = -16; r < 40; r++) {
      c.moveTo(-900, r * bh); c.lineTo(W + 900, r * bh);
      const off = r % 2 ? bw / 2 : 0;
      for (let q = -8; q < 23; q++) { c.moveTo(q * bw + off, r * bh); c.lineTo(q * bw + off, (r + 1) * bh); }
    }
    c.stroke();
  }

  /** Border frame tubes: 8 segments around the sign, one ignites per beat. */
  private border(): { path: Path2D; t0: number }[] {
    const x0 = 250, x1 = W - 250, y0 = 250, y1 = 845, r = 60;
    const segs: [P, P][] = [];
    const top = [x0 + r, (x0 + x1) / 2, x1 - r], bot = [x1 - r, (x0 + x1) / 2, x0 + r];
    segs.push([{ x: top[0]!, y: y0 }, { x: top[1]! - 20, y: y0 }], [{ x: top[1]! + 20, y: y0 }, { x: top[2]!, y: y0 }]);
    segs.push([{ x: x1, y: y0 + r }, { x: x1, y: y1 - r }]);
    segs.push([{ x: bot[0]!, y: y1 }, { x: bot[1]! + 20, y: y1 }], [{ x: bot[1]! - 20, y: y1 }, { x: bot[2]!, y: y1 }]);
    segs.push([{ x: x0, y: y1 - r }, { x: x0, y: y0 + r }]);
    const inPlate = this.beats.filter((b) => b >= this.ctx.start + 0.05);
    const out = segs.map(([a, b], i) => {
      const p = new Path2D(); p.moveTo(a.x, a.y); p.lineTo(b.x, b.y);
      return { path: p, t0: inPlate[i] ?? Infinity };
    });
    // the four corner bends
    const corners: [number, number, number, number][] = [[x0, y0, 1, 1], [x1, y0, -1, 1], [x1, y1, -1, -1], [x0, y1, 1, -1]];
    corners.forEach(([cx, cy, sx, sy], i) => {
      const p = new Path2D();
      p.moveTo(cx, cy + sy * r); p.quadraticCurveTo(cx, cy, cx + sx * r, cy);
      out.push({ path: p, t0: inPlate[6 + (i >> 1)] ?? Infinity });
    });
    return out;
  }

  private renderNeon(c: C2, f: Frame): PostOverrides {
    const { audio } = this.ctx;
    const t = f.t;
    const fr = stateAt(this.list, t).frame as NeonFrame;
    const lays = this.layouts(c);
    const cut = t >= this.ctx.end - 3 * FR; // exit: every tube cuts out on the plate's last beat
    const bp = beatPulse(audio, t, 0.14), kp = kickPulse(audio, t, 0.1), dp = downbeatPulse(audio, t, 0.25);
    const surge = cut ? 0 : 1 + 0.45 * bp; // every lit tube surges on the beat
    const plasmaKick = 1.6 * kp;
    const floodT = this.list.find((s) => s.s.frame === 'flood')?.t ?? this.ctx.end;

    // camera
    const fc = this.focus(t);
    let s = 1, fx = W / 2, fy = 590, shx = 0, shy = 0, skew = 0, sq = 1;
    let sh: P = { x: 7, y: 9 };
    const buzz = (hash(Math.floor(t * 60), 11) - 0.5);
    if (fr === 'tight') { s = 2.35; fx = fc.x; fy = fc.y; shx = buzz * 5; shy = (hash(Math.floor(t * 60), 12) - 0.5) * 3; sh = { x: 9, y: 11 }; }
    if (fr === 'oblique') { s = 1.6; fx = fc.x + 80; fy = fc.y + 20; skew = 0.17; sq = 0.84; sh = { x: 26, y: 8 }; }
    if (fr === 'flood') { s = lerp(0.9, 1.0, ease.outCubic(clamp((t - floodT) / 0.5))); fy = 560; sh = { x: 5, y: 7 }; }

    c.save();
    c.translate(W / 2 + shx, H / 2 + shy);
    c.transform(s * sq, s * skew, 0, s, 0, 0);
    c.translate(-fx, -fy);
    this.wall(c);

    // light spill on the brick, per lit word (the wide shot floods)
    const flood = fr === 'flood' && !cut ? 1 : 0;
    c.globalCompositeOperation = 'lighter';
    this.rows.forEach((r, ri) => r.words.forEach((w, wi) => {
      const lit = cut ? 0 : flickerOn(t - w.start);
      if (lit <= 0.01) return;
      const p = this.wordCentre(ri, wi), rad = lays[ri]!.words[wi]!.w * (0.9 + 0.7 * flood) + 160;
      const col: PaletteKey = /[A-Za-z]/.test(w.w) ? this.accentOr('ember') : 'signal';
      const g = c.createRadialGradient(p.x, p.y, 0, p.x, p.y, rad);
      g.addColorStop(0, rgba(col, (0.2 + 0.1 * flood) * lit * surge * (col === 'signal' ? 1 : 0.4)));
      g.addColorStop(1, rgba(col, 0));
      c.fillStyle = g;
      c.fillRect(p.x - rad, p.y - rad, rad * 2, rad * 2);
    }));
    c.globalCompositeOperation = 'source-over';
    this.mortar(c);

    // transformer + GTO wire from every word's electrodes
    const tx = W - 330, ty = 905;
    c.strokeStyle = rgba('graphite', 0.8); c.lineWidth = 2.5;
    this.rows.forEach((_r, ri) => lays[ri]!.words.forEach((wb) => {
      const x0 = W / 2 - lays[ri]!.width / 2 + wb.x + 14, x1 = x0 + wb.w - 28, y = ROW_Y[ri % 2]! + 26;
      for (const x of [x0, x1]) {
        c.beginPath(); c.moveTo(x, y + 8);
        c.bezierCurveTo(x, y + 120, tx + (x - tx) * 0.3, ty - 40, tx + 20, ty);
        c.stroke();
      }
    }));
    c.fillStyle = rgba('ink', 1); c.fillRect(tx, ty - 20, 190, 110);
    c.strokeStyle = rgba('graphite', 0.9); c.lineWidth = 2; c.strokeRect(tx, ty - 20, 190, 110);
    c.fillStyle = rgba('graphite', 1); c.font = `18px "${F.mono(500)}"`; c.textAlign = 'left';
    c.fillText('NST 15kV 30mA', tx + 16, ty + 16);
    c.fillText('CLASS 2  60Hz', tx + 16, ty + 44);

    // border tubes: one segment ignites per beat
    for (const b of this.border()) {
      const tt = t - b.t0;
      tube(c, b.path, 'signal', plasmaW(tt) + plasmaKick * (tt > 0 ? 1 : 0), cut ? 0 : flickerOn(tt) * surge * 0.85, sh, 8);
    }

    // the line itself: every glyph contour is a tube, lit stroke by stroke from its syllable start
    this.rows.forEach((row, ri) => {
      const size = lays[ri]!.size;
      drawLyric(c, row, t, {
        x: W / 2, y: ROW_Y[ri % 2]!, family: F.hangul(), size: SIZE, maxWidth: 1480, align: 'center',
        lead: row.start - this.ctx.start + 0.2, unsungAlpha: 1,
        drawChar: (c2, ch, st) => {
          const w = row.words[st.word]!;
          const s0 = (w.syl?.[st.syl] ?? [w.start, w.end])[0];
          const col: PaletteKey = /[A-Za-z]/.test(ch) ? this.accentOr('ember') : 'signal';
          contours(F.hangul(), size, ch).forEach((ct, k) => {
            const tt = t - (s0 + k * 0.05);
            const lit = st.sung && !cut ? flickerOn(tt) * surge : 0;
            tube(c2, ct.path, col, plasmaW(tt) + (lit > 0 ? plasmaKick : 0), lit, sh);
            if (k === 0) { // standoff clip at the start of each glyph
              c2.fillStyle = rgba('graphite', 1); c2.beginPath(); c2.arc(ct.p0.x, ct.p0.y, 6, 0, Math.PI * 2); c2.fill();
              c2.fillStyle = rgba('ink', 1); c2.beginPath(); c2.arc(ct.p0.x, ct.p0.y, 2.5, 0, Math.PI * 2); c2.fill();
            }
          });
        },
      });
    });

    // electrodes at each word's ends (housings through the wall); they buzz while the word is lit
    this.rows.forEach((r, ri) => lays[ri]!.words.forEach((wb, wi) => {
      const x0 = W / 2 - lays[ri]!.width / 2 + wb.x + 14, x1 = x0 + wb.w - 28, y = ROW_Y[ri % 2]! + 26;
      const lit = cut ? 0 : flickerOn(t - r.words[wi]!.start);
      const col: PaletteKey = /[A-Za-z]/.test(r.words[wi]!.w) ? this.accentOr('ember') : 'signal';
      for (const x of [x0, x1]) {
        c.fillStyle = rgba('ink', 1); c.fillRect(x - 13, y - 8, 26, 16);
        c.strokeStyle = rgba('graphite', 1); c.lineWidth = 2; c.strokeRect(x - 13, y - 8, 26, 16);
        if (lit > 0) {
          const hum = 0.55 + 0.45 * hash(Math.floor(t * 120), x, 3);
          c.globalCompositeOperation = 'lighter';
          c.fillStyle = rgba(col, 0.8 * lit * hum); c.fillRect(x - 9, y - 3, 18, 6);
          c.globalCompositeOperation = 'source-over';
        }
      }
    }));
    c.restore();

    const floodIn = fr === 'flood' ? Math.exp(-(t - floodT) / 0.15) : 0;
    const bloom = cut ? 0 : { front: 0.35, tight: 0.5, oblique: 0.45, flood: 0.75 }[fr];
    return {
      bloom, bloomThreshold: 0.72, bloomRadius: fr === 'flood' ? 0.9 : 0.7, halation: cut ? 0 : 0.25,
      zoom: 1 + 0.012 * dp + 0.006 * bp, flash: 0.12 * floodIn, shake: [0, 0],
    };
  }

  // ============================================================== ring
  private renderRing(c: C2, f: Frame): PostOverrides {
    const { audio } = this.ctx;
    const t = f.t;
    const st = stateAt(this.list, t);
    const fr = st.frame as RingFrame;
    const bar2 = this.list.find((s) => s.s.frame === 'cut')?.t ?? (this.ctx.start + this.ctx.end) / 2;
    const b1 = beatTimes(audio, this.ctx.start - 1e-3, bar2 - 1e-3), b2 = beatTimes(audio, bar2 - 1e-3, this.ctx.end - 1e-3);
    const bp = beatPulse(audio, t, 0.12), kp = kickPulse(audio, t, 0.1), dp = downbeatPulse(audio, t, 0.3);

    // camera (pitch el, scale S, centre)
    const cam = { equator: [0.1, 820, 1180, 610], orbit: [0.45, 380, 960, 560], cut: [0.24, 440, 960, 610], into: [1.05, 390, 960, 540] }[fr];
    const [el, S0, cx, cy] = cam as [number, number, number, number];
    const S = S0 * (1 + 0.05 * bp);
    const face = (q: number) => (q + 0.5) * (Math.PI / 2) + Math.PI / 2; // yaw that turns quarter q to the camera
    let yaw = face(3) + 0.22 * Math.max(0, t - bar2);
    if (t < bar2) {
      let q = 0;
      for (let k = 0; k < b1.length; k++) if (t >= b1[k]! - 1e-6) q = k;
      const u = ease.outBack(clamp((t - (b1[q] ?? t)) / 0.16));
      yaw = lerp(face(q - 1) + (q === 0 ? 0.5 : 0), face(q), u) - 0.25;
    }
    const ce = Math.cos(el), se = Math.sin(el), cyw = Math.cos(yaw), syw = Math.sin(yaw);
    const view = (v: [number, number, number]): [number, number, number] => {
      const x = v[0] * cyw + v[2] * syw, z = -v[0] * syw + v[2] * cyw;
      return [x, v[1] * ce + z * se, z * ce - v[1] * se];
    };
    const proj = (v: [number, number, number]): P & { z: number } => {
      const [x, y, z] = view(v);
      const k = 1 / (1 + z * 0.14);
      return { x: cx + S * x * k, y: cy - S * y * k, z };
    };

    // petal opening: petal q opens on beat q of bar 2 (snap with a small overshoot)
    const openAt = (q: number) => {
      const tt = t - (b2[q] ?? Infinity);
      if (tt < 0) return 0;
      const u = clamp(tt / 0.3);
      return ease.outBack(u);
    };
    const petalPt = (lat: number, lon: number, q: number, r = 1): [number, number, number] => {
      const p: [number, number, number] = [r * Math.cos(lat) * Math.cos(lon), r * Math.sin(lat), r * Math.cos(lat) * Math.sin(lon)];
      if (lat < -1e-6 || q < 0) return p;
      const th = -openAt(q) * 2.05;
      if (th === 0) return p;
      const lm = (q + 0.5) * (Math.PI / 2), hx = Math.cos(lm), hz = Math.sin(lm);
      const d: [number, number, number] = [-hz, 0, hx];
      const v: [number, number, number] = [p[0] - hx, p[1], p[2] - hz];
      const cth = Math.cos(th), sth = Math.sin(th), dv = d[0] * v[0] + d[2] * v[2];
      const cr: [number, number, number] = [d[1] * v[2] - d[2] * v[1], d[2] * v[0] - d[0] * v[2], d[0] * v[1] - d[1] * v[0]];
      return [
        hx + v[0] * cth + cr[0] * sth + d[0] * dv * (1 - cth),
        v[1] * cth + cr[1] * sth,
        hz + v[2] * cth + cr[2] * sth + d[2] * dv * (1 - cth),
      ];
    };

    // background: a few fixed stars
    for (let i = 0; i < 70; i++) {
      c.fillStyle = rgba('bone', 0.15 + 0.35 * hash(i, 9));
      c.fillRect(hash(i, 1) * W, hash(i, 2) * H, 2, 2);
    }

    type Item = { z: number; draw: () => void };
    const items: Item[] = [];
    const ringCol = this.accentOr('signal');
    const cutFlare = t >= bar2 ? Math.exp(-(t - bar2) / 0.35) : 0;
    const opened = [0, 1, 2, 3].reduce((a, q) => a + clamp(openAt(q)), 0) / 4;
    const dying = smoothstep(this.ctx.end - 0.45, this.ctx.end - 0.05, t);
    const quarterLit = (q: number) => {
      const tt = t - ((b1[q] ?? Infinity) + 2 * FR);
      const on = flickerOn(tt);
      const dieFlick = dying > 0 ? (hash(Math.floor(t * 60), q, 7) > dying ? 1 - dying : 0) : 1;
      return on * dieFlick;
    };
    const ringLitAt = (lon: number) => quarterLit(Math.floor((((lon % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) / (Math.PI / 2)));

    // shell panels: 32 longitudes x 12 latitudes; upper half = 4 petals
    const NL = 32, NB = 6;
    const L = [-0.45, 0.8, -0.4];
    for (let q = 0; q < 4; q++) for (let j = 0; j < NL / 4; j++) for (let b = -NB; b < NB; b++) {
      const lon0 = (q * NL / 4 + j) * (2 * Math.PI / NL), lon1 = lon0 + 2 * Math.PI / NL;
      const lat0 = (b / NB) * (Math.PI / 2), lat1 = ((b + 1) / NB) * (Math.PI / 2);
      const pq = b >= 0 ? q : -1;
      const w = [petalPt(lat0, lon0, pq), petalPt(lat0, lon1, pq), petalPt(lat1, lon1, pq), petalPt(lat1, lon0, pq)];
      const vw = w.map(view);
      // face normal in view space
      const ax = vw[1]![0] - vw[0]![0], ay = vw[1]![1] - vw[0]![1], az = vw[1]![2] - vw[0]![2];
      const bx = vw[3]![0] - vw[0]![0], by = vw[3]![1] - vw[0]![1], bz = vw[3]![2] - vw[0]![2];
      let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
      const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
      const outer = nz > 0; // n = dLon x dLat points inward: nz > 0 means the outward face looks at the camera
      const pts = w.map(proj);
      const zAvg = pts.reduce((a, p) => a + p.z, 0) / 4;
      const eqGlow = Math.exp(-Math.abs((lat0 + lat1) / 2) * 7) * (b === 0 || b === -1 ? 1 : 0.4);
      const ringHere = ringLitAt((lon0 + lon1) / 2);
      items.push({
        z: zAvg, draw: () => {
          c.beginPath();
          c.moveTo(pts[0]!.x, pts[0]!.y); for (let k = 1; k < 4; k++) c.lineTo(pts[k]!.x, pts[k]!.y); c.closePath();
          c.fillStyle = rgba('ink2', 1); c.fill();
          if (outer) {
            const dif = clamp(-(nx * L[0]! + ny * L[1]! + nz * L[2]!));
            c.fillStyle = rgba('graphite', 0.06 + 0.5 * dif * dif); c.fill();
            if (ringHere > 0) { c.fillStyle = rgba(ringCol, 0.13 * eqGlow * ringHere); c.fill(); }
          } else {
            // interior face, lit by the exposed star
            c.fillStyle = rgba('signal', clamp(0.15 + 0.6 * opened) * (0.5 + 0.5 * bp) * (0.35 + 0.65 * Math.abs(nz))); c.fill();
          }
          c.strokeStyle = rgba('ink', 0.9); c.lineWidth = 1.2; c.stroke();
        },
      });
    }

    // the star inside
    const core = proj([0, 0, 0]);
    items.push({
      z: core.z, draw: () => {
        const r = S * (0.28 + 0.06 * kp);
        const g = c.createRadialGradient(core.x, core.y, 0, core.x, core.y, r * 2.2);
        g.addColorStop(0, rgba('bone', 1)); g.addColorStop(0.2, rgba('ember', 1));
        g.addColorStop(0.5, rgba('signal', 0.8)); g.addColorStop(1, rgba('signal', 0));
        c.fillStyle = g; c.beginPath(); c.arc(core.x, core.y, r * 2.2, 0, Math.PI * 2); c.fill();
      },
    });

    // seams: the petals' cut edges glow after the cut
    if (cutFlare > 0.01 || t >= bar2) {
      for (let q = 0; q < 4; q++) for (const lon of [q * Math.PI / 2 + 0.002, (q + 1) * Math.PI / 2 - 0.002]) {
        const seg = Array.from({ length: NB + 1 }, (_, i) => proj(petalPt((i / NB) * Math.PI / 2, lon, q, 1.003)));
        items.push({
          z: seg.reduce((a, p) => a + p.z, 0) / seg.length - 0.02, draw: () => {
            c.globalCompositeOperation = 'lighter';
            c.strokeStyle = rgba('ember', 0.25 + 0.75 * cutFlare); c.lineWidth = 2 + 5 * cutFlare;
            c.beginPath(); seg.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y))); c.stroke();
            c.globalCompositeOperation = 'source-over';
          },
        });
      }
    }

    // the neon ring: 96 segments on the equator; quarter q ignites on beat q of bar 1
    const NR = 96, RR = 1.04, px = clamp(S / 450, 0.8, 1.9);
    for (let i = 0; i < NR; i++) {
      const l0 = (i / NR) * 2 * Math.PI, l1 = ((i + 1) / NR) * 2 * Math.PI;
      const a = proj([RR * Math.cos(l0), 0, RR * Math.sin(l0)]), b = proj([RR * Math.cos(l1), 0, RR * Math.sin(l1)]);
      const q = Math.floor(i / (NR / 4));
      const lit = quarterLit(q), tt = t - ((b1[q] ?? Infinity) + 2 * FR);
      const w = (plasmaW(tt) + 1.5 * kp + 6 * cutFlare) * px;
      items.push({
        z: (a.z + b.z) / 2 - 0.01, draw: () => {
          const p = new Path2D(); p.moveTo(a.x, a.y); p.lineTo(b.x, b.y);
          tube(c, p, ringCol, w, lit * (1 + 0.5 * bp + 1.2 * cutFlare), { x: 0, y: 4 * px }, 9 * px, 'butt');
        },
      });
    }

    // clamps: 4 per quarter slam onto the equator on beat q of bar 1 (radial snap with overshoot)
    for (let i = 0; i < 16; i++) {
      const q = Math.floor(i / 4), lon = (i + 0.5) * (Math.PI / 8);
      const tt = t - (b1[q] ?? Infinity) + (i % 4) * 0.02 - 0.06;
      const u = tt < 0 ? 0 : clamp(tt / 0.1);
      const rr = tt < 0 ? 1.42 : lerp(1.42, 1.06, u) - 0.03 * Math.sin(clamp(tt / 0.25) * Math.PI) * (1 - clamp(tt / 0.25));
      const alpha = tt < 0 ? 0.35 : 1;
      const cl = Math.cos(lon), sl = Math.sin(lon);
      const inner = proj([rr * cl, 0, rr * sl]), outerP = proj([(rr + 0.12) * cl, 0, (rr + 0.12) * sl]);
      const tA = proj([rr * cl - 0.07 * sl, 0.05, rr * sl + 0.07 * cl]), tB = proj([rr * cl + 0.07 * sl, -0.05, rr * sl - 0.07 * cl]);
      const spark = tt >= 0 ? Math.exp(-tt / 0.08) : 0;
      items.push({
        z: inner.z - 0.02, draw: () => {
          c.strokeStyle = rgba('graphite', alpha); c.lineWidth = 11 * px; c.lineCap = 'butt';
          c.beginPath(); c.moveTo(inner.x, inner.y); c.lineTo(outerP.x, outerP.y); c.stroke();
          c.strokeStyle = rgba('bone', 0.85 * alpha); c.lineWidth = 6 * px;
          c.beginPath(); c.moveTo(tA.x, tA.y); c.lineTo(tB.x, tB.y); c.stroke();
          if (spark > 0.02) {
            c.globalCompositeOperation = 'lighter';
            c.fillStyle = rgba('ember', spark); c.beginPath(); c.arc(inner.x, inner.y, 14 * px * spark + 3, 0, Math.PI * 2); c.fill();
            c.globalCompositeOperation = 'source-over';
          }
        },
      });
    }

    items.sort((a, b) => b.z - a.z);
    for (const it of items) it.draw();

    // hits (T3): every beat a big structural hit — zoom punch + shake on the clamp slam / petal snap
    const sk = 12 * bp;
    return {
      bloom: 0.55 + 0.6 * cutFlare, bloomThreshold: 0.7, bloomRadius: 0.8, halation: 0.3,
      zoom: 1 + 0.06 * bp + 0.04 * dp, shake: [sk * (hash(Math.floor(t * 60), 1) - 0.5), sk * (hash(Math.floor(t * 60), 2) - 0.5)],
      flash: 0.25 * cutFlare * cutFlare, fade: dying * 0.3,
    };
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const L = this.layer, c = L.ctx;
    L.clear();
    const post = this.plate.variant === 'ring' ? this.renderRing(c, f) : this.renderNeon(c, f);
    L.upload();
    clearRT(this.ctx.renderer, out, LIN.ink);
    this.ctx.comp.draw(this.ctx.renderer, L.texture, out, { mode: 'normal' });
    return post;
  }

  override dispose() { this.layer?.texture.dispose(); }
}
