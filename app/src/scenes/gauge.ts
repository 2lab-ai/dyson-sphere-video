// GAUGE — precise mechanical instruments on ink: engraved dial faces, a numeral wheel, a ratchet sprocket and
// pawl, needles. Everything is a pure function of song time; the structure comes from ./gauge.shots.
// Variants (data/edit.json, docs/STORYBOARD.md):
//   countdown (p07): the needle tries to rewind on every beat and fails — the sprocket slips back one tooth with
//     a 6° overshoot, then the drive throws it one tooth forward; it reaches the stop on the last downbeat and
//     keeps straining against it. Line 7 is engraved on the dial face (then on the ratchet's bridge plate, then
//     on the side of the case); each word lands with a stamp when its first syllable is sung.
//   exp (p23): an exponential (log-decade) scale; the needle races up, pins past the red line and overshoots
//     +6° on every kick/beat, settling in 2 frames; line 23 runs along an exponential curve engraved on the
//     face, traced in signal as it is sung; on the last beat the needle snaps off.
import type * as THREE from 'three';
import { Scene, type Frame, type PostOverrides } from '../engine/scene';
import { Layer2D, clearRT } from '../engine/gl';
import { LIN, rgba } from '../engine/palette';
import { drawLyric, layoutLine, ownedLines, F, type CharState, type CharXform, type DrawLyricOpts } from '../engine/lyric';
import { beatPulse, kickPulse, downbeatPulse } from '../engine/beat';
import { font } from '../engine/type';
import { stateAt, beatTimes, barTimes, type PlateInfo, type Shot } from '../engine/shots';
import { clamp, polylineLengths, pointAtLength, type V2 } from '../engine/util';
import type { Line } from '../engine/lyrics';
import { shots, stopTime, snapTime, type Framing } from './gauge.shots';

const W = 1920, H = 1080;
const DEG = Math.PI / 180;
const FR = 1 / 60;
/** Countdown ratchet: one tooth = 24°, the stop at 126° (clockwise from 12 o'clock). */
const TOOTH = 24, STOP = 126;
/** Exp dial: 8 decades from -120° to 126°, the red line at the 1M decade, needle pinned at 124°. */
const EXP_A0 = -120, EXP_A1 = 126, DECADES = 7, PIN = 124;
const EXP_LABELS = ['1', '10', '100', '1K', '10K', '100K', '1M', '10M'];
const RED_LINE = EXP_A0 + ((EXP_A1 - EXP_A0) * 6) / DECADES;

/** Storyboard hit envelope: full for frames 0-2, then an outExpo decay over 6 frames. */
function env(tau: number): number {
  if (tau < 0) return 0;
  if (tau < 2 * FR) return 1;
  const x = (tau - 2 * FR) / (6 * FR);
  return x >= 1 ? 0 : Math.pow(2, -10 * x);
}
/** Time since the last event <= t (Infinity if none). */
function since(xs: readonly number[], t: number): number {
  let best = -Infinity;
  for (const x of xs) if (x <= t + 1e-9 && x > best) best = x;
  return t - best;
}
const polar = (a: number, r: number): V2 => ({ x: r * Math.sin(a * DEG), y: -r * Math.cos(a * DEG) });

export default class Gauge extends Scene {
  private layer!: Layer2D;
  private list: Shot[] = [];
  private plate!: PlateInfo;
  private lines: Line[] = [];
  private beats: number[] = [];
  private kicks: [number, number][] = [];
  private tStop = 0;
  private tSnap = 0;
  private tDown = 0;

  override init() {
    this.plate = this.ctx.params as PlateInfo;
    this.list = shots(this.plate, this.ctx.audio);
    this.lines = ownedLines(this.ctx);
    this.layer = new Layer2D();
    const au = this.ctx.audio;
    this.beats = beatTimes(au, this.ctx.start, this.ctx.end + 1e-3);
    this.kicks = (au.onsets.kick ?? []).filter(([t]) => t >= this.ctx.start - 0.2 && t < this.ctx.end + 0.1);
    this.tStop = stopTime(this.plate, au);
    this.tSnap = snapTime(this.plate, au);
    this.tDown = barTimes(au, this.ctx.start, this.ctx.end)[0] ?? this.ctx.start + 0.5;
  }

