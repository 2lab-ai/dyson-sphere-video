// ANIMATIC — one generic module that stands in for every plate under the render flag --animatic (timeline.ts swaps
// every entry to this module; the real modules are untouched). It is NOT art: per plate it draws a crude but honest
// proxy of the planned frame so a reviewer can judge variety (ground, palette, subject, composition, motion) in real
// time, before any v3 plate module is built:
//   - the ground in the plate's named palette (look.palette → engine/palette.ts)
//   - the main subject as a simple shape at its planned position/scale (storyboard `subject`)
//   - the storyboard camera per shot (`cam`: wide/close/macro/top/side/low/tilt/track/push/pull/up/over/inside/flat),
//     changing the framing exactly at the approved shot times (./animatic.shots)
//   - the owned lyric lines via drawLyric at the planned placement with a material hint (storyboard `lyr`)
//   - a per-beat pulse (engine/beat)
//   - the plate number, idiom and camera, very small in the lower-left corner (debug only)
import type * as THREE from 'three';
import { Scene, type Frame, type PostOverrides } from '../engine/scene';
import { Layer2D, clearRT } from '../engine/gl';
import { palette, pcss, pmix, plin, type NamedPalette, type Role } from '../engine/palette';
import { drawLyric, ownedLines, F, type CharState } from '../engine/lyric';
import { beatPulse, kickPulse, downbeatPulse, beatIndex, barIndex } from '../engine/beat';
import { shotAt, type PlateInfo, type Shot } from '../engine/shots';
import { sbPlate, type SbPlate, type SbSubject } from '../engine/storyboard';
import { clamp, lerp, hash, TAU, ease } from '../engine/util';
import type { Line } from '../engine/lyrics';
import { shots } from './animatic.shots';

const W = 1920, H = 1080;

/** Per-frame drawing environment handed to each subject proxy. */
interface Env {
  P: NamedPalette;
  t: number;
  /** 0..1 through the plate, seconds since the plate start. */
  pp: number;
  lt: number;
  /** Shot index and 0..1 through the shot. */
  si: number;
  u: number;
  bp: number;
  kp: number;
  dp: number;
  /** Beats / bars since the plate start (integers). */
  nb: number;
  nB: number;
  seed: number;
  variant: string;
}

type Draw = (c: CanvasRenderingContext2D, s: SbSubject, e: Env) => void;

const col = (e: Env, r: Role, a = 1) => pcss(e.P, r, a);

