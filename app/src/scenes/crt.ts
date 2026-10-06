// E2 CRT video wall (Nam June Paik): a stacked wall of 6x4 television sets, each tube a different broken signal.
// The line scrolls across the wall one syllable per tube (a marquee that jumps one tube left on every beat), while
// one tube stays dark: it hides the future. The last syllable lives only in that dark tube, as a warm dot that
// becomes a warm glyph when it is sung; the macro shot goes inside its glass, and the wall powers off tube by tube.
//
// Beat (always visible): every beat the marquee jumps one tube, and one tube loses vertical hold (its picture rolls
// a full frame with the black blanking bar); every kick pulses the whole wall's brightness (composite tint).
// Colour: the plate's named palette only (look.palette = 'crt'): ground #050505, CRT white, P31 green, blue; the
// shared warm signal is reserved for the hidden future (the dot and its syllable).
import type * as THREE from 'three';
import { beatIndex, beatPulse, downbeatPulse, kickPulse } from '../engine/beat';
import { Layer2D, clearRT } from '../engine/gl';
import { drawLyric, layoutLine, ownedLines, F, type CharState, type LineLayout } from '../engine/lyric';
import type { Line } from '../engine/lyrics';
import { palette, pcss, plin, pmix, type NamedPalette } from '../engine/palette';
import { Scene, type Frame, type PostOverrides } from '../engine/scene';
import { shotAt, type PlateInfo, type Shot } from '../engine/shots';
import { shots } from './crt.shots';

// ------------------------------------------------------------------ wall geometry (logical px, world space)
const COLS = 6, ROWS = 4, N = COLS * ROWS;
const CW = 290, CH = 235;
const X0 = (1920 - COLS * CW) / 2, Y0 = (1080 - ROWS * CH) / 2;
/** The dark tube (row 2, col 3): it never shows the scrolling line; it hides the future. */
const DARK = 15;
/** Track slot of the first syllable at the plate's first beat (the marquee moves one slot left per beat). */
const S0 = 10;
const GLYPH = 128;

const hash = (i: number) => { const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453; return x - Math.floor(x); };
const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const smooth = (x: number) => { const k = clamp(x); return k * k * (3 - 2 * k); };

interface Rect { x: number; y: number; w: number; h: number }
const cell = (s: number): Rect => ({ x: X0 + (s % COLS) * CW, y: Y0 + Math.floor(s / COLS) * CH, w: CW, h: CH });
/** Cabinet style per tube: side knob panel (Paik's 60s consoles) or a full-front set with a speaker strip below. */
const sidePanel = (s: number) => hash(s * 3 + 1) < 0.5;
function screenRect(s: number): Rect {
  const c = cell(s);
  const x = c.x + 6, y = c.y + 6, w = c.w - 12, h = c.h - 12;
  if (sidePanel(s)) return { x: x + 16, y: y + 16, w: w * 0.76 - 16, h: h - 32 };
  return { x: x + 18, y: y + 14, w: w - 36, h: h - 50 };
}
/** Signal shown by a tube that carries no syllable (Paik's wall: every set a different broken picture). */
const signalOf = (s: number) => Math.floor(hash(s * 7 + 3) * 5);

/** Slot of syllable k after `nb` beats (the last syllable is always in the dark tube). */
function slotOf(k: number, nb: number, last: number): number {
  if (k === last) return DARK;
  const i = k + S0 - nb;
  return i < DARK ? i : i + 1;
}

// ------------------------------------------------------------------ camera
interface Cam { cx: number; cy: number; z: number; rot: number }
function camFor(block: string): Cam {
  const cc = (col: number, row: number) => [X0 + (col + 0.5) * CW, Y0 + (row + 0.5) * CH] as const;
  if (block === 'voice') { const [a, b] = cc(1.5, 1.5); return { cx: a, cy: b, z: 2.2, rot: 0 }; }
  if (block === 'edge') { const [a, b] = cc(3, 1.5); return { cx: a, cy: b, z: 2.0, rot: -0.045 }; }
  if (block === 'dark') { const [a, b] = cc(3, 2); return { cx: a - 0.35 * CW, cy: b - 0.02 * CH, z: 3.2, rot: 0 }; }
  return { cx: 960, cy: 540, z: 0.94, rot: 0 };
}
const BLOCK_SLOTS: Record<string, number[]> = { voice: [7, 8, 13, 14], edge: [8, 9, 10, 14, 15, 16], dark: [15, 14, 16, 9, 21] };
/** Power-off order at the exit: off-frame tubes first, then the dark tube's neighbours one by one. */
/** Seconds before the plate end at which each tube switches off. */
const OFF_AT: Record<number, number> = { 16: 0.314, 21: 0.249, 9: 0.189, 14: 0.129 };
const OFF_REST = 0.374, OFF_DARK = 0.069, OFF_LEN = 0.075;

