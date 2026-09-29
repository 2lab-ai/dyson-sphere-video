// THERMAL — machines and steam seen by a thermal camera (idiom S1, after Richard Mosse's "Incoming").
// Heat is the image. Nothing here is a line drawing: the scene draws a scalar TEMPERATURE field (additive alpha)
// into a low-res "sensor" buffer (~576x324, like a microbolometer), and one shader pass turns it into the picture:
// heat diffusion (blur), the thermal unsharp halo (the dark ring around hot bodies), automatic gain control
// (when something gets very hot, the rest of the frame drops), static sensor fixed-pattern noise + a little
// temporal noise, and the named `thermal` palette as an ironbow LUT ground -> deep -> mid -> hi -> text.
//   steam (p36)
//     close / gears     a clockwork gear train, tight. The train TICKS on every beat (escapement snap) and the
//                       meshing teeth flare with friction heat; the whole train glows a step hotter per bar.
//     train / linkage   (extra, beat 3) pull back: the gears turn a crank, the connecting rod and rocker carry the
//                       motion across the frame into a steam cylinder (the piston snaps through a stroke per beat).
//     side / pistons    (+1 bar) the motion carries on, now continuous steam: side on the loco's running gear —
//                       cylinder, piston rod, crosshead, main rod, coupling rod, driving wheels. One wheel half-turn
//                       per beat, so a piston reaches a dead centre ON every beat and flares white-hot; the exhaust
//                       chuffs from the chimney on every beat.
//     wide / loco       (extra, beat 3) the whole locomotive thunders through, left to right, rails hot under the
//                       wheels. Exit: the loco's heat blooms white (local: firebox + boiler saturate, AGC crushes the
//                       rest of the frame toward the cold ground — the frame edges stay dark).
// One shared phase drives gears, crank, rods and wheels, so the motion carries across every cut.
import * as THREE from 'three';
import { Scene, type Frame, type PostOverrides } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { palette, pcss, plin, type NamedPalette } from '../engine/palette';
import type { AudioData } from '../engine/audio';
import { beatPulse, downbeatPulse, kickPulse, beatIndex, barIndex } from '../engine/beat';
import { shotAt, type PlateInfo, type Shot } from '../engine/shots';
import { clamp, smoothstep, ease, hash, TAU } from '../engine/util';
import { shots } from './thermal.shots';

type C2 = CanvasRenderingContext2D;
type Cam = { cx: number; cy: number; s: number; rot: number };

const DS = 0.25; // sensor buffer scale (480x270, a microbolometer-class sensor)
const RAIL_Y = 830; // world y of the rail top
const WHEEL_R = 95; // driving wheel radius (loco space)

const FRAG = /* glsl */ `
uniform sampler2D uTemp;
uniform vec2 uRes, uTex;
uniform float uTime, uLo, uGam, uBoost, uSens;
uniform vec3 uG, uD, uM, uHi, uTx;

float tmp(vec2 uv) { return texture(uTemp, uv).a; }
vec3 ironbow(float v) {
  vec3 c = mix(uG, uD, smoothstep(0.02, 0.30, v));
  c = mix(c, uM, smoothstep(0.26, 0.56, v));
  c = mix(c, uHi, smoothstep(0.52, 0.80, v));
  c = mix(c, uTx, smoothstep(0.78, 1.00, v));
  return c * (1.0 + 1.4 * max(v - 1.0, 0.0));
}
void main() {
  vec2 uv = vUv;
  vec2 px = vec2(uv.x, 1.0 - uv.y) * uRes;
  // near: centre + 4 taps at one sensor texel (heat never has a hard edge)
  vec2 e = uTex * 1.4;
  float tn = 0.28 * tmp(uv);
  tn += 0.12 * (tmp(uv + vec2(e.x, 0.0)) + tmp(uv - vec2(e.x, 0.0)) + tmp(uv + vec2(0.0, e.y)) + tmp(uv - vec2(0.0, e.y)));
  tn += 0.06 * (tmp(uv + e) + tmp(uv - e) + tmp(uv + vec2(e.x, -e.y)) + tmp(uv - vec2(e.x, -e.y)));
  // wide: two rings of 8 (diffusion + the thermal halo)
  float tw = 0.0;
  for (int i = 0; i < 8; i++) {
    float a = float(i) * 0.785398 + 0.39;
    vec2 dir = vec2(cos(a), sin(a)) * uTex;
    tw += tmp(uv + dir * 4.0) + tmp(uv + dir * 10.0);
  }
  tw /= 16.0;
  float v = max(tn + 0.4 * (tn - tw), 0.0) + 0.3 * tw;
  // sensor: static fixed-pattern noise (column / row / pixel, in sensor px) + temporal noise at 30 fps
  vec2 sp = floor(px * uSens);
  float fpn = (hash11(sp.x * 1.37 + 3.1) - 0.5) * 0.02 + (hash11(sp.y * 2.11 + 7.7) - 0.5) * 0.008 + (hash12(sp) - 0.5) * 0.016;
  float tno = (hash12(sp + floor(uTime * 30.0) * 17.31) - 0.5) * 0.022;
  // automatic gain control, then the detector's cos^4-like falloff
  v = pow(clamp((v - uLo) / (1.0 - uLo), 0.0, 1.0), uGam) * uBoost;
  vec2 q = (px - 0.5 * uRes) / uRes.y;
  v = v * (1.0 - 0.2 * dot(q, q)) + (fpn + tno) * step(0.015, v);
  fragColor = vec4(max(ironbow(v), 0.0), 1.0);
}`;

