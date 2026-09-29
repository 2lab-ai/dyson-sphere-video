// Plate — SHELL (climax). The sphere closes: a giant shell of hexagonal panels around the star, seen from
// close up. Panels fly in and lock one beat at a time (30% -> 100% coverage), each lock sends a shock ripple
// through its neighbours, starlight leaks through the remaining gaps as god-rays, the seams cycle
// pink -> cyan -> gold per bar and a mechanical ECG ring pulses around the equator. The last panel seals,
// then everything whites out.
import * as THREE from 'three';
import { ShaderScene } from './_shader';
import type { Frame } from '../engine/scene';
import { clamp, smoothstep } from '../engine/util';

const BPM = 102.97;
const COV0 = 0.3; // coverage when the scene opens
const SEAL_P = 0.9; // scene progress at which the last panel locks

export default class Shell extends ShaderScene {
  protected override uniforms(): Record<string, THREE.IUniform> {
    // uCov = coverage before this beat, after this beat's lock, after the next beat's lock; w = sealed 0/1
    return { uCov: { value: new THREE.Vector4(COV0, COV0, COV0, 0) } };
  }

  protected glsl() {
    return /* glsl */ `
    uniform vec4 uCov;
    const float HEXS = 3.2;       // hex cells per cube-face half-width
    const float GAP = 0.03;      // seam half-gap between locked panels (hex-space)

    vec3 seamCol() {
      float b = mod(floor(uBar), 3.0);
      vec3 a = b < 0.5 ? C_PINK : b < 1.5 ? C_CYAN : C_GOLD;
      vec3 n = b < 0.5 ? C_CYAN : b < 1.5 ? C_GOLD : C_PINK;
      return mix(a, n, smoothstep(0.8, 1.0, uBarPh));
    }
    mat3 sphereRot() {
      float a = uT * 0.16 + 0.05 * uKick, b = 0.42 + 0.08 * sin(uT * 0.21);
      float ca = cos(a), sa = sin(a), cb = cos(b), sb = sin(b);
      mat3 ry = mat3(ca, 0.0, -sa, 0.0, 1.0, 0.0, sa, 0.0, ca);
      mat3 rx = mat3(1.0, 0.0, 0.0, 0.0, cb, sb, 0.0, -sb, cb);
      return ry * rx;
    }
    // unit direction -> (hex-space position on its cube face, face id)
    vec3 cubeUV(vec3 n) {
      vec3 ax = abs(n); vec2 uv; float f;
      if (ax.x >= ax.y && ax.x >= ax.z) { uv = n.yz / ax.x; f = n.x > 0.0 ? 0.0 : 1.0; }
      else if (ax.y >= ax.z) { uv = n.xz / ax.y; f = n.y > 0.0 ? 2.0 : 3.0; }
      else { uv = n.xy / ax.z; f = n.z > 0.0 ? 4.0 : 5.0; }
      uv = atan(uv) * (4.0 / PI);                // equi-angular cube: evens out the panel sizes
      return vec3(uv * HEXS, f);
    }
    // hex grid: xy = offset from cell centre, zw = cell centre
    vec4 hexCell(vec2 p) {
      const vec2 s = vec2(1.0, 1.7320508);
      vec2 a = mod(p, s) - 0.5 * s, b = mod(p - 0.5 * s, s) - 0.5 * s;
      vec2 g = dot(a, a) < dot(b, b) ? a : b;
      return vec4(g, p - g);
    }
    float hexDist(vec2 g) { g = abs(g); return max(dot(g, vec2(0.5, 0.8660254)), g.x); } // 0.5 at the edge
    // hash on the snapped lattice key (x*2, y/sqrt(3)/2 are integers at centres) so it never flickers
    float cellHash(vec2 c, float f) { vec2 id = floor(vec2(c.x * 2.0, c.y / 0.8660254) + 0.5); return hash12(id * 1.37 + f * 19.1 + 3.3); }

    // front-shell leak (1 = open hole / bright seam) at a screen position, for the god-rays
    vec3 camPos() { return vec3(0.12 * sin(uT * 0.23), 0.08 * sin(uT * 0.17), -mix(2.35, 1.85, uP)); }
    vec3 camRay(vec2 p, vec3 ro) {
      vec3 fw = normalize(-ro), rt = normalize(cross(vec3(0.0, 1.0, 0.0), fw)), up = cross(fw, rt);
      return normalize(p.x * rt + p.y * up + 2.3 * fw);
    }
    vec2 hitSphere(vec3 ro, vec3 rd, float r) {
      float b = dot(ro, rd), c = dot(ro, ro) - r * r, h = b * b - c;
      if (h < 0.0) return vec2(-1.0);
      h = sqrt(h); return vec2(-b - h, -b + h);
    }
    float leak(vec2 p, vec3 ro, mat3 R) {
      vec3 rd = camRay(p, ro);
      vec2 t = hitSphere(ro, rd, 1.0);
      if (t.x < 0.0) return 0.0;
      vec3 n = R * normalize(ro + rd * t.x);
      vec3 cu = cubeUV(n); vec4 hc = hexCell(cu.xy);
      float h = cellHash(hc.zw, cu.z);
      float hole = step(uCov.y, h);
      float seam = smoothstep(0.5 - GAP - 0.02, 0.5 - GAP * 0.3, hexDist(hc.xy));
      return hole * (0.6 + 0.4 * (1.0 - seam));
    }

    vec3 starfield(vec3 rd) {
      vec3 col = C_INK * 0.5 + C_VIOLET * 0.05 * (0.6 + 0.4 * fbm(rd * 2.5 + uT * 0.02, 3));
      vec3 q = rd * 70.0; vec3 id = floor(q); vec3 f = fract(q) - 0.5;
      float h = hash13(id);
      col += mix(C_CYAN, C_PINK, fract(h * 13.0)) * smoothstep(0.08, 0.0, length(f)) * step(0.93, h) * 2.0;
      return col;
    }

    // what you see through a gap: the star and the lit inside of the far wall
    vec3 interior(vec3 ro, vec3 rd, float t1, mat3 R, vec3 sc) {
      vec3 col;
      float tc = -dot(ro, rd); float dmin = length(ro + rd * tc);
      vec2 ts = hitSphere(ro, rd, 0.3 * (1.0 + 0.1 * uKick));
      if (ts.x > 0.0) {
        vec3 sp = normalize(ro + rd * ts.x);
        float n = fbm(vec3(R * sp * 4.0 + uT * 0.3), 4);
        float limb = pow(sat(dot(sp, -rd)), 0.6);
        col = mix(C_EMBER, C_GOLD, 0.5 + 0.5 * n) * (0.9 + 0.7 * n) * limb + C_BONE * limb * limb * 0.5;
      } else {
        vec3 n2 = R * normalize(ro + rd * t1);
        vec3 cu = cubeUV(n2); vec4 hc = hexCell(cu.xy);
        float h = cellHash(hc.zw, cu.z);
        float e = hexDist(hc.xy);
        float lit = 0.55 + 0.45 * smoothstep(0.5, 0.0, e);
        if (h < uCov.y && e < 0.5 - GAP) {
          // inside face of a far panel, warmly lit by the star
          col = mix(C_EMBER, C_GOLD, 0.35 + 0.3 * sin(h * 20.0)) * 0.3 * lit;
          col += sc * pxLine(abs(e - 0.34) / fwidth(e), 0.5, 1.5) * 0.5;
        } else {
          col = starfield(rd) + sc * 0.6 * smoothstep(0.5 - GAP - 0.02, 0.5, e) * step(h, uCov.y);
        }
      }
      col += mix(C_GOLD, C_EMBER, 0.4) * exp(-max(dmin - 0.3, 0.0) * 9.0) * (0.35 + 0.4 * uKick);
      return col;
    }

    // heartbeat trace: flat line with a P bump, QRS spike and T bump; turns stepped (mechanical) over the scene
    float ecg(float x) {
      float steps = mix(64.0, 12.0, smoothstep(0.2, 0.85, uP));
      x = mix(x, floor(x * steps) / steps, smoothstep(0.15, 0.6, uP));
      float v = 0.15 * exp(-pow((x - 0.18) * 30.0, 2.0));
      v -= 0.25 * exp(-pow((x - 0.36) * 90.0, 2.0));
      v += 1.0 * exp(-pow((x - 0.40) * 70.0, 2.0));
      v -= 0.35 * exp(-pow((x - 0.44) * 80.0, 2.0));
      v += 0.25 * exp(-pow((x - 0.62) * 22.0, 2.0));
      return v;
    }

    vec3 plate(vec2 p) {
      mat3 R = sphereRot();
      vec3 ro = camPos(), rd = camRay(p, ro);
      vec3 sc = seamCol();
      float seal = uCov.w;
      float white = smoothstep(0.93, 1.0, uP);
      float ph = uBeatPh;
      float lockF = exp(-ph * 5.0) * (0.6 + 0.6 * uKick);
      vec3 col;
      vec2 t = hitSphere(ro, rd, 1.0);
      if (t.x < 0.0) {
        col = starfield(rd);
        // limb halo of the shell
        float tc = -dot(ro, rd); float dm = length(ro + rd * tc);
        col += sc * exp(-(dm - 1.0) * 25.0) * 0.6 + C_GOLD * exp(-(dm - 1.0) * 6.0) * 0.12 * (1.0 - uCov.y);
      } else {
        vec3 wp = ro + rd * t.x, wn = normalize(wp);
        vec3 n = R * wn;
        vec3 cu = cubeUV(n); vec4 hc = hexCell(cu.xy);
        float h = cellHash(hc.zw, cu.z);
        float e = hexDist(hc.xy);
        bool locked = h < uCov.y;
        bool fresh = h >= uCov.x && h < uCov.y;
        bool incoming = h >= uCov.y && h < uCov.z;
        vec3 inner = interior(ro, rd, t.y, R, sc);
        if (locked && e < 0.5 - GAP) {
          // a panel: dark metal, bevelled, inset trim, running lights
          float fres = pow(1.0 - sat(dot(wn, -rd)), 3.0);
          vec3 L = normalize(vec3(-0.6, 0.7, -0.5));
          float bev = smoothstep(0.5 - GAP - 0.06, 0.5 - GAP, e);
          vec3 pn = normalize(wn + 0.25 * bev * normalize(vec3(hc.xy, 0.0).xzy));
          float dif = sat(dot(pn, L));
          col = C_INK2 * (0.35 + 0.9 * dif) + mix(C_VIOLET, C_CYAN, 0.5 + 0.5 * wn.y) * fres * 0.35;
          col += C_BONE * pow(sat(dot(reflect(rd, pn), L)), 24.0) * 0.6;
          col += sc * bev * bev * (0.35 + 2.5 * seal * smoothstep(0.9, 0.95, uP));                                           // seam glow on the bevel
          float trim = pxLine(abs(e - 0.34) / fwidth(e), 0.4, 1.4);
          col += sc * trim * (0.25 + 0.6 * uKick * step(0.6, hash11(h * 91.0)));
          vec2 dp = hc.xy * rot2(h * 6.28);
          float dots = smoothstep(0.03, 0.0, length(dp - vec2(0.0, 0.2)));
          col += mix(C_CYAN, C_PINK, step(0.5, h)) * dots * 2.5 * step(0.5, fract(uBeat * 0.5 + h));
          col *= 0.8 + 0.3 * uLow;
          // freshly locked panel flares white, then cools to its seam colour
          if (fresh) col += mix(C_BONE * 3.0, sc * 1.5, sat(ph * 1.6)) * lockF;
        } else if (locked) {
          col = inner * 0.3 + sc * 1.3 * (0.6 + 0.5 * uKick);           // seam: star light squeezing through
        } else {
          col = inner;
          float rim = smoothstep(0.42, 0.5, e);
          col += sc * rim * 0.4;
          if (incoming) {
            // next beat's panel flying in: a shrinking outline hex closing on its slot
            float k = ph * ph;
            float r = mix(1.1, 0.46, k);
            vec2 off = normalize(hash22(hc.zw + cu.z) - 0.5) * (1.0 - k) * 0.6;
            float eo = hexDist(hc.xy - off);
            col += mix(C_BONE, sc, 0.5) * pxLine(abs(eo - r) / fwidth(eo), 0.8, 2.0) * (0.4 + 1.6 * k);
            col = mix(col, C_INK2 * 0.8, 0.5 * k * step(eo, r));
          }
        }
        // shock ripples from this beat's locks, through two rings of neighbours
        float rip = 0.0;
        for (int j = -2; j <= 2; j++) for (int i = -2; i <= 2; i++) for (int s = 0; s < 2; s++) {
          vec2 c = hc.zw + vec2(float(i) + 0.5 * float(s), 1.7320508 * float(j) + 0.8660254 * float(s));
          float hh = cellHash(c, cu.z);
          if (hh < uCov.x || hh >= uCov.y) continue;
          float d = length(cu.xy - c);
          float ring = ph * 3.2;
          rip += exp(-abs(d - ring) * 9.0) * (1.0 - ph) * step(0.3, d);
        }
        col += (C_BONE * 0.6 + sc) * min(rip, 1.5) * (0.5 + 0.7 * uKick);

        // ECG ring floating just above the equator
        vec2 tr = hitSphere(ro, rd, 1.035);
        vec3 en = R * normalize(ro + rd * tr.x);
        float lon = atan(en.z, en.x) / TAU + 0.5;
        float x = fract(lon * 5.0 - uT * 0.35);
        float lat = asin(clamp(en.y, -1.0, 1.0));
        float amp = 0.07 * (0.6 + 0.9 * uKick);
        float dl = abs(lat - amp * ecg(x));
        float fw = fwidth(lat) + 1e-4;
        float face = sat(dot(normalize(ro + rd * tr.x), -rd) * 3.0);
        vec3 ecgC = mix(C_LIME, C_BONE, 0.3 + 0.5 * uKick);
        col += ecgC * (pxLine(dl / fw, 1.0, 2.5) * 3.0 + exp(-dl * 90.0) * 0.6) * face * (0.7 + 1.0 * uKick);
      }

      // god-rays: star light leaking out of the open gaps, streaming radially away from the centre
      float gr = 0.0, w = 1.0;
      vec2 dir = p * (0.55 / 22.0);
      vec2 q = p;
      for (int k = 0; k < 22; k++) {
        gr += leak(q, ro, R) * w;
        w *= 0.93; q -= dir;
      }
      gr /= 22.0;
      float rp = length(p);
      float beamMask = smoothstep(0.2, 0.9, rp);                    // keep the lyric centre calm
      float beams = gr * beamMask * (1.0 - seal * 0.7) * (0.8 + 1.4 * uKick + 0.6 * uLow);
      col += mix(C_GOLD, sc, 0.45) * beams * mix(1.1, 0.4, step(0.0, t.x));

      // calmer, dimmer core behind the slam word
      col *= 0.62 + 0.38 * smoothstep(0.05, 0.55, length(p * vec2(0.75, 1.3)));

      // the seal: seams flood white-hot, then the whole frame burns out
      col = mix(col, vec3(7.0), white * white);
      return col;
    }`;
  }

  protected override frame(f: Frame) {
    const dur = Math.max(f.end - f.start, 1e-3);
    const bps = BPM / 60;
    const k = Math.floor(f.beat) - Math.floor(f.beat - f.lt * bps + 1e-3); // beats since the scene began
    const nSeal = Math.max(1, SEAL_P * dur * bps);
    const cov = (i: number) => (i <= 0 ? COV0 : COV0 + (1 - COV0) * clamp(i / nSeal) ** 0.85);
    const u = this.pass.u.uCov!.value as THREE.Vector4;
    const sealed = cov(k) >= 1 ? 1 : 0;
    // the very last lock covers everything (h < 1), so nothing is left open once sealed
    u.set(cov(k - 1), sealed ? 1.01 : cov(k), cov(k + 1) >= 1 ? 1.01 : cov(k + 1), sealed);
    const white = smoothstep(0.93, 1.0, f.p);
    return {
      exposure: 1.0 + 0.8 * white,
      bloom: 0.9 + 0.8 * white,
      bloomThreshold: 0.8,
      vignette: 0.4 * (1 - white),
      flash: 0.6 * white * white,
    };
  }
}
