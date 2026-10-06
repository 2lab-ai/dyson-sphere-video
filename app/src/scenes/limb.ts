// ORBIT host (run p23–p27, docs/PLAN-V4.md §C7): a photographic night Earth seen from orbit. The Earth disc sits on
// the run's anchor circle — the same circle as p22's engraved iris (engine/anchor.ts ORBIT_CIRCLE), so the cut p22→p23 swaps the
// medium (W) and keeps the circle — and its limb arcs across the lower right of the frame, a thin atmosphere line on
// it, sparse city lights on the night face, stars behind. Camera class = the engraving's slow macro crawl, no push:
// the planet turns slowly under a fixed limb and the star field drifts along the seam (both on absolute time, so the
// crawl is continuous across the run's cuts).
//
// Ground per plate from ctx.params.look: palette 'blackmarble' → night, dark ground (p23–p26); palette 'dawn' with
// ground 'light' (p27) → dawn has come over the limb: the sky floods with the dawn colour field, the disc is sunlit
// haze, the limb burns (light from the cut). The subject is composited centred on the anchor: 'screen' on the night
// world (the hosted child's black drops out), 'multiply' on the dawn world (its white drops out).
//
// Beat (world): the atmosphere line flares on each beat; the city lights step brighter per bar (persistent).
import * as THREE from 'three';
import type { Frame, PostOverrides } from '../engine/scene';
import { FSPass, W, H } from '../engine/gl';
import { palette, plin } from '../engine/palette';
import { beatPulse, downbeatPulse } from '../engine/beat';
import { WorldHost, type Slot } from '../engine/world';
import { ORBIT_CIRCLE as IRIS } from '../engine/anchor';

/** Where a non-disc subject's centre goes (px): near the frame centre, on the Earth's face. */
const SUBJECT = { x: 990, y: 470 };

const FRAG = /* glsl */ `
uniform vec2 uRes;
uniform vec3 uA;      // anchor circle: centre px (y down), radius px
uniform float uT, uDawn, uBp, uBar;
uniform vec3 cGround, cDeep, cMid, cHi;

void main() {
  vec2 px = vec2(vUv.x * uRes.x, (1.0 - vUv.y) * uRes.y);
  vec2 q = (px - uA.xy) / uA.z;
  float d = length(q);
  float aa = 1.5 / uA.z;
  float inside = 1.0 - smoothstep(1.0 - aa, 1.0 + aa, d);
  vec2 sunDir = normalize(vec2(0.72, 0.69)); // the dawn side: lower right

  // ---- space: the ground, stars drifting along the seam (the crawl)
  vec2 sp = px + vec2(uT * 9.0, -uT * 1.2);
  vec2 cell = floor(sp / 6.0);
  float h = hash12(cell);
  float star = step(0.9965, h) * (0.35 + 0.65 * hash12(cell + 7.3)) * (0.8 + 0.2 * sin(uT * 3.0 + h * 40.0));
  vec3 night = cGround + cHi * star * 0.85;
  vec3 dawnSky = mix(cHi, cGround, smoothstep(0.0, 1.0, vUv.y * 0.9 + 0.1 * (1.0 - vUv.x)));
  vec3 sky = mix(night, dawnSky + cHi * star * 0.04, uDawn);

  // ---- the disc: a sphere, turning slowly (the crawl)
  float z = sqrt(max(0.0, 1.0 - d * d));
  vec3 n = vec3(q.x, -q.y, z);
  float lon = atan(n.x, n.z) + uT * 0.012, lat = asin(clamp(n.y, -1.0, 1.0));
  vec3 g = vec3(cos(lat) * sin(lon), sin(lat), cos(lat) * cos(lon));
  float land = smoothstep(0.02, 0.12, fbm(g * 2.3, 5));
  float cities = land * smoothstep(0.55, 0.8, fbm(g * 38.0, 3) * 0.5 + 0.5 + 0.25 * fbm(g * 6.0, 2));
  float lit = 0.4 + 0.08 * min(uBar, 6.0);
  float limbDark = pow(z, 0.35);
  vec3 earthN = (cDeep * (0.18 + 0.22 * land) + cHi * cities * lit) * limbDark;
  float day = smoothstep(-0.2, 0.9, dot(q / max(d, 1e-4), sunDir) * d + 0.25);
  vec3 earthD = mix(mix(cGround, cHi, 0.35), mix(cDeep, cMid, 0.4), 0.18 * land) * (0.82 + 0.18 * day);
  vec3 earth = mix(earthN, earthD, uDawn);

  // ---- the atmosphere: a thin line on the limb, thicker on the sun side; the beat flares it
  float side = 0.5 + 0.5 * dot(q / max(d, 1e-4), sunDir);
  float rim = exp(-abs(d - 1.0) * uA.z / (6.0 + 10.0 * side)) * (0.35 + 0.65 * side);
  float halo = exp(-max(0.0, d - 1.0) * uA.z / 60.0) * (1.0 - inside) * side;
  vec3 atmo = cMid * (rim * (0.9 + 0.9 * uBp) + 0.25 * halo) + cHi * pow(rim, 3.0) * side * (0.3 + 0.7 * uDawn);

  vec3 col = mix(sky, earth, inside) + atmo * mix(1.0, 0.6, uDawn);
  fragColor = vec4(col, 1.0);
}
`;

