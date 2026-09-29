// SODIUM — p32-sodium-sun (climax, 3.5 bars). Olafur Eliasson's The Weather Project (Tate Turbine Hall, 2003):
// a half-disc of mono-frequency lamps on the end wall, made whole by the mirror ceiling, in a hall filled with
// amber haze; visitors stand as black silhouettes, lie on the floor and find themselves in the ceiling.
// Mono-frequency light collapses every colour onto one ramp, so every pixel here sits on the sodium palette ramp
// mid (black) -> deep (umber) -> ground (amber haze) -> hi (lamp yellow); signal is only the syllable being cut.
// The line is etched into the disc (a cut with a lit lip) and its last words slip out through the rim into the
// haze; in the mirror-ceiling shots the crowd lying on the floor spells the word. No lines, no hall drawing:
// fog field, filled silhouettes, soft gradients.
// Beat: every kick swells the haze; every beat one silhouette raises an arm toward the sun (it stays raised,
// the crowd keeps reaching) and the lamp rim flares; the crowd letters stamp on the beat. Exit: the sun dims to
// an ember while the hall stays lit.
import type * as THREE from 'three';
import { Scene, type Frame, type PostOverrides } from '../engine/scene';
import { Layer2D, clearRT } from '../engine/gl';
import { palette, pcss, plin, pmix, type NamedPalette } from '../engine/palette';
import { drawLyric, layoutLine, ownedLines, F, type CharState } from '../engine/lyric';
import { beatPulse, kickPulse, downbeatPulse } from '../engine/beat';
import { stateAt, shotAt, type PlateInfo, type Shot } from '../engine/shots';
import { clamp, lerp, hash, ease } from '../engine/util';
import type { Line } from '../engine/lyrics';
import { shots, type Cam } from './sodium.shots';

const W = 1920, H = 1080;
const SAFE = 96;
/** The etched rows: word index ranges of the line (영혼을 갈망해, / 붙잡지 못한 / Deluded day). */
const ROWS: [number, number][] = [[0, 1], [2, 3], [4, 5]];

interface Person {
  x: number; // floor x (px in the wide frame)
  z: number; // 0 far .. 1 near
  h: number; // standing height (px)
  lying: boolean;
  raiseAt: number; // song time the arm goes up (Infinity: never)
  side: -1 | 1; // which arm reaches
  up0: number; // already reaching at the start (0..1)
  sway: number;
}

interface Dot { x: number; y: number; s: number; a: number; lying: boolean; beat: number }

export default class Sodium extends Scene {
  private layer!: Layer2D;
  private list: Shot[] = [];
  private plate!: PlateInfo;
  private P!: NamedPalette;
  private line: Line | null = null;
  private beats: number[] = [];
  private crowd: Person[] = [];
  private giants: Person[] = [];
  private dots: Dot[] = [];
  private tile: HTMLCanvasElement | null = null;
  private fam = '';

