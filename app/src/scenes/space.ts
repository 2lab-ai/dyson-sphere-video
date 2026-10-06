// COSMOS run host (v4, p13–p17): photographic space. One world for five plates — a black ground, a deep star field in
// three parallax layers drifting slowly, a faint deep-blue haze — and one layout: the subject is a circle at the anchor
// (1187, 413) (plasma knot -> web knot -> the Sun -> Earth + Theia -> the Moon forming). Camera class: a slow push about
// the anchor plus a cut-in per bar (1.0x <-> 1.6x on bar parity, held for the whole bar), applied identically to the
// star field and the subject slot, so the circle never leaves the anchor. Stars behind a solid body are occluded (the
// subject is composited with 'max', which cannot hide what is behind it). The one full-frame whiteout of the unit is
// p13's at 65.120 s (the host owns it: the subject only covers its slot).
import * as THREE from 'three';
import { FSPass, makeRT, clearRT, W, H } from '../engine/gl';
import type { Frame, PostOverrides } from '../engine/scene';
import { palette, plin } from '../engine/palette';
import { downbeatPulse } from '../engine/beat';
import { clamp } from '../engine/util';
import { WorldHost, type Slot } from '../engine/world';

/** The run's anchor, px from the top-left of the 1920x1080 frame. */
const ANCHOR: [number, number] = [1187, 413];
/** The unit's whiteout (p13, the drop). */
const WHITEOUT_T = 65.12;
/** Radius (child half-height units) of the solid body each subject puts at the anchor, for star occlusion. */
const BODY: Record<string, (p: number) => number> = {
  // solar / moon step per beat (8 and 4 beats per plate): the same held radius their hosted GLSL draws
  solar: (p) => Math.min(0.3 * Math.pow(1.06, 1 + Math.floor(p * 8)), 0.5),
  impact: () => 0.34,
  moon: (p) => 0.08 + 0.07 * Math.min(Math.floor(p * 4), 3),
};

const GLSL = /* glsl */ `
uniform vec2 uRes; uniform vec2 uAnchor; uniform float uZoom, uT, uOcc, uDb;
uniform vec3 cDeep, cMid, cHi;
// one layer of stars: a jittered cell grid, sparse, with a photographic size/brightness spread
vec3 stars(vec2 q, float cell, float dens, float seed) {
  vec2 id = floor(q / cell), f = q / cell - id;
  vec3 c = vec3(0.0);
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 g = id + vec2(i, j);
    float h = hash12(g + seed);
    if (h > dens) continue;
    vec2 o = hash22(g + seed * 1.7);
    vec2 d = (vec2(i, j) + o - f) * cell;
    float mag = pow(hash12(g + seed * 3.1), 6.0);           // most stars faint, a few bright
    float r = 0.7 + 1.6 * mag;
    float core = exp(-dot(d, d) / (r * r));
    float tw = 0.85 + 0.15 * sin(uT * (1.3 + 2.0 * h) + h * 40.0);
    vec3 tint = mix(mix(cMid, vec3(1.0), 0.65), cHi, hash12(g + seed * 5.3));
    c += tint * core * (0.25 + 2.2 * mag) * tw;
  }
  return c;
}
void main() {
  vec2 px = vec2(vUv.x, 1.0 - vUv.y) * uRes;                  // px from the top-left, like the anchor
  vec2 rel = px - uAnchor;
  vec3 c = vec3(0.0);
  for (int k = 0; k < 3; k++) {
    float depth = 0.35 + 0.325 * float(k);                    // far layers move least on the push and drift
    float z = 1.0 + (uZoom - 1.0) * depth;
    vec2 q = rel / z + uAnchor + vec2(-6.0, 2.5) * uT * depth;
    c += stars(q, 22.0 + 10.0 * float(k), 0.16 - 0.04 * float(k), 17.0 + 31.0 * float(k)) * (0.55 + 0.25 * float(k));
  }
  // faint haze: deep blue dust, darker toward the frame edge
  vec2 hq = (rel / (1.0 + (uZoom - 1.0) * 0.2)) / uRes.y;
  float neb = smoothstep(0.1, 0.9, fbm(hq * 1.6 + vec2(3.1, 7.7) + uT * 0.004, 5) * 0.5 + 0.5);
  c += cDeep * neb * 0.22;
  // the body at the anchor hides what is behind it
  float rpx = uOcc * 540.0 * uZoom;
  c *= smoothstep(rpx - 2.0, rpx + 2.0, length(rel));
  fragColor = vec4(c * (1.0 + 0.12 * uDb), 1.0);
}`;

export default class Space extends WorldHost {
  private world!: FSPass;
  private white!: THREE.WebGLRenderTarget;
  private bars: number[] = [];

  protected override initWorld() {
    const P = palette(this.ctx.params.look?.palette ?? 'space');
    const v = (r: 'deep' | 'mid' | 'hi') => ({ value: new THREE.Vector3(...plin(P, r)) });
    this.world = new FSPass(GLSL, {
      uRes: { value: new THREE.Vector2(W, H) }, uAnchor: { value: new THREE.Vector2(...ANCHOR) },
      uZoom: { value: 1 }, uT: { value: 0 }, uOcc: { value: 0 }, uDb: { value: 0 }, cDeep: v('deep'), cMid: v('mid'), cHi: v('hi'),
    });
    this.white = makeRT(8, 8);
    clearRT(this.ctx.renderer, this.white, [1, 1, 1], 1);
    this.bars = this.ctx.audio.downbeats.filter((b) => b >= this.ctx.start - 1e-3 && b < this.ctx.end - 1e-3);
  }

  /** Camera: slow push over the plate x a cut-in on every other bar (held the whole bar), x a small settle on the cut. */
  private zoom(f: Frame) {
    let n = 0;
    for (const b of this.bars) if (b <= f.t) n++;
    const cut = n % 2 === 1 ? 1.6 : 1.0;
    return (1 + 0.08 * f.p) * cut * (1 + 0.025 * downbeatPulse(this.ctx.audio, f.t, 0.18));
  }

  /** p13's whiteout: dark on the first frame (the residue point), white in 3 frames, held, then gone by ~0.8 s. */
  private whiteout(t: number) {
    const dt = t - WHITEOUT_T;
    if (dt < 0 || dt > 0.8) return 0;
    return clamp(dt / 0.05, 0, 1) * (1 - clamp((dt - 0.3) / 0.5, 0, 1));
  }

  renderWorld(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const u = this.world.u, sub = (this.ctx.params.subject as { module: string }).module;
    u.uZoom!.value = this.zoom(f); u.uT!.value = f.t; u.uDb!.value = downbeatPulse(this.ctx.audio, f.t, 0.3);
    u.uOcc!.value = BODY[sub]?.(f.p) ?? 0;
    this.world.render(this.ctx.renderer, out);
    return { bloom: 0.4, halation: 0.04, vignette: 0.22 };
  }

  slot(f: Frame): Slot {
    const s = 1 / this.zoom(f), ax = ANCHOR[0] / W, ay = 1 - ANCHOR[1] / H;
    return { scale: [s, s], offset: [(0.5 - ax) * s, (0.5 - ay) * s], mode: 'max' };
  }

  protected override afterSubject(f: Frame, out: THREE.WebGLRenderTarget) {
    const w = this.whiteout(f.t);
    if (w > 0) this.ctx.comp.draw(this.ctx.renderer, this.white.texture, out, { mode: 'screen', opacity: w });
  }

  override dispose() { super.dispose(); this.world?.mat.dispose(); this.white?.dispose(); }
}
