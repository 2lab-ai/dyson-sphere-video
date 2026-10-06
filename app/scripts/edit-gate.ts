#!/usr/bin/env bun
// The edit gate (docs/EDIT-SPEC.md §Gate + docs/PLAN-V3.md "Trinity decisions"). Fail-closed: exit 1 unless every
// check passes.
//   bun scripts/edit-gate.ts                          self-test first (aborts if the gate is broken), then the real edit
//   bun scripts/edit-gate.ts --selftest               only the self-test
//   bun scripts/edit-gate.ts --tolerate-module-missing  exit 0 when C.module-missing is the ONLY failing check (the
//                                                     animatic render: modules/variants not built yet; nothing else)
//
// Every check is a pure function of one GateInput (plates, lyrics, audio, source texts, shot functions,
// the lyric timing helper), so the self-test can feed it in-memory fixtures. Each negative fixture names
// the check it must trip; a fixture "passes the self-test" only when THAT check fails. A positive control
// (the real cut list with compliant synthetic modules) must pass every check, or a gate that fails
// everything would look healthy.
//
// Layers:
//   T  timeline   coverage, 4-bar cap, plate count, lyric ownership, no cut inside a line, anchors,
//                 light plates, distinct modules, accent plates; v3 look: look fields + palette, ground vs palette
//                 luminance, idiom adjacency (sequence-exempt), idiom once (allow-list), family run / window (one
//                 literal demo exception), ground run, B/C/O budget, cream budget, sequences, match-circle pairs
//   C  code paths no global lyric HUD; modules/variants built; vocal modules call drawLyric; every module calls a
//                 beat pulse; no colour literals in scenes; scene imports; retired idioms; v3 retired modules;
//                 annotation helpers (titleBlock/crosshair/dimension); accent guard
//   S  shots      .shots.ts present; >= 60 structural transitions; max gap per section; determinism. Plates whose
//                 module/variant is not built yet are checked against the animatic's shot list (the stand-in that
//                 renders them until the module phase), built from the same storyboard contract.
//   L  lyric      no syllable counts as sung before its start
//
// Parser: rolldown/parseAst (oxc, ships with Vite). The spec asked for the TypeScript compiler API, but
// typescript@7 (the Go port, pinned by this repo) exposes no synchronous JS parser; oxc gives the same
// ESTree-level AST (comments and strings are not code).
//
// Colour-literal heuristic (scenes/*.ts, string and template text only):
//   - '#rgb' '#rgba' '#rrggbb' '#rrggbbaa' followed by a non-word char (so '#define' / '#ifdef' pass)
//   - css colour functions: rgb( rgba( hsl( hsla(
//   - numeric literals written 0xRRGGBB (exactly six hex digits)
//   - GLSL vec3(...)/vec4(...) whose first three args are numeric literals, all within [0, 1], not all
//     equal (greys and uniform sizes pass), with at least one non-integer value (axis/up vectors like
//     vec3(0.0, 1.0, 0.0) pass). Hash constants in scenes get flagged too: use GLSL_COMMON's hashes.
import { parseAst } from 'rolldown/parseAst';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { barLen, gapCap, sameState, stateAt, type AudioLite, type PlateInfo, type Shot, type ShotState } from '../src/engine/shots';
import { syllableState as realSyllableState } from '../src/engine/lyric';
import { HEX, PALETTES, groundClass, isCream, type NamedPalette } from '../src/engine/palette';

const APP = path.resolve(import.meta.dir, '..');
const ROOT = path.resolve(APP, '..');
const FRAME = 1 / 60;
const TOL = 1.5e-3; // edit.json rounds to ms
const RETIRED = ['grid', 'tunnel', 'glitch', 'kaleido'];
const LINES_EXPECTED = 32;

// ------------------------------------------------------------------ v3 literals (docs/PLAN-V3.md, Trinity decisions)
/** v3-retired modules: no plate may use them and no file may import them (the files stay on disk, untouched). */
const RETIRED_V3 = ['blueprint', 'screen', 'silhouette', 'chrome'];
/** Retired annotation-chrome helpers: any identifier in a used scene matching this fails. */
const ANNOTATION_RE = /titleBlock|crosshair|dimension/i;
/**
 * (module/variant) pairs that are BUILT for v3. Everything else in the edit is a new module or a new variant of an
 * old one: C.module-missing names it, and the S layer checks it against the animatic stand-in. The module phase
 * adds a pair here when its module agent lands it.
 */
const BUILT = new Set([
  'spark/write', 'spark/merge', 'spark/outro', 'sign/neon', 'lens/gaze', 'lens/ai', 'engrave/hand',
  'orbit/capture', 'orbit/swarm', 'void/descent', 'void/stones', 'popup/city', 'press/credits', 'press/riso', 'bigbang/bang', 'solar/sun', 'lightpaint/time', 'cosmicweb/web', 'impact/theia', 'moon/sumuk', 'crt/wall', 'jamo/ahn', 'xray/heart', 'flipdisc/choice', 'colorfield/freedom', 'blackmarble/future', 'sodium/sun', 'led/ticker', 'lidar/room', 'thermal/steam', 'ecg/xy', 'ecg/ridge', 'cave/fire', 'gauge/bass', 'wave/ocean', 'clay/tablet', 'dither/bomb', 'demo/boot', 'demo/internet', 'demo/ai', 'split/ascii', 'glass/rose', 'glass/thermal', 'shell/dancheong', 'shell/pullback', 'popup/life-sea', 'popup/life-land', 'engrave/iris', 'flipdisc/board', 'colorfield/dawn',
]);
/** Idioms allowed to repeat, with their max count. Everything else: at most once. */
const IDIOM_REPEAT: Record<string, number> = { 'pop-up': 3, demoscene: 3, 'light-trace': 3, aperture: 2, '3d-lit': 3 };
/** Idioms allowed only on named plates (M3 fluid: #5 ocean and #13 Big Bang). */
const IDIOM_PLATES: Record<string, string[]> = { 'fluid-cosmos': ['p13-bigbang-bang'] };
/** Banned idioms (the retired drawing / UI-chrome looks). */
const IDIOM_BANNED = ['blueprint', 'drawing', 'technical-drawing', 'screen-ui', 'dial-chrome', 'silhouette', 'liquid-chrome'];
/** Plate-ID-scoped sequences: the only places the same idiom may sit on adjacent plates. */
const SEQUENCES: Record<string, string[]> = {
  'popup-life': ['p18-popup-life-sea', 'p19-popup-life-land'],
  demo: ['p38-demo-boot', 'p39-demo-internet', 'p40-demo-ai'],
};
const SEQ_MAX_BARS = 8;
/**
 * The one family exception (PLAN-V3 #39–#46): the demo sequence makes an E-E-E run (#39–#41) and E×4 in the
 * 8-plate window #39–#46. Keyed by plate ids; nothing else is exempt.
 */
const DEMO_EXCEPTION = {
  run: ['p38-demo-boot', 'p39-demo-internet', 'p40-demo-ai'],
  window: ['p38-demo-boot', 'p39-demo-internet', 'p40-demo-ai', 'p41-orbit-swarm', 'p42-shell-dancheong', 'p43-shell-pullback', 'p44-press-credits', 'p45-spark-outro'],
  family: 'E', max: 4,
};
/** Gated match-circle cuts (#41→#42, #42→#43, #43→#44). Stub: declared, and adjacent. The snapshot check comes with the modules. */
const MATCH_REQUIRED: [string, string][] = [
  ['p40-demo-ai', 'p41-orbit-swarm'], ['p41-orbit-swarm', 'p42-shell-dancheong'], ['p42-shell-dancheong', 'p43-shell-pullback'],
];
const FAMILIES = ['E', 'S', 'H', 'M', 'P', 'A'];
const MAX_DARK_RUN = 4, MAX_BCO = 8, MAX_CREAM = 3, FAMILY_WINDOW = 8, FAMILY_WINDOW_MAX = 3;
/** v4 (PLAN-V4 §C7): declared dark envelopes by plate number — 7 non-light in a row allowed only inside one of these. */
const DARK_ENVELOPES: [string, string][] = [['p01', 'p07'], ['p13', 'p17'], ['p20', 'p26'], ['p38', 'p43']];
const MAX_DARK_RUN_ENVELOPE = 7;
/** v4: a run (same world across consecutive plates) holds at most this many plates. */
const RUN_MAX = 6;
const DIMS = ['W', 'G', 'C', 'L', 'S'] as const;

