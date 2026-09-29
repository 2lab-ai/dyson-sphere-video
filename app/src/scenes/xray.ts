// XRAY — the machine heart on a lightbox, as a radiograph (idiom S2, after Nick Veasey's X-ray photographs).
// Not a drawing: nothing here is a line. Every part of the machine is a translucent FILLED shape accumulated
// additively into a half-res density buffer (overlaps = thicker metal = brighter), and one shader pass turns
// density into film: transmission 1 - exp(-k·d), a cortical rim from the density gradient (the bright edge a real
// radiograph gives dense matter), a soft scatter halo, film fog and grain, lightbox illumination with tube banding,
// and the named `xray` palette ramp ground -> deep -> mid -> hi.
//   heart (p02)
//     wide    AP film on the lightbox: the whole chest. Ribs are chains of gears, the spine a column of gear
//             vertebrae, the heart a clockwork pump (crank gear, idler, piston, aorta tube) in its cardiac shadow.
//             Line 2 sits inside the ribcage as dense metal plates, exposed syllable by syllable.
//     mid     (extra, on a beat) the camera snaps half-way in on the heart.
//     close   a second film slides in from the right: the pump fills the frame; the words being sung are bone
//             inside it.
//     side    a third film (lateral) slides in from the left: the gear train in profile, the ribs sweeping
//             forward, the letters stacked down the spine as vertebrae (S-curved column).
//   Beat: every beat re-exposes the film (gain spike: the metal flashes bone-white and decays) and the whole gear
//   train steps one tooth (snaps in ~50 ms); the piston strokes on each beat. Exit: the lightbox tubes flicker off.
import * as THREE from 'three';
import { Scene, type Frame, type PostOverrides } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { palette, pcss, plin, type NamedPalette } from '../engine/palette';
import { drawLyric, layoutLine, ownedLines, F, type CharState } from '../engine/lyric';
import type { Line } from '../engine/lyrics';
import type { AudioData } from '../engine/audio';
import { beatPulse, downbeatPulse, beatIndex } from '../engine/beat';
import { shotAt, type PlateInfo, type Shot } from '../engine/shots';
import { clamp, smoothstep, ease, hash, TAU } from '../engine/util';
import { shots } from './xray.shots';

type C2 = CanvasRenderingContext2D;
type Cam = { cx: number; cy: number; s: number };

const DS = 0.5; // density buffer scale (half res)
const HEART = { x: 860, y: 600 };
/** World rects (AP film on the lightbox). */
const FILM = [110, 62, 1810, 1018] as const;
const BOX = [70, 26, 1850, 1054] as const;

