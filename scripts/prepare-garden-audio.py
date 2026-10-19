#!/usr/bin/env python3
"""Make the two aligned web assets from offline bass separation (requires FFmpeg)."""
import argparse
import hashlib
import json
import subprocess
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("stems", type=Path, help="Directory containing backing.wav and bass.wav")
parser.add_argument("--output", type=Path, default=Path("src/assets/audio"))
args = parser.parse_args()
args.output.mkdir(parents=True, exist_ok=True)

# Match GARDEN_TRACK in src/room/gardenTrack.ts: 24 bars and the final decay.
duration, fade_start = 56.14, 55.29
for name, bitrate in [("backing", "192k"), ("bass", "128k")]:
    source = args.stems / f"{name}.wav"
    target = args.output / f"garden-party-{name}.mp3"
    subprocess.run([
        "ffmpeg", "-y", "-v", "error", "-i", str(source),
        "-af", f"atrim=duration={duration},asetpts=PTS-STARTPTS,afade=t=out:st={fade_start}:d={duration - fade_start:.2f}",
        "-ar", "48000", "-ac", "2", "-c:a", "libmp3lame", "-b:a", bitrate,
        "-map_metadata", "-1", str(target),
    ], check=True)
    print(json.dumps({"file": str(target), "bytes": target.stat().st_size,
                      "sha256": hashlib.sha256(target.read_bytes()).hexdigest()}))
