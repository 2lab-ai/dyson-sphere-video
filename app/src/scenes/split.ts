// SPLIT — two sheets of paper glued edge to edge along one seam: above, a printed virtual grid (bone, crisp
// graphite rules, registration crosses); below, real fibrous paper (paper2, mottled pulp). Lines 14–15 are printed
// ACROSS the seam, so every glyph is cut in two — its top half crisp on the grid, its bottom half soaked into the
// pulp. On every beat the seam opens one step (a hard snap with a spring overshoot) and the fibres bridging it
// pull taut and thin, but it HOLDS: nothing tears here (the collapse is p-engrave's first shot). Sung letters of
// line 15 pop out of the print (leaving a blind-embossed ghost) and wedge into the gap in signal orange.
// Shots (./split.shots, storyboard times): frontal -> raking light along the seam (foreshortened, long fibre
// shadows) -> the seam gapes, letters jammed -> top-down macro on the last connecting fibres (diagonal seam).
// Variant: 'torn' is the only one in the cut list; any other variant falls back to the same composition.
import type * as THREE from 'three';
import { Scene, type Frame, type PostOverrides } from '../engine/scene';
import { Layer2D, clearRT } from '../engine/gl';
import { LIN, rgba } from '../engine/palette';
import { drawLyric, layoutLine, ownedLines, F, type CharState, type LineLayout } from '../engine/lyric';
import { beatPulse, kickPulse, downbeatPulse, beatIndex } from '../engine/beat';
import { stateAt, shotAt, type PlateInfo, type Shot } from '../engine/shots';
import { hash, clamp, lerp, fbm1, mulberry32, ease } from '../engine/util';
import type { Line } from '../engine/lyrics';
import { shots, type Framing } from './split.shots';

const W = 1920, H = 1080;
// world: origin at the seam centre; the paper spans [-WX, WX] x [-WY, WY]
const WX = 1600, WY = 1000, EDGE_STEP = 5;
const G0 = 16, STEP = 13; // seam gap at the plate start, and the step it opens per beat (world px)
const NF = 320; // fibres bridging the seam

// lyric placement (world): line 14 at the left, line 15 after it; both straddle the seam (glyph centre on y = 0)
const L14 = { x: -1000, size: 180, maxWidth: 560 };
const L15 = { x: -400, size: 150, maxWidth: 1400 };

interface Fibre { xa: number; xb: number; ra: number; rb: number; len: number; w: number; bend: number; fray: number }
interface Cam { s: number; sy: number; rot: number; fx: number; fy: number }

export default class Split extends Scene {
  private layer!: Layer2D;
  private pulp!: HTMLCanvasElement;
  private list: Shot[] = [];
  private plate!: PlateInfo;
  private lines: Line[] = [];
  private eT = new Float32Array(0);
  private eB = new Float32Array(0);
  private fibres: Fibre[] = [];
  private lay: (LineLayout | null)[] = [];
  private beat0 = 0;

