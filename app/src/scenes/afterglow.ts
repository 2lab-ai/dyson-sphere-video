// Plate — AFTERGLOW (outro). The finished sphere: a sealed, dark hex-paneled Dyson shell whose seams glow
// and whose star leaks out only as a faint infrared halo. The camera pulls back from it into a wide
// starfield while neon aurora ribbons trail across the sky; kicks pulse the seams. A glitch-in title card
// ("DYSON SPHERE" / "Sentient Architect") holds over the wind-down, then everything fades to black.
import * as THREE from 'three';
import { ShaderScene } from './_shader';
import type { Frame } from '../engine/scene';
import { Layer2D } from '../engine/gl';
import { F, font, measure } from '../engine/type';
import { clamp, ease, hash, prog, smoothstep } from '../engine/util';

const T_TITLE_IN = 214.0;
const T_TITLE_OUT = 228.0;
const T_BLACK = 231.8;

export default class Afterglow extends ShaderScene {
  private title!: Layer2D;
  private titleOn: THREE.IUniform<number> = { value: 0 };
  private titleTex: THREE.IUniform<THREE.Texture | null> = { value: null };
  private lastKey = '';

  override init() {
    this.title = new Layer2D();
    this.titleTex.value = this.title.texture;
    return super.init();
  }

  protected override uniforms() {
    return { uTitle: this.titleTex, uTitleOn: this.titleOn };
  }

