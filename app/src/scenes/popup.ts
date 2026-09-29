// POPUP — a pop-up book spread on a bone table (plate p26-popup-city, variant 'city').
// Paper pieces are Canvas2D drawings (printed face, white cut edge, grain, real window holes) stood up in a
// three.js scene on hinges: rotation.x = -(1 - f)·π/2 with an overshooting ease, one building per beat.
//   b0            the spread opens (the near page swings over from the far page), the back skyline pops
//   b1..b8        one cramped-city building per beat, front to back; b8 is the last, tallest tower
//   last beat     the city folds flat and the near page slams shut; the plate's final frame is black
// Lyrics: the first owned line is printed on paper tabs lying on the street (one word per tab), the second on
// the blades of a pop-up street sign (one word per blade). The tab/blade carrying the word being sung turns
// toward the current camera (so it reads in every shot, overhead included) and lays back afterwards.
// Beat: a building hinges up on every beat; downbeats jolt the book and punch the frame; kicks flicker the
// window light. Light: a single shadow-casting key per shot — the cut-out windows print light onto the street.
import * as THREE from 'three';
import { Scene, type Frame, type PostOverrides } from '../engine/scene';
import { makeRT, clearRT, W, H } from '../engine/gl';
import { LIN, rgba, type PaletteKey } from '../engine/palette';
import { drawLyric, layoutLine, ownedLines, F } from '../engine/lyric';
import { beatPulse, kickPulse, downbeatPulse, beatIndex } from '../engine/beat';
import { beatTimes, shotAt, type PlateInfo, type Shot } from '../engine/shots';
import { clamp, ease, hash, lerp, prog } from '../engine/util';
import type { Line, Word } from '../engine/lyrics';
import { shots, type Cam } from './popup.shots';

// ------------------------------------------------------------------ layout (world units; book spine along x at z = 0)
const PAGE_W = 10, PAGE_D = 3.5, BOARD = 0.1;
const PX = 150; // texture px per world unit
const RISE = 0.34; // s for a piece to hinge up
/** Half-width of the street (it runs along z, narrowing toward the back: the passage gets squeezed). */
const streetHW = (z: number) => 0.92 + 0.26 * (z / PAGE_D);

type Roof = 'flat' | 'step' | 'tank' | 'antenna' | 'saw' | 'spire' | 'skyline';
interface Bld { x0: number; x1: number; z: number; h: number; face: PaletteKey; roof: Roof; seed: number }

// variant 'city': b1..b8 in rise order (front to back, alternating sides, getting taller and closer to the street)
const CITY: Bld[] = [
  { x0: -4.7, x1: -1.22, z: 3.0, h: 1.45, face: 'paper2', roof: 'tank', seed: 1 },
  { x0: 1.18, x1: 4.6, z: 2.72, h: 1.8, face: 'bone', roof: 'saw', seed: 2 },
  { x0: -4.1, x1: -1.1, z: 1.75, h: 2.35, face: 'graphite', roof: 'step', seed: 3 },
  { x0: 1.08, x1: 4.0, z: 1.3, h: 2.65, face: 'paper2', roof: 'antenna', seed: 4 },
  { x0: -3.7, x1: -0.86, z: -0.75, h: 3.05, face: 'bone', roof: 'flat', seed: 5 },
  { x0: 0.84, x1: 3.5, z: -1.1, h: 3.35, face: 'ink2', roof: 'tank', seed: 6 },
  { x0: -3.2, x1: -0.74, z: -2.15, h: 3.9, face: 'paper2', roof: 'step', seed: 7 },
  { x0: -1.02, x1: 1.02, z: -2.85, h: 5.1, face: 'bone', roof: 'spire', seed: 8 },
];
const SKYLINE: Bld = { x0: -4.85, x1: 4.85, z: -3.28, h: 2.3, face: 'paper2', roof: 'skyline', seed: 9 };
const SIGN = { x: 0.05, z: -0.42, post: 2.15 };

