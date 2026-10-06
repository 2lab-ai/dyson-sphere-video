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
import { beatPulse, downbeatPulse } from '../engine/beat';
import { clamp, ease } from '../engine/util';

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
    const R = 520 + 160 * db;
    const g = c.createRadialGradient(AX, ay, 0, AX, ay, R * 2.2);
    g.addColorStop(0, pcss(P, 'hi', 0.95 * lit));
    g.addColorStop(0.3, pcss(P, 'hi', 0.45 * lit));
    g.addColorStop(1, pcss(P, 'hi', 0));
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);
    // the disc itself, swelling on each beat
    const r = (88 + 22 * bp) * (0.7 + 0.3 * lit);
    c.fillStyle = pmix(P, 'hi', 'ground', 0.1 * (1 - lit));
    c.beginPath();
    c.arc(AX, ay, r, 0, Math.PI * 2);
    c.fill();
    // the floor: a deeper amber band whose edge slides down as the camera tilts up
    const fy = 860 + ty;
    const fl = c.createLinearGradient(0, fy - 40, 0, H);
    fl.addColorStop(0, pcss(P, 'ground', 0));
    fl.addColorStop(0.2, pmix(P, 'ground', 'deep', 0.22));
    fl.addColorStop(1, pmix(P, 'ground', 'deep', 0.35));
    c.fillStyle = fl;
    c.fillRect(0, fy - 40, W, H - fy + 40);
    // p33 (cave): silhouettes around the fire at the anchor — crouched before the ignition, arms up after it
    if (this.sub === 'cave') this.ring(c, t, ay, bp, t >= IGNITE ? ease.outCubic(clamp((t - IGNITE) / 0.4)) : 0);
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

  /** Figures in an arc around the disc (nearer = lower and larger); `up` 0..1 raises the arms. */
  private ring(c: CanvasRenderingContext2D, t: number, ay: number, bp: number, up: number) {
    const P = this.P;
    c.fillStyle = pcss(P, 'mid', 0.9);
    c.strokeStyle = pcss(P, 'mid', 0.9);
    c.lineCap = 'round';
    for (let i = 0; i < 7; i++) {
      const a = Math.PI * (0.08 + (0.84 * i) / 6); // arc under the disc, left to right
      const x = AX - Math.cos(a) * 520, foot = ay + 150 + Math.sin(a) * 210;
      const h = 150 + 120 * Math.sin(a) + 6 * bp, w = h * 0.2;
      const sway = 4 * Math.sin(t * 2.1 + i * 1.7);
      const head = foot - h + h * 0.25 * (1 - up);
      c.beginPath();
      c.moveTo(x - w, foot); c.lineTo(x - w * 0.6 + sway, head + h * 0.18); c.lineTo(x + w * 0.6 + sway, head + h * 0.18); c.lineTo(x + w, foot);
      c.closePath(); c.fill();
      c.beginPath(); c.arc(x + sway, head + h * 0.08, w * 0.62, 0, Math.PI * 2); c.fill();
      // arms: toward the fire, rising with the ignition
      const dir = x < AX ? 1 : -1;
      c.lineWidth = w * 0.42;
      c.beginPath();
      c.moveTo(x + sway, head + h * 0.26);
      c.lineTo(x + sway + dir * h * (0.42 - 0.12 * up), head + h * (0.42 - 0.5 * up));
      c.stroke();
    }
  }

  slot(_f: Frame): Slot {
    if (this.sub === 'clay') return { scale: [1, 1], offset: [0, 0], mode: 'multiply' };
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
    if (this.sub === 'cave' && t >= IGNITE && t < IGNITE + 0.9) {
      // the whiteout: full white for 4 frames, then it burns back to the haze (persists well past 6 frames)
      const e = t - IGNITE;
      fc.fillStyle = rgba('bone', e < 0.067 ? 1 : Math.exp(-(e - 0.067) / 0.22));
      fc.fillRect(0, 0, W, H);
      draw = true;
    }
    if (this.sub === 'clay') {
      // the haze hangs in front of the tablet too: the raking-lit clay stays a light ground
      fc.fillStyle = pcss(P, 'hi', 0.3);
      fc.fillRect(0, 0, W, H);
      draw = true;
      // the last bar: a bright square window opens in the tablet at the anchor (p35's residue)
      const bar = (60 / this.ctx.audio.bpm) * 4;
      const u = ease.outCubic(clamp((t - (f.end - bar)) / (bar * 0.6)));
      if (u > 0) {
        const s = 230 * u, ay = AY + this.tilt(t) * 0.25;
        const g = fc.createRadialGradient(AX, ay, 0, AX, ay, s * 1.6);
        g.addColorStop(0, rgba('bone', 0.7));
        g.addColorStop(1, rgba('bone', 0));
        fc.fillStyle = g;
        fc.fillRect(AX - s * 2, ay - s * 2, s * 4, s * 4);
        fc.fillStyle = pcss(P, 'hi', 1);
        fc.fillRect(AX - s / 2, ay - s / 2, s, s);
        fc.fillStyle = rgba('bone', 1);
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
