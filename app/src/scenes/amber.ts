// AMBER run host (p32–p34): sodium haze — a LIGHT amber ground, a wide camera tilting up, a disc of light at the
// anchor (1187,413). One world across the run: p32's sun, p33's fire and p34's window are the same disc in the same
// haze. Subjects draw their object (+ lyric) on a transparent target; clay (a lit 3D field) multiplies its pale clay
// into the haze instead.
//
// Beat: the disc swells on every beat; bar: the haze blooms on the downbeat.
// p32 (nov 1) carries p31's last stone: it stands on the floor as the first silhouette.
// p33: the hit at 165.343 s = the fire ignites — the run's (and this unit's) only whiteout, then the disc stays brighter.
// p34: the last bar opens a bright square window in the tablet at the anchor (p35's first pane).
import type * as THREE from 'three';
import type { Frame, PostOverrides } from '../engine/scene';
import { WorldHost, type Slot } from '../engine/world';
import { Layer2D, clearRT, W, H } from '../engine/gl';
import { palette, pcss, pmix, rgba, type NamedPalette } from '../engine/palette';
import { beatPulse, downbeatPulse, beatIndex } from '../engine/beat';
import { clamp, ease, hash, noise1 } from '../engine/util';

const AX = 1187, AY = 413; // the run's anchor (layout: disc at anchor)
const IGNITE = 165.343; // p33: the fire ignites (PLAN-V4 C7, timed inside the plate)
const FIRE = { x: 960, y: 980 }; // the cave subject's fire, in its own (wide) frame

export default class Amber extends WorldHost {
  private layer!: Layer2D;
  private fg!: Layer2D;
  private P!: NamedPalette;

  protected override initWorld() {
    this.layer = new Layer2D();
    this.fg = new Layer2D();
    this.P = palette(this.ctx.params.look?.palette ?? 'amber');
  }

  private get sub(): string { return (this.ctx.params.subject?.module as string) ?? ''; }

  /** Beats since t0 (held: snaps on the beat and stays), 0 before the first beat after t0. */
  private steps(t: number, t0 = this.ctx.start): number {
    const au = this.ctx.audio;
    return t < t0 ? 0 : Math.max(0, beatIndex(au, t) - beatIndex(au, t0 + 1e-3));
  }

  /** Camera tilt across the run: the world slides down the frame as the camera tilts up (px). */
  private tilt(t: number): number {
    return 90 * ease.inOutCubic(clamp((t - 155.348) / (172.336 - 155.348)));
  }

