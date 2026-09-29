"""Storyboard v3 -> data/storyboard.json + docs/STORYBOARD.md (editor-owned; binding spec docs/PLAN-V3.md).

Every plate in data/edit.json gets: hit tier, ground (from its look), beat mechanism, lyric surface, exit, the planned
subject (kind + position/scale on the 1920x1080 frame: what the animatic draws and the 4-s table reports), the lyric
placement (position, size, rotation, material hint), and a shot list whose times are computed from the real data
(line/word starts, beats, bars) and checked against:
- the max-gap rules, strictest section touched (as gapCap() in app/src/engine/shots.ts): drop1 / climax / drop2
  <= 1 bar, other vocal sections <= 2 bars, intro/outro <= 4 bars
- minimum shot length (T3 0.35 s, else 0.5 s)
- consecutive shots differ in camera (`cam`: the animatic's structural state)
- sequence plates (edit `sequence`) have a shot at every downbeat inside the plate
Anchors: 's' plate start · 'L<n>' line n start · 'W<n>.<k>' word k of line n · '+<k>b' k beats after the plate's
first beat · '+<k>B' k bars after the plate start (snapped to the nearest beat) · 'D<k>' the k-th downbeat after
the plate start.
Rows whose (module, variant) is already built in v2 keep the v2 shot anchors unchanged (their .shots.ts files are
keyed to them): spark write/merge/outro, sign neon, lens gaze/ai, engrave hand, orbit capture, void descent,
popup city, press credits.
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
E = json.loads((ROOT / "data/edit.json").read_text())
L = json.loads((ROOT / "data/lyrics.json").read_text())["lines"]
A = json.loads((ROOT / "data/audio.json").read_text())
BAR, BEATS, DOWNS = E["bar"], A["beats"], A["downbeats"]
SECTIONS = A["sections"]
GAP_BARS = dict(intro=4, verse1=2, pre1=2, drop1=1, bridge=2, verse2=2, pre2=2, climax=1, drop2=1, outro=4)
W, H = 1920, 1080
# the match-cut circle anchor (PLAN-V3 constant 2): the right-third golden point
CX, CY = round(W * 0.618), round(H * 0.382)

TIERS = {
    "T1": "verse/outro: camera/post shake <= 6 px, flare <= 1.4x (object motion is choreography, not capped)",
    "T2": "pre-chorus/bridge: camera/post shake <= 14 px, flare <= 2x; downbeat scale punch <= 1.06x",
    "T3": "drop/climax: every beat a BIG structural hit specific to the plate (the object itself moves/locks/"
          "breaks); full-frame flashes only where a shot names them, <= 3 large flashes/s on #38-#41",
}
HIT = ("kick = frames 0-2 at full amplitude, decays over 6 frames (outExpo); snare (beats 2/4) = secondary element. "
       "Lyrics follow their word/syllable times; object hits follow beat times — never move a word to a beat")


def subj(kind, x, y, s, **kw):
    """The planned main subject: kind (animatic proxy), centre (px), scale (fraction of frame height)."""
    return dict(kind=kind, x=x, y=y, s=s, **kw)


def lyr(x, y, size, mat, rot=0.0, align="center", vertical=False):
    """Lyric placement: anchor (px), glyph size (px), material hint, rotation (rad)."""
    return dict(x=x, y=y, size=size, mat=mat, rot=rot, align=align, vertical=vertical)


NOLYR = None

# key: (module, variant). shots: (anchor, cam, description)
SB = {
    # ------------------------------------------------------------------ verse 1
    ("spark", "write"): dict(  # built (v2 anchors)
        tier="T1", beat="the trail (object) snaps forward 24 px per beat; the point flares 1.4x on the kick; camera still",
        lyric="line 0 is revealed stroke by stroke from the real Hangul glyph outlines along the hairline; its strokes "
              "briefly form a street / window / circuit structure; line 1 gets dragged into speed streaks",
        subject=subj("point", 560, 540, 0.02), lyr=lyr(960, 600, 150, "beam"),
        shots=[("s", "wide", "black; a point ignites at centre-left on beat 1 and draws one hairline across"),
               ("L0", "track", "the point starts writing line 0; its strokes build a small street-and-window structure"),
               ("W0.1", "macro", "the structure swaps to a circuit pattern (hard cut) as the second word lands"),
               ("L1", "close", "tight tracking on the point; line 1 letters smear into speed streaks"),
               ("+10b", "side", "whip: camera overtakes the point")],
        exit="whip-pan into the X-ray"),
    ("xray", "heart"): dict(
        tier="T1", beat="each kick the radiograph re-exposes: the ribs/gears flash bone-white and decay; the gear train steps one tooth",
        lyric="line 2 is the bone-white radiograph of letters inside the ribcage of gears, exposed word by word",
        subject=subj("ribs", 960, 520, 0.8), lyr=lyr(960, 560, 120, "radiograph"),
        shots=[("s", "wide", "a lightbox: the whole chest of the machine, ribs made of gears, heart a clockwork pump"),
               ("W2.2", "close", "the film slides: close on the heart pump, letters as bone inside it"),
               ("+6b", "side", "lateral view (a second film): the gear train in profile, letters stacked like vertebrae")],
        exit="the lightbox switches off to black"),
    ("crt", "wall"): dict(
        tier="T1", beat="every beat one tube rolls its vertical hold (a bar snaps), the wall's brightness pulses on the kick",
        lyric="line 3 scrolls across the tubes, one syllable per tube; one tube stays dark, hiding the future",
        subject=subj("tvgrid", 960, 540, 0.9, cols=6, rows=4), lyr=lyr(960, 560, 110, "scan"),
        shots=[("s", "wide", "a wall of 24 CRT TVs (Paik), the line scrolling across them"),
               ("W3.2", "close", "close on 4 tubes: scanlines, the scrolling syllables"),
               ("+6b", "macro", "the one dark tube: a warm dot (the hidden future) inside its glass")],
        exit="the tubes collapse to a dot one by one"),
    ("press", "riso"): dict(
        tier="T1", beat="per beat the pink pass slips 6 px further out of register; the drum stamp flashes the ink density",
        lyric="line 4 printed huge in riso blue, a fluorescent pink pass drifting out of register until the words double",
        subject=subj("poster", 900, 520, 0.8), lyr=lyr(900, 560, 190, "print", rot=-0.05),
        shots=[("s", "wide", "the full riso poster, blue and pink passes nearly aligned"),
               ("W4.2", "macro", "crop on the misregistered word: grain and dot noise of the drum"),
               ("+6b", "tilt", "the sheet tilted on the tray, the passes clearly apart")],
        exit="the sheet is pulled out of frame"),
    ("wave", "ocean"): dict(
        tier="T1", beat="the crest surges forward on each beat, curls of amber light break off it on the kick",
        lyric="line 5 rides the crest of an ink-in-water wave, letters carried left and diffusing at their edges",
        subject=subj("wave", 960, 620, 0.5), lyr=lyr(1100, 470, 120, "ink"),
        shots=[("s", "side", "side-on: a teal ink wave rolling in from the right, flowing left"),
               ("W5.2", "low", "low angle into the curl, amber light threads in the teal"),
               ("+6b", "close", "close on the crest: the letters diffusing like ink")],
        exit="the wave covers the frame in teal"),
    ("sign", "neon"): dict(  # built (v2 anchors)
        tier="T1", accent=True,
        beat="the next tube stroke flickers on per beat (2 off-frames then on), tube width 2→8 px on ignition",
        lyric="line 6 as hand-bent neon tube lettering switching on stroke by stroke",
        subject=subj("tubes", 960, 520, 0.6), lyr=lyr(960, 540, 150, "tube"),
        shots=[("s", "wide", "the wall frontal, tubes dark"),
               ("W6.2", "close", "tight on the tubes as the next words ignite, electrode buzz"),
               ("+6b", "flat", "wide: the glow floods and looms over the wall")],
        exit="all tubes cut out on the downbeat"),
    ("gauge", "bass"): dict(
        tier="T1", beat="the paper hand tries to rewind on each kick and fails: it jerks back one notch and snaps forward",
        lyric="line 7 cut out of paper along the clock rim; each word lands as the rewind fails",
        subject=subj("bassclock", 820, 540, 0.75), lyr=lyr(1250, 820, 110, "cut", rot=-0.08, align="center"),
        shots=[("s", "wide", "a cut-paper clock on mustard, jagged hands, the line along the rim"),
               ("W7.2", "close", "close on the hands straining against a paper stop"),
               ("+6b", "tilt", "the clock face tilts; a black paper arrow pins the hands")],
        exit="the paper clock tears away on the downbeat"),
    # ------------------------------------------------------------------ pre 1
    ("lightpaint", "time"): dict(
        tier="T2", beat="each beat a new light stroke is added and the oldest one fades out of the exposure",
        lyric="line 8 is written by a light pen in long exposure; the trail stays as the line",
        subject=subj("trails", 960, 540, 0.8), lyr=lyr(960, 540, 140, "beam", rot=0.04),
        shots=[("s", "wide", "black studio, a figure's light pen draws the first trail"),
               ("W8.2", "track", "tracking along the trail as the pen writes the line"),
               ("+4b", "flat", "the full exposure: all trails at once, the figure a blur")],
        exit="the shutter closes to black"),
    ("led", "ticker"): dict(
        tier="T2", beat="the ticker jumps one LED column per beat; the year counter flips on each kick",
        lyric="line 9 scrolls on the stadium LED ribbon; AGI overtakes the scrolling years",
        subject=subj("ticker", 960, 560, 0.35), lyr=lyr(960, 575, 130, "led"),
        shots=[("s", "wide", "a curved stadium LED ribbon, years scrolling"),
               ("W9.2", "low", "low angle under the ribbon, the dots huge"),
               ("W9.4", "side", "down the length of the ribbon, the letters racing past the years"),
               ("+9b", "close", "close on the LEDs: the counter overtaken")],
        exit="the ribbon goes dark column by column"),
    ("lidar", "room"): dict(
        tier="T2", beat="the scanner's sweep line passes once per beat, leaving a fresh shell of returns",
        lyric="line 10 appears as point returns on the wall the sweep reveals",
        subject=subj("scan", 960, 560, 0.8), lyr=lyr(960, 420, 110, "lidar"),
        shots=[("s", "wide", "a black room: a sweep line starts revealing the walls as points"),
               ("W10.2", "top", "overhead: the floor plan fills in as returns"),
               ("W10.4", "side", "side angle: two figures appear as point clouds"),
               ("+12b", "close", "close on the two figures, near points orange, far points blue")],
        exit="the scanner stops; the points fade far to near"),
    ("lens", "gaze"): dict(  # built (v2 anchors); reskin: bright film stock
        tier="T2", beat="aperture blades step 1/12 turn per beat on both irises",
        lyric="line 11 is inscribed around the irises; line 12 is readable ONLY in the zone where the two eyes' light overlaps",
        subject=subj("iris2", 960, 540, 0.45), lyr=lyr(960, 820, 100, "etch"),
        shots=[("s", "wide", "two-shot: two irises facing across a wall, overexposed film; line 11 starts on the left ring"),
               ("W11.2", "close", "tight left iris, line 11 on its ring"),
               ("L12", "flat", "the overlap zone between the eyes, line 12 appears in it"),
               ("W12.1", "macro", "tight right iris, the overlap zone with line 12 still in frame")],
        exit="both apertures close"),
    ("ecg", "xy"): dict(
        tier="T2", beat="both Lissajous figures jump a phase step on each kick; the beam brightens for 3 frames",
        lyric="line 13 is drawn by the beam between the two figures (vector strokes), sung syllables at full phosphor",
        subject=subj("lissajous", 960, 500, 0.6), lyr=lyr(960, 860, 110, "phosphor"),
        shots=[("s", "wide", "a scope screen: two different Lissajous figures, green phosphor"),
               ("W13.2", "close", "one figure falters, the other dims with it"),
               ("W13.4", "macro", "the figures lock into the same ratio: synced"),
               ("+12b", "flat", "the whole scope bezel; the beam collapses to one dot before the drop")],
        exit="the beam collapses to a point (the singularity before the drop)"),
    # ------------------------------------------------------------------ drop 1: origin
    ("bigbang", "bang"): dict(
        tier="T3", beat="per beat the whole frame's temperature steps down one notch (white → gold → red) and every curl "
                        "grows (space expanding everywhere at once, no centre)",
        lyric="none",
        subject=subj("flood", 960, 540, 1.0), lyr=NOLYR,
        shots=[("s", "flat", "the drop hits: the WHOLE frame is white-hot at once, uniform, no centre, no edge"),
               ("+1B", "close", "it cools into gold ink-in-water curls filling the frame; every curl drifts apart from every other")],
        exit="the curls thin out into filaments"),
    ("cosmicweb", "web"): dict(
        tier="T3", beat="each beat the spacing between the nodes grows one step while every node keeps its size "
                        "(metric expansion, not a zoom)",
        lyric="none",
        subject=subj("lattice", 960, 540, 1.0), lyr=NOLYR,
        shots=[("s", "wide", "the cosmic web: nodes and filaments; the gaps between them grow per beat"),
               ("+1B", "tilt", "re-framed at the next power of ten: clusters of galaxies inside the filaments, still separating")],
        exit="one node brightens (a nebula)"),
    ("solar", "sun"): dict(
        tier="T3", beat="granulation pulses on the kick; a prominence arcs out on each downbeat",
        lyric="none",
        subject=subj("sun", CX, CY, 0.62), lyr=NOLYR,
        shots=[("s", "wide", "a nebula collapses to a point at the anchor"),
               ("+1B", "close", "the Sun ignites, SDO 304 false colour, granulation boiling on the kick")],
        exit="the Sun's limb flares"),
    ("impact", "theia"): dict(
        tier="T3", beat="the clay planets move stepped at 12 fps; each beat one clay lump accretes onto the proto-Earth",
        lyric="none",
        subject=subj("planets", 900, 560, 0.45), lyr=NOLYR,
        shots=[("s", "wide", "a clay proto-Earth accreting lumps; a smaller clay planet (Theia) approaches"),
               ("+1B", "close", "the impact on the downbeat: clay splashes, a ring of debris flies out")],
        exit="debris spreads into a ring"),
    ("moon", "sumuk"): dict(
        tier="T3", beat="each beat one ink stroke of the ring gathers into the moon disc",
        lyric="none",
        subject=subj("moon", CX, CY, 0.4), lyr=NOLYR,
        shots=[("s", "wide", "ink wash on grey hanji: the debris ring gathers into a full moon, seal stamp on the last beat")],
        exit="the moon becomes the pop-up book's sun"),
    ("popup", "life-sea"): dict(
        tier="T3", beat="per beat one paper piece hinges up: the cell divides (1→2→4→8), then fish rise",
        lyric="none",
        subject=subj("card", 960, 600, 0.7, scene="sea"), lyr=NOLYR,
        shots=[("s", "wide", "the natural-history book opens (hard page-turn): a primordial paper sea, one cell"),
               ("+1B", "low", "low angle across the paper waves: the cells divide, fish rise from the fold")],
        exit="page turn (hard boundary)"),
    ("popup", "life-land"): dict(
        tier="T3", beat="per beat a new paper creature hinges up and takes one step, each with its own gait",
        lyric="none",
        subject=subj("card", 960, 600, 0.7, scene="land"), lyr=NOLYR,
        shots=[("s", "wide", "page 2: the shore — a tetrapod crawls out of the paper sea"),
               ("+1B", "side", "the forest pops up: several lineages, several gaits (knuckle-walking, climbing)"),
               ("+2B", "track", "tracking along the fold: several upright hominins walk side by side, each different"),
               ("+3B", "close", "a human appears last, at the end of the line (not one ape standing up)")],
        exit="the book closes on the bridge downbeat"),
    # ------------------------------------------------------------------ bridge / verse 2
    ("split", "ascii"): dict(
        tier="T2", beat="the tear widens a step per beat; the ASCII side re-rasters one density step on the kick",
        lyric="lines 14–15 cross the tear: on the left they are an ASCII Hangul raster, on the right lit and solid",
        subject=subj("ascii", 960, 540, 1.0), lyr=lyr(960, 540, 130, "ascii"),
        shots=[("s", "wide", "the frame torn vertically: left an amber ASCII raster, right a lit room"),
               ("L15", "close", "close on the tear, glyph cells vs light"),
               ("W15.2", "tilt", "the tear gapes, letters half glyph, half solid"),
               ("+10b", "macro", "macro on the last cells flipping")],
        exit="the raster side swallows the frame"),
    ("engrave", "hand"): dict(  # built (v2 anchors)
        tier="T2", beat="hatch lines flash per beat; the hand advances 14 px per beat",
        lyric="line 16 = the last fibres give way (collapse on its first syllable); line 17: an engraved steel hand sweeps and scoops the letters",
        subject=subj("hand", 1000, 560, 0.7), lyr=lyr(760, 460, 120, "etch"),
        shots=[("s", "close", "held tension: the last fibres of the tear still straining"),
               ("L16", "macro", "the last fibre snaps on the first syllable — collapse"),
               ("L17", "wide", "wide: the engraved steel hand enters and sweeps, Prussian blue plate"),
               ("W17.3", "close", "close: fingers closing on the letters"),
               ("W17.4", "low", "letters falling through the fingers")],
        exit="the fist closes"),
    ("lens", "ai"): dict(  # built (v2 anchors); reskin: chrome iris on a white cyc
        tier="T1", beat="blades step per beat",
        lyric="the aperture swallows line 18; the stolen words reappear INSIDE the pupil together with line 19",
        subject=subj("iris", 960, 540, 0.55), lyr=lyr(960, 540, 110, "etch"),
        shots=[("s", "wide", "the chrome machine eye full frame on a white cyc, words sucked into the aperture"),
               ("L19", "macro", "pupil macro: the stolen words float inside, line 19 reflected")],
        exit="a glint in the pupil"),
    ("blackmarble", "future"): dict(
        tier="T1", beat="city lights twinkle up one grid step per beat; the terminator line advances on the kick",
        lyric="line 20 is spelled by the night lights of cities on the dark Earth",
        subject=subj("globe", 960, 900, 1.2), lyr=lyr(960, 640, 120, "lights"),
        shots=[("s", "wide", "Earth at night from orbit, the limb glowing, cities as lights"),
               ("W20.1", "close", "closer: the lights spell the line across a continent"),
               ("+4b", "top", "straight down: the grid of lights, like a circuit")],
        exit="the lights switch off in a wave"),
    ("flipdisc", "choice"): dict(
        tier="T1", beat="one row of discs flips per beat with a mechanical clack (a flash of yellow)",
        lyric="lines 21–22 are flipped in yellow discs on the departure board; the choices flip away row by row",
        subject=subj("discs", 960, 540, 0.9, cols=32, rows=12), lyr=lyr(960, 540, 120, "disc"),
        shots=[("s", "wide", "a departure board of flip discs, destinations as choices"),
               ("L22", "close", "close on the discs flipping, yellow to black"),
               ("W22.2", "side", "down the length of the board: rows cleared")],
        exit="the board goes black"),
    ("jamo", "ahn"): dict(
        tier="T1", beat="per beat the jamo fly further apart (faster each beat); on the downbeat they snap back together",
        lyric="line 23 in Ahn Sang-soo-style deconstructed jamo, black/red/blue on white, the film's only Korean-letterform plate",
        subject=subj("jamo", 960, 540, 0.7), lyr=lyr(960, 560, 220, "jamo"),
        shots=[("s", "wide", "the line assembled in geometric jamo on white"),
               ("+2b", "close", "the jamo break apart, circles and bars flying")],
        exit="they reassemble on the downbeat (the cut)"),
    ("orbit", "capture"): dict(  # built (v2 anchors)
        tier="T2", beat="rings clang shut: whole frame 2 px horizontal jolt, 1 frame hold",
        lyric="line 24 inside the closing cage",
        subject=subj("rings", 960, 540, 0.8), lyr=lyr(960, 560, 120, "beam"),
        shots=[("s", "wide", "outside: 3D steel rings closing"), ("W24.2", "inside", "inside the cage, the Latin words pressed to the bars")],
        exit="the cage spins to a blur"),
    ("colorfield", "freedom"): dict(
        tier="T2", beat="the field breathes on the beat: the aperture's edge softens 4% and the dawn stop brightens",
        lyric="line 25 dissolves into the colour field: each word fades into the light after it is sung",
        subject=subj("field", 960, 540, 1.0), lyr=lyr(960, 540, 140, "haze"),
        shots=[("s", "wide", "a Turrell aperture in a wall, dawn light inside"),
               ("W25.2", "push", "pushing into the aperture, its edge vanishing"),
               ("+8b", "flat", "Ganzfeld: no edges left, only dawn")],
        exit="the field turns to page white"),
    ("popup", "city"): dict(  # built (v2 anchors)
        tier="T2", beat="one paper building hinges up per beat (rotation -(1-f)·π/2, easeBack), >= 8 buildings; white cut edges, cast shadows",
        lyric="line 26 printed on the page floor as the buildings squeeze the passage; line 27 on a street sign",
        subject=subj("card", 960, 600, 0.7, scene="city"), lyr=lyr(960, 900, 90, "paper"),
        shots=[("s", "wide", "the book three-quarter view, spread opening, fold line visible"),
               ("L27", "low", "low angle between cramped buildings; window cut-outs light a path"),
               ("+8b", "top", "overhead as the last tower rises")],
        exit="the book slams shut on the downbeat → one black frame"),
    # ------------------------------------------------------------------ climax
    ("spark", "merge"): dict(  # built (v2 anchors)
        tier="T3", beat="all marks jump one grid step closer per beat; downbeat = a full-frame signal flare",
        lyric="line 28 printed on a grid: marks of different rhythm/length/tilt are forced into a uniform grid, then compressed into one point",
        subject=subj("marks", 960, 540, 0.7), lyr=lyr(960, 820, 110, "beam"),
        shots=[("s", "wide", "many different marks"), ("+3b", "flat", "they snap into a uniform grid (the line printed on it)"),
               ("W28.3", "close", "the grid compresses"), ("+6b", "macro", "one point")],
        exit="the point flares"),
    ("ecg", "ridge"): dict(
        tier="T3", beat="each kick a new ridgeline enters at the bottom and the stack shifts up one row",
        lyric="line 29 rides the top ridge; the peaks flatten into identical machine pulses as it is sung",
        subject=subj("ridges", 960, 560, 0.8), lyr=lyr(960, 200, 110, "beam"),
        shots=[("s", "wide", "stacked pulsar ridgelines, white on black, each peak different"),
               ("+3b", "tilt", "oblique over the stack, the peaks becoming identical"),
               ("W29.4", "top", "flat from above: perfectly regular lines, the heartbeat gone")],
        exit="the lines go flat"),
    ("void", "descent"): dict(  # built (v2 anchors)
        tier="T3", beat="one memory stepping-stone appears per beat, the previous one erases",
        lyric="line 30 engraved on the stepping stones across a black void",
        subject=subj("stones", 960, 640, 0.3), lyr=lyr(960, 700, 100, "carve"),
        shots=[("s", "side", "side view: stones across the void"), ("+3b", "over", "over-the-shoulder along the path"), ("+6b", "top", "top view: the path erasing behind")],
        exit="the last stone drops away"),
    ("sodium", "sun"): dict(
        tier="T3", beat="per kick the haze pulses brighter; one silhouette raises an arm on each beat",
        lyric="line 31 etched into the sodium disc; the last words slip out through its rim",
        subject=subj("sodium", CX, CY, 0.5), lyr=lyr(CX, CY + 20, 70, "etch"),
        shots=[("s", "wide", "the hall in amber haze, a huge mono-frequency sun, silhouettes on the floor"),
               ("+3b", "low", "low from the floor, silhouettes reaching up"),
               ("W31.3", "close", "close on the disc: the etched line"),
               ("+8b", "up", "looking straight up at the mirrored ceiling, the crowd reflected"),
               ("+12b", "flat", "wide: the sun alone in the haze")],
        exit="the sun dims to an ember → firelight"),
    # ------------------------------------------------------------------ drop 2: civilization
    ("cave", "fire"): dict(
        tier="T3", beat="firelight flares on the beat; a handprint is stamped in ochre on each kick",
        lyric="none (the first sounds are sparks rising from the fire)",
        subject=subj("cave", 960, 560, 0.8), lyr=NOLYR,
        shots=[("s", "wide", "a cave wall in firelight, ochre handprints appearing"),
               ("D1", "close", "drop 2: close on a handprint, sparks (the first sounds) fly up")],
        exit="a spark lands on wet clay"),
    ("clay", "tablet"): dict(
        tier="T3", beat="one cuneiform wedge is pressed per beat, the stylus hit flicks the raking light",
        lyric="none",
        subject=subj("tablet", 960, 560, 0.7), lyr=NOLYR,
        shots=[("s", "wide", "a clay tablet under raking light, a stylus pressing wedges"),
               ("+1B", "macro", "macro: the wedges' shadows, rows of cuneiform")],
        exit="the tablet's light turns to a window's light"),
    ("glass", "rose"): dict(
        tier="T3", beat="one ring of panes lights per beat, from the centre outward",
        lyric="none",
        subject=subj("rose", 960, 540, 0.85), lyr=NOLYR,
        shots=[("s", "wide", "a dark rose window, panes lighting from the centre"),
               ("+1B", "up", "looking up at the window, the whole rose ablaze")],
        exit="the light through the rose turns to heat"),
    ("thermal", "steam"): dict(
        tier="T3", beat="pistons flare white-hot on the beat; gears glow one step hotter per bar",
        lyric="none",
        subject=subj("thermal", 960, 560, 0.7), lyr=NOLYR,
        shots=[("s", "close", "thermal camera: clockwork gears and linkages turning, heat in the teeth"),
               ("+1B", "side", "the linkages drive pistons, then a locomotive thunders through (one idiom, the subject changes)")],
        exit="the loco's heat blooms white"),
    ("dither", "bomb"): dict(
        tier="T3", beat="silence (no pulse) for 1 bar; whiteout on the downbeat; then the cloud rises one dither band per beat",
        lyric="none",
        subject=subj("mushroom", 960, 620, 0.8), lyr=NOLYR,
        shots=[("s", "flat", "a 1-bit desert and a test tower; silence"),
               ("+1B", "wide", "WHITEOUT on the downbeat, then a 1-bit dithered mushroom cloud rises"),
               ("+6b", "low", "low: the cloud's column towering")],
        exit="the cloud's pixels become ENIAC lamps"),
    ("demo", "boot"): dict(
        tier="T3", beat="panel lamps blink in a binary count per beat; bar 2: the raster bar jumps 14 px per beat",
        lyric="none",
        subject=subj("boot", 960, 540, 0.8), lyr=NOLYR,
        shots=[("s", "wide", "ENIAC panels: rows of lamps counting"),
               ("+1B", "close", "hard cut: a PET/C64 boot screen, blinking cursor, then the first raster bars")],
        exit="boot → network (hard boundary)"),
    ("demo", "internet"): dict(
        tier="T3", beat="copper bars bounce per beat; one network node lights per kick",
        lyric="none (the sine scroller carries jamo, not lyric lines)",
        subject=subj("copper", 960, 540, 0.9), lyr=NOLYR,
        shots=[("s", "flat", "modem handshake: a scrolling carrier waveform"),
               ("+1B", "wide", "copper bars + a sine scroller of jamo"),
               ("+2B", "top", "the network lights up node by node")],
        exit="the nodes flood into data"),
    ("demo", "ai"): dict(
        tier="T3", beat="the data flood shifts one block per beat (large flashes <= 3/s); it condenses a step per bar",
        lyric="none",
        subject=subj("face", CX, CY, 0.7), lyr=NOLYR,
        shots=[("s", "flat", "an Ikeda data flood: black barcodes on white"),
               ("+1B", "close", "the flood condenses into a low-res face; its eye is a circle at the anchor")],
        exit="match cut: the eye becomes the Sun"),
    # ------------------------------------------------------------------ outro: the sphere
    ("orbit", "swarm"): dict(
        tier="T1", beat="a collector volley launches per beat and snaps into orbit",
        lyric="none",
        subject=subj("swarm", CX, CY, 0.35), lyr=NOLYR,
        shots=[("s", "track", "lateral track in orbit: the Sun (from #15) at the anchor, volleys launching"),
               ("+1B", "wide", "wider: the swarm rings the Sun")],
        exit="match cut: the ringed Sun becomes the shell's oculus"),
    ("shell", "dancheong"): dict(
        tier="T1", beat="one ring of hex panels locks shut per beat, with a painted flash",
        lyric="none",
        subject=subj("vault", CX, CY, 0.9), lyr=NOLYR,
        shots=[("s", "up", "looking up from inside the shell: dancheong hex panels around the Sun at the anchor"),
               ("+1B", "close", "the last panels lock shut, the oculus closes")],
        exit="match cut: the closed oculus becomes the sealed sphere"),
    ("shell", "pullback"): dict(
        tier="T1", beat="one star goes dark per beat; the sealed sphere's seams pulse on the kick",
        lyric="none",
        subject=subj("pullback", CX, CY, 0.25), lyr=NOLYR,
        shots=[("s", "close", "exterior: the sealed sphere at the anchor, the Sun gone dark"),
               ("+1B", "pull", "pulling back wide: other stars go dark too (other spheres)")],
        exit="black field → title"),
    ("press", "credits"): dict(  # built (v2 anchors); reskin: constructivist
        tier="T1", beat="one glyph stamped per kick; the stamp afterimage lasts until the next kick",
        lyric="none (DYSON SPHERE / Sentient Architect)",
        subject=subj("wedge", 960, 540, 0.8), lyr=NOLYR,
        shots=[("s", "wide", "red field: a black wedge drives in, the title stamped"), ("+1B", "tilt", "credit line stamped along the wedge"), ("+2B", "flat", "full card")],
        exit="the red field to black"),
    ("spark", "outro"): dict(  # built (v2 anchors)
        tier="T1", beat="the point shrinks one step per kick; the hairline undraws at the beat rate; cut at size 0 on the last beat",
        lyric="none",
        subject=subj("point", 960, 540, 0.02), lyr=NOLYR,
        shots=[("s", "wide", "the point alone, hairline"), ("+2B", "close", "hairline undrawing")],
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
    if a[0] == "D":
        ds = [d for d in DOWNS if d > p["start"] + 1e-3]
        return ds[int(a[1:]) - 1]
    if a[0] == "+":
        n, u = int(a[1:-1]), a[-1]
        if u == "b":
            b0 = BEATS.index(beat_at_or_after(p["start"]))
            return BEATS[min(b0 + n, len(BEATS) - 1)]
        t = p["start"] + n * BAR
        return min(BEATS, key=lambda b: abs(b - t))
    raise ValueError(a)


def max_gap_bars(t0, t1):
    """The strictest section cap touched by [t0, t1) — same rule as gapCap() in app/src/engine/shots.ts."""
    caps = [GAP_BARS.get(s["name"], 2) for s in SECTIONS if s["end"] > t0 + 1e-6 and s["start"] < t1 - 1e-6]
    return min(caps) if caps else 2


def main():
    out, errors, md = [], [], []
    md.append("# Storyboard v3 — generated by analysis/storyboard.py (do not edit by hand)\n")
    md.append("Spec: docs/PLAN-V3.md (Trinity decisions override the draft table). Plate numbers `#n` are PLAN-V3 rows "
              "(#36 is deleted).\n")
    md.append("Hit tiers: " + " · ".join(f"**{k}** {v}" for k, v in TIERS.items()) + f"\n\nHit envelope: {HIT}.\n")
    total = 0
    for p in E["plates"]:
        key = (p["module"], p["variant"])
        if key not in SB:
            errors.append(f"{p['id']}: no storyboard entry for {key}")
            continue
        s = SB[key]
        if bool(p["lines"]) != (s["lyr"] is not None):
            errors.append(f"{p['id']}: lyric placement {'missing' if p['lines'] else 'given for an instrumental plate'}")
        shots = []
        for a, cam, d in s["shots"]:
            t = round(resolve(a, p), 3)
            if not (p["start"] - 1e-3 <= t < p["end"]):
                errors.append(f"{p['id']}: shot {a} at {t} outside [{p['start']}, {p['end']})")
            shots.append(dict(t=t, anchor=a, cam=cam, desc=d))
        shots.sort(key=lambda x: x["t"])
        if shots and abs(shots[0]["t"] - p["start"]) > 1e-3:
            errors.append(f"{p['id']}: first shot not at the plate start")
        times = [x["t"] for x in shots] + [p["end"]]
        for t0, t1 in zip(times, times[1:]):
            lim = max_gap_bars(t0, t1)
            if t1 - t0 > lim * BAR + 1 / 60:
                errors.append(f"{p['id']}: gap {t1 - t0:.2f}s > {lim} bar(s) between {t0} and {t1}")
        for x0, x1 in zip(shots, shots[1:] + [dict(t=p["end"])]):
            d = x1["t"] - x0["t"]
            lo = 0.35 if s["tier"] == "T3" else 0.5
            if d < lo:
                errors.append(f"{p['id']}: shot at {x0['t']} lasts {d:.3f}s < {lo:.2f}s")
        for x0, x1 in zip(shots, shots[1:]):
            if x0["cam"] == x1["cam"]:
                errors.append(f"{p['id']}: consecutive shots at {x0['t']} and {x1['t']} share cam '{x0['cam']}'")
        if p.get("sequence"):
            for d in DOWNS:
                if p["start"] - 1e-3 <= d < p["end"] - 1e-3 and not any(abs(x["t"] - d) <= 1 / 60 for x in shots):
                    errors.append(f"{p['id']}: sequence plate has no shot at the bar boundary {d:.3f}")
        total += len(shots)
        lk = p["look"]
        out.append(dict(id=p["id"], n=p["n"], module=p["module"], variant=p["variant"], start=p["start"], end=p["end"],
                        lines=p["lines"], tier=s["tier"], ground=lk["ground"], idiom=lk["idiom"], family=lk["family"],
                        palette=lk["palette"], sequence=p.get("sequence"), accent=s.get("accent", False),
                        beat=s["beat"], lyric=s["lyric"], subject=s["subject"], lyr=s["lyr"], exit=s["exit"],
                        event=p["event"], shots=shots))
        md.append(f"## #{p['n']} {p['id']}  {p['start']:.2f}–{p['end']:.2f} s · {lk['idiom']} ({lk['family']}) · "
                  f"{lk['ground']} · palette `{lk['palette']}` · {s['tier']}"
                  + (" · ACCENT" if s.get("accent") else "") + (f" · sequence {p['sequence']}" if p.get("sequence") else "")
                  + (f" · lines {p['lines']}" if p["lines"] else ""))
        md.append(f"- Event: {p['event']}")
        sj = s["subject"]
        md.append(f"- Subject: {sj['kind']} at ({sj['x']}, {sj['y']}), scale {sj['s']}")
        md.append(f"- Beat: {s['beat']}\n- Lyric: {s['lyric']}"
                  + (f" — placed at ({s['lyr']['x']}, {s['lyr']['y']}), {s['lyr']['size']} px, material `{s['lyr']['mat']}`"
                     if s["lyr"] else ""))
        for x in shots:
            md.append(f"- `{x['t']:8.3f}` ({x['anchor']}, cam `{x['cam']}`) {x['desc']}")
        md.append(f"- Exit: {s['exit']}\n")
    (ROOT / "data/storyboard.json").write_text(json.dumps(dict(version=3, tiers=TIERS, hit=HIT, anchor=dict(x=CX, y=CY),
                                                                plates=out), ensure_ascii=False, indent=1))
    (ROOT / "docs/STORYBOARD.md").write_text("\n".join(md))
    print(f"{len(out)} plates, {total} shots (+plate cuts = transitions >= {total})")
    for e in errors:
        print("ERROR", e)
    raise SystemExit(1 if errors else 0)


if __name__ == "__main__":
    main()
