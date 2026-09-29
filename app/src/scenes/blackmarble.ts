// BLACKMARBLE — NASA's Black Marble (Earth at night from orbit): a deep navy globe, a thin blue limb, sodium city
// lights. The future seen from orbit: the lyric line is not laid over the planet, it IS a continent of settlements.
//   Canvas2D (offscreen, never composited): the line is drawn with drawLyric into a settlement-density mask, in a
//     tangent patch of the globe. Sung characters are dense (cities switch on syllable by syllable); unsung ones are a
//     faint unlit outline (dark land, no lights), so nothing reads early.
//   GL (one full-screen pass): an analytic orthographic globe. Night land, rivers of towns, the word continent as
//     sprawl glow + point cities + (close/top) a street grid like a circuit; limb scattering pow(1 - N.V, 4) and a
//     thin airglow line; the dawn terminator, a dim navy day side that switches lights off.
// Variant (data/edit.json):
//   future (p23)  wide orbit -> close oblique over 미래 -> straight down on the street grid under 그속에 -> exit:
//                 a tilted limb, the dawn line sweeping across (the lights switch off in a wave; the word stays).
// Beat: on every beat the settlements step up one grid level (new cells twinkle on) and the whole night side
//   pulses; each strong kick advances the terminator one step.
import * as THREE from 'three';
import { Scene, type Frame, type PostOverrides } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { palette, pcss, plin, type NamedPalette } from '../engine/palette';
import { drawLyric, layoutLine, ownedLines, F, type LineLayout } from '../engine/lyric';
import { beatPulse, kickPulse, downbeatPulse, beatIndex } from '../engine/beat';
import { shotAt, type PlateInfo, type Shot } from '../engine/shots';
import { clamp, ease, lerp, smoothstep } from '../engine/util';
import type { Line } from '../engine/lyrics';
import { shots } from './blackmarble.shots';

// settlement mask (tangent patch of the globe), mask px
const MW = 3072, MH = 768, MSIZE = 230;

/** One orbital camera: globe centre + radius (px), roll, where the patch centre sits on screen, the line's width. */
type Cam = { cx: number; cy: number; R: number; roll: number; px: number; py: number; textW: number; focus: number; cellPx: number; grid: number };

