// LENS — optical instruments. Irises are mechanical aperture diaphragms: n blades pivoting in an engraved,
// knurled housing over a disc of lens glass. Not a human eye, not a sci-fi eye: a machine that looks.
//   GL pass (EYE_GLSL ring helpers): housing metal, knurl, engraved rings and scale ticks, the glass and the star
//   Canvas2D: the blades (projected wedge polygons), wall/beams, and every lyric line via drawLyric
// Variants (data/edit.json):
//   gaze  (p11) two irises face each other across a closed room's wall. Line 11 is engraved on the left ring;
//         line 12 exists only where the two eyes' light overlaps inside the wall. Beat: blades step 1/12 turn.
//   ai    (p20) one machine eye swallows line 18 into its aperture; the stolen words float inside the pupil as
//         evidence while line 19 is reflected on the front glass. Beat: blades step and snap. Exit: a glint flares.
//   star  (p37) an observation eye over the star. Beats 1-2: the latch preloads (click); beats 3-8: the six blades
//         close one per beat to aperture 0; the last ray is cut.
import * as THREE from 'three';
import { Scene, type Frame, type PostOverrides } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { rgba, type PaletteKey } from '../engine/palette';
import { drawLyric, layoutLine, ownedLines, F, type CharState, type CharXform } from '../engine/lyric';
import { beatPulse, kickPulse, downbeatPulse, beatIndex } from '../engine/beat';
import { stateAt, shotAt, type PlateInfo, type Shot } from '../engine/shots';
import { EYE_GLSL } from '../engine/prim';
import { clamp, ease, hash, lerp, smoothstep, TAU } from '../engine/util';
import type { Line } from '../engine/lyrics';
import { shots } from './lens.shots';

type P = { x: number; y: number };
type Cam = { s: number; fx: number; fy: number; rot: number };
/** A ring/iris in world px: centre, radius, and the squash of a disc turned away from the camera. */
type Ring = { c: P; R: number; sx: number; sy: number };
type Iris = Ring & { n: number; ap: number; phi: number; hot: number; edge: number; side?: boolean };

const proj = (cam: Cam, q: P): P => {
  const x = (q.x - cam.fx) * cam.s, y = (q.y - cam.fy) * cam.s;
  const c = Math.cos(cam.rot), s = Math.sin(cam.rot);
  return { x: W / 2 + c * x - s * y, y: H / 2 + s * x + c * y };
};
const onRing = (r: Ring, th: number, k = 1): P => ({ x: r.c.x + Math.cos(th) * r.R * k * r.sx, y: r.c.y + Math.sin(th) * r.R * k * r.sy });

// ------------------------------------------------------------------ GL: housing, glass, star
const FRAG = /* glsl */ `
uniform vec2 uRes;
uniform vec4 uI[2];   // iris: screen centre xy, blade-circle radii xy (px)
uniform vec4 uJ[2];   // x ellipse rotation, y index-ring rotation, z glass glow, w present
uniform vec4 uStar;   // screen xy, radius px, intensity
uniform float uTick;  // beat: the engraving catches light
${EYE_GLSL}
void main() {
  vec2 fc = vec2(vUv.x, 1.0 - vUv.y) * uRes;
  vec3 col = C_INK;
  // star (behind the glass): a hot core, an ember body, a long signal falloff
  vec2 sd = fc - uStar.xy; float sr = length(sd) / max(uStar.z, 1.0);
  col += uStar.w * (C_BONE * 3.0 * exp(-sr * sr * 40.0) + C_EMBER * 1.6 * exp(-sr * sr * 3.0) + C_SIGNAL * 0.45 * exp(-sr * 1.4));
  for (int i = 0; i < 2; i++) {
    if (uJ[i].w < 0.5) continue;
    vec2 d = rot2(uJ[i].x) * (fc - uI[i].xy);
    vec2 q = d / uI[i].zw;
    float r = length(q), a = atan(q.y, q.x);
    float aa = 1.6 / min(uI[i].z, uI[i].w);
    // housing annulus 1.0 .. 1.32: turned metal (fine concentric lathe marks), knurled outer band
    float hous = smoothstep(1.0 - aa, 1.0, r) * smoothstep(1.32 + aa, 1.32, r);
    float lathe = 0.5 + 0.5 * sin(r * 900.0 + hash11(floor(r * 60.0)) * 6.0);
    vec3 metal = C_INK2 * (1.15 + 0.35 * lathe) + C_GRAPHITE * 0.06 * sat(0.5 - 0.5 * sin(a - 0.9));
    col = mix(col, metal, hous);
    col += C_GRAPHITE * 0.55 * segRing(r, a, 1.255, 1.315, 180.0, 0.42, uJ[i].y, aa);
    col += C_BONE * (0.28 + 0.5 * uTick) * ringMask(r, 1.012, aa * 0.7, aa);
    col += C_GRAPHITE * 0.9 * ringMask(r, 1.24, aa * 0.5, aa);
    col += C_BONE * (0.30 + 0.35 * uTick) * segRing(r, a, 1.022, 1.058, 72.0, 0.10, uJ[i].y, aa);
    col += C_BONE * 0.45 * segRing(r, a, 1.022, 1.085, 12.0, 0.012, uJ[i].y, aa);
    // lens glass: darker than the room, faint coating rings, the eye's own light
    float glass = smoothstep(1.0, 1.0 - aa, r);
    vec3 g = col * 0.55 + C_INK * 0.25 + C_GRAPHITE * 0.10 * ringMask(r, 0.62, 0.003, aa) + C_GRAPHITE * 0.07 * ringMask(r, 0.83, 0.002, aa);
    g += uJ[i].z * (C_BONE * 1.4 * exp(-r * r * 260.0) + C_EMBER * 0.8 * exp(-r * r * 45.0) + C_SIGNAL * 0.16 * exp(-r * 5.0));
    // coating tint: a faint graphite bowl, lighter toward the rim of the glass
    g += C_GRAPHITE * 0.05 * smoothstep(0.2, 1.0, r);
    col = mix(col, g, glass);
  }
  fragColor = vec4(max(col, 0.0), 1.0);
}`;

