import { describe, expect, it } from "vitest";
import { PerspectiveCamera, Vector3 } from "three";
import {
  createPinchZoom,
  MAX_PINCH_ZOOM,
  MIN_PINCH_ZOOM,
  PINCH_AVATAR_FADE_START,
  PINCH_AVATAR_FADE_END,
  PINCH_RETURN_SECONDS,
  pinchAvatarOpacity,
  type PinchZoomSnapshot,
} from "../src/room/pinchZoom";

const viewport = { width: 390, height: 844 };
const resting = { active: false, returning: false, zoom: 1, offsetX: 0, offsetY: 0 };

function pair(x: number, y: number, span: number) {
  return [{ x: x - span / 2, y }, { x: x + span / 2, y }] as const;
}

function cameraFor(state: PinchZoomSnapshot, size = viewport) {
  const camera = new PerspectiveCamera(76, size.width / size.height, 0.035, 60);
  camera.position.set(1.4, 1.7, 2.8);
  camera.lookAt(0.8, 1.02, -0.5);
  camera.zoom = state.zoom;
  camera.setViewOffset(
    size.width, size.height, state.offsetX * size.width, state.offsetY * size.height,
    size.width, size.height,
  );
  camera.updateMatrixWorld();
  return camera;
}

function scenePoint(x: number, y: number, state = resting, size = viewport) {
  return new Vector3(2 * x / size.width - 1, 1 - 2 * y / size.height, 0.7)
    .unproject(cameraFor(state, size));
}

function project(point: Vector3, state: PinchZoomSnapshot, size = viewport) {
  const ndc = point.clone().project(cameraFor(state, size));
  return { x: (ndc.x + 1) / 2 * size.width, y: (1 - ndc.y) / 2 * size.height };
}

