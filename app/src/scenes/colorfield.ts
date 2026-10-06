// COLORFIELD — A2 Ganzfeld (James Turrell). A pale dawn wall with one knife-edged aperture cut into it; inside the
// aperture a luminous field of a single hue, pale at the top and deepening to dawn orange at the bottom, with no horizon.
// The plate's story is disappearance: the previous plate's cage ring is shoved out of frame in the first beat, then the
// line is sung into the light and every word, once sung, dissolves into the field (blur, lift, fade to the field's own
// colour). The last word, "fading away", dissolves syllable by syllable. The camera pushes into the aperture while its
// edge softens until there are no edges at all (Ganzfeld); the exit turns the field to page white.
// Beat: the field breathes — every beat lifts the aperture luminance and softens its edge ~4 %, downbeats more, and the
// sung glyphs warm on the downbeat. Structure from the pure shot list (./colorfield.shots) via stateAt().
// Colour: the plate's named palette only (look.palette = 'dawn'): shader via plin(), Canvas2D via pcss()/pmix().
// Variants (data/edit.json): freedom (p27).
import * as THREE from 'three';
import { Scene, type Frame, type PostOverrides } from '../engine/scene';
import { FSPass, Layer2D, clearRT } from '../engine/gl';
import { palette, pcss, pmix, plin, type NamedPalette } from '../engine/palette';
import { drawLyric, ownedLines, F } from '../engine/lyric';
import { beatPulse, downbeatPulse, kickPulse } from '../engine/beat';
import { shotAt, stateAt, type PlateInfo, type Shot } from '../engine/shots';
import { clamp, smoothstep, ease, lerp, hash } from '../engine/util';
import type { Line } from '../engine/lyrics';
import { shots } from './colorfield.shots';

const W = 1920, H = 1080;
// the aperture in the wall at camera scale 1 (logical px): centre and half size, corner radius
const AP = { x: 960, y: 520, hx: 720, hy: 320, r: 10 };

const FIELD_GLSL = /* glsl */ `
uniform vec2 uRes;
uniform vec3 uGround, uDeep, cPalMid, uHi;
uniform vec2 uC, uHalf;     // aperture centre / half size, logical px (y down)
uniform float uR, uSoft;    // corner radius, edge softness (px)
uniform float uBreath;      // 0..1+ luminance breath (beat)
uniform float uFlat;        // 0..1 : the whole frame becomes the field (no edges)
uniform float uWhite;       // 0..1 : exit to page white
uniform float uT, uSpill;   // time, light spill onto the wall (px)

// the dawn field: pale at the top, deep at the bottom, a slow drift of the warm stop; no horizon (single smooth ramp)
vec3 field(vec2 q, float k) {
  float drift = 0.5 + 0.5 * sin(uT * 0.37 + q.x * 0.0011);
  vec3 top = mix(uHi, uGround, 0.35 + 0.15 * drift);
  vec3 low = mix(uDeep, cPalMid, 0.18 * drift);
  float m = smoothstep(-0.15, 1.2, k);
  vec3 c = mix(top, low, m * m * (3.0 - 2.0 * m));
  return c * (1.04 + 0.22 * uBreath) + uHi * 0.1 * uBreath;
}

void main() {
  vec2 fc = vUv * uRes;
  vec2 q = vec2(fc.x, uRes.y - fc.y);           // logical px, y down (canvas convention)
  // aperture: rounded box, very soft when uSoft is large
  float d = sdBox(q - uC, uHalf - vec2(uR)) - uR;
  float mask = 1.0 - smoothstep(-uSoft, uSoft, d);
  float kIn = (q.y - (uC.y - uHalf.y)) / max(1.0, 2.0 * uHalf.y);
  vec3 ap = field(q, kIn);
  // the wall: the pale ground, lit by the aperture's spill (brighter near it), falling off to a soft room shade
  float glow = exp(-max(d, 0.0) / uSpill);
  vec2 v = (q - vec2(0.5 * uRes.x, 0.47 * uRes.y)) / uRes.y;
  float room = 0.93 - 0.2 * smoothstep(0.25, 1.05, length(v * vec2(0.8, 1.15)));
  vec3 wall = uGround * room * (0.86 + 0.16 * glow * (1.0 + 0.9 * uBreath)) + uDeep * 0.1 * glow * (1.0 + uBreath);
  vec3 c = mix(wall, ap, mask);
  // Ganzfeld: the field everywhere, ramped over the whole frame
  vec3 flatC = field(q, q.y / uRes.y * 0.95);
  c = mix(c, flatC, uFlat);
  c = mix(c, uHi * (1.0 + 0.05 * uBreath), uWhite);
  c += (hash12(fc + fract(uT) * 91.0) - 0.5) / 255.0;  // dither: no banding in the ramps
  fragColor = vec4(max(c, 0.0), 1.0);
}`;

