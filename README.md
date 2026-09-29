# Dyson Sphere — music video

A generative, code-rendered music video for **"Dyson Sphere"** by [Sentient Architect](https://www.youtube.com/@SentientArchitect)
(neon Korean synth-pop, 102.97 BPM, 3:52). Word-synced kinetic Hangul typography over beat-reactive neon shader plates:
every frame is a deterministic function of song time, so the browser preview and the offline 1080p60 export are identical.

Original track: https://youtu.be/LQVLjC1zJ-0

The renderer is a fork of the engine from [mexicat/pdoom-video](https://github.com/mexicat/pdoom-video) (MIT, Giacomo Magnanini):
timeline playback, HDR compositing, bloom/halation/grain post, adaptive motion blur and the headless-Chrome → ffmpeg exporter.
The analysis, the lyric layer, the palette and every scene are new. Made with Claude (Opus 5.5) in Claude Code.

## The edit

| Section | Time | Plate | Lyrics |
|---|---|---|---|
| intro / verse 1a | 0:00 | `ignite` — hyperspace streaks, a star is born, first collectors swing into orbit | karaoke |
| verse 1b | 0:18 | `grid` — synthwave grid, caged retro sun, a neon wave building | karaoke |
| pre-chorus 1 | 0:35 | `tunnel` — hex tunnel through a shell under construction | stack |
| drop 1 | 1:05 | `swarm` — the Dyson swarm assembles, DYSON SPHERE title slams | — |
| bridge | 1:38 | `glitch` — virtual vs real, the seam shatters | slam |
| verse 2 | 1:49 | `eye` — the AI eye, mechanical iris | karaoke |
| pre-chorus 2 | 2:08 | `tunnel` (ember variant) | stack |
| climax | 2:22 | `shell` — the sphere closes panel by panel | slam |
| drop 2 | 2:45 | `kaleido` — kaleidoscopic lattice euphoria | — |
| outro | 3:23 | `afterglow` — the sealed sphere, title card, fade | — |

On top of every plate a song-wide beat layer (`fx` in `app/src/timeline.ts`) punches the zoom on kicks, jolts and
colour-splits the frame on snares, flashes on downbeats and inverts for a beat every fourth bar in the hot sections.

## Layout

- `audio/dyson.mp3` — the song.
- `lyrics/lyrics.ko.vtt` — the lyric sheet (the channel's own subtitle track, cue-level timing).
- `analysis/` — Python (uv) tools that produced the timing data:
  - Demucs (`htdemucs`) stems: `uv run python -m demucs -n htdemucs -o stems work/mix.wav`
  - `whisper_run.py` — mlx-whisper (large-v3-turbo, Korean) word timestamps on the vocal stem
  - `align.py` — character-level alignment of the lyric sheet to the ASR words → `data/lyrics.json` (word + syllable timings)
  - `analyze.py` — tempo/beat grid (kick phase-coherence fit), envelopes, kick/snare/hat/vocal onsets, sections → `data/audio.json`
- `app/` — the renderer (TypeScript + three.js, bun + Vite).
  - `src/engine/` — renderer core; `hud.ts` is the lyric layer (karaoke / stack / slam styles, per-syllable fill).
  - `src/scenes/` — one module per plate; `_shader.ts` is the shared full-screen shader base.
  - `src/timeline.ts` — the edit, lyric style per line, and the beat FX.
  - `scripts/render.ts` — offline renderer.

## Run

Requirements: [bun](https://bun.sh), Google Chrome, ffmpeg with libx264; [uv](https://docs.astral.sh/uv/) for the analysis.

```sh
# (optional) regenerate the timing data
ffmpeg -i audio/dyson.mp3 -ar 44100 analysis/work/mix.wav
cd analysis && uv sync
uv run python -m demucs -n htdemucs -o stems work/mix.wav
uv run python whisper_run.py && uv run python align.py && uv run python analyze.py

# preview (space = play, ←/→ seek, [ ] scenes)
cd app && bun install && bunx vite

# export
bun scripts/render.ts video --samples 4 --shutter 0.4 --out ../out/dyson.mp4
bun scripts/render.ts sheet --from 60 --to 100 --n 12   # contact sheet
```

## Credits

- Song: "Dyson Sphere" — Sentient Architect.
- Engine: [pdoom-video](https://github.com/mexicat/pdoom-video) by Giacomo Magnanini (MIT).
- Fonts (SIL Open Font License): Black Han Sans, Do Hyeon, Archivo, IBM Plex Mono.

## License

Code: MIT (see `LICENSE`). The song, its lyrics and the rendered video belong to Sentient Architect.
