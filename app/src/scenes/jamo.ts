// JAMO — H1, Ahn Sang-soo deconstructed Hangul kinetic type (the film's only Korean-letterform plate).
//   ahn (p25)  line 23 set in geometric jamo on white: every syllable is split into initial / medial / final by
//              Unicode arithmetic (code − 0xAC00 → ⌊i/588⌋, ⌊(i%588)/28⌋, i%28) and each jamo is rebuilt from bold
//              masses only — bars, diagonals, rings — hung from a top line in Ahn's 1985 "out of the square"
//              arrangement (initial fixed top-left, vowel beside/below, final below; ragged bottoms). Consonants
//              black, vowels blue, the ㅎ rings red. Unsung syllables wait as faint jamo laid in a row on the
//              baseline and assemble into their block the moment the voice reaches them.
//              Downbeat: the line locks (hit). Then on every beat the pieces fly further apart, faster each beat
//              (change accelerating); the sung word 변화 holds together more than the rest so it stays legible
//              under the close camera. On the last beat everything scatters, and the pieces snap back into the
//              assembled line on the cut.
import type * as THREE from 'three';
import { Scene, type Frame, type PostOverrides } from '../engine/scene';
import { Layer2D, clearRT, W, H } from '../engine/gl';
import { palette, pcss, plin, type NamedPalette, type Role } from '../engine/palette';
import { drawLyric, ownedLines, layoutLine, F, type LineLayout, type CharState } from '../engine/lyric';
import { beatPulse, kickPulse, downbeatPulse } from '../engine/beat';
import { shotAt, type PlateInfo, type Shot } from '../engine/shots';
import { hash, clamp, lerp, ease } from '../engine/util';
import type { Line } from '../engine/lyrics';
import { shots } from './jamo.shots';

// ------------------------------------------------------------------ geometric jamo
/** A mass in jamo units (consonant box = 1 × 1, y down): filled bar, stroked diagonal, stroked ring. */
type Piece =
  | { k: 'bar'; x: number; y: number; w: number; h: number }
  | { k: 'diag'; x1: number; y1: number; x2: number; y2: number }
  | { k: 'ring'; cx: number; cy: number; r: number };
/** A placed piece: geometry in syllable units, its colour role, which jamo of the syllable it belongs to. */
interface PP { p: Piece; role: Role; jamo: number; cx: number; cy: number }
interface Syl { pieces: PP[]; w: number; h: number; nJamo: number; jb: [number, number, number, number][] }

const SW = 0.17; // stroke weight (units): one weight everywhere, as in Ahn's geometric face
const bar = (x: number, y: number, w: number, h: number): Piece => ({ k: 'bar', x, y, w, h });
const diag = (x1: number, y1: number, x2: number, y2: number): Piece => ({ k: 'diag', x1, y1, x2, y2 });
const ring = (cx: number, cy: number, r: number): Piece => ({ k: 'ring', cx, cy, r });

