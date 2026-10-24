import { test, expect, type Page } from "@playwright/test";
import { BASS_SONGS, BASS_DURATION } from "../../src/room/bassGame";
import { BASS_FRETBOARD } from "../../src/room/bassFretboard";
import { collectPageErrors, enterRoom, savedPosition } from "./helpers/room";

test.describe.configure({ timeout: 120_000 });
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

async function prepare(page: Page) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 1000));
  await savedPosition(page, { x: 1.65, z: 5.6, yaw: Math.PI, facing: 0, doorOpen: true });
  // Deterministic device sample clock for seeking/pause checks. The real browser
  // still decodes the two MP3 buffers and creates/starts every Web Audio voice.
  await page.addInitScript(() => {
    const Original = window.AudioContext;
    const starts: { rate: number; offset: number; duration: number; loop: boolean }[] = [];
    (window as any).bassStarts = starts;
    window.AudioContext = class extends Original {
      get currentTime() { return performance.now() / 1000; }
      createBufferSource() {
        const voice = super.createBufferSource();
        const start = voice.start.bind(voice);
        voice.start = (when = 0, offset = 0, duration?: number) => {
          starts.push({ rate: voice.playbackRate.value, offset, duration: voice.buffer?.duration ?? 0, loop: voice.loop });
          start(when, offset, duration);
        };
        return voice;
      }
    };
  });
  const room = await enterRoom(page, { pausedClock: true });
  await page.clock.fastForward(4400);
  await expect(room).toHaveAttribute("data-bass-phase", "ready");
  return room;
}
async function start(page: Page, difficulty: "easy" | "normal" | "hard" = "easy") {
  await page.locator(`button[data-bass-difficulty=${difficulty}]`).click();
  await page.getByRole("button", { name: "演奏する", exact: true }).click();
  await expect(page.locator(".room-home")).toHaveAttribute("data-bass-phase", "countdown");
  return page.evaluate(() => performance.now());
}
async function seek(page: Page, started: number, time: number, difficulty: "easy" | "normal" | "hard" = "easy") {
  const now = await page.evaluate(() => performance.now());
  const delta = started + (BASS_SONGS[difficulty].countdownSeconds + time) * 1000 - now;
  if (delta > 0) await page.clock.fastForward(delta);
}
function pad(page: Page, midi: number, alternative = false) {
  const cells = page.locator(`[data-bass-fret][data-midi="${midi}"]`);
  return alternative ? cells.last() : cells.first();
}
async function hit(page: Page, midi: number, id = 1, action: "down" | "up" | "move" | "cancel" = "down", dy = 0) {
  const control = pad(page, midi);
  const box = (await control.boundingBox())!;
  await control.dispatchEvent(`pointer${action}`, { pointerId: id, pointerType: "touch", button: 0, buttons: action === "up" ? 0 : 1, clientX: box.x + box.width / 2, clientY: box.y + box.height / 2 + dy });
}
async function samplerStarts(page: Page) {
  return page.evaluate(() => ((window as any).bassStarts as { rate: number; offset: number }[]).filter(voice => voice.offset === 0.317));
}

