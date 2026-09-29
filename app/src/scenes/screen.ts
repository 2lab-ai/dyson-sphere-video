// SCREEN — a bright, crisp interface on bone paper: flat panels, hairlines, mono labels, a signal cursor.
// Our own UI language (square flat panels, ruled title strips, index labels), not any real product's.
// Structure comes from the pure shot list (./screen.shots) via stateAt(); every view is its own composition.
// Variants (data/edit.json):
//   hidden (p03): three nested windows; the line types itself into the innermost field behind a signal block
//     cursor. A new nested frame snaps in on every beat (scale 0.8 -> 1 in 4 frames); the camera surges through
//     the stack on the beats while the frames it passes slide aside; then the field itself slides away and the
//     signal core (the future) sits behind it, the last word flies onto it, and the core floods the frame.
//   choice (p22): a dialog whose text is lines 21-22; its option buttons grey out one per sung word while the
//     cursor arrives a moment too late on each; the timer ring loses one segment per beat; when the last
//     segment goes, the dialog auto-closes to a hairline.
import type * as THREE from 'three';
import { Scene, type Frame, type PostOverrides } from '../engine/scene';
import { Layer2D, clearRT, W, H } from '../engine/gl';
import { LIN, rgba } from '../engine/palette';
import { drawLyric, layoutLine, ownedLines, syllableState, F, type LineLayout } from '../engine/lyric';
import { font } from '../engine/type';
import { beatPulse, kickPulse, downbeatPulse, beatIndex, beatPhase } from '../engine/beat';
import { stateAt, beatTimes, type PlateInfo, type Shot } from '../engine/shots';
import { clamp, ease, hash, lerp, pulse, TAU } from '../engine/util';
import type { Line } from '../engine/lyrics';
import { shots, type View } from './screen.shots';

type C2 = CanvasRenderingContext2D;
type P = { x: number; y: number };

// ---- hidden: the window stack (world units = px at depth == camera)
const R = 1.16; // scale ratio per unit of depth
const WW = 1760, WH = 960, TB = 46, PAD = 34; // window size, title strip, frame border
const DF = 1.9; // depth of the innermost window (the field)
const CAM_END = 1.5; // camera depth when the dolly ends
const SNAP = 4 / 60; // a new frame snaps 0.8 -> 1 in 4 frames

interface Win { z: number; t0: number; n: number; side: number; field: boolean }

// ---- choice: the dialog (world = the frontal layout)
const DLG = { x: 250, y: 150, w: 1420, h: 780 };
const BTN = { x: 321, y: 560, w: 300, h: 120, gx: 26, gy: 26 };
const LABELS = ['CHOOSE', 'WAIT', 'REFUSE', 'DELAY', 'ASK', 'OVERRIDE', 'STOP', 'DECIDE'];
const GREY_ORDER = [1, 6, 3, 0, 5, 2, 4, 7]; // grid position greyed by the k-th sung word (the last = DECIDE)
const RING = { x: 1450, y: 372, r: 104, w: 22 };

export default class ScreenScene extends Scene {
  private layer!: Layer2D;
  private list: Shot[] = [];
  private plate!: PlateInfo;
  private lines: Line[] = [];
  // hidden
  private wins: Win[] = [];
  private surges: number[] = [];
  private tDolly = 0;
  private tCore = 0;
  // choice
  private greyT: number[] = [];
  private ringT: number[] = [];

  override init() {
    this.plate = this.ctx.params as PlateInfo;
    this.list = shots(this.plate, this.ctx.audio);
    this.lines = ownedLines(this.ctx);
    this.layer = new Layer2D();
    const au = this.ctx.audio, { start, end } = this.ctx;
    const at = (v: View) => this.list.find((s) => s.s.view === v)?.t ?? end;
    if (this.plate.variant === 'hidden') {
      this.tDolly = at('dolly');
      this.tCore = at('core');
      this.surges = [this.tDolly, ...beatTimes(au, this.tDolly + 0.05, this.tCore - 0.05)];
      // the opening stack: an outer window, a middle one, the field
      this.wins = [
        { z: 0.3, t0: -1, n: 1, side: -1, field: false },
        { z: 0.85, t0: -1, n: 2, side: 1, field: false },
        { z: DF, t0: -1, n: 0, side: -1, field: true },
      ];
      // one new nested frame per beat, halfway between the camera and the field
      let n = 3;
      for (const b of beatTimes(au, start + 0.05, this.tCore - 0.05)) {
        const cam = this.cam(b - 1e-3);
        const z = cam + 0.5 * (DF - cam);
        if (z < DF - 0.12) this.wins.push({ z, t0: b, n: n, side: n % 2 ? 1 : -1, field: false }), n++;
      }
      this.wins.find((w) => w.field)!.n = n;
    } else {
      // button k greys when the k-th word of the dialog text starts; the last one on the very last syllable
      const words = this.lines.flatMap((l) => l.words);
      this.greyT = words.map((w) => w.start).slice(0, LABELS.length - 1);
      const lw = words[words.length - 1]!;
      this.greyT.push(lw.syl?.length ? lw.syl[lw.syl.length - 1]![0] : lw.end);
      while (this.greyT.length < LABELS.length) this.greyT.push(end);
      this.ringT = beatTimes(au, start + 0.02, end + 0.02);
    }
  }