export default class Limb extends WorldHost {
  private pass!: FSPass;
  private dawn = false;

  protected override initWorld() {
    const look = this.ctx.params.look as { palette?: string; ground?: string } | undefined;
    const P = palette(look?.palette ?? 'blackmarble');
    this.dawn = look?.ground === 'light';
    const v3 = (r: 'ground' | 'deep' | 'mid' | 'hi') => ({ value: new THREE.Vector3(...plin(P, r)) });
    this.pass = new FSPass(FRAG, {
      uRes: { value: new THREE.Vector2(W, H) },
      uA: { value: new THREE.Vector3(IRIS.x, IRIS.y, IRIS.r) },
      uT: { value: 0 }, uDawn: { value: 0 }, uBp: { value: 0 }, uBar: { value: 0 },
      cGround: v3('ground'), cDeep: v3('deep'), cMid: v3('mid'), cHi: v3('hi'),
    });
  }

  override renderWorld(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, audio } = this.ctx;
    const t = f.t, u = this.pass.u;
    const prog = Math.min(1, Math.max(0, (t - this.ctx.start) / Math.max(0.1, this.ctx.end - this.ctx.start)));
    u.uT!.value = t;
    // p27: light at the cut (ground 'light'), the flood completing over the plate
    u.uDawn!.value = this.dawn ? 0.85 + 0.15 * prog : 0;
    u.uBp!.value = beatPulse(audio, t, 0.14);
    u.uBar!.value = audio.downbeats ? audio.downbeats.filter((b) => b > this.ctx.start && b <= t).length : 0;
    this.pass.render(renderer, out);
    const db = downbeatPulse(audio, t, 0.2);
    return { zoom: 1 + 0.02 * db, shake: [0, 0], flash: 0, vignette: this.dawn ? 0.15 : 0.35, bloom: this.dawn ? 0 : 0.45, bloomThreshold: 0.85 };
  }

  override slot(_f: Frame): Slot {
    // the disc subject (p23 blackmarble: the iris's circle, face-on) goes exactly onto the anchor circle; the others keep
    // their full-width line in frame, so their centre sits between the anchor and the frame centre, at scale 1 (the
    // lyric keeps its fitted size). The flip board's stock is pale: dimmed so the night side stays the dark ground.
    const disc = this.subjectName.startsWith('blackmarble/');
    const cx = disc ? IRIS.x : SUBJECT.x, cy = disc ? IRIS.y : SUBJECT.y;
    const ax = cx / W - 0.5, ay = 1 - cy / H - 0.5; // uv y runs up
    const dim = this.subjectName.startsWith('flipdisc/') ? 0.72 : 1;
    return { scale: [1, 1], offset: [-ax, -ay], mode: this.dawn ? 'multiply' : 'screen', tint: [dim, dim, dim] };
  }

  override dispose() {
    super.dispose();
    this.pass?.mat.dispose();
  }
}
