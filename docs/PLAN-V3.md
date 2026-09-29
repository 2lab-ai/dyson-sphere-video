# v3 plan — one look per plate + three history sequences (2026-09-29; trinity R1–R5 → see "Trinity decisions" at the end, which OVERRIDE the draft table)

## User requirements (verbatim, binding)
1. "도면 화면이 씨발 왜 계속 반복해서 나온느거야? 리서치해서 매번 화면이 다른 느낌이 들게 해줘"
2. "4초마다 씬들을 어떻게 구성했는지 요약하고 그 내용으로 최대한 중복이 없고 매씬마다 최대한 다르게 표현해서 (아니 도면씬만 시발 한 10번 나오는데 병신아) 여러가지 다채롭고 골고루 나오게해줘"
3. New sequences:
   - "빅뱅부터 시작해서 우주가 팽창하고 태양이 생기고 지구가 생기고 달의 원조행성이 지구에 충돌하고 달이 생기는 씬 (8마디는 써야할듯?)"
   - "지구에 첫 생명이 탄생하고 진화를 거듭해서 바다에서 육지로, 숲에서 두발로 일어서는 호모 사피엔스의 여정"
   - "호모 사피엔스의 언어가 발생하고 문자가 발생하고 종교, 중세를 지나 기계를 만들고 증기기관 원자폭탄 최초의 컴퓨터, 인터넷, 그리고 AI가 나오는 여정"
4. "따로 추가해달라고 했던 카드나 8비트 씬같은것도 8마디 정도는 추가할수 있을듯" (pop-up card and 8-bit demoscene may grow to ~8 bars each)
5. Process: "먼저 전체를 기획하고 그 기획 내용부터 트리니티 리뷰를 하고 전체적으로 구성에 대해서 고민하고 그 다음에 시작해줘"
6. Standing from v2: a scene change at least every 4 bars; the beat always visible; lyrics part of the image (no karaoke); one pop-up-book plate (landfill/A.I. technique); one 1990s demoscene-taste plate.

## Inputs
- v2 audit (why it repeats): `docs/SCENES-V2-AUDIT.md`. 41 plates collapse into about 10 looks: drawing ×8, print-on-cream ×8, 3D sphere ×7, scope/dial ×4–5. There is one palette (ink/bone/orange) and mono annotation chrome everywhere.
- Idiom research (37 looks, refs, techniques, palettes, families E/S/H/M/P/A, sequencing rules): scratchpad `idiom-research.md`.
- Grid: 102.97 BPM, bar 2.3308 s. Sections: intro 0–2.19 · verse1 –34.82 · pre1 –65.12 · drop1 –97.75 (14 bars, instrumental) · bridge –109.41 · verse2 –128.05 · pre2 –142.04 · climax –165.34 · drop2 –202.64 (16 bars, instrumental) · outro –232.30 (12.7 bars, instrumental).

## Story arc (new)
The film becomes a history of energy and mind, from the first light to the sphere that captures it.
- **Vocal sections:** the song's present tense, AI and us. Plate boundaries are unchanged from v2 because they are already line-true.
- **drop1:** the origin, Big Bang → Moon (9 bars), then life to Homo sapiens as a pop-up natural-history book (5.5 bars).
- **drop2:** civilization, fire and speech → AI (16 bars). The computer and internet era is the demoscene, so the "8-bit" plate grows to 5 bars.
- **outro:** AI builds the Dyson sphere around the Sun. The Sun from drop1 is enclosed; pull back; credits; the point.

The sphere construction (v2 drop1) moves to the outro, as the destination of the whole arc.

## Constants that hold the variety together (from the research §2: Prince/"Cry"/"Star Guitar" grammar)
1. **One Korean typeface family** for every lyric. Only the material changes: beam, carve, stitch, scan, print.
2. **The circle** (ㅇ / sun / cell / eye / sphere) anchored at the same screen point (right-third golden point) at every plate's first frame. It is the match-cut anchor.
3. **Cuts on bar lines** (vocal plates on line-true beats, as v2).
4. **Signal orange is the one warm thread** in every palette. Cream is no longer a default ground: at most 3 plates.
5. **Beat visible** in every plate, in that plate's idiom (v2 rule, gate-checked).