  // =============================================================== hidden
  /** Camera depth: a surge (outExpo) on the dolly start and on every beat until the core. */
  private cam(t: number) {
    const step = CAM_END / Math.max(1, this.surges.length);
    let z = 0;
    for (const s of this.surges) z += step * ease.outExpo(clamp((t - s) / 0.34));
    return z;
  }

  private panel(c: C2, x: number, y: number, w: number, h: number, s: number, hole: boolean, label: string, idx: string, top: boolean) {
    const hx = x + PAD * s, hy = y + (TB + PAD * 0.55) * s, hw = w - 2 * PAD * s, hh = h - (TB + PAD * 1.45) * s;
    const ring = (dx: number, dy: number) => {
      c.beginPath();
      c.rect(x + dx, y + dy, w, h);
      if (hole) c.rect(hx + dx, hy + dy, hw, hh);
    };
    // flat hard shadow, then the panel
    ring(10 * s, 12 * s);
    c.fillStyle = rgba('graphite', 0.16);
    c.fill('evenodd');
    ring(0, 0);
    c.fillStyle = rgba('bone');
    c.fill('evenodd');
    c.fillStyle = rgba('paper2');
    c.fillRect(x, y, w, TB * s);
    c.strokeStyle = rgba('ink');
    c.lineWidth = Math.max(1, 1.6 * Math.min(1.5, s));
    c.strokeRect(x, y, w, h);
    c.beginPath(); c.moveTo(x, y + TB * s); c.lineTo(x + w, y + TB * s); c.stroke();
    if (hole) { c.lineWidth = 1; c.strokeRect(hx, hy, hw, hh); }
    // title strip: an index block (signal on the top-most window), mono label, ruled ticks, index count
    const ls = 17 * s;
    if (ls >= 6) {
      c.fillStyle = rgba(top ? 'signal' : 'ink');
      c.fillRect(x + 16 * s, y + 15 * s, 16 * s, 16 * s);
      c.font = font(F.mono(500), ls);
      c.textBaseline = 'middle';
      c.textAlign = 'left';
      c.fillStyle = rgba('ink');
      c.fillText(label, x + 44 * s, y + TB * s * 0.52);
      c.textAlign = 'right';
      c.fillStyle = rgba('graphite');
      c.fillText(idx, x + w - 18 * s, y + TB * s * 0.52);
      c.strokeStyle = rgba('graphite', 0.8);
      c.lineWidth = 1;
      for (let i = 0; i < 12; i++) {
        const tx = x + w - 150 * s - i * 9 * s;
        c.beginPath(); c.moveTo(tx, y + 16 * s); c.lineTo(tx, y + (i % 4 ? 26 : 31) * s); c.stroke();
      }
    }
  }

