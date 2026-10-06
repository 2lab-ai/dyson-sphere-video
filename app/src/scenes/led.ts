// LED — a stadium LED ribbon (Jenny Holzer's Truisms signs, idiom E3): the text is the image. One variant:
//   ticker (p09)  a curved ribbon of LED dots wraps the inside of a stadium ring. Two lanes on it:
//                 - the YEAR lane: years 2026, 2027, ... scroll to the right (the future receding), jumping one LED
//                   column on every beat; every strong kick flips all the counters one year on. A signal-orange
//                   point races the same way, faster: on every beat it hops one year-slot, straight over the next
//                   year (the year it passes goes hot, then dim behind it) — AGI overtaking the future.
//                 - the LYRIC lane: line 9 as a marquee scrolling left, rasterised from Black Han Sans at 4x and
//                   box-downsampled to the LED grid (a 5-row-per-LED Hangul bitmap, no bitmap font). Upcoming
//                   syllables are dim red, the syllable being sung is hot, sung words cool to amber, the Latin
//                   'AGI' burns in the signal colour.
//                 Cameras (./led.shots): wide on the curved ribbon with the upper tier -> low under the ribbon, the
//                 dots huge, tracking the point -> down the length of the ribbon, tracking -> close on the dots
//                 as the point overtakes the counter. Exit: the ribbon goes dark column by column, right to left;
//                 the unlit dot grid and the point itself stay lit.
// Render: the board is a Canvas2D at 4 px per LED (uploaded once per frame); a fullscreen shader intersects each
// camera ray with the ring (a cylinder), finds the LED cell, averages its 4x4 texels (coverage + colour) and draws
// a round emitter with a soft halo. Colours come only from the `led` palette.
import * as THREE from 'three';
import { ShaderScene } from './_shader';
import type { Frame, PostOverrides } from '../engine/scene';
import { Layer2D, clearRT, W as FW, H as FH } from '../engine/gl';
import { palette, pcss, pmix, plin, type NamedPalette } from '../engine/palette';
import { drawLyric, ownedLines, layoutLine, F, type LineLayout, type CharState } from '../engine/lyric';
import { beatPulse, kickPulse, downbeatPulse, beatIndex } from '../engine/beat';
import { stateAt, shotAt, type PlateInfo, type Shot } from '../engine/shots';
import { clamp, ease, lerp } from '../engine/util';
import type { Line } from '../engine/lyrics';
import { shots } from './led.shots';

// ------------------------------------------------------------------ board geometry (1 unit = 1 LED pitch)
const COLS = 768; // LED columns around the whole ring
const R = COLS / (2 * Math.PI); // ring radius
const MAIN = 36; // rows of the main ribbon (world y 0..36, row 0 at the top)
const TIER = 18; // rows of the upper tier ribbon (world y TIER_Y0..TIER_Y0+18)
const TIER_Y0 = 50;
const ROWS = MAIN + TIER;
const SS = 4; // board canvas px per LED (box-downsampled in the shader)
// lanes on the main ribbon
const YR_TOP = 3; // year digits: rows 3..9 (5x7 font)
const LY_BASE = 33; // lyric baseline row
const LY_SIZE = 25; // lyric size in LED rows
const FAM = F.slam();
// year model
const D = 32; // cols per year slot (4 digits x 6 = 23 cols + a 9-col gap)
const YW = 23;
const VY = 6; // year lane drift (cols/s), plus one column per beat
const K0 = 8; // the point starts in the gap right of year slot K0
const BASE_YEAR = 2026;

// 5x7 digits, rows top->bottom, 5 bits (MSB = left)
const DIGITS: number[][] = [
  [14, 17, 19, 21, 25, 17, 14], [4, 12, 4, 4, 4, 4, 14], [14, 17, 1, 2, 4, 8, 31], [31, 2, 4, 2, 1, 17, 14],
  [2, 6, 10, 18, 31, 2, 2], [31, 16, 30, 1, 1, 17, 14], [6, 8, 16, 30, 17, 17, 14], [31, 1, 2, 4, 8, 8, 8],
  [14, 17, 17, 14, 17, 17, 14], [14, 17, 17, 15, 1, 2, 12],
];

