// POPUP — pop-up books. Variant 'city' (p28): a spread on a bone table, below. Variants 'life-sea' / 'life-land'
// (p18–p19, the popup-life sequence): a natural-history book in its own palette, see the LIFE section further down.
// Variant 'city' (p28-popup-city):
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
import { Scene, type Frame, type PostOverrides, type SceneCtx } from '../engine/scene';
import { makeRT, clearRT, W, H } from '../engine/gl';
import { LIN, rgba, palette, pcss, pmix, plin, type NamedPalette, type PaletteKey, type Role } from '../engine/palette';
import { drawLyric, layoutLine, ownedLines, F } from '../engine/lyric';
import { beatPulse, kickPulse, downbeatPulse, beatIndex } from '../engine/beat';
import { beatTimes, shotAt, type PlateInfo, type Shot } from '../engine/shots';
import { clamp, ease, hash, lerp, prog } from '../engine/util';
import type { Line, Word } from '../engine/lyrics';
import { shots, type Cam, type LifeCam } from './popup.shots';

// ------------------------------------------------------------------ layout (world units; book spine along x at z = 0)
const PAGE_W = 10, PAGE_D = 3.5, BOARD = 0.1;
const PX = 150; // texture px per world unit
const RISE = 0.12; // s for a piece to hinge up (v4 fix: the building is UP within 3 frames of its beat, and stays)
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
/** The life book's overhead 3/4 camera (p18/p19 'open'), held static for p28. */
const BOOK_CAM: CamDef = { p0: [0.6, 7.6, 10.6], p1: [0.6, 7.6, 10.6], t0: [0, 0.2, -0.6], t1: [0, 0.2, -0.6], fov: 40, up: [0, 1, 0] };
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

// ====================================================================== LIFE: variants 'life-sea' (p18), 'life-land' (p19)
// A natural-history pop-up book in the popup-life palette (cream table, navy sea, green land, red, signal orange).
// Spine along z at x = 0 (left and right pages), the reader in +z. Every piece is a printed paper cut-out with a
// cream paper-core rim, stood on a hinge (rotation.x) like the city pieces; animals are paper puppets whose limbs
// turn on split-pin brads. Everything moves to the right: toward the next page, the shore, the future.
//   life-sea   b0 the closed book opens (the right board swings over) on a primordial sea: volcano backdrop, wave strips
//              b1..b3 the cell divides 1→2→4→8 (one division per beat)     b4..b7 one fish per beat pops from the fold
//              and rises on its stem: jawless, armoured, ray-finned, lobe-finned
//   life-land  b0 a hard PAGE TURN (the sea leaf flips over the spine and lands as the new left page); the shore
//              b0..b12 one lineage per beat, each with its own gait: tetrapod (crawl), synapsid (sprawl), early mammal
//              (walk), lemur and monkey (climb), gibbon (swing), chimp and gorilla (knuckle-walk), four upright
//              hominins side by side on their own rows (Australopithecus, Paranthropus, H. erectus, Neanderthal), and on
//              the last beat, last of all, a human (signal orange). Then the book closes.
// Beat: every beat a piece hinges up and every walker takes one step (hold, then snap); downbeats jolt the book.
const LPW = 5.2, LD = 3.6, LBOARD = 0.12, LPX = 110, APX = 150, LRISE = 0.3;

type Ink = Role | [Role, Role, number];
const ink = (P: NamedPalette, k: Ink, a = 1) => (typeof k === 'string' ? pcss(P, k, a) : pmix(P, k[0], k[1], k[2], a));

interface Art { c: HTMLCanvasElement; x0: number; y0: number; x1: number; y1: number }
/** A piece of printed paper in world units (y up), APX px per unit. */
function art(x0: number, y0: number, x1: number, y1: number, fn: (g: CanvasRenderingContext2D) => void, px = APX): Art {
  const c = canvas((x1 - x0) * px, (y1 - y0) * px), g = c.getContext('2d')!;
  const sx = c.width / (x1 - x0), sy = c.height / (y1 - y0);
  g.setTransform(sx, 0, 0, -sy, -x0 * sx, y1 * sy);
  fn(g);
  return { c, x0, y0, x1, y1 };
}
/** A silhouette built from inked parts: the union is the cut line. */
class Shape {
  sil = new Path2D();
  parts: [Path2D, Ink][] = [];
  add(k: Ink, build: (p: Path2D) => void) { const p = new Path2D(); build(p); build(this.sil); this.parts.push([p, k]); return this; }
}
function ell(p: Path2D, cx: number, cy: number, rx: number, ry = rx, rot = 0) {
  p.moveTo(cx + rx * Math.cos(rot), cy + rx * Math.sin(rot));
  p.ellipse(cx, cy, rx, ry, rot, 0, Math.PI * 2);
  p.closePath();
}
function poly(p: Path2D, pts: number[]) {
  p.moveTo(pts[0]!, pts[1]!);
  for (let i = 2; i + 1 < pts.length; i += 2) p.lineTo(pts[i]!, pts[i + 1]!);
  p.closePath();
}
/** Tapered capsule (a limb, a trunk, a tail). */
function cap(p: Path2D, x0: number, y0: number, x1: number, y1: number, r0: number, r1 = r0) {
  const a = Math.atan2(y1 - y0, x1 - x0), nx = -Math.sin(a), ny = Math.cos(a);
  poly(p, [x0 + nx * r0, y0 + ny * r0, x1 + nx * r1, y1 + ny * r1, x1 - nx * r1, y1 - ny * r1, x0 - nx * r0, y0 - ny * r0]);
  ell(p, x0, y0, r0); ell(p, x1, y1, r1);
}
/** Cut the shape out: cream paper-core rim, flat printed inks, print detail and litho stipple clipped inside. */
function cut(g: CanvasRenderingContext2D, P: NamedPalette, s: Shape, detail: ((g: CanvasRenderingContext2D) => void) | null, seed: number) {
  g.lineJoin = 'round';
  g.strokeStyle = pcss(P, 'ground'); g.lineWidth = 7 / APX; g.stroke(s.sil);
  for (const [p, k] of s.parts) { g.fillStyle = ink(P, k); g.fill(p); }
  g.save();
  g.clip(s.sil);
  if (detail) detail(g);
  // litho stipple and paper grain, in device px
  g.setTransform(1, 0, 0, 1, 0, 0);
  const w = g.canvas.width, h = g.canvas.height, n = Math.round((w * h) / 420);
  g.fillStyle = pcss(P, 'deep', 0.16);
  for (let k = 0; k < n; k++) g.fillRect(hash(seed, k, 1) * w, hash(seed, k, 2) * h, 2, 2);
  g.fillStyle = pcss(P, 'ground', 0.14);
  for (let k = 0; k < n / 2; k++) g.fillRect(hash(seed, k, 3) * w, hash(seed, k, 4) * h, 2, 2);
  g.fillStyle = g.createPattern(grain(), 'repeat')!;
  g.fillRect(0, 0, w, h);
  g.restore();
}
function eye(g: CanvasRenderingContext2D, P: NamedPalette, x: number, y: number, r: number) {
  const p = new Path2D(); ell(p, x, y, r); g.fillStyle = pcss(P, 'ground'); g.fill(p);
  const q = new Path2D(); ell(q, x + r * 0.2, y, r * 0.5); g.fillStyle = pcss(P, 'text'); g.fill(q);
}
function lines(g: CanvasRenderingContext2D, P: NamedPalette, k: Ink, a: number, lw: number, segs: number[][]) {
  g.strokeStyle = ink(P, k, a); g.lineWidth = lw / APX; g.lineCap = 'round';
  g.beginPath();
  for (const s of segs) { g.moveTo(s[0]!, s[1]!); for (let i = 2; i + 1 < s.length; i += 2) g.lineTo(s[i]!, s[i + 1]!); }
  g.stroke();
}
function spots(g: CanvasRenderingContext2D, P: NamedPalette, k: Ink, a: number, n: number, x0: number, x1: number, y0: number, y1: number, r: number, seed: number) {
  const p = new Path2D();
  for (let i = 0; i < n; i++) ell(p, lerp(x0, x1, hash(seed, i, 7)), lerp(y0, y1, hash(seed, i, 8)), r * (0.6 + 0.8 * hash(seed, i, 9)));
  g.fillStyle = ink(P, k, a); g.fill(p);
}

// ------------------------------------------------------------------ puppets
type Gait = 'crawl' | 'walk' | 'climb' | 'swing' | 'knuckle' | 'upright' | 'swim';
type End = 'paw' | 'hand' | 'foot' | 'knuckle' | 'tail';
/** A limb on a brad at (x, y) of the body; hangs down at rest; angle = base + amp·cos(π·(step + ph)). */
interface Limb { x: number; y: number; len: number; w: number; near: boolean; end: End; base: number; amp: number; ph: number; tool?: 'axe' | 'spear' }
interface Critter { key: string; ink: Ink; body: Art; limbs: Limb[]; gait: Gait; stride: number; beat: number; x: number; z: number; y: number; delay?: number }