const S = SW;
/** The 14 basic consonants in a unit box. */
const CONS: Record<string, Piece[]> = {
  'ㄱ': [bar(0, 0, 1, S), bar(1 - S, 0, S, 1)],
  'ㄴ': [bar(0, 0, S, 1), bar(0, 1 - S, 1, S)],
  'ㄷ': [bar(0, 0, 1, S), bar(0, S, S, 1 - 2 * S), bar(0, 1 - S, 1, S)],
  'ㄹ': [bar(0, 0, 1, S), bar(1 - S, S, S, 0.5 - 1.5 * S), bar(0, 0.5 - S / 2, 1, S), bar(0, 0.5 + S / 2, S, 0.5 - 1.5 * S), bar(0, 1 - S, 1, S)],
  'ㅁ': [bar(0, 0, 1, S), bar(0, S, S, 1 - 2 * S), bar(1 - S, S, S, 1 - 2 * S), bar(0, 1 - S, 1, S)],
  'ㅂ': [bar(0, 0, S, 1 - S), bar(1 - S, 0, S, 1 - S), bar(S, 0.42, 1 - 2 * S, S), bar(0, 1 - S, 1, S)],
  'ㅅ': [diag(0.5, 0.02, 0.06, 0.98), diag(0.5, 0.02, 0.94, 0.98)],
  'ㅇ': [ring(0.5, 0.5, 0.5 - S / 2)],
  'ㅈ': [bar(0, 0, 1, S), diag(0.5, S, 0.08, 0.98), diag(0.5, S, 0.92, 0.98)],
  'ㅊ': [bar(0.5 - S / 2, 0, S, 0.18), bar(0, 0.2, 1, S), diag(0.5, 0.2 + S, 0.1, 0.98), diag(0.5, 0.2 + S, 0.9, 0.98)],
  'ㅋ': [bar(0, 0, 1, S), bar(1 - S, S, S, 1 - S), bar(0, 0.46, 1 - S, S)],
  'ㅌ': [bar(0, 0, 1, S), bar(0, S, S, 1 - 2 * S), bar(S, 0.44, 1 - S, S), bar(0, 1 - S, 1, S)],
  'ㅍ': [bar(0, 0, 1, S), bar(0.22, S, S, 1 - 2 * S), bar(0.78 - S, S, S, 1 - 2 * S), bar(0, 1 - S, 1, S)],
  'ㅎ': [bar(0.3, 0, 0.4, S), bar(0, 0.2, 1, S), ring(0.5, 0.69, 0.3 - S / 2)],
};
const INITIAL = ['ㄱ', 'ㄱㄱ', 'ㄴ', 'ㄷ', 'ㄷㄷ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅂㅂ', 'ㅅ', 'ㅅㅅ', 'ㅇ', 'ㅈ', 'ㅈㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
const FINAL = ['', 'ㄱ', 'ㄱㄱ', 'ㄱㅅ', 'ㄴ', 'ㄴㅈ', 'ㄴㅎ', 'ㄷ', 'ㄹ', 'ㄹㄱ', 'ㄹㅁ', 'ㄹㅂ', 'ㄹㅅ', 'ㄹㅌ', 'ㄹㅍ', 'ㄹㅎ', 'ㅁ', 'ㅂ', 'ㅂㅅ', 'ㅅ', 'ㅅㅅ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
/** Medial = [horizontal part, vertical part] (either may be empty). */
const MEDIAL: [string, string][] = [
  ['', 'a'], ['', 'ae'], ['', 'ya'], ['', 'yae'], ['', 'eo'], ['', 'e'], ['', 'yeo'], ['', 'ye'],
  ['o', ''], ['o', 'a'], ['o', 'ae'], ['o', 'i'], ['yo', ''], ['u', ''], ['u', 'eo'], ['u', 'e'], ['u', 'i'],
  ['yu', ''], ['eu', ''], ['eu', 'i'], ['', 'i'],
];

/** Vertical vowel in the column [x0, x0+0.62] × [0, h]. */
function vVowel(v: string, x0: number, h: number): Piece[] {
  const m = h > 1.2 ? 0.5 : h * 0.5, t1 = m - 0.15, t2 = m + 0.15, L = 0.36;
  switch (v) {
    case 'a': return [bar(x0, 0, S, h), bar(x0 + S, m - S / 2, L, S)];
    case 'ya': return [bar(x0, 0, S, h), bar(x0 + S, t1 - S / 2, L, S), bar(x0 + S, t2 - S / 2, L, S)];
    case 'eo': return [bar(x0 + L, 0, S, h), bar(x0, m - S / 2, L, S)];
    case 'yeo': return [bar(x0 + L, 0, S, h), bar(x0, t1 - S / 2, L, S), bar(x0, t2 - S / 2, L, S)];
    case 'ae': return [bar(x0, 0, S, h), bar(x0 + S, m - S / 2, 0.22, S), bar(x0 + 0.44, 0, S, h)];
    case 'yae': return [bar(x0, 0, S, h), bar(x0 + S, t1 - S / 2, 0.22, S), bar(x0 + S, t2 - S / 2, 0.22, S), bar(x0 + 0.44, 0, S, h)];
    case 'e': return [bar(x0 + 0.22, 0, S, h), bar(x0, m - S / 2, 0.22, S), bar(x0 + 0.44, 0, S, h)];
    case 'ye': return [bar(x0 + 0.22, 0, S, h), bar(x0, t1 - S / 2, 0.22, S), bar(x0, t2 - S / 2, 0.22, S), bar(x0 + 0.44, 0, S, h)];
    case 'i': return [bar(x0 + 0.12, 0, S, h)];
    default: return [];
  }
}
/** Horizontal vowel in the row [0, 1] × [y0, y0+0.46]. */
function hVowel(v: string, y0: number): Piece[] {
  const T = 0.26;
  switch (v) {
    case 'o': return [bar(0.5 - S / 2, y0, S, T), bar(0, y0 + T, 1, S)];
    case 'yo': return [bar(0.3 - S / 2, y0, S, T), bar(0.7 - S / 2, y0, S, T), bar(0, y0 + T, 1, S)];
    case 'u': return [bar(0, y0, 1, S), bar(0.5 - S / 2, y0 + S, S, T)];
    case 'yu': return [bar(0, y0, 1, S), bar(0.3 - S / 2, y0 + S, S, T), bar(0.7 - S / 2, y0 + S, S, T)];
    case 'eu': return [bar(0, y0 + 0.14, 1, S)];
    default: return [];
  }
}
/** A consonant cluster ('ㄱ' or a doubled / compound 'ㄹㄱ') fitted into the box [x, y, w, h]. */
function cons(spec: string, x: number, y: number, w: number, h: number): Piece[] {
  const parts = Array.from(spec), n = parts.length, gap = n > 1 ? 0.08 : 0, cw = (w - gap * (n - 1)) / n;
  const out: Piece[] = [];
  parts.forEach((c, i) => {
    const ox = x + i * (cw + gap), sx = cw, sy = h;
    for (const p of CONS[c] ?? []) {
      if (p.k === 'bar') out.push(bar(ox + p.x * sx, y + p.y * sy, Math.max(S, p.w * sx), Math.max(S, p.h * sy)));
      else if (p.k === 'diag') out.push(diag(ox + p.x1 * sx, y + p.y1 * sy, ox + p.x2 * sx, y + p.y2 * sy));
      else out.push(ring(ox + p.cx * sx, y + p.cy * sy, p.r * Math.min(sx, sy)));
    }
  });
  // doubled / compound: the bars keep the one stroke weight (re-thicken what the squeeze thinned)
  return out.map((p) => (p.k === 'bar' ? { ...p, w: p.w < S ? S : p.w, h: p.h < S ? S : p.h } : p));
}
const centre = (p: Piece): [number, number] =>
  p.k === 'bar' ? [p.x + p.w / 2, p.y + p.h / 2] : p.k === 'diag' ? [(p.x1 + p.x2) / 2, (p.y1 + p.y2) / 2] : [p.cx, p.cy];
function bounds(ps: Piece[]): [number, number, number, number] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of ps) {
    const b = p.k === 'bar' ? [p.x, p.y, p.x + p.w, p.y + p.h] : p.k === 'diag'
      ? [Math.min(p.x1, p.x2), Math.min(p.y1, p.y2), Math.max(p.x1, p.x2), Math.max(p.y1, p.y2)]
      : [p.cx - p.r, p.cy - p.r, p.cx + p.r, p.cy + p.r];
    x0 = Math.min(x0, b[0]!); y0 = Math.min(y0, b[1]!); x1 = Math.max(x1, b[2]!); y1 = Math.max(y1, b[3]!);
  }
  return [x0, y0, x1, y1];
}

