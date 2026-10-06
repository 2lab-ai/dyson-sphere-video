#!/usr/bin/env python3 -I
"""hit-gate.py — render-based beat/hit gate (docs/PLAN-V4.md C7 gate clause 4).

    python3 -I scripts/hit-gate.py out/dyson-v4.mp4 [--json out/_check/hit-gate.json] [--calibrate]

Reads the rendered file at 60 fps as 192x108 grey (ffmpeg pipe), then checks, per plate (data/edit.json) and per beat
(data/audio.json):
  beat hit   : beat-centred sampling — pre = frame at t-3f, post = frame at t+3f (f = 1/60). A hit needs
               Δ(pre,post) >= max(ABS_FLOOR, min(HIT_RATIO x median consecutive-frame Δ, median + MARGIN))
               (calibrated on v3: 5x alone passed the static cosmicweb plate and failed the moving demo plates)
               AND (|ΔmeanLum| >= LUM_MIN or changed-area >= AREA_MIN), and PERSISTENCE: Δ(pre, t+6f) >= 0.5 x Δ(pre,post)
               (a 1-frame flash is not a hit). Plates must hit >= BEAT_MIN of their beats and every downbeat.
  section hit: at 65.120 / 142.035 / 165.343 the mean luminance reaches WHITE within ±4 frames (whiteout class).
  ground     : the median luminance of the first 0.5 s after each cut classifies dark/mid/light (mean luminance <= 0.06 / >= 0.35) and must
               match look.ground in data/edit.json.
  flashes    : full-frame luminance jumps (>= FLASH_JUMP in one frame) <= 3 in any 1 s window (photosensitivity).
  p45 ROI    : the outro's small point — checked in the 320x180 ROI around the anchor instead of full frame.
--calibrate prints per-plate statistics only (no pass/fail), for setting the constants on a known render.
"""
import json, subprocess, sys, argparse, statistics
import numpy as np

W, H, FPS = 192, 108, 60
HIT_RATIO, ABS_FLOOR, LUM_MIN, AREA_MIN = 5.0, 6.0 / 255, 8.0 / 255, 0.05
MARGIN = 10.0 / 255       # a hit must exceed the plate's own motion by at least this (keeps busy plates checkable)
PIX_CHANGE = 12.0 / 255   # a pixel "changed" when |Δ| >= this
BEAT_MIN = 0.75           # fraction of a plate's beats that must hit
WHITE = 0.80
FLASH_JUMP = 0.20
SECTION_HITS = [65.120, 142.035, 165.343]
ANCHOR = (1187 / 1920, 413 / 1080)
ROI_PLATES = {'p45'}