// ------------------------------------------------------------------ cameras and light per shot
interface CamDef { p0: [number, number, number]; p1: [number, number, number]; t0: [number, number, number]; t1: [number, number, number]; fov: number; up: [number, number, number] }
const CAMS: Record<Cam, CamDef> = {
  threeq: { p0: [7.3, 8.0, 11.0], p1: [5.9, 6.9, 9.3], t0: [0, 0.5, 0.3], t1: [0, 0.9, 0.1], fov: 32, up: [0, 1, 0] },
  floor: { p0: [1.5, 3.5, 5.3], p1: [0.8, 2.8, 4.1], t0: [-0.1, 0.2, 1.75], t1: [0, 0.3, 1.0], fov: 38, up: [0, 1, 0] },
  low: { p0: [0.12, 0.42, 3.4], p1: [0.04, 0.5, 2.55], t0: [0.05, 1.5, -2.5], t1: [0, 1.7, -2.5], fov: 54, up: [0, 1, 0] },
  overhead: { p0: [0.8, 11.6, 1.9], p1: [0.3, 10.4, 1.2], t0: [0.1, 0, -0.9], t1: [0, 0, -0.8], fov: 42, up: [0.16, 0, -1] },
  slam: { p0: [0.4, 12.6, 7.4], p1: [0.2, 13.4, 8.2], t0: [0, 0, 0.2], t1: [0, 0, 0.2], fov: 40, up: [0, 1, 0] },
};
interface LightDef { dir: [number, number, number]; key: PaletteKey; I: number; amb: number; glow: number; bloom: number }
const LIGHT: Record<Cam, LightDef> = {
  threeq: { dir: [-0.55, 0.78, 0.42], key: 'bone', I: 2.9, amb: 1.45, glow: 0.12, bloom: 0 },
  floor: { dir: [-0.78, 0.55, -0.22], key: 'bone', I: 3.4, amb: 1.4, glow: 0.3, bloom: 0 },
  low: { dir: [-0.28, 0.3, -1], key: 'ember', I: 5.2, amb: 1.3, glow: 1.9, bloom: 0.35 },
  overhead: { dir: [-0.38, 0.62, -0.72], key: 'bone', I: 3.2, amb: 1.4, glow: 1.3, bloom: 0.2 },
  slam: { dir: [-0.38, 0.62, -0.72], key: 'bone', I: 3.2, amb: 1.4, glow: 1.0, bloom: 0 },
};

// ------------------------------------------------------------------ paper helpers (Canvas2D)
function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = Math.max(8, Math.round(w));
  c.height = Math.max(8, Math.round(h));
  return c;
}
function tex(c: HTMLCanvasElement, mips = true) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.generateMipmaps = mips;
  t.minFilter = mips ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  t.anisotropy = 8;
  return t;
}
let grainCache: HTMLCanvasElement | null = null;
/** Deterministic paper grain tile: hashed luminance speckle, mostly transparent. */
function grain(): HTMLCanvasElement {
  if (grainCache) return grainCache;
  const c = canvas(160, 160), g = c.getContext('2d')!;
  const d = g.createImageData(160, 160);
  for (let i = 0; i < 160 * 160; i++) {
    const v = hash(i, 17), w = hash(i, 29);
    const dark = v < 0.5;
    const l = dark ? 70 : 255;
    d.data[i * 4] = l; d.data[i * 4 + 1] = dark ? 60 : 250; d.data[i * 4 + 2] = dark ? 50 : 240;
    d.data[i * 4 + 3] = Math.round((0.02 + 0.07 * w * w) * 255);
  }
  g.putImageData(d, 0, 0);
  return (grainCache = c);
}
/** Paper fibres and grain over the whole canvas (call with the paint area clipped as needed). */
function paperize(g: CanvasRenderingContext2D, w: number, h: number, seed: number, fibres = 1) {
  g.save();
  g.fillStyle = g.createPattern(grain(), 'repeat')!;
  g.fillRect(0, 0, w, h);
  g.lineWidth = 1;
  const n = Math.round((w * h) / 2600 * fibres);
  for (let k = 0; k < n; k++) {
    const x = hash(seed, k, 1) * w, y = hash(seed, k, 2) * h, a = hash(seed, k, 3) * Math.PI * 2, l = 5 + 14 * hash(seed, k, 4);
    g.strokeStyle = rgba('graphite', 0.05 + 0.05 * hash(seed, k, 5));
    g.beginPath(); g.moveTo(x, y);
    g.quadraticCurveTo(x + Math.cos(a) * l * 0.5 + 2, y + Math.sin(a) * l * 0.5, x + Math.cos(a) * l, y + Math.sin(a) * l);
    g.stroke();
  }
  g.restore();
}
function hatch(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, step: number, color: string, lw = 1) {
  g.save();
  g.beginPath(); g.rect(x, y, w, h); g.clip();
  g.strokeStyle = color; g.lineWidth = lw;
  g.beginPath();
  for (let k = -h; k < w; k += step) { g.moveTo(x + k, y + h); g.lineTo(x + k + h, y); }
  g.stroke();
  g.restore();
}

// ------------------------------------------------------------------ building art
interface PieceArt { front: HTMLCanvasElement; back: HTMLCanvasElement; glow: HTMLCanvasElement; w: number; h: number }