function limbArt(P: NamedPalette, L: Limb, k: Ink): Art {
  const r = L.w / 2, top = L.tool === 'spear' ? 1.75 - L.len : r + 0.04, sideX = L.tool === 'spear' ? 0.3 : 0.24;
  return art(-sideX, -L.len - (L.end === 'tail' ? 0.32 : 0.14), sideX, top, (g) => {
    const s = new Shape();
    const kk: Ink = L.near ? k : (typeof k === 'string' ? [k, 'deep', k === 'deep' ? 0 : 0.3] : [k[0], k[1], Math.min(1, k[2] + 0.2)]);
    if (L.tool === 'spear') s.add(['deep', 'text', 0.5], (p) => { poly(p, [-0.012, -L.len - 0.3, 0.012, -L.len - 0.3, 0.012, 1.6 - L.len, -0.012, 1.6 - L.len]); poly(p, [-0.03, 1.6 - L.len, 0, 1.72 - L.len, 0.03, 1.6 - L.len]); });
    s.add(kk, (p) => cap(p, 0, 0, 0, -L.len, r, r * 0.78));
    const e = -L.len, q = r * 0.78;
    if (L.end === 'paw') s.add(kk, (p) => { ell(p, q * 0.8, e - q * 0.3, q * 1.7, q * 0.62); for (let i = 0; i < 3; i++) cap(p, q * 0.8, e - q * 0.4, q * (1.6 + 0.9 * i), e - q * (1.0 - 0.2 * i), q * 0.28); });
    if (L.end === 'foot') s.add(kk, (p) => poly(p, [-q * 1.1, e + q * 0.3, -q * 1.2, e - q * 1.0, q * 3.6, e - q * 1.05, q * 3.4, e - q * 0.25, q * 0.9, e + q * 0.4]));
    if (L.end === 'hand') s.add(kk, (p) => ell(p, q * 0.25, e - q * 0.9, q * 0.95, q * 1.45, 0.15));
    if (L.end === 'knuckle') s.add(kk, (p) => ell(p, q * 0.5, e - q * 0.4, q * 1.35, q * 0.9));
    if (L.end === 'tail') s.add(kk, (p) => poly(p, [-q * 0.6, e + q, -0.2, e - 0.28, 0, e - 0.1, 0.2, e - 0.28, q * 0.6, e + q]));
    if (L.tool === 'axe') s.add(['deep', 'text', 0.3], (p) => poly(p, [q * 0.4, e - q * 0.3, q * 2.6, e - q * 1.4, q * 3.4, e - q * 0.2, q * 2.2, e + q * 1.2]));
    cut(g, P, s, (g) => {
      // split-pin brad at the pivot
      const b = new Path2D(); ell(b, 0, 0, Math.max(0.018, r * 0.42)); g.fillStyle = pcss(P, 'ground', 0.9); g.fill(b);
      const d = new Path2D(); ell(d, 0, 0, Math.max(0.008, r * 0.18)); g.fillStyle = pcss(P, 'text', 0.8); g.fill(d);
      if (L.end === 'tail') lines(g, P, 'ground', 0.5, 2, [[-0.14, e - 0.2, 0, e - 0.02, 0.14, e - 0.2]]);
    }, 400 + Math.round(L.len * 100));
  });
}

// ---- bodies (facing +x, feet on y = 0)
function tetrapodBody(P: NamedPalette): Art {
  return art(-1.28, 0, 1.12, 0.5, (g) => {
    const s = new Shape()
      .add('mid', (p) => ell(p, 0, 0.24, 0.6, 0.13))
      .add('mid', (p) => poly(p, [0.45, 0.15, 0.98, 0.19, 1.03, 0.24, 0.86, 0.31, 0.5, 0.35]))
      .add('mid', (p) => poly(p, [-0.5, 0.31, -1.15, 0.29, -1.22, 0.24, -0.5, 0.16]))
      .add(['mid', 'deep', 0.4], (p) => poly(p, [-0.45, 0.33, -1.12, 0.38, -1.2, 0.3, -0.6, 0.3]));
    cut(g, P, s, (g) => {
      spots(g, P, 'deep', 0.55, 12, -0.9, 0.5, 0.18, 0.32, 0.03, 11);
      lines(g, P, 'text', 0.5, 2, [[0.62, 0.21, 1.0, 0.215]]);
      eye(g, P, 0.84, 0.28, 0.035);
    }, 1);
  });
}
function synapsidBody(P: NamedPalette): Art {
  return art(-1.34, 0, 1.0, 1.05, (g) => {
    const sail: number[] = [];
    for (let i = 0; i <= 16; i++) { const x = -0.42 + (i * 0.84) / 16; sail.push(x, 0.36 + 0.6 * Math.sin((Math.PI * i) / 16) + (i % 2 ? 0.05 : 0)); }
    sail.push(0.42, 0.33, -0.42, 0.33);
    const s = new Shape()
      .add(['hi', 'deep', 0.35], (p) => poly(p, sail))
      .add('hi', (p) => ell(p, 0, 0.3, 0.5, 0.12))
      .add('hi', (p) => { ell(p, 0.6, 0.32, 0.2, 0.1); poly(p, [0.6, 0.24, 0.88, 0.27, 0.86, 0.36, 0.62, 0.41]); })
      .add('hi', (p) => poly(p, [-0.45, 0.35, -1.25, 0.19, -1.3, 0.16, -0.42, 0.21]));
    cut(g, P, s, (g) => {
      const sp: number[][] = [];
      for (let i = 1; i < 16; i++) { const x = -0.42 + (i * 0.84) / 16; sp.push([x, 0.36, x, 0.36 + 0.58 * Math.sin((Math.PI * i) / 16)]); }
      lines(g, P, 'text', 0.45, 2, sp);
      lines(g, P, ['hi', 'deep', 0.5], 0.8, 5, [[-0.4, 0.26, 0.4, 0.27]]);
      lines(g, P, 'text', 0.6, 2, [[0.66, 0.285, 0.87, 0.3]]);
      eye(g, P, 0.72, 0.35, 0.03);
    }, 2);
  });
}
function mammalBody(P: NamedPalette): Art {
  return art(-0.75, 0, 0.52, 0.42, (g) => {
    const s = new Shape()
      .add('deep', (p) => ell(p, 0, 0.21, 0.27, 0.11))
      .add('deep', (p) => poly(p, [0.16, 0.29, 0.44, 0.21, 0.48, 0.18, 0.4, 0.15, 0.17, 0.12]))
      .add('deep', (p) => ell(p, 0.2, 0.31, 0.05, 0.065, -0.3))
      .add('deep', (p) => cap(p, -0.23, 0.2, -0.7, 0.1, 0.022, 0.008));
    cut(g, P, s, (g) => {
      lines(g, P, 'ground', 0.55, 1.5, [[0.42, 0.19, 0.52, 0.22], [0.42, 0.18, 0.52, 0.16]]);
      eye(g, P, 0.33, 0.225, 0.022);
    }, 3);
  });
}
/** A primate clinging to a trunk (vertical, head up, facing +x). */
function climberBody(P: NamedPalette, k: Ink, lemur: boolean): Art {
  return art(-0.45, -0.62, 0.34, 1.02, (g) => {
    const s = new Shape()
      .add(k, (p) => ell(p, 0, 0.5, 0.12, 0.26, 0.08))
      .add(k, (p) => { ell(p, 0.02, 0.86, 0.1, 0.095); poly(p, lemur ? [0.05, 0.9, 0.22, 0.84, 0.21, 0.8, 0.05, 0.8] : [0.07, 0.86, 0.15, 0.83, 0.14, 0.79, 0.05, 0.8]); ell(p, -0.05, 0.94, 0.035, 0.045); })
      .add(k, (p) => (lemur ? cap(p, -0.05, 0.3, -0.16, -0.55, 0.045, 0.035) : cap(p, -0.06, 0.3, -0.3, 0.95, 0.025, 0.015)));
    cut(g, P, s, (g) => {
      if (lemur) { const r: number[][] = []; for (let i = 0; i < 7; i++) { const y = 0.2 - i * 0.11, x = -0.07 - i * 0.015; r.push([x - 0.06, y, x + 0.06, y - 0.02]); } lines(g, P, 'ground', 0.95, 7, r); }
      else spots(g, P, 'ground', 0.25, 10, -0.08, 0.1, 0.3, 0.7, 0.02, 44);
      eye(g, P, 0.09, 0.88, 0.022);
    }, lemur ? 4 : 5);
  });
}
/** A gibbon hanging from its hand grip (origin = the grip). */
function gibbonBody(P: NamedPalette): Art {
  return art(-0.3, -1.25, 0.3, 0.08, (g) => {
    const s = new Shape()
      .add('deep', (p) => { cap(p, 0, 0, -0.06, -0.58, 0.035, 0.04); cap(p, 0.02, 0, 0.09, -0.58, 0.03, 0.04); })
      .add('deep', (p) => ell(p, 0.01, -0.8, 0.11, 0.2))
      .add('deep', (p) => ell(p, 0.05, -0.5, 0.075, 0.075));
    cut(g, P, s, (g) => { const f = new Path2D(); ell(f, 0.08, -0.51, 0.04, 0.045); g.fillStyle = pcss(P, 'ground', 0.55); g.fill(f); eye(g, P, 0.09, -0.49, 0.013); }, 6);
  });
}
/** Knuckle-walking great ape (chimp s = 1, gorilla s = 1.3 with a crest and a silver saddle). */
function apeBody(P: NamedPalette, k: Ink, s: number, gorilla: boolean): Art {
  return art(-0.62 * s, 0, 0.66 * s, 1.1 * s, (g) => {
    g.scale(s, s);
    const sh = new Shape()
      .add(k, (p) => ell(p, 0, 0.64, 0.31, 0.21, 0.42))
      .add(k, (p) => { ell(p, 0.36, 0.84, 0.12, 0.12); ell(p, 0.46, 0.79, 0.085, 0.065); if (gorilla) poly(p, [0.28, 0.93, 0.36, 1.02, 0.44, 0.92]); })
      .add(k, (p) => ell(p, -0.24, 0.52, 0.16, 0.13));
    cut(g, P, sh, (g) => {
      if (gorilla) { const b = new Path2D(); ell(b, -0.06, 0.66, 0.2, 0.09, 0.42); g.fillStyle = pcss(P, 'ground', 0.4); g.fill(b); }
      const f = new Path2D(); ell(f, 0.44, 0.81, 0.07, 0.06); g.fillStyle = pcss(P, 'ground', gorilla ? 0.18 : 0.3); g.fill(f);
      eye(g, P, 0.42, 0.87, 0.02);
    }, gorilla ? 8 : 7);
  });
}
interface HomOpts { H: number; stoop: number; arm: number; head: number; brow: number; jaw: number; wide: number; crest?: boolean; round?: boolean; tool?: 'axe' | 'spear' }
/** Upright hominin: body art + legs on the hip brad and arms on the shoulder brad. */
function hominin(P: NamedPalette, k: Ink, o: HomOpts, seed: number): { body: Art; limbs: Limb[] } {
  const { H } = o, L = 0.48 * H, sx = o.stoop * H * 0.5, sy = L + 0.31 * H, w = 0.075 * o.wide * H;
  const hr = o.head * H, hx = sx + 0.03 * H + o.stoop * 0.12 * H, hy = sy + 0.1 * H;
  const body = art(-0.35 * H, 0.3 * H, 0.35 * H, H + 0.08, (g) => {
    const s = new Shape()
      .add(k, (p) => poly(p, [-w, L - 0.03 * H, sx - w * 1.05, sy + 0.01 * H, sx + w * 1.1, sy - 0.02 * H, w * 1.05, L + 0.02 * H]))
      .add(k, (p) => ell(p, 0.1 * w, L + 0.02 * H, w * 1.05, 0.06 * H))
      .add(k, (p) => cap(p, sx, sy, hx - 0.01 * H, hy - hr * 0.6, 0.032 * H, 0.028 * H))
      .add(k, (p) => {
        if (o.round) ell(p, hx - 0.005 * H, hy + 0.012 * H, hr * 1.08, hr * 1.2);
        else ell(p, hx, hy, hr * 1.05, hr * 0.95);
        if (o.jaw > 0.015) poly(p, [hx, hy - hr * 0.95, hx + hr + o.jaw * H, hy - hr * 0.55, hx + hr + o.jaw * H * 0.8, hy + 0.1 * hr, hx, hy]);
        else poly(p, [hx, hy - hr * 1.0, hx + hr * 1.1, hy - hr * 0.6, hx + hr * 1.15, hy + 0.05 * hr, hx, hy]);
        if (o.brow) poly(p, [hx + hr * 0.4, hy + hr * 0.45, hx + hr * 1.3, hy + hr * 0.3, hx + hr * 1.25, hy + hr * 0.12, hx + hr * 0.4, hy + hr * 0.2]);
        if (o.crest) poly(p, [hx - hr * 0.5, hy + hr * 0.8, hx - hr * 0.1, hy + hr * 1.35, hx + hr * 0.3, hy + hr * 0.85]);
      });
    cut(g, P, s, (g) => {
      eye(g, P, hx + hr * 0.75, hy + hr * 0.1, Math.max(0.012, hr * 0.14));
      lines(g, P, 'ground', 0.35, 2, [[sx - w * 0.5, sy - 0.06 * H, w * 0.2, L + 0.08 * H]]);
    }, seed);
  });
  const lw = 0.075 * H * (0.8 + 0.2 * o.wide), aw = 0.056 * H * (0.8 + 0.2 * o.wide);
  const limbs: Limb[] = [
    { x: 0.01 * H, y: L, len: L - 0.035 * H, w: lw, near: false, end: 'foot', base: 0, amp: 0.36, ph: 1 },
    { x: sx, y: sy - 0.02 * H, len: o.arm * H, w: aw, near: false, end: 'hand', base: 0.05, amp: 0.3, ph: 0 },
    { x: 0.01 * H, y: L, len: L - 0.035 * H, w: lw, near: true, end: 'foot', base: 0, amp: 0.36, ph: 0 },
    { x: sx, y: sy - 0.02 * H, len: o.arm * H, w: aw, near: true, end: 'hand', base: 0.05, amp: 0.3, ph: 1, tool: o.tool },
  ];
  return { body, limbs };
}
const quad = (x: number, y: number, len: number, w: number, near: boolean, end: End, base: number, amp: number, ph: number): Limb => ({ x, y, len, w, near, end, base, amp, ph });

