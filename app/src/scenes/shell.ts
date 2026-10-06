// SHELL — the Dyson shell closing, told in two plates with two different looks (v3). Canvas2D only: every panel is a
// real 3D hex on a sphere, projected through a pinhole camera; flat fills, no gradients, no filters.
// Variants (data/edit.json):
//   dancheong (p42, light, H3 dancheong vault)  Inside the sunlit shell, looking UP at the last opening. The panels are
//            painted like the ceiling of a Korean temple: graded colour bands with white lines between them, lotus
//            rosettes, black outlines, white plaster between the panels, ring beams with gold stamps. The first frame
//            continues p41's Sun (disc at the anchor, r = 110 px) seen through the oculus. Per beat one ring of panels
//            swings in bare, lands ON the beat, overshoots and flashes into paint; the eighth beat drops the lotus
//            medallion over the Sun. The last frame is the painted medallion at the anchor, r = 135 px.
//   pullback (p43, dark, 3D lit)  Outside: the sealed sphere at the anchor (r = 135 px, the medallion's pole facing us),
//            flat-shaded facets, its seams still leaking the trapped Sun and dying within the first bar; seams pulse
//            on the kick. Per beat another star gets its own shell: a dark sphere closes over it like an iris and
//            locks with a ring flash. The camera grazes the sealed surface, then pulls back wide while the remaining
//            stars go dark in batches, ending on a black field.
// Structure from the pure shot list (./shell.shots) via stateAt(); colour only from the plate's named palette.
import * as THREE from 'three';
import { Scene, type Frame, type PostOverrides } from '../engine/scene';
import { Layer2D, clearRT } from '../engine/gl';
import { palette, pcss, pmix, plin, type NamedPalette, type Role } from '../engine/palette';
import { beatPulse, kickPulse, downbeatPulse } from '../engine/beat';
import { beatTimes, shotAt, stateAt, type PlateInfo, type Shot } from '../engine/shots';
import { clamp, hash, ease, lerp, TAU } from '../engine/util';
import { shots, type Cam } from './shell.shots';

const W = 1920, H = 1080;
/** The match-circle anchor (storyboard subject centre for p40–p43). */
const AX = 1187, AY = 413;
/** p41's Sun disc at its last frame (orbit/swarm contract) and the p42 medallion = p43 sphere at the p42/p43 cut. */
const R_SUN = 110, R_SEAL = 135;
/** p42: brightness of the already-locked vault (painted panels in shadow on the dark ground). */
const VAULT_DIM = 0.22;

// ------------------------------------------------------------------ vector kit + pinhole camera
type V = [number, number, number];
const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: V, s: number): V => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V): V => mul(a, 1 / Math.max(1e-9, Math.hypot(a[0], a[1], a[2])));
/** Direction on a sphere from polar angle th about `ax` (with `e1`, `e2` completing the frame) and azimuth ph. */
const sph = (th: number, ph: number, ax: V, e1: V, e2: V): V =>
  add(mul(ax, Math.cos(th)), add(mul(e1, Math.sin(th) * Math.cos(ph)), mul(e2, Math.sin(th) * Math.sin(ph))));

interface Cam3 { C: V; w: V; u: V; v: V; f: number; px: number; py: number }
function lookAt(C: V, target: V, ref: V, roll: number, f: number, px: number, py: number): Cam3 {
  const w = norm(sub(target, C));
  let u = norm(cross(w, ref));
  let v = cross(u, w);
  if (roll) {
    const cs = Math.cos(roll), sn = Math.sin(roll);
    [u, v] = [add(mul(u, cs), mul(v, sn)), sub(mul(v, cs), mul(u, sn))];
  }
  return { C, w, u, v, f, px, py };
}
/** World -> logical px; null behind (or too close to) the camera. */
function proj(c: Cam3, X: V): [number, number, number] | null {
  const d = sub(X, c.C);
  const z = dot(d, c.w);
  if (z < 0.02) return null;
  return [c.px + (c.f * dot(d, c.u)) / z, c.py - (c.f * dot(d, c.v)) / z, z];
}

// ------------------------------------------------------------------ dancheong vault geometry
const ZEN: V = [0, 1, 0], EX: V = [1, 0, 0], EZ: V = [0, 0, 1];
const A0 = 0.12;         // medallion half-angle (rad)
const DR = 0.105;        // ring width (rad)
const NR = 24;           // rings out from the medallion
const CLOSE = 6;         // rings 1..CLOSE are open at the first frame and lock one per beat
const BEAMS = new Set([7, 11]); // ring beams (painted bands) instead of panel rings
const ringTh = (r: number) => A0 + (r - 0.5) * DR;
const ringN = (r: number) => Math.max(6, Math.round((TAU * Math.sin(ringTh(r))) / (DR * 1.02) / 6) * 6);
/** Motif per panel: a fixed order per ring, with a few panels swapped so the vault never mirrors itself. */
const motifOf = (r: number, i: number) => ([0, 2, 1, 3][r % 4]! + (hash(r, i, 7) > 0.86 ? 2 : 0)) % 4;

// ------------------------------------------------------------------ pullback geometry
const SAX: V = norm([0.18, 0.3, 1]);            // the sealed sphere's pole (the medallion) faces the first camera
const SE1: V = norm(cross(SAX, [0, 1, 0]));
const SE2: V = cross(SAX, SE1);
const SA0 = 0.2, SDR = 0.14;
const KEY: V = norm([-0.65, 0.55, 0.52]);       // cold key light, upper left, in front
const D0 = 4;                                   // first-frame distance: sphere radius on screen = R_SEAL