const wrap = (x: number) => ((x % COLS) + COLS) % COLS;

type V3 = [number, number, number];
/** A point on (or inset from) the ring, in the local frame where the focus column sits at angle 0. */
const onRing = (phi: number, y: number, inset = 0): V3 => [-(R - inset) * Math.sin(phi), y, (R - inset) * Math.cos(phi)];

export default class Led extends ShaderScene {
  private P: NamedPalette = palette(this.ctx.params.look?.palette ?? 'led');
  private plate = this.ctx.params as PlateInfo;
  private S: Shot[] = shots(this.plate, this.ctx.audio);
  private B!: Layer2D;
  private line: Line = ownedLines(this.ctx)[0]!;
  private lay: LineLayout | null = null;
  private anchors: { t: number; x: number }[] = [];
  private flips: number[] = [];
  private b0 = 0;

  override render(f: Frame, out: THREE.WebGLRenderTarget) {
    return this.plate.variant === 'ribbon' ? this.ribbon(f, out) : super.render(f, out);
  }

  // ---------------------------------------------------------------- ribbon (v4 NIGHT p05, hosted by wall)
  // A dead LED ribbon on the hardware comes on: a strip of dots that runs as a wave (the strip bends with a travelling
  // sine; the lit band races along it), the line set in LEDs on the strip. Each beat the wave's crest jumps one dot
  // column ahead and the whole strip steps brighter (held), the downbeat flips the wave's direction of travel.
  private R2?: Layer2D;
  private ribbon(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const L = (this.R2 ??= new Layer2D()), c = L.ctx, t = f.t, au = this.ctx.audio, P = this.P;
    L.clear();
    const bp = beatPulse(au, t, 0.12), db = downbeatPulse(au, t, 0.25);
    const bi = beatIndex(au, t) - this.b0, bar = Math.floor(Math.max(0, bi) / 4);
    const dir = bar % 2 ? -1 : 1;
    // dot pitch 7 px: the 150 px line covers ~21 dot rows, so the Hangul reads in the dots (14 rows at 15 px did not)
    const NX = 250, NY = 42, pitch = 7, x0 = FW / 2 - (NX * pitch) / 2, yc = FH / 2;
    const ph = t * 1.2 * dir + 0.35 * Math.max(0, bi);
    // the lit band jumps 46 columns on every beat and holds there until the next (the ribbon's held beat mark)
    const crest = ((Math.max(0, bi) * 46) % (NX + 60)) - 30;
    // the lyric rasterised into the strip's dot grid (stamp: sung = signal, via drawLyric on a mask)
    const MW = NX * pitch, MH = NY * pitch;
    const M = (this.mask ??= new Layer2D(MW, MH, 1)), m = M.ctx;
    m.clearRect(0, 0, MW, MH);
    // two rows (split at the word nearest the middle), each kept inside the span both framings show (≤1380 px wide)
    const line = this.line;
    if (line) {
      // split by drawn width (Latin ≈ half a Hangul cell), so 'High-tec의' doesn't push row 1 past the frame
      const wid = (w: string) => Array.from(w).reduce((a, ch) => a + (/[가-힣]/.test(ch) ? 1 : 0.55), 0);
      const n = line.words.length, tot = line.words.reduce((a, w) => a + wid(w.w), 0);
      let cut = 1, acc = 0;
      for (let i = 0; i < n - 1; i++) { acc += wid(line.words[i]!.w); if (acc * 2 >= tot) { cut = i + 1; break; } }
      const rows = n > 1 ? [line.words.slice(0, cut), line.words.slice(cut)] : [line.words];
      rows.forEach((ws, i) => drawLyric(m, { ...line, words: ws, text: ws.map((w) => w.w).join(' '), start: ws[0]!.start, end: ws[ws.length - 1]!.end }, t,
        { x: MW / 2, y: rows.length > 1 ? 132 + 140 * i : MH - 90, size: 126, maxWidth: 1380, align: 'center', family: FAM, sungColor: 'signal', unsungColor: 'bone', unsungAlpha: 0.5, lead: 0.4 }));
    }
    const px = m.getImageData(0, 0, MW, MH).data;
    for (let i = 0; i < NX; i++) {
      const yo = 22 * Math.sin(i * 0.04 + ph) + 10 * db * Math.sin(i * 0.15); // gentle bend: the line stays legible
      const band = Math.abs(i - crest) < 24 ? 1 : 0;
      for (let j = 0; j < NY; j++) {
        const k = ((j * pitch + (pitch >> 1)) * MW + (i * pitch + (pitch >> 1))) * 4;
        const a = px[k + 3]! / 255, sungR = px[k]! > 200 && px[k + 1]! < 160;
        const x = x0 + i * pitch, y = yc + yo + (j - NY / 2) * pitch;
        const base = 0.16 + 0.1 * bp + 0.84 * band;
        c.fillStyle = a > 0.3 ? (sungR ? pcss(P, 'signal', 1) : pmix(P, 'hi', 'text', 0.5, 0.8)) : pcss(P, 'signal', base * 0.6);
        c.fillRect(x - 3, y - 3, 6, 6);
      }
    }
    L.upload();
    clearRT(this.ctx.renderer, out, [0, 0, 0], 0);
    this.ctx.comp.draw(this.ctx.renderer, L.texture, out, { mode: 'normal' });
    return {};
  }
  private mask?: Layer2D;

