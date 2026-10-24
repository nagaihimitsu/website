import { BASS_GESTURE_CONFIG as CONFIG } from "./bassGesture";

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
}
/** Pointer capture keeps the starting button and pitch across every crossed cell. */
export function createBassContacts() {
  const active = new Map<number, BassContact>();
  return {
    begin(input: BassPointerInput, songTime: number) {
      if (active.has(input.id) || ![input.id, input.x, input.y, input.time, songTime].every(Number.isFinite)) return null;
      const contact: BassContact = { ...input, songTime, dx: 0, dy: 0, duration: 0, slap: false,
        gesture: "pending", currentFret: input.fret, currentMidi: input.midi, lastTime: input.time, cancelled: false };
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
      const horizontal = Math.abs(contact.dx), vertical = Math.abs(contact.dy);
      if (contact.gesture === "pending" && contact.duration <= CONFIG.slapMaxMs &&
        vertical >= CONFIG.slapMinDistance && vertical >= horizontal * CONFIG.directionRatio &&
        vertical / Math.max(1, contact.duration) >= CONFIG.slapMinSpeed) {
        contact.gesture = "slap";
        contact.slap = true;
        return true;
      }
      if (contact.gesture === "pending" && horizontal >= CONFIG.slideMinDistance && horizontal >= vertical * CONFIG.directionRatio) {
        contact.gesture = contact.fret >= 1 ? "slide" : "invalid";
      }
      if (contact.gesture === "slide") {
        if (input.y < (contact.rowTop ?? contact.y - 24) - CONFIG.rowTolerance || input.y > (contact.rowBottom ?? contact.y + 24) + CONFIG.rowTolerance) {
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