export default class Crt extends Scene {
  private layer!: Layer2D;
  private list: Shot[] = [];
  private plate!: PlateInfo;
  private P!: NamedPalette;
  private lines: Line[] = [];
  private noise!: HTMLCanvasElement;
  private scan!: CanvasPattern;
  private grille!: CanvasPattern;

  override init() {
    this.plate = this.ctx.params as PlateInfo;
    this.P = palette(this.ctx.params.look?.palette ?? 'crt');
    this.list = shots(this.plate, this.ctx.audio);
    this.lines = ownedLines(this.ctx);
    this.layer = new Layer2D();
    const P = this.P;
    // static: grey noise tinted by CRT white (from the palette hex, no literals)
    const n = document.createElement('canvas');
    n.width = 160; n.height = 120;
    const nc = n.getContext('2d')!;
    const img = nc.createImageData(n.width, n.height);
    const hv = parseInt(P.hi.slice(1), 16), hr = (hv >> 16) & 255, hg = (hv >> 8) & 255, hb = hv & 255;
    for (let i = 0; i < n.width * n.height; i++) {
      const v = hash(i * 1.37 + 0.5); const k = v * v;
      img.data[i * 4] = hr * k; img.data[i * 4 + 1] = hg * k; img.data[i * 4 + 2] = hb * k; img.data[i * 4 + 3] = 255;
    }
    nc.putImageData(img, 0, 0);
    this.noise = n;
    // scanlines: one dark row every 4 world px
    const s = document.createElement('canvas');
    s.width = 4; s.height = 4;
    const sc = s.getContext('2d')!;
    sc.fillStyle = pcss(P, 'ground', 0.62); sc.fillRect(0, 2, 4, 2);
    this.scan = this.layer.ctx.createPattern(s, 'repeat')!;
    // aperture grille: vertical phosphor triads (warm / green / blue), 1 world px each
    const g = document.createElement('canvas');
    g.width = 3; g.height = 1;
    const gc = g.getContext('2d')!;
    gc.fillStyle = pcss(P, 'signal', 1); gc.fillRect(0, 0, 1, 1);
    gc.fillStyle = pcss(P, 'deep', 1); gc.fillRect(1, 0, 1, 1);
    gc.fillStyle = pcss(P, 'mid', 1); gc.fillRect(2, 0, 1, 1);
    this.grille = this.layer.ctx.createPattern(g, 'repeat')!;
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, audio } = this.ctx;
    const t = f.t, p = this.plate, P = this.P;
    const sh = shotAt(this.list, t);
    const cam0 = String(sh.shot.s.cam), block = String(sh.shot.s.block);
    const u = clamp((t - sh.t0) / Math.max(1e-3, Math.min(sh.t1, p.end) - sh.t0));
    const bp = beatPulse(audio, t, 0.12), kp = kickPulse(audio, t, 0.14), dp = downbeatPulse(audio, t, 0.22);
    const bi = beatIndex(audio, t);
    const nb = Math.max(0, bi - beatIndex(audio, p.start + 1e-3));
    const tb = bi >= 0 ? audio.beats[bi]! : p.start;
    const line = this.lines[0];
    const nSyl = line ? line.words.reduce((a, w) => a + (w.syl?.length ?? 1), 0) : 0;
    const last = nSyl - 1;

    // which tube rolls its vertical hold on this beat (inside the frame when the camera is close)
    const pool = BLOCK_SLOTS[block] ?? null;
    const rollSlot = pool ? pool[Math.floor(hash(nb * 5 + 2) * pool.length)]! : Math.floor(hash(nb * 5 + 2) * N);
    const rollPh = clamp((t - tb) / 0.3);
    const roll = (s: number, h: number) => (s === rollSlot && rollPh < 1 ? (1 - Math.pow(1 - rollPh, 2.2)) * h : 0);

    // syllable -> tube, and which syllable is being voiced
    const tubeText = new Map<number, number>();
    for (let k = 0; k < nSyl; k++) tubeText.set(slotOf(k, nb, last), k);

    // power-off (exit): 0 = on, 1 = off
    const offT = (s: number) => p.end - (s === DARK ? OFF_DARK : OFF_AT[s] ?? OFF_REST);
    const off = (s: number) => clamp((t - offT(s)) / OFF_LEN);

    const L = this.layer, c = L.ctx;
    L.clear(pcss(P, 'ground'));