## Plate plan (46 plates; ✱ = new module or new idiom variant)

| # | time (s) | bars | sec | lyric | content | idiom (research id) | fam | module |
|---|---|---|---|---|---|---|---|---|
| 1 | 0.00–6.96 | 3.0 | intro/v1 | L0–1 | a point writes the first words as a circuit trace | light-trace on black | E | spark (keep) |
| 2 | 6.96–12.10 | 2.2 | v1 | L2 | the machine heart X-rayed: ribs of gears, the letters as bone-white radiograph | ✱ X-ray radiograph (S2) | S | xray ✱ |
| 3 | 12.10–16.17 | 1.7 | v1 | L3 | a wall of CRT TVs (Paik); the line scrolls across tubes and one tube hides "the future" | ✱ CRT video wall (E2) | E | crt ✱ (replaces screen) |
| 4 | 16.17–20.84 | 2.0 | v1 | L4 | the dream printed in fluorescent pink + blue riso that drifts out of register | ✱ risograph (P6) | P | press → riso variant |
| 5 | 20.84–24.94 | 1.8 | v1 | L5 | the high-tech tide as a Ben-Day comic wave, dots swelling on the beat | ✱ Ben-Day comic (P7) | P→ swap adjacency | wave → comic variant |
| 6 | 24.94–29.53 | 2.0 | v1 | L6 | neon tubes switching on over brick | neon | E | sign (keep) |
| 7 | 29.53–34.24 | 2.0 | v1 | L7 | a Saul Bass cut-paper clock that can't be rewound | ✱ Saul Bass cut-paper (P1) | P | gauge → bass variant |
| 8 | 34.24–37.56 | 1.4 | pre1 | L8 | time as long-exposure light-painting trails (Gjon Mili) writing the line | ✱ light painting (M4) | M | lightpaint ✱ |
| 9 | 37.56–43.56 | 2.6 | pre1 | L9 | a stadium LED ticker; AGI overtakes the scrolling years | ✱ LED wall (E3) | E | led ✱ (replaces spark-race) |
| 10 | 43.56–51.13 | 3.2 | pre1 | L10 | LiDAR sweep scanning the room "you and I made"; two figures appear as point returns | ✱ LiDAR scan (S3) | S | lidar ✱ (replaces blueprint) |
| 11 | 51.13–57.55 | 2.8 | pre1 | L11–12 | two camera irises across a wall (brass, film palette) | aperture | M | lens (keep, reskin) |
| 12 | 57.55–65.12 | 3.2 | pre1 | L13 | two XY-oscilloscope Lissajous figures that sync, green phosphor | ✱ oscilloscope XY (E1) | E | ecg → xy variant |
| 13 | 65.12–69.78 | 2 | drop1 | — | **Big Bang**: black → a singular point → the drop hits → white-hot inflation; plasma cools in ink-in-water curls | ✱ fluid cosmos (M3, *Tree of Life*) | M | cosmos ✱ |
| 14 | 69.78–74.44 | 2 | drop1 | — | **expansion**: the cosmic web grows, the camera zooms out a power of ten per beat | ✱ Powers-of-Ten (A3) | A | cosmos |
| 15 | 74.44–79.10 | 2 | drop1 | — | **the Sun ignites**: a nebula collapses → the Sun in SDO false colour, granulation pulsing on the kick | ✱ SDO solar (S5) | S | cosmos |
| 16 | 79.10–83.77 | 2 | drop1 | — | **Earth accretes; Theia strikes**: molten clay planets, stepped 12 fps, the impact on the downbeat | ✱ claymation (M2) | M | cosmos |
| 17 | 83.77–86.10 | 1 | drop1 | — | **the Moon forms**: the debris ring gathers into a full moon in Korean ink wash (sumuk) | ✱ ink wash (H2) | H | cosmos |
| 18 | 86.10–90.76 | 2 | drop1 | — | **life (pop-up book 1)**: the page opens on a primordial sea, a cell divides per beat, fish rise | pop-up | P | popup ✱ variant `life-sea` |
| 19 | 90.76–98.33 | 3.2 | drop1 | — | **life (pop-up book 2)**: onto land → forest → an ape stands up on two feet (Homo sapiens) on the last beat | pop-up | P | popup ✱ variant `life-land` |
| 20 | 98.33–106.49 | 3.5 | bridge | L14–15 | virtual vs real: the frame is torn, one side an ASCII Hangul raster, the other lit | ✱ ASCII raster (E6) | E | split → ascii variant |
| 21 | 106.49–113.11 | 2.8 | bridge/v2 | L16–17 | the steel hand, hatch engraving | engraving | H | engrave (keep) |
| 22 | 113.11–117.49 | 1.9 | v2 | L18–19 | the machine eye swallows the words | aperture | M | lens (keep) |
| 23 | 117.49–120.66 | 1.4 | v2 | L20 | the future seen from orbit: Earth's night lights spell the line (Black Marble) | ✱ night lights (S6) | S | blackmarble ✱ |
| 24 | 120.66–125.26 | 2.0 | v2 | L21–22 | a flip-disc departure board; the choices flip away | ✱ flip-disc (E4) | E | flipdisc ✱ (replaces screen) |
| 25 | 125.26–127.57 | 1.0 | v2 | L23 | Swiss-grid kinetic type accelerating | ✱ Swiss poster (P4) | P | swiss ✱ (replaces gauge) |
| 26 | 127.57–130.04 | 1.1 | pre2 | L24 | the cage closes (3D rings) | 3D lit | M | orbit (keep) |
| 27 | 130.04–135.63 | 2.4 | pre2 | L25 | the voice of freedom dissolves into a Turrell colour field | ✱ Ganzfeld (A2) | A | colorfield ✱ (replaces press-erase) |
| 28 | 135.63–141.24 | 2.4 | pre2 | L26–27 | pop-up city (pop-up book 3) | pop-up | P | popup (keep) |
| 29 | 141.24–145.30 | 1.7 | climax | L28 | marks merge into one point | light-trace | E | spark (keep) |
| 30 | 145.30–150.78 | 2.4 | climax | L29 | heartbeats flatten into machine regularity: Unknown Pleasures ridgelines | ✱ pulsar ridges (S7) | S | ecg → ridge variant |
| 31 | 150.78–155.35 | 2.0 | climax | L30 | stepping stones across the abyss | void | A | void (keep) |
| 32 | 155.35–163.59 | 3.5 | climax | L31 | Weather Project sodium sun; silhouettes reach for it; the line etched in the disc | ✱ sodium mono sun (A1) | A | sodium ✱ (replaces shell-seal) |
| 33 | 163.59–167.67 | 1.75 | climax/drop2 | — | **fire & speech**: a cave wall, ochre handprints, firelight on the beat, the first sounds as sparks | ✱ cave ochre (new H) | H | cave ✱ |
| 34 | 167.67–170.00 | 1 | drop2 | — | **writing**: wedges pressed into clay (lit matter) → the jamo of 훈민정음 assemble (Ahn Sang-soo) | ✱ clay tablet → Ahn jamo (M2/H1) | M | glyphs ✱ |
| 35 | 170.00–174.67 | 2 | drop2 | — | **religion → Middle Ages**: a stained-glass rose window lights up pane by pane, becomes a Bayeux embroidery strip | ✱ stained glass → embroidery (H5/H7) | H | glass ✱ |
| 36 | 174.67–177.00 | 1 | drop2 | — | **machines**: clockwork automata and the printing press in Reiniger silhouette theatre | ✱ silhouette (P2) | P | silhouette ✱ |
| 37 | 177.00–181.66 | 2 | drop2 | — | **steam**: a locomotive in a thermal camera; pistons flare on the beat | ✱ thermal ironbow (S1) | S | thermal ✱ |
| 38 | 181.66–186.32 | 2 | drop2 | — | **the atomic bomb**: silence → whiteout on the downbeat → a 1-bit dithered mushroom cloud (Obra Dinn) | ✱ 1-bit dither (P8) | P | dither ✱ |
| 39 | 186.32–190.98 | 2 | drop2 | — | **first computer** (8-bit 1): ENIAC panel lamps → a PET/C64 boot screen → first raster bars | demoscene | E | demo ✱ variant `boot` |
| 40 | 190.98–197.97 | 3 | drop2 | — | **internet** (8-bit 2): modem handshake → copper bars, sine scroller of jamo, the network lights up node by node | demoscene | E | demo (keep, extended) |
| 41 | 197.97–202.64 | 2 | drop2 | — | **AI**: an Ikeda data flood condenses into a liquid-chrome face/eye | ✱ liquid chrome (M1) | M | chrome ✱ |
| 42 | 202.64–207.30 | 2 | outro | — | **AI launches the swarm**: collector volleys snap into orbit around the Sun from #15 | 3D lit | M→ see adjacency | orbit (keep) |
| 43 | 207.30–211.96 | 2 | outro | — | **the shell closes**: hex panels painted in dancheong (Korean ornament) lock shut | ✱ dancheong shell (H3) | H | shell → dancheong variant |
| 44 | 211.96–216.62 | 2 | outro | — | **pull back**: the enclosed Sun goes dark; other stars go dark too (other spheres) | 3D lit | M | shell (keep, pullback) |
| 45 | 216.62–225.94 | 4 | outro | — | title + credits: constructivist wedge typography, stamped on the beat | ✱ constructivist (P5) | P | press → credits variant |
| 46 | 225.94–232.30 | 2.7 | outro | — | the point shrinks per beat to nothing | light-trace | E | spark (keep) |