// ------------------------------------------------------------------ inputs
interface LyWord { w: string; start: number; end: number; syl?: [number, number][] }
interface LyLine { text: string; start: number; end: number; words: LyWord[] }
type ShotsFn = (p: PlateInfo, au: AudioLite) => Shot[];
type SylFn = (w: LyWord, t: number) => { sung: number; frac: number };

interface GateInput {
  plates: PlateInfo[];
  lines: LyLine[];
  audio: AudioLite;
  /** Source texts keyed by path relative to app/src (e.g. 'scenes/spark.ts', 'engine/engine.ts'). */
  sources: Map<string, string>;
  /** Pure shot functions per module (absent = no .shots.ts). */
  shotsFns: Map<string, ShotsFn>;
  syllableState: SylFn;
  /** 'module/variant' pairs that are built (the real run: BUILT; the positive control: every pair). */
  built: Set<string>;
  /** Shot list used for plates that are not built (the animatic's shots()); absent = those plates have no shots. */
  standIn?: ShotsFn;
  /** Storyboard shot times per plate id (data/storyboard.json). */
  sbTimes: Map<string, { t: number; anchor: string }[]>;
}

const pairOf = (p: PlateInfo) => `${p.module}/${p.variant}`;
/** v4: a hosted plate's subject pair (what the host composites); the host module itself has no variants. */
const subjectPairOf = (p: PlateInfo) => (p.subject ? `${p.subject.module}/${p.subject.variant}` : null);
const idiomOf = (p: PlateInfo) => p.look?.idiom ?? `module:${p.module}`;
const palOf = (p: PlateInfo): NamedPalette | undefined => (p.look ? (PALETTES as Record<string, NamedPalette>)[p.look.palette] : undefined);

interface Result { id: string; ok: boolean; detail: string }

// ------------------------------------------------------------------ AST helpers
type Node = { type: string; [k: string]: any };
const astCache = new Map<string, Node>();
function parse(file: string, src: string): Node {
  const key = `${file}\0${src}`;
  let a = astCache.get(key);
  if (!a) {
    a = parseAst(src, { lang: file.endsWith('.tsx') ? 'tsx' : 'ts' }, file) as unknown as Node;
    astCache.set(key, a);
  }
  return a;
}
function walk(n: any, fn: (n: Node) => void) {
  if (!n || typeof n !== 'object') return;
  if (Array.isArray(n)) { for (const x of n) walk(x, fn); return; }
  if (typeof n.type === 'string') fn(n);
  for (const k in n) if (k !== 'type' && n[k] && typeof n[k] === 'object') walk(n[k], fn);
}
/** All module specifiers a file imports or re-exports (static and dynamic). */
function importSpecs(ast: Node): string[] {
  const out: string[] = [];
  walk(ast, (n) => {
    if ((n.type === 'ImportDeclaration' || n.type === 'ExportNamedDeclaration' || n.type === 'ExportAllDeclaration') && n.source?.value) out.push(n.source.value);
    if (n.type === 'ImportExpression' && n.source?.type === 'Literal' && typeof n.source.value === 'string') out.push(n.source.value);
  });
  return out;
}
const stripTs = (s: string) => s.replace(/\.ts$/, '');
/** Does the file call `name` imported from `from` (named, aliased or via a namespace import)? */
function callsImported(ast: Node, from: string, names: string[]): boolean {
  const locals = new Set<string>(), ns = new Set<string>();
  walk(ast, (n) => {
    if (n.type !== 'ImportDeclaration' || stripTs(n.source?.value ?? '') !== from || n.importKind === 'type') return;
    for (const s of n.specifiers ?? []) {
      if (s.type === 'ImportSpecifier' && s.importKind !== 'type' && names.includes(s.imported?.name ?? s.imported?.value)) locals.add(s.local.name);
      if (s.type === 'ImportNamespaceSpecifier') ns.add(s.local.name);
    }
  });
  let hit = false;
  walk(ast, (n) => {
    if (n.type !== 'CallExpression') return;
    const c = n.callee;
    if (c?.type === 'Identifier' && locals.has(c.name)) hit = true;
    if (c?.type === 'MemberExpression' && c.object?.type === 'Identifier' && ns.has(c.object.name) && names.includes(c.property?.name)) hit = true;
  });
  return hit;
}
/** String contents of a file: string literals and template quasis (cooked). */
function stringTexts(ast: Node): string[] {
  const out: string[] = [];
  walk(ast, (n) => {
    if (n.type === 'Literal' && typeof n.value === 'string') out.push(n.value);
    if (n.type === 'TemplateElement') out.push(n.value?.cooked ?? n.value?.raw ?? '');
  });
  return out;
}