    // camera: hard framing per shot + a slow push inside the shot + a beat nudge
    const cm = camFor(block);
    const z = cm.z * (1 + 0.035 * u) * (1 + 0.012 * bp);
    c.save();
    c.translate(960, 540);
    if (cm.rot) c.rotate(cm.rot);
    c.scale(z, z);
    c.translate(-cm.cx, -cm.cy);
    const camM = c.getTransform();
    const close = cam0 !== 'wide';

    // ---- cabinets
    for (let s = 0; s < N; s++) {
      const cr = cell(s);
      const shade = 0.07 + 0.05 * hash(s * 11 + 5);
      c.fillStyle = pmix(P, 'ground', 'hi', shade);
      c.beginPath(); c.roundRect(cr.x + 6, cr.y + 6, cr.w - 12, cr.h - 12, 10); c.fill();
      c.strokeStyle = pmix(P, 'ground', 'hi', shade + 0.06); c.lineWidth = 2; c.stroke();
      const sr = screenRect(s);
      // bezel
      c.fillStyle = pmix(P, 'ground', 'hi', 0.03);
      c.beginPath(); c.roundRect(sr.x - 7, sr.y - 7, sr.w + 14, sr.h + 14, 26); c.fill();
      if (sidePanel(s)) {
        const kx = sr.x + sr.w + (cr.x + cr.w - 6 - sr.x - sr.w) / 2;
        for (let j = 0; j < 2; j++) {
          c.fillStyle = pmix(P, 'ground', 'hi', 0.22);
          c.beginPath(); c.arc(kx, sr.y + 26 + j * 44, 11, 0, Math.PI * 2); c.fill();
          c.fillStyle = pmix(P, 'ground', 'hi', 0.05);
          c.fillRect(kx - 1.5, sr.y + 17 + j * 44, 3, 9);
        }
        c.fillStyle = pmix(P, 'ground', 'hi', 0.04);
        for (let j = 0; j < 7; j++) c.fillRect(kx - 14, sr.y + 118 + j * 8, 28, 3);
      } else {
        c.fillStyle = pmix(P, 'ground', 'hi', 0.04);
        for (let j = 0; j < 12; j++) c.fillRect(sr.x + sr.w * 0.25 + j * (sr.w * 0.5 / 12), sr.y + sr.h + 16, 4, 12);
      }
    }

    // ---- screens: signal content (clipped to the glass), rolled when losing vertical hold
    for (let s = 0; s < N; s++) {
      const sr = screenRect(s);
      c.save();
      c.beginPath(); c.roundRect(sr.x, sr.y, sr.w, sr.h, 22); c.clip();
      c.fillStyle = pcss(P, 'ground'); c.fillRect(sr.x, sr.y, sr.w, sr.h);
      const o = off(s);
      if (o < 1) {
        const dy = roll(s, sr.h);
        for (const shift of dy > 0 ? [dy, dy - sr.h] : [0]) {
          c.save(); c.translate(sr.x, sr.y + shift);
          this.content(c, s, sr.w, sr.h, t, tubeText.has(s), nb, kp);
          c.restore();
        }
        if (dy > 0) { c.fillStyle = pcss(P, 'ground'); c.fillRect(sr.x, sr.y + dy - 10, sr.w, 16); }
      }
      c.restore();
    }

    // ---- the line: one syllable per tube (drawLyric, each glyph moved to its tube's centre)
    if (line) {
      const lay: LineLayout = layoutLine(c, line, F.slam(), GLYPH);
      const inTube = (k: number) => slotOf(k, nb, last);
      drawLyric(c, line, t, {
        x: 0, y: 0, family: F.slam(), size: GLYPH, align: 'left', unsungAlpha: 0.2, lead: 1,
        charTransform: (_ch: string, idx: number, st: CharState) => {
          const b = lay.chars[idx]!;
          const s = inTube(idx), sr = screenRect(s);
          const o = off(s);
          const voice = st.sung && st.frac < 1;
          // the future stays hidden until it is sung
          const a = idx === last && !st.sung ? 0 : 1;
          const squash = o > 0 ? Math.max(0.02, 1 - o) : 1;
          return {
            dx: sr.x + sr.w / 2 - (b.x + b.w / 2),
            dy: sr.y + sr.h / 2 + GLYPH * 0.35 + roll(s, sr.h) + 4,
            scale: (voice ? 1.06 - 0.06 * st.frac : 1) * squash,
            alpha: a * (1 - o),
          };
        },
        drawChar: (cc: CanvasRenderingContext2D, ch: string, st: CharState) => {
          const idx = st.box.index;
          const s = inTube(idx), sr = screenRect(s);
          const m = cc.getTransform();
          cc.setTransform(camM);
          cc.beginPath(); cc.roundRect(sr.x, sr.y, sr.w, sr.h, 22); cc.clip();
          cc.setTransform(m);
          const future = idx === last;
          const voice = st.sung && st.frac < 1;
          const fill = future ? pcss(P, 'signal') : st.sung ? pcss(P, 'text') : pcss(P, 'deep', 0.9);
          cc.fillStyle = fill;
          if (st.sung) { cc.shadowColor = future ? pcss(P, 'signal', 0.9) : voice ? pcss(P, 'deep', 0.9) : pcss(P, 'hi', 0.6); cc.shadowBlur = (voice || future ? 26 : 12) * z; }
          const dy = roll(s, sr.h);
          cc.fillText(ch, 0, 0);
          if (dy > 0) cc.fillText(ch, 0, -sr.h);
          cc.shadowBlur = 0;
        },
      });
    }