for (const [width, height] of [[375, 667], [390, 844], [430, 932]]) {
  test(`${width}px 縦画面の24ボタン・HUD・常設タイムライン`, { tag: "@bass" }, async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.setViewportSize({ width, height });
    const room = await prepare(page);
    const started = await start(page);
    await seek(page, started, 1);
    await expect(page.locator("[data-bass-fret]")).toHaveCount(24);
    await expect(page.locator(".bass-string-board,[data-bass-pick]")).toHaveCount(0);
    for (const cell of BASS_FRETBOARD) {
      const control = page.locator(`[data-bass-fret="${cell.string}-${cell.fret}"]`);
      await expect(control).toHaveAttribute("data-midi", String(cell.midi));
      await expect(control).toHaveAccessibleName(`${cell.string + 1}弦 ${cell.fret}フレット ${cell.name}${cell.octave}`);
      const box = (await control.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0); expect(box.y).toBeGreaterThan(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      expect(box.y + box.height).toBeLessThanOrEqual(height);
      expect(box.width).toBeGreaterThanOrEqual(44); expect(box.height).toBeGreaterThanOrEqual(44);
    }
    const timeline = (await page.locator("[data-bass-timeline]").boundingBox())!;
    const board = (await page.locator(".bass-fretboard").boundingBox())!;
    const hud = (await page.locator(".bass-top-hud").boundingBox())!;
    expect(timeline.y + timeline.height).toBeLessThan(board.y);
    expect(hud.y + hud.height).toBeLessThan(timeline.y);
    await seek(page, started, 5); // recorded rest must retain the same geometry
    await expect(page.locator("[data-bass-note]")).toHaveCount(0);
    expect(await page.locator("[data-bass-timeline]").boundingBox()).toEqual(timeline);
    expect(await page.locator(".bass-fretboard").boundingBox()).toEqual(board);
    expect(await page.evaluate(() => ({ x: scrollX, y: scrollY, width: document.documentElement.scrollWidth }))).toEqual({ x: 0, y: 0, width });
    await expect(room).toHaveAttribute("data-bass-phase", "playing");
    await page.clock.runFor(64);
    await page.screenshot({ path: `/tmp/bass-v2-${width}.png` });
    expect(errors).toEqual([]);
  });
}

test("MIDI入力・同音別位置・誤入力音声・ポーズ・結果・再演奏", { tag: "@bass" }, async ({ page }) => {
  const errors = collectPageErrors(page);
  const room = await prepare(page);
  let started = await start(page);
  const notes = BASS_SONGS.easy.notes;
  await seek(page, started, notes[0].time);
  await hit(page, 45); await hit(page, 45, 1, "up");
  await expect(room).toHaveAttribute("data-bass-hits", "0");
  await hit(page, notes[0].midi); await hit(page, notes[0].midi, 1, "up");
  await expect(room).toHaveAttribute("data-bass-hits", "1");
  await expect(room).toHaveAttribute("data-bass-score", "750");
  const rates = (await samplerStarts(page)).map(s => s.rate);
  expect(rates).toHaveLength(2);
  expect(rates[0]).toBeCloseTo(2 ** ((45 - 31) / 12));
  expect(rates[1]).toBeCloseTo(2 ** ((notes[0].midi - 31) / 12));
  const duplicate = notes.find(n => n.time > 10 && BASS_FRETBOARD.filter(cell => cell.midi === n.midi).length > 1)!;
  await seek(page, started, duplicate.time);
  await pad(page, duplicate.midi, true).tap();
  await expect(room).toHaveAttribute("data-bass-hits", "2");
  await page.getByRole("button", { name: "演奏をポーズ" }).click();
  const elapsed = await room.getAttribute("data-bass-elapsed");
  await page.clock.fastForward(10000);
  expect(await room.getAttribute("data-bass-elapsed")).toBe(elapsed);
  await page.getByRole("button", { name: "部屋に戻る", exact: true }).click();
  await page.clock.runFor(32);
  started = await page.evaluate(() => performance.now()) - (BASS_SONGS.easy.countdownSeconds + Number(await room.getAttribute("data-bass-elapsed"))) * 1000;
  await seek(page, started, BASS_DURATION + 0.1);
  await expect(room).toHaveAttribute("data-bass-phase", "result");
  await expect(page.locator(".bass-result")).toContainText("最高コンボ");
  await page.getByRole("button", { name: "もう一度", exact: true }).click();
  await expect(room).toHaveAttribute("data-bass-score", "0");
  await expect(room).toHaveAttribute("data-bass-phase", "countdown");
  await page.getByRole("button", { name: "ベースを置く", exact: true }).click();
  await expect(room).toHaveAttribute("data-bass-phase", "idle");
  expect(errors).toEqual([]);
});

