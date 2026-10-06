// VOID — memory stepping-stones across a black void (p29-void-descent, climax, ink ground).
// One solid slab stone appears on every beat (it slams up out of the void, its edges flash bone) and the one
// before it erases from the back edge — the path only exists under the walker. Stones carry the line's words
// cut into their faces (sung syllable burns signal, then settles into the cut) and, on the stones between
// words, small reliefs of earlier motifs: the two points, the room's door, a paper building.
// Stones are real 3D boxes projected in Canvas2D (perspective camera rig per shot, painter's order, back-face
// cull), so the shots are genuine camera changes: side view, over-the-shoulder, top view, and a steep plunge
// on the last beat while the last stone drops away into the void.
import type * as THREE from 'three';
import { Scene, type Frame, type PostOverrides } from '../engine/scene';
import { Layer2D, clearRT } from '../engine/gl';
import { LIN, rgba, type PaletteKey } from '../engine/palette';
import { drawLyric, layoutLine, ownedLines, F } from '../engine/lyric';
import { beatPulse, kickPulse, downbeatPulse } from '../engine/beat';
import { stateAt, shotAt, type PlateInfo, type Shot } from '../engine/shots';
import { clamp, lerp, hash, ease } from '../engine/util';
import type { Line } from '../engine/lyrics';
import { shots, type Cam, type Face } from './void.shots';

const W = 1920, H = 1080;
type V3 = [number, number, number];
type P2 = { x: number; y: number; z: number };

// stone geometry (world units) and face resolution (face px per unit, for engraving/reliefs)
const SW = 3.2, SH = 1.3, SD = 3.2, PX = 100;
const STEP_X = 5.0, STEP_Y = -0.5;
const MOTIFS = ['points', 'door', 'building'] as const;
type Motif = (typeof MOTIFS)[number];

interface Stone {
  k: number;
  c: V3; // centre (before rise/fall offsets)
  t0: number; // appears (its beat)
  tErase: number; // erase starts (Infinity for the last stone)
  word: number; // engraved word index, -1 for relief stones
  motif: Motif | null;
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => mul(a, 1 / Math.hypot(a[0], a[1], a[2]));
const lerp3 = (a: V3, b: V3, s: number): V3 => [lerp(a[0], b[0], s), lerp(a[1], b[1], s), lerp(a[2], b[2], s)];

/** A pinhole camera: eye, basis, focal length in px, optional roll. */
class Cam3 {
  r: V3; u: V3; f: V3; fpx: number;
  constructor(public e: V3, target: V3, up: V3, fovDeg: number, roll = 0) {
    this.f = norm(sub(target, e));
    let r = norm(cross(this.f, up));
    let u = cross(r, this.f);
    if (roll) {
      const c = Math.cos(roll), s = Math.sin(roll);
      [r, u] = [add(mul(r, c), mul(u, s)), add(mul(u, c), mul(r, -s))];
    }
    this.r = r; this.u = u;
    this.fpx = H / 2 / Math.tan((fovDeg * Math.PI) / 360);
  }
  p(q: V3): P2 {
    const d = sub(q, this.e);
    const z = dot(d, this.f), zz = Math.max(0.05, z);
    return { x: W / 2 + (this.fpx * dot(d, this.r)) / zz, y: H / 2 - (this.fpx * dot(d, this.u)) / zz, z };
  }
}

export default class Void extends Scene {
  private layer!: Layer2D;
  private list: Shot[] = [];
  private plate!: PlateInfo;
  private lines: Line[] = [];
  private stones: Stone[] = [];
  private events: number[] = []; // times the camera target may change
  /** v4: composited by a WorldHost (LINES) — no ink ground, the stones only. */
  private get hosted() { return !!this.ctx.params.hosted; }