// ---- fish, cells, sea and land set pieces
function fishBody(P: NamedPalette, kind: number): { body: Art; tail: Limb; k: Ink } {
  const K: Ink[] = ['mid', 'deep', 'hi', ['mid', 'deep', 0.25]];
  const k = K[kind]!;
  const body = art(-0.75, -0.36, 0.78, 0.36, (g) => {
    const s = new Shape();
    if (kind === 0) s.add(k, (p) => { ell(p, 0.12, 0, 0.36, 0.14); poly(p, [0.05, 0.12, -0.5, 0.06, -0.52, -0.04, 0.05, -0.12]); });
    if (kind === 1) {
      s.add(['deep', 'mid', 0.45], (p) => poly(p, [0.05, 0.17, -0.62, 0.07, -0.66, -0.04, 0.05, -0.15]));
      s.add(k, (p) => { ell(p, 0.24, 0.02, 0.34, 0.2); poly(p, [0.4, -0.05, 0.68, -0.02, 0.62, -0.13, 0.32, -0.16]); });
    }
    if (kind === 2) {
      s.add(['hi', 'deep', 0.3], (p) => { poly(p, [-0.16, 0.14, 0.04, 0.33, 0.14, 0.14]); poly(p, [-0.06, -0.13, 0.04, -0.27, 0.13, -0.12]); });
      s.add(k, (p) => ell(p, 0, 0, 0.42, 0.17));
    }
    if (kind === 3) {
      s.add(['mid', 'deep', 0.55], (p) => { ell(p, 0.2, -0.2, 0.1, 0.05, -0.5); cap(p, 0.2, -0.1, 0.24, -0.2, 0.03); ell(p, -0.2, -0.18, 0.09, 0.045, -0.5); cap(p, -0.2, -0.1, -0.17, -0.18, 0.03); poly(p, [-0.1, 0.1, 0.0, 0.22, 0.08, 0.1]); });
      s.add(k, (p) => ell(p, 0, 0, 0.55, 0.14));
    }
    cut(g, P, s, (g) => {
      if (kind === 0) { const d = new Path2D(); for (let i = 0; i < 6; i++) ell(d, 0.06 - i * 0.07, -0.02, 0.014); g.fillStyle = pcss(P, 'text', 0.6); g.fill(d); lines(g, P, 'ground', 0.5, 2, [[0.4, 0.08, 0.1, 0.12, -0.2, 0.08]]); eye(g, P, 0.34, 0.03, 0.03); }
      if (kind === 1) { lines(g, P, 'ground', 0.55, 2.5, [[0.1, 0.2, 0.18, -0.16], [0.36, 0.2, 0.44, -0.08], [0.1, 0.02, 0.5, 0.06]]); eye(g, P, 0.42, 0.08, 0.045); }
      if (kind === 2) { const a: number[][] = []; for (let i = 0; i < 5; i++) for (let j = 0; j < 3; j++) { const x = 0.2 - i * 0.1, y = -0.08 + j * 0.08; a.push([x, y + 0.035, x - 0.04, y, x, y - 0.035]); } lines(g, P, 'ground', 0.45, 1.5, a); lines(g, P, 'text', 0.5, 2, [[0.24, 0.1, 0.2, 0, 0.24, -0.1]]); eye(g, P, 0.31, 0.04, 0.033); }
      if (kind === 3) { spots(g, P, 'deep', 0.6, 14, -0.45, 0.35, -0.08, 0.08, 0.02, 31); eye(g, P, 0.45, 0.03, 0.03); }
    }, 60 + kind);
  });
  const tail: Limb = { x: kind === 2 ? -0.38 : kind === 3 ? -0.5 : kind === 1 ? -0.6 : -0.48, y: 0, len: 0.14, w: 0.07, near: true, end: 'tail', base: -Math.PI / 2, amp: 0.35, ph: 0 };
  return { body, tail, k };
}
function cellArt(P: NamedPalette): Art {
  return art(-1.08, -1.08, 1.08, 1.08, (g) => {
    const s = new Shape().add('signal', (p) => ell(p, 0, 0, 1)).add(['ground', 'signal', 0.28], (p) => ell(p, 0, 0, 0.84)).add('hi', (p) => ell(p, 0.14, 0.1, 0.34, 0.3));
    cut(g, P, s, (g) => {
      spots(g, P, 'deep', 0.45, 9, -0.6, 0.55, -0.6, -0.1, 0.05, 71);
      spots(g, P, 'signal', 0.6, 6, -0.65, -0.1, 0.1, 0.6, 0.06, 72);
      const n = new Path2D(); ell(n, 0.2, 0.14, 0.09); g.fillStyle = pcss(P, 'deep', 0.85); g.fill(n);
    }, 70);
  }, 120);
}
function waveArt(P: NamedPalette, h: number, k: Ink, seed: number): Art {
  const lam = 1.05 + 0.3 * hash(seed, 1), ph = hash(seed, 2) * 6;
  const top = (x: number) => h + 0.16 * Math.pow(1 - Math.abs(Math.sin((Math.PI * x) / lam + ph)), 2.2);
  return art(-LPW, 0, LPW, h + 0.22, (g) => {
    const pts: number[] = [-LPW, 0];
    for (let x = -LPW; x <= LPW + 1e-6; x += 0.04) pts.push(x, top(x));
    pts.push(LPW, 0);
    const s = new Shape().add(k, (p) => poly(p, pts));
    cut(g, P, s, (g) => {
      const f: number[][] = [], f2: number[][] = [];
      for (let x = -LPW; x < LPW; x += 0.24) { f.push([x, top(x) - 0.07, x + 0.13, top(x + 0.13) - 0.07]); if (hash(seed, Math.round(x * 10)) < 0.4) f2.push([x, top(x) - 0.2 - 0.3 * hash(seed, x * 7), x + 0.16, top(x) - 0.22 - 0.3 * hash(seed, x * 7)]); }
      lines(g, P, 'ground', 0.75, 4, f);
      lines(g, P, 'ground', 0.35, 3, f2);
      lines(g, P, 'mid', 0.3, 6, [[-LPW, h * 0.45, LPW, h * 0.4]]);
    }, 80 + seed);
  }, 120);
}
function seaBackdrop(P: NamedPalette): Art {
  return art(-LPW, 0, LPW, 3.3, (g) => {
    const s = new Shape()
      .add(['deep', 'mid', 0.2], (p) => poly(p, [-LPW, 0, LPW, 0, LPW, 0.6, -LPW, 0.6]))
      .add(['ground', 'deep', 0.3], (p) => { ell(p, -3.0, 2.45, 0.34, 0.2); ell(p, -2.75, 2.75, 0.4, 0.24); ell(p, -2.35, 3.0, 0.45, 0.2); })
      .add('deep', (p) => poly(p, [-4.8, 0, -3.25, 2.15, -2.95, 2.18, -1.2, 0]))
      .add(['deep', 'mid', 0.3], (p) => poly(p, [0.4, 0, 2.2, 1.62, 2.55, 1.65, 4.7, 0]))
      .add('signal', (p) => { ell(p, 3.1, 2.55, 0.42); poly(p, [-3.25, 2.15, -3.1, 2.4, -2.95, 2.18]); });
    cut(g, P, s, (g) => {
      lines(g, P, 'signal', 0.85, 5, [[-3.12, 2.1, -3.3, 1.5, -3.45, 1.1], [-3.0, 2.1, -2.8, 1.6, -2.5, 1.2], [2.35, 1.58, 2.6, 1.1, 2.9, 0.8]]);
      lines(g, P, 'ground', 0.45, 3, [[-LPW, 0.3, LPW, 0.32], [-LPW, 0.45, LPW, 0.44]]);
    }, 90);
  }, 110);
}
function landBackdrop(P: NamedPalette): Art {
  return art(-LPW, 0, LPW, 3.1, (g) => {
    const m: number[] = [-LPW, 0], hl: number[] = [-LPW, 0];
    for (let x = -LPW; x <= LPW + 1e-6; x += 0.2) m.push(x, 1.35 + 0.9 * Math.abs(Math.sin(x * 0.9 + 1.3)) * (0.6 + 0.4 * hash(Math.round(x * 5), 3)));
    for (let x = -LPW; x <= LPW + 1e-6; x += 0.1) hl.push(x, 0.75 + 0.3 * Math.sin(x * 1.3) + 0.12 * Math.sin(x * 3.1));
    m.push(LPW, 0); hl.push(LPW, 0);
    const s = new Shape()
      .add('signal', (p) => ell(p, -2.9, 2.45, 0.46))
      .add('deep', (p) => poly(p, m))
      .add(['mid', 'deep', 0.25], (p) => poly(p, hl));
    cut(g, P, s, (g) => {
      const r: number[][] = [];
      for (let i = 0; i < 9; i++) { const a = (i / 8) * Math.PI; r.push([-2.9 + Math.cos(a) * 0.56, 2.45 + Math.sin(a) * 0.56, -2.9 + Math.cos(a) * 0.8, 2.45 + Math.sin(a) * 0.8]); }
      lines(g, P, 'signal', 0.8, 4, r);
      spots(g, P, 'mid', 0.5, 40, -LPW, LPW, 0.1, 0.9, 0.05, 92);
    }, 91);
  }, 110);
}
function treeArt(P: NamedPalette, h: number, seed: number, branch = 0): Art {
  return art(-1.0, 0, 1.0 + branch, h + 0.1, (g) => {
    const s = new Shape()
      .add('deep', (p) => { poly(p, [-0.13, 0, -0.05, h * 0.75, 0.05, h * 0.75, 0.13, 0]); cap(p, 0, h * 0.5, -0.45, h * 0.7, 0.04, 0.02); cap(p, 0, h * 0.58, 0.4, h * 0.76, 0.04, 0.02); if (branch) cap(p, 0, h * 0.6, branch, h * 0.63, 0.05, 0.035); })
      .add(['mid', 'deep', 0.2 * hash(seed, 1)], (p) => { for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2 + seed; ell(p, Math.cos(a) * 0.42 * (0.7 + 0.4 * hash(seed, i)), h * 0.8 + Math.sin(a) * 0.3, 0.3 + 0.12 * hash(seed, i, 2)); } ell(p, 0, h * 0.82, 0.45, 0.35); });
    cut(g, P, s, (g) => {
      spots(g, P, 'deep', 0.4, 24, -0.7, 0.7, h * 0.6, h * 1.0, 0.035, seed * 3);
      spots(g, P, 'hi', 0.95, 6, -0.55, 0.55, h * 0.66, h * 0.95, 0.035, seed * 5);
      lines(g, P, 'ground', 0.3, 2, [[-0.05, 0.1, -0.02, h * 0.6], [0.06, 0.25, 0.04, h * 0.5]]);
    }, 100 + seed);
  }, 110);
}
function fernArt(P: NamedPalette, h: number, seed: number): Art {
  return art(-0.6, 0, 0.6, h + 0.05, (g) => {
    const s = new Shape().add(['mid', 'deep', 0.35 * hash(seed, 4)], (p) => {
      for (let i = 0; i < 5; i++) { const a = -0.7 + (i / 4) * 1.4, L = h * (0.7 + 0.3 * Math.cos(a)); cap(p, 0, 0, Math.sin(a) * L * 0.6, L, 0.035, 0.012); for (let j = 1; j < 5; j++) { const f = j / 5; ell(p, Math.sin(a) * L * 0.6 * f, L * f, 0.08 * (1 - f * 0.5), 0.025, 1.2 - a); } }
    });
    cut(g, P, s, null, 120 + seed);
  }, 120);
}
/** A printed page floor (canvas top = far edge). 'sea' or 'land'; side -1 = left page, +1 = right page. */
function lifePage(P: NamedPalette, kind: 'sea' | 'land', side: number): HTMLCanvasElement {
  const cw = LPW * LPX, ch = 2 * LD * LPX, c = canvas(cw, ch), g = c.getContext('2d')!;
  const X = (x: number) => (side < 0 ? x + LPW : x) * LPX, Y = (z: number) => (z + LD) * LPX;
  const band = (k: Ink, a: number, z0: (x: number) => number, z1: number) => {
    g.beginPath(); g.moveTo(X(side < 0 ? -LPW : 0), Y(z1));
    for (let x = side < 0 ? -LPW : 0; x <= (side < 0 ? 0 : LPW) + 1e-6; x += 0.1) g.lineTo(X(x), Y(z0(x)));
    g.lineTo(X(side < 0 ? 0 : LPW), Y(z1)); g.closePath(); g.fillStyle = ink(P, k, a); g.fill();
  };
  g.fillStyle = pcss(P, 'ground'); g.fillRect(0, 0, cw, ch);
  if (kind === 'sea') {
    band('deep', 1, () => -LD, LD);
    for (let i = 0; i < 9; i++) { const z = -LD + 0.4 + i * 0.8; band(i % 2 ? ['deep', 'mid', 0.5] : ['deep', 'ground', 0.1], 0.8, (x) => z + 0.1 * Math.sin(x * 2.2 + i), z + 0.35); }
    g.strokeStyle = pcss(P, 'ground', 0.4); g.lineWidth = 3;
    for (let i = 0; i < 60; i++) { const x = hash(i, 5) * LPW * side, z = -LD + hash(i, 6) * 2 * LD; g.beginPath(); g.arc(X(x), Y(z), 10 + 14 * hash(i, 7), Math.PI * 1.1, Math.PI * 1.9); g.stroke(); }
  } else {
    band(['mid', 'deep', 0.5], 1, () => -LD, -0.9);
    band('mid', 1, (x) => -1.0 + 0.12 * Math.sin(x * 1.7), 1.3);
    band(['ground', 'hi', 0.14], 1, (x) => 1.2 + 0.1 * Math.sin(x * 2.3 + 1), 2.5);
    band('deep', 1, (x) => 2.4 + 0.12 * Math.sin(x * 1.9 + 2), LD);
    band(['deep', 'mid', 0.5], 0.8, (x) => 2.9 + 0.08 * Math.sin(x * 3 + 1), 3.2);
    g.fillStyle = pcss(P, 'hi', 0.3);
    for (let i = 0; i < 260; i++) g.fillRect(X(hash(i, 9) * LPW * side), Y(1.3 + hash(i, 10) * 1.1), 3, 3);
    g.fillStyle = pcss(P, 'deep', 0.35);
    for (let i = 0; i < 420; i++) g.fillRect(X(hash(i, 11) * LPW * side), Y(-LD + hash(i, 12) * 4.9), 3, 5);
    g.strokeStyle = pcss(P, 'ground', 0.7); g.lineWidth = 4;
    g.beginPath(); for (let x = side < 0 ? -LPW : 0; x <= (side < 0 ? 0 : LPW); x += 0.1) g.lineTo(X(x), Y(2.47 + 0.12 * Math.sin(x * 1.9 + 2))); g.stroke();
  }
  // litho stipple, grain, gutter shade and the fold line
  g.fillStyle = pcss(P, 'ground', 0.12);
  for (let i = 0; i < 1400; i++) g.fillRect(hash(i, 21) * cw, hash(i, 22) * ch, 2, 2);
  g.fillStyle = g.createPattern(grain(), 'repeat')!; g.fillRect(0, 0, cw, ch);
  const gx = side < 0 ? cw : 0, q = g.createLinearGradient(gx, 0, side < 0 ? cw - 0.8 * LPX : 0.8 * LPX, 0);
  q.addColorStop(0, pcss(P, 'deep', 0.45)); q.addColorStop(0.3, pcss(P, 'deep', 0.12)); q.addColorStop(1, pcss(P, 'deep', 0));
  g.fillStyle = q; g.fillRect(0, 0, cw, ch);
  g.strokeStyle = pcss(P, 'ground', 0.9); g.lineWidth = 10; g.strokeRect(5, 5, cw - 10, ch - 10);
  return c;
}