const FRAG = /* glsl */ `
uniform sampler2D uDen;
uniform vec2 uRes, uTex;
uniform vec4 uFilm, uBox;       // screen px, top-left origin: x0 y0 x1 y1
uniform float uOn, uGain, uT, uFog;
uniform vec3 uG, uD, uM, uHi;

float den(vec2 uv) { return texture(uDen, uv).a; }
float inRect(vec2 p, vec4 r, float soft) {
  vec2 a = smoothstep(r.xy - soft, r.xy + soft, p), b = 1.0 - smoothstep(r.zw - soft, r.zw + soft, p);
  return a.x * a.y * b.x * b.y;
}
vec3 ramp(float v) {
  vec3 c = mix(uG, uD, smoothstep(0.0, 0.22, v));
  c = mix(c, uM, smoothstep(0.18, 0.58, v));
  c = mix(c, uHi, smoothstep(0.52, 0.95, v));
  return c * (1.0 + 1.6 * max(v - 0.95, 0.0));
}
void main() {
  vec2 uv = vUv;
  vec2 p = vec2(uv.x, 1.0 - uv.y) * uRes;          // top-left px
  float d = den(uv);
  // cortical rim: local density gradient (dense edges read brighter on a radiograph)
  vec2 e = uTex * 1.5;
  float gx = den(uv + vec2(e.x, 0.0)) - den(uv - vec2(e.x, 0.0));
  float gy = den(uv + vec2(0.0, e.y)) - den(uv - vec2(0.0, e.y));
  float rim = clamp(length(vec2(gx, gy)) * 2.2, 0.0, 0.6);
  // soft scatter halo (8 taps)
  float halo = 0.0;
  for (int i = 0; i < 8; i++) {
    float a = float(i) * 0.785398;
    halo += den(uv + vec2(cos(a), sin(a)) * uTex * 7.0);
  }
  halo /= 8.0;
  float k = 2.3 * uGain;
  float tr = 1.0 - exp(-k * d);
  float v = tr + rim * (0.55 + 0.35 * (uGain - 1.0)) + 0.35 * (1.0 - exp(-k * halo));
  // lightbox illumination: centre-heavy, three tube bands, switches with uOn
  vec2 q = (p - 0.5 * uRes) / uRes;
  float illum = (0.82 + 0.18 * (1.0 - 4.0 * dot(q, q))) * (1.0 + 0.05 * cos(p.x / uRes.x * 6.2831853 * 3.0));
  float film = inRect(p, uFilm, 1.5);
  float box = inRect(p, uBox, 2.0);
  float g = hash12(floor(p * 0.75) + fract(uT * 7.13) * 97.0) - 0.5;
  // on the film: fog + the radiograph, lit by the box; afterglow keeps a trace when the box is off
  float lit = mix(0.12, 1.0, uOn) * illum;
  vec3 onFilm = ramp(uFog + v * lit + g * 0.035);
  // bare lightbox (margin around the film, or where a sliding film has not arrived yet)
  vec3 bare = uHi * (0.95 * uOn * illum);
  vec3 c = mix(uG, bare, box);
  c = mix(c, onFilm, film);
  fragColor = vec4(max(c, 0.0), 1.0);
}`;

export default class Xray extends Scene {
  private P!: NamedPalette;
  private den!: Layer2D;
  private pass!: FSPass;
  private list: Shot[] = [];
  private plate!: PlateInfo;
  private lines: Line[] = [];
  private i0 = 0;

  override init() {
    this.plate = this.ctx.params as PlateInfo;
    this.P = palette(this.ctx.params.look?.palette ?? 'xray');
    this.list = shots(this.plate, this.ctx.audio);
    this.lines = ownedLines(this.ctx);
    this.i0 = beatIndex(this.ctx.audio, this.ctx.start + 1e-3);
    this.den = new Layer2D(W, H, DS);
    this.den.texture.colorSpace = THREE.NoColorSpace;
    this.den.texture.premultiplyAlpha = false;
    const P = this.P;
    const v3 = (r: 'ground' | 'deep' | 'mid' | 'hi') => new THREE.Vector3(...plin(P, r));
    this.pass = new FSPass(FRAG, {
      uDen: { value: this.den.texture },
      uRes: { value: new THREE.Vector2(W, H) },
      uTex: { value: new THREE.Vector2(1 / (W * DS), 1 / (H * DS)) },
      uFilm: { value: new THREE.Vector4() },
      uBox: { value: new THREE.Vector4() },
      uOn: { value: 1 }, uGain: { value: 1 }, uT: { value: 0 }, uFog: { value: 0.05 },
      uG: { value: v3('ground') }, uD: { value: v3('deep') }, uM: { value: v3('mid') }, uHi: { value: v3('hi') },
    });
  }

  // ------------------------------------------------------------------ timing helpers
  /** Beats since the plate started, stepped: +1 per beat, snapping in over ~50 ms. */
  private steps(t: number): number {
    const au = this.ctx.audio, i = beatIndex(au, t), b = au.beats[i] ?? t;
    return Math.max(0, i - this.i0) + smoothstep(0, 0.05, t - b);
  }

