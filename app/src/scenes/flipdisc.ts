// FLIPDISC — E4 flip-disc display (BREAKFAST-style kinetic sign). One plate: a departure board of mechanical discs,
// black on one face, flip-yellow on the other, each turning about its vertical axle. Nothing on screen is drawn as a
// line: every mark is a disc that has physically turned over.
//   Board   176 x 68 discs. Top band (20 discs tall) = the lyric; below it seven departure rows of choices
//           (time, direction arrow, a verb, gate) in a 3x5 dot font — the only Latin on the board, board furniture.
//   Lyric   drawLyric() into a 4x-supersampled band mask every frame (unsung syllables at alpha 0): a disc turns
//           yellow when its syllable has started, in a short diagonal sweep inside the glyph. Line 21 is wiped by
//           a left-to-right flip wave at 122.44 while line 22 flips in behind it.
//   Beat    one choice row flips away per beat (yellow -> black, a travelling rotation wave with a glint where the
//           face catches the light), bottom row first; every disc twitches on its axle on each beat (a mechanical
//           clack: the yellow faces narrow and flash). The last beat takes the band itself: the board goes black.
//   Shots   (./flipdisc.shots) wide frontal -> close, stepping along the line on each beat -> macro on one word ->
//           oblique down the length of the board.
// Rendering: one fragment shader ray-casts the board plane (so the side shot is a true perspective) and draws each
// cell's disc from a per-frame state texture (angle per disc). Colours only from the `flipdisc` palette (uniforms).
import * as THREE from 'three';
import { Scene, type Frame, type PostOverrides } from '../engine/scene';
import { FSPass, clearRT } from '../engine/gl';
import { palette, pcss, plin, type NamedPalette } from '../engine/palette';
import { drawLyric, layoutLine, ownedLines, F, type LineLayout } from '../engine/lyric';
import type { Line } from '../engine/lyrics';
import { beatIndex, beatPulse, downbeatPulse, kickPulse } from '../engine/beat';
import { shotAt, type PlateInfo, type Shot } from '../engine/shots';
import { clamp, smoothstep } from '../engine/util';
import { shots, type Cam } from './flipdisc.shots';

const COLS = 176, ROWS = 68;
const BAND_TOP = 2, BAND = 20; // lyric band rows [2, 22)
const LX = 8; // lyric left margin (discs)
const CH_TOP = 26, CH_N = 7, CH_H = 6; // choice rows: 7 rows of 5 dots + 1 gap, from row 26
const SS = 4; // mask px per disc
const FLIP = 0.075; // seconds for one disc to turn over
const PI = Math.PI;

