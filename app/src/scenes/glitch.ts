// Plate — GLITCH (bridge). VIRTUAL vs REAL: a soft-focus night city on one side of a wobbling seam, its
// neon wireframe/voxel digital twin on the other. Kicks swap the halves for a beat, snares fire pixel-sort
// streaks and scanline slips, and over the section the seam shatters into datamosh blocks until the two
// worlds are interleaved as checkerboard shards.
import { ShaderScene } from './_shader';
import type { Frame } from '../engine/scene';

export default class Glitch extends ShaderScene {
  protected glsl() {
    return /* glsl */ `
    const float HOR = -0.28;          // horizon line
    const float COLW = 0.11;          // building column width

    // shared skyline: both worlds are built on the same buildings (the twin is a twin)
    float bldH(float ci) {
      float h = hash11(ci * 7.13 + 3.0);
      return 0.12 + 0.55 * h * h + 0.25 * step(0.86, hash11(ci * 1.91));
    }

    // ---- REAL: soft-focus night city under stars ----
    vec3 realW(vec2 q) {
      float sky = sat((q.y - HOR) * 0.8);
      vec3 col = mix(C_VIOLET * 0.22 + C_EMBER * 0.10, C_INK2 * 0.5, sky);
      // stars, gently twinkling
      vec2 sg = q * 28.0; vec2 si = floor(sg); vec2 sf = fract(sg) - 0.5;
      float sh = hash12(si);
      vec2 so = (hash22(si + 4.0) - 0.5) * 0.6;
      float sd = length(sf - so);
      col += C_BONE * exp(-sd * sd * 90.0) * step(0.82, sh) * (0.5 + 0.5 * sin(uT * 3.0 + sh * 40.0)) * 1.1 * step(HOR + 0.15, q.y);
      // skyline silhouette with warm windows, slow parallax
      float x = q.x + uT * 0.02;
      float ci = floor(x / COLW);
      float h = bldH(ci);
      float top = HOR + h;
      float inB = smoothstep(0.012, -0.012, q.y - top);
      vec2 w = vec2(fract(x / COLW) * 5.0, (q.y - HOR) * 38.0);
      vec2 wi = floor(w); vec2 wf = fract(w) - 0.5;
      float lit = step(0.55, hash12(wi + ci * 31.0 + floor(uT * 0.3 + hash11(ci)) * 0.0));
      float win = exp(-dot(wf, wf) * 9.0) * lit * step(HOR, q.y);
      vec3 wc = mix(C_GOLD, C_EMBER, hash12(wi + ci));
      col = mix(col, C_INK * 0.7 + wc * win * 0.9, inB);
      // haze at the horizon
      col += mix(C_EMBER, C_PINK, 0.4) * exp(-abs(q.y - HOR) * 7.0) * 0.35;
      // street below: dark, reflective
      if (q.y < HOR) col = C_INK * 0.6 + mix(C_EMBER, C_GOLD, 0.5) * exp((q.y - HOR) * 9.0) * 0.25;
      // bokeh discs drifting in front, big and blurred
      for (int L = 0; L < 2; L++) {
        float fl = float(L);
        float sc = 3.0 + 2.0 * fl;
        vec2 bg = q * sc + vec2(uT * (0.08 + 0.05 * fl), fl * 3.1);
        vec2 bi = floor(bg); vec2 bf = fract(bg) - 0.5;
        float bh = hash12(bi + fl * 17.0);
        vec2 bo = (hash22(bi + 9.0) - 0.5) * 0.5;
        float r = 0.18 + 0.2 * hash12(bi + 2.0);
        float d = length(bf - bo);
        vec3 bc = bh < 0.33 ? C_GOLD : bh < 0.66 ? C_PINK : C_CYAN;
        col += bc * smoothstep(r, r * 0.55, d) * step(0.55, bh * 1.7 - 0.2 * fl) * 0.22;
      }
      return col;
    }

    // ---- VIRTUAL: neon wireframe / voxel twin ----
    vec3 twinW(vec2 q) {
      // voxelise the coordinates
      vec2 v = (floor(q * 72.0) + 0.5) / 72.0;
      vec3 col = C_INK * 0.35 + C_VIOLET * 0.05;
      // voxel stars
      vec2 si = floor(q * 28.0);
      float sh = hash12(si);
      vec2 sv = abs(fract(q * 28.0) - 0.5);
      col += C_CYAN * step(max(sv.x, sv.y), 0.12) * step(0.86, sh) * 0.9 * step(HOR + 0.15, q.y);
      // perspective grid floor
      if (q.y < HOR) {
        float z = 0.35 / max(HOR - q.y, 0.004);
        vec2 g = vec2(q.x * z, z + uT * 1.6);
        vec2 gf = abs(fract(g) - 0.5);
        vec2 gw = fwidth(g);
        float ln = max(smoothstep(0.5 - 1.5 * gw.x, 0.5, gf.x + 0.02), smoothstep(0.5 - 1.5 * gw.y, 0.5, gf.y + 0.02));
        ln *= sat(1.0 / (1.0 + 4.0 * max(gw.x, gw.y)));   // fade where the grid aliases at the horizon
        col += mix(C_PINK, C_CYAN, sat(1.0 / z)) * ln * exp(-z * 0.12) * 1.2;
      }
      // twin skyline: wireframe outlines + voxel windows
      float x = q.x + uT * 0.02;
      float ci = floor(x / COLW);
      float h = bldH(ci);
      float top = HOR + h;
      float fx = fract(x / COLW);
      float inB = step(q.y, top) * step(HOR, q.y);
      float ex = min(fx, 1.0 - fx) * COLW;
      float ey = abs(q.y - top);
      float edge = inB * (1.0 - smoothstep(0.0, 0.0045, ex)) + step(HOR, q.y) * (1.0 - smoothstep(0.0, 0.0045, ey)) * step(0.0, top - q.y + 0.004) * step(0.03, fx) * step(fx, 0.97);
      vec3 ec = mix(C_CYAN, C_PINK, step(0.5, hash11(ci * 3.3)));
      col += ec * edge * 2.2;
      // voxel windows light up in scanning waves
      vec2 w = vec2(fx * 5.0, (v.y - HOR) * 38.0);
      vec2 wi = floor(w);
      vec2 wf = abs(fract(w) - 0.5);
      float wave = sat(1.0 - abs(fract((q.y - HOR) * 1.2 - uT * 0.8 + hash11(ci) ) - 0.5) * 6.0);
      float lit = step(0.5, hash12(wi + ci * 31.0 + floor(uBeat) * 0.0));
      col += mix(C_CYAN, C_LIME, hash12(wi + ci)) * step(max(wf.x, wf.y), 0.28) * lit * inB * (0.25 + 1.2 * wave);
      // inner diagonal wire (wireframe box face)
      float diag = abs(fx * COLW - (top - q.y) * COLW / max(h, 0.01));
      col += ec * inB * (1.0 - smoothstep(0.0, 0.003, diag)) * 0.6;
      // sweeping scan line
      float scan = exp(-abs(q.y - (fract(uT * 0.35) * 1.6 - 0.8)) * 60.0);
      col += C_LIME * scan * 0.5;
      return col;
    }

    vec3 world(vec2 q, float side) { return side < 0.5 ? realW(q) : twinW(q); }

    vec3 plate(vec2 p) {
      float P = uP;
      float bt = floor(uBeat);
      vec2 q = p;

      // --- which world owns this pixel ---
      // wobbling seam, more violent as the section progresses and on snares
      float seam = 0.04 * sin(p.y * 5.0 + uT * 2.3) + (0.03 + 0.12 * P) * snoise(vec2(p.y * 3.0, uT * 1.5))
                 + 0.08 * uSnare * sin(p.y * 23.0 + uT * 9.0);
      float side = step(seam, p.x);
      // halves swap every other beat (on the kick)
      float swapB = mod(bt, 2.0);
      side = abs(side - swapB);

      // shatter: torn blocks at two scales steal from the other world
      float torn = 0.0;
      vec2 bSz = vec2(0.34, 0.19);
      vec2 b1 = floor(p / bSz);
      float h1 = hash12(b1 + vec2(bt * 1.37, 0.0));
      float t1 = step(h1, 0.05 + 0.55 * P + 0.25 * uSnare);
      vec2 b2 = floor(p / (bSz * 0.37));
      float h2 = hash12(b2 * 1.7 + vec2(0.0, floor(uBeat * 2.0) * 3.1));
      float t2 = step(h2, 0.02 + 0.35 * P * P + 0.2 * uSnare);
      // blocks near the seam tear first
      float nearSeam = exp(-abs(p.x - seam) * (3.5 - 2.5 * P));
      t1 *= step(hash12(b1 + 11.0), nearSeam + P);
      if (t1 + t2 > 0.5) {
        side = 1.0 - side;
        torn = 1.0;
        vec2 bid = t2 > 0.5 ? b2 : b1;
        // datamosh displacement: the block samples from a stale offset
        vec2 off = (hash22(bid + bt) - 0.5) * vec2(0.5, 0.12) * (0.4 + P + uKick * 0.6);
        q += off;
      }

      // late in the section: interleaved checkerboard shards take over
      float chk = smoothstep(0.62, 0.95, P);
      vec2 cq = rot2(0.12 * sin(uT * 0.5)) * p * (3.2 + 0.8 * chk);
      cq.x += 0.25 * step(0.5, fract(floor(cq.y) * 0.5)) + 0.15 * sin(uT + floor(cq.y));
      vec2 cc = floor(cq);
      float checker = mod(cc.x + cc.y + swapB, 2.0);
      float useChk = step(hash12(cc + 5.0), chk);
      side = mix(side, checker, useChk);
      vec2 cf = abs(fract(cq) - 0.5);
      float shardEdge = useChk * smoothstep(0.455, 0.49, max(cf.x, cf.y));

      // scanline slips
      float row = floor(p.y * 64.0);
      float hs = hash12(vec2(row, floor(uT * 14.0)));
      if (hs < 0.03 + 0.18 * P + 0.3 * uSnare) q.x += (hash12(vec2(row, 7.0 + bt)) - 0.5) * (0.12 + 0.3 * P);

      // pixel-sort streaks on snares: pixels past the sort point smear along x
      float srow = floor(p.y * 90.0);
      float sHit = step(hash12(vec2(srow, bt * 3.7)), 0.12 + 0.55 * uSnare) * step(0.08, uSnare + 0.15 * P);
      float sStart = (hash12(vec2(srow, bt + 1.0)) - 0.5) * 3.0;
      float sorted = sHit * step(sStart, q.x);
      if (sorted > 0.5) q.x = sStart + (q.x - sStart) * 0.04;

      // RGB channel offset, stronger on torn/sorted pixels
      float ca = 0.004 + 0.02 * (torn + sorted) * (0.5 + P) + 0.012 * uSnare;
      vec3 c0 = world(q, side);
      vec3 c1 = world(q + vec2(ca, 0.0), side);
      vec3 col = vec3(c1.r, c0.g, mix(c0.b, c1.b, 0.3));
      if (sorted > 0.5) col *= 0.9 + 0.6 * sat((q.x - sStart) * 25.0);

      // datamosh blocks posterise a bit and get a tint
      if (torn > 0.5) {
        float bh = hash12(floor(p / vec2(0.34, 0.19)) + bt * 0.73);
        col = floor(col * 6.0 + 0.5) / 6.0;
        col = bh < 0.35 ? col.brg : bh < 0.6 ? col.gbr : col;   // channel-swapped mosh
        col = mix(vec3(luma(col)), col, 1.5) * 1.25;              // saturated, not grey
      }

      // the seam itself: a hot split line (dimmer behind the slam word)
      float centreDim = mix(0.35, 1.0, smoothstep(0.1, 0.45, abs(p.y)));
      float sLine = exp(-abs(p.x - seam) * 90.0) * (1.0 - chk);
      col += mix(C_CYAN, C_PINK, swapB) * sLine * (1.2 + 2.0 * uKick) * centreDim;
      // shard edges
      col += mix(C_PINK, C_LIME, checker) * shardEdge * 0.9 * centreDim;

      // keep the centre darker so the white slam word pops
      float cd = length(p * vec2(0.55, 1.1));
      col *= mix(0.42, 1.0, smoothstep(0.05, 0.75, cd));
      col *= 0.9 + 0.25 * uLow;
      return col;
    }`;
  }

  protected override frame(_f: Frame) {
    return { exposure: 1.05, bloom: 0.75, bloomThreshold: 0.9, vignette: 0.4 };
  }
}