type Ctx2 = CanvasRenderingContext2D;

export default class Shell extends Scene {
  private layer!: Layer2D;
  private list: Shot[] = [];
  private plate!: PlateInfo;
  private P!: NamedPalette;
  private beats: number[] = [];
  private sprites: HTMLCanvasElement[] = [];
  private medal!: HTMLCanvasElement;
  private fUp = 700;
  private fSeal = 1600;
  private fOut = 520;
  private stars: { X: V; b: number; tOff: number; hero: boolean; rw: number }[] = [];

  override init() {
    this.plate = this.ctx.params as PlateInfo;
    this.P = palette(this.ctx.params.look?.palette ?? (this.plate.variant === 'dancheong' ? 'dancheong' : 'pullback'));
    this.list = shots(this.plate, this.ctx.audio);
    this.beats = beatTimes(this.ctx.audio, this.ctx.start, this.ctx.end);
    this.layer = new Layer2D();
    if (this.plate.variant === 'dancheong') this.initVault();
    else this.initOut();
  }

  // ================================================================== dancheong
  private initVault() {
    // focal lengths solved from the geometry: the open ring edge at ~330 px in the first frame; the medallion at
    // exactly R_SEAL in the seal shot (camera on the zenith axis, so it projects as a circle)
    const up = this.vaultCam('up', 0, 0, 0, 1);
    let acc = 0;
    for (let k = 0; k < 12; k++) {
      const p = proj(up, sph(A0 + CLOSE * DR, (k / 12) * TAU, ZEN, EX, EZ))!;
      acc += Math.hypot(p[0] - AX, p[1] - AY);
    }
    this.fUp = 330 / (acc / 12);
    const seal = this.vaultCam('seal', 0, 0, 0, 1);
    const m = proj(seal, add(ZEN, mul(EX, A0)))!;
    this.fSeal = R_SEAL / Math.hypot(m[0] - AX, m[1] - AY);
    this.sprites = [0, 1, 2, 3].map((k) => this.paintSprite(k));
    this.medal = this.paintMedallion();
  }

  /** Camera per shot. u = 0..1 through the shot (slow drift), f1 = focal override (solving). */
  private vaultCam(cam: Cam, u: number, bp: number, t: number, f1 = 0): Cam3 {
    const REF: V = [0, 0, -1];
    const f = (k: number) => (f1 || this.fUp) * k;
    const d = 0.02 * u;
    switch (cam) {
      case 'tilt': // off-axis, looking obliquely across the vault: the rings run as perspective ellipses
        return lookAt([-0.5 + d, -0.45, 0.4], norm([0.55, 0.72, -0.42]), REF, 0.38, f(0.85), 820, 600);
      case 'close': // standing near the far wall, film plane level: rings crowd on one side, rafters fan out
        return this.shiftCam([-0.55 + d, -0.42, 0.42], f(1.55 * (1 + 0.05 * u)), 0.5);
      case 'rake': // a low raking angle from the far side: the last rings stacked up in depth
        return lookAt([0.55, -0.62 + d, -0.35], norm([-0.5, 0.78, 0.36]), REF, -0.45, f(0.95), 1120, 600);
      case 'seal':
        return this.shiftCam([0.42, -0.3, -0.36], f1 || this.fSeal, -0.3);
      default: // up
        return this.shiftCam([0.62 + d, -0.46, 0.3], f(1 + 0.004 * bp), 0.05 * Math.sin(t * 0.7));
    }
  }

  /**
   * An off-axis view with a level film plane (setViewOffset-style lens shift): the camera stands away from the
   * vault's axis and looks straight up, the principal point shifted so the zenith lands on the anchor. Everything
   * near the zenith (the Sun, the medallion) stays a true circle there, while the rings and rafters around it run
   * eccentric, crowding on the far side where the vault curves down.
   */
  private shiftCam(C: V, f: number, roll: number): Cam3 {
    const c = lookAt(C, add(C, [0, 1, 0]), [0, 0, -1], roll, f, 0, 0);
    const z = proj(c, ZEN)!;
    return { ...c, px: AX - z[0], py: AY - z[1] };
  }

