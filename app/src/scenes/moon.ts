// MOON — p17 (1 bar, T3), Korean ink wash (sumuk) on grey hanji. The debris ring left by the Theia impact
// is a tilted ring of dry-brush ink strokes and spatter over misty granite peaks (after Jeong Seon). On each
// beat one stroke sweeps inward and lands as a wet wash around the moon: the moon itself is never painted,
// it is the paper left bare by the wash around it (烘雲托月, "paint the clouds to reveal the moon"). Four
// beats, four strokes: quarter, half, gibbous, full. The wash bleeds outward with a pooled, darkened front
// and is wet-dark on the beat; spatter flies from each landing stroke. On the last beat the framing returns
// to the exit position (the moon becomes the pop-up book's sun) and a red seal (낙관) is stamped.
// Structure comes from ./moon.shots via shotAt (framing + topology + seal).
import * as THREE from 'three';
import type { Frame, PostOverrides } from '../engine/scene';
import { Layer2D } from '../engine/gl';
import { palette, pcss, plin } from '../engine/palette';
import { F, font } from '../engine/type';
import { beatPulse, kickPulse, downbeatPulse } from '../engine/beat';
import { shotAt, type PlateInfo, type Shot } from '../engine/shots';
import { hash, clamp, pulse } from '../engine/util';
import { ShaderScene } from './_shader';
import { shots, type Cam } from './moon.shots';

const W = 1920, H = 1080;
/** Screen px (top-left origin) -> shader p units (short side spans -1..1, y up). */
const toP = (x: number, y: number): [number, number] => [(x - W / 2) / (H / 2), (H / 2 - y) / (H / 2)];

// framing per state: moon centre on screen (px), scale, roll. `exit` = the storyboard subject (1187, 413).
const CAM: Record<Cam, { x: number; y: number; s: number; roll: number }> = {
  wide: { x: 900, y: 560, s: 0.78, roll: 0 }, // the ring where the impact left it (p16's planets)
  centre: { x: 960, y: 520, s: 1.22, roll: -0.07 },
  close: { x: 610, y: 600, s: 2.05, roll: 0.06 },
  exit: { x: 1187, y: 413, s: 1.0, roll: 0 },
};