function disc(c: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string) {
  c.fillStyle = fill;
  c.beginPath(); c.arc(x, y, Math.max(0.5, r), 0, TAU); c.fill();
}
function ring(c: CanvasRenderingContext2D, x: number, y: number, r: number, stroke: string, w: number) {
  c.strokeStyle = stroke; c.lineWidth = w;
  c.beginPath(); c.arc(x, y, Math.max(0.5, r), 0, TAU); c.stroke();
}
function rect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, fill: string) {
  c.fillStyle = fill; c.fillRect(x, y, w, h);
}
function glow(c: CanvasRenderingContext2D, color: string, blur: number) {
  c.shadowColor = color; c.shadowBlur = blur;
}
function noGlow(c: CanvasRenderingContext2D) { c.shadowBlur = 0; }
function gear(c: CanvasRenderingContext2D, x: number, y: number, r: number, teeth: number, rot: number, fill: string) {
  c.fillStyle = fill;
  c.beginPath();
  for (let i = 0; i < teeth * 2; i++) {
    const a = rot + (i / (teeth * 2)) * TAU, rr = i % 2 ? r : r * 1.18;
    c.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  c.closePath(); c.fill();
}
/** A stick figure (crude silhouette): height h, posture 0 = crawl … 1 = upright. */
function figure(c: CanvasRenderingContext2D, x: number, y: number, h: number, posture: number, fill: string) {
  const bodyW = lerp(h * 0.9, h * 0.22, posture), bodyH = lerp(h * 0.28, h * 0.55, posture);
  c.fillStyle = fill;
  c.fillRect(x - bodyW / 2, y - h * 0.3 - bodyH, bodyW, bodyH);
  disc(c, x + lerp(bodyW / 2, 0, posture), y - h * 0.3 - bodyH - h * 0.1, h * 0.1, fill);
  c.fillRect(x - bodyW / 2, y - h * 0.3, h * 0.06, h * 0.3);
  c.fillRect(x + bodyW / 2 - h * 0.06, y - h * 0.3, h * 0.06, h * 0.3);
}

// ------------------------------------------------------------------ subject proxies (one per storyboard kind)
const DRAW: Record<string, Draw> = {
  point(c, s, e) {
    const out = e.variant === 'outro';
    const r = out ? 14 * (1 - e.pp) * (1 + 0.4 * e.kp) : 12 * (1 + 0.6 * e.kp);
    const len = out ? 900 * (1 - ease.inOutCubic(e.pp)) : 200 + 1100 * e.pp + 24 * e.nb;
    c.strokeStyle = col(e, 'hi', 0.7); c.lineWidth = 2;
    c.beginPath(); c.moveTo(s.x, s.y); c.lineTo(s.x + len, s.y); c.stroke();
    glow(c, col(e, 'signal'), 40); disc(c, s.x + len, s.y, r, col(e, 'signal')); noGlow(c);
  },
  ribs(c, s, e) {
    const R = s.s * H, a = 0.45 + 0.55 * e.kp;
    rect(c, s.x - 10, s.y - R / 2, 20, R, col(e, 'hi', 0.5 * a));
    for (let i = 0; i < 8; i++) {
      const y = s.y - R * 0.4 + i * R * 0.1, w = R * (0.34 + 0.06 * Math.sin(i));
      c.strokeStyle = col(e, 'hi', 0.35 + 0.5 * a); c.lineWidth = 10;
      c.beginPath(); c.ellipse(s.x, y, w, R * 0.05, 0, Math.PI * 0.05, Math.PI * 0.95); c.stroke();
    }
    for (let i = 0; i < 5; i++) gear(c, s.x + (i - 2) * 70, s.y + R * 0.45, 26, 10, e.nb * 0.3 + i, col(e, 'mid', 0.8));
    gear(c, s.x - 60, s.y - 10, 90, 14, e.nb * 0.26, col(e, 'hi', 0.25 + 0.5 * a));
  },
  tvgrid(c, s, e) {
    const cols = Number(s.cols ?? 6), rows = Number(s.rows ?? 4);
    const gw = s.s * H * 1.9, gh = s.s * H, cw = gw / cols, ch = gh / rows;
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const x = s.x - gw / 2 + i * cw, y = s.y - gh / 2 + j * ch, k = j * cols + i;
      rect(c, x + 4, y + 4, cw - 8, ch - 8, col(e, 'deep', 0.35));
      const dark = k === 15;
      const on = (hash(k, e.nb) > 0.15 ? 1 : 0.4) * (0.6 + 0.4 * e.kp);
      rect(c, x + 14, y + 14, cw - 28, ch - 28, dark ? col(e, 'ground') : pmix(e.P, 'mid', 'hi', hash(k, 3), on));
      if (dark) disc(c, x + cw / 2, y + ch / 2, 10 * (1 + e.bp), col(e, 'signal'));
      const roll = ((e.lt * 0.7 + hash(k)) % 1) * (ch - 28);
      if (k % 5 === e.nb % 5) rect(c, x + 14, y + 14 + roll, cw - 28, 8, col(e, 'ground', 0.6));
    }
  },
  poster(c, s, e) {
    const w = s.s * H * 1.1, h = s.s * H, off = 6 * e.nb + 20 * e.bp;
    c.globalAlpha = 0.85;
    rect(c, s.x - w / 2, s.y - h / 2, w, h * 0.62, col(e, 'deep'));
    rect(c, s.x - w / 2 + off, s.y - h / 2 + off * 0.6, w, h * 0.62, col(e, 'mid', 0.7));
    disc(c, s.x + w * 0.28, s.y + h * 0.28, h * 0.2, col(e, 'hi', 0.9));
    c.globalAlpha = 1;
  },
  wave(c, s, e) {
    const A = 90 * (1 + 0.5 * e.bp);
    for (const [k, r, a] of [[0, 'deep', 1], [1, 'mid', 0.9]] as const) {
      c.fillStyle = col(e, r, a);
      c.beginPath(); c.moveTo(0, H);
      for (let x = 0; x <= W; x += 20) c.lineTo(x, s.y + k * 60 + A * Math.sin(x / 190 + e.lt * 2.4 + k) + 40 * Math.sin(x / 71 - e.lt * 1.3));
      c.lineTo(W, H); c.closePath(); c.fill();
    }
    for (let i = 0; i < 14; i++) {
      const x = ((hash(i, 1) * W - e.lt * 160 * (0.5 + hash(i))) % W + W) % W, y = s.y - 40 + 80 * hash(i, 2);
      ring(c, x, y, 20 + 30 * hash(i, 4) + 20 * e.kp, col(e, 'hi', 0.5), 4);
    }
  },
  tubes(c, s, e) {
    const on = Math.min(9, e.nb + 1);
    glow(c, col(e, 'signal'), 30);
    for (let i = 0; i < 9; i++) {
      if (i >= on) continue;
      const x0 = s.x - 700 + i * 160;
      c.strokeStyle = i === on - 1 && e.bp > 0.6 ? col(e, 'hi') : col(e, 'signal');
      c.lineWidth = 2 + 6 * clamp(e.lt * 3 - i * 0.1);
      c.beginPath(); c.moveTo(x0, s.y - 140); c.lineTo(x0 + 70, s.y + 120 * Math.sin(i)); c.lineTo(x0 + 130, s.y - 100); c.stroke();
    }
    noGlow(c);
  },
  bassclock(c, s, e) {
    const R = s.s * H * 0.5;
    disc(c, s.x, s.y, R, col(e, 'deep'));
    for (let i = 0; i < 12; i++) { const a = (i / 12) * TAU; rect(c, s.x + Math.cos(a) * R * 0.8 - 12, s.y + Math.sin(a) * R * 0.8 - 12, 24, 24, col(e, 'ground')); }
    const a = -Math.PI / 2 + e.nb * 0.35 - 0.2 * e.kp;
    c.fillStyle = col(e, 'mid');
    c.beginPath(); c.moveTo(s.x, s.y); c.lineTo(s.x + Math.cos(a - 0.12) * R * 0.9, s.y + Math.sin(a - 0.12) * R * 0.9); c.lineTo(s.x + Math.cos(a + 0.12) * R * 0.9, s.y + Math.sin(a + 0.12) * R * 0.9); c.fill();
    c.fillStyle = col(e, 'hi');
    c.beginPath(); c.moveTo(s.x, s.y); c.lineTo(s.x + R * 0.55, s.y + 30); c.lineTo(s.x + R * 0.5, s.y - 40); c.fill();
  },
  trails(c, s, e) {
    glow(c, col(e, 'mid'), 24);
    for (let i = 0; i < Math.min(7, e.nb + 2); i++) {
      c.strokeStyle = pmix(e.P, 'mid', 'hi', hash(i, 7), 0.4 + 0.5 * (i === e.nb % 7 ? 1 : 0.5));
      c.lineWidth = 6 + 6 * e.kp;
      c.beginPath();
      c.moveTo(200 + hash(i) * 300, 300 + hash(i, 2) * 500);
      c.bezierCurveTo(600 + hash(i, 3) * 400, 100 + hash(i, 4) * 800, 1100 + hash(i, 5) * 300, 100 + hash(i, 6) * 800, 1500 + hash(i, 8) * 300, 300 + hash(i, 9) * 500);
      c.stroke();
    }
    noGlow(c);
  },
  ticker(c, s, e) {
    const h = s.s * H;
    rect(c, 0, s.y - h / 2, W, h, col(e, 'deep', 0.8));
    const step = 22, off = (e.nb * step * 2) % (step * 40);
    for (let y = s.y - h / 2 + 12; y < s.y + h / 2 - 8; y += step) for (let x = -off; x < W; x += step) {
      const lit = hash(Math.floor((x + off) / step / 3), Math.floor(y / step)) > 0.55;
      disc(c, x, y, 7, lit ? col(e, 'hi', 0.6 + 0.4 * e.kp) : col(e, 'mid', 0.18));
    }
  },
  scan(c, s, e) {
    const sx = lerp(100, W - 100, (e.lt / 0.583) % 1);
    for (let i = 0; i < 900; i++) {
      const x = hash(i, 1) * W, y = 300 + hash(i, 2) * 700;
      if (x > sx + 40 && e.si === 0) continue;
      const near = (y - 300) / 700;
      disc(c, x, y, 2 + 2 * near, pmix(e.P, 'deep', 'signal', near, 0.8));
    }
    for (const fx of [800, 1120]) for (let i = 0; i < 90; i++) disc(c, fx + (hash(i, fx) - 0.5) * 70, 640 + hash(i, 9) * 260, 3, col(e, 'hi', 0.9));
    c.strokeStyle = col(e, 'signal', 0.7 + 0.3 * e.bp); c.lineWidth = 3;
    c.beginPath(); c.moveTo(sx, 0); c.lineTo(sx, H); c.stroke();
  },
  iris(c, s, e) { irisAt(c, s.x, s.y, s.s * H * 0.5, e); },
  iris2(c, s, e) { irisAt(c, s.x - 430, s.y, s.s * H * 0.5, e); irisAt(c, s.x + 430, s.y, s.s * H * 0.5, e); },
  lissajous(c, s, e) {
    const R = s.s * H * 0.45, sync = e.si >= 2 ? 1 : 0;
    glow(c, col(e, 'mid'), 20);
    for (const [ox, a, b] of [[-380, 3, 2], [380, sync ? 3 : 5, sync ? 2 : 4]] as const) {
      c.strokeStyle = col(e, 'mid', 0.7 + 0.3 * e.kp); c.lineWidth = 3;
      c.beginPath();
      for (let i = 0; i <= 400; i++) {
        const q = (i / 400) * TAU, ph = e.nb * 0.4 + e.lt * 0.3;
        c.lineTo(s.x + ox + R * Math.sin(a * q + ph), s.y + R * Math.sin(b * q));
      }
      c.stroke();
    }
    noGlow(c);
  },
  flood(c, s, e) {
    if (e.si === 0) {
      // the whole frame hot at once — uniform, no centre (space expands everywhere)
      const heat = 1 - 0.5 * e.u;
      rect(c, 0, 0, W, H, pmix(e.P, 'mid', 'hi', heat, 1));
      for (let i = 0; i < 160; i++) disc(c, hash(i, 1) * W, hash(i, 2) * H, 30 + 20 * e.bp, col(e, 'hi', 0.25));
    } else {
      const spread = 1 + 0.12 * e.nb;
      for (let j = 0; j < 7; j++) for (let i = 0; i < 12; i++) {
        const x = W / 2 + (i - 5.5) * 170 * spread + 30 * Math.sin(e.lt + j), y = H / 2 + (j - 3) * 170 * spread;
        c.strokeStyle = pmix(e.P, 'deep', 'mid', hash(i, j), 0.8); c.lineWidth = 10;
        c.beginPath(); c.arc(x, y, 40 + 16 * e.kp, e.lt + hash(i, j) * 6, e.lt + hash(i, j) * 6 + 4.2); c.stroke();
      }
    }
  },
  lattice(c, s, e) {
    // metric expansion: the spacing between nodes grows per beat; node size stays the same
    const sp = 120 * (1 + 0.14 * (e.nb + e.bp * 0.4)) * (e.si ? 0.55 : 1);
    const pts: [number, number][] = [];
    for (let j = -6; j <= 6; j++) for (let i = -9; i <= 9; i++) pts.push([W / 2 + (i + (hash(i, j) - 0.5) * 0.7) * sp, H / 2 + (j + (hash(j, i) - 0.5) * 0.7) * sp]);
    c.strokeStyle = col(e, 'mid', 0.5); c.lineWidth = 2;
    for (let k = 0; k < pts.length; k++) { const a = pts[k]!, b = pts[k + 1]; if (b && hash(k) > 0.35) { c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.stroke(); } }
    for (const [x, y] of pts) disc(c, x, y, 6, col(e, 'hi', 0.9));
  },
  sun(c, s, e) {
    const R = s.s * H * 0.5;
    if (e.si === 0) {
      for (let i = 0; i < 300; i++) {
        const a = hash(i) * TAU, r = (200 + hash(i, 2) * 700) * (1 - 0.85 * e.u);
        disc(c, s.x + Math.cos(a) * r, s.y + Math.sin(a) * r * 0.7, 4, pmix(e.P, 'deep', 'mid', hash(i, 3), 0.7));
      }
      disc(c, s.x, s.y, 20 + 60 * e.u, col(e, 'hi'));
      return;
    }
    const g = c.createRadialGradient(s.x, s.y, 0, s.x, s.y, R);
    g.addColorStop(0, col(e, 'hi')); g.addColorStop(0.6, col(e, 'mid')); g.addColorStop(1, col(e, 'deep'));
    c.fillStyle = g; c.beginPath(); c.arc(s.x, s.y, R * (1 + 0.03 * e.kp), 0, TAU); c.fill();
    for (let i = 0; i < 220; i++) { const a = hash(i) * TAU, r = Math.sqrt(hash(i, 1)) * R * 0.95; disc(c, s.x + Math.cos(a) * r, s.y + Math.sin(a) * r, 7, col(e, 'hi', 0.25 + 0.5 * e.kp * hash(i, 2))); }
    c.strokeStyle = col(e, 'mid', 0.9 * e.dp + 0.1); c.lineWidth = 16;
    c.beginPath(); c.arc(s.x + R * 0.9, s.y - R * 0.3, R * 0.35, Math.PI * 0.9, Math.PI * 1.9); c.stroke();
  },
  planets(c, s, e) {
    const tt = Math.floor(e.lt * 12) / 12; // stepped 12 fps
    const R = s.s * H * 0.5;
    disc(c, s.x, s.y, R + 6 * Math.min(8, e.nb), col(e, 'mid'));
    for (let i = 0; i < Math.min(8, e.nb); i++) disc(c, s.x + Math.cos(i * 2.1) * R * 0.9, s.y + Math.sin(i * 2.1) * R * 0.9, 30, col(e, 'hi'));
    if (e.si === 0) disc(c, lerp(W + 100, s.x + R * 1.4, tt / 2.33), s.y - R * 0.4, R * 0.4, col(e, 'deep'));
    else {
      disc(c, s.x + R * 0.8, s.y - R * 0.3, R * 0.4, col(e, 'deep'));
      for (let i = 0; i < 40; i++) { const a = hash(i) * TAU, r = R * (1.2 + tt * 0.6 * hash(i, 1)); disc(c, s.x + Math.cos(a) * r, s.y + Math.sin(a) * r * 0.5, 10, col(e, 'mid')); }
    }
  },
  moon(c, s, e) {
    const R = s.s * H * 0.5, g = ease.outCubic(e.pp);
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * TAU + e.lt * 0.4, r = lerp(R * 2.2, R * 0.7, g);
      c.strokeStyle = col(e, 'deep', 0.35); c.lineWidth = 30;
      c.beginPath(); c.arc(s.x, s.y, r, a, a + 0.18); c.stroke();
    }
    disc(c, s.x, s.y, R * g, col(e, 'mid', 0.55));
    if (e.pp > 0.75) rect(c, s.x + R * 1.3, s.y + R * 0.8, 60, 60, col(e, 'hi'));
  },
  card(c, s, e) {
    const w = s.s * H * 1.25, h = s.s * H * 0.55;
    // the open book: two pages and the fold
    c.fillStyle = col(e, 'deep', 0.15);
    c.beginPath(); c.moveTo(s.x - w, s.y + h); c.lineTo(s.x, s.y + h * 0.8); c.lineTo(s.x + w, s.y + h); c.lineTo(s.x + w * 0.9, s.y); c.lineTo(s.x, s.y - h * 0.15); c.lineTo(s.x - w * 0.9, s.y); c.closePath(); c.fill();
    c.strokeStyle = col(e, 'deep', 0.5); c.lineWidth = 3;
    c.beginPath(); c.moveTo(s.x, s.y - h * 0.15); c.lineTo(s.x, s.y + h * 0.8); c.stroke();
    const scene = String(s.scene ?? 'city');
    const n = Math.min(10, e.nb + 1);
    for (let i = 0; i < n; i++) {
      const hinge = i === n - 1 ? ease.outBack(clamp((e.bp > 0 ? 1 - e.bp : 1))) : 1;
      const x = s.x - w * 0.75 + (i / 9) * w * 1.5, base = s.y + h * 0.55;
      if (scene === 'city') rect(c, x - 40, base - 260 * hash(i, 3) * hinge - 80 * hinge, 80, 260 * hash(i, 3) * hinge + 80 * hinge, pmix(e.P, 'mid', 'deep', hash(i), 0.9));
      else if (scene === 'sea') {
        if (i % 2 === 0) rect(c, x - 70, base - 60 * hinge, 140, 60 * hinge, col(e, 'deep', 0.8));
        else disc(c, x, base - 150 * hinge, 26, col(e, 'mid'));
      } else {
        // several lineages, several gaits; a human appears last (shot 3)
        const posture = e.si === 0 ? 0 : e.si === 1 ? 0.3 + 0.1 * (i % 3) : e.si === 2 ? 0.6 + 0.1 * (i % 3) : 0.7;
        figure(c, x, base, 170 * hinge, posture, col(e, 'mid', 0.95));
      }
    }
    if (scene === 'land' && e.si === 3) figure(c, s.x + w * 0.85, s.y + h * 0.55, 230, 1, col(e, 'signal'));
    disc(c, s.x + w * 0.62, s.y - h * 1.2, 50, col(e, scene === 'city' ? 'mid' : 'hi', 0.9));
  },
  ascii(c, s, e) {
    const tear = W / 2 + 40 * e.nb + 30 * e.bp;
    const g = c.createLinearGradient(tear, 0, W, 0);
    g.addColorStop(0, col(e, 'hi', 0.9)); g.addColorStop(1, col(e, 'mid', 0.4));
    c.fillStyle = g; c.fillRect(tear, 0, W - tear, H);
    const cell = 26;
    c.font = `${cell}px "${F.mono()}"`;
    for (let y = 0; y < H; y += cell) for (let x = 0; x < tear - cell; x += cell * 0.62) {
      const v = hash(Math.floor(x), y, e.nb);
      c.fillStyle = col(e, 'mid', 0.2 + 0.6 * v);
      c.fillText(v > 0.7 ? '@' : v > 0.45 ? '%' : v > 0.25 ? '+' : '.', x, y + cell);
    }
  },
  hand(c, s, e) {
    const R = s.s * H * 0.5, dx = 14 * e.nb;
    c.save(); c.translate(s.x + dx, s.y);
    c.fillStyle = col(e, 'mid', 0.9);
    c.beginPath(); c.roundRect(-R * 0.5, -R * 0.1, R, R * 0.9, 60); c.fill();
    for (let i = 0; i < 4; i++) { c.beginPath(); c.roundRect(-R * 0.48 + i * R * 0.25, -R * 0.9, R * 0.2, R * 0.85, 40); c.fill(); }
    c.strokeStyle = col(e, 'ground', 0.5 + 0.4 * e.bp); c.lineWidth = 3;
    for (let y = -R; y < R; y += 16) { c.beginPath(); c.moveTo(-R * 0.6, y); c.lineTo(R * 0.6, y + 30); c.stroke(); }
    c.restore();
  },
  globe(c, s, e) {
    const R = s.s * H * 0.5;
    disc(c, s.x, s.y, R, col(e, 'deep'));
    glow(c, col(e, 'mid'), 40); ring(c, s.x, s.y, R, col(e, 'mid', 0.8), 6); noGlow(c);
    const lit = Math.min(1, 0.3 + 0.12 * e.nb);
    for (let i = 0; i < 700; i++) {
      const x = hash(i, 1) * W, y = s.y - R + hash(i, 2) * 520;
      if (Math.hypot(x - s.x, y - s.y) > R - 10 || hash(i, 3) > lit) continue;
      disc(c, x, y, 2 + 2 * hash(i, 4), col(e, 'hi', 0.6 + 0.4 * e.kp));
    }
  },
  discs(c, s, e) {
    const cols = Number(s.cols ?? 32), rows = Number(s.rows ?? 12), gw = s.s * H * 1.9, cw = gw / cols, gh = cw * rows;
    rect(c, s.x - gw / 2 - 20, s.y - gh / 2 - 20, gw + 40, gh + 40, col(e, 'deep'));
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const cleared = j < e.nb % (rows + 1);
      const on = !cleared && hash(i, j) > 0.55;
      disc(c, s.x - gw / 2 + (i + 0.5) * cw, s.y - gh / 2 + (j + 0.5) * cw, cw * 0.42, on ? col(e, 'hi') : col(e, 'ground'));
    }
  },
  jamo(c, s, e) {
    const beatInBar = e.nb % 4, apart = e.si === 0 ? 0.15 * e.u : 0.3 + 0.25 * beatInBar + 0.2 * e.bp;
    const parts: [Role, 'o' | 'bar' | 'sq', number, number][] = [['deep', 'o', -300, -40], ['mid', 'bar', -120, 0], ['hi', 'sq', 60, -80], ['deep', 'bar', 220, 40], ['mid', 'o', 360, -20], ['hi', 'bar', 0, 160]];
    parts.forEach(([r, k, x, y], i) => {
      const a = hash(i) * TAU, px = s.x + x + Math.cos(a) * 500 * apart, py = s.y + y + Math.sin(a) * 300 * apart;
      if (k === 'o') ring(c, px, py, 70, col(e, r), 34);
      else if (k === 'bar') rect(c, px - 30, py - 140, 60, 280, col(e, r));
      else rect(c, px - 70, py - 70, 140, 140, col(e, r));
    });
  },
  rings(c, s, e) {
    for (let i = 0; i < 5; i++) {
      const tilt = 0.3 + i * 0.25 + e.lt * 0.4, close = clamp(e.pp * 1.5);
      c.strokeStyle = pmix(e.P, 'mid', 'hi', i / 5, 0.9); c.lineWidth = 10 + 4 * e.kp;
      c.beginPath(); c.ellipse(s.x, s.y, s.s * H * 0.6 * (1.3 - 0.4 * close), s.s * H * 0.6 * Math.abs(Math.sin(tilt)) + 10, i * 0.6, 0, TAU); c.stroke();
    }
  },
  field(c, s, e) {
    const soft = e.si === 0 ? 0 : e.si === 1 ? e.u : 1;
    const w = lerp(700, W * 1.6, soft), h = lerp(420, H * 1.6, soft);
    const g = c.createRadialGradient(s.x, s.y, 0, s.x, s.y, Math.max(w, h) * 0.7);
    g.addColorStop(0, col(e, 'hi', 1)); g.addColorStop(0.5, col(e, 'ground', 1)); g.addColorStop(1, col(e, 'deep', 0.9 - 0.4 * soft));
    rect(c, 0, 0, W, H, col(e, 'deep', 1 - soft));
    c.fillStyle = g;
    c.beginPath(); c.roundRect(s.x - w / 2, s.y - h / 2, w, h, 60 + 400 * soft); c.fill();
    rect(c, 0, 0, W, H, col(e, 'hi', 0.12 * e.bp));
  },
  marks(c, s, e) {
    const n = 60, stage = e.si; // 0 different marks, 1 grid, 2 compress, 3 point
    for (let i = 0; i < n; i++) {
      const gx = (i % 12) - 5.5, gy = Math.floor(i / 12) - 2;
      const k = stage === 0 ? 0 : stage === 1 ? 1 : stage === 2 ? 1 : 1;
      const sq = stage === 2 ? 1 - 0.7 * e.u : stage === 3 ? 0 : 1;
      const x = lerp(hash(i, 1) * W, s.x + gx * 110 * sq, k), y = lerp(hash(i, 2) * H, s.y + gy * 110 * sq, k);
      const a = lerp(hash(i, 3) * 3, 0, k), L = lerp(20 + 60 * hash(i, 4), 40, k);
      c.strokeStyle = col(e, 'hi', 0.8); c.lineWidth = 4;
      c.beginPath(); c.moveTo(x - Math.cos(a) * L / 2, y - Math.sin(a) * L / 2); c.lineTo(x + Math.cos(a) * L / 2, y + Math.sin(a) * L / 2); c.stroke();
    }
    if (stage === 3) { glow(c, col(e, 'signal'), 50); disc(c, s.x, s.y, 16 * (1 + e.kp), col(e, 'signal')); noGlow(c); }
  },
  ridges(c, s, e) {
    const rows = 22, top = 240, dy = 30;
    for (let j = 0; j < rows; j++) {
      const y = top + j * dy, reg = clamp(e.pp * 1.4);
      c.beginPath(); c.moveTo(560, y);
      for (let x = 560; x <= 1360; x += 8) {
        const m = Math.exp(-(((x - 960) / 160) ** 2));
        const irr = m * 90 * hash(Math.floor(x / 24), j + e.nb);
        const regv = m * 70 * Math.abs(Math.sin(x / 18));
        c.lineTo(x, y - lerp(irr, regv, reg) * (1 + 0.3 * e.kp));
      }
      c.lineTo(1360, y + 4); c.lineTo(560, y + 4); c.closePath();
      c.fillStyle = col(e, 'ground'); c.fill();
      c.strokeStyle = col(e, 'hi', 0.9); c.lineWidth = 2; c.stroke();
    }
  },
  stones(c, s, e) {
    for (let i = 0; i < 6; i++) {
      const k = e.nb - 5 + i;
      if (k < 0) continue;
      const x = 260 + i * 280, y = s.y - i * 30, a = i === 5 ? 1 - 0.6 * e.bp : 0.35 + 0.1 * i;
      c.fillStyle = col(e, 'hi', a);
      c.beginPath(); c.moveTo(x, y); c.lineTo(x + 220, y - 20); c.lineTo(x + 250, y + 40); c.lineTo(x + 30, y + 60); c.closePath(); c.fill();
      rect(c, x + 30, y + 60, 220, 90, col(e, 'mid', a * 0.7));
    }
  },
  sodium(c, s, e) {
    const g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, col(e, 'hi', 0.5 + 0.2 * e.kp)); g.addColorStop(1, col(e, 'ground', 0));
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    glow(c, col(e, 'hi'), 80); disc(c, s.x, s.y, s.s * H * 0.5, col(e, 'hi')); noGlow(c);
    for (let i = 0; i < 26; i++) {
      const x = 80 + i * 70 + 20 * hash(i), up = (i % 4 === e.nb % 4) ? 1 : 0;
      figure(c, x, H - 40, 120 + 40 * hash(i, 2), 1, col(e, 'mid', 0.85));
      if (up) rect(c, x - 3, H - 40 - 200, 6, 60, col(e, 'mid', 0.85));
    }
  },
  cave(c, s, e) {
    for (let i = 0; i < 30; i++) disc(c, hash(i, 1) * W, hash(i, 2) * H, 80 + 160 * hash(i, 3), col(e, 'deep', 0.35));
    const fire = c.createRadialGradient(W / 2, H + 100, 0, W / 2, H + 100, 900);
    fire.addColorStop(0, col(e, 'hi', 0.7 + 0.3 * e.bp)); fire.addColorStop(1, col(e, 'hi', 0));
    c.fillStyle = fire; c.fillRect(0, 0, W, H);
    for (let i = 0; i < Math.min(8, e.nb + 1); i++) {
      const x = 360 + (i % 4) * 380 + 40 * hash(i), y = 300 + Math.floor(i / 4) * 300;
      disc(c, x, y, 55, col(e, 'mid', 0.85));
      for (let f = 0; f < 5; f++) { const a = -2.4 + f * 0.45; c.fillStyle = col(e, 'mid', 0.85); c.beginPath(); c.ellipse(x + Math.cos(a) * 85, y + Math.sin(a) * 85, 16, 40, a + Math.PI / 2, 0, TAU); c.fill(); }
    }
    for (let i = 0; i < 20; i++) disc(c, W / 2 + (hash(i) - 0.5) * 600, H - ((e.lt * 300 + hash(i, 5) * H) % H), 4, col(e, 'signal', 0.9));
  },
  tablet(c, s, e) {
    const w = s.s * H * 1.3, h = s.s * H;
    c.fillStyle = col(e, 'mid'); c.beginPath(); c.roundRect(s.x - w / 2, s.y - h / 2, w, h, 40); c.fill();
    const n = Math.min(48, (e.nb + 1) * 3);
    for (let i = 0; i < n; i++) {
      const x = s.x - w / 2 + 70 + (i % 12) * (w - 140) / 11, y = s.y - h / 2 + 80 + Math.floor(i / 12) * 110;
      c.fillStyle = col(e, 'deep', 0.9);
      c.beginPath(); c.moveTo(x, y); c.lineTo(x + 36, y + 14); c.lineTo(x, y + 28); c.closePath(); c.fill();
      rect(c, x - 2, y + 6, 4, 50, col(e, 'hi', 0.6));
    }
  },
  rose(c, s, e) {
    const R = s.s * H * 0.5, rings = 5, lit = Math.min(rings, e.nb + 1);
    for (let r = rings; r >= 1; r--) {
      const n = 6 + r * 4;
      for (let i = 0; i < n; i++) {
        const a0 = (i / n) * TAU, a1 = ((i + 1) / n) * TAU;
        const on = r <= lit;
        c.fillStyle = on ? pcss(e.P, (['deep', 'mid', 'hi', 'text'] as Role[])[(i + r) % 4]!, 0.85 + 0.15 * e.bp) : col(e, 'deep', 0.15);
        c.beginPath(); c.moveTo(s.x, s.y); c.arc(s.x, s.y, (R * r) / rings, a0, a1); c.closePath(); c.fill();
      }
    }
    c.strokeStyle = col(e, 'ground'); c.lineWidth = 8;
    for (let r = 1; r <= rings; r++) { c.beginPath(); c.arc(s.x, s.y, (R * r) / rings, 0, TAU); c.stroke(); }
  },
  thermal(c, s, e) {
    const heat = (k: number) => pmix(e.P, k < 0.5 ? 'deep' : 'mid', k < 0.5 ? 'mid' : 'hi', (k % 0.5) * 2);
    if (e.si === 0) {
      for (let i = 0; i < 6; i++) gear(c, 400 + i * 230, s.y + (i % 2) * 120, 90 + 20 * (i % 3), 12, e.lt * (i % 2 ? 1 : -1) + i, heat(0.3 + 0.1 * i + 0.3 * e.kp));
    } else {
      rect(c, 240, s.y - 120, 1200, 240, heat(0.45));
      for (let i = 0; i < 4; i++) rect(c, 320 + i * 280, s.y - 220 - 60 * (i === e.nb % 4 ? 1 : 0), 120, 110, heat(0.7 + 0.3 * e.kp));
      for (let i = 0; i < 5; i++) disc(c, 360 + i * 240, s.y + 170, 70, heat(0.55));
      disc(c, 1500, s.y - 60, 120, heat(0.95));
    }
  },
  mushroom(c, s, e) {
    rect(c, 0, H * 0.78, W, H * 0.22, col(e, 'deep'));
    if (e.si === 0) { rect(c, s.x - 6, H * 0.78 - 300, 12, 300, col(e, 'deep')); return; }
    const rise = clamp(e.u * 1.3);
    const dot = 8;
    for (let y = 100; y < H * 0.78; y += dot) for (let x = 400; x < 1520; x += dot) {
      const cap = ((x - s.x) / 380) ** 2 + ((y - (H * 0.78 - 520 * rise - 60)) / 150) ** 2 < 1;
      const stem = Math.abs(x - s.x) < 70 && y > H * 0.78 - 520 * rise;
      if (!cap && !stem) continue;
      const shade = hash(x, y) < 0.7 - 0.4 * ((y / H) % 1) ? 1 : 0;
      if (shade) rect(c, x, y, dot - 1, dot - 1, col(e, 'deep'));
    }
    // whiteout on the downbeat (one large flash), decaying over the first quarter of the shot
    if (e.si === 1 && e.u < 0.25) rect(c, 0, 0, W, H, col(e, 'hi', clamp(1 - e.u * 4)));
  },
  boot(c, s, e) {
    if (e.si === 0) {
      for (let j = 0; j < 8; j++) for (let i = 0; i < 20; i++) {
        const bit = ((e.nb + i * 3 + j) >> (i % 4)) & 1;
        disc(c, 200 + i * 80, 260 + j * 80, 22, bit ? col(e, 'hi', 0.9) : col(e, 'deep', 0.6));
      }
    } else {
      rect(c, 260, 140, 1400, 800, col(e, 'mid'));
      rect(c, 360, 220, 1200, 640, col(e, 'deep'));
      for (let k = 0; k < 4; k++) rect(c, 400, 260 + k * 60, 600 - k * 90, 30, col(e, 'mid', 0.9));
      if (Math.floor(e.lt * 3) % 2 === 0) rect(c, 400, 520, 30, 36, col(e, 'mid'));
      const y = 600 + 14 * (e.nb % 2) + 40 * Math.sin(e.lt * 3);
      const g = c.createLinearGradient(0, y, 0, y + 80);
      g.addColorStop(0, col(e, 'hi', 0)); g.addColorStop(0.5, col(e, 'hi')); g.addColorStop(1, col(e, 'hi', 0));
      c.fillStyle = g; c.fillRect(360, y, 1200, 80);
    }
  },
  copper(c, s, e) {
    if (e.si === 0) {
      c.strokeStyle = col(e, 'mid'); c.lineWidth = 4; c.beginPath();
      for (let x = 0; x <= W; x += 6) c.lineTo(x, H / 2 + 120 * Math.sin(x / 14 + e.lt * 20) * Math.sin(x / 300));
      c.stroke();
      return;
    }
    if (e.si === 2) {
      const n = Math.min(24, 2 + e.nb * 2);
      for (let i = 0; i < 24; i++) for (let j = i + 1; j < 24; j += 5) if (i < n && j < n) {
        c.strokeStyle = col(e, 'mid', 0.5); c.lineWidth = 2;
        c.beginPath(); c.moveTo(200 + hash(i) * 1520, 150 + hash(i, 1) * 780); c.lineTo(200 + hash(j) * 1520, 150 + hash(j, 1) * 780); c.stroke();
      }
      for (let i = 0; i < n; i++) disc(c, 200 + hash(i) * 1520, 150 + hash(i, 1) * 780, 14 + 6 * e.kp, col(e, 'hi'));
      return;
    }
    for (let i = 0; i < 6; i++) {
      const y = H / 2 + Math.sin(e.lt * 3 + i * 0.7) * 320 + 14 * e.bp;
      const g = c.createLinearGradient(0, y - 30, 0, y + 30);
      g.addColorStop(0, col(e, 'deep', 0)); g.addColorStop(0.5, col(e, i % 2 ? 'mid' : 'hi')); g.addColorStop(1, col(e, 'deep', 0));
      c.fillStyle = g; c.fillRect(0, y - 30, W, 60);
    }
    c.fillStyle = col(e, 'hi');
    c.font = `64px "${F.slam()}"`;
    const jamo = 'ㄱㄴㄷㄹㅁㅂㅅㅇㅈㅊㅋㅌㅍㅎ';
    for (let i = 0; i < 28; i++) c.fillText(jamo[i % jamo.length]!, ((i * 90 - e.lt * 400) % (W + 200) + W + 200) % (W + 200) - 100, 880 + 50 * Math.sin(i * 0.5 + e.lt * 4));
  },
  face(c, s, e) {
    if (e.si === 0) {
      // data flood: barcodes; the large-area pattern changes once per beat (<= 3 flashes/s)
      for (let x = 0; x < W; x += 6) if (hash(x, e.nb) > 0.55) rect(c, x, 0, 3 + 6 * hash(x, 2), H, col(e, 'deep', 0.9));
      return;
    }
    const cell = 60, cond = clamp(e.u * 1.4);
    for (let j = -7; j <= 7; j++) for (let i = -6; i <= 6; i++) {
      const inFace = (i / 6) ** 2 + (j / 7.5) ** 2 < 1;
      const v = inFace ? 0.25 + 0.5 * hash(i, j) : hash(i, j, e.nb) * (1 - cond);
      if (v < 0.2) continue;
      rect(c, W / 2 - 60 + i * cell, H / 2 + j * cell, cell - 2, cell - 2, col(e, 'deep', v));
    }
    ring(c, s.x, s.y, 70, col(e, 'signal'), 18);
    disc(c, s.x, s.y, 26 * (1 + e.kp * 0.3), col(e, 'deep'));
  },
  swarm(c, s, e) {
    glow(c, col(e, 'hi'), 80); disc(c, s.x, s.y, s.s * H * 0.35, col(e, 'signal')); disc(c, s.x, s.y, s.s * H * 0.27, col(e, 'hi')); noGlow(c);
    const n = Math.min(12, 3 + e.nb);
    for (let k = 0; k < n; k++) {
      const R = 220 + k * 34, tilt = 0.25 + 0.05 * k;
      c.strokeStyle = col(e, 'mid', 0.25); c.lineWidth = 2;
      c.beginPath(); c.ellipse(s.x, s.y, R, R * tilt, -0.2, 0, TAU); c.stroke();
      for (let i = 0; i < 10; i++) { const a = i * 0.63 + e.lt * (0.4 + 0.05 * k); rect(c, s.x + Math.cos(a) * R - 9, s.y + Math.sin(a) * R * tilt - 5, 18, 10, col(e, 'mid')); }
    }
  },
  vault(c, s, e) {
    const close = e.si === 0 ? 0.3 * e.u + 0.1 * e.nb : 0.6 + 0.4 * e.u;
    for (let r = 7; r >= 1; r--) {
      const R = 120 + r * 120, n = 6 * r;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU + r * 0.2, x = s.x + Math.cos(a) * R, y = s.y + Math.sin(a) * R;
        const role = (['deep', 'mid', 'hi'] as Role[])[(i + r) % 3]!;
        c.fillStyle = pcss(e.P, role, 0.9);
        c.beginPath();
        for (let k = 0; k < 6; k++) { const b = a + (k / 6) * TAU; c.lineTo(x + Math.cos(b) * 58, y + Math.sin(b) * 58); }
        c.closePath(); c.fill();
      }
    }
    const oc = 110 * (1 - clamp(close));
    glow(c, col(e, 'signal'), 60); disc(c, s.x, s.y, oc * (1 + 0.1 * e.bp), col(e, 'signal')); noGlow(c);
  },
  pullback(c, s, e) {
    for (let i = 0; i < 260; i++) {
      const dark = i < e.nb * 18;
      disc(c, hash(i, 1) * W, hash(i, 2) * H, 2 + 2 * hash(i, 3), dark ? col(e, 'deep') : col(e, 'hi', 0.8));
    }
    const R = s.s * H * 0.5;
    disc(c, s.x, s.y, R, col(e, 'mid'));
    c.strokeStyle = col(e, 'hi', 0.3 + 0.5 * e.kp); c.lineWidth = 3;
    for (let k = -2; k <= 2; k++) { c.beginPath(); c.ellipse(s.x, s.y, R, R * Math.abs(k) * 0.3, 0, 0, TAU); c.stroke(); }
  },
  wedge(c, s, e) {
    c.fillStyle = col(e, 'deep');
    c.beginPath(); c.moveTo(0, H * 0.2); c.lineTo(s.x + 300 + 20 * e.kp, s.y); c.lineTo(0, H * 0.8); c.closePath(); c.fill();
    rect(c, s.x - 100, s.y - 380, 90, 760, col(e, 'mid'));
    ring(c, s.x + 420, s.y - 180, 150, col(e, 'hi'), 40);
    const n = Math.min(12, e.nb + 1);
    for (let i = 0; i < n; i++) rect(c, s.x + 80 + i * 60, s.y + 150, 48, 90 * (i === n - 1 ? 1 + 0.2 * e.kp : 1), col(e, i % 3 ? 'deep' : 'mid'));
  },
};

