import type { BassNoteState } from "./bassGame";

/** SCOREの点数とは別の、リザルト用の判定係数とランク境界。 */
export const BASS_RESULT_CONFIG = Object.freeze({
  weights: Object.freeze({ excellent: 1, great: 0.8, good: 0.5, bad: 0.2, miss: 0 }),
  ranks: Object.freeze([
    { rank: "SS", minimum: 98 }, { rank: "S", minimum: 90 }, { rank: "A", minimum: 80 },
    { rank: "B", minimum: 70 }, { rank: "C", minimum: 60 }, { rank: "D", minimum: 0 },
  ] as const),
});
export type BassRank = typeof BASS_RESULT_CONFIG.ranks[number]["rank"];
export type BassResultCounts = Readonly<Record<keyof typeof BASS_RESULT_CONFIG.weights, number>>;
export interface BassResult {
  readonly counts: BassResultCounts;
  readonly total: number;
  readonly achievement: number;
  readonly rank: BassRank;
  readonly maxCombo: number;
}

export function bassResultRank(achievement: number): BassRank {
  return BASS_RESULT_CONFIG.ranks.find(({ minimum }) => achievement >= minimum)?.rank ?? "D";
}

/** 最終ノーツ状態から集計する。開始通知・誤タップ・シーク済み音は判定数に足さない。 */
export function calculateBassResult(states: readonly BassNoteState[], maxCombo: number): BassResult {
  const counts = { excellent: 0, great: 0, good: 0, bad: 0, miss: 0 };
  for (const state of states) {
    if (state === "perfect") counts.excellent++;
    else if (state === "great" || state === "good" || state === "bad" || state === "miss") counts[state]++;
  }
  const keys = Object.keys(counts) as (keyof BassResultCounts)[];
  const total = keys.reduce((sum, key) => sum + counts[key], 0);
  // 十進の係数を百分率にしてから整数の判定数へ掛け、境界での丸め誤差を抑える。
  const weighted = keys.reduce((sum, key) => sum + counts[key] * (BASS_RESULT_CONFIG.weights[key] * 100), 0);
  const achievement = total ? weighted / total : 0;
  return Object.freeze({ counts: Object.freeze(counts), total, achievement, rank: bassResultRank(achievement), maxCombo });
}
