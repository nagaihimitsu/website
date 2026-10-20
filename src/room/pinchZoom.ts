export const MIN_PINCH_ZOOM = 0.7;
export const MAX_PINCH_ZOOM = 6;
export const PINCH_AVATAR_FADE_START = 3;
export const PINCH_AVATAR_FADE_END = 3.7;
export const PINCH_RETURN_SECONDS = 0.28;

/** Preserve the familiar view through 3×, then reveal scenery behind the avatar. */
export function pinchAvatarOpacity(zoom: number) {
  // An invalid diagnostic/input must never leave the avatar hidden.
  if (!Number.isFinite(zoom)) return 1;
  const progress = Math.max(0, Math.min(1,
    (zoom - PINCH_AVATAR_FADE_START) / (PINCH_AVATAR_FADE_END - PINCH_AVATAR_FADE_START),
  ));
  return 1 - progress * progress * (3 - 2 * progress);
}

interface Point {
  x: number;
  y: number;
}

interface Viewport {
  width: number;
  height: number;
}

export interface PinchZoomSnapshot {
  active: boolean;
  returning: boolean;
  zoom: number;
  /** Fractions of the full viewport for PerspectiveCamera.setViewOffset(). */
  offsetX: number;
  offsetY: number;
}

function measurement(a: Point, b: Point, viewport: Viewport) {
  if (
    ![a.x, a.y, b.x, b.y, viewport.width, viewport.height].every(Number.isFinite) ||
    viewport.width <= 0 ||
    viewport.height <= 0
  ) return null;
  const distance = Math.hypot(a.x - b.x, a.y - b.y);
  // Touches almost on top of each other cannot provide a stable scale ratio.
  if (distance < 8) return null;
  return {
    distance,
    x: (a.x + b.x) / (2 * viewport.width) - 0.5,
    y: (a.y + b.y) / (2 * viewport.height) - 0.5,
  };
}

/** Temporary lens zoom: the camera's world position and rotation stay intact. */
export function createPinchZoom() {
  let active = false;
  let zoom = 1;
  let offsetX = 0;
  let offsetY = 0;
  let previous: ReturnType<typeof measurement> = null;
  let returning: {
    elapsed: number;
    zoom: number;
    offsetX: number;
    offsetY: number;
  } | null = null;

  function reset() {
    active = false;
    zoom = 1;
    offsetX = offsetY = 0;
    previous = returning = null;
  }

  return {
    begin(a: Point, b: Point, viewport: Viewport) {
      const next = measurement(a, b, viewport);
      if (!next) return;
      active = true;
      previous = next;
      // Keep the rendered framing when a new pinch interrupts the return.
      returning = null;
    },
    move(a: Point, b: Point, viewport: Viewport) {
      if (!active || !previous) return;
      const next = measurement(a, b, viewport);
      if (!next) return;
      const nextZoom = Math.max(
        MIN_PINCH_ZOOM,
        Math.min(MAX_PINCH_ZOOM, zoom * next.distance / previous.distance),
      );
      const ratio = nextZoom / zoom;
      // Three.js projects a normalized pixel p as:
      //   p' = 0.5 + zoom * (p - 0.5) - offset.
      // Scale around the previous midpoint, then move it to the new midpoint.
      // This keeps the same scene detail between the user's fingers.
      offsetX = ratio * (previous.x + offsetX) - next.x;
      offsetY = ratio * (previous.y + offsetY) - next.y;
      zoom = nextZoom;
      // Rebase even at a clamp so reversing direction responds immediately.
      previous = next;
    },
    end() {
      if (!active) return;
      active = false;
      previous = null;
      returning = zoom !== 1 || offsetX !== 0 || offsetY !== 0
        ? { elapsed: 0, zoom, offsetX, offsetY }
        : null;
    },
    reset,
    step(elapsed: number, reducedMotion: boolean) {
      if (!returning) return;
      if (reducedMotion) {
        reset();
        return;
      }
      if (!Number.isFinite(elapsed) || elapsed <= 0) return;
      returning.elapsed += elapsed;
      const progress = Math.min(1, returning.elapsed / PINCH_RETURN_SECONDS);
      if (progress === 1) {
        reset();
        return;
      }
      const remaining = (1 - progress) ** 3;
      zoom = 1 + (returning.zoom - 1) * remaining;
      offsetX = returning.offsetX * remaining;
      offsetY = returning.offsetY * remaining;
    },
    snapshot(): PinchZoomSnapshot {
      return { active, returning: returning !== null, zoom, offsetX, offsetY };
    },
  };
}