const HEX_RE = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![0-9A-Za-z_])/;
const CSS_RE = /\b(?:rgba?|hsla?)\s*\(/i;
const VEC_RE = /\bvec[34]\s*\(([^()]*)\)/g;
const NUM_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?f?$/i;
function colourLiterals(file: string, src: string): string[] {
  const ast = parse(file, src);
  const hits: string[] = [];
  for (const s of stringTexts(ast)) {
    const h = HEX_RE.exec(s); if (h) hits.push(`hex '${h[0]}'`);
    const c = CSS_RE.exec(s); if (c) hits.push(`css '${c[0]}'`);
    for (const m of s.matchAll(VEC_RE)) {
      const args = m[1]!.split(',').map((x) => x.trim());
      if (args.length < 3 || !args.slice(0, 3).every((a) => NUM_RE.test(a))) continue;
      const v = args.slice(0, 3).map((a) => parseFloat(a));
      const inUnit = v.every((x) => x >= 0 && x <= 1), allEq = v.every((x) => x === v[0]), frac = v.some((x) => !Number.isInteger(x));
      if (inUnit && !allEq && frac) hits.push(`glsl '${m[0]}'`);
    }
  }
  walk(ast, (n) => { if (n.type === 'Literal' && typeof n.value === 'number' && /^0x[0-9a-f]{6}$/i.test(n.raw ?? '')) hits.push(`hex number ${n.raw}`); });
  return hits;
}

// ------------------------------------------------------------------ checks
const pass = (id: string, detail = ''): Result => ({ id, ok: true, detail });
const fail = (id: string, detail: string): Result => ({ id, ok: false, detail });
const list = (xs: string[], n = 6) => xs.slice(0, n).join('; ') + (xs.length > n ? `; … (+${xs.length - n})` : '');
const f3 = (x: number) => x.toFixed(3);

function timelineChecks(I: GateInput): Result[] {
  const { plates: P, lines: L, audio: au } = I;
  const bar = barLen(au), cap = 4 * bar + FRAME;
  const R: Result[] = [];
  const beats = au.beats, downs = au.downbeats;
  const isOn = (xs: number[], t: number) => xs.some((x) => Math.abs(x - t) <= TOL);

  // coverage
  const cov: string[] = [];
  if (!P.length) cov.push('no plates');
  else {
    if (Math.abs(P[0]!.start) > FRAME) cov.push(`starts at ${f3(P[0]!.start)}`);
    if (Math.abs(P[P.length - 1]!.end - au.duration) > FRAME) cov.push(`ends at ${f3(P[P.length - 1]!.end)} != ${f3(au.duration)}`);
    for (let i = 1; i < P.length; i++) {
      const g = P[i]!.start - P[i - 1]!.end;
      if (Math.abs(g) > FRAME) cov.push(`${g > 0 ? 'gap' : 'overlap'} ${f3(Math.abs(g))}s at ${P[i]!.id}`);
    }
    for (const p of P) if (p.end - p.start <= 0) cov.push(`${p.id} empty`);
  }
  R.push(cov.length ? fail('T.coverage', list(cov)) : pass('T.coverage', `[0, ${f3(au.duration)}) exact`));

  const long = P.filter((p) => p.end - p.start > cap).map((p) => `${p.id} ${(p.end - p.start).toFixed(2)}s`);
  R.push(long.length ? fail('T.cap', `> 4 bars (${(4 * bar).toFixed(3)}s): ${list(long)}`) : pass('T.cap', `max ${Math.max(...P.map((p) => p.end - p.start)).toFixed(2)}s`));
  R.push(P.length >= 36 ? pass('T.count', `${P.length} plates`) : fail('T.count', `${P.length} plates < 36`));

  // lyric ownership
  const own: string[] = [];
  if (L.length !== LINES_EXPECTED) own.push(`lyrics has ${L.length} lines, expected ${LINES_EXPECTED}`);
  const owners = new Map<number, string[]>();
  for (const p of P) {
    if (!p.lines.length) continue;
    if (p.lines.length > 2) own.push(`${p.id} owns ${p.lines.length} lines`);
    for (const li of p.lines) {
      const l = L[li];
      if (!l) { own.push(`${p.id} owns missing line ${li}`); continue; }
      owners.set(li, [...(owners.get(li) ?? []), p.id]);
      if (l.start < p.start - TOL || l.end > p.end + TOL) own.push(`${p.id} [${f3(p.start)},${f3(p.end)}) does not hold line ${li} [${f3(l.start)},${f3(l.end)}]`);
    }
  }
  for (let i = 0; i < L.length; i++) {
    const o = owners.get(i) ?? [];
    if (o.length !== 1) own.push(`line ${i} owned by ${o.length ? o.join(',') : 'nobody'}`);
  }
  R.push(own.length ? fail('T.lines', list(own)) : pass('T.lines', `${L.length} lines, each owned once by a 1–2 line plate`));

  // no boundary strictly inside a line
  const cut: string[] = [];
  for (const p of P.slice(1)) for (let i = 0; i < L.length; i++) {
    const l = L[i]!;
    if (p.start > l.start + TOL && p.start < l.end - TOL) cut.push(`${p.id} starts at ${f3(p.start)} inside line ${i} (${f3(l.start)}–${f3(l.end)})`);
  }
  R.push(cut.length ? fail('T.no-cut-in-line', list(cut)) : pass('T.no-cut-in-line'));

  // anchors
  const anc: string[] = [];
  P.forEach((p, k) => {
    if (k === 0) return; // the first plate starts at 0 (coverage)
    if (p.lines.length) {
      const li = Math.min(...p.lines), l = L[li];
      if (!l) return;
      const tw = l.words[0]?.start ?? l.start;
      const before = beats.filter((b) => b <= tw + TOL);
      const b = before.length ? before[before.length - 1]! : tw;
      const inside = L.slice(0, li).some((q) => q.start + TOL < b && b < q.end - TOL);
      const want = inside ? tw : b;
      if (Math.abs(p.start - want) > TOL) anc.push(`${p.id} at ${f3(p.start)}, want ${inside ? 'first word' : 'beat'} ${f3(want)}`);
    } else {
      const prev = P[k - 1]!;
      if (prev.lines.length) {
        const lastEnd = Math.max(...prev.lines.map((i) => L[i]?.end ?? 0));
        const d = downs.find((x) => x >= lastEnd - TOL), b = beats.find((x) => x >= lastEnd - TOL);
        const want = d !== undefined && d - prev.start <= cap ? d : b;
        if (want === undefined || Math.abs(p.start - want) > TOL) anc.push(`${p.id} at ${f3(p.start)}, want ${want === d ? 'downbeat' : 'beat'} after lines ${f3(want ?? NaN)}`);
      } else if (!isOn(downs, p.start)) anc.push(`${p.id} at ${f3(p.start)} is not on a downbeat`);
    }
  });
  R.push(anc.length ? fail('T.anchor', list(anc)) : pass('T.anchor'));

  const light = P.filter((p) => p.light).length, needLight = Math.ceil(P.length / 4);
  R.push(light >= needLight ? pass('T.light', `${light} >= ${needLight}`) : fail('T.light', `${light} light plates < ceil(${P.length}/4) = ${needLight}`));
  const mods = new Set(P.map((p) => p.module));
  R.push(mods.size >= 8 ? pass('T.distinct', `${mods.size} modules, ${new Set(P.map(idiomOf)).size} idioms`) : fail('T.distinct', `${mods.size} distinct modules < 8`));
  const acc = P.filter((p) => p.accent).map((p) => p.id);
  R.push(acc.length <= 2 ? pass('T.accent', acc.join(', ') || 'none') : fail('T.accent', `${acc.length} accent plates > 2: ${list(acc)}`));
  R.push(...lookChecks(I));
  return R;
}

/** A plate's declared sequence, if it is a valid plate-ID-scoped one. */
const seqOf = (p: PlateInfo) => (p.sequence && SEQUENCES[p.sequence]?.includes(p.id) ? p.sequence : null);

function lookChecks(I: GateInput): Result[] {
  const { plates: P, audio: au } = I;
  const bar = barLen(au);
  const R: Result[] = [];

  // look fields present and valid
  const lk: string[] = [];
  for (const p of P) {
    const l = p.look;
    if (!l) { lk.push(`${p.id}: no look`); continue; }
    if (!l.idiom) lk.push(`${p.id}: no idiom`);
    if (!FAMILIES.includes(l.family)) lk.push(`${p.id}: family '${l.family}'`);
    if (!palOf(p)) lk.push(`${p.id}: unknown palette '${l.palette}'`);
    if (!['dark', 'mid', 'light'].includes(l.ground)) lk.push(`${p.id}: ground '${l.ground}'`);
    if (typeof l.bco !== 'boolean') lk.push(`${p.id}: bco not boolean`);
    if (p.light !== (l.ground === 'light')) lk.push(`${p.id}: light=${p.light} but ground '${l.ground}'`);
  }
  R.push(lk.length ? fail('T.look', list(lk)) : pass('T.look', `${P.length} plates: idiom, family, palette, ground, bco`));

  // declared ground vs the palette's ground luminance (a plate cannot declare itself light on a dark palette)
  const gm: string[] = [];
  for (const p of P) { const pal = palOf(p); if (pal && p.look && groundClass(pal.ground) !== p.look.ground) gm.push(`${p.id}: declared ${p.look.ground}, palette '${p.look.palette}' ground ${pal.ground} is ${groundClass(pal.ground)}`); }
  R.push(gm.length ? fail('T.ground-match', list(gm)) : pass('T.ground-match', 'declared grounds match palette luminance'));

  // ---------------------------------------------------------------- v4 typing (docs/PLAN-V4.md §C7; same rules as app/scripts/plan-table.ts)
  // nov: R (first) | 1 | 2. A 2 changes exactly one of the five dims vs the previous plate (or vs `ref`) and names it in
  // `chg`; a 1 changes >= 4 and names a `residue`; runs are contiguous and <= RUN_MAX plates.
  const nv: string[] = [];
  const dimsOf = (p: PlateInfo) => p.dims;
  const byId = new Map(P.map((p) => [p.id, p]));
  const runsSeen = new Map<string, number[]>();
  const novString: string[] = [];
  P.forEach((p, i) => {
    const d = dimsOf(p);
    if (!p.nov || !d) { nv.push(`${p.id}: no nov/dims`); return; }
    novString.push(p.nov);
    if (i === 0) { if (p.nov !== 'R') nv.push(`${p.id}: first plate must be R`); return; }
    if (p.nov === 'R') { nv.push(`${p.id}: R only on the first plate`); return; }
    const base = p.ref ? byId.get(p.ref) : P[i - 1];
    if (!base) { nv.push(`${p.id}: ref ${p.ref} not in the edit`); return; }
    const bd = dimsOf(base)!;
    const ch = DIMS.filter((k) => d[k] !== bd[k]);
    if (p.nov === '2') {
      if (ch.length !== 1) nv.push(`${p.id}: nov 2 but ${ch.length} dims change (${ch.join('+') || 'none'})`);
      if ((p.chg ?? '').replace(/\s*\(.*\)$/, '') !== ch.join('+')) nv.push(`${p.id}: chg '${p.chg}' != ${ch.join('+') || 'none'}`);
      if (!p.run && !p.ref) nv.push(`${p.id}: nov 2 needs run or ref`);
    } else if (p.nov === '1') {
      if (ch.length < 4) nv.push(`${p.id}: nov 1 but only ${ch.length} dims change (${ch.join('+')})`);
      if (!p.residue) nv.push(`${p.id}: nov 1 without residue`);
      if (p.run) nv.push(`${p.id}: a 1 cannot be inside a run`);
    } else nv.push(`${p.id}: nov '${p.nov}'`);
    if (p.run) runsSeen.set(p.run, [...(runsSeen.get(p.run) ?? []), i]);
  });
  for (const [r, idx] of runsSeen) {
    if (idx.length > RUN_MAX) nv.push(`run ${r}: ${idx.length} plates > ${RUN_MAX}`);
    if (idx.some((v, k) => k && v !== idx[k - 1]! + 1)) nv.push(`run ${r}: not contiguous`);
  }
  const ones = P.filter((p) => p.nov === '1').length;
  R.push(nv.length ? fail('T.nov', list(nv)) : pass('T.nov', `string ${novString.join('')} — ${ones} ones / ${P.length - 1} cuts, ${runsSeen.size} runs`));

  // adjacency on the canonical idiom: allowed inside one declared run or sequence, or on a ref callback; banned elsewhere
  // effective run: the declared run, else the declared sequence; a 1/R plate immediately before a run is that run's
  // head (it opened the world the run continues in)
  const effRun = (i: number): string | null => {
    const p = P[i]!;
    if (p.run) return p.run;
    const nx = P[i + 1];
    if ((p.nov === '1' || p.nov === 'R') && nx?.run) return nx.run;
    return seqOf(p);
  };
  const runOf = (p: PlateInfo) => effRun(P.indexOf(p));
  const adj: string[] = [];
  for (let i = 1; i < P.length; i++) {
    const a = P[i - 1]!, b = P[i]!;
    if (idiomOf(a) !== idiomOf(b)) continue;
    if (runOf(a) && runOf(a) === runOf(b)) continue;
    if (b.ref) continue;
    adj.push(`${a.id}→${b.id} (${idiomOf(b)})`);
  }
  R.push(adj.length ? fail('T.adjacent', `same idiom as the previous plate outside a run/sequence: ${list(adj)}`) : pass('T.adjacent', 'adjacent idiom repeats only inside declared runs/sequences'));

  // each idiom once outside runs, except the explicit allow-list; inside a run an idiom may repeat (the run IS the repeat)
  const cnt = new Map<string, string[]>();
  for (const p of P) if (p.look && !p.run) cnt.set(p.look.idiom, [...(cnt.get(p.look.idiom) ?? []), p.id]);
  const once: string[] = [];
  for (const [id, ps] of cnt) {
    if (IDIOM_BANNED.includes(id)) once.push(`${id} is banned (${ps.join(',')})`);
    else if (IDIOM_PLATES[id]) { const bad = ps.filter((x) => !IDIOM_PLATES[id]!.includes(x)); if (bad.length) once.push(`${id} only on ${IDIOM_PLATES[id]!.join(',')}: ${bad.join(',')}`); }
    else if (ps.length > (IDIOM_REPEAT[id] ?? 1)) once.push(`${id} ×${ps.length} > ${IDIOM_REPEAT[id] ?? 1}`);
  }
  for (const p of P) if (p.look && IDIOM_BANNED.includes(p.look.idiom)) once.push(`${p.look.idiom} is banned (${p.id})`);
  R.push(once.length ? fail('T.idiom-once', list(once)) : pass('T.idiom-once', `${cnt.size} idioms outside runs; repeats only ${Object.keys(IDIOM_REPEAT).join('/')} + fluid-cosmos on #13`));

  // family: outside runs no 3 in a row and <= 3 per family in any 8-plate window; plates of one declared run count once
  const fam = (p: PlateInfo) => p.look?.family;
  const run: string[] = [];
  const units: { ids: string[]; f: string | undefined; r: string | null }[] = [];
  P.forEach((p, i) => {
    const r = effRun(i), last = units[units.length - 1];
    if (last && r && last.r === r) last.ids.push(p.id); else units.push({ ids: [p.id], f: fam(p), r });
  });
  for (let i = 2; i < units.length; i++) {
    const tri = [units[i - 2]!, units[i - 1]!, units[i]!];
    const f = tri[0]!.f;
    if (!f || !tri.every((u) => u.f === f)) continue;
    const ids = tri.flatMap((u) => u.ids);
    const exempt = f === DEMO_EXCEPTION.family && ids.every((id) => DEMO_EXCEPTION.run.includes(id));
    if (!exempt) run.push(`${ids.join(',')} (${f})`);
  }
  R.push(run.length ? fail('T.family-run', `3 plates of one family in a row outside a run: ${list(run)}`) : pass('T.family-run', 'no family 3 in a row outside declared runs'));
  const win: string[] = [];
  for (let i = 0; i + FAMILY_WINDOW <= P.length; i++) {
    const w = P.slice(i, i + FAMILY_WINDOW);
    const c = new Map<string, number>();
    const seenRun = new Set<string>();
    for (const p of w) {
      const f = fam(p); if (!f) continue;
      const r = runOf(p);
      if (r) { if (seenRun.has(r + f)) continue; seenRun.add(r + f); }
      c.set(f, (c.get(f) ?? 0) + 1);
    }
    const isDemoWin = w.map((p) => p.id).join() === DEMO_EXCEPTION.window.join();
    for (const [f, n] of c) {
      const cap = isDemoWin && f === DEMO_EXCEPTION.family ? DEMO_EXCEPTION.max : FAMILY_WINDOW_MAX;
      if (n > cap) win.push(`${w[0]!.id}..${w[w.length - 1]!.id}: ${f}×${n} > ${cap}`);
    }
  }
  R.push(win.length ? fail('T.family-window', list(win)) : pass('T.family-window', `<= ${FAMILY_WINDOW_MAX} per family in every ${FAMILY_WINDOW}-plate window (a run counts once)`));

  // ground: non-light at most 4 in a row, 7 inside a declared dark envelope (plate-number ranges, not run membership)
  const pn = (p: PlateInfo) => p.id.slice(0, 3);
  const inEnv = (p: PlateInfo) => DARK_ENVELOPES.some(([a, b]) => pn(p) >= a && pn(p) <= b);
  const gr: string[] = [];
  let k0 = 0;
  for (let i = 0; i <= P.length; i++) {
    const light = i < P.length && P[i]!.look?.ground === 'light';
    if (light || i === P.length) {
      const seg = P.slice(k0, i);
      const cap = seg.length && seg.every(inEnv) ? MAX_DARK_RUN_ENVELOPE : MAX_DARK_RUN;
      if (seg.length > cap) gr.push(`${P[k0]!.id}..${P[i - 1]!.id}: ${seg.length} non-light plates > ${cap}`);
      k0 = i + 1;
    }
  }
  R.push(gr.length ? fail('T.ground-run', `non-light run too long: ${list(gr)}`) : pass('T.ground-run', `non-light runs <= ${MAX_DARK_RUN} (<= ${MAX_DARK_RUN_ENVELOPE} inside ${DARK_ENVELOPES.map(([a, b]) => a + '–' + b).join(', ')})`));

  // B/C/O budget (and the flag must match the palette)
  const bco = P.filter((p) => p.look?.bco).map((p) => p.id);
  // a palette is B/C/O when every role is a legacy v2 token (ink / bone / graphite / paper2 / signal …)
  const legacy = new Set<string>(Object.values(HEX));
  const isBco = (p: PlateInfo) => { const pal = palOf(p); return !!pal && Object.values(pal).every((h) => legacy.has(h)); };
  const bcoBad = P.filter((p) => p.look && palOf(p) && p.look.bco !== isBco(p)).map((p) => `${p.id} bco=${p.look!.bco} but palette '${p.look!.palette}' is ${isBco(p) ? '' : 'not '}B/C/O`);
  R.push(bco.length > MAX_BCO || bcoBad.length ? fail('T.bco', [bco.length > MAX_BCO ? `${bco.length} B/C/O plates > ${MAX_BCO}: ${list(bco)}` : '', list(bcoBad)].filter(Boolean).join('; ')) : pass('T.bco', `${bco.length} B/C/O plates <= ${MAX_BCO}`));

  // cream grounds (computed from the palette's ground hex, engine/palette.ts isCream)
  const cream = P.filter((p) => { const pal = palOf(p); return pal ? isCream(pal.ground) : false; }).map((p) => p.id);
  R.push(cream.length > MAX_CREAM ? fail('T.cream', `${cream.length} cream grounds > ${MAX_CREAM}: ${list(cream)}`) : pass('T.cream', `${cream.length} cream grounds (${cream.join(', ') || 'none'})`));

  // sequences: plate-ID scoped, contiguous, <= 8 bars, a storyboard shot at every bar boundary
  const sq: string[] = [];
  for (const p of P) if (p.sequence && !seqOf(p)) sq.push(`${p.id} declares sequence '${p.sequence}' outside the allowed ids`);
  for (const [name, ids] of Object.entries(SEQUENCES)) {
    const idx = P.map((p, i) => (p.sequence === name ? i : -1)).filter((i) => i >= 0);
    if (!idx.length) continue; // not in this edit (fixtures)
    if (idx.some((v, j) => j && v !== idx[j - 1]! + 1)) sq.push(`${name}: plates not contiguous`);
    const ps = idx.map((i) => P[i]!);
    if (ps.map((p) => p.id).join() !== ids.join()) sq.push(`${name}: plates ${ps.map((p) => p.id).join(',')} != ${ids.join(',')}`);
    const bars = (ps[ps.length - 1]!.end - ps[0]!.start) / bar;
    if (bars > SEQ_MAX_BARS + FRAME / bar) sq.push(`${name}: ${bars.toFixed(2)} bars > ${SEQ_MAX_BARS}`);
    for (const p of ps) {
      const sb = I.sbTimes.get(p.id) ?? [];
      for (const d of au.downbeats) if (d >= p.start - TOL && d < p.end - TOL && !sb.some((x) => Math.abs(x.t - d) <= FRAME)) sq.push(`${p.id}: no storyboard shot at bar ${f3(d)}`);
    }
  }
  R.push(sq.length ? fail('T.sequence', list(sq)) : pass('T.sequence', Object.entries(SEQUENCES).map(([n, ids]) => `${n} ${ids.length} plates`).join(', ') + `, each <= ${SEQ_MAX_BARS} bars, a shot per bar`));

  // match-circle: the three gated pairs are declared and adjacent (snapshot check comes with the modules)
  const mc: string[] = [];
  P.forEach((p, i) => { if (p.match_circle_next && i + 1 >= P.length) mc.push(`${p.id} declares a match cut but is the last plate`); });
  for (const [a, b] of MATCH_REQUIRED) {
    const i = P.findIndex((p) => p.id === a);
    if (!P.some((p) => p.id === a || p.id === b)) continue; // not in this edit (fixtures)
    if (i < 0 || P[i + 1]?.id !== b) mc.push(`${a}→${b} not adjacent`);
    else if (!P[i]!.match_circle_next) mc.push(`${a}→${b} not declared (match_circle_next)`);
  }
  R.push(mc.length ? fail('T.match-circle', list(mc)) : pass('T.match-circle', `${MATCH_REQUIRED.length} gated pairs declared and adjacent (snapshot check: module phase)`));
  return R;
}

function codeChecks(I: GateInput): Result[] {
  const R: Result[] = [];
  const S = I.sources;
  const src = (f: string) => S.get(f);

  // no global lyric HUD / lyric style / global fx
  const hud: string[] = [];
  if (S.has('engine/hud.ts')) hud.push('engine/hud.ts exists');
  for (const f of ['engine/engine.ts', 'main.ts', 'timeline.ts', 'engine/post.ts']) {
    const s = src(f);
    if (s === undefined) { hud.push(`${f} missing`); continue; }
    const ast = parse(f, s);
    for (const spec of importSpecs(ast)) if (/(^|\/)hud(\.ts)?$/.test(spec)) hud.push(`${f} imports ${spec}`);
    const ids = new Set<string>();
    walk(ast, (n) => { if ((n.type === 'Identifier' || n.type === 'JSXIdentifier') && /^(lyricStyle|Hud|fx|lyricGain)$/.test(n.name)) ids.add(n.name); });
    for (const id of ids) hud.push(`${f} uses identifier ${id}`);
  }
  R.push(hud.length ? fail('C.no-hud', list(hud)) : pass('C.no-hud', 'no HUD / lyricStyle / fx in engine, post, main, timeline'));

  const used = [...new Set(I.plates.flatMap((p) => [p.module, ...(p.subject ? [p.subject.module] : [])]))];
  // the animatic (one generic module that stands in for every plate under --animatic) obeys the same code rules
  const ANIM = S.has('scenes/animatic.ts') ? ['animatic'] : [];
  // a hosted plate's lyric is drawn by its SUBJECT module (the host composites it), so the subject is the vocal module
  const vocalMods = new Set([...I.plates.filter((p) => p.lines.length).map((p) => p.subject?.module ?? p.module), ...ANIM]);
  const missing = used.filter((m) => !S.has(`scenes/${m}.ts`));
  // built pairs: a host plate is built when the host module exists (hosts have no variants) AND its subject pair is built
  const unbuilt = [...new Set(I.plates.flatMap((p) => {
    const sp = subjectPairOf(p);
    if (sp) return S.has(`scenes/${p.subject!.module}.ts`) && !I.built.has(sp) ? [sp] : [];
    return S.has(`scenes/${p.module}.ts`) && !I.built.has(pairOf(p)) ? [pairOf(p)] : [];
  }))];
  R.push(missing.length || unbuilt.length
    ? fail('C.module-missing', [missing.length ? `no scenes/<m>.ts for: ${missing.join(', ')}` : '', unbuilt.length ? `variant not built: ${unbuilt.join(', ')}` : ''].filter(Boolean).join(' | '))
    : pass('C.module-missing', `${used.length} modules present, every module/variant built`));

  const noLyric = [...vocalMods].filter((m) => S.has(`scenes/${m}.ts`) && !callsImported(parse(`scenes/${m}.ts`, src(`scenes/${m}.ts`)!), '../engine/lyric', ['drawLyric']));
  R.push(noLyric.length ? fail('C.lyric-call', `vocal modules without a drawLyric(...) call: ${noLyric.join(', ')}`) : pass('C.lyric-call', `${[...vocalMods].filter((m) => S.has(`scenes/${m}.ts`)).length} present vocal modules call drawLyric`));

  const beatMods = [...used, ...ANIM];
  const noBeat = beatMods.filter((m) => S.has(`scenes/${m}.ts`) && !callsImported(parse(`scenes/${m}.ts`, src(`scenes/${m}.ts`)!), '../engine/beat', ['beatPulse', 'kickPulse', 'downbeatPulse']));
  R.push(noBeat.length ? fail('C.beat-call', `modules without a beatPulse/kickPulse/downbeatPulse call: ${noBeat.join(', ')}`) : pass('C.beat-call', `${beatMods.filter((m) => S.has(`scenes/${m}.ts`)).length} present modules drive the beat`));

  const sceneFiles = [...S.keys()].filter((f) => /^scenes\/[^/]+\.ts$/.test(f));
  const col: string[] = [];
  for (const f of sceneFiles) for (const h of colourLiterals(f, src(f)!)) col.push(`${f}: ${h}`);
  R.push(col.length ? fail('C.colour', list(col)) : pass('C.colour', `${sceneFiles.length} scene files, palette tokens only`));

  const imp: string[] = [];
  for (const f of sceneFiles) {
    const base = path.basename(f, '.ts'), isShots = base.endsWith('.shots'), mod = base.replace(/\.shots$/, '');
    for (const spec0 of importSpecs(parse(f, src(f)!))) {
      const spec = stripTs(spec0);
      if (isShots) {
        if (spec !== '../engine/shots' && spec !== '../engine/beat' && spec !== '../engine/storyboard') imp.push(`${f} imports ${spec0} (a .shots.ts may import only ../engine/shots, ../engine/beat, ../engine/storyboard)`);
        continue;
      }
      if (!spec.startsWith('.') && !spec.startsWith('/')) continue; // packages
      if (spec === './_shader' || spec === `./${mod}.shots` || spec.startsWith('../engine/')) continue;
      imp.push(`${f} imports ${spec0}`);
    }
  }
  R.push(imp.length ? fail('C.imports', list(imp)) : pass('C.imports', 'scenes import only ../engine/**, ./_shader, their own .shots'));

  const ret: string[] = [];
  for (const r of RETIRED) if (S.has(`scenes/${r}.ts`)) ret.push(`scenes/${r}.ts exists`);
  for (const [f, s] of S) for (const spec of importSpecs(parse(f, s))) {
    const b = stripTs(path.basename(spec));
    if (RETIRED.includes(b)) ret.push(`${f} imports ${spec}`);
  }
  R.push(ret.length ? fail('C.retired', list(ret)) : pass('C.retired', `${RETIRED.join('/')} absent`));

  // v3-retired modules: referenced by no plate and imported by no file (the files themselves may stay on disk)
  const r3: string[] = [];
  for (const p of I.plates) if (RETIRED_V3.includes(p.module)) r3.push(`${p.id} uses retired module ${p.module}`);
  for (const [f, s] of S) {
    if (RETIRED_V3.some((r) => f === `scenes/${r}.ts` || f === `scenes/${r}.shots.ts`)) continue;
    for (const spec of importSpecs(parse(f, s))) if (RETIRED_V3.includes(stripTs(path.basename(spec)).replace(/\.shots$/, ''))) r3.push(`${f} imports ${spec}`);
  }
  R.push(r3.length ? fail('C.retired-v3', list(r3)) : pass('C.retired-v3', `${RETIRED_V3.join('/')} referenced by no plate and no import`));

  // retired annotation chrome: no titleBlock / crosshair / dimension identifiers in any scene the edit renders
  const ann: string[] = [];
  for (const m of [...used, ...ANIM]) for (const f of [`scenes/${m}.ts`, `scenes/${m}.shots.ts`]) {
    const s = src(f);
    if (s === undefined) continue;
    const ids = new Set<string>();
    walk(parse(f, s), (n) => { if (n.type === 'Identifier' && ANNOTATION_RE.test(n.name)) ids.add(n.name); });
    for (const id of ids) ann.push(`${f}: ${id}`);
  }
  R.push(ann.length ? fail('C.annotation', `annotation helpers in rendered scenes: ${list(ann)}`) : pass('C.annotation', 'no titleBlock/crosshair/dimension identifiers in rendered scenes'));

  // accent: a scene that references the accent token must guard it with params.accent (grep)
  const accUse: string[] = [];
  for (const f of sceneFiles) {
    const s = src(f)!.replace(/params\s*(\?\.|\.)\s*accent\b/g, '');
    if (/\bC_ACCENT\b|['"`]accent['"`]|\.accent\b/.test(s) && !/params\s*(\?\.|\.)\s*accent\b/.test(src(f)!)) accUse.push(f);
  }
  R.push(accUse.length ? fail('C.accent-guard', `accent used without a params.accent guard: ${accUse.join(', ')}`) : pass('C.accent-guard'));
  return R;
}

function shotChecks(I: GateInput): Result[] {
  const R: Result[] = [];
  const au = I.audio, bar = barLen(au);
  // built plates use their module's shot list; the others the stand-in (the animatic), which must exist
  // v4: a hosted plate's shots come from its subject module (the host composites the subject's shots)
  const shotModOf = (p: PlateInfo) => p.subject?.module ?? p.module;
  const isBuilt = (p: PlateInfo) => I.built.has(subjectPairOf(p) ?? pairOf(p));
  const fnFor = (p: PlateInfo): ShotsFn | undefined => (isBuilt(p) ? I.shotsFns.get(shotModOf(p)) : I.standIn);
  const used = [...new Set(I.plates.filter(isBuilt).map(shotModOf))];
  const missing = used.filter((m) => !I.shotsFns.has(m));
  const nStand = I.plates.filter((p) => !isBuilt(p)).length;
  if (nStand && !I.standIn) missing.push(`(stand-in for ${nStand} unbuilt plates: scenes/animatic.shots.ts)`);
  R.push(missing.length ? fail('S.shots-missing', `no scenes/<m>.shots.ts for: ${missing.join(', ')}`) : pass('S.shots-missing', `${used.length} shot lists` + (nStand ? `; ${nStand} unbuilt plates on the animatic stand-in` : '')));

  // events: every plate start + every real state change inside a plate
  const events: number[] = [];
  const errs: string[] = [];
  const lists = new Map<string, Shot[]>();
  for (const p of I.plates) {
    events.push(p.start);
    const fn = fnFor(p);
    if (!fn) continue;
    let sh: Shot[];
    try { sh = fn(p, au); } catch (e) { errs.push(`${p.id}: ${(e as Error).message}`); continue; }
    if (!Array.isArray(sh) || !sh.length) { errs.push(`${p.id}: empty shot list`); continue; }
    lists.set(p.id, sh);
    const inside = [...sh].filter((s) => s.t > p.start + FRAME / 2 && s.t < p.end - FRAME / 2).sort((a, b) => a.t - b.t);
    let prev: ShotState = stateAt(sh, p.start);
    for (const s of inside) {
      const cur = stateAt(sh, s.t);
      if (!sameState(prev, cur)) events.push(s.t);
      prev = cur;
    }
  }
  if (errs.length) R.push(fail('S.errors', list(errs)));

  // every approved storyboard shot (data/storyboard.json) must be a real state change (or the plate start) in the module's list
  const sbMiss: string[] = [];
  for (const p of I.plates) {
    const sh = lists.get(p.id), sbs = I.sbTimes.get(p.id);
    if (!sbs) { sbMiss.push(`${p.id}: not in storyboard`); continue; }
    if (!sh) continue;
    for (const x of sbs) {
      if (Math.abs(x.t - p.start) <= FRAME) continue;
      const before = stateAt(sh, x.t - FRAME), at = stateAt(sh, x.t + FRAME / 4);
      if (sameState(before, at)) sbMiss.push(`${p.id}: no state change at storyboard shot ${x.t} (${x.anchor})`);
    }
  }
  if (I.shotsFns.size || I.standIn) R.push(sbMiss.length ? fail('S.storyboard', list(sbMiss)) : pass('S.storyboard', 'every storyboard shot is a real state change'));
  events.sort((a, b) => a - b);
  const ev: number[] = [];
  for (const t of events) if (!ev.length || t - ev[ev.length - 1]! > FRAME) ev.push(t);
  R.push(ev.length >= 60 ? pass('S.count', `${ev.length} transitions`) : fail('S.count', `${ev.length} transitions < 60`));

  const gaps: string[] = [];
  const pts = [...ev, au.duration];
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]!, b = pts[i + 1]!, c = gapCap(au, a, b);
    if (b - a > c + FRAME) {
      const secs = au.sections.filter((s) => s.end > a && s.start < b).map((s) => s.name).join('+');
      gaps.push(`${f3(a)}→${f3(b)} ${((b - a) / bar).toFixed(2)} bars > ${(c / bar).toFixed(0)} (${secs})`);
    }
  }
  R.push(gaps.length ? fail('S.gap', `${gaps.length} gaps over cap: ${list(gaps, 4)}`) : pass('S.gap', 'every gap within its section cap'));

  // determinism: the list and stateAt are pure
  const det: string[] = [];
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (const p of I.plates) {
    const fn = fnFor(p), a = lists.get(p.id);
    if (!fn || !a) continue;
    const b = fn(p, au);
    if (JSON.stringify(a) !== JSON.stringify(b)) { det.push(`${p.id}: shots() differs between calls`); continue; }
    const ts = Array.from({ length: 24 }, () => p.start + rnd() * (p.end - p.start));
    const one = ts.map((t) => JSON.stringify(stateAt(a, t)));
    const order = ts.map((_, i) => i).sort(() => rnd() - 0.5);
    for (const i of order) if (JSON.stringify(stateAt(b, ts[i]!)) !== one[i]) { det.push(`${p.id}: stateAt differs at ${f3(ts[i]!)}`); break; }
  }
  R.push(det.length ? fail('S.deterministic', list(det)) : pass('S.deterministic', `${lists.size} plates`));
  return R;
}

function lyricChecks(I: GateInput): Result[] {
  const early: string[] = [];
  let n = 0;
  for (const [li, l] of I.lines.entries()) for (const w of l.words) {
    const syl = w.syl?.length ? w.syl : [[w.start, w.end] as [number, number]];
    syl.forEach(([a], k) => {
      n++;
      const before = I.syllableState(w, a - 0.01).sung, at = I.syllableState(w, a).sung;
      if (before > k) early.push(`line ${li} '${w.w}' syllable ${k} sung at ${f3(a - 0.01)} (starts ${f3(a)})`);
      if (at < k + 1) early.push(`line ${li} '${w.w}' syllable ${k} not sung at its start ${f3(a)}`);
    });
  }
  return [early.length ? fail('L.no-early', list(early)) : pass('L.no-early', `${n} syllables: sung exactly from their start`)];
}

export function runGate(I: GateInput): Result[] {
  return [...timelineChecks(I), ...codeChecks(I), ...shotChecks(I), ...lyricChecks(I)];
}

// ------------------------------------------------------------------ real inputs
function readSources(): Map<string, string> {
  const m = new Map<string, string>();
  const dir = path.join(APP, 'src');
  const rec = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) rec(p);
      else if (e.name.endsWith('.ts')) m.set(path.relative(dir, p).split(path.sep).join('/'), readFileSync(p, 'utf8'));
    }
  };
  rec(dir);
  for (const f of readdirSync(path.join(APP, 'scripts'))) if (f.endsWith('.ts')) m.set(`../scripts/${f}`, readFileSync(path.join(APP, 'scripts', f), 'utf8'));
  return m;
}