  // ------------------------------------------------------------------ mechanisms (pure in t)
  /** Countdown needle angle (deg). Per beat: slip back one tooth + 6° in 2 frames, then the drive wins. */
  private countdownAngle(t: number): number {
    const toStop = this.beats.filter((b) => b <= this.tStop + 1e-6).length;
    const target = (k: number) => Math.min(STOP, STOP - TOOTH * (toStop - k)); // after k beats
    let k = 0;
    for (const b of this.beats) if (b <= t + 1e-9) k++;
    const trem = 1.1 * kickPulse(this.ctx.audio, t, 0.05) * Math.sin(t * 97);
    if (k === 0) return target(0) + trem;
    const tb = this.beats[k - 1]!, tau = t - tb;
    const prev = target(k - 1), next = target(k);
    if (next === STOP && prev < STOP) {
      // the arriving beat: no rewind attempt — driven onto the stop within 1 frame, then the bounce
      if (tau < FR) return prev + (STOP - prev) * (tau / FR) + trem;
      const u = tau - FR;
      return STOP - 5 * Math.abs(Math.sin(u * 30)) * Math.exp(-u / 0.06) + trem;
    }
    const back = prev - TOOTH - 6; // the rewind attempt: one tooth back, 6° overshoot
    if (tau < 2 * FR) return prev + (back - prev) * (tau / (2 * FR)) + trem;
    const u = tau - 2 * FR;
    let a = next + (back - next) * Math.exp(-u / 0.05) * Math.cos(u * 26);
    if (a > STOP) a = STOP - (a - STOP) * 0.35; // bounce off the stop pin
    return a + trem;
  }
  /** Countdown value shown on the numeral wheel (continuous: rolls with the needle). */
  private countdownValue(a: number) { return (STOP - a) / TOOTH; }

  /** Exp needle: races up exponentially to the pin by the first downbeat, then +6° per kick/beat, 2-frame settle. */
  private expAngle(t: number): number {
    const t0 = this.ctx.start, t1 = this.tDown;
    if (t < t1) {
      const u = clamp((t - t0) / Math.max(0.05, t1 - t0));
      const g = (Math.exp(3.2 * u) - 1) / (Math.exp(3.2) - 1);
      return EXP_A0 + (PIN - EXP_A0) * g;
    }
    const settle = (tau: number) => (tau < 0 ? 0 : Math.max(0, 1 - tau / (2 * FR)));
    let o = settle(since(this.beats, t));
    for (const [kt, s] of this.kicks) if (kt <= t) o = Math.max(o, settle(t - kt) * clamp(0.45 + s));
    return PIN + 6 * o;
  }

