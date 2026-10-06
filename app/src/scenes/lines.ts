// LINES run host (p30–p31): white ridgelines on black — terrain seen from a low oblique camera, rows receding to a
// horizon (Joy-Division as landscape, not a chart: no axes, no ticks, no frame). One world across the run: the rows
// are keyed on song time, so p30 → p31 is the same terrain still drifting. The subject (ecg/ridge, void/stones) is
// composited 'normal' over it: its own black occlusion fills read as near terrain in front of the far rows.
//
// Beat: the front rows lift on every beat; bar: a heave rolls through the rows on the downbeat.
// p30 (nov 1) carries p29's orange point: it sits on the front ridge from the first frame (drawn after the subject).
import type * as THREE from 'three';
import type { Frame, PostOverrides } from '../engine/scene';
import { WorldHost, type Slot } from '../engine/world';
import { Layer2D, clearRT, W, H } from '../engine/gl';
import { palette, pcss, type NamedPalette } from '../engine/palette';
import { beatPulse, downbeatPulse } from '../engine/beat';
import { clamp, smoothstep, noise1 } from '../engine/util';

const NROW = 30; // rows on screen
const DZ = 70; // world spacing between rows
const Z0 = 200; // nearest row depth
const XR = 2600; // half-width of a row (world)
const NS = 120; // samples per row
const FOC = 900; // focal length (px)
const CAM_H = 160; // camera height above the terrain floor (low oblique)
const SPEED = 38; // world units/s the camera drifts forward

export default class Lines extends WorldHost {
  private layer!: Layer2D;
  private P!: NamedPalette;
  private fg!: Layer2D;

  protected override initWorld() {
    this.layer = new Layer2D();
    this.fg = new Layer2D();
    this.P = palette(this.ctx.params.look?.palette ?? 'ridge');
  }

  /** Terrain height at world (X, row index k): long ridges + a finer crest, all deterministic. */
  private height(X: number, k: number): number {
    const a = 45 * (0.5 + 0.5 * noise1(X * 0.0011 + k * 0.19, 3));
    const b = 18 * noise1(X * 0.004 + k * 0.53, 7);
    const crest = 24 * Math.pow(Math.max(0, noise1(X * 0.0023 - k * 0.31, 11)), 2);
    return a + b + crest;
  }

  /** Camera at song time t: drifting forward, swaying sideways, horizon breathing slightly. */
  private cam(t: number) {
    return { travel: t * SPEED, x: 240 * Math.sin(t * 0.09) + 90 * Math.sin(t * 0.23), hz: 330 + 18 * Math.sin(t * 0.17) };
  }

  /** Screen points of row k at song time t (and its depth). */
  private row(k: number, t: number, lift: number): { pts: [number, number][]; z: number } {
    const c = this.cam(t);
    const z = k * DZ - c.travel;
    const pts: [number, number][] = [];
    const s = FOC / z;
    for (let i = 0; i <= NS; i++) {
      const X = c.x - XR + (2 * XR * i) / NS;
      const h = this.height(X, k) * lift;
      pts.push([W / 2 + (X - c.x) * s, c.hz + (CAM_H - h) * s]);
    }
    return { pts, z };
  }

  /** The row index nearest the camera that is fully in front of it. */
  private frontRow(t: number): number {
    return Math.ceil((this.cam(t).travel + Z0) / DZ);
  }

  renderWorld(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const t = f.t, au = this.ctx.audio, P = this.P;
    const L = this.layer, c = L.ctx;
    L.clear(pcss(P, 'ground'));
    const bp = beatPulse(au, t, 0.14), db = downbeatPulse(au, t, 0.3);
    const k0 = this.frontRow(t);
    c.lineJoin = 'round';
    // far → near: fill black under the ridge (occlusion), then the white ridge
    for (let k = k0 + NROW; k >= k0; k--) {
      const d = k - k0; // 0 = front
      const near = Math.exp(-d / 6);
      // the downbeat heave rolls from the front row backwards; the beat lifts the front rows
      const heave = db * Math.exp(-Math.abs(d - (1 - db) * 10) / 2.5);
      const lift = 1 + 0.35 * bp * near + 0.45 * heave;
      const { pts, z } = this.row(k, t, lift);
      const fadeFar = smoothstep(NROW, NROW - 6, d);
      const fadeIn = smoothstep(Z0 * 0.8, Z0 * 1.2, z);
      const a = fadeFar * fadeIn;
      if (a <= 0.01) continue;
      c.fillStyle = pcss(P, 'ground', 1);
      c.beginPath();
      c.moveTo(pts[0]![0], H + 40);
      for (const [x, y] of pts) c.lineTo(x, y);
      c.lineTo(pts[pts.length - 1]![0], H + 40);
      c.closePath();
      c.fill();
      c.strokeStyle = pcss(P, 'hi', a * (0.55 + 0.45 * near) * (0.85 + 0.15 * bp + 0.3 * heave));
      c.lineWidth = Math.max(1, 3.2 * (FOC / z) * (1 + 0.5 * bp * near));
      c.beginPath();
      c.moveTo(pts[0]![0], pts[0]![1]);
      for (const [x, y] of pts) c.lineTo(x, y);
      c.stroke();
    }
    L.upload();
    clearRT(this.ctx.renderer, out, [0, 0, 0]);
    this.ctx.comp.draw(this.ctx.renderer, L.texture, out, { mode: 'normal' });
    return { zoom: 1 + 0.012 * db, vignette: 0.35, grain: 0.06 };
  }

  slot(_f: Frame): Slot {
    return { scale: [1, 1], offset: [0, 0], mode: 'normal' };
  }

  protected override afterSubject(f: Frame, out: THREE.WebGLRenderTarget) {
    // residue (p30, nov 1): p29's orange point sits on the front ridge — from the first frame, through the plate
    if (String(this.ctx.params.nov) !== '1') return;
    const t = f.t, au = this.ctx.audio;
    const k0 = this.frontRow(t);
    const { pts } = this.row(k0, t, 1 + 0.35 * beatPulse(au, t, 0.14));
    // ridge y under screen x ≈ 960
    let y = H * 0.8;
    for (let i = 0; i + 1 < pts.length; i++) {
      const [ax, ay] = pts[i]!, [bx, by] = pts[i + 1]!;
      if (ax <= W / 2 && bx >= W / 2) { y = ay + ((W / 2 - ax) / Math.max(1, bx - ax)) * (by - ay); break; }
    }
    y = clamp(y, 160, H - 60);
    const fc = this.fg.ctx;
    this.fg.clear();
    const R = 16;
    const glow = fc.createRadialGradient(W / 2, y - R, 0, W / 2, y - R, R * 5);
    glow.addColorStop(0, pcss(this.P, 'signal', 0.55));
    glow.addColorStop(1, pcss(this.P, 'signal', 0));
    fc.fillStyle = glow;
    fc.fillRect(W / 2 - R * 5, y - R * 6, R * 10, R * 10);
    fc.fillStyle = pcss(this.P, 'signal', 1);
    fc.beginPath();
    fc.arc(W / 2, y - R, R, 0, Math.PI * 2);
    fc.fill();
    this.fg.upload();
    this.ctx.comp.draw(this.ctx.renderer, this.fg.texture, out, { mode: 'normal' });
  }

  override dispose() {
    super.dispose();
    this.layer?.texture.dispose();
    this.fg?.texture.dispose();
  }
}