export default class Colorfield extends Scene {
  private pass!: FSPass;
  private layer!: Layer2D;
  private list: Shot[] = [];
  private plate!: PlateInfo;
  private lines: Line[] = [];
  private P!: NamedPalette;

  override init() {
    this.plate = this.ctx.params as PlateInfo;
    this.P = palette(this.ctx.params.look?.palette ?? 'dawn');
    this.list = shots(this.plate, this.ctx.audio);
    this.lines = ownedLines(this.ctx);
    const v3 = (r: 'ground' | 'deep' | 'mid' | 'hi') => ({ value: new THREE.Vector3(...plin(this.P, r)) });
    this.pass = new FSPass(FIELD_GLSL, {
      uRes: { value: new THREE.Vector2(W, H) },
      uGround: v3('ground'), uDeep: v3('deep'), cPalMid: v3('mid'), uHi: v3('hi'),
      uC: { value: new THREE.Vector2(AP.x, AP.y) }, uHalf: { value: new THREE.Vector2(AP.hx, AP.hy) },
      uR: { value: AP.r }, uSoft: { value: 2 }, uBreath: { value: 0 }, uFlat: { value: 0 }, uWhite: { value: 0 },
      uT: { value: 0 }, uSpill: { value: 260 },
    });
    this.layer = new Layer2D();
  }

  /** Camera scale about the frame centre + aperture edge softness, per shot (hold, then snap). */
  private camera(cam: string, t: number, t0: number, t1: number) {
    const k = (a: number, tau: number) => ease.outExpo(clamp((t - a) / tau));
    if (cam === 'wide') return { s: 0.9, soft: 1.5 };
    if (cam === 'wall') {
      // snap in on the downbeat, then a slow creep toward the light
      const s = lerp(0.9, 1.08, k(t0, 0.3)) + 0.07 * ease.inOutQuad(clamp((t - t0) / Math.max(0.1, t1 - t0)));
      return { s, soft: 1.5 + 6 * clamp((t - t0) / (t1 - t0)) };
    }
    if (cam === 'push') {
      // snap forward on the word, then an accelerating push until the aperture overfills the frame
      const u = clamp((t - t0) / Math.max(0.1, t1 - t0));
      const s = lerp(1.15, 1.7, k(t0, 0.28)) * Math.pow(2.3, ease.inQuad(u));
      return { s, soft: lerp(10, 560, ease.inOutQuad(u)) + 40 * k(t0, 0.3) };
    }
    return { s: 4.2, soft: 700 }; // flat
  }