test("ロング開始・終了、スラップと通過ボタンの二重発音防止", { tag: "@bass" }, async ({ page }) => {
  const room = await prepare(page);
  const started = await start(page, "normal");
  const hold = BASS_SONGS.normal.notes.find(n => n.kind === "hold")!;
  await seek(page, started, hold.time, "normal");
  await expect(page.locator(`[data-bass-note="${hold.id}"] .bass-hold-tail`)).toBeVisible();
  await hit(page, hold.midi);
  await expect(pad(page, hold.midi)).toHaveClass(/is-holding/);
  await page.clock.runFor(16);
  await page.screenshot({ path: "/tmp/bass-v2-hold.png" });
  await expect(room).toHaveAttribute("data-bass-hits", "0");
  await seek(page, started, hold.endTime!, "normal");
  await hit(page, hold.midi, 1, "up");
  await expect(room).toHaveAttribute("data-bass-hits", "1");
  const slap = BASS_SONGS.normal.notes.find(n => n.kind === "slap" && n.time > hold.endTime!)!;
  await seek(page, started, slap.time, "normal");
  await expect(page.locator(`[data-bass-note="${slap.id}"] .bass-slap-arrow`)).toHaveText("↑");
  const before = (await samplerStarts(page)).length;
  await hit(page, slap.midi, 2);
  await hit(page, slap.midi, 2, "move", -45);
  await hit(page, slap.midi, 2, "up", -60);
  await expect(room).toHaveAttribute("data-bass-hits", "2");
  expect((await samplerStarts(page)).length).toBe(before + 1);
});

test("複数の指が同じボタンを押し、キャンセル後も演奏できる", { tag: "@bass" }, async ({ page }) => {
  const room = await prepare(page);
  const started = await start(page, "hard");
  await seek(page, started, 5, "hard");
  await hit(page, 33, 1); await hit(page, 33, 2);
  await hit(page, 38, 3);
  expect((await samplerStarts(page)).length).toBe(3);
  await hit(page, 33, 1, "cancel"); await hit(page, 33, 2, "up"); await hit(page, 38, 3, "up");
  await hit(page, 33, 1); await hit(page, 33, 1, "up");
  expect((await samplerStarts(page)).length).toBe(4);
  await expect(room).toHaveAttribute("data-bass-hits", "0");
});

test("実タッチのマルチタッチ、ボタン横断、キャンセルを音声へ接続", { tag: "@bass" }, async ({ page, context }) => {
  const errors = collectPageErrors(page);
  await prepare(page);
  const started = await start(page);
  await seek(page, started, 5);
  const cdp = await context.newCDPSession(page);
  const a = (await pad(page, 33).boundingBox())!;
  const b = (await pad(page, 38).boundingBox())!;
  const p1 = { id: 1, x: a.x + a.width / 2, y: a.y + a.height / 2 };
  const p2 = { id: 2, x: a.x + a.width / 2 + 3, y: a.y + a.height / 2 };
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [p1, p2] });
  expect(await samplerStarts(page)).toHaveLength(2);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ ...p1, x: b.x + b.width / 2, y: b.y + b.height / 2 }, p2] });
  expect(await samplerStarts(page)).toHaveLength(2);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [p1] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  expect(await samplerStarts(page)).toHaveLength(3);
  expect(await page.evaluate(() => scrollY)).toBe(0);
  await cdp.detach();
  expect(errors).toEqual([]);
});


test("音源失敗後の再試行と読込中の難易度変更が遅延開始を防ぐ", { tag: "@bass" }, async ({ page }) => {
  let requests = 0;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route(/garden-party-backing[^/]*\.mp3(?:\?.*)?$/, async route => {
    if (route.request().resourceType() !== "fetch") { await route.continue(); return; }
    requests++;
    if (requests === 1) await route.fulfill({ status: 503, body: "unavailable" });
    else { await gate; await route.continue(); }
  });
  const room = await prepare(page);
  await expect(room).toHaveAttribute("data-bass-audio", "error");
  await page.getByRole("button", { name: "曲の読み込みを再試行", exact: true }).click();
  try {
    await expect(page.getByRole("button", { name: "曲を準備中…", exact: true })).toBeDisabled();
    await page.locator("button[data-bass-difficulty=hard]").click();
  } finally { release(); }
  await expect(room).toHaveAttribute("data-bass-audio", "ready");
  await page.clock.runFor(64);
  await expect(room).toHaveAttribute("data-bass-phase", "ready");
  await expect(room).toHaveAttribute("data-bass-difficulty", "hard");
  await start(page, "hard");
  await expect(room).toHaveAttribute("data-bass-phase", "countdown");
});