  override init() {
    this.plate = this.ctx.params as PlateInfo;
    this.P = palette(this.ctx.params.look?.palette ?? 'sodium');
    this.list = shots(this.plate, this.ctx.audio);
    this.line = ownedLines(this.ctx)[0] ?? null;
    this.layer = new Layer2D();
    this.fam = F.slam();
    const { start, end } = this.ctx;
    this.beats = this.ctx.audio.beats.filter((b) => b >= start - 0.3 && b < end - 0.02);
    const nb = this.beats.length;

    // the hall crowd (wide shot): far -> near; one near figure is assigned to each beat and raises an arm on it
    const N = 120;
    const crowd: Person[] = [];
    for (let i = 0; i < N; i++) {
      const z = Math.pow(hash(i, 1), 1.6);
      crowd.push({
        x: -80 + hash(i, 2) * (W + 160),
        z,
        h: lerp(30, 330, z * z),
        lying: hash(i, 3) < 0.2,
        raiseAt: Infinity,
        side: hash(i, 4) < 0.5 ? -1 : 1,
        up0: hash(i, 5) < 0.12 ? 1 : 0,
        sway: hash(i, 6) * Math.PI * 2,
      });
    }
    // near standing figures that are not already reaching, spread across x, take the beats in turn
    const near = crowd
      .map((p, i) => ({ p, i }))
      .filter(({ p }) => !p.lying && p.up0 === 0 && p.z > 0.32 && p.x > 120 && p.x < W - 120)
      .sort((a, b) => a.p.x - b.p.x);
    for (let k = 0; k < nb && near.length; k++) near[(k * 7 + 3) % near.length]!.p.raiseAt = this.beats[k]!;
    this.crowd = crowd.sort((a, b) => a.z - b.z);

    // the low shot: four giants in the foreground (feet off frame), reaching for the disc on successive beats
    const gx = [170, 560, 1610, 1880];
    const gb = [1, 2, 3, 4];
    this.giants = gx.map((x, j) => ({
      x, z: 1, h: [980, 900, 940, 1040][j]!, lying: false,
      raiseAt: this.beats[gb[j]!] ?? Infinity, side: x < 1187 ? 1 : -1, up0: 0, sway: j * 1.3,
    }));

    // the mirror-ceiling crowd seen from above: scattered people, a subset waves on each beat
    const dots: Dot[] = [];
    for (let i = 0; i < 260; i++) {
      dots.push({ x: hash(i, 11) * (W + 200) - 100, y: hash(i, 12) * (H + 200) - 100, s: lerp(34, 62, hash(i, 13)), a: hash(i, 14) * Math.PI * 2, lying: hash(i, 15) < 0.55, beat: Math.floor(hash(i, 16) * 4) });
    }
    this.dots = dots;

    // the crowd texture for the lettering: people lying on the floor, seen in the mirror from above
    const tile = document.createElement('canvas');
    tile.width = 120; tile.height = 120;
    const g = tile.getContext('2d');
    if (g) {
      const spots: [number, number, number][] = [[28, 24, 0.4], [88, 20, 2.1], [60, 62, -0.9], [22, 96, 1.6], [96, 92, 0.2], [2, 58, -2.4], [118, 58, -2.4]];
      for (const [x, y, a] of spots) this.fromAbove(g, x, y, 40, a, 0.8, pcss(this.P, 'mid'), true);
    }
    this.tile = tile;
  }

  // ------------------------------------------------------------------ colour ramp
  /** The mono-frequency ramp: 0 = mid (black), 1 = deep, 2 = ground (haze), 3 = hi (lamp). */
  private ramp(v: number, a = 1): string {
    const P = this.P;
    const x = clamp(v, 0, 3);
    if (x < 1) return pmix(P, 'mid', 'deep', x, a);
    if (x < 2) return pmix(P, 'deep', 'ground', x - 1, a);
    return pmix(P, 'ground', 'hi', x - 2, a);
  }

  // ------------------------------------------------------------------ figures
  /** A standing silhouette, feet at (x, fy). reach 0..1 raises the `side` arm toward angle `ang` (rad). */
  private person(c: CanvasRenderingContext2D, x: number, fy: number, h: number, col: string, side: number, reach: number, ang: number, both = 0) {
    const sh = fy - 0.8 * h, hip = fy - 0.47 * h;
    c.fillStyle = col;
    c.strokeStyle = col;
    c.lineCap = 'round';
    c.lineJoin = 'round';
    // legs
    c.lineWidth = 0.085 * h;
    c.beginPath();
    c.moveTo(x - 0.045 * h, hip); c.lineTo(x - 0.06 * h, fy - 0.03 * h);
    c.moveTo(x + 0.045 * h, hip); c.lineTo(x + 0.065 * h, fy - 0.03 * h);
    c.stroke();
    // torso (coat) and shoulders
    c.beginPath();
    c.moveTo(x - 0.12 * h, sh + 0.025 * h);
    c.quadraticCurveTo(x, sh - 0.03 * h, x + 0.12 * h, sh + 0.025 * h);
    c.lineTo(x + 0.1 * h, hip + 0.04 * h);
    c.lineTo(x - 0.1 * h, hip + 0.04 * h);
    c.closePath();
    c.fill();
    // neck + head
    c.fillRect(x - 0.025 * h, sh - 0.06 * h, 0.05 * h, 0.07 * h);
    c.beginPath(); c.arc(x, sh - 0.105 * h, 0.066 * h, 0, Math.PI * 2); c.fill();
    // arms: down along the body, or raised toward `ang`
    c.lineWidth = 0.058 * h;
    const len = 0.39 * h;
    for (const s of [-1, 1]) {
      const down = Math.PI / 2 - s * 0.16;
      const r = s === side ? reach : both;
      const up = s === side ? ang : -Math.PI / 2 + s * 0.3;
      const a = lerp(down, up, r);
      const L = len * (1 + 0.12 * r);
      const ax = x + s * 0.105 * h, ay = sh + 0.035 * h;
      c.beginPath(); c.moveTo(ax, ay); c.lineTo(ax + Math.cos(a) * L, ay + Math.sin(a) * L); c.stroke();
    }
  }

