import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { requiredFinalHitKime, FINAL_HIT_KIME, inFinalHitProtectedSpace } from "../src/room/finalHitKime";
import evidence from "../docs/analysis/final-hit-kime-evidence.json";
import { createBassGame } from "../src/room/bassGame";
import { finalHitSong, FINAL_HIT_CHARTS, FINAL_HIT_AUDIO_DURATION } from "../src/room/finalHitTrack";
import { FINAL_HIT_LIMITS, finalHitChartStats, finalHitRequiredGap, validateFinalHitChart } from "../src/room/finalHitValidation";
import master from "../src/room/charts/final-hit/01_midi_all_notes.json";
import analysis from "../docs/analysis/final-hit-audio.json";
import audit from "../src/room/charts/final-hit/06_gameplay_validation.json";
import overrides from "../src/room/charts/final-hit/overrides.json";
import type { ChartPatch } from "../src/room/bassChartImport";

describe("最終のヒットの3難易度", () => {
  it.each(["easy", "normal", "hard"] as const)("%sは音源終端まで有効な運指・時刻・密度・スラップ率を持つ", difficulty => {
    const song = finalHitSong(undefined, difficulty), stats = validateFinalHitChart(song);
    expect(stats).toEqual(audit.reports[difficulty]);
    expect(song).toMatchObject({ id: "final-hit", difficulty, label: difficulty.toUpperCase(), duration: FINAL_HIT_AUDIO_DURATION });
    expect(FINAL_HIT_CHARTS[difficulty].difficulty).toBe(difficulty);
    const cap = FINAL_HIT_LIMITS[difficulty].maxPerSecond;
    if (cap !== null) expect(stats.maxPerSecond).toBeLessThanOrEqual(cap);
    expect(stats.minInterval).toBeGreaterThanOrEqual(FINAL_HIT_LIMITS[difficulty].minInterval);
    const bounds = { easy: [45, 70, 0.6, 0.75], normal: [75, 100, 0.65, 0.8], hard: [100, 140, 0.7, 0.85] }[difficulty];
    expect(stats.total).toBeGreaterThanOrEqual(bounds[0]); expect(stats.total).toBeLessThanOrEqual(bounds[1]);
    expect(stats.slapRatio).toBeGreaterThanOrEqual(bounds[2]); expect(stats.slapRatio).toBeLessThanOrEqual(bounds[3]);
    expect(stats.end).toBe(58.795833); expect(stats.start).toBeGreaterThan(0);
    for (const [index, note] of song.notes.entries()) {
      const source = master.notes.find(n => n.id === note.sourceId)!;
      expect(note.time).toBe(source.timeSec); expect(note.sourceMidi).toBe(source.midiNote);
      if (note.kimeId?.startsWith("P")) { expect(note.midi).toBe(40); expect(note.pitchMapping).toBe("octave-compatible-accent"); }
      else expect(note.midi).toBe(source.midiNote);
      expect(note.sourceDurationSec).toBe(source.durationSec);
      expect(note.positionVerified).toBe(false); expect(note.techniqueVerified).toBe(false);
      if (!note.protected) {
        const feature = analysis.features.find(f => f.sourceId === note.sourceId)!;
        expect(feature.pitchRelative).toBeGreaterThanOrEqual(0.43); expect(Math.abs(feature.onsetDeltaSec)).toBeLessThanOrEqual(0.15);
      }
      if (index) expect(note.time - song.notes[index - 1].time + 1e-8).toBeGreaterThanOrEqual(finalHitRequiredGap(song.notes[index - 1], note, difficulty));
    }
    const shifted = finalHitSong(0.12, difficulty);
    expect(shifted.notes.map((n, i) => n.time - song.notes[i].time)).toEqual(expect.arrayContaining([expect.closeTo(0.12)]));
    expect(finalHitChartStats(shifted.notes).maxPerSecond).toBe(stats.maxPerSecond);
    expect(song.importInfo?.audioSyncVerified).toBe(false);
  });
  it("HardからNormal、NormalからEasyへアクセントを選び、3段階の音数を増やす", () => {
    const songs = (["easy", "normal", "hard"] as const).map(d => finalHitSong(undefined, d));
    expect(songs.map(s => s.notes.length)).toEqual([49, 76, 112]);
    for (let i = 0; i < 2; i++) for (const note of songs[i].notes) expect(songs[i + 1].notes.some(n => n.sourceId === note.sourceId && n.time === note.time && n.midi === note.midi)).toBe(true);

  });
  it.each(["easy", "normal", "hard"] as const)("%sを実際の選曲APIから全曲演奏し、4奏法の共通採点とリザルトへ接続", difficulty => {
    const song = finalHitSong(undefined, difficulty);
    const game = createBassGame(); game.tick(4.1, true); game.selectSong("final-hit"); game.setDifficulty(difficulty); game.start(); game.tick(song.countdownSeconds, true);
    for (const note of song.notes) {
      game.tick(note.time - game.snapshot().elapsed, true); game.beginInput(note.id, note.midi, note.time, note);
      if (note.kind === "slap") { expect(game.slapInput(note.id)).toBe(true); expect(game.slapInput(note.id)).toBe(false); }
      if (note.kind === "hold") game.tick(note.endTime! - game.snapshot().elapsed, true);
      if (note.kind === "slide") { game.tick(note.endTime! - game.snapshot().elapsed, true); game.slideInput(note.id, note.endFret!); }
      game.endInput(note.id);
    }
    game.tick(song.duration - game.snapshot().elapsed, true);
    expect(game.snapshot()).toMatchObject({ phase: "result", hits: song.notes.length, score: song.notes.length * 1000, combo: song.notes.length, misses: 0,
      result: { total: song.notes.length, achievement: 100, rank: "SS", maxCombo: song.notes.length, counts: { excellent: song.notes.length } } });
  });
  it("任意の1秒を使い、固定秒区切りをまたぐ密度を数える", () => {
    const template = finalHitSong().notes[0];
    const notes = [0.8, 0.99, 1.18, 1.37, 1.56].map((time, id) => ({ ...template, time, id }));
    expect(finalHitChartStats(notes).maxPerSecond).toBe(5);
    expect(finalHitChartStats(notes).maxPerSecond).toBe(5);
  });
  it.each(["duplicate", "range", "order", "pitch", "hold", "slide", "simultaneous"])("不正な%sを拒否", mode => {
    const song = finalHitSong(); const notes = song.notes.map(n => ({ ...n }));
    if (mode === "duplicate") notes[1].id = notes[0].id;
    if (mode === "range") notes[0].time = -1;
    if (mode === "order") notes[1].time = notes[0].time - 1;
    if (mode === "pitch") notes[0].midi = 60;
    if (mode === "hold") Object.assign(notes[0], { kind: "hold", endTime: notes[0].time });
    if (mode === "slide") Object.assign(notes[0], { kind: "slide", endTime: notes[0].time + 1, endString: 3, endFret: 4 });
    if (mode === "simultaneous") notes[1].time = notes[0].time;
    expect(() => validateFinalHitChart({ ...song, notes })).toThrow();
  });
  it("難易度・曲別記憶・オフセットを保持し、演奏中とポーズ中の変更を拒否", () => {
    const game = createBassGame(); game.tick(4.1, true); game.setDifficulty("hard"); game.selectSong("final-hit");
    expect(game.snapshot().difficulty).toBe("easy"); game.setAudioOffset(0.12); game.setDifficulty("normal");
    expect(game.snapshot()).toMatchObject({ difficulty: "normal", audioOffsetSec: 0.12 });
    game.tick(0, true, true); expect(game.setDifficulty("hard")).toBe(false); game.tick(0, true);
    game.start(); expect(game.setDifficulty("hard")).toBe(false); game.tick(70, true); game.continueFromResult();
    game.selectSong("garden-party"); expect(game.snapshot().difficulty).toBe("hard");
    game.selectSong("final-hit"); expect(game.snapshot().difficulty).toBe("normal");
  });
  it("原本への明示的な位置修正は位置全体へ適用し、編曲位置と混ぜない", () => {
    const song = finalHitSong(undefined, "hard");
    const note = song.notes.find((n, i) => {
      const edited = { ...n, string: 0 as const, fret: 0 }, before = song.notes[i - 1], after = song.notes[i + 1];
      return n.midi === 43 && n.string === 1 && (!before || n.time - before.time >= finalHitRequiredGap(before, edited, "hard")) &&
        (!after || after.time - n.time >= finalHitRequiredGap(edited, after, "hard"));
    })!;
    expect(note).toBeDefined();
    const patches = overrides.notes as Record<string, ChartPatch>;
    try {
      patches[note.sourceId!] = { fret: 0 }; // 元のG弦0F。編曲のD弦5Fとは別位置。
      const edited = finalHitSong(undefined, "hard").notes.find(n => n.id === note.id)!;
      expect(edited).toMatchObject({ midi: 43, string: 0, fret: 0 });
    } finally { delete patches[note.sourceId!]; }
  });
  it.each(["easy", "normal", "hard"] as const)("%sは全保護キメと休符を先に確定し、34〜37秒の反復を残す", difficulty => {
    const song = finalHitSong(0, difficulty), required = requiredFinalHitKime(difficulty);
    expect(song.notes.filter(n => n.protected).map(n => n.kimeId)).toEqual(required.map(n => n.id));
    const repeat = song.notes.filter(n => n.kimeGroupId === "K09");
    expect(repeat.map(n => n.kimeId)).toEqual(difficulty === "easy" ? ["P13", "P15", "P17"] : ["P13", "P14", "P15", "P16", "P17", "P18"]);
    for (const n of repeat) expect(n).toMatchObject({ kind: "slap", midi: 40, sourceMidi: 52, protected: true });
    for (const n of song.notes.filter(n => !n.protected)) expect(inFinalHitProtectedSpace(n.time)).toBe(false);
    for (const rest of FINAL_HIT_KIME.rests) expect(song.notes.filter(n => n.time >= rest.startSec && n.time < rest.endSec)).toEqual([]);
    for (const group of FINAL_HIT_KIME.groups) expect(song.notes.some(n => n.time >= group.startSec && n.time < group.endSec)).toBe(true);
  });
  it.each(["remove", "flag", "time", "kind", "mapping", "duplicate", "rest", "guard"])("キメ保護違反 %s を拒否する", mode => {
    const song = finalHitSong(0, "normal"), notes = song.notes.map(n => ({ ...n }));
    const index = notes.findIndex(n => n.kimeId === "P15"), note = notes[index];
    if (mode === "remove") notes.splice(index, 1);
    if (mode === "flag") note.protected = false;
    if (mode === "time") note.time += 0.01;
    if (mode === "kind") note.kind = "tap";
    if (mode === "mapping") note.sourceMidi = 40;
    if (mode === "duplicate") notes.push({ ...note, id: 10000 });
    if (mode === "rest" || mode === "guard") {
      notes.push({ ...notes[0], id: 10000, time: mode === "rest" ? 2.6 : 34.4, kimeId: undefined, protected: false });
      notes.sort((a, b) => a.time - b.time);
    }
    expect(() => validateFinalHitChart({ ...song, notes })).toThrow();
  });
  it("保護キメは除外パッチで黙って削除されない", () => {
    const patches = overrides.notes as Record<string, ChartPatch>;
    try { patches.n0373 = { excluded: true }; expect(() => finalHitSong(0, "easy")).toThrow(/保護キメ/); }
    finally { delete patches.n0373; }
  });
  it("HARDの旧4入力/秒上限を撤廃し、移動可能な5入力も拒否しない", () => {
    const song = finalHitSong(0, "hard");
    const template = song.notes.find(n => n.kimeId === "P21")!;
    const notes = song.notes.filter(n => n.time < 55.6 || n.time > 57.2);
    notes.push(...[55.9, 56.11, 56.32, 56.53, 56.74].map((time, i) => ({ ...template, id: 10000 + i, time, kimeId: undefined, kimeGroupId: undefined, protected: false })));
    notes.sort((a, b) => a.time - b.time);
    expect(validateFinalHitChart({ ...song, notes }).maxPerSecond).toBe(5);
    expect(FINAL_HIT_LIMITS.hard.maxPerSecond).toBeNull();
  });
  it("追加MIDIと提供分析の原本ハッシュ、648音一致の照合証跡、ペアの時刻差を保持", () => {
    for (const [file, sha] of [["source.mid", evidence.sourceMidiSha256], ["source-analysis.json", evidence.sourceAnalysisSha256], ["source-analysis.csv", evidence.sourceCsvSha256]]) {
      expect(createHash("sha256").update(readFileSync(`src/room/charts/final-hit/kime/${file}`)).digest("hex")).toBe(sha);
    }
    expect(evidence.midiEventsMatch).toBe(true); expect(evidence.midiNoteCount).toBe(master.notes.length);
    expect(evidence.appliedOffsetSec).toBe(0); expect(evidence.recordingDurationSec).toBe(FINAL_HIT_AUDIO_DURATION);
    for (const motif of FINAL_HIT_KIME.events.filter(n => n.id.startsWith("P"))) {
      const sources = motif.representedSourceIds.map(id => master.notes.find(n => n.id === id)!);
      expect((sources[1].timeSec - sources[0].timeSec) * 1000).toBeCloseTo(motif.pairDelayMs, 2);
      expect(motif.timeSec).toBe(sources[1].timeSec); expect(motif.pairDelayMs).toBeGreaterThan(69);
      expect(motif.pitchVerified).toBe(false); expect(motif.techniqueVerified).toBe(false);
    }
  });

});
