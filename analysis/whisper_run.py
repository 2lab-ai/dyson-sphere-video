"""Run mlx-whisper (Korean, word timestamps) on the vocal stem -> work/whisper.json."""
import common  # noqa: F401  (sets cache dirs)
import json
import mlx_whisper
import soundfile as sf

y, sr = common.load_stem("vocals", sr=16000)
sf.write(common.WORK / "vocals16k.wav", y, sr)
res = mlx_whisper.transcribe(
    str(common.WORK / "vocals16k.wav"), path_or_hf_repo="mlx-community/whisper-large-v3-turbo",
    language="ko", word_timestamps=True, condition_on_previous_text=False,
    initial_prompt="다이슨 스피어, 우주, 별, 태양, 문명에 관한 신스팝 노래 가사.",
    temperature=0.0, no_speech_threshold=None, hallucination_silence_threshold=None,
)
(common.WORK / "whisper.json").write_text(json.dumps(res, ensure_ascii=False, indent=1, default=float))
print(len(res["segments"]), "segments")
