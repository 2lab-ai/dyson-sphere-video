// The lyric layer: word-synced kinetic Hangul typography drawn over every scene (composited into the HDR
// frame before post, so bloom, zoom punches and chromatic aberration hit the words too).
// Three styles, chosen per lyric line by the timeline:
//   karaoke — the line sits low, each word pops in on its first syllable, sung syllables fill with the neon
//   slam    — the current word alone, huge, punched in with an RGB-split echo; the line runs small below
//   stack   — words pile up down the left edge, the newest one lit, older ones shrink and dim
import { Layer2D, W, H } from './gl';
import { rgba, HEX, NEONS } from './palette';
import { F, font } from './type';
import type { Line, Lyrics, Word } from './lyrics';
import { clamp, ease, hash, lerp, prog } from './util';

export type LyricStyle = 'karaoke' | 'slam' | 'stack' | 'off';

export interface HudState {
  opacity: number;
  /** Kick / snare pulses (0..1, decaying) — words breathe on the kick. */
  kick: number;
  snare: number;
  /** Bar index: advances the neon accent. */
  bar: number;
}

const SYLLABLE = /[가-힣A-Za-z0-9]/;
const LINGER = 0.45; // a line stays on screen this long after its last word

export class Hud {
  layer = new Layer2D();
  constructor(public lyrics: Lyrics, public styleOf: (l: Line) => LyricStyle) {}

  draw(t: number, st: HudState) {
    const L = this.layer;
    L.clear();
    if (st.opacity <= 0.001) return L.upload();
    const c = L.ctx;
    c.globalAlpha = st.opacity;
    for (const l of this.lyrics.lines) {
      if (t < l.start - 0.1 || t > l.end + LINGER) continue;
      const next = this.lyrics.lines[l.i + 1];
      // a line is pushed off as soon as the next one starts, else it lingers out
      const out = next && t >= next.start - 0.05 ? prog(t, next.start - 0.05, next.start + 0.2) : prog(t, l.end, l.end + LINGER);
      if (out >= 1) continue;
      const style = this.styleOf(l);
      if (style === 'off') continue;
      const accent = HEX[NEONS[(Math.floor(st.bar) + l.i) % NEONS.length]!];
      c.save();
      c.globalAlpha *= 1 - ease.inCubic(out);
      if (style === 'karaoke') this.karaoke(c, t, l, accent, st, out);
      else if (style === 'slam') this.slam(c, t, l, accent, st, out);
      else this.stack(c, t, l, accent, st, out);
      c.restore();
    }
    return L.upload();
  }

  /** Index of the last sung syllable of a word (-1 = none yet). */
  private sung(w: Word, t: number) {
    const syl = w.syl ?? [];
    if (!syl.length) return t >= w.start ? 1e9 : -1;
    let k = -1;
    for (let i = 0; i < syl.length; i++) if (t >= syl[i]![0] - 0.02) k = i;
    return k;
  }

  /** Draw a word char by char; syllables up to `sungIdx` take `hot`, the rest `cold`. */
  private wordChars(c: CanvasRenderingContext2D, w: string, x: number, y: number, sungIdx: number, hot: string, cold: string) {
    let k = -1;
    for (const ch of w) {
      if (SYLLABLE.test(ch)) k++;
      c.fillStyle = k <= sungIdx ? hot : cold;
      c.fillText(ch, x, y);
      x += c.measureText(ch).width;
    }
  }

  private karaoke(c: CanvasRenderingContext2D, t: number, l: Line, accent: string, st: HudState, out: number) {
    const fam = F.slam();
    let size = 104;
    c.font = font(fam, size);
    let gap = size * 0.28;
    const widths = () => l.words.map((w) => c.measureText(w.w).width);
    let ws = widths();
    let total = ws.reduce((a, b) => a + b, 0) + gap * (ws.length - 1);
    if (total > 1640) {
      size *= 1640 / total; gap = size * 0.28; c.font = font(fam, size);
      ws = widths(); total = ws.reduce((a, b) => a + b, 0) + gap * (ws.length - 1);
    }
    let x = (W - total) / 2;
    const y = H * 0.8 - out * 40;
    c.textBaseline = 'alphabetic';
    // a soft dark band behind the line keeps it legible over the busiest plates
    c.save();
    c.globalAlpha *= 0.6 * clamp((t - l.start + 0.1) / 0.15);
    c.filter = 'blur(28px)';
    c.fillStyle = HEX.ink;
    c.fillRect(x - 60, y - size * 1.0, total + 120, size * 1.35);
    c.restore();
    l.words.forEach((w, i) => {
      const a = t - (w.start - 0.06);
      const wx = x;
      x += ws[i]! + gap;
      if (a < 0) return;
      const pop = prog(a, 0, 0.22, (u) => ease.outBack(u, 2.6));
      const active = t >= w.start - 0.06 && t < w.end;
      const s = lerp(1.55, 1, pop) * (1 + (active ? 0.05 * st.kick : 0));
      const dy = lerp(-36, 0, pop);
      c.save();
      c.translate(wx + ws[i]! / 2, y + dy);
      c.rotate((hash(i, l.i, 3) - 0.5) * 0.3 * (1 - pop));
      c.scale(s, s);
      c.globalAlpha *= clamp(a / 0.05);
      c.shadowColor = active ? accent : rgba('ink', 0.9);
      c.shadowBlur = active ? 28 + 30 * st.kick : 14;
      this.wordChars(c, w.w, -ws[i]! / 2, 0, this.sung(w, t), active ? accent : HEX.bone, rgba('bone', 0.55));
      c.restore();
    });
  }

