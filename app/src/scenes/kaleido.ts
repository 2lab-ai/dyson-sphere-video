// Plate 9 — KALEIDO. Drop 2, the completed sphere as pure euphoria: a folded (KIFS) lattice of orbital
// rings, collector panels and stars, mirrored into a kaleidoscope whose segment count jumps on every
// downbeat, pumped down an endless zoom tunnel on the kicks. Backbeats throw confetti, the last 8 bars
// strobe on the 16ths, and once every 8 bars the frame freezes for one beat into a pixel mosaic.
import { ShaderScene } from './_shader';
import type { Frame } from '../engine/scene';

export default class Kaleido extends ShaderScene {
  protected glsl() {
    return /* glsl */ `
    // shadow clock: everything reads these, so the mosaic beat can freeze the whole plate
    float T, K, S, H, BAR, BEAT, LATE;
    const float BARLEN = 240.0 / 102.97;

    // rainbow sweep that stays inside the shared neon palette
    vec3 pal(float x) {
      vec3 cs[6] = vec3[6](C_PINK, C_VIOLET, C_CYAN, C_LIME, C_GOLD, C_EMBER);
      x = fract(x) * 6.0;
      int i = int(floor(x));
      float f = smoothstep(0.0, 1.0, fract(x));
      return mix(cs[i], cs[(i + 1) % 6], f);
    }

    // one layer of the folded sphere lattice; q in plate units, px = pixel size in q units
    vec3 lattice(vec2 q, float px, float hueBase) {
      vec3 col = vec3(0.0);
      vec2 z = q;
      float sc = 1.0;
      vec2 off = vec2(0.62 + 0.12 * sin(T * 0.37), 0.30 + 0.10 * cos(T * 0.29 + LATE * T * 0.4));
      float ang = 0.45 + 0.25 * sin(T * 0.21) + LATE * 0.35 * sin(T * 0.9);
      for (int i = 0; i < 5; i++) {
        float fi = float(i);
        z = abs(z) - off;
        z = rot2(ang + fi * 0.13) * z;
        z *= 1.55;
        sc *= 1.55;
        vec3 hue = pal(hueBase + fi * 0.16);
        float w = px * 1.7 * sc;              // line half-width in z units (constant in pixels)
        // orbital ring
        float dr = abs(length(z) - 0.55);
        // collector panel outline
        float db = sdBox(z - vec2(0.35, 0.0), vec2(0.16, 0.07));
        float dp = abs(db);
        float fill = smoothstep(w, -w, db) * 0.22;
        // spar line
        float dl = max(abs(z.y), abs(z.x) - 0.9);
        float ring = smoothstep(w * 1.6, w * 0.4, dr) * 1.6 + exp(-dr / sc * 90.0) * 0.10;
        float panel = smoothstep(w * 1.4, w * 0.3, dp) * 1.2 + exp(-dp / sc * 120.0) * 0.06;
        float spar = smoothstep(w, w * 0.2, dl) * 0.6;
        // panels light up in a wave running through the lattice depth
        float lit = 0.35 + 0.65 * smoothstep(0.6, 1.0, sin(T * 3.0 - fi * 1.1 + BEAT * 1.5708));
        float keep = step(0.5, hash11(fi * 7.1 + floor(BAR) * 3.3 + hueBase * 0.0)) * 0.7 + 0.3; // some fold levels go quiet each bar
        col += (hue * (ring + spar * 0.5) + mix(hue, C_BONE, 0.35) * panel * lit + hue * fill * lit) * keep * (1.0 - fi * 0.12);
        // stars at the fold nodes
        float ds = length(z - vec2(0.55, 0.0)) / sc;
        col += mix(C_BONE, hue, 0.5) * (smoothstep(px * 2.5, 0.0, ds) * 3.0 + exp(-ds * 160.0) * 0.12) * step(2.0, fi);
      }
      return col;
    }

    vec3 confetti(vec2 p) {
      // bursts on the backbeats (beats 2 and 4 of the grid), age = phase through that beat
      float bib = floor(fract(BAR) * 4.0 + 1e-3);
      float back = mod(bib, 2.0);
      float age = fract(BEAT);
      float amp = mix(back, 1.0, LATE * 0.7) * (0.6 + 0.4 * S) * (1.0 - smoothstep(0.55, 1.0, age));
      if (amp < 0.01) return vec3(0.0);
      float seed = floor(BEAT);
      vec3 col = vec3(0.0);
      for (int i = 0; i < 44; i++) {
        float fi = float(i);
        vec2 h = hash22(vec2(fi, seed * 1.37));
        float h3 = hash12(vec2(seed, fi * 2.1));
        float a = h.x * 6.2831853;
        float spd = 0.6 + 1.9 * h.y;
        float dist = spd * (1.0 - exp(-age * 4.0)) * 0.9;
        vec2 c = vec2(cos(a), sin(a)) * dist + vec2(0.0, -0.25 * age * age);
        vec2 d = rot2(age * (6.0 + 10.0 * h3) + fi) * (p - c);
        float sz = 0.015 + 0.018 * h3;
        float r = sdBox(d, vec2(sz, sz * 0.45));
        col += pal(h3 + T * 0.1) * smoothstep(0.004, 0.0, r) * 2.2;
      }
      return col * amp;
    }

    vec3 plate(vec2 p) {
      T = uT; K = uKick; S = uSnare; H = uHat; BAR = uBar; BEAT = uBeat;
      LATE = smoothstep(0.42, 0.58, uP);
      // pixel-mosaic freeze: beat 3 of every 8th bar (the beat before the global bar-4 invert)
      float bi = floor(uBar), bp = fract(uBar);
      float freeze = (mod(bi, 8.0) == 7.0 && bp >= 0.5 && bp < 0.75) ? 1.0 : 0.0;
      vec2 p0 = p;
      if (freeze > 0.5) {
        T = uT - (bp - 0.5) * BARLEN;
        BAR = bi + 0.5; BEAT = floor(uBeat + 1e-3);
        K = 0.8; S = 0.0; H = 0.0;
        float cell = 0.055;
        p = (floor(p / cell) + 0.5) * cell;
      }

      // segment count jumps every downbeat
      int segs[8] = int[8](6, 8, 12, 5, 10, 7, 16, 9);
      float N = float(segs[int(mod(floor(BAR), 8.0))]);

      float r = length(p);
      float a = atan(p.y, p.x) + T * (0.08 + 0.35 * LATE) + 0.15 * sin(T * 0.7);
      float seg = 6.2831853 / N;
      a = mod(a, seg);
      a = abs(a - seg * 0.5);
      vec2 q = r * vec2(cos(a), sin(a));

      // endless zoom: three self-similar layers cross-fading, pumped on each kick
      float px = 2.0 / uRes.y;
      float speed = 0.22 + 0.33 * LATE;
      float zph = T * speed + 0.10 * K;
      vec3 col = C_INK * 0.7 + C_VIOLET * 0.035 * (1.0 - r * 0.4);
      float hueBase = T * 0.09 + r * 0.25 + floor(BAR) * 0.137;
      for (int L = 0; L < 3; L++) {
        float ph = fract(zph + float(L) / 3.0);
        float s = exp2(1.5 - 3.0 * ph);        // layer scales 2.8 -> 0.35 as it rushes toward the viewer
        float wgt = sin(ph * 3.14159265);
        wgt *= wgt;
        col += lattice(q * s, px * s, hueBase + float(L) * 0.33) * wgt * 0.75;
      }

      col *= 0.45 + 0.55 * smoothstep(0.0, 0.45, r);  // the folds pile up in the middle: thin it out
      // the star at the heart of the sphere
      float coreR = 0.05 + 0.03 * K;
      col += C_GOLD * exp(-r / coreR) * 2.2 + C_BONE * smoothstep(coreR * 0.6, 0.0, r) * 5.0;
      col += pal(hueBase + 0.3) * exp(-abs(r - (0.12 + 0.5 * fract(zph))) * 60.0) * 0.25 * K;

      // keep dark negative space: tame the very middle and the mean
      col *= 0.85 + 0.25 * uRms;
      col += confetti(p);

      // hat strobe on 16ths through the last 8 bars: a darkening gate, never white
      // the global FX inverts the last beat of every 4th bar: hold the strobe open and push the lines
      // there, so the invert reads as dark neon on bone instead of a blank sheet
      float invBeat = (mod(bi, 4.0) == 3.0 && bp >= 0.75) ? 1.0 : 0.0;
      float strobeOn = step(8.0 * BARLEN, uLt) * (1.0 - freeze);
      strobeOn *= 1.0 - invBeat;
      col *= 1.0 + 0.8 * invBeat;
      float gate = step(0.5, fract(BEAT * 4.0));
      col *= mix(1.0, mix(0.22, 1.25, gate) * (0.8 + 0.4 * H), strobeOn);

      if (freeze > 0.5) {
        // mosaic cells get a thin dark grout so the freeze reads as pixels
        vec2 g = abs(fract(p0 / 0.055) - 0.5);
        col *= 0.6 + 0.4 * smoothstep(0.5, 0.42, max(g.x, g.y));
        col = pow(col, vec3(0.9)) * 1.1;
      }
      return col;
    }`;
  }

  protected override frame(f: Frame) {
    // full-strength peak: the global beat FX ride on top, we just keep bloom tight so lines stay lines
    const last8 = f.lt > 8 * (240 / 102.97) ? 1 : 0;
    return { exposure: 1.0, bloom: 0.75 + 0.15 * last8, bloomThreshold: 1.0, vignette: 0.4, ca: 1.5 + 1.0 * last8 };
  }
}