// ------------------------------------------------------------------ GL
const FRAG = /* glsl */ `
uniform vec2 uRes;
uniform vec4 uCam;              // globe centre xy (px), radius (px), roll
uniform vec3 uEv, uUv, uNv;     // patch basis in view space (east, north, out)
uniform vec2 uSpan;             // mask extent in sphere units (east, north)
uniform sampler2D uMask;
uniform vec3 uSunG;             // sun direction in the patch (globe) frame
uniform vec4 uB;                // beat pulse, grid level (float), kick pulse, downbeat pulse
uniform vec4 uL;                // cell frequency (cells / sphere unit), cell px, street-grid mix, street freq
uniform vec4 uX;                // exit wave front (px along the wave axis), wave active, text floor on the day side, city districts beyond the word
uniform vec3 uGround, uDeep, cPalMid, uHi, uSig;

// nearest jittered point of the 3D cell lattice around p (cell units): distance + cell hash
vec2 cell3(vec3 p) {
  vec3 ip = floor(p), fp = p - ip;
  vec3 o = step(0.5, fp) - 1.0;           // the 2x2x2 block nearest to p
  float best = 9.0, h = 0.0;
  for (int i = 0; i < 8; i++) {
    vec3 c = o + vec3(float(i & 1), float((i >> 1) & 1), float((i >> 2) & 1));
    vec3 r = hash33(ip + c);
    vec3 d = c + 0.2 + 0.6 * r - fp;
    float dd = dot(d, d);
    if (dd < best) { best = dd; h = hash13(ip + c + 17.3); }
  }
  return vec2(sqrt(best), h);
}

float maskA(vec2 uv) { return texture(uMask, uv).a; }

void main() {
  vec2 fc = vec2(vUv.x, 1.0 - vUv.y) * uRes;
  vec2 q = rot2(uCam.w) * (fc - uCam.xy) / uCam.z;
  float r = length(q);
  float R = uCam.z;
  vec3 col = uGround;
  vec3 sodium = mix(uSig, uHi, 0.42);

  if (r < 1.0) {
    vec3 V = vec3(q.x, -q.y, sqrt(max(0.0, 1.0 - r * r)));      // surface normal (view space)
    vec3 S = vec3(dot(V, uEv), dot(V, uUv), dot(V, uNv));        // the same point in the globe frame
    float lam = dot(S, uSunG);                                   // > 0: day
    float night = smoothstep(0.06, -0.05, lam);

    // --- ground: black ocean, moonlit land (deep navy, very dim)
    float land = fbm(S * 2.2 + 3.1, 4);
    float isLand = smoothstep(-0.02, 0.06, land);
    vec3 base = mix(uGround * 1.4, uDeep * 0.55, isLand) * (0.8 + 0.4 * fbm(S * 14.0, 3));
    // day side: a dim navy wash (never bright), with a thin warm twilight band on the terminator
    base = mix(base, uDeep * (0.55 + 0.9 * sat(lam * 2.0)) + cPalMid * 0.10 * sat(lam * 3.0), 1.0 - night);
    base += sodium * 0.05 * exp(-abs(lam) * 45.0);

    // --- the word continent: settlement density from the mask (tangent-plane projection of the patch)
    vec2 uv = vec2(0.5 + S.x / uSpan.x, 0.5 + S.y / uSpan.y);
    float inPatch = step(0.0, S.z) * step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
    vec2 px = vec2(1.0 / ${MW}.0, 1.0 / ${MH}.0);
    float m = maskA(uv) * inPatch;
    float sprawl = 0.0, moat = 0.0;
    for (int i = 0; i < 8; i++) {
      float a = float(i) * 0.785398;
      vec2 o = vec2(cos(a), sin(a));
      sprawl += maskA(uv + o * px * 7.0);
      moat += maskA(uv + o * px * 90.0);
    }
    sprawl = sprawl / 8.0 * inPatch;
    moat = sat(moat / 8.0 * 4.0 + sprawl * 2.0) * inPatch;
    float lit = smoothstep(0.38, 0.62, m);                        // sung strokes (unsung ~0.2: outline only)
    float litS = smoothstep(0.30, 0.62, sprawl);
    float outline = smoothstep(0.08, 0.2, max(m, sprawl)) * (1.0 - lit);
    // districts and dark parks inside the strokes: the word is settlements, not a fill
    float patchN = smoothstep(-0.25, 0.35, fbm(S * uL.x * 0.08, 2));

    // --- background towns: sparse chains along rivers and coasts, kept out of the moat around the word
    float river = 1.0 - abs(fbm(S * 5.5 + 7.7, 4));
    float coast = 1.0 - abs(land) * 18.0;
    float chain = max(pow(sat(river), 22.0), sat(coast) * 0.5) * isLand;
    float bgD = chain * smoothstep(0.1, 0.5, fbm(S * 30.0 + 1.3, 2) + 0.35) * (1.0 - moat) * 0.6;

    // --- point cities (3D cells: foreshorten naturally toward the limb), two sizes
    float lvl = uB.y;
    vec2 cl = cell3(S * uL.x);
    float dpx = cl.x * uL.y;                                      // distance to the cell's city in px
    vec2 cl2 = cell3(S * uL.x * 2.3 + 5.1);
    float dpx2 = cl2.x * uL.y / 2.3;
    float dens = lit * (0.35 + 0.65 * patchN);
    float thrT = (0.62 + 0.06 * lvl) * 1.3 * dens;                // one grid step per beat
    float thrB = (0.35 + 0.05 * lvl) * 2.0 * bgD;
    float onT = step(cl.y, thrT);
    float onT2 = step(cl2.y, dens * (0.45 + 0.06 * lvl));
    float onB = step(cl.y, thrB);
    // the cells that switched on at this beat twinkle
    float fresh = step(thrT - 0.08 * dens, cl.y) * onT + step(thrB - 0.1 * bgD, cl.y) * onB;
    float bright = (0.55 + 0.45 * fract(cl.y * 91.7)) * (1.0 + 2.2 * uB.x * fresh);
    float core = exp(-dpx * dpx / 1.1), halo = exp(-dpx / 2.6);

    // --- street grid (close/top): lit avenues inside the built-up word, lit blocks, vias at crossings (a circuit)
    vec2 g = S.xy * uL.w;
    vec2 gf = abs(fract(g + 0.5) - 0.5);
    float gpx = uCam.z / uL.w;                                    // street spacing in px
    float street = exp(-pow(min(gf.x, gf.y) * gpx / 1.2, 2.0));
    vec2 ga = abs(fract(g / 5.0 + 0.5) - 0.5) * 5.0;              // arterials every 5th street
    float art = exp(-pow(min(ga.x, ga.y) * gpx / 2.0, 2.0));
    float via = exp(-pow(length(gf) * gpx / 2.4, 2.0));
    float grid = uL.z * (street * 0.9 + art * 1.4 + via * 1.6 * (0.6 + 0.4 * step(0.5, hash12(floor(g + 0.5)))));
    float blockLit = step(hash12(floor(g) + 3.7), 0.35 + 0.45 * patchN);
    // districts of the city beyond the word (top only): patchy, with dark gaps, never a lattice over everything
    float bgTown = uX.w * (1.0 - smoothstep(0.05, 0.3, sprawl)) * smoothstep(0.1, 0.45, fbm(S * 25.0 + 2.0, 3));

    // --- switch-off wave (exit): screen-space front sweeping along the dawn direction
    float front = uX.x;
    float wv = dot(fc, normalize(vec2(1.0, 0.35)));
    float off = uX.y * smoothstep(front + 40.0, front - 40.0, wv);  // 1 behind the front
    float spark = uX.y * exp(-abs(wv - front) / 28.0);              // the front flickers as the grid drops
    float bgOn = night * (1.0 - off);
    float wordOn = mix(uX.z, 1.0, night * (1.0 - off * (1.0 - uX.z)));

    float gain = 1.0 + 0.55 * uB.x + 0.25 * uB.w;                // the night side pulses on the beat
    vec3 lights = vec3(0.0);
    lights += sodium * (litS * 0.20 + lit * 0.10 * (0.5 + patchN)) * wordOn;          // sprawl glow
    lights += (uHi * 3.2 * core + sodium * 1.2 * halo) * onT * bright * wordOn;       // word cities
    lights += uHi * 1.6 * exp(-dpx2 * dpx2 / 0.8) * onT2 * wordOn;                     // word towns
    lights += sodium * grid * lit * (0.5 + 0.5 * blockLit) * wordOn;                   // avenues
    lights += sodium * 0.22 * uL.z * lit * blockLit * (1.0 - street) * wordOn;         // lit blocks
    lights += uHi * 1.2 * grid * lit * via * wordOn * uB.x;                             // vias flash on the beat
    lights += sodium * grid * 0.16 * bgTown * bgOn;                                     // the city grid beyond (top)
    lights += uHi * 1.4 * via * bgTown * bgOn * step(0.55, hash12(floor(g + 0.5) + 9.1)) * (1.0 + uB.x);   // its crossings
    lights += (uHi * 2.0 * core + sodium * 0.9 * halo) * onB * bright * 0.8 * bgOn;   // towns
    lights += sodium * bgD * 0.08 * bgOn;                                               // faint rural haze
    lights += uHi * 1.5 * spark * (bgD + lit);
    vec3 outl = uDeep * 0.9 * outline;                                                  // unlit land of the word
    col = base + outl + lights * gain;

    // limb scattering inside the disc (airglow on the night side, brighter toward the sun)
    float rim = pow(1.0 - V.z, 4.0);
    col += cPalMid * rim * (0.35 + 0.5 * sat(lam + 0.25));
  }
  // atmosphere outside the disc: a thin airglow line + soft blue falloff
  float hpx = (r - 1.0) * R;
  if (hpx > 0.0) {
    float thick = 6.0 + R * 0.012;
    col += cPalMid * (0.55 * exp(-hpx / thick) + 0.35 * exp(-hpx * hpx / 6.0)) * (1.0 + 1.2 * uB.x);   // the airglow line strobes on the beat
    col += uHi * 0.06 * exp(-hpx * hpx / 3.0);
  }
  fragColor = vec4(max(col, 0.0), 1.0);
}`;

