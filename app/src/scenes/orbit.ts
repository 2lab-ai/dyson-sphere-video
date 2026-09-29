// ORBIT — solid 3D: a star and the collector panels put on orbits around it, lit by the star itself.
// Three plates (data/edit.json variant):
//   launch  (p13, drop-1 entry, T3)  the star's huge silhouette -> sparse orbits, 3/4 -> a dense collector plane
//            -> a giant disc of panels occluding the star (top). Every beat fires a panel volley off the star that
//            snaps into orbit (ringLaunch overshoot); every downbeat inverts the whole frame for one beat.
//   ring    (p15, T3)  through the gaps between ring bands -> behind the star: panel silhouettes on the overexposed
//            star (one white frame, then that bar in negative) -> extreme wide, rings closed -> the star flares to
//            white. Every beat all panels flip half a turn (edge-on mid-flip: the rings open for a moment) and the
//            star flares.
//   capture (p24, T2, line 24)  a cage of panel rings around the line: rings swing in and clang shut on the beats
//            (2 px jolt, 1-frame hold) -> inside the cage, the words pressed to the bars -> the cage spins to a blur.
//   swarm   (p41, outro, T1, no lyric; palette `swarm`)  AI launches the swarm. Every beat a volley of collectors is
//            fired from the camera's own vantage (the AI's eye of p40 has just become the Sun): tracers streak in,
//            accelerate, and SNAP into a new inclined orbit ring exactly on the beat (the tracer turns into a lit panel
//            facing the Sun, a radial spring and a heat flash; the whole swarm answers with a ripple). Shots: a
//            lateral track in orbit near the ring plane (near panels whip past as dark silhouettes) -> a high 3/4 wide
//            where the swarm rings the Sun -> on the last beat every ring widens into a closed band (the shell to
//            come). Match-circle: the Sun is pinned to the storyboard anchor (1187,413) by an off-axis view offset, and
//            its photosphere radius is set by camera distance: SUN_R0 px on the first frame (continues p40's eye),
//            SUN_R1 px on the last frame (p42's oculus).
// The line is drawn with drawLyric onto a Canvas2D layer that is a plane INSIDE the cage (depth-tested: the front
// bars pass over the words). Everything is a pure function of song time: panel pose = f(index, t).
import * as THREE from 'three';
import { Scene, type Frame, type PostOverrides } from '../engine/scene';
import { Layer2D, FSPass, clearRT, makeRT } from '../engine/gl';
import { LIN, palette, plin, type NamedPalette } from '../engine/palette';
import { drawLyric, layoutLine, ownedLines, F } from '../engine/lyric';
import { beatPulse, kickPulse, downbeatPulse, beatIndex } from '../engine/beat';
import { stateAt, beatTimes, type PlateInfo, type Shot } from '../engine/shots';
import { ringLaunch, igniteRamp, decay } from '../engine/prim';
import { hash, clamp, smoothstep, lerp, TAU } from '../engine/util';
import type { Line } from '../engine/lyrics';
import { shots } from './orbit.shots';

const MAXN = 3400;
const FR = 1 / 60;
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const col = (k: keyof typeof LIN, s = 1) => new THREE.Color().setRGB(LIN[k][0] * s, LIN[k][1] * s, LIN[k][2] * s);

/** Storyboard hit envelope: full for 2 frames, then outExpo decay over ~6 frames. dt = seconds since the hit. */
const env = (dt: number) => (dt < 0 ? 0 : dt < 2 * FR ? 1 : Math.pow(2, (-10 * (dt - 2 * FR)) / (6 * FR)));
const easeOut = (x: number) => 1 - Math.pow(1 - clamp(x), 3);

// swarm match-circle contract (1920x1080 logical px): Sun centre = storyboard anchor, photosphere radius at the cuts
const ANCHOR: [number, number] = [1187, 413];
const SUN_R0 = 76; // first frame: p40's eye (the animatic eye ring: r 70 + half its 18 px stroke)
const SUN_R1 = 110; // last frame: p42's oculus (the animatic vault oculus radius on its first frame)
const FLIGHT = 0.4; // s: a volley is fired this long before its beat and snaps into orbit on the beat
/** Camera distance (in Sun radii) that gives the Sun a photosphere radius of rPx at vertical fov (deg). */
const distFor = (rPx: number, fov: number) => 1 / Math.sin(Math.atan((rPx * Math.tan(((fov / 2) * Math.PI) / 180)) / 540));