  /** A person lying on the floor seen from the side at a distance: a low, long mass. */
  private lyingSide(c: CanvasRenderingContext2D, x: number, fy: number, h: number, col: string) {
    c.fillStyle = col;
    c.beginPath(); c.ellipse(x, fy - 0.05 * h, 0.42 * h, 0.06 * h, 0, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.arc(x - 0.44 * h, fy - 0.07 * h, 0.065 * h, 0, Math.PI * 2); c.fill();
    // knees up
    c.beginPath(); c.moveTo(x + 0.1 * h, fy - 0.06 * h); c.lineTo(x + 0.24 * h, fy - 0.2 * h); c.lineTo(x + 0.38 * h, fy - 0.05 * h); c.closePath(); c.fill();
  }

  /** A person seen from directly above (the mirror ceiling): lying spread out, or standing (head + shoulders). */
  private fromAbove(c: CanvasRenderingContext2D, x: number, y: number, s: number, a: number, arms: number, col: string, lying: boolean) {
    c.save();
    c.translate(x, y);
    c.rotate(a);
    c.fillStyle = col;
    c.strokeStyle = col;
    c.lineCap = 'round';
    if (lying) {
      // body along +x, head at -x; arms spread from 'at the side' to 'over the head' by `arms`
      c.beginPath(); c.ellipse(0, 0, 0.3 * s, 0.11 * s, 0, 0, Math.PI * 2); c.fill();
      c.beginPath(); c.arc(-0.4 * s, 0, 0.11 * s, 0, Math.PI * 2); c.fill();
      c.lineWidth = 0.085 * s;
      c.beginPath();
      c.moveTo(0.22 * s, -0.05 * s); c.lineTo(0.6 * s, -0.12 * s);
      c.moveTo(0.22 * s, 0.05 * s); c.lineTo(0.6 * s, 0.12 * s);
      for (const sd of [-1, 1]) {
        const ang = lerp(0.35, Math.PI - 0.35, arms) * sd;
        c.moveTo(-0.22 * s, sd * 0.09 * s);
        c.lineTo(-0.22 * s + Math.cos(ang) * 0.36 * s, sd * 0.09 * s + Math.sin(ang) * 0.36 * s);
      }
      c.stroke();
    } else {
      c.beginPath(); c.ellipse(0, 0, 0.13 * s, 0.26 * s, 0, 0, Math.PI * 2); c.fill();
      c.beginPath(); c.arc(0, 0, 0.1 * s, 0, Math.PI * 2); c.fill();
      if (arms > 0.05) {
        c.lineWidth = 0.08 * s;
        c.beginPath(); c.moveTo(0, -0.2 * s); c.lineTo(0.42 * s * arms, -0.34 * s); c.stroke();
      }
    }
    c.restore();
  }

  // ------------------------------------------------------------------ light
  /** Haze: soft light around the sun plus slow drifting fog masses (no edges, no lines). */
  private haze(c: CanvasRenderingContext2D, sx: number, sy: number, R: number, t: number, kp: number, k = 1) {
    const g = c.createRadialGradient(sx, sy, R * 0.8, sx, sy, R * 4.2 + 260 * kp);
    g.addColorStop(0, this.ramp(3, (0.55 + 0.35 * kp) * k));
    g.addColorStop(0.35, this.ramp(2.45, (0.35 + 0.3 * kp) * k));
    g.addColorStop(1, this.ramp(2, 0));
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);
    for (let i = 0; i < 6; i++) {
      const x = 960 + 820 * Math.sin(t * 0.21 + i * 1.7), y = 540 + 360 * Math.cos(t * 0.17 + i * 2.3);
      const r = 420 + 160 * Math.sin(i * 3.1 + t * 0.3);
      const fg = c.createRadialGradient(x, y, 0, x, y, r);
      const lit = i % 2 === 0;
      fg.addColorStop(0, this.ramp(lit ? 2.7 : 1.7, (lit ? 0.12 + 0.12 * kp : 0.08) * k));
      fg.addColorStop(1, this.ramp(2, 0));
      c.fillStyle = fg;
      c.fillRect(x - r, y - r, 2 * r, 2 * r);
    }
  }