// ------------------------------------------------------------------ scene
export default class BlackMarble extends Scene {
  private mask!: Layer2D;
  private pass!: FSPass;
  private list: Shot[] = [];
  private plate!: PlateInfo;
  private lines: Line[] = [];
  private P!: NamedPalette;
  private kicks: number[] = [];

  override init() {
    this.plate = this.ctx.params as PlateInfo;
    this.list = shots(this.plate, this.ctx.audio);
    this.lines = ownedLines(this.ctx);
    this.P = palette(this.ctx.params.look?.palette ?? 'blackmarble');
    this.mask = new Layer2D(MW, MH, 1);
    this.mask.texture.colorSpace = THREE.NoColorSpace;
    const ks = this.ctx.audio.onsets?.kick ?? [];
    this.kicks = ks.filter(([t, s]) => s >= 0.9 && t >= this.ctx.start - 1e-3 && t < this.ctx.end).map(([t]) => t);
    const P = this.P, v3 = (k: 'ground' | 'deep' | 'mid' | 'hi' | 'signal') => new THREE.Vector3(...plin(P, k));
    this.pass = new FSPass(FRAG, {
      uRes: { value: new THREE.Vector2(W, H) },
      uCam: { value: new THREE.Vector4() },
      uEv: { value: new THREE.Vector3() },
      uUv: { value: new THREE.Vector3() },
      uNv: { value: new THREE.Vector3() },
      uSpan: { value: new THREE.Vector2(1, 1) },
      uMask: { value: this.mask.texture },
      uSunG: { value: new THREE.Vector3() },
      uB: { value: new THREE.Vector4() },
      uL: { value: new THREE.Vector4() },
      uX: { value: new THREE.Vector4() },
      uGround: { value: v3('ground') },
      uDeep: { value: v3('deep') },
      cPalMid: { value: v3('mid') },
      uHi: { value: v3('hi') },
      uSig: { value: v3('signal') },
    });
  }