const GLSL = /* glsl */ `
uniform vec3 uGround, uDeep, uMid;
uniform vec4 uCam;   // moon centre on screen (p units), scale, roll
uniform vec4 uSt;    // song time minus each stroke's beat (negative = not yet)
uniform float uBp, uFull;

const float R = 0.36;          // moon radius (world)
const float RR = 2.35 * R;     // debris ring radius
const float TH0 = 2.35;        // first stroke's angle

float sq(float x) { return x * x; }
float wrapA(float a) { return mod(a + PI, 2.0 * PI) - PI; }
float easeOut(float x) { x = sat(x); return 1.0 - (1.0 - x) * (1.0 - x) * (1.0 - x); }
float gatherOf(float st) { return st < 0.0 ? 0.0 : easeOut(st / 0.34); }
float bleedOf(float st) { return st < 0.03 ? 0.0 : easeOut((st - 0.03) / 0.6); }

// one dry-brush stroke of the ring, gathering with g (0 = on the ring, 1 = landed on the moon's rim)
float stroke(vec2 w, float i, float g, float st) {
  float rad = mix(RR, R * 1.1, g);
  float fl = mix(0.3, 1.0, g), tilt = mix(-0.22, 0.0, g);
  float half_ = mix(0.46, 0.84, g);
  float th = TH0 + i * PI * 0.5 - (1.0 - g) * 0.35; // the stroke swings round as it falls in
  vec2 q = rot2(-tilt) * w;
  q.y /= fl;
  float r = length(q), a = atan(q.y, q.x);
  float al = wrapA(a - th) / half_;                  // -1..1 along the stroke (1 = tail)
  if (abs(al) > 1.15) return 0.0;
  float press = 1.0 - pow(sat(abs(al)), 3.0);        // brush pressure: fat belly, tapered ends
  press *= mix(1.0, 0.65, sat(al));                  // lifts off towards the tail
  float wid = mix(0.055, 0.085, g) * press + 0.004;
  float d = abs(r - rad - 0.012 * snoise(vec2(a * 3.0, i * 7.0)));
  float body = 1.0 - smoothstep(wid * 0.5 - 0.004, wid * 0.5 + 0.004, d);
  // dry brush: bristle streaks along the stroke, more broken towards the tail and when it moves fast
  float speed = st > 0.0 && st < 0.34 ? 1.0 - st / 0.34 : 0.0;
  float bristle = snoise(vec2(a * rad * 70.0, (r - rad) / max(wid, 1e-3) * 5.0 + i * 13.0));
  float dry = smoothstep(-0.55 + 0.9 * sat(al * 0.5 + 0.5) + 0.35 * speed, 0.2 + 0.9 * sat(al * 0.5 + 0.5), bristle);
  float ends = 1.0 - smoothstep(0.95, 1.15, abs(al));
  float ink = body * ends * mix(0.35, 1.0, dry);
  // once landed it soaks into the wash and stays as a darker rim
  float soak = st > 0.0 ? 1.0 - 0.55 * smoothstep(0.35, 1.0, st) : 1.0;
  return ink * soak * 1.25;
}

// the debris spatter on the ring; each dot belongs to one stroke and is swept in with it
float debris(vec2 w, vec4 g) {
  vec2 q = rot2(0.22) * w;
  q.y /= 0.3;
  float a = atan(q.y, q.x);
  float cells = 84.0;
  float c0 = floor((a + PI) / (2.0 * PI) * cells);
  float d = 0.0;
  for (int k = -1; k <= 1; k++) {
    float c = mod(c0 + float(k), cells);
    float ca = (c + hash11(c * 1.7)) / cells * 2.0 * PI - PI;
    float quarter = mod(floor(wrapA(ca - TH0 + PI * 0.25 + 0.35) / (PI * 0.5) + 4.0), 4.0);
    float gg = quarter < 0.5 ? g.x : quarter < 1.5 ? g.y : quarter < 2.5 ? g.z : g.w;
    float rr = RR * (0.86 + 0.3 * hash11(c * 3.1)) * (1.0 - 0.5 * gg);
    vec2 dp = rot2(-0.22) * vec2(cos(ca), sin(ca) * 0.3) * rr;
    float sz = (0.004 + 0.012 * pow(hash11(c * 5.3), 2.0)) * (1.0 - gg);
    float dd = length(w - dp) - sz * (1.0 + 0.25 * snoise(w * 90.0));
    d = max(d, 1.0 - smoothstep(-0.002, 0.002, dd));
  }
  return d;
}

// spatter flung out when stroke i lands
float spatter(vec2 w, float i, float st) {
  if (st < 0.0) return 0.0;
  float th = TH0 + i * PI * 0.5;
  vec2 o = vec2(cos(th), sin(th)) * R * 1.25;
  float fly = easeOut(st / 0.18);
  float d = 0.0;
  for (int k = 0; k < 12; k++) {
    float h1 = hash11(i * 17.0 + float(k) * 1.37), h2 = hash11(i * 29.0 + float(k) * 2.11);
    float ang = th + (h1 - 0.5) * 1.6;
    vec2 p = o + vec2(cos(ang), sin(ang)) * (0.08 + 0.5 * h2) * fly;
    float sz = 0.003 + 0.011 * pow(hash11(float(k) * 4.7 + i), 2.0);
    d = max(d, 1.0 - smoothstep(-0.0015, 0.0015, length(w - p) - sz));
  }
  return d;
}

// the wash around the moon (the moon is the paper it leaves bare); returns (wash density, ink density)
vec2 halo(vec2 w, vec4 st, float ab) {
  float r = length(w), a = atan(w.y, w.x);
  float wash = 0.0, ink = 0.0;
  for (int k = 0; k < 4; k++) {
    float i = float(k);
    float s = st[k];
    float b = bleedOf(s);
    if (b <= 0.0) continue;
    float th = TH0 + i * PI * 0.5;
    float da = abs(wrapA(a - th));
    float edge = 0.12 * snoise(vec2(r * 9.0, i * 5.0));
    float sect = 1.0 - smoothstep(PI * 0.25 - 0.02, PI * 0.25 + 0.2, da + edge);
    sect = max(sect, uFull * 1.0);
    // the bleed front: a threshold sweep over distance with a ragged, paper-dependent edge
    float front = R + (0.06 + 0.95 * b) * R * (1.0 + 0.35 * fbm(w * 5.0 + i, 3)) + 0.02 * ab;
    float inside = smoothstep(front + 0.006, front - 0.006, r) * step(R, r + 0.004 * snoise(w * 60.0));
    float body = 0.85 * exp(-(r - R) / (0.6 * R)) * (0.75 + 0.5 * ab);
    float pool = 0.55 * exp(-max(front - r, 0.0) / 0.018);              // the drying front darkens
    float rim = 0.9 * exp(-max(r - R, 0.0) / 0.012) * step(R - 0.003, r); // the moon's edge, cut clean
    float wet = 1.0 + 0.5 * exp(-max(s, 0.0) / 0.2);                    // wet-dark when it lands
    wash = max(wash, sect * inside * (body + pool) * wet);
    ink = max(ink, sect * rim * smoothstep(0.0, 0.25, b) * 0.6);
  }
  // inside the disc: a faint mare wash, only where the strokes have landed
  if (r < R) {
    float cov = 0.0;
    for (int k = 0; k < 4; k++) {
      float th = TH0 + float(k) * PI * 0.5;
      cov = max(cov, (1.0 - smoothstep(PI * 0.25, PI * 0.25 + 0.3, abs(wrapA(a - th)))) * bleedOf(st[k] - 0.1));
    }
    cov = max(cov, uFull);
    float mare = smoothstep(0.05, 0.55, fbm(w * 4.2 + 3.0, 4)) * 0.22 + smoothstep(0.35, 0.7, fbm(w * 11.0, 3)) * 0.08;
    wash = max(wash, mare * cov * smoothstep(R, R - 0.03, r));
  }
  return vec2(wash, ink);
}

// granite peaks in mist (Inwangsan after rain), bottom-left of the moon
vec2 peaks(vec2 w) {
  float x = w.x;
  float h1 = -0.95 + 0.62 * exp(-sq((x + 1.55) / 0.42)) + 0.4 * exp(-sq((x + 0.85) / 0.3))
           + 0.22 * exp(-sq((x + 2.25) / 0.35)) + 0.05 * fbm(vec2(x * 3.0, 1.0), 3);
  float h2 = -1.25 + 0.5 * exp(-sq((x + 0.2) / 0.55)) + 0.3 * exp(-sq((x + 1.2) / 0.5)) + 0.04 * fbm(vec2(x * 4.0, 7.0), 3);
  float wash = 0.0, ink = 0.0;
  // far ridge: pale wash, fading down into mist
  if (w.y < h1) {
    float depth = h1 - w.y;
    float mist = 1.0 - smoothstep(0.05, 0.5 + 0.15 * snoise(vec2(x * 2.0, 3.0)), depth);
    float pool = exp(-depth / 0.015);
    float cun = smoothstep(0.35, 0.85, snoise(vec2(x * 34.0, w.y * 2.2))) * (1.0 - smoothstep(0.0, 0.35, depth)); // vertical rock strokes
    wash += (0.55 * mist + 0.4 * pool);
    ink += 0.55 * cun + 0.25 * pool;
  }
  // near ridge: darker, lower, also dissolving into mist
  if (w.y < h2) {
    float depth = h2 - w.y;
    float mist = 1.0 - smoothstep(0.02, 0.35, depth);
    wash += 1.1 * mist + 0.6 * exp(-depth / 0.012);
    ink += 0.4 * smoothstep(0.4, 0.8, snoise(vec2(x * 26.0, w.y * 3.0))) * mist;
  }
  return vec2(wash, ink);
}

vec3 plate(vec2 p) {
  vec2 w = rot2(-uCam.w) * (p - uCam.xy) / uCam.z;
  // hanji: paper absorption mottling and long fibres (kept around zero mean so the ground stays the ground)
  float ab = fbm(w * 7.0, 3);
  float fib = smoothstep(0.55, 0.95, snoise(rot2(0.4) * w * vec2(6.0, 140.0))) - 0.15;
  float Dw = 0.035 * ab + 0.02 * fib;
  float Di = 0.0;

  vec2 m = peaks(w);
  Dw += m.x * (0.85 + 0.3 * ab);
  Di += m.y;

  vec4 g = vec4(gatherOf(uSt.x), gatherOf(uSt.y), gatherOf(uSt.z), gatherOf(uSt.w));
  vec2 h = halo(w, uSt, ab);
  Dw += h.x * (1.0 + 0.3 * uBp); // the wash reads wet-dark on every beat
  Di += h.y;

  float s = 0.0;
  s = max(s, stroke(w, 0.0, g.x, uSt.x));
  s = max(s, stroke(w, 1.0, g.y, uSt.y));
  s = max(s, stroke(w, 2.0, g.z, uSt.z));
  s = max(s, stroke(w, 3.0, g.w, uSt.w));
  s = max(s, debris(w, g));
  for (int k = 0; k < 4; k++) s = max(s, spatter(w, float(k), uSt[k]));
  Di += s * (0.9 + 0.2 * ab);

  // Beer-style layering: wash density darkens towards the grey wash, ink density towards the ink
  vec3 G = max(uGround, vec3(1e-3));
  vec3 c = G * pow(max(uMid, vec3(1e-3)) / G, vec3(max(Dw, 0.0)));
  c *= pow(max(uDeep, vec3(1e-3)) / G, vec3(clamp(Di, 0.0, 1.2)));
  return c;
}
`;

