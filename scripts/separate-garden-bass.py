#!/usr/bin/env python3
"""Extract sample-aligned bass/backing WAVs locally; no downloads or uploads.

Optional offline production tooling, not a website/build dependency. Set up an
isolated environment before running:
    python -m venv /tmp/garden-audio-venv
    /tmp/garden-audio-venv/bin/pip install numpy scipy soundfile onnxruntime

Supply kuielab_a_bass.onnx yourself. Its verified public distribution is:
https://github.com/TRvlvr/model_repo/releases/download/all_public_uvr_models/kuielab_a_bass.onnx
Upstream: https://github.com/kuielab/mdx-net-submission/tree/leaderboard_A
License: scripts/licenses/kuielab-mdx-MIT.txt

The MDX STFT configuration matches UVR's model_data.json entry
6703e39f36f18aa7855ee1047765621d (FFT 16384, hop 1024, 2048 bins, 512 frames).
These are inferred stems, not guaranteed isolated original instrument tracks.
"""

import argparse
import hashlib
import json
import math
from pathlib import Path
import time


MODEL_SHA256 = "0c3e77b9963185b1ea6bb46a4b8924137d9370fc1ccdefec7b1b416ef550dcaa"
MODEL_RATE = 44_100
N_FFT = 16_384
HOP = 1_024
BINS = 2_048
FRAMES = 512
CHUNK = HOP * (FRAMES - 1)
TRIM = N_FFT // 2
COMPENSATE = 1.035
OUTPUT_NAMES = ("bass.wav", "backing.wav", "mix.wav", "metadata.json")


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def extract(args):
    # Lazy imports let --help work without installing any audio dependencies.
    import numpy as np
    import onnxruntime as ort
    import scipy
    from scipy.fft import irfft, rfft
    from scipy.signal import resample_poly
    import soundfile as sf

    source = args.input.resolve()
    model = args.model.resolve()
    output = args.output_dir.resolve()
    if sha256(model) != MODEL_SHA256:
        raise ValueError("Model SHA256 does not match the supported kuielab_a_bass.onnx.")
    for name in OUTPUT_NAMES:
        if (output / name).exists():
            raise ValueError(f"Output already exists; choose a fresh directory: {output / name}")

    info = sf.info(source)
    if info.format not in ("WAV", "WAVEX", "RF64"):
        raise ValueError("Input must be a WAV file.")
    original, sample_rate = sf.read(source, dtype="float32", always_2d=True)
    if len(original) == 0 or original.shape[1] not in (1, 2):
        raise ValueError("Input must contain nonempty mono or stereo audio.")
    if not np.isfinite(original).all():
        raise ValueError("Input contains non-finite audio samples.")
    channels = original.shape[1]

    def resample(audio, old_rate, new_rate):
        if old_rate == new_rate:
            return audio.copy()
        divisor = math.gcd(old_rate, new_rate)
        return resample_poly(audio, new_rate // divisor, old_rate // divisor, axis=0)

    mix = resample(original, sample_rate, MODEL_RATE)
    if channels == 1:
        mix = np.repeat(mix, 2, axis=1)
    mix = mix.T.astype(np.float32)
    window = (0.5 - 0.5 * np.cos(2 * np.pi * np.arange(N_FFT) / N_FFT)).astype(np.float32)

    def stft(audio):
        padded = np.pad(audio, ((0, 0), (TRIM, TRIM)), mode="reflect")
        frames = np.lib.stride_tricks.sliding_window_view(padded, N_FFT, axis=-1)[:, ::HOP, :]
        spectrum = rfft(frames * window, axis=-1, workers=args.threads).transpose(0, 2, 1)
        packed = np.stack((spectrum.real, spectrum.imag), axis=1)
        packed = packed.reshape(1, 4, N_FFT // 2 + 1, FRAMES)[:, :, :BINS, :].copy()
        packed[:, :, :3, :] = 0
        return packed

    def inverse_stft(packed):
        packed = packed.reshape(2, 2, BINS, FRAMES)
        spectrum = np.zeros((2, N_FFT // 2 + 1, FRAMES), dtype=np.complex64)
        spectrum[:, :BINS, :] = packed[:, 0] + 1j * packed[:, 1]
        frames = irfft(
            spectrum.transpose(0, 2, 1), n=N_FFT, axis=-1, workers=args.threads
        ) * window
        audio = np.zeros((2, CHUNK + N_FFT), dtype=np.float32)
        weight = np.zeros(CHUNK + N_FFT, dtype=np.float32)
        for frame in range(FRAMES):
            start = frame * HOP
            audio[:, start:start + N_FFT] += frames[:, frame]
            weight[start:start + N_FFT] += window ** 2
        audio /= np.maximum(weight, 1e-8)
        return audio[:, TRIM:-TRIM]

    ort.disable_telemetry_events()
    options = ort.SessionOptions()
    options.intra_op_num_threads = args.threads
    options.inter_op_num_threads = 1
    session = ort.InferenceSession(
        str(model), sess_options=options, providers=["CPUExecutionProvider"]
    )
    # Shared context and 25% overlap avoid abrupt inference chunk boundaries.
    padded = np.pad(mix, ((0, 0), (TRIM, CHUNK)))
    result = np.zeros_like(padded)
    weight = np.zeros(padded.shape[1], dtype=np.float32)
    fade = np.hanning(CHUNK).astype(np.float32)
    started = time.monotonic()
    for chunk, start in enumerate(range(0, mix.shape[1] + TRIM, int(CHUNK * 0.75)), 1):
        spectrum = stft(padded[:, start:start + CHUNK])
        prediction = session.run(None, {"input": spectrum})[0]
        separated = inverse_stft(prediction)
        result[:, start:start + CHUNK] += separated * fade
        weight[start:start + CHUNK] += fade
        print(json.dumps({"chunk": chunk, "elapsed_seconds": round(time.monotonic() - started, 2)}), flush=True)

    bass = (result / np.maximum(weight, 1e-8))[:, TRIM:TRIM + mix.shape[1]].T * COMPENSATE
    if channels == 1:
        bass = bass.mean(axis=1, keepdims=True)
    bass = resample(bass, MODEL_RATE, sample_rate)
    # Polyphase resampling preserves sample-zero alignment; restore the exact
    # original frame count after integer rounding, including uncommon rates.
    bass = bass[:len(original)]
    if len(bass) < len(original):
        bass = np.pad(bass, ((0, len(original) - len(bass)), (0, 0)))
    backing = original - bass
    if not np.isfinite(bass).all() or not np.isfinite(backing).all():
        raise ValueError("Inference produced non-finite samples; no outputs written.")

    output.mkdir(parents=True, exist_ok=True)
    # Float WAV preserves headroom and lets bass + backing reconstruct the
    # original within float precision. No normalization/fade/trim is applied.
    for name, audio in (("bass", bass), ("backing", backing), ("mix", original)):
        sf.write(output / f"{name}.wav", audio, sample_rate, subtype="FLOAT")
    metadata = {
        "source": source.name,
        "source_sha256": sha256(source),
        "model": model.name,
        "model_sha256": MODEL_SHA256,
        "inference_sample_rate": MODEL_RATE,
        "sample_rate": sample_rate,
        "channels": channels,
        "frames": len(original),
        "seconds": len(original) / sample_rate,
        "processing_seconds": round(time.monotonic() - started, 3),
        "reconstruction_max_error": float(np.max(np.abs(bass + backing - original))),
        "peak": {name: float(np.max(np.abs(audio))) for name, audio in (
            ("mix", original), ("bass", bass), ("backing", backing)
        )},
        "dependencies": {
            "numpy": np.__version__, "scipy": scipy.__version__,
            "soundfile": sf.__version__, "onnxruntime": ort.__version__,
        },
    }
    (output / "metadata.json").write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(metadata, indent=2))


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("input", type=Path, help="Input mono/stereo WAV; preserve its rate and length.")
    parser.add_argument("--model", type=Path, required=True, help="Local verified kuielab_a_bass.onnx.")
    parser.add_argument("--output-dir", type=Path, required=True, help="Write bass.wav, backing.wav, mix.wav and metadata.json here.")
    parser.add_argument("--threads", type=int, default=2, help="CPU inference/FFT threads (default: 2).")
    args = parser.parse_args()
    if args.threads < 1:
        parser.error("--threads must be positive")
    try:
        extract(args)
    except (OSError, ValueError, ImportError) as error:
        parser.exit(1, f"Error: {error}\n")


if __name__ == "__main__":
    main()