const STAR_VERT = /* glsl */ `
varying vec3 vN; varying vec3 vP; varying vec3 vW;
void main() {
  vN = normalize(normalMatrix * normal); vP = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0); vW = -mv.xyz;
  gl_Position = projectionMatrix * mv;
}`;
const STAR_FRAG = /* glsl */ `
uniform vec3 uSig, uEmb, uBone, uInk2; uniform float uT, uExpo, uSil;
varying vec3 vN; varying vec3 vP; varying vec3 vW;
float h3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float n3(vec3 x) {
  const vec2 e = vec2(1.0, 0.0);
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h3(i), h3(i + e.xyy), f.x), mix(h3(i + e.yxy), h3(i + e.xxy), f.x), f.y),
             mix(mix(h3(i + e.yyx), h3(i + e.xyx), f.x), mix(h3(i + e.yxx), h3(i + e.xxx), f.x), f.y), f.z);
}
void main() {
  float mu = clamp(dot(normalize(vN), normalize(vW)), 0.0, 1.0);
  vec3 q = vP * 7.0 + vec3(0.0, uT * 0.25, 0.0);
  float g = n3(q) * 0.6 + n3(q * 2.3 + 4.0) * 0.3 + n3(q * 5.1) * 0.1;      // granulation
  float cell = smoothstep(0.35, 0.75, g);
  vec3 surf = mix(uSig * 1.1, uEmb * 2.2, cell) * (0.35 + 0.65 * pow(mu, 0.45)); // limb darkening
  surf = mix(surf, uBone * 3.0, smoothstep(0.55, 1.0, uExpo * 0.12) * pow(mu, 0.3));
  // silhouette: a dark body, only the limb burns
  vec3 sil = uInk2 * (0.5 + 0.6 * cell) + uSig * 0.05 * g + uEmb * 3.5 * pow(1.0 - mu, 5.0);
  gl_FragColor = vec4(mix(surf * uExpo, sil * max(1.0, uExpo * 0.5), uSil), 1.0);
}`;
const CORONA_FRAG = /* glsl */ `
uniform vec3 uSig, uEmb; uniform float uT, uGain, uR;
varying vec2 vUv;
float h1(float x) { return fract(sin(x * 127.1) * 43758.5453); }
float n1(float x) { float i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(h1(i), h1(i + 1.0), f); }
void main() {
  vec2 p = (vUv - 0.5) * 2.0 * uR;             // in star radii
  float r = length(p), a = atan(p.y, p.x);
  float streak = 0.55 + 0.45 * n1(a * 9.0 + uT * 0.3) * n1(a * 23.0 - uT * 0.2);
  float g = exp(-max(r - 1.0, 0.0) * mix(7.0, 2.2, streak)) * smoothstep(0.9, 1.0, r);
  vec3 c = mix(uEmb * 1.6, uSig, clamp((r - 1.0) * 1.5, 0.0, 1.0)) * g * uGain;
  gl_FragColor = vec4(c, 1.0);
}`;
const PLANE_VERT = /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

// Polarity swap in palette terms (not an RGB invert, which would turn the star cyan): the void becomes bone
// paper and the star an ink disc; mid-tones keep a trace of signal.
const NEG_FRAG = /* glsl */ `
uniform sampler2D tex; uniform float uNeg;
void main() {
  vec3 c = texture(tex, vUv).rgb;
  float l = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  float s = smoothstep(0.015, 0.5, l / (1.0 + l) * 1.6);
  vec3 neg = mix(C_BONE, C_INK, s) + C_SIGNAL * 0.22 * s * (1.0 - s) * 4.0 * (1.0 - s);
  fragColor = vec4(mix(c, neg, uNeg), 1.0);
}`;

interface Pose { p: THREE.Vector3; n: THREE.Vector3; u: THREE.Vector3; s: [number, number, number]; heat: number; sig?: number }

export default class Orbit extends Scene {
  private list: Shot[] = [];
  private plate!: PlateInfo;
  private lines: Line[] = [];
  private v = 'launch';
  private beats: number[] = [];
  private scene3 = new THREE.Scene();
  private cam = new THREE.PerspectiveCamera(40, 16 / 9, 0.05, 200);
  private panels!: THREE.InstancedMesh;
  private star!: THREE.Mesh;
  private starMat!: THREE.ShaderMaterial;
  private corona!: THREE.Mesh;
  private coronaMat!: THREE.ShaderMaterial;
  private light!: THREE.PointLight;
  private fill!: THREE.DirectionalLight;
  private amb!: THREE.AmbientLight;
  private traces: THREE.LineLoop[] = [];
  private layer?: Layer2D;
  private textPlane?: THREE.Mesh;
  private rt!: THREE.WebGLRenderTarget;
  private grade!: FSPass;
  private m4 = new THREE.Matrix4();
  private tmpC = new THREE.Color();
  private base = col('paper2');
  private hot = col('paper2', 6);
  private sigC = col('signal');
  private sigTmp = new THREE.Color();
  private P?: NamedPalette;

  override init() {
    this.plate = this.ctx.params as PlateInfo;
    this.v = this.plate.variant;
    this.list = shots(this.plate, this.ctx.audio);
    this.lines = ownedLines(this.ctx);
    this.beats = beatTimes(this.ctx.audio, this.plate.start - 0.01, this.plate.end);

    const S = this.scene3;
    this.rt = makeRT();
    this.grade = new FSPass(NEG_FRAG, { tex: { value: this.rt.texture }, uNeg: { value: 0 } });
    const sw = this.v === 'swarm';
    const P = sw ? palette((this.plate as PlateInfo & { look: { palette: string } }).look.palette) : undefined;
    this.P = P;
    const pc = (r: 'ground' | 'deep' | 'mid' | 'hi' | 'signal', k = 1) => { const c = plin(P!, r); return new THREE.Color().setRGB(c[0] * k, c[1] * k, c[2] * k); };
    if (P) { this.base = pc('mid'); this.hot = pc('hi', 3); this.sigC = pc('signal'); }
    const mat = new THREE.MeshStandardMaterial({ color: P ? new THREE.Color(1, 1, 1) : col('paper2'), roughness: 0.42, metalness: 0.35 });
    this.panels = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, MAXN);
    this.panels.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.panels.setColorAt(0, col('bone'));
    this.panels.frustumCulled = false;
    S.add(this.panels);