// ---- 3x5 dot font for the board furniture (times, verbs, gates) and 5x5 arrows ----
const GLYPH: Record<string, string[]> = {
  '0': ['###', '#.#', '#.#', '#.#', '###'], '1': ['.#.', '##.', '.#.', '.#.', '###'], '2': ['###', '..#', '###', '#..', '###'],
  '3': ['###', '..#', '.##', '..#', '###'], '4': ['#.#', '#.#', '###', '..#', '..#'], '5': ['###', '#..', '###', '..#', '###'],
  '6': ['###', '#..', '###', '#.#', '###'], '7': ['###', '..#', '.#.', '.#.', '.#.'], '8': ['###', '#.#', '###', '#.#', '###'],
  '9': ['###', '#.#', '###', '..#', '###'], ':': ['.', '#', '.', '#', '.'],
  A: ['###', '#.#', '###', '#.#', '#.#'], B: ['##.', '#.#', '##.', '#.#', '##.'], D: ['##.', '#.#', '#.#', '#.#', '##.'],
  E: ['###', '#..', '##.', '#..', '###'], G: ['###', '#..', '#.#', '#.#', '###'], H: ['#.#', '#.#', '###', '#.#', '#.#'],
  I: ['###', '.#.', '.#.', '.#.', '###'], L: ['#..', '#..', '#..', '#..', '###'], N: ['#..#', '##.#', '#.##', '#..#', '#..#'],
  O: ['###', '#.#', '#.#', '#.#', '###'], R: ['##.', '#.#', '##.', '#.#', '#.#'], S: ['###', '#..', '###', '..#', '###'],
  T: ['###', '.#.', '.#.', '.#.', '.#.'], U: ['#.#', '#.#', '#.#', '#.#', '###'], V: ['#.#', '#.#', '#.#', '#.#', '.#.'],
  W: ['#...#', '#...#', '#.#.#', '#.#.#', '.#.#.'], Y: ['#.#', '#.#', '.#.', '.#.', '.#.'],
  '>': ['..#..', '...#.', '#####', '...#.', '..#..'], '<': ['..#..', '.#...', '#####', '.#...', '..#..'],
  '^': ['..#..', '.###.', '#.#.#', '..#..', '..#..'], v: ['..#..', '..#..', '#.#.#', '.###.', '..#..'],
  '/': ['.####', '...##', '..#.#', '.#...', '#....'], '\\': ['#....', '.#...', '..#.#', '...##', '.####'],
  '`': ['####.', '##...', '#.#..', '...#.', '....#'],
};
// seven choices: departure time, direction, what you could still do, gate
const CHOICES: [string, string, string, string][] = [
  ['12:04', '>', 'STAY', '01'], ['12:07', '^', 'LEAVE', '03'], ['12:11', '/', 'WAIT', '04'], ['12:15', '<', 'TURN', '07'],
  ['12:18', '\\', 'HOLD', '09'], ['12:22', '`', 'RUN', '12'], ['12:26', 'v', 'BUILD', '15'],
];

const FRAG = /* glsl */ `
uniform sampler2D uState;           // per disc: r = angle (0 black face .. 1 yellow face, over -0.6..pi+0.6 rad)
uniform vec2 uRes;
uniform vec3 uPos, uFwd, uRight, uUp; // pinhole camera; the board is the plane z = 0, u = x, v = -y (disc units)
uniform float uFocal;
uniform vec3 uGround, uDeep, cPalMid, uHi;
uniform float uGlint;
uniform float uHosted; // 1 = hosted on a light world: the surround is the stock itself (it drops out under multiply)
const float COLS = ${COLS}.0, ROWS = ${ROWS}.0;
const float R = 0.43;

float decodeAngle(float r) { return r * (PI + 1.2) - 0.6; }

void main() {
  vec2 fc = vUv * uRes;
  vec2 s = (fc - 0.5 * uRes) / (0.5 * uRes.y);
  vec3 dir = normalize(uFwd * uFocal + uRight * s.x + uUp * s.y);
  float tt = -uPos.z / dir.z;
  vec3 w = uPos + dir * max(tt, 0.0);
  vec2 bv = vec2(w.x, -w.y);                 // board coords (discs)
  float px = max(length(fwidth(bv)), 1e-4);  // one screen pixel in disc units
  // housing: the sign's face, a darker surround outside its frame
  vec2 q = abs(bv - vec2(COLS, ROWS) * 0.5) - vec2(COLS, ROWS) * 0.5 - 1.6;
  float inside = 1.0 - smoothstep(-px, px, max(q.x, q.y));
  float sur = mix(0.45, 1.0, uHosted);
  vec3 col = uGround * mix(sur, 1.0, inside);
  if (tt <= 0.0) { fragColor = vec4(uGround * sur, 1.0); return; }
  ivec2 cell = ivec2(floor(bv));
  if (cell.x >= 0 && cell.y >= 0 && cell.x < int(COLS) && cell.y < int(ROWS)) {
    vec2 l = fract(bv) - 0.5;
    float a = decodeAngle(texelFetch(uState, cell, 0).r);
    float ca = cos(a), sa = sin(a);
    bool yellow = ca < 0.0;
    float yaw = yellow ? a - PI : a;          // the visible face's normal, relative to facing the camera
    float lit = 0.62 + 0.38 * max(cos(yaw + 0.55), 0.0);
    float glint = pow(max(cos(yaw + 0.62), 0.0), 40.0);
    vec3 face = yellow ? uHi * (lit + uGlint * 1.6 * glint) : uDeep * (0.75 + 0.9 * lit) + cPalMid * 0.35 * glint;
    // recess ring the disc sits in
    float rr = length(l);
    vec3 cellc = mix(uGround * 0.5, col, smoothstep(0.47 - px, 0.47 + px, rr));
    // disc: an ellipse of half-width R|cos a|; its silver edge shows as a sliver on the turning side
    float hw = R * abs(ca) + 1e-3;
    float edge = R * (abs(ca) + 0.16 * abs(sa));
    float dEdge = length(vec2(l.x / edge, l.y / R)) - 1.0;
    float dFace = length(vec2(l.x / hw, l.y / R)) - 1.0;
    float aaE = px / max(edge, 0.02), aaF = px / max(hw, 0.02);
    cellc = mix(cellc, cPalMid * 0.55, 1.0 - smoothstep(-aaE, aaE, dEdge));
    cellc = mix(cellc, face, 1.0 - smoothstep(-aaF, aaF, dFace));
    // axle pins above and below the disc
    float pin = min(length(l - vec2(0.0, 0.465)), length(l + vec2(0.0, 0.465)));
    cellc = mix(cellc, cPalMid * 0.7, 1.0 - smoothstep(0.035 - px, 0.035 + px, pin));
    // far away (a disc under ~2 px): the average of the cell, no moire
    vec3 avg = mix(uGround * 0.5, face, PI * R * hw * 0.9);
    col = mix(cellc, avg, smoothstep(0.35, 0.7, px));
  }
  fragColor = vec4(col, 1.0);
}`;