describe("temporary anchored pinch zoom", () => {
  it.each([viewport, { width: 844, height: 390 }])(
    "magnifies the detail between the fingers rather than the screen center (%j)",
    (size) => {
      const pinch = createPinchZoom();
      const anchor = { x: size.width * 0.72, y: size.height * 0.28 };
      const detail = scenePoint(anchor.x, anchor.y, resting, size);
      const neighbour = scenePoint(anchor.x - 12, anchor.y + 15, resting, size);
      pinch.begin(...pair(anchor.x, anchor.y, 70), size);
      pinch.move(...pair(anchor.x, anchor.y, 140), size);
      expect(pinch.snapshot().zoom).toBeCloseTo(2);
      const projected = project(detail, pinch.snapshot(), size);
      expect(projected.x).toBeCloseTo(anchor.x);
      expect(projected.y).toBeCloseTo(anchor.y);
      const enlarged = project(neighbour, pinch.snapshot(), size);
      expect(enlarged.x).toBeCloseTo(anchor.x - 24);
      expect(enlarged.y).toBeCloseTo(anchor.y + 30);
    },
  );

  it("zooms out around an off-center detail and follows a moving midpoint", () => {
    const pinch = createPinchZoom();
    const detail = scenePoint(100, 330);
    const neighbour = scenePoint(120, 310);
    pinch.begin(...pair(100, 330, 100), viewport);
    pinch.move(...pair(130, 300, 75), viewport);
    expect(pinch.snapshot().zoom).toBeCloseTo(0.75);
    const projected = project(detail, pinch.snapshot());
    expect(projected.x).toBeCloseTo(130);
    expect(projected.y).toBeCloseTo(300);
    const smaller = project(neighbour, pinch.snapshot());
    expect(smaller.x).toBeCloseTo(145);
    expect(smaller.y).toBeCloseTo(285);
  });

  it("preserves the anchor through successive off-center scale and pan updates", () => {
    const pinch = createPinchZoom();
    const detail = scenePoint(270, 270);
    pinch.begin(...pair(270, 270, 80), viewport);
    pinch.move(...pair(245, 280, 110), viewport);
    pinch.move(...pair(220, 320, 160), viewport);
    const projected = project(detail, pinch.snapshot());
    expect(pinch.snapshot().zoom).toBeCloseTo(2);
    expect(projected.x).toBeCloseTo(220);
    expect(projected.y).toBeCloseTo(320);
  });

  it("responds immediately when reversing away from either scale limit", () => {
    const pinch = createPinchZoom();
    pinch.begin(...pair(195, 300, 40), viewport);
    pinch.move(...pair(195, 300, 320), viewport);
    expect(pinch.snapshot().zoom).toBe(MAX_PINCH_ZOOM);
    pinch.move(...pair(195, 300, 280), viewport);
    expect(pinch.snapshot().zoom).toBeCloseTo(5.25);
    pinch.move(...pair(195, 300, 30), viewport);
    expect(pinch.snapshot().zoom).toBe(MIN_PINCH_ZOOM);
    pinch.move(...pair(195, 300, 40), viewport);
    expect(pinch.snapshot().zoom).toBeCloseTo(MIN_PINCH_ZOOM * 4 / 3);
  });

  it("continues through the former maximum to 6× without moving the touched detail", () => {
    const pinch = createPinchZoom();
    const detail = scenePoint(240, 300);
    const neighbour = scenePoint(230, 312);
    pinch.begin(...pair(240, 300, 40), viewport);
    for (const scale of [3, 3.35, 3.7, 6]) {
      pinch.move(...pair(240, 300, 40 * scale), viewport);
      expect(pinch.snapshot().zoom).toBeCloseTo(scale);
      const projected = project(detail, pinch.snapshot());
      expect(projected.x).toBeCloseTo(240);
      expect(projected.y).toBeCloseTo(300);
      const enlarged = project(neighbour, pinch.snapshot());
      expect(enlarged.x).toBeCloseTo(240 - 10 * scale);
      expect(enlarged.y).toBeCloseTo(300 + 12 * scale);
    }
  });

  it.each([0.75, 2, 6])("restores the exact original view smoothly from scale %s", (scale) => {
    const pinch = createPinchZoom();
    pinch.begin(...pair(260, 250, 100), viewport);
    pinch.move(...pair(280, 300, 100 * scale), viewport);
    const held = pinch.snapshot();
    pinch.end();
    expect(pinch.snapshot()).toMatchObject({ active: false, returning: true });
    pinch.step(PINCH_RETURN_SECONDS / 2, false);
    const halfway = pinch.snapshot();
    expect(Math.abs(halfway.zoom - 1)).toBeLessThan(Math.abs(held.zoom - 1));
    expect(Math.abs(halfway.offsetX)).toBeLessThan(Math.abs(held.offsetX));
    expect(Math.abs(halfway.offsetY)).toBeLessThan(Math.abs(held.offsetY));
    pinch.step(PINCH_RETURN_SECONDS / 2, false);
    expect(pinch.snapshot()).toEqual(resting);
  });

  it("returns independently of frame rate and immediately with reduced motion", () => {
    const pinches = [createPinchZoom(), createPinchZoom()];
    for (const pinch of pinches) {
      pinch.begin(...pair(260, 250, 80), viewport);
      pinch.move(...pair(260, 250, 160), viewport);
      pinch.end();
    }
    pinches[0].step(0.12, false);
    for (let i = 0; i < 12; i++) pinches[1].step(0.01, false);
    expect(pinches[0].snapshot().zoom).toBeCloseTo(pinches[1].snapshot().zoom);
    expect(pinches[0].snapshot().offsetX).toBeCloseTo(pinches[1].snapshot().offsetX);
    pinches[0].step(0, true);
    expect(pinches[0].snapshot()).toEqual(resting);
  });

  it("can begin a new pinch during the return without a jump or lost anchor", () => {
    const pinch = createPinchZoom();
    pinch.begin(...pair(260, 250, 80), viewport);
    pinch.move(...pair(260, 250, 160), viewport);
    pinch.end();
    pinch.step(0.1, false);
    const before = pinch.snapshot();
    const detail = scenePoint(120, 400, before);
    pinch.begin(...pair(120, 400, 80), viewport);
    expect(pinch.snapshot()).toEqual({ ...before, active: true, returning: false });
    pinch.move(...pair(140, 420, 120), viewport);
    const projected = project(detail, pinch.snapshot());
    expect(projected.x).toBeCloseTo(140);
    expect(projected.y).toBeCloseTo(420);
  });

  it("ignores invalid measurements and clears state on interruption", () => {
    const pinch = createPinchZoom();
    pinch.begin(...pair(100, 100, 0), viewport);
    expect(pinch.snapshot()).toEqual(resting);
    pinch.begin(...pair(100, 100, 80), { width: 0, height: 844 });
    expect(pinch.snapshot()).toEqual(resting);
    pinch.begin(...pair(100, 100, 80), viewport);
    const start = pinch.snapshot();
    pinch.move({ x: NaN, y: 100 }, { x: 100, y: 100 }, viewport);
    pinch.move(...pair(100, 100, 1), viewport);
    expect(pinch.snapshot()).toEqual(start);
    pinch.move(...pair(100, 100, 120), viewport);
    pinch.end();
    const returning = pinch.snapshot();
    pinch.step(NaN, false);
    pinch.step(-1, false);
    expect(pinch.snapshot()).toEqual(returning);
    pinch.reset();
    pinch.move(...pair(100, 100, 160), viewport);
    expect(pinch.snapshot()).toEqual(resting);
  });
});

