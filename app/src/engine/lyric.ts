// Scene-owned lyrics. There is no global lyric layer: every vocal plate draws its own lines, in its own
// position, motion and material, through drawLyric(). This module only does the parts that must be the
// same everywhere — which lines a plate owns, per-syllable progress (never ahead of the voice), measured
// layout, readability defaults — and it logs every draw so a render can prove who drew what.
//
// API (stable — plate authors code against this):
//   ownedLines(ctx): Line[]                         the plate's lines: ctx.params.lines (ids) -> ctx.lyrics.lines
//   syllableState(word, t): { sung, frac }          sung = syllables whose start <= t (0..n); frac = progress
//                                                   0..1 through the latest started syllable (0 if none)
//   wordState(word, t): { started, progress, done } progress 0..1 across the word's syllables
//   lineVisible(line, t, lead = 0.4): boolean       t >= line.start - lead (a plate keeps its line after it is
//                                                   sung; hide it yourself if the idiom wants that)
//   layoutLine(c2d, line, family, size, maxWidth?, vertical?): LineLayout
//                                                   measured with the real font on c2d; shrinks `size` to fit
//                                                   maxWidth (maxHeight when vertical). Per-word and per-char boxes.
//   drawLyric(c2d, line, t, opts): LineLayout | null  THE draw entry point. Every vocal plate must call it for
//                                                   each owned line (the gate checks the call in the AST: import
//                                                   it by name — `import { drawLyric } from '../engine/lyric'`).
//   lyricDrawLog: Map<plateId, count>               every drawLyric call, keyed by the plate the engine is
//                                                   rendering (export mode: window.__pdoom.lyricDraws)
//
// Fonts (engine/type.ts): Hangul needs F.slam() (Black Han Sans) or F.hangul() (Do Hyeon). F.archivo() and
// F.mono() have no Hangul glyphs — use them for Latin-only furniture, not for lines.
//
// Timing rules baked in: a syllable is sung only when t >= its own start (data/lyrics.json `syl`), never
// early. Syllables map to the syllable-bearing characters [가-힣A-Za-z0-9]; punctuation (‘-’, ‘,’) takes the
// state of the syllable before it. A word without `syl` is one syllable [start, end]. Unsung characters are
// drawn at `unsungAlpha` (0.35) while the line is inside its lead window.
import type { Line, Word } from './lyrics';
import { rgba, type PaletteKey } from './palette';
import { F, font } from './type';

export { F };

// ------------------------------------------------------------------ draw log
/** drawLyric calls per plate id (reset only by reloading the page). */
export const lyricDrawLog = new Map<string, number>();
/** Smallest fitted glyph size (px, 1080p logical) drawn per plate — the v4 gate checks it against LYRIC_MIN_PX. */
export const lyricSizeLog = new Map<string, number>();
/** v4: no lyric smaller than this on screen (docs/PLAN-V4.md C7 gate clause 5). layoutLine will not shrink below it. */
export const LYRIC_MIN_PX = 120;
let currentPlate = '(none)';
/** Engine-internal: the plate being rendered (set right before each scene render). */
export function setLyricPlate(id: string) { currentPlate = id; }

// ------------------------------------------------------------------ timing
const SYLLABIC = /[가-힣A-Za-z0-9]/;

export interface SylState { sung: number; frac: number }
export interface WordState { started: boolean; progress: number; done: boolean }

function syls(word: Pick<Word, 'start' | 'end' | 'syl'>): [number, number][] {
  return word.syl && word.syl.length ? word.syl : [[word.start, word.end]];
}

export function syllableState(word: Pick<Word, 'start' | 'end' | 'syl'>, t: number): SylState {
  const s = syls(word);
  let sung = 0;
  for (const [a] of s) if (t >= a) sung++;
  if (sung === 0) return { sung: 0, frac: 0 };
  const [a, b] = s[sung - 1]!;
  return { sung, frac: Math.min(1, Math.max(0, (t - a) / Math.max(1e-3, b - a))) };
}

export function wordState(word: Pick<Word, 'start' | 'end' | 'syl'>, t: number): WordState {
  const s = syls(word);
  const { sung, frac } = syllableState(word, t);
  const progress = sung === 0 ? 0 : (sung - 1 + frac) / s.length;
  return { started: sung > 0, progress, done: sung === s.length && frac >= 1 };
}

