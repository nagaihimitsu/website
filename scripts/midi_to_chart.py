#!/usr/bin/env python3
"""Convert a MIDI file or a ZIP containing a MIDI file to JSON for a bass rhythm game.

Dependency: pip install mido
Usage: python midi_to_chart.py "song.zip" --output-dir converted_song

Important: MIDI stores pitch/timing/velocity, but usually does NOT store
string/fret/fingering/slap/pop/hammer-on/pull-off/dead-note performance detail.
All proposed fret positions are guesses and must be reviewed.
"""

from __future__ import annotations

import argparse
import bisect
import io
import json
import zipfile
from collections import defaultdict, deque
from pathlib import Path

import mido

BASE_TUNING = [
    {"stringNumber": 4, "stringName": "E", "openMidiNote": 28, "openNoteName": "E1"},
    {"stringNumber": 3, "stringName": "A", "openMidiNote": 33, "openNoteName": "A1"},
    {"stringNumber": 2, "stringName": "D", "openMidiNote": 38, "openNoteName": "D2"},
    {"stringNumber": 1, "stringName": "G", "openMidiNote": 43, "openNoteName": "G2"},
]
PITCH_NAMES = ("C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B")


def note_name(number: int) -> str:
    return f"{PITCH_NAMES[number % 12]}{number // 12 - 1}"


def read_midi(path: Path):
    if path.suffix.lower() in {".mid", ".midi"}:
        return path.read_bytes(), path.name
    if path.suffix.lower() != ".zip":
        raise ValueError("Input must be a .mid, .midi, or .zip file")
    with zipfile.ZipFile(path) as archive:
        files = [member for member in archive.infolist()
                 if not member.is_dir()
                 and member.filename.lower().endswith((".mid", ".midi"))
                 and not member.filename.startswith("__MACOSX/")]
        if not files:
            raise ValueError("ZIP contains no MIDI files")
        if len(files) > 1:
            raise ValueError("ZIP contains multiple MIDI files. Select one first.")
        member = files[0]
        if member.file_size > 10 * 1024 * 1024:
            raise ValueError("MIDI is too large (max 10 MiB)")
        name = member.filename
        # Apple ZIP archives sometimes lack UTF-8 name flags.
        if not member.flag_bits & 0x800:
            try:
                name = name.encode("cp437").decode("utf-8")
            except (UnicodeError, LookupError):
                pass
        return archive.read(member), name


def collect_tempo(mid: mido.MidiFile):
    events = [(0, -1, 500000)]  # Default 120 BPM until overridden.
    for track_index, track in enumerate(mid.tracks):
        tick = 0
        for msg in track:
            tick += msg.time
            if msg.type == "set_tempo":
                events.append((tick, track_index, msg.tempo))

    events.sort(key=lambda entry: (entry[0], entry[1]))
    unique = []
    for tick, track_index, tempo in events:
        if unique and unique[-1][0] == tick:
            unique[-1] = (tick, tempo)
        else:
            unique.append((tick, tempo))

    ticks = [x[0] for x in unique]
    tempos = [x[1] for x in unique]
    seconds = [0.0]
    for i in range(1, len(ticks)):
        seconds.append(seconds[-1] + mido.tick2second(
            ticks[i] - ticks[i-1], mid.ticks_per_beat, tempos[i-1]))

    def to_seconds(tick: int) -> float:
        i = bisect.bisect_right(ticks, tick) - 1
        return seconds[i] + mido.tick2second(tick - ticks[i], mid.ticks_per_beat, tempos[i])

    tempo_entries = [{"timeSec": round(to_seconds(tick), 6),
                      "bpm": round(60000000 / tempo, 6)}
                     for tick, tempo in unique]
    return to_seconds, tempo_entries


def extract_notes(mid: mido.MidiFile, to_seconds):
    results = []
    warnings = []
    tracks = []
    max_tick = 0
    for track_index, track in enumerate(mid.tracks):
        tick = 0
        active = defaultdict(deque)
        programs = defaultdict(lambda: 0)
        track_name = ""
        for msg in track:
            tick += msg.time
            if msg.type == "track_name":
                track_name = msg.name
            if msg.type == "program_change":
                programs[msg.channel] = msg.program
            if msg.type == "note_on" and msg.velocity > 0:
                active[(msg.channel, msg.note)].append((tick, msg.velocity, programs[msg.channel]))
            elif msg.type == "note_off" or (msg.type == "note_on" and msg.velocity == 0):
                key = (msg.channel, msg.note)
                if not active[key]:
                    warnings.append(f"Unmatched note-off: track={track_index} tick={tick} note={msg.note}")
                    continue
                start_tick, velocity, program = active[key].popleft()
                if tick <= start_tick:
                    warnings.append(f"Zero duration: track={track_index} tick={tick} note={msg.note}")
                    continue
                start = to_seconds(start_tick)
                end = to_seconds(tick)
                results.append({
                    "timeSec": round(start, 6),
                    "durationSec": round(end - start, 6),
                    "endSec": round(end, 6),
                    "midiNote": msg.note,
                    "noteName": note_name(msg.note),
                    "velocity": velocity,
                    "trackIndex": track_index,
                    "midiChannel": msg.channel,
                    "midiProgram": program,
                    "isPercussionChannel": msg.channel == 9,
                })
        max_tick = max(max_tick, tick)
        remaining = sum(len(notes) for notes in active.values())
        if remaining:
            warnings.append(f"Unclosed notes: track={track_index}, count={remaining}")
        tracks.append({"index": track_index, "name": track_name, "messageCount": len(track)})

    results.sort(key=lambda event: (event["timeSec"], event["midiNote"], event["endSec"], event["trackIndex"]))
    for i, note in enumerate(results, 1):
        note["id"] = f"n{i:04d}"
    return results, tracks, warnings, to_seconds(max_tick)


