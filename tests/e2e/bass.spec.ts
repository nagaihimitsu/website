import { test, expect, type CDPSession, type Locator, type Page } from "@playwright/test";
import { BASS_COUNTDOWN_SECONDS, BASS_CHART, BASS_DURATION, BASS_PROXIMITY_SECONDS, BASS_PICKUP_SECONDS, BASS_SONGS, BASS_STRINGS, type BassString } from "../../src/room/bassGame";
import { collectPageErrors, enterRoom, position, savedPosition } from "./helpers/room";

test.describe.configure({ timeout: 120_000 });

interface BassAudioCounters {
  contexts: number;
  starts: number;
  closes: number;
  decodedDurations: number[];
  bufferStarts: { duration: number; offset: number; rate: number }[];
}

const pluckKeys = ["Digit7", "Digit8", "Digit9", "Digit0"];
const pluckPad = (page: Page, string: BassString) => page.locator(`[data-bass-pick="${string}"]`);

async function prepare(page: Page, { delayDecode = false }: { delayDecode?: boolean } = {}) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const time = new Date("2026-01-01T00:00:00Z");
  await page.clock.install({ time });
  await page.clock.pauseAt(new Date(time.getTime() + 60_000));
  await savedPosition(page, { x: 1.65, z: 5.6, yaw: Math.PI, facing: Math.PI, doorOpen: true });
  await page.addInitScript(({ delayDecode }) => {
    let releaseDecode = () => {};
    const decodeGate = delayDecode ? new Promise<void>((resolve) => { releaseDecode = resolve; }) : Promise.resolve();
    const counters: BassAudioCounters = { contexts: 0, starts: 0, closes: 0, decodedDurations: [], bufferStarts: [] };
    Object.assign(window, { bassAudioCheck: counters, bassReleaseDecode: releaseDecode });
    const NativeAudioContext = window.AudioContext;
    window.AudioContext = class extends NativeAudioContext {
      private readonly transportClockOrigin: number;
      constructor(options?: AudioContextOptions) {
        super(options);
        this.transportClockOrigin = performance.now();
        counters.contexts++;
      }
      // Accelerated browser journeys use a virtual transport clock. Decoding and
      // the audio graph stay native; real-time playback is checked separately.
      get currentTime() { return (performance.now() - this.transportClockOrigin) / 1000; }
      createOscillator() {
        const oscillator = super.createOscillator();
        const start = oscillator.start.bind(oscillator);
        oscillator.start = (when?: number) => { counters.starts++; start(when); };
        return oscillator;
      }
      decodeAudioData(data: ArrayBuffer, success?: DecodeSuccessCallback | null, error?: DecodeErrorCallback | null) {
        return super.decodeAudioData(data, success, error).then(async (buffer) => {
          counters.decodedDurations.push(buffer.duration);
          await decodeGate;
          return buffer;
        });
      }
      createBufferSource() {
        const source = super.createBufferSource();
        const start = source.start.bind(source);
        source.start = (when = 0, offset = 0, duration?: number) => {
          if (source.buffer) counters.bufferStarts.push({
            duration: source.buffer.duration, offset, rate: source.playbackRate.value,
          });
          start(when, offset, duration);
        };
        return source;
      }
      close() { counters.closes++; return super.close(); }
    };
  }, { delayDecode });
  return enterRoom(page, { pausedClock: true });
}

async function audioCounters(page: Page) {
  return page.evaluate(() => (window as typeof window & { bassAudioCheck: BassAudioCounters }).bassAudioCheck);
}

async function expectRecordedMusic(page: Page, { stemPairs = 1, resumed = false } = {}) {
  const audio = await audioCounters(page);
  expect(audio.decodedDurations).toHaveLength(2);
  expect(audio.decodedDurations.every((duration) => duration >= BASS_DURATION - 0.1)).toBe(true);
  const stems = audio.bufferStarts.filter((source) => source.duration >= BASS_DURATION - 0.1);
  // Advancing the controlled clock must not repeatedly restart the recording.
  expect(stems).toHaveLength(stemPairs * 2);
  expect(stems.slice(0, 2).every((source) => source.offset === 0)).toBe(true);
  expect(stems.every((source) => source.rate === 1)).toBe(true);
  if (resumed) expect(stems.slice(-2).every((source) => source.offset > 0)).toBe(true);
  else expect(stems.every((source) => source.offset === 0)).toBe(true);
}

async function clockNow(page: Page) {
  return page.evaluate(() => performance.now());
}