  /** A lamp-light shock in the haze on the beat: a bright soft ring leaving the rim. */
  private halo(c: CanvasRenderingContext2D, sx: number, sy: number, R: number, bp: number) {
    if (bp < 0.02) return;
    const r1 = R * (1.05 + 0.9 * (1 - bp)), w = R * 0.35;
    const g = c.createRadialGradient(sx, sy, Math.max(0, r1 - w), sx, sy, r1 + w);
    g.addColorStop(0, this.ramp(3, 0));
    g.addColorStop(0.5, this.ramp(3, 0.75 * bp));
    g.addColorStop(1, this.ramp(3, 0));
    c.fillStyle = g;
    c.beginPath(); c.arc(sx, sy, r1 + w, 0, Math.PI * 2); c.fill();
  }

  /** The sun: lower half on the wall, upper half its reflection in the mirror ceiling (one faint tonal break). */
  private sun(c: CanvasRenderingContext2D, sx: number, sy: number, R0: number, bp: number, dim: number) {
    const R = R0 * (1 + 0.028 * bp);
    // glow skirt: a lamp rim that flares on every beat
    const sk = c.createRadialGradient(sx, sy, R * 0.96, sx, sy, R * (1.5 + 0.25 * bp));
    sk.addColorStop(0, this.ramp(lerp(3, 2.2, dim), 0.85 + 0.15 * bp));
    sk.addColorStop(1, this.ramp(2.3, 0));
    c.fillStyle = sk;
    c.beginPath(); c.arc(sx, sy, R * (1.5 + 0.25 * bp), 0, Math.PI * 2); c.fill();
    // the disc: concentric lamp bands (radial only), the rim hotter on the beat
    const lamp = lerp(3, 1.35, dim);
    for (const half of [1, -1]) {
      const d = c.createRadialGradient(sx, sy, 0, sx, sy, R);
      const off = half < 0 ? 0.12 : 0; // the mirror half reads a touch dimmer
      // lamp rings: dips at rest, driven to full lamp on the beat
      const ring = 0.4 * (1 - bp);
      d.addColorStop(0, this.ramp(lamp - off, 1));
      d.addColorStop(0.5, this.ramp(lamp - off - 0.05, 1));
      d.addColorStop(0.6, this.ramp(lamp - off - ring, 1));
      d.addColorStop(0.7, this.ramp(lamp - off - 0.05, 1));
      d.addColorStop(0.86, this.ramp(lamp - off - 0.05, 1));
      d.addColorStop(0.93, this.ramp(lamp - off - ring * 1.3, 1));
      d.addColorStop(1, this.ramp(lamp - off - 0.1, 1));
      c.fillStyle = d;
      c.beginPath();
      if (half > 0) c.arc(sx, sy, R, 0, Math.PI);
      else c.arc(sx, sy, R, Math.PI, Math.PI * 2);
      c.closePath();
      c.fill();
    }
    // the ember: as the sun dies it goes signal-orange from the centre
    if (dim > 0.01) {
      const e = c.createRadialGradient(sx, sy, 0, sx, sy, R);
      e.addColorStop(0, pcss(this.P, 'signal', 0.9 * dim));
      e.addColorStop(1, pcss(this.P, 'signal', 0.35 * dim));
      c.fillStyle = e;
      c.beginPath(); c.arc(sx, sy, R, 0, Math.PI * 2); c.fill();
    }
  }