function loadJSON<T>(rel: string): T { return JSON.parse(readFileSync(path.join(ROOT, rel), 'utf8')) as T; }

async function realInput(): Promise<GateInput> {
  const edit = loadJSON<{ plates: PlateInfo[] }>('data/edit.json');
  const ly = loadJSON<{ lines: LyLine[] }>('data/lyrics.json');
  const a = loadJSON<AudioLite>('data/audio.json');
  const audio: AudioLite = { bpm: a.bpm, beats: a.beats, downbeats: a.downbeats, sections: a.sections, duration: a.duration };
  const shotsFns = new Map<string, ShotsFn>();
  for (const m of new Set([...edit.plates.flatMap((p) => [p.module, ...(p.subject ? [p.subject.module] : [])]), 'animatic'])) {
    const f = path.join(APP, 'src/scenes', `${m}.shots.ts`);
    if (!existsSync(f)) continue;
    // a broken shot list must not hide everyone else's status: it becomes a throwing fn (-> S.errors)
    try {
      const mod = await import(pathToFileURL(f).href);
      shotsFns.set(m, typeof mod.shots === 'function' ? mod.shots : () => { throw new Error(`scenes/${m}.shots.ts exports no shots()`); });
    } catch (e) {
      const msg = String((e as Error)?.message ?? e);
      shotsFns.set(m, () => { throw new Error(`scenes/${m}.shots.ts failed to import: ${msg}`); });
    }
  }
  const standIn = shotsFns.get('animatic');
  shotsFns.delete('animatic');
  return { plates: edit.plates, lines: ly.lines, audio, sources: readSources(), shotsFns, syllableState: realSyllableState, built: BUILT, standIn, sbTimes: loadSbTimes() };
}