def positions(midi_note: int, max_frets: int):
    all_positions = []
    for string in BASE_TUNING:
        fret = midi_note - string["openMidiNote"]
        if 0 <= fret <= max_frets:
            all_positions.append({
                "stringNumber": string["stringNumber"],
                "stringName": string["stringName"],
                "fret": fret,
            })
    return sorted(all_positions, key=lambda p: (p["fret"], p["stringNumber"]))


def to_chart(all_notes, song_name, max_frets, midi_duration):
    notes = []
    skipped_ids = []
    for source in all_notes:
        # A drum channel is not a pitched bass line.
        possible = [] if source["isPercussionChannel"] else positions(source["midiNote"], max_frets)
        if not possible:
            skipped_ids.append(source["id"])
            continue
        proposed = possible[0]  # Lowest fret, not a verified fingering.
        notes.append({
            "id": source["id"],
            "timeSec": source["timeSec"],
            "durationSec": source["durationSec"],
            "midiNote": source["midiNote"],
            "noteName": source["noteName"],
            "velocity": source["velocity"],
            "stringNumber": proposed["stringNumber"],
            "stringName": proposed["stringName"],
            "fret": proposed["fret"],
            "possiblePositions": possible,
            "positionVerified": False,
            "technique": None,
            "techniqueVerified": False,
            "originalTrackIndex": source["trackIndex"],
        })

    return {
        "schemaVersion": "1.0.0",
        "kind": "unverified-4-string-bass-chart-candidates",
        "songId": song_name,
        "durationSec": round(midi_duration, 6),
        "timeOrigin": "MIDI beginning; do NOT shift first note to zero",
        "audioOffsetSec": 0.0,
        "audioSyncVerified": False,
        "instrument": "4-string electric bass (standard tuning)",
        "tuningLowToHigh": BASE_TUNING,
        "maxFrets": max_frets,
        "fingeringRule": "lowest fret among all playable positions (automatic guess)",
        "performanceTechniqueSource": "not encoded by MIDI; unknown/null",
        "sourceNotesCount": len(all_notes),
        "candidateNotesCount": len(notes),
        "excludedNotesCount": len(skipped_ids),
        "excludedSourceNoteIds": skipped_ids,
        "warnings": [
            "Pitch range filtering does not separate bass from other instruments.",
            "All proposed string/fret positions are unverified and may differ from TAB.",
            "Hammer-ons, pull-offs, ghost/dead notes, slap, and pop require separate information.",
            "Align this MIDI against the original Suno audio; offset defaults to 0 only as a placeholder.",
            "Multiple notes can start simultaneously; adapt to the game's chord/polyphony rules.",
        ],
        "notes": notes,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path, help="MIDI (.mid/.midi) or ZIP containing one MIDI")
    parser.add_argument("--output-dir", type=Path, default=Path("converted_song"))
    parser.add_argument("--frets", type=int, default=24)
    parser.add_argument("--song-id", type=str, default=None)
    args = parser.parse_args()
    if not 0 <= args.frets <= 36:
        parser.error("--frets must be from 0 through 36")

    midi_data, midi_file_name = read_midi(args.input)
    mid = mido.MidiFile(file=io.BytesIO(midi_data))
    to_seconds, tempo_entries = collect_tempo(mid)
    notes, tracks, warnings, midi_duration = extract_notes(mid, to_seconds)
    song_id = args.song_id or Path(midi_file_name).stem

    raw = {
        "schemaVersion": "1.0.0",
        "kind": "faithful-midi-note-events",
        "songId": song_id,
        "source": {"inputFilename": args.input.name, "midiFilename": midi_file_name},
        "ticksPerBeat": mid.ticks_per_beat,
        "midiFormatType": mid.type,
        "tempoChanges": tempo_entries,
        "tracks": tracks,
        "durationSec": round(midi_duration, 6),
        "noteCount": len(notes),
        "noteTimeReference": "MIDI file start",
        "warnings": warnings,
        "notes": notes,
    }
    chart = to_chart(notes, song_id, args.frets, midi_duration)
    report = {
        "songId": song_id,
        "durationSec": round(midi_duration, 6),
        "midiNotes": len(notes),
        "bass24FretPlayableCandidates": len(chart["notes"]),
        "excludedOutOfRangeOrDrum": len(chart["excludedSourceNoteIds"]),
        "noteRangeMidi": [min(n["midiNote"] for n in notes), max(n["midiNote"] for n in notes)] if notes else [],
        "noteRangeNames": [note_name(min(n["midiNote"] for n in notes)), note_name(max(n["midiNote"] for n in notes))] if notes else [],
        "firstNoteTimeSec": min((n["timeSec"] for n in notes), default=None),
        "tempoChanges": tempo_entries,
        "sourceTracks": tracks,
        "issues": [
            "MIDI program 0 means piano playback setting, not proof of what was recorded.",
            "MIDI may contain non-bass notes; a 4-string range filter is not stem separation.",
            "TAB articulations such as dead notes are not represented as pitched MIDI notes.",
            "Tempo metadata may be generic for an audio-transcribed MIDI; compare timing with audio.",
        ],
    }

    args.output_dir.mkdir(parents=True, exist_ok=True)
    for filename, obj in (
        ("01_midi_all_notes.json", raw),
        ("02_bass_4string_candidates.json", chart),
        ("03_conversion_report.json", report),
    ):
        (args.output_dir / filename).write_text(json.dumps(obj, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    print("Output directory:", args.output_dir)


if __name__ == "__main__":
    main()