describe("avatar visibility during close pinch inspection", () => {
  it("keeps the original zoom range opaque and fully hides at the end of the transition", () => {
    for (const zoom of [MIN_PINCH_ZOOM, 1, 2, PINCH_AVATAR_FADE_START])
      expect(pinchAvatarOpacity(zoom)).toBe(1);
    for (const zoom of [PINCH_AVATAR_FADE_END, 4, MAX_PINCH_ZOOM])
      expect(pinchAvatarOpacity(zoom)).toBe(0);
    expect(pinchAvatarOpacity((PINCH_AVATAR_FADE_START + PINCH_AVATAR_FADE_END) / 2))
      .toBeCloseTo(0.5);
  });

  it("fades continuously with soft boundaries and reverses as the fingers close", () => {
    const opacity = [3, 3.01, 3.2, 3.35, 3.5, 3.69, 3.7].map(pinchAvatarOpacity);
    expect(opacity[1]).toBeGreaterThan(0.999);
    expect(opacity.at(-2)).toBeLessThan(0.001);
    for (let index = 1; index < opacity.length; index++)
      expect(opacity[index]).toBeLessThan(opacity[index - 1]);

    const pinch = createPinchZoom();
    pinch.begin(...pair(195, 300, 40), viewport);
    pinch.move(...pair(195, 300, 240), viewport);
    expect(pinchAvatarOpacity(pinch.snapshot().zoom)).toBe(0);
    pinch.move(...pair(195, 300, 134), viewport);
    expect(pinchAvatarOpacity(pinch.snapshot().zoom)).toBeCloseTo(0.5);
    pinch.move(...pair(195, 300, 120), viewport);
    expect(pinchAvatarOpacity(pinch.snapshot().zoom)).toBe(1);
  });

  it("restores the avatar during release and on immediate cancellation", () => {
    const pinch = createPinchZoom();
    pinch.begin(...pair(195, 300, 40), viewport);
    pinch.move(...pair(195, 300, 240), viewport);
    pinch.end();
    pinch.step(0.064, false);
    expect(pinchAvatarOpacity(pinch.snapshot().zoom)).toBeGreaterThan(0);
    expect(pinchAvatarOpacity(pinch.snapshot().zoom)).toBeLessThan(1);
    pinch.step(PINCH_RETURN_SECONDS, false);
    expect(pinchAvatarOpacity(pinch.snapshot().zoom)).toBe(1);

    pinch.begin(...pair(195, 300, 40), viewport);
    pinch.move(...pair(195, 300, 240), viewport);
    pinch.reset();
    expect(pinchAvatarOpacity(pinch.snapshot().zoom)).toBe(1);
  });

  it("leaves the avatar visible for non-finite input", () => {
    for (const zoom of [NaN, Infinity, -Infinity])
      expect(pinchAvatarOpacity(zoom)).toBe(1);
  });
});