type CamPose = { pos: THREE.Vector3; look: THREE.Vector3; focal: number };

export default class Flipdisc extends Scene {
  private P!: NamedPalette;
  private pass!: FSPass;
  private tex!: THREE.DataTexture;
  private data = new Uint8Array(COLS * ROWS * 4);
  private list: Shot[] = [];
  private plate!: PlateInfo;
  private lines: Line[] = [];
  private choice = new Int8Array(COLS * ROWS).fill(-1); // choice row index per disc, -1 = none
  private mask!: CanvasRenderingContext2D;
  private beats: number[] = [];
  private exitT = 0;

  override init() {
    this.plate = this.ctx.params as PlateInfo;
    this.P = palette(this.ctx.params.look.palette);
    this.list = shots(this.plate, this.ctx.audio);
    this.lines = ownedLines(this.ctx);
    const { start, end } = this.ctx;
    this.beats = this.ctx.audio.beats.filter((b) => b > start + 0.05 && b < end - 0.02);
    this.exitT = this.beats[this.beats.length - 1] ?? end - 0.15;
    // choice rows
    CHOICES.forEach(([time, arrow, verb, gate], r) => {
      const y0 = CH_TOP + r * CH_H;
      let x = 6;
      for (const ch of time) x = this.stamp(ch, x, y0, r) + 1;
      this.stamp(arrow, 30, y0, r);
      x = 42;
      for (const ch of verb) x = this.stamp(ch, x, y0, r) + 1;
      x = COLS - 14;
      for (const ch of gate) x = this.stamp(ch, x, y0, r) + 1;
    });
    const cv = document.createElement('canvas');
    cv.width = COLS * SS; cv.height = BAND * SS;
    this.mask = cv.getContext('2d', { willReadFrequently: true })!;
    this.tex = new THREE.DataTexture(this.data, COLS, ROWS, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.tex.magFilter = THREE.NearestFilter; this.tex.minFilter = THREE.NearestFilter;
    this.tex.flipY = false; this.tex.generateMipmaps = false;
    const v3 = (c: [number, number, number]) => new THREE.Vector3(...c);
    this.pass = new FSPass(FRAG, {
      uState: { value: this.tex }, uRes: { value: new THREE.Vector2(1920, 1080) },
      uPos: { value: new THREE.Vector3() }, uFwd: { value: new THREE.Vector3() }, uRight: { value: new THREE.Vector3() }, uUp: { value: new THREE.Vector3() },
      uFocal: { value: 3 }, uGlint: { value: 1 },
      uGround: { value: v3(plin(this.P, this.ctx.params.hosted && !this.night() ? 'hi' : 'ground')) }, uHosted: { value: this.ctx.params.hosted && !this.night() ? 1 : 0 }, uDeep: { value: v3(plin(this.P, 'deep').map((c) => c * (this.night() ? 0.45 : 1)) as [number, number, number]) },
      cPalMid: { value: v3(plin(this.P, 'mid')) }, uHi: { value: v3(plin(this.P, 'hi')) },
    });
  }

  /** Hosted on the ORBIT night limb (p24 `board`): a dark object — dark surround and disc faces, lit glyphs only, so the
   *  host's Earth shows through under 'screen'. `years` (p09, hosted on the light FILM stock) keeps the pale stock. */
  private night(): boolean {
    return !!this.ctx.params.hosted && this.plate.variant !== 'years';
  }

  /** Writes one dot-font glyph into the choice map; returns the column after it. */
  private stamp(ch: string, x0: number, y0: number, row: number): number {
    const g = GLYPH[ch];
    if (!g) return x0 + 2;
    g.forEach((line, dy) => Array.from(line).forEach((c, dx) => { if (c === '#') this.choice[(y0 + dy) * COLS + x0 + dx] = row; }));
    return x0 + g[0]!.length;
  }

  /** The lyric line into the band mask at time t (unsung syllables invisible). Coverage per disc + the layout. */
  private band(line: Line, t: number): { cov: Float32Array; lay: LineLayout | null; x0: number } {
    const c = this.mask, P = this.P;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, COLS * SS, BAND * SS);
    const maxW = (COLS - 2 * LX) * SS;
    const fit = layoutLine(c, line, F.slam(), BAND * SS * 0.98, maxW);
    const lay = drawLyric(c, line, t, {
      x: LX * SS, y: BAND * SS * 0.5 + fit.size * 0.37, size: BAND * SS * 0.98, maxWidth: maxW, align: 'left', family: F.slam(),
      unsungAlpha: 0, lead: 0,
      drawChar: (cc, ch) => { cc.fillStyle = pcss(P, 'hi'); cc.fillText(ch, 0, 0); },
    });
    const cov = new Float32Array(COLS * BAND);
    if (lay) {
      const img = c.getImageData(0, 0, COLS * SS, BAND * SS).data, rowPx = COLS * SS;
      for (let y = 0; y < BAND; y++) for (let x = 0; x < COLS; x++) {
        let s = 0;
        for (let j = 0; j < SS; j++) for (let i = 0; i < SS; i++) s += img[((y * SS + j) * rowPx + x * SS + i) * 4 + 3]!;
        cov[y * COLS + x] = s / (SS * SS * 255);
      }
    }
    return { cov, lay, x0: LX * SS };
  }