Retired entirely: blueprint (all 5 plates), screen (UI chrome), gauge (dial chrome), the v2 press-title, shell-seal, spark-race, lens-star. Mono annotation chrome (title blocks, dimension labels, crosshair marks) is banned.

## Counts
- idioms used: 36 distinct for 46 plates.
- Repeats that remain: pop-up ×3 (user-asked), demoscene ×2 (user-asked), light-trace ×3 (the through-line point: open / merge / close), aperture ×2, 3D-lit orbit/shell ×3 (the finale).
- Cream ground ≤ 3 plates (pop-up book pages).

## Mechanical enforcement (gate additions, fail-closed)
- `look` per plate in edit.json (idiom id + family + palette name).
- An idiom repeats only if it's on an allow-list (pop-up, demo, light-trace, aperture, 3D-lit); non-allowed idioms appear at most once.
- No two adjacent plates share an idiom. The same family may not appear in 3 consecutive plates.
- No family more than 3 times in any 8-plate window.
- Cream-ground plates ≤ 3; the blueprint/drawing idiom id is banned; annotation chrome is banned by an AST scan of mono-font labels in scenes.
- Palette: `palette.ts` gains a named palette per idiom. Scenes may only use tokens of their plate's palette, plus `signal`.

## Build order
1. Editor: the new cut list (46 plates) + storyboard rows for new plates, then gate additions, then the storyboard trinity.
2. Modules: new modules one per agent (per-unit dispatch), reskin variants per agent.
3. Contact-sheet review per module → full-song sheet → render → push → upload.