  /** One hex panel design, painted once into a sprite (sprite space [-1, 1], pointy along +y = radial). */
  private paintSprite(kind: number): HTMLCanvasElement {
    const S = 256;
    const cv = document.createElement('canvas');
    cv.width = S; cv.height = S;
    const c = cv.getContext('2d')!;
    c.setTransform(S / 2, 0, 0, S / 2, S / 2, S / 2);
    const P = this.P;
    const hex = (r: number, fill: string) => {
      c.beginPath();
      for (let k = 0; k < 6; k++) { const a = Math.PI / 2 + (k * Math.PI) / 3; c.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
      c.closePath(); c.fillStyle = fill; c.fill();
    };
    const disc = (r: number, fill: string) => { c.beginPath(); c.arc(0, 0, r, 0, TAU); c.fillStyle = fill; c.fill(); };
    const petals = (n: number, r0: number, r1: number, wd: number, fill: string, rot = 0) => {
      c.fillStyle = fill;
      for (let i = 0; i < n; i++) {
        const a = rot + (i / n) * TAU;
        c.beginPath();
        c.ellipse(Math.cos(a) * (r0 + r1) / 2, Math.sin(a) * (r0 + r1) / 2, (r1 - r0) / 2, wd, a, 0, TAU);
        c.fill();
      }
    };
    const ink = pcss(P, 'text'), white = pcss(P, 'ground');
    // graded bands (휘): base, white line, lighter tint, base, black line, field
    const bands: [Role, Role, Role, Role][] = [['deep', 'mid', 'hi', 'mid'], ['mid', 'deep', 'ground', 'hi'], ['deep', 'hi', 'mid', 'deep'], ['text', 'deep', 'hi', 'mid']];
    const [base, field, pet, core] = bands[kind]!;
    const baseCss = kind === 3 ? pmix(P, 'deep', 'text', 0.55) : pcss(P, base);
    hex(1, ink);
    hex(0.93, baseCss);
    hex(0.84, white);
    hex(0.79, kind === 3 ? pmix(P, 'deep', 'ground', 0.35) : pmix(P, base === 'text' ? 'deep' : base, 'ground', 0.45));
    hex(0.72, baseCss);
    hex(0.66, ink);
    hex(0.63, pcss(P, field));
    if (kind === 2) {
      // four-petal cross flower
      petals(4, 0.08, 0.56, 0.17, ink, Math.PI / 4);
      petals(4, 0.1, 0.52, 0.13, pcss(P, pet), Math.PI / 4);
      petals(4, 0.1, 0.4, 0.09, white, Math.PI / 4);
    } else {
      const n = kind === 1 ? 6 : 8;
      petals(n, 0.12, 0.58, kind === 1 ? 0.17 : 0.13, ink);
      petals(n, 0.14, 0.54, kind === 1 ? 0.14 : 0.105, pcss(P, pet));
      petals(n, 0.16, 0.42, kind === 1 ? 0.08 : 0.06, kind === 1 ? pcss(P, 'mid') : white);
      petals(n, 0.3, 0.5, 0.04, pcss(P, field === 'hi' ? 'mid' : 'hi'), Math.PI / n);
    }
    disc(0.17, ink);
    disc(0.14, pcss(P, core));
    disc(0.06, white);
    return cv;
  }

  /** The lotus medallion that closes the oculus (sprite space [-1, 1], a circle of radius 1). */
  private paintMedallion(): HTMLCanvasElement {
    const S = 512;
    const cv = document.createElement('canvas');
    cv.width = S; cv.height = S;
    const c = cv.getContext('2d')!;
    c.setTransform(S / 2, 0, 0, S / 2, S / 2, S / 2);
    const P = this.P;
    const disc = (r: number, fill: string) => { c.beginPath(); c.arc(0, 0, r, 0, TAU); c.fillStyle = fill; c.fill(); };
    const petals = (n: number, r0: number, r1: number, wd: number, fill: string, rot = 0) => {
      c.fillStyle = fill;
      for (let i = 0; i < n; i++) {
        const a = rot + (i / n) * TAU;
        c.beginPath();
        c.ellipse(Math.cos(a) * (r0 + r1) / 2, Math.sin(a) * (r0 + r1) / 2, (r1 - r0) / 2, wd, a, 0, TAU);
        c.fill();
      }
    };
    disc(1, pcss(P, 'text'));
    disc(0.96, pcss(P, 'mid'));
    disc(0.9, pcss(P, 'ground'));
    disc(0.86, pcss(P, 'deep'));
    // outer ring of gold stamps on green
    c.fillStyle = pcss(P, 'hi');
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * TAU;
      c.beginPath();
      c.moveTo(Math.cos(a) * 0.72, Math.sin(a) * 0.72);
      c.lineTo(Math.cos(a + 0.09) * 0.79, Math.sin(a + 0.09) * 0.79);
      c.lineTo(Math.cos(a) * 0.84, Math.sin(a) * 0.84);
      c.lineTo(Math.cos(a - 0.09) * 0.79, Math.sin(a - 0.09) * 0.79);
      c.fill();
    }
    disc(0.7, pcss(P, 'text'));
    disc(0.67, pcss(P, 'mid'));
    petals(12, 0.2, 0.66, 0.13, pcss(P, 'text'));
    petals(12, 0.22, 0.63, 0.11, pcss(P, 'hi'));
    petals(12, 0.25, 0.5, 0.055, pcss(P, 'ground'));
    petals(8, 0.1, 0.4, 0.1, pcss(P, 'text'), Math.PI / 12);
    petals(8, 0.11, 0.38, 0.085, pcss(P, 'deep'), Math.PI / 12);
    disc(0.16, pcss(P, 'text'));
    disc(0.13, pcss(P, 'hi'));
    disc(0.06, pcss(P, 'mid'));
    return cv;
  }

  /** Lock time of ring r (1..CLOSE: beats 1..6, outer first; 0 = the medallion, beat 7). */
  private lockT(r: number) {
    const k = r === 0 ? 7 : CLOSE + 1 - r;
    return this.beats[k] ?? this.ctx.start + k * 0.5827;
  }