  /** The field window's content: the input box with the typed line and the block cursor. */
  private field(c: C2, f: Frame, cx: number, cy: number, s: number) {
    const au = this.ctx.audio, line = this.lines[0]!;
    // furniture: label, input box, ruled placeholder rows
    const bx = cx - 790 * s, by = cy - 150 * s, bw = 1580 * s, bh = 250 * s;
    c.font = font(F.mono(500), 20 * s);
    c.textAlign = 'left'; c.textBaseline = 'alphabetic';
    c.fillStyle = rgba('graphite');
    c.fillText('INPUT / 03 — LAYER ' + String(this.wins.length).padStart(2, '0'), bx, by - 22 * s);
    c.strokeStyle = rgba('ink');
    c.lineWidth = Math.max(1.5, (2 + 3 * kickPulse(au, f.t, 0.1)) * s);
    c.strokeRect(bx, by, bw, bh);
    c.fillStyle = rgba('paper2', 0.9);
    for (let i = 0; i < 3; i++) c.fillRect(bx, by + bh + (48 + i * 40) * s, (i === 2 ? 620 : 1180 - i * 260) * s, 14 * s);
    // the typed line: unsung syllables are not drawn at all (they haven't been typed yet)
    const size = 158 * s, x0 = bx + 44 * s, base = by + bh / 2 + size * 0.36;
    const lay = drawLyric(c, line, f.t, { x: x0, y: base, size, align: 'left', maxWidth: bw - 150 * s, family: F.slam(), sungColor: 'ink', unsungAlpha: 0, lead: 10 });
    const tipX = lay ? x0 + this.typedEnd(lay, f.t) : x0;
    const sz = lay?.size ?? size;
    this.cursor(c, f, tipX + (tipX > x0 ? 10 * s : 0), base - sz * 0.86, sz * 0.52, sz * 1.0, 'signal');
  }

  /** x (relative to the line origin) just after the last typed character. */
  private typedEnd(lay: LineLayout, t: number) {
    let x = 0;
    for (const b of lay.chars) if (b.syl < syllableState(lay.line.words[b.word]!, t).sung) x = Math.max(x, b.x + b.w);
    return x;
  }

  /** Block cursor: solid while typing, blinks on the beat otherwise; kicks widen it. */
  private cursor(c: C2, f: Frame, x: number, y: number, w: number, h: number, col: 'signal' | 'ink' | 'bone') {
    const au = this.ctx.audio, line = this.lines[0]!;
    let typing = false;
    for (const wd of line.words) for (const [a] of wd.syl ?? [[wd.start, wd.end]]) if (f.t >= a && f.t - a < 0.3) typing = true;
    const on = typing || beatPhase(au, f.t) < 0.55;
    if (!on) return;
    const k = kickPulse(au, f.t, 0.1);
    c.fillStyle = rgba(col);
    c.fillRect(x, y, w * (1 + 0.5 * k), h);
  }

  private renderHidden(c: C2, f: Frame, view: View) {
    const au = this.ctx.audio;
    if (view === 'core') return this.renderCore(c, f);
    const cam = view === 'front' ? 0 : this.cam(f.t);
    const V = view === 'deep' ? { x: -330, y: -170 } : { x: 0, y: 0 };
    c.save();
    if (view === 'deep') {
      // oblique 3/4 view of the stack: shear about the frame centre
      c.translate(W / 2 + 80, H / 2 + 40);
      c.transform(1.04, -0.09, -0.24, 0.94, 0, 0);
      c.translate(-W / 2, -H / 2);
    }
    // back to front
    const ws = this.wins.filter((w) => f.t >= w.t0).sort((a, b) => b.z - a.z);
    const topN = ws.length ? ws[ws.length - 1]!.n : -1;
    for (const w of ws) {
      const d = w.z - cam;
      let s = Math.pow(R, -d);
      if (w.t0 >= 0) s *= 0.8 + 0.2 * ease.outCubic(clamp((f.t - w.t0) / SNAP));
      // passing frames slide aside
      const u = w.field ? 0 : ease.inOutCubic(clamp((cam - (w.z - 0.3)) / 0.26));
      if (u >= 1 || s > 4) continue;
      const cx = W / 2 + V.x * (1 - s) + w.side * u * 1500 * s, cy = H / 2 + V.y * (1 - s);
      const pw = WW * s, ph = WH * s;
      this.panel(c, cx - pw / 2, cy - ph / 2, pw, ph, s, !w.field, w.field ? 'FIELD' : `LAYER ${String(w.n).padStart(2, '0')}`, `${String(w.n).padStart(2, '0')}/${String(this.wins.length).padStart(2, '0')}`, w.n === topN);
      if (w.field) this.field(c, f, cx, cy + TB * s * 0.5, s);
    }
    c.restore();
    // registration marks on the paper: step on every beat (beat index parity)
    const bi = beatIndex(au, f.t), bp = beatPulse(au, f.t, 0.1);
    c.strokeStyle = rgba('ink', 0.7);
    c.lineWidth = 1.5;
    for (const [mx, my] of [[48, 48], [W - 48, 48], [48, H - 48], [W - 48, H - 48]] as const) {
      const r = 12 + 8 * bp;
      c.beginPath(); c.moveTo(mx - r, my); c.lineTo(mx + r, my); c.moveTo(mx, my - r); c.lineTo(mx, my + r); c.stroke();
    }
    c.font = font(F.mono(500), 16);
    c.fillStyle = rgba('graphite');
    c.textAlign = 'left'; c.textBaseline = 'middle';
    c.fillText(`DEPTH ${(view === 'front' ? 0 : cam).toFixed(2)} · FRAME ${String(Math.max(0, bi % 100)).padStart(2, '0')}`, 72, H - 48);
  }