    const cu = P
      ? { uSig: { value: pc('signal') }, uEmb: { value: pc('hi') }, uBone: { value: pc('hi') }, uInk2: { value: pc('deep') }, uT: { value: 0 }, uExpo: { value: 1 }, uSil: { value: 0 } }
      : { uSig: { value: col('signal') }, uEmb: { value: col('ember') }, uBone: { value: col('bone') }, uInk2: { value: col('ink2') }, uT: { value: 0 }, uExpo: { value: 1 }, uSil: { value: 0 } };
    this.starMat = new THREE.ShaderMaterial({ uniforms: cu, vertexShader: STAR_VERT, fragmentShader: STAR_FRAG });
    this.star = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 64), this.starMat);
    S.add(this.star);
    this.coronaMat = new THREE.ShaderMaterial({
      uniforms: { uSig: cu.uSig, uEmb: cu.uEmb, uT: { value: 0 }, uGain: { value: 1 }, uR: { value: 3 } },
      vertexShader: PLANE_VERT, fragmentShader: CORONA_FRAG,
      blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
    });
    this.corona = new THREE.Mesh(new THREE.PlaneGeometry(6, 6), this.coronaMat);
    S.add(this.corona);

    this.light = new THREE.PointLight(P ? pc('hi') : col('ember'), 5, 0, 0);
    S.add(this.light);
    this.amb = new THREE.AmbientLight(P ? pc('deep') : col('graphite'), 0.18);
    S.add(this.amb);
    this.fill = new THREE.DirectionalLight(P ? pc('mid') : col('bone'), 0.12);
    S.add(this.fill, this.fill.target);

    // orbit traces (hairlines): unit circles in the xz plane, placed per ring each frame
    const circ: THREE.Vector3[] = [];
    for (let i = 0; i < 160; i++) circ.push(V(Math.cos((i / 160) * TAU), 0, Math.sin((i / 160) * TAU)));
    const lg = new THREE.BufferGeometry().setFromPoints(circ);
    const lm = new THREE.LineBasicMaterial({ color: col('graphite'), transparent: true, opacity: 0.55 });
    for (let k = 0; k < 12; k++) { const l = new THREE.LineLoop(lg, lm); l.visible = false; this.traces.push(l); S.add(l); }

    // swarm: the Sun sits on the optical axis, and an off-axis window moves it to the anchor (an exact circle there)
    if (sw) this.cam.setViewOffset(1920, 1080, 960 - ANCHOR[0], 540 - ANCHOR[1], 1920, 1080);

    if (this.lines.length) {
      this.layer = new Layer2D();
      const tm = new THREE.MeshBasicMaterial({ map: this.layer.texture, transparent: true, depthWrite: false, toneMapped: false });
      this.textPlane = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 5.6 * 9 / 16), tm);
      this.textPlane.renderOrder = 2;
      S.add(this.textPlane);
    }
  }

  /** Seconds since the last beat (Infinity before the first), from the beat pulse itself. */
  private sinceBeat(t: number) { const p = beatPulse(this.ctx.audio, t, 1); return p <= 0 ? Infinity : -Math.log(p); }
  /** Beats of this plate elapsed at t (0 = the first beat has hit). */
  private beatNo(t: number) { let k = -1; for (const b of this.beats) if (b <= t + 1e-6) k++; return k; }

  // ------------------------------------------------------------------ panel poses
  /** Orbital plane basis for ring (inclination, node): returns the in-plane point at angle th, radius r. */
  private onRing(r: number, th: number, inc: number, node: number, out: THREE.Vector3) {
    // (r cos th, 0, r sin th) tilted about x by inc, then about y by node
    const x = r * Math.cos(th), z0 = r * Math.sin(th);
    const y = -z0 * Math.sin(inc), z = z0 * Math.cos(inc);
    const cn = Math.cos(node), sn = Math.sin(node);
    return out.set(cn * x + sn * z, y, -sn * x + cn * z);
  }
  private ringNormal(inc: number, node: number, out: THREE.Vector3) {
    const y = Math.cos(inc), z = Math.sin(inc), cn = Math.cos(node), sn = Math.sin(node);
    return out.set(sn * z, y, cn * z);
  }

  private posesLaunch(t: number, topo: string, out: Pose[]) {
    const per = topo === 'volley' ? 18 : topo === 'sparse' ? 42 : topo === 'dense' ? 190 : 270;
    const nb = this.beatNo(t);
    const n = Math.min(MAXN, (nb + 1) * per);
    const tmp = V(), rn = V();
    for (let i = 0; i < n; i++) {
      const L = Math.floor(i / per), T = this.beats[L]!;
      const age = t - T;
      const lr = ringLaunch(age / 0.32);
      let r: number, inc: number, node: number, th: number;
      const hh = hash(i, 11), hk = hash(i, 5);
      if (topo === 'volley' || topo === 'sparse') {
        const k = i % 8;
        r = 1.75 + 0.48 * k + 0.05 * (hh - 0.5); inc = (hash(k, 1) - 0.5) * 1.3; node = hash(k, 2) * TAU;
        th = hk * TAU + 0.55 * Math.pow(r, -1.5) * (t - this.plate.start) * 1.6;
      } else if (topo === 'dense') {
        const k = i % 30;
        r = 1.45 + 0.19 * k + 0.06 * hh; inc = 0.012 * (hash(k, 3) - 0.5); node = 0;
        th = hk * TAU + 0.5 * Math.pow(r, -1.5) * (t - this.plate.start);
      } else {
        // disc: a Vogel-spiral sheet of panels lifted between camera and star, filled from the rim inward
        // volley by volley, so the last volleys close the disc over the star
        const NT = this.beats.length * per;
        r = 5.9 * Math.sqrt(1 - (i + 0.5) / NT); inc = 0; node = 0;
        th = i * 2.399963 + 0.12 * (t - this.plate.start);
      }
      const rr = 1.02 + (r - 1.02) * lr;
      const p = this.onRing(rr, th, inc, node, V());
      const heat = decay(age, 0.12);
      let nrm: THREE.Vector3, u: THREE.Vector3, s: [number, number, number];
      if (topo === 'disc') {
        p.y += lerp(0, 1.5, clamp(lr));
        nrm = V(0, -1, 0); u = V(-Math.sin(th), 0, Math.cos(th));
        s = [0.18, 0.185, 0.03];
      } else {
        nrm = p.clone().normalize();
        this.ringNormal(inc, node, rn);
        if (topo === 'dense') nrm.multiplyScalar(0.35).addScaledVector(rn, 0.94).normalize();
        u = tmp.crossVectors(rn, nrm).normalize().clone();
        s = topo === 'dense' ? [0.2, 0.2, 0.02] : [0.26, 0.17, 0.025];
      }
      out.push({ p, n: nrm, u, s, heat });
    }
  }

  private ringBands(t: number, topo: string, camK: string, out: Pose[]) {
    const closed = topo === 'closed';
    const start = this.plate.start;
    const nb = this.beatNo(t), b0 = this.beats[Math.max(0, nb)] ?? start;
    const bands: { r: number; inc: number; node: number }[] = [];
    for (let k = 0; k < 6; k++) bands.push({ r: 1.9 + 0.55 * k, inc: 0.16, node: 0.3 });
    bands.push({ r: 2.25, inc: 1.15, node: 1.9 }, { r: 3.35, inc: -0.95, node: 0.7 }, { r: 4.45, inc: 1.4, node: 3.1 });
    const rn = V();
    bands.forEach((b, k) => {
      const n = Math.round(b.r * 30);
      const w = (TAU * b.r) / n;
      this.ringNormal(b.inc, b.node, rn);
      // flip: half a turn per beat, rippling outward ring by ring
      // behind: the foreground silhouettes fill the frame, so every ring snaps together (no ripple) and turns an
      // extra quarter (edge-on for 3 frames, then settles) while it jumps along the ring normal with overshoot
      const behind = camK === 'behind', wide = camK === 'wide';
      const d = t - b0 - (behind ? 0 : k * 1.5 * FR);
      const flip = Math.PI * (Math.max(0, nb) + (nb < 0 ? 0 : easeOut(d / (9 * FR)))) - (d < 0 ? Math.PI : 0)
        + (behind && d >= 0 ? (Math.PI / 2) * (d < 3 * FR ? 1 : Math.exp(-(d - 3 * FR) / 0.09)) : 0);
      const jump = behind && d >= 0 ? 0.16 * Math.exp(-d / 0.1) * Math.cos(d * 28) : 0;
      const e = env(d);
      for (let j = 0; j < n; j++) {
        const th = (j / n) * TAU + 0.35 * Math.pow(b.r, -1.5) * (t - start) * (k % 2 ? -1 : 1);
        const p = this.onRing(b.r, th, b.inc, b.node, V());
        const radial = p.clone().normalize();
        const tang = V().crossVectors(rn, radial).normalize();
        // rotate the panel normal (radial) about the tangent by the flip angle
        const nrm = radial.clone().multiplyScalar(Math.cos(flip)).addScaledVector(rn, Math.sin(flip));
        // the flipping panel catches the star full-face for a moment: a hot flash per beat
        p.addScaledVector(rn, jump);
        // wide: the rings are small in frame, so the beat thickens them and burns them hot
        const thick = wide ? 1 + 0.9 * e : 1;
        out.push({ p, n: nrm, u: tang, s: [w * (closed ? 0.97 : 0.62), (closed ? 0.5 : 0.3) * thick, 0.03 * thick], heat: (wide ? 7 : 1.3) * e });
      }
    });
  }

  /** Cage ring clang times (capture): 3 rings on beat 1, 3 on beat 2, 2 on beat 3; the lock on beat 4. */
  private clangs(): number[] {
    const b = this.beats.filter((x) => x >= this.plate.start - 1e-3);
    const at = (i: number) => b[Math.min(i, b.length - 1)] ?? this.plate.end;
    return [0, 0, 0, 1, 1, 1, 2, 2].map(at);
  }

  private cage(t: number, out: Pose[]) {
    const R = 2.6, C = this.clangs();
    const lock = this.beats[this.beats.length - 1]!;
    const spin = t > lock ? 7 * (t - lock) ** 2 + 1.5 * (t - lock) : 0;
    const blur = t > lock ? clamp((t - lock) * 3.2) : 0;
    const start = this.plate.start;
    for (let j = 0; j < 8; j++) {
      const ax = j < 6 ? V(Math.cos((j * Math.PI) / 6), 0, Math.sin((j * Math.PI) / 6)) : j === 6 ? V(0, 1, 0) : V(0.5, 0.7, 0.5).normalize();
      const shut = t >= C[j]!;
      const open = shut ? 0 : clamp((C[j]! - t) / Math.max(0.3, C[j]! - start + 0.4));
      // an open ring swings about a hinge axis and hangs wide; on its clang it snaps into the cage
      const hinge = V(0, 1, 0).cross(ax).lengthSq() > 1e-3 ? V(0, 1, 0).cross(ax).normalize() : V(1, 0, 0);
      const q = new THREE.Quaternion().setFromAxisAngle(hinge, 1.1 * open * (j % 2 ? 1 : -1));
      const qs = new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), spin);
      const axis = ax.clone().applyQuaternion(q).applyQuaternion(qs);
      const e1 = V().crossVectors(axis, Math.abs(axis.y) < 0.9 ? V(0, 1, 0) : V(1, 0, 0)).normalize();
      const e2 = V().crossVectors(axis, e1);
      const rr = R * (1 + 0.35 * open);
      const sweep = shut ? 1 : 0.62;
      const heat = shut ? decay(t - C[j]!, 0.1) : 0;
      const n = 44;
      for (let i = 0; i < n; i++) {
        const f = i / n;
        if (f > sweep) continue;
        const a = f * TAU + j * 0.4;
        const radial = e1.clone().multiplyScalar(Math.cos(a)).addScaledVector(e2, Math.sin(a));
        const tang = e1.clone().multiplyScalar(-Math.sin(a)).addScaledVector(e2, Math.cos(a));
        const p = radial.clone().multiplyScalar(rr);
        out.push({ p, n: radial, u: tang, s: [((TAU * rr) / n) * 0.9 * (1 + 5 * blur), 0.12, 0.07], heat: heat + (t >= lock ? decay(t - lock, 0.12) : 0) });
      }
    }
  }

  // ------------------------------------------------------------------ swarm
  /** The swarm's rings: 3 sparse rings already in orbit, then one ring per volley (beats 1..7 of the plate). */
  private swarmRings(): { r: number; inc: number; node: number; n: number; snap: number; w: number }[] {
    const vb = this.beats.filter((b) => b > this.plate.start + 0.05 && b < this.plate.end - 0.05);
    const R = [7.6, 2.4, 5.2, 3.3, 8.4, 4.2, 6.2], I = [0.18, -0.5, 0.9, -0.25, 0.35, -1.0, 0.6];
    const out = [3.1, 5.0, 6.6].map((r, k) => ({ r, inc: [0.3, -0.7, 0.5][k]!, node: hash(k, 31) * TAU, n: 36, snap: -Infinity, w: 2.2 * Math.pow(r, -1.5) }));
    vb.forEach((snap, k) => {
      const r = R[k % R.length]!;
      out.push({ r, inc: I[k % I.length]!, node: hash(k, 17) * TAU, n: Math.round(r * 26), snap, w: 2.2 * Math.pow(r, -1.5) * (k % 2 ? -1 : 1) });
    });
    return out;
  }

  private posesSwarm(t: number, topo: string, out: Pose[]) {
    const cp = this.cam.position, fwd = V(), right = V(), up = V();
    this.cam.getWorldDirection(fwd);
    right.crossVectors(fwd, this.cam.up).normalize();
    up.crossVectors(right, fwd).normalize();
    const lock = topo === 'lock' ? this.list[this.list.length - 1]!.t : Infinity;
    const lk = t >= lock ? easeOut((t - lock) / 0.12) : 0;
    const bt = this.sinceBeat(t);
    const lt = t - this.plate.start;
    const rn = V();
    // the Sun's disc stays clean (match-circle at both cuts): near-side panels on the line of sight to it fold away
    const sunD = cp.length(), sunA = Math.asin(1 / sunD), toSun = cp.clone().negate().normalize(), rel = V();
    const clear = (p: THREE.Vector3) => {
      rel.subVectors(p, cp);
      const dd = rel.length();
      if (dd > sunD) return 1;
      return smoothstep(sunA * 1.05, sunA * 1.7, Math.acos(clamp(rel.dot(toSun) / dd, -1, 1)));
    };
    for (const g of this.swarmRings()) {
      if (t < g.snap - FLIGHT) continue;
      this.ringNormal(g.inc, g.node, rn);
      const w = (TAU * g.r) / g.n;
      const a = t - g.snap;
      for (let j = 0; j < g.n; j++) {
        const th = (j / g.n) * TAU + g.w * lt + hash(j, g.n) * 0.02;
        if (a < 0) {
          // in flight: a tracer fired from the camera's vantage, accelerating onto its slot; every tracer of a
          // volley arrives on the beat (the launch is staggered, the snap is not)
          const fl = FLIGHT * (0.65 + 0.35 * hash(j, 7, g.n));
          const u = 1 - -a / fl;
          if (u < 0) continue;
          const e = Math.pow(u, 2.4);
          const tgt = this.onRing(g.r, th, g.inc, g.node, V());
          const p0 = cp.clone().addScaledVector(right, (hash(j, 3) - 0.5) * 3.2).addScaledVector(up, -0.9 + (hash(j, 4) - 0.5) * 1.4).addScaledVector(fwd, -0.4);
          const dir = tgt.clone().sub(p0);
          const len = dir.length();
          const p = p0.addScaledVector(dir, e);
          const toCam = cp.clone().sub(p).normalize();
          dir.normalize();
          out.push({ p, n: toCam, u: dir, s: [0.04 + len * 0.055 * Math.pow(u, 1.4), 0.014, 0.014], heat: 0.35, sig: 0.25 + 0.4 * e });
          continue;
        }
        // in orbit: the radial spring of the snap, then a lit collector facing the Sun
        const spring = Number.isFinite(a) ? 0.07 * Math.exp(-a / 0.09) * Math.cos(a * 38) : 0;
        const p = this.onRing(g.r * (1 + spring), th, g.inc, g.node, V());
        const radial = p.clone().normalize();
        const tang = V().crossVectors(rn, radial).normalize();
        // every beat the swarm answers the snap: a heat ripple running outward ring by ring
        const ripple = 0.45 * env(bt - g.r * 0.018);
        const snapHeat = Number.isFinite(a) ? 2.4 * decay(a, 0.1) : 0;
        const lockHeat = t >= lock ? 1.0 * decay(t - lock, 0.16) : 0;
        const k = clear(p);
        if (k <= 0) continue;
        out.push({ p, n: radial, u: tang, s: [w * (0.6 + 0.37 * lk) * k, (0.3 + 0.28 * lk) * k, 0.025], heat: snapHeat + ripple + lockHeat });
      }
    }
  }

  private upload(poses: Pose[]) {
    const m = this.m4, v2 = V(), v3 = V();
    const base = this.base;
    let k = 0;
    for (const q of poses) {
      if (k >= MAXN) break;
      v2.crossVectors(q.n, q.u).normalize();
      v3.crossVectors(v2, q.n).normalize(); // re-orthogonalised tangent
      m.set(
        v3.x * q.s[0], v2.x * q.s[1], q.n.x * q.s[2], q.p.x,
        v3.y * q.s[0], v2.y * q.s[1], q.n.y * q.s[2], q.p.y,
        v3.z * q.s[0], v2.z * q.s[1], q.n.z * q.s[2], q.p.z,
        0, 0, 0, 1,
      );
      this.panels.setMatrixAt(k, m);
      // base + (hot - base) * heat (capture: hot = 6 x base, i.e. base * (1 + 5 heat)); swarm tracers add signal
      this.tmpC.copy(this.hot).sub(base).multiplyScalar(q.heat).add(base);
      if (q.sig) this.tmpC.add(this.sigTmp.copy(this.sigC).multiplyScalar(4 * q.sig));
      this.panels.setColorAt(k, this.tmpC);
      k++;
    }
    this.panels.count = k;
    this.panels.instanceMatrix.needsUpdate = true;
    if (this.panels.instanceColor) this.panels.instanceColor.needsUpdate = true;
  }

  private setCam(pos: THREE.Vector3, at: THREE.Vector3, fov: number, roll = 0, up = V(0, 1, 0)) {
    const c = this.cam;
    c.position.copy(pos); c.up.copy(up); c.fov = fov; c.lookAt(at);
    if (roll) c.rotateZ(roll);
    c.updateProjectionMatrix(); c.updateMatrixWorld();
  }

  private placeTraces(on: boolean, rings: { r: number; inc: number; node: number }[], opacity = 0.55) {
    this.traces.forEach((l, k) => {
      const g = rings[k];
      l.visible = on && !!g;
      if (!g) return;
      l.scale.setScalar(g.r);
      l.rotation.set(0, 0, 0);
      l.rotateY(g.node); l.rotateX(-g.inc);
      (l.material as THREE.LineBasicMaterial).opacity = opacity;
    });
  }

  // ------------------------------------------------------------------ lyric (capture)
  private drawLine(t: number) {
    const L = this.layer!, c = L.ctx;
    L.clear();
    const line = this.lines[0]!;
    const au = this.ctx.audio;
    // two rows: the Korean clause on top, the Latin words on their own row underneath; fit the wider row
    const split = Math.min(3, line.words.length);
    const rows = (l: ReturnType<typeof layoutLine>) => {
      const r2x = l.words[split]?.x ?? l.width;
      const r1w = split > 0 ? l.words[split - 1]!.x + l.words[split - 1]!.w : l.width;
      return { r2x, r1w, r2w: l.width - r2x };
    };
    let lay = layoutLine(c, line, F.slam(), 320);
    const m = rows(lay), widest = Math.max(m.r1w, m.r2w);
    if (widest > 1560) lay = layoutLine(c, line, F.slam(), 320 * (1560 / widest));
    const { r2x: row2x, r1w: row1w, r2w: row2w } = rows(lay);
    const x0 = 960 - row1w / 2;
    const dx2 = 960 - row2w / 2 - (x0 + row2x);
    const db = downbeatPulse(au, t, 0.18);
    const hit = env(this.sinceBeat(t));
    drawLyric(c, line, t, {
      x: x0, y: 540 - lay.size * 0.2, size: lay.size, align: 'left', family: F.slam(),
      sungColor: 'bone', unsungColor: 'graphite', unsungAlpha: 0.55,
      charTransform: (_ch, i, s) => {
        const second = s.word >= split;
        // a sung glyph arrives oversized and is pressed flat against the bars; each clang squashes it once more
        const press = s.sung ? 1 + 0.35 * Math.pow(1 - s.frac, 3) : 1;
        const clang = 1 - 0.05 * hit;
        return {
          dx: second ? dx2 : 0,
          dy: (second ? lay.size * 1.12 : 0) + (s.sung ? 0 : 10 * (hash(i, 9) - 0.5)),
          scale: press * clang * (1 + 0.05 * db),
        };
      },
    });
    L.upload();
  }

  // ------------------------------------------------------------------ render
  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, audio } = this.ctx;
    const st = stateAt(this.list, f.t);
    const camK = st.cam as string, topo = st.topo as string;
    const bt = this.sinceBeat(f.t);
    const hit = env(bt);
    const kick = kickPulse(audio, f.t, 0.1);
    const db = downbeatPulse(audio, f.t, 0.2);
    const ov: PostOverrides = { vignette: 0.35, grain: 0.05 };

    // capture: every clang holds its frame one extra frame (the scene clock freezes at the clang)
    let t = f.t;
    if (this.v === 'capture' && bt < 2 * FR) t = f.t - bt;

    const poses: Pose[] = [];
    this.star.position.set(0, 0, 0); this.star.scale.setScalar(1);
    this.light.position.set(0, 0, 0);
    this.starMat.uniforms.uT!.value = t;
    this.coronaMat.uniforms.uT!.value = t;
    let expo = 1.4, sil = 0, gain = 1, starScale = 1, coronaR = 1, neg = 0;
    const lt = t - this.plate.start;

    if (this.v === 'launch') {
      this.posesLaunch(t, topo, poses);
      const sparseRings = Array.from({ length: 8 }, (_, k) => ({ r: 1.75 + 0.48 * k, inc: (hash(k, 1) - 0.5) * 1.3, node: hash(k, 2) * TAU }));
      this.placeTraces(topo === 'sparse' || topo === 'volley', sparseRings, topo === 'volley' ? 0.25 : 0.6);
      const ign = igniteRamp(f.t, this.plate.start, 0.45);
      if (camK === 'silhouette') {
        sil = 1; gain = 1.6 * ign * (1 + 1.2 * hit); expo = 1.2;
        this.setCam(V(-1.05 + 0.08 * lt, 0.25, 2.55 - 0.05 * lt), V(0.55, 0.05, 0), 52, -0.08);
      } else if (camK === 'threeq') {
        expo = 1.6 * (1 + 0.8 * hit);
        this.setCam(V(6.4 + 0.2 * lt, 3.9, 8.2), V(0.3, -0.2, 0), 40, 0.06);
      } else if (camK === 'plane') {
        expo = 1.8 * (1 + 0.8 * hit);
        this.setCam(V(0.6 - 0.12 * lt, 0.42, 7.6), V(0, 0.95, 0), 46, 0.02);
      } else {
        expo = 1.6 * (1 + 1.0 * hit); gain = 1.3 * (1 + hit); coronaR = 2.4;
        this.setCam(V(0, 11.5, 0.001), V(0, 0, 0), 44, 0, V(0, 0, -1));
      }
      // drop-1 signature: each downbeat inverts the whole frame for one beat
      const dbs = this.beats.filter((b) => audio.downbeats.some((d) => Math.abs(d - b) < 1e-3));
      const bl = 60 / audio.bpm;
      neg = dbs.some((d) => f.t >= d && f.t < d + bl) ? 1 : 0;
      ov.zoom = 1 + 0.06 * hit;
      ov.shake = [0, 9 * hit * (bt < 2 * FR ? 1 : -1)]; // the volley's recoil
      ov.bloom = 0.45; ov.bloomThreshold = 1.1;
    } else if (this.v === 'ring') {
      this.ringBands(t, topo, camK, poses);
      expo = 1.6 * (1 + 1.4 * hit + 0.4 * kick);
      gain = 1.3 * (1 + 1.2 * hit);
      const bands = Array.from({ length: 6 }, (_, k) => ({ r: 1.9 + 0.55 * k, inc: 0.16, node: 0.3 }));
      this.placeTraces(camK === 'wide', bands, 0.35);
      if (camK === 'gaps') {
        this.setCam(V(-1.4 + 0.45 * lt, 0.2, 4.3), V(0.2, 0.05, 0), 56, 0.14);
      } else if (camK === 'behind') {
        expo = 9 * (1 + 0.8 * hit); gain = 3; coronaR = 1 + 0.6 * hit; // the flare swells the (inked) halo
        this.setCam(V(0.35, 0.72, 2.95), V(0, 0.02, 0), 36, -0.1);
        // storyboard: one white frame on the cut, then this bar in negative
        const t0 = this.list[1]!.t;
        if (f.t >= t0 && f.t < t0 + FR) ov.flash = 3;
        else if (f.t >= t0 + FR) neg = 1;
      } else if (camK === 'wide') {
        this.setCam(V(-4, 9.5, 30), V(0, -0.6, 0), 24, 0.03);
      } else {
        // exit: push toward the star and let it flare to white across the last beat
        const x = smoothstep(this.list[this.list.length - 1]!.t, this.plate.end, f.t);
        expo = 2 + 14 * x; gain = 2 + 6 * x; starScale = 1 + 0.25 * x;
        this.setCam(V(2.4, 1.2, 6.2 - 1.5 * x), V(0, 0, 0), 38, -0.05);
        ov.flash = 1.6 * x * x;
      }
      ov.zoom = 1 + 0.05 * hit;
      ov.bloom = camK === 'behind' ? 0.7 : 0.45; ov.bloomThreshold = 1.1;
      // extreme wide: the rings are small in frame, so the beat blooms the burning rings (glowing signal only)
      if (camK === 'wide') { ov.bloom = 0.45 + 1.1 * hit; ov.bloomThreshold = 1.1 - 0.4 * hit; }
    } else if (this.v === 'swarm') {
      // camera first: the volleys are fired from its vantage. The Sun stays on the optical axis (anchor via the
      // view offset); its photosphere radius is continuous from SUN_R0 (the eye) and lands on SUN_R1 (the oculus).
      const s0 = this.plate.start, s1 = this.list[1]!.t, end = this.plate.end;
      let fov: number, rPx: number, el: number, phi: number, roll: number;
      if (camK === 'track') {
        fov = 70; rPx = lerp(SUN_R0, 86, clamp((f.t - s0) / (s1 - s0)));
        el = 0.1 + 0.02 * lt; phi = 0.6 + 0.19 * lt; roll = -0.06;
      } else {
        const x = clamp((f.t - s1) / (end - FR - s1));
        fov = 55; rPx = lerp(92, SUN_R1, x);
        el = 0.62 - 0.05 * x; phi = 1.25 + 0.19 * lt; roll = 0.04;
      }
      const d = distFor(rPx, fov);
      this.setCam(V(d * Math.cos(el) * Math.sin(phi), d * Math.sin(el), d * Math.cos(el) * Math.cos(phi)), V(0, 0, 0), fov, roll);
      this.posesSwarm(t, topo, poses);
      this.placeTraces(false, []);
      // the flare on the beat stays inside the T1 cap (1.4x)
      expo = 1.5 * (1 + 0.4 * hit) * (1 + 0.1 * kick);
      gain = 1.2 * (1 + 0.35 * hit);
      const lock = topo === 'lock' ? decay(f.t - this.list[this.list.length - 1]!.t, 0.2) : 0;
      if (lock) { expo *= 1 + 0.3 * lock; gain *= 1 + 0.3 * lock; }
      // no punch on the cut itself: the first frame's disc must sit exactly on p40's eye
      if (this.beatNo(f.t) > 0) ov.zoom = 1 + 0.02 * hit;
      if (bt < 2 * FR && this.beatNo(f.t) > 0) ov.shake = [0, 5 * (bt < FR ? 1 : -1)]; // the snap's recoil (T1: <= 6 px)
      ov.bloom = 0.5; ov.bloomThreshold = 1.1;
    } else {
      // capture: the star is far behind the cage, backlighting it; the line sits inside
      this.star.position.set(-15, 7.5, -19); starScale = 2.8;
      this.light.position.copy(this.star.position);
      this.cage(t, poses);
      this.placeTraces(false, []);
      expo = 1.6 * (1 + 0.6 * hit);
      gain = 1.4;
      const tp = this.textPlane!;
      const lock = this.beats[this.beats.length - 1]!;
      if (camK === 'outside') {
        this.setCam(V(1.0, 0.5, 7.6 - 0.5 * lt), V(0, 0.05, 0), 38, 0.04);
        tp.position.set(0, 0, 0); tp.scale.setScalar(1);
      } else if (camK === 'inside') {
        const lt2 = f.t - this.list[1]!.t;
        this.setCam(V(0.15 - 0.06 * lt2, 0.05, 1.0), V(0, 0, -2.4), 58, -0.03);
        tp.position.set(0, -0.1, -2.25); tp.scale.setScalar(1.22);
      } else {
        const x = clamp(f.t - lock);
        this.setCam(V(0, 0.4, 6.5 + 2 * x), V(0, 0, 0), 40, 0.25 * x);
        tp.position.set(0, 0, 0); tp.scale.setScalar(0.92);
      }
      tp.quaternion.copy(this.cam.quaternion);
      // while the cage spins to a blur the line stays legible on top of it (it is what the cage holds)
      (tp.material as THREE.MeshBasicMaterial).depthTest = camK !== 'spin';
      this.drawLine(f.t);
      // the clang: 2 px horizontal jolt; one downbeat scale punch (T2 cap 1.06)
      if (bt < 2 * FR) ov.shake = [2, 0];
      ov.zoom = 1 + 0.05 * downbeatPulse(audio, f.t, 0.12);
      ov.bloom = 0.3; ov.bloomThreshold = 1.2;
    }

    // star + corona
    this.star.scale.setScalar(starScale);
    this.starMat.uniforms.uExpo!.value = expo;
    this.starMat.uniforms.uSil!.value = sil;
    this.coronaMat.uniforms.uGain!.value = gain;
    this.corona.position.copy(this.star.position);
    this.corona.scale.setScalar(starScale * coronaR * (1 + 0.08 * hit));
    this.coronaMat.uniforms.uR!.value = 3 * coronaR * (1 + 0.08 * hit); // radius in star radii across the scaled plane
    this.corona.quaternion.copy(this.cam.quaternion);
    this.light.intensity = this.v === 'capture' ? 4 : this.v === 'swarm' ? 3.6 * (1 + 0.35 * hit) : 3.2 * (1 + 0.8 * hit + 0.3 * db);
    const fillDir = V().subVectors(this.cam.position, this.star.position).normalize();
    this.fill.position.copy(this.cam.position).addScaledVector(fillDir, 0);
    this.fill.target.position.copy(this.star.position);
    const dark = this.v === 'launch' && camK === 'top';
    this.fill.intensity = dark ? 0.03 : 0.14;
    this.amb.intensity = dark ? 0.05 : 0.18;

    this.upload(poses);
    clearRT(renderer, this.rt, this.P ? plin(this.P, 'ground') : LIN.ink);
    renderer.setRenderTarget(this.rt);
    renderer.render(this.scene3, this.cam);
    this.grade.u.uNeg!.value = neg;
    this.grade.render(renderer, out);
    if (neg) ov.bloom = 0;
    return ov;
  }

  override dispose() {
    this.panels?.geometry.dispose();
    (this.panels?.material as THREE.Material)?.dispose();
    this.star?.geometry.dispose(); this.starMat?.dispose();
    this.corona?.geometry.dispose(); this.coronaMat?.dispose();
    this.layer?.texture.dispose();
    this.rt?.dispose();
  }
}
