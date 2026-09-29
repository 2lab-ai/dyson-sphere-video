// Plate — SWARM (drop 1). The Dyson swarm assembles: a blazing star seen from a low oblique orbit,
// ring after ring of collector panels launched on the kicks and snapped into tilted orbits (each ring is
// analytic: one ray-plane hit per ring, the panel cell picked from the hit's polar coords, so thousands
// of panels cost ~20 intersections a pixel). Panels crossing the disc read as dark silhouettes, snares
// flip panels over to their bright side, every downbeat sends a colour wave around the rings, and on the
// first downbeat of every 8 bars a neon-outline "DYSON SPHERE" punches in with an RGB split.
import * as THREE from 'three';
import { ShaderScene } from './_shader';
import type { Frame } from '../engine/scene';
import { Layer2D } from '../engine/gl';
import { F, fitSize, measure, textPath2D } from '../engine/type';
import { clamp, ease } from '../engine/util';

const RINGS = 20;

export default class Swarm extends ShaderScene {
  private title!: Layer2D;
  private births: number[] = [];
  private snares: number[] = [];
  private bar0 = 0;
  private beat0 = 0;
  private u = {
    uTitleTex: { value: null as THREE.Texture | null },
    uBirth: { value: new Array<number>(RINGS).fill(0) },
    uLBeat: { value: 0 },
    uTitle: { value: 0 },
    uTitleS: { value: 1 },
    uSplit: { value: 0 },
    uSnIdx: { value: 0 },
    uSnAge: { value: 9 },
  };

  override init() {
    const { audio, start, end } = this.ctx;
    this.bar0 = Math.round(audio.barAt(start));
    this.beat0 = Math.round(audio.beatAt(start));
    // ring launches ride the strong kicks, at least ~2 beats apart; the first 3 rings are already up
    const beat = 60 / audio.bpm;
    const strong = audio.events('kick', start, end).filter(([, s]) => s >= 0.8).map(([t]) => t);
    const b: number[] = [-6, -5, -4, -3, -2, -1];
    let last = -1e9;
    for (const t of strong) {
      if (b.length >= RINGS) break;
      if (t - last < 1.5 * beat) continue;
      b.push((t - start) / beat);
      last = t;
    }
    while (b.length < RINGS) b.push(b[b.length - 1]! + 2);
    this.births = b;
    this.u.uBirth.value = b;
    this.snares = audio.events('snare', start - 1, end).filter(([, s]) => s >= 0.7).map(([t]) => t);

    // the title, drawn once: white neon outline on black (the shader reads .r as a mask)
    this.title = new Layer2D();
    const c = this.title.ctx;
    this.title.clear('#000');
    const fam = F.archivo(125, 900), track = 38;
    const size = fitSize('DYSON SPHERE', fam, 1560, 260, track);
    const w = measure('DYSON SPHERE', fam, size, track);
    const path = textPath2D('DYSON SPHERE', fam, size, (1920 - w) / 2, 540 + size * 0.36, track);
    c.lineJoin = 'round';
    c.strokeStyle = '#fff';
    c.lineWidth = 7;
    c.stroke(path);
    c.fillStyle = '#fff';
    c.globalAlpha = 0.08;
    c.fill(path);
    c.globalAlpha = 1;
    this.u.uTitleTex.value = this.title.upload();
    super.init();
  }

  protected override uniforms() { return this.u as unknown as Record<string, THREE.IUniform>; }