  override init() {
    this.B = new Layer2D(COLS, ROWS, SS);
    this.B.texture.minFilter = THREE.LinearFilter;
    this.B.texture.magFilter = THREE.LinearFilter;
    const au = this.ctx.audio;
    this.b0 = Math.max(0, beatIndex(au, this.plate.start));
    // strong kicks flip the year counters
    this.flips = (au.onsets?.kick ?? []).filter(([t, s]) => s >= 0.7 && t > this.plate.start && t < this.plate.end).map(([t]) => t);
    super.init();
  }

  protected override uniforms(): Record<string, THREE.IUniform> {
    const P = this.P;
    return {
      uBoard: { value: this.B.texture },
      uBoardPx: { value: new THREE.Vector2(COLS * SS, ROWS * SS) },
      uFc: { value: 0 },
      uCamPos: { value: new THREE.Vector3() },
      uCamTgt: { value: new THREE.Vector3() },
      uTanHalf: { value: 0.35 },
      uTier: { value: 1 },
      uGain: { value: 1 },
      uUnlit: { value: 1 },
      cGround: { value: new THREE.Vector3(...plin(P, 'ground')) },
      cDeep: { value: new THREE.Vector3(...plin(P, 'deep')) },
      cMid: { value: new THREE.Vector3(...plin(P, 'mid')) },
    };
  }

