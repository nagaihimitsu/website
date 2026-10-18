import { test, expect, type Page } from "@playwright/test";

async function birdPose(page: Page) {
  return page.locator(".room-home").evaluate((element) => ({
    x: Number(element.getAttribute("data-bird-x")),
    z: Number(element.getAttribute("data-bird-z")),
    y: Number(element.getAttribute("data-bird-height")),
  }));
}

async function enter(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/#/");
  await expect(page.locator(".room-home")).toHaveAttribute(
    "data-room-status", "ready", { timeout: 30000 },
  );
  return errors;
}

test("小鳥が短く跳ねて移動し、メニュー中は止まる", async ({ page }) => {
  const errors = await enter(page);
  const start = await birdPose(page);
  await expect.poll(async () => (await birdPose(page)).y, { timeout: 15000 })
    .toBeGreaterThan(0.025);
  await expect.poll(async () => {
    const bird = await birdPose(page);
    return Math.hypot(bird.x - start.x, bird.z - start.z);
  }, { timeout: 15000 }).toBeGreaterThan(0.18);
  await page.locator(".room-menu-toggle").click();
  await expect(page.locator(".room-menu")).toBeVisible();
  const paused = await birdPose(page);
  await page.waitForTimeout(450);
  expect(await birdPose(page)).toEqual(paused);
  await page.getByRole("button", { name: "部屋に戻る", exact: true }).click();
  await expect.poll(async () => {
    const bird = await birdPose(page);
    return Math.hypot(bird.x - paused.x, bird.z - paused.z);
  }, { timeout: 15000 }).toBeGreaterThan(0.1);
  expect(errors).toEqual([]);
});

test("小鳥をすり抜けず、パンチで壊れない", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    sessionStorage.setItem("personal-atlas-room-position-v3", JSON.stringify({
      x: 0.05, y: 0, z: -0.7, yaw: 0, pitch: 0.16, facing: 0, brokenIds: [],
    }));
  });
  const errors = await enter(page);
  const room = page.locator(".room-home");
  const bird = await birdPose(page);
  await page.keyboard.down("ArrowUp");
  try {
    await expect.poll(async () => Number(await room.getAttribute("data-player-z")))
      .toBeLessThan(-0.9);
    await page.waitForTimeout(450);
  } finally {
    await page.keyboard.up("ArrowUp");
  }
  const playerZ = Number(await room.getAttribute("data-player-z"));
  // The bird's .21 m half-width and the visitor's .22 m radius remain separate.
  expect(playerZ - bird.z).toBeGreaterThanOrEqual(0.429);
  expect(playerZ - bird.z).toBeLessThan(0.5);
  expect(await birdPose(page)).toEqual(bird);
  await page.keyboard.press("KeyF");
  await expect(room).toHaveAttribute("data-punching", "true");
  await expect(room).toHaveAttribute("data-punching", "false");
  await expect(room).toHaveAttribute("data-broken-count", "0");
  expect(await birdPose(page)).toEqual(bird);
  await expect(room).toHaveAttribute("data-room-status", "ready");
  expect(errors).toEqual([]);
});
