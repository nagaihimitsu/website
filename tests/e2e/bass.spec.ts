import { test, expect, type CDPSession, type Locator, type Page } from "@playwright/test";
import { BASS_COUNTDOWN_SECONDS, BASS_CHART, BASS_DURATION, BASS_PHRASES, BASS_STRINGS, type BassString } from "../../src/room/bassGame";
import { collectPageErrors, enterRoom, position, savedPosition } from "./helpers/room";

test.describe.configure({ timeout: 120_000 });

const holdKeys = ["Digit1", "Digit2", "Digit3", "Digit4"];
const pluckKeys = ["Digit7", "Digit8", "Digit9", "Digit0"];
const holdPad = (page: Page, string: BassString) => page.locator(`[data-bass-hold="${string}"]`);
const pluckPad = (page: Page, string: BassString) => page.locator(`[data-bass-pick="${string}"]`);

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

async function clockNow(page: Page) {
  return page.evaluate(() => performance.now());
}

async function advanceSongTo(page: Page, startedAt: number, seconds: number) {
  const remaining = startedAt + (BASS_COUNTDOWN_SECONDS + seconds) * 1000 - await clockNow(page);
  expect(remaining).toBeGreaterThanOrEqual(-1);
  if (remaining > 0) await page.clock.fastForward(remaining);
}

async function walk(page: Page, key: string, duration: number) {
  await page.locator(".room-canvas canvas").focus();
  await page.keyboard.down(key);
  try { await page.clock.fastForward(duration); }
  finally { await page.keyboard.up(key); }
  await page.clock.fastForward(150);
}