  renderWorld(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const t = f.t, au = this.ctx.audio, P = this.P;
    const L = this.layer, c = L.ctx;
    const bp = beatPulse(au, t, 0.14), db = downbeatPulse(au, t, 0.3);
    const ty = this.tilt(t);
    const lit = this.sub === 'cave' ? (t >= IGNITE ? 1 : 0.35) : 1;
    L.clear(pcss(P, 'ground'));
    // sky haze: paler toward the disc, a touch deeper toward the frame's top (the camera looks up into it)
    const sky = c.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, pmix(P, 'ground', 'deep', 0.12));
    sky.addColorStop(0.55, pcss(P, 'ground'));
    sky.addColorStop(1, pmix(P, 'ground', 'hi', 0.25));
    c.fillStyle = sky;
    c.fillRect(0, 0, W, H);
    // the disc's haze: wide, swelling on the downbeat
    const ay = AY + ty * 0.25;
    const R = (520 + 160 * db) * (this.sub === 'sodium' ? 1 + 0.06 * Math.min(this.steps(t), 8) : 1);
    const g = c.createRadialGradient(AX, ay, 0, AX, ay, R * 2.2);
    g.addColorStop(0, pcss(P, 'hi', 0.95 * lit));
    g.addColorStop(0.3, pcss(P, 'hi', 0.45 * lit));
    g.addColorStop(1, pcss(P, 'hi', 0));
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);
    // the disc itself, swelling on each beat; p32's sun steps up 6 % per beat and holds. p33 has no disc: the fire is
    // the light at the anchor
    const sun = this.sub === 'sodium' ? 1 + 0.06 * this.steps(t) : 1;
    const r = (88 + 22 * bp) * (0.7 + 0.3 * lit) * sun;
    if (this.sub !== 'cave') {
      c.fillStyle = pmix(P, 'hi', 'ground', 0.1 * (1 - lit));
      c.beginPath();
      c.arc(AX, ay, r, 0, Math.PI * 2);
      c.fill();
    }
    // the floor: a deeper amber band whose edge slides down as the camera tilts up
    const fy = 860 + ty;
    const fl = c.createLinearGradient(0, fy - 40, 0, H);
    fl.addColorStop(0, pcss(P, 'ground', 0));
    fl.addColorStop(0.2, pmix(P, 'ground', 'deep', 0.22));
    fl.addColorStop(1, pmix(P, 'ground', 'deep', 0.35));
    c.fillStyle = fl;
    c.fillRect(0, fy - 40, W, H - fy + 40);
    // residue (p32, nov 1): p31's last stone stands on the floor — the first silhouette
    if (String(this.ctx.params.nov) === '1') {
      const sx = 610, sy = fy + 6;
      c.fillStyle = pcss(P, 'mid', 0.92);
      c.beginPath();
      c.moveTo(sx - 70, sy); c.lineTo(sx - 58, sy - 150); c.lineTo(sx - 18, sy - 178 - 6 * bp);
      c.lineTo(sx + 44, sy - 160); c.lineTo(sx + 66, sy);
      c.closePath();
      c.fill();
    }
    L.upload();
    clearRT(this.ctx.renderer, out, [1, 1, 1]);
    this.ctx.comp.draw(this.ctx.renderer, L.texture, out, { mode: 'normal' });
    return { zoom: 1 + 0.01 * db, vignette: 0.18, grain: 0.05, bloom: 0.15, bloomThreshold: 0.92 };
  }

  /**
   * The fire at the anchor (base just under it). Before the ignition: a log pile, a kindling glow and embers that
   * step up per beat. After it: tongues of flame (dark-red outer, orange, white core) whose height steps up 15 % per
   * beat and holds, embers rising out of it.
   */
  private fire(c: CanvasRenderingContext2D, t: number, ay: number, pre: number, post: number) {
    const P = this.P, fx = AX, fb = ay + 140;
    const burning = post >= 0;
    const glowR = burning ? 330 + 40 * post : 110 + 35 * pre;
    const g = c.createRadialGradient(fx, fb - 40, 0, fx, fb - 40, glowR);
    g.addColorStop(0, burning ? rgba('bone', 0.9) : pcss(P, 'signal', 0.55 + 0.12 * pre));
    g.addColorStop(0.35, pcss(P, 'signal', burning ? 0.45 : 0.25));
    g.addColorStop(1, pcss(P, 'signal', 0));
    c.fillStyle = g;
    c.fillRect(fx - glowR, fb - 40 - glowR, 2 * glowR, 2 * glowR);
    // logs
    c.strokeStyle = pcss(P, 'mid', 1); c.lineCap = 'round'; c.lineWidth = 20;
    c.beginPath(); c.moveTo(fx - 120, fb + 22); c.lineTo(fx + 95, fb - 10); c.moveTo(fx + 125, fb + 20); c.lineTo(fx - 85, fb - 12); c.stroke();
    const tongue = (x: number, w: number, h: number, sway: number, col: string) => {
      c.fillStyle = col;
      c.beginPath();
      c.moveTo(x - w, fb);
      c.quadraticCurveTo(x - w * 0.95, fb - h * 0.5, x + sway, fb - h);
      c.quadraticCurveTo(x + w * 0.95, fb - h * 0.5, x + w, fb);
      c.closePath(); c.fill();
    };
    if (burning) {
      const H0 = 300 * (1 + 0.15 * Math.min(post, 5));
      for (let i = 0; i < 5; i++) {
        const x = fx + (i - 2) * 46;
        const h = H0 * (i === 2 ? 1 : 0.62 + 0.18 * hash(i, 61)) * (0.93 + 0.07 * noise1(t * 5 + i * 2.3, 62));
        const sw = 30 * noise1(t * 3 + i, 63);
        tongue(x, 62, h, sw, pmix(P, 'signal', 'mid', 0.42, 0.95));
        tongue(x, 42, h * 0.78, sw * 0.8, pcss(P, 'signal', 1));
        tongue(x, 20, h * 0.45, sw * 0.5, rgba('bone', 1));
      }
    } else {
      // kindling: a low glowing bed on the logs, growing a step per beat
      for (let i = 0; i < 3; i++) tongue(fx + (i - 1) * 40, 34, (26 + 14 * pre) * (0.9 + 0.1 * noise1(t * 4 + i, 64)), 0, pcss(P, 'signal', 0.9));
    }
    // embers rising (deterministic in t)
    const n = burning ? 28 : 8 + 4 * pre, rise = burning ? 520 + 60 * post : 160;
    for (let i = 0; i < n; i++) {
      const sp = 0.6 + 0.6 * hash(i, 65), ph = (t * sp * 0.9 + hash(i, 66)) % 1;
      const x = fx + (hash(i, 67) - 0.5) * 220 + 40 * Math.sin(t * 2 + i) * ph;
      c.fillStyle = i % 3 ? pcss(P, 'signal', 1 - ph) : rgba('bone', 1 - ph);
      c.beginPath(); c.arc(x, fb - 30 - ph * rise, 3 + 3 * hash(i, 68), 0, Math.PI * 2); c.fill();
    }
  }

  /**
   * Figures in an arc around the fire (nearer = lower and larger). `step` (held, per beat) edges them in toward it;
   * `up` 0..1 raises the arms; `lit`: a rim of firelight on the side facing the fire (the dark body offset away).
   */
  private ring(c: CanvasRenderingContext2D, t: number, ay: number, bp: number, step: number, up: number, lit: boolean) {
    const P = this.P;
    c.lineCap = 'round';
    for (let i = 0; i < 7; i++) {
      const a = Math.PI * (0.08 + (0.84 * i) / 6); // arc under the anchor, left to right
      const rad = 540 - 30 * Math.min(step, 7);
      const x = AX - Math.cos(a) * rad, foot = ay + 150 + Math.sin(a) * 210;
      const h = 150 + 120 * Math.sin(a) + 6 * bp, w = h * 0.2;
      const sway = 4 * Math.sin(t * 2.1 + i * 1.7);
      const dir = x < AX ? 1 : -1; // toward the fire
      const head = foot - h + h * 0.25 * (1 - up);
      const fig = (ox: number, col: string) => {
        c.fillStyle = col; c.strokeStyle = col;
        const X = x + ox;
        c.beginPath();
        c.moveTo(X - w, foot); c.lineTo(X - w * 0.6 + sway, head + h * 0.18); c.lineTo(X + w * 0.6 + sway, head + h * 0.18); c.lineTo(X + w, foot);
        c.closePath(); c.fill();
        c.beginPath(); c.arc(X + sway, head + h * 0.08, w * 0.62, 0, Math.PI * 2); c.fill();
        // arms: toward the fire, rising with it
        c.lineWidth = w * 0.42;
        c.beginPath();
        c.moveTo(X + sway, head + h * 0.26);
        c.lineTo(X + sway + dir * h * (0.42 - 0.12 * up), head + h * (0.42 - 0.5 * up));
        c.stroke();
      };
      if (lit) fig(0, pcss(P, 'hi', 1));
      else fig(0, pcss(P, 'signal', 0.8));
      fig(-dir * (lit ? 8 : 4), pcss(P, 'mid', 0.95));
    }
  }

  slot(f: Frame): Slot {
    // a held push toward the anchor on every beat (the anchor stays put; a zoom-in never samples past the child's
    // edge): p32 the reaching crowd advances on the sun (1 %/beat, capped so the left-edge lyric stays in frame),
    // p34 the camera leans into the writing as each wedge goes in (2.5 %/beat)
    if (this.sub === 'clay' || this.sub === 'sodium') {
      const s = 1 / (1 + (this.sub === 'clay' ? 0.025 : 0.01) * Math.min(this.steps(f.t), 8));
      const off: [number, number] = [((AX - W / 2) * (1 - s)) / W, ((H / 2 - AY) * (1 - s)) / H];
      return { scale: [s, s], offset: off, mode: 'normal' };
    }
    if (this.sub === 'cave') {
      // the cave's fire (bottom-centre of its frame) placed just under the anchor, the scene at 2/3 size; the flames
      // rise into the disc. uv = (vUv - 0.5) * s + 0.5 + off  =>  off = (child px - s * screen px) about the centre
      const s = 1.5, xa = AX, ya = AY + 60;
      return { scale: [s, s], offset: [(FIRE.x - W / 2 - s * (xa - W / 2)) / W, (H / 2 - FIRE.y - s * (H / 2 - ya)) / H], mode: 'normal' };
    }
    return { scale: [1, 1], offset: [0, 0], mode: 'normal' };
  }

  protected override afterSubject(f: Frame, out: THREE.WebGLRenderTarget) {
    const t = f.t, P = this.P, fc = this.fg.ctx;
    let draw = false;
    this.fg.clear();
    if (this.sub === 'cave') {
      // p33: the fire at the anchor over the cave's own (faint) marks, then the silhouettes around it (nearer ones
      // occlude it) — crouched and edging in a held step per beat before the ignition, arms rising a held step per
      // beat after it, lit fire-side
      const ay = AY + this.tilt(t) * 0.25, bp = beatPulse(this.ctx.audio, t, 0.14);
      const pre = this.steps(Math.min(t, IGNITE - 1e-3)), post = t >= IGNITE ? this.steps(t, IGNITE) : -1;
      this.fire(fc, t, ay, pre, post);
      this.ring(fc, t, ay, bp, pre + Math.max(0, post + 1), post < 0 ? 0 : Math.min(1, 0.55 + 0.15 * post), post >= 0);
      draw = true;
    }
    if (this.sub === 'cave' && t >= IGNITE && t < IGNITE + 0.9) {
      // the whiteout: full white for 4 frames, then it burns back to the haze (persists well past 6 frames)
      const e = t - IGNITE;
      fc.fillStyle = rgba('bone', e < 0.067 ? 1 : Math.exp(-(e - 0.067) / 0.22));
      fc.fillRect(0, 0, W, H);
      draw = true;
    }
    if (this.sub === 'clay') {
      // the haze hangs in front of the tablet too: the raking-lit clay stays a light ground
      fc.fillStyle = pcss(P, 'hi', 0.12);
      fc.fillRect(0, 0, W, H);
      draw = true;
      // the last bar: a bright square window opens in the tablet at the anchor (p35's residue)
      const bar = (60 / this.ctx.audio.bpm) * 4;
      // it opens on the bar's first beat and brightens a held step on each of its beats
      const kb = this.steps(t, f.end - bar - 0.02);
      const u = kb > 0 ? ease.outCubic(clamp((t - (f.end - bar)) / 0.06)) : 0;
      if (u > 0) {
        const lv = Math.min(1, 0.4 + 0.2 * (kb - 1));
        const s = 230 * u, ay = AY + this.tilt(t) * 0.25;
        const g = fc.createRadialGradient(AX, ay, 0, AX, ay, s * 1.6);
        g.addColorStop(0, rgba('bone', 0.7 * lv));
        g.addColorStop(1, rgba('bone', 0));
        fc.fillStyle = g;
        fc.fillRect(AX - s * 2, ay - s * 2, s * 4, s * 4);
        fc.fillStyle = pcss(P, 'hi', 1);
        fc.fillRect(AX - s / 2, ay - s / 2, s, s);
        fc.fillStyle = rgba('bone', lv);
        fc.fillRect(AX - s * 0.42, ay - s * 0.42, s * 0.84, s * 0.84);
        draw = true;
      }
    }
    if (!draw) return;
    this.fg.upload();
    this.ctx.comp.draw(this.ctx.renderer, this.fg.texture, out, { mode: 'normal' });
  }

  override dispose() {
    super.dispose();
    this.layer?.texture.dispose();
    this.fg?.texture.dispose();
  }
}