    // ---- the future: a warm dot inside the dark tube's glass
    {
      const sr = screenRect(DARK);
      const x = sr.x + sr.w / 2, y = sr.y + sr.h / 2 + roll(DARK, sr.h) * 0;
      const lw = line?.words[line.words.length - 1];
      const lt = lw && t >= (lw.syl?.[lw.syl.length - 1]?.[0] ?? lw.start) ? 1 : 0;
      const r = (cam0 === 'macro' ? 5 : 7) * (1 + 0.5 * bp + 0.3 * lt);
      const g = c.createRadialGradient(x, y, 0, x, y, r * 5);
      g.addColorStop(0, pcss(P, 'signal', 0.55 + 0.3 * kp));
      g.addColorStop(1, pcss(P, 'signal', 0));
      c.fillStyle = g; c.beginPath(); c.arc(x, y, r * 5, 0, Math.PI * 2); c.fill();
      c.fillStyle = pmix(P, 'signal', 'hi', 0.55);
      c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
    }

    // ---- glass: scanlines, aperture grille (close), hum bar, curvature shading, specular, power-off
    for (let s = 0; s < N; s++) {
      const sr = screenRect(s);
      c.save();
      c.beginPath(); c.roundRect(sr.x, sr.y, sr.w, sr.h, 22); c.clip();
      c.fillStyle = this.scan; c.fillRect(sr.x, sr.y, sr.w, sr.h);
      if (close) {
        c.globalCompositeOperation = 'multiply';
        c.globalAlpha = 0.55;
        c.fillStyle = this.grille; c.fillRect(sr.x, sr.y, sr.w, sr.h);
        c.globalAlpha = 1;
        c.globalCompositeOperation = 'source-over';
      }
      // rolling hum bar
      const hy = sr.y + ((t * 0.3 + hash(s * 13)) % 1) * (sr.h + 60) - 30;
      const hg = c.createLinearGradient(0, hy - 30, 0, hy + 30);
      hg.addColorStop(0, pcss(P, 'hi', 0)); hg.addColorStop(0.5, pcss(P, 'hi', 0.07)); hg.addColorStop(1, pcss(P, 'hi', 0));
      c.fillStyle = hg; c.fillRect(sr.x, hy - 30, sr.w, 60);
      // curvature: darker corners
      const cx = sr.x + sr.w / 2, cy = sr.y + sr.h / 2;
      const vg = c.createRadialGradient(cx, cy, sr.h * 0.35, cx, cy, sr.w * 0.72);
      vg.addColorStop(0, pcss(P, 'ground', 0)); vg.addColorStop(1, pcss(P, 'ground', 0.75));
      c.fillStyle = vg; c.fillRect(sr.x, sr.y, sr.w, sr.h);
      // specular reflection on the curved glass
      c.fillStyle = pcss(P, 'hi', 0.05);
      c.beginPath(); c.ellipse(sr.x + sr.w * 0.3, sr.y + sr.h * 0.2, sr.w * 0.28, sr.h * 0.1, -0.25, 0, Math.PI * 2); c.fill();
      // power-off: the picture collapses to a line, then to a dot (the dark tube keeps its warm dot)
      const o = off(s);
      if (o > 0 && s !== DARK) {
        const a = clamp(o / 0.55), b2 = clamp((o - 0.55) / 0.45);
        const lh = Math.max(2, sr.h * (1 - a) * 0.5), lw = sr.w * (1 - b2) + 6;
        c.fillStyle = pcss(P, 'hi', 0.9 * (1 - b2 * 0.5));
        c.fillRect(cx - lw / 2, cy - lh / 2, lw, lh);
        if (b2 >= 1) {
          const k = clamp(1 - (t - offT(s) - OFF_LEN) / 0.25);
          c.fillStyle = pcss(P, 'hi', 0.8 * k);
          c.beginPath(); c.arc(cx, cy, 3, 0, Math.PI * 2); c.fill();
        }
      }
      c.restore();
    }
    c.restore();