  protected glsl() {
    return /* glsl */ `
    uniform sampler2D uTitleTex;
    uniform float uBirth[${RINGS}];
    uniform float uLBeat, uTitle, uTitleS, uSplit, uSnIdx, uSnAge;

    const float RS = 0.42;   // star radius

    vec3 ringCol(float h) {
      return h < 0.3 ? C_CYAN : h < 0.5 ? C_PINK : h < 0.68 ? C_GOLD : h < 0.84 ? C_LIME : C_VIOLET * 1.6;
    }
    vec3 waveCol(float b) {
      float k = mod(b, 4.0);
      return k < 1.0 ? C_CYAN : k < 2.0 ? C_PINK : k < 3.0 ? C_LIME : C_GOLD;
    }
    float easeOutBack(float x) { float c1 = 1.9, c3 = c1 + 1.0; x -= 1.0; return 1.0 + c3 * x * x * x + c1 * x * x; }

    vec3 background(vec3 rd) {
      vec3 col = C_INK * 0.5;
      float n = fbm(rd * 2.2 + vec3(0.0, 0.0, uT * 0.01), 3);
      col += mix(C_VIOLET, C_PINK, sat(n + 0.4)) * sat(n * 0.8 + 0.2) * 0.10;
      // pinprick stars on a direction grid
      vec2 sp = vec2(atan(rd.z, rd.x) * 60.0, rd.y * 60.0);
      vec2 ci = floor(sp), cf = fract(sp) - 0.5;
      float h = hash12(ci);
      vec2 o = (hash22(ci + 7.0) - 0.5) * 0.6;
      col += mix(C_BONE, C_CYAN, h) * smoothstep(0.07, 0.0, length(cf - o)) * step(0.82, h) * 1.4 * (0.6 + 0.4 * sin(uT * 3.0 + h * 40.0));
      return col;
    }

    vec3 plate(vec2 p) {
      // --- camera: low oblique orbit that dollies in over the drop, look-at drifting off the star
      float yaw = 0.6 + uP * 1.9 + 0.08 * sin(uT * 0.4);
      float pitch = mix(0.34, 0.16, uP) + 0.05 * sin(uT * 0.23);
      float dist = mix(4.4, 2.9, smoothstep(0.0, 1.0, uP)) * (1.0 - 0.015 * uKick);
      vec3 ro = dist * vec3(cos(pitch) * sin(yaw), sin(pitch), cos(pitch) * cos(yaw));
      vec3 tgt = vec3(0.38 * sin(uT * 0.11 + 1.0), 0.12, 0.25 * cos(uT * 0.13));
      vec3 fw = normalize(tgt - ro);
      vec3 rt = normalize(cross(fw, vec3(0.0, 1.0, 0.0)));
      vec3 up = cross(rt, fw);
      float fl = 1.55;
      vec3 rd = normalize(fw * fl + rt * p.x + up * p.y);
      float pixAng = 2.0 / (1080.0 * fl);

      // --- the star
      vec3 col = background(rd);
      float b = dot(ro, rd);
      float c2 = dot(ro, ro) - RS * RS;
      float disc = b * b - c2;
      float tS = 1e9;
      float closest = length(ro - rd * b);          // ray's closest approach to the star centre
      vec3 starC = vec3(0.0);
      float pulse = 1.0 + 0.25 * uKick;
      if (disc > 0.0) {
        tS = -b - sqrt(disc);
        vec3 sp = ro + rd * tS;
        vec3 sn = normalize(sp);
        float mu = sat(dot(sn, -rd));
        float g = fbm(sn * 7.0 + vec3(uT * 0.25, -uT * 0.18, 0.0), 4);
        float cells = fbm(sn * 22.0 - vec3(0.0, uT * 0.4, 0.0), 2);
        vec3 surf = mix(C_EMBER * 1.1, C_GOLD * 2.4, sat(0.55 + g * 0.9));
        surf += C_BONE * sat(cells) * 1.2;
        surf *= mix(0.45, 1.0, pow(mu, 0.6));                     // limb darkening
        surf = mix(C_PINK * 1.6, surf, smoothstep(0.0, 0.35, mu)); // pink limb
        starC = surf * pulse;
      }
      // corona + streamers (visible around the disc and through gaps)
      float ang = atan(dot(rd, up), dot(rd, rt));
      float edge = max(closest - RS, 0.0);
      float stream = 0.6 + 0.8 * fbm(vec2(ang * 3.0, uT * 0.3 - edge * 4.0), 3);
      float corona = exp(-edge * (9.0 - 3.0 * uKick)) * stream;
      starC += mix(C_PINK, C_EMBER, exp(-edge * 10.0)) * corona * (0.8 + 0.6 * uVocal + 0.5 * uKick);
      starC += C_GOLD * exp(-edge * 30.0) * 1.0 * pulse;

      // --- rings of collector panels
      vec3 camFw = normalize(-ro);
      float occl = 1.0;
      vec3 pan = vec3(0.0);
      float wave = sat(1.0 - uBarPh * 1.6);                  // downbeat colour wave envelope
      vec3 wc = waveCol(floor(uBar));
      for (int i = 0; i < ${RINGS}; i++) {
        float fi = float(i);
        float age = uLBeat - uBirth[i];
        if (age < 0.0) continue;
        float h1 = hash11(fi * 13.1 + 3.0), h2 = hash11(fi * 7.7 + 1.0), h3 = hash11(fi * 3.3 + 9.0);
        // orbit plane: inclination + node, rings near the ecliptic mostly, a few steep ones
        float inc = (h1 - 0.5) * (i % 3 == 0 ? 2.2 : 1.1);
        float node = h2 * 6.2831853;
        vec3 n = vec3(0.0, cos(inc), sin(inc));
        n.xz = rot2(node) * n.xz;
        vec3 e1 = normalize(cross(n, abs(n.x) < 0.9 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 0.0, 1.0)));
        vec3 e2 = cross(n, e1);
        float R = 0.78 + fi * 0.095 + h3 * 0.05;
        float launch = sat(age / 1.1);
        float Rc = mix(RS * 0.9, R, easeOutBack(launch));
        float dn = dot(rd, n);
        if (abs(dn) < 1e-4) continue;
        float t = -dot(ro, n) / dn;
        if (t < 0.05) continue;
        bool behind = t > tS;
        vec3 hp = ro + rd * t;
        vec2 q = vec2(dot(hp, e1), dot(hp, e2));
        float r = length(q);
        float lanes = 3.0, laneW = 0.052;
        float rr = (r - Rc) / laneW + lanes * 0.5;
        if (rr < -1.0 || rr > lanes + 1.0) continue;
        float fp = pixAng * t / max(abs(dn), 0.03);          // pixel footprint on the plane
        // birth shockwave line
        float birth = exp(-age * 1.6);
        vec3 rc = ringCol(fract(fi * 0.618 + 0.1));
        float fade = behind ? 0.0 : 1.0;
        pan += rc * exp(-abs(r - Rc) / max(fp * 2.0, 0.004)) * birth * 3.0 * fade;
        if (rr < 0.0 || rr >= lanes) continue;
        float lane = floor(rr);
        float M = floor(60.0 + fi * 9.0);
        float spin = (mod(fi, 2.0) < 0.5 ? 1.0 : -1.0) * 0.55 * pow(R, -1.5);
        float a = atan(q.y, q.x) / 6.2831853;
        float rot = uT * spin * 0.16 + 2.5 * exp(-age * 1.4) + lane * 0.13;
        float ca = (a - rot) * M;
        float cell = floor(ca);
        vec2 cc = vec2(fract(ca) - 0.5, fract(rr) - 0.5);
        float id = cell + lane * 997.0 + fi * 131.0;
        float ph = hash11(id * 0.713);
        if (ph < 0.12 + 0.25 * (1.0 - launch)) continue;       // gaps in the swarm
        // snare flips: side = parity of a per-panel coin toss per snare; the last flip animates
        float side = step(0.5, hash12(vec2(id, uSnIdx)));
        float flipping = step(0.55, hash12(vec2(id, uSnIdx + 0.5)));
        float fa = flipping * sat(1.0 - uSnAge * 4.5) * 3.14159;
        float wS = abs(cos(fa));
        // footprint in cell units
        float cellT = 6.2831853 * r / M;
        vec2 fpc = vec2(fp / cellT, fp / laneW) + 1e-3;
        vec2 hb = vec2(0.36 * wS + 0.02, 0.38);
        vec2 dd = abs(cc) - hb;
        float cov = sat(0.5 - max(dd.x / fpc.x, dd.y / fpc.y));
        float frame = cov * sat(0.5 - max(-dd.x - 0.07, -dd.y - 0.07) / max(fpc.x, fpc.y)) ;
        float blur = sat(max(fpc.x, fpc.y) * 1.5 - 0.5);       // sub-pixel panels → average glow
        cov = mix(cov, 0.55, blur);
        frame = mix(frame, 0.25, blur);
        if (behind) continue;
        // depth: far side of the star dims, near side and close-to-lens panels glow
        float far = dot(hp, camFw);
        float dep = far > 0.0 ? 0.5 : 1.0;
        dep *= smoothstep(0.1, 0.9, t);
        // lit side = bright bone-tinted, dark side = coloured glass
        vec3 bright = mix(rc, C_BONE, 0.3) * 1.5;
        vec3 dark = rc * 0.18;
        vec3 fill = mix(dark, bright, side) * (1.0 + flipping * 1.0 * sat(1.0 - uSnAge * 3.0));
        vec3 pc = fill * cov + rc * frame * 1.4;
        // downbeat wave running around the ring
        float wpos = fract(a + fi * 0.021 + 0.5);
        float front = uBarPh * 2.6;
        float wv = exp(-abs(wpos - front) * 14.0) * wave;
        pc += wc * cov * wv * 1.8;
        pc *= (0.75 + 0.25 * uKick + 1.2 * birth) * (0.75 + 0.5 * ph);
        // panels in front of the star: silhouettes against the disc, a warm rim from the backlight
        float front3 = disc > 0.0 ? 1.0 : exp(-edge * 5.0);
        occl *= 1.0 - 0.92 * cov * front3;
        pc += C_GOLD * frame * front3 * 1.2;
        pan += pc * dep;
      }
      col = col * occl + starC * occl + pan;

      // --- lens: anamorphic streak, starburst, ghosts along the flare axis
      vec3 sv = -ro;
      float sz = dot(sv, fw);
      vec2 s = vec2(dot(sv, rt), dot(sv, up)) / sz * fl;
      vec2 d = p - s;
      float lit = (0.6 + 0.5 * uKick + 0.2 * uRms) * step(0.0, sz);
      col += mix(C_CYAN, C_VIOLET, 0.3) * exp(-abs(d.y) * 55.0) * exp(-abs(d.x) * 0.9) * 1.7 * lit;
      col += C_PINK * exp(-abs(d.y) * 140.0) * exp(-abs(d.x) * 2.5) * 1.2 * lit;
      float ra = atan(d.y, d.x);
      float burst = pow(abs(cos(ra * 4.0 + uT * 0.2)), 40.0) + 0.6 * pow(abs(cos(ra * 7.0 - uT * 0.13)), 60.0);
      col += C_GOLD * burst * exp(-length(d) * 5.0) * 0.45 * lit;
      for (int k = 0; k < 5; k++) {
        float fk = float(k);
        float m = -0.35 - fk * 0.38;
        vec2 gp = s * m;
        float gr = 0.03 + 0.05 * hash11(fk * 3.1);
        // hexagonal aperture ghost
        vec2 g = abs(rot2(0.3) * (p - gp));
        float hex = max(g.x * 0.866 + g.y * 0.5, g.y) - gr;
        vec3 gc = k % 2 == 0 ? C_CYAN : C_PINK;
        col += gc * (smoothstep(0.006, 0.0, abs(hex)) * 0.5 + smoothstep(0.0, -gr, hex) * 0.12) * lit;
      }

      // --- title: neon outline with punch-in scale and RGB split
      if (uTitle > 0.001) {
        vec2 uv = p * vec2(1080.0 / 1920.0, 1.0) * 0.5;
        vec2 dir = vec2(1.0, 0.0);
        float sp = uSplit;
        float rT = texture(uTitleTex, uv / uTitleS + 0.5 + dir * sp).r;
        float gT = texture(uTitleTex, uv / uTitleS + 0.5).r;
        float bT = texture(uTitleTex, uv / uTitleS + 0.5 - dir * sp).r;
        vec3 tcol = vec3(rT, gT, bT);
        vec3 neon = tcol.r * C_PINK * vec3(1.0, 0.0, 0.3) + tcol.g * mix(C_BONE, C_CYAN, 0.5) + tcol.b * C_CYAN * vec3(0.0, 0.6, 1.0);
        float scan = 0.85 + 0.15 * sin(p.y * 900.0);
        col = col * (1.0 - 0.5 * uTitle) + neon * 2.6 * uTitle * scan;
      }
      return col;
    }`;
  }

