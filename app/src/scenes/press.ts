// PRESS — letterpress on bone paper: heavy ink, two-pass misregistration, halftone, the platen stamp.
// Every plate is a print job; the words are the ink. Structure comes from ./press.shots (stateAt: frame + medium),
// the beat is the platen: each beat stamps (ink density, paper jolt, a new impression, a scraper stroke...).
// Variants (data/edit.json, storyboard in docs/STORYBOARD.md):
//   dream    line 4 printed huge in ink, a signal second pass slides out of register until the words double;
//            poster → crop with halftone → raking light lifting the two passes; the paper slides up out of frame
//   squeeze  line 8 overprinted by a roller that never stops (one impression per beat, 14 px apart), the web runs
//            faster each bar, the stop latch bounces off on every downbeat; side → top view → macro on the latch
//   title    DYSON SPHERE (Archivo) re-stamped per beat, width/weight stepping; a signal disc stamped behind; the
//            letter counters turn into panel holes and the camera goes through the O into the shell
//   erase    line 25 stamped, every word scraped off after it is sung (one scraper stroke per beat); ghost impression
//   burst    drop-2 entry: the printing plate shatters, type slabs crash into depth, align into raster lines that
//            become copper bars; full-frame polarity swap for one beat on each downbeat
//   credits  DYSON SPHERE / Sentient Architect stamped one glyph at a time, the stamp's afterimage lingers; to black
// All passes of a lyric line are drawLyric() calls with the line's sung state (secondary passes: unsungAlpha 0).
import type * as THREE from 'three';
import { Scene, type Frame, type PostOverrides } from '../engine/scene';
import { Layer2D, clearRT } from '../engine/gl';
import { LIN, rgba, type PaletteKey } from '../engine/palette';
import { drawLyric, ownedLines, layoutLine, F, type DrawLyricOpts, type CharState, type CharXform } from '../engine/lyric';
import { beatPulse, kickPulse, downbeatPulse, beatIndex, barIndex } from '../engine/beat';
import { stateAt, shotAt, type PlateInfo, type Shot } from '../engine/shots';
import { ot, font, layout } from '../engine/type';
import { clamp, ease, hash, lerp, mulberry32, smoothstep } from '../engine/util';
import type { Line } from '../engine/lyrics';
import { shots } from './press.shots';

const W = 1920, H = 1080;
type Cam = { s: number; x: number; y: number; r: number };
type C2 = CanvasRenderingContext2D;
type P = { x: number; y: number };

/** Page point (x, y) at the frame centre (+dx, dy screen px), scale s, rotation r. */
function setCam(c: C2, k: Cam, dx = 0, dy = 0) {
  const a = Math.cos(k.r) * k.s, b = Math.sin(k.r) * k.s;
  c.setTransform(a, b, -b, a, W / 2 + dx - (a * k.x - b * k.y), H / 2 + dy - (b * k.x + a * k.y));
}
const outExpo = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : 1 - Math.pow(2, -10 * x));
const wordEnd = (w: Line['words'][number]) => (w.syl?.length ? w.syl[w.syl.length - 1]![1] : w.end);

/** Two-row setting of one lyric line (flush left): split word, size, per-word x at that size. */
interface Rows { size: number; split: number; wordX: number[]; wordW: number[]; rowW: [number, number]; gap: number }

/** Glyph outline at size 100 (baseline 0): whole path, its counters, advance. */
interface Glyph { path: Path2D; holes: Path2D | null; hole: P | null; adv: number }

export default class Press extends Scene {
  private L!: Layer2D;
  private A!: Layer2D; // offscreen pass
  private B!: Layer2D; // offscreen pass 2 (burst plate)
  private list: Shot[] = [];
  private plate!: PlateInfo;
  private lines: Line[] = [];
  private wear!: CanvasPattern;
  private dots!: CanvasPattern;
  private dots2!: CanvasPattern;
  private paper!: CanvasPattern;
  /** Negative print (burst polarity swap): paper and ink trade places; signal stays. */
  private neg = false;
  private k(key: PaletteKey): PaletteKey {
    if (!this.neg) return key;
    return ({ bone: 'ink', ink: 'bone', paper2: 'ink2', ink2: 'paper2' } as Partial<Record<PaletteKey, PaletteKey>>)[key] ?? key;
  }
  private rowCache = new Map<string, Rows>();
  private glyphCache = new Map<string, Glyph>();
  private plateReady = false;
  private shards: { poly: P[]; c: P; dir: P; spin: number; dz: number }[] = [];

