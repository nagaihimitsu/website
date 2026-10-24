"""原音の時刻を保ち、ブラウザ配信用MP3を生成する（切り詰め・正規化なし）。"""
import hashlib
import json
import subprocess
import sys
import wave
from pathlib import Path

root = Path(__file__).resolve().parents[1]
source = Path(sys.argv[1])
source_sha = hashlib.sha256(source.read_bytes()).hexdigest()
if source_sha != "8502b7d6ce574ea8a38681962997bca96ec7b5c54e3c114f2d3abc54968e2aa2":
    raise SystemExit("提供された原音とSHA-256が異なります。曲と譜面の組合せを確認してください")
with wave.open(str(source), "rb") as audio:
    frames, rate, channels = audio.getnframes(), audio.getframerate(), audio.getnchannels()
target = root / "src/assets/audio/final-hit.mp3"
subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(source), "-map_metadata", "-1", "-c:a", "libmp3lame", "-b:a", "192k", "-ar", "48000", str(target)], check=True)
manifest = {"filename": "最終のヒット.wav", "sha256": source_sha, "sampleRate": rate, "frames": frames,
            "channels": channels, "durationSec": frames / rate, "encoding": "MP3 192kbps stereo; no trim, resampling rate 48000Hz",
            "encodedSha256": hashlib.sha256(target.read_bytes()).hexdigest()}
(root / "src/room/charts/final-hit/audio-source.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
