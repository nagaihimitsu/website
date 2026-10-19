import { expect, type Page } from "@playwright/test";
import { PerspectiveCamera, Vector3 } from "three";

export interface SavedRoomPosition {
  x: number;
  y?: number;
  z: number;
  yaw: number;
  pitch?: number;
  facing?: number;
  brokenIds?: string[];
}

export async function savedPosition(page: Page, pose: SavedRoomPosition) {
  // Restore a legitimate saved visitor position; actions still use real input.
  await page.addInitScript(
    ({ key, value }) => sessionStorage.setItem(key, JSON.stringify(value)),
    {
      key: "personal-atlas-room-position-v3",
      value: { y: 0, pitch: 0.16, facing: pose.yaw, brokenIds: [], ...pose },
    },
  );
}

export async function enterRoom(
  page: Page,
  { pausedClock = false }: { pausedClock?: boolean } = {},
) {
  await page.goto("/#/");
  if (pausedClock) {
    // Let asynchronous assets mount the engine, then explicitly paint its first
    // frames. Tests can advance simulation time independently of software GL.
    await expect.poll(async () => {
      await page.clock.runFor(32);
      return page.locator(".room-canvas canvas").isVisible();
    }, { timeout: 30000, intervals: [100] }).toBe(true);
    await page.clock.runFor(32);
  }
  const room = page.locator(".room-home");
  await expect(room).toHaveAttribute("data-room-status", "ready", {
    timeout: 30000,
  });
  await expect(page.locator(".room-canvas canvas")).toBeVisible();
  for (const coordinate of [
    "player-x", "player-z", "player-height", "yaw", "pitch", "facing",
    "camera-distance", "camera-x", "camera-y", "camera-z",
  ]) {
    await expect(room).toHaveAttribute(`data-${coordinate}`, /^-?\d+(?:\.\d+)?$/);
  }
  return room;
}

export async function position(page: Page) {
  return page.locator(".room-home").evaluate((element) => ({
    x: Number(element.getAttribute("data-player-x")),
    z: Number(element.getAttribute("data-player-z")),
    height: Number(element.getAttribute("data-player-height")),
    yaw: Number(element.getAttribute("data-yaw")),
    pitch: Number(element.getAttribute("data-pitch")),
    facing: Number(element.getAttribute("data-facing")),
    cameraDistance: Number(element.getAttribute("data-camera-distance")),
    cameraX: Number(element.getAttribute("data-camera-x")),
    cameraY: Number(element.getAttribute("data-camera-y")),
    cameraZ: Number(element.getAttribute("data-camera-z")),
  }));
}

/** Project a real mesh point into the current follow camera, including mobile FOV. */
export async function projectRoomPoint(page: Page, point: [number, number, number]) {
  const state = await position(page);
  const box = (await page.locator(".room-canvas canvas").boundingBox())!;
  const aspect = box.width / box.height;
  const camera = new PerspectiveCamera(aspect < 0.8 ? 76 : 68, aspect, 0.035, 60);
  camera.position.set(state.cameraX, state.cameraY, state.cameraZ);
  camera.lookAt(state.x, state.height + 1.02, state.z);
  camera.updateMatrixWorld();
  const projected = new Vector3(...point).project(camera);
  return {
    x: box.x + ((projected.x + 1) / 2) * box.width,
    y: box.y + ((1 - projected.y) / 2) * box.height,
    normalized: { x: projected.x, y: projected.y },
  };
}

export async function renderReleasedInput(page: Page) {
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
}

export function collectPageErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}