  /** 0..1 pulse on each word start of the owned line (the exposure of a new word). */
  private wordPulse(t: number): number {
    let v = 0;
    for (const l of this.lines) for (const w of l.words) if (t >= w.start) v = Math.max(v, Math.exp(-(t - w.start) / 0.09));
    return v;
  }

  // ------------------------------------------------------------------ density primitives (all filled, additive)
  private fill(c: C2, a: number) { c.fillStyle = pcss(this.P, 'hi', a); c.fill('evenodd'); }

  /** A spur gear: toothed rim, hub hole and optional lightening holes (even-odd holes). */
  private gear(c: C2, x: number, y: number, r: number, teeth: number, rot: number, a: number, holes = 0) {
    const td = Math.max(2.2, r * 0.16), n = teeth * 4;
    c.beginPath();
    for (let i = 0; i <= n; i++) {
      const ph = i % 4, ang = rot + (i / n) * TAU;
      const rr = ph === 1 || ph === 2 ? r + td * 0.5 : r - td * 0.5;
      const aa = ang + (ph === 1 ? 0.18 : ph === 2 ? -0.18 : 0) * (TAU / teeth) * 0.5;
      if (i === 0) c.moveTo(x + rr * Math.cos(aa), y + rr * Math.sin(aa)); else c.lineTo(x + rr * Math.cos(aa), y + rr * Math.sin(aa));
    }
    c.closePath();
    const hub = r * 0.22;
    c.moveTo(x + hub, y); c.arc(x, y, hub, 0, TAU);
    for (let k = 0; k < holes; k++) {
      const ha = rot + (k / holes) * TAU, hr = r * 0.2, hx = x + Math.cos(ha) * r * 0.56, hy = y + Math.sin(ha) * r * 0.56;
      c.moveTo(hx + hr, hy); c.arc(hx, hy, hr, 0, TAU);
    }
    this.fill(c, a);
    // the hub boss (a denser ring around the axle)
    c.beginPath(); c.arc(x, y, hub * 1.7, 0, TAU); c.moveTo(x + hub, y); c.arc(x, y, hub, 0, TAU);
    this.fill(c, a * 0.8);
  }

  /** An edge-on gear (seen in profile): a slab with tooth ridges on both faces, ridges shifted by `tooth` pitch. */
  private slab(c: C2, x: number, y: number, w: number, h: number, a: number, phase: number) {
    c.beginPath(); c.rect(x - w / 2, y - h / 2, w, h); this.fill(c, a);
    const pitch = 16, n = Math.floor(h / pitch);
    c.beginPath();
    for (let i = -1; i <= n; i++) {
      const yy = y - h / 2 + ((i + phase) % (n + 1) + (n + 1)) % (n + 1) * pitch;
      if (yy < y - h / 2 || yy > y + h / 2 - 7) continue;
      c.rect(x - w / 2 - 7, yy, 7, 7); c.rect(x + w / 2, yy, 7, 7);
    }
    this.fill(c, a * 1.1);
  }

  private ellipse(c: C2, x: number, y: number, rx: number, ry: number, a: number, rot = 0) {
    c.beginPath(); c.ellipse(x, y, rx, ry, rot, 0, TAU); this.fill(c, a);
  }

  /** A tube (vessel / aorta): a thick band along a quadratic curve — a filled density band, not an outline. */
  private tube(c: C2, pts: [number, number][], wdt: number, a: number) {
    c.save();
    c.strokeStyle = pcss(this.P, 'hi', a);
    c.lineWidth = wdt; c.lineCap = 'round'; c.lineJoin = 'round';
    c.beginPath(); c.moveTo(pts[0]![0], pts[0]![1]);
    for (let i = 1; i + 1 < pts.length; i += 2) c.quadraticCurveTo(pts[i]![0], pts[i]![1], pts[i + 1]![0], pts[i + 1]![1]);
    c.stroke();
    c.restore();
  }