  // ------------------------------------------------------------------ the line
  /**
   * Etch rows of the line into the disc (sx, sy, R). `rows` picks which rows; `slip(row)` shifts a row (the last
   * words sliding out through the rim). Characters outside the disc become silhouettes in the haze.
   */
  private etch(c: CanvasRenderingContext2D, t: number, sx: number, sy: number, R: number, o: {
    rows: number[]; size: number; cx: number; lead: number; slip?: (row: number) => { dx: number; dy: number };
    rowY?: (row: number) => number; outside?: 'mid' | 'deep'; alpha?: number; beat?: number; minX?: number;
  }) {
    const line = this.line;
    if (!line) return;
    const lay = layoutLine(c, line, this.fam, o.size);
    for (const r of o.rows) {
      const [a, b] = ROWS[r]!;
      const wa = lay.words[a], wb = lay.words[b];
      if (!wa || !wb) continue;
      const rx0 = wa.x, rw = wb.x + wb.w - rx0;
      const shift = -(-lay.width / 2 + rx0 + rw / 2);
      const s = o.slip ? { ...o.slip(r) } : { dx: 0, dy: 0 };
      if (o.minX !== undefined) s.dx = Math.max(s.dx, o.minX - (o.cx - rw / 2));
      const baseY = o.rowY ? o.rowY(r) : sy + (r - 1) * o.size * 1.22;
      const y = baseY + o.size * 0.36;
      const out = new Map<number, number>();
      drawLyric(c, line, t, {
        x: o.cx, y, size: o.size, family: this.fam, align: 'center', lead: o.lead,
        unsungAlpha: 0.16, alpha: o.alpha ?? 1,
        charTransform: (_ch, idx, cs: CharState) => {
          if (cs.word < a || cs.word > b) return { alpha: 0 };
          // where this glyph lands on screen: outside the rim it is a silhouette in the haze
          const gx = o.cx - lay.width / 2 + cs.box.x + cs.box.w / 2 + shift + s.dx;
          const gy = y - o.size * 0.35 + s.dy;
          const d = Math.hypot(gx - sx, gy - sy);
          out.set(idx, clamp((d - R + o.size * 0.25) / (o.size * 0.5)));
          return { dx: shift + s.dx, dy: s.dy + (cs.sung ? 0 : 3), scale: cs.sung ? 1 + 0.18 * (1 - cs.frac) ** 3 : 1 };
        },
        drawChar: (g, ch, cs) => {
          const k = out.get(cs.box.index) ?? 0;
          if (k < 0.99) {
            // the cut: a lit lip on the lower right, then the groove (the syllable being cut burns signal)
            const bt = o.beat ?? 0;
            if (cs.sung) { g.fillStyle = this.ramp(3, 0.9 * (1 - k)); const lip = o.size * (0.03 + 0.05 * bt); g.fillText(ch, lip, lip); }
            if (cs.sung && bt > 0.05) { g.fillStyle = this.ramp(1.6, 0.8 * bt * (1 - k)); g.fillText(ch, -o.size * 0.04 * bt, -o.size * 0.04 * bt); }
            g.fillStyle = cs.sung && cs.frac < 1 ? pcss(this.P, 'signal', 1 - k) : this.ramp(0.95, 1 - k);
            g.fillText(ch, 0, 0);
          }
          if (k > 0.01) {
            g.fillStyle = this.ramp(o.outside === 'deep' ? 1 : 0.15, k);
            g.fillText(ch, 0, 0);
          }
        },
      });
    }
  }

  /** The words spelled by the crowd lying on the floor, seen in the mirror ceiling. */
  private crowdWords(c: CanvasRenderingContext2D, t: number, words: number[], x: number, y: number, size: number, bp: number, maxWidth?: number) {
    const line = this.line;
    if (!line) return;
    const lay = layoutLine(c, line, this.fam, size, maxWidth);
    const a = Math.min(...words), b = Math.max(...words);
    const wa = lay.words[a], wb = lay.words[b];
    if (!wa || !wb) return;
    const shift = -(-lay.width / 2 + wa.x + (wb.x + wb.w - wa.x) / 2);
    const pat = this.tile ? c.createPattern(this.tile, 'repeat') : null;
    drawLyric(c, line, t, {
      x, y: y + lay.size * 0.36, size, maxWidth, family: this.fam, align: 'center', lead: 3,
      unsungAlpha: 0.22,
      charTransform: (_ch, _i, cs) => {
        if (!words.includes(cs.word)) return { alpha: 0 };
        // people not yet in place drift; sung letters lock in and stamp on the beat
        const j = cs.box.index;
        const drift = cs.sung ? 0 : 1;
        return {
          dx: shift + drift * 26 * Math.sin(t * 1.3 + j),
          dy: drift * 18 * Math.cos(t * 1.1 + j * 2.1),
          rot: drift * 0.08 * Math.sin(j * 3.7),
          scale: cs.sung ? 1 + 0.12 * bp + 0.2 * (1 - cs.frac) ** 3 : 0.94,
        };
      },
      drawChar: (g, ch, cs) => {
        // density first (the shadow the bodies make), then the bodies themselves
        g.fillStyle = this.ramp(cs.sung ? 1.0 - 0.6 * bp : 1.4, cs.sung ? 0.45 + 0.35 * bp : 0.5);
        g.fillText(ch, 0, 0);
        if (pat) { g.fillStyle = pat; g.fillText(ch, 0, 0); }
        if (cs.sung && cs.frac < 1) { g.fillStyle = pcss(this.P, 'signal', 0.35 * (1 - cs.frac)); g.fillText(ch, 0, 0); }
      },
    });
  }