## Open questions for the panel
1. Is the arc right? Specifically: the sphere moves to the outro; sodium sun at #32 instead of shell-seal; history sequences placed in drop1/drop2.
2. Are the idiom assignments well matched to line meaning and era? Any obvious swaps?
3. Adjacency: #4/#5 (P, P), #41/#42/#43/#44 (M, M, H, M) and #21/#22 etc. Propose fixes.
4. Is 46 plates with 36 idioms buildable at quality? What to cut if not (scope)?
5. Palette: is reopening the palette per idiom right, with orange as the one thread, or is that chaos?

## Trinity decisions (R1–R5, unanimous — consensus at R5/5; these override the draft table)

Final cut: **45 plates** (#36 deleted). Changes to the draft table:
- **#5** → M3 ink-in-water ocean (`#021C1E/#2C7873/#FFB400`), side-on flowing wave. M3 may be used only on {#5, #13}. #13 is a frontal gold/white expansion out of darkness. Composition, luminance and motion are specified per plate.
- **#7** Saul Bass on a **mustard ground** (`#F2C14E`). **#11** lens is **bright, overexposed film stock**. Together they break the #8–#15 dark run.
- **#13 / #14 / #19** science reading: the Big Bang is NOT a bomb going off in empty space (space itself expands everywhere). #14 shows the distances between structures growing (metric expansion), not a plain camera zoom. #19: gait changes across several lineages, and a human appears last, NOT "one ape stands up = Homo sapiens".
- **#25** Swiss → **H1 Ahn Sang-soo jamo**: jamo break apart as change accelerates and reassemble on the downbeat. This is the film's only Korean-letterform plate.
- **drop2 re-timed**:
  - #33 fire and speech (cave ochre) 163.59–167.67
  - #34 clay tablet / cuneiform only, 167.67–172.33 (2 bars)
  - #35 stained glass only, 172.33–177.00 (2)
  - **#36 deleted** (the silhouette module is not built)
  - #37 thermal 177.00–181.66 (2): opens on clockwork gears and linkages, whose motion carries into pistons and a locomotive. One idiom; only the subject changes.
  - #38 atomic bomb, 1-bit dither, 181.66–186.32 (2)
  - #39 demo `boot` (first computer) 186.32–190.98 (2)
  - #40 demo `internet` 190.98–197.97 (3)
  - #41 demo `ai` 197.97–202.64 (2): a data flood (≤3 flashes/s) condenses into a low-res face. **The chrome module is deleted.**
- **Demo = 7 bars.** Reported honestly: the user asked for "~8", and 7 are scheduled; the atomic bomb keeps 2 bars.
- **Pop-up**: life #18–19 = 5.25 bars; all pop-up plates incl. #28 = 7.65 bars.
- **Finale camera**: #42 lateral track in orbit → #43 looking up from inside the dancheong shell → #44 exterior wide pull-back.
- **Sequence exceptions** (plate-ID scoped): popup {#18, #19} and demo {#39, #40, #41}. Each sequence totals ≤8 bars and needs a hard boundary event (page turn / boot→network). There is a storyboard shot at every bar boundary, plus the `sameState` check. Variant names count as the canonical idiom.

### Gates (edit-gate additions)
- Adjacency is judged on the **canonical idiom**, not the module (so #13–17 `cosmos` passes while its looks differ). Exempt only inside a declared sequence.
- Family: no 3 in a row; at most 3 of one family in any 8-plate window. One named exception: the #39–46 window, E×4 (a direct result of the demo sequence). **No** adjacent-family ban; #31 void stays family A.
- Ground: `light:false` at most 4 in a row. Plates with only the ink/bone/signal B/C/O palette ≤ 8. Cream ground ≤ 3.
- No forced circle on every plate. **Match-circle gate** covers only #41→#42 (eye→sun), #42→#43 and #43→#44. Candidates #11→12, #17→18 and #22→23 get declared and gated only if the animatic shows a real match-cut. #15→#32 is a motif rhyme, never gated. *(S5 R5: unanimous on the three gated pairs. Candidate promotion after the animatic is optional: grok/fable allow it, gpt-6 would not add it. It never gates by default.)*
- Pixel ΔL/Δhue: a diagnostic in the animatic. It is promoted to fail-closed only after FP/FN validation on known similar/dissimilar pairs; otherwise video review stays the gate.
- Retire the blueprint module and the annotation helpers (titleBlock / crosshair / dimension), with a code grep gate. The mono-font AST scan is auxiliary. Large-area flashes are checked on the output video: ≤3 flashes/s on #38–#41.

### Build order
Final cut list + exception rules → a **real-length animatic of the whole song** from one generic module (per-plate ground/palette/subject/camera/lyric placement) + the 4-second summary table → review of 3 risky transition clips (#4–5, #16–19, #37–44) → module dispatch, one agent per unit (cosmos #13–17 = 5 units).
