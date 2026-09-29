// Plate 6 — THE AI EYE (verse 2). A gigantic mechanical iris stares out of the frame: concentric rings of
// aperture blades, hex cells, tick marks and circuit traces all turning at their own speeds; the pupil is a
// black hole with one tiny star (the bright future) glittering inside. The blades snap shut on every kick
// and breathe open between; the snare flips the iris colours. Steel-hand silhouettes sweep the frame on
// every bar line, and the Dyson swarm orbits in the cornea highlight.
import { ShaderScene } from './_shader';
import type { Frame } from '../engine/scene';
import { prog, ease } from '../engine/util';

export default class Eye extends ShaderScene {
  protected glsl() {
    return /* glsl */ `
    const vec2 EYE_C = vec2(0.0, 0.12);
    const float AAE = 0.0025;

    // angular segment mask on the ring r0..r1: n segments, duty = filled fraction, rot = rotation (rad)
    float segRing(float r, float a, float r0, float r1, float n, float duty, float rot) {
      float band = smoothstep(r0 - AAE, r0, r) * smoothstep(r1 + AAE, r1, r);
      float f = fract((a + rot) / TAU * n);
      float d = (abs(f - 0.5) - 0.5 * duty) * (TAU * r / n);
      return band * smoothstep(AAE, -AAE, d);
    }
    float ringLine(float r, float r0, float w) { return smoothstep(w + AAE, w, abs(r - r0)); }

    // iris palette: cyan/violet, the snare flips it toward pink/gold
    vec3 irisCol(float k, float shift) {
      vec3 a = mix(C_CYAN, C_VIOLET, k);
      vec3 b = mix(C_PINK, C_GOLD, k);
      return mix(a, b, shift);
    }

    // one robotic steel hand: a palm plate plus four jointed fingers, in local coords (x along the fingers)
    float handSdf(vec2 h) {
      float d = sdBox(h - vec2(-0.55, 0.0), vec2(0.45, 0.36)) - 0.04;
      for (int i = 0; i < 4; i++) {
        float fi = float(i);
        float y = -0.27 + fi * 0.18;
        float len = 0.62 + 0.14 * sin(fi * 1.9 + 0.6);
        float bend = 0.10 * (fi - 1.5);
        vec2 a0 = vec2(-0.1, y);
        vec2 a1 = a0 + vec2(len * 0.5, bend * 0.5);
        vec2 a2 = a1 + vec2(len * 0.5, bend);
        // segmented phalanges: two capsules with a gap at the knuckle
        float s1 = sdSegment(h, a0, a1 - vec2(0.02, 0.0)) - 0.055;
        float s2 = sdSegment(h, a1 + vec2(0.02, 0.0), a2) - 0.045;
        d = min(d, min(s1, s2));
      }
      // thumb
      d = min(d, sdSegment(h, vec2(-0.45, -0.34), vec2(-0.05, -0.62)) - 0.06);
      return d;
    }

    vec3 plate(vec2 p) {
      vec2 q = p - EYE_C;
      float r = length(q), a = atan(q.y, q.x);
      float open = smoothstep(0.0, 1.4, uLt);
      float shift = sat(uSnare * 1.3);
      float calm = mix(0.35, 1.0, smoothstep(-0.78, -0.30, p.y));   // quieter band behind the karaoke line

      // ---------- background: ink, faint violet hex lattice, radial rays ----------
      vec3 col = C_INK * 0.7 + C_VIOLET * 0.05 * exp(-r * 1.2);
      {
        vec2 hp = p * 7.0;
        vec2 hr = vec2(1.0, 1.7320508);
        vec2 ha = mod(hp, hr) - 0.5 * hr, hb = mod(hp - 0.5 * hr, hr) - 0.5 * hr;
        vec2 hg = dot(ha, ha) < dot(hb, hb) ? ha : hb;
        vec2 ah = abs(hg);
        float hd = 0.5 - max(dot(ah, normalize(vec2(1.0, 1.7320508))), ah.x);
        vec2 hid = hp - hg;
        float blink = step(0.93, hash12(floor(hid * 3.1) + floor(uBeat)));
        col += C_VIOLET * smoothstep(0.03, 0.0, hd) * 0.18 * calm + C_CYAN * blink * 0.25 * smoothstep(0.5, 0.2, hd) * calm;
      }
      // radial light rays
      float rayN = snoise(vec2(a * 6.0, uT * 0.4)) * 0.5 + 0.5;
      float rays = pow(sat(0.5 + 0.5 * sin(a * 24.0 + uT * 0.3 + rayN * 3.0)), 6.0) * rayN;
      col += mix(C_CYAN, C_VIOLET, rayN) * rays * exp(-max(r - 0.55, 0.0) * 1.6) * (0.35 + 0.9 * uKick + 0.4 * uLow) * calm * step(0.55, r);

      // ---------- eyelid / sclera frame: an almond aperture ----------
      float lidH = 0.78 * open * (1.0 - 0.06 * uKick);
      float lidW = 1.65;
      float lx = q.x / lidW;
      float lid = abs(q.y) - lidH * (1.0 - lx * lx);
      float inEye = smoothstep(0.01, -0.01, lid);
      // sclera: dark steel with a cyan rim glow
      vec3 scl = C_INK2 * 0.6 + C_VIOLET * 0.12 * sat(1.2 - r);
      scl += C_CYAN * 0.22 * exp(-(-lid) * 18.0) * sat(-lid * 40.0);
      {
        // circuit veins running out from the iris
        float vn = 180.0;
        float va = a + 0.15 * snoise(vec2(r * 3.0, a * 2.0));
        float vid = floor(va / TAU * vn);
        float vh = hash11(vid * 2.9);
        float vd = (fract(va / TAU * vn) - 0.5) * TAU * r / vn;
        float vlen = 0.85 + 0.6 * vh;
        float vein = smoothstep(0.0025, 0.0, abs(vd)) * step(0.55, vh) * smoothstep(vlen, 0.8, r);
        float vpulse = exp(-abs(r - (0.8 + fract(uT * 0.5 + vh * 5.0) * 0.8)) * 30.0);
        scl += irisCol(vh, shift) * vein * (0.25 + 1.5 * vpulse);
      }
      // lid edge plates: segmented metal band outside the almond
      float lidBand = smoothstep(0.0, 0.01, lid) * smoothstep(0.09, 0.07, lid);
      float plates = step(0.12, fract(q.x * 9.0 + sign(q.y) * uT * 0.2));
      col += (C_BONE * 0.06 + irisCol(0.8 - 0.6 * sat(abs(q.x) - 0.4), shift) * 0.55) * lidBand * plates * calm;
      col += irisCol(0.2, shift) * exp(-abs(lid) * 60.0) * 1.2 * calm;
      col = mix(col, scl, inEye);

      // ---------- iris ----------
      float Rs = 0.82 * (0.85 + 0.15 * open);
      float inIris = smoothstep(Rs + AAE, Rs, r) * inEye;
      float rOut = r;
      r *= 0.60 / Rs;                      // iris content is laid out for a 0.60 radius
      float R = 0.60;
      vec3 ir = vec3(0.0);
      // fibrous striations
      float fib = fbm(vec2(a * 9.0, r * 5.0 - uT * 0.3), 3) * 0.5 + 0.5;
      float fibK = sat(r / R);
      ir += irisCol(fibK, shift) * (0.10 + 0.35 * fib) * smoothstep(0.2, R, r);
      // outer gold limbal ring + rotating gold segments
      ir += C_GOLD * ringLine(r, R - 0.008, 0.006) * 2.0;
      ir += C_GOLD * segRing(r, a, R - 0.06, R - 0.025, 48.0, 0.55, uT * 0.25) * 1.0;
      ir += irisCol(0.1, shift) * ringLine(r, R - 0.07, 0.002) * 2.0;
      // tick marks (counter-rotating), long ones every 8
      {
        float tr = a - uT * 0.4;
        float f = fract(tr / TAU * 120.0);
        float long_ = step(fract(floor(tr / TAU * 120.0) / 8.0), 0.01);
        float r0 = R - 0.12, r1 = R - 0.085 + 0.02 * long_;
        float d = (abs(f - 0.5) - 0.12) * (TAU * r / 120.0);
        float m = smoothstep(r0 - AAE, r0, r) * smoothstep(r1 + AAE, r1, r) * smoothstep(-AAE, AAE, d);
        ir += mix(irisCol(0.0, shift), C_GOLD, long_) * m * 1.3;
      }
      // circuit traces with travelling pulses
      {
        float n = 72.0;
        float tr = a + uT * 0.12;
        float id = floor(tr / TAU * n);
        float h = hash11(id * 1.37 + 5.0);
        float ac = (fract(tr / TAU * n) - 0.5) * TAU * r / n;
        float r0 = 0.30, len = 0.04 + 0.12 * h;
        float on = step(0.3, h);
        float line = smoothstep(0.0022 + AAE, 0.0022, abs(ac)) * smoothstep(r0 - AAE, r0, r) * smoothstep(r0 + len + AAE, r0 + len, r);
        float pad = smoothstep(0.009, 0.006, length(vec2(ac, r - (r0 + len))));
        float pulsePos = r0 + fract(uT * (0.6 + h) + h * 7.0) * len;
        float pulse = exp(-abs(r - pulsePos) * 90.0) * line;
        ir += irisCol(0.5 + 0.5 * h, shift) * (line * 0.45 + pad * 1.0) * on;
        ir += C_BONE * pulse * 3.0 * on * (0.5 + uHat);
      }
      // hex-cell / polar cell band (rotating the other way, cells blink on the beat)
      {
        float n = 36.0;
        float tr = a - uT * 0.18;
        float id = floor(tr / TAU * n);
        float rr = (r - 0.235) / 0.055;
        float row = floor(rr * 2.0);
        vec2 cc = vec2((fract(tr / TAU * n) - 0.5) * TAU * r / n, (fract(rr * 2.0) - 0.5) * 0.0275);
        float band = step(0.0, rr) * step(rr, 1.0);
        float cell = sdBox(cc, vec2(TAU * r / n * 0.38, 0.009)) - 0.002;
        float lit = step(0.55, hash12(vec2(id, row + floor(uBeat * 2.0) * 3.0)));
        float m = smoothstep(AAE, -AAE, cell) * band;
        ir += mix(irisCol(0.7, shift) * 0.5, irisCol(0.0, shift) * 1.5 + C_BONE * 0.2, lit) * m;
      }
      // aperture blades: contract on the kick, dilate between
      float N = 9.0;
      float pr = mix(0.19, 0.085, uKick) * (0.9 + 0.1 * sin(uBarPh * TAU)) * (1.0 + 0.2 * (1.0 - open));
      float rb = uT * 0.25 + uKick * 0.35;
      float secA = mod(a - rb, TAU / N) - PI / N;
      float dPoly = r * cos(secA) - pr * cos(PI / N);
      float bladeOuter = 0.225;
      float inBlade = smoothstep(-AAE, AAE, dPoly) * smoothstep(bladeOuter + AAE, bladeOuter, r);
      {
        float sp = fract(N * (a - rb) / TAU + (r - pr) * 7.0);
        float seam = smoothstep(0.03, 0.0, min(sp, 1.0 - sp));
        vec3 metal = mix(C_INK2 * 1.5, irisCol(0.3, shift) * 0.7, sp) + irisCol(0.0, shift) * pow(sp, 8.0) * 0.6;
        vec3 bl = metal + irisCol(0.0, shift) * seam * 1.8;
        bl += C_GOLD * ringLine(r, bladeOuter, 0.004) * 2.5;
        ir = mix(ir, bl, inBlade);
        // hot rim around the pupil
        ir += irisCol(0.1, shift) * exp(-max(dPoly, 0.0) * 70.0) * smoothstep(-0.004, 0.0, dPoly) * (1.5 + 3.0 * uKick);
      }
      // ---------- pupil: black hole with a tiny star inside ----------
      float inPupil = smoothstep(AAE, -AAE, dPoly);
      {
        vec3 bh = vec3(0.0);
        // tilted accretion ring (Doppler-bright on one side) and photon ring
        vec2 dq = rot2(0.35) * q;
        float ell = abs(length(vec2(dq.x, dq.y * 3.2)) - pr * 0.72);
        float dop = 0.6 + 0.4 * cos(atan(dq.y * 3.2, dq.x) + uT * 1.5);
        bh += mix(C_EMBER, C_GOLD, dop) * exp(-ell * 110.0) * 1.6 * dop;
        bh += C_VIOLET * exp(-abs(r - pr * 0.42) * 160.0) * 0.8;
        // the star (future): pinpoint + 4-point glint, twinkles with the hats
        float tw = 0.7 + 0.3 * sin(uT * 9.0) + 0.8 * uHat;
        float spk = exp(-abs(q.x) * 260.0) * exp(-abs(q.y) * 22.0) + exp(-abs(q.y) * 260.0) * exp(-abs(q.x) * 22.0);
        bh += C_BONE * (exp(-r * 180.0) * 12.0 + spk * 2.5) * tw;
        bh += C_GOLD * exp(-r * 45.0) * 1.2 * tw;
        ir = mix(ir, bh, inPupil);
      }
      // scanning laser: radar sweep inside the iris
      {
        float sw = mod(a - uT * 2.2, TAU);
        float trail = exp(-sw * 3.0) * step(pr, r);
        float beam = smoothstep(0.006, 0.0, abs(sin(a - uT * 2.2)) * r) * step(0.0, cos(a - uT * 2.2));
        ir += C_PINK * (trail * 0.35 + beam * 3.0) * (1.0 - inPupil);
      }
      col = mix(col, ir, inIris);
      // iris outer glow onto the sclera
      r = rOut;
      col += irisCol(0.3, shift) * exp(-max(r - Rs, 0.0) * 14.0) * 0.5 * step(Rs, r) * inEye;

      // ---------- cornea highlight with the Dyson swarm reflected in it ----------
      {
        vec2 hc = vec2(-0.27, 0.25);
        vec2 hq = q - hc;
        float hr = length(hq);
        float hl = smoothstep(0.13, 0.0, hr);
        col += C_BONE * hl * hl * 0.35 * inEye;
        // fisheye: bend the reflection
        vec2 fq = hq * (1.0 + 4.0 * hr * hr) / 0.11;
        col += C_GOLD * exp(-length(fq) * 6.0) * 1.5 * step(hr, 0.12);
        for (int i = 0; i < 12; i++) {
          float fi = float(i);
          float rad = 0.28 + 0.06 * fi;
          float ph = uT * (1.3 - fi * 0.05) + fi * 2.3;
          float tilt = 0.3 + 0.2 * sin(fi * 1.3);
          vec2 s = rot2(fi * 0.5) * vec2(cos(ph) * rad, sin(ph) * rad * tilt);
          float d = length(fq - s);
          col += mix(C_CYAN, C_GOLD, fract(fi * 0.41)) * exp(-d * 30.0) * 1.6 * step(hr, 0.12);
        }
        col += C_BONE * smoothstep(0.004, 0.0, abs(hr - 0.12)) * 0.25 * inEye;
      }

      // horizontal scan laser sweeping the frame once per bar
      {
        float sy = mix(0.9, -0.4, fract(uBar * 0.5));
        float d = abs(p.y - sy);
        col += C_PINK * (smoothstep(0.004, 0.0, d) * 2.0 + exp(-d * 40.0) * 0.25) * (0.6 + 0.4 * sin(p.x * 40.0 - uT * 20.0)) * calm;
      }

      // ---------- steel hands sweeping over everything on the bar line ----------
      {
        float bar = floor(uBar);
        float dir = mod(bar, 2.0) < 1.0 ? 1.0 : -1.0;
        float k = uBarPh * uBarPh * (3.0 - 2.0 * uBarPh);
        float ang = (hash11(bar * 3.3) - 0.5) * 0.9;
        vec2 hpp = rot2(ang) * p;
        hpp.x *= dir;
        hpp.x -= mix(-2.9, 2.7, k);
        hpp.y -= (hash11(bar * 7.1) - 0.5) * 0.8;
        float hd = handSdf(hpp / 0.95) * 0.95;
        float body = smoothstep(0.01, -0.01, hd);
        float edge = smoothstep(0.008, 0.0, abs(hd));
        float joints = smoothstep(0.006, 0.0, abs(hd + 0.025)) * body;
        // the hand dims what it passes over, with a steel-cyan rim and faint panel lines
        col *= 1.0 - 0.55 * body;
        col += C_INK2 * 0.5 * body + C_VIOLET * 0.5 * joints;
        col += mix(C_CYAN, C_BONE, 0.3) * edge * 1.2;
      }

      return col * mix(1.0, calm, 0.7);
    }`;
  }

  protected override frame(f: Frame) {
    return { exposure: 1.0, bloom: 0.85, vignette: 0.5, zoom: 1 + 0.03 * prog(f.lt, 0, 18, ease.inOutQuad) };
  }
}
