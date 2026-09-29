// DEMO — one plate in the taste of a 1990s Amiga/PC intro, rendered at 320x180 and blown up nearest-neighbour
// (6x6 output px per pixel) with an ordered (4x4 Bayer) dither on the ramp ink -> signal -> bone and a scanline hint.
// One effect per bar, hard cut on every downbeat (./demo.shots):
//   copper  copper raster bars (jump 14 px per beat) + a big bouncing sine scroller (lands on every beat)
//   roto    rotozoomer of a hex-panel texture; angle + scale snap one step per beat, a panel set lights per beat
//   balls   shaded vector balls, z-sorted, one latitude band lands on its sphere position per beat
//   wire    the finished sphere turns into its wireframe drawing (hand-off to the exploded drawing plate)
// No lyric lines are owned (instrumental); the scroller text is the plate's own credit line.
import * as THREE from 'three';
import { Scene, type Frame, type PostOverrides } from '../engine/scene';
import { Layer2D, clearRT } from '../engine/gl';
import { HEX, LIN, rgba } from '../engine/palette';
import { F } from '../engine/lyric';
import { beatPulse, kickPulse, downbeatPulse, beatIndex } from '../engine/beat';
import { shotAt, type PlateInfo, type Shot } from '../engine/shots';
import { hash, clamp, smoothstep } from '../engine/util';
import { shots, type Fx } from './demo.shots';

const RW = 320, RH = 180; // internal resolution
const PX = 1080 / RH; // output px per internal px
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((b) => (b + 0.5) / 16);
const SCROLL_TEXT = 'DYSON SPHERE · SENTIENT ARCHITECT · GREETINGS TO THE SCENE · ';
const NB = 48; // vector balls