// ------------------------------------------------------------------ the life book
type V3 = [number, number, number];
interface LCam { p0: V3; p1: V3; t0: V3; t1: V3; fov: number; roll: number; dir: V3; I: number; amb: number }
interface Walker { c: Critter; hinge: THREE.Group; walker: THREE.Group; limbs: { g: THREE.Group; L: Limb }[]; tRise: number }
interface Stand { hinge: THREE.Group; tRise: number; rock?: number }

class LifeBook {
  private P: NamedPalette;
  private sea: boolean;
  private list: Shot[];
  private beats: number[];
  private rt: THREE.WebGLRenderTarget;
  private scene = new THREE.Scene();
  private cam = new THREE.PerspectiveCamera(40, W / H, 0.05, 300);
  private sun = new THREE.DirectionalLight();
  private amb = new THREE.AmbientLight();
  private book = new THREE.Group();
  private rightBoard = new THREE.Group();
  private closer = new THREE.Group();
  private leaf1 = new THREE.Group();
  private leaf2 = new THREE.Group();
  private stands: Stand[] = [];
  private walkers: Walker[] = [];
  private cells: { g: THREE.Group; stem: THREE.Mesh }[] = [];
  private cellHinge = new THREE.Group();
  private fish: (Walker & { stem: THREE.Mesh; y0: number })[] = [];
  private tCell = 0;
  private disposables: { dispose(): void }[] = [];
  private mats = new Map<string, THREE.MeshLambertMaterial>();