def load_frames(path):
    cmd = ['ffmpeg', '-v', 'error', '-i', path, '-vf', f'scale={W}:{H},format=gray', '-r', str(FPS), '-f', 'rawvideo', 'pipe:1']
    raw = subprocess.run(cmd, check=True, capture_output=True).stdout
    n = len(raw) // (W * H)
    return np.frombuffer(raw[: n * W * H], dtype=np.uint8).reshape(n, H, W).astype(np.float32) / 255.0


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('video'); ap.add_argument('--json'); ap.add_argument('--calibrate', action='store_true')
    ap.add_argument('--edit', default='data/edit.json'); ap.add_argument('--audio', default='data/audio.json')
    a = ap.parse_args()
    E = json.load(open(a.edit))['plates']; A = json.load(open(a.audio))
    beats, downs = A['beats'], A['downbeats']
    F = load_frames(a.video); N = len(F)
    fi = lambda t: int(round(t * FPS))
    lum = F.mean(axis=(1, 2))
    report, fails = [], []

    for p in E:
        pid = p['id']; s, e = p['start'], p['end']
        i0, i1 = max(0, fi(s)), min(N - 1, fi(e) - 1)
        if i1 - i0 < 8: continue
        roi = pid[:3] in ROI_PLATES
        def frame(i):
            f = F[i]
            if roi:
                cx, cy = int(ANCHOR[0] * W), int(ANCHOR[1] * H)
                return f[max(0, cy - 9):cy + 9, max(0, cx - 16):cx + 16]
            return f
        consec = np.array([np.abs(frame(i + 1) - frame(i)).mean() for i in range(i0, i1)])
        med = float(np.median(consec)) if len(consec) else 0.0
        pb = [b for b in beats if s + 0.05 <= b < e - 0.12]
        hits, misses = [], []
        for b in pb:
            k = fi(b)
            if k - 3 < i0 or k + 6 > i1: continue
            pre, post, late = frame(k - 3), frame(k + 3), frame(k + 6)
            d = float(np.abs(post - pre).mean()); dl = float(np.abs(late - pre).mean())
            dlum = abs(float(post.mean() - pre.mean())); area = float((np.abs(post - pre) >= PIX_CHANGE).mean())
            thr = max(ABS_FLOOR, min(HIT_RATIO * med, med + MARGIN))
            ok = d >= thr and (dlum >= LUM_MIN or area >= AREA_MIN) and dl >= 0.5 * d
            (hits if ok else misses).append((round(b, 3), round(d * 255, 1), round(thr * 255, 1), round(dlum * 255, 1), round(area, 3), round(dl / max(d, 1e-6), 2)))
        down_miss = [b for b in downs if s + 0.05 <= b < e - 0.12 and not any(abs(h[0] - b) < 0.01 for h in hits) and any(abs(m[0] - b) < 0.01 for m in misses)]
        g = float(np.median(lum[i0:min(i1, i0 + 30)])); gclass = 'dark' if g <= 0.06 else 'light' if g >= 0.35 else 'mid'
        declared = p.get('look', {}).get('ground')
        rate = len(hits) / max(1, len(hits) + len(misses))
        row = {'id': pid, 'beats': len(hits) + len(misses), 'hits': len(hits), 'rate': round(rate, 2), 'median_dframe': round(med * 255, 2),
               'downbeat_misses': [round(x, 3) for x in down_miss], 'ground_measured': round(g, 3), 'ground_class': gclass, 'ground_declared': declared,
               'misses': misses[:6]}
        report.append(row)
        if not a.calibrate:
            if rate < BEAT_MIN: fails.append(f"{pid}: beat hit rate {rate:.2f} < {BEAT_MIN} (median Δ/frame {med*255:.2f}/255; misses {misses[:3]})")
            if down_miss: fails.append(f"{pid}: downbeat without a hit at {down_miss}")
            if declared and gclass != declared: fails.append(f"{pid}: ground measured {gclass} ({g:.3f}) but declared {declared}")

    # section whiteouts
    sec = {}
    for t in SECTION_HITS:
        k = fi(t); win = lum[max(0, k - 4): k + 5]
        peak = float(win.max()) if len(win) else 0.0
        sec[t] = round(peak, 3)
        if not a.calibrate and peak < WHITE: fails.append(f"section hit {t}: peak luminance {peak:.3f} < {WHITE} (no whiteout)")
    # photosensitivity: luminance jumps >= FLASH_JUMP per frame, max count in any 1 s window
    jumps = np.where(np.abs(np.diff(lum)) >= FLASH_JUMP)[0]
    worst, worst_t = 0, 0.0
    for j in jumps:
        c = int(((jumps >= j) & (jumps < j + FPS)).sum())
        if c > worst: worst, worst_t = c, j / FPS
    if not a.calibrate and worst > 3: fails.append(f"photosensitivity: {worst} full-frame flashes within 1 s at {worst_t:.2f}s")

    out = {'video': a.video, 'frames': N, 'plates': report, 'section_peaks': sec, 'max_flashes_per_s': worst, 'fails': fails}
    if a.json: json.dump(out, open(a.json, 'w'), indent=1)
    for r in report:
        print(f"{r['id']:<26} beats {r['beats']:>3} hits {r['hits']:>3} rate {r['rate']:.2f} medΔ {r['median_dframe']:>5.2f} ground {r['ground_class']:<5} ({r['ground_measured']:.3f}) declared {r['ground_declared']} downbeat-miss {r['downbeat_misses']}")
    print('section peaks', sec, '| max flashes/s', worst)
    if a.calibrate: return 0
    for f in fails: print('FAIL', f)
    print('HIT-GATE', 'FAIL' if fails else 'PASS', f'({len(fails)} findings, {len(report)} plates)')
    return 1 if fails else 0


if __name__ == '__main__':
    sys.exit(main())
