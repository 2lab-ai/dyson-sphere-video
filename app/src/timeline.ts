// The edit: which plate plays when, the lyric style per line, and the song-wide beat FX.
// Boundaries come from the analysed sections (data/audio.json) and lyric lines (data/lyrics.json).
import type { TimelineEntry } from './engine/engine';
import type { SceneClass } from './engine/scene';
import type { Line, Lyrics } from './engine/lyrics';
import type { AudioData } from './engine/audio';
import type { PostParams } from './engine/post';
import type { LyricStyle } from './engine/hud';

const modules = import.meta.glob<{ default: SceneClass }>('./scenes/*.ts');
const scene = (name: string) => () => {
  const m = modules[`./scenes/${name}.ts`];
  return m ? m() : Promise.reject(new Error(`scene module not found: scenes/${name}.ts`));
};

/** Section windows, filled in by makeTimeline (fx and lyricStyle read them). */
let SEC: Record<string, { start: number; end: number }> = {};
const inSec = (t: number, ...names: string[]) => names.some((n) => SEC[n] && t >= SEC[n]!.start && t < SEC[n]!.end);

export function makeTimeline(ly: Lyrics, au: AudioData): TimelineEntry[] {
  SEC = Object.fromEntries(au.sections.map((s) => [s.name, s]));
  const s = (n: string) => SEC[n]!.start;
  const bar = 4 * (60 / au.bpm);
  // cross-fade overlap: half a beat
  const X = 0.5 * (60 / au.bpm);
  const E = (id: string, file: string, start: number, end: number, extra: Partial<TimelineEntry> = {}): TimelineEntry =>
    ({ id, load: scene(file), start, end, ...extra });
  // verse 1 splits on the beat before its fifth line (where the neon/high-tech imagery begins)
  const v1b = au.timeOfBeat(Math.floor(au.beatAt(ly.lines[4]!.start + 0.02)));
  return [
    E('ignite', 'ignite', 0, v1b + X),
    E('grid', 'grid', v1b, s('pre1') + X),
    E('tunnel1', 'tunnel', s('pre1'), s('drop1') + X, { params: { u: [0, 0, 0, 0] } }),
    E('swarm', 'swarm', s('drop1'), s('bridge') + X),
    E('glitch', 'glitch', s('bridge'), s('verse2') + X),
    E('eye', 'eye', s('verse2'), s('pre2') + X),
    E('tunnel2', 'tunnel', s('pre2'), s('climax') + X, { params: { u: [1, 0, 0, 0] } }),
    E('shell', 'shell', s('climax'), s('drop2') + X),
    E('kaleido', 'kaleido', s('drop2'), s('outro') + X),
    E('afterglow', 'afterglow', s('outro'), au.duration + bar),
  ];
}

export function lyricStyle(l: Line): LyricStyle {
  const t = l.start + 0.05;
  if (inSec(t, 'pre1', 'pre2')) return 'stack';
  if (inSec(t, 'bridge', 'climax')) return 'slam';
  return 'karaoke';
}

/** Hot sections get the full dopamine treatment; verses get a lighter touch. */
export function fx(t: number, p: PostParams, au: AudioData): PostParams {
  const a = au.sample(t);
  const bb = au.backbeat(t);
  const hot = inSec(t, 'drop1', 'drop2', 'climax') ? 1 : inSec(t, 'pre1', 'pre2', 'bridge') ? 0.6 : inSec(t, 'outro') ? 0.35 : 0.3;
  const beat = au.beatAt(t), bar = au.barAt(t);
  const barPh = bar - Math.floor(bar);
  // zoom punch on the kick; the snare jolts the frame and splits the colours
  const zoom = p.zoom * (1 + 0.045 * hot * a.kick);
  const ang = beat * 2.399;
  const shake: [number, number] = [p.shake[0] + Math.cos(ang) * 14 * hot * bb, p.shake[1] + Math.sin(ang) * 14 * hot * bb];
  // white flash on each downbeat of the hot sections; every 4th bar ends on a one-beat invert
  const down = Math.pow(0.5, (barPh * 4 * 60) / au.bpm / 0.07);
  const flash = p.flash + (hot >= 1 ? 0.25 * down : 0);
  const inv = hot >= 1 && Math.floor(bar) % 4 === 3 && barPh > 0.75 ? 1 : 0;
  return {
    ...p, zoom, shake, flash,
    ca: p.ca + 6 * hot * bb + 2 * hot * a.kick,
    bloom: p.bloom * (1 + 0.6 * hot * a.kick),
    invert: Math.max(p.invert, inv),
  };
}