  /**
   * Variant `dawn` (p27, hosted on the ORBIT limb at dawn): the colour field is the host's — this draws the subject
   * carried from p26, the cage of orbit rings around line 25, dissolving as the dawn comes over the limb. Each beat drops
   * a further set of ring segments for good (persistent) and jolts the survivors outward; a sung syllable stamps
   * signal-orange. Hosted: white surround (it drops out under the host's 'multiply'); standalone: the palette ground.
   */
  private dawn(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, audio } = this.ctx;
    const t = f.t, P = this.P, start = this.ctx.start, end = this.ctx.end;
    const db = downbeatPulse(audio, t, 0.25);
    const nb = audio.beats.filter((b) => b > start + 0.05 && b <= t).length;
    // segments go only on the beats (held steps, no continuous fade); the plate's last downbeat takes the last of them
    const dbs = (audio.downbeats ?? []).filter((b) => b > start + 0.05 && b < end - 0.02);
    const lastDb = dbs[dbs.length - 1] ?? Infinity;
    const gone = t >= lastDb ? 1.01 : clamp(0.06 + 0.085 * nb, 0, 0.9);
    // the jolt: every beat shoves the cage to a new resting place, ≥ 24 px, and it stays there until the next beat
    const JOLT: [number, number][] = [[0, 0], [30, -14], [-26, 18], [34, 10], [-32, -16], [24, 22], [-30, 8], [28, -20], [-24, -12], [32, 16]];
    const [jx, jy] = JOLT[nb % JOLT.length]!;
    const L = this.layer, c = L.ctx, cx = 960, cy = 540;
    L.clear();
    const RINGS = 7, SEGS = 56;
    for (let r = 0; r < RINGS; r++) {
      const tilt = -0.5 + (r / (RINGS - 1)) * 1.0, inc = 0.18 + 0.1 * (r % 3);
      const rx = 600 + 40 * (r % 2), ry = rx * inc;
      c.save();
      c.translate(cx + jx, cy + jy);
      c.rotate(tilt + 0.05 * t);
      c.strokeStyle = pcss(P, r % 2 ? 'text' : 'mid', 0.9);
      c.lineWidth = 9;
      c.lineCap = 'round';
      for (let s = 0; s < SEGS; s++) {
        if (hash(r * 97 + s, 4.1) < gone) continue;
        const a0 = (s / SEGS) * Math.PI * 2 + 0.6 * t * (r % 2 ? 0.2 : -0.2), a1 = a0 + ((Math.PI * 2) / SEGS) * 0.8;
        c.beginPath(); c.ellipse(0, 0, rx, ry, 0, a0, a1); c.stroke();
      }
      c.restore();
    }
    for (const line of this.lines) {
      drawLyric(c, line, t, {
        x: cx, y: cy + 44, size: 124, maxWidth: 1380, align: 'center', family: F.slam(), lead: 0.4,
        drawChar: (cc, ch, s) => {
          if (!s.sung) { cc.strokeStyle = pcss(P, 'deep', 0.75); cc.lineWidth = 2.6; cc.strokeText(ch, 0, 0); return; }
          cc.fillStyle = pcss(P, 'signal'); cc.fillText(ch, 0, 0);
        },
        charTransform: (_ch, _i, s) => (s.sung ? { dy: -10 * ease.outBack(clamp(s.frac * 5)) } : { dy: 0 }),
      });
    }
    L.upload();
    const hosted = !!this.ctx.params.hosted;
    clearRT(renderer, out, hosted ? [1, 1, 1] : plin(P, 'ground'), 1);
    this.ctx.comp.draw(renderer, L.texture, out, { mode: 'normal' });
    return { zoom: 1 + 0.03 * db, shake: [0, 0], flash: 0, bloom: 0, vignette: 0.2 };
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    if (this.plate.variant === 'dawn') return this.dawn(f, out);
    const { renderer, audio } = this.ctx;
    const t = f.t, P = this.P;
    const st = stateAt(this.list, t);
    const sh = shotAt(this.list, t);
    const cam = String(st.cam);
    const start = this.ctx.start, end = this.ctx.end;

    const bp = beatPulse(audio, t, 0.26), db = downbeatPulse(audio, t, 0.45), kp = kickPulse(audio, t, 0.14);
    const breath = 0.75 * bp + 0.5 * db + 0.15 * kp;
    const cm = this.camera(cam, t, sh.t0, sh.t1 === Infinity ? end : sh.t1);
    const s = cm.s * (1 + 0.006 * bp);
    const soft = cm.soft * (1 + 0.04 * bp) + 3 * bp; // the edge softens ~4 % on every beat

    const u = this.pass.u;
    (u.uC!.value as THREE.Vector2).set(W / 2 + (AP.x - W / 2) * s, H / 2 + (AP.y - H / 2) * s);
    (u.uHalf!.value as THREE.Vector2).set(AP.hx * s, AP.hy * s);
    u.uR!.value = AP.r * s;
    u.uSoft!.value = soft;
    u.uBreath!.value = breath;
    u.uSpill!.value = 220 * s * (1 + 0.7 * bp + 0.4 * db);
    const flat = cam === 'flat' ? ease.outCubic(clamp((t - sh.t0) / 0.2)) : 0;
    u.uFlat!.value = flat;
    // exit: the field turns to page white, landing on the plate's end
    u.uWhite!.value = cam === 'flat' ? 0.85 * smoothstep(sh.t0 + 0.12, end - 0.02, t) : 0;
    u.uT!.value = t;
    this.pass.render(renderer, out);

    // ---- Canvas2D: the ring being shoved out, then the line in the light
    const L = this.layer, c = L.ctx;
    L.clear();