async function expectPadsFit(page: Page) {
  const viewport = page.viewportSize()!;
  for (const [index, string] of BASS_STRINGS.entries()) {
    const row = index as BassString;
    const left = holdPad(page, row), right = pluckPad(page, row);
    await expect(left).toHaveAccessibleName(new RegExp(`${string.name}弦`));
    await expect(right).toHaveAccessibleName(new RegExp(`${string.name}弦`));
    for (const control of [left, right]) {
      await expect(control).toBeVisible();
      const box = (await control.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

type TouchPoint = { x: number; y: number; id: number };
async function touchPoint(control: Locator, id: number): Promise<TouchPoint> {
  const box = (await control.boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, id };
}
function createTouchInput(cdp: CDPSession) {
  const activeContacts = new Set<number>();
  async function send(type: "touchStart" | "touchEnd", touchPoints: TouchPoint[]) {
    // CDP touchEnd lists the contacts being lifted; [] lifts every contact.
    await cdp.send("Input.dispatchTouchEvent", { type, touchPoints });
    if (type === "touchStart") {
      for (const point of touchPoints) activeContacts.add(point.id);
    } else if (touchPoints.length) {
      for (const point of touchPoints) activeContacts.delete(point.id);
    } else activeContacts.clear();
  }
  return {
    send,
    async releaseAll() {
      // Chromium rejects a second touchEnd after the final contact is gone.
      if (activeContacts.size) await send("touchEnd", []);
    },
  };
}

// Two browser journeys keep native audio, keyboard input and real multi-contact
// input covered while sharing the expensive software-rendered room startup.
test("5秒でベースを取り、左手を押さえた行だけ右手で弾き、同じ部屋へ戻せる", { tag: "@bass" }, async ({ page }) => {
  const errors = collectPageErrors(page);
  const room = await prepare(page);
  const canvas = page.locator(".room-canvas canvas");
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
  await canvas.focus();
  await page.keyboard.press("Space");
  let startedAt = await clockNow(page);
  await expect(room).toHaveAttribute("data-bass-phase", "countdown");
  expect((await audioCounters(page)).contexts).toBe(1);

  const first = BASS_CHART[0];
  const leftKey = holdKeys[first.string], rightKey = pluckKeys[first.string];
  const wrongKey = pluckKeys[(first.string + 1) % 4];
  const left = holdPad(page, first.string);
  await advanceSongTo(page, startedAt, first.time);
  await expect(left).toHaveAttribute("data-fret", String(first.fret));
  // Freeze at this note for all negative inputs: none can accidentally score
  // the next eighth note, and left input alone never performs the right hand.
  await page.keyboard.press(rightKey);
  await page.keyboard.press("Space");
  await page.keyboard.press("Enter");
  await expect(room).toHaveAttribute("data-bass-hits", "0");
  await expect(room).toHaveAttribute("data-bass-score", "0");
  await page.keyboard.down(leftKey);
  await expect(left).toHaveAttribute("aria-pressed", "true");
  await expect(room).toHaveAttribute("data-bass-hits", "0");
  await expect(room).toHaveAttribute("data-bass-score", "0");
  await page.keyboard.press(wrongKey);
  await expect(room).toHaveAttribute("data-bass-hits", "0");
  await page.keyboard.press(rightKey);
  await expect(room).toHaveAttribute("data-bass-hits", "1");
  const firstScore = Number(await room.getAttribute("data-bass-score"));
  expect(firstScore).toBeGreaterThan(0);

  await advanceSongTo(page, startedAt, BASS_CHART[1].time);
  await page.keyboard.press(rightKey);
  await expect(room).toHaveAttribute("data-bass-hits", "2");
  expect(Number(await room.getAttribute("data-bass-score"))).toBeGreaterThan(firstScore);
  await page.keyboard.up(leftKey);
  await expect(left).toHaveAttribute("aria-pressed", "false");
  await advanceSongTo(page, startedAt, BASS_CHART[2].time);
  const beforeReleasedPluck = Number(await room.getAttribute("data-bass-score"));
  await page.keyboard.press(rightKey);
  await expect(room).toHaveAttribute("data-bass-hits", "2");
  expect(Number(await room.getAttribute("data-bass-score"))).toBeLessThanOrEqual(beforeReleasedPluck);
  await page.keyboard.down(leftKey);
  await page.keyboard.press(rightKey);
  await expect(room).toHaveAttribute("data-bass-hits", "3");
  await page.screenshot({ path: "docs/screenshots/bass-playing-desktop.png" });
  expect((await audioCounters(page)).starts).toBeGreaterThan(0);
  expect((await position(page)).height).toBe(0);
  await expect(page).toHaveURL(/#\/$/);

  // The physical key stays down while the menu opens. Resuming must require
  // a new left-hand contact, even though the song itself resumes in place.
  await page.locator(".room-menu-toggle").click();
  const elapsed = await room.getAttribute("data-bass-elapsed");
  await expect(left).toHaveCount(0);
  await page.clock.fastForward(10000);
  expect(await room.getAttribute("data-bass-elapsed")).toBe(elapsed);
  startedAt += 10000;
  await page.getByRole("button", { name: "部屋に戻る", exact: true }).click();
  await expect(canvas).toBeFocused();
  await expect(left).toHaveAttribute("aria-pressed", "false");
  await advanceSongTo(page, startedAt, BASS_CHART[3].time);
  await page.keyboard.press(rightKey);
  await expect(room).toHaveAttribute("data-bass-hits", "3");
  await page.keyboard.up(leftKey);
  await page.keyboard.down(leftKey);
  await page.keyboard.press(rightKey);
  await expect(room).toHaveAttribute("data-bass-hits", "4");
  await page.keyboard.up(leftKey);
  await walk(page, "KeyW", 200);
  expect((await position(page)).z).toBeCloseTo(stationary.z, 2);

  // A sustained physical contact stays at 3F as the A-string guide changes
  // to 5F. Only releasing it moves the left pad; the right target stays put.
  const nextPosition = BASS_PHRASES.find((phrase) => phrase.string === 2 && phrase.fret === 5)!;
  const oldPosition = BASS_PHRASES.find((phrase) => phrase.string === nextPosition.string && phrase.id < nextPosition.id)!;
  const changingLeft = holdPad(page, nextPosition.string);
  const fixedRight = pluckPad(page, nextPosition.string);
  await advanceSongTo(page, startedAt, nextPosition.previewAt - 0.5);
  await canvas.focus();
  await page.keyboard.down(holdKeys[nextPosition.string]);
  await expect(changingLeft).toHaveAttribute("data-held-fret", String(oldPosition.fret));
  const heldBox = (await changingLeft.boundingBox())!;
  const rightBox = (await fixedRight.boundingBox())!;
  await advanceSongTo(page, startedAt, nextPosition.previewAt + 0.1);
  await expect(page.locator(".bass-phrase-next")).toContainText(`${nextPosition.fret}F`);
  expect((await changingLeft.boundingBox())!.x).toBeCloseTo(heldBox.x, 2);
  await advanceSongTo(page, startedAt, nextPosition.start);
  await expect(changingLeft).toHaveAttribute("data-fret", String(nextPosition.fret));
  await expect(changingLeft).toHaveAttribute("data-held-fret", String(oldPosition.fret));
  expect((await changingLeft.boundingBox())!.x).toBeCloseTo(heldBox.x, 2);
  expect((await fixedRight.boundingBox())!.x).toBeCloseTo(rightBox.x, 2);
  expect((await fixedRight.boundingBox())!.y).toBeCloseTo(rightBox.y, 2);
  await page.keyboard.up(holdKeys[nextPosition.string]);
  await expect(changingLeft).toHaveAttribute("data-held-fret", "-1");
  expect((await changingLeft.boundingBox())!.x).not.toBeCloseTo(heldBox.x, 1);
  expect((await fixedRight.boundingBox())!.x).toBeCloseTo(rightBox.x, 2);
  expect((await fixedRight.boundingBox())!.y).toBeCloseTo(rightBox.y, 2);
  await page.keyboard.down(holdKeys[nextPosition.string]);
  await expect(changingLeft).toHaveAttribute("data-held-fret", String(nextPosition.fret));
  await page.keyboard.press(pluckKeys[nextPosition.string]);
  await expect(room).toHaveAttribute("data-bass-hits", "5");
  await page.keyboard.up(holdKeys[nextPosition.string]);

  await advanceSongTo(page, startedAt, BASS_DURATION + 0.05);
  await expect(room).toHaveAttribute("data-bass-phase", "result");
  await expect(page.getByRole("button", { name: "もう一度", exact: true })).toBeVisible();
  const beforePuttingDown = await position(page);
  await page.getByRole("button", { name: "ベースを置く", exact: true }).click();
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
  test("スマホの左指を押さえたまま別の指で弾き、横向きでもEASYを再演奏できる", { tag: "@bass" }, async ({ page, context }) => {
    const errors = collectPageErrors(page);
    const room = await prepare(page);
    await page.clock.fastForward(5000);
    await page.clock.fastForward(1200);
    await expect(room).toHaveAttribute("data-bass-phase", "ready");
    expect((await audioCounters(page)).contexts).toBe(0);
    await page.getByRole("button", { name: "演奏する", exact: true }).tap();
    let startedAt = await clockNow(page);
    const first = BASS_CHART[0];
    const left = holdPad(page, first.string), right = pluckPad(page, first.string);
    await advanceSongTo(page, startedAt, first.time);
    await expectPadsFit(page);
    const cdp = await context.newCDPSession(page);
    const touch = createTouchInput(cdp);
    try {
      let leftFinger = await touchPoint(left, 1), rightFinger = await touchPoint(right, 2);
      const wrongFinger = await touchPoint(pluckPad(page, ((first.string + 1) % 4) as BassString), 3);
      await touch.send("touchStart", [rightFinger]);
      await touch.send("touchEnd", []);
      await expect(room).toHaveAttribute("data-bass-hits", "0");
      await touch.send("touchStart", [leftFinger]);
      await expect(left).toHaveAttribute("aria-pressed", "true");
      await expect(room).toHaveAttribute("data-bass-hits", "0");
      await expect(room).toHaveAttribute("data-bass-score", "0");
      await touch.send("touchStart", [leftFinger, wrongFinger]);
      await touch.send("touchEnd", [wrongFinger]);
      await expect(room).toHaveAttribute("data-bass-hits", "0");
      await touch.send("touchStart", [leftFinger, rightFinger]);
      await touch.send("touchEnd", [rightFinger]);
      await expect(room).toHaveAttribute("data-bass-hits", "1");
      await expect(left).toHaveAttribute("aria-pressed", "true");
      const firstScore = Number(await room.getAttribute("data-bass-score"));
      expect(firstScore).toBeGreaterThan(0);
      await advanceSongTo(page, startedAt, BASS_CHART[1].time);
      await touch.send("touchStart", [leftFinger, rightFinger]);
      await touch.send("touchEnd", [rightFinger]);
      await expect(room).toHaveAttribute("data-bass-hits", "2");
      expect(Number(await room.getAttribute("data-bass-score"))).toBeGreaterThan(firstScore);
      await page.screenshot({ path: "docs/screenshots/bass-playing-mobile.png" });
      await touch.send("touchEnd", []);
      await expect(left).toHaveAttribute("aria-pressed", "false");
      await advanceSongTo(page, startedAt, BASS_CHART[2].time);
      await touch.send("touchStart", [rightFinger]);
      await touch.send("touchEnd", []);
      await expect(room).toHaveAttribute("data-bass-hits", "2");
      await touch.send("touchStart", [leftFinger]);
      await touch.send("touchStart", [leftFinger, rightFinger]);
      await touch.send("touchEnd", [rightFinger]);
      await expect(room).toHaveAttribute("data-bass-hits", "3");

      // Chromium does not synthesize a button click from a secondary touch.
      // Keep the native left contact down while a trusted mouse opens the menu.
      await page.locator(".room-menu-toggle").click();
      await expect(page.locator(".room-menu")).toBeVisible();
      await expect(left).toHaveCount(0);
      const elapsed = await room.getAttribute("data-bass-elapsed");
      await page.clock.fastForward(1000);
      expect(await room.getAttribute("data-bass-elapsed")).toBe(elapsed);
      startedAt += 1000;
      await touch.send("touchEnd", []);
      await page.getByRole("button", { name: "部屋に戻る", exact: true }).tap();
      await expect(left).toHaveAttribute("aria-pressed", "false");
      await page.setViewportSize({ width: 844, height: 390 });
      await expectPadsFit(page);
      leftFinger = await touchPoint(left, 1);
      rightFinger = await touchPoint(right, 2);
      await advanceSongTo(page, startedAt, BASS_CHART[3].time);
      await touch.send("touchStart", [rightFinger]);
      await touch.send("touchEnd", []);
      await expect(room).toHaveAttribute("data-bass-hits", "3");
      await touch.send("touchStart", [leftFinger]);
      await touch.send("touchStart", [leftFinger, rightFinger]);
      await touch.send("touchEnd", [rightFinger]);
      await expect(room).toHaveAttribute("data-bass-hits", "4");
      await expect(left).toHaveAttribute("aria-pressed", "true");
      await page.screenshot({ path: "docs/screenshots/bass-playing-landscape.png" });
    } finally {
      try { await touch.releaseAll(); }
      finally { await cdp.detach(); }
    }
    expect((await audioCounters(page)).starts).toBeGreaterThan(0);
    await advanceSongTo(page, startedAt, BASS_DURATION + 0.05);
    await expect(room).toHaveAttribute("data-bass-phase", "result");
    await page.getByRole("button", { name: "もう一度", exact: true }).tap();
    await expect(room).toHaveAttribute("data-bass-phase", "countdown");
    await expect(room).toHaveAttribute("data-bass-hits", "0");
    await expect(room).toHaveAttribute("data-bass-score", "0");
    expect((await audioCounters(page)).contexts).toBe(1);
    await page.getByRole("button", { name: "ベースを置く", exact: true }).tap();
    await expect(room).toHaveAttribute("data-bass-phase", "idle");
    await expect(page).toHaveURL(/#\/$/);
    expect(errors).toEqual([]);
  });
});