  // ------------------------------------------------------------------ AP chest (front film)
  private chestAP(c: C2, st: number, t: number, detail = 1) {
    const au = this.ctx.audio;
    // soft tissue: torso, mediastinum, diaphragm (lungs stay darker between them)
    c.beginPath();
    c.moveTo(900, 20); c.lineTo(1020, 20);
    c.bezierCurveTo(1060, 120, 1500, 110, 1620, 230);
    c.bezierCurveTo(1560, 520, 1520, 820, 1500, 1100);
    c.lineTo(420, 1100);
    c.bezierCurveTo(400, 820, 360, 520, 300, 230);
    c.bezierCurveTo(420, 110, 860, 120, 900, 20);
    this.fill(c, 0.06);
    c.beginPath(); c.roundRect(835, 90, 250, 1000, 60); this.fill(c, 0.045);
    c.beginPath(); c.moveTo(430, 1100); c.bezierCurveTo(520, 820, 820, 800, 960, 900); c.bezierCurveTo(1100, 800, 1400, 820, 1490, 1100); c.closePath(); this.fill(c, 0.07);
    // cardiac shadow
    this.ellipse(c, HEART.x + 20, HEART.y + 30, 250, 205, 0.06, -0.35);
    // spine: gear vertebrae + transverse processes
    for (let i = 0; i < 16; i++) {
      const y = 110 + i * 62;
      c.beginPath(); c.roundRect(960 - 62, y - 9, 124, 18, 9); this.fill(c, 0.09);
      this.gear(c, 960, y, 28, 10, (i % 2 ? -1 : 1) * st * (TAU / 10), 0.17);
    }
    // clavicles: gear chains
    for (const sgn of [-1, 1]) {
      for (let k = 0; k < 9; k++) {
        const u = k / 8, x = 960 + sgn * (70 + u * 330), y = 160 - 40 * Math.sin(u * Math.PI * 0.8);
        this.gear(c, x, y, 19 - 3 * u, 8, sgn * (k % 2 ? -1 : 1) * st * (TAU / 8), 0.14);
      }
    }
    // ribs: 8 pairs, each a chain of meshing gears along an elliptical arc
    for (let i = 0; i < 8; i++) {
      const y0 = 190 + i * 88, rx = 330 + 150 * Math.sin((Math.PI * (i + 1.4)) / 10), ry = 120 + i * 6;
      for (const sgn of [-1, 1]) {
        let th = 0.16, k = 0;
        while (th < 2.25) {
          const r = 22 - 9 * (th / 2.25);
          const x = 960 + sgn * rx * Math.sin(th), y = y0 + ry - ry * Math.cos(th);
          this.gear(c, x, y, r, 9, sgn * (k % 2 ? -1 : 1) * st * (TAU / 9) + k, 0.13 + 0.03 * (k % 2));
          const dl = r * 1.55; // arc step ~ overlapping teeth
          const ds = Math.hypot(rx * Math.cos(th), ry * Math.sin(th));
          th += dl / Math.max(40, ds); k++;
        }
      }
    }
    this.heart(c, st, t, au, detail);
  }

