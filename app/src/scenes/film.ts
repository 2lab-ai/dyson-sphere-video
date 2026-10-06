// FILM run host (p08–p12): the NIGHT street wall — brick, the shop window, the clock on the wall — photographed on
// overexposed daylight stock (palette 'film': blown highlights, grain, halation, light ground). Only the exposure
// flips at p08; from then on only the subject changes (docs/BUILD-V4.md, engine/world.ts).
//
//   World   a Canvas2D street redrawn every frame under the camera: blown-out sky/stock, the brick wall centre-right with
//           the shop window in it, the clock-wall silhouette above, the kerb line. Low-contrast ink, as overexposed film.
//   Camera  eye-level; a persistent push per bar (a step cut-in on each downbeat, held) about the anchor point.
//   Subject composited with 'multiply' into the wall (centre-right). Every subject is developed first into ink on white:
//           light-on-dark subjects (lidar) by mapping exposure to ink, the others by normalising their white point.
//   p12     lightpaint/orbit collapses to FILM_ANCHOR_CHILD, which the slot maps onto the screen anchor (1187, 413)
//           independent of the push (the push pivots on the anchor) — p13's residue.
import * as THREE from 'three';
import { WorldHost, type Slot } from '../engine/world';
import { type Frame, type PostOverrides } from '../engine/scene';
import { FSPass, Layer2D, makeRT, clearRT, W, H } from '../engine/gl';
import { palette, pcss, plin, type NamedPalette } from '../engine/palette';
import { barIndex, beatPulse, downbeatPulse } from '../engine/beat';
import { clamp, ease, hash, TAU } from '../engine/util';

/** The screen anchor (p13's residue) and the subject-frame point the slot maps onto it. */
export const FILM_ANCHOR: [number, number] = [1187, 413];
export const FILM_ANCHOR_CHILD: [number, number] = [1007, 413];
const SUBJECT_SCALE = 0.86; // subject frame -> screen, before the push
const PUSH = 0.07; // per bar

const DEVELOP = /* glsl */ `
uniform sampler2D tex;
uniform float uMode;          // 0: normalise the white point; 1: exposure -> ink (light-on-dark subjects)
uniform vec3 uWhite, uDeep, uSig;
void main() {
  vec3 c = texture(tex, vUv).rgb;
  if (uMode < 0.5) { fragColor = vec4(min(c / uWhite, vec3(1.0)), 1.0); return; }
  float mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b));
  float l = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  vec3 ink = mix(uDeep, uSig, smoothstep(0.35, 0.7, (mx - mn) / max(mx, 1e-3)));
  fragColor = vec4(mix(vec3(1.0), ink, clamp(l * 6.0, 0.0, 1.0)), 1.0);
}`;

export default class Film extends WorldHost {
  private P!: NamedPalette;
  private L!: Layer2D;
  private dev!: FSPass;
  private devRT: THREE.WebGLRenderTarget | null = null;
  private bar0 = 0;

  override async init() {
    // the subject reads the anchor from its params (scenes never import each other)
    this.ctx.params = { ...this.ctx.params, filmAnchor: FILM_ANCHOR_CHILD };
    await super.init();
  }

  protected override initWorld() {
    this.P = palette('film');
    this.L = new Layer2D();
    this.devRT = makeRT();
    const v3 = (role: 'hi' | 'deep' | 'signal') => ({ value: new THREE.Vector3(...plin(this.P, role)) });
    this.dev = new FSPass(DEVELOP, { tex: { value: null }, uMode: { value: this.subjectName.startsWith('lidar/') ? 1 : 0 }, uWhite: v3('hi'), uDeep: v3('deep'), uSig: v3('signal') });
    this.bar0 = barIndex(this.ctx.audio, this.ctx.start + 0.05);
  }

  /** Push: a held step per bar since the plate start (eased over 0.1 s), pivoting on the anchor. */
  private push(t: number): number {
    const au = this.ctx.audio, b = barIndex(au, t), n = Math.max(0, b - this.bar0);
    const d = au.downbeats[b] ?? this.ctx.start;
    const k = b >= this.bar0 && n > 0 ? ease.outCubic(clamp((t - d) / 0.1)) : 1;
    return 1 + PUSH * (n - 1 + k) * (n > 0 ? 1 : 0);
  }