  /** Strong kicks since the plate start, each eased in (the terminator steps on them). */
  private kickSteps(t: number) {
    let k = 0;
    for (const x of this.kicks) if (t >= x) k += ease.outBack(clamp((t - x) / 0.14));
    return k;
  }

  private camFor(cam: string, u: number): Cam {
    // u: 0..1 through the shot
    switch (cam) {
      case 'close': // oblique over the word continent, the limb across the top, a slight roll
        return { cx: 960 - 30 * u, cy: 1900, R: 1800 * (1 + 0.035 * u), roll: 0.1, px: 960, py: 600, textW: 1800, focus: -1, cellPx: 7, grid: 0.4 };
      case 'top': // straight down: no limb, the street grid under 그속에
        return { cx: 960, cy: 560, R: 11000 * (1 + 0.06 * u), roll: 0, px: 960 - 40 * u, py: 560, textW: 3900, focus: 2, cellPx: 13, grid: 1 };
      case 'exit': // tilted limb, dawn coming over it
        return { cx: 1480, cy: 1420, R: 1300, roll: 0.36, px: 980, py: 600, textW: 1150, focus: -1, cellPx: 4.5, grid: 0 };
      default: // wide orbit, the planet low in frame, a slow drift east
        return { cx: 960 + 20 * (1 - u), cy: 960, R: 830 * (1 + 0.03 * u), roll: -0.04, px: 975 - 25 * u, py: 605, textW: 1300, focus: -1, cellPx: 4.5, grid: 0 };
    }
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, audio: au } = this.ctx;
    const t = f.t, P = this.P;
    const sh = shotAt(this.list, t);
    const cam = String(sh.shot.s.cam ?? 'wide');
    const slt = t - sh.t0, su = clamp(slt / Math.max(0.05, Math.min(sh.t1, this.ctx.end) - sh.t0));
    const C = this.camFor(cam, su);

    // ---- settlement mask: the owned line, drawn with drawLyric in the tangent patch
    const c = this.mask.ctx;
    this.mask.clear();
    const line = this.lines[0];
    let lay: LineLayout | null = null;
    if (line) {
      lay = layoutLine(c, line, F.slam(), MSIZE, MW * 0.6);
      let shift = 0;
      if (C.focus >= 0 && lay.words[C.focus]) { const w = lay.words[C.focus]!; shift = -(-lay.width / 2 + w.x + w.w / 2); }
      for (const ln of this.lines) {
        drawLyric(c, ln, t, {
          x: MW / 2 + shift, y: MH / 2 + MSIZE * 0.36, size: MSIZE, maxWidth: MW * 0.6, family: F.slam(), align: 'center',
          unsungAlpha: 0.2, lead: 0.5,
          // a syllable's settlements switch on over its first ~third; unsung stays a dim outline
          charTransform: (_ch, _i, s) => (s.sung ? { alpha: 0.5 + 0.5 * smoothstep(0, 0.3, s.frac) } : { alpha: 1 }),
          drawChar: (cc, ch) => { cc.fillStyle = pcss(P, 'hi'); cc.fillText(ch, 0, 0); },
        });
      }
    }
    this.mask.upload();