/** Silhouette (outline) and window holes of a building, in canvas px (bottom edge = hinge line). */
function buildingShape(b: Bld, cw: number, ch: number) {
  const outline = new Path2D(), holes: { x: number; y: number; w: number; h: number }[] = [], printed: typeof holes = [];
  const m = 5; // margin for the cut edge
  const bodyTop = b.roof === 'flat' ? m : b.roof === 'spire' ? ch * 0.2 : b.roof === 'skyline' ? m : ch * 0.13;
  const L = m, R = cw - m, B = ch;
  const poly = (pts: number[][]) => { outline.moveTo(pts[0]![0]!, pts[0]![1]!); for (const p of pts.slice(1)) outline.lineTo(p[0]!, p[1]!); outline.closePath(); };
  let bodies: { l: number; r: number; top: number }[] = [{ l: L, r: R, top: bodyTop }];
  switch (b.roof) {
    case 'flat': poly([[L, B], [L, bodyTop], [R, bodyTop], [R, B]]); break;
    case 'step': {
      const s1 = ch * 0.07, w = R - L;
      poly([[L, B], [L, bodyTop + s1], [L + w * 0.18, bodyTop + s1], [L + w * 0.18, bodyTop], [L + w * 0.3, bodyTop], [L + w * 0.3, m], [L + w * 0.62, m], [L + w * 0.62, bodyTop], [R, bodyTop], [R, B]]);
      break;
    }
    case 'saw': {
      const n = 4, w = (R - L) / n, pts: number[][] = [[L, B], [L, bodyTop]];
      for (let i = 0; i < n; i++) { pts.push([L + i * w, m]); pts.push([L + (i + 1) * w, bodyTop]); }
      pts.push([R, B]);
      poly(pts);
      break;
    }
    case 'tank': case 'antenna': {
      poly([[L, B], [L, bodyTop], [R, bodyTop], [R, B]]);
      const cx = L + (R - L) * (b.seed % 2 ? 0.7 : 0.3);
      if (b.roof === 'tank') {
        const tw = Math.min(90, (R - L) * 0.22), th = (bodyTop - m) * 0.62;
        outline.rect(cx - tw / 2, m, tw, th);
        outline.rect(cx - tw / 2 + 4, m + th - 1, 6, bodyTop - m - th + 2);
        outline.rect(cx + tw / 2 - 10, m + th - 1, 6, bodyTop - m - th + 2);
      } else {
        outline.rect(cx - 4, m, 8, bodyTop - m + 2);
        outline.rect(cx - 18, m + (bodyTop - m) * 0.35, 36, 6);
      }
      break;
    }
    case 'spire': {
      const w = R - L, cx = (L + R) / 2;
      poly([[L, B], [L, bodyTop], [L + w * 0.14, bodyTop], [L + w * 0.14, bodyTop - ch * 0.05], [L + w * 0.3, bodyTop - ch * 0.05], [cx - w * 0.07, ch * 0.06], [cx - 5, ch * 0.06], [cx - 3, m], [cx + 3, m], [cx + 5, ch * 0.06], [cx + w * 0.07, ch * 0.06], [R - w * 0.3, bodyTop - ch * 0.05], [R - w * 0.14, bodyTop - ch * 0.05], [R - w * 0.14, bodyTop], [R, bodyTop], [R, B]]);
      break;
    }
    case 'skyline': {
      // a strip of joined roofs of different heights
      const n = 11, pts: number[][] = [[L, B]];
      bodies = [];
      let x = L;
      for (let i = 0; i < n; i++) {
        const w = ((R - L) / n) * (0.7 + 0.6 * hash(b.seed, i, 1));
        const top = m + (ch - m) * (0.05 + 0.5 * hash(b.seed, i, 2));
        const xr = i === n - 1 ? R : Math.min(R, x + w);
        pts.push([x, top], [xr, top]);
        bodies.push({ l: x, r: xr, top });
        x = xr;
        if (x >= R) break;
      }
      pts.push([R, B]);
      poly(pts);
      break;
    }
  }
  // windows: storey grid inside each body
  const floorH = 0.36 * PX, winW = 0.17 * PX, winH = 0.2 * PX;
  bodies.forEach((bd, bi) => {
    const bw = bd.r - bd.l;
    const cols = Math.max(1, Math.floor((bw - 0.2 * PX) / (winW * 2.05)));
    const pad = (bw - cols * winW * 2.05 + winW * 1.05) / 2;
    const rows = Math.floor((B - bd.top - 0.5 * PX) / floorH);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = bd.l + pad + c * winW * 2.05, y = bd.top + 0.2 * PX + r * floorH;
        if (x + winW > bd.r - 8 || y + winH > B - 0.4 * PX) continue;
        const k = hash(b.seed, bi, r, c);
        const w = b.roof === 'skyline' ? winW * 0.7 : winW, hh = b.roof === 'skyline' ? winH * 0.7 : winH;
        if (k < 0.6) holes.push({ x, y, w, h: hh }); else printed.push({ x, y, w, h: hh });
      }
    }
  });
  return { outline, holes, printed, bodyTop, bodies };
}

