import { BASS_GESTURE_CONFIG as CONFIG } from "./bassGesture";
import type { BassNoteKind } from "./bassGame";

export interface BassPointerInput {
  id: number;
  action: "down" | "move" | "up" | "cancel";
  midi: number;
  string: 0 | 1 | 2 | 3;
  fret: number;
  x: number;
  y: number;
  time: number;
  /** 開始セルの実寸。ポインター捕捉中も同じ弦の連続座標へ変換する。 */
  fretWidth?: number;
  rowTop?: number;
  rowBottom?: number;
}
export interface BassContact extends BassPointerInput {
  songTime: number;
  endTime?: number;
  dx: number;
  dy: number;
  duration: number;
  slap: boolean;
  gesture: "pending" | "slap" | "slide" | "invalid";
  currentFret: number;
  currentMidi: number;
  lastTime: number;
  cancelled: boolean;
  noteId?: number | null;
  expectedKind?: BassNoteKind | null;
  speedX: number;
  speedY: number;
}
/** Pointer capture keeps the starting button and pitch across every crossed cell. */
export function createBassContacts() {
  const active = new Map<number, BassContact>();
  return {
    begin(input: BassPointerInput, songTime: number) {
      if (active.has(input.id) || ![input.id, input.x, input.y, input.time, songTime].every(Number.isFinite)) return null;
      const contact: BassContact = { ...input, songTime, dx: 0, dy: 0, duration: 0, slap: false,
        gesture: "pending", currentFret: input.fret, currentMidi: input.midi, lastTime: input.time, cancelled: false, speedX: 0, speedY: 0 };
      active.set(input.id, contact);
      return contact;
    },
    move(input: BassPointerInput) {
      const contact = active.get(input.id);
      if (!contact) return false;
      if (![input.time, input.x, input.y].every(Number.isFinite) || input.time < contact.lastTime) {
        contact.gesture = "invalid"; contact.cancelled = true; return false;
      }
      contact.lastTime = input.time;
      contact.dx = input.x - contact.x;
      contact.dy = input.y - contact.y;
      contact.duration = input.time - contact.time;
      contact.speedX = contact.dx / Math.max(1, contact.duration);
      contact.speedY = contact.dy / Math.max(1, contact.duration);
      const horizontal = Math.abs(contact.dx), vertical = Math.abs(contact.dy);
      const height = Math.max(1, (contact.rowBottom ?? contact.y + 24) - (contact.rowTop ?? contact.y - 24));
      const tolerance = Math.max(4, Math.min(10, height * CONFIG.rowToleranceRatio));
      const sameRow = input.y >= (contact.rowTop ?? contact.y - 24) - tolerance && input.y <= (contact.rowBottom ?? contact.y + 24) + tolerance;
      const slapDistance = contact.rowTop === undefined ? CONFIG.slapMinDistance : Math.max(18, Math.min(32, height * CONFIG.slapHeightRatio));
      const slideDistance = contact.fretWidth === undefined ? CONFIG.slideMinDistance : Math.max(10, Math.min(20, contact.fretWidth * CONFIG.slideWidthRatio));
      if (contact.gesture === "pending" && contact.duration <= CONFIG.slapMaxMs &&
        vertical >= slapDistance && vertical >= horizontal * CONFIG.directionRatio &&
        vertical / Math.max(1, contact.duration) >= CONFIG.slapMinSpeed) {
        contact.gesture = "slap";
        contact.slap = true;
        return true;
      }
      if (contact.gesture === "pending" && sameRow && horizontal >= slideDistance && horizontal >= vertical * CONFIG.directionRatio) {
        contact.gesture = contact.fret >= 1 ? "slide" : "invalid";
      }
      if (contact.gesture === "slide") {
        if (!sameRow) {
          contact.gesture = "invalid"; contact.cancelled = true;
        } else {
          contact.currentFret = Math.max(1, Math.min(5, contact.fret + contact.dx / Math.max(1, contact.fretWidth ?? 55)));
          contact.currentMidi = contact.midi + contact.currentFret - contact.fret;
        }
      }
      return false;
    },
    end(input: BassPointerInput, songTime: number) {
      const contact = active.get(input.id);
      active.delete(input.id);
      if (contact) { contact.endTime = songTime; contact.cancelled ||= input.action === "cancel"; }
      return contact;
    },
    clear: () => active.clear(),
    has: (id: number) => active.has(id),
    values: () => active.values(),
    get: (id: number) => active.get(id),
    get size() { return active.size; },
  };
}
