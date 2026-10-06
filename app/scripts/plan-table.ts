// plan-table.ts — generate PLAN-V4 §C7 (markdown table + the 2/1 string) from data/plan-v4.json and lint it.
// bun app/scripts/plan-table.ts            → prints the markdown block to stdout, lint to stderr, exit 1 on any lint fail
// bun app/scripts/plan-table.ts --write    → also rewrites the "## C7" section of docs/PLAN-V4.md
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dir, '../..');
type Plate = { id: string; nov: 'R' | '1' | '2'; run?: string; ref?: string; W: string; G: string; C: string; L: string; S: string; chg?: string; residue?: string; note?: string };
type Table = { dims: ('W' | 'G' | 'C' | 'L' | 'S')[]; dark_envelopes: [string, string][]; whiteouts: (number | string)[]; plates: Plate[] };

const T: Table = JSON.parse(readFileSync(resolve(ROOT, 'data/plan-v4.json'), 'utf8'));
const byId = new Map(T.plates.map(p => [p.id, p]));
const fails: string[] = [];

// Resolve "=" / "= (...)" cells against the comparison plate so every row has concrete values.
function resolved(p: Plate, base: Plate | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const d of T.dims) {
    const v = p[d];
    if (v === '=' || v.startsWith('= ')) {
      if (!base) fails.push(`${p.id}.${d}: "=" with no base plate`);
      out[d] = base ? resolvedCache.get(base.id)![d] : v;
    } else out[d] = v;
  }
  return out;
}
const resolvedCache = new Map<string, Record<string, string>>();
const groundClass = (g: string) => (/^(light|mid|dark)/.exec(g.replace(/^=\s*/, ''))?.[1] ?? (fails.push(`ground class unparsable: "${g}"`), 'dark'));

// Which dims changed: compare the RESOLVED value against the base's resolved value. A cell that re-types the base's
// value verbatim is rejected (write "=" instead) so the lint cannot be fooled by restating the same thing.
const isEq = (v: string) => v === '=' || v.startsWith('= ');
function changed(p: Plate, base: Plate | undefined): string[] {
  if (!base) return T.dims.filter(d => !isEq(p[d]));
  const cur = resolvedCache.get(p.id)!, prv = resolvedCache.get(base.id)!;
  return T.dims.filter(d => {
    if (isEq(p[d])) return false;
    if (cur[d] === prv[d]) fails.push(`${p.id}.${d}: re-types the base value "${prv[d]}" — write "=" instead`);
    return cur[d] !== prv[d];
  });
}

let prev: Plate | undefined;
const str: string[] = [];
for (const p of T.plates) {
  const base = p.ref ? byId.get(p.ref) : prev;
  if (p.ref && !base) fails.push(`${p.id}: ref ${p.ref} not found`);
  resolvedCache.set(p.id, resolved(p, base));
  const ch = changed(p, base);
  if (p.nov === '2') {
    if (ch.length > 1) fails.push(`${p.id}: nov 2 but ${ch.length} dims change (${ch.join(',')}) — a 2 keeps >=4 of 5`);
    if (ch.length === 0) fails.push(`${p.id}: nov 2 with no changed dim — identical plate`);
    const declared = (p.chg ?? '').replace(/\s*\(.*\)$/, '');
    if (declared !== ch.join('+')) fails.push(`${p.id}: chg says "${p.chg}" but cells change ${ch.join('+') || 'nothing'}`);
    if (!p.run && !p.ref) fails.push(`${p.id}: nov 2 needs run or ref`);
  } else if (p.nov === '1') {
    if (ch.length < 4) fails.push(`${p.id}: nov 1 but only ${ch.length} dims change (${ch.join(',')}) — a 1 changes >=4`);
    if (!p.residue) fails.push(`${p.id}: nov 1 without residue`);
    if (p.run) fails.push(`${p.id}: a 1 cannot be inside a run`);
  }
  str.push(p.nov);
  prev = p;
}

