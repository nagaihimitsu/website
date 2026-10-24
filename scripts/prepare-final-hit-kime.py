#!/usr/bin/env python3
"""提供キメ分析・MIDI・推定ステムを照合し、保護定義を生成する制作専用処理。
元JSON/CSV/MIDIは変更しない。音高・奏法を聴感確認済みとは扱わない。
"""
import argparse
import hashlib
import json
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
import soundfile as sf
from scipy import signal

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--stem', type=Path, required=True)
parser.add_argument('--mix', type=Path, required=True)
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
folder = root / 'src/room/charts/final-hit'
source = folder / 'kime'
read = lambda p: json.loads(p.read_text())
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
raw = read(source / 'source-analysis.json')
master = read(folder / '01_midi_all_notes.json')
audio = read(folder / 'audio-source.json')
with tempfile.TemporaryDirectory() as tmp:
    subprocess.run([sys.executable, str(root / 'scripts/midi_to_chart.py'), str(source / 'source.mid'), '--output-dir', tmp], check=True, stdout=subprocess.DEVNULL)
    converted = read(Path(tmp) / '01_midi_all_notes.json')
    if master['notes'] != converted['notes']:
        raise ValueError('追加MIDIと既存648音が一致しません。時刻系の再確認が必要です。')
if sha(args.mix) != audio['sha256']:
    raise ValueError('照合する原曲WAVが既存の音源と異なります')
stem, sr = sf.read(args.stem, always_2d=True)
mix, mix_rate = sf.read(args.mix, always_2d=True)
if sr != mix_rate or len(stem) != len(mix):
    raise ValueError('推定ステムと原音のサンプル位置が一致しません')
stem, mix = stem.mean(axis=1), mix.mean(axis=1)
lookup = {n['id']: n for n in master['notes']}
evidence, events = [], []
easy_ids = {'P01','P03','P05','P07','P09','P11','P13','P15','P17','P19','P20','P21'}
for motif in raw['signatureMotifs']:
    first = min((n for n in master['notes'] if n['midiNote'] == 50), key=lambda n: abs(n['timeSec'] - motif['firstApproxSec']))
    second = min((n for n in master['notes'] if n['midiNote'] == 52), key=lambda n: abs(n['timeSec'] - motif['secondApproxSec']))
    if max(abs(first['timeSec'] - motif['firstApproxSec']), abs(second['timeSec'] - motif['secondApproxSec'])) > .015:
        raise ValueError(f"{motif['id']}: 元MIDIに対応するペアがありません")
    measurements = []
    for name, wave in [('estimated-bass', stem), ('original-mix', mix)]:
        bands = []
        for note in [first, second]:
            segment = wave[int((note['timeSec'] + .012) * sr):int((note['timeSec'] + .082) * sr)]
            f = np.fft.rfftfreq(32768, 1 / sr)
            spectrum = abs(np.fft.rfft(segment * np.hanning(len(segment)), 32768))
            energies = {}
            for midi in [note['midiNote'] - 24, note['midiNote'] - 12, note['midiNote']]:
                hz = 440 * 2 ** ((midi - 69) / 12)
                energies[str(midi)] = round(float(spectrum[(f > hz * .94) & (f < hz * 1.06)].max()), 6)
            bands.append({'sourceId': note['id'], 'timeSec': note['timeSec'], 'bands': energies})
        measurements.append({'audio': name, 'events': bands})
    delay = round((second['timeSec'] - first['timeSec']) * 1000, 3)
    evidence.append({'id': motif['id'], 'providedDelayMs': motif['intraPairDelayMs'], 'calculatedDelayMs': delay, 'measurements': measurements})
    events.append({'id': motif['id'], 'groupId': motif['groupId'], 'sourceId': second['id'], 'timeSec': second['timeSec'],
                   'sourceMidi': second['midiNote'], 'midi': 40, 'kind': 'slap', 'protected': True,
                   'requiredDifficulties': ['easy','normal','hard'] if motif['id'] in easy_ids else ['normal','hard'],
                   'representedSourceIds': [first['id'], second['id']], 'firstTimeSec': first['timeSec'], 'pairDelayMs': delay,
                   'guardStartSec': round(first['timeSec'] - .1, 6), 'guardEndSec': round(second['timeSec'] + .26, 6),
                   'pitchMapping': 'octave-compatible-accent', 'pitchVerified': False, 'techniqueVerified': False})
