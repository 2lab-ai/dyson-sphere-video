// SPARK — the through-line motif: a single signal-orange point of light with a hairline trail on ink.
// Reference module for the v2 plate API (keep it small; see engine/lyric.ts, engine/shots.ts, engine/beat.ts):
//   - structure comes from the pure shot list (./spark.shots) via stateAt(): camera framing + lyric layout
//   - the plate draws its own lines with drawLyric(); the layout differs per shot and per variant
//   - the beat is visible: the point swells on every beat, the trail thickens on kicks, a ring on downbeats
// Variants (data/edit.json): write (ignites, then writes lines 0-1), race (outruns a ruler), glint (a
// constellation that flashes on the beat), merge (points drift together into one), outro (fade to black).
import type * as THREE from 'three';
import { Scene, type Frame, type PostOverrides } from '../engine/scene';
import { Layer2D, clearRT } from '../engine/gl';
import { LIN, rgba } from '../engine/palette';
import { drawLyric, ownedLines, F, type DrawLyricOpts } from '../engine/lyric';
import { beatPulse, kickPulse, downbeatPulse } from '../engine/beat';
import { stateAt, type PlateInfo, type Shot } from '../engine/shots';
import { igniteRamp } from '../engine/prim';
import { hash, clamp, smoothstep } from '../engine/util';
import type { Line } from '../engine/lyrics';
import { shots, type Framing, type Layout } from './spark.shots';

type P = { x: number; y: number };
const W = 1920, H = 1080;

export default class Spark extends Scene {
  private layer!: Layer2D;
  private list: Shot[] = [];
  private plate!: PlateInfo;
  private lines: Line[] = [];

  override init() {
    this.plate = this.ctx.params as PlateInfo;
    this.list = shots(this.plate, this.ctx.audio);
    this.lines = ownedLines(this.ctx);
    this.layer = new Layer2D();
  }

  /** World position (px, origin at the frame centre) of the point at song time t. */
  private point(t: number, k = 0): P {
    const lt = t - this.ctx.start, v = this.plate.variant;
    if (v === 'race') return { x: ((lt * 900 + k * 300) % 2600) - 1300, y: 60 * Math.sin(lt * 3.1 + k) };
    if (v === 'merge') {
      // k > 0: satellites spiralling in; all meet the main point by 80% of the plate
      const m = 1 - smoothstep(0, 0.8, (t - this.ctx.start) / (this.ctx.end - this.ctx.start));
      const a = k * 2.4 + lt * 1.3, r = k ? 700 * m : 0;
      return { x: 180 * Math.sin(lt * 0.9) + r * Math.cos(a), y: 90 * Math.sin(lt * 1.4) + r * 0.55 * Math.sin(a) };
    }
    return { x: 560 * Math.sin(lt * 0.61 + k), y: 250 * Math.sin(lt * 1.07 + 1 + k) };
  }

  /** Camera for a framing: screen = centre + rot * (world - focus) * scale. */
  private camera(fr: Framing, t: number) {
    const p = this.point(t);
    const cam = { wide: [0.62, 0, 0, 0], close: [1.7, p.x, p.y, 0], tilt: [1.0, 0, 0, 0.32], offset: [0.9, -380, 60, 0], high: [1.25, p.x * 0.5, p.y * 0.5, -0.45] }[fr];
    const [s, fx, fy, rot] = cam as [number, number, number, number];
    const c = Math.cos(rot), sn = Math.sin(rot);
    return (q: P): P => {
      const x = (q.x - fx) * s, y = (q.y - fy) * s;
      return { x: W / 2 + c * x - sn * y, y: H / 2 + sn * x + c * y };
    };
  }

