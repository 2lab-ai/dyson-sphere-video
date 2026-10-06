# v4 correction pass R1 — brief for every unit fixer

Read `docs/BUILD-V4.md` first (mechanism, rules, receipt). Then the two defect sources for your plates:
1. `docs/FIXES-V4-R1.md` — what the contact sheets showed (sheet defects).
2. `out/_check/hit-gate-v4-check.fails.txt` — what the render-based gate measured on the first full render
   (`out/dyson-v4-check.mp4`, 540p). Per plate: beat hit rate (must be ≥0.75), downbeats without a hit, ground class.
   A miss tuple is (beat time, Δ/255 measured, threshold/255, ΔmeanLum/255, changed-area, persistence).

## What a beat hit is, measured
`scripts/hit-gate.py` samples 3 frames before and 3 after each beat (192×108 grey, full frame). A hit needs
`Δ ≥ max(4/255, min(5×plate-median, median+10/255))` AND (`ΔmeanLum ≥ 8/255` OR `changed-area ≥ 4 %`) AND persistence
(the change is still ≥50 % there 6 frames later). So: **a held state change of the subject that moves ≥4 % of the frame**
— a 20 px jolt of a large object, a lit element that stays lit, a scale step that holds. Small sparkles and single-frame
flashes do not count. Hosted plates now get a uniform snap from `engine/world.ts` (the subject steps up 7 % on every beat
and eases back) — that alone lifts a slot-sized subject by roughly 2–3/255; your plate still needs its own held mark.

## Receipt per unit (replaces BUILD-V4's sheet step)
1. `cd app && bun scripts/edit-gate.ts` → `GATE PASS` (37 checks); `bunx tsc --noEmit -p .` clean.
2. Partial render of your span: `cd app && bun scripts/render.ts video --from <A> --to <B> --height 540 --samples 1 --crf 20 --out ../out/_check/v4-fix-<unit>.mp4`
   then `cd .. && .venv/bin/python -I scripts/hit-gate.py out/_check/v4-fix-<unit>.mp4 --from <A>` → every plate of yours
   at rate ≥0.75, no downbeat misses, ground class = declared. Paste that output verbatim in your hand-back.
3. A contact sheet of the same span (`render.ts sheet … --out ../out/_check/v4-fix-<unit>.png`), read it, one line per plate.
4. Commit through a PRIVATE index (`GIT_INDEX_FILE=$(mktemp) git add <your paths> && GIT_INDEX_FILE=… git commit`), one commit
   `v4 fix <UNIT>: …` with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Never `git add -A`, never amend.
   Do NOT touch `data/edit.json`, `engine/world.ts`, `scripts/hit-gate.py`.

If a tool guard starts rejecting your calls, stop and return the exact state as text.
