// COSMICWEB — p14, the Powers-of-Ten idiom (Eames 1977) applied to metric expansion. Palette `web` (cool, dark).
// The point of the plate: this is NOT a camera zoom. The camera is locked between downbeats; the fixed Eames square
// is the scale reference; bound structures (galaxy clusters, galaxy groups) keep their pixel size and their internal
// layout, while the distances BETWEEN them grow one step per beat (comoving positions times a(t), a stepping on each
// beat). Filaments are particle streams (never stroked lines); on every beat a new batch of galaxies is born along them.
// The only camera move is the power-of-ten push on the downbeat (the 1/10 inset grows to fill the frame).
//   wide  (69.781)  decade 25, top-down: a cool fog condenses into the web on beat 1, then the gaps grow per beat
//   inset (70.947)  the next decade is marked: a 1/10 inset square opens on one filament knot and rides with it
//   tilt  (72.112)  decade 24, oblique over the plane: galaxy groups strung along one filament, separating per beat
//   nebula (73.86)  exit: one galaxy flares into a warm nebula at the Sun plate's anchor (1187, 413)
import type * as THREE from 'three';
import { Scene, type Frame, type PostOverrides } from '../engine/scene';
import { Layer2D, clearRT, W, H } from '../engine/gl';
import { palette, pcss, plin, type NamedPalette, type Role } from '../engine/palette';
import { F } from '../engine/lyric';
import { beatPulse, kickPulse, downbeatPulse } from '../engine/beat';
import { stateAt, type PlateInfo, type Shot } from '../engine/shots';
import { mulberry32, clamp, lerp, ease, TAU } from '../engine/util';
import { shots } from './cosmicweb.shots';

type Spr = HTMLCanvasElement;
interface Dot { x: number; y: number; fx: number; fy: number; born: number; s: number; k: number }
interface Clu { x: number; y: number; m: number; mem: { dx: number; dy: number; s: number }[] }
interface Gal { dx: number; dy: number; s: number; rot: number; v: number }
interface Grp { x: number; y: number; gal: Gal[]; born: number }

const STEP1 = 1.3; // comoving scale-factor step per beat, bar 1
const STEP2 = 1.28; // bar 2
const SQ = 600; // Eames square side (screen px, wide) / plane units (tilt)
const INSET = 60; // the 1/10 inset square
// tilt camera
const TH = 0.72, PHI = -0.5, DD = 1500, CX = W / 2, CY = 560;
const NEB = { x: 1187, y: 413 }; // p15's sun anchor

function sprite(size: number, draw: (c: CanvasRenderingContext2D, r: number) => void): Spr {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const c = cv.getContext('2d')!;
  c.translate(size / 2, size / 2);
  draw(c, size / 2);
  return cv;
}
function glow(P: NamedPalette, size: number, stops: [number, Role, number][]): Spr {
  return sprite(size, (c, r) => {
    const g = c.createRadialGradient(0, 0, 0, 0, 0, r);
    for (const [o, role, a] of stops) g.addColorStop(o, pcss(P, role, a));
    c.fillStyle = g;
    c.fillRect(-r, -r, 2 * r, 2 * r);
  });
}

/** Sum over event times <= t of an eased 0->1 step (each takes `dur`). */
function steps(times: readonly number[], t: number, dur: number): number {
  let v = 0;
  for (const x of times) { if (x > t + 1e-9) break; v += ease.outCubic(clamp((t - x) / dur)); }
  return v;
}

export default class CosmicWeb extends Scene {
  private L!: Layer2D;
  private P!: NamedPalette;
  private list: Shot[] = [];
  private plate!: PlateInfo;
  private beats: number[] = [];
  private tPush = 0; // the bar-2 downbeat
  private bar1: number[] = []; // expansion steps, bar 1
  private bar2: number[] = [];
  private dots: Dot[] = [];
  private clus: Clu[] = [];
  private grps: Grp[] = [];
  private dust: Dot[] = [];
  private insetAt = { x: 0, y: 0 };
  private nebGrp = -1;
  private sp: Record<string, Spr> = {};
  private gal: Spr[] = [];

