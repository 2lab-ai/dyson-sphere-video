// Afterglow decay (from v1 scenes/afterglow.ts and the engine's hit pulses): how light dies away.
//   decay(dt, halfLife)               1 at dt = 0, halves every halfLife s (0 for dt < 0)
//   fadeTail(t, t0, t1)               1 before t0 -> 0 at t1 (smooth), for tails and fade-outs
//   AFTERGLOW_GLSL                    float decay(float dt, float halfLife);
//                                     float glowFalloff(float d, float core, float k);  bright core + exp halo
import { smoothstep } from '../util';

export const decay = (dt: number, halfLife: number) => (dt < 0 ? 0 : Math.pow(0.5, dt / Math.max(1e-4, halfLife)));

export const fadeTail = (t: number, t0: number, t1: number) => 1 - smoothstep(t0, t1, t);

export const AFTERGLOW_GLSL = /* glsl */ `
float decay(float dt, float halfLife) { return dt < 0.0 ? 0.0 : exp2(-dt / max(halfLife, 1e-4)); }
float glowFalloff(float d, float core, float k) { return smoothstep(core, 0.0, d) + exp(-max(d, 0.0) * k) * 0.25; }
`;