  constructor(private ctx: SceneCtx, private plate: PlateInfo) {
    this.P = palette(plate.look?.palette ?? 'popup-life');
    this.sea = plate.variant === 'life-sea';
    this.list = shots(plate, ctx.audio);
    this.beats = beatTimes(ctx.audio, plate.start - 1e-3, plate.end);
    this.rt = makeRT(W, H, { samples: 4 });
    this.build();
  }

  private b(i: number) { return this.beats[i] ?? this.plate.end; }
  private tex(c: HTMLCanvasElement) { const x = tex(c); x.anisotropy = this.ctx.renderer.capabilities.getMaxAnisotropy(); this.disposables.push(x); return x; }
  private flat(k: Ink) {
    const key = JSON.stringify(k);
    let m = this.mats.get(key);
    if (!m) {
      const c = new THREE.Color().setRGB(...plin(this.P, typeof k === 'string' ? k : k[0]));
      if (typeof k !== 'string') c.lerp(new THREE.Color().setRGB(...plin(this.P, k[1])), k[2]);
      m = new THREE.MeshLambertMaterial({ color: c });
      this.mats.set(key, m); this.disposables.push(m);
    }
    return m;
  }
  /** Mesh of a paper piece: the art's origin at the mesh origin. */
  private mesh(a: Art, segX = 1) {
    const geo = new THREE.PlaneGeometry(a.x1 - a.x0, a.y1 - a.y0, segX, 1);
    geo.translate((a.x0 + a.x1) / 2, (a.y0 + a.y1) / 2, 0);
    const mat = new THREE.MeshLambertMaterial({ map: this.tex(a.c), alphaTest: 0.5, side: THREE.DoubleSide });
    this.disposables.push(geo, mat);
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = m.receiveShadow = true;
    return m;
  }
  /** A page floor quad (x from xa to xb, all of z), optionally with the uv mirrored (the back of a leaf). */
  private floor(c: HTMLCanvasElement, xa: number, xb: number, u0: number, u1: number, back: boolean, y: number) {
    const geo = new THREE.PlaneGeometry(xb - xa, 2 * LD, 8, 10);
    geo.rotateX(back ? Math.PI / 2 : -Math.PI / 2);
    geo.translate((xa + xb) / 2, y, 0);
    const uv = geo.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) {
      const u = uv.getX(i), v = uv.getY(i);
      uv.setXY(i, back ? u1 + (u0 - u1) * u : u0 + (u1 - u0) * u, back ? 1 - v : v);
    }
    const mat = new THREE.MeshLambertMaterial({ map: this.tex(c) });
    this.disposables.push(geo, mat);
    const m = new THREE.Mesh(geo, mat);
    m.receiveShadow = true;
    return m;
  }
  private boardBox(side: number) {
    const g = new THREE.Group();
    const geo = new THREE.BoxGeometry(LPW, LBOARD, 2 * LD); geo.translate((side * LPW) / 2, -LBOARD / 2, 0);
    const cl = new THREE.BoxGeometry(LPW + 0.12, 0.05, 2 * LD + 0.22); cl.translate(side * (LPW + 0.12) / 2, -LBOARD - 0.025, 0);
    this.disposables.push(geo, cl);
    const block = new THREE.Mesh(geo, this.flat(['ground', 'deep', 0.12])), cloth = new THREE.Mesh(cl, this.flat('deep'));
    block.castShadow = block.receiveShadow = cloth.castShadow = cloth.receiveShadow = true;
    g.add(block, cloth);
    return g;
  }
  private stand(a: Art, x: number, z: number, tRise: number, order: number, parent: THREE.Object3D = this.book, rock?: number, segX = 1) {
    const hinge = new THREE.Group();
    hinge.position.set(x, 0.006 + 0.003 * order, z);
    hinge.add(this.mesh(a, segX));
    parent.add(hinge);
    const s: Stand = { hinge, tRise, rock };
    this.stands.push(s);
    return s;
  }
  private critter(c: Critter, order: number): Walker {
    const hinge = new THREE.Group(), walker = new THREE.Group();
    hinge.position.set(c.x, 0.006 + 0.003 * order, c.z);
    walker.position.y = c.y;
    hinge.add(walker);
    walker.add(this.mesh(c.body));
    const limbs = c.limbs.map((L) => {
      const g = new THREE.Group();
      g.position.set(L.x, L.y, L.near ? 0.012 : -0.012);
      g.add(this.mesh(limbArt(this.P, L, c.ink)));
      walker.add(g);
      return { g, L };
    });
    this.book.add(hinge);
    const w: Walker = { c, hinge, walker, limbs, tRise: this.b(c.beat) + (c.delay ?? 0) };
    this.walkers.push(w);
    return w;
  }

  private build() {
    const P = this.P, t0 = this.b(0);
    const table = new THREE.Mesh(new THREE.PlaneGeometry(160, 160), this.flat('ground'));
    table.rotation.x = -Math.PI / 2; table.position.y = -LBOARD - 0.06; table.receiveShadow = true;
    this.disposables.push(table.geometry);
    this.scene.add(table, this.book);
    const seaL = lifePage(P, 'sea', -1), seaR = lifePage(P, 'sea', 1);

    if (this.sea) {
      // the book: left board fixed; the right board swings open over the spine on the first beat
      const left = this.boardBox(-1); left.add(this.floor(seaL, -LPW, 0, 0, 1, false, 0.001));
      const right = this.boardBox(1); right.add(this.floor(seaR, 0, LPW, 0, 1, false, 0.001));
      this.rightBoard.add(right);
      this.book.add(left, this.rightBoard);
      this.stand(seaBackdrop(P), 0, -3.25, t0 + 0.2, 0, this.book, undefined, 8);
      const Z = [-2.5, -1.45, -0.4, 0.65, 1.7, 2.75], Hh = [1.55, 1.3, 1.1, 0.9, 0.7, 0.5];
      const K: Ink[] = ['deep', ['deep', 'mid', 0.5], ['deep', 'ground', 0.12], ['deep', 'mid', 0.75], 'deep', ['deep', 'mid', 0.35]];
      Z.forEach((z, i) => this.stand(waveArt(P, Hh[i]!, K[i]!, i + 1), 0, z, t0 + 0.26 + 0.035 * i, i + 1, this.book, i % 2 ? 1 : -1, 12));
      // the cell: eight paper discs on stems, stacked on one hinge; they part on beats 1..3
      this.tCell = t0 + 0.34;
      this.cellHinge.position.set(1.7, 0.03, -0.85);
      const ca = cellArt(P);
      for (let i = 0; i < 8; i++) {
        const g = new THREE.Group(); g.add(this.mesh(ca));
        const sg = new THREE.PlaneGeometry(0.035, 1); sg.translate(0, 0.5, 0); this.disposables.push(sg);
        const stem = new THREE.Mesh(sg, this.flat(['deep', 'text', 0.3])); stem.castShadow = true;
        stem.position.z = -0.03 - 0.004 * i; g.position.z = 0.012 * i;
        this.cellHinge.add(g, stem);
        this.cells.push({ g, stem });
      }
      this.book.add(this.cellHinge);
      // fish: one per beat from the fold (b4..b7), rising on stems
      const FX = [-3.3, -1.7, -2.5, -0.9], FZ = [0.3, -1.9, 1.35, -0.2];
      for (let f = 0; f < 4; f++) {
        const fb = fishBody(P, f);
        const c: Critter = { key: `fish${f}`, ink: fb.k, body: fb.body, limbs: [fb.tail], gait: 'swim', stride: 0.3, beat: 4 + f, x: FX[f]!, z: FZ[f]!, y: 0.3 };
        const w = this.critter(c, 20 + f);
        w.walker.scale.setScalar(1.5);
        const sg = new THREE.PlaneGeometry(0.03, 1); sg.translate(0, 0.5, 0); this.disposables.push(sg);
        const stem = new THREE.Mesh(sg, this.flat(['deep', 'text', 0.3])); stem.castShadow = true; stem.position.z = -0.03;
        w.hinge.add(stem);
        this.walkers.pop();
        this.fish.push({ ...w, stem, y0: 0.3 });
      }
    } else {
      // land: the left board carries the old sea page; the sea leaf turns over and becomes the new left page
      const left = this.boardBox(-1); left.add(this.floor(seaL, -LPW, 0, 0, 1, false, 0.001));
      const right = this.boardBox(1); right.add(this.floor(lifePage(P, 'land', 1), 0, LPW, 0, 1, false, 0.001));
      const landL = lifePage(P, 'land', -1);
      this.leaf1.add(this.floor(seaR, 0, LPW / 2, 0, 0.5, false, 0.006), this.floor(landL, 0, LPW / 2, 0.5, 1, true, 0.002));
      this.leaf2.add(this.floor(seaR, 0, LPW / 2, 0.5, 1, false, 0.006), this.floor(landL, 0, LPW / 2, 0, 0.5, true, 0.002));
      this.leaf2.position.x = LPW / 2;
      this.leaf1.add(this.leaf2);
      this.leaf1.position.y = 0.004;
      this.closer.add(right);
      this.book.add(left, this.leaf1, this.closer);
      const land = t0 + 0.4; // the leaf has landed: the left-page pieces can stand
      this.stand(landBackdrop(P), 0, -3.25, land, 0, this.book, undefined, 8);
      this.stand(waveArt(P, 0.28, ['deep', 'mid', 0.3], 7), 0, 2.95, t0 + 0.16, 1, this.book, 1, 12);
      this.stand(waveArt(P, 0.2, 'deep', 8), 0, 3.35, t0 + 0.12, 2, this.book, -1, 12);
      [[-4.3, 1.55, 0.6], [-2.2, 1.35, 0.8], [-3.6, 0.95, 0.55], [3.9, 1.0, 0.7], [1.9, 1.45, 0.5]].forEach(([x, z, h], i) =>
        this.stand(fernArt(P, h!, i + 1), x!, z!, x! < 0 ? land + 0.05 * i : t0 + 0.2 + 0.05 * i, 3 + i));
      // forest (b3, b4): trees; T4 has the gibbon's branch
      const T = [[-2.9, -1.7, 3.0, 3, 0], [-4.4, -2.7, 2.6, 3, 0], [0.9, -2.1, 3.3, 4, 0], [2.4, -2.6, 3.4, 4, 1.7], [4.5, -1.9, 2.4, 4, 0]];
      T.forEach(([x, z, h, b, br], i) => this.stand(treeArt(P, h!, i + 1, br!), x!, z!, this.b(b!) + 0.04 * i, 8 + i));
      const apeLimbs = (s: number): Limb[] => [
        quad(0.16 * s, 0.74 * s, 0.68 * s, 0.1 * s, false, 'knuckle', -0.12, 0.33, 1), quad(-0.22 * s, 0.5 * s, 0.48 * s, 0.12 * s, false, 'foot', 0.1, 0.33, 0),
        quad(0.2 * s, 0.72 * s, 0.68 * s, 0.1 * s, true, 'knuckle', -0.12, 0.33, 0), quad(-0.2 * s, 0.5 * s, 0.48 * s, 0.12 * s, true, 'foot', 0.1, 0.33, 1),
      ];
      const climbLimbs: Limb[] = [
        quad(0.04, 0.66, 0.3, 0.06, false, 'hand', Math.PI - 0.25, 0.35, 1), quad(0.0, 0.3, 0.28, 0.07, false, 'foot', 0.6, 0.3, 0),
        quad(0.06, 0.66, 0.3, 0.06, true, 'hand', Math.PI - 0.25, 0.35, 0), quad(0.02, 0.3, 0.28, 0.07, true, 'foot', 0.6, 0.3, 1),
      ];
      const hom = (k: Ink, o: HomOpts, seed: number) => hominin(P, k, o, seed);
      const aus = hom('mid', { H: 1.15, stoop: 0.1, arm: 0.46, head: 0.075, brow: 1, jaw: 0.08, wide: 1.15 }, 11);
      const par = hom('hi', { H: 1.3, stoop: 0.06, arm: 0.43, head: 0.08, brow: 1, jaw: 0.07, wide: 1.35, crest: true }, 12);
      const ere = hom('deep', { H: 1.78, stoop: 0.02, arm: 0.38, head: 0.064, brow: 1, jaw: 0.04, wide: 1.0, tool: 'axe' }, 13);
      const nea = hom(['deep', 'mid', 0.5], { H: 1.6, stoop: 0.03, arm: 0.38, head: 0.076, brow: 1, jaw: 0.045, wide: 1.45, tool: 'spear' }, 14);
      const sap = hom('signal', { H: 1.74, stoop: 0, arm: 0.38, head: 0.068, brow: 0, jaw: 0.0, wide: 1.0, round: true }, 15);
      const C: Critter[] = [
        { key: 'tetrapod', ink: 'mid', body: tetrapodBody(P), gait: 'crawl', stride: 0.25, beat: 0, delay: 0.2, x: 0.6, z: 2.15, y: 0, limbs: [
          quad(0.33, 0.2, 0.2, 0.07, false, 'paw', 0.5, 0.6, 1), quad(-0.43, 0.2, 0.2, 0.07, false, 'paw', 0.5, 0.6, 0), quad(0.38, 0.18, 0.2, 0.075, true, 'paw', 0.5, 0.6, 0), quad(-0.38, 0.18, 0.2, 0.075, true, 'paw', 0.5, 0.6, 1)] },
        { key: 'synapsid', ink: 'hi', body: synapsidBody(P), gait: 'crawl', stride: 0.4, beat: 1, x: -1.0, z: 1.72, y: 0, limbs: [
          quad(0.27, 0.24, 0.23, 0.07, false, 'paw', 0.35, 0.55, 1), quad(-0.33, 0.24, 0.23, 0.07, false, 'paw', 0.35, 0.55, 0), quad(0.31, 0.22, 0.23, 0.08, true, 'paw', 0.35, 0.55, 0), quad(-0.29, 0.22, 0.23, 0.08, true, 'paw', 0.35, 0.55, 1)] },
        { key: 'mammal', ink: 'deep', body: mammalBody(P), gait: 'walk', stride: 0.32, beat: 2, x: -0.6, z: 1.12, y: 0, limbs: [
          quad(0.1, 0.15, 0.15, 0.05, false, 'paw', 0, 0.55, 1), quad(-0.18, 0.16, 0.16, 0.055, false, 'paw', 0, 0.55, 0), quad(0.14, 0.14, 0.15, 0.05, true, 'paw', 0, 0.55, 0), quad(-0.14, 0.15, 0.16, 0.055, true, 'paw', 0, 0.55, 1)] },
        { key: 'lemur', ink: 'text', body: climberBody(P, 'text', true), gait: 'climb', stride: 0.26, beat: 3, delay: 0.06, x: -2.93, z: -1.62, y: 0.55, limbs: climbLimbs },
        { key: 'monkey', ink: 'hi', body: climberBody(P, 'hi', false), gait: 'climb', stride: 0.3, beat: 4, delay: 0.1, x: 0.87, z: -2.02, y: 0.7, limbs: climbLimbs },
        { key: 'gibbon', ink: 'deep', body: gibbonBody(P), gait: 'swing', stride: 0.34, beat: 5, x: 2.75, z: -2.53, y: 3.4 * 0.615, limbs: [
          quad(0.0, -0.95, 0.3, 0.06, false, 'foot', 0.7, 0.35, 1), quad(0.02, -0.95, 0.3, 0.06, true, 'foot', 0.7, 0.35, 0)] },
        { key: 'chimp', ink: 'text', body: apeBody(P, 'text', 1, false), gait: 'knuckle', stride: 0.28, beat: 6, x: -3.6, z: -0.7, y: 0, limbs: apeLimbs(1) },
        { key: 'gorilla', ink: 'deep', body: apeBody(P, 'deep', 1.3, true), gait: 'knuckle', stride: 0.3, beat: 7, x: -2.2, z: -1.15, y: 0, limbs: apeLimbs(1.3) },
        { key: 'australopithecus', ink: 'mid', body: aus.body, limbs: aus.limbs, gait: 'upright', stride: 0.26, beat: 8, x: -2.8, z: 0.55, y: 0 },
        { key: 'paranthropus', ink: 'hi', body: par.body, limbs: par.limbs, gait: 'upright', stride: 0.26, beat: 9, x: -3.3, z: 0.05, y: 0 },
        { key: 'erectus', ink: 'deep', body: ere.body, limbs: ere.limbs, gait: 'upright', stride: 0.33, beat: 10, x: -3.25, z: 0.95, y: 0 },
        { key: 'neanderthal', ink: ['deep', 'mid', 0.5], body: nea.body, limbs: nea.limbs, gait: 'upright', stride: 0.3, beat: 11, x: -3.5, z: -0.35, y: 0 },
        { key: 'sapiens', ink: 'signal', body: sap.body, limbs: sap.limbs, gait: 'upright', stride: 0.3, beat: 12, x: -2.5, z: 1.95, y: 0 },
      ];
      C.forEach((c, i) => this.critter(c, 20 + i));
    }

    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    Object.assign(this.sun.shadow.camera, { left: -9, right: 9, top: 9, bottom: -9, near: 0.5, far: 60 });
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    this.sun.shadow.radius = 2;
    this.scene.add(this.sun, this.sun.target, this.amb);
  }

  /** 0 flat .. 1 standing (overshoots); everything folds flat as the land book closes. */
  private rise(tRise: number, t: number) {
    if (t < tRise) return 0;
    return ease.outBack(clamp((t - tRise) / LRISE), 2.0) * (1 - this.fold(t));
  }
  private fold(t: number) { return this.sea ? 0 : prog(t, this.plate.end - 0.3, this.plate.end - 0.13, ease.inQuad); }
  /** Steps taken since the piece stood up: whole beats plus the eased snap of the current one. */
  private steps(tRise: number, t: number) {
    let k = 0, last = -1;
    for (const b of this.beats) if (b > tRise + 0.05 && b <= t) { k++; last = b; }
    return k === 0 ? 0 : k - 1 + prog(t, last, last + 0.26, ease.outCubic);
  }
  private posOf(w: Walker, t: number) {
    const s = this.steps(w.tRise, t);
    return new THREE.Vector3(w.c.x + (w.c.gait === 'climb' ? 0 : w.c.stride * s), w.c.y + (w.c.gait === 'climb' ? w.c.stride * s : 0), w.c.z);
  }

  /** A fish's swim (x) and rise (y) on its stem: a jump out of the fold, then one stroke per beat. */
  private fishAt(f: Walker & { y0: number }, t: number) {
    const s = this.steps(f.tRise, t);
    const y = f.y0 + 0.42 * Math.pow(s, 0.85) + 0.9 * (1 - Math.exp(-(t - f.tRise) / 0.35)) * (t > f.tRise ? 1 : 0);
    return { s, x: f.c.stride * s, y };
  }

  private camFor(name: LifeCam, t: number): LCam {
    const up: V3 = [-0.45, 0.8, 0.5];
    const add = (a: THREE.Vector3, d: V3): V3 => [a.x + d[0], a.y + d[1], a.z + d[2]];
    switch (name) {
      case 'open': return { p0: [0.6, 7.6, 10.6], p1: [0.4, 6.6, 9.4], t0: [0, 0.2, -0.6], t1: [0, 0.5, -0.6], fov: 40, roll: 0, dir: up, I: 2.6, amb: 1.5 };
      case 'cell': {
        const c = new THREE.Vector3(1.7, 1.55, -0.85);
        return { p0: add(c, [-1.35, 0.25, 3.3]), p1: add(c, [-1.1, 0.1, 2.75]), t0: add(c, [-0.6, -0.05, 0]), t1: add(c, [-0.55, 0, 0]), fov: 36, roll: 0.04, dir: [-0.6, 0.6, 0.55], I: 3.0, amb: 1.35 };
      }
      case 'waves': return { p0: [0.2, 0.5, 4.5], p1: [-0.3, 0.58, 4.0], t0: [-2.6, 1.0, -0.6], t1: [-2.6, 1.35, -0.6], fov: 44, roll: 0, dir: [-0.7, 0.45, 0.55], I: 3.2, amb: 1.3 };
      case 'rise': {
        // low front-right, looking up at the rising fish (framed on their centroid)
        const c = new THREE.Vector3(); let n = 0;
        for (const f of this.fish) if (t >= f.tRise) { const q = this.fishAt(f, t); c.add(new THREE.Vector3(f.c.x + q.x, q.y, f.c.z)); n++; }
        if (n) c.multiplyScalar(1 / n); else c.set(-1.5, 1.2, 0);
        return { p0: add(c, [2.4, -1.0, 4.4]), p1: add(c, [2.0, -0.7, 3.9]), t0: add(c, [0.3, 0.1, 0]), t1: add(c, [0.3, 0.3, 0]), fov: 40, roll: -0.1, dir: [0.35, 0.6, 0.7], I: 3.2, amb: 1.6 };
      }
      case 'shore': return { p0: [-3.2, 7.4, 9.9], p1: [-2.5, 6.5, 8.8], t0: [0.4, 0, 0.5], t1: [0.6, 0.2, 0.5], fov: 38, roll: 0, dir: up, I: 2.7, amb: 1.5 };
      case 'beach': return { p0: [2.3, 0.8, 4.6], p1: [1.9, 0.72, 4.2], t0: [0.1, 0.25, 1.8], t1: [-0.1, 0.27, 1.8], fov: 38, roll: 0.03, dir: [0.6, 0.5, 0.6], I: 3.0, amb: 1.35 };
      case 'forest': return { p0: [-2.5, 1.5, 3.6], p1: [-0.7, 1.6, 3.6], t0: [-2.3, 1.35, -1.6], t1: [-0.5, 1.45, -1.6], fov: 44, roll: 0, dir: [-0.5, 0.7, 0.5], I: 2.9, amb: 1.4 };
      case 'canopy': return { p0: [0.2, 3.9, 3.2], p1: [-0.1, 3.5, 2.9], t0: [-2.5, 0.45, -0.9], t1: [-2.3, 0.45, -0.9], fov: 42, roll: 0.1, dir: [0.3, 0.85, 0.4], I: 2.8, amb: 1.45 };
      case 'track': return { p0: [-3.1, 0.95, 4.3], p1: [-1.0, 0.95, 4.3], t0: [-2.8, 0.85, 0.3], t1: [-0.7, 0.85, 0.3], fov: 38, roll: 0, dir: [-0.55, 0.55, 0.6], I: 3.0, amb: 1.4 };
      case 'file': return { p0: [1.9, 1.45, 6.0], p1: [1.7, 1.4, 5.7], t0: [-2.9, 0.8, 0.35], t1: [-2.8, 0.8, 0.35], fov: 28, roll: 0, dir: [0.6, 0.5, 0.6], I: 3.0, amb: 1.4 };
      case 'close': {
        const h = this.walkers.find((w) => w.c.key === 'sapiens');
        const c = h ? this.posOf(h, t) : new THREE.Vector3(-2.5, 0, 1.95);
        return { p0: add(c, [0.7, 1.05, 4.6]), p1: add(c, [0.55, 1.0, 4.2]), t0: add(c, [0.1, 0.95, 0]), t1: add(c, [0.1, 0.97, 0]), fov: 32, roll: 0, dir: [0.55, 0.55, 0.65], I: 3.1, amb: 1.4 };
      }
    }
  }

  render(t: number, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, audio: au } = this.ctx, P = this.P, t0 = this.b(0), end = this.plate.end;
    const sh = shotAt(this.list, t);
    const name = sh.shot.s.cam as LifeCam;
    const u = clamp((t - sh.t0) / Math.max(0.1, Math.min(sh.t1, end) - sh.t0));
    const uE = ease.inOutQuad(u);
    const cd = this.camFor(name, t);
    const L3 = (a: V3, b: V3) => new THREE.Vector3(lerp(a[0], b[0], uE), lerp(a[1], b[1], uE), lerp(a[2], b[2], uE));
    const cam = this.cam;
    cam.fov = cd.fov;
    cam.up.set(0, 1, 0);
    cam.position.copy(L3(cd.p0, cd.p1));
    cam.lookAt(L3(cd.t0, cd.t1));
    cam.rotateZ(cd.roll);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();

    // book: the sea book opens on beat 0; the land leaf turns on beat 0; the land book closes at the end
    const db = downbeatPulse(au, t, 0.14), bp = beatPulse(au, t, 0.1), kp = kickPulse(au, t, 0.1);
    this.book.position.y = -0.06 * db;
    let open = 1;
    if (this.sea) {
      open = prog(t, t0, t0 + 0.42, ease.outCubic);
      this.rightBoard.rotation.z = Math.PI * (1 - open);
    } else {
      const lu = prog(t, t0, t0 + 0.4, ease.inOutCubic);
      this.leaf1.rotation.z = lerp(0.3, Math.PI, lu);
      this.leaf2.rotation.z = -0.75 * Math.sin(Math.PI * Math.min(1, 0.12 + lu * 0.88)) * (1 - lu * 0.4);
      this.leaf1.visible = true;
      this.closer.rotation.z = Math.PI * prog(t, end - 0.2, end - 1 / 120, ease.inCubic); // the right board slams over
    }

    for (const s of this.stands) {
      const f = this.rise(s.tRise, t) * open;
      s.hinge.rotation.x = -(1 - f) * Math.PI / 2 - (s.rock ?? 0) * 0.07 * bp * f;
      s.hinge.position.y = 0.006 + (s.rock ? 0.03 * kp * f : 0);
      s.hinge.visible = f > 0.002;
    }

    // the cell: 1 → 2 → 4 → 8 on beats 1..3 (area conserved: r / √2 per division)
    if (this.sea) {
      const fc = this.rise(this.tCell, t) * open;
      this.cellHinge.rotation.x = -(1 - fc) * Math.PI / 2;
      this.cellHinge.visible = fc > 0.002;
      const D = [0, 0.42, 0.3, 0.17];
      const posAt = (g: number, i: number) => {
        let x = 0, y = 0;
        for (let k = 1; k <= g; k++) { const j = i >> (3 - k), s = j & 1 ? 1 : -1; if (k % 2) x += s * D[k]!; else y += s * D[k]!; }
        return [x, y] as const;
      };
      let gen = 0, gu = 1;
      for (let k = 1; k <= 3; k++) if (t >= this.b(k)) { gen = k; gu = prog(t, this.b(k), this.b(k) + 0.24, (x) => ease.outBack(x, 2.2)); }
      const cy = 1.55;
      this.cells.forEach((c, i) => {
        const [ax, ay] = posAt(Math.max(0, gen - 1), i), [bx, by] = posAt(gen, i);
        const x = lerp(ax, bx, gu), y = lerp(ay, by, gu);
        const r = lerp(0.6 / Math.pow(Math.SQRT2, Math.max(0, gen - 1)), 0.6 / Math.pow(Math.SQRT2, gen), clamp(gu));
        const pinch = gen > 0 ? Math.sin(Math.PI * clamp(gu)) * 0.28 : 0;
        const along = gen % 2 === 1;
        c.g.position.set(x, cy + y, 0.012 * i);
        c.g.scale.set(r * (1 + (along ? pinch : -pinch * 0.4)) * (1 + 0.06 * bp), r * (1 + (along ? -pinch * 0.4 : pinch)) * (1 + 0.06 * bp), 1);
        c.stem.position.x = x;
        c.stem.scale.y = Math.max(0.01, cy + y - r * 0.9);
      });
      for (const f of this.fish) {
        const fr = this.rise(f.tRise, t) * open;
        f.hinge.rotation.x = -(1 - fr) * Math.PI / 2;
        f.hinge.visible = fr > 0.002;
        const { s, x, y } = this.fishAt(f, t);
        f.walker.position.set(x, y, 0);
        f.walker.rotation.z = 0.08 * Math.sin(Math.PI * s + 0.5);
        f.stem.scale.y = Math.max(0.01, y);
        for (const l of f.limbs) l.g.rotation.z = l.L.base + l.L.amp * Math.cos(Math.PI * (s + l.L.ph)) * (0.6 + 0.4 * bp);
      }
    }

    // walkers: pop on their beat, then one step per beat in their own gait
    for (const w of this.walkers) {
      const f = this.rise(w.tRise, t);
      w.hinge.rotation.x = -(1 - f) * Math.PI / 2;
      w.hinge.visible = f > 0.002;
      const s = this.steps(w.tRise, t), g = w.c.gait, ph = Math.cos(Math.PI * s);
      const p = this.posOf(w, t);
      w.hinge.position.x = g === 'swing' ? w.c.x : p.x;
      w.walker.position.y = p.y + (g === 'walk' || g === 'upright' || g === 'knuckle' ? 0.03 * Math.abs(Math.sin(Math.PI * s)) : 0);
      w.walker.position.x = g === 'swing' ? w.c.stride * s : 0;
      w.walker.rotation.z = g === 'crawl' ? 0.05 * ph : g === 'swing' ? 0.42 * ph : g === 'knuckle' ? 0.03 * ph : 0;
      for (const l of w.limbs) l.g.rotation.z = l.L.base + l.L.amp * Math.cos(Math.PI * (s + l.L.ph));
    }

    // light
    const dir = new THREE.Vector3(...cd.dir).normalize();
    this.sun.color.setRGB(...plin(P, 'ground'));
    this.sun.intensity = cd.I * (1 + 0.08 * kp);
    this.sun.position.copy(dir.multiplyScalar(25));
    this.sun.target.position.set(0, 0, 0);
    this.sun.target.updateMatrixWorld();
    this.amb.color.setRGB(...plin(P, 'ground'));
    this.amb.intensity = cd.amb;

    const sm = renderer.shadowMap, prevOn = sm.enabled, prevType = sm.type;
    sm.enabled = true; sm.type = THREE.PCFShadowMap;
    clearRT(renderer, this.rt, plin(P, 'ground'));
    renderer.setRenderTarget(this.rt);
    renderer.render(this.scene, cam);
    sm.enabled = prevOn; sm.type = prevType;
    this.ctx.comp.draw(renderer, this.rt.texture, out, { mode: 'replace' });

    // hits: a jolt on every pop beat, a punch on downbeats, the page turn / the opening slap
    const bi = beatIndex(au, t);
    const slap = t >= t0 ? Math.exp(-(t - t0) / (this.sea ? 0.16 : 0.1)) : 0;
    const sx = (hash(bi, 11) - 0.5) * 2 * 3.5 * bp + (this.sea ? 0 : 8 * slap);
    const sy = (hash(bi, 12) - 0.5) * 2 * 3.5 * bp + 5 * slap;
    return {
      shake: [sx, sy],
      zoom: Math.min(1.06, 1 + 0.035 * db + 0.04 * slap),
      bloom: 0,
      grain: 0.05,
      vignette: 0.22,
    };
  }

  dispose() {
    this.rt.dispose();
    for (const d of this.disposables) d.dispose();
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
  /** Variants 'life-sea' / 'life-land' (the popup-life sequence) render through their own book. */
  private life: LifeBook | null = null;

  override init() {
    this.plate = this.ctx.params as PlateInfo;
    if (this.plate.variant !== 'city') { this.life = new LifeBook(this.ctx, this.plate); return; }
    this.list = shots(this.plate, this.ctx.audio);
    const lines = ownedLines(this.ctx);
    const au = this.ctx.audio, { start, end } = this.ctx;
    this.rt = makeRT(W, H, { samples: 4 });
    this.beats = beatTimes(au, start - 1e-3, end);
    // v4 p28 (nov 2, ref p19): the SAME open spread as the life book — open from the first frame, no opening move
    this.tOpen = start - 1;
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
    if (this.life) return this.life.render(f.t, out);
    const { renderer, audio: au } = this.ctx;
    const t = f.t;
    const sh = shotAt(this.list, t);
    const camName = sh.shot.s.cam as Cam;
    const u = clamp((t - sh.t0) / Math.max(0.1, Math.min(sh.t1, this.ctx.end) - sh.t0));
    const uE = ease.inOutQuad(u);

    // --- camera (slow drift inside each shot; every cut is a new set-up)
    // v4: one static book camera = the life book's overhead 3/4 set-up (LifeBook 'open' p0/t0, fov 40); the cut list
    // still drives the page content and light, never the camera
    const cd = BOOK_CAM;
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
    // v4 fix: the page jolts on every downbeat and HOLDS the new seat until the next (alternating drop / recoil)
    const dbN = au.downbeats.filter((d) => d >= this.ctx.start - 1e-3 && d <= t + 1e-4).length;
    const seat = dbN % 2, bN = au.beats.filter((b) => b >= this.ctx.start + 0.05 && b <= t + 1e-4).length % 2;
    this.book.position.y = -0.07 * db - 0.22 * seat - 0.12 * bN; // every beat the spread settles a notch and holds
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
    // the key light is the book's (fixed, like the camera); only the windows' glow follows the shot
    const ld = { ...LIGHT.threeq, glow: LIGHT[camName].glow, bloom: LIGHT[camName].bloom };
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
      zoom: Math.min(1.1, 1 + 0.03 * seat + 0.025 * bN + 0.03 * db + 0.06 * impact),
      bloom: ld.bloom,
      bloomThreshold: 0.92,
      grain: 0.05,
      vignette: 0.3,
      fade: t >= this.ctx.end - 0.5 / 60 ? 1 : 0, // the plate's last frame is black
    };
  }

  override dispose() {
    this.life?.dispose();
    this.rt?.dispose();
    for (const d of this.disposables) d.dispose();
  }
}