  /** Syllable start and glyph extent (discs) of the character covering column x, from the live layout. */
  private charAt(lay: LineLayout, x0: number, x: number): { t: number; a: number; b: number } | null {
    const px = (x + 0.5) * SS - x0;
    for (const b of lay.chars) {
      if (px < b.x - SS || px > b.x + b.w + SS) continue;
      const w = lay.line.words[b.word]!;
      const t = w.syl?.[b.syl]?.[0] ?? w.start;
      return { t, a: (x0 + b.x) / SS, b: (x0 + b.x + b.w) / SS };
    }
    return null;
  }

  /** Disc angle (0 black .. PI yellow) turning from state `from` toward `to`, started at t0 — with a slap overshoot. */
  private turn(from: number, to: number, t0: number, t: number): number {
    const k = (t - t0) / FLIP;
    if (k <= 0) return from;
    if (k >= 1.6) return to;
    const e = k < 1 ? k * k * (3 - 2 * k) : 1 + 0.14 * Math.sin((k - 1) * PI / 0.6) * (1.6 - k) / 0.6;
    return from + (to - from) * e;
  }

  private camera(cam: Cam, t: number, t0: number, t1: number, l22: LineLayout | null, x22: number): CamPose {
    const front = (cx: number, cy: number, pitch: number, focal = 3): CamPose => {
      const d = (focal * 540) / pitch;
      return { pos: new THREE.Vector3(cx, -cy, d), look: new THREE.Vector3(cx, -cy, 0), focal };
    };
    if (cam === 'wide') return front(COLS / 2, ROWS / 2 - 0.5, (this.night() ? 8.5 : 10) * (1 + 0.035 * (t - t0)));
    if (cam === 'close' && this.night()) {
      // night host: never a full-frame dot grid — the whole board stays an object in frame (the limb behind it); on
      // every beat it steps sideways along line 22 (a stepper motor) and holds there
      const n = this.beats.filter((b) => b <= t).length, tb = this.beats[n - 1] ?? t0;
      const STEP = [0, 9, -8, 10, -10, 7, -9, 8]; // cols: the board's edges stay in frame, no glyph cropped
      const xs = (k: number) => COLS / 2 + STEP[Math.max(0, k) % STEP.length]!;
      const x = xs(n - 1) + (xs(n) - xs(n - 1)) * smoothstep(0, 0.09, t - tb);
      return front(x, ROWS / 2 - 0.5, 9.6);
    }
    if (cam === 'close') {
      // steps along the line: on every beat the camera jumps to the latest sung character (a stepper motor)
      const target = (tb: number) => {
        let x = LX + 20;
        if (l22) for (const b of l22.chars) {
          const w = l22.line.words[b.word]!;
          if ((w.syl?.[b.syl]?.[0] ?? w.start) <= tb + 0.2) x = (x22 + b.x + b.w * 0.5) / SS;
        }
        return clamp(x, 46, COLS - 46);
      };
      const bs = [t0, ...this.beats.filter((b) => b > t0 && b < t1)];
      let i = 0;
      while (i + 1 < bs.length && bs[i + 1]! <= t) i++;
      const prev = i > 0 ? target(bs[i - 1]!) : target(t0);
      const x = prev + (target(bs[i]!) - prev) * smoothstep(0, 0.09, t - bs[i]!);
      return front(x, 24, 21);
    }
    if (cam === 'macro') {
      // the second word fills the frame
      let cx = COLS / 2;
      if (l22 && l22.words[1]) { const w = l22.words[1]!; cx = (x22 + w.x + w.w * 0.5) / SS; }
      return front(cx - 1.5 + 2.5 * clamp((t - t0) / Math.max(0.1, t1 - t0)), BAND_TOP + BAND / 2 + 0.5, 42);
    }
    // side: oblique from the near (left) end, looking down the length of the board; a slow dolly along it
    const k = t - t0;
    return { pos: new THREE.Vector3(-28 + 5 * k, -12, 52), look: new THREE.Vector3(74 + 4 * k, -30, 0), focal: 1.55 };
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, audio } = this.ctx;
    const t = f.t;
    const sh = shotAt(this.list, t);
    if (this.plate.variant === 'years') return this.years(f, out);
    // night host: the macro (one syllable filling the frame = a full-frame dot grid, not the object) stays on the close
    const night = this.night();
    const cam = (night && sh.shot.s.cam === 'macro' ? 'close' : sh.shot.s.cam) as Cam;
    const [L21, L22] = this.lines as [Line, Line];
    const tSwap = L22.start;
    const WIPE = 0.0013; // s per disc column: the line-change wave