const rgb = (k: keyof typeof HEX): [number, number, number] => {
  const n = parseInt(HEX[k].slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

type Mask = { w: number; h: number; a: Uint8Array };

export default class Demo extends Scene {
  private low!: Layer2D;
  private scan!: Layer2D;
  private img!: ImageData;
  private val = new Float32Array(RW * RH); // 0 = ink, 0.5 = signal, 1 = bone (dithered between)
  private ramp: [number, number, number][] = [rgb('ink'), rgb('signal'), rgb('bone')];
  private list: Shot[] = [];
  private plate!: PlateInfo;
  private scroll!: Mask;
  private small!: Mask;
  private ball: { p: [number, number, number]; band: number; nb: number[] }[] = [];

  override init() {
    this.plate = this.ctx.params as PlateInfo;
    this.list = shots(this.plate, this.ctx.audio);
    this.low = new Layer2D(RW, RH, 1);
    const tex = this.low.texture;
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    this.img = this.low.ctx.createImageData(RW, RH);
    // scanline hint: the bottom output row pair of every internal row is darkened
    this.scan = new Layer2D();
    const s = this.scan.ctx;
    s.clearRect(0, 0, 1920, 1080);
    s.fillStyle = rgba('ink', 0.42);
    for (let y = 0; y < RH; y++) s.fillRect(0, (y + 1) * PX - 2, 1920, 2);
    this.scan.upload();
    this.scroll = this.mask(SCROLL_TEXT, `44px "${F.archivo(125, 900)}"`, 48);
    this.small = this.mask('GREETINGS TO THE SCENE', `10px "${F.mono(700)}"`, 12);
    // vector-ball sphere: a Fibonacci sphere, split into 4 latitude bands (top first), 3 nearest neighbours each
    for (let i = 0; i < NB; i++) {
      const y = 1 - (2 * (i + 0.5)) / NB, r = Math.sqrt(1 - y * y), a = i * 2.39996;
      this.ball.push({ p: [r * Math.cos(a), y, r * Math.sin(a)], band: Math.min(3, Math.floor((i * 4) / NB)), nb: [] });
    }
    for (const b of this.ball) {
      const d = this.ball.map((o, j) => [(o.p[0] - b.p[0]) ** 2 + (o.p[1] - b.p[1]) ** 2 + (o.p[2] - b.p[2]) ** 2, j] as const);
      d.sort((u, v) => u[0] - v[0]);
      b.nb = d.slice(1, 4).map((x) => x[1]);
    }
  }

  /** A 1-bit text mask (alpha > 50%) at the internal resolution. */
  private mask(text: string, font: string, h: number): Mask {
    const cv = document.createElement('canvas');
    const c = cv.getContext('2d')!;
    c.font = font;
    const w = Math.ceil(c.measureText(text).width) + 2;
    cv.width = w; cv.height = h;
    c.font = font;
    c.textBaseline = 'alphabetic';
    c.fillStyle = rgba('bone');
    c.fillText(text, 1, Math.round(h * 0.86));
    const d = c.getImageData(0, 0, w, h).data, a = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) a[i] = d[i * 4 + 3]! > 128 ? 1 : 0;
    return { w, h, a };
  }

  /** Beats elapsed since t0 as a stepped value: +1 per beat, snapping in over ~50 ms. */
  private steps(t: number, t0: number): number {
    const au = this.ctx.audio, i0 = beatIndex(au, t0 + 1e-3), i = beatIndex(au, t);
    const b = au.beats[i] ?? t0;
    return i - i0 + smoothstep(0, 0.05, t - b);
  }

  // ---- effects (write this.val) ----

  private copper(t: number, t0: number) {
    const V = this.val, au = this.ctx.audio, lt = t - t0;
    V.fill(0);
    const jump = 14 * this.steps(t, t0);
    const bp = beatPulse(au, t, 0.1);
    // raster bars: 5 bars riding a sine, the whole stack jumps 14 px per beat
    for (let k = 0; k < 5; k++) {
      const yc = 90 + 64 * Math.sin(lt * 2.1 + k * 0.78) + jump, h = 6 + 2 * bp;
      for (let dy = -Math.ceil(h); dy <= Math.ceil(h); dy++) {
        const y = Math.round(((yc + dy) % RH + RH) % RH);
        const v = 0.12 + 0.88 * Math.pow(clamp(1 - Math.abs(dy) / h), 0.8);
        for (let x = 0; x < RW; x++) { const o = y * RW + x; if (v > V[o]!) V[o] = v; }
      }
    }
    // chrome rules framing the scroller zone; they flash bone on the beat
    for (const y of [16, 17, 162, 163]) for (let x = 0; x < RW; x++) V[y * RW + x] = 0.55 + 0.45 * bp;
    // small greetings line above the top rule
    this.blit(this.small, 160 - (this.small.w >> 1), 3, 1);
    // the big sine scroller: text bounces, landing on every beat (squash on impact)
    const M = this.scroll, ph = this.phase(t);
    const hop = 4 * ph * (1 - ph), squash = 1 - 0.28 * beatPulse(au, t, 0.07);
    const base = 128 - 40 * hop, sx0 = Math.floor(lt * 330) - 12;
    const amp = 16 + 10 * bp;
    for (const pass of [0, 1]) {
      for (let x = 0; x < RW; x++) {
        const sx = (((x + sx0) % M.w) + M.w) % M.w;
        const yTop = base - M.h * squash + amp * Math.sin((x + sx0) * 0.03 + lt * 4.2);
        for (let r = 0; r < M.h; r++) {
          if (!M.a[r * M.w + sx]) continue;
          const y0 = Math.round(yTop + r * squash) + (pass ? 0 : 3), xx = x + (pass ? 0 : 3);
          if (y0 < 0 || y0 >= RH || xx >= RW) continue;
          V[y0 * RW + xx] = pass ? 1 - 0.62 * (r / M.h) : 0; // shadow first, then bone -> signal gradient
        }
      }
    }
  }

  private phase(t: number) {
    const b = this.ctx.audio.beats, i = beatIndex(this.ctx.audio, t);
    if (i < 0 || i + 1 >= b.length) return 0;
    return clamp((t - b[i]!) / (b[i + 1]! - b[i]!));
  }

  private blit(m: Mask, x0: number, y0: number, v: number) {
    for (let r = 0; r < m.h; r++) for (let c = 0; c < m.w; c++) {
      const x = x0 + c, y = y0 + r;
      if (m.a[r * m.w + c] && x >= 0 && x < RW && y >= 0 && y < RH) this.val[y * RW + x] = v;
    }
  }

  private roto(t: number, t0: number) {
    const V = this.val, au = this.ctx.audio, lt = t - t0;
    const st = this.steps(t, t0), k = Math.floor(st);
    const ang = 0.3 + st * 0.55 + lt * 0.18;
    const sc = 0.55 * Math.pow(0.72, st) * (1 + 0.04 * Math.sin(lt * 3)); // texels per pixel
    const ca = Math.cos(ang) * sc, sa = Math.sin(ang) * sc;
    const ou = lt * 30 + st * 23, ov = lt * 11 - st * 17;
    const bp = beatPulse(au, t, 0.14);
    const R = 12, SQ3 = Math.sqrt(3);
    for (let y = 0; y < RH; y++) {
      const py = y - RH / 2;
      for (let x = 0; x < RW; x++) {
        const px = x - RW / 2;
        const u = px * ca - py * sa + ou, v = px * sa + py * ca + ov;
        // pointy-top hex grid: fractional axial -> cube round
        const q = ((SQ3 / 3) * u - v / 3) / R, r = ((2 / 3) * v) / R, s = -q - r;
        let rq = Math.round(q), rr = Math.round(r), rs = Math.round(s);
        const dq = Math.abs(rq - q), dr = Math.abs(rr - r), ds = Math.abs(rs - s);
        if (dq > dr && dq > ds) rq = -rr - rs; else if (dr > ds) rr = -rq - rs;
        // centre and local offset
        const cx = R * SQ3 * (rq + rr / 2), cy = R * 1.5 * rr, lx = (u - cx) / R, ly = (v - cy) / R;
        // hex "radius" (distance to edge, 1 at the edge)
        const e = Math.max(Math.abs(lx), Math.abs(lx * 0.5 + ly * 0.866), Math.abs(lx * 0.5 - ly * 0.866)) / 0.866;
        const hx = hash(rq, rr);
        let val: number;
        if (e > 0.9) val = 0; // ink seam
        else {
          // bevelled panel: base level per panel, lit from the upper left, inner frame line
          const lvl = 0.3 + 0.35 * Math.floor(hx * 3) / 2;
          val = lvl + 0.18 * (-lx - ly) * 0.5;
          if (e > 0.72 && e < 0.78) val = 0.95;
          if (Math.floor(hash(rq, rr, k) * 5) === 0) val = Math.max(val, 0.5 + 0.5 * bp); // this beat's panels light up
        }
        V[y * RW + x] = val;
      }
    }
  }

  private balls(t: number, t0: number, fx: Fx, tw: number) {
    const V = this.val, au = this.ctx.audio, lt = t - t0;
    V.fill(0);
    const bi = beatIndex(au, t0 + 1e-3), beats = [0, 1, 2, 3].map((j) => au.beats[bi + j] ?? t0 + j * 0.58);
    const ry = lt * 1.1 + 0.4, tilt = 0.38, cy = Math.cos(ry), sy = Math.sin(ry), ct = Math.cos(tilt), stl = Math.sin(tilt);
    const wire = fx === 'wire' ? smoothstep(tw, tw + 0.25, t) : 0;
    const pump = 1 + 0.07 * beatPulse(au, t, 0.1);
    const FOC = 150, CZ = 3.6, RAD = 1.0 * pump;
    type B = { x: number; y: number; z: number; r: number; hit: number; on: boolean };
    const P: B[] = this.ball.map((b) => {
      const tl = beats[b.band]!, fly = 0.5;
      // flight: from outside the frame (outward + toward camera) accelerating into its slot, landing on the beat
      const u = clamp((t - (tl - fly)) / fly), out = Math.pow(1 - u, 2.2);
      let [x, y, z] = b.p;
      x *= RAD * (1 + out * 2.6); y *= RAD * (1 + out * 2.6); z = z * RAD - out * 2.8;
      const x1 = x * cy + z * sy, z1 = -x * sy + z * cy;
      const y2 = y * ct - z1 * stl, z2 = y * stl + z1 * ct;
      const w = FOC / (CZ + z2);
      const hit = t >= tl ? Math.exp(-(t - tl) / 0.12) : 0;
      return { x: RW / 2 + x1 * w, y: RH / 2 - 4 + y2 * w, z: z2, r: (6.2 + 3 * hit) * (w / (FOC / CZ)) * (1 - 0.7 * wire), hit, on: t >= tl - fly };
    });
    // floor line and ball shadows
    for (let x = 0; x < RW; x++) V[160 * RW + x] = 0.5;
    for (const b of P) if (b.on) for (let dx = -Math.round(b.r); dx <= Math.round(b.r); dx++) {
      const x = Math.round(b.x + dx * 1.4);
      for (const y of [161, 162]) if (x >= 0 && x < RW) V[y * RW + x] = 0.24;
    }
    // wireframe (exit): neighbour edges drawn as bone lines
    if (wire > 0) this.ball.forEach((b, i) => b.nb.forEach((j) => { if (j > i || !this.ball[j]!.nb.includes(i)) this.line(P[i]!, P[j]!, 0.55 + 0.45 * wire); }));
    const order = P.map((_, i) => i).filter((i) => P[i]!.on).sort((a, b) => P[b]!.z - P[a]!.z); // far -> near
    for (const i of order) {
      const b = P[i]!, r = b.r, depth = clamp(0.62 - b.z * 0.35, 0.35, 1);
      for (let y = Math.floor(b.y - r); y <= Math.ceil(b.y + r); y++) {
        if (y < 0 || y >= RH) continue;
        for (let x = Math.floor(b.x - r); x <= Math.ceil(b.x + r); x++) {
          if (x < 0 || x >= RW) continue;
          const nx = (x + 0.5 - b.x) / r, ny = (y + 0.5 - b.y) / r, d2 = nx * nx + ny * ny;
          if (d2 > 1) continue;
          const nz = Math.sqrt(1 - d2);
          const lam = clamp(-0.5 * nx - 0.55 * ny + 0.67 * nz), spec = Math.pow(clamp(-0.35 * nx - 0.4 * ny + 0.85 * nz), 18);
          let v = d2 > 0.8 ? 0.02 : (0.18 + 0.52 * lam) * depth + 0.6 * spec + 0.5 * b.hit;
          V[y * RW + x] = clamp(v);
        }
      }
    }
  }

  private line(a: { x: number; y: number }, b: { x: number; y: number }, v: number) {
    const n = Math.ceil(Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y)));
    for (let i = 0; i <= n; i++) {
      const x = Math.round(a.x + ((b.x - a.x) * i) / Math.max(1, n)), y = Math.round(a.y + ((b.y - a.y) * i) / Math.max(1, n));
      if (x >= 0 && x < RW && y >= 0 && y < RH) this.val[y * RW + x] = v;
    }
  }

  /** Ordered dither of this.val onto the ink / signal / bone ramp. */
  private quantize() {
    const V = this.val, D = this.img.data, R = this.ramp;
    for (let y = 0; y < RH; y++) for (let x = 0; x < RW; x++) {
      const o = y * RW + x, l = clamp(V[o]!) * 2;
      let i = Math.floor(l);
      if (i < 2 && l - i > BAYER[(y & 3) * 4 + (x & 3)]!) i++;
      const c = R[i]!;
      D[o * 4] = c[0]; D[o * 4 + 1] = c[1]; D[o * 4 + 2] = c[2]; D[o * 4 + 3] = 255;
    }
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, audio } = this.ctx;
    const sh = shotAt(this.list, f.t), fx = sh.shot.s.fx as Fx;
    // the balls/wire shots share one clock (the wire shot continues the sphere)
    const ballsStart = this.list.find((s) => s.s.fx === 'balls')?.t ?? sh.t0;
    if (fx === 'copper') this.copper(f.t, sh.t0);
    else if (fx === 'roto') this.roto(f.t, sh.t0);
    else this.balls(f.t, ballsStart, fx, sh.t0);
    this.quantize();
    this.low.ctx.putImageData(this.img, 0, 0);
    this.low.upload();

    clearRT(renderer, out, LIN.ink);
    this.ctx.comp.draw(renderer, this.low.texture, out, { mode: 'normal' });
    this.ctx.comp.draw(renderer, this.scan.texture, out, { mode: 'normal' });

    // hits: hard-cut punch + flash on each downbeat, a pixel-grid shake on ball landings, white-out into the next plate
    const db = downbeatPulse(audio, f.t, 0.16), kp = kickPulse(audio, f.t, 0.08);
    const land = fx === 'balls' ? beatPulse(audio, f.t, 0.08) : 0;
    const exit = smoothstep(this.ctx.end - 0.1, this.ctx.end - 1 / 60, f.t);
    return {
      zoom: 1 + 0.09 * db + 0.02 * kp,
      flash: 0.2 * downbeatPulse(audio, f.t, 0.03) + 0.9 * exit,
      shake: [PX * Math.round(2 * land * Math.sin(f.t * 97)), PX * Math.round(1.5 * land * Math.cos(f.t * 83))],
      ca: 0,
      grain: 0.03,
      vignette: 0.35,
    };
  }

  override dispose() { this.low?.texture.dispose(); this.scan?.texture.dispose(); }
}