  override init() {
    this.plate = this.ctx.params as PlateInfo;
    this.P = palette(this.plate.look?.palette ?? 'web');
    this.list = shots(this.plate, this.ctx.audio);
    this.L = new Layer2D();
    const au = this.ctx.audio, s = this.ctx.start, e = this.ctx.end;
    this.beats = au.beats.filter((b) => b >= s - 1e-3 && b < e - 1e-3);
    this.tPush = au.downbeats.find((d) => d > s + 0.1 && d < e - 0.1) ?? s + (e - s) / 2;
    this.bar1 = this.beats.filter((b) => b > s + 0.05 && b < this.tPush - 0.05);
    this.bar2 = this.beats.filter((b) => b > this.tPush + 0.05);
    const P = this.P;
    this.sp.dot = glow(P, 12, [[0, 'hi', 1], [0.35, 'hi', 0.55], [1, 'mid', 0]]);
    this.sp.dust = glow(P, 8, [[0, 'mid', 0.9], [1, 'mid', 0]]);
    this.sp.core = glow(P, 96, [[0, 'hi', 0.9], [0.12, 'hi', 0.5], [0.4, 'mid', 0.18], [1, 'deep', 0]]);
    this.sp.halo = glow(P, 160, [[0, 'mid', 0.3], [0.5, 'deep', 0.2], [1, 'deep', 0]]);
    this.sp.neb = glow(P, 256, [[0, 'hi', 1], [0.1, 'signal', 0.95], [0.4, 'signal', 0.35], [1, 'signal', 0]]);
    // galaxy sprites: inclined discs with a bright bulge and two dotted arms
    const rg = mulberry32(77);
    for (let k = 0; k < 6; k++) {
      const inc = 0.3 + 0.7 * rg();
      this.gal.push(sprite(64, (c, r) => {
        c.scale(1, inc);
        const g = c.createRadialGradient(0, 0, 0, 0, 0, r);
        g.addColorStop(0, pcss(P, 'hi', 1)); g.addColorStop(0.12, pcss(P, 'hi', 0.7));
        g.addColorStop(0.45, pcss(P, 'mid', 0.28)); g.addColorStop(1, pcss(P, 'mid', 0));
        c.fillStyle = g; c.fillRect(-r, -r, 2 * r, 2 * r);
        if (k % 3 !== 2) {
          c.fillStyle = pcss(P, 'hi', 0.55);
          for (let arm = 0; arm < 2; arm++) for (let i = 0; i < 26; i++) {
            const u = i / 26, a = arm * Math.PI + u * 3.6, rr = 4 + u * (r - 8);
            c.beginPath(); c.arc(Math.cos(a) * rr, Math.sin(a) * rr, 1.6 * (1 - u * 0.5), 0, TAU); c.fill();
          }
        }
      }));
    }
    this.buildWeb();
    this.buildGroups();
  }