  override init() {
    this.plate = this.ctx.params as PlateInfo;
    this.list = shots(this.plate, this.ctx.audio);
    this.lines = ownedLines(this.ctx);
    this.layer = new Layer2D();
    const { start, end } = this.ctx;
    const beats = this.ctx.audio.beats.filter((b) => b >= start - 1e-3 && b < end - 0.05);
    const words = this.lines[0]?.words ?? [];
    // each word goes on the stone that is newest when the word starts
    const wordOf = beats.map(() => -1);
    words.forEach((w, j) => {
      let k = 0;
      for (let i = 0; i < beats.length; i++) if (beats[i]! <= w.start + 1e-3) k = i;
      if (wordOf[k] === -1) wordOf[k] = j;
    });
    let m = 0;
    this.stones = beats.map((t0, k) => {
      const word = wordOf[k]!;
      const next = beats[k + 1];
      const wEnd = word >= 0 ? words[word]!.end : -Infinity;
      return {
        k,
        c: [k * STEP_X, k * STEP_Y, 0.9 * Math.sin(k * 1.3)] as V3,
        t0,
        tErase: next === undefined ? Infinity : Math.max(next, wEnd),
        word,
        motif: word < 0 ? MOTIFS[m++ % MOTIFS.length]! : null,
      };
    });
    const ev = [...beats, ...words.map((w) => w.end + 0.1)].filter((x) => x > start + 1e-3);
    this.events = [...new Set(ev)].sort((x, y) => x - y);
  }

  /** Where the camera wants to be at t: the newest stone, or between it and the stone whose word is still sung. */
  private target(t: number): { k: number; c: V3 } {
    const S = this.stones, words = this.lines[0]?.words ?? [];
    let k = 0;
    for (let i = 0; i < S.length; i++) if (S[i]!.t0 <= t) k = i;
    const w = S.find((s) => s.k < k && s.word >= 0 && t >= S[s.k]!.t0 && t < words[s.word]!.end + 0.1);
    return { k, c: w ? lerp3(w.c, S[k]!.c, 0.3) : S[k]!.c }; // biased to the sung word
  }

  /** Newest stone at t (index), and the walker's focus point: holds, then glides to each new target. */
  private focus(t: number, depth = 0): { k: number; F: V3 } {
    const cur = this.target(t);
    if (depth > 3) return { k: cur.k, F: cur.c };
    let tc = -Infinity;
    for (const x of this.events) if (x <= t + 1e-6) tc = x;
    if (!isFinite(tc) || t - tc >= 0.32) return { k: cur.k, F: cur.c };
    const from = this.focus(tc - 1e-4, depth + 1).F;
    return { k: cur.k, F: lerp3(from, cur.c, ease.outCubic(clamp((t - tc) / 0.32))) };
  }

  private camera(cam: Cam, F: V3, t: number, t0: number): Cam3 {
    const drift = t - t0; // slow push inside a shot (never a zoom pulse: the eye moves)
    switch (cam) {
      case 'side':
        return new Cam3(add(F, [-0.8 + drift * 0.6, 2.2, 10.5 - drift * 0.8]), add(F, [0.4, -0.3, 0]), [0, 1, 0], 46);
      case 'shoulder':
        return new Cam3(add(F, [-4.8 + drift * 0.5, 4.4, -0.5]), add(F, [2.6, -1.6, 0.3]), [0, 1, 0], 58, -0.05);
      case 'top':
        return new Cam3(add(F, [-0.7, 10 - drift * 1.2, 0.001]), add(F, [-0.7, 0, 0]), [0, 0, -1], 50);
      default:
        return new Cam3(add(F, [-3.2, 8.5, 5.5]), add(F, [0.6, -3.5, -0.6]), [0, 1, 0], 55, 0.12);
    }
  }

  /** Stone state at t: visible length fraction kept (erasing from the back), rise/fall offset, flash. */
  private stoneAt(s: Stone, t: number) {
    if (t < s.t0) return null;
    const a = (t - s.t0) / 0.16;
    const rise = a < 1 ? -3.2 * (1 - ease.outBack(clamp(a))) : 0;
    const er = clamp((t - s.tErase) / 0.42);
    let fall = 0;
    const last = s.k === this.stones.length - 1;
    const tDrop = this.ctx.end - 0.26;
    if (last && t > tDrop) { const d = t - tDrop; fall = -(2 * d + 70 * d * d); }
    const flash = Math.exp(-(t - s.t0) / 0.14);
    return { keep: 1 - ease.inCubic(er), er, dy: rise + fall, flash, gone: er >= 1 };
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, audio } = this.ctx;
    const t = f.t;
    const st = stateAt(this.list, t);
    const sh = shotAt(this.list, t);
    const cam = st.cam as Cam, face = st.face as Face;
    const L = this.layer, c = L.ctx;
    L.clear();
    const { F } = this.focus(t);
    const C = this.camera(cam, F, t, sh.t0);
    const bp = beatPulse(audio, t, 0.13), kp = kickPulse(audio, t, 0.1), dp = downbeatPulse(audio, t, 0.25);

