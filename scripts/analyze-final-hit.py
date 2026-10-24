#!/usr/bin/env python3
"""推定ベースステムをMIDIと照合する制作専用解析。聴感・奏法の確定ではない。
numpy/scipyとFFmpegが必要。音声を外部へ送らず、ビルド時には実行しない。
"""
import argparse
import hashlib
import json
import subprocess
from pathlib import Path

import numpy as np
from scipy import signal

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--mix', type=Path, required=True)
parser.add_argument('--stem', type=Path, required=True)
parser.add_argument('--metadata', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
master = json.loads((root / 'src/room/charts/final-hit/01_midi_all_notes.json').read_text())
metadata = json.loads(args.metadata.read_text())
sha = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
if sha(args.mix) != metadata['source_sha256']:
    raise ValueError('原曲と推定ステムの出典が一致しません')
sr = 8000
x = np.frombuffer(subprocess.check_output(['ffmpeg', '-v', 'error', '-i', str(args.stem), '-ar', str(sr), '-ac', '1', '-f', 'f32le', '-']), dtype='<f4')
f, t, z = signal.stft(x, fs=sr, nperseg=1024, noverlap=944, nfft=8192, boundary='zeros')
mag = np.abs(z)
flux = np.maximum(np.diff(mag, axis=1, prepend=mag[:, :1]), 0)
env = signal.savgol_filter(flux[(f >= 35) & (f <= 900)].sum(axis=0), 9, 2)
peaks, _ = signal.find_peaks(env, distance=6, prominence=float(np.percentile(env, 40)) * .15)
peak_times = t[peaks]
salience = []
for midi in range(28, 49):
    hz = 440 * 2 ** ((midi - 69) / 12)
    energy = np.zeros(len(t))
    for h in range(1, 5):
        freq = hz * h
        at = np.max(mag[(f >= freq * .983) & (f <= freq * 1.017)], axis=0)
        sides = (mag[np.argmin(abs(f - freq * .95))] + mag[np.argmin(abs(f - freq * 1.05))]) / 2
        energy += np.maximum(0, at - sides) / h ** 1.5
    salience.append(energy)
salience = np.stack(salience)
native = [n for n in master['notes'] if 28 <= n['midiNote'] <= 48]
offsets = np.arange(-.2, .201, .005)
scores = [float(np.mean([np.interp(n['timeSec'] + offset, t, env) for n in native])) for offset in offsets]
features = []
for note in native:
    at = note['timeSec']
    mask = (t >= at + .015) & (t <= at + .12)
    pitches = np.percentile(salience[:, mask], 70, axis=1)
    strength = float(pitches[note['midiNote'] - 28])
    timing = float(peak_times[np.argmin(abs(peak_times - at))] - at)
    attack_mask = (t >= at - .025) & (t <= at + .06)
    # 立ち上がりの広帯域成分をゲーム用スラップ割当に使う。velocityだけでは決めない。
    bright = float(flux[(f >= 900) & (f <= 3500)][:, attack_mask].sum(axis=0).max())
    features.append({'sourceId': note['id'], 'timeSec': at, 'midi': note['midiNote'], 'durationSec': note['durationSec'],
                     'pitchRelative': round(strength / (float(pitches.max()) + 1e-9), 4), 'strength': round(strength, 7),
                     'onset': round(float(env[attack_mask].max()), 7), 'brightness': round(bright, 7),
                     'onsetDeltaSec': round(timing, 6)})
report = {'schemaVersion': '1.0.0', 'songId': 'final-hit', 'method': 'KUIELab推定ベースの基本波・倍音・オンセット照合。奏法はゲーム用推定で聴感確認済みではない。',
          'sourceSha256': sha(args.mix), 'stemSha256': sha(args.stem), 'modelSha256': metadata['model_sha256'],
          'audioDurationSec': len(x) / sr, 'audioSyncVerified': False, 'appliedOffsetSec': 0,
          'offsetScan': {'bestSec': round(float(offsets[int(np.argmax(scores))]), 3), 'zeroScore': round(scores[40], 6),
                         'bestScore': round(max(scores), 6), 'reason': '零付近の改善が小さく、元の絶対時刻を維持。先頭を0秒へ移さない。'},
          'features': features}
args.output.parent.mkdir(parents=True, exist_ok=True)
args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'notes': len(features), 'offsetScan': report['offsetScan']}, ensure_ascii=False))
