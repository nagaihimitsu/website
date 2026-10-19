import { test, expect, type Page } from "@playwright/test";
import { BASS_COUNTDOWN_SECONDS, BASS_CHART } from "../../src/room/bassGame";
import { collectPageErrors, enterRoom, position, savedPosition } from "./helpers/room";

test.describe.configure({ timeout: 90_000 });

async function prepare(page: Page) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const time = new Date("2026-01-01T00:00:00Z");
  await page.clock.install({ time });
  await page.clock.pauseAt(new Date(time.getTime() + 60_000));
  await savedPosition(page, { x: 1.65, z: 5.6, yaw: Math.PI, facing: Math.PI, doorOpen: true });
  await page.addInitScript(() => {
    const counters = { contexts: 0, starts: 0, closes: 0 };
    Object.assign(window, { bassAudioCheck: counters });
    const NativeAudioContext = window.AudioContext;
    window.AudioContext = class extends NativeAudioContext {
      constructor(options?: AudioContextOptions) { super(options); counters.contexts++; }
      createOscillator() {
        const oscillator = super.createOscillator();
        const start = oscillator.start.bind(oscillator);
        oscillator.start = (when?: number) => { counters.starts++; start(when); };
        return oscillator;
      }
      close() { counters.closes++; return super.close(); }
    };
  });
  return enterRoom(page, { pausedClock: true });
}

async function audioCounters(page: Page) {
  return page.evaluate(() => (window as typeof window & { bassAudioCheck: { contexts: number; starts: number; closes: number } }).bassAudioCheck);
}

async function walk(page: Page, key: string, duration: number) {
  await page.locator(".room-canvas canvas").focus();
  await page.keyboard.down(key);
  try { await page.clock.fastForward(duration); }
  finally { await page.keyboard.up(key); }
  await page.clock.fastForward(150);
}

test("5秒ゲージは離れると消え、手に取ったベースを同じ画面で弾いて戻せる", { tag: "@bass" }, async ({ page }) => {
  const errors = collectPageErrors(page);
  const room = await prepare(page);
  await page.screenshot({ path: "docs/screenshots/bass-garden.png" });
  await page.clock.fastForward(3000);
  await expect(room).toHaveAttribute("data-bass-phase", "approaching");
  expect(Number(await room.getAttribute("data-bass-progress"))).toBeGreaterThan(0.5);
  await expect(page.getByRole("progressbar")).toBeVisible();
  expect((await audioCounters(page)).contexts).toBe(0);
  await walk(page, "ArrowDown", 500);
  await expect(room).toHaveAttribute("data-bass-phase", "idle");
  await expect(page.getByRole("progressbar")).toHaveCount(0);
  await page.clock.fastForward(6000);
  await expect(room).toHaveAttribute("data-bass-phase", "idle");
  await walk(page, "KeyW", 500);
  await page.clock.fastForward(4600);
  await expect(room).toHaveAttribute("data-bass-phase", "pickup");
  await page.clock.fastForward(1200);
  await expect(room).toHaveAttribute("data-bass-phase", "ready");
  await page.screenshot({ path: "docs/screenshots/bass-ready-desktop.png" });
  expect((await audioCounters(page)).contexts).toBe(0);
  const stationary = await position(page);
  await page.getByRole("button", { name: "演奏する" }).click();
  await page.clock.fastForward(BASS_COUNTDOWN_SECONDS * 1000);
  await page.clock.fastForward(BASS_CHART[0].time * 1000);
  await page.locator(".room-canvas canvas").focus();
  await page.keyboard.press("Space");
  await expect(room).toHaveAttribute("data-bass-hits", "1");
  expect((await audioCounters(page)).contexts).toBe(1);
  expect((await audioCounters(page)).starts).toBeGreaterThan(0);
  expect((await position(page)).height).toBe(0);
  await walk(page, "KeyW", 200);
  expect((await position(page)).z).toBeCloseTo(stationary.z, 2);
  await page.screenshot({ path: "docs/screenshots/bass-playing-desktop.png" });
  await expect(page).toHaveURL(/#\/$/);

  await page.locator(".room-menu-toggle").click();
  const elapsed = await room.getAttribute("data-bass-elapsed");
  await page.clock.fastForward(10000);
  expect(await room.getAttribute("data-bass-elapsed")).toBe(elapsed);
  await page.getByRole("button", { name: "部屋に戻る", exact: true }).click();
  await expect(page.locator(".room-canvas canvas")).toBeFocused();
  await page.clock.fastForward(21000);
  await expect(room).toHaveAttribute("data-bass-phase", "result");
  await expect(page.getByRole("button", { name: "もう一度" })).toBeVisible();
  const beforePuttingDown = await position(page);
  await page.getByRole("button", { name: "ベースを置く" }).click();
  await walk(page, "KeyW", 200);
  expect((await position(page)).x).toBeCloseTo(beforePuttingDown.x, 2);
  expect((await position(page)).z).toBeCloseTo(beforePuttingDown.z, 2);
  await page.clock.fastForward(250);
  await expect(room).toHaveAttribute("data-bass-phase", "idle");
  await expect(page.getByRole("group", { name: "移動スティック", exact: true })).toBeVisible();
  await page.clock.fastForward(6000);
  await expect(room).toHaveAttribute("data-bass-phase", "idle");
  await page.locator(".room-menu-toggle").click();
  await page.locator(".room-menu").getByRole("link", { name: "世界地図を開く", exact: true }).click();
  await expect(page).toHaveURL(/#\/world$/);
  await expect.poll(async () => (await audioCounters(page)).closes).toBe(1);
  expect(errors).toEqual([]);
});

test.describe("touch", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  test("スマホで音符に合わせてタップし、EASYを再演奏できる", { tag: "@bass" }, async ({ page }) => {
    const errors = collectPageErrors(page);
    const room = await prepare(page);
    await page.clock.fastForward(5000);
    await page.clock.fastForward(1200);
    await expect(room).toHaveAttribute("data-bass-phase", "ready");
    await page.getByRole("button", { name: "演奏する" }).tap();
    await page.clock.fastForward(BASS_COUNTDOWN_SECONDS * 1000);
    await page.clock.fastForward(BASS_CHART[0].time * 1000);
    await page.getByRole("button", { name: "ベースを弾く" }).tap();
    await expect(room).toHaveAttribute("data-bass-hits", "1");
    await page.clock.fastForward(625);
    await page.getByRole("button", { name: "ベースを弾く" }).tap();
    await expect(room).toHaveAttribute("data-bass-hits", "2");
    await page.screenshot({ path: "docs/screenshots/bass-playing-mobile.png" });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect((await audioCounters(page)).starts).toBeGreaterThan(0);
    await page.clock.fastForward(21000);
    await expect(room).toHaveAttribute("data-bass-phase", "result");
    await page.getByRole("button", { name: "もう一度" }).tap();
    await expect(room).toHaveAttribute("data-bass-phase", "countdown");
    await page.getByRole("button", { name: "ベースを置く" }).tap();
    await expect(room).toHaveAttribute("data-bass-phase", "idle");
    await expect(page).toHaveURL(/#\/$/);
    expect(errors).toEqual([]);
  });
});
