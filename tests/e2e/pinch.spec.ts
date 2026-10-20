import { test, expect, type CDPSession, type Page } from "@playwright/test";
import { PerspectiveCamera, Vector3 } from "three";
import { collectPageErrors, enterRoom, position, savedPosition } from "./helpers/room";

test.describe.configure({ timeout: 90_000 });
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

type Contact = { id: number; x: number; y: number };
function touches(cdp: CDPSession) {
  let count = 0;
  return {
    async start(points: Contact[]) {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: points });
      count = points.length;
    },
    async move(points: Contact[]) {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: points });
    },
    async end(points: Contact[] = []) {
      if (!count) return;
      // CDP lists the lifted contacts here; [] lifts every remaining contact.
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: points });
      count = points.length ? count - points.length : 0;
    },
    async cancel() {
      if (!count) return;
      await cdp.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
      count = 0;
    },
  };
}

async function prepare(page: Page, reducedMotion = false, terrace = false) {
  await page.emulateMedia({ reducedMotion: reducedMotion ? "reduce" : "no-preference" });
  const time = new Date("2026-10-20T00:00:00Z");
  await page.clock.install({ time });
  await page.clock.pauseAt(new Date(time.getTime() + 60_000));
  await savedPosition(page, terrace
    ? { x: 1.65, z: 5.6, yaw: Math.PI, facing: Math.PI, doorOpen: true }
    : { x: 0.95, z: -0.45, yaw: 0 });
  const room = await enterRoom(page, { pausedClock: true });
  await page.clock.runFor(128);
  await expect(room).toHaveAttribute("data-camera-zoom", /^1(?:\.0+)?$/);
  return room;
}

async function projection(page: Page) {
  return page.locator(".room-home").evaluate((element) => ({
    zoom: Number(element.getAttribute("data-camera-zoom")),
    offsetX: Number(element.getAttribute("data-camera-offset-x")),
    offsetY: Number(element.getAttribute("data-camera-offset-y")),
  }));
}

async function expectNormalProjection(page: Page) {
  await expect(page.locator(".room-home")).toHaveAttribute("data-pinching", "false");
  expect(await projection(page)).toEqual({ zoom: 1, offsetX: 0, offsetY: 0 });
}

// Reconstruct the actual camera from its published diagnostics. The ray through
// an off-centre pixel must remain under the midpoint, at both zoom directions.
// This fails if integration merely changes a centred FOV or reverses offsets.
async function expectAnchor(page: Page, initial: Awaited<ReturnType<typeof position>>,
  anchor: { x: number; y: number }, midpoint = anchor) {
  const box = (await page.locator(".room-canvas canvas").boundingBox())!;
  const aspect = box.width / box.height;
  const camera = new PerspectiveCamera(aspect < 0.8 ? 76 : 68, aspect, 0.035, 60);
  camera.position.set(initial.cameraX, initial.cameraY, initial.cameraZ);
  camera.lookAt(initial.x, initial.height + 1.02, initial.z);
  camera.updateMatrixWorld();
  const point = new Vector3(
    (anchor.x - box.x) / box.width * 2 - 1,
    1 - (anchor.y - box.y) / box.height * 2, 0.5,
  ).unproject(camera);
  const state = await projection(page);
  camera.zoom = state.zoom;
  camera.setViewOffset(box.width, box.height,
    state.offsetX * box.width, state.offsetY * box.height, box.width, box.height);
  camera.updateProjectionMatrix();
  const projected = point.project(camera);
  expect(Math.abs(box.x + (projected.x + 1) * box.width / 2 - midpoint.x)).toBeLessThan(1);
  expect(Math.abs(box.y + (1 - projected.y) * box.height / 2 - midpoint.y)).toBeLessThan(1);
}