// ------------------------------------------------------------------ scene
export default class Lens extends Scene {
  private layer!: Layer2D;
  private pass!: FSPass;
  private list: Shot[] = [];
  private plate!: PlateInfo;
  private lines: Line[] = [];

  override init() {
    this.plate = this.ctx.params as PlateInfo;
    this.list = shots(this.plate, this.ctx.audio);
    this.lines = ownedLines(this.ctx);
    this.layer = new Layer2D();
    const v4 = () => new THREE.Vector4();
    this.pass = new FSPass(FRAG, {
      uRes: { value: new THREE.Vector2(W, H) },
      uI: { value: [v4(), v4()] },
      uJ: { value: [v4(), v4()] },
      uStar: { value: v4() },
      uTick: { value: 0 },
    });
  }

  // ---------------------------------------------------------------- timing helpers
  /** Beats since the plate's first beat, with an eased snap into each beat (outBack: a mechanical step). */
  private step(t: number, snap = 0.11, fn: (x: number) => number = ease.outBack) {
    const au = this.ctx.audio;
    const i0 = beatIndex(au, this.ctx.start + 1e-3), i = beatIndex(au, t);
    if (i < 0) return 0;
    return i - i0 + fn(clamp((t - au.beats[i]!) / snap)) - 1;
  }
  /** Integer beat count since the plate start (0 on the first beat at/after start... -1 before it). */
  private beatNo(t: number) {
    const au = this.ctx.audio;
    return beatIndex(au, t) - beatIndex(au, this.ctx.start + 1e-3);
  }

  // ---------------------------------------------------------------- drawing: iris blades
  private blades(c: CanvasRenderingContext2D, cam: Cam, ir: Iris) {
    const n = ir.n, al = TAU / n, R = ir.R, a = Math.max(ir.ap, 0);
    const S = (u: number, v: number) => proj(cam, { x: ir.c.x + u * ir.sx, y: ir.c.y + v * ir.sy });
    const unit = (k: number) => ({ x: Math.cos(ir.phi + k * al), y: Math.sin(ir.phi + k * al) });
    const V = (k: number) => { const u = unit(k); return { x: u.x * a, y: u.y * a }; };
    const ext = (k: number) => {
      // edge k runs V_k -> V_{k+1} (direction from the unit polygon, so a = 0 is well defined); extend to the circle
      const u0 = unit(k), u1 = unit(k + 1);
      let dx = u1.x - u0.x, dy = u1.y - u0.y; const L = Math.hypot(dx, dy); dx /= L; dy /= L;
      const v = V(k + 1), b = v.x * dx + v.y * dy, cc = v.x * v.x + v.y * v.y - R * R;
      const tt = -b + Math.sqrt(Math.max(0, b * b - cc));
      return { x: v.x + dx * tt, y: v.y + dy * tt };
    };
    const C = proj(cam, ir.c);
    const rs = R * cam.s * Math.max(ir.sx, ir.sy);
    for (let k = 0; k < n; k++) {
      const v0 = V(k), v1 = V(k + 1), e = ext(k), thE = Math.atan2(e.y, e.x);
      c.beginPath();
      let q = S(v0.x, v0.y); c.moveTo(q.x, q.y);
      q = S(v1.x, v1.y); c.lineTo(q.x, q.y);
      q = S(e.x, e.y); c.lineTo(q.x, q.y);
      for (let j = 1; j <= 10; j++) { const th = thE - (al * j) / 10; q = S(Math.cos(th) * R, Math.sin(th) * R); c.lineTo(q.x, q.y); }
      c.closePath();
      c.fillStyle = rgba('ink2');
      c.fill();
      const g = c.createRadialGradient(C.x, C.y, 0, C.x, C.y, rs);
      const tone = k % 2 ? 0.16 : 0.26;
      g.addColorStop(0, rgba('graphite', tone * 1.6));
      g.addColorStop(0.55, rgba('graphite', tone * 0.7));
      g.addColorStop(1, rgba('graphite', tone * 0.25));
      c.fillStyle = g;
      c.fill();
      // leading edge (V_k -> E_k): the machined hairline that catches the beat
      const hot = k === ir.hot;
      c.lineCap = 'round';
      c.strokeStyle = hot ? rgba('signal', 0.95) : rgba('bone', 0.22 + 0.55 * ir.edge);
      c.lineWidth = hot ? 3.2 : 1 + 2.2 * ir.edge;
      c.beginPath(); q = S(v0.x, v0.y); c.moveTo(q.x, q.y); q = S(e.x, e.y); c.lineTo(q.x, q.y); c.stroke();
      // pivot pin near the housing
      const thp = thE - al * 0.55, pin = S(Math.cos(thp) * R * 0.9, Math.sin(thp) * R * 0.9);
      const pr = Math.max(1.5, 4.5 * cam.s * Math.min(1, ir.sx * 3));
      c.fillStyle = rgba('ink');
      c.beginPath(); c.arc(pin.x, pin.y, pr, 0, TAU); c.fill();
      c.strokeStyle = rgba('bone', 0.35 + 0.5 * ir.edge); c.lineWidth = 1;
      c.stroke();
    }
  }

