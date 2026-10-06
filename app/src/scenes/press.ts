// PRESS — two print jobs, each in its own idiom and palette (data/edit.json look.palette).
//   riso     p04 (line 4): a two-colour risograph poster on white stock. Canvas2D draws each spot plate as a
//            coverage mask (blue: the line, the horizon; pink: the dream sun and a second pass of the line); a
//            fragment pass inks them: AM halftone in page space (15° / 75°), ink starvation, speckle, multiply on
//            the stock. The pink pass slips further out of register on every beat until the words double.
//            wide poster → the first row → macro on the misregistered word → the sheet tilted on the tray, pulled.
//   credits  p44 (outro): constructivist wedge on a red field (Lissitzky). A black wedge drives in on the beat, the
//            title and the credit are stamped along it one block per beat (the last stamp leaves a white
//            afterimage until the next), the camera turns in 15° steps, the wedge pierces the cream disc, to black.
// Structure comes from ./press.shots (stateAt: frame + stage).
import * as THREE from 'three';
import { Scene, type Frame, type PostOverrides } from '../engine/scene';
import { Layer2D, FSPass, clearRT } from '../engine/gl';
import { palette, pcss, plin, pmix, type NamedPalette, type Role } from '../engine/palette';
import { drawLyric, ownedLines, layoutLine, F, type CharState, type CharXform } from '../engine/lyric';
import { beatPulse, kickPulse, downbeatPulse, beatIndex } from '../engine/beat';
import { stateAt, shotAt, type PlateInfo, type Shot } from '../engine/shots';
import { font, layout } from '../engine/type';
import { clamp, ease, hash, smoothstep } from '../engine/util';
import type { Line } from '../engine/lyrics';
import { shots } from './press.shots';

const W = 1920, H = 1080;
type C2 = CanvasRenderingContext2D;
/** Affine page → screen: x' = a x + c y + e, y' = b x + d y + f (Canvas2D setTransform order). */
type Mat = [number, number, number, number, number, number];

/** Page point (px, py) lands on screen (sx, sy); rotate r1, scale (s, s*k), rotate r2 (k < 1 = foreshortened). */
function camMat(px: number, py: number, sx: number, sy: number, s: number, r1 = 0, k = 1, r2 = 0): Mat {
  const c1 = Math.cos(r1), s1 = Math.sin(r1), c2 = Math.cos(r2), s2 = Math.sin(r2);
  // M = R2 · diag(s, s k) · R1
  const m00 = s * c1, m01 = -s * s1, m10 = s * k * s1, m11 = s * k * c1;
  const a = c2 * m00 - s2 * m10, c = c2 * m01 - s2 * m11, b = s2 * m00 + c2 * m10, d = s2 * m01 + c2 * m11;
  return [a, b, c, d, sx - (a * px + c * py), sy - (b * px + d * py)];
}
const mulMat = (m: Mat, n: Mat): Mat => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
const trMat = (x: number, y: number): Mat => [1, 0, 0, 1, x, y];
const apply = (c: C2, m: Mat) => c.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
const wordEnd = (w: Line['words'][number]) => (w.syl?.length ? w.syl[w.syl.length - 1]![1] : w.end);

/** Two-row setting of one lyric line (flush left): split word, size, per-word x at that size. */
interface Rows { size: number; split: number; wordX: number[]; wordW: number[]; rowW: [number, number]; gap: number }

