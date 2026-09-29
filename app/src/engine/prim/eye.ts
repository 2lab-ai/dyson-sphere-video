// Eye ring masks (from v1 scenes/eye.ts): anti-aliased rings and segmented rings in polar coords.
//   EYE_GLSL                          float ringMask(float r, float r0, float w, float aa);   line of half-width w at radius r0
//                                     float segRing(float r, float a, float r0, float r1, float n, float duty, float rot, float aa);
//                                       band r0..r1 cut into n angular segments, `duty` filled, rotated by rot (rad)
//   ringMask(r, r0, w, aa)            TS version of the ring mask (for Canvas2D hit tests)
import { smoothstep } from '../util';

export const ringMask = (r: number, r0: number, w: number, aa = 0.0025) => smoothstep(w + aa, w, Math.abs(r - r0));

export const EYE_GLSL = /* glsl */ `
float ringMask(float r, float r0, float w, float aa) { return smoothstep(w + aa, w, abs(r - r0)); }
float segRing(float r, float a, float r0, float r1, float n, float duty, float rot, float aa) {
  float band = smoothstep(r0 - aa, r0, r) * smoothstep(r1 + aa, r1, r);
  float f = fract((a + rot) / TAU * n);
  float d = (abs(f - 0.5) - 0.5 * duty) * (TAU * r / n);
  return band * smoothstep(aa, -aa, d);
}
`;
