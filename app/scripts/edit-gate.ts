#!/usr/bin/env bun
// The edit gate (docs/EDIT-SPEC.md §Gate). Fail-closed: exit 1 unless every check passes.
//   bun scripts/edit-gate.ts             self-test first (aborts if the gate is broken), then the real edit
//   bun scripts/edit-gate.ts --selftest  only the self-test
//
// Every check is a pure function of one GateInput (plates, lyrics, audio, source texts, shot functions,
// the lyric timing helper), so the self-test can feed it in-memory fixtures. Each negative fixture names
// the check it must trip; a fixture "passes the self-test" only when THAT check fails. A positive control
// (the real cut list with compliant synthetic modules) must pass every check, or a gate that fails
// everything would look healthy.
//
// Layers:
//   T  timeline   coverage, 4-bar cap, plate count, lyric ownership, no cut inside a line, anchors,
//                 light plates, adjacency, distinct modules, accent plates
//   C  code paths no global lyric HUD; modules exist; vocal modules call drawLyric; every module calls a
//                 beat pulse; no colour literals in scenes; scene imports; retired idioms; accent guard
//   S  shots      .shots.ts present; >= 60 structural transitions; max gap per section; determinism
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

const APP = path.resolve(import.meta.dir, '..');
const ROOT = path.resolve(APP, '..');
const FRAME = 1 / 60;
const TOL = 1.5e-3; // edit.json rounds to ms
const RETIRED = ['grid', 'tunnel', 'glitch', 'kaleido'];
const LINES_EXPECTED = 32;

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
}

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
  const adj = P.slice(1).filter((p, i) => p.module === P[i]!.module).map((p) => p.id);
  R.push(adj.length ? fail('T.adjacent', `same module as the previous plate: ${list(adj)}`) : pass('T.adjacent'));
  const mods = new Set(P.map((p) => p.module));
  R.push(mods.size >= 8 ? pass('T.distinct', `${mods.size} modules`) : fail('T.distinct', `${mods.size} distinct modules < 8`));
  const acc = P.filter((p) => p.accent).map((p) => p.id);
  R.push(acc.length <= 2 ? pass('T.accent', acc.join(', ') || 'none') : fail('T.accent', `${acc.length} accent plates > 2: ${list(acc)}`));
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

  const used = [...new Set(I.plates.map((p) => p.module))];
  const vocalMods = new Set(I.plates.filter((p) => p.lines.length).map((p) => p.module));
  const missing = used.filter((m) => !S.has(`scenes/${m}.ts`));
  R.push(missing.length ? fail('C.module-missing', `no scenes/<m>.ts for: ${missing.join(', ')}`) : pass('C.module-missing', `${used.length} modules present`));

  const noLyric = [...vocalMods].filter((m) => S.has(`scenes/${m}.ts`) && !callsImported(parse(`scenes/${m}.ts`, src(`scenes/${m}.ts`)!), '../engine/lyric', ['drawLyric']));
  R.push(noLyric.length ? fail('C.lyric-call', `vocal modules without a drawLyric(...) call: ${noLyric.join(', ')}`) : pass('C.lyric-call', `${[...vocalMods].filter((m) => S.has(`scenes/${m}.ts`)).length} present vocal modules call drawLyric`));

  const noBeat = used.filter((m) => S.has(`scenes/${m}.ts`) && !callsImported(parse(`scenes/${m}.ts`, src(`scenes/${m}.ts`)!), '../engine/beat', ['beatPulse', 'kickPulse', 'downbeatPulse']));
  R.push(noBeat.length ? fail('C.beat-call', `modules without a beatPulse/kickPulse/downbeatPulse call: ${noBeat.join(', ')}`) : pass('C.beat-call', `${used.filter((m) => S.has(`scenes/${m}.ts`)).length} present modules drive the beat`));

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
  const used = [...new Set(I.plates.map((p) => p.module))];
  const missing = used.filter((m) => !I.shotsFns.has(m));
  R.push(missing.length ? fail('S.shots-missing', `no scenes/<m>.shots.ts for: ${missing.join(', ')}`) : pass('S.shots-missing', `${used.length} shot lists`));

  // events: every plate start + every real state change inside a plate
  const events: number[] = [];
  const errs: string[] = [];
  const lists = new Map<string, Shot[]>();
  for (const p of I.plates) {
    events.push(p.start);
    const fn = I.shotsFns.get(p.module);
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
  const sbPlates = new Map<string, { shots: { t: number; anchor: string }[] }>(
    (JSON.parse(readFileSync(path.join(ROOT, 'data/storyboard.json'), 'utf8')).plates as any[]).map((p) => [p.id, p]));
  for (const p of I.plates) {
    const sh = lists.get(p.id), sbp = sbPlates.get(p.id);
    if (!sbp) { sbMiss.push(`${p.id}: not in storyboard`); continue; }
    if (!sh) continue;
    for (const x of sbp.shots) {
      if (Math.abs(x.t - p.start) <= FRAME) continue;
      const before = stateAt(sh, x.t - FRAME), at = stateAt(sh, x.t + FRAME / 4);
      if (sameState(before, at)) sbMiss.push(`${p.id}: no state change at storyboard shot ${x.t} (${x.anchor})`);
    }
  }
  if (I.shotsFns.size) R.push(sbMiss.length ? fail('S.storyboard', list(sbMiss)) : pass('S.storyboard', 'every storyboard shot is a real state change'));
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
    const fn = I.shotsFns.get(p.module), a = lists.get(p.id);
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
  for (const m of new Set(edit.plates.map((p) => p.module))) {
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
  return { plates: edit.plates, lines: ly.lines, audio, sources: readSources(), shotsFns, syllableState: realSyllableState };
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
const SB_TIMES = new Map<string, number[]>(
  (JSON.parse(readFileSync(path.join(ROOT, 'data/storyboard.json'), 'utf8')).plates as any[]).map((p) => [p.id, p.shots.map((x: any) => x.t)]));
const goodShots: ShotsFn = (p, au) => {
  // a cut on every downbeat and at every approved storyboard shot, each a new state
  const ts = [...new Set([p.start, ...au.downbeats.filter((d) => d > p.start + FRAME && d < p.end - FRAME), ...(SB_TIMES.get(p.id) ?? [])])]
    .filter((t) => t >= p.start - 1e-6 && t < p.end).sort((x, y) => x - y);
  return ts.map((t, i) => ({ t, s: { id: `${p.id}:${t}`, frame: `f${i}` } }));
};

function compliantBase(real: GateInput): GateInput {
  const sources = new Map<string, string>();
  for (const f of ['engine/engine.ts', 'engine/post.ts', 'main.ts', 'timeline.ts']) sources.set(f, real.sources.get(f) ?? '');
  const mods = new Set(real.plates.map((p) => p.module));
  for (const m of mods) sources.set(`scenes/${m}.ts`, goodModule(m));
  return { ...real, sources, shotsFns: new Map([...mods].map((m) => [m, goodShots])) };
}

interface Fixture { name: string; expect: string; make: (base: GateInput, real: GateInput) => GateInput }
const clonePlates = (ps: PlateInfo[]) => ps.map((p) => ({ ...p, lines: [...p.lines] }));

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
      const m = b.plates.find((p) => p.lines.length)!.module;
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
  process.exit(bad.length ? 1 : 0);
}