function drawBuilding(b: Bld): PieceArt {
  const wU = b.x1 - b.x0, hU = b.h;
  const cw = Math.round(wU * PX), ch = Math.round(hU * PX);
  const sh = buildingShape(b, cw, ch);
  const dark = b.face === 'graphite' || b.face === 'ink2';
  const inkC = dark ? 'bone' : 'ink';
  const mk = (printedFace: boolean) => {
    const c = canvas(cw, ch), g = c.getContext('2d')!;
    g.save();
    g.clip(sh.outline);
    g.fillStyle = rgba(printedFace ? b.face : 'paper2');
    g.fillRect(0, 0, cw, ch);
    if (printedFace) {
      // printed facade: storey lines, pilasters, cornice, shade hatch, ground-floor shop
      g.strokeStyle = rgba(inkC, dark ? 0.35 : 0.55);
      g.lineWidth = 1.4;
      for (const bd of sh.bodies) {
        for (let y = bd.top + 0.2 * PX + 0.26 * PX; y < ch - 0.4 * PX; y += 0.36 * PX) { g.beginPath(); g.moveTo(bd.l, y); g.lineTo(bd.r, y); g.stroke(); }
        g.lineWidth = 3; g.beginPath(); g.moveTo(bd.l, bd.top + 9); g.lineTo(bd.r, bd.top + 9); g.stroke(); g.lineWidth = 1.4;
      }
      hatch(g, cw * 0.84, 0, cw * 0.16, ch, 7, rgba(dark ? 'bone' : 'graphite', dark ? 0.18 : 0.35));
      if (b.roof !== 'skyline') {
        const sy = ch - 0.38 * PX;
        g.fillStyle = rgba(dark ? 'paper2' : 'graphite', 0.8);
        for (let x = 8, i = 0; x < cw - 8; x += 22, i++) if (i % 2 === 0) g.fillRect(x, sy, 22, 0.1 * PX);
        g.fillStyle = rgba(dark ? 'bone' : 'ink', 0.75);
        g.fillRect(cw * (0.2 + 0.5 * hash(b.seed, 5)), ch - 0.26 * PX, 0.2 * PX, 0.26 * PX);
      }
      for (const p of sh.printed) { g.fillStyle = rgba(dark ? 'ink' : 'graphite', dark ? 0.7 : 0.55); g.fillRect(p.x, p.y, p.w, p.h); }
    }
    paperize(g, cw, ch, b.seed + (printedFace ? 0 : 50), printedFace ? 1 : 0.6);
    // soft vertical shading (top lighter, foot darker)
    const q = g.createLinearGradient(0, 0, 0, ch);
    q.addColorStop(0, rgba('bone', 0.06)); q.addColorStop(1, rgba('ink', 0.12));
    g.fillStyle = q; g.fillRect(0, 0, cw, ch);
    g.restore();
    // white cut edges: the silhouette and every hole get a bone rim, then the holes are cut through
    g.strokeStyle = rgba('bone');
    g.lineJoin = 'round';
    g.lineWidth = 5;
    g.stroke(sh.outline);
    g.lineWidth = 4.5;
    for (const hl of sh.holes) g.strokeRect(hl.x, hl.y, hl.w, hl.h);
    g.globalCompositeOperation = 'destination-out';
    g.fillStyle = rgba('ink');
    for (const hl of sh.holes) g.fillRect(hl.x, hl.y, hl.w, hl.h);
    g.globalCompositeOperation = 'source-over';
    return c;
  };
  const glow = canvas(cw / 2, ch / 2), gg = glow.getContext('2d')!;
  gg.filter = 'blur(3px)';
  gg.fillStyle = rgba('bone');
  for (const hl of sh.holes) gg.fillRect(hl.x / 2 - 2, hl.y / 2 - 2, hl.w / 2 + 4, hl.h / 2 + 4);
  return { front: mk(true), back: mk(false), glow, w: wU, h: hU };
}