  // ------------------------------------------------------------------ shots
  private raise(p: Person, t: number) {
    return Math.max(p.up0, p.raiseAt <= t ? ease.outBack(clamp((t - p.raiseAt) / 0.16)) : 0);
  }

  /** The hall, wide: end wall with the sun, mirror ceiling above the seam, floor with the crowd. */
  private wide(c: CanvasRenderingContext2D, t: number, lt: number, kp: number, bp: number) {
    const sx = 1187, sy = 413, R = 270, floorY = 705;
    c.save();
    // a slow push toward the sun
    const push = 1 + 0.025 * lt;
    c.translate(sx, sy); c.scale(push, push); c.translate(-sx, -sy);
    // mirror ceiling: slightly darker, darker toward the top
    const cg = c.createLinearGradient(0, -80, 0, sy);
    cg.addColorStop(0, this.ramp(1.8));
    cg.addColorStop(1, this.ramp(2.2));
    c.fillStyle = cg;
    c.fillRect(-200, -200, W + 400, sy + 200);
    // floor: darker toward the camera
    const fg = c.createLinearGradient(0, floorY, 0, H + 80);
    fg.addColorStop(0, this.ramp(2.15));
    fg.addColorStop(1, this.ramp(1.7));
    c.fillStyle = fg;
    c.fillRect(-200, floorY, W + 400, H - floorY + 300);
    // side walls: dim masses converging on the end wall
    for (const s of [-1, 1]) {
      const x0 = s < 0 ? -200 : W + 200, x1 = s < 0 ? 300 : 1790;
      const wg = c.createLinearGradient(x0, 0, x1, 0);
      wg.addColorStop(0, this.ramp(1.5, 0.7));
      wg.addColorStop(1, this.ramp(1.9, 0));
      c.fillStyle = wg;
      c.beginPath(); c.moveTo(x0, -200); c.lineTo(x1, 250); c.lineTo(x1, floorY + 20); c.lineTo(x0, H + 200); c.closePath(); c.fill();
    }
    this.haze(c, sx, sy, R, t, kp);
    this.halo(c, sx, sy, R, bp);
    this.sun(c, sx, sy, R, bp, 0);
    // the sun's pool on the floor
    const pool = c.createRadialGradient(sx, floorY + 40, 0, sx, floorY + 40, 520);
    pool.addColorStop(0, this.ramp(2.8, 0.35 + 0.2 * kp));
    pool.addColorStop(1, this.ramp(2, 0));
    c.fillStyle = pool;
    c.fillRect(sx - 520, floorY - 40, 1040, 400);
    this.etch(c, t, sx, sy, R, { rows: [0, 1, 2], size: 52, cx: sx, lead: 0.4, beat: bp });
    // the crowd and its reflection in the ceiling (upside down, far figures near the seam)
    for (const p of this.crowd) {
      const fy = lerp(floorY + 6, H + 160, Math.pow(p.z, 1.25));
      const col = this.ramp(lerp(1.55, 0.05, Math.pow(p.z, 0.6)));
      const reach = this.raise(p, t);
      const ang = Math.atan2(sy - (fy - 0.8 * p.h), sx - p.x);
      const sw = Math.sin(t * 0.8 + p.sway) * 3 * p.z;
      // reflection
      const ry = 2 * sy - fy;
      if (ry > -60 && p.z < 0.55) {
        c.save();
        c.translate(0, 2 * sy); c.scale(1, -1);
        c.globalAlpha = 0.45;
        if (p.lying) this.lyingSide(c, p.x + sw, fy, p.h, this.ramp(1.2));
        else this.person(c, p.x + sw, fy, p.h, this.ramp(1.2), p.side, reach, clamp(ang, -Math.PI * 0.95, -Math.PI * 0.05));
        c.restore();
      }
      if (p.lying) this.lyingSide(c, p.x, fy, p.h, col);
      else this.person(c, p.x + sw, fy, p.h, col, p.side, reach * (1 + 0.1 * bp), clamp(ang, -Math.PI * 0.95, -Math.PI * 0.05));
    }
    c.restore();
  }