    // the previous plate's cage ring, still around the words at the cut: the push shoves it past the frame edges
    const ra = t - start;
    if (ra < 0.42) {
      const g = ease.inCubic(clamp(ra / 0.34));
      const rs = 1 + 3.6 * g, al = 1 - smoothstep(0.18, 0.4, ra);
      c.save();
      c.translate(960 - 90 * g, 540 + 140 * g);
      c.filter = `blur(${(1 + 14 * g).toFixed(1)}px)`;
      c.lineWidth = 16 * rs;
      c.strokeStyle = pcss(P, 'text', 0.9 * al);
      for (const [rx, ry, rot] of [[640, 210, -0.12], [520, 320, 0.5]] as const) {
        c.beginPath();
        c.ellipse(0, 0, rx * rs, ry * rs, rot + 0.5 * g, 0, Math.PI * 2);
        c.stroke();
      }
      c.restore();
    }

    // the line: floats in the light, barely visible (a slightly different luminance of the field) until sung, then
    // saturates; once a word is sung it dissolves into the field. The last word dissolves syllable by syllable.
    const push = cam === 'push' ? clamp((t - sh.t0) / 2.1) : cam === 'flat' ? 1 : 0;
    const ly = 540 - 20 * push;
    const lyScale = 1 + 0.08 * push;
    for (const line of this.lines) {
      const nW = line.words.length;
      drawLyric(c, line, t, {
        x: 960 - 480 * ease.inOutCubic(push), y: ly + 46, size: 140 * lyScale, maxWidth: 1340 * lyScale, align: 'center', family: F.slam(),
        lead: 0.6, unsungAlpha: 1,
        charTransform: (_ch, idx, cs) => {
          const w = line.words[cs.word]!;
          const lastWord = cs.word === nW - 1;
          // when this glyph starts dissolving: after its own syllable (last word) or after its word ends
          const syl = w.syl && w.syl.length ? w.syl[cs.syl]! : [w.start, w.end];
          const t0 = lastWord ? syl[1] + 0.12 : w.end + 0.28;
          const dz = ease.inOutQuad(clamp((t - t0) / (lastWord ? 0.75 : 1.1)));
          const bob = (1 - dz) * 5 * bp * Math.sin(idx * 1.3);
          return { dy: -46 * dz - bob, scale: 1 + 0.22 * dz + 0.02 * db * (cs.sung ? 1 : 0), alpha: 1 - dz };
        },
        drawChar: (c2d, ch, cs) => {
          const w = line.words[cs.word]!;
          const lastWord = cs.word === nW - 1;
          const syl = w.syl && w.syl.length ? w.syl[cs.syl]! : [w.start, w.end];
          const t0 = lastWord ? syl[1] + 0.12 : w.end + 0.28;
          const dz = clamp((t - t0) / (lastWord ? 0.75 : 1.1));
          // unsung: a whisper of the field's own highlight; sung: saturates to the text stop, warmed on the downbeat
          const sat = cs.sung ? ease.outCubic(clamp(cs.frac * 3)) : 0;
          if (sat <= 0) {
            c2d.fillStyle = pcss(P, 'hi', 0.42);
          } else {
            c2d.fillStyle = dz > 0 ? pmix(P, 'text', 'hi', ease.inQuad(dz) * 0.85, 1) : pmix(P, 'text', 'signal', 0.35 * db, 1);
            if (sat < 1) c2d.globalAlpha *= 0.35 + 0.65 * sat;
          }
          const blur = cs.sung ? 26 * ease.inQuad(dz) + (1 - sat) * 2 : 3;
          c2d.filter = blur > 0.2 ? `blur(${blur.toFixed(1)}px)` : 'none';
          c2d.fillText(ch, 0, 0);
          c2d.filter = 'none';
        },
      });
    }
    L.upload();
    this.ctx.comp.draw(renderer, L.texture, out, { mode: 'normal' });

    // hits (T2): a breath, not a punch — a small zoom on each beat, a push punch on the cut, a soft white lift on the
    // Ganzfeld snap; the vignette (the room) goes away as the edges do
    const cut = sh.t0 > start + 1e-3 ? Math.exp(-(t - sh.t0) / 0.14) : 0;
    const flatHit = cam === 'flat' ? Math.exp(-(t - sh.t0) / 0.18) : 0;
    return {
      bloom: 0,
      zoom: 1 + 0.01 * bp + 0.025 * cut,
      exposure: 1 + 0.07 * bp + 0.04 * db,
      flash: 0.12 * flatHit,
      vignette: cam === 'wide' || cam === 'wall' ? 0.16 : cam === 'push' ? 0.16 * (1 - push) : 0,
      ca: cam === 'wide' || cam === 'wall' ? 0.4 : 0,
      grain: 0.03,
      shake: [0, 0],
    };
  }

  override dispose() { this.layer?.texture.dispose(); this.pass?.mat.dispose(); }
}
