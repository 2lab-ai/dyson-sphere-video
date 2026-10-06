#!/usr/bin/env python3 -I
"""v4 migration: data/plan-v4.json (typing + 5 dims) + a host/subject map -> data/edit.json fields.
Plate ids, starts/ends/lines are untouched (boundaries are v3's). Adds per plate: nov, run|ref, dims {W,G,C,L,S}
(resolved), chg|residue, and for hosted runs: module = host, subject = {module, variant}. Run: python3 -I analysis/edit_v4.py"""
import json, sys
P = json.load(open('data/plan-v4.json')); E = json.load(open('data/edit.json'))
by = {p['id'][:3]: p for p in E['plates']}
# host, subject module, subject variant, idiom, family, ground  — per plate (None host = the plate's own module is the world)
MAP = {
 'p01': ('wall', 'spark', 'write', 'light-trace', 'E', 'dark'),
 'p02': ('wall', 'ecg', 'scope', 'oscilloscope-xy', 'E', 'dark'),
 'p03': ('wall', 'crt', 'wall', 'crt-wall', 'E', 'dark'),
 'p04': ('wall', 'sign', 'neon', 'neon', 'E', 'dark'),
 'p05': ('wall', 'led', 'ribbon', 'led-wall', 'E', 'dark'),
 'p06': ('wall', 'sign', 'tubes', 'neon', 'E', 'dark'),
 'p07': ('wall', 'press', 'clock', 'paper-clock', 'P', 'dark'),
 'p08': ('film', 'lightpaint', 'time', 'light-painting', 'M', 'light'),
 'p09': ('film', 'flipdisc', 'years', 'flip-board', 'E', 'light'),
 'p10': ('film', 'lidar', 'room', 'swept-room', 'S', 'light'),
 'p11': ('film', 'lens', 'gaze', 'aperture', 'M', 'light'),
 'p12': ('film', 'lightpaint', 'orbit', 'double-exposure', 'M', 'light'),
 'p13': ('space', 'bigbang', 'bang', 'fluid-cosmos', 'M', 'dark'),
 'p14': ('space', 'cosmicweb', 'web', 'powers-of-ten', 'A', 'dark'),
 'p15': ('space', 'solar', 'sun', 'sdo-solar', 'S', 'dark'),
 'p16': ('space', 'impact', 'theia', 'impact', 'M', 'dark'),
 'p17': ('space', 'moon', 'ring', 'debris-ring', 'S', 'dark'),
 'p18': (None, 'popup', 'life-sea', 'pop-up', 'P', 'light'),
 'p19': (None, 'popup', 'life-land', 'pop-up', 'P', 'light'),
 'p20': (None, 'split', 'ascii', 'ascii-raster', 'E', 'dark'),
 'p21': (None, 'engrave', 'hand', 'engraving', 'H', 'dark'),
 'p22': (None, 'engrave', 'iris', 'engraving', 'H', 'dark'),
 'p23': ('limb', 'blackmarble', 'future', 'black-marble', 'S', 'dark'),
 'p24': ('limb', 'flipdisc', 'board', 'flip-board', 'E', 'dark'),
 'p25': ('limb', 'jamo', 'ahn', 'ahn-jamo', 'H', 'dark'),
 'p26': ('limb', 'orbit', 'capture', '3d-lit', 'M', 'dark'),
 'p27': ('limb', 'colorfield', 'dawn', 'ganzfeld', 'A', 'light'),
 'p28': (None, 'popup', 'city', 'pop-up', 'P', 'light'),
 'p29': ('wall', 'spark', 'merge', 'light-trace', 'E', 'dark'),
 'p30': ('lines', 'ecg', 'ridge', 'pulsar-ridge', 'S', 'dark'),
 'p31': ('lines', 'void', 'stones', 'void', 'A', 'dark'),
 'p32': ('amber', 'sodium', 'sun', 'sodium-sun', 'A', 'light'),
 'p33': ('amber', 'cave', 'fire', 'cave-ochre', 'H', 'light'),
 'p34': ('amber', 'clay', 'tablet', 'clay-tablet', 'M', 'light'),
 'p35': (None, 'glass', 'rose', 'stained-glass', 'H', 'dark'),
 'p36': (None, 'glass', 'thermal', 'thermal', 'S', 'dark'),
 'p37': (None, 'dither', 'bomb', '1bit-dither', 'P', 'light'),
 'p38': (None, 'demo', 'boot', 'demoscene', 'E', 'dark'),
 'p39': (None, 'demo', 'internet', 'demoscene', 'E', 'dark'),
 'p40': (None, 'demo', 'ai', 'demoscene', 'E', 'dark'),
 'p41': (None, 'orbit', 'swarm', '3d-lit', 'M', 'dark'),
 'p42': (None, 'shell', 'dancheong', 'dancheong', 'H', 'dark'),
 'p43': (None, 'shell', 'pullback', '3d-lit', 'M', 'dark'),
 'p44': (None, 'press', 'credits', 'constructivist', 'P', 'light'),
 'p45': ('wall', 'spark', 'outro', 'light-trace', 'E', 'dark'),
}
PAL = {'wall': 'wall', 'film': 'film', 'space': 'space', 'limb': 'blackmarble', 'lines': 'ridge', 'amber': 'amber', 'glass': 'glass',
       'p22': 'engrave', 'p27': 'dawn', 'p36': 'thermal', 'p40': 'demo-ai-dark', 'p42': 'swarm', 'p44': 'credits'}