/** The printed spread floor of one page (canvas top = far edge of that page). */
function drawPage(which: 'near' | 'far'): HTMLCanvasElement {
  const cw = PAGE_W * PX, ch = PAGE_D * PX, c = canvas(cw, ch), g = c.getContext('2d')!;
  const zOf = (py: number) => (which === 'near' ? py / PX : py / PX - PAGE_D);
  const pyOf = (z: number) => (which === 'near' ? z * PX : (z + PAGE_D) * PX);
  const pxOf = (x: number) => (x + PAGE_W / 2) * PX;
  g.fillStyle = rgba('bone'); g.fillRect(0, 0, cw, ch);
  // printed street: a shaded band with ink curbs, a dashed centre line and a crosswalk at the near edge
  g.beginPath();
  for (let py = 0; py <= ch; py += 8) g.lineTo(pxOf(-streetHW(zOf(py))), py);
  for (let py = ch; py >= 0; py -= 8) g.lineTo(pxOf(streetHW(zOf(py))), py);
  g.closePath();
  g.fillStyle = rgba('paper2', 0.75); g.fill();
  g.strokeStyle = rgba('ink', 0.65); g.lineWidth = 2.2; g.stroke();
  g.strokeStyle = rgba('graphite', 0.7); g.lineWidth = 3; g.setLineDash([22, 18]);
  g.beginPath(); g.moveTo(pxOf(0), 0); g.lineTo(pxOf(0), ch); g.stroke(); g.setLineDash([]);
  if (which === 'near') {
    g.fillStyle = rgba('graphite', 0.5);
    const hw = streetHW(3.3);
    for (let x = -hw + 0.06; x < hw - 0.1; x += 0.24) g.fillRect(pxOf(x), pyOf(3.22), 0.12 * PX, 0.2 * PX);
  }
  // block footprints (pop-up bases) under each building row
  for (const b of [...CITY, SKYLINE]) {
    if ((which === 'near') !== b.z > 0) continue;
    hatch(g, pxOf(b.x0), pyOf(b.z) - 0.22 * PX, (b.x1 - b.x0) * PX, 0.22 * PX, 9, rgba('graphite', 0.3));
    g.strokeStyle = rgba('graphite', 0.5); g.lineWidth = 1.5;
    g.strokeRect(pxOf(b.x0), pyOf(b.z) - 0.22 * PX, (b.x1 - b.x0) * PX, 0.22 * PX);
  }
  paperize(g, cw, ch, which === 'near' ? 101 : 102, 1.4);
  // gutter shading and the fold line at the spine
  const spineY = which === 'near' ? 0 : ch;
  const q = g.createLinearGradient(0, spineY, 0, which === 'near' ? 0.7 * PX : ch - 0.7 * PX);
  q.addColorStop(0, rgba('graphite', 0.4)); q.addColorStop(0.25, rgba('graphite', 0.12)); q.addColorStop(1, rgba('graphite', 0));
  g.fillStyle = q; g.fillRect(0, 0, cw, ch);
  g.strokeStyle = rgba('ink', 0.55); g.lineWidth = 2.5;
  g.beginPath(); g.moveTo(0, spineY + (which === 'near' ? 1 : -1)); g.lineTo(cw, spineY + (which === 'near' ? 1 : -1)); g.stroke();
  // outer page edge: faint deckle shade
  const e = g.createLinearGradient(0, which === 'near' ? ch : 0, 0, which === 'near' ? ch - 0.25 * PX : 0.25 * PX);
  e.addColorStop(0, rgba('graphite', 0.2)); e.addColorStop(1, rgba('graphite', 0));
  g.fillStyle = e; g.fillRect(0, 0, cw, ch);
  return c;
}

// ------------------------------------------------------------------ lyric paper (redrawn per frame)
class WordPaper {
  c: HTMLCanvasElement;
  g: CanvasRenderingContext2D;
  t: THREE.CanvasTexture;
  private size = 0;
  constructor(public line: Line, public wi: number, public w: number, public h: number, public stock: PaletteKey) {
    this.c = canvas(1024, (1024 * h) / w);
    this.g = this.c.getContext('2d')!;
    this.t = tex(this.c);
  }
  get word(): Word { return this.line.words[this.wi]!; }
  draw(t: number, alpha = 1) {
    const { c, g } = this, cw = c.width, ch = c.height;
    g.clearRect(0, 0, cw, ch);
    g.fillStyle = rgba(this.stock); g.fillRect(0, 0, cw, ch);
    paperize(g, cw, ch, 300 + this.wi, 0.6);
    g.strokeStyle = rgba('ink', 0.6); g.lineWidth = 3;
    g.strokeRect(14, 14, cw - 28, ch - 28);
    g.strokeStyle = rgba('bone'); g.lineWidth = 8; g.strokeRect(0, 0, cw, ch);
    const fam = F.slam();
    if (!this.size) {
      const probe = layoutLine(g, this.line, fam, 100);
      const ww = probe.words[this.wi]!.w;
      this.size = Math.min(ch * 0.66, (100 * cw * 0.8) / Math.max(1, ww));
    }
    const lay = layoutLine(g, this.line, fam, this.size);
    const wb = lay.words[this.wi]!;
    drawLyric(g, this.line, t, {
      x: cw / 2 - (wb.x + wb.w / 2), y: ch / 2 + this.size * 0.36, size: this.size, align: 'left', family: fam,
      sungColor: 'ink', unsungColor: 'graphite', unsungAlpha: 0.4, lead: 2, alpha,
      charTransform: (_ch, _i, s) => (s.word === this.wi ? undefined : { alpha: 0 }),
      drawChar: (cc, chr, s) => { if (s.sung && s.frac < 1) cc.fillStyle = rgba('signal'); cc.fillText(chr, 0, 0); },
    });
    this.t.needsUpdate = true;
  }
  /** 0..1: this word is being sung (turns to camera), eased in at its start and out after its end. */
  active(t: number) {
    const w = this.word, s0 = w.start, s1 = Math.max(w.end, ...(w.syl ?? []).map((s) => s[1]));
    return Math.min(prog(t, s0, s0 + 0.2, ease.outBack), 1 - prog(t, s1, s1 + 0.3, ease.inOutQuad));
  }
}

// ------------------------------------------------------------------ the scene
interface Piece { hinge: THREE.Group; tRise: number; near: boolean; glow?: THREE.MeshBasicMaterial; parts: THREE.Object3D[] }