  override init() {
    this.plate = this.ctx.params as PlateInfo;
    // one composition per variant; 'torn' is the only split variant in the cut list (anything else renders as torn)
    if (this.plate.variant !== 'torn') console.warn(`split: unknown variant ${this.plate.variant}, rendering 'torn'`);
    this.list = shots(this.plate, this.ctx.audio);
    this.lines = ownedLines(this.ctx);
    this.layer = new Layer2D();
    this.beat0 = beatIndex(this.ctx.audio, this.ctx.start + 1e-3);
    // torn edges: a shared low-frequency tear line + independent fine tooth per sheet (they almost fit together)
    const n = Math.ceil((2 * WX) / EDGE_STEP) + 1;
    this.eT = new Float32Array(n);
    this.eB = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = -WX + i * EDGE_STEP;
      const base = 16 * fbm1(x * 0.006, 3, 11) + 5 * fbm1(x * 0.05, 2, 12);
      this.eT[i] = base + 3.5 * (hash(i, 1) - 0.5) - 1;
      this.eB[i] = base + 3.5 * (hash(i, 2) - 0.5) + 1;
    }
    // fibres: mostly short pulp hairs, a few long thick strands (the last ones to hold)
    for (let i = 0; i < NF; i++) {
      const long = hash(i, 5) > 0.9;
      const xa = -WX + 40 + hash(i, 3) * (2 * WX - 80);
      this.fibres.push({
        xa,
        xb: xa + (hash(i, 4) - 0.5) * (long ? 70 : 34),
        ra: 6 + 16 * hash(i, 6),
        rb: 6 + 16 * hash(i, 7),
        len: long ? 190 + 110 * hash(i, 8) : 30 + 110 * hash(i, 8),
        w: long ? 2.2 + 1.6 * hash(i, 9) : 0.6 + 1.1 * hash(i, 9),
        bend: hash(i, 10) > 0.5 ? 1 : -1,
        fray: hash(i, 11),
      });
    }
    this.pulp = this.makePulp();
  }

  /** Real paper: a static pulp texture for the lower sheet (sheet-local coords: y = 0 at the seam edge). */
  private makePulp(): HTMLCanvasElement {
    const cv = document.createElement('canvas');
    cv.width = 2 * WX; cv.height = WY + 40;
    const c = cv.getContext('2d')!;
    c.fillStyle = rgba('paper2');
    c.fillRect(0, 0, cv.width, cv.height);
    const rnd = mulberry32(1807);
    // mottling: soft cloudy blotches of bone and graphite
    for (let i = 0; i < 260; i++) {
      const x = rnd() * cv.width, y = rnd() * cv.height, r = 30 + rnd() * 120;
      const g = c.createRadialGradient(x, y, 0, x, y, r);
      const k = rnd() > 0.5 ? 'bone' : 'graphite';
      g.addColorStop(0, rgba(k, k === 'bone' ? 0.22 : 0.05));
      g.addColorStop(1, rgba(k, 0));
      c.fillStyle = g;
      c.fillRect(x - r, y - r, 2 * r, 2 * r);
    }
    // fibres laid in the pulp: short curved hairs, mostly graphite, some bright
    c.lineCap = 'round';
    for (let i = 0; i < 9000; i++) {
      const x = rnd() * cv.width, y = rnd() * cv.height, a = rnd() * Math.PI * 2, l = 6 + rnd() * 26;
      const bright = rnd() > 0.7;
      c.strokeStyle = rgba(bright ? 'bone' : 'graphite', bright ? 0.5 : 0.06 + rnd() * 0.12);
      c.lineWidth = 0.5 + rnd() * 1.1;
      c.beginPath();
      c.moveTo(x, y);
      c.quadraticCurveTo(x + Math.cos(a + 0.6) * l * 0.5, y + Math.sin(a + 0.6) * l * 0.5, x + Math.cos(a) * l, y + Math.sin(a) * l);
      c.stroke();
    }
    return cv;
  }

  private edge(arr: Float32Array, x: number): number {
    const f = (x + WX) / EDGE_STEP, i = clamp(Math.floor(f), 0, arr.length - 2);
    return lerp(arr[i]!, arr[i + 1]!, clamp(f - i));
  }

  /** Seam gap at t: one step per beat since the plate start, snapped in with a short spring overshoot. */
  private gap(t: number): number {
    const au = this.ctx.audio;
    const k = beatIndex(au, t) - this.beat0;
    if (k <= 0) return G0;
    const tb = au.beats[beatIndex(au, t)]!;
    const tau = t - tb;
    const snap = 1 - Math.exp(-tau / 0.045) * Math.cos(tau * 38);
    return G0 + STEP * (k - 1) + STEP * snap;
  }

  private tracePath(c: CanvasRenderingContext2D, arr: Float32Array, top: boolean) {
    const yEnd = top ? -WY : WY;
    c.beginPath();
    c.moveTo(-WX, yEnd);
    for (let i = 0; i < arr.length; i++) c.lineTo(-WX + i * EDGE_STEP, arr[i]!);
    c.lineTo(WX, yEnd);
    c.closePath();
  }

  /** Word centre (world x) of line 15's word i, from the measured layout. */
  private wordX(i: number): number {
    const l = this.lay[1];
    if (!l) return 0;
    const wb = l.words[clamp(i, 0, l.words.length - 1)]!;
    return L15.x + wb.x + wb.w / 2;
  }

  private camera(fr: Framing, t: number, t0: number): Cam {
    const au = this.ctx.audio, dt = t - t0;
    const l15 = this.lines[1];
    // the word being sung on line 15 (camera follows the voice along the seam)
    let wi = 0;
    if (l15) l15.words.forEach((w, i) => { if (t >= w.start - 0.05) wi = i; });
    const wx = this.wordX(wi);
    switch (fr) {
      case 'raking': {
        // grazing light, low camera: foreshortened, panning with the voice
        const fx = lerp(this.wordX(0), wx, ease.inOutCubic(clamp((t - (l15?.words[1]?.start ?? t)) / 0.5 + 1)));
        return { s: 1.9, sy: 0.56, rot: -0.05, fx: fx + 40 + dt * 18, fy: 6 };
      }
      case 'gape': return { s: 1.72, sy: 1, rot: 0.03, fx: lerp(this.wordX(2), this.wordX(3), 0.35) + dt * 22, fy: 0 };
      case 'topdown': return { s: 2.55, sy: 1, rot: -0.34, fx: this.wordX(3) - 40 + dt * 10, fy: 0 };
      default: return { s: 0.84, sy: 1, rot: 0, fx: 0 + dt * 8, fy: -20 };
    }
  }

  /** Is char `st` of line `li` a wedged letter (sung, out of the print, jammed in the seam)? And how far in (0..1).
   *  Only once the seam gapes (storyboard W15.2): before that every letter stays printed across the seam, readable
   *  in ink; at that cut the letters already sung are found jammed, and each later syllable snaps in as it is sung. */
  private wedge(li: number, st: CharState, seamWedged: boolean): number {
    if (li !== 1 || !st.sung || !seamWedged) return 0;
    return ease.outBack(clamp(st.frac * 2.4));
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, audio } = this.ctx;
    const t = f.t;
    const st = stateAt(this.list, t);
    const sh = shotAt(this.list, t);
    const fr = st.frame as Framing;
    const seamWedged = st.seam === 'wedged';
    const L = this.layer, c = L.ctx;
    L.clear(rgba('ink'));

    // measured layouts (fonts are loaded before init; cached after the first frame)
    if (this.lay.length === 0) {
      this.lay = [
        this.lines[0] ? layoutLine(c, this.lines[0], F.slam(), L14.size, L14.maxWidth) : null,
        this.lines[1] ? layoutLine(c, this.lines[1], F.slam(), L15.size, L15.maxWidth) : null,
      ];
    }
    const g = this.gap(t);
    const bp = beatPulse(audio, t, 0.1), kp = kickPulse(audio, t, 0.1), dp = downbeatPulse(audio, t, 0.25);
    const cam = this.camera(fr, t, sh.t0);
    const raking = fr === 'raking', macro = fr === 'topdown';

    c.save();
    c.translate(W / 2, H / 2);
    c.rotate(cam.rot);
    c.scale(cam.s, cam.s * cam.sy);
    c.translate(-cam.fx, -cam.fy);

    // 1. the void under the seam: ink, with the paper's cut walls (thickness) catching light at the edges
    const wall = raking ? 9 : macro ? 2 : 4;
    c.fillStyle = rgba('ink2');
    c.fillRect(-WX, -g / 2 - 30, 2 * WX, g + 60);

    // 2. wedged letters, jammed between the edges (drawn under the sheets so the torn lips bite into them)
    const baseline = (lay: LineLayout | null) => (lay ? lay.size * 0.35 : 0);
    const fit = clamp((g * 1.12) / ((this.lay[1]?.size ?? L15.size) * 0.8), 0.18, 1);
    const l15 = this.lines[1];
    if (l15) {
      drawLyric(c, l15, t, {
        x: L15.x, y: baseline(this.lay[1]), size: L15.size, maxWidth: L15.maxWidth, align: 'left',
        family: F.slam(), sungColor: 'signal', unsungColor: 'signal', unsungAlpha: 0, lead: 3,
        charTransform: (_ch, i, s) => {
          const a = this.wedge(1, s, seamWedged);
          if (a <= 0) return { alpha: 0 };
          const jam = (hash(i, 21) - 0.5) * 0.3;
          return {
            scale: lerp(1, fit, clamp(a)),
            rot: jam * a + 0.05 * kp * (hash(i, 22) - 0.5),
            dy: (hash(i, 23) - 0.5) * g * 0.08 * a + 3 * bp,
            dx: (hash(i, 24) - 0.5) * 10 * a,
          };
        },
      });
    }

    // 3. the two sheets
    for (const top of [true, false]) {
      c.save();
      c.translate(0, top ? -g / 2 : g / 2);
      const arr = top ? this.eT : this.eB;
      this.tracePath(c, arr, top);
      // shadow each sheet casts into the gap (long under raking light)
      c.save();
      c.shadowColor = rgba('ink', raking ? 0.8 : 0.5);
      c.shadowBlur = raking ? 18 : 8;
      c.shadowOffsetY = (top ? 1 : -1) * (raking ? 10 : 3) * cam.s;
      c.fillStyle = rgba(top ? 'bone' : 'paper2');
      c.fill();
      c.restore();
      c.clip();
      if (top) this.drawGrid(c, raking);
      else c.drawImage(this.pulp, -WX, -20);
      // the cut wall: a thin lit strip along the torn edge
      c.beginPath();
      for (let i = 0; i < arr.length; i++) c.lineTo(-WX + i * EDGE_STEP, arr[i]! + (top ? -wall / 2 : wall / 2));
      c.strokeStyle = rgba(top ? 'paper2' : 'bone', top ? 0.9 : 0.8);
      c.lineWidth = wall;
      c.stroke();

      // the printed lines, cut by the seam: crisp ink on the grid, soaked ink in the pulp
      this.lines.forEach((line, li) => {
        const P = li === 0 ? L14 : L15;
        drawLyric(c, line, t, {
          x: P.x, y: baseline(this.lay[li] ?? null), size: P.size, maxWidth: P.maxWidth, align: 'left',
          family: F.slam(), sungColor: 'ink', unsungColor: 'graphite', unsungAlpha: 0.3, lead: 3,
          alpha: top ? 1 : 0.88,
          charTransform: (_ch, _i, s) => {
            // a sung letter lands with a press: it stamps a hair lower on its syllable start
            const press = s.sung ? 4 * (1 - s.frac) * (1 - s.frac) : 0;
            return { dy: press };
          },
          drawChar: (cc, ch, s) => {
            const a = this.wedge(li, s, seamWedged);
            if (a > 0) {
              // the letter left the print: a blind-embossed ghost remains
              cc.globalAlpha *= clamp(1 - a * 0.7);
              cc.strokeStyle = rgba('graphite', 0.8);
              cc.lineWidth = 1.6;
              cc.strokeText(ch, 0, 0);
              return;
            }
            if (!top && s.sung) {
              // ink bleeding into the fibres
              const a0 = cc.globalAlpha;
              cc.globalAlpha = a0 * 0.25;
              cc.fillText(ch, 1.5, 1);
              cc.fillText(ch, -1, 2);
              cc.globalAlpha = a0;
            }
            cc.fillText(ch, 0, 0);
          },
        });
      });
      c.restore();
    }

    // 4. the fibres bridging the seam, straining on every beat but holding
    this.drawFibres(c, t, g, bp, kp, raking, macro, cam.s);
    c.restore();

    // 5. raking light: a low sun from the left; the far side of the frame falls into shade
    if (raking) {
      c.save();
      c.globalCompositeOperation = 'multiply';
      const gr = c.createLinearGradient(0, 0, W, 0);
      gr.addColorStop(0, rgba('bone', 1));
      gr.addColorStop(0.55, rgba('paper2', 1));
      gr.addColorStop(1, rgba('graphite', 1));
      c.fillStyle = gr;
      c.fillRect(0, 0, W, H);
      c.restore();
    }
    L.upload();

    clearRT(renderer, out, LIN.bone);
    this.ctx.comp.draw(renderer, L.texture, out, { mode: 'normal' });

    // hits (T2): a vertical jolt on every beat (the sheets jerk apart), a downbeat punch, harder on each cut
    const cut = Math.exp(-(t - sh.t0) / 0.12) * (sh.index > 0 ? 1 : 0);
    const wordHit = this.wordHit(t);
    // T2 cap: shake <= 14 px as a vector (x <= 6, y <= 12; the camera itself carries no extra jolt)
    const shakeY = clamp(5 * bp + 8 * cut + 6 * wordHit, 0, 12) * (beatIndex(audio, t) % 2 ? 1 : -1);
    const shakeX = clamp(3 * cut * (hash(sh.index, 31) - 0.5) * 4, -6, 6);
    return {
      zoom: 1 + Math.min(0.06, 0.035 * dp + 0.03 * cut),
      shake: [shakeX, shakeY],
      flash: raking ? 0.25 * cut : 0,
      vignette: raking ? 0.45 : macro ? 0.35 : 0.22,
      grain: 0.05,
      bloom: 0,
    };
  }

  /** 1 at each line-15 word start, decaying fast (the letters slam into the seam). */
  private wordHit(t: number): number {
    let v = 0;
    for (const w of this.lines[1]?.words ?? []) if (t >= w.start) v = Math.max(v, Math.exp(-(t - w.start) / 0.1));
    return v;
  }

  /** The virtual sheet: a printed measuring grid with registration crosses and coordinates. */
  private drawGrid(c: CanvasRenderingContext2D, raking: boolean) {
    const minor = 36, major = 180;
    c.lineWidth = 1;
    for (let x = -WX; x <= WX; x += minor) {
      c.strokeStyle = rgba('graphite', x % major === 0 ? 0.42 : 0.16);
      c.beginPath(); c.moveTo(x, -WY); c.lineTo(x, 40); c.stroke();
    }
    for (let y = 0; y >= -WY; y -= minor) {
      c.strokeStyle = rgba('graphite', y % major === 0 ? 0.42 : 0.16);
      c.beginPath(); c.moveTo(-WX, y); c.lineTo(WX, y); c.stroke();
    }
    c.strokeStyle = rgba('ink', 0.7);
    c.lineWidth = 1.5;
    c.fillStyle = rgba('graphite', raking ? 0.5 : 0.8);
    c.font = `14px "${F.mono()}"`;
    for (let x = -WX; x <= WX; x += major) {
      for (let y = -major; y >= -WY; y -= major) {
        c.beginPath(); c.moveTo(x - 9, y); c.lineTo(x + 9, y); c.moveTo(x, y - 9); c.lineTo(x, y + 9); c.stroke();
        c.beginPath(); c.arc(x, y, 5, 0, Math.PI * 2); c.stroke();
        c.fillText(`${(x / major) | 0}.${(-y / major) | 0}`, x + 8, y - 8);
      }
    }
  }

  private drawFibres(c: CanvasRenderingContext2D, t: number, g: number, bp: number, kp: number, raking: boolean, macro: boolean, s: number) {
    c.lineCap = 'round';
    const px = 1 / s; // one screen pixel in world units
    const shOff = raking ? 16 : macro ? 5 : 3; // shadow offset along the light (from the left, slightly down)
    for (let i = 0; i < this.fibres.length; i++) {
      const fb = this.fibres[i]!;
      const ax = fb.xa, ay = -g / 2 + this.edge(this.eT, fb.xa) - fb.ra;
      const bx = fb.xb, by = g / 2 + this.edge(this.eB, fb.xb) + fb.rb;
      const d = Math.hypot(bx - ax, by - ay);
      const tension = d / fb.len;
      // slack fibres sag sideways; taut ones go straight and thin, but never snap
      const slack = tension < 1 ? Math.sqrt(fb.len * fb.len - d * d) * 0.5 : 0;
      const quiver = (1 - clamp(tension)) * 14 * bp * Math.sin(i * 2.1 + t * 40);
      // an S-wave along the strand: the slack bows it one way near the top, the other near the bottom
      const off = fb.bend * slack * 0.3 + quiver;
      const c1x = lerp(ax, bx, 0.33) + off, c1y = lerp(ay, by, 0.33);
      const c2x = lerp(ax, bx, 0.66) - off * 0.5 * (fb.fray - 0.3), c2y = lerp(ay, by, 0.66);
      const mx = (ax + bx) / 2 + off * 0.4, my = (ay + by) / 2;
      const strain = clamp(tension - 0.6, 0, 1.4);
      // every beat the load jumps onto the thick strands: they flash wider (most visible in the macro)
      const w = Math.max(0.45 * px, fb.w * (1 - 0.45 * strain) * (1 + 0.8 * kp * clamp(tension) + (fb.w > 2 ? 1.1 * bp : 0)));
      const a = clamp(1.05 - (fb.w > 2 ? 0.2 : 0.75) * Math.max(0, tension - 1), 0.12, 1); // short hairs fade to ghosts, long strands stay
      // shadow on whatever is behind
      c.strokeStyle = rgba('ink', 0.3 * a);
      c.lineWidth = w * 1.2;
      c.beginPath(); c.moveTo(ax + shOff, ay + shOff * 0.4); c.bezierCurveTo(c1x + shOff * 1.6, c1y + shOff, c2x + shOff * 1.6, c2y + shOff, bx + shOff, by + shOff * 0.4); c.stroke();
      // the fibre, lit
      c.strokeStyle = rgba(strain > 0.7 ? 'paper2' : 'bone', a);
      c.lineWidth = w;
      c.beginPath(); c.moveTo(ax, ay); c.bezierCurveTo(c1x, c1y, c2x, c2y, bx, by); c.stroke();
      // frayed ends on the thick strands (visible in the macro)
      if (fb.w > 2 && (macro || raking)) {
        c.lineWidth = w * 0.35;
        for (const k of [-1, 1]) {
          c.beginPath();
          c.moveTo(ax + k * w * 1.5, ay - 4);
          c.quadraticCurveTo(lerp(ax, mx, 0.3) + k * w, lerp(ay, my, 0.3), lerp(ax, bx, 0.45), lerp(ay, by, 0.45));
          c.moveTo(bx + k * w * 1.5, by + 4);
          c.quadraticCurveTo(lerp(bx, mx, 0.3) + k * w, lerp(by, my, 0.3), lerp(bx, ax, 0.45), lerp(by, ay, 0.45));
          c.stroke();
        }
      }
      // the strain point: a thin bright neck where a taut strand is about to go (it doesn't, here)
      if (tension > 1.1 && fb.w > 2) {
        c.fillStyle = rgba('bone', 0.9 * clamp(tension - 1.1));
        c.beginPath(); c.arc(mx, my, w * 0.9 + 1.5 * bp * px * 3, 0, Math.PI * 2); c.fill();
      }
    }
  }

  override dispose() { this.layer?.texture.dispose(); }
}