export default class Thermal extends Scene {
  private P!: NamedPalette;
  private buf!: Layer2D;
  private pass!: FSPass;
  private list: Shot[] = [];
  private plate!: PlateInfo;
  private i0 = 0;
  private b0 = 0; // first bar index
  private tSteam = 0; // the storyboard +1 bar cut: clockwork -> continuous steam
  private speed = 0; // loco speed, loco-space px / s (no wheel slip)
  private flr = 1; // flare radius scale (bigger when the camera is wide)

  override init() {
    this.plate = this.ctx.params as PlateInfo;
    this.P = palette(this.ctx.params.look?.palette ?? 'thermal');
    this.list = shots(this.plate, this.ctx.audio);
    const au = this.ctx.audio;
    this.i0 = beatIndex(au, this.ctx.start + 1e-3);
    this.b0 = barIndex(au, this.ctx.start + 1e-3);
    this.tSteam = this.list.find((s) => s.s.subject === 'pistons')?.t ?? (this.ctx.start + this.ctx.end) / 2;
    this.speed = (WHEEL_R * Math.PI) / (60 / au.bpm); // half a turn per beat
    this.buf = new Layer2D(W, H, DS);
    this.buf.texture.colorSpace = THREE.NoColorSpace;
    this.buf.texture.premultiplyAlpha = false;
    const P = this.P;
    const v3 = (r: 'ground' | 'deep' | 'mid' | 'hi' | 'text') => new THREE.Vector3(...plin(P, r));
    this.pass = new FSPass(FRAG, {
      uTemp: { value: this.buf.texture },
      uRes: { value: new THREE.Vector2(W, H) },
      uTex: { value: new THREE.Vector2(1 / (W * DS), 1 / (H * DS)) },
      uSens: { value: DS },
      uTime: { value: 0 }, uLo: { value: 0 }, uGam: { value: 1 }, uBoost: { value: 1 },
      uG: { value: v3('ground') }, uD: { value: v3('deep') }, uM: { value: v3('mid') }, uHi: { value: v3('hi') }, uTx: { value: v3('text') },
    });
  }

  // ------------------------------------------------------------------ timing
  private beatAt(t: number) {
    const au = this.ctx.audio as AudioData, i = beatIndex(au, t);
    const b = au.beats[i] ?? t, bl = (au.beats[i + 1] ?? b + 60 / au.bpm) - b;
    return { n: Math.max(0, i - this.i0), b, bl };
  }
  /** The shared machine phase, in beats since the plate start. Clockwork (before the steam cut): TICKS — holds,
   *  then snaps through one beat's worth of motion in ~0.16 s. Steam: continuous. Equal at every beat, so the
   *  motion carries across the cut. */
  private phase(t: number): number {
    const { n, b, bl } = this.beatAt(t);
    if (t < this.tSteam) return n + ease.outBack(clamp((t - b) / 0.16), 1.2);
    return n + clamp((t - b) / bl);
  }
  /** World x of the loco's origin (a single world: the tracking and the static camera see the same train). */
  private locoX(t: number): number { return this.speed * (t - this.tSteam) - 350 - this.speed * 2 * (60 / this.ctx.audio.bpm); }