function loadSbTimes(): Map<string, { t: number; anchor: string }[]> {
  return new Map((JSON.parse(readFileSync(path.join(ROOT, 'data/storyboard.json'), 'utf8')).plates as any[]).map((p) => [p.id, p.shots]));
}

// ------------------------------------------------------------------ self-test
const goodModule = (m: string) => `// synthetic compliant module ${m}
import { Scene } from '../engine/scene';
import { drawLyric, ownedLines } from '../engine/lyric';
import { beatPulse } from '../engine/beat';
import { stateAt } from '../engine/shots';
import { shots } from './${m}.shots';
export default class M extends Scene {
  render(f) { const k = beatPulse(this.ctx.audio, f.t); for (const l of ownedLines(this.ctx)) drawLyric(this.c, l, f.t, { x: 0, y: 0, size: 100 * (1 + k) }); return stateAt(shots(this.ctx.params, this.ctx.audio), f.t); }
}
`;
const SB_TIMES = new Map<string, number[]>([...loadSbTimes()].map(([id, sh]) => [id, sh.map((x) => x.t)]));
const goodShots: ShotsFn = (p, au) => {
  // a cut on every downbeat and at every approved storyboard shot, each a new state
  const ts = [...new Set([p.start, ...au.downbeats.filter((d) => d > p.start + FRAME && d < p.end - FRAME), ...(SB_TIMES.get(p.id) ?? [])])]
    .filter((t) => t >= p.start - 1e-6 && t < p.end).sort((x, y) => x - y);
  return ts.map((t, i) => ({ t, s: { id: `${p.id}:${t}`, frame: `f${i}` } }));
};