export default class Popup extends Scene {
  private list: Shot[] = [];
  private plate!: PlateInfo;
  private rt!: THREE.WebGLRenderTarget;
  private scene = new THREE.Scene();
  private cam = new THREE.PerspectiveCamera(35, W / H, 0.05, 300);
  private sun = new THREE.DirectionalLight();
  private amb = new THREE.AmbientLight();
  private book = new THREE.Group();
  private nearPage = new THREE.Group();
  private farPage = new THREE.Group();
  private pieces: Piece[] = [];
  private tabs: { paper: WordPaper; hinge: THREE.Group }[] = [];
  private blades: { paper: WordPaper; pivot: THREE.Group; rest: number; y: number }[] = [];
  private sign!: Piece;
  private beats: number[] = [];
  private tOpen = 0;
  private tSlam = 0;
  private tShut = 0;
  private disposables: { dispose(): void }[] = [];

  override init() {
    this.plate = this.ctx.params as PlateInfo;
    this.list = shots(this.plate, this.ctx.audio);
    const lines = ownedLines(this.ctx);
    const au = this.ctx.audio, { start, end } = this.ctx;
    this.rt = makeRT(W, H, { samples: 4 });
    this.beats = beatTimes(au, start - 1e-3, end);
    this.tOpen = this.beats[0] ?? start;
    const slam = this.list.find((s) => s.s.book === 'shut');
    this.tSlam = slam ? slam.t : end - 0.36;
    this.tShut = end - 1.3 / 60;

    const layout = this.plate.variant === 'city' ? CITY : CITY; // one composition so far; variants get their own lists
    const aniso = this.ctx.renderer.capabilities.getMaxAnisotropy();
    const T = (c: HTMLCanvasElement) => { const x = tex(c); x.anisotropy = aniso; this.disposables.push(x); return x; };
    const lambert = (o: THREE.MeshLambertMaterialParameters) => { const m = new THREE.MeshLambertMaterial(o); this.disposables.push(m); return m; };
    const col = (k: PaletteKey) => new THREE.Color().setRGB(...LIN[k]);

    // table
    const table = new THREE.Mesh(new THREE.PlaneGeometry(140, 140), lambert({ color: col('paper2') }));
    table.rotation.x = -Math.PI / 2; table.position.y = -BOARD - 0.04; table.receiveShadow = true;
    this.scene.add(table);

    // the book: two boards hinged at the spine (x axis). Top face = printed spread, bottom = cloth cover.
    const cover = lambert({ color: col('ink2') }), edge = lambert({ color: col('paper2') });
    for (const which of ['near', 'far'] as const) {
      const g = new THREE.BoxGeometry(PAGE_W, BOARD, PAGE_D);
      g.translate(0, -BOARD / 2, which === 'near' ? PAGE_D / 2 : -PAGE_D / 2);
      this.disposables.push(g);
      const top = lambert({ map: T(drawPage(which)) });
      const board = new THREE.Mesh(g, [edge, edge, top, cover, edge, edge]);
      board.castShadow = board.receiveShadow = true;
      const cloth = new THREE.Mesh(new THREE.BoxGeometry(PAGE_W + 0.3, 0.05, PAGE_D + 0.15), cover);
      cloth.position.set(0, -BOARD - 0.02, which === 'near' ? PAGE_D / 2 + 0.07 : -PAGE_D / 2 - 0.07);
      cloth.castShadow = cloth.receiveShadow = true;
      const grp = which === 'near' ? this.nearPage : this.farPage;
      grp.add(board, cloth);
      this.book.add(grp);
    }
    this.scene.add(this.book);

    // paper pieces
    const addPiece = (b: Bld, tRise: number, order: number): Piece => {
      const art = drawBuilding(b);
      const geo = new THREE.PlaneGeometry(art.w, art.h); geo.translate(0, art.h / 2, 0);
      this.disposables.push(geo);
      const front = new THREE.Mesh(geo, lambert({ map: T(art.front), alphaTest: 0.5, side: THREE.FrontSide, shadowSide: THREE.DoubleSide }));
      const back = new THREE.Mesh(geo, lambert({ map: T(art.back), alphaTest: 0.5, side: THREE.FrontSide }));
      back.rotation.y = Math.PI;
      front.castShadow = front.receiveShadow = back.receiveShadow = true;
      const glowMat = new THREE.MeshBasicMaterial({ map: T(art.glow), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, color: col('ember') });
      this.disposables.push(glowMat);
      const glow = new THREE.Mesh(geo, glowMat);
      glow.position.z = -0.14;
      const hinge = new THREE.Group();
      hinge.position.set((b.x0 + b.x1) / 2, 0.004 * (order + 1), b.z);
      hinge.add(front, back, glow);
      const near = b.z > 0;
      (near ? this.nearPage : this.farPage).add(hinge);
      return { hinge, tRise, near, glow: glowMat, parts: [front, back, glow] };
    };
    this.pieces.push(addPiece(SKYLINE, this.tOpen + 0.26, 0));
    layout.forEach((b, i) => this.pieces.push(addPiece(b, this.beats[i + 1] ?? end, i + 1)));

    // line A: word tabs lying on the street (hinged at their near edge, they lift toward the camera)
    const [lineA, lineB] = lines;
    if (lineA) lineA.words.forEach((_w, i) => {
      const w = 2.0 - 0.22 * i, d = 0.74, z = 3.1 - 1.32 * i;
      const paper = new WordPaper(lineA, i, w, d, 'bone');
      this.disposables.push(paper.t);
      const geo = new THREE.PlaneGeometry(w, d); geo.translate(0, d / 2, 0); this.disposables.push(geo);
      const face = new THREE.Mesh(geo, lambert({ map: paper.t, side: THREE.FrontSide }));
      const back = new THREE.Mesh(geo, lambert({ color: col('paper2'), side: THREE.FrontSide }));
      back.rotation.y = Math.PI;
      face.castShadow = face.receiveShadow = true;
      const hinge = new THREE.Group(); hinge.add(face, back);
      hinge.position.set(0, 0.012 + 0.002 * i, z);
      (z > 0 ? this.nearPage : this.farPage).add(hinge);
      this.tabs.push({ paper, hinge });
    });

    // line B: a pop-up street sign, one blade per word
    const signH = new THREE.Group();
    signH.position.set(SIGN.x, 0.02, SIGN.z);
    const postGeo = new THREE.PlaneGeometry(0.09, SIGN.post); postGeo.translate(0, SIGN.post / 2, 0); this.disposables.push(postGeo);
    const post = new THREE.Mesh(postGeo, lambert({ color: col('graphite'), side: THREE.DoubleSide }));
    post.castShadow = true;
    signH.add(post);
    if (lineB) lineB.words.forEach((_w, j) => {
      const w = 1.95, h = 0.56, y = SIGN.post - 0.36 - j * 0.66;
      const paper = new WordPaper(lineB, j, w, h, 'bone');
      this.disposables.push(paper.t);
      const geo = new THREE.PlaneGeometry(w, h); this.disposables.push(geo);
      const face = new THREE.Mesh(geo, lambert({ map: paper.t, side: THREE.FrontSide }));
      const back = new THREE.Mesh(geo, lambert({ color: col('paper2'), side: THREE.FrontSide }));
      back.rotation.y = Math.PI;
      face.castShadow = true;
      const pivot = new THREE.Group(); pivot.rotation.order = 'YXZ';
      pivot.position.set(0, y, 0.02); pivot.add(face, back);
      signH.add(pivot);
      this.blades.push({ paper, pivot, rest: j % 2 ? -0.5 : 0.4, y });
    });
    this.farPage.add(signH);
    this.sign = { hinge: signH, tRise: lineB ? lineB.start - 0.02 : end, near: false, parts: [signH] };

    // light: one shadow-casting key + ambient fill
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    Object.assign(this.sun.shadow.camera, { left: -9, right: 9, top: 9, bottom: -9, near: 0.5, far: 60 });
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    this.sun.shadow.radius = 2;
    this.scene.add(this.sun, this.sun.target, this.amb);
  }