  protected glsl() {
    return /* glsl */ `
    uniform sampler2D uTitle;
    uniform float uTitleOn;

    // hex grid: xy = offset from the cell centre, zw = cell id (inradius 0.5)
    vec4 hexGrid(vec2 p) {
      const vec2 s = vec2(1.0, 1.7320508);
      vec4 hc = floor(vec4(p, p - vec2(0.5, 1.0)) / s.xyxy) + 0.5;
      vec4 h = vec4(p - hc.xy * s, p - (hc.zw + 0.5) * s);
      return dot(h.xy, h.xy) < dot(h.zw, h.zw) ? vec4(h.xy, hc.xy) : vec4(h.zw, hc.zw + 0.5);
    }
    float hexEdge(vec2 q) { q = abs(q); return 0.5 - max(dot(q, vec2(0.5, 0.8660254)), q.x); }

    // starfield that recedes (camera pulling back): layers cycle in depth
    vec3 stars(vec2 p, float pull) {
      vec3 col = vec3(0.0);
      for (int L = 0; L < 4; L++) {
        float fl = float(L);
        float d = fract(fl * 0.25 + pull);          // 0 = near (big), 1 = far (small)
        float sc = mix(4.0, 26.0, d);
        float fade = smoothstep(0.0, 0.25, d) * smoothstep(1.0, 0.75, d);
        vec2 q = p * sc + fl * 37.1;
        vec2 id = floor(q), f = fract(q) - 0.5;
        vec2 h = hash22(id + fl * 13.0);
        vec2 o = (h - 0.5) * 0.7;
        float r = length(f - o);
        float b = hash12(id * 1.7 + 3.1);
        float tw = 0.6 + 0.4 * sin(uT * (2.0 + 5.0 * b) + b * 40.0);
        vec3 tint = mix(C_BONE, mix(C_CYAN, C_PINK, step(0.5, h.x)), step(0.72, b));
        col += tint * (smoothstep(0.06, 0.0, r) * 1.6 + exp(-r * 22.0) * 0.25) * step(0.62, b) * fade * tw;
      }
      return col;
    }

    // neon aurora ribbons trailing across the sky
    vec3 aurora(vec2 p, float energy) {
      vec3 col = vec3(0.0);
      for (int i = 0; i < 4; i++) {
        float fi = float(i);
        float sp = 0.25 + 0.07 * fi;
        float y0 = -0.55 + 0.3 * fi + 0.06 * sin(uT * 0.13 + fi);
        float curve = y0 + 0.22 * sin(p.x * (0.9 + 0.25 * fi) + uT * sp + fi * 1.9)
                         + 0.08 * snoise(vec2(p.x * 1.3 + uT * 0.2, fi * 7.0));
        float dy = p.y - curve;
        // curtain: sharp bottom edge, long soft tail upward
        float band = exp(-abs(dy) * 34.0) * 1.2 + exp(-max(dy, 0.0) * 5.5) * step(0.0, dy) * 0.35;
        float streak = 0.55 + 0.45 * snoise(vec2(p.x * 11.0 - uT * 0.6 * sp, fi * 3.3));
        float along = 0.5 + 0.5 * sin(p.x * 1.7 - uT * 0.9 + fi * 2.4);
        vec3 c = fi < 0.5 ? C_CYAN : fi < 1.5 ? C_PINK : fi < 2.5 ? C_LIME : C_VIOLET;
        col += c * band * streak * (0.35 + 0.65 * along) * (0.5 + 0.5 * energy + 0.35 * uKick * energy);
      }
      return col * 0.55;
    }

    vec3 plate(vec2 p) {
      // pull-back: sphere shrinks and rises to make room for the title
      float k = smoothstep(202.6, 217.0, uT);
      float kk = k * k * (3.0 - 2.0 * k);
      float R = mix(0.78, 0.25, kk) - 0.06 * smoothstep(217.0, 232.0, uT);
      vec2 C = vec2(0.10 * (1.0 - kk) + 0.04 * sin(uT * 0.21), mix(0.0, 0.30, kk));
      float energy = 1.0 - smoothstep(221.0, 231.0, uT);
      float pull = uLt * 0.045 + 0.5 * kk;

      vec3 col = C_INK * 0.35 + C_VIOLET * 0.035 * (1.0 - 0.4 * length(p));
      col += stars(p, pull);
      vec3 aur = aurora(p, energy);

      vec2 d = p - C;
      float r = length(d);
      float inside = smoothstep(R + 0.004, R - 0.004, r);

      // infrared halo: the only starlight that gets out
      float out_ = max(r - R, 0.0) / R;
      vec3 halo = vec3(0.30, 0.012, 0.02) * exp(-out_ * 4.0) * (0.35 + 0.25 * uLow + 0.25 * uKick * energy);
      halo += C_EMBER * exp(-out_ * 30.0) * 0.35;
      col += (aur + halo) * (1.0 - inside);

      if (inside > 0.0) {
        vec3 n = vec3(d / R, 0.0);
        n.z = sqrt(max(1.0 - dot(n.xy, n.xy), 0.0));
        // rotate the shell: axis tilt + spin
        vec3 m = n;
        m.yz = rot2(0.42) * m.yz;
        m.xz = rot2(uT * 0.11) * m.xz;
        float lon = atan(m.z, m.x);
        float lat = asin(clamp(m.y, -1.0, 1.0));
        const float K = 34.0 / 6.2831853;
        vec2 uv = vec2(lon * K, lat * K * 1.15);
        vec4 hg = hexGrid(uv);
        float e = hexEdge(hg.xy);
        float cw = fwidth(e) + 0.004;
        float seam = smoothstep(0.022 + cw, 0.0, e);
        float seamGlow = exp(-e * 70.0);
        float cellH = hash12(hg.zw + 7.0);

        float fres = pow(1.0 - n.z, 2.5);
        float light = sat(dot(n, normalize(vec3(-0.5, 0.6, 0.6))));
        // dark panels with subtle per-panel variation and rim sheen
        vec3 panel = C_INK2 * (0.12 + 0.22 * cellH) * (0.3 + 0.7 * light) + C_VIOLET * fres * 0.25;
        // a few panels still glowing faintly (vents)
        panel += C_EMBER * smoothstep(0.93, 0.99, cellH) * (0.5 + 0.5 * sin(uT * 1.3 + cellH * 30.0)) * 0.6 * (1.0 - fres);

        // seams: hot gold core, kick pulse, a wave sweeping pole to pole
        float wave = exp(-pow((lat - (fract(uT * 0.08) * 3.6 - 1.8)) * 3.0, 2.0));
        float pulse = 0.55 + 2.4 * uKick * energy + 0.4 * uLow + 1.2 * wave;
        vec3 seamC = mix(C_GOLD, C_EMBER, 0.35 + 0.35 * sin(lon * 3.0 + uT * 0.5));
        seamC = mix(seamC, C_PINK, 0.25 * fres);
        vec3 shell = panel + seamC * (seam * 1.8 + seamGlow * 0.12) * pulse * (0.35 + 0.65 * (1.0 - fres * 0.6));
        // aurora reflection on the rim
        shell += aur * fres * 0.7 + C_CYAN * fres * 0.12;
        col = mix(col, shell, inside);
      }

      // title card (canvas texture, sRGB decoded to linear on sample)
      if (uTitleOn > 0.0) {
        vec4 tt = texture(uTitle, vUv);
        col *= 1.0 - 0.55 * tt.a * uTitleOn;
        col += tt.rgb * tt.a * 1.5 * uTitleOn;
      }
      return col;
    }`;
  }

