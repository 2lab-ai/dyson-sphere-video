"""Storyboard v2 -> data/storyboard.json + docs/STORYBOARD.md (editor-owned, trinity-reviewed).

Every plate in data/edit.json gets: hit tier, beat mechanism (concrete numbers), lyric surface, exit, and a shot list
whose times are computed from the real data (line/word starts, beats, bars) and checked against the max-gap rules:
drop1 / climax / drop2 <= 1 bar, other vocal sections <= 2 bars, intro/outro <= 4 bars.
Anchors: 's' plate start · 'L<n>' line n start · 'W<n>.<k>' word k of line n · '+<k>b' k beats after the plate's
first beat · '+<k>B' k bars after the plate start (snapped to the nearest beat).
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
E = json.loads((ROOT / "data/edit.json").read_text())
L = json.loads((ROOT / "data/lyrics.json").read_text())["lines"]
A = json.loads((ROOT / "data/audio.json").read_text())
BAR, BEATS = E["bar"], A["beats"]
SEC = {s["name"]: (s["start"], s["end"]) for s in A["sections"]}

TIERS = {
    "T1": "verse: camera/post shake <= 6 px, flare <= 1.4x (object motion is choreography, not capped)",
    "T2": "pre-chorus/bridge: camera/post shake <= 14 px, flare <= 2x; downbeat scale punch <= 1.06x",
    "T3": "drop/climax: every beat a BIG structural hit specific to the plate (the object itself moves/locks/"
          "breaks); full-frame polarity swaps / frame-covering flares only where a shot names them (drop entries)",
}
HIT = ("kick = frames 0-2 at full amplitude, decays over 6 frames (outExpo); snare (beats 2/4) = secondary element. "
       "Lyrics follow their word/syllable times; object hits follow beat times — never move a word to a beat")

# key: (module, variant)
SB = {
    ("spark", "write"): dict(
        tier="T1", ground="ink",
        beat="the trail (object) snaps forward 24 px per beat; the point flares 1.4x on the kick; camera still",
        lyric="line 0 is revealed stroke by stroke from the real Hangul glyph outlines (opentype path + dash offset) "
              "along the hairline; its strokes briefly form a street / window / circuit structure; line 1 gets "
              "dragged into speed streaks",
        shots=[("s", "black; a point ignites at centre-left on beat 1 and draws one hairline across"),
               ("L0", "the point starts writing line 0; its strokes build a small street-and-window structure"),
               ("W0.1", "the structure swaps to a circuit pattern (hard cut) as the second word lands"),
               ("L1", "tight tracking on the point; line 1 letters smear into speed streaks"),
               ("+10b", "whip: camera overtakes the point")],
        exit="whip-pan into the p03 trace"),
    ("ecg", "heart"): dict(
        tier="T1", ground="ink",
        beat="each heart spike (on the kick) drags the markers and letters 40 px forward (object traction); camera follows with <= 6 px lag",
        lyric="line 2 rides the trace; each spike tows the next letters into view (the heart leads us)",
        shots=[("s", "full-width oscilloscope, two small markers pulled along by the trace"),
               ("W2.2", "3/4 view: the trace as a tow rope, markers and letters dragged in parallax"),
               ("+6b", "tight on one heartbeat cycle with a reticle grid")],
        exit="the trace pulls taut and snaps to a white line → match cut to bone paper"),
    ("screen", "hidden"): dict(
        tier="T1", ground="bone",
        beat="a new nested window frame snaps in per beat (scale 0.8→1 in 4 frames)",
        lyric="line 3 types into the innermost field, cursor block in signal",
        shots=[("s", "frontal UI, three nested windows"),
               ("W3.2", "camera dollies through the window stack; windows slide aside"),
               ("+6b", "the signal core (the future) is revealed and fills a third of frame")],
        exit="the core fills the frame orange"),
    ("press", "dream"): dict(
        tier="T1", ground="bone",
        beat="platen stamp per beat: ink density +30%, paper jolts 6 px down",
        lyric="line 4 printed huge in ink; a signal second pass slides out of register until the words double",
        shots=[("s", "the full poster"),
               ("W4.2", "crop on the misregistered word, halftone visible"),
               ("+6b", "raking side light: the two passes lift off the paper as layers")],
        exit="the paper slides up out of frame"),
    ("wave", "tide"): dict(
        tier="T1", ground="bone",
        beat="the crest impacts on each beat: its silhouette jumps forward and throws a line of dots",
        lyric="line 5 sits on the crest and is carried left; letters bob with the wave height",
        shots=[("s", "side view: a halftone-dot wave rolling in silently from the right edge"),
               ("W5.2", "low angle inside the curl, dots huge"),
               ("+6b", "top view: the wave front as a line of dot rows")],
        exit="the wave swallows the frame to ink"),
    ("sign", "neon"): dict(
        tier="T1", ground="ink", accent=True,
        beat="the next tube stroke flickers on per beat (2 off-frames then on), tube width 2→8 px on ignition",
        lyric="line 6 as hand-bent neon tube lettering switching on stroke by stroke",
        shots=[("s", "the wall frontal, tubes dark"),
               ("W6.2", "tight on the tubes as the next words ignite, electrode buzz"),
               ("+6b", "wide: the glow floods and looms over the wall")],
        exit="all tubes cut out on the downbeat"),
    ("gauge", "countdown"): dict(
        tier="T1", ground="ink",
        beat="the needle tries to rewind on each kick and fails: sprocket slips back one tooth with a 6° overshoot",
        lyric="line 7 on the dial face; each word lands as the rewind fails",
        shots=[("s", "full dial with numeral wheel"),
               ("W7.2", "macro on the sprocket and pawl"),
               ("+6b", "side view: the needle straining against the stop")],
        exit="the needle hits the stop on the downbeat"),
    ("press", "squeeze"): dict(
        tier="T2", ground="bone",
        beat="the roller never stops: each beat it prints the line again, offset 14 px; the stop-latch bounces off on the downbeat",
        lyric="line 8 printed by an unstoppable press roller, overprinted per beat; the paper runs faster each bar",
        shots=[("s", "wide: roller press and paper web"),
               ("W8.2", "top view on the web, overprints stacking"),
               ("+4b", "macro: the stop latch snapping back")],
        exit="the paper runs out of frame"),
    ("spark", "race"): dict(
        tier="T2", ground="ink",
        beat="the point passes one year tick exactly on each beat (tick flashes, 14 px jump)",
        lyric="line 9 is drawn as the point overtakes the ticks; every word lands at its own word time (the Latin word at its start, not moved to a beat)",
        shots=[("s", "side tracking on a timeline ruler"),
               ("W9.2", "ahead of the point: it rushes at the camera"),
               ("W9.4", "overhead: the ruler as a vanishing strip"),
               ("+9b", "the point exits frame right, ticks still flashing")],
        exit="the point leaves the frame"),
    ("blueprint", "room"): dict(
        tier="T2", ground="bone",
        beat="a new wall segment snaps on per beat (line weight 1→3 px pulse)",
        lyric="line 10 is the dimension label along the wall the two points draw",
        shots=[("s", "elevation: two points start drawing walls"),
               ("W10.2", "isometric: floor and door appear"),
               ("W10.4", "plan view: the closed room"),
               ("+12b", "section cut through the room, the two points inside")],
        exit="the door shuts on the downbeat"),
    ("lens", "gaze"): dict(
        tier="T2", ground="ink",
        beat="aperture blades step 1/12 turn per beat on both irises",
        lyric="line 11 is inscribed around the irises; line 12 is readable ONLY in the narrow zone where the two "
              "eyes' light overlaps, with the closed room's wall between them",
        shots=[("s", "two-shot: two irises facing, the room wall between; line 11 starts on the left ring"),
               ("W11.2", "tight left iris, line 11 on its ring"),
               ("L12", "the overlap zone between the eyes, line 12 appears in it"),
               ("W12.1", "tight right iris, the overlap zone with line 12 still in frame")],
        exit="both apertures close"),
    ("ecg", "twin"): dict(
        tier="T2", ground="ink",
        beat="both traces spike on the kick; when the right trace drops out the left one's amplitude dies, and returns with it",
        lyric="line 13 rides between the two traces; they sync their beat (never merge); a thin connecting line forms on the last word",
        shots=[("s", "machine chassis wide, two different pulses apart"),
               ("W13.2", "tight: the right trace falters, the left dies with it"),
               ("W13.4", "they sync beat for beat, still two"),
               ("+12b", "the thin connecting line pulls taut — it becomes the drop's first orbit")],
        exit="the connecting line flares into the drop"),
    ("orbit", "launch"): dict(
        tier="T3", ground="ink",
        beat="each beat launches a panel volley that snaps into orbit; on each downbeat a full-frame polarity swap for one beat (drop-1 entry signature)",
        lyric="none (drop)",
        shots=[("s", "first beat: the star's huge silhouette revealed"),
               ("+1B", "sparse orbits, 3/4 view"),
               ("+2B", "a dense collector plane fills the lower frame")],
        exit="a giant disc of panels occludes the star (top view)"),
    ("blueprint", "orbits"): dict(
        tier="T3", ground="bone",
        beat="ink lines draw in per beat (8 frames each); downbeat stamp",
        lyric="none",
        shots=[("s", "plan view of the orbits"), ("+1B", "elevation sheet"), ("+2B", "detail callout of one panel")],
        exit="the sheet flips to ink"),
    ("orbit", "ring"): dict(
        tier="T3", ground="ink",
        beat="panel flip + star flare per beat",
        lyric="none",
        shots=[("s", "through the gaps between rings"), ("+1B", "behind the star: panel silhouettes cut against the overexposed star (one white frame, then the bar in NEGATIVE as an added effect)"),
               ("+2B", "extreme wide: rings closed")],
        exit="the star flare to white"),
    ("press", "title"): dict(
        tier="T3", ground="bone",
        beat="the title stamps per beat, its width axis stepping 62→125 and weight 300→900 per kick",
        lyric="none (Latin title DYSON SPHERE)",
        shots=[("s", "letters stamped one by one"), ("+1B", "a signal circle stamped behind"),
               ("+2B", "the letter counters turn into panel holes")],
        exit="through the holes into the shell (p-shell-partial)"),
    ("shell", "partial"): dict(
        tier="T3", ground="ink",
        beat="per beat light rays blast out of a different gap (rays sweep 30°); downbeat: a panel clamps shut with a camera jolt",
        lyric="none",
        shots=[("s", "half-built shell, light spilling through gaps"), ("+1B", "inside looking out through a gap"),
               ("+2B", "a panel slams shut toward camera")],
        exit="black"),
    ("split", "torn"): dict(
        tier="T2", ground="bone",
        beat="the seam widens a step per beat but holds; letters wedge into it",
        lyric="lines 14–15 cross the seam between two paper layers (virtual printed grid / real fibrous paper); letters wedge in, nothing tears yet",
        shots=[("s", "frontal: two layers, one seam"),
               ("L15", "raking light on the seam, fibres straining"),
               ("W15.2", "the seam gapes, letters jammed in it"),
               ("+10b", "top-down: the last connecting fibres")],
        exit="held tension (the collapse is p-engrave's first shot)"),
    ("engrave", "hand"): dict(
        tier="T2", ground="ink",
        beat="hatch lines flash per beat; the hand advances 14 px per beat",
        lyric="line 16 = the last fibres give way (collapse on its first syllable); line 17: an engraved steel hand sweeps and scoops the letters",
        shots=[("s", "held tension: the last fibres of the seam from p-split still straining"),
               ("L16", "the last fibre snaps on the first syllable — collapse"),
               ("L17", "wide: the engraved steel hand enters and sweeps"),
               ("W17.3", "close: fingers closing on the letters"),
               ("W17.4", "letters falling through the fingers")],
        exit="the fist closes"),
    ("lens", "ai"): dict(
        tier="T1", ground="ink",
        beat="blades step per beat",
        lyric="the aperture swallows line 18; the stolen words reappear INSIDE the pupil (evidence) together with line 19",
        shots=[("s", "the AI eye full frame, words sucked into the aperture"),
               ("L19", "pupil macro: the stolen words float inside, line 19 reflected")],
        exit="a glint in the pupil flares"),
    ("spark", "glint"): dict(
        tier="T1", ground="ink",
        beat="star radius 3→9 px on the kick, back within 4 frames",
        lyric="inside the pupil's reflection, points assemble a model of a future city while spelling line 20",
        shots=[("s", "constellation of points inside the reflection"),
               ("W20.1", "the points stand up as a small future city model"),
               ("+4b", "the model flattens into a grid of buttons")],
        exit="the grid becomes p-screen-choice's button grid"),
    ("screen", "choice"): dict(
        tier="T1", ground="bone",
        beat="the timer ring loses one segment per beat (snap)",
        lyric="lines 21–22 are the dialog text; options grey out one by one as the words are sung",
        shots=[("s", "the dialog with option buttons"), ("L22", "cursor close-up hovering, unable to click"),
               ("W22.2", "the timer ring fills the frame")],
        exit="the dialog auto-closes"),
    ("gauge", "exp"): dict(
        tier="T2", ground="ink",
        beat="needle +6° overshoot per kick past the red line, settles in 2 frames",
        lyric="line 23 along the exponential curve on the dial",
        shots=[("s", "the dial with an exponential scale"), ("+2b", "needle macro, pinned")],
        exit="the needle snaps off"),
    ("orbit", "capture"): dict(
        tier="T2", ground="ink",
        beat="rings clang shut: whole frame 2 px horizontal jolt, 1 frame hold",
        lyric="line 24 inside the closing cage",
        shots=[("s", "outside: rings closing"), ("W24.2", "inside the cage, the Latin words pressed to the bars")],
        exit="the cage spins to a blur"),
    ("press", "erase"): dict(
        tier="T2", ground="bone",
        beat="a scraper stroke per beat",
        lyric="line 25 stamped, each word scraped away after it is sung",
        shots=[("s", "the stamped poster"), ("W25.2", "scraper close-up"), ("+8b", "empty paper with a ghost impression")],
        exit="blank page"),
    ("popup", "city"): dict(
        tier="T2", ground="bone",
        beat="one paper building hinges up per beat (rotation -(1-f)·π/2, easeBack), >= 8 buildings; white cut edges, cast shadows",
        lyric="line 26 printed on the page floor as the buildings squeeze the passage; line 27 on a street sign; "
              "the paper panel carrying the currently sung words turns toward the camera",
        shots=[("s", "the book three-quarter view, spread opening, fold line visible"),
               ("L27", "low angle between cramped buildings; window cut-outs light a path"),
               ("+8b", "overhead as the last tower rises")],
        exit="the book slams shut on the downbeat → one black frame"),
    ("spark", "merge"): dict(
        tier="T3", ground="ink",
        beat="all marks jump one grid step closer per beat; downbeat = a full-frame signal flare (NOT a polarity swap — contrast with the other T3 plates)",
        lyric="line 28 printed on a grid: marks of different rhythm/length/tilt lose their differences, are forced into a uniform grid, then compressed into one point",
        shots=[("s", "many different marks"), ("+3b", "they snap into a uniform grid (the line printed on it)"),
               ("W28.3", "the grid compresses"), ("+6b", "one point")],
        exit="the point flares"),
    ("ecg", "square"): dict(
        tier="T3", ground="ink",
        beat="each kick the trace lays one raster line down the screen",
        lyric="line 29 rides the scanlines",
        shots=[("s", "bar 1: the living irregular sine hardens into a square wave"),
               ("+3b", "the trace becomes a raster covering the screen line by line"),
               ("W29.4", "flip to bone graph paper: the heartbeat as a regulated spec drawing")],
        exit="the clock stops"),
    ("void", "descent"): dict(
        tier="T3", ground="ink",
        beat="one memory stepping-stone appears per beat, the previous one erases",
        lyric="line 30 engraved on the stepping stones across a black void; stones carry earlier motifs (two points, the room's door, a paper building)",
        shots=[("s", "side view: stones across the void"), ("+3b", "over-the-shoulder along the path"), ("+6b", "top view: the path erasing behind")],
        exit="the last stone drops away"),
    ("shell", "seal"): dict(
        tier="T3", ground="ink",
        beat="a lock pin drives in per kick with a shock ring across the neighbouring panels",
        lyric="line 31 etched on the last panels; the letters of the 'could not hold' words slip out through the last gap",
        shots=[("s", "panels close like fingers around the point of light, light bursts through the gaps"),
               ("+3b", "the last panel is etched syllable by syllable"),
               ("W31.3", "the point escapes through the last gap before it closes"),
               ("+8b", "close on the gap: the lock pins drive in one per kick"),
               ("+12b", "outside: perfectly sealed; inside (cutaway): empty")],
        exit="seal → black"),
    ("blueprint", "stamp"): dict(
        tier="T3", ground="bone",
        beat="beat 1: the stamp lands (paper drops 6 px, ink splatter radius 80 px); following beats: an inspection line sweeps across the empty interior cutaway, ticking",
        lyric="none (SEALED stamp)",
        shots=[("s", "cutaway drawing of the sphere with an EMPTY interior; SEALED stamp slams on it")],
        exit="drop 2 blast"),
    ("press", "burst"): dict(
        tier="T3", ground="bone",
        beat="type slabs crash into depth per beat; on each downbeat a full-frame polarity swap for one beat (drop-2 entry signature)",
        lyric="none",
        shots=[("s", "the printing plate shatters"), ("+1B", "type flies in depth"), ("+2B", "type aligns into raster lines")],
        exit="the raster lines become the demo's copper bars"),
    ("demo", "scene"): dict(
        tier="T3", ground="ink",
        beat="bar 1: raster bars jump 14 px + scroller bounces per beat; bar 2: the rotozoom's phase/scale snaps a step per beat; bar 3: one vector ball lands on its sphere position per beat; downbeat hard cut between effects",
        lyric="none (sine scroller text: DYSON SPHERE · SENTIENT ARCHITECT · greetings)",
        shots=[("s", "copper raster bars + sine scroller (low-res, ordered dither signal<->bone)"),
               ("+1B", "rotozoomer of the hex-panel texture"), ("+2B", "vector balls assembling the sphere")],
        exit="the vector sphere becomes the exploded drawing"),
    ("blueprint", "exploded"): dict(
        tier="T3", ground="bone",
        beat="one part unlatches per beat; dimension lines restamp with the wrong numbers per kick",
        lyric="none",
        shots=[("s", "assembled drawing"), ("+1B", "exploded view"), ("+2B", "detail: a latch drawing")],
        exit="the sheet folds away"),
    ("shell", "whole"): dict(
        tier="T3", ground="ink",
        beat="a panel lock motion per beat (silhouette changes) with a 1-frame camera jolt",
        lyric="none",
        shots=[("s", "exterior: the complete sphere"), ("+1B", "equator cutaway: seam section"),
               ("+2B", "the empty interior where the point was")],
        exit="the equator seam glows"),
    ("sign", "ring"): dict(
        tier="T3", ground="ink", accent=True,
        beat="bar 1: one quarter of the neon ring ignites per kick (tube 2→8 px); bar 2: the four cut sections of the shell open one per beat",
        lyric="none",
        shots=[("s", "contact points lock along the equator"), ("+1B", "the ring cuts the shell open, exposing the interior")],
        exit="the ring dies"),
    ("lens", "star"): dict(
        tier="T3", ground="ink",
        beat="beats 1–2: latch preload clicks; beats 3–8: the six blades close one per beat; aperture 0 on the last beat",
        lyric="none",
        shots=[("s", "the star's observation face"), ("+1B", "aperture side view, blades closing")],
        exit="the last ray is cut"),
    ("shell", "pullback"): dict(
        tier="T1", ground="ink",
        beat="the sealed sphere's seams signal per beat; one star goes out every 2 s, the rest flare on the kick",
        lyric="none",
        shots=[("s", "close on the sealed sphere"), ("+2B", "wide starfield, the sphere small"),
               ("+3B", "the afterimages of the extinguished stars are projected onto the sphere's surface and drain into its seams (the shell as a screen)")],
        exit="the sphere dissolves into lines"),
    ("blueprint", "return"): dict(
        tier="T1", ground="bone",
        beat="one line erases per beat",
        lyric="none",
        shots=[("s", "the sphere as a blueprint"), ("+1B", "lines erasing"), ("+2B", "only the orbit ellipses remain")],
        exit="a blank sheet"),
    ("press", "credits"): dict(
        tier="T1", ground="bone",
        beat="one glyph stamped per kick; the stamp afterimage lasts until the next kick",
        lyric="none (DYSON SPHERE / Sentient Architect)",
        shots=[("s", "title stamped"), ("+1B", "credit line stamped"), ("+2B", "full card")],
        exit="paper to black"),
    ("spark", "outro"): dict(
        tier="T1", ground="ink",
        beat="the point shrinks one step per kick; the hairline undraws at the beat rate; cut at size 0 on the last beat",
        lyric="none",
        shots=[("s", "the point alone, hairline"), ("+2B", "hairline undrawing")],
        exit="black (matches frame 1)"),
}


def beat_at_or_after(t):
    return min((b for b in BEATS if b >= t - 1e-6), default=t)


def resolve(a, p):
    if a == "s":
        return p["start"]
    if a[0] == "L":
        return L[int(a[1:])]["start"]
    if a[0] == "W":
        n, k = a[1:].split(".")
        return L[int(n)]["words"][int(k)]["start"]
    if a[0] == "+":
        n, u = int(a[1:-1]), a[-1]
        if u == "b":
            b0 = BEATS.index(beat_at_or_after(p["start"]))
            return BEATS[min(b0 + n, len(BEATS) - 1)]
        t = p["start"] + n * BAR
        return min(BEATS, key=lambda b: abs(b - t))
    raise ValueError(a)


def max_gap(t0, t1):
    mid = (t0 + t1) / 2
    for name in ("drop1", "climax", "drop2"):
        a, b = SEC[name]
        if a <= mid < b:
            return 1
    for name in ("intro", "outro"):
        a, b = SEC[name]
        if a <= mid < b:
            return 4
    return 2


def main():
    out, errors, md = [], [], []
    md.append("# Storyboard v2 — generated by analysis/storyboard.py (do not edit by hand)\n")
    md.append("Hit tiers: " + " · ".join(f"**{k}** {v}" for k, v in TIERS.items()) + f"\n\nHit envelope: {HIT}.\n")
    total = 0
    for p in E["plates"]:
        key = (p["module"], p["variant"])
        if key not in SB:
            errors.append(f"{p['id']}: no storyboard entry for {key}")
            continue
        s = SB[key]
        shots = []
        for a, d in s["shots"]:
            t = round(resolve(a, p), 3)
            if not (p["start"] - 1e-3 <= t < p["end"]):
                errors.append(f"{p['id']}: shot {a} at {t} outside [{p['start']}, {p['end']})")
            shots.append(dict(t=t, anchor=a, desc=d))
        shots.sort(key=lambda x: x["t"])
        times = [x["t"] for x in shots] + [p["end"]]
        for t0, t1 in zip(times, times[1:]):
            lim = max_gap(t0, t1)
            if t1 - t0 > lim * BAR + 1 / 60:
                errors.append(f"{p['id']}: gap {t1 - t0:.2f}s > {lim} bar(s) between {t0} and {t1}")
        for x0, x1 in zip(shots, shots[1:] + [dict(t=p["end"])]):
            d = x1["t"] - x0["t"]
            lo = 0.35 if s["tier"] == "T3" else 0.5
            if d < lo:
                errors.append(f"{p['id']}: shot at {x0['t']} lasts {d:.3f}s < {lo:.2f}s")
        total += len(shots)
        out.append(dict(id=p["id"], module=p["module"], variant=p["variant"], start=p["start"], end=p["end"],
                        lines=p["lines"], tier=s["tier"], ground=s["ground"], accent=s.get("accent", False),
                        beat=s["beat"], lyric=s["lyric"], exit=s["exit"], event=p["event"], shots=shots))
        md.append(f"## {p['id']}  {p['start']:.2f}–{p['end']:.2f} s · {s['ground']} · {s['tier']}"
                  + (" · ACCENT" if s.get("accent") else "") + (f" · lines {p['lines']}" if p["lines"] else ""))
        md.append(f"- Beat: {s['beat']}\n- Lyric: {s['lyric']}")
        for x in shots:
            md.append(f"- `{x['t']:8.3f}` ({x['anchor']}) {x['desc']}")
        md.append(f"- Exit: {s['exit']}\n")
    # the storyboard owns the event contract: write it back into edit.json so every reader sees the same event
    ev = {x["id"]: (x["lyric"] if x["lines"] else x["shots"][0]["desc"]) + " | shots: " + " → ".join(sh["desc"] for sh in x["shots"])
          for x in out}
    for p in E["plates"]:
        if p["id"] in ev:
            p["event"] = ev[p["id"]]
    for x in out:
        x["event"] = ev[x["id"]]
    (ROOT / "data/edit.json").write_text(json.dumps(E, ensure_ascii=False, indent=1))
    (ROOT / "data/storyboard.json").write_text(json.dumps(dict(tiers=TIERS, hit=HIT, plates=out), ensure_ascii=False, indent=1))
    (ROOT / "docs/STORYBOARD.md").write_text("\n".join(md))
    print(f"{len(out)} plates, {total} shots (+plate cuts = transitions >= {total})")
    for e in errors:
        print("ERROR", e)
    raise SystemExit(1 if errors else 0)


if __name__ == "__main__":
    main()