function compliantBase(real: GateInput): GateInput {
  const sources = new Map<string, string>();
  for (const f of ['engine/engine.ts', 'engine/post.ts', 'main.ts', 'timeline.ts']) sources.set(f, real.sources.get(f) ?? '');
  const mods = new Set(real.plates.flatMap((p) => [p.module, ...(p.subject ? [p.subject.module] : [])]));
  for (const m of mods) sources.set(`scenes/${m}.ts`, goodModule(m));
  // every module/variant (and every hosted subject pair) is "built" by a compliant synthetic module; the stand-in is never used
  return { ...real, sources, shotsFns: new Map([...mods].map((m) => [m, goodShots])), built: new Set(real.plates.map((p) => subjectPairOf(p) ?? pairOf(p))), standIn: undefined };
}

interface Fixture { name: string; expect: string; make: (base: GateInput, real: GateInput) => GateInput }
const clonePlates = (ps: PlateInfo[]) => ps.map((p) => ({ ...p, lines: [...p.lines], look: p.look ? { ...p.look } : undefined }));
/** Index of a plate by id prefix (fixtures address plates by their v3 id). */
const at = (ps: PlateInfo[], idPrefix: string) => { const i = ps.findIndex((p) => p.id.startsWith(idPrefix)); if (i < 0) throw new Error(`fixture: no plate ${idPrefix}`); return i; };