// ------------------------------------------------------------------ riso ink pass (GLSL)
// Names are prefixed rz*: GLSL_COMMON already defines PI, TAU, sat, rot2, hash*, snoise, fbm.
const RISO_FRAG = /* glsl */ `
uniform sampler2D uA;      // blue plate coverage (alpha)
uniform sampler2D uB;      // pink plate coverage (alpha)
uniform mat3 uInv;         // screen px (logical, top-left origin) -> page px
uniform vec2 uMis;         // pink plate offset on the page (px)
uniform vec4 uInk;         // x density, y starvation, z pull seed, w halftone pitch (page px)
uniform float uPx;         // screen px per page px (halftone anti-aliasing)
uniform vec4 uStack;       // under-sheets: step dx, dy (page px), rotation step, count
uniform vec3 uPaper, uBlue, uPink, uTray;

float rzInside(vec2 q, float aa) {
  vec2 d = min(q, vec2(${W}.0, ${H}.0) - q);
  return clamp(min(d.x, d.y) / aa + 0.5, 0.0, 1.0);
}
// AM halftone: cosine spot function, dot centres on the (rotated) lattice; solid above ~0.93 coverage
float rzScreen(vec2 q, float ang, float cov) {
  if (cov < 0.004) return 0.0;
  if (cov > 0.93) return 1.0;
  vec2 g = rot2(ang) * q / uInk.w;
  float s = 0.5 - 0.25 * (cos(TAU * g.x) + cos(TAU * g.y));
  float w = clamp(1.2 / (uInk.w * uPx), 0.02, 0.5);
  return 1.0 - smoothstep(cov - w, cov + w, s + 0.5 * w);
}
// soy ink on a stencil drum: blotchy starvation, fine speckle knocked out, rough edges
float rzInk(vec2 q, float cov, float ang, float seed) {
  float n = fbm(vec3(q * 0.0045, seed * 1.7), 3);
  float r = hash12(floor(q * 0.55) + seed * 19.0);
  float c = clamp(cov + (hash12(floor(q * 1.3) + seed * 7.0) - 0.5) * 0.12, 0.0, 1.0);
  float ink = rzScreen(q, ang, c);
  ink *= 1.0 - uInk.y * smoothstep(0.05, 0.55, n);
  ink *= r > 0.965 ? 0.2 : 1.0;
  return ink * uInk.x;
}
void main() {
  vec2 fc = vec2(vUv.x * ${W}.0, (1.0 - vUv.y) * ${H}.0);
  vec2 q = (uInv * vec3(fc, 1.0)).xy;
  float aa = 1.0 / max(uPx, 1e-3);
  float top = rzInside(q, aa);
  // tray + the stack of blank sheets under the pull, each a little shaded, dropping a soft shadow
  vec3 col = uTray;
  float sh = 0.0;
  for (int i = 3; i >= 1; i--) {
    if (float(i) > uStack.w) continue;
    vec2 qi = rot2(uStack.z * float(i)) * (q - vec2(${W / 2}.0, ${H / 2}.0)) + vec2(${W / 2}.0, ${H / 2}.0) - uStack.xy * float(i);
    float m = rzInside(qi, aa);
    col = mix(col, uPaper * (1.0 - 0.035 * float(i)), m);
  }
  vec2 qs = q - vec2(10.0, 14.0);
  vec2 d = max(max(-qs, qs - vec2(${W}.0, ${H}.0)), 0.0);
  sh = exp(-length(d) / 26.0) * (1.0 - top);
  col *= 1.0 - 0.22 * sh;
  float a = texture(uA, vUv).a, b = texture(uB, vUv).a;
  float ia = rzInk(q, a, 0.2618, uInk.z);
  float ib = rzInk(q - uMis, b, 1.309, uInk.z + 3.0);
  vec3 sheet = uPaper * mix(vec3(1.0), uBlue, ia) * mix(vec3(1.0), uPink, ib);
  // stock tooth: faint fibre noise on the paper itself
  sheet *= 0.985 + 0.03 * hash12(floor(q * 0.8) + 3.0);
  col = mix(col, sheet, top);
  fragColor = vec4(max(col, 0.0), 1.0);
}`;

export default class Press extends Scene {
  private L!: Layer2D;
  private B!: Layer2D;
  private ink?: FSPass;
  private list: Shot[] = [];
  private plate!: PlateInfo;
  private lines: Line[] = [];
  private P!: NamedPalette;
  private rowCache = new Map<string, Rows>();