  /** Hinge progress of a piece: 0 flat .. 1 standing (overshoots), folding back down during the slam. */
  private rise(tRise: number, t: number) {
    if (t < tRise) return 0;
    const f = ease.outBack(clamp((t - tRise) / RISE), 2.2);
    return f * (1 - prog(t, this.tSlam, this.tSlam + (this.tShut - this.tSlam) * 0.55, ease.inOutQuad));
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, audio: au } = this.ctx;
    const t = f.t;
    const sh = shotAt(this.list, t);
    const camName = sh.shot.s.cam as Cam;
    const u = clamp((t - sh.t0) / Math.max(0.1, Math.min(sh.t1, this.ctx.end) - sh.t0));
    const uE = ease.inOutQuad(u);

    // --- camera (slow drift inside each shot; every cut is a new set-up)
    const cd = CAMS[camName];
    const L3 = (a: number[], b: number[]) => new THREE.Vector3(lerp(a[0]!, b[0]!, uE), lerp(a[1]!, b[1]!, uE), lerp(a[2]!, b[2]!, uE));
    const cam = this.cam;
    cam.fov = cd.fov;
    cam.up.set(...cd.up).normalize();
    cam.position.copy(L3(cd.p0, cd.p1));
    cam.lookAt(L3(cd.t0, cd.t1));
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();

    // --- book: opens on the first beat, jolts on downbeats, slams shut on the last beat
    const open = prog(t, this.tOpen, this.tOpen + 0.46, ease.outCubic);
    const shut = prog(t, this.tSlam + 0.1, this.tShut, ease.inCubic);
    const db = downbeatPulse(au, t, 0.14);
    this.nearPage.rotation.x = -Math.PI * (1 - open) - Math.PI * shut * open - 0.03 * (1 - shut);
    this.farPage.rotation.x = 0.03;
    this.book.position.y = -0.07 * db;
    this.book.scale.setScalar(1 + 0.012 * db);