  private renderVault(t: number, cam: Cam, u: number): PostOverrides {
    const { audio } = this.ctx;
    const P = this.P, L = this.layer, c = L.ctx;
    const bp = beatPulse(audio, t, 0.14), db = downbeatPulse(audio, t, 0.3), kp = kickPulse(audio, t, 0.1);
    const C3 = this.vaultCam(cam, u, bp, t);
    const spin = 0.035 * (t - this.ctx.start); // the vault turns slowly about the zenith
    const start = this.ctx.start, end = this.ctx.end;

    L.clear(pcss(P, 'ground'));

    // ---- the Sun beyond the oculus (continues p41's disc: r = R_SUN at the anchor in the first frame)
    const zp = proj(C3, ZEN);
    const tMed = this.lockT(0);
    if (zp && t < tMed + 0.05) {
      const k = C3.f / this.fUp;
      const rc = R_SUN * k; // the disc itself holds its size (match cut); the glare carries the beat
      c.setTransform(1, 0, 0, 1, 0, 0);
      // the glare: flat rings stepping down toward the sunlit white
      for (let i = 4; i >= 1; i--) {
        c.beginPath(); c.arc(zp[0], zp[1], rc * (1 + 0.28 * i + 0.25 * bp), 0, TAU);
        c.fillStyle = pmix(P, 'ground', 'hi', 0.18 * (5 - i) * (0.8 + 0.4 * bp)); c.fill();
      }
      c.beginPath(); c.arc(zp[0], zp[1], rc, 0, TAU); c.fillStyle = pcss(P, 'signal'); c.fill();
      c.beginPath(); c.arc(zp[0], zp[1], rc * 0.8, 0, TAU); c.fillStyle = pmix(P, 'signal', 'hi', 0.7); c.fill();
    }

    // ---- the medallion: lowered over the Sun, landing on beat 7
    if (t > tMed - 0.34) {
      const tl = tMed;
      const pre = clamp((t - (tl - 0.34)) / 0.34);
      const s = t < tl ? lerp(0.25, 1, ease.inCubic(pre)) : 1 + 0.06 * Math.sin(Math.min(Math.PI, ((t - tl) / 0.12) * Math.PI)) * Math.exp(-(t - tl) / 0.14);
      const P0 = proj(C3, ZEN), P1 = proj(C3, add(ZEN, mul(EX, A0 * s))), P2 = proj(C3, add(ZEN, mul(EZ, A0 * s)));
      if (P0 && P1 && P2) {
        const rot = spin * 2;
        const ax = [P1[0] - P0[0], P1[1] - P0[1]], ay = [P2[0] - P0[0], P2[1] - P0[1]];
        const cs = Math.cos(rot), sn = Math.sin(rot);
        const bx = [ax[0]! * cs + ay[0]! * sn, ax[1]! * cs + ay[1]! * sn], by = [ay[0]! * cs - ax[0]! * sn, ay[1]! * cs - ax[1]! * sn];
        c.setTransform(bx[0]!, bx[1]!, by[0]!, by[1]!, P0[0], P0[1]);
        const paint = t < tl ? 0 : clamp((t - tl) / 0.16);
        if (paint < 1) { c.beginPath(); c.arc(0, 0, 1, 0, TAU); c.fillStyle = pcss(P, 'text'); c.fill(); c.beginPath(); c.arc(0, 0, 0.95, 0, TAU); c.fillStyle = pcss(P, 'ground'); c.fill(); }
        c.globalAlpha = paint;
        c.drawImage(this.medal, -1, -1, 2, 2);
        c.globalAlpha = 1;
        const fl = t < tl ? 0 : Math.exp(-(t - tl) / 0.09);
        if (fl > 0.01) { c.beginPath(); c.arc(0, 0, 1, 0, TAU); c.fillStyle = pcss(P, 'hi', 0.85 * fl); c.fill(); }
      }
    }

    // ---- rings, inner to outer (an incoming ring slides in under the ring outside it)
    // v4 (palette 'swarm', dark vault): the already-locked vault stays in shadow (VAULT_DIM over the dark ground);
    // only the rings that close on this plate's beats are lit, and they stay lit — no light flood
    for (let r = 1; r <= NR; r++) {
      const base = r > CLOSE ? VAULT_DIM : 1;
      c.globalAlpha = base;
      if (BEAMS.has(r)) { this.drawBeam(c, C3, r, spin, r === CLOSE + 1 ? bp : 0); continue; }
      const tl = r <= CLOSE ? this.lockT(r) : -Infinity;
      if (t < tl - 0.3) continue;
      let th = ringTh(r), twist = 0, paint = 1, flash = 0;
      if (r <= CLOSE) {
        if (t < tl) {
          const pu = ease.inCubic(clamp((t - (tl - 0.3)) / 0.3)); // accelerate INTO the beat, land exactly on it
          th += DR * 0.95 * (1 - pu);
          twist = 0.22 * (1 - pu);
          paint = 0;
        } else {
          const a = t - tl;
          th -= DR * 0.14 * Math.sin(Math.min(Math.PI, (a / 0.1) * Math.PI)) * Math.exp(-a / 0.12); // overshoot
          paint = clamp(a / 0.15);
          flash = Math.exp(-a / 0.1);
        }
      }
      const n = ringN(r);
      const rho = DR * 0.53;
      for (let i = 0; i < n; i++) {
        const ph = ((i + (r % 2) * 0.5) / n) * TAU + spin + twist + r * 0.05;
        const X = sph(th, ph, ZEN, EX, EZ);
        const eTh: V = [Math.cos(th) * Math.cos(ph), -Math.sin(th), Math.cos(th) * Math.sin(ph)];
        const ePh: V = [-Math.sin(ph), 0, Math.cos(ph)];
        const p0 = proj(C3, X);
        if (!p0) continue;
        const p1 = proj(C3, add(X, mul(ePh, rho))), p2 = proj(C3, add(X, mul(eTh, rho)));
        if (!p1 || !p2) continue;
        const jx = [p1[0] - p0[0], p1[1] - p0[1]], jy = [p2[0] - p0[0], p2[1] - p0[1]];
        const sz = Math.hypot(jx[0]!, jx[1]!) + Math.hypot(jy[0]!, jy[1]!);
        if (sz > 2600 || p0[0] < -sz || p0[0] > W + sz || p0[1] < -sz || p0[1] > H + sz) continue;
        c.setTransform(jx[0]!, jx[1]!, jy[0]!, jy[1]!, p0[0], p0[1]);
        if (paint < 1) this.bareHex(c);
        if (paint > 0) {
          // v4 fix (p42 end): the newest rings land dimmer (in the shell's shadow) so the sealed vault stays a dark ground
          c.globalAlpha = paint * base * (r >= CLOSE - 2 ? 0.5 : r >= CLOSE - 4 ? 0.75 : 1);
          c.drawImage(this.sprites[motifOf(r, i)]!, -1, -1, 2, 2);
          c.globalAlpha = base;
        }
        if (flash > 0.01) {
          this.hexPath(c, 1);
          c.fillStyle = pcss(P, i % 2 ? 'hi' : 'signal', 0.9 * flash);
          c.fill();
        }
      }
    }
    c.globalAlpha = VAULT_DIM;
    this.drawRafters(c, C3, t, spin);
    c.globalAlpha = 1;
    c.setTransform(1, 0, 0, 1, 0, 0);
    L.upload();

    // hits: on each lock a luminance bump and a small punch; the cut frames stay exactly on the anchor
    const locks = [1, 2, 3, 4, 5, 6, 0].map((r) => this.lockT(r));
    let hit = 0;
    for (const tl of locks) if (t >= tl) hit = Math.max(hit, Math.exp(-(t - tl) / 0.1));
    const edge = t - start < 2.5 / 60 || end - t < 2.5 / 60;
    const med = t >= tMed ? Math.exp(-(t - tMed) / 0.14) : 0;
    return {
      bloom: 0,
      exposure: 1 + 0.06 * hit + 0.04 * db + 0.03 * kp,
      flash: 0.1 * med,
      zoom: edge ? 1 : 1 + 0.012 * hit + 0.02 * med,
      shake: edge ? [0, 0] : [3 * hit * Math.sin(t * 91), 2 * hit * Math.cos(t * 77)],
      vignette: 0.1,
      ca: 0.2,
      grain: 0.03,
    };
  }

