// Plate 1 — IGNITE. Hyperspace streaks rush at the camera and a star is born at the vanishing point;
// every kick blows its corona out, and the first handful of collector satellites swing into orbit.
import { ShaderScene } from './_shader';
import type { Frame } from '../engine/scene';
import { prog, ease } from '../engine/util';

export default class Ignite extends ShaderScene {
  protected glsl() {
    return /* glsl */ `
    // streak starfield: stars on concentric shells, stretched radially by speed
    vec3 warp(vec2 p, float speed) {
      vec3 col = vec3(0.0);
      float r = length(p), a = atan(p.y, p.x);
      for (int L = 0; L < 3; L++) {
        float fl = float(L);
        float cells = 90.0 + 70.0 * fl;
        float ai = floor((a / 6.2831853 + 0.5) * cells);
        float h = hash11(ai * 3.7 + fl * 17.0);
        float ac = (ai + 0.5) / cells * 6.2831853 - 3.14159265;
        // star depth cycles toward the camera
        float z = fract(h * 7.3 - uT * (0.10 + 0.05 * fl) * speed);
        float rr = 0.04 / max(z, 0.02);
        float len = 0.02 + 0.5 * speed * (1.0 - z) * rr * 0.4;
        float da = abs(mod(a - ac + 3.14159265, 6.2831853) - 3.14159265) * r;
        float dr = max(0.0, abs(r - rr) - len);
        float d = length(vec2(da, dr));
        float w = 0.0025 + 0.004 * (1.0 - z);
        vec3 tint = mix(C_CYAN, C_PINK, hash11(ai + 91.0 * fl));
        col += tint * smoothstep(w, 0.0, d) * (1.2 - z) * 2.2 * step(0.35, h);
      }
      return col;
    }
    vec3 plate(vec2 p) {
      float birth = smoothstep(0.0, 3.5, uLt);                 // the star swells in over the intro
      float speed = mix(2.8, 0.8, birth) + 1.5 * uKick;
      vec3 col = C_INK * 0.6 + C_VIOLET * 0.04 * (1.0 - length(p) * 0.5);
      col += warp(p, speed) * (1.0 - 0.6 * birth + 0.4 * uKick);
      // the star: hot core, turbulent corona, lens halo
      float r = length(p);
      float R = 0.16 * birth * (1.0 + 0.12 * uKick + 0.04 * sin(uT * 2.0));
      float n = fbm(vec3(p * 5.0, uT * 0.4), 4);
      float core = smoothstep(R, R * 0.2, r);
      float corona = exp(-max(r - R, 0.0) * (9.0 - 4.0 * uKick)) * (0.7 + 0.5 * n) * birth;
      col += C_GOLD * core * 9.0 + mix(C_EMBER, C_PINK, 0.3 + 0.3 * sin(uT)) * corona * 2.2;
      col += C_BONE * smoothstep(R * 0.55, 0.0, r) * 14.0 * birth;
      // collector satellites: bright dots on tilted orbits, appearing one by one
      for (int i = 0; i < 14; i++) {
        float fi = float(i);
        float on = smoothstep(4.0 + fi * 1.1, 4.6 + fi * 1.1, uLt);
        float rad = 0.28 + 0.05 * fi;
        float ph = uT * (0.9 - fi * 0.04) + fi * 2.1;
        float tilt = 0.35 + 0.15 * sin(fi * 1.7);
        vec2 q = vec2(cos(ph) * rad, sin(ph) * rad * tilt);
        q = rot2(fi * 0.7) * q;
        float front = step(0.0, sin(ph)) * 0.6 + 0.4;
        float d = length(p - q);
        col += mix(C_CYAN, C_GOLD, fract(fi * 0.37)) * (smoothstep(0.012, 0.0, d) * 6.0 + exp(-d * 60.0) * 0.8) * on * front;
        // faint orbit trace
        vec2 pr = rot2(-fi * 0.7) * p;
        float e = abs(length(vec2(pr.x, pr.y / tilt)) - rad);
        col += C_VIOLET * smoothstep(0.004, 0.0, e) * 0.25 * on;
      }
      return col;
    }`;
  }

  protected override frame(f: Frame) {
    // open from black, a white burst when the voice comes in
    const fade = 1 - prog(f.lt, 0, 1.2, ease.outCubic);
    return { fade, exposure: 1.0, bloom: 0.8, vignette: 0.45 };
  }
}
