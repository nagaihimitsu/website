import { describe, expect, it } from "vitest";
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
    expect(stats.maxPerSecond).toBeLessThanOrEqual(FINAL_HIT_LIMITS[difficulty].maxPerSecond);
    expect(stats.minInterval).toBeGreaterThanOrEqual(FINAL_HIT_LIMITS[difficulty].minInterval);
    const bounds = { easy: [50, 70, 0.6, 0.75], normal: [75, 100, 0.65, 0.8], hard: [100, 140, 0.7, 0.85] }[difficulty];
    expect(stats.total).toBeGreaterThanOrEqual(bounds[0]); expect(stats.total).toBeLessThanOrEqual(bounds[1]);
    expect(stats.slapRatio).toBeGreaterThanOrEqual(bounds[2]); expect(stats.slapRatio).toBeLessThanOrEqual(bounds[3]);
    expect(stats.end).toBe(58.795833); expect(stats.start).toBeGreaterThan(0);
    for (const [index, note] of song.notes.entries()) {
      const source = master.notes.find(n => n.id === note.sourceId)!;
      expect(note.time).toBe(source.timeSec); expect(note.midi).toBe(source.midiNote);
      expect(note.sourceDurationSec).toBe(source.durationSec);
      expect(note.positionVerified).toBe(false); expect(note.techniqueVerified).toBe(false);
      const feature = analysis.features.find(f => f.sourceId === note.sourceId)!;
      expect(feature.pitchRelative).toBeGreaterThanOrEqual(0.43); expect(Math.abs(feature.onsetDeltaSec)).toBeLessThanOrEqual(0.15);
      if (index) expect(note.time - song.notes[index - 1].time + 1e-8).toBeGreaterThanOrEqual(finalHitRequiredGap(song.notes[index - 1], note, difficulty));
    }
    const shifted = finalHitSong(0.12, difficulty);
    expect(shifted.notes.map((n, i) => n.time - song.notes[i].time)).toEqual(expect.arrayContaining([expect.closeTo(0.12)]));
    expect(finalHitChartStats(shifted.notes).maxPerSecond).toBe(stats.maxPerSecond);
    expect(song.importInfo?.audioSyncVerified).toBe(false);
  });
  it("HardからNormal、NormalからEasyへアクセントを選び、3段階の音数を増やす", () => {
    const songs = (["easy", "normal", "hard"] as const).map(d => finalHitSong(undefined, d));
    expect(songs.map(s => s.notes.length)).toEqual([53, 81, 114]);
    for (let i = 0; i < 2; i++) for (const note of songs[i].notes) expect(songs[i + 1].notes.some(n => n.sourceId === note.sourceId && n.time === note.time && n.midi === note.midi)).toBe(true);
    const hard = songs[2].notes;
    expect(hard.filter(n => hard.filter(other => other.time >= n.time && other.time <= n.time + 1).length === 4).length).toBeLessThan(hard.length / 2);
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
  it("任意の1秒を使い、固定秒区切りをまたぐ過密を検出する", () => {
    const template = finalHitSong().notes[0];
    const notes = [0.8, 0.99, 1.18, 1.37, 1.56].map((time, id) => ({ ...template, time, id }));
    expect(finalHitChartStats(notes).maxPerSecond).toBe(5);
    expect(() => validateFinalHitChart({ difficulty: "hard", duration: 60, notes })).toThrow();
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
    const note = song.notes.find(n => n.midi === 43 && n.string === 1)!;
    expect(note).toBeDefined();
    const patches = overrides.notes as Record<string, ChartPatch>;
    try {
      patches[note.sourceId!] = { fret: 0 }; // 元のG弦0F。編曲のD弦5Fとは別位置。
      const edited = finalHitSong(undefined, "hard").notes.find(n => n.id === note.id)!;
      expect(edited).toMatchObject({ midi: 43, string: 0, fret: 0 });
    } finally { delete patches[note.sourceId!]; }
  });
});
