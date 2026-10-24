import { describe, expect, it } from "vitest";
import { BASS_RESULT_CONFIG, bassResultRank, calculateBassResult } from "../src/room/bassResult";
import { BASS_SONGS, createBassGame, type BassNote, type BassNoteState } from "../src/room/bassGame";
import { midiFrequency } from "../src/room/bassFretboard";

const note = (id: number, time: number, kind: BassNote["kind"] = "tap", endTime?: number): BassNote => ({
  id, phraseId: id, time, kind, endTime, midi: 35, string: 2, fret: 2, frequency: midiFrequency(35),
  technique: kind === "slap" ? "slap" : kind === "slide" ? "slide" : "pick", travelSeconds: 1.2,
  ...(kind === "slide" ? { endMidi: 38, endString: 2, endFret: 5 } : {}),
});
function playing(notes: readonly BassNote[]) {
  const game = createBassGame(notes); game.tick(4.1, true); game.start(); game.tick(BASS_SONGS.easy.countdownSeconds, true); return game;
}

describe("リザルトの純粋計算", () => {
  it("全Excellentは100%・SS、全Missは0%・D、空譜面も0%", () => {
    expect(calculateBassResult(Array(8).fill("perfect"), 8)).toMatchObject({ achievement: 100, rank: "SS", total: 8, maxCombo: 8, counts: { excellent: 8, miss: 0 } });
    expect(calculateBassResult(Array(8).fill("miss"), 0)).toMatchObject({ achievement: 0, rank: "D", total: 8, counts: { excellent: 0, miss: 8 } });
    expect(calculateBassResult([], 0)).toEqual({ achievement: 0, rank: "D", total: 0, maxCombo: 0, counts: { excellent: 0, great: 0, good: 0, bad: 0, miss: 0 } });
  });
  it.each([["perfect", 100, "SS"], ["great", 80, "A"], ["good", 50, "D"], ["bad", 20, "D"], ["miss", 0, "D"]] as const)("1音だけの%sは%f%%・%s", (state, achievement, rank) => {
    const result = calculateBassResult([state], 0);
    expect(result).toMatchObject({ achievement, rank, total: 1 });
    expect(Object.values(result.counts).reduce((sum, n) => sum + n, 0)).toBe(1);
  });
  it("指定係数でMiss込みの対象数を分母にし、入力配列を変更しない", () => {
    const states = Object.freeze(["perfect", "great", "good", "bad", "miss"] as const);
    const before = [...states];
    const result = calculateBassResult(states, 3);
    expect(result).toMatchObject({ total: 5, achievement: 50, counts: { excellent: 1, great: 1, good: 1, bad: 1, miss: 1 } });
    expect(Object.values(result.counts).reduce((sum, n) => sum + n, 0)).toBe(result.total);
    expect(states).toEqual(before); expect(Object.isFrozen(result)).toBe(true); expect(Object.isFrozen(result.counts)).toBe(true);
    expect(BASS_RESULT_CONFIG.weights).toEqual({ excellent: 1, great: 0.8, good: 0.5, bad: 0.2, miss: 0 });
  });
  it.each([[98, "SS", "S"], [90, "S", "A"], [80, "A", "B"], [70, "B", "C"], [60, "C", "D"]] as const)("%f%%の境界を丸めず評価", (threshold, rank, lower) => {
    expect(bassResultRank(threshold)).toBe(rank);
    expect(bassResultRank(threshold - 0.000001)).toBe(lower);
  });
  it("97.995%を98.00%と表示してもランクはS", () => {
    const result = calculateBassResult([...Array<BassNoteState>(19599).fill("perfect"), ...Array<BassNoteState>(401).fill("miss")], 19599);
    expect(result.achievement).toBe(97.995);
    expect(result.achievement.toFixed(2)).toBe("98.00"); expect(result.rank).toBe("S");
  });
  it("シーク済みや未確定の状態を最終判定として数えない", () => {
    expect(calculateBassResult(["skipped", "pending", "holding", "sliding", "perfect"], 1)).toMatchObject({ total: 1, achievement: 100 });
  });
});

