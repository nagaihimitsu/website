import audioSource from "./charts/final-hit/audio-source.json" with { type: "json" };
import master from "./charts/final-hit/01_midi_all_notes.json" with { type: "json" };
import candidates from "./charts/final-hit/02_bass_4string_candidates.json" with { type: "json" };
import overrides from "./charts/final-hit/overrides.json" with { type: "json" };
import easy from "./charts/final-hit/easy.json" with { type: "json" };
import normal from "./charts/final-hit/normal.json" with { type: "json" };
import hard from "./charts/final-hit/hard.json" with { type: "json" };
import { importMidiChart, importedBassSong, type ChartOverrides } from "./bassChartImport";
import { validateFinalHitChart } from "./finalHitValidation";
import type { BassDifficulty, BassNote, BassNoteKind, BassSong } from "./bassGame";
import { BASS_STRINGS, midiFrequency, type BassString } from "./bassFretboard";
import { FINAL_HIT_KIME } from "./finalHitKime";

interface SavedNote { id: number; sourceId: string; timeSec: number; midi: number; string: number; fret: number; kind: string;
  kimeId?: string; kimeGroupId?: string; protected?: boolean; sourceMidi?: number; pitchMapping?: string;
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
  const sourceNotes = new Map(master.notes.map((note, id) => [note.id, { ...note, index: id }]));
  const notes = chart.notes.flatMap(entry => {
    const saved: SavedNote = entry;
    const patch = (overrides as ChartOverrides).notes[saved.sourceId] ?? {};
    if (patch.excluded) {
      if (saved.protected) throw new Error(`最終のヒット: 保護キメ ${saved.kimeId} は無条件に除外できません`);
      return [];
    }
    const source = sourceNotes.get(saved.sourceId);
    const kime = saved.kimeId ? FINAL_HIT_KIME.events.find(event => event.id === saved.kimeId) : undefined;
    if (!source || source.index !== saved.id || source.timeSec !== saved.timeSec ||
      (saved.sourceMidi !== undefined && saved.sourceMidi !== source.midiNote) ||
      (source.midiNote !== saved.midi && (!kime || kime.sourceId !== saved.sourceId || kime.midi !== saved.midi))) throw new Error(`最終のヒット: ${saved.sourceId}の原本・編曲根拠が一致しません`);
    const original: BassNote = originals.get(saved.sourceId) ?? { id: source.index, sourceId: source.id,
      time: source.timeSec + imported.audioOffsetSec, sourceTimeSec: source.timeSec, sourceDurationSec: source.durationSec,
      midi: saved.midi, frequency: midiFrequency(saved.midi), string: saved.string as BassString, fret: saved.fret,
      kind: "tap" as const, technique: null, phraseId: 0, travelSeconds: 1.2, positionVerified: false, techniqueVerified: false };
    const kind = (patch.kind ?? (patch.technique === "slap" ? "slap" : patch.technique === "pick" ? "tap" : saved.kind)) as BassNoteKind;
    const editedPosition = patch.stringNumber !== undefined || patch.fret !== undefined;
    return [{ ...original, midi: saved.midi, frequency: midiFrequency(saved.midi), sourceMidi: source.midiNote,
      kimeId: saved.kimeId, kimeGroupId: saved.kimeGroupId, protected: saved.protected, pitchMapping: saved.pitchMapping,
      string: (editedPosition ? original.string : saved.string) as BassString,
      fret: editedPosition ? original.fret : saved.fret, kind,
      technique: kind === "slap" ? "slap" as const : kind === "slide" ? "slide" as const : "pick" as const,
      ...(kind === "hold" ? { endTime: patch.kind === "hold" ? original.endTime : (saved.endTimeSec ?? saved.timeSec + original.sourceDurationSec!) + imported.audioOffsetSec } : {}),
      ...(kind === "slide" && patch.kind !== "slide" ? { endTime: saved.endTimeSec === undefined ? undefined : saved.endTimeSec + imported.audioOffsetSec,
        endString: (saved.endString ?? saved.string) as BassString, endFret: saved.endFret,
        endMidi: saved.endMidi ?? (saved.endFret === undefined ? undefined : BASS_STRINGS[saved.string].openMidi + saved.endFret) } : {}),
    }];
  });
  const selected = new Set(notes.map(n => n.id));
  const selectedSources = new Set(notes.map(n => n.sourceId));
  const song = importedBassSong({ ...imported, notes, excluded: [...imported.excluded.filter(n => !selectedSources.has(n.sourceId)),
    ...imported.notes.filter(n => !selected.has(n.id)).map(n => ({ sourceId: n.sourceId!, timeSec: n.sourceTimeSec!, midiNote: n.midi, reason: "arrangement-omitted" as const }))] }, FINAL_HIT_AUDIO_DURATION);
  song.difficulty = difficulty; song.label = difficulty.toUpperCase();
  validateFinalHitChart(song);
  return song;
}