const sylCache = new Map<string, Syl | null>();
/** Decompose a precomposed syllable by Unicode arithmetic and build its Ahn-style block (null: not Hangul). */
function syllable(ch: string): Syl | null {
  if (sylCache.has(ch)) return sylCache.get(ch)!;
  const code = ch.codePointAt(0)! - 0xac00;
  if (code < 0 || code >= 11172) { sylCache.set(ch, null); return null; }
  const ini = Math.floor(code / 588), med = Math.floor((code % 588) / 28), fin = code % 28;
  const [hv, vv] = MEDIAL[med]!;
  const jamo: [Piece[], Role][] = [];
  const xV = 1.2, hasH = hv !== '', hasV = vv !== '';
  const vowelH = hasH ? 1.72 : 1;
  jamo.push([cons(INITIAL[ini]!, 0, 0, 1, 1), 'deep']);
  const vowel = [...(hasH ? hVowel(hv, 1.16) : []), ...(hasV ? vVowel(vv, xV, vowelH) : [])];
  jamo.push([vowel, 'mid']);
  const fy = (hasH ? 1.72 : 1) + 0.2;
  if (fin) jamo.push([cons(FINAL[fin]!, 0.08, fy, 0.84, 0.8), 'deep']);
  const pieces: PP[] = [];
  const jb: [number, number, number, number][] = [];
  jamo.forEach(([ps, role], j) => {
    jb.push(bounds(ps));
    for (const p of ps) {
      const [cx, cy] = centre(p);
      pieces.push({ p, role: p.k === 'ring' ? 'hi' : role, jamo: j, cx, cy });
    }
  });
  const all = bounds(pieces.map((q) => q.p));
  const out: Syl = { pieces, w: hasV ? xV + 0.62 : 1, h: all[3], nJamo: jamo.length, jb };
  sylCache.set(ch, out);
  return out;
}

