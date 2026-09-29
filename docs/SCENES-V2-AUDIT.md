# v2 scene audit — how each ~4-bar plate is composed, and why it feels repetitive (2026-09-29)

User verdict on v2: "도면 화면이 씨발 왜 계속 반복해서 나온느거야?" / "도면씬만 한 10번 나오는데".
The cut rhythm is fine (41 plates, 178 transitions); the **look** is not: the plates collapse into ~6
visual families and share one 3-colour world.

## Plate-by-plate (time · module · what is on screen · look family)

| plate | time (s) | ground | what is on screen | look family |
|---|---|---|---|---|
| p01 spark-write | 0.0–7.0 | ink | a glowing point writes glyph outlines as a circuit trace | light-trace |
| p02 ecg-heart | 7.0–12.1 | ink | oscilloscope heart trace on a graticule, letters ride it | **instrument/scope** |
| p03 screen-hidden | 12.1–16.2 | bone | nested UI windows, line types into the innermost field | **drawing/UI chrome** |
| p04 press-dream | 16.2–20.8 | bone | letterpress line, misregistered second pass | **print on paper** |
| p05 wave-tide | 20.8–24.9 | bone | halftone wave carrying the line | **print on paper** |
| p06 sign-neon | 24.9–29.5 | ink | neon tube lettering on brick | neon |
| p07 gauge-countdown | 29.5–34.2 | ink | sawtooth rewind dial + labelled panel | **instrument/scope** |
| p08 press-squeeze | 34.2–37.6 | bone | roller overprints the line every beat | **print on paper** |
| p09 spark-race | 37.6–43.6 | ink | point races along a year ruler with labels | light-trace (+ annotation) |
| p10 blueprint-room | 43.6–51.1 | bone | floor-plan drawing, dimension label | **drawing** |
| p11 lens-gaze | 51.1–57.5 | ink | two camera irises across a wall | aperture |
| p12 ecg-twin | 57.5–65.1 | ink | two-channel scope chassis | **instrument/scope** |
| p13 orbit-launch | 65.1–72.1 | ink | 3D star, panels volley into orbit | **3D sphere/space** |
| p14 blueprint-orbits | 72.1–79.1 | bone | orbit plan / elevation drawing, REV A stamp | **drawing** |
| p15 orbit-ring | 79.1–86.1 | ink | camera between panel rings | **3D sphere/space** |
| p16 press-title | 86.1–93.1 | bone | DYSON SPHERE poster + orange disc | **print on paper** |
| p17 shell-partial | 93.1–98.3 | ink | half-built hex shell, light through gaps | **3D sphere/space** |
| p18 split-torn | 98.3–106.5 | bone | line crosses a torn paper seam | **print on paper** |
| p19 engrave-hand | 106.5–113.1 | ink | hatch-engraved steel hand | engraving |
| p20 lens-ai | 113.1–117.5 | ink | machine iris swallows the line | aperture |
| p21 spark-glint | 117.5–120.7 | ink | pupil reflection, points build a city | light-trace |
| p22 screen-choice | 120.7–125.3 | bone | UI dialog, options grey out | **drawing/UI chrome** |
| p23 gauge-exp | 125.3–127.6 | ink | exponential dial | **instrument/scope** |
| p24 orbit-capture | 127.6–130.0 | ink | 3D ring cage closes on the line | **3D sphere/space** |
| p25 press-erase | 130.0–135.6 | bone | stamped words scraped away | **print on paper** |
| p26 popup-city | 135.6–141.2 | bone | pop-up book city | paper craft 3D |
| p27 spark-merge | 141.2–145.3 | ink | marks lock into a grid, collapse to a point | light-trace |
| p28 ecg-square | 145.3–150.8 | ink→bone | sine → square wave → graph-paper spec sheet | **instrument → drawing** |
| p29 void-descent | 150.8–155.3 | ink | stepping stones over a void | void |
| p30 shell-seal | 155.3–163.6 | ink | sphere seals, lock pins | **3D sphere/space** |
| p31 blueprint-stamp | 163.6–165.3 | bone | cutaway drawing + SEALED stamp | **drawing** |
| p32 press-burst | 165.3–172.3 | bone | printing plate shatters into sorts | **print on paper** |
| p33 demo-scene | 172.3–179.3 | ink | 90s demo tiles, copper bars, honeycomb | demoscene |
| p34 blueprint-exploded | 179.3–186.3 | bone | exploded assembly drawing | **drawing** |
| p35 shell-whole | 186.3–193.3 | ink | complete sphere, cutaway | **3D sphere/space** |
| p36 sign-ring | 193.3–198.0 | ink | neon ring on the equator | neon |
| p37 lens-star | 198.0–202.6 | ink | observation iris closes on the star | aperture |
| p38 shell-pullback | 202.6–212.0 | ink | pull back from the sphere, stars go out | **3D sphere/space** |
| p39 blueprint-return | 212.0–219.0 | bone | the sphere as a blueprint, lines erase | **drawing** |
| p40 press-credits | 219.0–225.9 | bone | title + credits stamped | **print on paper** |
| p41 spark-outro | 225.9–232.3 | ink | the point shrinks per beat to nothing | light-trace |

## Counts (the root cause)

| look family | plates | |
|---|---|---|
| drawing (+UI chrome, spec sheet) | p03 p10 p14 p22 p28 p31 p34 p39 | **8** |
| print on paper (bone + ink + orange) | p04 p05 p08 p16 p18 p25 p32 p40 | **8** |
| 3D sphere/space | p13 p15 p17 p24 p30 p35 p38 | **7** |
| instrument/scope/dial | p02 p07 p12 p23 (p28) | **4–5** |
| light-trace point | p01 p09 p21 p27 p41 | 5 |
| aperture | p11 p20 p37 | 3 |
| neon | p06 p36 | 2 |
| engraving / pop-up / void / demoscene | 1 each | 4 |

~10 families for 41 plates. On top of that, one palette (ink / bone / signal orange) and one annotation habit
(mono labels, title blocks, crosshairs) runs through every bone plate, so "print" and "drawing" merge into one
"도면" family of ~16 plates. The v2 spec capped plate length and required ≥8 idioms, but set **no cap on how
often an idiom repeats**, and the module plan (blueprint ×5, press ×6, shell ×4, spark ×5) baked the repetition in.