async function advanceSongTo(page: Page, startedAt: number, seconds: number, countdownSeconds = BASS_COUNTDOWN_SECONDS) {
  const remaining = startedAt + (countdownSeconds + seconds) * 1000 - await clockNow(page);
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

async function expectRightOnlyControls(page: Page) {
  await expect(page.locator("[data-bass-hold], .bass-hold, .bass-fret-preview, .bass-phrase-guide")).toHaveCount(0);
  await expect(page.locator(".bass-hud")).not.toContainText(/押し続け|押し直し|左で押さえ|左：/);
}

async function expectPadsFit(page: Page) {
  await expectRightOnlyControls(page);
  const viewport = page.viewportSize()!;
  await expect(page.locator("[data-bass-pick]")).toHaveCount(4);
  for (const [index, string] of BASS_STRINGS.entries()) {
    const control = pluckPad(page, index as BassString);
    await expect(control).toHaveAccessibleName(new RegExp(`${string.name}弦`));
    await expect(control).toBeVisible();
    const box = (await control.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

async function paintResizedRoom(page: Page) {
  const viewport = page.viewportSize()!;
  const pixelRatio = await page.evaluate(() => Math.min(window.devicePixelRatio || 1, window.innerWidth < 700 ? 1.25 : 1.5));
  // ResizeObserver is delivered independently of the paused RAF clock. Wait for
  // the renderer's backing surface before painting, otherwise resize can erase
  // the frames we just advanced and leave only the HTML HUD in the screenshot.
  await expect.poll(() => page.locator(".room-canvas canvas").evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    return { width: canvas.width, height: canvas.height };
  })).toEqual({ width: Math.floor(viewport.width * pixelRatio), height: Math.floor(viewport.height * pixelRatio) });
  await page.clock.runFor(64);
}

type TouchPoint = { x: number; y: number; id: number };
async function touchPoint(control: Locator, id: number): Promise<TouchPoint> {
  const box = (await control.boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, id };
}
function createTouchInput(cdp: CDPSession) {
  const activeContacts = new Set<number>();
  async function send(type: "touchStart" | "touchMove" | "touchEnd", touchPoints: TouchPoint[]) {
    // CDP touchEnd lists the contacts being lifted; [] lifts every contact.
    await cdp.send("Input.dispatchTouchEvent", { type, touchPoints });
    if (type === "touchStart") {
      for (const point of touchPoints) activeContacts.add(point.id);
    } else if (type === "touchEnd") {
      if (touchPoints.length) {
        for (const point of touchPoints) activeContacts.delete(point.id);
      } else activeContacts.clear();
    }
  }
  return {
    send,
    async releaseAll() {
      // Chromium rejects a second touchEnd after the final contact is gone.
      if (activeContacts.size) await send("touchEnd", []);
    },
  };
}

/** Consecutive recorded attacks include automatic changes of string and fret. */
function easyInputSequence() {
  return BASS_CHART.filter((note) => note.time > 10).slice(0, 4);
}

// Keep the browser checks scoped to the changed input flow and its audio lifecycle.
test(`${BASS_PROXIMITY_SECONDS}秒でベースを取り、右キーだけで演奏し、同じ部屋へ戻せる`, { tag: "@bass" }, async ({ page }) => {
  const errors = collectPageErrors(page);
  const room = await prepare(page);
  const canvas = page.locator(".room-canvas canvas");
  await page.screenshot({ path: "docs/screenshots/bass-garden.png" });
  await page.clock.fastForward(BASS_PROXIMITY_SECONDS * 600);
  await expect(room).toHaveAttribute("data-bass-phase", "approaching");
  expect(Number(await room.getAttribute("data-bass-progress"))).toBeGreaterThan(0.5);
  await expect(page.getByRole("progressbar")).toBeVisible();
  expect((await audioCounters(page)).contexts).toBe(0);
  await walk(page, "ArrowDown", 500);
  await expect(room).toHaveAttribute("data-bass-phase", "idle");
  await expect(page.getByRole("progressbar")).toHaveCount(0);
  await walk(page, "KeyW", 500);
  await page.clock.fastForward(BASS_PROXIMITY_SECONDS * 1000 - 400);
  await expect(room).toHaveAttribute("data-bass-phase", "pickup");
  await page.clock.fastForward((BASS_PICKUP_SECONDS + 0.1) * 1000);
  await expect(room).toHaveAttribute("data-bass-phase", "ready");
  await expect(page.getByRole("button", { name: "演奏する", exact: true })).toBeEnabled();
  await expectRightOnlyControls(page);
  await page.screenshot({ path: "docs/screenshots/bass-ready-desktop.png" });
  expect((await audioCounters(page)).contexts).toBe(0);
  const stationary = await position(page);
  await canvas.focus();
  await page.keyboard.press("Space");
  await expect(room).toHaveAttribute("data-bass-phase", "countdown");
  let startedAt = await clockNow(page);
  expect((await audioCounters(page)).contexts).toBe(1);
  const [first, second, third, fourth] = easyInputSequence();
  await advanceSongTo(page, startedAt, first.time - 0.25);
  await expectPadsFit(page);
  await page.keyboard.press(pluckKeys[first.string]); // Outside the timing window.
  await expect(room).toHaveAttribute("data-bass-hits", "0");
  await advanceSongTo(page, startedAt, first.time);
  // Removed left shortcuts and unrelated activation keys cannot play notes.
  for (const key of ["Digit1", "Digit2", "Digit3", "Digit4", "Space", "Enter"]) await page.keyboard.press(key);
  await page.keyboard.press(pluckKeys[(first.string + 1) % 4]);
  await expect(room).toHaveAttribute("data-bass-hits", "0");
  await page.keyboard.press(pluckKeys[first.string]);
  await expect(room).toHaveAttribute("data-bass-hits", "1");
  const firstScore = Number(await room.getAttribute("data-bass-score"));
  expect(firstScore).toBeGreaterThan(0);
  await page.keyboard.press(pluckKeys[first.string]); // One note cannot be scored twice.
  await expect(room).toHaveAttribute("data-bass-hits", "1");
  for (const [index, note] of [second, third].entries()) {
    await advanceSongTo(page, startedAt, note.time);
    await page.keyboard.press(pluckKeys[note.string]);
    await expect(room).toHaveAttribute("data-bass-hits", String(index + 2));
  }
  expect(Number(await room.getAttribute("data-bass-score"))).toBeGreaterThan(firstScore);
  await page.screenshot({ path: "docs/screenshots/bass-playing-desktop.png" });
  await expectRecordedMusic(page);
  expect((await position(page)).height).toBe(0);
  await expect(page).toHaveURL(/#\/$/);

  await page.locator(".room-menu-toggle").click();
  const elapsed = await room.getAttribute("data-bass-elapsed");
  await expect(page.locator("[data-bass-pick]")).toHaveCount(0);
  await page.clock.fastForward(10000);
  expect(await room.getAttribute("data-bass-elapsed")).toBe(elapsed);
  await page.getByRole("button", { name: "部屋に戻る", exact: true }).click();
  await expect(canvas).toBeFocused();
  await page.clock.runFor(32);
  startedAt = await clockNow(page) - (BASS_COUNTDOWN_SECONDS + Number(await room.getAttribute("data-bass-elapsed"))) * 1000;
  await advanceSongTo(page, startedAt, fourth.time);
  await page.keyboard.press(pluckKeys[fourth.string]);
  await expect(room).toHaveAttribute("data-bass-hits", "4");
  await expectRecordedMusic(page, { stemPairs: 2, resumed: true });
  await walk(page, "KeyW", 200);
  expect((await position(page)).z).toBeCloseTo(stationary.z, 2);

  await advanceSongTo(page, startedAt, BASS_DURATION + 0.05);
  await expect(room).toHaveAttribute("data-bass-phase", "result");
  await expect(page.getByRole("button", { name: "もう一度", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "ベースを置く", exact: true }).click();
  await page.clock.fastForward(250);
  await expect(room).toHaveAttribute("data-bass-phase", "idle");
  await expect(page.getByRole("group", { name: "移動スティック", exact: true })).toBeVisible();
  await page.clock.fastForward((BASS_PROXIMITY_SECONDS + 1) * 1000);
  await expect(room).toHaveAttribute("data-bass-phase", "idle");
  await page.locator(".room-menu-toggle").click();
  await page.locator(".room-menu").getByRole("link", { name: "世界地図を開く", exact: true }).click();
  await expect(page).toHaveURL(/#\/world$/);
  await expect.poll(async () => (await audioCounters(page)).closes).toBe(1);
  expect(errors).toEqual([]);
});

test.describe("touch", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  test("スマホで右側だけをタップし、横向きでもEASYを再演奏できる", { tag: "@bass" }, async ({ page, context }) => {
    const errors = collectPageErrors(page);
    const room = await prepare(page);
    await page.clock.fastForward(BASS_PROXIMITY_SECONDS * 1000);
    await page.clock.fastForward((BASS_PICKUP_SECONDS + 0.1) * 1000);
    await expect(room).toHaveAttribute("data-bass-phase", "ready");
    await expectRightOnlyControls(page);
    expect((await audioCounters(page)).contexts).toBe(0);
    await page.getByRole("button", { name: "演奏する", exact: true }).tap();
    await expect(room).toHaveAttribute("data-bass-phase", "countdown");
    let startedAt = await clockNow(page);
    const [first, second, third, fourth] = easyInputSequence();
    await advanceSongTo(page, startedAt, first.time);
    await expectPadsFit(page);
    const cdp = await context.newCDPSession(page);
    const touch = createTouchInput(cdp);
    try {
      const wrongFinger = await touchPoint(pluckPad(page, ((first.string + 1) % 4) as BassString), 1);
      await touch.send("touchStart", [wrongFinger]);
      await touch.send("touchEnd", []);
      await expect(room).toHaveAttribute("data-bass-hits", "0");
      let finger = await touchPoint(pluckPad(page, first.string), 1);
      await touch.send("touchStart", [finger]);
      await expect(room).toHaveAttribute("data-bass-hits", "1");
      // Keeping the same finger down does not play another note automatically.
      await advanceSongTo(page, startedAt, second.time);
      await expect(room).toHaveAttribute("data-bass-hits", "1");
      await touch.send("touchEnd", []);
      finger = await touchPoint(pluckPad(page, second.string), 1);
      await touch.send("touchStart", [finger]);
      await touch.send("touchEnd", []);
      await expect(room).toHaveAttribute("data-bass-hits", "2");
      await page.screenshot({ path: "docs/screenshots/bass-playing-mobile.png" });
      await advanceSongTo(page, startedAt, third.time);
      finger = await touchPoint(pluckPad(page, third.string), 1);
      await touch.send("touchStart", [finger]);
      await expect(room).toHaveAttribute("data-bass-hits", "3");

      // Unmounting the HUD cancels a captured right contact without another hit.
      await page.locator(".room-menu-toggle").click();
      await expect(page.locator(".room-menu")).toBeVisible();
      await expect(page.locator("[data-bass-pick]")).toHaveCount(0);
      const elapsed = await room.getAttribute("data-bass-elapsed");
      await page.clock.fastForward(1000);
      expect(await room.getAttribute("data-bass-elapsed")).toBe(elapsed);
      await touch.send("touchEnd", []);
      await page.getByRole("button", { name: "部屋に戻る", exact: true }).tap();
      await page.clock.runFor(32);
      startedAt = await clockNow(page) - (BASS_COUNTDOWN_SECONDS + Number(await room.getAttribute("data-bass-elapsed"))) * 1000;
      await page.setViewportSize({ width: 844, height: 390 });
      await expectPadsFit(page);
      await advanceSongTo(page, startedAt, fourth.time);
      finger = await touchPoint(pluckPad(page, fourth.string), 1);
      await touch.send("touchStart", [finger]);
      await touch.send("touchEnd", []);
      await expect(room).toHaveAttribute("data-bass-hits", "4");
      expect((await position(page)).height).toBe(0);
      await paintResizedRoom(page);
      await page.screenshot({ path: "docs/screenshots/bass-playing-landscape.png" });
    } finally {
      try { await touch.releaseAll(); }
      finally { await cdp.detach(); }
    }
    await expectRecordedMusic(page, { stemPairs: 2, resumed: true });
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

  test("NORMALは右手のタップと上スワイプだけで弾き、HARDへ切り替えて再演奏できる", { tag: "@bass" }, async ({ page, context }) => {
    const errors = collectPageErrors(page);
    let backingRequests = 0;
    let releaseRetry!: () => void;
    const retryGate = new Promise<void>((resolve) => { releaseRetry = resolve; });
    await page.route(/garden-party-backing[^/]*\.mp3(?:\?.*)?$/, async (route) => {
      if (route.request().resourceType() !== "fetch") { await route.continue(); return; }
      backingRequests++;
      if (backingRequests === 1) await route.fulfill({ status: 503, body: "music temporarily unavailable" });
      else { await retryGate; await route.continue(); }
    });
    await page.setViewportSize({ width: 844, height: 390 });
    const room = await prepare(page);
    await page.clock.fastForward(BASS_PROXIMITY_SECONDS * 1000);
    await page.clock.fastForward((BASS_PICKUP_SECONDS + 0.1) * 1000);
    await expect(room).toHaveAttribute("data-bass-phase", "ready");
    await expectRightOnlyControls(page);
    await expect(page.getByRole("button", { name: "EASY", exact: true })).toHaveAttribute("aria-pressed", "true");
    const normal = BASS_SONGS.normal;
    await expect(room).toHaveAttribute("data-bass-audio", "error");
    expect((await audioCounters(page)).contexts).toBe(0);
    await page.getByRole("button", { name: "曲の読み込みを再試行", exact: true }).tap();
    try {
      await expect(page.getByRole("button", { name: "曲を準備中…", exact: true })).toBeDisabled();
      await page.getByRole("button", { name: "NORMAL", exact: true }).tap();
    } finally { releaseRetry(); }
    await expect(room).toHaveAttribute("data-bass-audio", "ready");
    await page.clock.fastForward(64);
    await expect(room).toHaveAttribute("data-bass-phase", "ready");
    expect(backingRequests).toBe(2);
    await expect(page.getByRole("button", { name: "NORMAL", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(room).toHaveAttribute("data-bass-difficulty", "normal");
    await expect(room).toHaveAttribute("data-bass-bpm", String(normal.bpm));
    await page.getByRole("button", { name: "演奏する", exact: true }).tap();
    await expect(room).toHaveAttribute("data-bass-phase", "countdown");
    const normalStartedAt = await clockNow(page);
    const advanceNormal = (seconds: number) => advanceSongTo(page, normalStartedAt, seconds, normal.countdownSeconds);
    const firstSlap = normal.notes.find((note) => note.technique === "slap" && note.string > 0)!;
    const laterPick = normal.notes.find((note) => note.string === firstSlap.string && note.time > firstSlap.time && note.technique === "pick")!;
    const slapVisual = page.locator(`[data-bass-note="${firstSlap.id}"]`);
    const pickVisual = page.locator(`[data-bass-note="${laterPick.id}"]`);
    const cdp = await context.newCDPSession(page);
    const touch = createTouchInput(cdp);
    try {
      await advanceNormal(firstSlap.time - 0.65);
      await expectPadsFit(page);
      await expect(slapVisual).toHaveAttribute("data-technique", "slap");
      await expect(slapVisual.locator("svg")).toBeVisible();
      expect(Number(await slapVisual.getAttribute("data-travel-seconds"))).toBe(firstSlap.travelSeconds);
      expect(firstSlap.travelSeconds).toBeLessThan(laterPick.travelSeconds);
      expect((await slapVisual.boundingBox())!.x).toBeLessThan((await pickVisual.boundingBox())!.x);
      const finger = await touchPoint(pluckPad(page, firstSlap.string), 1);
      await advanceNormal(firstSlap.time - 0.1);
      expect((await slapVisual.boundingBox())!.x).toBeGreaterThan((await pickVisual.boundingBox())!.x);
      await page.screenshot({ path: "docs/screenshots/bass-playing-normal-landscape.png" });

      // A tap cannot play an arrow. Upward capture keeps the original string,
      // even when one finger passes over another row's button.
      await touch.send("touchStart", [finger]);
      await page.clock.fastForward(32);
      await touch.send("touchEnd", []);
      await expect(room).toHaveAttribute("data-bass-hits", "0");
      const above = await touchPoint(pluckPad(page, (firstSlap.string - 1) as BassString), 1);
      const moved = { ...finger, y: above.y };
      await touch.send("touchStart", [finger]);
      await page.clock.fastForward(32);
      await touch.send("touchMove", [moved]);
      await expect(room).toHaveAttribute("data-bass-hits", "1");
      await page.clock.fastForward(32);
      const further = { ...moved, y: moved.y - 12 };
      await touch.send("touchMove", [further]);
      await touch.send("touchEnd", []);
      await expect(room).toHaveAttribute("data-bass-hits", "1");

      // The next recorded pick succeeds with just a fresh right contact.
      await advanceNormal(laterPick.time - 0.032);
      const nextFinger = await touchPoint(pluckPad(page, laterPick.string), 1);
      await touch.send("touchStart", [nextFinger]);
      await expect(room).toHaveAttribute("data-bass-hits", "1");
      await page.clock.fastForward(32);
      await touch.send("touchEnd", []);
      await expect(room).toHaveAttribute("data-bass-hits", "2");
      expect((await position(page)).height).toBe(0);
    } finally {
      try { await touch.releaseAll(); }
      finally { await cdp.detach(); }
    }
    await expectRecordedMusic(page);
    await advanceNormal(normal.duration + 0.05);
    await expect(room).toHaveAttribute("data-bass-phase", "result");
    const hard = BASS_SONGS.hard;
    await page.getByRole("button", { name: "HARD", exact: true }).tap();
    await expect(page.getByRole("button", { name: "HARD", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(room).toHaveAttribute("data-bass-difficulty", "hard");
    await expect(room).toHaveAttribute("data-bass-bpm", String(hard.bpm));
    await page.locator(".room-canvas canvas").focus();
    await page.keyboard.press("Enter");
    await expect(room).toHaveAttribute("data-bass-phase", "countdown");
    const hardStartedAt = await clockNow(page);
    const advanceHard = (seconds: number) => advanceSongTo(page, hardStartedAt, seconds, hard.countdownSeconds);
    const firstHardSlap = hard.notes.find((note) => note.technique === "slap")!;
    const hardNotes = [...new Map([...hard.notes.slice(0, 3), firstHardSlap].map((note) => [note.id, note])).values()].sort((a, b) => a.time - b.time);
    for (const [index, note] of hardNotes.entries()) {
      await advanceHard(note.time);
      await page.keyboard.press(`${note.technique === "slap" ? "Shift+" : ""}${pluckKeys[note.string]}`);
      await expect(room).toHaveAttribute("data-bass-hits", String(index + 1));
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await paintResizedRoom(page);
    await expectPadsFit(page);
    await page.setViewportSize({ width: 844, height: 390 });
    await paintResizedRoom(page);
    await expectPadsFit(page);
    await page.screenshot({ path: "docs/screenshots/bass-playing-hard-landscape.png" });
    await expectRecordedMusic(page, { stemPairs: 2 });
    await advanceHard(hard.duration + 0.05);
    await expect(room).toHaveAttribute("data-bass-phase", "result");
    await page.getByRole("button", { name: "もう一度", exact: true }).tap();
    await expect(room).toHaveAttribute("data-bass-phase", "countdown");
    await expect(room).toHaveAttribute("data-bass-difficulty", "hard");
    await expect(room).toHaveAttribute("data-bass-hits", "0");
    await expect(room).toHaveAttribute("data-bass-score", "0");
    expect((await audioCounters(page)).contexts).toBe(1);
    await page.getByRole("button", { name: "ベースを置く", exact: true }).tap();
    await expect(room).toHaveAttribute("data-bass-phase", "idle");
    await expect(page).toHaveURL(/#\/$/);
    expect(errors).toEqual([]);
  });
});

test("録音のデコード中に置いたベースが、読込完了後に勝手に演奏を始めない", { tag: "@bass" }, async ({ page }) => {
  const errors = collectPageErrors(page);
  const room = await prepare(page, { delayDecode: true });
  await page.clock.fastForward(BASS_PROXIMITY_SECONDS * 1000);
  await page.clock.fastForward((BASS_PICKUP_SECONDS + 0.1) * 1000);
  await expect(room).toHaveAttribute("data-bass-phase", "ready");
  await page.getByRole("button", { name: "演奏する", exact: true }).click();
  await expect(page.getByRole("button", { name: "曲を準備中…", exact: true })).toBeDisabled();
  // Decode both real MP3s, delaying only the Promise observed by the app.
  await expect.poll(async () => (await audioCounters(page)).decodedDurations.length).toBe(2);
  await page.getByRole("button", { name: "ベースを置く", exact: true }).click();
  await expect(room).toHaveAttribute("data-bass-phase", "idle");
  await page.evaluate(() => (window as typeof window & { bassReleaseDecode: () => void }).bassReleaseDecode());
  await expect(room).toHaveAttribute("data-bass-audio", "ready");
  await page.clock.fastForward((BASS_COUNTDOWN_SECONDS + 1) * 1000);
  await expect(room).toHaveAttribute("data-bass-phase", "idle");
  expect((await audioCounters(page)).bufferStarts).toHaveLength(0);
  await page.locator(".room-menu-toggle").click();
  await page.locator(".room-menu").getByRole("link", { name: "世界地図を開く", exact: true }).click();
  await expect(page).toHaveURL(/#\/world$/);
  await expect.poll(async () => (await audioCounters(page)).closes).toBe(1);
  expect(errors).toEqual([]);
});
