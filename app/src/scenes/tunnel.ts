// Plates TUNNEL1 / TUNNEL2 — hyperspace through the inside of the shell under construction: a polygonal
// tunnel of neon panels rushing at the camera. Seams glow, every kick launches a ring of light down the
// tube, the snare flips the panel colours, each bar snaps the tube round one panel, and data glyphs rain
// along the walls. uParam.x = 1 (tunnel2): ember/gold hexagon, faster, more twist, warning-stripe panels
// and a strobe that ramps up into the climax. The vanishing point sits right of centre so the stacked
// lyrics on the left read over the calmer near wall.
import { ShaderScene } from './_shader';
import type { Frame } from '../engine/scene';

export default class Tunnel extends ShaderScene {
  protected glsl() {
    return /* glsl */ `
    // 3x5 pixel glyph from a hash; (g in 0..1 cell coords)
    float glyph(vec2 g, float h) {
      vec2 px = floor(g * vec2(3.0, 5.0));
      if (px.x < 0.0 || px.x > 2.0 || px.y < 0.0 || px.y > 4.0) return 0.0;
      float bit = px.x + px.y * 3.0;
      return step(0.45, hash11(h * 31.7 + bit * 7.13));
    }

    vec3 plate(vec2 p) {
      float hot = uParam.x;
      float P = uP;
      float N = mix(8.0, 6.0, hot);                 // octagon / hexagon
      float S = TAU / N;
      float inten = mix(0.6, 1.0, P) + hot * 0.5 * P * P;

      // vanishing point right of centre, gently drifting
      vec2 c = vec2(0.45 + 0.06 * sin(uT * 0.31), 0.03 + 0.05 * sin(uT * 0.23 + 1.0));
      vec2 q = p - c;
      float r = length(q) + 1e-4;
      float a = atan(q.y, q.x);

      // bar-phase rotation: the tube snaps round one panel at every bar and eases the rest of the way
      float snap = floor(uBar) + smoothstep(0.0, 0.3, uBarPh);
      float rot = snap * S * (hot > 0.5 ? 1.0 : 0.5) + uT * mix(0.05, 0.12, hot);
      float twist = mix(0.10, 0.28 + 0.2 * P, hot) * (1.0 + 0.6 * uLow);

      // polygon depth (two passes so the depth twist lands on the right wall)
      float aa = a + rot;
      float al = aa - floor(aa / S + 0.5) * S;
      float z = 0.42 / max(r * cos(al), 1e-4);
      aa = a + rot + twist * z;
      float sec = floor(aa / S + 0.5);
      al = aa - sec * S;
      z = 0.42 / max(r * cos(al), 1e-4);

      // travel along the tube, accelerating through the section
      float v0 = mix(3.2, 5.5, hot);
      float travel = uLt * v0 + uLt * uLt * mix(0.02, 0.12, hot);
      float w = z + travel;                         // world depth coordinate along the wall
      float u = al / S + 0.5;                       // 0..1 across the wall

      float fog = exp(-z * mix(0.16, 0.13, hot));
      float nearFade = smoothstep(0.02, 0.25, z);

      // palette: snare-count flips the two panel hues
      float flip = mod(floor((uBeat + 1.0) * 0.5), 2.0);
      vec3 cA = mix(mix(C_CYAN, C_PINK, flip), mix(C_EMBER, C_GOLD * 0.7, flip), hot);
      vec3 cB = mix(mix(C_PINK, C_CYAN, flip), mix(C_PINK * 0.8, C_EMBER, flip), hot);
      vec3 cSeam = mix(C_VIOLET * 1.2 + C_CYAN * 0.25, C_EMBER * 0.9 + C_GOLD * 0.25, hot);

      // panels: K across each wall, 1 unit deep
      float K = 3.0;
      vec2 pc = vec2(u * K, w * 1.0);
      vec2 cid = floor(pc);
      vec2 f = fract(pc);
      float hc = hash13(vec3(cid, sec + 17.0));
      // seams (antialiased by the local footprint)
      vec2 fw = max(fwidth(pc), vec2(1e-4));
      vec2 e = min(f, 1.0 - f) / fw;
      float seam = exp(-min(e.x, e.y) * 0.55);
      float seamWide = exp(-min(f.x, 1.0 - f.x) * 14.0) * 0.5 + exp(-min(f.y, 1.0 - f.y) * 14.0) * 0.5;

      vec3 col = C_INK * 0.5;
      // panel body: dark glass with a lit inset on some panels
      vec3 pcol = mix(cA, cB, step(0.55, hc));
      float lit = step(mix(0.7, 0.58, P), hash13(vec3(cid, sec + floor(uBeat * 0.5) * 0.37)));
      vec2 fi = abs(f - 0.5);
      float inset = smoothstep(0.02, 0.0, max(fi.x - 0.38, fi.y - 0.36) );
      float insetEdge = smoothstep(0.03, 0.0, abs(max(fi.x - 0.38, fi.y - 0.36)));
      float pulse = 0.5 + 0.5 * sin(w * 2.0 - uT * 6.0 + hc * 6.28);
      col += pcol * 0.03;
      col += pcol * inset * lit * (0.2 + 0.45 * pulse) * 0.7;
      col += pcol * insetEdge * 0.6;
      // circuit trace inside dark panels
      float tr = smoothstep(0.02, 0.0, abs(f.y - 0.5 - 0.3 * step(0.5, hash11(hc * 9.0)) * sign(f.x - 0.5)));
      col += cB * tr * (1.0 - lit) * 0.35 * step(0.3, hc);

      // warning stripes (tunnel2): some panels become hazard chevrons, more toward the end
      if (hot > 0.5) {
        float wp = step(1.0 - (0.18 + 0.37 * P), hash13(vec3(cid, sec + 5.0)));
        float st = step(0.5, fract((f.x + f.y) * 3.0 - uT * 2.5));
        col = mix(col, mix(C_INK * 0.3, C_GOLD * 0.7, st) * inset, wp * inset);
      }

      col += cSeam * (seam * 1.5 + seamWide * 0.25) * (0.6 + 0.8 * uKick);
      // long corner rails where two walls meet, hot
      float corner = exp(-min(u, 1.0 - u) * K / fw.x * 0.35);
      col += mix(C_CYAN, C_GOLD, hot) * corner * 1.3;

      // glyph rain streaming along some sub-columns toward the camera
      float gcols = K * 4.0;
      float gx = u * gcols;
      float gcol = floor(gx);
      float hcol = hash12(vec2(gcol, sec));
      float rainOn = step(mix(0.72, 0.55, P + hot * 0.3), hcol);
      float gs = 5.0 + 3.0 * hcol + 4.0 * hot;
      float gy = w * 3.0 - uT * gs;
      vec2 gcell = vec2(gcol, floor(gy));
      vec2 gf = vec2(fract(gx), fract(gy));
      float gh = hash13(vec3(gcell, sec + floor(uT * 8.0) * 0.1));
      float g = glyph((gf - vec2(0.2, 0.1)) / vec2(0.6, 0.8), gh);
      float head = fract(gcell.y * 0.071 + hcol * 3.0 + uT * 0.35);
      float trail = pow(head, 6.0);
      col += mix(C_LIME, C_GOLD, hot) * g * rainOn * (0.1 + 2.2 * trail) * smoothstep(6.0, 1.5, z);

      // kick rings: one launched every beat far down the tube, rushing at the camera
      for (int k = 0; k < 5; k++) {
        float fk = float(k);
        float age = fk + uBeatPh;                    // beats since launch
        float rz = 6.5 - age * mix(1.25, 1.55, hot);  // depth of the ring now
        if (rz < 0.05) continue;
        float bIdx = floor(uBeat) - fk;
        float amp = (0.45 + 1.3 * uKick + (k == 0 ? 0.8 * uKick : 0.0)) * (0.6 + 0.4 * hash11(bIdx * 1.3));
        float ring = exp(-abs(z - rz) * (10.0 + 6.0 / rz)) ;
        vec3 rc = mix(mix(C_CYAN, C_PINK, hash11(bIdx)), mix(C_GOLD, C_EMBER, hash11(bIdx)), hot);
        col += rc * ring * amp * 3.0 * (1.0 - smoothstep(5.6, 6.5, rz));
      }

      // depth fog into a hot core at the vanishing point
      vec3 coreC = mix(mix(C_VIOLET, C_CYAN, 0.35), mix(C_EMBER, C_GOLD, 0.2), hot);
      col = col * fog * nearFade * inten;
      col += coreC * (1.0 - fog) * 0.35;
      col += mix(C_BONE, C_GOLD, hot) * exp(-r * mix(24.0, 20.0, hot)) * (1.8 + 2.5 * uKick + 1.5 * hot * P);
      // speed streaks radiating from the core
      float sl = hash11(floor(a * 60.0 / TAU * 3.0));
      float sp = fract(sl * 7.0 - uT * (1.2 + hot) - 0.4 / r);
      col += coreC * step(0.82, sl) * smoothstep(0.1, 0.0, sp) * smoothstep(0.05, 0.4, r) * 0.5;

      // tunnel2 strobe ramping toward the climax (eighth notes, only in the last half)
      float strobe = hot * smoothstep(0.45, 1.0, P) * step(0.5, fract(uBeat * 2.0));
      float sOn = hot * smoothstep(0.45, 1.0, P);
      // lyric box (stack words, px 130..900 x 300..800): soft mask, stronger as tunnel2 ramps
      float box = smoothstep(0.3, -0.05, sdBox(p - vec2(-0.83, -0.02), vec2(0.72, 0.46)));
      float fs = mix(1.0, 0.45 + 0.9 * step(0.5, fract(uBeat * 2.0)), sOn);
      col *= mix(fs, min(fs, 1.0), box);
      col += C_EMBER * strobe * 0.05;

      // keep the lyric column (left third) calmer
      float calm = mix(0.5, 1.0, smoothstep(-1.4, -0.1, p.x));
      calm *= 1.0 - box * mix(0.3, 0.45 + 0.25 * P, hot);
      col *= calm;
      return col;
    }`;
  }

  protected override frame(f: Frame) {
    const hot = (this.ctx.params.u?.[0] ?? 0) > 0.5;
    return {
      exposure: hot ? 0.95 + 0.15 * f.p : 0.95 + 0.1 * f.p,
      bloom: hot ? 0.7 + 0.3 * f.p : 0.65,
      vignette: 0.4,
      ca: hot ? 2.0 + 2.0 * f.p : 1.4,
    };
  }
}