export default class Moon extends ShaderScene {
  private list: Shot[] = [];
  private strokeT: number[] = [];
  private tSeal = Infinity;
  private seal: Layer2D | null = null;
  private P = palette('sumuk');

  protected glsl() { return GLSL; }

  protected override uniforms(): Record<string, THREE.IUniform> {
    this.P = palette(this.ctx.params.look?.palette ?? 'sumuk');
    return {
      uGround: { value: new THREE.Vector3(...plin(this.P, 'ground')) },
      uDeep: { value: new THREE.Vector3(...plin(this.P, 'deep')) },
      uMid: { value: new THREE.Vector3(...plin(this.P, 'mid')) },
      uCam: { value: new THREE.Vector4(0, 0, 1, 0) },
      uSt: { value: new THREE.Vector4(-9, -9, -9, -9) },
      uBp: { value: 0 },
      uFull: { value: 0 },
    };
  }

  override init() {
    const plate = this.ctx.params as PlateInfo;
    this.list = shots(plate, this.ctx.audio);
    // the four strokes land on the plate's beats (the shot times after the start are those beats)
    const bs = this.ctx.audio.beats.filter((b) => b >= this.ctx.start - 1e-3 && b < this.ctx.end - 1 / 60);
    const dur = this.ctx.end - this.ctx.start;
    for (let i = 0; i < 4; i++) this.strokeT.push(bs[i] ?? this.ctx.start + (i * dur) / 4);
    const sealShot = this.list.find((s) => s.s.seal === true);
    this.tSeal = sealShot ? sealShot.t : this.strokeT[3]!;
    super.init();
  }

