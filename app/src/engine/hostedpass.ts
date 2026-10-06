// Hosted subject pass (v4 runs): a subject module that draws a different object when a WorldHost composites it
// (params.hosted) builds one of these instead of its own world. The GLSL defines `vec3 plate(vec2 p)` — p in half-height
// units, centred on the frame centre (the host's slot puts that centre on the run's anchor). Everything outside the
// object must be pure black: the host composites with 'screen', so black is transparent.
//
// Uniforms the plate may read: uLt (s since the plate start), uP (0..1), uNb / uNbar (beats / bars started since the
// plate start, integers as floats — the persistent per-beat / per-bar state), uBp / uDb (decaying beat / downbeat
// pulses), uBeatPh, and the palette roles cGround, cDeep, cMid, cHi, cSig (linear).
import * as THREE from 'three';
import { FSPass, W, H } from './gl';
import { palette, plin } from './palette';
import { beatPulse, downbeatPulse } from './beat';
import type { Frame, SceneCtx } from './scene';

/** Shared photographic-space helpers: one sun direction, one heat ramp, one sphere, one debris ring for the run. */
export const SPACE_GLSL = /* glsl */ `
const vec3 LDIR = normalize(vec3(-0.62, 0.42, 0.66));          // the Sun, upper left, slightly in front
// black body-ish heat ramp: 0 black -> signal red-orange -> gold -> white (runs over 1 in the core)
vec3 heat(float x) {
  vec3 c = mix(vec3(0.0), cSig, smoothstep(0.0, 0.35, x));
  c = mix(c, cHi, smoothstep(0.3, 0.75, x));
  return mix(c, vec3(1.6), smoothstep(0.8, 1.35, x));
}
// a sphere of radius r at c: coverage (antialiased) and the view-space normal
float sphere(vec2 p, vec2 c, float r, out vec3 n) {
  vec2 d = (p - c) / r; float l2 = dot(d, d);
  n = vec3(d, sqrt(max(1.0 - l2, 0.0)));
  return 1.0 - smoothstep(1.0 - 2.5 / (540.0 * r), 1.0, sqrt(l2));
}
// the debris ring seen at an angle: radius R (half-height units), returns (brightness, behind-the-body flag)
vec2 debrisRing(vec2 p, float R, float w, float t) {
  vec2 q = rot2(0.26) * p; q.y /= 0.27;
  float rr = length(q), a = atan(q.y, q.x);
  float band = exp(-pow((rr - R) / w, 2.0));
  float grain = smoothstep(0.35, 0.95, hash12(floor(vec2(a * 140.0 + t * 0.6, rr * 260.0))));
  float clump = 0.55 + 0.45 * snoise(vec2(a * 3.0 + t * 0.4, rr * 4.0));
  return vec2(band * (0.25 + 0.75 * grain) * clump, step(0.0, q.y));
}`;

export class HostedPass {
  private pass: FSPass;
  private beats: number[];
  private bars: number[];
  constructor(private ctx: SceneCtx, glsl: string) {
    const P = palette(ctx.params.look?.palette ?? 'space');
    const v = (r: 'ground' | 'deep' | 'mid' | 'hi' | 'signal') => ({ value: new THREE.Vector3(...plin(P, r)) });
    const u: Record<string, THREE.IUniform> = {
      uRes: { value: new THREE.Vector2(W, H) }, uLt: { value: 0 }, uP: { value: 0 }, uNb: { value: 0 }, uNbar: { value: 0 },
      uBp: { value: 0 }, uDb: { value: 0 }, uBeatPh: { value: 0 },
      cGround: v('ground'), cDeep: v('deep'), cMid: v('mid'), cHi: v('hi'), cSig: v('signal'),
    };
    this.pass = new FSPass(/* glsl */ `
uniform vec2 uRes; uniform float uLt, uP, uNb, uNbar, uBp, uDb, uBeatPh;
uniform vec3 cGround, cDeep, cMid, cHi, cSig;
${SPACE_GLSL}
${glsl}
void main() {
  vec2 p = (vUv * uRes - 0.5 * uRes) / (0.5 * uRes.y);
  fragColor = vec4(max(plate(p), 0.0), 1.0);
}`, u);
    const s = ctx.start - 1e-3, e = ctx.end - 1e-3;
    this.beats = ctx.audio.beats.filter((b) => b >= s && b < e);
    this.bars = ctx.audio.downbeats.filter((b) => b >= s && b < e);
  }
  /** Beats / bars started at or before t (0 before the first one in the plate). */
  count(t: number) {
    let nb = 0, nbar = 0;
    for (const b of this.beats) if (b <= t) nb++;
    for (const b of this.bars) if (b <= t) nbar++;
    return { nb, nbar };
  }
  render(f: Frame, out: THREE.WebGLRenderTarget) {
    const u = this.pass.u, au = this.ctx.audio, { nb, nbar } = this.count(f.t);
    u.uLt!.value = f.lt; u.uP!.value = f.p; u.uNb!.value = nb; u.uNbar!.value = nbar; u.uBeatPh!.value = f.beatPhase;
    u.uBp!.value = beatPulse(au, f.t, 0.12); u.uDb!.value = downbeatPulse(au, f.t, 0.25);
    this.pass.render(this.ctx.renderer, out);
  }
  dispose() { this.pass.mat.dispose(); }
}