  private drawPoint(c: CanvasRenderingContext2D, f: Frame, cam: (q: P) => P, k: number, amp: number) {
    const au = this.ctx.audio;
    // hairline trail: 1.2 s of history, fading out
    const N = 48;
    c.lineCap = 'round';
    for (let i = 0; i < N; i++) {
      const a = cam(this.point(f.t - (i / N) * 1.2, k)), b = cam(this.point(f.t - ((i + 1) / N) * 1.2, k));
      c.strokeStyle = rgba('signal', amp * (1 - i / N) * 0.9);
      c.lineWidth = 1.5 + 3 * kickPulse(au, f.t);
      c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke();
    }
    const p = cam(this.point(f.t, k));
    const r = (7 + 16 * beatPulse(au, f.t, 0.15)) * amp;
    const g = c.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 5);
    g.addColorStop(0, rgba('bone', amp));
    g.addColorStop(0.18, rgba('ember', amp));
    g.addColorStop(0.45, rgba('signal', 0.35 * amp));
    g.addColorStop(1, rgba('signal', 0));
    c.fillStyle = g;
    c.beginPath(); c.arc(p.x, p.y, r * 5, 0, Math.PI * 2); c.fill();
    // downbeat ring expanding from the point
    const d = downbeatPulse(au, f.t, 0.35);
    if (d > 0.02) {
      c.strokeStyle = rgba('ember', d * amp);
      c.lineWidth = 1.5;
      c.beginPath(); c.arc(p.x, p.y, r * 5 + (1 - d) * 220, 0, Math.PI * 2); c.stroke();
    }
  }

  /** Where each owned line goes, per layout (line k of the plate's lines). */
  private lyricOpts(layout: Layout, k: number, n: number): DrawLyricOpts {
    const row = k - (n - 1) / 2;
    switch (layout) {
      case 'left': return { x: 150, y: 560 + row * 150, size: 120, align: 'left', maxWidth: 1300 };
      case 'right': return { x: 1770, y: 560 + row * 150, size: 120, align: 'right', maxWidth: 1300 };
      case 'vertical': return { x: 1560 - k * 150, y: 140, size: 110, vertical: true, maxWidth: 820 };
      case 'low': return { x: 960, y: 930 - (n - 1 - k) * 120, size: 96, align: 'center', maxWidth: 1600 };
      case 'stack': return { x: 150, y: 300 + k * 190, size: 170, align: 'left', family: F.hangul(), maxWidth: 1620 };
      default: return { x: 960, y: 590 + row * 170, size: 150, align: 'center', maxWidth: 1650 };
    }
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, audio } = this.ctx;
    const st = stateAt(this.list, f.t);
    const v = this.plate.variant;
    const L = this.layer, c = L.ctx;
    L.clear();
    const cam = this.camera(st.frame as Framing, f.t);
    const ign = v === 'write' ? igniteRamp(f.t, this.ctx.start + 0.15, 1.8) : 1;

    // variant furniture
    if (v === 'race') {
      // a timeline ruler the point outruns: ticks stream past, a long tick every 5
      c.strokeStyle = rgba('graphite', 0.8);
      c.lineWidth = 1;
      const off = (f.lt * 1400) % 600;
      for (let i = -2; i < 22; i++) {
        const a = cam({ x: -1400 + i * 120 - off, y: 150 }), b = cam({ x: -1400 + i * 120 - off, y: i % 5 === 0 ? 210 : 175 });
        c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke();
      }
    }
    if (v === 'glint') {
      const bp = beatPulse(audio, f.t, 0.2);
      for (let i = 0; i < 24; i++) {
        const q = cam({ x: (hash(i, 3) - 0.5) * 1700, y: (hash(i, 7) - 0.5) * 800 });
        const on = hash(i, Math.floor(f.beat)) > 0.55 ? bp : 0.15;
        c.fillStyle = rgba('ember', clamp(on));
        c.beginPath(); c.arc(q.x, q.y, 2 + 5 * on, 0, Math.PI * 2); c.fill();
      }
    }
    const pts = v === 'merge' ? 6 : 1;
    for (let k = 0; k < pts; k++) this.drawPoint(c, f, cam, k, ign * (k ? 0.7 : 1));

    // the plate's own lyric lines
    const n = this.lines.length;
    this.lines.forEach((line, k) => {
      const o = this.lyricOpts(st.layout as Layout, k, n);
      drawLyric(c, line, f.t, {
        ...o,
        family: o.family ?? F.slam(),
        sungColor: 'bone',
        unsungColor: 'bone',
        charTransform: (_ch, i, s) => {
          if (v === 'write') return { dx: s.sung ? -22 * (1 - s.frac) ** 3 : 0 }; // pulled in by the point's speed
          if (v === 'race') return { dx: s.sung ? 0 : 30, rot: s.sung ? 0 : -0.08 };
          if (v === 'merge') return { dx: (hash(i, 1) - 0.5) * 300 * (1 - s.frac), dy: (hash(i, 2) - 0.5) * 200 * (1 - s.frac) };
          if (v === 'glint') return { scale: 1 + 0.12 * beatPulse(audio, f.t) * (s.sung ? 1 : 0) };
        },
      });
    });
    L.upload();

    clearRT(renderer, out, LIN.ink);
    this.ctx.comp.draw(renderer, L.texture, out, { mode: 'normal' });
    const fade = v === 'outro' ? smoothstep(this.ctx.end - 2.5, this.ctx.end - 0.1, f.t) : 0;
    return { bloom: 0.35, bloomThreshold: 0.8, fade };
  }

  override dispose() { this.layer?.texture.dispose(); }
}