    // draw order: far → near
    const live = this.stones
      .map((s) => ({ s, v: this.stoneAt(s, t) }))
      .filter((o) => o.v && !(o.v.gone && t - o.s.tErase > 1.6))
      .map((o) => ({ ...o, z: C.p(add(o.s.c, [0, o.v!.dy, 0])).z }))
      // a stone the eye is standing over fades out instead of filling the lens
      .map((o) => ({ ...o, near: clamp((o.z - 3) / 2) }))
      .filter((o) => o.near > 0)
      .sort((a, b) => b.z - a.z);

    // erased footprints: a faint pencil outline of where the stone was (the path erasing behind)
    for (const { s, v } of live) {
      if (!v || v.er <= 0) continue;
      const fade = clamp(1 - (t - s.tErase - 0.2) / 1.4);
      this.ghost(c, C, s.c, fade * 0.7);
    }

    // plumb lines into the void under each live stone: depth without particles
    for (const { s, v, near } of live) {
      if (!v || v.gone) continue;
      c.globalAlpha = near;
      const cc = add(s.c, [0, v.dy, 0]);
      for (const [dx, dz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
        const x = dx < 0 ? SW / 2 - SW * v.keep : SW / 2;
        const a = C.p(add(cc, [x, -SH / 2, (dz * SD) / 2])), b = C.p(add(cc, [x, -SH / 2 - 26, (dz * SD) / 2]));
        if (a.z < 0.3 || b.z < 0.3) continue;
        const g = c.createLinearGradient(a.x, a.y, b.x, b.y);
        g.addColorStop(0, rgba('graphite', 0.55 * v.keep));
        g.addColorStop(1, rgba('graphite', 0));
        c.strokeStyle = g;
        c.lineWidth = 1 + 1.5 * kp;
        c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke();
      }
    }

    for (const { s, v, near } of live) if (v && !v.gone) { c.globalAlpha = near; this.drawStone(c, C, s, v, face, t, kp); }
    c.globalAlpha = 1;

    // over-the-shoulder: the walker's head and shoulder in the near foreground, stepping on each beat
    if (cam === 'shoulder') this.walker(c, bp);

    // the impact line on each new stone's beat: a hairline slash across the frame under the stone
    const { k } = this.focus(t);
    const ns = this.stones[k]!;
    const imp = Math.exp(-(t - ns.t0) / 0.1);
    if (imp > 0.03) {
      const q = C.p(add(ns.c, [0, -SH / 2, 0]));
      c.strokeStyle = rgba('bone', 0.7 * imp);
      c.lineWidth = 2;
      const hw = 260 + 700 * (1 - imp);
      c.beginPath(); c.moveTo(q.x - hw, q.y + 30); c.lineTo(q.x + hw, q.y + 30); c.stroke();
    }

    L.upload();
    clearRT(renderer, out, this.hosted ? [0, 0, 0] : LIN.ink, this.hosted ? 0 : 1);
    this.ctx.comp.draw(renderer, L.texture, out, { mode: 'normal' });

    // hits: a punch-in on every cut, a small punch on every beat, a shake on the downbeat
    const cut = Math.exp(-(t - sh.t0) / 0.09);
    const sd = hash(Math.floor(f.bar), 5) * Math.PI * 2;
    return {
      zoom: 1 + 0.07 * cut + 0.028 * bp,
      flash: sh.index > 0 ? 0.14 * Math.exp(-(t - sh.t0) / 0.022) : 0,
      shake: [Math.cos(sd) * 9 * dp, Math.sin(sd) * 9 * dp],
      bloom: cam === 'plunge' ? 0.3 : 0.12,
      bloomThreshold: 0.8,
      vignette: 0.45,
    };
  }