  protected override glsl(): string {
    return /* glsl */ `
uniform sampler2D uBoard; uniform vec2 uBoardPx;
uniform float uFc, uTanHalf, uTier, uGain, uUnlit;
uniform vec3 uCamPos, uCamTgt, cGround, cDeep, cMid;
const float RING = ${R.toFixed(4)};
const float COLS = ${COLS.toFixed(1)};
const float MAIN = ${MAIN.toFixed(1)};
const float TIER = ${TIER.toFixed(1)};
const float TIER_Y0 = ${TIER_Y0.toFixed(1)};
const float ROWS = ${ROWS.toFixed(1)};

// 4 bilinear taps = the average of the cell's 4x4 board texels (premultiplied colour, coverage)
vec4 cellSample(vec2 cell) {
  vec2 base = vec2(cell.x * 4.0, (ROWS - 1.0 - cell.y) * 4.0);
  vec4 s = vec4(0.0);
  for (int i = 0; i < 4; i++) {
    vec2 o = vec2(float(i & 1) * 2.0 + 1.0, float(i >> 1) * 2.0 + 1.0);
    vec4 c = texture(uBoard, (base + o) / uBoardPx);
    s += vec4(c.rgb * c.a, c.a);
  }
  return s * 0.25;
}

vec3 plate(vec2 p) {
  vec3 f = normalize(uCamTgt - uCamPos);
  vec3 r = normalize(cross(f, vec3(0.0, 1.0, 0.0)));
  vec3 u = cross(r, f);
  vec3 d = normalize(f + uTanHalf * (p.x * r + p.y * u));
  vec3 o = uCamPos;
  float a = dot(d.xz, d.xz), b = dot(o.xz, d.xz), c = dot(o.xz, o.xz) - RING * RING;
  float disc = b * b - a * c;
  vec3 col = cGround;
  if (disc < 0.0 || a < 1e-6) return col;
  float t = (-b + sqrt(disc)) / a;
  if (t <= 0.0) return col;
  vec3 h = o + t * d;
  float phi = atan(-h.x, h.z);
  float uc = uFc + phi * RING;
  float row;
  if (h.y >= 0.0 && h.y <= MAIN) row = MAIN - h.y;
  else if (uTier > 0.5 && h.y >= TIER_Y0 && h.y <= TIER_Y0 + TIER) row = MAIN + (TIER_Y0 + TIER - h.y);
  else {
    // the dark fascia of the stand: a faint sheen right at the ribbon's lips
    float lip = max(exp(-abs(h.y - MAIN) * 1.2), exp(-abs(h.y) * 1.2));
    return col + cDeep * 0.25 * lip;
  }
  vec2 g = vec2(uc, row);
  vec2 cell = floor(g);
  cell.x = mod(cell.x, COLS);
  vec2 lc = fract(g) - 0.5;
  float dd = length(lc);
  float aa = max(fwidth(g.x), fwidth(g.y));
  float rad = 0.37;
  float m = 1.0 - smoothstep(rad - aa, rad + aa, dd);
  m = mix(m, 0.43, smoothstep(0.35, 0.9, aa)); // sub-pixel dots: their average
  vec4 s = cellSample(cell);
  float on = step(0.42, s.a);
  vec3 led = on * s.rgb / max(s.a, 1e-4);
  float halo = exp(-dd * dd * 7.0) * 0.45 * (1.0 - smoothstep(0.4, 1.0, aa));
  // panel seams every 32 columns (the physical tiles of the ribbon)
  float seam = 1.0 - 0.35 * step(0.485, abs(fract((cell.x + 0.5) / 32.0) - 0.5)) * step(0.46, abs(lc.x));
  col = cGround * 1.6 * seam;
  col += cDeep * 0.55 * uUnlit * m;                 // the unlit emitter
  col += led * uGain * (m * 2.6 + halo);             // the lit emitter + its bleed
  return col;
}`;
  }

  // ------------------------------------------------------------------ time model
  private hopState(t: number) {
    const au = this.ctx.audio;
    const bi = beatIndex(au, t);
    const nb = Math.max(0, bi - this.b0);
    const lastB = bi >= 0 ? au.beats[bi]! : this.plate.start;
    const nextB = au.beats[bi + 1] ?? lastB + 60 / au.bpm;
    const hop = ease.outCubic(clamp((t - lastB) / 0.16));
    const phase = clamp((t - lastB) / Math.max(1e-3, nextB - lastB));
    return { nb, hop, phase, lastB };
  }
  /** Board column of the year lane origin (year slot k starts at oy + k*D). */
  private oy(t: number) {
    const { nb } = this.hopState(t);
    return VY * (t - this.plate.start) + nb;
  }
  /** The racing point's board column (hops one year slot per beat). */
  private xp(t: number) {
    const { nb, hop } = this.hopState(t);
    return this.oy(t) + K0 * D + YW + 4.5 + D * (nb + hop - 1);
  }
  /** Smooth version (no hop) for tracking cameras. */
  private xpLin(t: number) {
    const { nb, phase } = this.hopState(t);
    return this.oy(t) + K0 * D + YW + 4.5 + D * (nb + phase - 0.8);
  }
  private flipCount(t: number) { let n = 0; for (const k of this.flips) if (k <= t) n++; return n; }
  private lastFlip(t: number) { let l = -1e9; for (const k of this.flips) if (k <= t) l = k; return l; }

  /** Line-layout x of the syllable being sung (piecewise linear between syllable starts). */
  private headX(t: number): number {
    const A = this.anchors;
    if (!A.length) return 0;
    if (t <= A[0]!.t) return A[0]!.x;
    for (let i = 0; i < A.length - 1; i++) {
      const a = A[i]!, b = A[i + 1]!;
      if (t < b.t) return lerp(a.x, b.x, clamp((t - a.t) / Math.max(1e-3, b.t - a.t)));
    }
    return A[A.length - 1]!.x;
  }

