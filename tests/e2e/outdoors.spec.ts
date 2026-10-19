import { test, expect, type Page } from "@playwright/test";
import { collectPageErrors, enterRoom, position } from "./helpers/room";

test.describe.configure({ timeout: 90_000 });

async function prepare(page: Page) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const time = new Date("2026-01-01T00:00:00Z");
  await page.clock.install({ time });
  await page.clock.pauseAt(new Date(time.getTime() + 60_000));
  // Seed once: subsequent navigation must restore the engine's own saved pose.
  await page.addInitScript(() => {
    const key = "personal-atlas-room-position-v3";
    if (!sessionStorage.getItem(key)) sessionStorage.setItem(key, JSON.stringify({
      x: 2.75, y: 0, z: 3.1, yaw: Math.PI, facing: Math.PI, pitch: 0.16,
      brokenIds: [], doorOpen: false,
    }));
  });
  return enterRoom(page, { pausedClock: true });
}

async function walk(page: Page, key: string, milliseconds: number) {
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  await page.keyboard.down(key);
  try {
    for (let remaining = milliseconds; remaining > 0; remaining -= 900)
      await page.clock.fastForward(Math.min(900, remaining));
  }
  finally { await page.keyboard.up(key); }
  await page.clock.fastForward(150);
  return position(page);
}

test("閉じた扉をパンチで開き、室内とテラスを連続して往復・復元できる", { tag: "@outdoors" }, async ({ page }) => {
  const errors = collectPageErrors(page);
  const room = await prepare(page);
  const blocked = await walk(page, "KeyW", 600);
  expect(blocked.z).toBeGreaterThan(3.5);
  expect(blocked.z).toBeLessThan(3.66);
  await expect(room).toHaveAttribute("data-door-open", "false");
  await page.keyboard.press("KeyF");
  await page.clock.fastForward(200);
  await page.clock.fastForward(600);
  await expect(room).toHaveAttribute("data-door-open", "true");
  await page.screenshot({ path: "docs/screenshots/door-open-desktop.png" });

  // Walk far enough that the trailing camera also crosses the doorway.
  const outside = await walk(page, "KeyW", 1350);
  expect(outside.z).toBeGreaterThan(7);
  expect(outside.z).toBeLessThan(7.8);
  expect(outside.height).toBe(0);
  expect(outside.cameraZ).toBeGreaterThan(4.2);
  await expect(room).toHaveAttribute("data-grounded", "true");
  await expect(page).toHaveURL(/#\/$/);
  await page.screenshot({ path: "docs/screenshots/terrace-desktop.png" });

  // Opening the existing menu pauses the world and commits the visitor pose.
  await page.locator(".room-menu-toggle").click();
  const saved = await page.evaluate(() => JSON.parse(sessionStorage.getItem("personal-atlas-room-position-v3")!));
  expect(saved.doorOpen).toBe(true);
  expect(saved.z).toBeCloseTo(outside.z, 2);
  await page.reload();
  await enterRoom(page, { pausedClock: true });
  await expect(room).toHaveAttribute("data-door-open", "true");
  expect((await position(page)).z).toBeCloseTo(outside.z, 2);
  const inside = await walk(page, "ArrowDown", 1450);
  expect(inside.z).toBeLessThan(3.6);
  expect(inside.height).toBe(0);
  await expect(room).toHaveAttribute("data-grounded", "true");
  expect(errors).toEqual([]);
});

test.describe("touch", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  test("スマホのパンチと移動スティックでテラスへ出られる", { tag: "@outdoors" }, async ({ page, context }) => {
    const errors = collectPageErrors(page);
    const room = await prepare(page);
    await page.getByRole("button", { name: "パンチ", exact: true }).tap();
    await page.clock.fastForward(200);
    await page.clock.fastForward(600);
    await expect(room).toHaveAttribute("data-door-open", "true");
    const stick = await page.getByRole("group", { name: "移動スティック", exact: true }).boundingBox();
    const center = { x: stick!.x + stick!.width / 2, y: stick!.y + stick!.height / 2, id: 1 };
    const cdp = await context.newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [center] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ ...center, y: center.y - stick!.width * 0.4 }] });
    try {
      await page.clock.fastForward(900);
      await page.clock.fastForward(600);
    }
    finally { await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); }
    await page.clock.fastForward(150);
    const outside = await position(page);
    expect(outside.z).toBeGreaterThan(5.5);
    expect(outside.height).toBe(0);
    expect(outside.cameraZ).toBeGreaterThan(4.1);
    await expect(room).toHaveAttribute("data-grounded", "true");
    await page.screenshot({ path: "docs/screenshots/terrace-mobile.png" });
    expect(errors).toEqual([]);
  });
});