    // hosted (v4 NIGHT, scenes/wall.ts): transparent ground — the wall host owns the brick
    if (this.ctx.params.hosted) clearRT(renderer, out, [0, 0, 0], 0); else clearRT(renderer, out, plin(P, 'ground'));
    const k = 1.05 + 0.5 * kp;
    this.ctx.comp.draw(renderer, L.upload(), out, { mode: 'normal', tint: [k, k, k] });

    const cut = Math.exp(-(t - sh.t0) / 0.12);
    return {
      bloom: close ? 0.55 : 0.4, bloomThreshold: 0.62, bloomRadius: 0.6,
      zoom: 1 + 0.03 * dp + 0.05 * cut * (sh.index > 0 ? 1 : 0),
      flash: cam0 === 'macro' ? 0.12 * cut : 0,
      ca: close ? 2.2 : 1.2, grain: 0.04, vignette: 0.32,
    };
  }

  /** One tube's picture in screen-local px (0..w, 0..h). */
  private content(c: CanvasRenderingContext2D, s: number, w: number, h: number, t: number, text: boolean, nb: number, kp: number) {
    const P = this.P;
    if (s === DARK) {
      c.fillStyle = pmix(P, 'ground', 'signal', 0.04); c.fillRect(0, 0, w, h);
      return;
    }
    if (text) {
      // a syllable's tube: dark phosphor field with a faint green raster
      c.fillStyle = pmix(P, 'ground', 'deep', 0.1 + 0.06 * kp); c.fillRect(0, 0, w, h);
      return;
    }
    const kind = (signalOf(s) + nb) % 5; // each beat re-tunes the idle sets to another broken channel
    const fr = Math.floor(t * 24);
    if (kind === 0) {
      // colour bars (in the wall's palette), torn horizontally by a sync fault
      const roles = [['hi', 'hi', 0], ['hi', 'deep', 0.5], ['deep', 'deep', 0], ['deep', 'mid', 0.5], ['mid', 'mid', 0], ['ground', 'mid', 0.2]] as const;
      for (let y = 0; y < h; y += 6) {
        const tear = Math.sin(y * 0.09 + t * 7 + s) * 6 + (hash(fr + y + s) > 0.93 ? 24 : 0);
        roles.forEach(([a, b, m], i) => { c.fillStyle = pmix(P, a, b, m, 0.85); c.fillRect(tear + (i * w) / 6, y, w / 6 + 1, 6); });
      }
    } else if (kind === 1) {
      // snow
      c.imageSmoothingEnabled = false;
      const ox = hash(fr * 3 + s) * 40, oy = hash(fr * 5 + s) * 30;
      c.globalAlpha = 0.75;
      c.drawImage(this.noise, ox, oy, 100, 80, 0, 0, w, h);
      c.globalAlpha = 1;
      c.imageSmoothingEnabled = true;
    } else if (kind === 2) {
      // magnet-distorted raster (Paik's Magnet TV): wavy blue lines
      c.strokeStyle = pcss(P, 'mid', 0.9); c.lineWidth = 3;
      for (let j = 0; j < 9; j++) {
        c.beginPath();
        for (let x = 0; x <= w; x += 8) {
          const y = (j + 0.5) * (h / 9) + Math.sin(x * 0.03 + t * 3 + j * 0.7 + s) * 12 * Math.sin(t * 1.3 + j);
          if (x === 0) c.moveTo(x, y); else c.lineTo(x, y);
        }
        c.stroke();
      }
    } else if (kind === 3) {
      // lost vertical deflection: one bright horizontal line
      c.fillStyle = pcss(P, 'hi', 0.9); c.fillRect(0, h / 2 - 2, w, 4);
      c.fillStyle = pcss(P, 'hi', 0.18); c.fillRect(0, h / 2 - 12, w, 24);
    } else {
      // green concentric rings (a test pattern breathing)
      c.strokeStyle = pcss(P, 'deep', 0.85); c.lineWidth = 3;
      for (let j = 1; j < 7; j++) {
        c.beginPath(); c.ellipse(w / 2, h / 2, j * w * 0.08 * (1 + 0.1 * Math.sin(t * 4 + j)), j * h * 0.08, 0, 0, Math.PI * 2); c.stroke();
      }
    }
  }
}
