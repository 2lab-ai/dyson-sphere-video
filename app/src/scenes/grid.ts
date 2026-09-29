// Plate 2 — GRID. Synthwave perfect: an infinite neon floor races at the camera (surging on every beat),
// a banded retro sun sits on the horizon half-caged by glowing ring segments (the first Dyson swarm), and
// behind it a silent tsunami of cyan/pink scanlines rises and curls over the window. Colours swap each bar.
import { ShaderScene } from './_shader';
import type { Frame } from '../engine/scene';

export default class Grid extends ShaderScene {
  protected glsl() {
    return /* glsl */ `
    const float HZ = 0.02;            // horizon height
    const vec2 SUN = vec2(0.0, 0.34); // sun centre
    const float SR = 0.44;            // sun radius

    // bar-swapped neon pair (a = primary, b = secondary)
    vec3 neonA() { float s = mod(floor(uBar), 2.0); return mix(C_PINK, C_CYAN, s); }
    vec3 neonB() { float s = mod(floor(uBar), 2.0); return mix(C_CYAN, C_PINK, s); }
    float beatPulse() { return exp(-uBeatPh * 5.0); }

    // the rising wave body: tall on the left, tapering right, capped below the top of frame
    float waveTop(float x, float grow) {
      float lean = smoothstep(1.9, -1.2, x);
      float sw = 0.05 * sin(x * 2.3 - uT * 0.9) + 0.025 * sin(x * 5.1 + uT * 1.7);
      return HZ + grow * (0.10 + 0.58 * lean) + sw * (0.3 + 0.7 * grow);
    }
    float thinLines(float u) { float f = fract(u); return smoothstep(0.16, 0.0, min(f, 1.0 - f)); }

    vec3 sky(vec2 p) {
      float grow = smoothstep(0.0, 1.0, uP) * 0.85 + 0.15;
      vec3 col = mix(C_VIOLET * 0.12, C_INK * 0.5, sat((p.y - HZ) * 1.2));
      col += C_PINK * 0.10 * exp(-(p.y - HZ) * 5.0);
      // stars
      vec2 g = p * 60.0; vec2 id = floor(g); vec2 f = fract(g) - 0.5;
      float h = hash12(id);
      vec2 o = (hash22(id + 7.0) - 0.5) * 0.6;
      float tw = 0.5 + 0.5 * sin(uT * (2.0 + h * 5.0) + h * 40.0);
      col += mix(C_BONE, C_CYAN, h) * smoothstep(0.09, 0.0, length(f - o)) * step(0.9, h) * (0.6 + 1.6 * tw) * sat((p.y - HZ) * 3.0);

      float hit = 0.55 + 0.7 * beatPulse() + 0.8 * uKick;
      float inW = p.y - HZ;
      // ---- wave body: scanline wall behind the sun ----
      float top = waveTop(p.x, grow);
      float below = top - p.y;
      if (below > -0.2 && inW > 0.0) {
        float body = smoothstep(0.0, 0.015, below);
        float face = body * (0.35 + 0.65 * smoothstep(0.0, 1.0, inW / max(top - HZ, 0.05)));
        vec3 tint = mix(neonB(), neonA(), sat(inW * 2.0 + 0.2 * sin(p.x * 2.0 + uT)));
        col = mix(col, C_INK * 0.25 + tint * 0.07, body * 0.85);
        col += tint * thinLines(inW * 42.0 - uT * 1.6) * face * hit * 1.4;
        float crest = exp(-abs(below) * 70.0);
        col += mix(C_BONE, neonA(), 0.45) * crest * (1.0 + 1.2 * uKick);
        col += neonA() * exp(-max(-below, 0.0) * 12.0) * step(below, 0.0) * 0.25;
      }
      // ---- the curling lip: a thick partial ring hanging off the left crest toward the sun ----
      float px = -0.95;
      float peak = waveTop(px, grow);
      float RL = 0.06 + 0.30 * grow;
      vec2 L = vec2(px + RL * 0.75, peak - RL * 0.8);
      vec2 q = p - L;
      float r = length(q);
      float ang = atan(q.y, q.x);                 // pi = left (joins crest), pi/2 = top, 0 = right
      float th = RL * mix(0.12, 0.5, sat((ang + 0.6 * PI) / (1.6 * PI)));
      // arc visible from the left over the top and down the right side (to about -0.55 pi)
      float arc = smoothstep(-0.62 * PI, -0.40 * PI, ang) * (1.0 - step(0.97 * PI, ang));
      float ring = smoothstep(th, th - 0.012, abs(r - RL)) * arc;
      if (ring > 0.0) {
        float rr = (r - RL) / th;                 // -1 inner .. 1 outer
        vec3 tint = mix(neonA(), neonB(), sat(0.5 - 0.5 * rr));
        col = mix(col, C_INK * 0.2, ring * 0.9);
        // scanlines follow the curl (concentric) and stream along it
        float sl = thinLines(rr * 5.0 + 0.5) * (0.6 + 0.4 * sin(ang * 14.0 - uT * 6.0));
        col += tint * sl * ring * hit * 1.3;
        col += mix(C_BONE, neonA(), 0.3) * exp(-abs(r - RL - th) * 90.0) * arc * 1.2;
      }
      // spray at the falling tip
      vec2 tip = L + RL * vec2(cos(-0.55 * PI), sin(-0.55 * PI));
      col += neonB() * exp(-length(p - tip) * 22.0) * 0.6 * grow * (0.6 + uKick);
      return col;
    }

    vec3 sun(vec2 p, vec3 col) {
      vec2 q = p - SUN;
      float r = length(q);
      float R = SR * (1.0 + 0.03 * uKick);
      // corona
      col += mix(C_PINK, C_GOLD, 0.4) * exp(-max(r - R, 0.0) * 6.0) * (0.35 + 0.25 * uLow);
      if (r < R) {
        float v = sat((q.y + R) / (2.0 * R));      // 0 bottom .. 1 top
        vec3 disc = mix(C_PINK * 1.1, C_GOLD * 1.25, smoothstep(0.05, 0.95, v));
        disc = mix(disc, mix(C_GOLD, C_BONE, 0.5) * 1.4, smoothstep(0.8, 1.0, v) * 0.6);
        // horizontal cut bands in the lower 70%, thickening downward, scrolling down
        float y = (0.7 - v) / 0.7;
        float bands = fract(v * 12.0 + uT * 0.35);
        float gap = mix(0.08, 0.6, sat(y));
        float cut = step(0.0, y) * step(bands, gap);
        disc *= 1.0 - cut;
        col = mix(col, disc, aaFill(r - R) * (1.0 - cut));
      }
      return col;
    }

    // ring segments around the sun: tilted ellipses, broken into arcs; back half occluded by the disc
    vec3 rings(vec2 p, vec3 col, bool front) {
      vec2 q = p - SUN;
      for (int i = 0; i < 4; i++) {
        float fi = float(i);
        float tilt = 0.18 + 0.07 * fi;
        float rot = -0.25 + 0.17 * fi + 0.05 * sin(uT * 0.3 + fi);
        vec2 e = rot2(rot) * q;
        float rad = SR * (1.28 + 0.16 * fi);
        vec2 u = vec2(e.x, e.y / tilt);
        float d = abs(length(u) - rad) * tilt;
        float a = atan(u.y, u.x);
        bool isFront = u.y < 0.0;
        if (isFront != front) continue;
        // segments: gaps rotate around
        float segs = 9.0 + 3.0 * fi;
        float sa = fract((a / TAU) * segs - uT * (0.25 + 0.08 * fi) * (mod(fi, 2.0) * 2.0 - 1.0));
        float seg = smoothstep(0.0, 0.04, sa) * smoothstep(0.78, 0.7, sa);
        // coverage grows through the scene: the swarm is still being built
        float built = step(hash11(floor((a / TAU) * segs + 50.0 * fi)), 0.35 + 0.6 * uP);
        vec3 c = mix(neonB(), C_GOLD, 0.25 * fi / 3.0);
        float w = 0.004 + 0.002 * fi;
        col += c * (smoothstep(w, 0.0, d) * 3.0 + exp(-d * 90.0) * 0.6) * seg * built * (0.7 + 0.8 * beatPulse());
      }
      return col;
    }

    // wireframe mountain silhouettes on the horizon
    float mtnH(float x, float fl) {
      float h = 0.0;
      h += 0.16 * abs(sin(x * 1.7 + fl * 2.3));
      h += 0.08 * abs(sin(x * 4.3 + fl * 5.1));
      h += 0.04 * snoise(vec2(x * 6.0, fl * 3.0));
      float side = smoothstep(0.35, 1.3, abs(x)); // keep the sun's centre clear
      return h * (0.25 + 0.95 * side) * (1.0 - 0.3 * fl);
    }
    vec3 mountains(vec2 p, vec3 col) {
      for (int L = 1; L >= 0; L--) {
        float fl = float(L);
        float px = p.x * (1.0 + 0.3 * fl) + fl * 3.0;
        float h = HZ + mtnH(px, fl);
        float y = p.y - HZ;
        if (p.y < h && y > 0.0) {
          col = C_INK * 0.35 + C_VIOLET * 0.08 * (1.0 - fl * 0.5);
          // wireframe: vertical-ish ribs and horizontal contours
          float t = y / max(h - HZ, 1e-3);
          float cx = abs(fract(px * 9.0) - 0.5);
          float cy = abs(fract(t * 5.0) - 0.5);
          float dg = abs(fract(px * 9.0 + t * 1.3) - 0.5);
          float wire = max(max(smoothstep(0.07, 0.0, cx), smoothstep(0.07, 0.0, cy)), smoothstep(0.06, 0.0, dg));
          col += C_VIOLET * wire * (0.7 + 0.5 * beatPulse()) * (1.2 - 0.4 * fl);
        }
        // glowing ridge
        float dr = abs(p.y - h);
        col += mix(C_VIOLET, neonA(), 0.35) * exp(-dr * 220.0) * 1.6 * step(HZ, p.y);
      }
      return col;
    }

    vec3 floorGrid(vec2 p) {
      float d = HZ - p.y;                      // >0 below horizon
      float z = 0.35 / d;                      // depth
      // travel: a surge at the start of every beat, plus kick boost
      float bp = fract(uBeat);
      float travel = uT * 2.0 + (floor(uBeat) + (1.0 - pow(1.0 - bp, 3.0))) * 1.6 + 0.4 * uKick;
      float wx = p.x * z * 5.0;
      float wz = z * 5.0 + travel;
      vec2 g = vec2(wx, wz);
      vec2 fw = fwidth(g);
      vec2 gd = abs(fract(g) - 0.5);
      float lx = pxLine(gd.x / max(fw.x, 1e-4), 0.0, 1.5) ;
      float lz = pxLine(gd.y / max(fw.y, 1e-4), 0.0, 1.5);
      // the lines fade as they get too dense in the distance
      float fadeX = sat(1.0 - fw.x * 2.5), fadeZ = sat(1.0 - fw.y * 2.5);
      float lines = max(lx * fadeX, lz * fadeZ);
      float glow = max(exp(-gd.x / max(fw.x, 1e-4) * 0.25) * fadeX, exp(-gd.y / max(fw.y, 1e-4) * 0.25) * fadeZ);
      float pulse = 0.55 + 1.3 * beatPulse() + 0.7 * uKick;
      // lines closer to the horizon pick up the secondary colour
      vec3 lc = mix(neonA(), neonB(), smoothstep(0.6, 0.0, d) * 0.6);
      vec3 col = C_INK * 0.25 + C_VIOLET * 0.05;
      // sun reflection on the floor
      col += mix(C_PINK, C_GOLD, 0.3) * exp(-abs(p.x) * 4.0) * exp(-d * 6.0) * 0.35;
      // darken the karaoke text zone (lyrics sit ~80% down: p.y ~ -0.6)
      float zone = 1.0 - 0.6 * exp(-pow((p.y + 0.6) / 0.14, 2.0)) * smoothstep(1.4, 0.4, abs(p.x));
      col += lc * (lines * 1.2 + glow * 0.12) * pulse * zone;
      // horizon haze
      col += neonA() * exp(-d * 30.0) * 0.6;
      return col;
    }

    vec3 plate(vec2 p) {
      vec3 col;
      if (p.y < HZ) {
        col = floorGrid(p);
      } else {
        col = sky(p);
        col = rings(p, col, false);
        col = sun(p, col);
        col = rings(p, col, true);
        col = mountains(p, col);
      }
      // horizon line
      col += C_BONE * exp(-abs(p.y - HZ) * 400.0) * (0.8 + 0.8 * beatPulse());
      return col;
    }`;
  }

  protected override frame(_f: Frame) {
    return { exposure: 1.0, bloom: 0.9, vignette: 0.4 };
  }
}