    // lyric masks: line 21 until its wipe has crossed the board, line 22 from its first syllable
    const m21 = t < tSwap + COLS * WIPE + FLIP ? this.band(L21, Math.min(t, tSwap - 1e-3)) : null;
    const m22 = t >= tSwap ? this.band(L22, t) : null;

    const bp = beatPulse(audio, t, 0.1);
    // the beat twitch of every disc (a mechanical clack): yellow faces swing toward the light
    const twitch = 0.72 * bp;
    const D = this.data;
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
      const i = y * COLS + x;
      let a = 0;
      const cr = this.choice[i]!;
      if (cr >= 0) {
        // choice rows: bottom row first, one per beat; a left-to-right wave with a small per-disc stagger
        const k = CH_N - 1 - cr, tb = this.beats[k] ?? this.exitT;
        // night host: the rows flip ON instead (dark board, lit digits), one per beat, and hold — the beat mark
        a = night ? this.turn(0, PI, tb + x * 0.0016 + (y - CH_TOP - cr * CH_H) * 0.004, t) : this.turn(PI, 0, tb + x * 0.0016 + (y - CH_TOP - cr * CH_H) * 0.004, t);
      } else if (y >= BAND_TOP && y < BAND_TOP + BAND) {
        const by = y - BAND_TOP;
        const bi = by * COLS + x;
        // line 21: on per syllable, off in the line-change wave
        if (m21 && m21.cov[bi]! > 0.4 && m21.lay) {
          const ch = this.charAt(m21.lay, m21.x0, x);
          if (ch) {
            const on = ch.t + ((x - ch.a) / Math.max(1, ch.b - ch.a)) * 0.07 + by * 0.0025;
            a = this.turn(0, PI, on, t);
            a = this.turn(a, 0, tSwap + x * WIPE, t);
          }
        }
        if (m22 && m22.cov[bi]! > 0.4 && m22.lay) {
          const ch = this.charAt(m22.lay, m22.x0, x);
          if (ch) {
            let on = ch.t + ((x - ch.a) / Math.max(1, ch.b - ch.a)) * 0.07 + by * 0.0025;
            on = Math.max(on, tSwap + x * WIPE + FLIP * 0.8);
            a = Math.max(a, this.turn(0, PI, on, t));
          }
        }
        // exit: the band goes last, its wave reaching the end of the line just before the cut
        if (a > 0) a = this.turn(a, 0, this.exitT + 0.025 + x * 0.00034 + by * 0.001, t);
      }
      // twitch: yellow discs swing back toward the black face a little, black ones swing the other way
      a += a > PI / 2 ? -twitch : twitch * 0.5;
      D[i * 4] = Math.round(clamp((a + 0.6) / (PI + 1.2)) * 255);
      D[i * 4 + 3] = 255;
    }
    this.tex.needsUpdate = true;

    // camera
    const pose = this.camera(cam, t, sh.t0, sh.t1 === Infinity ? this.ctx.end : sh.t1, m22?.lay ?? null, LX * SS);
    const fwd = pose.look.clone().sub(pose.pos).normalize();
    const right = fwd.clone().cross(new THREE.Vector3(0, 1, 0)).normalize();
    const up = right.clone().cross(fwd).normalize();
    const u = this.pass.u;
    u.uPos!.value.copy(pose.pos); u.uFwd!.value.copy(fwd); u.uRight!.value.copy(right); u.uUp!.value.copy(up);
    u.uFocal!.value = pose.focal;
    u.uGlint!.value = cam === 'side' ? 1.3 : 1;

    clearRT(renderer, out, plin(this.P, 'ground'));
    this.pass.render(renderer, out);

    // hits: a punch on each downbeat (and on the shot cuts), a small vertical clack on each beat
    const db = downbeatPulse(audio, t, 0.16), kp = kickPulse(audio, t, 0.07);
    const cut = Math.exp(-Math.max(0, t - sh.t0) / 0.12);
    return {
      zoom: 1 + 0.045 * db + 0.02 * kp + 0.03 * cut,
      shake: [0, 5 * beatPulse(audio, t, 0.045)],
      flash: 0,
      bloom: 0,
      ca: 0.35, grain: 0.035, vignette: 0.4,
    };
  }

  // ---------------------------------------------------------------- variant `years` (p09, hosted on the FILM street)
  // The same board as a street ticker: the lyric band on top (each syllable's discs turn as it is sung), and under it
  // the year counter, overtaken once per beat (the changed discs turn in a left-to-right wave).
  private yearAt(k: number): number { return 2026 + Math.round(k * k * 2.5 + k * 6); }
  private yearCov(year: number): Float32Array {
    const c = this.mask;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, COLS * SS, BAND * SS);
    c.font = `${BAND * SS * 1.05}px ${F.slam()}`;
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillStyle = pcss(this.P, 'hi');
    c.fillText(String(year), (COLS * SS) / 2, BAND * SS * 0.54);
    const img = c.getImageData(0, 0, COLS * SS, BAND * SS).data, rowPx = COLS * SS;
    const cov = new Float32Array(COLS * BAND);
    for (let y = 0; y < BAND; y++) for (let x = 0; x < COLS; x++) {
      let s = 0;
      for (let j = 0; j < SS; j++) for (let i = 0; i < SS; i++) s += img[((y * SS + j) * rowPx + x * SS + i) * 4 + 3]!;
      cov[y * COLS + x] = s / (SS * SS * 255);
    }
    return cov;
  }

  private years(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, audio } = this.ctx;
    const t = f.t;
    const sh = shotAt(this.list, t), cam = sh.shot.s.cam as Cam;
    const line = this.lines[0]!;
    const bp = beatPulse(audio, t, 0.1), twitch = 0.72 * bp;
    const m = this.band(line, t);
    const bi = beatIndex(audio, t), b0 = beatIndex(audio, this.ctx.start + 1e-3);
    const k = Math.max(0, bi - b0), tb = audio.beats[bi] ?? this.ctx.start;
    const cur = this.yearCov(this.yearAt(k)), prev = k > 0 ? this.yearCov(this.yearAt(k - 1)) : cur;
    const YR = 38; // year band rows [38, 58)
    const D = this.data;
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
      const i = y * COLS + x;
      let a = 0;
      const by = y - BAND_TOP, yy = y - YR;
      if (by >= 0 && by < BAND && m.lay && m.cov[by * COLS + x]! > 0.4) {
        const ch = this.charAt(m.lay, m.x0, x);
        const on = ch ? ch.t + ((x - ch.a) / Math.max(1, ch.b - ch.a)) * 0.07 + by * 0.0025 : t;
        a = this.turn(0, PI, on, t);
      } else if (yy >= 0 && yy < BAND) {
        const was = prev[yy * COLS + x]! > 0.4 ? PI : 0, now = cur[yy * COLS + x]! > 0.4 ? PI : 0;
        a = was === now ? now : this.turn(was, now, tb + x * 0.0016 + yy * 0.003, t);
      }
      if (a > PI * 0.5) a -= twitch * 0.35;
      D[i * 4] = Math.round(clamp((a + 0.6) / (PI + 1.2)) * 255);
      D[i * 4 + 3] = 255;
    }
    this.tex.needsUpdate = true;
    const pose = this.camera(cam, t, sh.t0, sh.t1 === Infinity ? this.ctx.end : sh.t1, m.lay, LX * SS);
    const fwd = pose.look.clone().sub(pose.pos).normalize();
    const right = fwd.clone().cross(new THREE.Vector3(0, 1, 0)).normalize();
    const up = right.clone().cross(fwd).normalize();
    const u = this.pass.u;
    u.uPos!.value.copy(pose.pos); u.uFwd!.value.copy(fwd); u.uRight!.value.copy(right); u.uUp!.value.copy(up);
    u.uFocal!.value = pose.focal;
    u.uGlint!.value = 1;
    clearRT(renderer, out, plin(this.P, 'hi'));
    this.pass.render(renderer, out);
    const db = downbeatPulse(audio, t, 0.16);
    return { zoom: 1 + 0.045 * db, flash: 0, bloom: 0 };
  }

  override dispose() { this.tex?.dispose(); }
}