// Dark-run check against the declared envelopes (cap 7 inside, 4 outside).
const inEnv = (id: string) => T.dark_envelopes.some(([a, b]) => id >= a && id <= b);
let k0 = 0;
const ids = T.plates.map(p => p.id);
for (let i = 0; i <= T.plates.length; i++) {
  const dark = i < T.plates.length && groundClass(resolvedCache.get(ids[i]!)!.G) !== 'light';
  if (!dark) {
    const n = i - k0;
    if (n > 0) {
      const cap = ids.slice(k0, i).every(inEnv) ? 7 : 4;
      if (n > cap) fails.push(`dark run ${ids[k0]}..${ids[i - 1]}: ${n} > ${cap}`);
    }
    k0 = i + 1;
  }
}
// Runs: <= 6 members, contiguous.
const runs = new Map<string, string[]>();
T.plates.forEach(p => p.run && (runs.get(p.run) ?? runs.set(p.run, []).get(p.run)!).push(p.id));
for (const [r, m] of runs) {
  if (m.length > 6) fails.push(`run ${r}: ${m.length} plates > 6`);
  const idx = m.map(id => ids.indexOf(id));
  if (idx.some((v, i) => i > 0 && v !== idx[i - 1]! + 1)) fails.push(`run ${r}: members not contiguous (${m.join(',')})`);
}

const ones = T.plates.filter(p => p.nov === '1').map(p => p.id);
const string = str.join(' ');

// Markdown
const esc = (s: string) => s.replace(/\|/g, '\\|');
const rows = T.plates.map(p => {
  const r = resolvedCache.get(p.id)!;
  const cell = (d: typeof T.dims[number]) => (p[d] === '=' ? '=' : p[d].startsWith('= ') ? '= ' + p[d].slice(2) : (p.nov === '2' ? '● ' : '') + p[d]);
  const last = p.nov === '1' ? `residue: ${p.residue}` : p.nov === '2' ? `changed: ${p.chg}` : 'reference';
  const id = p.nov === '1' ? `**${p.id}**` : p.id;
  const nov = p.nov === '1' ? '**1**' : p.nov;
  void r;
  return `| ${id} | ${nov} | ${p.run ?? (p.ref ? `ref ${p.ref}` : '—')} | ${esc(cell('W'))} | ${esc(cell('G'))} | ${esc(cell('C'))} | ${esc(cell('L'))} | ${esc(cell('S'))} | ${esc(last)}${p.note ? ' · ' + esc(p.note) : ''} |`;
});
const md = `## C7 — Canonical table (generated by \`bun app/scripts/plan-table.ts\` from \`data/plan-v4.json\`; supersedes C1/C3/C6)
Dimensions: **W** world/medium · **G** palette+ground class (what the pixel lint measures at the cut) · **C** camera class · **L** layout · **S** subject.
\`=\` = identical to the previous plate (or to \`ref\`). A **2** changes exactly one cell (●) and keeps the other four; a **1** changes ≥4 cells
and names the **residue** it keeps from the previous run. Lint: ${fails.length ? fails.length + ' FAIL' : 'PASS'} (${T.plates.length} plates, ${ones.length} ones = ${Math.round((100 * ones.length) / (T.plates.length - 1))} % of the 44 cuts; the owner's example is 7/32 = 22 %).

| id | nov | run/ref | W | G | C | L | S | changed / residue |
|---|---|---|---|---|---|---|---|---|
${rows.join('\n')}

String (generated): \`${string}\`
Ones: ${ones.join(', ')}.
Dark envelopes (cap 7 inside, 4 outside): ${T.dark_envelopes.map(([a, b]) => `${a}–${b}`).join(', ')}.
Whiteouts: ${T.whiteouts.join(', ')} only.
<!-- /C7 generated block — everything below this line is hand-written and preserved by --write -->
`;

if (process.argv.includes('--write')) {
  const doc = resolve(ROOT, 'docs/PLAN-V4.md');
  let s = readFileSync(doc, 'utf8');
  const i = s.indexOf('\n## C7 ');
  const END = '<!-- /C7 generated block';
  const j = s.indexOf(END);
  if (i >= 0 && j < 0) throw new Error('PLAN-V4.md has a C7 block without the end marker — refusing to overwrite the hand-written clauses');
  const tail = j >= 0 ? s.slice(s.indexOf('\n', j) + 1) : '';
  s = (i >= 0 ? s.slice(0, i + 1) : s + '\n') + md + tail;
  writeFileSync(doc, s);
}
process.stdout.write(md);
for (const f of fails) process.stderr.write(`FAIL ${f}\n`);
process.stderr.write(`${fails.length ? 'FAIL' : 'PASS'} plan-table: ${T.plates.length} plates, ones=${ones.length}, string=${string.replace(/ /g, '')}\n`);
process.exit(fails.length ? 1 : 0);