  private slam(c: CanvasRenderingContext2D, t: number, l: Line, accent: string, st: HudState, out: number) {
    let wi = -1;
    l.words.forEach((w, i) => { if (t >= w.start - 0.04) wi = i; });
    if (wi >= 0) {
      const w = l.words[wi]!;
      const a = t - (w.start - 0.04);
      const fam = F.slam();
      c.font = font(fam, 300);
      const size = Math.min(340, (300 * 1500) / Math.max(c.measureText(w.w).width, 1));
      c.font = font(fam, size);
      const width = c.measureText(w.w).width;
      const pop = prog(a, 0, 0.16, (u) => ease.outBack(u, 3.2));
      const s = lerp(2.3, 1, pop) * (1 + 0.07 * st.kick) * (1 + 0.25 * out);
      const split = 10 + 26 * st.snare + 30 * (1 - pop);
      c.save();
      c.translate(W / 2 + (hash(wi, l.i) - 0.5) * 60, H * 0.47 + size * 0.34);
      c.rotate((hash(l.i, wi, 11) - 0.5) * 0.14);
      c.scale(s, s);
      c.textBaseline = 'alphabetic';
      c.globalAlpha *= clamp(a / 0.04);
      c.globalCompositeOperation = 'lighter';
      c.fillStyle = rgba('pink', 0.85);
      c.fillText(w.w, -width / 2 - split, 0);
      c.fillStyle = rgba('cyan', 0.85);
      c.fillText(w.w, -width / 2 + split, 0);
      c.globalCompositeOperation = 'source-over';
      c.shadowColor = accent;
      c.shadowBlur = 40 + 40 * st.kick;
      this.wordChars(c, w.w, -width / 2, 0, this.sung(w, t), HEX.bone, rgba('bone', 0.75));
      c.restore();
    }
    // the whole line, small, as a running subtitle
    c.save();
    c.font = font(F.hangul(), 46);
    c.textBaseline = 'alphabetic';
    const sp = c.measureText(' ').width;
    let x = (W - c.measureText(l.words.map((w) => w.w).join(' ')).width) / 2;
    c.shadowColor = rgba('ink', 0.95);
    c.shadowBlur = 12;
    for (const w of l.words) {
      c.fillStyle = t >= w.start - 0.04 ? accent : rgba('bone', 0.45);
      c.fillText(w.w, x, H - 64);
      x += c.measureText(w.w).width + sp;
    }
    c.restore();
  }

  private stack(c: CanvasRenderingContext2D, t: number, l: Line, accent: string, st: HudState, out: number) {
    const started = l.words.filter((w) => t >= w.start - 0.05);
    const n = started.length;
    const fam = F.slam();
    let y = H * 0.74;
    for (let k = n - 1; k >= 0 && k >= n - 4; k--) {
      const w = started[k]!;
      const age = n - 1 - k; // 0 = newest
      const a = t - (w.start - 0.05);
      const pop = prog(a, 0, 0.2, (u) => ease.outBack(u, 2.2));
      const size = [190, 124, 90, 66][age]!;
      c.save();
      c.font = font(fam, size);
      c.textBaseline = 'alphabetic';
      c.globalAlpha *= [1, 0.8, 0.55, 0.3][age]! * clamp(a / 0.05);
      c.shadowColor = age === 0 ? accent : rgba('ink', 0.9);
      c.shadowBlur = age === 0 ? 36 + 30 * st.kick : 10;
      c.translate(130 + (age === 0 ? lerp(-140, 0, pop) : 0) - out * 80, y);
      if (age === 0) c.scale(1 + 0.05 * st.kick, 1 + 0.05 * st.kick);
      this.wordChars(c, w.w, 0, 0, age === 0 ? this.sung(w, t) : 1e9, age === 0 ? accent : HEX.bone, rgba('bone', 0.6));
      c.restore();
      y -= size * 1.02;
    }
  }
}