const FIXTURES: Fixture[] = [
  {
    name: 'v1 10-entry section timeline', expect: 'T.cap',
    make: (b) => {
      const s = (n: string) => b.audio.sections.find((x) => x.name === n)!.start;
      const w4 = b.lines[4]!.words[0]!.start;
      const v1b = b.audio.beats.filter((x) => x <= w4).pop()!;
      const cuts = [0, v1b, s('pre1'), s('drop1'), s('bridge'), s('verse2'), s('pre2'), s('climax'), s('drop2'), s('outro'), b.audio.duration];
      const mods = ['ignite', 'grid', 'tunnel', 'swarm', 'glitch', 'eye', 'tunnel', 'shell', 'kaleido', 'afterglow'];
      const plates = mods.map((m, i) => ({ id: `v1-${i}-${m}`, module: m, variant: 'v1', lines: [], bars: null, light: false, event: '', start: cuts[i]!, end: cuts[i + 1]!, anchor: 'section' }));
      const sources = new Map(b.sources);
      for (const m of mods) sources.set(`scenes/${m}.ts`, goodModule(m));
      return { ...b, plates, sources, shotsFns: new Map(mods.map((m) => [m, goodShots])) };
    },
  },
  {
    name: 'one module/state split into 40 identical plates', expect: 'T.adjacent',
    make: (b) => {
      const d = b.audio.duration / 40;
      const plates = Array.from({ length: 40 }, (_, i) => ({ id: `mono-${i}`, module: 'mono', variant: 'x', lines: [], bars: null, light: i % 4 === 0, event: '', start: i * d, end: (i + 1) * d, anchor: 'x' }));
      const sources = new Map(b.sources); sources.set('scenes/mono.ts', goodModule('mono'));
      return { ...b, plates, sources, shotsFns: new Map([['mono', ((p: PlateInfo) => [{ t: p.start, s: { frame: 'same' } }]) as ShotsFn]]) };
    },
  },
  {
    name: 'shots differing only by id', expect: 'S.count',
    make: (b) => ({ ...b, shotsFns: new Map([...b.shotsFns.keys()].map((m) => [m, ((p: PlateInfo, au: AudioLite) => goodShots(p, au).map((s, i) => ({ t: s.t, s: { id: `x${i}`, frame: 'same' } }))) as ShotsFn])) }),
  },
  {
    name: 'vocal module without a drawLyric call', expect: 'C.lyric-call',
    make: (b) => {
      const v = b.plates.find((p) => p.lines.length)!;
      const m = v.subject?.module ?? v.module; // v4: the subject draws a hosted plate's lyric
      const sources = new Map(b.sources);
      sources.set(`scenes/${m}.ts`, `// drawLyric(c, line, t, opts) is mentioned only here
import { drawLyric } from '../engine/lyric';
import { beatPulse } from '../engine/beat';
const note = "drawLyric(c, l, t, {})";
export default class M { render(f) { beatPulse(this.au, f.t); return note + String(drawLyric); } }
`);
      return { ...b, sources };
    },
  },
  {
    name: 'global karaoke restored (new Hud in the engine)', expect: 'C.no-hud',
    make: (b) => {
      const sources = new Map(b.sources);
      sources.set('engine/engine.ts', `${b.sources.get('engine/engine.ts')}\nimport { Hud } from './hud';\nexport const hud = new Hud(null as any, (l: any) => 'karaoke');\n`);
      return { ...b, sources };
    },
  },
  {
    name: 'a cut inside a lyric line', expect: 'T.no-cut-in-line',
    make: (b) => {
      const plates = clonePlates(b.plates);
      const k = plates.findIndex((p) => p.lines.length) + 1; // the plate after the first vocal plate
      const l = b.lines[plates[k - 1]!.lines[plates[k - 1]!.lines.length - 1]!]!;
      const mid = (l.start + l.end) / 2;
      plates[k - 1]!.end = mid; plates[k]!.start = mid;
      return { ...b, plates };
    },
  },
  {
    name: 'lyric helper marks a syllable sung before its start', expect: 'L.no-early',
    make: (b) => ({ ...b, syllableState: (w, t) => realSyllableState(w, t + 0.02) }),
  },
  {
    name: 'module without a beat pulse call', expect: 'C.beat-call',
    make: (b) => {
      const m = b.plates.find((p) => !p.lines.length)!.module;
      const sources = new Map(b.sources);
      sources.set(`scenes/${m}.ts`, `// beatPulse(au, t) — only mentioned in a comment
import { drawLyric } from '../engine/lyric';
import { beatPulse } from '../engine/beat';
const s = 'kickPulse(au, t)';
export default class M { render(f) { drawLyric(this.c, this.l, f.t, { x: 0, y: 0, size: 10 }); return [s, beatPulse]; } }
`);
      return { ...b, sources };
    },
  },
  // ---- v3
  {
    name: 'same idiom on adjacent plates outside a sequence', expect: 'T.adjacent',
    make: (b) => {
      // v4: p19 loses both its sequence and its run (and p18 is relabelled a 2 so it is not a run head):
      // pop-up → pop-up is now an adjacent repeat outside any run/sequence
      const plates = clonePlates(b.plates);
      for (const p of plates) if (p.sequence === 'popup-life') { delete p.sequence; delete p.run; }
      const p18 = plates[at(plates, 'p18-')]!; p18.nov = '2'; p18.ref = plates[at(plates, 'p01-')]!.id;
      return { ...b, plates };
    },
  },
  {
    name: '5 non-light plates in a row', expect: 'T.ground-run',
    make: (b) => {
      // v4: p27 (dawn) goes dark: p27..p31 = 5 non-light outside any declared envelope (p20–p26 ends at p26)
      const plates = clonePlates(b.plates);
      const p = plates[at(plates, 'p27-')]!;
      p.look = { ...p.look!, ground: 'dark', palette: 'blackmarble' }; p.light = false;
      return { ...b, plates };
    },
  },
  {
    name: 'B/C/O palette on 9 plates', expect: 'T.bco',
    make: (b) => {
      // v4: the real edit has 1 B/C/O plate (p28 popup-city); eight more DARK plates switch to the legacy
      // ink/bone/signal palette: 1 + 8 = 9 > 8
      const plates = clonePlates(b.plates);
      for (const id of ['p02-', 'p03-', 'p05-', 'p06-', 'p20-', 'p21-', 'p23-', 'p24-']) { const p = plates[at(plates, id)]!; p.look = { ...p.look!, palette: 'bco', bco: true }; }
      return { ...b, plates };
    },
  },
  {
    name: 'one family 3 plates in a row outside the demo', expect: 'T.family-run',
    make: (b) => {
      // v4: three consecutive non-run plates of one family: p20 (1), p21 (1) are E/H; relabel p21 and p22 as E and
      // take p22 out of its run (p20, p21, p22 = E E E, none in a run)
      const plates = clonePlates(b.plates);
      for (const id of ['p21-', 'p22-']) { const p = plates[at(plates, id)]!; p.look = { ...p.look!, family: 'E' }; }
      const p22 = plates[at(plates, 'p22-')]!; delete p22.run; p22.ref = plates[at(plates, 'p21-')]!.id;
      return { ...b, plates };
    },
  },
];