dims = {}
prev = None
for row in P['plates']:
    pid = row['id']; base = dims[row['ref']] if row.get('ref') else prev
    cur = {}
    for d in 'WGCLS':
        v = row[d]
        cur[d] = base[d] if (v == '=' or v.startswith('= ')) else v
    dims[pid] = cur
    e = by[pid]; host, mod, var, idiom, fam, ground = MAP[pid]
    e['nov'] = row['nov']
    for k in ('run', 'ref'): e.pop(k, None)
    if row.get('run'): e['run'] = row['run']
    if row.get('ref'): e['ref'] = by[row['ref']]['id']
    e['dims'] = cur
    e['event'] = cur['S']
    e['chg'] = row.get('chg'); e['residue'] = row.get('residue')
    if e['chg'] is None: del e['chg']
    if e['residue'] is None: del e['residue']
    if host:
        e['module'] = host; e['subject'] = {'module': mod, 'variant': var}; e['variant'] = var
    else:
        e['module'] = mod; e['variant'] = var; e.pop('subject', None)
    e['look']['idiom'] = idiom; e['look']['family'] = fam; e['look']['ground'] = ground
    e['look']['palette'] = PAL.get(pid) or PAL.get(host) or e['look']['palette']
    e['look']['bco'] = e['look']['palette'] in ('bco', 'popup-city')
    e['light'] = ground == 'light'
    e['id'] = f"{pid}-{mod}-{var}"
    prev = cur
E['v'] = 4
# storyboard: carry each v3 plate's shots under the v4 id (builders refine them in their .shots.ts)
S = json.load(open('data/storyboard.json'))
old = {sp['id'][:3]: sp for sp in S['plates']}
for p in E['plates']:
    sp = old[p['id'][:3]]
    sp['id'] = p['id']; sp['module'] = p['module']; sp['variant'] = p['variant']; sp['ground'] = p['look']['ground']
    sp['idiom'] = p['look']['idiom']; sp['family'] = p['look']['family']; sp['palette'] = p['look']['palette']; sp['event'] = p['event']
    sp['nov'] = p['nov']; sp['dims'] = p['dims']
    if 'subject' in p: sp['subject_module'] = p['subject']
json.dump(S, open('data/storyboard.json', 'w'), ensure_ascii=False, indent=1)
json.dump(E, open('data/edit.json', 'w'), ensure_ascii=False, indent=1)
print('ok', len(E['plates']), 'plates; hosted:', sum(1 for p in E['plates'] if 'subject' in p))