  /** Low from the floor: giants in the foreground reaching up, the disc high between them. */
  private low(c: CanvasRenderingContext2D, t: number, lt: number, kp: number, bp: number) {
    const sx = 1150, sy = 360 - 14 * lt, R = 360, floorY = 975;
    c.save();
    const cg = c.createLinearGradient(0, 0, 0, sy);
    cg.addColorStop(0, this.ramp(1.85));
    cg.addColorStop(1, this.ramp(2.2));
    c.fillStyle = cg;
    c.fillRect(0, 0, W, sy);
    this.haze(c, sx, sy, R, t, kp);
    this.sun(c, sx, sy, R, bp, 0);
    this.etch(c, t, sx, sy, R, { rows: [0, 1], size: 66, cx: sx, lead: 0.4, beat: bp });
    // the floor, a sliver
    const fg = c.createLinearGradient(0, floorY, 0, H);
    fg.addColorStop(0, this.ramp(1.9));
    fg.addColorStop(1, this.ramp(1.3));
    c.fillStyle = fg;
    c.fillRect(0, floorY, W, H - floorY);
    // mid-ground figures on the floor line, small and hazed
    for (let i = 0; i < 26; i++) {
      const x = 60 + i * 72 + 30 * Math.sin(i * 2.7);
      const h = lerp(110, 230, hash(i, 21));
      const reach = hash(i, 22) < 0.45 ? 1 : 0;
      const ang = Math.atan2(sy - (floorY - 0.8 * h), sx - x);
      this.person(c, x, floorY + 10, h, this.ramp(lerp(1.2, 0.7, hash(i, 23))), x < sx ? 1 : -1, reach, ang);
    }
    // the giants
    for (const p of this.giants) {
      const fy = 1360 + 10 * Math.sin(t * 0.7 + p.sway);
      const reach = this.raise(p, t);
      const shY = fy - 0.8 * p.h;
      const ang = Math.atan2(sy - shY, sx - p.x);
      this.person(c, p.x, fy, p.h, this.ramp(0.02), p.side, reach * (1 + 0.14 * bp), ang, 0);
    }
    c.restore();
  }

  /** Close on the disc: the etched rows large; 'Deluded day' slides out through the rim into the haze. */
  private close(c: CanvasRenderingContext2D, t: number, lt: number, kp: number, bp: number) {
    const sx = 1330 - 30 * lt, sy = 470, R = 900;
    this.haze(c, sx, sy, R * 0.4, t, kp, 0.8);
    this.sun(c, sx, sy, R, bp, 0);
    const t0 = this.line?.words[4]?.start ?? 159;
    const slide = ease.outCubic(clamp((t - t0 + 0.15) / 1.2));
    this.etch(c, t, sx, sy, R, {
      rows: [0, 1, 2], size: 132, cx: 1150, lead: 3, beat: bp, minX: SAFE,
      rowY: (r) => sy + (r - 1) * 132 * 1.3 - 30,
      slip: (r) => (r === 2 ? { dx: -700 * slide, dy: 40 * slide } : { dx: 0, dy: 0 }),
    });
  }

  /** Straight up at the mirror ceiling: the reflected crowd, the word lying on the floor. */
  private up(c: CanvasRenderingContext2D, t: number, lt: number, kp: number, bp: number, tight: boolean) {
    c.save();
    // the ceiling reflects the hall: amber, darker away from the reflected sun
    const rx = tight ? 2300 : 1780, ry = tight ? -300 : -40;
    const bg = c.createRadialGradient(rx, ry, 0, rx, ry, 2200);
    bg.addColorStop(0, this.ramp(2.7));
    bg.addColorStop(0.35, this.ramp(2.25));
    bg.addColorStop(1, this.ramp(1.95));
    c.fillStyle = bg;
    c.fillRect(0, 0, W, H);
    // the reflected sun half at the frame's edge (only in the open framing)
    if (!tight) {
      this.haze(c, rx, ry, 300, t, kp, 0.9);
      this.sun(c, rx, ry, 300, bp, 0);
    } else {
      this.haze(c, rx, ry, 300, t, kp, 0.6);
    }
    // view: the tight framing turns and leans in
    const cx = 960, cy = 540;
    const rot = tight ? -0.1 - 0.012 * lt : 0.02 * lt, sc = tight ? 1.55 + 0.03 * lt : 1 + 0.03 * lt;
    c.translate(cx, cy); c.rotate(rot); c.scale(sc, sc); c.translate(-cx, -cy);
    // scattered people seen from above (a quarter of them wave on each beat)
    const bi = this.beats.findIndex((b, i) => b <= t && (this.beats[i + 1] ?? Infinity) > t);
    for (let i = 0; i < this.dots.length; i++) {
      const d = this.dots[i]!;
      const wave = bi >= 0 && d.beat === bi % 4 ? bp : 0;
      this.fromAbove(c, d.x, d.y, d.s, d.a, clamp(0.3 * (d.lying ? 1 : 0) + wave), this.ramp(lerp(0.3, 1.1, hash(i, 17)), 0.75), d.lying);
    }
    c.restore();
    // the word (screen-space so it stays inside title-safe)
    c.save();
    if (tight) {
      c.translate(cx, cy); c.rotate(-0.1); c.translate(-cx, -cy);
      this.crowdWords(c, t, [4], 960, 420, 250, bp, W - 2 * SAFE - 260);
      this.crowdWords(c, t, [5], 1080, 740, 250, bp);
    } else {
      this.crowdWords(c, t, [4, 5], 960, 560, 210, bp, W - 2 * SAFE - 120);
    }
    c.restore();
  }