  /** The aperture opening as a path (for clipping to the pupil). */
  private aperturePath(c: CanvasRenderingContext2D, cam: Cam, ir: Iris, grow = 1) {
    const al = TAU / ir.n;
    c.beginPath();
    for (let k = 0; k < ir.n; k++) {
      const q = proj(cam, { x: ir.c.x + Math.cos(ir.phi + k * al) * ir.ap * grow * ir.sx, y: ir.c.y + Math.sin(ir.phi + k * al) * ir.ap * grow * ir.sy });
      if (k) c.lineTo(q.x, q.y); else c.moveTo(q.x, q.y);
    }
    c.closePath();
  }

  private setIrisGL(i: number, cam: Cam, ir: Iris | null, glow: number, knurl: number) {
    const I = (this.pass.u.uI!.value as THREE.Vector4[])[i]!, J = (this.pass.u.uJ!.value as THREE.Vector4[])[i]!;
    if (!ir) { J.set(0, 0, 0, 0); return; }
    const C = proj(cam, ir.c);
    I.set(C.x, C.y, ir.R * cam.s * ir.sx, ir.R * cam.s * ir.sy);
    J.set(cam.rot, knurl, glow, 1);
  }

  // ---------------------------------------------------------------- drawing: text on a ring
  /**
   * Draw a lyric line along a ring (world), centred at angle th0, reading in direction dir (+1 = clockwise on
   * screen, the top arc; -1 = the bottom arc). Glyphs keep their size; positions and tangents follow the ellipse.
   */
  private ringLyric(c: CanvasRenderingContext2D, line: Line, t: number, cam: Cam, ring: Ring, k: number, th0: number, dir: number,
    sizeW: number, colors: { sung: PaletteKey; unsung: PaletteKey; unsungAlpha?: number; alpha?: number },
    extra?: (st: CharState, p: P, ang: number) => CharXform | null, engraved = true) {
    const fam = F.slam();
    const layW = layoutLine(c, line, fam, sizeW);
    // arc-length table over a full turn centred on th0
    const N = 240, th: number[] = [], len: number[] = [];
    let acc = 0, prev = onRing(ring, th0 - dir * Math.PI, k);
    for (let i = 0; i <= N; i++) {
      const a = th0 - dir * Math.PI + (dir * TAU * i) / N, p = onRing(ring, a, k);
      acc += Math.hypot(p.x - prev.x, p.y - prev.y); prev = p;
      th.push(a); len.push(acc);
    }
    const s0 = len[N / 2]! - layW.width / 2;
    const at = (s: number) => {
      let lo = 0, hi = N;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (len[m]! < s) lo = m; else hi = m; }
      const f = clamp((s - len[lo]!) / Math.max(1e-6, len[hi]! - len[lo]!));
      return lerp(th[lo]!, th[hi]!, f);
    };
    const sizeS = sizeW * cam.s;
    drawLyric(c, line, t, {
      x: 0, y: 0, align: 'left', size: sizeS, family: fam,
      sungColor: colors.sung, unsungColor: colors.unsung, unsungAlpha: colors.unsungAlpha ?? 0.3, alpha: colors.alpha ?? 1,
      charTransform: (_ch, _i, st) => {
        const b = st.box;
        const a = at(s0 + (b.x + b.w / 2) / cam.s);
        const p = proj(cam, onRing(ring, a, k)), p2 = proj(cam, onRing(ring, a + dir * 0.01, k));
        const ang = Math.atan2(p2.y - p.y, p2.x - p.x);
        const base: CharXform = { dx: p.x - (b.x + b.w / 2), dy: p.y - (b.y - sizeS * 0.35), rot: ang };
        const x = extra?.(st, p, ang);
        if (!x) return base;
        return { dx: (base.dx ?? 0) + (x.dx ?? 0), dy: (base.dy ?? 0) + (x.dy ?? 0), rot: x.rot ?? ang, scale: x.scale, alpha: x.alpha };
      },
      drawChar: engraved ? (cc, ch) => {
        // engraved: a dark cut first, the lit face over it
        const fs = cc.fillStyle;
        cc.fillStyle = rgba('ink', 0.85);
        cc.fillText(ch, sizeS * 0.035, sizeS * 0.035);
        cc.fillStyle = fs;
        cc.fillText(ch, 0, 0);
      } : undefined,
    });
  }

  /** Latin furniture engraved on a ring: aperture numbers (not a lyric). */
  private ringScale(c: CanvasRenderingContext2D, cam: Cam, ring: Ring, th0: number, span: number, alpha: number) {
    const marks = ['1.4', '2', '2.8', '4', '5.6', '8', '11', '16', '22'];
    c.save();
    c.font = `${Math.round(13 * cam.s)}px "${F.mono()}"`;
    c.textAlign = 'center'; c.textBaseline = 'middle';
    marks.forEach((m, i) => {
      const a = th0 - span / 2 + (span * i) / (marks.length - 1);
      const p = proj(cam, onRing(ring, a, 1.18)), p2 = proj(cam, onRing(ring, a + 0.01, 1.18));
      c.save(); c.translate(p.x, p.y); c.rotate(Math.atan2(p2.y - p.y, p2.x - p.x));
      c.fillStyle = rgba(i === 4 ? 'signal' : 'bone', alpha); c.fillText(m, 0, 0);
      c.restore();
    });
    c.restore();
  }

  // ---------------------------------------------------------------- variants
  private cam(frame: string, t0: number, t: number): Cam {
    const drift = 1 + 0.018 * (t - t0);
    const C: Record<string, Cam> = {
      // gaze
      two: { s: 1.12, fx: 960, fy: 540, rot: 0 },
      tightL: { s: 1.75, fx: 447, fy: 640, rot: 0 },
      ring: { s: 2.5, fx: 470, fy: 700, rot: 0.06 },
      overlap: { s: 2.2, fx: 960, fy: 540, rot: 0 },
      tightR: { s: 1.6, fx: 1230, fy: 540, rot: 0 },
      shut: { s: 0.82, fx: 960, fy: 560, rot: 0 },
      // ai
      full: { s: 1.0, fx: 960, fy: 540, rot: 0 },
      pupil: { s: 2.4, fx: 960, fy: 540, rot: 0 },
      reflect: { s: 3.3, fx: 935, fy: 470, rot: 0.14 },
      // star
      face: { s: 1.0, fx: 960, fy: 540, rot: 0 },
      push: { s: 1.9, fx: 990, fy: 515, rot: 0.3 },
      side: { s: 1.0, fx: 960, fy: 540, rot: 0 },
      sideMacro: { s: 2.8, fx: 1170, fy: 540, rot: 0 },
    };
    const k = C[frame] ?? C.two!;
    return { ...k, s: k.s * drift };
  }

  private gaze(c: CanvasRenderingContext2D, f: Frame, frame: string, cam: Cam): PostOverrides {
    const au = this.ctx.audio, t = f.t;
    const [l11, l12] = this.lines;
    const face = frame === 'two' || frame === 'shut' ? 0.84 : 1;
    const shutT = this.list.find((s) => s.s.frame === 'shut')?.t ?? this.ctx.end;
    const close = smoothstep(shutT, shutT + 0.45, t);
    const bp = beatPulse(au, t, 0.14);
    const turn = (TAU / 12) * this.step(t);
    const ap = 230 * (0.4 + 0.03 * Math.sin(t * 1.3)) * (1 - close);
    const L: Iris = { c: { x: 470, y: 540 }, R: 230, sx: face, sy: 1, n: 9, ap, phi: 0.2 + turn, hot: -1, edge: bp };
    const Rr: Iris = { c: { x: 1450, y: 540 }, R: 230, sx: face, sy: 1, n: 9, ap, phi: 0.5 - turn, hot: -1, edge: bp };
    const glow = 0.55 * (1 - close) + 0.35 * bp * (1 - close);
    this.setIrisGL(0, cam, L, glow, turn * 0.25);
    this.setIrisGL(1, cam, Rr, glow, -turn * 0.25);

    // the closed room's wall: a brick slab between the eyes
    const w0 = proj(cam, { x: 925, y: -400 }), w1 = proj(cam, { x: 995, y: -400 }), w2 = proj(cam, { x: 995, y: 1500 }), w3 = proj(cam, { x: 925, y: 1500 });
    c.beginPath(); c.moveTo(w0.x, w0.y); c.lineTo(w1.x, w1.y); c.lineTo(w2.x, w2.y); c.lineTo(w3.x, w3.y); c.closePath();
    c.fillStyle = rgba('ink2'); c.fill();
    c.strokeStyle = rgba('graphite', 0.9); c.lineWidth = 1.2; c.stroke();
    c.save(); c.clip();
    c.strokeStyle = rgba('graphite', 0.35); c.lineWidth = 1;
    for (let y = -400; y < 1500; y += 34) {
      const a = proj(cam, { x: 925, y }), b = proj(cam, { x: 995, y });
      c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke();
      const jx = 925 + ((Math.round(y / 34) % 2 === 0) ? 23 : 47);
      const j0 = proj(cam, { x: jx, y }), j1 = proj(cam, { x: jx, y: y + 34 });
      c.beginPath(); c.moveTo(j0.x, j0.y); c.lineTo(j1.x, j1.y); c.stroke();
    }
    c.restore();

    // the irises
    this.blades(c, cam, L);
    this.blades(c, cam, Rr);
    this.ringScale(c, cam, Rr, -Math.PI / 2, 1.9, 0.55);
    this.ringScale(c, cam, L, -Math.PI / 2, 1.9, 0.4);

    // line 11 engraved around the left ring (bottom arc reads left to right)
    // (kept on the ring only while the ring is the surface; after that the frame belongs to line 12)
    const onRingL = stateAt(this.list, t).surface === 'ringL';
    this.ringLyric(c, l11!, t, cam, L, 1.16, Math.PI / 2, -1, 44, { sung: 'bone', unsung: 'graphite', unsungAlpha: 0.7, alpha: onRingL ? 1 : 0 });

    // each eye's light: a cone that reaches just past the wall; the words live only where both cones meet
    const lit = (1 - close) * (0.75 + 0.25 * bp);
    const beam = (ir: Iris, xEnd: number) => {
      const half = Math.tan(0.62) * Math.abs(xEnd - ir.c.x) * (ir.ap / (230 * 0.4) || 0);
      const a = proj(cam, ir.c), b = proj(cam, { x: xEnd, y: 540 - half }), d = proj(cam, { x: xEnd, y: 540 + half });
      c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.lineTo(d.x, d.y); c.closePath();
      return { a, b: proj(cam, { x: xEnd, y: 540 }) };
    };
    c.save();
    c.globalCompositeOperation = 'lighter';
    for (const [ir, xe] of [[L, 1000], [Rr, 920]] as const) {
      const g = beam(ir, xe);
      const gr = c.createLinearGradient(g.a.x, g.a.y, g.b.x, g.b.y);
      gr.addColorStop(0, rgba('ember', 0.0));
      gr.addColorStop(0.35, rgba('ember', 0.05 * lit));
      gr.addColorStop(1, rgba('bone', 0.11 * lit));
      c.fillStyle = gr; c.fill();
    }
    c.restore();
    // the overlap: clip to both cones
    c.save();
    beam(L, 1000); c.clip();
    beam(Rr, 920); c.clip();
    c.globalCompositeOperation = 'lighter';
    c.fillStyle = rgba('ember', 0.16 * lit + 0.1 * bp * lit);
    c.fillRect(0, 0, W, H);
    c.globalCompositeOperation = 'source-over';
    const lay = layoutLine(c, l12!, F.slam(), 50, undefined, true);
    const top = proj(cam, { x: 960, y: 540 - lay.height / 2 });
    drawLyric(c, l12!, t, {
      x: top.x, y: top.y, size: 50 * cam.s, vertical: true, rotation: cam.rot, family: F.slam(),
      sungColor: 'bone', unsungColor: 'ember', unsungAlpha: 0.3, alpha: lit,
      charTransform: (_ch, _i, st) => ({ scale: st.sung ? 1 + 0.12 * (1 - st.frac) : 1 }),
    });
    c.restore();

    const db = downbeatPulse(au, t, 0.18);
    const l12t = l12!.start;
    return {
      zoom: 1 + 0.055 * db,
      shake: [0, 5 * bp * (1 - close)],
      flash: 0.06 * Math.exp(-Math.max(0, t - l12t) / 0.08) * (t >= l12t ? 1 : 0),
      bloom: 0.22, bloomThreshold: 0.95, bloomRadius: 0.35,
      fade: smoothstep(this.ctx.end - 0.25, this.ctx.end, t) * 0.6,
    };
  }

  private ai(c: CanvasRenderingContext2D, f: Frame, frame: string, cam: Cam): PostOverrides {
    const au = this.ctx.audio, t = f.t;
    const [l18, l19] = this.lines;
    const bp = beatPulse(au, t, 0.12), kp = kickPulse(au, t, 0.1);
    // a gulp per syllable of line 18: the aperture dilates as it takes each word in
    let gulp = 0;
    for (const w of l18!.words) for (const [a] of w.syl ?? [[w.start, w.end]]) if (t >= a) gulp = Math.max(gulp, Math.exp(-(t - a) / 0.25));
    const R = 310;
    const ap = R * (0.36 + 0.14 * gulp - 0.035 * bp);
    const ir: Iris = { c: { x: 960, y: 540 }, R, sx: 1, sy: 1, n: 7, ap, phi: (TAU / 14) * this.step(t, 0.09), hot: -1, edge: bp };
    const glint = smoothstep(this.ctx.end - 0.5, this.ctx.end - 0.05, t);
    this.setIrisGL(0, cam, ir, (frame === 'full' ? 0.35 : 0.16) + 0.4 * gulp + 0.8 * glint, this.step(t) * 0.12);
    this.setIrisGL(1, cam, null, 0, 0);
    this.blades(c, cam, ir);
    this.ringScale(c, cam, ir, Math.PI / 2, 1.6, 0.4);

    const suck = (st: CharState): number => {
      const w = l18!.words[st.word]!, a0 = (w.syl ?? [[w.start, w.end]])[st.syl]![0];
      return ease.inCubic(clamp((t - a0 - 0.2) / 0.55));
    };
    if (frame === 'full') {
      // line 18 on the upper ring; each word, once sung, is pulled spiralling into the aperture
      this.ringLyric(c, l18!, t, cam, ir, 1.2, -Math.PI / 2, 1, 100, { sung: 'bone', unsung: 'graphite', unsungAlpha: 0.8 }, (st, p, ang) => {
        const u = suck(st);
        if (u <= 0) return null;
        const C = proj(cam, ir.c);
        const dx = p.x - C.x, dy = p.y - C.y, r = Math.hypot(dx, dy) * (1 - u), th = Math.atan2(dy, dx) + 1.6 * u;
        return { dx: C.x + Math.cos(th) * r - p.x, dy: C.y + Math.sin(th) * r - p.y, rot: ang + 2.2 * u, scale: 1 - 0.8 * u, alpha: 1 - smoothstep(0.75, 1, u) };
      }, true);
    } else {
      // inside the pupil: the stolen words drift in the glass, kept as evidence
      c.save();
      this.aperturePath(c, cam, ir, 1.001); c.clip();
      const C = proj(cam, ir.c);
      const size = 34 * cam.s;
      drawLyric(c, l18!, t, {
        x: C.x, y: C.y, size, align: 'center', family: F.slam(), sungColor: 'ember', unsungColor: 'ember',
        charTransform: (_ch, i, st) => {
          // kept in reading order, suspended in the glass: a slow bob and tilt, a twitch on the kick
          const ph = hash(i, 11) * TAU, lt = t - this.ctx.start;
          return { dx: 6 * cam.s * Math.sin(lt * 1.3 + ph), dy: 9 * cam.s * Math.sin(lt * 1.7 + ph) + (i - 1) * size * 0.18, rot: 0.12 * Math.sin(lt * 1.1 + ph), scale: 0.95 + 0.2 * kp };
        },
      });
      // an evidence bracket around the pupil's contents
      c.strokeStyle = rgba('ember', 0.5); c.lineWidth = 1.2;
      const e = ap * cam.s * 0.62, m = e * 0.25;
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
        c.beginPath(); c.moveTo(C.x + sx * e, C.y + sy * (e - m)); c.lineTo(C.x + sx * e, C.y + sy * e); c.lineTo(C.x + sx * (e - m), C.y + sy * e); c.stroke();
      }
      c.restore();

      // the front glass reflects line 19 along a large curved highlight (in front of everything)
      const glass: Ring = { c: { x: 960, y: 1250 }, R: 800, sx: 1, sy: 1 };
      c.save();
      c.globalCompositeOperation = 'lighter';
      const G = proj(cam, glass.c);
      c.strokeStyle = rgba('bone', 0.05 + 0.04 * bp);
      c.lineWidth = 64 * cam.s;
      c.beginPath(); c.arc(G.x, G.y, glass.R * cam.s, -Math.PI / 2 - 0.35 + cam.rot, -Math.PI / 2 + 0.35 + cam.rot); c.stroke();
      c.restore();
      this.ringLyric(c, l19!, t, cam, glass, 1, -Math.PI / 2, 1, 34, { sung: 'bone', unsung: 'bone', unsungAlpha: 0.22, alpha: 0.95 }, (st) => (
        st.sung ? { scale: 1 + 0.15 * (1 - st.frac) } : null), false);
    }
    // exit: a glint in the pupil flares
    if (glint > 0) {
      const g = proj(cam, { x: 960 + 38, y: 540 - 42 });
      c.save(); c.globalCompositeOperation = 'lighter';
      for (const a of [0, Math.PI / 2, Math.PI / 4, -Math.PI / 4]) {
        const Lg = (a === 0 || a === Math.PI / 2 ? 520 : 170) * glint * cam.s;
        const gr = c.createLinearGradient(g.x - Math.cos(a) * Lg, g.y - Math.sin(a) * Lg, g.x + Math.cos(a) * Lg, g.y + Math.sin(a) * Lg);
        gr.addColorStop(0, rgba('ember', 0)); gr.addColorStop(0.5, rgba('bone', 0.9 * glint)); gr.addColorStop(1, rgba('ember', 0));
        c.strokeStyle = gr; c.lineWidth = 2.5 * cam.s;
        c.beginPath(); c.moveTo(g.x - Math.cos(a) * Lg, g.y - Math.sin(a) * Lg); c.lineTo(g.x + Math.cos(a) * Lg, g.y + Math.sin(a) * Lg); c.stroke();
      }
      c.restore();
    }
    return {
      zoom: 1 + 0.02 * kp,
      shake: [0, -4 * bp],
      flash: 0.05 * glint * glint,
      bloom: 0.15 + 0.25 * glint, bloomThreshold: 0.95, bloomRadius: 0.35,
    };
  }

  private star(c: CanvasRenderingContext2D, f: Frame, frame: string, cam: Cam): PostOverrides {
    const au = this.ctx.audio, t = f.t;
    const bn = this.beatNo(t);
    const tb = au.beats[beatIndex(au, t)] ?? t;
    const snap = ease.outExpo(clamp((t - tb) / 0.08));
    const bp = beatPulse(au, t, 0.1), kp = kickPulse(au, t, 0.1);
    const clicks = clamp(bn + 1, 0, 2) - (bn >= 0 && bn < 2 ? 1 - snap : 0);
    const done = clamp(bn - 1, 0, 6), closing = bn >= 2 && bn <= 7;
    const closed = done - (closing ? 1 - snap : 0);
    const R = 360, a0 = R * 0.46;
    const ap = a0 * (1 - closed / 6);
    const side = frame === 'side' || frame === 'sideMacro';
    const ir: Iris = {
      c: side ? { x: 1150, y: 540 } : { x: 960, y: 540 }, R, sx: side ? 0.16 : 1, sy: 1, n: 6, ap,
      phi: 0.25 - 0.17 * clicks + 0.5 * (closed / 6), hot: closing ? (done - 1) % 6 : -1, edge: bn < 2 ? Math.min(1.4, 1.6 * bp) : bp, side,
    };
    const tCut = au.beats[beatIndex(au, this.ctx.start + 1e-3) + 7] ?? this.ctx.end;
    const cut = t >= tCut;
    const light = ap / a0;
    this.setIrisGL(1, cam, null, 0, 0);
    const uStar = this.pass.u.uStar!.value as THREE.Vector4;

    if (!side) {
      const C = proj(cam, ir.c);
      uStar.set(C.x, C.y, R * 0.55 * cam.s, 0.35 + 0.9 * light);
      this.setIrisGL(0, cam, ir, 0.2 * light, 0.26 * clicks);
      this.blades(c, cam, ir);
      // diffraction spikes of a six-bladed aperture: one per edge normal, their length is the light still passing
      if (light > 0.001) {
        c.save(); c.globalCompositeOperation = 'lighter';
        for (let k = 0; k < 6; k++) {
          const a = ir.phi + (k + 0.5) * (TAU / 6) + cam.rot, Ls = (240 + 820 * light) * cam.s * (0.85 + 0.3 * kp);
          const gr = c.createLinearGradient(C.x, C.y, C.x + Math.cos(a) * Ls, C.y + Math.sin(a) * Ls);
          gr.addColorStop(0, rgba('bone', 0.85 * light)); gr.addColorStop(0.3, rgba('ember', 0.4 * light)); gr.addColorStop(1, rgba('signal', 0));
          c.strokeStyle = gr; c.lineWidth = (1.5 + 2.5 * bp) * Math.min(2, cam.s);
          c.beginPath(); c.moveTo(C.x, C.y); c.lineTo(C.x + Math.cos(a) * Ls, C.y + Math.sin(a) * Ls); c.stroke();
        }
        c.restore();
      }
      // the latch: a pawl on the housing that clicks twice to preload the spring
      const th = -0.85 + 0.0;
      const piv = { x: ir.c.x + Math.cos(th) * R * 1.4, y: ir.c.y + Math.sin(th) * R * 1.4 };
      const la = th + Math.PI * 0.55 + 0.42 * clicks;
      const tip = { x: piv.x + Math.cos(la) * R * 0.52, y: piv.y + Math.sin(la) * R * 0.52 };
      const P0 = proj(cam, piv), P1 = proj(cam, tip);
      c.lineCap = 'round';
      c.strokeStyle = rgba('graphite'); c.lineWidth = 26 * cam.s;
      c.beginPath(); c.moveTo(P0.x, P0.y); c.lineTo(P1.x, P1.y); c.stroke();
      c.strokeStyle = rgba(bn < 2 ? 'signal' : 'bone', bn < 2 ? 0.5 + 0.5 * bp : 0.5); c.lineWidth = (2 + 5 * (bn < 2 ? bp : 0)) * cam.s;
      c.beginPath(); c.moveTo(P0.x, P0.y); c.lineTo(P1.x, P1.y); c.stroke();
      c.fillStyle = rgba('ink'); c.beginPath(); c.arc(P0.x, P0.y, 9 * cam.s, 0, TAU); c.fill();
      c.strokeStyle = rgba('bone', 0.7); c.lineWidth = 1.5; c.stroke();
    } else {
      // side view: the star at left, the housing edge-on, the beam that squeezes through the slit
      const S = proj(cam, { x: 250, y: 540 });
      const dark = cut ? Math.exp(-(t - tCut) / 0.1) : 1;
      uStar.set(S.x, S.y, 170 * cam.s, 0.15 + 0.85 * dark);
      this.setIrisGL(0, cam, null, 0, 0);
      const C = proj(cam, ir.c);
      c.save(); c.globalCompositeOperation = 'lighter';
      // incoming light: the star floods the front face
      const top = proj(cam, { x: ir.c.x, y: 540 - R * 1.3 }), bot = proj(cam, { x: ir.c.x, y: 540 + R * 1.3 });
      const gi = c.createLinearGradient(S.x, S.y, C.x, C.y);
      gi.addColorStop(0, rgba('ember', (0.25 / cam.s) * dark)); gi.addColorStop(1, rgba('signal', (0.08 / cam.s) * dark));
      c.fillStyle = gi;
      c.beginPath(); c.moveTo(S.x, S.y - 40 * cam.s); c.lineTo(top.x, top.y); c.lineTo(bot.x, bot.y); c.lineTo(S.x, S.y + 40 * cam.s); c.closePath(); c.fill();
      c.restore();
      // housing as a short cylinder: back rim, body, front face
      const depth = 70, rx = R * 1.32 * ir.sx * cam.s, ry = R * 1.32 * cam.s;
      const B = proj(cam, { x: ir.c.x + depth, y: 540 });
      c.fillStyle = rgba('ink2');
      c.beginPath(); c.ellipse(B.x, B.y, rx, ry, cam.rot, 0, TAU); c.fill();
      c.fillRect(Math.min(C.x, B.x), C.y - ry, Math.abs(B.x - C.x), 2 * ry);
      c.strokeStyle = rgba('graphite', 0.8); c.lineWidth = 1.2;
      c.beginPath(); c.moveTo(C.x, C.y - ry); c.lineTo(B.x, B.y - ry); c.moveTo(C.x, C.y + ry); c.lineTo(B.x, B.y + ry); c.stroke();
      // knurl on the cylinder body
      c.strokeStyle = rgba('graphite', 0.45); c.lineWidth = 1;
      for (let i = 0; i < 26; i++) {
        const y = C.y - ry + ((i + 0.5 + 0.35 * clicks) / 26) * 2 * ry;
        c.beginPath(); c.moveTo(C.x + 4, y); c.lineTo(B.x - 4, y); c.stroke();
      }
      c.fillStyle = rgba('ink2');
      c.beginPath(); c.ellipse(C.x, C.y, rx, ry, cam.rot, 0, TAU); c.fill();
      c.strokeStyle = rgba('bone', 0.4 + 0.5 * bp); c.lineWidth = 1.5; c.stroke();
      this.blades(c, cam, ir);
      // the slit of light and the outgoing ray
      c.save(); c.globalCompositeOperation = 'lighter';
      if (!cut && ap > 0.5) {
        this.aperturePath(c, cam, ir); c.fillStyle = rgba('bone', 0.95); c.fill();
      }
      const tail = cut ? (t - tCut) * 3200 : 0;
      const x0 = proj(cam, { x: ir.c.x + tail, y: 540 });
      const hb = Math.max(ap, cut ? a0 / 6 * 0.25 : 0) * cam.s;
      if (x0.x < W + 10) {
        const go = c.createLinearGradient(x0.x, 0, W, 0);
        go.addColorStop(0, rgba('bone', 0.9)); go.addColorStop(1, rgba('ember', 0.45));
        c.fillStyle = go;
        c.fillRect(x0.x, C.y - hb * 0.35, W - x0.x, hb * 0.7);
        c.fillStyle = rgba('signal', 0.25);
        c.fillRect(x0.x, C.y - hb, W - x0.x, hb * 2);
      }
      c.restore();
    }
    // T3: every beat is a big hit — the latch jolts the frame, each blade slam punches in
    const shakeDir = bn % 2 ? 1 : -1;
    const hitAmp = bn < 2 ? 18 : 11;
    const cutHit = cut ? Math.exp(-(t - tCut) / 0.12) : 0;
    return {
      zoom: 1 + 0.08 * bp + 0.05 * cutHit,
      shake: [shakeDir * hitAmp * bp, (bn < 2 ? hitAmp : 5) * bp],
      flash: 0,
      bloom: 0.55, bloomThreshold: 0.9, halation: 0.2,
    };
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer } = this.ctx;
    const sh = shotAt(this.list, f.t);
    const st = stateAt(this.list, f.t);
    const frame = String(st.frame);
    const cam = this.cam(frame, sh.t0, f.t);
    const L = this.layer, c = L.ctx;
    L.clear();
    (this.pass.u.uStar!.value as THREE.Vector4).set(0, 0, 1, 0);
    this.pass.u.uTick!.value = beatPulse(this.ctx.audio, f.t, 0.15);
    const v = this.plate.variant;
    const post = v === 'ai' ? this.ai(c, f, frame, cam) : v === 'star' ? this.star(c, f, frame, cam) : this.gaze(c, f, frame, cam);
    L.upload();
    this.pass.render(renderer, out);
    this.ctx.comp.draw(renderer, L.texture, out, { mode: 'normal' });
    return post;
  }

  override dispose() { this.layer?.texture.dispose(); }
}