  /** The clockwork pump. `detail` > 1 adds finer parts for the close film. */
  private heart(c: C2, st: number, t: number, au: AudioData, detail: number) {
    const { x, y } = HEART;
    const pump = beatPulse(au, t, 0.2);
    const rot = st * (TAU / 26);
    // crank gear + idler + small pinion
    this.gear(c, x, y, 120, 26, rot, 0.2, 5);
    this.gear(c, x + 172, y - 62, 58, 12, -rot * (26 / 12) + 0.1, 0.2, 3);
    this.gear(c, x + 236, y + 44, 34, 8, rot * (26 / 8), 0.18);
    // piston cylinder (a ring) and the piston that strokes on each beat
    const cyx = x - 150, cyy = y - 250;
    c.beginPath(); c.roundRect(cyx - 58, cyy - 110, 116, 230, 16); c.roundRect(cyx - 40, cyy - 94, 80, 200, 10); this.fill(c, 0.2);
    const py = cyy + 30 - 70 * pump;
    c.beginPath(); c.roundRect(cyx - 36, py - 34, 72, 68, 8); this.fill(c, 0.26);
    // connecting rod from the crank pin to the piston (a filled bar)
    const pin = { x: x + Math.cos(rot - 2.2) * 70, y: y + Math.sin(rot - 2.2) * 70 };
    const dx = cyx - pin.x, dy = py + 30 - pin.y, L = Math.hypot(dx, dy), nx = -dy / L * 11, ny = dx / L * 11;
    c.beginPath(); c.moveTo(pin.x + nx, pin.y + ny); c.lineTo(cyx + nx, py + 30 + ny); c.lineTo(cyx - nx, py + 30 - ny); c.lineTo(pin.x - nx, pin.y - ny); c.closePath(); this.fill(c, 0.18);
    c.beginPath(); c.arc(pin.x, pin.y, 14, 0, TAU); this.fill(c, 0.25);
    // aorta and vessels (tubes)
    this.tube(c, [[cyx, cyy - 110], [cyx - 10, cyy - 260], [x + 140, cyy - 230], [x + 300, cyy - 200], [x + 330, cyy - 40]], 42, 0.08);
    this.tube(c, [[x + 172, y - 120], [x + 200, y - 300], [x + 120, y - 400]], 26, 0.07);
    if (detail > 1) {
      // valves: small ratchet gears and rivets around the rim
      for (let k = 0; k < 12; k++) {
        const a = rot + (k / 12) * TAU;
        c.beginPath(); c.arc(x + Math.cos(a) * 96, y + Math.sin(a) * 96, 4, 0, TAU); this.fill(c, 0.35);
      }
      this.gear(c, cyx + 90, cyy - 140, 24, 7, -st * (TAU / 7), 0.2);
      this.gear(c, x - 40, y + 170, 30, 9, st * (TAU / 9), 0.18);
      // cylinder rings
      for (let k = 0; k < 4; k++) { c.beginPath(); c.rect(cyx - 62, cyy - 70 + k * 48, 124, 6); this.fill(c, 0.14); }
    }
  }

  // ------------------------------------------------------------------ lateral film
  private chestLat(c: C2, st: number, t: number, spineX: number) {
    const au = this.ctx.audio;
    // soft tissue: side profile (front = left, back = right)
    c.beginPath();
    c.moveTo(560, -20); c.bezierCurveTo(430, 200, 380, 520, 440, 1100); c.lineTo(1420, 1100);
    c.bezierCurveTo(1380, 700, 1400, 300, 1330, -20); c.closePath(); this.fill(c, 0.06);
    // ribs: sweeping forward and down from the spine (oblique gear discs)
    for (let i = 0; i < 9; i++) {
      const y0 = 150 + i * 92;
      for (let k = 0; k < 13; k++) {
        const u = k / 12, x = spineX - 60 - u * 700, y = y0 + 120 * Math.sin(u * Math.PI * 0.75) + u * 40;
        c.save(); c.translate(x, y); c.scale(1, 0.55);
        this.gear(c, 0, 0, 20 - 6 * u, 9, (k % 2 ? -1 : 1) * st * (TAU / 9) + k, 0.11);
        c.restore();
      }
    }
    // the gear train in profile: edge-on slabs stacked down the chest, axles between them
    for (let k = 0; k < 7; k++) {
      const y = 170 + k * 118, w = k % 2 ? 26 : 38, h = k % 2 ? 150 : 200;
      const x = 760 + (k % 2 ? 36 : -20);
      this.slab(c, x, y, w, h, 0.16, (k % 2 ? -1 : 1) * st);
      c.beginPath(); c.rect(x - 150, y - 5, 300, 10); this.fill(c, 0.1);
    }
    // the pump in profile: crank gear edge-on + a horizontal cylinder with its piston
    const hx = 600, hy = 560, pump = beatPulse(au, t, 0.2);
    this.ellipse(c, hx + 40, hy + 20, 220, 190, 0.06);
    this.slab(c, hx, hy, 46, 250, 0.2, st);
    c.beginPath(); c.roundRect(hx + 40, hy - 150, 280, 100, 14); c.roundRect(hx + 56, hy - 136, 248, 72, 10); this.fill(c, 0.2);
    c.beginPath(); c.roundRect(hx + 70 + 110 * pump, hy - 132, 70, 64, 8); this.fill(c, 0.26);
    this.tube(c, [[hx + 320, hy - 100], [hx + 460, hy - 110], [spineX - 90, hy - 300]], 40, 0.08);
  }