  protected override frame(f: Frame) {
    const beat = 60 / this.ctx.audio.bpm;
    const lbeat = f.beat - this.beat0;
    this.u.uLBeat.value = lbeat;
    // snares: how many so far, age of the latest
    let n = 0, last = -1e9;
    for (const t of this.snares) { if (t <= f.t) { n++; last = t; } else break; }
    this.u.uSnIdx.value = n;
    this.u.uSnAge.value = (f.t - last) / beat;

    // title on the first downbeat of every 8 bars: punch in, hold, dissolve
    const lb = f.bar - this.bar0;
    const k = Math.floor(lb / 8) * 8;
    const x = lb - k; // bars since that downbeat
    let env = 0, scale = 1, split = 0;
    if (x >= 0 && x < 2) {
      const inT = clamp(x * 4 / 0.5);              // first half beat
      const out = 1 - clamp((x - 1.5) / 0.5);
      env = ease.outCubic(inT) * out;
      const pi = ease.outCubic(clamp(x * 4 / 1.0));
      scale = 1.5 - 0.5 * pi + 0.03 * f.a.kick;
      split = 0.02 * (1 - pi) + 0.004 * f.a.snare + 0.003 * f.a.kick;
      // hard strobe on every beat of the hold
      env *= 0.75 + 0.25 * Math.pow(0.5, (f.beatPhase * beat) / 0.08);
    }
    this.u.uTitle.value = env;
    this.u.uTitleS.value = scale;
    this.u.uSplit.value = split;
    return { exposure: 1.0, bloom: 0.9, vignette: 0.4, halation: 0.35 };
  }

  override dispose() { this.title?.texture.dispose(); }
}