// ------------------------------------------------------------------ camera
interface Cam { s: number; rot: number; fx: number; fy: number; sx: number; sy: number }
/** frame -> camera: focus point (world px) mapped to a screen point, scale, roll. u = 0..1 through the shot. */
function camera(frame: string, u: number, w0: [number, number], w1: [number, number], mid: [number, number]): Cam {
  const push = 1 + 0.05 * ease.outCubic(u);
  switch (frame) {
    case 'lean': return { s: 1.28 * push, rot: -0.07, fx: w0[0], fy: w0[1], sx: W * 0.5, sy: H * 0.52 };
    case 'mid': return { s: 1.1 * push, rot: 0.05, fx: mid[0], fy: mid[1], sx: W * 0.5, sy: H * 0.5 };
    case 'close': return { s: 1.9 * push, rot: -0.03, fx: w1[0], fy: w1[1] + 40, sx: W * 0.5, sy: H * 0.5 };
    case 'fly': return { s: 0.86, rot: 0.04, fx: mid[0], fy: mid[1], sx: W * 0.5, sy: H * 0.5 };
    default: return { s: 1 * push, rot: 0, fx: mid[0], fy: mid[1], sx: W * 0.5, sy: H * 0.5 }; // wide
  }
}

// ------------------------------------------------------------------ scene
export default class Jamo extends Scene {
  private layer!: Layer2D;
  private list: Shot[] = [];
  private plate!: PlateInfo;
  private P!: NamedPalette;
  private lines: Line[] = [];
  /** Beats inside the plate (the first is the downbeat lock; the rest are the break-apart beats). */
  private beats: number[] = [];

  override init() {
    this.plate = this.ctx.params as PlateInfo;
    this.P = palette(this.ctx.params.look?.palette ?? 'ahn');
    this.list = shots(this.plate, this.ctx.audio);
    this.lines = ownedLines(this.ctx);
    this.layer = new Layer2D();
    const p = this.plate;
    this.beats = this.ctx.audio.beats.filter((b) => b > p.start + 0.05 && b < p.end - 0.05);
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, audio } = this.ctx;
    const t = f.t, p = this.plate, P = this.P;
    const sh = shotAt(this.list, t);
    const t1 = Math.min(sh.t1, p.end);
    const u = clamp((t - sh.t0) / Math.max(1e-3, t1 - sh.t0));
    const frame = String(sh.shot.s.frame), stage = String(sh.shot.s.stage);
    const bp = beatPulse(audio, t, 0.1), kp = kickPulse(audio, t, 0.08), dp = downbeatPulse(audio, t, 0.14);

    const L = this.layer, c = L.ctx;
    // hosted (ORBIT): no ground — the glyphs scatter over the host's limb glow (black drops out under 'screen')
    const hosted = !!this.ctx.params.hosted;
    if (hosted) L.clear(); else L.clear(pcss(P, 'ground'));