  private ensureLayout() {
    if (this.lay) return;
    const lay = layoutLine(this.B.ctx, this.line, FAM, LY_SIZE);
    this.lay = lay;
    const A: { t: number; x: number }[] = [];
    this.line.words.forEach((w, wi) => {
      const syl = w.syl && w.syl.length ? w.syl : [[w.start, w.end] as [number, number]];
      syl.forEach(([s], si) => {
        const c = lay.chars.find((b) => b.word === wi && b.syl === si);
        if (c) A.push({ t: s, x: c.x + c.w / 2 });
      });
    });
    A.push({ t: this.line.end, x: lay.width + 6 });
    this.anchors = A;
  }

  // ------------------------------------------------------------------ board
  private digit(c: CanvasRenderingContext2D, n: number, x: number, y: number, s = 1) {
    const g = DIGITS[n]!;
    for (let r = 0; r < 7; r++) for (let k = 0; k < 5; k++) if ((g[r]! >> (4 - k)) & 1) {
      const cx = wrap(x + k * s);
      c.fillRect(cx, y + r * s, s, s);
    }
  }
  private year(c: CanvasRenderingContext2D, v: number, x: number, y: number, s = 1) {
    const ds = String(v).split('').map(Number);
    ds.forEach((n, i) => this.digit(c, n, x + i * 6 * s, y, s));
  }