# 反復以外も、休止後の復帰・フィル終端・音域の切り返しを全曲で保護する。
accents = [('K01','n0009'),('K01','n0024'),('K02','n0055'),('K03','n0081'),('K03','n0153'),
           ('K04','n0200'),('K05','n0239'),('K07','n0308'),('K07','n0320'),('K10','n0392'),
           ('K10','n0418'),('K11','n0446'),('K11','n0525'),('K12','n0558'),('K14','n0641'),('K14','n0645')]
for index, (group, source_id) in enumerate(accents, 1):
    note = lookup[source_id]
    events.append({'id': f'A{index:02}', 'groupId': group, 'sourceId': source_id, 'timeSec': note['timeSec'],
                   'sourceMidi': note['midiNote'], 'midi': note['midiNote'], 'kind': 'slap', 'protected': True,
                   'requiredDifficulties': ['easy','normal','hard'], 'representedSourceIds': [source_id],
                   'firstTimeSec': note['timeSec'], 'pairDelayMs': 0,
                   'guardStartSec': round(note['timeSec'] - .18, 6), 'guardEndSec': round(note['timeSec'] + .14, 6),
                   'pitchMapping': 'native-audio-candidate', 'pitchVerified': False, 'techniqueVerified': False})
filtered = signal.sosfiltfilt(signal.butter(4, [35, 250], fs=sr, btype='bandpass', output='sos'), stem)
rests = []
for index, rest in enumerate(raw['bassLowFrequencyBreaks'], 1):
    start, end = rest['startSec'], rest['endSec']
    inside = np.mean(filtered[int(start*sr):int(end*sr)] ** 2)
    side = np.mean(np.r_[filtered[int(max(0,start-.3)*sr):int(start*sr)],filtered[int(end*sr):int((end+.3)*sr)]] ** 2)
    rests.append({'id': f'R{index:02}', 'startSec': start, 'endSec': end, 'protected': True,
                  'stemEnergyRatio': round(float(inside / (side + 1e-12)), 4), 'instrumentVerified': False})
proof = {'schemaVersion':'1.0.0', 'sourceMidiSha256':sha(source/'source.mid'), 'sourceAnalysisSha256':sha(source/'source-analysis.json'),
         'sourceCsvSha256':sha(source/'source-analysis.csv'), 'audioSha256':audio['sha256'], 'stemSha256':sha(args.stem),
         'midiEventsMatch':True, 'midiNoteCount':len(master['notes']), 'recordingDurationSec':audio['durationSec'],
         'analysisDurationSec':raw['audioDurationSec'], 'appliedOffsetSec':0, 'tempoMetadataBpm':120, 'acousticTempoApproxBpm':140,
         'cautions':['分析JSONのintraPairDelayMsは実時刻差と桁が異なるため再計算。','MP3の長さの差では発音時刻を拡縮しない。',
                     '推定ステムが弱い反復も、混合音源の反復とユーザー指定を優先して残す。','E3候補をE2へ置くのは24ボタン向けの編曲で、実演奏の音域や奏法の確定ではない。'],
         'motifs':evidence, 'rests':rests}
(root/'docs/analysis/final-hit-kime-evidence.json').write_text(json.dumps(proof,ensure_ascii=False,indent=2)+'\n')
registry = {'schemaVersion':'1.0.0','songId':'final-hit','policy':'protected-accents-before-fillers',
            'audioSha256':audio['sha256'], 'events':sorted(events,key=lambda e:e['timeSec']), 'rests':rests,
            'groups':raw['groups']}
(folder/'kime-map.json').write_text(json.dumps(registry,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'protectedDefinitions':len(events),'signatureMotifs':len(evidence),'rests':len(rests),'midiEventsMatch':True}))