  private drawTitle(t: number) {
    const L = this.title, c = L.ctx;
    // quantise the glitch clock so jitter steps at ~24 fps (deterministic from t)
    const step = Math.floor(t * 24);
    const lt = t - T_TITLE_IN;
    const glitch = 1 - prog(lt, 0.0, 1.4, ease.outCubic); // strong at the start, settles
    const aftershock = lt > 5 && hash(step, 91) > 0.93 ? 0.35 : 0; // occasional small re-glitch while holding
    const g = Math.max(glitch, aftershock);
    const key = `${step}:${g.toFixed(3)}:${(Math.round(t * 30))}`;
    if (key === this.lastKey) return;
    this.lastKey = key;

    L.clear();
    const cx = 960;
    const bigFam = F.archivo(125, 900), subFam = F.mono(500);
    const bigSize = Math.min(200, 1500 / (measure('DYSON SPHERE', bigFam, 100, 6) / 100));
    const trackBig = bigSize * 0.03;
    const bigW = measure('DYSON SPHERE', bigFam, bigSize, trackBig);
    const bigY = 700;
    const subSize = 40, subTrack = 22;
    const subText = 'Sentient Architect';
    const subW = measure(subText, subFam, subSize, subTrack);
    const subY = bigY + 95;

    const glow = 0.6 + 0.4 * Math.sin(t * 1.4);

    c.textBaseline = 'alphabetic';
    const drawLine = (text: string, fam: string, size: number, track: number, x0: number, y: number, subDelay: number) => {
      const chars = Array.from(text);
      c.font = font(fam, size);
      (c as any).letterSpacing = `${track}px`;
      let visible = '';
      for (let i = 0; i < chars.length; i++) {
        const on = hash(i, subDelay * 7 + 3) * 0.8 + 0.1 < clamp((lt - subDelay) / 0.9);
        visible += on || chars[i] === ' ' ? chars[i]! : (g > 0.2 && hash(i, step) > 0.6 ? '#/<>_|'[Math.floor(hash(i, step, 2) * 6)]! : ' ');
      }
      // slices with horizontal jitter; RGB split in pink / cyan, bone-white core
      const top = y - size * 0.95, h = size * 1.2;
      const slices = 7;
      for (let s = 0; s < slices; s++) {
        const sy = top + (h * s) / slices, sh = h / slices + 1;
        const jit = g * (hash(step, s, subDelay) - 0.5) * 120 * (hash(step, s, 5) > 0.45 ? 1 : 0.1);
        c.save();
        c.beginPath(); c.rect(0, sy, 1920, sh); c.clip();
        const split = 4 + g * 18;
        c.globalCompositeOperation = 'lighter';
        c.shadowBlur = 0;
        c.fillStyle = 'rgba(255,43,214,0.85)';
        c.fillText(visible, x0 + jit - split, y);
        c.fillStyle = 'rgba(0,229,255,0.85)';
        c.fillText(visible, x0 + jit + split, y);
        c.globalCompositeOperation = 'source-over';
        c.shadowColor = `rgba(255,120,230,${0.5 + 0.4 * glow})`;
        c.shadowBlur = 8 + 14 * glow;
        c.fillStyle = '#fff4fb';
        c.fillText(visible, x0 + jit, y);
        c.restore();
      }
      (c as any).letterSpacing = '0px';
    };
    drawLine('DYSON SPHERE', bigFam, bigSize, trackBig, cx - bigW / 2, bigY, 0);
    drawLine(subText, subFam, subSize, subTrack, cx - subW / 2, subY, 0.35);

    // thin neon rule between the lines, drawn outward from the centre
    const ruleW = (bigW * 0.5) * prog(lt, 0.3, 1.5, ease.outCubic);
    c.fillStyle = `rgba(0,229,255,${0.55 + 0.3 * glow})`;
    c.shadowColor = 'rgba(0,229,255,0.9)'; c.shadowBlur = 14;
    c.fillRect(cx - ruleW, bigY + 32, ruleW * 2, 3);
    c.shadowBlur = 0;
    L.upload();
  }

  protected override frame(f: Frame) {
    const t = f.t;
    const on = smoothstep(T_TITLE_IN, T_TITLE_IN + 0.25, t) * (1 - smoothstep(T_TITLE_OUT - 1.2, T_TITLE_OUT, t));
    this.titleOn.value = on;
    if (on > 0) this.drawTitle(t);
    const fade = smoothstep(T_BLACK - 2.5, T_BLACK, t);
    return { fade: t >= T_BLACK ? 1 : fade, exposure: 1.0, bloom: 0.55, bloomThreshold: 1.3, halation: 0.06, vignette: 0.5};
  }
}
