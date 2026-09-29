// Shared base for full-screen shader plates: one fragment shader, fed the song clock and the audio
// features as uniforms. Subclasses give the GLSL body (a `vec3 plate(vec2 p)` function, p = pixel-centred
// coords with the short side spanning -1..1) and optionally per-frame post overrides and extra uniforms.
import * as THREE from 'three';
import { FSPass, H, W } from '../engine/gl';
import { Scene, type Frame, type PostOverrides } from '../engine/scene';

export const SHADER_UNIFORMS = /* glsl */ `
uniform vec2 uRes;        // 1920x1080 (logical)
uniform float uT;         // song time (s)
uniform float uLt;        // time since the scene started (s)
uniform float uP;         // 0..1 through the scene
uniform float uBeat, uBar, uBeatPh, uBarPh; // continuous beat/bar index and phases
uniform float uKick, uSnare, uHat, uVonset; // decaying hit pulses 0..1
uniform float uRms, uLow, uMid, uHigh, uVocal, uDrums, uBass; // envelopes 0..1
uniform float uSeed;
uniform vec4 uParam;      // free per-entry parameters (timeline params.u)
`;

export abstract class ShaderScene extends Scene {
  protected pass!: FSPass;
  /** GLSL defining `vec3 plate(vec2 p)` (linear HDR colour). May declare extra uniforms. */
  protected abstract glsl(): string;
  /** Extra uniforms referenced by glsl(). */
  protected uniforms(): Record<string, THREE.IUniform> { return {}; }
  /** Called each frame before drawing: update extra uniforms, return post overrides. */
  protected frame(_f: Frame): PostOverrides | void {}

  override init() {
    const u: Record<string, THREE.IUniform> = { uRes: { value: new THREE.Vector2(W, H) }, uParam: { value: new THREE.Vector4(...(this.ctx.params.u ?? [0, 0, 0, 0])) } };
    for (const k of ['uT', 'uLt', 'uP', 'uBeat', 'uBar', 'uBeatPh', 'uBarPh', 'uKick', 'uSnare', 'uHat', 'uVonset', 'uRms', 'uLow', 'uMid', 'uHigh', 'uVocal', 'uDrums', 'uBass'])
      u[k] = { value: 0 };
    u.uSeed = { value: this.ctx.params.seed ?? 1 };
    Object.assign(u, this.uniforms());
    this.pass = new FSPass(`${SHADER_UNIFORMS}\n${this.glsl()}\nvoid main() {
      vec2 fc = vUv * uRes;
      vec2 p = (fc - 0.5 * uRes) / (0.5 * uRes.y);
      vec3 c = plate(p);
      fragColor = vec4(max(c, 0.0), 1.0);
    }`, u);
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget) {
    const u = this.pass.u, a = f.a;
    u.uT!.value = f.t; u.uLt!.value = f.lt; u.uP!.value = f.p;
    u.uBeat!.value = f.beat; u.uBar!.value = f.bar; u.uBeatPh!.value = f.beatPhase; u.uBarPh!.value = f.barPhase;
    u.uKick!.value = a.kick; u.uSnare!.value = a.snare; u.uHat!.value = a.hat; u.uVonset!.value = a.vonset;
    u.uRms!.value = a.rms; u.uLow!.value = a.low; u.uMid!.value = a.mid; u.uHigh!.value = a.high;
    u.uVocal!.value = a.vocal; u.uDrums!.value = a.drums; u.uBass!.value = a.bass;
    const ov = this.frame(f);
    this.pass.render(this.ctx.renderer, out);
    return ov;
  }
}
