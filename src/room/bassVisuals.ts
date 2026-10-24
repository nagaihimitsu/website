import type { BassGameNote } from "./bassGame";

export const BASS_VISUAL_CONFIG = Object.freeze({ leadTime: 1.2, pixelsPerSecond: 200, futureSeconds: 2.4, judgeX: 32 });
export const timelineX = (hitTime: number, songTime: number, judgeX: number = BASS_VISUAL_CONFIG.judgeX, pixelsPerSecond: number = BASS_VISUAL_CONFIG.pixelsPerSecond) => judgeX + (hitTime - songTime) * pixelsPerSecond;
export const chargeProgress = (hitTime: number, songTime: number, leadTime: number = BASS_VISUAL_CONFIG.leadTime) => Math.min(1, Math.max(0, 1 - (hitTime - songTime) / Math.max(0.001, leadTime)));
export function nextCharge(notes: readonly BassGameNote[], midi: number) {
  return notes.find(note => note.midi === midi && (note.state === "pending" || note.state === "holding"));
}
