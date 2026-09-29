"""Word timings for the lyric sheet.

The uploader subtitle track (lyrics/lyrics.ko.vtt) has the correct text with cue-level timing; Whisper
(work/whisper.json, see whisper_run.py) has word timing but mis-hears words. Align the two character by
character (Hangul syllables / latin letters, whitespace and punctuation ignored): every lyric character
that matches an ASR character takes its time, the rest are interpolated, all clamped into the cue window.
Each eojeol (space-separated word) then starts at its first character's time and ends where the next
word starts (or at the cue end). Writes data/lyrics.json in the renderer's format.
"""
import common
import json, re
from difflib import SequenceMatcher

KEEP = re.compile(r"[가-힣A-Za-z0-9]")


def ts(s):
    h, m, rest = s.split(":")
    return int(h) * 3600 + int(m) * 60 + float(rest)


def parse_vtt(path):
    cues, cur = [], None
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if "-->" in line:
            a, b = [x.strip().split(" ")[0] for x in line.split("-->")]
            cur = dict(start=ts(a), end=ts(b), lines=[])
            cues.append(cur)
        elif cur is not None and line and not line.startswith("["):
            cur["lines"].append(line)
        elif cur is not None and line.startswith("[") and "]" in line and line.index("]") < len(line) - 1:
            cur["lines"].append(line[line.index("]") + 1:].strip())
    return [c for c in cues if c["lines"]]


def asr_chars():
    d = json.loads((common.WORK / "whisper.json").read_text())
    out = []
    for s in d["segments"]:
        for w in s["words"]:
            cs = [c for c in w["word"] if KEEP.match(c)]
            n = max(len(cs), 1)
            for i, c in enumerate(cs):
                out.append((c.lower(), w["start"] + (w["end"] - w["start"]) * i / n))
    return out


def main():
    cues = parse_vtt(common.PROJECT / "lyrics" / "lyrics.ko.vtt")
    # lyric characters with their cue, line and word indices
    lines, chars = [], []
    for ci, c in enumerate(cues):
        for text in c["lines"]:
            li = len(lines)
            words = text.split()
            lines.append(dict(text=text, cue=ci, words=words))
            for wi, w in enumerate(words):
                for ch in w:
                    if KEEP.match(ch):
                        chars.append(dict(c=ch.lower(), cue=ci, line=li, word=wi, t=None))
    asr = asr_chars()
    sm = SequenceMatcher(None, [c["c"] for c in chars], [a[0] for a in asr], autojunk=False)
    for a, b, n in sm.get_matching_blocks():
        for k in range(n):
            ch, t = chars[a + k], asr[b + k][1]
            cue = cues[ch["cue"]]
            if cue["start"] - 0.6 <= t <= cue["end"] + 0.3:  # reject matches in the wrong cue
                ch["t"] = t
    matched = sum(c["t"] is not None for c in chars)
    # interpolate the rest inside each cue (cue start/end act as anchors)
    for ci, cue in enumerate(cues):
        idx = [i for i, c in enumerate(chars) if c["cue"] == ci]
        end = (len(idx), cue["end"] - 0.15)
        anchors = [(-1, cue["start"])]
        for k, i in enumerate(idx):  # matched chars, kept only while monotone and before the cue end
            t = chars[i]["t"]
            if t is not None and anchors[-1][1] <= t < end[1]:
                anchors.append((k, t))
            else:
                chars[i]["t"] = None
        anchors.append(end)
        for k, i in enumerate(idx):
            if chars[i]["t"] is not None:
                continue
            lo = max((a for a in anchors if a[0] < k), key=lambda a: a[0])
            hi = min((a for a in anchors if a[0] > k), key=lambda a: a[0])
            chars[i]["t"] = lo[1] + (hi[1] - lo[1]) * (k - lo[0]) / (hi[0] - lo[0])
    # a cue whose characters bunch up (the ASR missed the phrase and matched stray syllables elsewhere)
    # gets its characters spread evenly over the cue instead
    for ci, cue in enumerate(cues):
        idx = [i for i, c in enumerate(chars) if c["cue"] == ci]
        ts_ = [chars[i]["t"] for i in idx]
        if sum(b - a < 0.03 for a, b in zip(ts_, ts_[1:])) > 0.25 * len(ts_):
            t0 = min(ts_[0], cue["start"] + 0.3) if matched else cue["start"]
            for k, i in enumerate(idx):
                chars[i]["t"] = t0 + (cue["end"] - 0.3 - t0) * k / len(idx)
            print(f"cue {ci} ({cue['start']:.2f}) spread evenly")
    out = []
    for li, l in enumerate(lines):
        cue = cues[l["cue"]]
        ws = []
        for wi, w in enumerate(l["words"]):
            cs = [c for c in chars if c["line"] == li and c["word"] == wi]
            st = cs[0]["t"] if cs else (ws[-1]["end"] if ws else cue["start"])
            syl = [round(c["t"], 3) for c in cs]
            ws.append(dict(w=w, start=round(st, 3), end=0, syl=syl))
        for k, w in enumerate(ws):
            nxt = ws[k + 1]["start"] if k + 1 < len(ws) else None
            last = w["syl"][-1] if w["syl"] else w["start"]
            w["end"] = round(nxt if nxt is not None else min(cue["end"], last + 0.6), 3)
            w["syl"] = [[s, round(w["syl"][j + 1] if j + 1 < len(w["syl"]) else w["end"], 3)] for j, s in enumerate(w["syl"])]
        out.append(dict(i=li, text=l["text"], start=ws[0]["start"], end=ws[-1]["end"], words=ws))
    # a line never outlives the start of the next one
    for a, b in zip(out, out[1:]):
        if a["end"] > b["start"]:
            a["end"] = b["start"]
            a["words"][-1]["end"] = min(a["words"][-1]["end"], b["start"])
    (common.DATA / "lyrics.json").write_text(json.dumps(dict(lines=out), ensure_ascii=False, indent=1))
    print(f"{len(out)} lines, {len(chars)} chars, {matched} matched to ASR ({matched / len(chars):.0%})")
    for l in out:
        print(f"{l['start']:7.2f} {l['end']:7.2f}  {len(l['words'])}w")


if __name__ == "__main__":
    main()