  /** The sun alone in the haze; 'Deluded day' has slipped out below the rim; the sun dims to an ember. */
  private flat(c: CanvasRenderingContext2D, t: number, lt: number, kp: number, bp: number) {
    const sx = 1187, sy = 413, R = 300;
    const tEnd = this.ctx.end;
    const dim = ease.inOutCubic(clamp((t - (tEnd - 0.4)) / 0.4)) * 0.85;
    const vg = c.createLinearGradient(0, 0, 0, H);
    vg.addColorStop(0, this.ramp(2.05));
    vg.addColorStop(0.5, this.ramp(2.3));
    vg.addColorStop(1, this.ramp(2.0));
    c.fillStyle = vg;
    c.fillRect(0, 0, W, H);
    this.haze(c, sx, sy, R * (1 - 0.2 * dim), t, kp, 1 - 0.25 * dim);
    this.halo(c, sx, sy, R, bp * (1 - dim));
    this.sun(c, sx, sy, R, bp * (1 - dim), dim);
    this.etch(c, t, sx, sy, R, { rows: [0, 1], size: 60, cx: sx, lead: 3, rowY: (r) => sy + (r - 0.5) * 60 * 1.3 - 20, alpha: 1 - 0.7 * dim, beat: bp });
    // the slipped words, drifting away in the haze below-left of the rim
    this.etch(c, t, sx, sy, R, {
      rows: [2], size: 104, cx: sx, lead: 3, outside: 'mid',
      rowY: () => 820 + 10 * lt,
      slip: () => ({ dx: -250 - 40 * lt, dy: 0 }),
    });
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, audio } = this.ctx;
    const t = f.t;
    const st = stateAt(this.list, t);
    const sh = shotAt(this.list, t);
    const cam = st.cam as Cam;
    const lt = t - sh.t0;
    const L = this.layer, c = L.ctx;
    L.clear(pcss(this.P, 'ground'));
    const bp = beatPulse(audio, t, 0.14), kp = kickPulse(audio, t, 0.16), dp = downbeatPulse(audio, t, 0.25);

    if (cam === 'wide') this.wide(c, t, lt, kp, bp);
    else if (cam === 'low') this.low(c, t, lt, kp, bp);
    else if (cam === 'close') this.close(c, t, lt, kp, bp);
    else if (cam === 'up' || cam === 'uptight') this.up(c, t, lt, kp, bp, cam === 'uptight');
    else this.flat(c, t, lt, kp, bp);

    L.upload();
    clearRT(renderer, out, plin(this.P, 'ground'));
    this.ctx.comp.draw(renderer, L.texture, out, { mode: 'normal' });

    // hits: an exposure punch and a push-in on every cut, the haze swelling on the kick, a jolt on the downbeat
    const cut = sh.index > 0 ? Math.exp(-lt / 0.1) : 0;
    const sd = hash(Math.floor(f.bar), 9) * Math.PI * 2;
    const jolt = cam === 'low' || cam === 'uptight' ? 7 : 3;
    return {
      exposure: 1 + 0.1 * kp + 0.05 * bp + 0.18 * cut,
      flash: 0.05 * cut,
      zoom: 1 + 0.06 * cut + 0.018 * bp,
      shake: [Math.cos(sd) * jolt * dp, Math.sin(sd) * jolt * dp],
      bloom: cam === 'close' ? 0.18 : 0.32,
      bloomThreshold: 0.72,
      ca: 0,
      grain: 0.05,
      vignette: cam === 'up' || cam === 'uptight' ? 0.4 : cam === 'flat' ? 0.2 : 0.32,
    };
  }

  override dispose() { this.layer?.texture.dispose(); }
}