  private camAt(t: number) {
    const sh = shotAt(this.list, t);
    const c = CAM[sh.shot.s.cam as Cam];
    const lt = t - sh.t0;
    // hold then snap: a slow push inside each shot, the new framing lands on the beat
    const s = c.s * (1 + 0.035 * lt);
    return { c, s, lt };
  }

  protected override frame(f: Frame): PostOverrides {
    const au = this.ctx.audio, t = f.t, u = this.pass.u;
    const { c, s } = this.camAt(t);
    const [px, py] = toP(c.x, c.y);
    (u.uCam!.value as THREE.Vector4).set(px, py, s, c.roll);
    const st = this.strokeT.map((b) => t - b);
    (u.uSt!.value as THREE.Vector4).set(st[0]!, st[1]!, st[2]!, st[3]!);
    const bp = beatPulse(au, t, 0.14), kick = kickPulse(au, t, 0.1), db = downbeatPulse(au, t, 0.25);
    u.uBp!.value = bp;
    u.uFull!.value = clamp((t - this.tSeal - 0.05) / 0.4);

    // authored hits (T3): every stroke landing is a punch-in + shake; the seal is the biggest
    const hit = (t0: number) => (t < t0 ? 0 : t - t0 < 2 / 60 ? 1 : pulse(t, t0 + 2 / 60, 0.03));
    let hs = 0;
    for (const b of this.strokeT) hs = Math.max(hs, hit(b));
    const hSeal = hit(this.tSeal);
    const sk = 7 * hs + 12 * hSeal + 2 * kick;
    const ang = hash(Math.floor(t * 60), 17) * Math.PI * 2;
    return {
      zoom: 1 + 0.045 * hs + 0.03 * hSeal + 0.015 * db,
      shake: [sk * Math.cos(ang), sk * Math.sin(ang)],
      exposure: 1 - 0.05 * hs,
      vignette: 0.18,
      grain: 0.05,
      ca: 0,
      bloom: 0,
      flash: 0,
    };
  }