  // ------------------------------------------------------------------ drawing helpers
  private stroke(c: CanvasRenderingContext2D, key: Parameters<typeof rgba>[0], a: number, w: number) {
    c.strokeStyle = rgba(key, a); c.lineWidth = w;
  }
  private circle(c: CanvasRenderingContext2D, x: number, y: number, r: number) {
    c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2);
  }

  /** Lyric along a polyline (screen or current-transform coords), centred at arc length sMid. */
  private lyricOnPath(c: CanvasRenderingContext2D, line: Line, t: number, pts: V2[], sMid: number, size: number, extra?: (st: CharState) => CharXform, maxWidth?: number) {
    const L = polylineLengths(pts);
    const family = F.slam();
    const lay = layoutLine(c, line, family, size, maxWidth);
    const s0 = sMid - lay.width / 2;
    drawLyric(c, line, t, {
      x: 0, y: 0, size, family, align: 'left', maxWidth,
      sungColor: 'bone', unsungColor: 'graphite', unsungAlpha: 0.7,
      charTransform: (_ch, _i, st) => {
        const b = st.box;
        const p = pointAtLength(pts, L, s0 + b.x + b.w / 2);
        const piv = { x: p.x + 0.35 * lay.size * Math.sin(p.angle), y: p.y - 0.35 * lay.size * Math.cos(p.angle) };
        const e = extra?.(st) ?? {};
        return { ...e, dx: piv.x - (b.x + b.w / 2) + (e.dx ?? 0), dy: piv.y + 0.35 * lay.size + (e.dy ?? 0), rot: p.angle + (e.rot ?? 0) };
      },
    });
  }

  /** Words land when sung: a stamp (scale 1.35 -> 1 in the first 0.12 s of the syllable). */
  private stamp(st: CharState): CharXform {
    if (!st.sung) return {};
    const a = Math.max(0, 1 - st.frac * 4);
    return { scale: 1 + 0.35 * a * a };
  }

  /** The countdown dial in world px (centre at origin, R = 420). */
  private drawCountdownDial(c: CanvasRenderingContext2D, t: number, a: number) {
    const au = this.ctx.audio, R = 420;
    const bp = beatPulse(au, t, 0.14);
    // case + bezel (the bezel ring thickens on each downbeat)
    c.fillStyle = rgba('ink2', 1); this.circle(c, 0, 0, R + 34); c.fill();
    this.stroke(c, 'graphite', 0.9, 3 + 6 * downbeatPulse(au, t, 0.15)); this.circle(c, 0, 0, R + 34); c.stroke();
    this.stroke(c, 'bone', 0.35, 1.2); this.circle(c, 0, 0, R + 8); c.stroke();
    this.circle(c, 0, 0, R - 70); c.stroke();
    // engraved scale: minor every 4.8°, a tooth every 24°, labels counting down to 0 at the stop
    const cur = Math.round(this.countdownValue(a));
    for (let d = -120; d <= STOP + 0.1; d += 4.8) {
      const isT = Math.abs(((STOP - d) / TOOTH) - Math.round((STOP - d) / TOOTH)) < 1e-3;
      const p = polar(d, R), q = polar(d, R - (isT ? 40 : 16));
      this.stroke(c, 'bone', isT ? 0.95 : 0.5, isT ? 3 : 1.2);
      c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(q.x, q.y); c.stroke();
    }
    c.textAlign = 'center'; c.textBaseline = 'middle';
    for (let n = 0; n <= 10; n++) {
      const d = STOP - TOOTH * n;
      if (d < -121) continue;
      const p = polar(d, R - 82);
      const hot = n === cur;
      c.font = font(F.archivo(100, 900), hot ? 50 + 14 * bp : 44);
      c.fillStyle = hot ? rgba('signal', 0.75 + 0.25 * bp) : rgba('bone', 0.8);
      c.fillText(String(n), p.x, p.y);
    }
    // the stop pin
    const sp = polar(STOP + 4, R - 22);
    const hitStop = env(t - this.tStop) + (t > this.tStop ? 0.6 * env(since(this.beats, t) - 0.08) : 0);
    c.fillStyle = rgba('bone', 1); this.circle(c, sp.x, sp.y, 11); c.fill();
    c.fillStyle = rgba('signal', clamp(hitStop)); this.circle(c, sp.x, sp.y, 11 + 10 * hitStop); c.fill();
    // numeral wheel window
    this.drawWheel(c, 0, 150, 1, this.countdownValue(a), t);
    // needle
    this.drawNeedle(c, a, R - 26, 1 + 2 * kickPulse(au, t, 0.08));
  }

  /** Odometer window at (x, y): two digits, the ones wheel rolling continuously with the needle. */
  private drawWheel(c: CanvasRenderingContext2D, x: number, y: number, s: number, v: number, t: number) {
    const w = 190 * s, h = 104 * s, dh = 92 * s;
    c.save();
    c.fillStyle = rgba('ink', 1);
    c.beginPath(); c.roundRect(x - w / 2, y - h / 2, w, h, 10 * s); c.fill();
    this.stroke(c, 'bone', 0.7, 2 * s); c.stroke();
    c.clip();
    c.font = font(F.mono(700), 78 * s); c.textAlign = 'center'; c.textBaseline = 'middle';
    const vv = Math.max(0, v);
    for (const [cx, val] of [[x - 42 * s, vv / 10], [x + 42 * s, vv]] as const) {
      const base = Math.floor(val);
      const fr = cx < x ? 0 : val - base; // tens wheel only steps
      for (let k = -1; k <= 1; k++) {
        const d = ((base + k) % 10 + 10) % 10;
        const yk = y + (k - fr) * dh; // the next digit rolls in from below
        c.fillStyle = rgba(d === 0 && cx > x ? 'signal' : 'bone', 1);
        c.fillText(String(d), cx, yk + 4 * s);
      }
    }
    // shading bands at the window edges
    c.fillStyle = rgba('ink', 0.55); c.fillRect(x - w / 2, y - h / 2, w, 16 * s); c.fillRect(x - w / 2, y + h / 2 - 16 * s, w, 16 * s);
    c.restore();
    // beat index hairline across the window
    this.stroke(c, 'signal', 0.5 + 0.5 * beatPulse(this.ctx.audio, t, 0.1), 2 * s);
    c.beginPath(); c.moveTo(x - w / 2 - 14 * s, y); c.lineTo(x - w / 2, y); c.moveTo(x + w / 2, y); c.lineTo(x + w / 2 + 14 * s, y); c.stroke();
  }

  /** A tapered needle from the origin at angle a (deg), length r; hub on top. */
  private drawNeedle(c: CanvasRenderingContext2D, a: number, r: number, weight: number, from = -70, tipKey: 'signal' | 'bone' = 'signal') {
    c.save();
    c.rotate(a * DEG);
    c.fillStyle = rgba('bone', 1);
    c.beginPath(); c.moveTo(-9 * weight, -from); c.lineTo(9 * weight, -from); c.lineTo(2, -r); c.lineTo(-2, -r); c.closePath(); c.fill();
    this.stroke(c, tipKey, 1, 3 * weight);
    c.beginPath(); c.moveTo(0, -r * 0.72); c.lineTo(0, -r); c.stroke();
    c.restore();
    c.fillStyle = rgba('ink2', 1); this.circle(c, 0, 0, 30); c.fill();
    this.stroke(c, 'bone', 0.9, 2.5); c.stroke();
    c.fillStyle = rgba('bone', 0.9); this.circle(c, 0, 0, 7); c.fill();
  }

  // ------------------------------------------------------------------ countdown shots
  private countdown(c: CanvasRenderingContext2D, f: Frame, fr: Framing) {
    const t = f.t, au = this.ctx.audio;
    const a = this.countdownAngle(t);
    const line = this.lines[0]!;
    if (fr === 'dial' || fr === 'wheel') {
      const s = fr === 'dial' ? 1 : 2.3, fy = fr === 'dial' ? -10 : 150;
      c.save();
      c.translate(W / 2, H / 2); c.scale(s, s); c.translate(0, -fy);
      this.drawCountdownDial(c, t, a);
      if (fr === 'dial') {
        // line 7 engraved along the lower arc of the face, under the needle's sweep
        const pts: V2[] = [];
        for (let d = -85; d <= 85; d += 2) pts.push({ x: 292 * Math.sin(d * DEG), y: 292 * Math.cos(d * DEG) });
        const L = polylineLengths(pts);
        this.lyricOnPath(c, line, t, pts, L[L.length - 1]! / 2, 84, (st) => this.stamp(st), 720);
      } else {
        drawLyric(c, line, t, { x: 0, y: 262, size: 46, family: F.slam(), align: 'center', maxWidth: 560, sungColor: 'bone', unsungColor: 'graphite', unsungAlpha: 0.7, charTransform: (_ch, _i, st) => this.stamp(st) });
      }
      c.restore();
      return;
    }
    if (fr === 'sprocket') { this.sprocket(c, t, a, line); return; }
    this.side(c, t, a, line, au);
  }

  /** Macro: the ratchet sprocket (rotates 1:1 with the needle) and the pawl riding its teeth. */
  private sprocket(c: CanvasRenderingContext2D, t: number, a: number, line: Line) {
    const au = this.ctx.audio;
    const G = { x: 690, y: 560 }, r0 = 300, r1 = 352, N = 15;
    const kp = kickPulse(au, t, 0.1);
    // gear body
    c.save(); c.translate(G.x, G.y); c.rotate(a * DEG);
    c.beginPath();
    for (let i = 0; i < N; i++) {
      const a0 = (i / N) * Math.PI * 2, a1 = ((i + 1) / N) * Math.PI * 2;
      // ratchet tooth: rises slowly over the tooth, drops vertically
      c.lineTo(r0 * Math.sin(a0), -r0 * Math.cos(a0));
      c.lineTo(r1 * Math.sin(a1 - 0.02), -r1 * Math.cos(a1 - 0.02));
      c.lineTo(r0 * Math.sin(a1), -r0 * Math.cos(a1));
    }
    c.closePath();
    c.fillStyle = rgba('ink2', 1); c.fill();
    this.stroke(c, 'bone', 0.95, 2.5 + 3 * kp); c.stroke();
    // spokes (cut-outs) and hub
    for (let i = 0; i < 5; i++) {
      c.save(); c.rotate((i / 5) * Math.PI * 2);
      c.beginPath(); c.moveTo(-26, -70); c.lineTo(-44, -230); c.arc(0, -230, 44, Math.PI, 0); c.lineTo(26, -70); c.closePath();
      c.fillStyle = rgba('ink', 1); c.fill(); this.stroke(c, 'graphite', 0.9, 1.5); c.stroke();
      c.restore();
    }
    this.stroke(c, 'bone', 0.4, 1); this.circle(c, 0, 0, 270); c.stroke();
    c.fillStyle = rgba('ink2', 1); this.circle(c, 0, 0, 62); c.fill(); this.stroke(c, 'bone', 0.9, 2); c.stroke();
    c.fillStyle = rgba('bone', 1); this.circle(c, 0, 0, 12); c.fill();
    c.restore();
    // pawl: pivot upper right, tip rides the teeth at gear angle 40° (lift follows the tooth phase)
    const P = { x: 1240, y: 170 };
    const ph = ((a % TOOTH) + TOOTH) % TOOTH / TOOTH; // 0 at a tooth drop, rising to 1
    const tauB = since(this.beats, t);
    const caught = tauB < 2 * FR ? 1 : env(tauB - 2 * FR); // the pawl catches the slip
    const rr = r0 + (r1 - r0) * ph + 6;
    const tip = { x: G.x + rr * Math.sin(40 * DEG), y: G.y - rr * Math.cos(40 * DEG) };
    this.stroke(c, 'bone', 1, 14 + 6 * caught); c.lineCap = 'round';
    c.beginPath(); c.moveTo(P.x, P.y); c.quadraticCurveTo(P.x - 120, tip.y - 150, tip.x, tip.y); c.stroke();
    c.fillStyle = rgba('signal', 0.25 + 0.75 * caught); this.circle(c, tip.x, tip.y, 12 + 10 * caught); c.fill();
    c.fillStyle = rgba('ink2', 1); this.circle(c, P.x, P.y, 34); c.fill(); this.stroke(c, 'bone', 0.9, 3); c.stroke();
    // spring: zigzag from the pawl arm to the frame, compressing on the catch
    const S0 = { x: P.x + 20, y: P.y + 40 }, S1 = { x: 1480, y: 330 - 30 * caught };
    this.stroke(c, 'graphite', 1, 3); c.lineCap = 'butt';
    c.beginPath(); c.moveTo(S0.x, S0.y);
    for (let i = 1; i <= 12; i++) {
      const u = i / 12, n = i % 2 ? 16 : -16;
      const dx = S1.x - S0.x, dy = S1.y - S0.y, l = Math.hypot(dx, dy);
      c.lineTo(S0.x + dx * u - (dy / l) * n * (i < 12 ? 1 : 0), S0.y + dy * u + (dx / l) * n * (i < 12 ? 1 : 0));
    }
    c.stroke();
    // bridge plate with line 7 engraved
    const bx = 1000, by = 720, bw = 820, bh = 240;
    c.fillStyle = rgba('ink2', 1); c.beginPath(); c.roundRect(bx, by, bw, bh, 14); c.fill();
    this.stroke(c, 'graphite', 1, 2); c.stroke();
    for (const [sx, sy] of [[bx + 26, by + 26], [bx + bw - 26, by + 26], [bx + 26, by + bh - 26], [bx + bw - 26, by + bh - 26]] as const) {
      c.fillStyle = rgba('graphite', 1); this.circle(c, sx, sy, 9); c.fill();
      this.stroke(c, 'ink', 1, 2); c.beginPath(); c.moveTo(sx - 6, sy); c.lineTo(sx + 6, sy); c.stroke();
    }
    drawLyric(c, line, t, { x: bx + bw / 2, y: by + bh / 2 + 50, size: 132, family: F.slam(), align: 'center', maxWidth: bw - 90, sungColor: 'bone', unsungColor: 'graphite', unsungAlpha: 0.7, charTransform: (_ch, _i, st) => this.stamp(st) });
    // tooth counter tick: the slip, printed as a mark on the plate edge per beat
    c.font = font(F.mono(500), 22); c.textAlign = 'left'; c.textBaseline = 'alphabetic';
    c.fillStyle = rgba('graphite', 1);
    c.fillText(`T-${Math.max(0, Math.round(this.countdownValue(a))).toString().padStart(2, '0')}  PAWL ${caught > 0.5 ? 'CATCH' : 'RIDE'}`, bx + 60, by + 44);
  }

  /** Side view: the case edge-on, the needle bowing against the stop pin, line 7 on the case wall. */
  private side(c: CanvasRenderingContext2D, t: number, a: number, line: Line, au: typeof this.ctx.audio) {
    const C = { x: 960, y: 400 }, rx = 720, ry = 150, R = 420, wall = 250;
    const pr = (p: V2): V2 => ({ x: C.x + (p.x / R) * rx, y: C.y + (p.y / R) * ry });
    // wall
    c.fillStyle = rgba('ink2', 1);
    c.beginPath(); c.ellipse(C.x, C.y + wall, rx, ry, 0, 0, Math.PI); c.lineTo(C.x - rx, C.y); c.ellipse(C.x, C.y, rx, ry, 0, Math.PI, 0, true); c.closePath(); c.fill();
    this.stroke(c, 'graphite', 1, 2); c.stroke();
    // knurled rim lines on the wall (edge-on) — step on each beat
    const bi = this.beats.filter((b) => b <= t).length;
    for (let i = 0; i < 48; i++) {
      const u = ((i + bi * 0.5) / 48) * Math.PI;
      const x = C.x - rx * Math.cos(u);
      const y0 = C.y + ry * Math.sin(u);
      this.stroke(c, 'graphite', 0.55, 1.5);
      c.beginPath(); c.moveTo(x, y0 + 8); c.lineTo(x, y0 + 30); c.stroke();
    }
    // face
    c.fillStyle = rgba('ink2', 1); c.beginPath(); c.ellipse(C.x, C.y, rx, ry, 0, 0, Math.PI * 2); c.fill();
    this.stroke(c, 'bone', 0.8, 2.5); c.stroke();
    for (let d = -120; d <= STOP + 0.1; d += 4.8) {
      const isT = Math.abs(((STOP - d) / TOOTH) - Math.round((STOP - d) / TOOTH)) < 1e-3;
      const p = pr(polar(d, R - 10)), q = pr(polar(d, R - (isT ? 50 : 24)));
      this.stroke(c, 'bone', isT ? 0.9 : 0.4, isT ? 2.5 : 1);
      c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(q.x, q.y); c.stroke();
    }
    // stop pin: a post standing on the face
    const base = pr(polar(STOP + 4, R - 22)), H0 = 110;
    const hit = t >= this.tStop ? env(since(this.beats, t) - 0.08) : 0;
    this.stroke(c, 'bone', 1, 14); c.lineCap = 'round';
    c.beginPath(); c.moveTo(base.x, base.y); c.lineTo(base.x, base.y - H0); c.stroke();
    c.fillStyle = rgba('signal', clamp(0.3 + hit)); this.circle(c, base.x, base.y - H0 + 36, 10 + 8 * hit); c.fill();
    // needle raised 70 px above the face on its arbor, bowing under strain against the pin
    const lift = 70;
    const hub = { x: C.x, y: C.y - lift };
    const tipP = pr(polar(a, R - 26));
    const tip = { x: tipP.x, y: tipP.y - lift };
    const pinned = a > STOP - 3 ? 1 : 0;
    const strain = pinned * (0.5 + 0.8 * kickPulse(au, t, 0.1) + 0.6 * hit);
    const mx = (hub.x + tip.x) / 2, my = (hub.y + tip.y) / 2;
    const dx = tip.x - hub.x, dy = tip.y - hub.y, l = Math.hypot(dx, dy) || 1;
    const ctrl = { x: mx + (dy / l) * 60 * strain, y: my - (dx / l) * 60 * strain - 30 * strain };
    this.stroke(c, 'graphite', 1, 10); c.beginPath(); c.moveTo(C.x, C.y); c.lineTo(hub.x, hub.y); c.stroke(); // arbor
    this.stroke(c, 'bone', 1, 12 + 4 * beatPulse(au, t, 0.1));
    c.beginPath(); c.moveTo(hub.x, hub.y); c.quadraticCurveTo(ctrl.x, ctrl.y, tip.x, tip.y); c.stroke();
    this.stroke(c, 'signal', 1, 6); c.beginPath(); c.moveTo((ctrl.x + tip.x * 3) / 4, (ctrl.y + tip.y * 3) / 4); c.lineTo(tip.x, tip.y); c.stroke();
    c.fillStyle = rgba('ink2', 1); c.beginPath(); c.ellipse(hub.x, hub.y, 34, 14, 0, 0, Math.PI * 2); c.fill();
    this.stroke(c, 'bone', 0.9, 2); c.stroke();
    c.lineCap = 'butt';
    // line 7 engraved on the wall of the case
    drawLyric(c, line, t, { x: C.x, y: C.y + ry + 175, size: 132, family: F.slam(), align: 'center', maxWidth: 1300, sungColor: 'bone', unsungColor: 'graphite', unsungAlpha: 0.7, charTransform: (_ch, _i, st) => this.stamp(st) });
  }

  // ------------------------------------------------------------------ exp shots
  /** Exponential curve engraved on the exp dial face (world px, dial centre at origin). */
  private expCurve(): V2[] {
    const pts: V2[] = [];
    for (let i = 0; i <= 80; i++) {
      const u = i / 80, g = (Math.exp(2.4 * u) - 1) / (Math.exp(2.4) - 1);
      pts.push({ x: -300 + 540 * u, y: 215 - 360 * g });
    }
    return pts;
  }

  private drawExpDial(c: CanvasRenderingContext2D, t: number, a: number, snapped: number) {
    const au = this.ctx.audio, R = 420;
    const bp = beatPulse(au, t, 0.15);
    c.fillStyle = rgba('ink2', 1); this.circle(c, 0, 0, R + 34); c.fill();
    this.stroke(c, 'graphite', 0.9, 3); this.circle(c, 0, 0, R + 34); c.stroke();
    this.stroke(c, 'bone', 0.35, 1.2); this.circle(c, 0, 0, R + 8); c.stroke();
    // red zone past the red line: a signal band that flares on every beat
    c.lineCap = 'butt';
    this.stroke(c, 'signal', 0.55 + 0.45 * bp, 16 + 10 * bp);
    c.beginPath(); c.arc(0, 0, R - 20, (RED_LINE - 90) * DEG, (EXP_A1 + 8 - 90) * DEG); c.stroke();
    // log-decade scale: majors equally spaced, minors at log10(k) — the ticks bunch toward each decade's end
    const span = (EXP_A1 - EXP_A0) / DECADES;
    for (let dcd = 0; dcd <= DECADES; dcd++) {
      const d0 = EXP_A0 + span * dcd;
      const p = polar(d0, R), q = polar(d0, R - 48);
      this.stroke(c, dcd >= 6 ? 'signal' : 'bone', 1, dcd === 6 ? 6 : 3.5);
      c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(q.x, q.y); c.stroke();
      const lp = polar(d0, R - 86);
      c.font = font(F.archivo(100, 900), 36); c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillStyle = rgba(dcd >= 6 ? 'signal' : 'bone', 0.9);
      c.fillText(EXP_LABELS[dcd]!, lp.x, lp.y);
      if (dcd === DECADES) break;
      for (let k = 2; k <= 9; k++) {
        const d = d0 + span * Math.log10(k);
        const p1 = polar(d, R), q1 = polar(d, R - (k === 5 ? 30 : 20));
        this.stroke(c, 'bone', 0.55, 1.3);
        c.beginPath(); c.moveTo(p1.x, p1.y); c.lineTo(q1.x, q1.y); c.stroke();
      }
    }
    // pin past the red line
    const pp = polar(PIN + 7, R - 30);
    c.fillStyle = rgba('bone', 1); this.circle(c, pp.x, pp.y, 10); c.fill();
    // engraved exponential curve + its axes
    const pts = this.expCurve();
    this.stroke(c, 'graphite', 0.9, 1.5);
    c.beginPath(); c.moveTo(-310, 225); c.lineTo(260, 225); c.moveTo(-310, 225); c.lineTo(-310, -120); c.stroke();
    c.beginPath(); pts.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y))); this.stroke(c, 'graphite', 1, 3); c.stroke();
    // the traced part (follows the sung syllables along the curve)
    const line = this.lines[0]!;
    const prog = clamp((t - line.start) / Math.max(0.1, line.end - line.start));
    const n = Math.max(1, Math.round(prog * (pts.length - 1)));
    c.beginPath(); for (let i = 0; i <= n; i++) (i ? c.lineTo(pts[i]!.x, pts[i]!.y) : c.moveTo(pts[i]!.x, pts[i]!.y));
    this.stroke(c, 'signal', 1, 4 + 3 * kickPulse(au, t, 0.08)); c.stroke();
    // needle (outer half flies off after the snap)
    this.drawExpNeedle(c, t, a, snapped);
  }

  private drawExpNeedle(c: CanvasRenderingContext2D, t: number, a: number, snapped: number) {
    const R = 420;
    if (snapped < 0) { this.drawNeedle(c, a, R - 30, 1.1); return; }
    // inner stub stays, outer segment flies along the clockwise tangent, spinning
    c.save(); c.rotate(PIN * DEG);
    c.fillStyle = rgba('bone', 1);
    c.beginPath(); c.moveTo(-10, 70); c.lineTo(10, 70); c.lineTo(5, -190); c.lineTo(-2, -206); c.lineTo(-6, -184); c.closePath(); c.fill();
    c.restore();
    const tau = snapped;
    const piv = polar(PIN, 250);
    const tan = { x: Math.cos(PIN * DEG), y: Math.sin(PIN * DEG) };
    const rad = { x: Math.sin(PIN * DEG), y: -Math.cos(PIN * DEG) };
    c.save();
    c.translate(piv.x + (tan.x * 2600 + rad.x * 900) * tau, piv.y + (tan.y * 2600 + rad.y * 900) * tau + 1800 * tau * tau);
    c.rotate(PIN * DEG + 16 * tau);
    c.fillStyle = rgba('bone', 1);
    c.beginPath(); c.moveTo(-5, 60); c.lineTo(2, 44); c.lineTo(6, 66); c.lineTo(2, -140); c.lineTo(-2, -140); c.closePath(); c.fill();
    this.stroke(c, 'signal', 1, 4); c.beginPath(); c.moveTo(0, -60); c.lineTo(0, -140); c.stroke();
    c.restore();
    c.fillStyle = rgba('ink2', 1); this.circle(c, 0, 0, 30); c.fill();
    this.stroke(c, 'bone', 0.9, 2.5); c.stroke();
    // shards at the break
    const bp = polar(PIN, 196);
    for (let i = 0; i < 7; i++) {
      const ang = i * 2.1 + 0.4, d = 40 + 900 * tau * (0.4 + (i % 3) * 0.3);
      c.fillStyle = rgba(i % 2 ? 'ember' : 'bone', clamp(1 - tau * 5));
      c.fillRect(bp.x + Math.cos(ang) * d, bp.y + Math.sin(ang) * d, 5, 5);
    }
  }

  private exp(c: CanvasRenderingContext2D, f: Frame, fr: Framing) {
    const t = f.t;
    const a = this.expAngle(t);
    const snapped = t >= this.tSnap ? t - this.tSnap : -1;
    const line = this.lines[0]!;
    // camera: world -> screen as translate/scale/rotate about a focus point
    const cam = fr === 'macro' ? { s: 2.1, r: 0.5, fx: 200, fy: 50 } : fr === 'snap' ? { s: 0.9, r: 0.09, fx: 0, fy: 10 } : { s: 1.1, r: 0, fx: 0, fy: 20 };
    c.save();
    c.translate(W / 2, H / 2); c.rotate(cam.r); c.scale(cam.s, cam.s); c.translate(-cam.fx, -cam.fy);
    this.drawExpDial(c, t, a, snapped);
    c.restore();
    // line 23 along the curve, set at screen size on the camera-projected curve
    const co = Math.cos(cam.r), si = Math.sin(cam.r);
    const scr = this.expCurve().map((p) => {
      const x = (p.x - cam.fx) * cam.s, y = (p.y - cam.fy) * cam.s;
      return { x: W / 2 + co * x - si * y, y: H / 2 + si * x + co * y };
    });
    // lift the text off the groove (normal toward the curve's upper-left side)
    const off = fr === 'macro' ? 26 : 16;
    const path = scr.map((p, i) => {
      const q = scr[Math.min(i + 1, scr.length - 1)]!, o = scr[Math.max(i - 1, 0)]!;
      const ang = Math.atan2(q.y - o.y, q.x - o.x);
      return { x: p.x + off * Math.sin(ang), y: p.y - off * Math.cos(ang) };
    });
    const L = polylineLengths(path);
    let sMid = L[L.length - 1]! / 2;
    const size = fr === 'macro' ? 110 : fr === 'snap' ? 70 : 80;
    if (fr === 'macro') {
      // centre the words on the stretch of curve nearest the frame centre, kept inside the title-safe box
      let best = 0, bd = Infinity;
      for (let i = 0; i < path.length; i++) {
        const p = path[i]!, dd = Math.hypot(p.x - W / 2, p.y - H * 0.55);
        if (dd < bd) { bd = dd; best = i; }
      }
      sMid = L[best]!;
    }
    // exponential growth on the letters: later characters sit bigger on the curve (only once sung)
    const n = line.words.reduce((k, w) => k + Array.from(w.w).length, 0);
    this.lyricOnPath(this.layer.ctx, line, t, path, sMid, size, (st) => {
      const u = st.box.index / Math.max(1, n - 1);
      const s0 = this.stamp(st);
      return { scale: (s0.scale ?? 1) * (st.sung ? 1 + 0.18 * u * u : 1) };
    }, fr === 'macro' ? 1350 : undefined);
  }

  // ------------------------------------------------------------------ frame
  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, audio } = this.ctx;
    const st = stateAt(this.list, f.t);
    const fr = st.frame as Framing;
    const L = this.layer, c = L.ctx;
    L.clear();
    const v = this.plate.variant;
    if (v === 'exp') this.exp(c, f, fr); else this.countdown(c, f, fr);
    L.upload();
    clearRT(renderer, out, LIN.ink);
    this.ctx.comp.draw(renderer, L.texture, out, { mode: 'normal' });

    // authored hits (storyboard tiers: countdown T1 shake <= 6 px, flare <= 1.4x; exp T2 shake <= 14 px, punch <= 1.06x)
    const tb = since(this.beats, f.t);
    let kEnv = 0;
    for (const [kt, s] of this.kicks) if (kt <= f.t) kEnv = Math.max(kEnv, env(f.t - kt) * clamp(s));
    const dir = Math.floor(f.t * 60) % 2 ? 1 : -1;
    if (v === 'exp') {
      const snap = f.t >= this.tSnap ? env(f.t - this.tSnap) : 0;
      const shake = Math.min(14, 7 * kEnv + 14 * snap);
      return {
        zoom: 1 + 0.05 * env(f.t - this.tDown) + 0.02 * env(tb) * (fr === 'macro' ? 1 : 0.5),
        shake: [dir * shake, -dir * shake * 0.5],
        flash: 0.05 * snap,
        bloom: fr === 'macro' ? 0.4 : 0.25, bloomThreshold: 0.75,
      };
    }
    const stopHit = env(f.t - this.tStop);
    const shake = Math.min(6, 4 * kEnv + 6 * stopHit);
    return {
      zoom: 1 + 0.025 * env(tb) + 0.04 * stopHit,
      shake: [dir * shake, dir * shake * 0.4],
      flash: 0.025 * stopHit,
      bloom: fr === 'sprocket' ? 0 : 0.2, bloomThreshold: 0.8,
    };
  }

  override dispose() { this.layer?.texture.dispose(); }
}