  // ------------------------------------------------------------ fields (comoving coordinates, built once)
  private buildWeb() {
    const r = mulberry32(1414);
    const gauss = () => (r() + r() + r() + r() - 2) * 0.85;
    // cluster nodes on a jittered grid, generous margin
    const nodes: Clu[] = [];
    const GX = 17, GY = 10, SX = 2300 / GX, SY = 1360 / GY;
    for (let i = 0; i < GX; i++) for (let j = 0; j < GY; j++) {
      if (r() < 0.12) continue;
      const x = -1150 + (i + 0.5 + (r() - 0.5) * 0.9) * SX, y = -680 + (j + 0.5 + (r() - 0.5) * 0.9) * SY;
      const m = 0.35 + r() * r() * 1.4;
      const mem = Array.from({ length: Math.round(8 + m * 16) }, () => {
        const a = r() * TAU, d = Math.abs(gauss()) * (8 + m * 12);
        return { dx: Math.cos(a) * d, dy: Math.sin(a) * d, s: 0.6 + r() * 0.8 };
      });
      nodes.push({ x, y, m, mem });
    }
    this.clus = nodes;
    // filaments: each node to its 3 nearest, particle streams with a bow
    const seen = new Set<string>();
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i]!;
      const near = nodes.map((b, j) => [Math.hypot(b.x - a.x, b.y - a.y), j] as const).sort((u, v) => u[0] - v[0]).slice(1, 5);
      for (const [d, j] of near) {
        const key = i < j ? `${i}-${j}` : `${j}-${i}`;
        if (seen.has(key) || d > 250) continue;
        seen.add(key);
        const b = nodes[j]!, nx = -(b.y - a.y) / d, ny = (b.x - a.x) / d, bow = (r() - 0.5) * 0.35 * d;
        const n = Math.round(d / 6);
        for (let k = 0; k < n; k++) {
          const u = 0.08 + 0.84 * r(), bw = 4 * u * (1 - u) * bow, w = gauss() * (5 + 7 * 4 * u * (1 - u));
          const x = lerp(a.x, b.x, u) + nx * (bw + w), y = lerp(a.y, b.y, u) + ny * (bw + w);
          const q = r();
          const born = q < 0.55 ? 0 : q < 0.7 ? 1 : q < 0.85 ? 2 : 3; // 0 = formed on beat 1, 1..3 = born on beats 2..4
          this.dots.push({ x, y, fx: (r() - 0.5) * 2000, fy: (r() - 0.5) * 1140, born, s: 0.55 + r() * 0.7, k: r() });
        }
      }
    }
    // the inset: the filament particle nearest the centre (it rides with the expansion)
    let best = this.dots[0]!, bd = Infinity;
    for (const d of this.dots) { const q = Math.hypot(d.x + 90, d.y + 60); if (q < bd) { bd = q; best = d; } }
    this.insetAt = { x: best.x, y: best.y };
  }

  private buildGroups() {
    const r = mulberry32(2424);
    const gauss = () => (r() + r() + r() + r() - 2) * 0.85;
    // one filament across the plane: a gentle S from far-left to near-right, groups strung along it
    const along = (u: number) => ({ x: lerp(-1700, 1700, u), y: lerp(-420, 420, u) + 180 * Math.sin(u * 4.2 - 1.2) });
    for (let i = 0; i < 110; i++) {
      const u = r(), c = along(u), off = gauss() * 120;
      const n = 2 + Math.floor(r() * r() * 8);
      const gal: Gal[] = Array.from({ length: n }, (_, k) => {
        const a = r() * TAU, d = k === 0 ? 0 : 14 + r() * 34;
        return { dx: Math.cos(a) * d, dy: Math.sin(a) * d, s: (k === 0 ? 1.5 : 0.6) + r() * 0.7, rot: r() * TAU, v: Math.floor(r() * 6) };
      });
      const q = r();
      this.grps.push({ x: c.x, y: c.y + off, gal, born: q < 0.6 ? 0 : q < 0.73 ? 1 : q < 0.86 ? 2 : 3 });
    }
    for (let i = 0; i < 2200; i++) {
      const u = r(), c = along(u), off = gauss() * 140;
      const q = r();
      this.dust.push({ x: c.x + gauss() * 30, y: c.y + off, fx: 0, fy: 0, born: q < 0.6 ? 0 : q < 0.73 ? 1 : q < 0.86 ? 2 : 3, s: 0.5 + r() * 0.8, k: r() });
    }
    // the exit galaxy: placed so that after the last expansion step it projects onto the Sun plate's anchor
    const aF = Math.pow(STEP2, this.bar2.length);
    const kk = (CY - NEB.y) / DD, Y = (kk * DD) / (Math.cos(TH) - kk * Math.sin(TH));
    const X = ((NEB.x - CX) * (DD + Y * Math.sin(TH))) / DD;
    const cr = Math.cos(-PHI), sr = Math.sin(-PHI);
    this.grps.push({
      x: (X * cr - Y * sr) / aF, y: (X * sr + Y * cr) / aF, born: 0,
      gal: [{ dx: 0, dy: 0, s: 1.7, rot: 0.6, v: 0 }, { dx: 26, dy: -12, s: 0.8, rot: 2, v: 2 }, { dx: -20, dy: 18, s: 0.7, rot: 1, v: 4 }],
    });
    this.nebGrp = this.grps.length - 1;
  }

  /** Plane (x, y) -> screen, oblique camera. Returns scale too. */
  private proj(x: number, y: number): [number, number, number] {
    const c = Math.cos(PHI), s = Math.sin(PHI);
    const X = x * c - y * s, Y = x * s + y * c;
    const z = Math.max(260, DD + Y * Math.sin(TH));
    return [CX + (DD * X) / z, CY - (DD * Y * Math.cos(TH)) / z, DD / z];
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const L = this.L, c = L.ctx, P = this.P, t = f.t, au = this.ctx.audio;
    L.clear(pcss(P, 'ground'));
    const st = stateAt(this.list, t);
    const bp = beatPulse(au, t, 0.14), kp = kickPulse(au, t, 0.1), dp = downbeatPulse(au, t, 0.3);
    let post: PostOverrides = { bloom: 0, vignette: 0.45, grain: 0.035 };
    const push = clamp((t - this.tPush) / 0.24);
    if (t < this.tPush) this.wide(c, t, st.stage === 'inset', bp, kp, dp, 1);
    else {
      if (push < 1) {
        // the power-of-ten push: the inset grows ten times to fill the frame, the web dissolves outward
        const k = ease.outCubic(push);
        const a = Math.pow(STEP1, this.bar1.length), ix = this.insetAt.x * a + W / 2, iy = this.insetAt.y * a + H / 2;
        const sc = Math.pow(10, k);
        c.save();
        const fa = 1 - ease.outCubic(clamp(push / 0.6));
        c.translate(lerp(ix, W / 2, k), lerp(iy, H / 2, k)); c.scale(sc, sc); c.translate(-ix, -iy);
        this.wide(c, this.tPush - 1e-3, true, 0, 0, 0, fa);
        c.restore();
        c.globalAlpha = k;
      }
      this.tilt(c, t, st.stage === 'nebula', bp, kp, push);
      c.globalAlpha = 1;
      post = { bloom: 0.35, bloomThreshold: 0.7, vignette: 0.5, grain: 0.035 };
      if (st.stage === 'nebula') post = { ...post, bloom: 0.9, halation: 0.25 };
    }
    this.decade(c, push < 0.5 ? 25 : 24, 0.5 + 0.35 * dp);
    // downbeat: a short, contained shake (never a luminance wash on this dark plate)
    post.shake = [dp * 5 * Math.sin(t * 90), dp * 3 * Math.cos(t * 77)];
    c.setTransform(1, 0, 0, 1, 0, 0);
    L.upload();
    clearRT(this.ctx.renderer, out, plin(P, 'ground'));
    this.ctx.comp.draw(this.ctx.renderer, L.texture, out, { mode: 'normal' });
    return post;
  }

  // ------------------------------------------------------------ bar 1: the web, top-down, camera locked
  private wide(c: CanvasRenderingContext2D, t: number, inset: boolean, bp: number, kp: number, dp: number, fa: number) {
    const P = this.P, s0 = this.ctx.start;
    const a = Math.pow(STEP1, steps(this.bar1, t, 0.17));
    const nb = this.bar1.filter((b) => b <= t + 1e-9).length; // how many birth batches are out
    const form = ease.outCubic(clamp((t - s0 - 0.04) / 0.42)); // fog -> web on beat 1
    const ox = W / 2, oy = H / 2;
    c.globalCompositeOperation = 'lighter';
    // the fixed scale reference: a darker window with a soft luminous rim (the Eames square)
    this.square(c, ox, oy, SQ, fa, (0.22 + 0.25 * dp) * fa);
    // filament particles: comoving * a, fixed pixel size
    const dot = this.sp.dot!, dust = this.sp.dust!;
    for (const d of this.dots) {
      if (d.born > nb) continue;
      let x = d.x * a + ox, y = d.y * a + oy;
      let al = 0.55 + 0.35 * d.k;
      if (d.born === 0) { x = lerp(d.fx + ox, x, form); y = lerp(d.fy + oy, y, form); al *= lerp(0.8, 1, form); }
      else {
        const tb = this.bar1[d.born - 1]!, age = t - tb;
        al *= 0.7 + 1.6 * Math.exp(-age / 0.18); // the newborn batch flares on its beat
      }
      if (x < -20 || x > W + 20 || y < -20 || y > H + 20) continue;
      const sz = 8 * d.s;
      const fog = d.born === 0 && form < 0.6;
      c.globalAlpha = clamp(al * (fog ? 1.6 : 1)) * fa;
      const zz = fog ? sz * 2.2 : sz;
      c.drawImage(fog ? dust : dot, x - zz / 2, y - zz / 2, zz, zz);
    }
    // clusters: bound — their members keep their offsets and size, only the centre is carried outward
    const core = this.sp.core!, halo = this.sp.halo!;
    for (const q of this.clus) {
      const cx = q.x * a + ox, cy = q.y * a + oy;
      if (cx < -120 || cx > W + 120 || cy < -120 || cy > H + 120) continue;
      const fx = lerp(cx + (q.x * 0.6), cx, form), fy = lerp(cy + (q.y * 0.6), cy, form);
      const hs = 70 + q.m * 70;
      c.globalAlpha = 0.5 * form * fa;
      c.drawImage(halo, fx - hs / 2, fy - hs / 2, hs, hs);
      const cs = (34 + q.m * 34) * (1 + 0.35 * bp);
      c.globalAlpha = clamp((0.55 + 0.45 * bp) * form) * fa;
      c.drawImage(core, fx - cs / 2, fy - cs / 2, cs, cs);
      c.globalAlpha = clamp(0.8 * form + 0.2 * kp) * fa;
      for (const m of q.mem) { const sz = 6 * m.s; c.drawImage(dot, fx + m.dx - sz / 2, fy + m.dy - sz / 2, sz, sz); }
    }
    // the next decade: a 1/10 inset square rides on one filament knot
    if (inset) {
      const tin = this.list.find((s) => s.s.stage === 'inset')?.t ?? t;
      const k = ease.outBack(clamp((t - tin) / 0.2));
      this.square(c, this.insetAt.x * a + ox, this.insetAt.y * a + oy, INSET * (0.2 + 0.8 * k) * (1 + 0.25 * bp), 0.6 * fa, fa, true);
    }
    c.globalCompositeOperation = 'source-over';
  }

  // ------------------------------------------------------------ bar 2: galaxy groups along one filament, oblique
  private tilt(c: CanvasRenderingContext2D, t: number, nebula: boolean, bp: number, kp: number, push: number) {
    const P = this.P;
    const a = Math.pow(STEP2, steps(this.bar2, t, 0.17));
    const nb = this.bar2.filter((b) => b <= t + 1e-9).length;
    const land = ease.outCubic(clamp(push));
    c.globalCompositeOperation = 'lighter';
    // the Eames square lies on the plane (a fixed trapezoid): same reference, next decade
    this.planeSquare(c, SQ, 0.18 + 0.2 * downbeatPulse(this.ctx.audio, t, 0.3));
    // diffuse filament dust (unbound: carried by the expansion)
    const dust = this.sp.dust!;
    for (const d of this.dust) {
      if (d.born > nb) continue;
      const [x, y, s] = this.proj(d.x * a, d.y * a);
      if (x < -20 || x > W + 20 || y < -20 || y > H + 20) continue;
      let al = (0.45 + 0.45 * d.k) * land;
      if (d.born > 0) al *= 0.8 + 1.8 * Math.exp(-(t - this.bar2[d.born - 1]!) / 0.18);
      const sz = 7 * d.s * s;
      c.globalAlpha = clamp(al);
      c.drawImage(dust, x - sz / 2, y - sz / 2, sz, sz);
    }
    // groups: bound — galaxies keep offsets and size on the plane
    const tNeb = this.bar2[this.bar2.length - 1] ?? this.ctx.end;
    for (let gi = 0; gi < this.grps.length; gi++) {
      const g = this.grps[gi]!;
      if (g.born > nb) continue;
      const cxw = g.x * a, cyw = g.y * a;
      const [gx, gy, gs] = this.proj(cxw, cyw);
      if (gx < -200 || gx > W + 200 || gy < -200 || gy > H + 200) continue;
      let al = land;
      if (g.born > 0) al *= 0.85 + 1.4 * Math.exp(-(t - this.bar2[g.born - 1]!) / 0.2);
      const isNeb = gi === this.nebGrp && nebula;
      for (const m of g.gal) {
        const [x, y, s] = this.proj(cxw + m.dx, cyw + m.dy);
        const sz = 50 * m.s * s * (1 + (m === g.gal[0] ? 0.3 * bp : 0));
        c.save();
        c.translate(x, y); c.rotate(m.rot); c.scale(1, 0.55 + 0.45 * Math.cos(TH) * 0.5 + 0.2);
        c.globalAlpha = clamp(al * (0.75 + 0.25 * kp));
        c.drawImage(this.gal[m.v]!, -sz / 2, -sz / 2, sz, sz);
        c.restore();
      }
      if (isNeb) {
        // exit: one galaxy brightens into a nebula — the warm hand-off to the Sun plate
        const k = ease.outCubic(clamp((t - tNeb) / 0.35));
        const ns = (140 + 560 * k) * (1 + 0.12 * bp) * gs;
        c.globalAlpha = clamp(0.3 + 0.7 * k);
        c.drawImage(this.sp.neb!, gx - ns / 2, gy - ns / 2, ns, ns);
      }
    }
    c.globalAlpha = 1;
    c.globalCompositeOperation = 'source-over';
  }

  /** The Eames square: a slightly darker window with a soft luminous rim (no hairline). */
  private square(c: CanvasRenderingContext2D, x: number, y: number, s: number, wAlpha: number, rim: number, hot = false) {
    const P = this.P;
    c.save();
    c.globalCompositeOperation = 'source-over';
    c.globalAlpha = 1;
    c.fillStyle = pcss(P, 'deep', 0.35 * wAlpha);
    c.fillRect(x - s / 2, y - s / 2, s, s);
    c.globalCompositeOperation = 'lighter';
    c.shadowColor = pcss(P, 'mid', 0.9);
    c.shadowBlur = 18;
    c.strokeStyle = pcss(P, hot ? 'hi' : 'mid', rim);
    c.lineWidth = s < 200 ? 3 : 5;
    c.strokeRect(x - s / 2, y - s / 2, s, s);
    c.restore();
  }

  private planeSquare(c: CanvasRenderingContext2D, s: number, rim: number) {
    const P = this.P, h = s / 2;
    const q = [this.proj(-h, -h), this.proj(h, -h), this.proj(h, h), this.proj(-h, h)];
    c.save();
    c.globalCompositeOperation = 'source-over';
    c.beginPath();
    q.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
    c.closePath();
    c.fillStyle = pcss(P, 'deep', 0.3);
    c.fill();
    c.globalCompositeOperation = 'lighter';
    c.shadowColor = pcss(P, 'mid', 0.9);
    c.shadowBlur = 18;
    c.strokeStyle = pcss(P, 'mid', rim);
    c.lineWidth = 5;
    c.stroke();
    c.restore();
  }

  /** One large display numeral: the power of the fixed square. Changes only on the downbeat push. */
  private decade(c: CanvasRenderingContext2D, e: number, a: number) {
    const P = this.P;
    c.save();
    c.globalAlpha = a;
    c.fillStyle = pcss(P, 'hi', 1);
    c.font = `150px "${F.archivo(100, 800)}"`;
    c.textBaseline = 'alphabetic';
    c.fillText('10', 150, H - 150);
    const w = c.measureText('10').width;
    c.font = `78px "${F.archivo(100, 800)}"`;
    c.fillText(String(e), 150 + w + 6, H - 150 - 72);
    c.restore();
  }
}
