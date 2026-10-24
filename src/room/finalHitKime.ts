import registry from "./charts/final-hit/kime-map.json" with { type: "json" };
import type { BassDifficulty, BassNote } from "./bassGame";

export const FINAL_HIT_KIME = registry;
export const requiredFinalHitKime = (difficulty: BassDifficulty) => registry.events.filter(event => event.requiredDifficulties.includes(difficulty));

/** 背景に残す先行音・省略した反復も、別の通常音で埋めない。 */
export function inFinalHitProtectedSpace(time: number) {
  return registry.events.some(event => time >= event.guardStartSec && time <= event.guardEndSec) ||
    registry.rests.some(rest => time >= rest.startSec && time < rest.endSec);
}

export function validateFinalHitKime(notes: readonly BassNote[], difficulty: BassDifficulty, offset = 0) {
  const fail = (text: string) => { throw new Error(`最終のヒット ${difficulty}: ${text}`); };
  for (const expected of requiredFinalHitKime(difficulty)) {
    const matches = notes.filter(note => note.kimeId === expected.id);
    if (matches.length !== 1) fail(`保護キメ ${expected.id} の欠落または重複`);
  }
  for (const note of notes) {
    const time = note.time - offset;
    if (note.kimeId) {
      const expected = registry.events.find(event => event.id === note.kimeId);
      if (!expected || note.protected !== true || note.kimeGroupId !== expected.groupId || note.sourceId !== expected.sourceId ||
        note.kind !== "slap" || note.midi !== expected.midi || note.sourceMidi !== expected.sourceMidi || note.pitchMapping !== expected.pitchMapping || Math.abs(time - expected.timeSec) > 1e-6) fail(`保護キメ ${note.kimeId} の時刻・音高・奏法・フラグが変更されています`);
    } else if (note.protected || inFinalHitProtectedSpace(time)) fail("通常音がキメまたは休符の保護範囲へ侵入しています");
    if (registry.rests.some(rest => time < rest.endSec && (note.endTime === undefined ? time >= rest.startSec : note.endTime - offset > rest.startSec))) fail("保護休符への入力・保持が含まれます");
  }
}
