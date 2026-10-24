import audioSource from "./charts/final-hit/audio-source.json" with { type: "json" };
import master from "./charts/final-hit/01_midi_all_notes.json" with { type: "json" };
import candidates from "./charts/final-hit/02_bass_4string_candidates.json" with { type: "json" };
import overrides from "./charts/final-hit/overrides.json" with { type: "json" };
import easy from "./charts/final-hit/easy.json" with { type: "json" };
import normal from "./charts/final-hit/normal.json" with { type: "json" };
import hard from "./charts/final-hit/hard.json" with { type: "json" };
import { importMidiChart, importedBassSong, type ChartOverrides } from "./bassChartImport";
import { validateFinalHitChart } from "./finalHitValidation";
import type { BassDifficulty, BassNoteKind, BassSong } from "./bassGame";
import { BASS_STRINGS, type BassString } from "./bassFretboard";

interface SavedNote { id: number; sourceId: string; timeSec: number; midi: number; string: number; fret: number; kind: string;
  endTimeSec?: number; endString?: number; endFret?: number; endMidi?: number }

export const FINAL_HIT_AUDIO_DURATION = audioSource.durationSec;
export const FINAL_HIT_CHARTS = { easy, normal, hard };
export function finalHitSong(offset?: number, difficulty: BassDifficulty = "easy"): BassSong {
  const imported = importMidiChart(master, candidates, offset === undefined ? overrides : {
    ...overrides, audioOffsetSec: offset, audioSyncVerified: offset === overrides.audioOffsetSec && overrides.audioSyncVerified,
  });
  const chart = FINAL_HIT_CHARTS[difficulty];
  if (chart.songId !== "final-hit" || chart.difficulty !== difficulty || chart.schemaVersion !== "1.0.0") throw new Error("最終のヒット: 編曲形式が不正です");
  const originals = new Map(imported.notes.map(note => [note.sourceId, note]));
  const notes = chart.notes.flatMap(entry => {
    const saved: SavedNote = entry;
    const patch = (overrides as ChartOverrides).notes[saved.sourceId] ?? {};
    if (patch.excluded) return [];
    const original = originals.get(saved.sourceId);
    if (!original || original.id !== saved.id || original.sourceTimeSec !== saved.timeSec || original.midi !== saved.midi) throw new Error(`最終のヒット: ${saved.sourceId}が原本と一致しません`);
    const kind = (patch.kind ?? (patch.technique === "slap" ? "slap" : patch.technique === "pick" ? "tap" : saved.kind)) as BassNoteKind;
    const editedPosition = patch.stringNumber !== undefined || patch.fret !== undefined;
    return [{ ...original, string: (editedPosition ? original.string : saved.string) as BassString,
      fret: editedPosition ? original.fret : saved.fret, kind,
      technique: kind === "slap" ? "slap" as const : kind === "slide" ? "slide" as const : "pick" as const,
      ...(kind === "hold" ? { endTime: patch.kind === "hold" ? original.endTime : (saved.endTimeSec ?? saved.timeSec + original.sourceDurationSec!) + imported.audioOffsetSec } : {}),
      ...(kind === "slide" && patch.kind !== "slide" ? { endTime: saved.endTimeSec === undefined ? undefined : saved.endTimeSec + imported.audioOffsetSec,
        endString: (saved.endString ?? saved.string) as BassString, endFret: saved.endFret,
        endMidi: saved.endMidi ?? (saved.endFret === undefined ? undefined : BASS_STRINGS[saved.string].openMidi + saved.endFret) } : {}),
    }];
  });
  const selected = new Set(notes.map(n => n.id));
  const song = importedBassSong({ ...imported, notes, excluded: [...imported.excluded,
    ...imported.notes.filter(n => !selected.has(n.id)).map(n => ({ sourceId: n.sourceId!, timeSec: n.sourceTimeSec!, midiNote: n.midi, reason: "arrangement-omitted" as const }))] }, FINAL_HIT_AUDIO_DURATION);
  song.difficulty = difficulty; song.label = difficulty.toUpperCase();
  validateFinalHitChart(song);
  return song;
}