  /** Box corners of stone s with the back part (−x) erased: keep ∈ [0,1] of its length remains. */
  private corners(cc: V3, keep: number): V3[] {
    const x0 = SW / 2 - SW * keep, x1 = SW / 2, y0 = -SH / 2, y1 = SH / 2, z0 = -SD / 2, z1 = SD / 2;
    return [
      [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
      [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1],
    ].map((q) => add(cc, q as V3));
  }

  private ghost(c: CanvasRenderingContext2D, C: Cam3, cc: V3, a: number) {
    if (a <= 0.01) return;
    const P = this.corners(cc, 1).map((q) => C.p(q));
    if (P.some((q) => q.z < 0.3)) return;
    c.strokeStyle = rgba('graphite', a);
    c.lineWidth = 1.6;
    c.setLineDash([6, 8]);
    c.beginPath();
    for (const [i, j] of [[3, 2], [2, 6], [6, 7], [7, 3]] as const) { c.moveTo(P[i]!.x, P[i]!.y); c.lineTo(P[j]!.x, P[j]!.y); }
    c.stroke();
    c.setLineDash([]);
  }

  private drawStone(c: CanvasRenderingContext2D, C: Cam3, s: Stone, v: NonNullable<ReturnType<Void['stoneAt']>>, face: Face, t: number, kp: number) {
    const cc = add(s.c, [0, v.dy, 0]);
    const V = this.corners(cc, v.keep);
    const P = V.map((q) => C.p(q));
    // faces: indices, outward normal, material
    const faces: { idx: number[]; n: V3; col: PaletteKey; a: number; name: string }[] = [
      { idx: [3, 2, 6, 7], n: [0, 1, 0], col: 'paper2', a: 1, name: 'top' },
      { idx: [4, 5, 6, 7], n: [0, 0, 1], col: 'graphite', a: 1, name: 'front' },
      { idx: [0, 1, 2, 3], n: [0, 0, -1], col: 'graphite', a: 0.75, name: 'back' },
      { idx: [1, 5, 6, 2], n: [1, 0, 0], col: 'ink2', a: 1, name: 'right' },
      { idx: [0, 4, 7, 3], n: [-1, 0, 0], col: 'ink2', a: 1, name: 'left' },
      { idx: [0, 1, 5, 4], n: [0, -1, 0], col: 'ink2', a: 1, name: 'bottom' },
    ];
    for (const fc of faces) {
      if (fc.idx.some((i) => P[i]!.z < 0.3)) continue; // near clip: a face through the lens is dropped
      const ctr = mul(fc.idx.reduce<V3>((acc, i) => add(acc, V[i]!), [0, 0, 0]), 0.25);
      if (dot(fc.n, sub(C.e, ctr)) <= 0) continue;
      const pts = fc.idx.map((i) => P[i]!);
      const path = new Path2D();
      pts.forEach((p, i) => (i ? path.lineTo(p.x, p.y) : path.moveTo(p.x, p.y)));
      path.closePath();
      // stones (p31): dark silhouettes laid across the void — ink sides, a graphite top that carries the word
      const col: PaletteKey = this.plate.variant === 'stones' ? (fc.name === 'top' ? 'graphite' : 'ink') : fc.col;
      c.fillStyle = rgba(col, fc.a);
      c.fill(path);
      // the slam: a bone wash over the faces as the stone lands
      if (v.flash > 0.02) { c.fillStyle = rgba('bone', 0.55 * v.flash); c.fill(path); }
      c.strokeStyle = rgba('bone', 0.35 + 0.65 * v.flash);
      c.lineWidth = 1.2 + 2.2 * kp + 3 * v.flash;
      c.stroke(path);
      // the engraving surface for this shot
      if (fc.name === face) this.engrave(c, C, s, cc, face, path, t);
    }
  }

  /** Face-local frame (px space fw x fh, origin top-left) → screen, linearised at the face centre. */
  private faceXform(C: Cam3, cc: V3, face: Face, cam: Cam) {
    let o: V3, u: V3, vv: V3, fw: number, fh: number;
    if (face === 'front') { o = add(cc, [0, 0, SD / 2]); u = [1, 0, 0]; vv = [0, -1, 0]; fw = SW * PX; fh = SH * PX; }
    else if (cam === 'shoulder') { o = add(cc, [0, SH / 2, 0]); u = [0, 0, 1]; vv = [-1, 0, 0]; fw = SD * PX; fh = SW * PX; }
    else { o = add(cc, [0, SH / 2, 0]); u = [1, 0, 0]; vv = [0, 0, 1]; fw = SW * PX; fh = SD * PX; }
    const eps = 0.05;
    const p0 = C.p(o), pu = C.p(add(o, mul(u, eps))), pv = C.p(add(o, mul(vv, eps)));
    const k = 1 / (eps * PX);
    const a = (pu.x - p0.x) * k, b = (pu.y - p0.y) * k, cx = (pv.x - p0.x) * k, d = (pv.y - p0.y) * k;
    // local (lx, ly) with origin top-left → screen = p0 + J * (lx - fw/2, ly - fh/2)
    return { m: [a, b, cx, d, p0.x - a * fw / 2 - cx * fh / 2, p0.y - b * fw / 2 - d * fh / 2] as const, fw, fh };
  }

  private engrave(c: CanvasRenderingContext2D, C: Cam3, s: Stone, cc: V3, face: Face, clip: Path2D, t: number) {
    const cam = stateAt(this.list, t).cam as Cam;
    const { m, fw, fh } = this.faceXform(C, cc, face, cam);
    // keep the engraving on the (possibly half-erased) face
    const erased = s.tErase < t ? clamp((t - s.tErase) / 0.42) : 0;
    c.save();
    c.clip(clip);
    c.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
    const onTop = face === 'top';
    const cut: PaletteKey = onTop ? 'ink' : 'bone';
    // an engraved border groove
    c.strokeStyle = rgba(onTop ? 'graphite' : 'ink', 0.7);
    c.lineWidth = 3;
    const ins = Math.min(fw, fh) * 0.08;
    c.strokeRect(ins, ins, fw - 2 * ins, fh - 2 * ins);
    const alpha = 1 - erased;
    if (s.word >= 0) {
      const line = this.lines[0]!;
      const fam = F.slam();
      const probe = layoutLine(c, line, fam, 100);
      const wb = probe.words[s.word]!;
      const size = Math.min(fh * 0.62, (fw * 0.8) / (wb.w / 100));
      const lay = layoutLine(c, line, fam, size);
      const wz = lay.words[s.word]!;
      const shift = -(-lay.width / 2 + wz.x + wz.w / 2);
      drawLyric(c, line, t, {
        x: fw / 2, y: fh / 2 + size * 0.36, size, family: fam, align: 'center',
        sungColor: cut, unsungColor: onTop ? 'graphite' : 'ink', unsungAlpha: 0.5, alpha,
        charTransform: (_ch, _i, cs) => (cs.word === s.word ? { dx: shift, dy: cs.sung ? 0 : -4, scale: cs.sung ? 1 + 0.25 * (1 - cs.frac) ** 3 : 1 } : { alpha: 0 }),
        drawChar: (g, ch, cs) => {
          // cut into the stone: a shadow lip, then the groove; the syllable being sung burns signal
          const fill = g.fillStyle;
          if (cs.sung) {
            g.fillStyle = rgba(onTop ? 'bone' : 'ink', 0.8);
            g.fillText(ch, 3, 3);
          }
          g.fillStyle = cs.sung && cs.frac < 1 ? rgba('signal') : fill;
          g.fillText(ch, 0, 0);
        },
      });
    } else if (s.motif) {
      c.globalAlpha *= alpha;
      this.relief(c, s.motif, fw, fh, onTop, t - s.t0);
    }
    c.restore();
  }

  /** Earlier motifs as small reliefs, drawn in face px. */
  private relief(c: CanvasRenderingContext2D, motif: Motif, fw: number, fh: number, onTop: boolean, age: number) {
    const ink: PaletteKey = onTop ? 'ink' : 'bone';
    const u = Math.min(fw, fh);
    const cx = fw / 2, cy = fh / 2;
    c.lineWidth = Math.max(2, u * 0.02);
    c.strokeStyle = rgba(ink, 0.85);
    if (motif === 'points') {
      // two points of light on one orbit, turning
      const R = u * 0.3, a = age * 2.2;
      c.beginPath(); c.ellipse(cx, cy, R, R * 0.55, 0, 0, Math.PI * 2); c.stroke();
      for (const off of [0, Math.PI]) {
        const x = cx + R * Math.cos(a + off), y = cy + R * 0.55 * Math.sin(a + off);
        c.fillStyle = rgba('signal');
        c.beginPath(); c.arc(x, y, u * 0.045, 0, Math.PI * 2); c.fill();
      }
    } else if (motif === 'door') {
      // the room's door, ajar: frame, leaf, a line of light at the gap
      const dw = u * 0.34, dh = u * 0.62, x0 = cx - dw / 2, y0 = cy - dh / 2;
      c.strokeRect(x0, y0, dw, dh);
      c.beginPath(); c.moveTo(x0 + dw, y0); c.lineTo(x0 + dw * 0.72, y0 + dh * 0.08); c.lineTo(x0 + dw * 0.72, y0 + dh * 0.92); c.lineTo(x0 + dw, y0 + dh); c.stroke();
      c.fillStyle = rgba('signal');
      c.fillRect(x0 + dw * 0.9, y0 + 4, Math.max(3, dw * 0.06), dh - 8);
      c.beginPath(); c.arc(x0 + dw * 0.78, cy, u * 0.018, 0, Math.PI * 2); c.fillStyle = rgba(ink, 0.9); c.fill();
    } else {
      // a paper building: folded facade with a window grid and fold lines
      const bw = u * 0.5, bh = u * 0.56, x0 = cx - bw / 2, y0 = cy - bh / 2 + u * 0.04;
      c.strokeRect(x0, y0, bw, bh);
      c.beginPath(); c.moveTo(x0, y0); c.lineTo(x0 + bw * 0.5, y0 - u * 0.12); c.lineTo(x0 + bw, y0); c.stroke();
      c.setLineDash([u * 0.03, u * 0.025]);
      c.beginPath(); c.moveTo(x0 + bw * 0.5, y0 - u * 0.12); c.lineTo(x0 + bw * 0.5, y0 + bh); c.stroke();
      c.setLineDash([]);
      c.fillStyle = rgba(ink, 0.85);
      for (let i = 0; i < 3; i++) for (let j = 0; j < 4; j++) {
        const lit = hash(i, j, 29) > 0.75;
        c.fillStyle = lit ? rgba('signal') : rgba(ink, 0.8);
        c.fillRect(x0 + bw * (0.1 + j * 0.22), y0 + bh * (0.12 + i * 0.28), bw * 0.1, bh * 0.14);
      }
    }
  }

  /** Over-the-shoulder foreground: head + shoulder silhouette, bobbing one step per beat. */
  private walker(c: CanvasRenderingContext2D, bp: number) {
    const bob = 14 * bp;
    c.save();
    // bottom-right corner, mirrored and small: the path and its words stay clear
    c.translate(W + 60, 430 + bob);
    c.scale(-0.62, 0.62);
    const g = new Path2D();
    g.moveTo(-40, H + 20);
    g.bezierCurveTo(40, 900, 250, 860, 360, 850);
    g.bezierCurveTo(380, 800, 330, 740, 340, 680);
    g.bezierCurveTo(350, 560, 560, 540, 600, 660);
    g.bezierCurveTo(620, 730, 590, 800, 560, 850);
    g.bezierCurveTo(700, 870, 820, 930, 880, H + 20);
    g.closePath();
    c.fillStyle = rgba('ink2');
    c.fill(g);
    c.strokeStyle = rgba('graphite', 0.9);
    c.lineWidth = 2.5;
    c.stroke(g);
    c.restore();
  }

  override dispose() { this.layer?.texture.dispose(); }
}