function selftest(real: GateInput): boolean {
  const base = compliantBase(real);
  const ctl = runGate(base).filter((r) => !r.ok);
  let ok = true;
  console.log('SELF-TEST');
  if (ctl.length) {
    ok = false;
    console.log(`  BROKEN  positive control (real cut list + compliant synthetic modules) fails: ${ctl.map((r) => `${r.id}: ${r.detail}`).join(' | ')}`);
  } else console.log('  ok      positive control passes every check');
  for (const fx of FIXTURES) {
    const fails = runGate(fx.make(base, real)).filter((r) => !r.ok).map((r) => r.id);
    const hit = fails.includes(fx.expect);
    if (!hit) ok = false;
    console.log(`  ${hit ? 'FAIL ok' : 'BROKEN '} ${fx.name.padEnd(52)} expected ${fx.expect.padEnd(16)} got [${fails.join(', ') || 'nothing failed'}]`);
  }
  console.log(ok ? `  self-test: all ${FIXTURES.length} fixtures FAIL as required\n` : '  self-test: THE GATE IS BROKEN\n');
  return ok;
}

function printTable(rs: Result[]) {
  console.log('LAYER  CHECK               STATUS  DETAIL');
  for (const r of rs) console.log(`${r.id.split('.')[0]!.padEnd(6)} ${r.id.padEnd(19)} ${r.ok ? 'pass  ' : 'FAIL  '}  ${r.detail}`);
}

if (import.meta.main) {
  const real = await realInput();
  const stOk = selftest(real);
  if (process.argv.includes('--selftest')) process.exit(stOk ? 0 : 1);
  if (!stOk) { console.log('ABORT: the self-test failed, the gate cannot be trusted'); process.exit(1); }
  const rs = runGate(real);
  printTable(rs);
  const bad = rs.filter((r) => !r.ok);
  console.log(bad.length ? `\nGATE FAIL: ${bad.length} of ${rs.length} checks (${bad.map((r) => r.id).join(', ')})` : `\nGATE PASS: ${rs.length} checks`);
  if (process.argv.includes('--tolerate-module-missing') && bad.length === 1 && bad[0]!.id === 'C.module-missing') {
    console.log('TOLERATED (--tolerate-module-missing): only C.module-missing fails — modules/variants not built yet (animatic render only)');
    process.exit(0);
  }
  process.exit(bad.length ? 1 : 0);
}