  override init() {
    this.plate = this.ctx.params as PlateInfo;
    this.P = palette(this.ctx.params.look.palette);
    this.list = shots(this.plate, this.ctx.audio);
    this.lines = ownedLines(this.ctx);
    this.L = new Layer2D();
    if (this.plate.variant === 'riso') {
      this.B = new Layer2D();
      const v3 = (r: Role) => new THREE.Vector3(...plin(this.P, r));
      const paper = plin(this.P, 'ground'), blue = plin(this.P, 'deep');
      this.ink = new FSPass(RISO_FRAG, {
        uA: { value: this.L.texture }, uB: { value: this.B.texture },
        uInv: { value: new THREE.Matrix3() }, uMis: { value: new THREE.Vector2() },
        uInk: { value: new THREE.Vector4(1, 0.4, 0, 9) }, uPx: { value: 1 },
        uStack: { value: new THREE.Vector4(-16, 12, 0.014, 3) },
        uPaper: { value: v3('ground') }, uBlue: { value: v3('deep') }, uPink: { value: v3('mid') },
        // the output tray: the stock in shade, a breath of the blue drum
        uTray: { value: new THREE.Vector3(...paper.map((p, i) => 0.8 * (p + (blue[i]! - p) * 0.08))) },
      });
    }
  }