  private renderCore(c: C2, f: Frame) {
    const au = this.ctx.audio, line = this.lines[0]!;
    const u = f.t - this.tCore;
    const bp = beatPulse(au, f.t, 0.14);
    const cx = W / 2, cy = 610;
    const ex = ease.inExpo(clamp((f.t - (this.ctx.end - 0.36)) / 0.3)); // full cover 0.06 s before the cut
    const r0 = 330 * (1 + 0.08 * bp) * (0.86 + 0.14 * ease.outBack(clamp(u / 0.2)));
    const r = lerp(r0, 1350, ex);
    // the passed windows, slid aside to the edges
    for (const side of [-1, 1]) {
      const x = side < 0 ? -1460 : W - 300;
      this.panel(c, x, 120, 1760, 900, 1, true, `LAYER ${side < 0 ? '07' : '08'}`, '', false);
    }
    // dial furniture around the core: hairline rings + ticks, stepping one tick per beat
    const bi = beatIndex(au, f.t);
    c.strokeStyle = rgba('ink', 1 - ex);
    c.lineWidth = 1.2;
    for (const k of [1.22, 1.42]) { c.beginPath(); c.arc(cx, cy, r0 * k, 0, TAU); c.stroke(); }
    for (let i = 0; i < 72; i++) {
      const a = (i + bi) * (TAU / 72) - Math.PI / 2, l = i % 6 ? 10 : 24;
      c.beginPath();
      c.moveTo(cx + Math.cos(a) * r0 * 1.42, cy + Math.sin(a) * r0 * 1.42);
      c.lineTo(cx + Math.cos(a) * (r0 * 1.42 + l), cy + Math.sin(a) * (r0 * 1.42 + l));
      c.stroke();
    }
    c.font = font(F.mono(500), 18);
    c.fillStyle = rgba('graphite', 1 - ex);
    c.textAlign = 'left'; c.textBaseline = 'middle';
    c.fillText('CORE / LAYER 09 — BEHIND THE FIELD', 120, H - 64);
    // the core: flat signal disc with an ember centre
    const g = c.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, rgba('ember'));
    g.addColorStop(0.55 * (1 - ex), rgba('signal'));
    g.addColorStop(1, rgba('signal'));
    c.fillStyle = g;
    c.beginPath(); c.arc(cx, cy, r, 0, TAU); c.fill();
    // the field slides aside to the left, uncovering the core
    const slide = ease.inOutCubic(clamp(u / 0.16));
    if (slide < 1) {
      const s = Math.pow(R, -(DF - CAM_END));
      this.panel(c, W / 2 - (WW * s) / 2 - slide * 1900, H / 2 - (WH * s) / 2, WW * s, WH * s, s, false, 'FIELD', '', true);
    }
    // the line: set as the page heading, the last word flies onto the core (bone on signal)
    const size = 100, x0 = 120, y0 = 200;
    const lay = layoutLine(c, line, F.slam(), size, W - 240);
    const lw = lay.words[lay.words.length - 1]!;
    const wMid = lw.x + lw.w / 2, ks = 2.7, fly = ease.outExpo(clamp(u / 0.26));
    const last = line.words.length - 1;
    drawLyric(c, line, f.t, {
      x: x0, y: y0, size, align: 'left', maxWidth: W - 240, family: F.slam(), sungColor: 'ink', unsungAlpha: 0, lead: 10,
      charTransform: (_ch, _i, st) => {
        if (st.word !== last) return;
        const nx = x0 + st.box.x + st.box.w / 2, ny = y0 - lay.size * 0.35;
        const tx = cx + (st.box.x + st.box.w / 2 - wMid) * ks, ty = cy + 10;
        return { dx: (tx - nx) * fly, dy: (ty - ny) * fly, scale: lerp(1, ks, fly) * (1 + 0.06 * bp) };
      },
      drawChar: (cc, ch, st) => {
        cc.fillStyle = rgba(st.word === last && fly > 0.5 ? 'bone' : 'ink');
        cc.fillText(ch, 0, 0);
      },
    });
    // cursor block after the word on the core
    const cw = lw.w * ks;
    this.cursor(c, f, cx + cw / 2 + 18, cy + 10 - lay.size * ks * 0.62, lay.size * ks * 0.34, lay.size * ks * 0.72, 'bone');
  }

  // =============================================================== choice
  private btnRect(i: number) {
    const col = i % 4, row = Math.floor(i / 4);
    return { x: BTN.x + col * (BTN.w + BTN.gx), y: BTN.y + row * (BTN.h + BTN.gy), w: BTN.w, h: BTN.h };
  }

  /** 0..1 how greyed grid button i is at t (snaps in 5 frames on its word). */
  private greyed(i: number, t: number) {
    const k = GREY_ORDER.indexOf(i);
    return clamp((t - this.greyT[k]!) / (5 / 60));
  }

  /** The cursor (world): always arriving at the next live button just as it greys. */
  private cursorPos(t: number, jitter = true): P {
    const n = this.greyT.length;
    let k = 0;
    while (k < n && this.greyT[k]! <= t) k++;
    const hover = (j: number): P => {
      const b = this.btnRect(GREY_ORDER[j]!);
      return { x: b.x + b.w * 0.62, y: b.y + b.h * 0.58 };
    };
    let p: P;
    if (k >= n) {
      const h = hover(n - 1), u = t - this.greyT[n - 1]!;
      p = { x: h.x + 40 * Math.sin(u * 2.1), y: h.y + 30 * u };
    } else {
      const a = k === 0 ? { x: 1480, y: 900 } : hover(k - 1), b = hover(k);
      const t0 = k === 0 ? this.ctx.start : this.greyT[k - 1]!, t1 = this.greyT[k]!;
      const m = ease.inOutCubic(clamp((t - t0) / Math.max(0.05, (t1 - t0) * 0.85)));
      p = { x: lerp(a.x, b.x, m), y: lerp(a.y, b.y, m) };
    }
    if (!jitter) return p;
    const kp = kickPulse(this.ctx.audio, t, 0.1);
    // a failed click just after each grey-out: the pointer recoils
    let rec = 0;
    for (const g of this.greyT) rec = Math.max(rec, pulse(t, g + 0.03, 0.06));
    return { x: p.x + 4 * Math.sin(t * 23) + 7 * kp, y: p.y + 3 * Math.sin(t * 17 + 1) - 12 * rec };
  }

  private drawButtons(c: C2, t: number) {
    for (let i = 0; i < LABELS.length; i++) {
      const b = this.btnRect(i), g = this.greyed(i, t);
      const hot = g <= 0 && GREY_ORDER[this.greyT.findIndex((x) => x > t)] === i;
      c.fillStyle = rgba(g > 0 ? 'paper2' : 'bone');
      c.fillRect(b.x, b.y, b.w, b.h);
      if (g > 0) {
        // disabled hatch
        c.save();
        c.beginPath(); c.rect(b.x, b.y, b.w, b.h); c.clip();
        c.strokeStyle = rgba('graphite', 0.28 * g);
        c.lineWidth = 1;
        for (let hx = -b.h; hx < b.w; hx += 14) { c.beginPath(); c.moveTo(b.x + hx, b.y + b.h); c.lineTo(b.x + hx + b.h, b.y); c.stroke(); }
        c.restore();
      }
      c.strokeStyle = rgba(hot ? 'signal' : g > 0 ? 'graphite' : 'ink');
      c.lineWidth = hot ? 4 : 1.6;
      c.strokeRect(b.x, b.y, b.w, b.h);
      c.font = font(F.mono(700), 30);
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillStyle = rgba(g > 0 ? 'graphite' : 'ink');
      c.fillText(LABELS[i]!, b.x + b.w / 2, b.y + b.h / 2 + 2);
      if (g > 0) {
        const tw = c.measureText(LABELS[i]!).width;
        c.strokeStyle = rgba('graphite');
        c.lineWidth = 2;
        c.beginPath(); c.moveTo(b.x + b.w / 2 - tw / 2 - 8, b.y + b.h / 2); c.lineTo(b.x + b.w / 2 - tw / 2 - 8 + (tw + 16) * g, b.y + b.h / 2); c.stroke();
      }
      c.font = font(F.mono(500), 15);
      c.textAlign = 'left';
      c.fillStyle = rgba('graphite');
      c.fillText(String(i + 1).padStart(2, '0'), b.x + 10, b.y + 16);
    }
  }

  /** The timer ring: one segment per beat of the plate, one lost per beat (snap); the lost one flies off in signal. */
  private drawRing(c: C2, t: number, x: number, y: number, r: number, w: number, big: boolean) {
    const n = Math.max(1, this.ringT.length), gap = 0.05;
    let lost = 0;
    for (const b of this.ringT) if (t >= b) lost++;
    c.lineCap = 'butt';
    for (let i = 0; i < n; i++) {
      const a0 = -Math.PI / 2 + (i * TAU) / n + gap, a1 = -Math.PI / 2 + ((i + 1) * TAU) / n - gap;
      if (i < lost) {
        c.strokeStyle = rgba('graphite', 0.7);
        c.lineWidth = 1;
        c.beginPath(); c.arc(x, y, r + w / 2, a0, a1); c.arc(x, y, r - w / 2, a1, a0, true); c.closePath(); c.stroke();
        const u = (t - this.ringT[i]!) / 0.32;
        if (u < 1) {
          const am = (a0 + a1) / 2, o = (big ? 160 : 60) * ease.outExpo(u);
          c.strokeStyle = rgba('signal', 1 - u);
          c.lineWidth = w;
          c.beginPath(); c.arc(x + Math.cos(am) * o, y + Math.sin(am) * o, r, a0, a1); c.stroke();
        }
      } else {
        c.strokeStyle = rgba(i === lost ? 'signal' : 'ink');
        c.lineWidth = w;
        c.beginPath(); c.arc(x, y, r, a0, a1); c.stroke();
      }
    }
    c.font = font(F.mono(700), r * (big ? 0.2 : 0.42));
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillStyle = rgba('ink');
    c.fillText(String(n - lost).padStart(2, '0'), x, big ? y + r * 0.62 : y);
  }

  private drawPointer(c: C2, p: P, s: number) {
    // our own pointer: a solid ink wedge with a bone rim and a signal notch
    c.save();
    c.translate(p.x, p.y);
    c.scale(s, s);
    c.beginPath();
    c.moveTo(0, 0); c.lineTo(0, 46); c.lineTo(12, 35); c.lineTo(21, 54); c.lineTo(29, 50); c.lineTo(20, 32); c.lineTo(36, 32); c.closePath();
    c.fillStyle = rgba('ink'); c.fill();
    c.strokeStyle = rgba('bone'); c.lineWidth = 2.5; c.stroke();
    c.fillStyle = rgba('signal');
    c.fillRect(2, 20, 5, 9);
    c.restore();
  }

  /** Failed-click marks: a signal ring that opens and a slash through it, right after each grey-out. */
  private drawClickFail(c: C2, t: number, p: P, s: number) {
    for (const g of this.greyT) {
      const u = (t - g - 0.03) / 0.3;
      if (u < 0 || u >= 1) continue;
      const rr = (12 + 50 * ease.outExpo(u)) * s;
      c.strokeStyle = rgba('signal', 1 - u);
      c.lineWidth = 3 * s;
      c.beginPath(); c.arc(p.x, p.y, rr, 0, TAU); c.stroke();
      c.beginPath(); c.moveTo(p.x - rr * 0.7, p.y + rr * 0.7); c.lineTo(p.x + rr * 0.7, p.y - rr * 0.7); c.stroke();
    }
  }

  private drawDialog(c: C2, f: Frame, withText: boolean) {
    const au = this.ctx.audio;
    const bp = beatPulse(au, f.t, 0.1);
    const { x, y, w, h } = DLG;
    // shadow snaps deeper on every beat
    c.fillStyle = rgba('graphite', 0.18);
    c.fillRect(x + 14 + 8 * bp, y + 16 + 8 * bp, w, h);
    c.fillStyle = rgba('bone');
    c.fillRect(x, y, w, h);
    c.fillStyle = rgba('paper2');
    c.fillRect(x, y, w, 56);
    c.strokeStyle = rgba('ink');
    c.lineWidth = 2;
    c.strokeRect(x, y, w, h);
    c.beginPath(); c.moveTo(x, y + 56); c.lineTo(x + w, y + 56); c.stroke();
    c.fillStyle = rgba('signal');
    c.fillRect(x + 18, y + 19, 18, 18);
    c.font = font(F.mono(500), 20);
    c.textAlign = 'left'; c.textBaseline = 'middle';
    c.fillStyle = rgba('ink');
    c.fillText('DECISION / 22 — INPUT REQUIRED', x + 50, y + 29);
    // close box (auto-closes itself at the end)
    c.strokeRect(x + w - 46, y + 14, 28, 28);
    c.beginPath(); c.moveTo(x + w - 40, y + 20); c.lineTo(x + w - 24, y + 36); c.moveTo(x + w - 24, y + 20); c.lineTo(x + w - 40, y + 36); c.stroke();
    c.font = font(F.mono(500), 16);
    c.fillStyle = rgba('graphite');
    c.fillText('SELECT ONE OPTION BEFORE THE RING RUNS OUT', x + 70, y + 520 - 22 + 0);
    if (withText) this.lines.forEach((line, k) => {
      drawLyric(c, line, f.t, {
        x: x + 70, y: y + 200 + k * 124, size: 96, align: 'left', maxWidth: 900, family: F.slam(),
        sungColor: 'ink', unsungColor: 'graphite', unsungAlpha: 0.45, lead: 10,
      });
    });
    this.drawRing(c, f.t, RING.x, RING.y, RING.r, RING.w, false);
    this.drawButtons(c, f.t);
  }

  /** Tooltip carried by the pointer: the line being sung, as the dialog's own text. */
  private tooltip(c: C2, f: Frame, p: P, size: number, left: boolean) {
    const line = this.lines[this.lines.length - 1]!;
    const lay = layoutLine(c, line, F.slam(), size);
    const pw = lay.width + size * 0.9, ph = size * 1.6;
    const x = left ? p.x - 30 - pw : p.x + size * 0.9, y = p.y + size * 1.3;
    c.fillStyle = rgba('graphite', 0.2);
    c.fillRect(x + size * 0.14, y + size * 0.16, pw, ph);
    c.fillStyle = rgba('bone');
    c.fillRect(x, y, pw, ph);
    c.strokeStyle = rgba('ink');
    c.lineWidth = size * 0.04;
    c.strokeRect(x, y, pw, ph);
    c.fillStyle = rgba('signal');
    c.fillRect(x, y, size * 0.12, ph);
    drawLyric(c, line, f.t, {
      x: x + size * 0.45, y: y + ph / 2 + size * 0.36, size, align: 'left', family: F.slam(),
      sungColor: 'ink', unsungColor: 'graphite', unsungAlpha: 0.4, lead: 10,
    });
  }

  private renderChoice(c: C2, f: Frame, view: View) {
    const t = f.t;
    const p = this.cursorPos(t), pc = this.cursorPos(t, false);
    if (view === 'ring') {
      // the timer ring fills the frame; the rest of the line sits in its bore; then the dialog auto-closes
      const tc = this.ringT[this.ringT.length - 1] ?? this.ctx.end;
      const k1 = ease.outCubic(clamp((t - tc) / 0.06)), k2 = ease.outCubic(clamp((t - tc - 0.06) / 0.05));
      c.save();
      c.translate(W / 2, H / 2);
      c.scale(Math.max(0.001, 1 - k2), lerp(1, 0.004, k1));
      c.translate(-W / 2, -H / 2);
      c.strokeStyle = rgba('ink', 0.5);
      c.lineWidth = 1;
      c.strokeRect(120, 100, W - 240, H - 200);
      for (let i = 0; i < 48; i++) {
        const a = (i * TAU) / 48;
        c.beginPath(); c.moveTo(W / 2 + Math.cos(a) * 468, H / 2 + Math.sin(a) * 468); c.lineTo(W / 2 + Math.cos(a) * (i % 6 ? 480 : 494), H / 2 + Math.sin(a) * (i % 6 ? 480 : 494)); c.stroke();
      }
      this.drawRing(c, t, W / 2, H / 2, 410, 72, true);
      drawLyric(c, this.lines[this.lines.length - 1]!, t, {
        x: W / 2, y: H / 2 + 30, size: 110, align: 'center', maxWidth: 640, family: F.slam(),
        sungColor: 'ink', unsungColor: 'graphite', unsungAlpha: 0.4, lead: 10,
      });
      // the useless pointer, still trying
      const q = { x: W / 2 + 560 + 20 * Math.sin(t * 7), y: H / 2 + 220 - 40 * (t - this.ctx.start - 3.5) };
      this.drawPointer(c, q, 1.4);
      this.drawClickFail(c, t, q, 1.4);
      c.restore();
      if (k2 >= 1) {
        // closed: a hairline where the dialog was
        c.strokeStyle = rgba('ink');
        c.lineWidth = 1.5;
        const l = 900 * (1 - clamp((t - tc - 0.11) / 0.1));
        c.beginPath(); c.moveTo(W / 2 - l / 2, H / 2); c.lineTo(W / 2 + l / 2, H / 2); c.stroke();
      }
      return;
    }
    c.save();
    if (view === 'dialog') {
      // the dialog pops open over 4 frames at the plate start
      const o = 0.9 + 0.1 * ease.outCubic(clamp((t - this.ctx.start) / SNAP));
      c.translate(W / 2, H / 2); c.scale(o, o); c.translate(-W / 2, -H / 2);
    } else if (view === 'cursor') {
      // close-up: the camera rides the pointer (without its jitter), pointer left of centre
      const z = 2.35;
      c.translate(W / 2 - 540, H / 2 - 120); c.scale(z, z); c.translate(-pc.x, -pc.y);
    } else {
      // grid: the button grid tilted and cropped, pointer small among the options
      const z = 1.5;
      c.translate(W / 2, H / 2 + 60); c.rotate(-0.075); c.transform(1, 0, -0.12, 1, 0, 0); c.scale(z, z); c.translate(-960, -706);
    }
    this.drawDialog(c, f, view === 'dialog');
    const ps = view === 'cursor' ? 1 : view === 'grid' ? 1.1 : 1.3;
    this.drawClickFail(c, t, p, ps);
    this.drawPointer(c, p, ps);
    if (view === 'cursor') {
      // the timer ring rides the pointer as a badge, so the per-beat segment loss stays in the close-up
      c.fillStyle = rgba('bone');
      c.strokeStyle = rgba('ink');
      c.lineWidth = 1;
      c.beginPath(); c.arc(p.x - 70, p.y - 34, 40, 0, TAU); c.fill(); c.stroke();
      this.drawRing(c, t, p.x - 70, p.y - 34, 28, 9, false);
      this.tooltip(c, f, p, 42, false);
    }
    if (view === 'grid') this.tooltip(c, f, p, 58, p.x > 900);
    c.restore();
  }

  // =============================================================== render
  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, audio } = this.ctx;
    const view = stateAt(this.list, f.t).view as View;
    const L = this.layer, c = L.ctx;
    L.clear(rgba('bone'));
    // paper: a faint ruled grid (the page the interface is printed on)
    c.strokeStyle = rgba('paper2', 0.8);
    c.lineWidth = 1;
    c.beginPath();
    for (let x = 0; x <= W; x += 60) { c.moveTo(x, 0); c.lineTo(x, H); }
    for (let y = 0; y <= H; y += 60) { c.moveTo(0, y); c.lineTo(W, y); }
    c.stroke();
    if (this.plate.variant === 'choice') this.renderChoice(c, f, view);
    else this.renderHidden(c, f, view);
    L.upload();
    clearRT(renderer, out, LIN.bone);
    this.ctx.comp.draw(renderer, L.texture, out, { mode: 'normal' });

    // hits (T1: shake <= 6 px, flare <= 1.4x)
    const kp = kickPulse(audio, f.t, 0.08), db = downbeatPulse(audio, f.t, 0.15);
    const dir = hash(beatIndex(audio, f.t), 11) * TAU;
    const shake: [number, number] = [Math.cos(dir) * 4 * kp, Math.sin(dir) * 4 * kp];
    let zoom = 1 + 0.018 * db, flash = 0;
    if (this.plate.variant === 'hidden') {
      // each new frame and each camera surge lands with a small punch
      for (const w of this.wins) if (w.t0 >= 0) zoom += 0.02 * pulse(f.t, w.t0, 0.05);
      if (view === 'core') flash = 0.3 * pulse(f.t, this.tCore, 0.06);
    } else {
      for (const g of this.greyT) zoom += 0.022 * pulse(f.t, g, 0.06);
      const tc = this.ringT[this.ringT.length - 1];
      if (tc !== undefined) flash = 0.25 * pulse(f.t, tc, 0.05);
    }
    return { shake, zoom, flash, vignette: 0.12, bloom: 0 };
  }

  override dispose() { this.layer?.texture.dispose(); }
}
