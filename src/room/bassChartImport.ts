import { BASS_FRETBOARD, BASS_STRINGS, midiFrequency, type BassString } from "./bassFretboard";
import { validateBassSlide } from "./bassSlide";
import type { BassNote, BassNoteKind, BassSong } from "./bassGame";

export interface MidiEvent { id: string; timeSec: number; durationSec: number; midiNote: number; velocity: number }
export interface BassPosition { stringNumber: number; fret: number }
export interface CandidateNote extends MidiEvent, BassPosition {
  possiblePositions: BassPosition[];
  positionVerified: boolean;
  technique: string | null;
  techniqueVerified: boolean;
}
export interface MidiMaster { schemaVersion: string; kind: string; songId: string; durationSec: number; noteCount: number; notes: MidiEvent[]; tempoChanges: { timeSec: number; bpm: number }[] }
export interface MidiCandidates { schemaVersion: string; kind: string; songId: string; durationSec: number; audioOffsetSec: number; audioSyncVerified: boolean; candidateNotesCount: number; notes: CandidateNote[] }
export interface ChartPatch { stringNumber?: number; fret?: number; technique?: string | null; kind?: BassNoteKind; endTimeSec?: number; endStringNumber?: number; endFret?: number; positionVerified?: boolean; techniqueVerified?: boolean; excluded?: boolean }
export interface ChartOverrides { schemaVersion: string; audioOffsetSec?: number; audioSyncVerified?: boolean; notes: Record<string, ChartPatch> }
export interface ImportExclusion { sourceId: string; timeSec: number; midiNote: number; reason: "not-in-candidates" | "outside-current-fretboard" | "manually-excluded" }
export interface ImportedChart {
  notes: BassNote[];
  excluded: ImportExclusion[];
  sourceNoteCount: number;
  candidateNoteCount: number;
  audioOffsetSec: number;
  audioSyncVerified: boolean;
  midiDurationSec: number;
  sourceSongId: string;
  tempoChanges: { timeSec: number; bpm: number }[];
}
function check(value: unknown, message: string): asserts value { if (!value) throw new Error(`MIDI譜面: ${message}`); }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function finite(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value); }
function pitchPosition(position: BassPosition, midi: number, maxFrets = 24) {
  return Number.isInteger(position.stringNumber) && position.stringNumber >= 1 && position.stringNumber <= 4 &&
    Number.isInteger(position.fret) && position.fret >= 0 && position.fret <= maxFrets && BASS_STRINGS[position.stringNumber - 1].openMidi + position.fret === midi;
}