export function lineVisible(line: Pick<Line, 'start'>, t: number, lead = 0.4): boolean {
  return t >= line.start - lead;
}

/** The plate's owned lines, in order (ctx.params.lines are indices into data/lyrics.json). */
export function ownedLines(ctx: { params: Record<string, any>; lyrics: { lines: Line[] } }): Line[] {
  const ids: number[] = ctx.params.lines ?? [];
  return ids.map((i) => {
    const l = ctx.lyrics.lines[i];
    if (!l) throw new Error(`plate owns lyric line ${i}, which does not exist`);
    return l;
  });
}

// ------------------------------------------------------------------ layout
export interface CharBox {
  ch: string;
  /** Box relative to the line origin: horizontal = left edge on the baseline; vertical = centred column. */
  x: number;
  y: number;
  w: number;
  /** Index in the line (over all words, spaces excluded), word index, syllable index within the word. */
  index: number;
  word: number;
  syl: number;
}
export interface WordBox { word: Word; x: number; y: number; w: number; h: number; chars: CharBox[] }
export interface LineLayout {
  line: Line;
  family: string;
  /** Size actually used (after fitting). */
  size: number;
  vertical: boolean;
  /** Extent: horizontal = width x size; vertical = column width x height. */
  width: number;
  height: number;
  words: WordBox[];
  chars: CharBox[];
}

export function layoutLine(c2d: CanvasRenderingContext2D, line: Line, family: string, size: number, maxWidth?: number, vertical = false): LineLayout {
  const run = (sz: number): LineLayout => {
    c2d.save();
    c2d.font = font(family, sz);
    const gap = Math.max(c2d.measureText(' ').width, sz * 0.28);
    const words: WordBox[] = [];
    const chars: CharBox[] = [];
    let pen = 0, colW = 0, index = 0;
    line.words.forEach((w, wi) => {
      const cs = Array.from(w.w);
      const nSyl = syls(w).length;
      const boxes: CharBox[] = [];
      let k = -1, prefix = '';
      const x0 = pen;
      for (const ch of cs) {
        if (SYLLABIC.test(ch)) k++;
        const syl = Math.min(Math.max(k, 0), nSyl - 1);
        const cw = c2d.measureText(ch).width;
        if (vertical) {
          boxes.push({ ch, x: -cw / 2, y: pen + sz * 0.85, w: cw, index: index++, word: wi, syl });
          pen += sz * 1.02;
          colW = Math.max(colW, cw);
        } else {
          prefix += ch;
          // kerned position: width of the run so far minus this glyph's own advance
          boxes.push({ ch, x: x0 + c2d.measureText(prefix).width - cw, y: 0, w: cw, index: index++, word: wi, syl });
        }
      }
      const ww = vertical ? colW : c2d.measureText(w.w).width;
      if (!vertical) pen += ww;
      words.push({ word: w, x: vertical ? -colW / 2 : x0, y: vertical ? x0 : 0, w: ww, h: vertical ? pen - x0 : sz, chars: boxes });
      chars.push(...boxes);
      if (wi < line.words.length - 1) pen += vertical ? sz * 0.45 : gap;
    });
    c2d.restore();
    return { line, family, size: sz, vertical, width: vertical ? colW : pen, height: vertical ? pen : sz, words, chars };
  };
  let lay = run(size);
  const extent = vertical ? lay.height : lay.width;
  if (maxWidth && extent > maxWidth) lay = run(size * (maxWidth / extent) * 0.999);
  return lay;
}

// ------------------------------------------------------------------ draw
/** What charTransform sees for each character. */
export interface CharState {
  /** This character's syllable has started (t >= its syl start). */
  sung: boolean;
  /** 0..1 through this character's syllable (0 until it starts, 1 after it ends). */
  frac: number;
  /** The word's progress 0..1. */
  wordProgress: number;
  word: number;
  syl: number;
  box: CharBox;
}
export interface CharXform { dx?: number; dy?: number; rot?: number; scale?: number; alpha?: number }

