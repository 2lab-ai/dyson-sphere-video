// The edit: data/edit.json (written by analysis/editplan.py) -> timeline entries. One plate = one entry,
// hard cuts (no overlaps). Each entry loads `scenes/<module>.ts` and receives the whole plate as ctx.params
// (id, module, variant, lines, bars, light, event, start, end, anchor, accent?). A module that does not
// exist yet fails to load and the engine shows its window as a solid red placeholder.
// Animatic (?animatic=1, set by `scripts/render.ts --animatic`): every plate loads scenes/animatic.ts instead of its
// module — the v3 real-length proxy for review before the plate modules are built. Nothing else changes.
import type { TimelineEntry } from './engine/engine';
import type { SceneClass } from './engine/scene';
import type { Lyrics } from './engine/lyrics';
import type { AudioData } from './engine/audio';
import type { PlateInfo } from './engine/shots';
import edit from '@root/data/edit.json';
import { setSceneLoader } from './engine/world';

const modules = import.meta.glob<{ default: SceneClass }>(['./scenes/*.ts', '!./scenes/*.shots.ts', '!./scenes/_*.ts']);
const scene = (name: string) => () => {
  const m = modules[`./scenes/${name}.ts`];
  return m ? m() : Promise.reject(new Error(`scene module not found: scenes/${name}.ts`));
};
// v4 world hosts (engine/world.ts) load their subject module through the same glob.
setSceneLoader((name) => scene(name)());

export const PLATES: PlateInfo[] = (edit as unknown as { plates: PlateInfo[] }).plates;
const ANIMATIC = typeof location !== 'undefined' && new URLSearchParams(location.search).has('animatic');

export function makeTimeline(_ly: Lyrics, _au: AudioData): TimelineEntry[] {
  const E = (id: string, file: string, start: number, end: number, extra: Partial<TimelineEntry> = {}): TimelineEntry =>
    ({ id, load: scene(file), start, end, ...extra });
  return PLATES.map((p) => E(p.id, ANIMATIC ? 'animatic' : p.module, p.start, p.end, { params: { ...p } }));
}
