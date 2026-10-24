import type { BassDifficulty, BassNote, BassSong } from "./bassGame";
import { BASS_STRINGS } from "./bassFretboard";
import { validateBassSlide } from "./bassSlide";

export const FINAL_HIT_LIMITS = Object.freeze({
  easy: { maxPerSecond: 2, minInterval: 0.55, reachSeconds: 0.15, slapRatio: 0.68 },
  normal: { maxPerSecond: 3, minInterval: 0.36, reachSeconds: 0.075, slapRatio: 0.74 },
  hard: { maxPerSecond: 4, minInterval: 0.26, reachSeconds: 0.045, slapRatio: 0.8 },
});

/** 弦飛びとフレット移動、スラップ後の移動に余裕を残す。 */
export function finalHitRequiredGap(previous: Pick<BassNote, "string" | "fret" | "kind" | "endString" | "endFret">, next: Pick<BassNote, "string" | "fret">, difficulty: BassDifficulty) {
  const distance = Math.abs((previous.endString ?? previous.string) - next.string) * 1.4 + Math.abs((previous.endFret ?? previous.fret) - next.fret) * 0.7;
  const config = FINAL_HIT_LIMITS[difficulty];
  return config.minInterval + Math.max(0, distance - 2.5) * config.reachSeconds + (previous.kind === "slap" && distance > 3 ? 0.06 : 0);
}

export function finalHitChartStats(notes: readonly BassNote[]) {
  let left = 0, maxPerSecond = 0, minInterval = Infinity;
  const kinds = { tap: 0, hold: 0, slap: 0, slide: 0 };
  for (let right = 0; right < notes.length; right++) {
    while (notes[right].time - notes[left].time > 1 + 1e-8) left++;
    maxPerSecond = Math.max(maxPerSecond, right - left + 1);
    if (right) minInterval = Math.min(minInterval, notes[right].time - notes[right - 1].time);
    kinds[notes[right].kind]++;
  }
  return { total: notes.length, maxPerSecond, minInterval: Number.isFinite(minInterval) ? minInterval : 0, kinds,
    slapRatio: notes.length ? kinds.slap / notes.length : 0,
    minMidi: notes.length ? Math.min(...notes.map(n => n.midi)) : null,
    maxMidi: notes.length ? Math.max(...notes.map(n => n.midi)) : null,
    start: notes[0]?.time ?? 0, end: Math.max(0, ...notes.map(n => n.endTime ?? n.time)) };
}

export function validateFinalHitChart(song: Pick<BassSong, "notes" | "duration" | "difficulty">) {
  const { notes, difficulty, duration } = song;
  const fail = (message: string) => { throw new Error(`最終のヒット ${difficulty}: ${message}`); };
  if (!notes.length) fail("譜面が空です");
  const ids = new Set<number>();
  for (const [index, note] of notes.entries()) {
    if (!["tap", "hold", "slap", "slide"].includes(note.kind)) fail("奏法が不正");
    if (!Number.isInteger(note.id) || ids.has(note.id)) fail("ID重複または不正"); ids.add(note.id);
    if (!Number.isFinite(note.time) || note.time < 0 || (note.endTime ?? note.time) > duration) fail("曲の時間範囲外");
    if (!Number.isInteger(note.midi) || note.midi < 28 || note.midi > 48 ||
      !BASS_STRINGS[note.string] || note.fret < 0 || note.fret > 5 || !Number.isInteger(note.fret) || BASS_STRINGS[note.string].openMidi + note.fret !== note.midi) fail("音高・運指が不正");
    if (note.kind === "hold" && (!Number.isFinite(note.endTime) || note.endTime! <= note.time)) fail("保持時間が不正");
    validateBassSlide(note);
    if (!index) continue;
    const previous = notes[index - 1], gap = note.time - previous.time;
    if (gap + 1e-8 < finalHitRequiredGap(previous, note, difficulty)) fail("入力間隔または運指の移動時間不足");
    if (previous.endTime !== undefined && note.time < previous.endTime + 0.16 - 1e-8) fail("保持・スライド後の解除時間不足");
  }
  const stats = finalHitChartStats(notes);
  if (stats.maxPerSecond > FINAL_HIT_LIMITS[difficulty].maxPerSecond) fail("任意の1秒間の入力上限超過");
  if (stats.slapRatio < 0.6) fail("スラップの割合不足");
  return stats;
}