describe("共通判定からの曲終了・遷移", () => {
  it("Missで現在コンボが切れても最大コンボを保持、誤入力は譜面判定数を増やさない", () => {
    const game = playing([note(0, 1), note(1, 2), note(2, 3), note(3, 4), note(4, 5)]);
    for (const time of [1, 2, 4]) {
      game.tick(time - game.snapshot().elapsed, true); game.beginInput(time, 35); game.endInput(time);
    }
    game.beginInput(90, 48); game.endInput(90);
    game.tick(60, true);
    expect(game.snapshot()).toMatchObject({ combo: 0, maxCombo: 2, score: 2750, result: { total: 5, achievement: 60, rank: "C", maxCombo: 2, counts: { excellent: 3, miss: 2 } } });
  });
  it("ロング・スラップ・スライドの開始と終了を重複集計しない", () => {
    const game = playing([note(0, 1), note(1, 2, "hold", 3), note(2, 4, "slap"), note(3, 5, "slide", 6)]);
    game.tick(1, true); game.beginInput(1, 35); game.endInput(1);
    game.tick(1, true); game.beginInput(2, 35); game.tick(1, true); game.endInput(2); game.endInput(2);
    game.tick(1, true); game.beginInput(3, 35); game.slapInput(3); game.slapInput(3); game.endInput(3);
    game.tick(1, true); game.beginInput(4, 35, 5, { string: 2, fret: 2 });
    game.tick(1, true); game.slideInput(4, 5); game.slideInput(4, 5); game.endInput(4); game.endInput(4);
    game.tick(60, true);
    expect(game.snapshot()).toMatchObject({ score: 4000, maxCombo: 4, result: { counts: { excellent: 4, great: 0, good: 0, bad: 0, miss: 0 }, total: 4, achievement: 100, rank: "SS" } });
  });
  it("曲末の未判定・保持をMiss確定し、結果は1回だけ作成し入力や時間経過で変えない", () => {
    const end = BASS_SONGS.easy.duration;
    const game = playing([note(0, end - 0.1), note(1, end - 0.1, "hold", end + 0.1)]);
    game.tick(end - 0.1, true); game.beginInput(1, 35); game.endInput(1);
    game.beginInput(2, 35); game.tick(0.1, true);
    const before = game.snapshot(), result = before.result;
    expect(before).toMatchObject({ phase: "result", result: { total: 2, counts: { excellent: 1, miss: 1 }, achievement: 50 } });
    expect(before.notes.every(n => n.state === "perfect" || n.state === "miss")).toBe(true);
    expect(game.beginInput(3, 35)).toBeNull(); expect(game.slapInput(2)).toBe(false); expect(game.slideInput(2, 5)).toBeNull();
    game.endInput(2); game.suspendInputs(); game.tick(60, true); game.tick(10, true, true);
    expect(game.snapshot().result).toBe(result);
    expect(game.snapshot()).toMatchObject({ score: before.score, hits: before.hits, misses: before.misses, maxCombo: before.maxCombo });
  });
  it("続けるは1回だけ選曲へ戻り、次の演奏へ前回の判定数を持ち込まない", () => {
    const game = playing([note(0, 1)]); expect(game.continueFromResult()).toBe(false);
    game.tick(60, true); game.tick(0, true, true); expect(game.continueFromResult()).toBe(false);
    game.tick(0, true); expect(game.continueFromResult()).toBe(true); expect(game.continueFromResult()).toBe(false);
    expect(game.snapshot()).toMatchObject({ phase: "ready", result: null, score: 0, combo: 0, maxCombo: 0, hits: 0, misses: 0 });
    game.start(); game.tick(BASS_SONGS.easy.countdownSeconds + 1, true); game.beginInput(2, 35); game.endInput(2); game.tick(60, true);
    expect(game.snapshot().result).toMatchObject({ total: 1, counts: { excellent: 1, miss: 0 }, achievement: 100 });
    game.cancel(); expect(game.snapshot()).toMatchObject({ phase: "idle", result: null, score: 0, maxCombo: 0 });
  });
  it("空譜面は0%・Dのリザルトへ正常に遷移する", () => {
    const game = playing([]); game.tick(60, true);
    expect(game.snapshot()).toMatchObject({ phase: "result", result: { total: 0, achievement: 0, rank: "D" } });
  });
  it("新曲の続けるで曲・難易度・手動オフセットを保持する", () => {
    const game = createBassGame(); game.tick(4.1, true); game.selectSong("final-hit"); game.setAudioOffset(0.12);
    const selected = game.snapshot(); game.start(); game.tick(70, true);
    expect(game.snapshot().result).toMatchObject({ total: selected.notes.length, counts: { miss: selected.notes.length } });
    expect(game.continueFromResult()).toBe(true);
    expect(game.snapshot()).toMatchObject({ phase: "ready", songId: "final-hit", difficulty: selected.difficulty, audioOffsetSec: 0.12, result: null, misses: 0 });
  });
});