/** 原本を変更せず、検証と明示的な修正だけで現行の指板へ適合させる。 */
export function importMidiChart(masterValue: unknown, candidateValue: unknown, overrideValue: unknown = { schemaVersion: "1.0.0", notes: {} }): ImportedChart {
  check(record(masterValue) && record(candidateValue) && record(overrideValue), "JSONオブジェクトが必要です");
  for (const value of [masterValue, candidateValue, overrideValue]) check(value.schemaVersion === "1.0.0", "未対応のschemaVersionです");
  check(masterValue.kind === "faithful-midi-note-events" && candidateValue.kind === "unverified-4-string-bass-chart-candidates", "譜面形式が異なります");
  check(Array.isArray(masterValue.notes) && masterValue.noteCount === masterValue.notes.length, "原本の件数が不正です");
  check(Array.isArray(candidateValue.notes) && candidateValue.candidateNotesCount === candidateValue.notes.length, "候補の件数が不正です");
  check(masterValue.songId === candidateValue.songId && typeof masterValue.songId === "string", "曲IDが一致しません");
  check(finite(masterValue.durationSec) && masterValue.durationSec > 0 && candidateValue.durationSec === masterValue.durationSec, "譜面の長さが不正です");
  check(Array.isArray(masterValue.tempoChanges) && masterValue.tempoChanges.every(t => record(t) && finite(t.timeSec) && finite(t.bpm) && t.bpm > 0), "テンポ情報が不正です");
  check(Number.isInteger(candidateValue.maxFrets) && (candidateValue.maxFrets as number) >= 0 && (candidateValue.maxFrets as number) <= 24, "対応外のフレット範囲です");
  check(Array.isArray(candidateValue.tuningLowToHigh) && candidateValue.tuningLowToHigh.length === 4 &&
    new Set(candidateValue.tuningLowToHigh.map(t => record(t) ? t.stringNumber : null)).size === 4 &&
    candidateValue.tuningLowToHigh.every(t => record(t) && Number.isInteger(t.stringNumber) && (t.stringNumber as number) >= 1 && (t.stringNumber as number) <= 4 && BASS_STRINGS[(t.stringNumber as number) - 1].openMidi === t.openMidiNote), "標準4弦チューニングと一致しません");
  check(record(overrideValue.notes), "修正データのnotesが不正です");
  const master = masterValue as unknown as MidiMaster;
  const candidates = candidateValue as unknown as MidiCandidates;
  const overrides = overrideValue as unknown as ChartOverrides;
  const audioOffsetSec = overrides.audioOffsetSec ?? candidates.audioOffsetSec;
  const audioSyncVerified = overrides.audioSyncVerified ?? candidates.audioSyncVerified;
  check(finite(audioOffsetSec) && typeof audioSyncVerified === "boolean", "同期設定が不正です");
  const originals = new Map<string, { note: MidiEvent; index: number }>();
  for (const [index, n] of master.notes.entries()) {
    check(record(n) && typeof n.id === "string" && n.id.length > 0 && !originals.has(n.id), "原本のIDが不正または重複しています");
    check(finite(n.timeSec) && n.timeSec >= 0 && finite(n.durationSec) && n.durationSec >= 0 && n.timeSec + n.durationSec <= master.durationSec + 0.00001, `${n.id}: 時刻が不正です`);
    check(Number.isInteger(n.midiNote) && n.midiNote >= 0 && n.midiNote <= 127 && Number.isInteger(n.velocity) && n.velocity >= 0 && n.velocity <= 127, `${n.id}: 音高/velocityが不正です`);
    check(n.timeSec + audioOffsetSec >= 0, `${n.id}: オフセットにより開始前になります`);
    originals.set(n.id, { note: n, index });
  }
  for (const [id, patch] of Object.entries(overrides.notes)) {
    check(originals.has(id) && record(patch), `${id}: 修正対象が存在しません`);
    check(patch.technique === undefined || patch.technique === null || typeof patch.technique === "string", `${id}: 奏法が不正です`);
    check(patch.kind === undefined || (typeof patch.kind === "string" && ["tap", "hold", "slap", "slide"].includes(patch.kind)), `${id}: ノーツ種別が不正です`);
    for (const key of ["positionVerified", "techniqueVerified", "excluded"] as const) check(patch[key] === undefined || typeof patch[key] === "boolean", `${id}: ${key}が不正です`);
  }
  const notes: BassNote[] = [];
  const excluded: ImportExclusion[] = [];
  const seen = new Set<string>();
  for (const source of candidates.notes) {
    check(record(source) && typeof source.id === "string" && !seen.has(source.id), "候補のIDが不正または重複しています");
    seen.add(source.id);
    const original = originals.get(source.id);
    check(original && ["timeSec", "durationSec", "midiNote", "velocity"].every(key => source[key as keyof MidiEvent] === original.note[key as keyof MidiEvent]), `${source.id}: 原本の音符と一致しません`);
    check(typeof source.positionVerified === "boolean" && typeof source.techniqueVerified === "boolean" && (source.technique === null || typeof source.technique === "string"), `${source.id}: 確認状態が不正です`);
    check(Array.isArray(source.possiblePositions) && source.possiblePositions.length > 0 && source.possiblePositions.every(p => record(p) && pitchPosition(p as unknown as BassPosition, source.midiNote, candidateValue.maxFrets as number)), `${source.id}: 弦とフレットが音高に一致しません`);
    check(pitchPosition(source, source.midiNote, candidateValue.maxFrets as number), `${source.id}: 提案運指が音高に一致しません`);
    const patch = overrides.notes[source.id] ?? {};
    const chosen = { stringNumber: patch.stringNumber ?? source.stringNumber, fret: patch.fret ?? source.fret };
    check(pitchPosition(chosen, source.midiNote, candidateValue.maxFrets as number), `${source.id}: 修正運指が音高に一致しません`);
    const screenPositions = BASS_FRETBOARD.filter(cell => cell.midi === source.midiNote);
    const reason = patch.excluded ? "manually-excluded" : screenPositions.length === 0 ? "outside-current-fretboard" : null;
    if (reason) { excluded.push({ sourceId: source.id, timeSec: source.timeSec, midiNote: source.midiNote, reason }); continue; }
    // 実運指が5Fを超える場合も保存し、画面には同音高の弾ける位置を使う。
    const display = screenPositions.find(cell => cell.string + 1 === chosen.stringNumber && cell.fret === chosen.fret) ?? screenPositions[0];
    const technique = patch.technique !== undefined ? patch.technique : source.technique;
    const kind = patch.kind ?? (technique === "slap" ? "slap" : "tap");
    check(kind !== "hold" || source.durationSec > 0, `${source.id}: 保持時間がありません`);
    const time = source.timeSec + audioOffsetSec;
    const importedNote: BassNote = { id: original.index, sourceId: source.id, time, midi: source.midiNote, frequency: midiFrequency(source.midiNote),
      kind, ...(kind === "hold" ? { endTime: time + source.durationSec } : {}),
      string: display.string as BassString, fret: display.fret, phraseId: notes.length,
      technique: technique === "pick" || technique === "slap" || technique === "slide" ? technique : null,
      importedTechnique: technique, sourceTimeSec: source.timeSec, sourceDurationSec: source.durationSec, velocity: source.velocity,
      sourceStringNumber: chosen.stringNumber, sourceFret: chosen.fret,
      sourcePositionVerified: patch.positionVerified ?? source.positionVerified,
      positionVerified: display.string + 1 === chosen.stringNumber && display.fret === chosen.fret && (patch.positionVerified ?? source.positionVerified), techniqueVerified: patch.techniqueVerified ?? source.techniqueVerified,
      travelSeconds: 1.2 };
    if (kind === "slide") {
      check(display.string + 1 === chosen.stringNumber && display.fret === chosen.fret, `${source.id}: スライド始点は現行指板の位置が必要です`);
      importedNote.endTime = patch.endTimeSec === undefined ? undefined : patch.endTimeSec + audioOffsetSec;
      importedNote.endString = (patch.endStringNumber === undefined ? display.string : patch.endStringNumber - 1) as BassString;
      importedNote.endFret = patch.endFret;
      importedNote.endMidi = patch.endFret === undefined ? undefined : BASS_STRINGS[display.string].openMidi + patch.endFret;
      validateBassSlide(importedNote);
    }
    notes.push(importedNote);
  }
  for (const n of master.notes) if (!seen.has(n.id)) excluded.push({ sourceId: n.id, timeSec: n.timeSec, midiNote: n.midiNote, reason: "not-in-candidates" });
  notes.sort((a, b) => a.time - b.time || a.id - b.id);
  check(notes.length > 0, "現行指板で演奏できる音符がありません");
  return { notes, excluded, sourceNoteCount: master.notes.length, candidateNoteCount: candidates.notes.length,
    audioOffsetSec, audioSyncVerified, midiDurationSec: master.durationSec, sourceSongId: master.songId, tempoChanges: master.tempoChanges };
}

