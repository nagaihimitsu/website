import type { BassString, BassTechnique } from "./bassGame";

export const BASS_TAP_MAX_MS = 220;
export const BASS_TAP_MAX_MOVEMENT = 12;
export const BASS_SLAP_MAX_MS = 250;
export const BASS_SLAP_MIN_DISTANCE = 24;
export const BASS_SLAP_DIRECTION_RATIO = 1.35;

export interface BassGesturePoint {
  pointerId: number;
  x: number;
  y: number;
  time: number;
}

export interface BassGestureInput {
  string: BassString;
  technique: BassTechnique;
}

interface ActiveGesture extends BassGesturePoint {
  string: BassString;
  lastTime: number;
  maxMovement: number;
  emitted: boolean;
}

function isFinitePoint(point: BassGesturePoint) {
  return Number.isFinite(point.pointerId) && Number.isFinite(point.x) &&
    Number.isFinite(point.y) && Number.isFinite(point.time);
}

/** One captured contact controls its original string, even when it crosses another row. */
export function createBassGesture() {
  let active: ActiveGesture | null = null;

  function begin(point: BassGesturePoint & { string: BassString }) {
    if (active || !isFinitePoint(point) || !Number.isInteger(point.string) ||
      point.string < 0 || point.string > 3) return false;
    active = { ...point, lastTime: point.time, maxMovement: 0, emitted: false };
    return true;
  }

  function move(point: BassGesturePoint): BassGestureInput | null {
    if (!active || active.pointerId !== point.pointerId) return null;
    if (!isFinitePoint(point) || point.time < active.lastTime) {
      active = null;
      return null;
    }
    active.lastTime = point.time;
    const dx = point.x - active.x;
    const dy = point.y - active.y;
    active.maxMovement = Math.max(active.maxMovement, Math.hypot(dx, dy));
    if (active.emitted) return null;
    if (point.time - active.time <= BASS_SLAP_MAX_MS &&
      -dy >= BASS_SLAP_MIN_DISTANCE && -dy >= BASS_SLAP_DIRECTION_RATIO * Math.abs(dx)) {
      active.emitted = true;
      return { string: active.string, technique: "slap" };
    }
    return null;
  }

  function end(point: BassGesturePoint): BassGestureInput | null {
    if (!active || active.pointerId !== point.pointerId) return null;
    // The release can contain a last movement not delivered in a pointermove event.
    const swipe = move(point);
    if (!active) return null;
    const contact = active;
    active = null;
    if (swipe) return swipe;
    if (!contact.emitted && point.time - contact.time <= BASS_TAP_MAX_MS &&
      contact.maxMovement <= BASS_TAP_MAX_MOVEMENT) {
      return { string: contact.string, technique: "pick" };
    }
    return null;
  }

  function cancel(pointerId?: number) {
    if (pointerId === undefined || active?.pointerId === pointerId) active = null;
  }

  return { begin, move, end, cancel, reset: () => { active = null; } };
}