    // ---- camera -> uniforms
    const pxPerMask = lay ? C.textW / lay.width : 1;
    const spanE = (MW * pxPerMask) / C.R, spanN = (MH * pxPerMask) / C.R;
    const cr = Math.cos(C.roll), sr = Math.sin(C.roll);
    let dx = (C.px - C.cx) / C.R, dy = (C.py - C.cy) / C.R;
    [dx, dy] = [cr * dx + sr * dy, -sr * dx + cr * dy];
    const d2 = Math.min(0.95, dx * dx + dy * dy), k = Math.sqrt(d2 / Math.max(1e-9, dx * dx + dy * dy));
    const n = [dx * k, -dy * k, Math.sqrt(1 - d2)] as const;
    let e = [1 - n[0] * n[0], -n[0] * n[1], -n[0] * n[2]];
    const el = Math.hypot(e[0]!, e[1]!, e[2]!); e = e.map((x) => x / el);
    const up = [n[1] * e[2]! - n[2] * e[1]!, n[2] * e[0]! - n[0] * e[2]!, n[0] * e[1]! - n[1] * e[0]!];
    const U = this.pass.u;
    (U.uCam!.value as THREE.Vector4).set(C.cx, C.cy, C.R, C.roll);
    (U.uNv!.value as THREE.Vector3).set(n[0], n[1], n[2]);
    (U.uEv!.value as THREE.Vector3).set(e[0]!, e[1]!, e[2]!);
    (U.uUv!.value as THREE.Vector3).set(up[0]!, up[1]!, up[2]!);
    (U.uSpan!.value as THREE.Vector2).set(spanE, spanN);

    // ---- beat: grid level steps per beat; terminator steps per strong kick; the exit sweeps dawn across
    const bp = beatPulse(au, t, 0.14), kp = kickPulse(au, t, 0.1), dp = downbeatPulse(au, t, 0.25);
    const lvl = Math.max(0, beatIndex(au, t) - beatIndex(au, this.ctx.start + 1e-3));
    (U.uB!.value as THREE.Vector4).set(bp, lvl, kp, dp);
    const ex = cam === 'exit' ? su : 0;
    // sun in the globe frame: rotating about north; the terminator rises from the western limb, one step per kick
    const A = (1.72 - 0.16 * this.kickSteps(t)) - 1.2 * ease.inOutCubic(ex);
    (U.uSunG!.value as THREE.Vector3).set(-Math.cos(A), 0.12, -Math.sin(A));
    const cellF = C.R / C.cellPx;
    (U.uL!.value as THREE.Vector4).set(cellF, C.cellPx, C.grid, C.R / 30);
    // exit wave: the front crosses the frame (along (1, .35)) over the shot
    const span = W + 0.35 * H + 200;
    (U.uX!.value as THREE.Vector4).set(cam === 'exit' ? lerp(-100, span, ease.outQuad(ex)) : -1e4, cam === 'exit' ? 1 : 0, 0.55, cam === 'top' ? 1 : 0);

    this.pass.render(renderer, out);

    // ---- post: bloom on the city cores only, a punch on each cut, a kick shake
    const cut = Math.exp(-slt / 0.12);
    return {
      bloom: 0.55 + 0.35 * bp,
      bloomThreshold: 0.9,
      bloomRadius: 0.6,
      zoom: 1 + 0.045 * cut + 0.012 * kp + 0.006 * bp,
      shake: [Math.sin(t * 91) * 2.5 * kp, Math.cos(t * 77) * 2.5 * kp],
      vignette: 0.35,
      flash: cam === 'top' ? 0.05 * cut : 0,
    };
  }

  override dispose() {
    this.mask.texture.dispose();
    this.pass.mat.dispose();
  }
}