function irisAt(c: CanvasRenderingContext2D, x: number, y: number, R: number, e: Env) {
  disc(c, x, y, R * 1.15, col(e, 'deep', 0.9));
  ring(c, x, y, R * 1.15, col(e, 'mid'), 14);
  const ap = R * (0.75 - 0.05 * (e.nb % 12)), rot = e.nb * (TAU / 12);
  c.fillStyle = col(e, 'mid', 0.95);
  for (let i = 0; i < 8; i++) {
    const a = rot + (i / 8) * TAU;
    c.beginPath(); c.moveTo(x + Math.cos(a) * R, y + Math.sin(a) * R); c.lineTo(x + Math.cos(a + 0.9) * R, y + Math.sin(a + 0.9) * R);
    c.lineTo(x + Math.cos(a + 0.5) * ap, y + Math.sin(a + 0.5) * ap); c.closePath(); c.fill();
  }
  disc(c, x, y, Math.max(8, ap * 0.55), col(e, 'ground'));
  disc(c, x + ap * 0.15, y - ap * 0.15, 10 + 6 * e.bp, col(e, 'signal'));
}

// ------------------------------------------------------------------ cameras (storyboard `cam`)
interface Cam { z: number; sx?: number; sy?: number; rot?: number; dx?: number; dy?: number }
function camera(name: string, u: number): Cam {
  switch (name) {
    case 'flat': return { z: 0.8 };
    case 'close': return { z: 1.8 };
    case 'macro': return { z: 3 };
    case 'inside': return { z: 2.6 };
    case 'top': return { z: 1.1, sy: 0.55 };
    case 'side': return { z: 1.2, sx: 0.6, rot: 0.05 };
    case 'low': return { z: 1.3, sy: 1.25, dy: 120 };
    case 'tilt': return { z: 1.15, rot: -0.14 };
    case 'track': return { z: 1.3, dx: lerp(160, -160, u) };
    case 'push': return { z: lerp(1, 1.7, ease.inOutCubic(u)) };
    case 'pull': return { z: lerp(1.7, 0.5, ease.inOutCubic(u)) };
    case 'up': return { z: 1.25, rot: 0.3 * u };
    case 'over': return { z: 1.5, dx: -200, dy: 80 };
    default: return { z: 1 }; // wide
  }
}