    // ---- break-apart envelope: per beat further (A) and faster (shorter rise), with less recoil each time
    const lock = this.beats[0] ?? p.start;
    const brk = this.beats.slice(1);
    const lastLine = this.lines[this.lines.length - 1];
    // the last beat: out in ~2 frames, back in ~2 frames, and the assembled line holds the final ~3 frames into the cut
    const snapEnd = Math.min(p.end - 0.05, lastLine ? lastLine.end : p.end - 0.05);
    const snap0 = snapEnd - 0.03;
    const A = [30, 110, 420], RISE = [0.11, 0.08, 0.022], HOLD = [0.4, 0.62, 1];
    let spread = 0;
    brk.forEach((b, k) => {
      const x = t - b;
      if (x < 0) return;
      const r = RISE[Math.min(k, 2)]!, a = A[Math.min(k, 2)]!, hold = HOLD[Math.min(k, 2)]!;
      spread += a * (x < r ? ease.outExpo(x / r) : hold + (1 - hold) * Math.exp(-(x - r) / 0.16));
    });
    if (brk.length && t > brk[0]!) spread += 70 * (t - brk[0]!) * (t - brk[0]!); // the acceleration itself
    const snapK = t >= snapEnd ? 0 : t > snap0 ? 1 - ease.inCubic((t - snap0) / (snapEnd - snap0)) : 1;
    spread *= snapK;
    const lastBeat = brk.length ? brk[brk.length - 1]! : Infinity;
    const scatter = t >= lastBeat;
    const lockHit = t >= lock && t < lock + 0.09 ? 1 - (t - lock) / 0.09 : 0;
    const lockRed = t >= lock && t < lock + 0.075;

    // ---- lyric layout: one line, big, hung from a top line (world coords = 1920×1080)
    const line = this.lines[0];
    const size = 250, lx = W * 0.5, ly = 560;
    let lay: LineLayout | null = null;
    if (line) {
      c.save();
      lay = layoutLine(c, line, F.slam(), size, 1728);
      c.restore();
    }
    const word = (i: number): [number, number] => {
      const wb = lay?.words[i];
      if (!lay || !wb) return [lx, ly - size * 0.2];
      return [lx - lay.width / 2 + wb.x + wb.w / 2, ly - lay.size * 0.2];
    };
    const nW = lay?.words.length ?? 1;
    const cam = camera(frame, u, word(0), word(nW - 1), [lx, ly - size * 0.2]);
    // the cut: the last frames are the assembled line, framed wide
    const final = t >= snapEnd;
    const camF = final ? camera('wide', 0, word(0), word(nW - 1), [lx, ly - size * 0.2]) : cam;
    const punch = 1 + 0.035 * bp + 0.06 * dp + (final ? 0.05 : 0);

    // current word (being sung): holds together more under the break so it stays legible
    let cur = 0;
    if (line) line.words.forEach((w, i) => { if (t >= w.start) cur = i; });

    c.save();
    c.translate(camF.sx, camF.sy);
    c.rotate(camF.rot);
    c.scale(camF.s * punch, camF.s * punch);
    c.translate(-camF.fx, -camF.fy);

