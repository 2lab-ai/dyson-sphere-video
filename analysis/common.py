"""Shared paths / cache setup for the dyson analysis scripts.

Import this module FIRST (before torch / huggingface / mlx imports) so that all
model downloads land in analysis/.cache/.
"""
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent          # analysis/
PROJECT = ROOT.parent
CACHE = ROOT / ".cache"
for var, sub in [("TORCH_HOME", "torch"), ("XDG_CACHE_HOME", "xdg"), ("MPLCONFIGDIR", "mpl"),
                 ("NUMBA_CACHE_DIR", "numba")]:
    os.environ.setdefault(var, str(CACHE / sub))
    (CACHE / sub).mkdir(parents=True, exist_ok=True)

AUDIO = PROJECT / "audio" / "dyson.mp3"
WAV = ROOT / "work" / "mix.wav"               # gapless decode of AUDIO = the time reference
STEMS = ROOT / "stems" / "htdemucs" / "mix"
DATA = PROJECT / "data"
WORK = ROOT / "work"
WORK.mkdir(exist_ok=True)
DATA.mkdir(exist_ok=True)


def load_stem(name, sr=None):
    """Load a Demucs stem (mono). Stems are separated from WAV, so they share its timeline."""
    import soundfile as sf
    y, s = sf.read(STEMS / f"{name}.wav", dtype="float32", always_2d=True)
    y = y.mean(axis=1)
    if sr and sr != s:
        import librosa
        y = librosa.resample(y, orig_sr=s, target_sr=sr)
        s = sr
    return y, s