// ------------------------------------------------------------------ lyric materials
const GLOW_MATS = new Set(['beam', 'tube', 'phosphor', 'led', 'lidar', 'radiograph', 'lights', 'scan']);
const STROKE_MATS = new Set(['carve', 'etch', 'cut']);

export default class Animatic extends Scene {
  private layer!: Layer2D;
  private list: Shot[] = [];
  private plate!: PlateInfo;
  private sb!: SbPlate;
  private P!: NamedPalette;
  private lines: Line[] = [];

  override init() {
    this.plate = this.ctx.params as PlateInfo;
    this.sb = sbPlate(this.plate.id);
    this.P = palette(this.ctx.params.look?.palette ?? 'bco');
    this.list = shots(this.plate, this.ctx.audio);
    this.lines = ownedLines(this.ctx);
    this.layer = new Layer2D();
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, audio } = this.ctx;
    const t = f.t, p = this.plate, P = this.P, sb = this.sb;
    const sh = shotAt(this.list, t);
    const t1 = Math.min(sh.t1, p.end);
    const e: Env = {
      P, t, pp: clamp((t - p.start) / (p.end - p.start)), lt: t - p.start, si: sh.index,
      u: clamp((t - sh.t0) / Math.max(1e-3, t1 - sh.t0)),
      bp: beatPulse(audio, t, 0.12), kp: kickPulse(audio, t, 0.12), dp: downbeatPulse(audio, t, 0.25),
      nb: Math.max(0, beatIndex(audio, t) - beatIndex(audio, p.start + 1e-3)),
      nB: Math.max(0, barIndex(audio, t) - barIndex(audio, p.start + 1e-3)),
      seed: p.n ?? 0, variant: p.variant,
    };
    const L = this.layer, c = L.ctx;
    L.clear(pcss(P, 'ground'));