test("触れた位置を拡大・縮小し、片指を離すと元のビューへ戻る", { tag: "@pinch" }, async ({ page, context }) => {
  const errors = collectPageErrors(page);
  const room = await prepare(page);
  const initial = await position(page);
  const hudBefore = await page.locator(".room-jump").boundingBox();
  const canvasBefore = await page.locator(".room-canvas canvas").boundingBox();
  const cdp = await context.newCDPSession(page);
  const input = touches(cdp);
  try {
    await page.screenshot({ path: "docs/screenshots/pinch-mobile-normal.png" });
    const a = { id: 1, x: 225, y: 270 }, b = { id: 2, x: 305, y: 270 };
    await input.start([a, b]);
    await page.clock.runFor(128);
    await expect(room).toHaveAttribute("data-pinching", "true");
    const wide = [{ ...a, x: 160, y: 285 }, { ...b, x: 340, y: 285 }];
    await input.move(wide);
    await page.clock.runFor(128);
    expect((await projection(page)).zoom).toBeCloseTo(2.25, 2);
    await expectAnchor(page, initial, { x: 265, y: 270 }, { x: 250, y: 285 });
    await page.keyboard.down("KeyW");
    await page.keyboard.press("Space");
    await page.keyboard.press("KeyF");
    await page.keyboard.press("KeyR");
    await page.clock.fastForward(450);
    await page.keyboard.up("KeyW");
    expect(await position(page)).toEqual(initial);
    await expect(room).toHaveAttribute("data-punching", "false");
    expect(await page.locator(".room-jump").boundingBox()).toEqual(hudBefore);
    expect(await page.locator(".room-canvas canvas").boundingBox()).toEqual(canvasBefore);
    expect(await page.evaluate(() => window.visualViewport?.scale)).toBe(1);
    await page.screenshot({ path: "docs/screenshots/pinch-mobile-in.png" });

    // One lifted contact ends zoom, while the surviving finger cannot orbit or
    // activate a collection. The return animation is genuinely intermediate.
    await input.end([wide[0]]);
    await page.clock.runFor(128);
    await expect(room).toHaveAttribute("data-pinching", "false");
    expect((await projection(page)).zoom).toBeGreaterThan(1);
    expect((await projection(page)).zoom).toBeLessThan(2.25);
    await input.move([{ ...wide[1], x: 240, y: 400 }]);
    await page.clock.fastForward(650);
    await expectNormalProjection(page);
    expect(await position(page)).toEqual(initial);
    await input.end();
    await expect(page).toHaveURL(/#\/$/);

    const c = { id: 3, x: 60, y: 330 }, d = { id: 4, x: 220, y: 330 };
    await input.start([c, d]);
    await input.move([{ ...c, x: 110 }, { ...d, x: 170 }]);
    await page.clock.runFor(128);
    expect((await projection(page)).zoom).toBeCloseTo(0.7, 2);
    await expectAnchor(page, initial, { x: 140, y: 330 });
    expect(await position(page)).toEqual(initial);
    await page.screenshot({ path: "docs/screenshots/pinch-mobile-out.png" });
    await input.end();
    await page.clock.fastForward(750);
    await expectNormalProjection(page);
    expect(await position(page)).toEqual(initial);

    // A fresh one-finger gesture still looks around normally.
    await input.start([{ id: 5, x: 230, y: 350 }]);
    await input.move([{ id: 5, x: 290, y: 365 }]);
    await input.end();
    await page.clock.runFor(128);
    expect(Math.abs((await position(page)).yaw - initial.yaw)).toBeGreaterThan(0.2);
    await expectNormalProjection(page);
    await expect(page).toHaveURL(/#\/$/);
    expect(errors).toEqual([]);
  } finally { await input.end(); await cdp.detach(); }
});

test("中断・画面回転でズームを解除し、移動スティックと見回しは併用できる", { tag: "@pinch" }, async ({ page, context }) => {
  const errors = collectPageErrors(page);
  await page.setViewportSize({ width: 844, height: 390 });
  const room = await prepare(page, true);
  const cdp = await context.newCDPSession(page);
  const input = touches(cdp);
  const start = [{ id: 1, x: 350, y: 140 }, { id: 2, x: 450, y: 140 }];
  const wide = [{ ...start[0], x: 300 }, { ...start[1], x: 500 }];
  try {
    await input.start(start);
    await input.move(wide);
    await page.clock.runFor(128);
    expect((await projection(page)).zoom).toBeCloseTo(2, 2);
    await input.cancel();
    await page.clock.runFor(128);
    await expectNormalProjection(page);

    await input.start(start);
    await input.move(wide);
    await page.clock.runFor(128);
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await page.clock.runFor(128);
    await expectNormalProjection(page);
    await input.end();

    await input.start(start);
    await input.move(wide);
    await page.clock.runFor(128);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(() => page.locator(".room-canvas canvas").evaluate((element) => (element as HTMLCanvasElement).width)).toBe(390);
    await page.clock.runFor(128);
    await expectNormalProjection(page);
    await input.end();

    const stickBox = (await page.getByRole("group", { name: "移動スティック", exact: true }).boundingBox())!;
    const stick = { id: 3, x: stickBox.x + stickBox.width / 2, y: stickBox.y + stickBox.height / 2 };
    const pulled = { ...stick, y: stick.y - stickBox.width * 0.15 };
    const look = { id: 4, x: 245, y: 340 };
    const before = await position(page);
    await input.start([stick]);
    await input.move([pulled]);
    await input.start([pulled, look]);
    await input.move([pulled, { ...look, x: 300 }]);
    await page.clock.fastForward(350);
    // Native touch moves may be coalesced onto the next compositor frame.
    await page.clock.runFor(128);
    await expectNormalProjection(page);
    const after = await position(page);
    expect(Math.abs(after.yaw - before.yaw)).toBeGreaterThan(0.15);
    expect(Math.hypot(after.x - before.x, after.z - before.z)).toBeGreaterThan(0.1);
    await input.end();
    await page.clock.fastForward(200);
    await expect(room).toHaveAttribute("data-room-status", "ready");
    expect(errors).toEqual([]);
  } finally { await input.end(); await cdp.detach(); }
});

test("ベースを持っている間はピンチで演奏用の表示を拡大しない", { tag: "@pinch" }, async ({ page, context }) => {
  const errors = collectPageErrors(page);
  const room = await prepare(page, true, true);
  await page.clock.fastForward(3100);
  await page.clock.fastForward(1000);
  await expect(room).toHaveAttribute("data-bass-phase", "ready");
  const cdp = await context.newCDPSession(page);
  const input = touches(cdp);
  try {
    await input.start([{ id: 1, x: 130, y: 200 }, { id: 2, x: 230, y: 200 }]);
    await input.move([{ id: 1, x: 70, y: 200 }, { id: 2, x: 300, y: 200 }]);
    await page.clock.runFor(128);
    await expect(room).toHaveAttribute("data-pinching", "false");
    expect((await projection(page)).zoom).toBe(1);
    await expect(room).toHaveAttribute("data-bass-phase", "ready");
    await input.end();
    await page.getByRole("button", { name: "ベースを置く", exact: true }).tap();
    await page.clock.fastForward(1000);
    await input.start([{ id: 3, x: 130, y: 200 }, { id: 4, x: 230, y: 200 }]);
    await input.move([{ id: 3, x: 80, y: 200 }, { id: 4, x: 280, y: 200 }]);
    await page.clock.runFor(128);
    await expect(room).toHaveAttribute("data-pinching", "true");
    expect((await projection(page)).zoom).toBeCloseTo(2, 2);
    await input.end();
    await page.clock.runFor(128);
    await expectNormalProjection(page);
    expect(errors).toEqual([]);
  } finally { await input.end(); await cdp.detach(); }
});

test("3倍を超えた時だけ旅人が滑らかに消え、縮小・解除すると戻る", { tag: "@pinch" }, async ({ page, context }) => {
  const errors = collectPageErrors(page);
  const room = await prepare(page);
  const initial = await position(page);
  const hudBefore = await page.locator(".room-jump").boundingBox();
  const cdp = await context.newCDPSession(page);
  const input = touches(cdp);
  // Frame the traveller's head/hood off-centre so screenshots prove that the
  // actual model fades, rather than merely being cropped outside the view.
  const anchor = { x: 215, y: 450 };
  const contacts = (zoom: number, firstId = 1): Contact[] => [
    { id: firstId, x: anchor.x - 20 * zoom, y: anchor.y },
    { id: firstId + 1, x: anchor.x + 20 * zoom, y: anchor.y },
  ];
  const opacity = async () => Number(await room.getAttribute("data-avatar-opacity"));
  const expectShown = async () => {
    await expect(room).toHaveAttribute("data-avatar-visible", "true");
    expect(await opacity()).toBe(1);
  };
  const zoomTo = async (zoom: number, firstId = 1) => {
    await input.move(contacts(zoom, firstId));
    // Chromium can deliver small native touch moves on a later compositor
    // frame; wait for both that event and the throttled camera snapshot.
    await expect.poll(async () => {
      await page.clock.runFor(128);
      return (await projection(page)).zoom;
    }).toBeCloseTo(zoom, 2);
    await expectAnchor(page, initial, anchor);
    expect(await position(page)).toEqual(initial);
  };
  try {
    await expectShown();
    await input.start(contacts(1));
    await zoomTo(3);
    await expectShown();
    await page.screenshot({ path: "docs/screenshots/pinch-avatar-3x.png" });

    await zoomTo(3.35);
    await expect(room).toHaveAttribute("data-avatar-visible", "true");
    expect(await opacity()).toBeGreaterThan(0.35);
    expect(await opacity()).toBeLessThan(0.65);
    await page.screenshot({ path: "docs/screenshots/pinch-avatar-fading.png" });

    await zoomTo(4.5);
    await expect(room).toHaveAttribute("data-avatar-visible", "false");
    expect(await opacity()).toBe(0);
    await zoomTo(6);
    await expect(room).toHaveAttribute("data-avatar-visible", "false");
    expect(await opacity()).toBe(0);
    expect(await page.locator(".room-jump").boundingBox()).toEqual(hudBefore);
    expect(await page.evaluate(() => window.visualViewport?.scale)).toBe(1);
    await page.screenshot({ path: "docs/screenshots/pinch-avatar-6x.png" });

    await zoomTo(2.8);
    await expectShown();
    await page.screenshot({ path: "docs/screenshots/pinch-avatar-reversed.png" });
    await zoomTo(0.7);
    await expectShown();
    await zoomTo(6);
    await input.end();
    await page.clock.fastForward(500);
    await page.clock.runFor(128);
    await expectNormalProjection(page);
    await expectShown();
    expect(await position(page)).toEqual(initial);
    await page.screenshot({ path: "docs/screenshots/pinch-avatar-restored.png" });

    // Cancellation and losing focus cannot leave the entire avatar hidden.
    for (const [index, reason] of ["cancel", "blur"].entries()) {
      const firstId = 3 + index * 2;
      await input.start(contacts(1, firstId));
      await zoomTo(6, firstId);
      await expect(room).toHaveAttribute("data-avatar-visible", "false");
      if (reason === "cancel") await input.cancel();
      else await page.evaluate(() => window.dispatchEvent(new Event("blur")));
      await page.clock.fastForward(500);
      await page.clock.runFor(128);
      await expectNormalProjection(page);
      await expectShown();
      expect(await position(page)).toEqual(initial);
      await input.end();
    }
    await expect(page).toHaveURL(/#\/$/);
    expect(errors).toEqual([]);
  } finally { await input.end(); await cdp.detach(); }
});