  override init() {
    this.plate = this.ctx.params as PlateInfo;
    this.list = shots(this.plate, this.ctx.audio);
    this.lines = ownedLines(this.ctx);
    this.L = new Layer2D();
    this.A = new Layer2D();
    const tile = (n: number, draw: (c: C2, rnd: () => number) => void) => {
      const cv = document.createElement('canvas');
      cv.width = cv.height = n;
      const c = cv.getContext('2d')!;
      draw(c, mulberry32(n * 7 + 3));
      return this.L.ctx.createPattern(cv, 'repeat')!;
    };
    // ink wear: pits and dry streaks knocked out of every impression
    this.wear = tile(256, (c, rnd) => {
      for (let i = 0; i < 1400; i++) {
        c.fillStyle = rgba('ink', 0.15 + 0.85 * rnd() ** 2);
        const r = 0.4 + 1.6 * rnd() ** 3;
        c.beginPath(); c.arc(rnd() * 256, rnd() * 256, r, 0, Math.PI * 2); c.fill();
      }
      for (let i = 0; i < 26; i++) {
        c.fillStyle = rgba('ink', 0.25 * rnd());
        c.fillRect(rnd() * 256, rnd() * 256, 20 + 60 * rnd(), 0.6 + rnd());
      }
    });
    const screen = (n: number, r: number) => tile(n, (c) => {
      c.fillStyle = rgba('ink');
      c.beginPath(); c.arc(n / 2, n / 2, r, 0, Math.PI * 2); c.fill();
      for (const [x, y] of [[0, 0], [n, 0], [0, n], [n, n]] as const) { c.beginPath(); c.arc(x, y, r * 0.55, 0, Math.PI * 2); c.fill(); }
    });
    this.dots = screen(11, 3.9);
    this.dots.setTransform(new DOMMatrix().rotateSelf(45));
    this.dots2 = screen(11, 3.4);
    this.dots2.setTransform(new DOMMatrix().rotateSelf(15));
    // bone paper: fibres and specks
    this.paper = tile(512, (c, rnd) => {
      for (let i = 0; i < 900; i++) {
        c.strokeStyle = rgba(rnd() > 0.5 ? 'graphite' : 'paper2', 0.05 + 0.1 * rnd());
        c.lineWidth = 0.5 + rnd();
        const x = rnd() * 512, y = rnd() * 512, a = rnd() * Math.PI, l = 3 + 14 * rnd();
        c.beginPath(); c.moveTo(x, y); c.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); c.stroke();
      }
      for (let i = 0; i < 300; i++) { c.fillStyle = rgba('graphite', 0.12 * rnd()); c.fillRect(rnd() * 512, rnd() * 512, 1.2, 1.2); }
    });
    if (this.plate.variant === 'burst') this.makeShards();
  }

  // ------------------------------------------------------------------ shared print helpers
  private get au() { return this.ctx.audio; }
  private get beatLen() { return 60 / this.ctx.audio.bpm; }

  /** The paper: bone + fibres in page space (moves with the camera). */
  private paperGround(c: C2, cam: Cam, dx = 0, dy = 0, rect?: [number, number, number, number]) {
    c.save();
    setCam(c, cam, dx, dy);
    c.fillStyle = rgba(this.k('bone'));
    const [x, y, w, h] = rect ?? [-3000, -3000, 8000, 8000];
    c.fillRect(x, y, w, h);
    if (!this.neg) { c.fillStyle = this.paper; c.fillRect(x, y, w, h); }
    c.restore();
  }

  /** Draw into the offscreen pass, knock out wear (and optionally a halftone screen), composite onto L. */
  private pass(draw: (c: C2) => void, o: { comp?: GlobalCompositeOperation; alpha?: number; cam?: Cam; dx?: number; dy?: number; screen?: CanvasPattern; wear?: number; shadow?: [number, number, number, number] } = {}) {
    const A = this.A, c = A.ctx;
    A.clear();
    c.save(); draw(c); c.restore();
    if (o.cam && (o.wear ?? 0.8) > 0) {
      c.save(); setCam(c, o.cam, o.dx, o.dy);
      c.globalCompositeOperation = 'destination-out';
      c.globalAlpha = o.wear ?? 0.8;
      c.fillStyle = this.wear;
      c.fillRect(-3000, -3000, 8000, 8000);
      c.restore();
    }
    if (o.cam && o.screen) {
      c.save(); setCam(c, o.cam, o.dx, o.dy);
      c.globalCompositeOperation = 'destination-in';
      c.fillStyle = o.screen;
      c.fillRect(-3000, -3000, 8000, 8000);
      c.restore();
    }
    const m = this.L.ctx;
    m.save();
    m.setTransform(1, 0, 0, 1, 0, 0);
    if (o.shadow) {
      m.shadowColor = rgba('ink', o.shadow[3]);
      m.shadowOffsetX = o.shadow[0]; m.shadowOffsetY = o.shadow[1]; m.shadowBlur = o.shadow[2];
    }
    m.globalCompositeOperation = o.comp ?? 'multiply';
    m.globalAlpha = o.alpha ?? 1;
    m.drawImage(A.canvas, 0, 0, W, H);
    m.restore();
  }

  /** Two-row flush-left setting of a line, balanced, fitted to maxW (cached per line/family). */
  private rows(line: Line, family: string, maxW: number, maxSize: number): Rows {
    const key = `${line.start}|${family}|${maxW}|${maxSize}`;
    const hit = this.rowCache.get(key);
    if (hit) return hit;
    const c = this.L.ctx;
    const probe = layoutLine(c, line, family, 100);
    const n = probe.words.length;
    const gapW = n > 1 ? probe.words[1]!.x - (probe.words[0]!.x + probe.words[0]!.w) : 28;
    let split = Math.max(1, Math.ceil(n / 2)), best = Infinity;
    for (let k = 1; k < n; k++) {
      const r1 = probe.words[k - 1]!.x + probe.words[k - 1]!.w, r2 = probe.width - probe.words[k]!.x;
      if (Math.max(r1, r2) < best) { best = Math.max(r1, r2); split = k; }
    }
    if (n < 2) { split = n; best = probe.width; }
    void gapW;
    const size = Math.min(maxSize, (maxW / Math.max(1, best)) * 100);
    const lay = layoutLine(c, line, family, size);
    const wordX = lay.words.map((w) => w.x), wordW = lay.words.map((w) => w.w);
    const r1 = split > 0 ? wordX[split - 1]! + wordW[split - 1]! : 0;
    const r2 = split < n ? lay.width - wordX[split]! : 0;
    const out: Rows = { size, split, wordX, wordW, rowW: [r1, r2], gap: size * 1.08 };
    this.rowCache.set(key, out);
    return out;
  }

  /** Page-space box of word k in a two-row setting anchored at (x0, baseline y0). */
  private wordBox(R: Rows, k: number, x0: number, y0: number) {
    const row = k >= R.split ? 1 : 0;
    const x = x0 + R.wordX[k]! - (row ? R.wordX[R.split]! : 0);
    return { x, y: y0 + row * R.gap - R.size * 0.72, w: R.wordW[k]!, h: R.size * 0.8, cx: x + R.wordW[k]! / 2, cy: y0 + row * R.gap - R.size * 0.36 };
  }

  /** drawLyric in the two-row setting; extra per-char motion composes on top of the row offset. */
  private lyricRows(c: C2, line: Line, t: number, R: Rows, x0: number, y0: number, family: string, o: Partial<DrawLyricOpts> & { xf?: (s: CharState, i: number) => CharXform | void }) {
    drawLyric(c, line, t, {
      x: x0, y: y0, size: R.size, align: 'left', family,
      sungColor: 'ink', unsungColor: 'graphite', unsungAlpha: 0.14, lead: 1.5,
      ...o,
      charTransform: (_ch, i, s) => {
        const row = s.word >= R.split ? 1 : 0;
        const e = o.xf?.(s, i) || {};
        return { ...e, dx: (e.dx ?? 0) - (row ? R.wordX[R.split]! : 0), dy: (e.dy ?? 0) + row * R.gap };
      },
    });
  }

  /** Index of the word being sung at t (last started; 0 before the line). */
  private curWord(line: Line, t: number) {
    let k = 0;
    line.words.forEach((w, i) => { if (t >= w.start) k = i; });
    return k;
  }

  /** Camera focus that eases from word to word (0.25 s) instead of jumping. */
  private followWord(line: Line, t: number, box: (k: number) => P): P {
    const k = this.curWord(line, t);
    const a = box(Math.max(0, k - 1)), b = box(k);
    const m = k === 0 ? 1 : ease.inOutCubic(clamp((t - line.words[k]!.start) / 0.25));
    return { x: lerp(a.x, b.x, m), y: lerp(a.y, b.y, m) };
  }

  /** Printer's registration mark (crosshair in a circle). */
  private regMark(c: C2, x: number, y: number, r: number, col: PaletteKey, a = 1) {
    c.strokeStyle = rgba(col, a);
    c.lineWidth = 2.2;
    c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.stroke();
    c.beginPath(); c.moveTo(x - r * 1.6, y); c.lineTo(x + r * 1.6, y); c.moveTo(x, y - r * 1.6); c.lineTo(x, y + r * 1.6); c.stroke();
  }

  private slug(c: C2, text: string, x: number, y: number, size = 20, col: PaletteKey = 'graphite') {
    c.font = font(F.mono(500), size);
    c.fillStyle = rgba(col, 0.9);
    c.textAlign = 'left';
    c.fillText(text, x, y);
  }

  // ------------------------------------------------------------------ render
  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer } = this.ctx;
    const st = stateAt(this.list, f.t);
    const sh = shotAt(this.list, f.t);
    const frame = String(st.frame), medium = String(st.medium);
    this.L.clear(rgba('bone'));
    const v = this.plate.variant;
    const post: PostOverrides =
      v === 'dream' ? this.dream(f, frame, sh.t0)
      : v === 'squeeze' ? this.squeeze(f, frame, sh.t0)
      : v === 'title' ? this.title(f, frame, medium, sh.t0)
      : v === 'erase' ? this.erase(f, frame, sh.t0)
      : v === 'burst' ? this.burst(f, frame, medium, sh.t0)
      : this.credits(f, frame, sh.t0);
    this.L.upload();
    clearRT(renderer, out, LIN.bone);
    this.ctx.comp.draw(renderer, this.L.texture, out, { mode: 'normal' });
    return { bloom: 0, vignette: 0.18, grain: 0.05, ca: 0.4, ...post };
  }

  // ------------------------------------------------------------------ dream: two passes out of register
  private dream(f: Frame, frame: string, t0: number): PostOverrides {
    const t = f.t, au = this.au, line = this.lines[0]!;
    const fam = F.slam();
    const R = this.rows(line, fam, 1600, 330);
    const x0 = 160, y0 = 540 - R.gap / 2 + R.size * 0.36;
    // platen stamp per beat: ink density +30 %, the paper jolts 6 px down
    const bp = beatPulse(au, t, 0.09);
    const jolt = 6 * beatPulse(au, t, 0.07);
    const density = 0.72 + 0.28 * bp;
    // exit: the paper slides up out of frame over the last beat
    const ex = ease.inCubic(clamp((t - (this.ctx.end - this.beatLen)) / this.beatLen));
    const dy = jolt - ex * H * 1.15;
    // misregistration grows through the line, and slips on each stamp
    const m = smoothstep(line.start - 0.2, line.end, t);
    const mis = { x: 5 + 30 * m + 5 * bp, y: -3 - 15 * m - 2 * bp };
    const box = (k: number) => { const b = this.wordBox(R, k, x0, y0); return { x: b.cx, y: b.cy }; };
    const lt = t - t0;
    const cam: Cam =
      frame === 'crop' ? { s: 2.05 + 0.04 * lt, ...this.followWord(line, t, box), r: -0.02 }
      : frame === 'raking' ? { s: 1.28 + 0.03 * lt, x: 1000 - 30 * lt, y: 560, r: -0.07 }
      : { s: 0.98 + 0.012 * lt, x: W / 2, y: H / 2, r: 0 };
    const c = this.L.ctx;
    if (ex > 0) { c.fillStyle = rgba('ink'); c.fillRect(0, 0, W, H); }
    this.paperGround(c, cam, 0, dy, [-80, -80, W + 160, H + 160]);
    const raking = frame === 'raking', crop = frame === 'crop';
    if (raking) {
      // raking light from the left: the paper falls off into shade on the right
      c.save(); setCam(c, cam, 0, dy);
      const g = c.createLinearGradient(-80, 0, W + 80, 0);
      g.addColorStop(0, rgba('bone', 0)); g.addColorStop(1, rgba('graphite', 0.32));
      c.fillStyle = g; c.globalCompositeOperation = 'multiply'; c.fillRect(-80, -80, W + 160, H + 160);
      c.restore();
    }
    // furniture: registration marks + slug (printed by both passes)
    const furniture = (c2: C2, col: PaletteKey) => {
      for (const [x, y] of [[70, 70], [W - 70, 70], [70, H - 70], [W - 70, H - 70]] as const) this.regMark(c2, x, y, 18, col);
      c2.fillStyle = rgba(col); c2.fillRect(160, 190, 1600, 7);
      this.slug(c2, 'PROOF 04 · 2 COL · BONE 120 G', 160, 930, 22, col);
    };
    const lift = raking ? 1 : 0;
    // pass 1: signal (second colour) — out of register
    this.pass((p) => {
      setCam(p, cam, mis.x * cam.s + lift * 16, mis.y * cam.s + dy + lift * -12);
      furniture(p, 'signal');
      this.lyricRows(p, line, t, R, x0, y0, fam, { sungColor: 'signal', unsungAlpha: 0 });
    }, { cam, dx: mis.x * cam.s, dy: mis.y * cam.s + dy, screen: crop ? this.dots2 : undefined, wear: 0.6, comp: raking ? 'source-over' : 'multiply', shadow: raking ? [30, 26, 26, 0.3] : undefined, alpha: 0.95 });
    // pass 2: ink key — the words, huge
    this.pass((p) => {
      setCam(p, cam, 0, dy);
      furniture(p, 'ink');
      this.lyricRows(p, line, t, R, x0, y0, fam, {
        xf: (s) => (s.sung ? { scale: 1 + 0.035 * (1 - s.frac) ** 4 } : undefined),
      });
    }, { cam, dy, screen: crop ? this.dots : undefined, alpha: density, wear: 0.75, comp: raking ? 'source-over' : 'multiply', shadow: raking ? [10, 9, 12, 0.28] : undefined });
    // word-start punch (T1: <= 1.4x flare, <= 6 px shake)
    let ws = 0;
    for (const w of line.words) if (t >= w.start) ws = w.start;
    const wp = ws ? Math.exp(-(t - ws) / 0.08) : 0;
    return { zoom: 1 + 0.018 * wp + 0.012 * kickPulse(au, t, 0.08), shake: [0, 3 * downbeatPulse(au, t, 0.1)] };
  }

  // ------------------------------------------------------------------ squeeze: the roller that never stops
  private squeeze(f: Frame, frame: string, t0: number): PostOverrides {
    const t = f.t, au = this.au, line = this.lines[0]!, fam = F.slam();
    const start = this.ctx.start, end = this.ctx.end;
    // the web: faster each bar (piecewise constant speed, integrated)
    const downs = au.downbeats.filter((d) => d > start + 1e-3 && d < end);
    const speeds = [520, 980, 1700, 2600];
    let off = 0, last = start;
    downs.forEach((d, i) => { if (t > d) { off += (d - last) * speeds[i]!; last = d; } });
    const seg = downs.filter((d) => t > d).length;
    off += (t - last) * speeds[seg]!;
    const exitP = smoothstep(end - 0.2, end, t);
    const webOut = -2400 * exitP * exitP;
    // impressions: one when the line starts, then one on every beat
    const imps = [line.start, ...au.beats.filter((b) => b > line.start + 0.05 && b < end)].filter((x) => x <= t);
    const K = imps.length;
    const bp = beatPulse(au, t, 0.08), dp = downbeatPulse(au, t, 0.2);
    // stop latch: knocked off on each downbeat, springs back (never engages)
    const bi = barIndex(au, t), db = bi >= 0 ? au.downbeats[bi]! : -99;
    const since = t - db;
    const latch = since >= 0 && since < 1.6 ? -1.05 * Math.exp(-since / 0.28) * Math.abs(Math.cos(since * 17)) : 0;
    const c = this.L.ctx;
    const lt = t - t0;
    const top = frame === 'top', macro = frame === 'macro';
    const R = top ? this.rows(line, fam, 1320, 250) : this.rows(line, fam, 1240, 215);
    const x0 = top ? 170 : 110, y0 = top ? 560 - R.gap / 2 + R.size * 0.36 : 690;
    const box = (k: number) => { const b = this.wordBox(R, k, x0, y0); return { x: b.cx, y: b.cy }; };
    const cam: Cam = macro ? { s: 2.2 + 0.05 * lt, ...this.followWord(line, t, box), r: 0.05 }
      : top ? { s: 1, x: W / 2, y: H / 2, r: 0 }
      : { s: 0.9 + 0.02 * lt, x: W / 2 + 40, y: H / 2 + 20, r: -0.015 };
    const webY0 = top ? 60 : 500, webY1 = top ? 1020 : 960;
    // ground behind the web (the press bed) is paper2; the web is bone paper running left
    c.save(); setCam(c, cam); c.fillStyle = rgba('paper2'); c.fillRect(-2000, -2000, 6000, 6000); c.restore();
    c.save(); setCam(c, cam);
    c.fillStyle = rgba('bone'); c.fillRect(-2000 + webOut, webY0, 6000, webY1 - webY0);
    c.translate(-(off % 512), 0); c.fillStyle = this.paper; c.fillRect(-2000, webY0, 6000, webY1 - webY0);
    c.restore();
    // web furniture scrolling at web speed: perforations + ticks (the speed you see)
    c.save(); setCam(c, cam);
    c.fillStyle = rgba('ink', 0.85);
    const step = 64, o = off % step;
    for (let x = -1200 - o; x < 3200; x += step) {
      c.fillRect(x + webOut, webY0 + 12, 22, 14);
      c.fillRect(x + webOut, webY1 - 26, 22, 14);
    }
    c.fillStyle = rgba('graphite', 0.6);
    for (let x = -1200 - ((off * 1) % 400); x < 3200; x += 400) c.fillRect(x + webOut, webY0 + 40, 2, webY1 - webY0 - 80);
    c.restore();
    // before the first impression the forme is inked but the web is blank: a faint blind impression
    if (K === 0) this.pass((p) => { setCam(p, cam, webOut * cam.s, 0); this.lyricRows(p, line, t, R, x0, y0, fam, { unsungAlpha: 0.1 }); }, { cam, wear: 0.5 });
    // the overprints: impression k sits 14 px further along; the newest is the densest
    for (let k = 0; k < K; k++) {
      const age = K - 1 - k;
      const fresh = Math.exp(-(t - imps[k]!) / 0.09);
      const col: PaletteKey = k === 0 ? 'signal' : 'ink';
      this.pass((p) => {
        setCam(p, cam, (-14 * k + webOut) * cam.s, 10 * k * cam.s * 0.5);
        this.lyricRows(p, line, t, R, x0, y0, fam, {
          sungColor: col, unsungAlpha: k === K - 1 ? 0.14 : 0,
          xf: () => ({ scale: 1 + 0.05 * fresh }),
        });
      }, { cam, dx: -14 * k * cam.s, alpha: k === 0 ? 0.9 : Math.max(0.2, 0.92 * Math.pow(0.72, age)), wear: 0.55 + 0.1 * age });
    }
    // the roller (side: a cylinder on the web; top: a band across the web's right end)
    c.save(); setCam(c, cam);
    const rot = off / 170;
    if (!top) {
      const rx = 1500, ry = 330, rr = 175;
      const g = c.createLinearGradient(rx - rr, 0, rx + rr, 0);
      g.addColorStop(0, rgba('ink')); g.addColorStop(0.35, rgba('graphite')); g.addColorStop(0.55, rgba('ink2')); g.addColorStop(1, rgba('ink'));
      c.fillStyle = g; c.beginPath(); c.arc(rx, ry, rr, 0, Math.PI * 2); c.fill();
      c.strokeStyle = rgba('bone', 0.35); c.lineWidth = 3;
      for (let i = 0; i < 10; i++) { const a = rot + i * 0.628; c.beginPath(); c.moveTo(rx + Math.cos(a) * rr * 0.4, ry + Math.sin(a) * rr * 0.4); c.lineTo(rx + Math.cos(a) * rr * 0.95, ry + Math.sin(a) * rr * 0.95); c.stroke(); }
      c.fillStyle = rgba('signal'); c.beginPath(); c.arc(rx, ry, 26 + 10 * bp, 0, Math.PI * 2); c.fill();
      // frame arm
      c.fillStyle = rgba('ink'); c.fillRect(rx - 30, -400, 60, ry + 400);
      // the stop latch: pivot on the arm, tip reaching for the roller's notch
      if (!macro) this.latch(c, rx - 330, 150, 250, 0.55 + latch, 1);
    } else {
      const bx = 1560;
      const g = c.createLinearGradient(bx, 0, W + 40, 0);
      g.addColorStop(0, rgba('ink')); g.addColorStop(0.4, rgba('graphite')); g.addColorStop(0.7, rgba('ink2')); g.addColorStop(1, rgba('ink'));
      c.fillStyle = g; c.fillRect(bx, -40, W - bx + 80, H + 80);
      c.fillStyle = rgba('bone', 0.3);
      for (let i = 0; i < 12; i++) { const y = ((i * 97 + off * 0.9) % (H + 100)) - 50; c.fillRect(bx + 20, y, W - bx - 40, 3); }
      c.fillStyle = rgba('signal', 0.9); c.fillRect(bx - 8, -40, 8 + 10 * bp, H + 80);
    }
    c.restore();
    if (macro) {
      // macro on the latch, in screen space: huge, knocked off the roller on the downbeat
      c.save(); c.setTransform(1, 0, 0, 1, 0, 0);
      this.latch(c, 130, 90, 760, 0.3 + latch, 1.9);
      c.restore();
    }
    return { zoom: 1 + 0.05 * dp + 0.012 * bp, shake: [12 * dp * (hash(bi, 2) > 0.5 ? 1 : -1), 6 * dp + 2 * kickPulse(au, t, 0.06)] };
  }

  /** The stop latch: a pawl on a pivot; tip in signal. */
  private latch(c: C2, x: number, y: number, len: number, ang: number, k: number) {
    c.save();
    c.translate(x, y); c.rotate(ang);
    c.fillStyle = rgba('ink');
    c.beginPath();
    c.moveTo(0, -16 * k); c.lineTo(len, -9 * k); c.lineTo(len + 34 * k, 24 * k); c.lineTo(len, 12 * k); c.lineTo(0, 16 * k); c.closePath(); c.fill();
    c.fillStyle = rgba('signal'); c.beginPath(); c.moveTo(len, -9 * k); c.lineTo(len + 34 * k, 24 * k); c.lineTo(len, 12 * k); c.closePath(); c.fill();
    c.fillStyle = rgba('graphite'); c.beginPath(); c.arc(0, 0, 26 * k, 0, Math.PI * 2); c.fill();
    c.fillStyle = rgba('bone'); c.beginPath(); c.arc(0, 0, 8 * k, 0, Math.PI * 2); c.fill();
    c.restore();
  }

  // ------------------------------------------------------------------ title: DYSON SPHERE, stepping per beat
  private glyph(family: string, ch: string): Glyph {
    const key = `${family}|${ch}`;
    const hit = this.glyphCache.get(key);
    if (hit) return hit;
    const fnt = ot(family), g = fnt.charToGlyph(ch);
    const cmds = g.getPath(0, 0, 100).commands as { type: string; x?: number; y?: number; x1?: number; y1?: number; x2?: number; y2?: number }[];
    const subs: typeof cmds[] = [];
    for (const k of cmds) { if (k.type === 'M' || !subs.length) subs.push([]); subs[subs.length - 1]!.push(k); }
    const area = (s: typeof cmds) => {
      const pts = s.filter((k) => k.type !== 'Z').map((k) => [k.x!, k.y!] as const);
      let a = 0;
      for (let i = 0; i < pts.length; i++) { const p = pts[i]!, q = pts[(i + 1) % pts.length]!; a += p[0] * q[1] - q[0] * p[1]; }
      return a / 2;
    };
    const toPath = (ss: typeof cmds[]) => {
      const p = new Path2D();
      for (const s of ss) for (const k of s) {
        if (k.type === 'M') p.moveTo(k.x!, k.y!);
        else if (k.type === 'L') p.lineTo(k.x!, k.y!);
        else if (k.type === 'Q') p.quadraticCurveTo(k.x1!, k.y1!, k.x!, k.y!);
        else if (k.type === 'C') p.bezierCurveTo(k.x1!, k.y1!, k.x2!, k.y2!, k.x!, k.y!);
        else if (k.type === 'Z') p.closePath();
      }
      return p;
    };
    const areas = subs.map(area);
    let outer = 0;
    areas.forEach((a, i) => { if (Math.abs(a) > Math.abs(areas[outer]!)) outer = i; });
    const sg = Math.sign(areas[outer] ?? 1);
    const holeSubs = subs.filter((_, i) => Math.sign(areas[i]!) !== sg && Math.abs(areas[i]!) > 20);
    let hole: P | null = null;
    if (holeSubs.length) {
      const pts = holeSubs[0]!.filter((k) => k.type !== 'Z');
      hole = { x: pts.reduce((s, k) => s + k.x!, 0) / pts.length, y: pts.reduce((s, k) => s + k.y!, 0) / pts.length };
    }
    const out: Glyph = { path: toPath(subs), holes: holeSubs.length ? toPath(holeSubs) : null, hole, adv: (g.advanceWidth ?? 0) * 100 / fnt.unitsPerEm };
    this.glyphCache.set(key, out);
    return out;
  }

  /** Title setting for width/weight step k (0..11): family, x scale, size, per-letter x, baseline. */
  private titleSet(text: string, k: number, maxW: number, maxCap: number, cx: number, cy: number) {
    const width = 62 + (63 * k) / 11, weight = 300 + (600 * k) / 11;
    const family = F.archivo(width, weight);
    const nominal = family.includes('-750-') ? 75 : family.includes('-1250-') ? 125 : 100;
    const sx = width / nominal;
    const chars = Array.from(text);
    const advs = chars.map((ch) => this.glyph(family, ch).adv * sx);
    const total = advs.reduce((a, b) => a + b, 0);
    const size = Math.min((maxW / total) * 100, maxCap / 0.72);
    const sc = size / 100;
    const xs: number[] = [];
    let pen = cx - (total * sc) / 2;
    for (const a of advs) { xs.push(pen); pen += a * sc; }
    return { family, sx, sc, xs, chars, base: cy + size * 0.36, size };
  }

  private title(f: Frame, frame: string, medium: string, t0: number): PostOverrides {
    const t = f.t, au = this.au, start = this.ctx.start, end = this.ctx.end, bl = this.beatLen;
    const b0 = beatIndex(au, start + 1e-3);
    const k = clamp(beatIndex(au, t) - b0, 0, 11);
    const bp = beatPulse(au, t, 0.07), kp = kickPulse(au, t, 0.06);
    const TXT = 'DYSON SPHERE';
    const S = this.titleSet(TXT, k, 1560, 560, W / 2, H / 2);
    const prev = k > 0 ? this.titleSet(TXT, k - 1, 1560, 560, W / 2, H / 2) : null;
    const lt = t - t0;
    // letters stamped one by one (a sixteenth apart) from the first beat
    let gi = 0;
    const stampAt = S.chars.map((ch) => (ch === ' ' ? -1 : start + (gi++) * (bl / 4)));
    // camera; 'push' dives into the O's counter (the hole into the shell)
    const oi = S.chars.indexOf('O');
    const og = this.glyph(S.family, 'O');
    const oc = og.hole ? { x: S.xs[oi]! + og.hole.x * S.sx * S.sc, y: S.base + og.hole.y * S.sc } : { x: W / 2, y: H / 2 };
    const cam: Cam =
      frame === 'tight' ? { s: 1.85, x: S.xs[7]! + 180, y: H / 2 - 20, r: -0.05 }
      : frame === 'offset' ? { s: 1.3, x: 760, y: 470, r: 0.07 }
      : frame === 'push' ? { s: 1.2 * Math.exp(3.6 * clamp(lt / (end - t0)) ** 1.5), x: oc.x, y: oc.y, r: 0.1 * lt }
      : { s: 1 + 0.015 * lt, x: W / 2, y: H / 2, r: 0 };
    const c = this.L.ctx;
    this.paperGround(c, cam);
    const holes = medium === 'holes';
    if (holes) {
      // panel seams: the paper is becoming a shell panel
      c.save(); setCam(c, cam);
      c.strokeStyle = rgba('graphite', 0.4); c.lineWidth = 2;
      for (let x = -2000; x < 4000; x += 240) { c.beginPath(); c.moveTo(x, -2000); c.lineTo(x, 3000); c.stroke(); }
      for (let y = -2000; y < 3000; y += 240) { c.beginPath(); c.moveTo(-2000, y); c.lineTo(4000, y); c.stroke(); }
      c.fillStyle = rgba('graphite', 0.7);
      for (let x = -2000; x < 4000; x += 240) for (let y = -2000; y < 3000; y += 240) { c.beginPath(); c.arc(x, y, 5, 0, Math.PI * 2); c.fill(); }
      c.restore();
    }
    // the signal disc stamped behind (lands on the second downbeat, thumps per beat)
    if (medium !== 'stamp') {
      const land = sbLand(this.list, 'disc');
      const pop = 1 + 0.35 * Math.exp(-(t - land) / 0.05);
      this.pass((p) => {
        setCam(p, cam);
        p.fillStyle = rgba('signal');
        p.beginPath(); p.arc(W / 2, H / 2, (420 + 14 * bp) * pop, 0, Math.PI * 2); p.fill();
      }, { cam, wear: 0.5 });
    }
    // ghost of the previous step (the last impression, not yet dry)
    const drawTitle = (p: C2, s: typeof S, col: PaletteKey, a: number, perLetter: boolean) => {
      s.chars.forEach((ch, i) => {
        if (ch === ' ') return;
        const ta = stampAt[i]!;
        if (perLetter && t < ta) return;
        const g = this.glyph(s.family, ch);
        const pop = perLetter ? 1 + 0.4 * Math.exp(-(t - ta) / 0.045) : 1;
        const slam = 1 + 0.07 * bp + 0.03 * kp;
        p.save();
        const w = g.adv * s.sx * s.sc;
        p.translate(s.xs[i]! + w / 2, s.base - s.size * 0.36);
        p.scale(s.sx * s.sc * pop * slam, s.sc * pop * slam);
        p.rotate((hash(i, k) - 0.5) * 0.02);
        p.translate(-g.adv / 2, 36);
        p.fillStyle = rgba(col, a);
        p.fill(g.path);
        p.restore();
      });
    };
    if (prev) this.pass((p) => { setCam(p, cam, 10, 8); drawTitle(p, prev, 'graphite', 0.45 * (1 - 0.6 * clamp((t - au.beats[b0 + k]!) / bl)), false); }, { cam, wear: 0.9 });
    this.pass((p) => { setCam(p, cam); drawTitle(p, S, 'ink', 0.82 + 0.18 * bp, true); }, { cam, wear: 0.7 });
    if (holes) {
      // counters become holes: the dark of the shell behind, lit by the star
      c.save(); setCam(c, cam);
      S.chars.forEach((ch, i) => {
        if (ch === ' ') return;
        const g = this.glyph(S.family, ch);
        if (!g.holes) return;
        const w = g.adv * S.sx * S.sc;
        c.save();
        c.translate(S.xs[i]! + w / 2, S.base - S.size * 0.36);
        c.scale(S.sx * S.sc * (1 + 0.07 * bp), S.sc * (1 + 0.07 * bp));
        c.translate(-g.adv / 2, 36);
        const hc = g.hole!;
        const gr = c.createRadialGradient(hc.x, hc.y, 0, hc.x, hc.y, 34);
        gr.addColorStop(0, rgba('bone', 0.6 + 0.4 * bp)); gr.addColorStop(0.3, rgba('ember')); gr.addColorStop(0.75, rgba('signal')); gr.addColorStop(1, rgba('ink'));
        c.fillStyle = gr;
        c.fill(g.holes);
        c.strokeStyle = rgba('ink'); c.lineWidth = 2.2; c.stroke(g.holes);
        c.restore();
      });
      c.restore();
    }
    // T3: every beat the title slams — zoom punch + shake; the disc landing flashes
    const land = medium !== 'stamp' ? sbLand(this.list, 'disc') : Infinity;
    return {
      zoom: 1 + 0.08 * bp,
      shake: [10 * kp * (hash(k, 1) - 0.5) * 2, 8 * bp],
      flash: t >= land ? 0.35 * Math.exp(-(t - land) / 0.08) : 0,
      bloom: holes ? 0.4 : 0, bloomThreshold: 0.8,
      ...(frame === 'push' ? { vignette: 0.35 } : {}),
    };
  }

  // ------------------------------------------------------------------ erase: scraped off after it is sung
  private erase(f: Frame, frame: string, t0: number): PostOverrides {
    const t = f.t, au = this.au, line = this.lines[0]!, fam = F.slam();
    const start = this.ctx.start, end = this.ctx.end;
    const R = this.rows(line, fam, 1600, 300);
    const x0 = 160, y0 = 520 - R.gap / 2 + R.size * 0.36;
    const strokes = au.beats.filter((b) => b >= start - 1e-3 && b < end);
    const SW = 0.16; // stroke duration
    const sp = (s: number) => ease.outCubic(clamp((t - s) / SW));
    // which strokes scrape which word (the first two strokes after the word is sung; one if time runs out)
    const plan = line.words.map((w) => {
      const e = wordEnd(w);
      const avail = strokes.filter((s) => s >= e - 0.06);
      return avail.slice(0, avail.length >= 2 && avail[1]! < end - 0.3 ? 2 : 1);
    });
    const scraped = plan.map((ss) => (ss.length ? ss.reduce((a, s) => a + sp(s), 0) / ss.length : 0));
    const lt = t - t0;
    const box = (k: number) => { const b = this.wordBox(R, k, x0, y0); return { x: b.cx, y: b.cy }; };
    const cam: Cam =
      frame === 'close' ? { s: 2.0 + 0.05 * lt, ...this.followWord(line, t, box), r: 0.04 }
      : frame === 'raking' ? { s: 1.12 + 0.02 * lt, x: W / 2 + 40, y: H / 2, r: 0.03 }
      : { s: 1 + 0.01 * lt, x: W / 2, y: H / 2, r: 0 };
    const c = this.L.ctx;
    this.paperGround(c, cam);
    const bar = { x: 160, y: 800, w: 1600, h: 46 }; // the proof rule under the line (scraped when no word is due)
    const barStrokes = strokes.filter((s) => !plan.some((ss) => ss.includes(s)));
    const blank = smoothstep(end - 0.35, end - 0.05, t);
    // ghost impression: the deboss left in the paper (only where ink was sung)
    const ghostA = (0.25 + 0.75 * Math.max(...scraped)) * (1 - blank);
    if (ghostA > 0.01) {
      c.save(); setCam(c, cam);
      c.shadowColor = rgba('graphite', 0.35); c.shadowOffsetX = -2.5; c.shadowOffsetY = -2.5; c.shadowBlur = 2;
      this.lyricRows(c, line, t, R, x0, y0, fam, { sungColor: 'paper2', unsungAlpha: 0, alpha: ghostA });
      c.restore();
    }
    // the ink impression, with the scraped part of each word knocked out
    this.pass((p) => {
      setCam(p, cam);
      this.lyricRows(p, line, t, R, x0, y0, fam, { xf: (s) => (s.sung ? { scale: 1 + 0.05 * (1 - s.frac) ** 5 } : undefined) });
      p.fillStyle = rgba('ink'); p.fillRect(bar.x, bar.y, bar.w, bar.h);
      p.globalCompositeOperation = 'destination-out';
      line.words.forEach((_, k) => {
        const q = scraped[k]!;
        if (q <= 0) return;
        const b = this.wordBox(R, k, x0, y0);
        const x1 = b.x - 20 + (b.w + 40) * q;
        p.fillStyle = rgba('ink', 0.94);
        p.beginPath(); p.moveTo(b.x - 30, b.y - 30);
        for (let j = 0; j <= 10; j++) p.lineTo(x1 + (hash(k, j) - 0.5) * 30, b.y - 30 + (j / 10) * (b.h + 70));
        p.lineTo(b.x - 30, b.y + b.h + 40); p.closePath(); p.fill();
      });
      barStrokes.forEach((s, j) => {
        const q = sp(s);
        if (q <= 0) return;
        const segW = bar.w / Math.max(1, barStrokes.length);
        p.fillStyle = rgba('ink', 0.9);
        p.fillRect(bar.x + j * segW, bar.y - 4, segW * q, bar.h + 8);
      });
    }, { cam, wear: 0.7, alpha: (0.85 + 0.15 * beatPulse(au, t, 0.1)) * (1 - blank) });
    // smear streaks dragged out by each stroke (graphite, drying off)
    c.save(); setCam(c, cam);
    line.words.forEach((_, k) => {
      for (const s of plan[k]!) {
        const q = sp(s);
        if (q <= 0) continue;
        const b = this.wordBox(R, k, x0, y0);
        const a = 0.5 * Math.exp(-(t - s) / 1.2) * (1 - blank);
        for (let j = 0; j < 9; j++) {
          c.fillStyle = rgba('graphite', a * (0.4 + 0.6 * hash(k, j, 3)));
          c.fillRect(b.x, b.y + (j / 9) * b.h, (b.w + 120 * hash(k, j)) * q, 2 + 5 * hash(j, k, 9));
        }
      }
    });
    c.restore();
    // the scraper: a steel blade crossing its target on every beat
    const cur = strokes.filter((s) => t >= s && t < s + SW + 0.1).pop();
    if (cur !== undefined) {
      const q = clamp((t - cur) / SW);
      const k = plan.findIndex((ss) => ss.includes(cur));
      const tb = k >= 0 ? this.wordBox(R, k, x0, y0) : { x: bar.x + (barStrokes.indexOf(cur) * bar.w) / Math.max(1, barStrokes.length), y: bar.y - 20, w: bar.w / Math.max(1, barStrokes.length), h: bar.h + 40 };
      const bx = tb.x - 40 + (tb.w + 80) * ease.outCubic(q);
      const fade = 1 - clamp((t - cur - SW) / 0.1);
      c.save(); setCam(c, cam);
      c.globalAlpha = fade;
      c.translate(bx, tb.y + tb.h / 2); c.rotate(0.22);
      const hh = tb.h + 120;
      const g = c.createLinearGradient(-60, 0, 0, 0);
      g.addColorStop(0, rgba('ink2')); g.addColorStop(0.7, rgba('graphite')); g.addColorStop(1, rgba('paper2'));
      c.fillStyle = g; c.fillRect(-60, -hh / 2, 60, hh);
      c.fillStyle = rgba('signal'); c.fillRect(-3, -hh / 2, 6, hh);
      c.fillStyle = rgba('ink', 0.85); c.fillRect(2, -hh / 2 + 10, 10, hh - 20); // ink bead pushed ahead
      c.restore();
    }
    const bp = beatPulse(au, t, 0.07), dp = downbeatPulse(au, t, 0.15);
    return { zoom: 1 + 0.04 * dp, shake: [9 * bp, 3 * bp] };
  }

  // ------------------------------------------------------------------ burst: plate shatters → type in depth → raster
  private makeShards() {
    const rnd = mulberry32(911);
    const PW = 1500, PH = 760, cx = PW * 0.52, cy = PH * 0.47;
    const N = 13, radii = [0, 140, 330, 620, 1400];
    const ang: number[] = [];
    for (let i = 0; i < N; i++) ang.push(((i + 0.2 + 0.6 * rnd()) / N) * Math.PI * 2);
    const vtx = radii.map((r, j) => ang.map((a) => ({ x: cx + Math.cos(a) * r * (j ? 0.8 + 0.4 * rnd() : 0), y: cy + Math.sin(a) * r * (j ? 0.8 + 0.4 * rnd() : 0) })));
    for (let j = 0; j + 1 < radii.length; j++) for (let i = 0; i < N; i++) {
      const i2 = (i + 1) % N;
      const poly = j === 0 ? [vtx[0]![0]!, vtx[1]![i]!, vtx[1]![i2]!] : [vtx[j]![i]!, vtx[j + 1]![i]!, vtx[j + 1]![i2]!, vtx[j]![i2]!];
      const c = { x: poly.reduce((s, p) => s + p.x, 0) / poly.length, y: poly.reduce((s, p) => s + p.y, 0) / poly.length };
      const d = Math.hypot(c.x - cx, c.y - cy) || 1;
      this.shards.push({ poly, c, dir: { x: (c.x - cx) / d, y: (c.y - cy) / d }, spin: (rnd() - 0.5) * 2.2, dz: 0.3 + rnd() });
    }
  }

  /** The printing plate: an ink slab with the title cut in reverse (mirrored, as type on a plate is). */
  private drawPlate() {
    if (this.plateReady) return;
    this.B = new Layer2D(1500, 760);
    const c = this.B.ctx;
    c.fillStyle = rgba('ink2'); c.fillRect(0, 0, 1500, 760);
    c.fillStyle = rgba('ink'); c.fillRect(24, 24, 1452, 712);
    c.save(); c.translate(1500, 0); c.scale(-1, 1);
    c.fillStyle = rgba('graphite');
    c.font = font(F.archivo(125, 900), 230); c.textAlign = 'center'; c.textBaseline = 'alphabetic';
    c.fillText('DYSON', 750, 330);
    c.fillText('SPHERE', 750, 580);
    c.fillStyle = rgba('bone', 0.5);
    c.font = font(F.mono(500), 30); c.fillText('SENTIENT ARCHITECT · PL. 32', 750, 680);
    c.restore();
    c.strokeStyle = rgba('graphite', 0.5); c.lineWidth = 2;
    for (let i = 0; i < 4; i++) { c.beginPath(); c.arc(60 + (i % 2) * 1380, 60 + Math.floor(i / 2) * 640, 16, 0, Math.PI * 2); c.stroke(); }
    this.plateReady = true;
  }

  private burst(f: Frame, frame: string, medium: string, t0: number): PostOverrides {
    const t = f.t, au = this.au, start = this.ctx.start, end = this.ctx.end, bl = this.beatLen;
    const bp = beatPulse(au, t, 0.07), kp = kickPulse(au, t, 0.06), dp = downbeatPulse(au, t, 0.1);
    const beats = au.beats.filter((b) => b >= start - 1e-3 && b < end);
    const lt = t - t0;
    const c = this.L.ctx;
    const cam: Cam =
      frame === 'tilt' ? { s: 1.2, x: W / 2 + 120, y: H / 2 - 40, r: -0.12 }
      : frame === 'orbit' ? { s: 1.1, x: W / 2 - 160, y: H / 2 + 60, r: 0.1 }
      : frame === 'tight' ? { s: 1.35, x: W / 2, y: H / 2 + 60, r: 0 }
      : frame === 'depth' ? { s: 1, x: W / 2, y: H / 2, r: 0 }
      : { s: 1 + 0.02 * lt, x: W / 2, y: H / 2, r: 0 };
    // polarity swap: for one beat on each downbeat the whole print turns negative (paper <-> ink). Done in the
    // scene with the palette (the post invert maps signal to a cyan-ish tone, which this plate may not show)
    const db = au.downbeats.filter((d) => d >= start - 1e-3 && d <= t).pop();
    this.neg = db !== undefined && t < db + bl;
    this.paperGround(c, cam);
    if (medium === 'shatter') {
      this.drawPlate();
      // fracture: beat-snapped steps (cracks → separate → fly)
      const bIn = beats.filter((b) => b < t0 + 4 * bl + 0.01);
      const steps = [0, 0.12, 0.45, 1.3];
      let D = 0;
      bIn.forEach((b, i) => { if (i > 0 && t >= b) D += ((steps[i] ?? 1) - (steps[i - 1] ?? 0)) * outExpo((t - b) / 0.14); });
      const ox = W / 2 - 750, oy = H / 2 - 380;
      c.save(); setCam(c, cam);
      for (const s of this.shards) {
        const z = 1 + D * s.dz * 1.4;
        const px = s.c.x + s.dir.x * D * 520 * s.dz, py = s.c.y + s.dir.y * D * 380 * s.dz + D * D * 120;
        c.save();
        c.translate(ox + (px - 750) * z + 750, oy + (py - 380) * z + 380);
        c.rotate(s.spin * D);
        c.scale(z * (1 + 0.03 * bp), z * (1 + 0.03 * bp));
        c.translate(-s.c.x, -s.c.y);
        c.beginPath(); s.poly.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y))); c.closePath();
        if (D > 0.01) { c.shadowColor = rgba(this.k('ink'), 0.35); c.shadowOffsetX = 14 * D; c.shadowOffsetY = 18 * D; c.shadowBlur = 12; c.fillStyle = rgba(this.k('ink')); c.fill(); c.shadowColor = rgba(this.k('ink'), 0); }
        c.save(); c.clip(); if (this.neg) c.filter = 'invert(1)'; c.drawImage(this.B.canvas, 0, 0, 1500, 760); c.restore();
        // crack lines light up on the first stamp
        c.strokeStyle = rgba(this.k('bone'), 0.8 * (1 - clamp(D)) * (t >= start ? 1 : 0)); c.lineWidth = 2.5; c.stroke();
        c.restore();
      }
      c.restore();
    } else {
      // type slabs: 32 sorts; 8 crash per beat of the fly shot (salvo), then rows lock into a raster
      const flyT = sbLand(this.list, 'fly'), rasT = sbLand(this.list, 'raster');
      const TXT = 'DYSONSPHERE';
      const N = 32, cols = 8;
      const fam = F.archivo(125, 900);
      c.save(); setCam(c, cam);
      const vc = frame === 'orbit' ? { x: 700, y: 420 } : { x: W / 2, y: H / 2 };
      const slabs: { x: number; y: number; s: number; r: number; i: number; z: number }[] = [];
      for (let i = 0; i < N; i++) {
        const grp = Math.floor(i / 8), tc = flyT + grp * bl + (i % 8) * 0.035;
        const land = { x: 180 + hash(i, 1) * 1560, y: 170 + hash(i, 2) * 740 };
        // depth: hover far, crash to the page on its beat
        const zf = 2.6 + 3 * hash(i, 3);
        const zc = t < tc ? zf - 0.4 * Math.max(0, t - flyT) : lerp(zf, 1, clamp((t - tc) / 0.13) ** 2);
        const z = Math.max(1, zc);
        let x = vc.x + (land.x - vc.x) / z, y = vc.y + (land.y - vc.y) / z, s = 1 / z;
        let r = (hash(i, 4) - 0.5) * 0.8 * (z - 1) / 6 + (hash(i, 5) - 0.5) * 0.12;
        if (medium === 'raster') {
          const row = Math.floor(i / cols), col = i % cols;
          const lock = rasT + Math.floor(row / 2) * bl * 1 + (row % 2) * bl * 0.5;
          const q = outExpo((t - lock) / 0.12);
          const gx = 240 + col * 206, gy = 250 + row * 190;
          x = lerp(land.x, gx, q); y = lerp(land.y, gy, q); s = 1; r = lerp(r, 0, q);
        }
        slabs.push({ x, y, s, r, i, z });
      }
      slabs.sort((a, b) => b.z - a.z);
      // copper bars: the locked raster rows stretch into full-width bars over the last beats
      const barQ = medium === 'raster' ? ease.inOutCubic(clamp((t - (end - 1.3 * bl)) / (1.1 * bl))) : 0;
      for (const sl of slabs) {
        const w = 150 * sl.s, h = 170 * sl.s, d = 26 * sl.s;
        c.save(); c.translate(sl.x, sl.y); c.rotate(sl.r);
        const pop = 1 + 0.12 * bp;
        c.scale(pop, pop);
        // body (side faces), then face; letter in bone
        c.fillStyle = rgba(this.k('ink2')); c.fillRect(-w / 2 + d, -h / 2 + d, w, h);
        c.fillStyle = rgba(this.k('ink')); c.fillRect(-w / 2, -h / 2, w, h);
        c.fillStyle = rgba(this.k(sl.i % 5 === 2 ? 'signal' : 'bone'));
        c.font = font(fam, 120 * sl.s); c.textAlign = 'center'; c.textBaseline = 'middle';
        c.fillText(TXT[sl.i % TXT.length]!, 0, 6 * sl.s);
        c.restore();
      }
      if (barQ > 0) {
        for (let row = 0; row < 4; row++) {
          const gy = 250 + row * 190, hh = 170 * (0.4 + 0.6 * barQ);
          const g = c.createLinearGradient(0, gy - hh / 2, 0, gy + hh / 2);
          g.addColorStop(0, rgba(this.k('ink'))); g.addColorStop(0.3, rgba(this.k('signal'))); g.addColorStop(0.5, rgba(this.k('ember'))); g.addColorStop(0.7, rgba(this.k('signal'))); g.addColorStop(1, rgba(this.k('ink')));
          const half = lerp(860, 1600, barQ);
          c.globalAlpha = barQ;
          c.fillStyle = g; c.fillRect(W / 2 - half, gy - hh / 2, half * 2, hh);
          c.globalAlpha = 1;
        }
      }
      c.restore();
    }
    this.neg = false;
    return { zoom: 1 + 0.1 * bp + 0.04 * dp, shake: [14 * kp * (hash(beatIndex(au, t), 3) - 0.5) * 2, 10 * bp], flash: 0.25 * dp };
  }

  // ------------------------------------------------------------------ credits: one glyph per stamp, afterimage
  private credits(f: Frame, frame: string, t0: number): PostOverrides {
    const t = f.t, au = this.au, start = this.ctx.start, end = this.ctx.end, bl = this.beatLen;
    const bp = beatPulse(au, t, 0.08);
    const credT = sbLand(this.list, 'credit');
    const TITLE = 'DYSON SPHERE', CRED = 'Sentient Architect';
    const tf = F.archivo(125, 900), cf = F.archivo(100, 500);
    const tl = layout(TITLE, tf, 200), cl = layout(CRED, cf, 100);
    const tSize = Math.min(220, (1500 / tl.width) * 200), cSize = Math.min(96, (1100 / cl.width) * 100);
    const tL = layout(TITLE, tf, tSize), cL = layout(CRED, cf, cSize);
    const tx = W / 2 - tL.width / 2, ty = 520, cx = W / 2 - cL.width / 2, cy = 700;
    const glyphs: { ch: string; x: number; y: number; fam: string; size: number; at: number; i: number }[] = [];
    let n = 0;
    tL.glyphs.forEach((g) => { if (g.ch !== ' ') glyphs.push({ ch: g.ch, x: tx + g.x, y: ty, fam: tf, size: tSize, at: start + (n++) * (bl / 4), i: glyphs.length }); });
    n = 0;
    cL.glyphs.forEach((g) => { if (g.ch !== ' ') glyphs.push({ ch: g.ch, x: cx + g.x, y: cy, fam: cf, size: cSize, at: credT + (n++) * (bl / 4) * 0.94, i: glyphs.length }); });
    const done = glyphs.filter((g) => t >= g.at);
    const lastG = done[done.length - 1];
    const nextAt = glyphs.find((g) => g.at > t)?.at ?? end;
    const lt = t - t0;
    const cam: Cam =
      frame === 'title' ? { s: 1.1 + 0.03 * lt, x: W / 2, y: ty - tSize * 0.35, r: 0 }
      : frame === 'credit' ? { s: 1.4 + 0.03 * lt, x: W / 2, y: cy - 90, r: -0.03 }
      : { s: 1.08 - 0.015 * lt, x: W / 2, y: 620, r: 0 };
    const jolt = 4 * beatPulse(au, t, 0.06);
    const c = this.L.ctx;
    this.paperGround(c, cam, 0, jolt);
    // card furniture (printed with the full card)
    const card = frame === 'card';
    c.save(); setCam(c, cam, 0, jolt);
    for (const [x, y] of [[90, 90], [W - 90, 90], [90, H - 90], [W - 90, H - 90]] as const) this.regMark(c, x, y, 16, 'graphite', card ? 1 : 0.35);
    c.fillStyle = rgba('ink', card ? 1 : 0.2); c.fillRect(W / 2 - 750, 600, 1500, 6);
    if (card) this.slug(c, `${au.bpm.toFixed(2)} BPM · LETTERPRESS ON BONE`, W / 2 - 750, 820, 24, 'graphite');
    c.restore();
    // the afterimage of the last stamp: a signal impression, larger and offset, fading until the next stamp
    if (lastG) {
      const q = clamp((t - lastG.at) / Math.max(0.05, nextAt - lastG.at));
      this.pass((p) => {
        setCam(p, cam, 9, 7 + jolt);
        p.font = font(lastG.fam, lastG.size * 1.06);
        p.fillStyle = rgba('signal', 0.85 * (1 - q));
        p.fillText(lastG.ch, lastG.x - lastG.size * 0.02, lastG.y);
      }, { cam, wear: 0.4 });
    }
    // the stamped glyphs (ink density up on each beat)
    this.pass((p) => {
      setCam(p, cam, 0, jolt);
      p.textBaseline = 'alphabetic';
      for (const g of done) {
        const pop = 1 + 0.25 * Math.exp(-(t - g.at) / 0.04);
        p.save();
        p.translate(g.x, g.y - g.size * 0.35);
        p.rotate((hash(g.i, 7) - 0.5) * 0.025);
        p.scale(pop, pop);
        p.font = font(g.fam, g.size);
        p.fillStyle = rgba('ink');
        p.fillText(g.ch, 0, g.size * 0.35 + (hash(g.i, 8) - 0.5) * 3);
        p.restore();
      }
    }, { cam, wear: 0.65, alpha: 0.82 + 0.18 * bp });
    const fade = smoothstep(end - 1.1, end - 0.05, t);
    const kp = kickPulse(au, t, 0.08), dp = downbeatPulse(au, t, 0.12);
    return { fade, zoom: 1 + 0.015 * dp + 0.01 * kp, shake: [0, 3 * bp] };
  }

  override dispose() {
    this.L?.texture.dispose();
    this.A?.texture.dispose();
    this.B?.texture.dispose();
  }
}

/** Song time of the first shot whose medium or frame is `m` (Infinity if none). */
function sbLand(list: Shot[], m: string): number {
  for (const s of list) if (s.s.medium === m || s.s.frame === m) return s.t;
  return Infinity;
}