  // ------------------------------------------------------------------ lyric (as dense metal plates)
  private lyricAlpha(s: CharState, full: number): number {
    if (!s.sung) return 0.07; // unexposed plate: a ghost of density
    return full * (0.35 + 0.65 * Math.min(1, s.frac * 3)) * (1 + 0.25 * Math.exp(-(s.frac) * 6));
  }

  private drawPlate = (c: C2, ch: string) => {
    c.fillStyle = pcss(this.P, 'hi', 1);
    c.fillText(ch, 0, 0);
  };

  // ------------------------------------------------------------------ frame
  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, audio } = this.ctx;
    const t = f.t;
    const sh = shotAt(this.list, t), frame = String(sh.shot.s.frame);
    const lt = t - sh.t0;
    const st = this.steps(t);
    const bp = beatPulse(audio, t, 0.14);
    const P = this.P;
    const line = this.lines[0];

    // camera and film slide per shot
    let cam: Cam = { cx: 960, cy: 540, s: 1 };
    let slide = 0;
    if (frame === 'wide') cam = { cx: 960 + 16 * (lt / 2.3 - 0.5), cy: 540, s: 1 }; // slow scan across the film
    else if (frame === 'mid') cam = { cx: 900, cy: 575, s: 1.5 };
    else if (frame === 'close') { cam = { cx: 870, cy: 560, s: 2.35 + 0.05 * lt }; slide = W * (1 - ease.outCubic(clamp(lt / 0.2))); }
    else if (frame === 'side') { cam = { cx: 960, cy: 540, s: 1.12 }; slide = -W * (1 - ease.outCubic(clamp(lt / 0.2))); }
    const tx = (x: number) => (x - cam.cx) * cam.s + 960 + slide, ty = (y: number) => (y - cam.cy) * cam.s + 540;

    const L = this.den;
    L.clear();
    const c = L.ctx;
    c.globalCompositeOperation = 'lighter';
    c.save();
    c.translate(960 + slide, 540); c.scale(cam.s, cam.s); c.translate(-cam.cx, -cam.cy);
    if (frame === 'side') {
      const spineX = 1180;
      this.chestLat(c, st, t, spineX);
      // letters stacked down the spine as vertebrae (S-curved column), with a spinous process per letter
      if (line) {
        const size = 74, top = 90;
        const lay = layoutLine(c, line, F.slam(), size, 900, true);
        const curve = (y: number) => 38 * Math.sin((y / 900) * Math.PI * 1.6 + 0.4);
        for (const b of lay.chars) {
          const y = top + b.y - lay.size * 0.35;
          c.beginPath(); c.roundRect(spineX + curve(y) + 46, y - 16, 90, 26, 12); this.fill(c, 0.12);
          c.beginPath(); c.roundRect(spineX + curve(y) - 48, y - lay.size * 0.5, 96, lay.size * 0.95, 10); this.fill(c, 0.07);
        }
        drawLyric(c, line, t, {
          x: spineX, y: top, size, vertical: true, maxWidth: 900, family: F.slam(), unsungAlpha: 1,
          charTransform: (_ch, _i, s) => ({ dx: curve(top + s.box.y - lay.size * 0.35), alpha: this.lyricAlpha(s, 0.5) }),
          drawChar: this.drawPlate,
        });
      }
    } else {
      this.chestAP(c, st, t, frame === 'close' ? 2 : 1);
      if (line && frame !== 'close') {
        drawLyric(c, line, t, {
          x: 960, y: 600, size: 124, maxWidth: 1240, family: F.slam(), unsungAlpha: 1,
          charTransform: (_ch, _i, s) => ({ alpha: this.lyricAlpha(s, 0.6), scale: 1 + 0.06 * Math.exp(-s.frac * 5) * (s.sung ? 1 : 0) }),
          drawChar: this.drawPlate,
        });
      }
    }
    c.restore();
    // close film: the words being sung, large, inside the pump (screen space, sliding with the film)
    if (line && frame === 'close') {
      const size = 196;
      const lay = layoutLine(c, line, F.slam(), size);
      const w0 = lay.words[2], w1 = lay.words[lay.words.length - 1];
      const spanL = w0 ? w0.x : 0, spanR = w1 ? w1.x + w1.w : lay.width;
      drawLyric(c, line, t, {
        x: 960 + slide - (spanL + spanR) / 2, y: 640, size, align: 'left', family: F.slam(), unsungAlpha: 1,
        charTransform: (_ch, _i, s) => ({ alpha: s.word < 2 ? 0 : this.lyricAlpha(s, 0.5) }),
        drawChar: this.drawPlate,
      });
    }
    L.upload();

    // film / lightbox rects in screen px
    const rect = (r: readonly number[]) => new THREE.Vector4(tx(r[0]!), ty(r[1]!), tx(r[2]!), ty(r[3]!));
    const full = (s: number) => new THREE.Vector4(-10 + s, -10, W + 10 + s, H + 10);
    const u = this.pass.u;
    if (frame === 'close' || frame === 'side') { (u.uFilm!.value as THREE.Vector4).copy(full(slide)); (u.uBox!.value as THREE.Vector4).copy(full(0)); }
    else { (u.uFilm!.value as THREE.Vector4).copy(rect(FILM)); (u.uBox!.value as THREE.Vector4).copy(rect(BOX)); }

    // lightbox switch: tubes strike at the start (on the first syllable), flicker off at the end
    const ls = t - this.ctx.start, le = this.ctx.end - t;
    let on = 1;
    if (ls < 0.02) on = 1.4; else if (ls < 0.05) on = 0.25; else if (ls < 0.08) on = 1.2;
    if (le < 0.12) on = le < 0.02 ? 0 : le < 0.05 ? 0.15 : le < 0.08 ? 0.7 : 0.2;
    u.uOn!.value = on;
    // re-exposure on every beat: the metal flashes bone-white and decays
    u.uGain!.value = 1 + 0.85 * bp + 0.35 * downbeatPulse(audio, t, 0.2);
    u.uT!.value = Math.floor(t * 24) / 24; // grain refreshes like film at 24 fps
    u.uFog!.value = 0.05 + 0.02 * hash(Math.floor(t * 24));
    this.pass.render(renderer, out);

    // hits: a flash on the lightbox strike and every film change, zoom punch on beats and word exposures
    const cut = t - sh.t0;
    const cutHit = sh.index > 0 || ls < 0.1 ? Math.exp(-cut / 0.07) : 0;
    const wp = this.wordPulse(t);
    return {
      zoom: 1 + 0.03 * bp + 0.04 * wp + (frame === 'mid' ? 0.05 * Math.exp(-cut / 0.12) : 0),
      flash: 0.28 * cutHit,
      shake: frame === 'side' ? [3 * bp * Math.sin(t * 91), 2 * bp * Math.cos(t * 77)] : [0, 0],
      ca: 0,
      grain: 0.05,
      vignette: 0.42,
      bloom: 0,
    };
  }

  override dispose() { this.den?.texture.dispose(); this.pass?.mat.dispose(); }
}