  // ------------------------------------------------------------------ heat primitives (additive temperature)
  private T(a: number) { return pcss(this.P, 'text', clamp(a)); }
  /** A soft heat blob: radial falloff from `a` at the centre to 0 at r. */
  private blob(c: C2, x: number, y: number, r: number, a: number) {
    if (a <= 0.004 || r <= 0) return;
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, this.T(a)); g.addColorStop(0.45, this.T(a * 0.45)); g.addColorStop(1, this.T(0));
    c.fillStyle = g;
    c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill();
  }
  private disc(c: C2, x: number, y: number, r: number, a: number) {
    c.fillStyle = this.T(a); c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill();
  }
  private rod(c: C2, x1: number, y1: number, x2: number, y2: number, w: number, a: number) {
    c.strokeStyle = this.T(a); c.lineWidth = w; c.lineCap = 'round';
    c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke();
  }
  private box(c: C2, x0: number, y0: number, x1: number, y1: number, a: number) {
    c.fillStyle = this.T(a); c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y0); c.lineTo(x1, y1); c.lineTo(x0, y1); c.closePath(); c.fill();
  }
  private ring(c: C2, x: number, y: number, r: number, w: number, a: number) {
    c.strokeStyle = this.T(a); c.lineWidth = w; c.beginPath(); c.arc(x, y, r, 0, TAU); c.stroke();
  }

  /** A gear as heat: a warm toothed rim band, spokes, a hotter hub and a hot axle bearing. */
  private gear(c: C2, x: number, y: number, r: number, teeth: number, rot: number, a: number) {
    const td = Math.max(8, r * 0.13), n = teeth * 4;
    c.strokeStyle = this.T(a * 0.85); c.lineWidth = r * 0.16; c.lineJoin = 'round';
    c.beginPath();
    for (let i = 0; i <= n; i++) {
      const ph = i % 4, ang = rot + (i / n) * TAU;
      const rr = ph === 1 || ph === 2 ? r + td * 0.5 : r - td * 0.6;
      const px = x + rr * Math.cos(ang), py = y + rr * Math.sin(ang);
      if (i === 0) c.moveTo(px, py); else c.lineTo(px, py);
    }
    c.stroke();
    // big wheels are spoked; pinions are solid (warm all over)
    const sp = teeth > 14 ? 5 : 0;
    if (!sp) this.disc(c, x, y, r * 0.84, a * 0.55);
    for (let k = 0; k < sp; k++) {
      const an = rot * 1 + (k / sp) * TAU + 0.3;
      this.rod(c, x + Math.cos(an) * r * 0.2, y + Math.sin(an) * r * 0.2, x + Math.cos(an) * r * 0.86, y + Math.sin(an) * r * 0.86, r * 0.1, a * 0.85);
    }
    this.blob(c, x, y, r * 1.05, a * 0.3); // the body's own heat haze
    this.disc(c, x, y, r * 0.24, a * 1.1);
    this.blob(c, x, y, r * 0.3, a * 0.9 + 0.12);
  }
  /** Friction heat where two gears mesh (the contact point on the line of centres). */
  private mesh(c: C2, ax: number, ay: number, ar: number, bx: number, by: number, a: number) {
    const d = Math.hypot(bx - ax, by - ay), k = ar / d;
    this.blob(c, ax + (bx - ax) * k, ay + (by - ay) * k, 55 + 25 * a, a);
  }

  // ------------------------------------------------------------------ subjects (world coordinates)
  private room(c: C2, warm: number) {
    // cold room, a warm wall behind the machine, floor colder (thermal backgrounds are soft gradients)
    this.blob(c, 960, 380, 1100, 0.11 + warm);
    this.blob(c, 300, 900, 500, 0.05);
  }

  /** close: the clockwork train. */
  private gears(c: C2, ph: number, heat: number, fl: number) {
    const A = { x: 760, y: 560, r: 330, n: 28 }, B = { x: 1223, y: 375, r: 170, n: 14 }, Cg = { x: 1144, y: 795, r: 120, n: 10 }, D = { x: 1267, y: 119, r: 90, n: 8 };
    const E = { x: 1514, y: 481, r: 140, n: 12 }, F = { x: 1369, y: 749, r: 110, n: 9 };
    const aRot = ph * 2 * (TAU / A.n) * 0.5;
    const bRot = -aRot * (A.r / B.r) + 0.11, cRot = -aRot * (A.r / Cg.r) + 0.2, dRot = aRot * (A.r / D.r) + 0.05;
    this.room(c, 0.02 * heat);
    this.gear(c, A.x, A.y, A.r, A.n, aRot, 0.26 + heat);
    this.gear(c, B.x, B.y, B.r, B.n, bRot, 0.3 + heat);
    this.gear(c, Cg.x, Cg.y, Cg.r, Cg.n, cRot, 0.3 + heat);
    this.gear(c, D.x, D.y, D.r, D.n, dRot, 0.33 + heat);
    this.gear(c, E.x, E.y, E.r, E.n, aRot * (A.r / E.r) + 0.3, 0.3 + heat);
    this.gear(c, F.x, F.y, F.r, F.n, aRot * (A.r / F.r) + 0.1, 0.32 + heat);
    // friction: the meshing teeth flare on the tick
    const m = 0.28 + heat + 0.62 * fl;
    this.mesh(c, A.x, A.y, A.r, B.x, B.y, m);
    this.mesh(c, A.x, A.y, A.r, Cg.x, Cg.y, m * 0.95);
    this.mesh(c, B.x, B.y, B.r, D.x, D.y, m * 0.9);
    this.mesh(c, B.x, B.y, B.r, E.x, E.y, m * 0.92);
    this.mesh(c, Cg.x, Cg.y, Cg.r, F.x, F.y, m * 0.88);
    // a crank on gear F starts the linkage out of frame (the motion is going somewhere)
    const pa = Math.PI * ph, px = F.x + 60 * Math.cos(pa), py = F.y + 60 * Math.sin(pa);
    this.rod(c, px, py, 1900, 900 + 40 * Math.sin(pa), 34, 0.3 + heat);
    this.blob(c, px, py, 46, 0.5 + heat + 0.4 * fl);
  }

  /** train: gears -> crank -> connecting rod (+ rocker) -> crosshead -> piston in its cylinder. */
  private linkage(c: C2, ph: number, heat: number, fl: number, even: boolean) {
    const A = { x: 320, y: 560, r: 200, n: 17 }, G = { x: 612, y: 560, r: 92, n: 8 };
    const cr = 70, L = 470, th = Math.PI * ph;
    const gRot = th, aRot = -th * (G.r / A.r) + 0.2;
    this.room(c, 0.02 + 0.02 * heat);
    this.gear(c, A.x, A.y, A.r, A.n, aRot, 0.3 + heat);
    this.gear(c, G.x, G.y, G.r, G.n, gRot, 0.34 + heat);
    this.mesh(c, A.x, A.y, A.r, G.x, G.y, 0.3 + heat + 0.5 * fl);
    // slider-crank
    const pinX = G.x + cr * Math.cos(th), pinY = G.y + cr * Math.sin(th);
    const xh = pinX + Math.sqrt(L * L - (pinY - G.y) ** 2), yh = G.y;
    this.rod(c, pinX, pinY, xh, yh, 30, 0.34 + heat);
    this.blob(c, pinX, pinY, 40, 0.55 + heat + 0.3 * fl);
    // eccentric rod: from the crank gear's eccentric to the valve chest over the cylinder (a quarter-turn ahead)
    const exX = G.x + 30 * Math.cos(th + Math.PI / 2), exY = G.y + 30 * Math.sin(th + Math.PI / 2);
    this.rod(c, exX, exY, 1290, 452, 22, 0.28 + heat);
    this.box(c, 1290, 432, 1660, 472, 0.26 + heat); // valve chest
    // crosshead guides, crosshead, piston rod
    this.rod(c, 1000, 518, 1270, 518, 22, 0.2 + heat);
    this.rod(c, 1000, 602, 1270, 602, 22, 0.2 + heat);
    this.box(c, xh - 34, yh - 36, xh + 34, yh + 36, 0.42 + heat + 0.25 * fl);
    const xp = xh + 300;
    this.rod(c, xh, yh, xp, yh, 20, 0.4 + heat + 0.35 * fl);
    // the cylinder: a warm shell, steam-hot inside; the piston flares on the beat at whichever end it reached
    this.box(c, 1270, 470, 1700, 650, 0.18 + heat);
    this.box(c, 1270, 470, 1700, 490, 0.2); this.box(c, 1270, 630, 1700, 650, 0.2);
    this.blob(c, 1485, 560, 260, 0.2 + heat);
    this.box(c, xp - 20, 480, xp + 20, 640, 0.52 + heat + 0.45 * fl);
    const endX = even ? 1690 : 1280;
    this.blob(c, endX, 560, 150, 0.2 + 0.8 * fl);
    // steam pipe to the (off-frame) boiler
    this.rod(c, 1690, 500, 1990, 380, 44, 0.5 + heat);
  }

  /** The locomotive in loco space: origin = rail top under the middle driving wheel; faces +x. */
  private loco(c: C2, t: number, ph: number, heat: number, fl: number, even: boolean, exit: number) {
    const th = Math.PI * ph; // wheel angle (clockwise as it rolls right)
    const wy = -WHEEL_R, wheels = [-215, 0, 215];
    // tender + cab + firebox + boiler + smokebox + chimney + dome (rounded bodies: heat has no corners)
    const poly = (pts: number[], a: number) => {
      c.fillStyle = this.T(a); c.beginPath(); c.moveTo(pts[0]!, pts[1]!);
      for (let i = 2; i < pts.length; i += 2) c.lineTo(pts[i]!, pts[i + 1]!);
      c.closePath(); c.fill();
    };
    poly([-1210, -300, -1180, -330, -780, -330, -760, -300, -760, -80, -1210, -80], 0.13 + 0.35 * exit); // tender
    this.blob(c, -985, -330, 190, 0.16); // coal, warm on top
    for (const x of [-1100, -870]) { this.disc(c, x, -48, 48, 0.2); this.blob(c, x, 0, 40, 0.2 + 0.25 * fl); }
    poly([-760, -500, -430, -500, -430, -470, -470, -470, -470, -140, -740, -140, -740, -470, -760, -470], 0.18 + 0.5 * exit); // cab + roof
    this.box(c, -700, -440, -540, -340, 0.05); // cab window (cool glass)
    poly([-470, -340, -300, -350, -300, -140, -470, -120], 0.36 + heat + exit); // firebox
    this.blob(c, -520, -250, 170 + 140 * exit, 0.45 + 0.55 * exit); // the fire door glow through the cab
    this.rod(c, -300, -245, 430, -245, 190, 0.2 + 0.5 * heat + 0.78 * exit); // boiler barrel
    for (let k = 0; k < 4; k++) this.blob(c, -230 + k * 190, -190, 150 + 110 * exit, 0.1 + 0.4 * exit); // steam heat, low in the barrel
    for (let k = 0; k < 6; k++) this.rod(c, -200 + k * 110, -335, -200 + k * 110, -155, 7, 0.05); // lagging bands
    this.disc(c, 470, -245, 100, 0.2 + 0.6 * heat); // smokebox (round, hot gases)
    this.blob(c, 500, -245, 90, 0.08 + 0.2 * fl);
    poly([448, -335, 492, -335, 504, -445, 436, -445], 0.5 + heat + 0.3 * fl); // chimney, flared
    this.box(c, 426, -465, 514, -440, 0.55 + heat + 0.3 * fl);
    c.fillStyle = this.T(0.32 + heat); c.beginPath(); c.ellipse(80, -335, 55, 50, 0, Math.PI, TAU); c.fill(); // dome
    c.fillStyle = this.T(0.26 + heat); c.beginPath(); c.ellipse(260, -335, 36, 32, 0, Math.PI, TAU); c.fill(); // sand dome
    this.box(c, -300, -150, 560, -132, 0.16); // running board
    poly([560, -150, 600, -150, 690, -12, 560, -12], 0.14); // pilot (cowcatcher)
    // wheels: rim, spokes, counterweight, hub; the tyre is hot where it meets the rail
    const drawWheel = (x: number, y: number, r: number, a: number) => {
      this.ring(c, x, y, r * 0.92, r * 0.16, 0.26 + heat);
      for (let k = 0; k < 10; k++) {
        const an = th + (k / 10) * TAU;
        this.rod(c, x, y, x + Math.cos(an) * r * 0.85, y + Math.sin(an) * r * 0.85, 7, 0.12 + heat * 0.4);
      }
      if (a) this.blob(c, x + Math.cos(th + Math.PI) * r * 0.55, y + Math.sin(th + Math.PI) * r * 0.55, r * 0.35, 0.22); // counterweight
      this.disc(c, x, y, r * 0.18, 0.4 + heat);
      this.blob(c, x, 0, r * 0.55, 0.3 + 0.35 * fl);
    };
    for (const x of wheels) drawWheel(x, wy, WHEEL_R, 1);
    drawWheel(420, -52, 52, 0); drawWheel(-640, -58, 58, 0);
    // coupling rod over the crank pins (all the same phase)
    const cr = 45, pins = wheels.map((x) => [x + cr * Math.cos(th), wy + cr * Math.sin(th)] as const);
    this.rod(c, pins[0]![0], pins[0]![1], pins[2]![0], pins[2]![1], 18, 0.3 + heat + 0.2 * fl);
    for (const [x, y] of pins) this.blob(c, x, y, 26, 0.55 + heat + 0.3 * fl);
    // main rod: middle crank pin -> crosshead; piston rod -> piston in the cylinder (front, over the pony wheel)
    const L = 330, [px, py] = pins[1]!;
    const xh = px + Math.sqrt(L * L - (py - (wy - 10)) ** 2), yh = wy - 10;
    this.rod(c, px, py, xh, yh, 22, 0.34 + heat + 0.3 * fl);
    this.rod(c, 190, yh - 26, 360, yh - 26, 8, 0.2); this.rod(c, 190, yh + 26, 360, yh + 26, 8, 0.2);
    this.box(c, xh - 24, yh - 24, xh + 24, yh + 24, 0.5 + heat + 0.3 * fl);
    const xp = xh + 130;
    this.rod(c, xh, yh, xp, yh, 12, 0.46 + heat + 0.4 * fl);
    this.box(c, 360, yh - 60, 540, yh + 50, 0.2 + heat);
    this.box(c, xp - 14, yh - 52, xp + 14, yh + 42, 0.42 + heat + 0.58 * fl);
    this.blob(c, even ? 530 : 370, yh, 130 * this.flr, 0.15 + 0.85 * fl);
    this.blob(c, 470, -450, 90 * this.flr, 0.7 * fl); // the chuff leaves the chimney on the beat // the dead centre the piston just reached flares
    // cylinder cocks: a hot jet of steam forward and down on every beat
    this.blob(c, 600, -30, 90 + 120 * (1 - fl), 0.55 * fl);
    this.blob(c, 700, 10, 60 + 170 * (1 - fl), 0.35 * fl);
    // exhaust: one chuff per beat from the chimney, left behind in the air (world), rising, spreading, cooling
    const au = this.ctx.audio, bl = 60 / au.bpm, lx = this.locoX(t);
    const { n } = this.beatAt(t);
    for (let k = Math.max(0, n - 6); k <= n; k++) {
      const tk = au.beats[this.i0 + k] ?? this.plate.start + k * bl, age = t - tk;
      if (age < 0 || tk < this.tSteam - bl * 0.5) continue;
      const cx = this.locoX(tk) + 470 - lx - 40 * age, cy = -450 - 300 * age - 120 * Math.sqrt(age);
      const r = 60 + 230 * age;
      this.blob(c, cx, cy, r, 0.9 * Math.exp(-age / 0.55));
      this.blob(c, cx - r * 0.5, cy + r * 0.2, r * 0.7, 0.5 * Math.exp(-age / 0.45) * (0.6 + 0.4 * hash(k, 3)));
    }
  }

  private ground(c: C2, x0: number, x1: number) {
    // rails (cool steel), sleepers every 150 px (world-fixed, so they scroll under a tracking camera)
    this.rod(c, x0, RAIL_Y + 6, x1, RAIL_Y + 6, 14, 0.14);
    for (let x = Math.floor(x0 / 150) * 150; x < x1; x += 150) this.box(c, x - 40, RAIL_Y + 16, x + 40, RAIL_Y + 34, 0.09);
    this.blob(c, (x0 + x1) / 2, RAIL_Y + 260, 1400, 0.08); // warm ballast
  }

  // ------------------------------------------------------------------ render
  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, audio } = this.ctx;
    const t = f.t;
    const sh = shotAt(this.list, t), frame = String(sh.shot.s.frame);
    const lt = t - sh.t0;
    const bp = beatPulse(audio, t, 0.16), db = downbeatPulse(audio, t, 0.25), kp = kickPulse(audio, t, 0.1);
    const fl = Math.max(bp, 0.8 * kp);
    const ph = this.phase(t);
    const { n } = this.beatAt(t);
    const even = n % 2 === 0;
    // one step hotter per bar, a little hotter per beat
    const heat = 0.07 * Math.max(0, barIndex(audio, t) - this.b0) + 0.01 * n;
    const exit = smoothstep(this.ctx.end - 0.42, this.ctx.end - 0.02, t);

    const L = this.buf;
    L.clear();
    const c = L.ctx;
    c.globalCompositeOperation = 'lighter';

    // camera per shot (slow sensor drift, as in Mosse's long takes)
    let cam: Cam;
    const lx = this.locoX(t);
    if (frame === 'close') cam = { cx: 1290 + 14 * lt, cy: 560, s: 1.9, rot: -0.07 }; // tight on the meshing teeth, the big wheel's hub off-frame
    else if (frame === 'train') cam = { cx: 1010 + 10 * lt, cy: 560, s: 0.94, rot: 0 };
    else if (frame === 'side') cam = { cx: lx + 120, cy: RAIL_Y - 190, s: 1.6, rot: 0.02 };
    else cam = { cx: 60, cy: RAIL_Y - 260, s: 0.8, rot: 0 };
    this.flr = frame === 'wide' ? 1.8 : 1;
    c.save();
    c.translate(960, 540); c.rotate(cam.rot); c.scale(cam.s, cam.s); c.translate(-cam.cx, -cam.cy);
    if (frame === 'close') this.gears(c, ph, heat, fl);
    else if (frame === 'train') this.linkage(c, ph, heat, fl, even);
    else {
      // the world: cold night air, warm ground, rails; the loco in it
      const half = 980 / cam.s;
      this.blob(c, cam.cx, cam.cy + 700, 1600, 0.07);
      this.ground(c, cam.cx - half - 200, cam.cx + half + 200);
      c.save(); c.translate(lx, RAIL_Y);
      this.loco(c, t, ph, heat, fl, even, exit);
      c.restore();
    }
    c.restore();
    L.upload();

    // automatic gain: a beat flare / the exit bloom push the curve, so the rest of the frame sinks while the
    // hottest body stays white (and, on the exit, goes past white into the bloom)
    const u = this.pass.u;
    u.uGam!.value = 1 + 0.14 * fl + 0.9 * exit;
    u.uLo!.value = 0.06 * exit;
    u.uBoost!.value = 1 + 0.45 * exit;
    u.uTime!.value = t;
    this.pass.render(renderer, out);

    const cut = t - sh.t0;
    const cutHit = sh.index > 0 ? Math.exp(-cut / 0.1) : 0;
    const loco = frame === 'side' || frame === 'wide';
    return {
      zoom: 1 + 0.028 * bp + 0.05 * cutHit + 0.02 * db,
      shake: loco ? [(4 * bp + 1.2) * Math.sin(t * 93), (3 * bp + 1) * Math.cos(t * 71)] : [0, 0],
      ca: 0,
      grain: 0.03,
      vignette: 0.32,
      bloom: loco ? 0.25 + 0.6 * exit : 0,
      bloomThreshold: 1.0,
      flash: 0,
    };
  }

  override dispose() { this.buf?.texture.dispose(); this.pass?.mat.dispose(); }
}
