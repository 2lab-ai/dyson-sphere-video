"""The edit (cut list) v3 -> data/edit.json. Owned by one editor; plate modules only render their windows.

Binding spec: docs/PLAN-V3.md, whose final section "Trinity decisions" overrides the draft table (45 plates,
#36 deleted). v2 rules that still apply (docs/EDIT-SPEC.md):
- a vocal plate owns 1-2 whole lyric lines; it starts at the beat at/before its first word (b <= t), or at the
  first word itself when that beat falls inside the previous lyric line (vocal boundaries are unchanged from v2)
- every plate <= 4 bars; the song is covered exactly [0, duration)
- the plate right after a vocal plate starts on the first downbeat after the owned lines end, or on the first beat
  after them when that downbeat would push the vocal plate past 4 bars
- instrumental plates (drop1, drop2, outro) start at their PLAN-V3 time, snapped to the nearest downbeat

Every plate carries `look` = {idiom (canonical, what adjacency/uniqueness is judged on), family (E/S/H/M/P/A),
palette (a name in app/src/engine/palette.ts), ground (dark|mid|light), bco (uses the legacy ink/bone/signal
palette)}, `event` (the on-screen event from PLAN-V3), and where declared `sequence` (plate-ID-scoped exceptions:
popup-life, demo) and `match_circle_next` (the gated match cuts #41->#42, #42->#43, #43->#44).
`n` is the PLAN-V3 row number (#36 does not exist). `light` (v2 field, read by v2 modules) = ground == 'light'.
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
L = json.loads((ROOT / "data/lyrics.json").read_text())["lines"]
A = json.loads((ROOT / "data/audio.json").read_text())
beats, downs, dur = A["beats"], A["downbeats"], A["duration"]
BAR = 4 * 60 / A["bpm"]
FRAME = 1 / 60


def anchor(li):
    t = L[li]["words"][0]["start"]
    b = max(x for x in beats if x <= t + 1e-9)
    inside = any(p["start"] < b < p["end"] for p in L[:li])
    return (t, "lyric") if inside else (b, "beat")


# (PLAN-V3 #, planned start s, module, variant, lines | None, idiom, family, palette, ground, bco, sequence, event)
# lines: owned lyric line ids (vocal) or None (instrumental: starts at the planned time snapped to a downbeat).
PLAN = [
    (1, 0.00, "spark", "write", [0, 1], "light-trace", "E", "bco", "dark", True, None,
     "a point of light writes the first words as a circuit trace on black"),
    (2, 6.96, "xray", "heart", [2], "xray", "S", "xray", "dark", False, None,
     "the machine heart X-rayed: ribs of gears, the letters as bone-white radiograph"),
    (3, 12.10, "crt", "wall", [3], "crt-wall", "E", "crt", "dark", False, None,
     "a wall of CRT TVs (Paik); the line scrolls across the tubes and one tube hides the future"),
    (4, 16.17, "press", "riso", [4], "risograph", "P", "riso", "light", False, None,
     "the dream printed in fluorescent pink and blue riso that drifts out of register"),
    (5, 20.84, "wave", "ocean", [5], "fluid-cosmos", "M", "ocean", "dark", False, None,
     "the high-tech tide as an ink-in-water ocean: a side-on wave flowing left, amber light in the teal"),
    (6, 24.94, "sign", "neon", [6], "neon", "E", "neon", "dark", False, None,
     "neon tubes switching on stroke by stroke over brick (accent plate)"),
    (7, 29.53, "gauge", "bass", [7], "saul-bass", "P", "bass", "light", False, None,
     "a Saul Bass cut-paper clock on a mustard ground that cannot be rewound"),
    (8, 34.24, "lightpaint", "time", [8], "light-painting", "M", "lightpaint", "dark", False, None,
     "time as long-exposure light-painting trails (Gjon Mili) writing the line"),
    (9, 37.56, "led", "ticker", [9], "led-wall", "E", "led", "dark", False, None,
     "a stadium LED ticker; AGI overtakes the scrolling years"),
    (10, 43.56, "lidar", "room", [10], "lidar", "S", "lidar", "dark", False, None,
     "a LiDAR sweep scans the room you and I made; two figures appear as point returns"),
    (11, 51.13, "lens", "gaze", [11, 12], "aperture", "M", "film", "light", False, None,
     "two camera irises across a wall, shot on bright overexposed film stock"),
    (12, 57.55, "ecg", "xy", [13], "oscilloscope-xy", "E", "scope", "dark", False, None,
     "two XY-oscilloscope Lissajous figures that sync, green phosphor"),
    (13, 65.12, "bigbang", "bang", None, "fluid-cosmos", "M", "cosmos-gold", "dark", False, None,
     "Big Bang: the drop hits and the whole frame is white-hot at once (space itself expands everywhere, no centre); "
     "the plasma cools into gold ink-in-water curls"),
    (14, 69.78, "cosmicweb", "web", None, "powers-of-ten", "A", "web", "dark", False, None,
     "expansion: the cosmic web grows; the distances between structures grow per beat (metric expansion) while the "
     "structures keep their size, a power of ten per bar"),
    (15, 74.44, "solar", "sun", None, "sdo-solar", "S", "sdo", "dark", False, None,
     "the Sun ignites: a nebula collapses into the Sun in SDO false colour, granulation pulsing on the kick"),
    (16, 79.10, "impact", "theia", None, "claymation", "M", "clay", "light", False, None,
     "Earth accretes; Theia strikes: molten clay planets, stepped 12 fps, the impact on the downbeat"),
    (17, 83.77, "moon", "sumuk", None, "ink-wash", "H", "sumuk", "light", False, None,
     "the Moon forms: the debris ring gathers into a full moon in Korean ink wash (sumuk)"),
    (18, 86.10, "popup", "life-sea", None, "pop-up", "P", "popup-life", "light", False, "popup-life",
     "life, pop-up book 1: the page opens on a primordial sea, a cell divides per beat, fish rise"),
    (19, 90.76, "popup", "life-land", None, "pop-up", "P", "popup-life", "light", False, "popup-life",
     "life, pop-up book 2: onto land, into the forest; gait changes across several lineages (crawl, knuckle-walk, "
     "climb, upright hominins); a human appears last"),
    (20, 98.33, "split", "ascii", [14, 15], "ascii-raster", "E", "ascii", "dark", False, None,
     "virtual vs real: the frame is torn, one side an ASCII Hangul raster, the other lit"),
    (21, 106.49, "engrave", "hand", [16, 17], "engraving", "H", "engrave", "dark", False, None,
     "the steel hand in hatch engraving, reversed out of Prussian blue"),
    (22, 113.11, "lens", "ai", [18, 19], "aperture", "M", "chrome-eye", "light", False, None,
     "the machine eye (a chrome iris on a white cyclorama) swallows the words"),
    (23, 117.49, "blackmarble", "future", [20], "black-marble", "S", "blackmarble", "dark", False, None,
     "the future seen from orbit: Earth's night lights spell the line (Black Marble)"),
    (24, 120.66, "flipdisc", "choice", [21, 22], "flip-disc", "E", "flipdisc", "dark", False, None,
     "a flip-disc departure board; the choices flip away"),
    (25, 125.26, "jamo", "ahn", [23], "ahn-jamo", "H", "ahn", "light", False, None,
     "Ahn Sang-soo jamo: the letters break apart as change accelerates and reassemble on the downbeat"),
    (26, 127.57, "orbit", "capture", [24], "3d-lit", "M", "steel", "dark", False, None,
     "the cage closes: 3D rings around the words"),
    (27, 130.04, "colorfield", "freedom", [25], "ganzfeld", "A", "dawn", "light", False, None,
     "the voice of freedom dissolves into a Turrell dawn colour field"),
    (28, 135.63, "popup", "city", [26, 27], "pop-up", "P", "popup-city", "light", True, None,
     "pop-up book 3: a paper city hinges up building by building, the line printed on the page"),
    (29, 141.24, "spark", "merge", [28], "light-trace", "E", "bco", "dark", True, None,
     "different marks are forced into one grid and merge into one point"),
    (30, 145.30, "ecg", "ridge", [29], "pulsar-ridge", "S", "ridge", "dark", False, None,
     "heartbeats flatten into machine regularity: Unknown Pleasures ridgelines"),
    (31, 150.78, "void", "descent", [30], "void", "A", "bco", "dark", True, None,
     "stepping stones across the abyss, one per beat"),
    (32, 155.35, "sodium", "sun", [31], "sodium-sun", "A", "sodium", "light", False, None,
     "the Weather Project sodium sun in an amber haze; silhouettes reach for it; the line etched in the disc"),
    (33, 163.59, "cave", "fire", None, "cave-ochre", "H", "cave", "dark", False, None,
     "fire and speech: a cave wall, ochre handprints, firelight on the beat, the first sounds as sparks"),
    (34, 167.67, "clay", "tablet", None, "clay-tablet", "M", "tablet", "mid", False, None,
     "writing: cuneiform wedges pressed into a clay tablet under raking light"),
    (35, 172.33, "glass", "rose", None, "stained-glass", "H", "glass", "dark", False, None,
     "religion: a stained-glass rose window lights up pane by pane"),
    (37, 177.00, "thermal", "steam", None, "thermal", "S", "thermal", "dark", False, None,
     "machines and steam in a thermal camera: clockwork gears and linkages drive pistons, then a locomotive; "
     "pistons flare on the beat"),
    (38, 181.66, "dither", "bomb", None, "1bit-dither", "P", "dither", "light", False, None,
     "the atomic bomb: silence, whiteout on the downbeat, a 1-bit dithered mushroom cloud (Obra Dinn)"),
    (39, 186.32, "demo", "boot", None, "demoscene", "E", "demo-boot", "dark", False, "demo",
     "first computer (8-bit 1): ENIAC panel lamps, a PET/C64 boot screen, the first raster bars"),
    (40, 190.98, "demo", "internet", None, "demoscene", "E", "demo-net", "dark", False, "demo",
     "internet (8-bit 2): modem handshake, copper bars, a sine scroller of jamo, the network lights node by node"),
    (41, 197.97, "demo", "ai", None, "demoscene", "E", "demo-ai", "light", False, "demo",
     "AI (8-bit 3): an Ikeda data flood (at most 3 flashes/s) condenses into a low-res face whose eye is a circle"),
    (42, 202.64, "orbit", "swarm", None, "3d-lit", "M", "swarm", "dark", False, None,
     "AI launches the swarm: collector volleys snap into orbit around the Sun from #15; lateral track in orbit"),
    (43, 207.30, "shell", "dancheong", None, "dancheong", "H", "dancheong", "light", False, None,
     "the shell closes: hex panels painted in dancheong lock shut, seen looking up from inside the sunlit shell"),
    (44, 211.96, "shell", "pullback", None, "3d-lit", "M", "pullback", "dark", False, None,
     "pull back (exterior wide): the enclosed Sun goes dark; other stars go dark too (other spheres)"),
    (45, 216.62, "press", "credits", None, "constructivist", "P", "constructivist", "mid", False, None,
     "title and credits: constructivist wedge typography, stamped on the beat"),
    (46, 225.94, "spark", "outro", None, "light-trace", "E", "bco", "dark", True, None,
     "the point shrinks per beat to nothing"),
]

# the only plates allowed to use the `accent` palette token (docs/EDIT-SPEC.md: accent on <= 2 plates)
ACCENT = {("sign", "neon")}
# gated match-circle cuts (PLAN-V3 Trinity decisions): the plates (PLAN-V3 #) whose cut to the NEXT plate is a circle match
MATCH_CIRCLE_FROM = {41, 42, 43}


def main():
    plates = []
    for k, (n, t_plan, mod, var, lines, idiom, fam, pal, ground, bco, seq, ev) in enumerate(PLAN):
        p = dict(id=f"p{k + 1:02d}-{mod}-{var}", n=n, module=mod, variant=var, lines=lines or [], bars=None,
                 light=ground == "light", event=ev, start=None, anchor=None, plan=t_plan,
                 look=dict(idiom=idiom, family=fam, palette=pal, ground=ground, bco=bco))
        if seq:
            p["sequence"] = seq
        if n in MATCH_CIRCLE_FROM:
            p["match_circle_next"] = True
        if (mod, var) in ACCENT:
            p["accent"] = True
        if k == 0:
            p["start"], p["anchor"] = 0.0, "start"
        elif lines:
            p["start"], p["anchor"] = anchor(lines[0])
        plates.append(p)
    for k, p in enumerate(plates):
        if p["start"] is not None:
            continue
        prev = plates[k - 1]
        if prev["lines"]:  # first plate after vocals (see the rule in the docstring)
            last = L[prev["lines"][-1]]["end"]
            d = min(x for x in downs if x >= last - 1e-6)
            p["start"] = d if d - prev["start"] <= 4 * BAR + 1e-3 else min(x for x in beats if x >= last - 1e-6)
            p["anchor"] = "downbeat" if p["start"] == d else "beat-after-line"
        else:  # instrumental after instrumental: the planned time, snapped to the nearest downbeat
            p["start"] = min(downs, key=lambda d: abs(d - p["plan"]))
            p["anchor"] = "downbeat"
    assert sum(1 for p in plates if p.get("accent")) == len(ACCENT), "accent plates missing from PLAN"
    moved = []
    for k, p in enumerate(plates):
        p["end"] = plates[k + 1]["start"] if k + 1 < len(plates) else dur
        p["start"], p["end"] = round(p["start"], 3), round(p["end"], 3)
        p["dur"] = round(p["end"] - p["start"], 3)
        if not p["lines"]:
            p["bars"] = round(p["dur"] / BAR, 2)
        if abs(p["start"] - p["plan"]) > FRAME:
            moved.append(f"{p['id']}: plan {p['plan']:.2f} -> {p['start']:.3f} ({(p['start'] - p['plan']) * 60:+.1f} frames)")
    (ROOT / "data/edit.json").write_text(json.dumps(dict(version=3, bar=BAR, duration=dur, plates=plates), ensure_ascii=False, indent=1))
    for p in plates:
        lk = p["look"]
        flag = "  <-- >4 bars" if p["dur"] > 4 * BAR + 1e-3 else ("  <-- <=0" if p["dur"] <= 0 else "")
        print(f"#{p['n']:<3d}{p['id']:24s} {p['start']:8.3f} {p['end']:8.3f} {p['dur'] / BAR:5.2f}b {p['anchor']:15s} "
              f"{lk['idiom']:16s} {lk['family']} {lk['ground']:5s} {lk['palette']:14s} L{p['lines']}{flag}")
    print(len(plates), "plates; light", sum(p["light"] for p in plates), "; idioms", len({p['look']['idiom'] for p in plates}))
    print("boundaries moved > 1 frame from the PLAN-V3 numbers:", "none" if not moved else "")
    for m in moved:
        print("  ", m)


if __name__ == "__main__":
    main()