  /** Painted rafters: timber ribs over the locked vault, converging on the oculus; their inner ends follow the closing. */
  private drawRafters(c: Ctx2, C3: Cam3, t: number, spin: number) {
    const P = this.P;
    let rmin = CLOSE + 1;
    for (let r = CLOSE; r >= 1; r--) if (t >= this.lockT(r)) rmin = r;
    const th0 = t >= this.lockT(0) ? A0 * 0.98 : A0 + (rmin - 1) * DR;
    const th1 = A0 + NR * DR;
    c.setTransform(1, 0, 0, 1, 0, 0);
    const strip = (ph: number, a: number, b: number, hw: number, fill: string) => {
      const L: [number, number][] = [], R: [number, number][] = [];
      const n = 28;
      for (let i = 0; i <= n; i++) {
        const th = lerp(a, b, i / n), dp = hw / Math.max(0.05, Math.sin(th));
        const p = proj(C3, sph(th, ph - dp, ZEN, EX, EZ)), q = proj(C3, sph(th, ph + dp, ZEN, EX, EZ));
        if (!p || !q) continue;
        L.push([p[0], p[1]]); R.push([q[0], q[1]]);
      }
      if (L.length < 2) return;
      c.beginPath();
      for (const p of L) c.lineTo(p[0], p[1]);
      for (let i = R.length - 1; i >= 0; i--) c.lineTo(R[i]![0], R[i]![1]);
      c.closePath(); c.fillStyle = fill; c.fill();
    };
    const NRAF = 16;
    for (let k = 0; k < NRAF; k++) {
      const ph = (k / NRAF) * TAU + spin + 0.11;
      strip(ph, th0, th1, 0.034, pcss(P, 'text'));
      strip(ph, th0 + 0.004, th1, 0.028, pmix(P, 'deep', 'text', 0.2));
      strip(ph, th0 + 0.004, th1, 0.006, pcss(P, 'hi'));
      // the painted head (머리초) at the inner end: red, white, gold, white bands
      const hd: [number, number, Role][] = [[0, 0.05, 'mid'], [0.05, 0.062, 'ground'], [0.062, 0.09, 'hi'], [0.09, 0.1, 'ground'], [0.1, 0.13, 'mid']];
      for (const [a, b, role] of hd) strip(ph, th0 + 0.004 + a, th0 + 0.004 + b, 0.028, pcss(P, role));
    }
  }