    if (line) {
      const U = size * 0.4; // px per jamo unit (consonant box)
      drawLyric(c, line, t, {
        x: lx, y: ly, size, align: 'center', family: F.slam(), maxWidth: 1728, unsungAlpha: 1, lead: 0.4,
        drawChar: (cc: CanvasRenderingContext2D, ch: string, st: CharState) => {
          const syl = syllable(ch);
          const scale = (lay?.size ?? size) / size;
          const u0 = U * scale, sw = SW * u0;
          const bw = st.box.w;
          if (!syl) { cc.fillStyle = pcss(P, 'deep'); cc.fillText(ch, 0, 0); return; }
          const ox = (bw - syl.w * u0) / 2, oy = -size * scale * 0.8;
          // syllable timing (never early): time since this syllable's own start
          const w = line.words[st.word]!;
          const sylT = w.syl?.[st.syl]?.[0] ?? w.start;
          const since = t - sylT;
          const inA = st.sung ? ease.outBack(clamp(since / 0.14)) : 0;
          // the word being sung holds (barely trembling) until the last beat; the rest fly
          const wf = scatter ? (st.word === cur ? 0.45 : 1) : st.word === cur ? (stage === 'burst' ? 0.06 : 0.35) : stage === 'burst' ? 1.5 : 1;
          const idx = st.box.index;
          for (let pi = 0; pi < syl.pieces.length; pi++) {
            const q = syl.pieces[pi]!;
            // strip position (unsung): the jamo in a row on the baseline, small
            const jb = syl.jb[q.jamo]!, n = syl.nJamo;
            const ss = 0.46, slotW = syl.w / n;
            const sx0 = q.jamo * slotW + (slotW - (jb[2] - jb[0]) * ss) / 2 - jb[0] * ss;
            const sy0 = syl.h - (jb[3] - jb[1]) * ss - jb[1] * ss + 0.25;
            const scx = sx0 + q.cx * ss, scy = sy0 + q.cy * ss;
            const pS = lerp(ss, 1, inA);
            let px = lerp(scx, q.cx, inA), py = lerp(scy, q.cy, inA);
            // break-apart: each piece flies on its own heading, spinning, further and faster each beat
            const h1 = hash(idx, pi, 7.1), h2 = hash(idx, pi, 3.3), h3 = hash(idx, pi, 9.7);
            const ang = h1 * Math.PI * 2;
            const dpx = spread * wf * (0.55 + 0.9 * h2) / u0;
            px += Math.cos(ang) * dpx;
            py += Math.sin(ang) * dpx * 0.8;
            const rot = (h3 - 0.5) * 2 * (spread * wf / 90) + (scatter ? 0 : (h3 - 0.5) * 0.12 * kp * (stage === 'burst' ? 1 : 0));
            const alpha = st.sung ? lerp(0.22, 1, clamp(since / 0.06)) : 0.22;
            cc.save();
            cc.translate(ox + px * u0, oy + py * u0);
            if (rot) cc.rotate(rot);
            cc.scale(pS, pS);
            cc.translate(-q.cx * u0, -q.cy * u0);
            cc.globalAlpha *= alpha;
            // downbeat lock: every sung piece stamps red for a moment (Ahn's red), then settles to its own colour
            const role: Role = !st.sung ? 'deep' : lockRed ? 'hi' : q.role;
            const g = q.p;
            if (g.k === 'bar') {
              cc.fillStyle = pcss(P, role);
              cc.fillRect(g.x * u0, g.y * u0, g.w * u0, g.h * u0);
            } else if (g.k === 'diag') {
              cc.strokeStyle = pcss(P, role);
              cc.lineWidth = sw * 1.12;
              cc.lineCap = 'butt';
              cc.beginPath(); cc.moveTo(g.x1 * u0, g.y1 * u0); cc.lineTo(g.x2 * u0, g.y2 * u0); cc.stroke();
            } else {
              // the ㅎ ring: red; on the downbeat lock it fills solid (a sun), then opens back to a ring
              const solid = st.sung && stage === 'lock' ? dp : 0;
              cc.strokeStyle = pcss(P, role);
              cc.lineWidth = sw * (1 + 0.5 * bp * (st.sung ? 1 : 0));
              cc.beginPath(); cc.arc(g.cx * u0, g.cy * u0, g.r * u0, 0, Math.PI * 2); cc.stroke();
              if (solid > 0.02) { cc.fillStyle = pcss(P, role, solid); cc.fill(); }
            }
            cc.restore();
          }
        },
      });
    }
    c.restore();

    clearRT(renderer, out, hosted ? [0, 0, 0] : plin(P, 'ground'), hosted ? 0 : 1);
    this.ctx.comp.draw(renderer, L.upload(), out, { mode: 'normal' });

    // hits: the downbeat lock punches in hard (with the red stamp above), every beat punches in, the scatter shakes
    const shk = scatter && !final ? 10 * (1 - clamp((t - lastBeat) / 0.1)) : 4 * bp * (stage === 'burst' ? 1 : 0);
    const sgn = hash(Math.floor(t * 60), 1.3) > 0.5 ? 1 : -1;
    return {
      grain: 0.035, vignette: 0.05, ca: 0, bloom: 0,
      zoom: 1 + 0.03 * bp + 0.07 * lockHit + (final ? 0.03 : 0),
      shake: [sgn * shk, -sgn * shk * 0.6],
    };
  }
}
