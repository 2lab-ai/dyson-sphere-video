// Ignition ramp (from v1 scenes/ignite.ts): a point of light swelling into a star.
//   igniteRamp(t, t0, dur)            0 before t0, smoothstep up to 1 at t0 + dur
//   igniteRadius(t, t0, dur, r, kick) star radius: ramp x r, breathing with a 0..1 kick pulse
//   IGNITE_GLSL                       float igniteRamp(float t, float t0, float dur);
//                                     float coronaFalloff(float r, float R, float k);  exp falloff outside R
import { smoothstep } from '../util';

export const igniteRamp = (t: number, t0: number, dur: number) => smoothstep(t0, t0 + Math.max(1e-4, dur), t);

export const igniteRadius = (t: number, t0: number, dur: number, r: number, kick = 0) =>
  r * igniteRamp(t, t0, dur) * (1 + 0.12 * kick);

export const IGNITE_GLSL = /* glsl */ `
float igniteRamp(float t, float t0, float dur) { return smoothstep(t0, t0 + max(dur, 1e-4), t); }
float coronaFalloff(float r, float R, float k) { return exp(-max(r - R, 0.0) * k); }
`;
