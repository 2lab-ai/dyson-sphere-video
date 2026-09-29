"""The edit (cut list) -> data/edit.json. Owned by one editor; plate modules only render their windows.

Rules (docs/EDIT-SPEC.md, trinity consensus 2026-09-29):
- a vocal plate owns 1-2 whole lyric lines; it starts at the beat at/before its first word (b <= t), or at the
  first word itself when that beat falls inside the previous lyric line; instrumental plates start on downbeats
- every plate <= 4 bars; the song is covered exactly [0, duration)
- the plate right after a vocal plate starts on the first downbeat after the owned lines end, or on the first beat
  after them when that downbeat would push the vocal plate past 4 bars (the cap has no exceptions)
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
L = json.loads((ROOT / "data/lyrics.json").read_text())["lines"]
A = json.loads((ROOT / "data/audio.json").read_text())
beats, downs, dur = A["beats"], A["downbeats"], A["duration"]
BAR = 4 * 60 / A["bpm"]


def anchor(li):
    t = L[li]["words"][0]["start"]
    b = max(x for x in beats if x <= t + 1e-9)
    inside = any(p["start"] < b < p["end"] for p in L[:li])
    return (t, "lyric") if inside else (b, "beat")


def down_after(t, bars):
    """The downbeat nearest to t + bars*BAR."""
    target = t + bars * BAR
    return min(downs, key=lambda d: abs(d - target))


# (module, variant, lyric line ids | None, light, event).  Instrumental runs are given as bar counts.
V = "vocal"
PLAN = [
    ("spark", "write", [0, 1], False, "a single point of light ignites in the void, then writes the words as it accelerates; speed streaks pull the letters"),
    ("ecg", "heart", [2], False, "a heart trace whose beats square off into a machine rhythm; words ride the trace"),
    ("screen", "hidden", [3], True, "a bright screen-in-screen UI; the hidden future is revealed by scrolling windows"),
    ("press", "dream", [4], True, "a letterpress poster printed in two passes that slide out of register (illusion)"),
    ("wave", "tide", [5], True, "a halftone print wave rolls in silently from the right; words surf the crest"),
    ("sign", "neon", [6], False, "hand-bent neon tube lettering switches on stroke by stroke and floods the wall (accent plate 1)"),
    ("gauge", "countdown", [7], False, "a mechanical countdown dial; each word drops the needle a notch"),
    ("press", "squeeze", [8], True, "a typographic compressor squeezes the line between two plates"),
    ("spark", "race", [9], False, "the point outruns a timeline ruler; year ticks blur past"),
    ("blueprint", "room", [10], True, "a section drawing of a room built line by line by two points (you and I)"),
    ("lens", "gaze", [11, 12], False, "two optical irises face each other; the truth line is inscribed around the rings"),
    ("ecg", "twin", [13], False, "two pulse traces inside a machine chassis converge and lock together"),
    ("orbit", "launch", 3, False, "collector panels launched from the star snap into orbit on every bar"),
    ("blueprint", "orbits", 3, True, "orbital blueprint: ellipses, dimension lines, ring counts ticking up"),
    ("orbit", "ring", 3, False, "rings of panels close around the star, camera re-frames every bar"),
    ("press", "title", 3, True, "a huge DYSON SPHERE letterpress poster stamped bar by bar"),
    ("shell", "partial", None, False, "a half-built shell with light spilling through the gaps"),
    ("split", "torn", [14, 15], True, "two paper layers (virtual/real); the seam tears across as the words cross it"),
    ("engrave", "hand", [16, 17], False, "an engraved steel hand sweeps across and scoops the letters away"),
    ("lens", "ai", [18, 19], False, "the AI eye's aperture closes on the stolen words, a future glints in the pupil"),
    ("spark", "glint", [20], False, "the future glitters as a constellation of points that spells the line"),
    ("screen", "choice", [21, 22], True, "a choice dialog whose options grey out one by one as the timer runs out"),
    ("gauge", "exp", [23], False, "an exponential needle pinned past the red line"),
    ("orbit", "capture", [24], False, "orbital rings close into a cage around the words (no escape)"),
    ("press", "erase", [25], True, "the stamped line is scraped away letter by letter after each word is sung"),
    ("popup", "city", [26, 27], True, "a pop-up book spread: a paper city hinges up building by building on the beat, the line printed on the page"),
    ("spark", "merge", [28], False, "many points drift together and merge into one"),
    ("ecg", "square", [29], False, "the heartbeat sine hardens into a square wave"),
    ("void", "descent", [30], False, "a depth gauge; the line falls down an abyss shaft, depth markers rushing up"),
    ("shell", "seal", [31], False, "the final panels seal the shell over the star as the long note holds"),
    ("blueprint", "stamp", None, True, "an approval stamp slams onto the finished drawing: SEALED"),
    ("press", "burst", 3, True, "drop 2 opens: a poster explosion of the title, bar-stamped"),
    ("demo", "scene", 3, False, "a 1990s demoscene interlude, one effect per bar with hard cuts on the downbeat: raster bars + sine scroller, then a hex-panel rotozoom, then a vector-ball sphere (ordered-dither signal/bone, no accent)"),
    ("blueprint", "exploded", 3, True, "exploded-view drawing of the sphere, parts flying apart per bar"),
    ("shell", "whole", 3, False, "the completed sphere turns; seams pulse"),
    ("sign", "ring", 2, False, "the sphere's seam lights up as a single neon ring (accent plate 2)"),
    ("lens", "star", 2, False, "the star seen through a closing aperture: the last light of drop 2"),
    ("shell", "pullback", 4, False, "pull back from the sealed sphere into a wide starfield"),
    ("blueprint", "return", 3, True, "the sphere dissolves back into its blueprint"),
    ("press", "credits", 3, True, "title card: DYSON SPHERE / Sentient Architect"),
    ("spark", "outro", None, False, "back to the single point of light; fade to black"),
]


# the only plates allowed to use the `accent` palette token (docs/EDIT-SPEC.md: accent on <= 2 plates)
# (keyed by module/variant so renumbering the plan cannot move it)
ACCENT = {("sign", "neon"), ("sign", "ring")}


def main():
    plates, t = [], 0.0
    # starts
    for k, (mod, var, lines, light, ev) in enumerate(PLAN):
        if isinstance(lines, list):
            s, kind = anchor(lines[0]) if k else (0.0, "start")
        elif k == 0:
            s, kind = 0.0, "start"
        else:
            s, kind = None, "downbeat"
        plates.append(dict(id=f"p{k + 1:02d}-{mod}-{var}", module=mod, variant=var, lines=lines if isinstance(lines, list) else [],
                           bars=lines if isinstance(lines, int) else None, light=light, event=ev, start=s, anchor=kind))
    # instrumental plates: chain on downbeats from the previous plate's start, the last of a run ends at the next anchor
    for k, p in enumerate(plates):
        if p["start"] is None:
            prev = plates[k - 1]
            if prev["bars"]:
                p["start"] = down_after(prev["start"], prev["bars"])
            elif prev["lines"]:  # first plate after vocals (see the rule in the docstring)
                last = L[prev["lines"][-1]]["end"]
                d = min(x for x in downs if x >= last - 1e-6)
                p["start"] = d if d - prev["start"] <= 4 * BAR + 1e-3 else min(x for x in beats if x >= last - 1e-6)
                p["anchor"] = "downbeat" if p["start"] == d else "beat-after-line"
            else:  # after an unmetered instrumental plate: next downbeat
                p["start"] = min(x for x in downs if x > prev["start"] + 1e-6)
    for p in plates:
        if (p["module"], p["variant"]) in ACCENT:
            p["accent"] = True
    assert sum(1 for p in plates if p.get("accent")) == len(ACCENT), "accent plates missing from PLAN"
    for k, p in enumerate(plates):
        p["end"] = plates[k + 1]["start"] if k + 1 < len(plates) else dur
        p["start"], p["end"] = round(p["start"], 3), round(p["end"], 3)
        p["dur"] = round(p["end"] - p["start"], 3)
    (ROOT / "data/edit.json").write_text(json.dumps(dict(bar=BAR, duration=dur, plates=plates), ensure_ascii=False, indent=1))
    for p in plates:
        flag = "  <-- >4 bars" if p["dur"] > 4 * BAR + 1e-3 else ("  <-- <=0" if p["dur"] <= 0 else "")
        print(f"{p['id']:24s} {p['start']:8.3f} {p['end']:8.3f} {p['dur']:6.2f}s {p['anchor']:8s} L{p['lines']}{flag}")
    print(len(plates), "plates; light", sum(p["light"] for p in plates))


if __name__ == "__main__":
    main()