  renderWorld(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const r = this.ctx.renderer, c = this.L.ctx, P = this.P, t = f.t;
    const z = this.push(t), [ax, ay] = FILM_ANCHOR;
    const bp = beatPulse(this.ctx.audio, t, 0.14);

    // develop the subject into ink on white (then swap: the slot composites the developed target)
    if (this.childRT && this.devRT) {
      this.dev.u.tex!.value = this.childRT.texture;
      this.dev.render(r, this.devRT);
      [this.childRT, this.devRT] = [this.devRT, this.childRT];
    }

    this.L.clear(pcss(P, 'hi'));
    c.setTransform(z, 0, 0, z, ax * (1 - z), ay * (1 - z));
    // the stock: blown daylight, the ground warming toward the street
    const sky = c.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, pcss(P, 'hi')); sky.addColorStop(0.75, pcss(P, 'hi')); sky.addColorStop(1, pcss(P, 'ground'));
    c.fillStyle = sky; c.fillRect(-200, -200, W + 400, H + 400);
    // the brick wall, centre-right (the NIGHT wall, overexposed: mortar a faint ink)
    const X0 = 620, X1 = W + 200, Y0 = -60, Y1 = 900, BW = 132, BH = 46;
    c.fillStyle = pcss(P, 'ground', 0.55); c.fillRect(X0, Y0, X1 - X0, Y1 - Y0);
    c.strokeStyle = pcss(P, 'deep', 0.14); c.lineWidth = 2;
    c.beginPath();
    for (let y = Y0, row = 0; y < Y1; y += BH, row++) {
      c.moveTo(X0, y); c.lineTo(X1, y);
      for (let x = X0 + (row % 2 ? BW / 2 : 0); x < X1; x += BW) { c.moveTo(x, y); c.lineTo(x, Math.min(y + BH, Y1)); }
    }
    c.stroke();
    for (let i = 0; i < 40; i++) { // weathered bricks
      const x = X0 + Math.floor(hash(i, 3) * 10) * BW + (Math.floor(hash(i, 4) * 20) % 2 ? BW / 2 : 0), y = Y0 + Math.floor(hash(i, 4) * 20) * BH;
      c.fillStyle = pcss(P, 'mid', 0.05 + 0.06 * hash(i, 5)); c.fillRect(x, y, BW, BH);
    }
    // the shop window (the room behind it is p10's subject)
    c.fillStyle = pcss(P, 'hi', 0.9); c.fillRect(760, 330, 470, 440);
    c.strokeStyle = pcss(P, 'deep', 0.45); c.lineWidth = 14; c.strokeRect(760, 330, 470, 440);
    c.lineWidth = 5; c.beginPath(); c.moveTo(995, 330); c.lineTo(995, 770); c.stroke();
    // the clock on the wall (silhouette), and its bracket
    c.fillStyle = pcss(P, 'deep', 0.32); c.beginPath(); c.arc(1640, 210, 118, 0, TAU); c.fill();
    c.fillStyle = pcss(P, 'hi', 0.85); c.beginPath(); c.arc(1640, 210, 96, 0, TAU); c.fill();
    c.strokeStyle = pcss(P, 'deep', 0.5); c.lineWidth = 9; c.lineCap = 'round';
    c.beginPath(); c.moveTo(1640, 210); c.lineTo(1640, 140); c.moveTo(1640, 210); c.lineTo(1690, 236); c.stroke();
    c.fillStyle = pcss(P, 'deep', 0.3); c.fillRect(1528, 196, 20, 28);
    // the kerb and the pavement, a lamp post at the left
    c.fillStyle = pcss(P, 'ground', 0.9); c.fillRect(-200, 900, W + 400, 400);
    c.strokeStyle = pcss(P, 'deep', 0.3); c.lineWidth = 6; c.beginPath(); c.moveTo(-200, 900); c.lineTo(W + 200, 900); c.stroke();
    c.fillStyle = pcss(P, 'deep', 0.22); c.fillRect(250, 120, 22, 780); c.fillRect(200, 110, 120, 26);
    // p11: the other figure's eye across the wall (the subject is the first iris); it dilates on the beat
    if (this.subjectName.startsWith('lens/')) {
      const ex = 420, ey = 470, R = 150;
      c.fillStyle = pcss(P, 'deep', 0.75); c.beginPath(); c.arc(ex, ey, R, 0, TAU); c.fill();
      c.strokeStyle = pcss(P, 'hi', 0.5); c.lineWidth = 3;
      c.beginPath();
      for (let k = 0; k < 36; k++) { const a = (k / 36) * TAU; c.moveTo(ex + Math.cos(a) * R * 0.5, ey + Math.sin(a) * R * 0.5); c.lineTo(ex + Math.cos(a) * R * 0.95, ey + Math.sin(a) * R * 0.95); }
      c.stroke();
      c.fillStyle = pcss(P, 'deep'); c.beginPath(); c.arc(ex, ey, R * (0.34 + 0.16 * bp), 0, TAU); c.fill();
      c.fillStyle = pcss(P, 'hi', 0.9); c.beginPath(); c.arc(ex - R * 0.22, ey - R * 0.24, R * 0.09, 0, TAU); c.fill();
    }
    this.L.upload();
    clearRT(r, out, [1, 1, 1]);
    this.ctx.comp.draw(r, this.L.texture, out, { mode: 'normal' });

    const dp = downbeatPulse(this.ctx.audio, t, 0.25);
    return { bloom: 0.55, bloomThreshold: 0.75, bloomRadius: 0.9, halation: 0.6 + 0.2 * dp, ca: 0.4, grain: 0.09, vignette: 0.12, flash: 0 };
  }

  /** The subject frame scaled by SUBJECT_SCALE * push, FILM_ANCHOR_CHILD pinned to FILM_ANCHOR (uv space, y up). */
  slot(f: Frame): Slot {
    const S = 1 / (SUBJECT_SCALE * this.push(f.t));
    const A = [FILM_ANCHOR[0] / W, 1 - FILM_ANCHOR[1] / H], Ac = [FILM_ANCHOR_CHILD[0] / W, 1 - FILM_ANCHOR_CHILD[1] / H];
    return { scale: [S, S], offset: [Ac[0]! - 0.5 - (A[0]! - 0.5) * S, Ac[1]! - 0.5 - (A[1]! - 0.5) * S], mode: 'multiply' };
  }

  override dispose() { super.dispose(); this.devRT?.dispose(); this.L?.texture.dispose(); }
}
