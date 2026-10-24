import { BASS_SLAP_MAX_MS, BASS_SLAP_MIN_DISTANCE, BASS_SLAP_DIRECTION_RATIO } from "./bassGesture";

export interface BassPointerInput {
  id: number;
  action: "down" | "move" | "up" | "cancel";
  midi: number;
  string: 0 | 1 | 2 | 3;
  fret: number;
  x: number;
  y: number;
  time: number;
}
export interface BassContact extends BassPointerInput {
  songTime: number;
  endTime?: number;
  dx: number;
  dy: number;
  duration: number;
  slap: boolean;
}
/** Pointer capture keeps the starting button and pitch across every crossed cell. */
export function createBassContacts() {
  const active = new Map<number, BassContact>();
  return {
    begin(input: BassPointerInput, songTime: number) {
      if (active.has(input.id) || ![input.id, input.x, input.y, input.time, songTime].every(Number.isFinite)) return null;
      const contact = { ...input, songTime, dx: 0, dy: 0, duration: 0, slap: false };
      active.set(input.id, contact);
      return contact;
    },
    move(input: BassPointerInput) {
      const contact = active.get(input.id);
      if (!contact || input.time < contact.time) return false;
      contact.dx = input.x - contact.x;
      contact.dy = input.y - contact.y;
      contact.duration = input.time - contact.time;
      if (!contact.slap && contact.duration <= BASS_SLAP_MAX_MS &&
        -contact.dy >= BASS_SLAP_MIN_DISTANCE && -contact.dy >= Math.abs(contact.dx) * BASS_SLAP_DIRECTION_RATIO) {
        contact.slap = true;
        return true;
      }
      return false;
    },
    end(input: BassPointerInput, songTime: number) {
      const contact = active.get(input.id);
      active.delete(input.id);
      if (contact) contact.endTime = songTime;
      return contact;
    },
    clear: () => active.clear(),
    has: (id: number) => active.has(id),
    get size() { return active.size; },
  };
}