    // --- pieces
    for (const p of this.pieces) {
      const fr = this.rise(p.tRise, t) * (p.near ? open : 1);
      p.hinge.rotation.x = -(1 - fr) * Math.PI / 2;
      p.hinge.visible = fr > 0.002;
    }
    const fs = this.rise(this.sign.tRise, t);
    this.sign.hinge.rotation.x = -(1 - fs) * Math.PI / 2;
    this.sign.hinge.visible = fs > 0.002;

    // --- lyric paper: the tab/blade carrying the sung word turns toward the camera
    this.book.updateMatrixWorld(true);
    const wp = new THREE.Vector3(), camPos = cam.position;
    for (const tb of this.tabs) {
      // once its word is over, a tab cropped by the close street shots lets its ink recede (the paper stays)
      const wEnd = tb.paper.word.end;
      tb.paper.draw(t, camName === 'low' || camName === 'floor' ? 1 - 0.7 * prog(t, wEnd + 0.15, wEnd + 0.55) : 1);
      tb.hinge.getWorldPosition(wp);
      const d = camPos.clone().sub(wp);
      const face = clamp(Math.atan2(d.z, d.y), 0, camName === 'low' ? 1.05 : 1.25);
      const a = tb.paper.active(t) * (1 - prog(t, this.tSlam, this.tSlam + 0.15));
      tb.hinge.rotation.x = -Math.PI / 2 + face * a;
      tb.hinge.visible = open > 0.98 || !this.nearPage.children.includes(tb.hinge);
    }
    for (const bl of this.blades) {
      bl.paper.draw(t);
      bl.pivot.getWorldPosition(wp);
      const d = camPos.clone().sub(wp);
      const yawT = Math.atan2(d.x, d.z), pitchT = -Math.atan2(d.y, Math.hypot(d.x, d.z));
      const a = bl.paper.active(t);
      const pop = 1 + a * (camName === 'overhead' || camName === 'slam' ? 0.45 : 0.14);
      bl.pivot.rotation.y = lerp(bl.rest, yawT, a);
      bl.pivot.rotation.x = clamp(pitchT, -1.45, 0.6) * a;
      // from above, the sung blade climbs over the post top and the other blade so nothing crosses its words
      bl.pivot.position.y = bl.y + a * (camName === 'overhead' || camName === 'slam' ? 1.15 : 0.12);
      bl.pivot.scale.setScalar(pop * (1 + 0.06 * beatPulse(au, t, 0.1) * a));
    }

    // --- light
    const ld = LIGHT[camName];
    const dir = new THREE.Vector3(...ld.dir).normalize();
    const kp = kickPulse(au, t, 0.1);
    this.sun.color.setRGB(...LIN[ld.key]);
    this.sun.intensity = ld.I * (1 + 0.1 * kp);
    this.sun.position.copy(dir.multiplyScalar(25));
    this.sun.target.position.set(0, 0, 0);
    this.sun.target.updateMatrixWorld();
    this.amb.color.setRGB(...LIN.bone);
    this.amb.intensity = ld.amb;
    const lineB = this.blades[0]?.paper.line;
    const lights = lineB ? 0.4 + 0.6 * prog(t, lineB.start, lineB.start + 0.35) : 1; // "the lights" come on with line B
    const glow = ld.glow * lights * (0.7 + 0.6 * kp);
    for (const p of this.pieces) if (p.glow) p.glow.color.setRGB(LIN.ember[0] * glow, LIN.ember[1] * glow, LIN.ember[2] * glow);

    // --- render (own MSAA target, shadows on for this pass only)
    const sm = renderer.shadowMap, prevOn = sm.enabled, prevType = sm.type;
    sm.enabled = true; sm.type = THREE.PCFShadowMap;
    clearRT(renderer, this.rt, LIN.bone);
    renderer.setRenderTarget(this.rt);
    renderer.render(this.scene, cam);
    sm.enabled = prevOn; sm.type = prevType;
    this.ctx.comp.draw(renderer, this.rt.texture, out, { mode: 'replace' });

    // --- hits: a small snap as each piece lands on its beat, a downbeat punch, the slam
    const bi = beatIndex(au, t), bp = beatPulse(au, t, 0.09);
    const impact = t >= this.tShut ? Math.exp(-(t - this.tShut) / 0.05) : 0;
    const sx = (hash(bi, 1) - 0.5) * 2 * 4 * bp + (hash(bi, 3) - 0.5) * 2 * 13 * impact;
    const sy = (hash(bi, 2) - 0.5) * 2 * 4 * bp + 11 * impact;
    const sk = Math.min(1, 14 / Math.max(1e-6, Math.hypot(sx, sy))); // T2 cap: shake <= 14 px
    return {
      shake: [sx * sk, sy * sk],
      zoom: Math.min(1.06, 1 + 0.045 * db + 0.06 * impact),
      bloom: ld.bloom,
      bloomThreshold: 0.92,
      grain: 0.05,
      vignette: 0.3,
      fade: t >= this.ctx.end - 0.5 / 60 ? 1 : 0, // the plate's last frame is black
    };
  }

  override dispose() {
    this.rt?.dispose();
    for (const d of this.disposables) d.dispose();
  }
}