    // subject, framed by the shot's camera around the subject centre
    const s = sb.subject, cam = camera(String(sh.shot.s.cam), e.u);
    const punch = 1 + 0.025 * e.bp;
    c.save();
    c.translate(s.x + (cam.dx ?? 0), s.y + (cam.dy ?? 0));
    if (cam.rot) c.rotate(cam.rot);
    c.scale(cam.z * punch * (cam.sx ?? 1), cam.z * punch * (cam.sy ?? 1));
    c.translate(-s.x, -s.y);
    (DRAW[s.kind] ?? DRAW.point!)(c, s, e);
    c.restore();
    c.shadowBlur = 0;

    // owned lyrics at the planned placement, in the plate's palette, with a material hint
    const ly = sb.lyr;
    if (ly) this.lines.forEach((line, i) => {
      const mat = ly.mat;
      drawLyric(c, line, t, {
        x: ly.x, y: ly.y + i * ly.size * 1.25, size: ly.size, rotation: ly.rot, align: ly.align, vertical: ly.vertical,
        family: F.slam(), maxWidth: 1760, unsungAlpha: 0.3,
        charTransform: (_ch: string, _i: number, st: CharState) => (st.sung && st.frac < 1 ? { scale: 1 + 0.08 * (1 - st.frac) } : undefined),
        drawChar: (cc: CanvasRenderingContext2D, ch: string, st: CharState) => {
          const voice = st.sung && st.frac < 1;
          const fill = voice ? pcss(P, 'signal') : st.sung ? pcss(P, 'text') : pcss(P, 'mid');
          if (GLOW_MATS.has(mat)) { cc.shadowColor = fill; cc.shadowBlur = 22; }
          if (mat === 'print') { cc.fillStyle = pcss(P, 'mid', 0.8); cc.fillText(ch, 6 + 2 * e.nb, 4); }
          if (STROKE_MATS.has(mat)) {
            cc.fillStyle = pcss(P, 'deep', 0.35); cc.fillText(ch, 0, 0);
            cc.strokeStyle = fill; cc.lineWidth = 3; cc.strokeText(ch, 0, 0);
          } else { cc.fillStyle = fill; cc.fillText(ch, 0, 0); }
          cc.shadowBlur = 0;
        },
      });
    });

    // debug label (very small, lower-left): PLAN row, idiom, family, ground, camera
    c.font = `18px "${F.mono(500)}"`;
    c.fillStyle = pmix(P, 'ground', 'text', 0.6, 0.85);
    c.fillText(`${p.n ?? ''} ${sb.idiom} ${sb.family} ${sb.ground} ${sb.palette} cam:${String(sh.shot.s.cam)}`, 24, H - 22);

    clearRT(renderer, out, plin(P, 'ground'));
    this.ctx.comp.draw(renderer, L.upload(), out, { mode: 'normal' });
    return { grain: 0.02, vignette: 0.08, ca: 0 };
  }
}