  private hexPath(c: Ctx2, r: number) {
    c.beginPath();
    for (let k = 0; k < 6; k++) { const a = Math.PI / 2 + (k * Math.PI) / 3; c.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
    c.closePath();
  }
  /** An unpainted panel: black rim, white plaster face. */
  private bareHex(c: Ctx2) {
    this.hexPath(c, 1); c.fillStyle = pcss(this.P, 'text'); c.fill();
    this.hexPath(c, 0.9); c.fillStyle = pcss(this.P, 'ground'); c.fill();
  }

  /** A painted ring beam: graded bands with white lines, gold stamps every 7.5°. */
  private drawBeam(c: Ctx2, C3: Cam3, r: number, spin: number, bp: number) {
    const P = this.P;
    const t0 = A0 + (r - 1) * DR, t1 = A0 + r * DR;
    const N = 120;
    const ring = (th: number) => {
      const out: [number, number][] = [];
      for (let i = 0; i <= N; i++) {
        const p = proj(C3, sph(th, (i / N) * TAU, ZEN, EX, EZ));
        if (p) out.push([p[0], p[1]]);
      }
      return out;
    };
    const bands: [number, number, string][] = [
      [0, 0.08, pcss(P, 'text')], [0.08, 0.28, pcss(P, 'deep')], [0.28, 0.34, pcss(P, 'ground')], [0.34, 0.66, pcss(P, 'mid')],
      [0.66, 0.72, pcss(P, 'ground')], [0.72, 0.92, pmix(P, 'deep', 'text', 0.4)], [0.92, 1, pcss(P, 'text')],
    ];
    c.setTransform(1, 0, 0, 1, 0, 0);
    for (const [a, b, col] of bands) {
      const inner = ring(lerp(t0, t1, a)), outer = ring(lerp(t0, t1, b));
      if (inner.length < 3 || outer.length < 3) continue;
      c.beginPath();
      c.moveTo(outer[0]![0], outer[0]![1]);
      for (const p of outer) c.lineTo(p[0], p[1]);
      for (let i = inner.length - 1; i >= 0; i--) c.lineTo(inner[i]![0], inner[i]![1]);
      c.closePath();
      c.fillStyle = col; c.fill();
    }
    // gold stamps (diamonds) along the red band, alternating with white; they flash on the beat on the oculus beam
    const tm = lerp(t0, t1, 0.5), hw = (t1 - t0) * 0.15;
    const M = 48;
    for (let i = 0; i < M; i++) {
      const ph = (i / M) * TAU + spin * 0.5 + r * 0.1;
      const dp = (TAU / M) * 0.3;
      const q = [proj(C3, sph(tm - hw, ph, ZEN, EX, EZ)), proj(C3, sph(tm, ph + dp, ZEN, EX, EZ)), proj(C3, sph(tm + hw, ph, ZEN, EX, EZ)), proj(C3, sph(tm, ph - dp, ZEN, EX, EZ))];
      if (q.some((p) => !p)) continue;
      c.beginPath();
      for (const p of q) c.lineTo(p![0], p![1]);
      c.closePath();
      c.fillStyle = i % 2 ? pcss(P, 'ground') : pmix(P, 'hi', 'signal', 0.6 * bp);
      c.fill();
    }
  }

  // ================================================================== pullback
  private initOut() {
    this.fOut = R_SEAL / Math.tan(Math.asin(1 / D0));
    // stars: placed by unprojecting chosen screen points through the camera of the moment they matter
    const au = this.ctx.audio;
    const bs = this.beats;
    const heroes: [number, number, number, number][] = [
      // beat, screen x, y, depth
      [1, 520, 300, 30], [2, 1560, 250, 26], [3, 620, 230, 24], [4, 1580, 760, 22], [5, 360, 700, 40], [6, 830, 250, 70], [7, 1500, 610, 90],
    ];
    for (const [k, x, y, d] of heroes) {
      const tb = bs[k] ?? this.ctx.start + k * 0.58;
      const cam = stateAt(this.list, tb).cam as Cam;
      const sh = shotAt(this.list, tb);
      const C3 = this.outCam(cam, this.shotU(tb, sh.t0, sh.t1));
      this.stars.push({ X: this.unproj(C3, x, y, d), b: 1, tOff: tb, hero: true, rw: (20 * d) / C3.f });
    }
    // the field: sparse, placed for the wide shot; each goes dark on one of the last four beats
    const wide = this.outCam('wide', 0);
    for (let i = 0; i < 46; i++) {
      const x = 60 + hash(i, 1) * 1800, y = 50 + hash(i, 2) * 980;
      if (Math.hypot(x - AX, y - AY) < 90) continue;
      const k = 4 + (i % 4);
      this.stars.push({ X: this.unproj(wide, x, y, 60 + 180 * hash(i, 3)), b: 0.35 + 0.65 * hash(i, 4) ** 2, tOff: (bs[k] ?? this.ctx.start + k * 0.58) + 0.04 * hash(i, 5), hero: false, rw: 0.12 });
    }
    void au;
  }

  private unproj(c: Cam3, x: number, y: number, z: number): V {
    return add(c.C, add(mul(c.w, z), add(mul(c.u, ((x - c.px) / c.f) * z), mul(c.v, (-(y - c.py) / c.f) * z))));
  }

  private shotU(t: number, t0: number, t1: number) {
    const e = t1 === Infinity ? this.ctx.end : t1;
    return clamp((t - t0) / Math.max(0.05, e - t0));
  }

  private outCam(cam: Cam, u: number): Cam3 {
    const Y: V = [0, 1, 0];
    const dir0: V = norm([0.18, 0.3, 1]);
    switch (cam) {
      case 'graze': { // skimming the sealed surface: the horizon of panels curves across the lower frame
        const C: V = [0.15 - 0.25 * u, 1.3, 0.78 + 0.1 * u];
        return lookAt(C, [-0.6, 0.55, -6], Y, 0.12, this.fOut * 1.55, 960, 520);
      }
      case 'pull': { // the pull-back: fast off the mark, then easing out
        const D = lerp(5, 17, ease.outCubic(u) * 0.7 + 0.3 * u);
        return lookAt(mul(norm([0.3, 0.26, 1]), D), [0, 0, 0], Y, 0, this.fOut, AX, AY);
      }
      case 'wide': {
        const D = lerp(30, 46, u);
        return lookAt(mul(norm([0.34, 0.24, 1]), D), [0, 0, 0], Y, 0, this.fOut, AX, AY);
      }
      default: // close: the first frame at D0 exactly (sphere r = R_SEAL at the anchor), then a slow push
        return lookAt(mul(dir0, D0 - 0.25 * u), [0, 0, 0], Y, 0, this.fOut, AX, AY);
    }
  }

  private renderOut(t: number, cam: Cam, u: number): PostOverrides {
    const { audio } = this.ctx;
    const P = this.P, L = this.layer, c = L.ctx;
    const start = this.ctx.start, end = this.ctx.end;
    const bp = beatPulse(audio, t, 0.14), kp = kickPulse(audio, t, 0.12), db = downbeatPulse(audio, t, 0.3);
    const C3 = this.outCam(cam, u);
    L.clear(pcss(P, 'ground'));
    c.setTransform(1, 0, 0, 1, 0, 0);
    // v4 fix: the star clouds behind the sphere go dark in HELD bands, one band per beat (outer edges first, closing on
    // the anchor), so every beat removes ~1/7 of the lit sky and the plate ends on a black field
    const ORDER = [0, 6, 1, 5, 2, 4, 3], BW = W / 7;
    c.save();
    for (let k = 0; k < 7; k++) {
      const tk = this.beats[k + 1] ?? end;
      if (t >= tk) continue;
      const x0 = ORDER[k]! * BW;
      c.globalAlpha = 0.17; c.fillStyle = pcss(P, 'text'); c.fillRect(x0, 0, BW, H);
      c.globalAlpha = 0.9;
      for (let i = 0; i < 70; i++) {
        const r = 0.8 + 1.8 * hash(k, i, 3) ** 3;
        c.beginPath(); c.arc(x0 + hash(k, i, 1) * BW, hash(k, i, 2) * H, r, 0, Math.PI * 2); c.fill();
      }
    }
    c.restore();

    // ---- stars (and the shells that close over them), far to near
    const sorted = this.stars
      .map((s) => ({ s, p: proj(C3, s.X) }))
      .filter((o) => o.p && o.p[0] > -60 && o.p[0] < W + 60 && o.p[1] > -60 && o.p[1] < H + 60)
      .sort((a, b) => b.p![2] - a.p![2]);
    for (const { s, p } of sorted) this.drawStar(c, s, p!, C3, t, kp);

    // ---- the sealed sphere
    this.drawSphere(c, C3, t, kp);
    L.upload();

    const edge = t - start < 2.5 / 60 || end - t < 2.5 / 60;
    let hit = 0;
    for (let k = 1; k < this.beats.length; k++) if (t >= this.beats[k]!) hit = Math.max(hit, Math.exp(-(t - this.beats[k]!) / 0.1));
    return {
      bloom: 0,
      exposure: 1 + 0.05 * hit + 0.03 * db,
      zoom: edge ? 1 : 1 + 0.01 * hit,
      shake: edge ? [0, 0] : [2 * hit * Math.sin(t * 83), 2 * hit * Math.cos(t * 71)],
      vignette: 0.22,
      ca: 0.3,
      grain: 0.04,
      flash: 0,
      fade: 0.25 * clamp((t - (end - 0.35)) / 0.35),
    } satisfies PostOverrides;
  }

  private drawStar(c: Ctx2, s: { X: V; b: number; tOff: number; hero: boolean; rw: number }, p: [number, number, number], C3: Cam3, t: number, kp: number) {
    const P = this.P;
    const [x, y, z] = p;
    const rs = Math.max(s.hero ? 5 : 1.6, (C3.f * s.rw) / z); // the star's own shell, on screen
    const close = s.hero ? 0.36 : 0.18;
    const u = clamp((t - (s.tOff - close)) / close); // 0 open .. 1 shut (lands on its beat)
    const lit = t < s.tOff;
    const tw = 0.85 + 0.15 * Math.sin(t * 9 + s.X[0] * 3) + 0.3 * kp * s.b;
    if (lit) {
      // the star: stepped glow + core
      const g = rs * (s.hero ? 2.4 : 2.6);
      for (let i = 3; i >= 1; i--) {
        c.beginPath(); c.arc(x, y, g * (i / 3) * (1 + 0.2 * kp), 0, TAU);
        c.fillStyle = pcss(P, i === 1 ? 'hi' : 'mid', (i === 1 ? 0.9 : 0.12) * s.b * tw); c.fill();
      }
      if (u > 0) {
        // the iris of panels closing over it: a dark disc with a shrinking wedge of light
        const gap = Math.PI * 2 * (1 - ease.inCubic(u));
        const a0 = hash(s.tOff) * TAU;
        c.beginPath(); c.moveTo(x, y); c.arc(x, y, rs, a0 + gap / 2, a0 - gap / 2 + TAU); c.closePath();
        c.fillStyle = pcss(P, 'deep'); c.fill();
        c.beginPath(); c.arc(x, y, rs, a0 + gap / 2, a0 - gap / 2 + TAU);
        c.strokeStyle = pcss(P, 'mid', 0.9); c.lineWidth = Math.max(1, rs * 0.12); c.stroke();
      }
    } else {
      const a = t - s.tOff;
      // locked: a dark sphere, key-lit crescent, and a ring flash on the lock
      c.beginPath(); c.arc(x, y, rs, 0, TAU); c.fillStyle = pmix(P, 'mid', 'deep', 0.35); c.fill();
      c.beginPath(); c.arc(x + rs * 0.22, y + rs * 0.18, rs * 0.94, 0, TAU); c.fillStyle = pcss(P, 'deep'); c.fill();
      if (a < 0.5) {
        const fl = Math.exp(-a / 0.12);
        c.beginPath(); c.arc(x, y, rs * (1.2 + 3 * a / 0.5), 0, TAU);
        c.strokeStyle = pmix(P, 'hi', 'signal', 0.3 * fl, fl * (s.hero ? 0.9 : 0.5)); c.lineWidth = Math.max(1.5, rs * 0.25 * (1 - a)); c.stroke();
      }
    }
  }

  private drawSphere(c: Ctx2, C3: Cam3, t: number, kp: number) {
    const P = this.P;
    const start = this.ctx.start;
    const cp = proj(C3, [0, 0, 0]);
    if (!cp) return;
    // the true silhouette: the circle of tangency seen from the camera, projected (exact off-axis and up close)
    const Dc = Math.hypot(...C3.C);
    const cn = norm(C3.C), s1 = norm(cross(cn, Math.abs(cn[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0])), s2 = cross(cn, s1);
    const sc = mul(cn, 1 / Dc), sr = Math.sqrt(Math.max(0, 1 - 1 / (Dc * Dc)));
    const sil: [number, number][] = [];
    for (let i = 0; i < 72; i++) {
      const a = (i / 72) * TAU;
      const q = proj(C3, add(sc, add(mul(s1, sr * Math.cos(a)), mul(s2, sr * Math.sin(a)))));
      if (q) sil.push([q[0], q[1]]);
    }
    const silPath = () => { c.beginPath(); for (const q of sil) c.lineTo(q[0], q[1]); c.closePath(); };
    const R = (C3.f / cp[2]) * (1 / Math.sqrt(Math.max(1e-4, 1 - 1 / (Dc * Dc))));
    // the trapped Sun leaks through the seams, and dies within the first bar; kicks re-ignite it faintly
    const age = t - start;
    const leak = Math.exp(-age / 0.55) + 0.35 * kp * Math.exp(-age / 1.4);
    const seam = leak > 0.06 ? pmix(P, 'ground', 'signal', clamp(leak * (0.75 + 0.25 * kp))) : pmix(P, 'ground', 'mid', 0.25 + 0.6 * kp);
    silPath(); c.fillStyle = seam; c.fill();
    if (R < 3) return;
    const V2C = norm(C3.C);
    const spin = 0.05 * age;
    const rings = Math.ceil((Math.PI - SA0) / SDR);
    const drawFacet = (n: V, e1: V, e2: V, rho: number, sides: number, rot: number) => {
      const X = n; // unit sphere
      const toCam = norm(sub(C3.C, X));
      if (dot(n, toCam) < 0.02) return;
      const pts: [number, number][] = [];
      for (let k = 0; k < sides; k++) {
        const a = rot + (k / sides) * TAU;
        const q = proj(C3, add(X, add(mul(e1, Math.cos(a) * rho), mul(e2, Math.sin(a) * rho))));
        if (!q) return;
        pts.push([q[0], q[1]]);
      }
      const lam = Math.max(0, dot(n, KEY));
      const fres = Math.pow(1 - clamp(dot(n, toCam)), 3);
      const h = norm(add(KEY, toCam));
      const spec = Math.pow(Math.max(0, dot(n, h)), 40);
      c.beginPath();
      for (const q of pts) c.lineTo(q[0], q[1]);
      c.closePath();
      c.fillStyle = pmix(P, 'deep', 'mid', clamp(0.04 + 0.9 * Math.pow(lam, 1.3) + 0.25 * fres * lam));
      c.fill();
      if (spec > 0.04) { c.fillStyle = pcss(P, 'hi', clamp(spec * 0.8)); c.fill(); }
    };
    // pole medallion (faces the first camera)
    drawFacet(SAX, SE1, SE2, SA0 * 0.9, 24, 0);
    for (let r = 1; r <= rings; r++) {
      const th = SA0 + (r - 0.5) * SDR;
      if (th > Math.PI - 0.05) break;
      const n = Math.max(6, Math.round((TAU * Math.sin(th)) / (SDR * 1.02)));
      for (let i = 0; i < n; i++) {
        const ph = ((i + (r % 2) * 0.5) / n) * TAU + spin;
        const nn = sph(th, ph, SAX, SE1, SE2);
        const eTh = norm(sub(sph(th + 0.01, ph, SAX, SE1, SE2), nn));
        const ePh = norm(cross(nn, eTh));
        if (dot(nn, V2C) < -0.2) continue;
        drawFacet(nn, ePh, eTh, SDR * 0.5, 6, Math.PI / 2);
      }
    }
    // the terminator side: the cold rim light on the silhouette
    silPath();
    c.strokeStyle = pcss(P, 'hi', 0.14 + 0.2 * kp); c.lineWidth = Math.max(1, R * 0.012); c.stroke();
  }

  // ================================================================== frame
  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const t = f.t;
    const cam = stateAt(this.list, t).cam as Cam;
    const sh = shotAt(this.list, t);
    const u = this.shotU(t, sh.t0, sh.t1);
    const post = this.plate.variant === 'dancheong' ? this.renderVault(t, cam, u) : this.renderOut(t, cam, u);
    clearRT(this.ctx.renderer, out, plin(this.P, 'ground'));
    this.ctx.comp.draw(this.ctx.renderer, this.layer.texture, out, { mode: 'normal' });
    return post;
  }

  override dispose() { this.layer?.texture.dispose(); }
}