  private get au() { return this.ctx.audio; }
  private get beatLen() { return 60 / this.ctx.audio.bpm; }
  private css(r: Role, a = 1) { return pcss(this.P, r, a); }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const st = stateAt(this.list, f.t);
    const sh = shotAt(this.list, f.t);
    const frame = String(st.frame), stage = String(st.stage);
    if (this.plate.variant === 'clock') return this.clock(f, out);
    if (this.plate.variant === 'riso') return this.riso(f, frame, stage, sh.t0, out);
    return this.credits(f, frame, stage, sh.t0, out);
  }

  // ---------------------------------------------------------------- clock (v4 NIGHT p07, hosted by wall)
  // A paper clock pasted on the brick: a printed mustard face (the subject accent — the brick around it stays the
  // host's dark), torn edge, paste wrinkles; the line printed across the face. The second hand ticks one step per beat
  // (a held state flip), the minute hand jumps on the downbeat; the signal dot rides the second hand's tip.
  private CL?: Layer2D;
  private clock(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const L = (this.CL ??= new Layer2D()), c = L.ctx, t = f.t, au = this.au;
    L.clear();
    const cx = 960, cy = 500, R = 290;
    const bi = Math.max(0, beatIndex(au, t) - beatIndex(au, this.ctx.start));
    const bp = beatPulse(au, t, 0.1), dp = downbeatPulse(au, t, 0.2);
    const bars = Math.floor(bi / 4);
    // the paper: a square sheet, slightly rotated, torn edge (seeded), mustard print
    c.save(); c.translate(cx, cy); c.rotate(-0.035);
    c.beginPath();
    const S = R + 46, n = 64;
    for (let i = 0; i < n; i++) {
      const side = Math.floor(i / 16), u = (i % 16) / 16, j = (hash(i, 7) - 0.5) * 14;
      const [x, y] = side === 0 ? [-S + 2 * S * u, -S + j] : side === 1 ? [S + j, -S + 2 * S * u] : side === 2 ? [S - 2 * S * u, S + j] : [-S + j, S - 2 * S * u];
      if (i) c.lineTo(x, y); else c.moveTo(x, y);
    }
    c.closePath();
    c.fillStyle = pmix(this.P, 'mid', 'hi', 0.22, 0.9); c.fill(); // mustard print (subject accent, kept dim: the plate's ground stays dark)
    // paste wrinkles: faint diagonal creases (seeded, static)
    c.strokeStyle = this.css('deep', 0.35); c.lineWidth = 2;
    for (let i = 0; i < 7; i++) { const y = -S + 2 * S * hash(i, 3); c.beginPath(); c.moveTo(-S, y); c.lineTo(S, y + (hash(i, 5) - 0.5) * 160); c.stroke(); }
    // the face: printed ring + 12 ticks
    c.strokeStyle = this.css('deep', 0.95); c.lineWidth = 10;
    c.beginPath(); c.arc(0, 0, R, 0, Math.PI * 2); c.stroke();
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      c.lineWidth = i % 3 ? 6 : 14;
      c.beginPath(); c.moveTo(Math.sin(a) * (R - 18), -Math.cos(a) * (R - 18)); c.lineTo(Math.sin(a) * (R - 64), -Math.cos(a) * (R - 64)); c.stroke();
    }
    // hands: minute jumps a twelfth per bar, second steps a sixtieth... per beat (×5 so it reads)
    const am = (bars / 12) * Math.PI * 2 + 0.6, as = (bi / 12) * Math.PI * 2;
    c.lineCap = 'round';
    c.strokeStyle = this.css('ground', 0.95); c.lineWidth = 22 + 6 * dp;
    c.beginPath(); c.moveTo(0, 0); c.lineTo(Math.sin(am) * R * 0.55, -Math.cos(am) * R * 0.55); c.stroke();
    c.strokeStyle = this.css('signal', 1); c.lineWidth = 7;
    c.beginPath(); c.moveTo(-Math.sin(as) * 50, Math.cos(as) * 50); c.lineTo(Math.sin(as) * R * 0.86, -Math.cos(as) * R * 0.86); c.stroke();
    c.fillStyle = this.css('signal', 1);
    c.beginPath(); c.arc(Math.sin(as) * R * 0.86, -Math.cos(as) * R * 0.86, 12 + 10 * bp, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.arc(0, 0, 16, 0, Math.PI * 2); c.fill();
    c.restore();
    // the line printed across the lower face, in the paper's ink (sung = signal)
    const line = this.lines[0];
    if (line) drawLyric(c, line, t, { x: cx, y: cy + 200, size: 128, maxWidth: 2 * R + 60, align: 'center', family: F.slam(), sungColor: 'signal', unsungColor: 'ink', unsungAlpha: 0.8, rotation: -0.035 });
    L.upload();
    clearRT(this.ctx.renderer, out, [0, 0, 0], 0);
    this.ctx.comp.draw(this.ctx.renderer, L.texture, out, { mode: 'normal' });
    return {};
  }

  // ------------------------------------------------------------------ riso
  /** Two-row flush-left setting of a line, balanced, fitted to maxW (cached). */
  private rows(line: Line, family: string, maxW: number, maxSize: number): Rows {
    const key = `${line.start}|${family}|${maxW}|${maxSize}`;
    const hit = this.rowCache.get(key);
    if (hit) return hit;
    const c = this.L.ctx;
    const probe = layoutLine(c, line, family, 100);
    const n = probe.words.length;
    let split = Math.max(1, Math.ceil(n / 2)), best = Infinity;
    for (let k = 1; k < n; k++) {
      const r1 = probe.words[k - 1]!.x + probe.words[k - 1]!.w, r2 = probe.width - probe.words[k]!.x;
      if (Math.max(r1, r2) < best) { best = Math.max(r1, r2); split = k; }
    }
    if (n < 2) { split = n; best = probe.width; }
    const size = Math.min(maxSize, (maxW / Math.max(1, best)) * 100);
    const lay = layoutLine(c, line, family, size);
    const wordX = lay.words.map((w) => w.x), wordW = lay.words.map((w) => w.w);
    const r1 = split > 0 ? wordX[split - 1]! + wordW[split - 1]! : 0;
    const r2 = split < n ? lay.width - wordX[split]! : 0;
    const out: Rows = { size, split, wordX, wordW, rowW: [r1, r2], gap: size * 1.12 };
    this.rowCache.set(key, out);
    return out;
  }

  /** Page-space centre of word k in the two-row setting anchored at (x0, baseline y0). */
  private wordCentre(R: Rows, k: number, x0: number, y0: number) {
    const row = k >= R.split ? 1 : 0;
    const x = x0 + R.wordX[k]! - (row ? R.wordX[R.split]! : 0);
    return { x: x + R.wordW[k]! / 2, y: y0 + row * R.gap - R.size * 0.36 };
  }

  private riso(f: Frame, frame: string, stage: string, t0: number, out: THREE.WebGLRenderTarget): PostOverrides {
    const t = f.t, au = this.au, line = this.lines[0]!;
    const start = this.ctx.start, end = this.ctx.end;
    const fam = F.slam();
    const R = this.rows(line, fam, 1560, 300);
    const blockW = Math.max(R.rowW[0], R.rowW[1]);
    // storyboard lyr: the block centred on (900, 560)
    const x0 = 900 - blockW / 2, y0 = 560 - R.gap / 2 + R.size * 0.36;
    const rot = -0.05;
    // --- the beat: every beat is a new pull through the drum
    const k = Math.max(0, beatIndex(au, t) - beatIndex(au, start));
    const bp = beatPulse(au, t, 0.09);
    const dp = downbeatPulse(au, t, 0.14);
    // registration: the pink pass slips ~6.5 px further per pull, plus a per-pull hop across the slip
    const hop = (hash(k, 4) - 0.5) * 10;
    const slip = (5 + 6.5 * k) * (frame === 'tilt' ? 1.35 : 1);
    const mis = { x: 0.83 * slip - 0.56 * hop, y: -0.56 * slip - 0.83 * hop };
    // paper feed: the sheet lands 10 px low on the beat and settles
    const jolt = 16 * beatPulse(au, t, 0.07);
    const lt = t - t0;
    // --- camera (page → screen)
    const word = (i: number) => this.wordCentre(R, i, x0, y0);
    const tb = au.beats[beatIndex(au, t)] ?? t;
    const sungWord = Math.max(0, line.words.findIndex((w) => tb < wordEnd(w)));
    let M: Mat;
    if (frame === 'macro') {
      // on the misregistered word (꿈 at the shot), following the sung word; both passes in frame
      const w = word(Math.min(Math.max(2, sungWord), line.words.length - 1));
      const cx = w.x + mis.x * 0.5, cy = w.y + mis.y * 0.5;
      M = camMat(cx, cy, 960, 540 + jolt, 3.1 + 0.08 * lt, rot - 0.03);
    } else if (frame === 'row') {
      // the whole first row inside the 96 px title-safe margins
      const a = word(0);
      const fit = (W - 2 * 110) / (R.rowW[0] * Math.cos(rot + 0.07));
      M = camMat(x0 + R.rowW[0] / 2, a.y + 40, 960, 520 + jolt, fit * (1 + 0.012 * lt), rot + 0.07);
    } else if (frame === 'tilt') {
      // the sheet lying on the output tray, seen from the side of the machine
      const q = stage === 'exit' ? ease.inCubic(clamp((t - t0) / Math.max(0.05, end - t0))) : 0;
      M = camMat(960, 540, 990 + 1250 * q, 560 - 180 * q + jolt, 0.98 + 0.03 * lt, -0.42, 0.62, 0.2 + 0.08 * q);
    } else {
      M = camMat(960, 540, 960, 540 + jolt, 0.9 + 0.012 * lt, -0.025);
    }
    const Mp = mulMat(M, trMat(mis.x, mis.y));
    // --- plates (coverage in alpha; the ink pass colours them)
    const A = this.L, B = this.B;
    A.clear(); B.clear();
    const a = A.ctx, b = B.ctx;
    // pink: the dream sun, a radial tone that the screen turns into growing dots
    apply(b, Mp);
    const sx = 1330, sy = 430, sr = 340;
    const g = b.createRadialGradient(sx, sy, 0, sx, sy, sr);
    g.addColorStop(0, this.css('mid', 0.96)); g.addColorStop(0.5, this.css('mid', 0.7)); g.addColorStop(0.97, this.css('mid', 0.16)); g.addColorStop(1, this.css('mid', 0));
    b.fillStyle = g;
    b.beginPath(); b.arc(sx, sy, sr, 0, Math.PI * 2); b.fill();
    // blue: the horizon, a flat tone band that fades up into the sun
    apply(a, M);
    const hz = a.createLinearGradient(0, 700, 0, 1080);
    hz.addColorStop(0, this.css('deep', 0)); hz.addColorStop(0.35, this.css('deep', 0.35)); hz.addColorStop(1, this.css('deep', 0.8));
    a.fillStyle = hz;
    a.fillRect(0, 700, W, 380);
    // the line: blue prints solid as each syllable is sung (unsung: a light screen tint, the plate inked but not
    // yet pulled); the pink second pass prints only what is sung, out of register
    const rowXf = (s: CharState): CharXform => {
      const row2 = s.word >= R.split;
      const pop = s.sung ? 1 + 0.16 * Math.pow(1 - s.frac, 4) : 1;
      return { dx: row2 ? -R.wordX[R.split]! : 0, dy: row2 ? R.gap : 0, scale: pop };
    };
    const opts = { x: x0, y: y0, size: R.size, align: 'left' as const, family: fam, rotation: rot, lead: 1, charTransform: (_c: string, _i: number, s: CharState) => rowXf(s) };
    apply(a, M);
    drawLyric(a, line, t, { ...opts, unsungAlpha: 0.3 });
    apply(b, Mp);
    drawLyric(b, line, t, { ...opts, unsungAlpha: 0 });
    A.upload(); B.upload();
    // --- ink pass
    const u = this.ink!.u;
    const det = M[0] * M[3] - M[1] * M[2];
    const ia = M[3] / det, ib = -M[1] / det, ic = -M[2] / det, id = M[0] / det;
    const ie = -(ia * M[4] + ic * M[5]), iff = -(ib * M[4] + id * M[5]);
    (u.uInv!.value as THREE.Matrix3).set(ia, ic, ie, ib, id, iff, 0, 0, 1);
    (u.uMis!.value as THREE.Vector2).set(mis.x, mis.y);
    (u.uInk!.value as THREE.Vector4).set(0.8 + 0.2 * bp, 0.5 - 0.32 * bp, k + 1, 9);
    u.uPx!.value = Math.sqrt(Math.abs(det));
    (u.uStack!.value as THREE.Vector4).set(-16, 12, 0.014, 3);
    this.ink!.render(this.ctx.renderer, out);
    const kp = kickPulse(au, t, 0.08);
    return { bloom: 0, halation: 0, ca: 0, vignette: 0.08, grain: 0.035, zoom: 1 + 0.03 * bp + 0.02 * dp, shake: [0, 2.5 * kp] };
  }

  // ------------------------------------------------------------------ credits
  private credits(f: Frame, frame: string, stage: string, t0: number, out: THREE.WebGLRenderTarget): PostOverrides {
    const t = f.t, au = this.au, start = this.ctx.start, end = this.ctx.end, bl = this.beatLen;
    const k = Math.max(0, beatIndex(au, t) - beatIndex(au, start));
    const beatT = (i: number) => au.beats[beatIndex(au, start) + i] ?? start + i * bl;
    const bp = beatPulse(au, t, 0.08), kp = kickPulse(au, t, 0.07), dp = downbeatPulse(au, t, 0.12);
    const lt = t - t0;
    // --- geometry (page = the card)
    const th = -0.49; // the wedge's axis (≈ -28°: pointing up-right, straight at the disc's centre)
    const ux = Math.cos(th), uy = Math.sin(th), nx = -uy, ny = ux; // axis, normal (down-right)
    const disc = { x: 1470, y: 360, r: 255 };
    const at = (o: { x: number; y: number }, du: number, dn = 0) => ({ x: o.x + ux * du + nx * dn, y: o.y + uy * du + ny * dn });
    // the tip drives in per beat in the first bar (snap), then holds; in the last bar it pierces the disc
    const steps = [0.42, 0.62, 0.78, 0.92, 1];
    const dk = k < 4 ? steps[k]! + (steps[k + 1]! - steps[k]!) * ease.outExpo(clamp((t - beatT(k)) / 0.11)) : 1;
    const pk = stage === 'pierce' ? k - 12 : -1;
    const pierce = pk < 0 ? 0 : 95 * pk + 95 * ease.outExpo(clamp((t - beatT(k)) / 0.1));
    const tipF = at(disc, -disc.r - 14);
    const tip = at(tipF, -1300 * (1 - dk) + pierce);
    const len = 1900, half = 330;
    // the base rides the drive but not the pierce: in the last bar the wedge lengthens into the disc
    const base = at(tipF, -1300 * (1 - dk) - len);
    // upper edge of the (final) wedge: direction e, outward normal -en
    const eL = Math.hypot(len, half), ex = (ux * len + nx * half) / eL, ey = (uy * len + ny * half) / eL;
    const eth = Math.atan2(ey, ex), enx = -ey, eny = ex;
    // title along the upper edge (outside), credit on the wedge's body along the axis
    const tf = F.archivo(125, 900), cf = F.archivo(100, 500);
    const TITLE = ['DYSON', 'SPHERE'], CRED = ['Sentient', 'Architect'];
    // the title fits 1000 px of the edge (≥ 96 px title-safe in every frame of the card)
    const t100 = layout(TITLE.join(' '), tf, 100).width;
    const tSize = Math.min(124, (1000 / t100) * 100), cSize = 70;
    const tl = TITLE.map((w) => layout(w, tf, tSize)), cl = CRED.map((w) => layout(w, cf, cSize));
    const sp = tSize * 0.3, csp = cSize * 0.3;
    const tW = tl[0]!.width + sp + tl[1]!.width, cW = cl[0]!.width + csp + cl[1]!.width;
    const tGap = 44, tBack = 70;
    const tStart = { x: tipF.x - ex * (tBack + tW) - enx * tGap, y: tipF.y - ey * (tBack + tW) - eny * tGap };
    const cStart = at(tipF, -(cW + 250), cSize * 0.36);
    // --- stamps: one block per beat
    type Stamp = { at: number; draw: (c: C2, fill: string) => void };
    const glyphRun = (c: C2, L: ReturnType<typeof layout>, fam: string, size: number, o: { x: number; y: number }, off: number, t1: number, ang: number) => {
      c.font = font(fam, size);
      const cx = Math.cos(ang), cy = Math.sin(ang);
      for (const gl of L.glyphs) {
        // glyphs of one block cascade in 14 ms steps: one hit that reads as stamped letter by letter
        const gt = t1 + gl.i * 0.014;
        if (t < gt) continue;
        const pop = 1 + 0.35 * Math.exp(-(t - gt) / 0.035);
        const d = off + gl.x + gl.w / 2;
        c.save();
        c.translate(o.x + cx * d, o.y + cy * d);
        c.rotate(ang + (hash(gl.i, size) - 0.5) * 0.03);
        c.scale(pop, pop);
        c.fillText(gl.ch, -gl.w / 2, 0);
        c.restore();
      }
    };
    const dot = (x: number, y: number, r: number) => (c: C2, fill: string) => { c.fillStyle = fill; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill(); };
    const tb = { x: tStart.x - enx * (tSize * 0.78 + 18), y: tStart.y - eny * (tSize * 0.78 + 18) };
    const stamps: Stamp[] = [
      { at: beatT(1), draw: (c, fill) => { c.fillStyle = fill; glyphRun(c, tl[0]!, tf, tSize, tStart, 0, beatT(1), eth); } },
      { at: beatT(2), draw: (c, fill) => { c.fillStyle = fill; glyphRun(c, tl[1]!, tf, tSize, tStart, tl[0]!.width + sp, beatT(2), eth); } },
      { at: beatT(3), draw: (c, fill) => this.bar(c, fill, tb.x, tb.y, tW * 0.62, 34, eth) },
      { at: beatT(4), draw: (c, fill) => { c.fillStyle = fill; glyphRun(c, cl[0]!, cf, cSize, cStart, 0, beatT(4), th); } },
      { at: beatT(5), draw: (c, fill) => { c.fillStyle = fill; glyphRun(c, cl[1]!, cf, cSize, cStart, cl[0]!.width + csp, beatT(5), th); } },
      { at: beatT(6), draw: (c, fill) => { const o = at(cStart, 0, 34); this.bar(c, fill, o.x, o.y, cW, 26, th); } },
      { at: beatT(7), draw: dot(300, 210, 64) },
      // the card: massive blocks, one per beat
      { at: beatT(8), draw: (c, fill) => this.bar(c, fill, 1180, 900, 520, 70, th) },
      { at: beatT(9), draw: (c, fill) => this.bar(c, fill, 1370, 970, 360, 70, th) },
      { at: beatT(10), draw: (c, fill) => this.bar(c, fill, 800, 110, 250, 76, th + Math.PI / 2) },
      { at: beatT(11), draw: dot(1780, 720, 44) },
    ];
    // colour of each stamp: title black on red, credit cream on the black wedge, blocks alternate
    const inkOf = (i: number): Role => (i <= 1 ? 'deep' : i <= 2 ? 'hi' : i <= 5 ? 'mid' : (['deep', 'deep', 'hi', 'mid', 'deep'] as Role[])[i - 6]!);
    // --- camera
    const cMid = at(cStart, cW / 2, -60);
    const tMid = { x: tStart.x + ex * tW / 2, y: tStart.y + ey * tW / 2 };
    let M: Mat;
    if (frame === 'tilt') {
      // constructivist camera: turns in 15° steps per beat (snap), the credit on the wedge centred
      const kb = k - 4, turn = (a: number) => (a * 15 * Math.PI) / 180;
      const r = turn(kb) + (turn(kb + 1) - turn(kb)) * ease.outBack(clamp((t - beatT(k)) / 0.12));
      M = camMat((cMid.x + tMid.x) / 2, (cMid.y + tMid.y) / 2, 960, 540, 0.97 + 0.02 * lt, 0, 1, r);
    } else if (frame === 'push') {
      M = camMat(tMid.x * 0.62 + disc.x * 0.38, (tMid.y + disc.y) / 2 + 70, 960, 540, 1.03 + 0.03 * lt, 0, 1, 0.04);
    } else if (frame === 'flat') {
      M = camMat(960, 540, 960, 540, 1.0 - 0.012 * lt);
    } else {
      M = camMat(960, 540, 960, 540, 1.02 + 0.015 * lt);
    }
    // paper jolt on each stamp (kicks jolt harder)
    const jolt = 7 * bp + 14 * Math.min(1, 3.5 * kp);
    M[5] += jolt;
    // --- draw
    const L = this.L, c = L.ctx;
    L.clear(this.css('ground'));
    apply(c, M);
    // the disc: cream, split along the wedge's axis once the wedge pierces it
    // v4 (palette 'credits'): the disc is the cream 'hi' (the sphere = the disc), drawn with a fine ink rim on the pale card
    c.fillStyle = this.css('hi');
    c.strokeStyle = this.css('text'); c.lineWidth = 5;
    if (pk < 0) {
      c.beginPath(); c.arc(disc.x, disc.y, disc.r, 0, Math.PI * 2); c.fill(); c.stroke();
    } else {
      const split = 16 + 14 * pk + 10 * bp;
      for (const sgn of [-1, 1]) {
        c.beginPath();
        c.arc(disc.x + nx * split * sgn, disc.y + ny * split * sgn, disc.r, th + (sgn > 0 ? 0 : Math.PI), th + (sgn > 0 ? Math.PI : Math.PI * 2));
        c.closePath(); c.fill();
      }
    }
    // the wedge
    c.fillStyle = this.css('deep');
    c.beginPath();
    c.moveTo(tip.x, tip.y);
    c.lineTo(base.x + nx * half, base.y + ny * half);
    c.lineTo(base.x - nx * half, base.y - ny * half);
    c.closePath(); c.fill();
    // afterimage of the latest stamp (white, offset, fading until the next beat), under the stamps
    const done = stamps.map((s, i) => ({ s, i })).filter((x) => t >= x.s.at);
    const last = done[done.length - 1];
    if (last) {
      const q = clamp((t - last.s.at) / bl);
      c.save();
      apply(c, mulMat(M, trMat(16 + 10 * q, 12 + 8 * q)));
      c.globalAlpha = 0.75 * (1 - q);
      last.s.draw(c, this.css('hi'));
      c.restore();
    }
    for (const { s, i } of done) {
      apply(c, M);
      s.draw(c, this.css(inkOf(i)));
    }
    L.upload();
    clearRT(this.ctx.renderer, out, plin(this.P, 'ground'));
    this.ctx.comp.draw(this.ctx.renderer, L.texture, out, { mode: 'normal' });
    // exit: the red field to black over the last beat
    const fade = smoothstep(end - bl * 1.1, end - 0.03, t);
    return { bloom: 0, halation: 0, ca: 0, vignette: 0.1, grain: 0.05, fade, zoom: 1 + 0.025 * bp + 0.02 * dp, shake: [0, 2 * bp] };
  }

  /** A solid bar of length w, thickness h, starting at (x, y) along angle a. */
  private bar(c: C2, fill: string, x: number, y: number, w: number, h: number, a: number) {
    c.save();
    c.translate(x, y);
    c.rotate(a);
    c.fillStyle = fill;
    c.fillRect(0, -h / 2, w, h);
    c.restore();
  }

  override dispose() {
    this.L?.texture.dispose();
    this.B?.texture.dispose();
    this.ink?.mat.dispose();
  }
}