  /** The red seal (낙관), carved white: the character for the moon, cut out of a rough vermilion block. */
  private drawSeal(t: number) {
    const L = (this.seal ??= new Layer2D());
    const c = L.ctx;
    L.clear();
    const lt = t - this.tSeal;
    const x = 1596, y = 842, sz = 112;
    // stamped: lands oversize for two frames, then presses flat
    const k = lt < 2 / 60 ? 1.22 : 1 + 0.22 * pulse(lt, 2 / 60, 0.025);
    c.save();
    c.translate(x, y);
    c.rotate(-0.045);
    c.scale(k, k);
    // rough block edge
    c.beginPath();
    const n = 28;
    for (let i = 0; i < n * 4; i++) {
      const side = Math.floor(i / n), f = (i % n) / n, j = (hash(i, 3) - 0.5) * 3.2;
      const e = sz / 2;
      const [px, py] = side === 0 ? [-e + f * sz, -e + j] : side === 1 ? [e + j, -e + f * sz] : side === 2 ? [e - f * sz, e + j] : [-e + j, e - f * sz];
      if (i === 0) c.moveTo(px, py); else c.lineTo(px, py);
    }
    c.closePath();
    c.fillStyle = pcss(this.P, 'hi', 0.95);
    c.fill();
    // carved character, white relief (백문)
    c.globalCompositeOperation = 'destination-out';
    c.font = font(F.slam(), 78);
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText('달', 0, 4);
    // ink starvation: specks where the paste did not take
    for (let i = 0; i < 90; i++) {
      const sx = (hash(i, 7) - 0.5) * sz, sy = (hash(i, 9) - 0.5) * sz, r = 0.6 + 2.2 * hash(i, 11) ** 3;
      c.beginPath(); c.arc(sx, sy, r, 0, Math.PI * 2); c.fill();
    }
    c.globalCompositeOperation = 'source-over';
    c.restore();
    return L.upload();
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget) {
    const ov = super.render(f, out);
    if (f.t >= this.tSeal) this.ctx.comp.draw(this.ctx.renderer, this.drawSeal(f.t), out, { mode: 'normal' });
    return ov;
  }

  override dispose() {
    this.seal?.texture.dispose();
    this.pass?.mat.dispose();
  }
}