  private drawBoard(t: number, fc: number, cam: string) {
    const P = this.P, c = this.B.ctx, au = this.ctx.audio;
    this.B.clear();
    c.imageSmoothingEnabled = false;
    // ---- year lane
    const oy = Math.floor(this.oy(t));
    const xp = this.xp(t);
    const flips = this.flipCount(t);
    const flipHot = Math.exp(-(t - this.lastFlip(t)) / 0.09);
    const kick = kickPulse(au, t, 0.1);
    const kMin = Math.floor((fc - 300 - oy) / D), kMax = Math.ceil((fc + 300 - oy) / D);
    for (let k = kMin; k <= kMax; k++) {
      const x = oy + k * D;
      const v = BASE_YEAR + (k - K0) + flips;
      if (v < 1000 || v > 9999) continue;
      const passed = x + YW < xp - 2.5;
      const crossing = !passed && x - 3 < xp;
      c.fillStyle = crossing ? pcss(P, 'text')
        : passed ? pmix(P, 'ground', 'mid', 0.5)
        : flipHot > 0.4 ? pcss(P, 'text') : pcss(P, 'hi');
      this.year(c, v, x, YR_TOP);
    }
    // ---- the racing point: a 5-row disc with a trail proportional to its speed
    const back = this.xp(t - 0.09);
    const trail = 3 + Math.max(0, xp - back) * 1.3;
    const px = Math.round(xp), cy = YR_TOP + 3;
    for (let i = 1; i <= Math.ceil(trail); i++) {
      const f = 1 - i / (trail + 1);
      c.fillStyle = pmix(P, 'ground', 'signal', 0.25 + 0.75 * f);
      const hh = f > 0.55 ? 1 : 0;
      c.fillRect(wrap(px - 2 - i), cy - hh, 1, 1 + 2 * hh);
    }
    const disc = (hot: boolean) => {
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        if (dx * dx + dy * dy > 5) continue;
        c.fillStyle = hot && dx * dx + dy * dy <= 1 ? pcss(P, 'text') : pcss(P, 'signal');
        c.fillRect(wrap(px + dx), cy + dy, 1, 1);
      }
    };
    disc(kick > 0.35);
    // ---- lyric lane: the marquee (line-x of the sung syllable pinned to the read column)
    this.ensureLayout();
    const read = fc + (cam === 'wide' ? -4 : cam === 'low' ? 10 : cam === 'side' ? 24 : 6);
    const bx = Math.floor(read - this.headX(t));
    const drawChar = (cc: CanvasRenderingContext2D, ch: string, st: CharState) => {
      const latin = /[A-Za-z]/.test(ch);
      cc.fillStyle = !st.sung ? pmix(P, 'ground', 'mid', 0.62)
        : latin ? pcss(P, 'signal')
        : st.wordProgress >= 1 ? pcss(P, 'hi') : pcss(P, 'text');
      cc.fillText(ch, 0, 0);
    };
    for (const off of [0, -COLS]) {
      drawLyric(c, this.line, t, { x: bx + off, y: LY_BASE, size: LY_SIZE, family: FAM, align: 'left', unsungAlpha: 1, lead: 0.4, drawChar });
    }
    // ---- upper tier: a slower, dimmer year marquee running the other way, at 2x
    const oy2 = Math.floor(40 - 14 * (t - this.plate.start));
    c.fillStyle = pmix(P, 'ground', 'mid', 0.42);
    const k2a = Math.floor((fc - 300 - oy2) / 60), k2b = Math.ceil((fc + 300 - oy2) / 60);
    for (let k = k2a; k <= k2b; k++) this.year(c, BASE_YEAR + k + flips, oy2 + k * 60, MAIN + 2, 2);
    // ---- exit: the ribbon goes dark column by column (right to left); the point stays lit
    if (cam === 'close') {
      const e = clamp((t - (this.plate.end - 0.34)) / 0.3);
      if (e > 0) {
        const dark = Math.floor(fc + 30 - e * 60);
        for (let x = dark; x <= Math.floor(fc + 40); x++) c.clearRect(wrap(x), 0, 1, ROWS);
        disc(false);
      }
    }
    this.B.upload();
  }

  // ------------------------------------------------------------------ frame
  protected override frame(f: Frame): PostOverrides {
    const t = f.t, au = this.ctx.audio, u = this.pass.u;
    const st = stateAt(this.S, t);
    const sh = shotAt(this.S, t);
    const cam = String(st.cam);
    const lt = t - sh.t0;
    let fc: number;
    let pos: V3, tgt: V3, fov: number;
    if (cam === 'wide') {
      fc = this.xp(this.plate.start) + 48;
      pos = [0, 21, R - 98 + 7 * lt];
      tgt = [0, 24, R];
      fov = 40;
    } else if (cam === 'low') {
      fc = this.xpLin(t) + 6;
      pos = [0, -15 + 1.5 * lt, R - 40];
      tgt = [0, 19, R];
      fov = 58;
    } else if (cam === 'side') {
      fc = this.xpLin(t) - 6;
      pos = onRing(-0.34, 20, 16);
      tgt = onRing(0.2 + 0.03 * lt, 18);
      fov = 52;
    } else {
      // close: framed on the year slot the point hops over on the shot's first beat
      const k = Math.round((this.xp(sh.t0 + 0.3) - this.oy(sh.t0 + 0.3) - YW - 4.5) / D);
      fc = this.oy(sh.t0) + k * D + YW / 2 + 2;
      pos = [0, 29.5, R - 36 + 6 * lt];
      tgt = [0, 29.5, R];
      fov = 40;
    }
    this.drawBoard(t, fc, cam);
    const bp = beatPulse(au, t, 0.09), db = downbeatPulse(au, t, 0.18);
    u.uFc!.value = fc;
    (u.uCamPos!.value as THREE.Vector3).set(...pos);
    (u.uCamTgt!.value as THREE.Vector3).set(...tgt);
    u.uTanHalf!.value = Math.tan((fov * Math.PI) / 360);
    u.uTier!.value = Number(st.tiers) > 1 ? 1 : 0;
    const cut = Math.exp(-lt / 0.07);
    const agi = this.line.words[3];
    const agiHit = agi ? Math.exp(-Math.max(0, t - agi.start) / 0.12) * (t >= agi.start ? 1 : 0) : 0;
    // the ribbon's own hits: every beat a refresh strobe, the cut and the word 'AGI' a full-panel surge
    u.uGain!.value = 0.78 + 0.55 * bp + 0.6 * cut + 0.6 * agiHit;
    u.uUnlit!.value = 0.7 + 1.2 * db;
    return {
      // bloom only past the resting emitters (~2 linear): the hot cream cores, the cut and 'AGI' surges
      bloom: 0.4,
      bloomThreshold: 2.2,
      bloomRadius: 0.55,
      halation: 0.18,
      zoom: 1 + 0.035 * db + 0.05 * agiHit,
      shake: cam === 'close' ? [5 * bp * Math.sin(t * 90), 0] : [0, 0],
    };
  }
}
