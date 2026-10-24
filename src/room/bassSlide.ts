import type { BassNote } from "./bassGame";
import { BASS_STRINGS } from "./bassFretboard";

/** 既存譜面は変更しない。明示されたスライドだけを検査する。 */
export function validateBassSlide(note: BassNote) {
  if (note.kind !== "slide") return;
  if (!Number.isFinite(note.time) || !Number.isFinite(note.endTime) || note.endTime! <= note.time ||
    !Number.isInteger(note.string) || !BASS_STRINGS[note.string] || note.endString !== note.string ||
    !Number.isInteger(note.fret) || !Number.isInteger(note.endFret) ||
    note.fret < 1 || note.fret > 5 || note.endFret! < 1 || note.endFret! > 5 || note.fret === note.endFret ||
    BASS_STRINGS[note.string].openMidi + note.fret !== note.midi ||
    BASS_STRINGS[note.string].openMidi + note.endFret! !== note.endMidi) throw new Error(`Invalid bass slide: ${note.id}`);
}