/** BPMはカウントとアニメーション用。ノーツ時刻は絶対秒をそのまま使う。 */
export function importedBassSong(chart: ImportedChart, audioDurationSec: number): BassSong {
  const bpm = chart.tempoChanges[0]?.bpm ?? 120;
  const beatSeconds = 60 / bpm;
  const countdownSeconds = beatSeconds * 4;
  const notes = chart.notes.map((note, phraseId) => ({ ...note, phraseId }));
  return { id: "final-hit", title: "最終のヒット", difficulty: "normal", label: "MIDI仮譜面", bpm, beatSeconds, countdownSeconds,
    duration: Math.max(audioDurationSec, chart.midiDurationSec + chart.audioOffsetSec + 0.2, ...notes.map(note => (note.endTime ?? note.time) + 0.2)),
    beats: audioDurationSec / beatSeconds, notes, swing: 0.5, chords: [], importInfo: chart,
    phrases: notes.map((note, id) => ({ id, string: note.string, fret: note.fret, start: note.time, end: note.endTime ?? note.time,
      frequency: note.frequency, mode: note.kind === "hold" ? "hold" : "tap",
      prepareAt: Math.max(-countdownSeconds, note.time - 0.5), previewAt: note.time - 1.2 })) };
}

/** 開発用の間引き。原時刻を維持し、削除した音も返す。 */
export function monophonicSelection<T extends MidiEvent>(notes: readonly T[]) {
  const kept: T[] = [], removed: T[] = [];
  let end = -Infinity;
  for (const n of [...notes].sort((a, b) => a.timeSec - b.timeSec || a.midiNote - b.midiNote || a.id.localeCompare(b.id))) {
    if (n.timeSec < end - 0.000001) removed.push(n);
    else { kept.push(n); end = n.timeSec + n.durationSec; }
  }
  return { kept, removed };
}