export interface DrawLyricOpts {
  /** Anchor point (logical px) and alignment of the line around it (vertical lines: x = column centre, y = top). */
  x: number;
  y: number;
  family?: string;
  size: number;
  align?: 'left' | 'center' | 'right';
  /** Fit: the line shrinks to this width (height when vertical). */
  maxWidth?: number;
  sungColor?: PaletteKey;
  unsungColor?: PaletteKey;
  /** Alpha of not-yet-sung characters (default 0.35). */
  unsungAlpha?: number;
  /** Seconds before line.start at which it appears (default 0.4). Nothing is drawn before that. */
  lead?: number;
  /** Overall alpha (e.g. the plate's own fade). */
  alpha?: number;
  /** Rotation of the whole line (rad) around (x, y). */
  rotation?: number;
  vertical?: boolean;
  /** v4 floor for the fitted size (default LYRIC_MIN_PX = 120). Only an instrumental/furniture use may lower it. */
  minSize?: number;
  /** Per-character motion/material hook. */
  charTransform?: (ch: string, idx: number, state: CharState) => CharXform | void;
  /** Optional per-character draw override (e.g. strokeText, outlines); default fills. */
  drawChar?: (c2d: CanvasRenderingContext2D, ch: string, state: CharState) => void;
}

export function drawLyric(c2d: CanvasRenderingContext2D, line: Line, t: number, opts: DrawLyricOpts): LineLayout | null {
  lyricDrawLog.set(currentPlate, (lyricDrawLog.get(currentPlate) ?? 0) + 1);
  const lead = opts.lead ?? 0.4;
  if (!lineVisible(line, t, lead)) return null;
  const family = opts.family ?? F.slam();
  const vertical = !!opts.vertical;
  const lay = layoutLine(c2d, line, family, Math.max(opts.size, opts.minSize ?? LYRIC_MIN_PX), opts.maxWidth, vertical);
  if (lay.size < (opts.minSize ?? LYRIC_MIN_PX) - 0.5) {
    // the fit shrank below the floor: re-measure at the floor (the line may overflow maxWidth; the gate reports it)
    const floor = layoutLine(c2d, line, family, opts.minSize ?? LYRIC_MIN_PX, undefined, vertical);
    Object.assign(lay, floor);
  }
  lyricSizeLog.set(currentPlate, Math.min(lyricSizeLog.get(currentPlate) ?? Infinity, lay.size));
  const align = opts.align ?? 'center';
  const sungC = opts.sungColor ?? 'bone', unsungC = opts.unsungColor ?? sungC;
  const unsungA = opts.unsungAlpha ?? 0.35, A = opts.alpha ?? 1;
  const ext = vertical ? 0 : lay.width;
  const ox = align === 'center' ? -ext / 2 : align === 'right' ? -ext : 0;
  const ws = line.words.map((w) => ({ st: syllableState(w, t), wp: wordState(w, t).progress, s: syls(w) }));
  c2d.save();
  c2d.translate(opts.x, opts.y);
  if (opts.rotation) c2d.rotate(opts.rotation);
  c2d.font = font(family, lay.size);
  c2d.textBaseline = 'alphabetic';
  c2d.textAlign = 'left';
  for (const b of lay.chars) {
    const w = ws[b.word]!;
    const sung = b.syl < w.st.sung;
    const [a0, a1] = w.s[b.syl]!;
    const frac = !sung ? 0 : Math.min(1, Math.max(0, (t - a0) / Math.max(1e-3, a1 - a0)));
    const state: CharState = { sung, frac, wordProgress: w.wp, word: b.word, syl: b.syl, box: b };
    const xf = opts.charTransform?.(b.ch, b.index, state) || {};
    const alpha = A * (sung ? 1 : unsungA) * (xf.alpha ?? 1);
    if (alpha <= 0.002) continue;
    c2d.save();
    // transform about the glyph's centre
    const cx = ox + b.x + b.w / 2, cy = b.y - lay.size * 0.35;
    c2d.translate(cx + (xf.dx ?? 0), cy + (xf.dy ?? 0));
    if (xf.rot) c2d.rotate(xf.rot);
    if (xf.scale !== undefined && xf.scale !== 1) c2d.scale(xf.scale, xf.scale);
    c2d.translate(-b.w / 2, lay.size * 0.35);
    c2d.globalAlpha *= alpha;
    c2d.fillStyle = rgba(sung ? sungC : unsungC);
    if (opts.drawChar) opts.drawChar(c2d, b.ch, state);
    else c2d.fillText(b.ch, 0, 0);
    c2d.restore();
  }
  c2d.restore();
  return lay;
}
