import { test, expect, type Page } from "@playwright/test";
import { BASS_SONGS, BASS_TECHNIQUE_STUDY, BASS_TECHNIQUE_STUDIES, BASS_DURATION } from "../../src/room/bassGame";
import { BASS_VISUAL_CONFIG } from "../../src/room/bassVisuals";
import { FINAL_HIT_CHARTS } from "../../src/room/finalHitTrack";
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
    const starts: { rate: number; offset: number; duration: number; loop: boolean; when: number }[] = [];
    (window as any).bassStarts = starts;
    const bends: { rate: number; when: number; voice: number }[] = [];
    (window as any).bassBends = bends;
    window.AudioContext = class extends Original {
      get currentTime() { return performance.now() / 1000; }
      createBufferSource() {
        const voice = super.createBufferSource();
        const start = voice.start.bind(voice);
        const voiceIndex = starts.length;
        const ramp = voice.playbackRate.linearRampToValueAtTime.bind(voice.playbackRate);
        voice.playbackRate.linearRampToValueAtTime = (rate, when) => { bends.push({ rate, when, voice: voiceIndex }); return ramp(rate, when); };
        voice.start = (when = 0, offset = 0, duration?: number) => {
          starts.push({ rate: voice.playbackRate.value, offset, duration: voice.buffer?.duration ?? 0, loop: voice.loop, when });
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
async function hit(page: Page, midi: number, id = 1, action: "down" | "up" | "move" | "cancel" = "down", dy = 0, dx = 0) {
  const control = pad(page, midi);
  const box = (await control.boundingBox())!;
  await control.dispatchEvent(`pointer${action}`, { pointerId: id, pointerType: "touch", button: 0, buttons: action === "up" ? 0 : 1, clientX: box.x + box.width / 2 + dx, clientY: box.y + box.height / 2 + dy });
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
  await expect(page.locator(".bass-result")).toContainText("最大コンボ");
  await page.getByRole("button", { name: "続ける", exact: true }).click();
  await expect(room).toHaveAttribute("data-bass-phase", "ready");
  await page.getByRole("button", { name: "演奏する", exact: true }).click();
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
  await expect(page.locator(`[data-bass-note="${slap.id}"] .bass-slap-arrow`)).toHaveText("↕");
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

test("新曲を選び、オフセット付き譜面・原曲音源・停止再開・既存曲への復帰が同期する", { tag: "@bass" }, async ({ page }) => {
  const errors = collectPageErrors(page);
  const room = await prepare(page);
  await page.getByRole("combobox", { name: "曲を選択" }).selectOption("final-hit");
  await expect(room).toHaveAttribute("data-bass-song", "final-hit");
  await expect(page.locator(".bass-draft-summary")).toContainText(`${FINAL_HIT_CHARTS.easy.notes.length}音`);
  await expect(page.locator("[data-bass-fret]")).toHaveCount(24);
  await page.getByRole("spinbutton", { name: "新曲の譜面オフセット（ミリ秒）" }).fill("120");
  await expect(room).toHaveAttribute("data-bass-audio-offset", "0.12");
  await page.getByRole("button", { name: "演奏する", exact: true }).click();
  await expect(room).toHaveAttribute("data-bass-phase", "countdown");
  const started = await page.evaluate(() => performance.now());
  const { finalHitSong } = await import("../../src/room/finalHitTrack");
  const song = finalHitSong(0.12);
  const first = song.notes[0];
  const advance = async (time: number) => {
    const delta = started + (song.countdownSeconds + time) * 1000 - await page.evaluate(() => performance.now());
    if (delta > 0) await page.clock.fastForward(delta);
  };
  await advance(first.time);
  await expect(page.locator(`[data-bass-note="${first.id}"]`)).toHaveAttribute("data-midi", String(first.midi));
  await hit(page, first.midi);
  if (first.kind === "slap") await hit(page, first.midi, 1, "move", -35);
  await hit(page, first.midi, 1, "up");
  await expect(room).toHaveAttribute("data-bass-hits", "1");
  const sources = await page.evaluate(() => (window as any).bassStarts as { rate: number; offset: number; duration: number }[]);
  const mix = sources.find(n => n.offset === 0 && n.duration > 59)!;
  expect(mix.duration).toBeCloseTo(60.0135, 2);
  expect(mix.rate).toBe(1);
  const scene = (await page.locator(".room-canvas canvas").boundingBox())!;
  expect(scene.height).toBeGreaterThan(700);
  await page.clock.runFor(16);
  await page.screenshot({ path: "/tmp/final-hit-playing.png" });
  await page.getByRole("button", { name: "演奏をポーズ" }).click();
  const elapsed = await room.getAttribute("data-bass-elapsed");
  await page.clock.fastForward(5000);
  expect(await room.getAttribute("data-bass-elapsed")).toBe(elapsed);
  await page.getByRole("button", { name: "部屋に戻る", exact: true }).click();
  await page.clock.runFor(32);
  await expect(room).toHaveAttribute("data-bass-song", "final-hit");
  await page.clock.fastForward(65000);
  await expect(room).toHaveAttribute("data-bass-phase", "result");
  await page.getByRole("button", { name: "続ける", exact: true }).click();
  await page.getByRole("combobox", { name: "曲を選択" }).selectOption("garden-party");
  await expect(room).toHaveAttribute("data-bass-song", "garden-party");
  await expect(page.locator(".bass-title")).toContainText("Garden-Party Groove");
  await page.getByRole("combobox", { name: "曲を選択" }).selectOption("final-hit");
  await expect(page.getByRole("spinbutton")).toHaveValue("120");
  expect(errors).toEqual([]);
});

test("新曲の読込を待つ間に別曲へ切り替えても遅延開始しない", { tag: "@bass" }, async ({ page }) => {
  const room = await prepare(page);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route(/final-hit[^/]*\.mp3(?:\?.*)?$/, async route => {
    if (route.request().resourceType() !== "fetch") { await route.continue(); return; }
    await gate; await route.continue();
  });
  await page.getByRole("combobox", { name: "曲を選択" }).selectOption("final-hit");
  await expect(room).toHaveAttribute("data-bass-audio", "loading");
  await page.getByRole("combobox", { name: "曲を選択" }).selectOption("garden-party");
  release();
  await page.clock.runFor(64);
  await expect(room).toHaveAttribute("data-bass-song", "garden-party");
  await expect(room).toHaveAttribute("data-bass-phase", "ready");
  await start(page);
  await expect(room).toHaveAttribute("data-bass-phase", "countdown");
});

test("375pxでも新曲の選曲・調整・開始と指板が画面内に収まる", { tag: "@bass" }, async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await prepare(page);
  await page.getByRole("combobox", { name: "曲を選択" }).selectOption("final-hit");
  for (const selector of [".bass-setup", ".bass-song-select", ".bass-offset", ".bass-start", ".bass-fretboard"]) {
    const box = (await page.locator(selector).boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(0); expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(375);
    expect(box.y + box.height).toBeLessThanOrEqual(667);
  }
  const setup = (await page.locator(".bass-setup").boundingBox())!;
  const header = (await page.locator(".bass-top-hud").boundingBox())!;
  expect(setup.y).toBeGreaterThanOrEqual(header.y + header.height);
  await expect(page.locator("[data-bass-fret]")).toHaveCount(24);
  await page.getByRole("button", { name: "演奏する", exact: true }).click();
  await page.clock.fastForward(3000);
  expect(await page.evaluate(() => scrollY)).toBe(0);
});

async function studyStart(page: Page) {
  await page.getByRole("combobox", { name: "曲を選択" }).selectOption("technique-study");
  await page.getByRole("button", { name: "演奏する", exact: true }).click();
  await expect(page.locator(".room-home")).toHaveAttribute("data-bass-phase", "countdown");
  return page.evaluate(() => performance.now());
}

for (const [difficulty, width, height] of [["easy", 375, 667], ["normal", 390, 844], ["hard", 430, 932]] as const) {
  test(`最終のヒット ${difficulty} ${width}px 全音入力・上下スラップ・音源同期・SSリザルト`, { tag: "@bass" }, async ({ page }) => {
    test.setTimeout(240_000); // 全曲を実3D上で入力するため、通常の部分操作テストより長い。
    const errors = collectPageErrors(page);
    await page.setViewportSize({ width, height });
    const room = await prepare(page);
    await page.getByRole("combobox", { name: "曲を選択" }).selectOption("final-hit");
    const { finalHitSong } = await import("../../src/room/finalHitTrack");
    const song = finalHitSong(0, difficulty);
    await page.locator(`button[data-bass-difficulty=${difficulty}]`).click();
    await expect(page.locator(".bass-draft-summary")).toContainText(`${song.notes.length}音`);
    await expect(page.locator(".bass-title")).toContainText(difficulty.toUpperCase());
    const header = (await page.locator(".bass-top-hud").boundingBox())!;
    const setup = (await page.locator(".bass-setup").boundingBox())!;
    expect(setup.y).toBeGreaterThanOrEqual(header.y + header.height);
    for (const selector of [".bass-setup", ".bass-fretboard", ".bass-offset", ".bass-difficulty-selector"]) {
      const box = (await page.locator(selector).boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0); expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width); expect(box.y + box.height).toBeLessThanOrEqual(height);
    }
    await page.screenshot({ path: `/tmp/final-hit-${difficulty}-ready.png` });
    await page.getByRole("button", { name: "演奏する", exact: true }).click();
    await expect(room).toHaveAttribute("data-bass-phase", "countdown");
    const started = await page.evaluate(() => performance.now());
    for (const [index, note] of song.notes.entries()) {
      const now = await page.evaluate(() => performance.now());
      const delta = started + (song.countdownSeconds + note.time) * 1000 - now;
      if (delta > 0) await page.clock.fastForward(delta);
      if (note.kimeGroupId === "K09") {
        const marker = page.locator(`[data-bass-note="${note.id}"]`);
        await expect(marker).toHaveAttribute("data-kime-id", note.kimeId!);
        await expect(marker).toHaveAttribute("data-protected", "true");
        const x = Number(await marker.locator("text").first().getAttribute("x"));
        expect(Math.abs(x - BASS_VISUAL_CONFIG.judgeX)).toBeLessThan(12);
        const charge = page.locator(`[data-bass-fret][data-charge-note="${note.id}"]`);
        await expect(charge).toHaveAttribute("data-kime-id", note.kimeId!);
        expect(Number(await charge.getAttribute("data-charge"))).toBeGreaterThan(0.96);
        if (note.kimeId === "P15") await page.screenshot({ path: `/tmp/final-hit-${difficulty}-kime.png` });
      }
      await hit(page, note.midi, index + 1);
      if (note.kind === "slap") await hit(page, note.midi, index + 1, "move", index % 2 ? 35 : -35, index % 2 ? -7 : 7);
      await hit(page, note.midi, index + 1, "up");
    }
    await expect(room).toHaveAttribute("data-bass-hits", String(song.notes.length));
    expect(await samplerStarts(page)).toHaveLength(song.notes.length);
    const mix = await page.evaluate(() => ((window as any).bassStarts as { rate: number; offset: number; duration: number; when: number }[]).find(n => n.offset === 0 && n.duration > 59));
    expect(mix?.rate).toBe(1); expect(mix?.duration).toBeCloseTo(60.0135, 2);
    const voices = await page.evaluate(() => ((window as any).bassStarts as { offset: number; rate: number; when: number }[]).filter(n => n.offset === 0.317));
    for (const [i, note] of song.notes.entries()) {
      expect(voices[i].when - mix!.when).toBeCloseTo(note.time, 2);
      expect(voices[i].rate).toBeCloseTo(2 ** ((note.midi - 31) / 12), 4);
    }
    await page.clock.fastForward(2000);
    await expect(room).toHaveAttribute("data-bass-phase", "result");
    await expect(page.locator(".bass-result-rank")).toHaveText("SS");
    await expect(page.locator(".bass-result-achievement")).toHaveText("100.00%");
    await expect(page.locator('[data-bass-result-count="excellent"] dd')).toHaveText(String(song.notes.length));
    await expect(page.locator('[data-bass-result-count="miss"] dd')).toHaveText("0");
    expect(await page.evaluate(() => scrollY)).toBe(0); expect(errors).toEqual([]);
  });
}

test("実MP3から作る持続音を1・2・4秒レンダリングし、周期的再アタックと停止後の残音を検査", { tag: "@bass" }, async ({ page }) => {
  await page.goto("/");
  const results = await page.evaluate(async () => {
    const modulePath = "/src/room/bassSustain.ts";
    const { createBassSustainBuffer } = await import(modulePath) as typeof import("../../src/room/bassSustain");
    const bytes = await (await fetch("/src/assets/audio/garden-party-bass.mp3")).arrayBuffer();
    const results = [];
    for (const seconds of [1, 2, 4]) {
      const context = new OfflineAudioContext(1, Math.ceil((seconds + 0.15) * 48000), 48000);
      const original = await context.decodeAudioData(bytes.slice(0));
      const sustain = createBassSustainBuffer(context, original);
      const source = context.createBufferSource(), gain = context.createGain();
      source.buffer = sustain.buffer; source.loop = true; source.loopStart = sustain.loopStart; source.loopEnd = sustain.loopEnd;
      source.connect(gain).connect(context.destination); gain.gain.setValueAtTime(1, 0);
      gain.gain.setValueAtTime(1, seconds); gain.gain.linearRampToValueAtTime(0, seconds + 0.025);
      source.start(0, 0.317); source.stop(seconds + 0.03);
      const rendered = (await context.startRendering()).getChannelData(0);
      const window = Math.round((sustain.loopEnd - sustain.loopStart) * 48000);
      const rms = (start: number, count: number) => Math.sqrt(rendered.slice(start, start + count).reduce((sum, n) => sum + n * n, 0) / count);
      const levels = [];
      for (let sample = 24000; sample + window < seconds * 48000; sample += window) levels.push(rms(sample, window));
      results.push({ seconds, min: Math.min(...levels), ratio: Math.max(...levels) / Math.min(...levels), released: rms(Math.round((seconds + 0.06) * 48000), 2000) });
    }
    return results;
  });
  for (const result of results) { expect(result.min).toBeGreaterThan(0.01); expect(result.ratio).toBeLessThan(1.01); expect(result.released).toBeLessThan(0.000001); }
});

for (const [width, height] of [[375, 667], [390, 844], [430, 932]]) {
  test(`リザルト ${width}px 全判定・固定結果・続ける・やめる`, { tag: "@bass" }, async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.setViewportSize({ width, height });
    const room = await prepare(page);
    const started = await start(page);
    await page.evaluate(() => {
      (window as any).bassResultMounts = 0;
      new MutationObserver(records => {
        for (const record of records) for (const node of record.addedNodes) if (node instanceof Element) {
          (window as any).bassResultMounts += node.matches(".bass-result") ? 1 : node.querySelectorAll(".bass-result").length;
        }
      }).observe(document.body, { childList: true, subtree: true });
    });
    await seek(page, started, BASS_DURATION + 0.1);
    const result = page.getByRole("dialog", { name: "Garden-Party Groove" });
    await expect(result).toHaveCount(1);
    await expect(result).toContainText("EASY");
    await expect(page.locator(".bass-result-rank")).toHaveText("D");
    await expect(page.locator(".bass-result-achievement")).toHaveText("0.00%");
    for (const key of ["excellent", "great", "good", "bad", "max-combo"]) await expect(page.locator(`[data-bass-result-count="${key}"] dd`)).toHaveText("0");
    await expect(page.locator('[data-bass-result-count="miss"] dd')).toHaveText(String(BASS_SONGS.easy.notes.length));
    await expect(page.locator(".bass-fretboard,.bass-song-select")).toHaveCount(0);
    await expect(result.getByRole("button")).toHaveCount(2);
    const before = await result.textContent();
    const voices = (await samplerStarts(page)).length;
    await page.clock.fastForward(10000);
    await page.keyboard.press("KeyG");
    expect(await result.textContent()).toBe(before);
    expect(await samplerStarts(page)).toHaveLength(voices);
    expect(await page.evaluate(() => (window as any).bassResultMounts)).toBe(1);
    for (const control of [result, result.getByRole("button", { name: "続ける" }), result.getByRole("button", { name: "やめる" })]) {
      const box = (await control.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0); expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width); expect(box.y + box.height).toBeLessThanOrEqual(height);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
    expect(await page.evaluate(() => scrollY)).toBe(0);
    await page.screenshot({ path: `/tmp/bass-result-${width}.png` });
    await page.keyboard.press("Tab");
    await expect(result.getByRole("button", { name: "続ける" })).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(result.getByRole("button", { name: "やめる" })).toBeFocused();
    await result.getByRole("button", { name: "続ける" }).evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
    await expect(room).toHaveAttribute("data-bass-phase", "ready");
    await expect(page.getByRole("combobox", { name: "曲を選択" })).toBeFocused();
    await expect(room).toHaveAttribute("data-bass-score", "0");
    await expect(room).toHaveAttribute("data-bass-hits", "0");
    await expect(page.locator(".bass-result")).toHaveCount(0);
    await page.getByRole("combobox", { name: "曲を選択" }).selectOption("technique-study");
    await page.getByRole("button", { name: "演奏する", exact: true }).click();
    await page.clock.fastForward(65000);
    await expect(room).toHaveAttribute("data-bass-phase", "result");
    await expect(page.locator('[data-bass-result-count="miss"] dd')).toHaveText(String(BASS_TECHNIQUE_STUDY.notes.length));
    expect(await page.evaluate(() => (window as any).bassResultMounts)).toBe(2);
    await page.getByRole("button", { name: "やめる", exact: true }).evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
    await expect(room).toHaveAttribute("data-bass-phase", "idle");
    await expect(page.locator(".bass-result,.bass-hud")).toHaveCount(0);
    await page.clock.fastForward(4500);
    await expect(room).toHaveAttribute("data-bass-phase", "idle");
    expect(errors).toEqual([]);
  });
}

async function slidePointer(page: Page, string: number, startFret: number, currentFret: number, id: number, action: "down" | "move" | "up" | "cancel", dy = 0) {
  const startControl = page.locator(`[data-bass-fret="${string}-${startFret}"]`);
  const a = (await startControl.boundingBox())!;
  const b = (await page.locator(`[data-bass-fret="${string}-${Math.floor(currentFret)}"]`).boundingBox())!;
  const next = currentFret % 1;
  await startControl.dispatchEvent(`pointer${action}`, { pointerId: id, pointerType: "touch", button: 0,
    buttons: action === "up" || action === "cancel" ? 0 : 1,
    clientX: b.x + b.width / 2 + next * (a.width + 6), clientY: a.y + a.height / 2 + dy });
}

test("奏法練習の完全版3難易度を375pxで選択し、終止音・結果・再選択まで演奏する", { tag: "@bass" }, async ({ page }) => {
  const errors = collectPageErrors(page);
  await page.setViewportSize({ width: 375, height: 667 });
  const room = await prepare(page);
  await page.getByRole("combobox", { name: "曲を選択" }).selectOption("technique-study");
  await expect(room).toHaveAttribute("data-bass-difficulty", "normal");
  for (const difficulty of ["normal", "easy", "hard"] as const) {
    const song = BASS_TECHNIQUE_STUDIES[difficulty];
    await page.locator(`button[data-bass-difficulty=${difficulty}]`).click();
    await expect(page.locator(".bass-title")).toContainText(difficulty.toUpperCase());
    await expect(page.locator(`button[data-bass-difficulty=${difficulty}]`)).toHaveAttribute("aria-pressed", "true");
    const header = (await page.locator(".bass-top-hud").boundingBox())!;
    const setup = (await page.locator(".bass-setup").boundingBox())!;
    expect(setup.y).toBeGreaterThanOrEqual(header.y + header.height);
    for (const selector of [".bass-setup", ".bass-song-select", ".bass-difficulty-selector", ".bass-start", ".bass-fretboard"]) {
      const box = (await page.locator(selector).boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0); expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(375); expect(box.y + box.height).toBeLessThanOrEqual(667);
    }
    await expect(page.locator("[data-bass-fret]")).toHaveCount(24);
    if (difficulty === "normal") await page.screenshot({ path: "/tmp/bass-study-ready-375.png" });
    const started = await start(page, difficulty);
    await expect(room).toHaveAttribute("data-bass-score", "0");
    const ending = song.notes.at(-1)!;
    await seek(page, started, ending.time - 0.2, difficulty);
    await expect(page.locator(`[data-bass-note="${ending.id}"] .bass-hold-tail`)).toBeVisible();
    const timeline = (await page.locator("[data-bass-timeline]").boundingBox())!;
    const board = (await page.locator(".bass-fretboard").boundingBox())!;
    expect(timeline.y + timeline.height).toBeLessThan(board.y);
    await seek(page, started, ending.time, difficulty);
    const before = (await samplerStarts(page)).length;
    await hit(page, ending.midi, 71);
    await expect(pad(page, ending.midi)).toHaveClass(/is-holding/);
    await seek(page, started, ending.endTime!, difficulty);
    await hit(page, ending.midi, 71, "up");
    await expect(room).toHaveAttribute("data-bass-hits", "1");
    await expect(room).toHaveAttribute("data-bass-score", "1000");
    expect(await samplerStarts(page)).toHaveLength(before + 1);
    await seek(page, started, song.duration + 0.1, difficulty);
    await expect(room).toHaveAttribute("data-bass-phase", "result");
    await expect(page.locator(".bass-result")).toContainText("1,000");
    const resultPanel = (await page.locator(".bass-result").boundingBox())!;
    expect(resultPanel.y).toBeGreaterThanOrEqual(0);
    expect(resultPanel.y + resultPanel.height).toBeLessThanOrEqual(667);
    await page.getByRole("button", { name: "続ける", exact: true }).click();
    await expect(room).toHaveAttribute("data-bass-phase", "ready");
  }
  await page.getByRole("combobox", { name: "曲を選択" }).selectOption("garden-party");
  await expect(room).toHaveAttribute("data-bass-difficulty", "easy");
  await page.getByRole("combobox", { name: "曲を選択" }).selectOption("technique-study");
  await expect(room).toHaveAttribute("data-bass-difficulty", "hard");
  expect(await page.evaluate(() => scrollY)).toBe(0);
  expect(errors).toEqual([]);
});

test("V2.1 左右スライド・連続音程・上下スラップ・保持と高速連打", { tag: "@bass" }, async ({ page }) => {
  const errors = collectPageErrors(page);
  const room = await prepare(page);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const started = await studyStart(page);
  await seek(page, started, 1.5);
  const before = (await samplerStarts(page)).length;
  const timeline = page.locator('[data-bass-note="1"]');
  await expect(timeline.locator('[data-bass-slide-tail]')).toBeVisible();
  await expect(timeline).toContainText("B"); await expect(timeline).toContainText("D");
  // 水平線のobjectBoundingBoxは高さ0となり、SVGグラデーションを描画できない。
  const routeGradient = page.locator('[data-bass-slide-path="1"] linearGradient');
  await expect(routeGradient).toHaveAttribute("gradientUnits", "userSpaceOnUse");
  await expect(routeGradient).toHaveAttribute("x1", "250");
  await expect(routeGradient).toHaveAttribute("x2", "550");
  const board = (await page.locator(".bass-fretboard").boundingBox())!;
  await seek(page, started, 2);
  await slidePointer(page, 2, 2, 2, 51, "down");
  await expect(room).toHaveAttribute("data-bass-hits", "0");
  await expect(page.locator('[data-bass-slide-path="1"]')).toHaveAttribute("data-state", "sliding");
  await seek(page, started, 2.5);
  await slidePointer(page, 2, 2, 3.5, 51, "move", 8);
  await expect(page.locator('[data-slide-end="1"]')).toHaveAttribute("data-end-progress", "0.500");
  await page.clock.runFor(16);
  await page.screenshot({ path: "/tmp/bass-v21-slide.png" });
  await seek(page, started, 3);
  await slidePointer(page, 2, 2, 5, 51, "move"); await slidePointer(page, 2, 2, 5, 51, "up");
  await expect(room).toHaveAttribute("data-bass-hits", "1");
  await expect(room).toHaveAttribute("data-bass-performance", /:slide:complete:perfect$/);
  expect((await samplerStarts(page)).length).toBe(before + 1);
  const bends = await page.evaluate(() => (window as any).bassBends as { rate: number }[]);
  expect(bends).toHaveLength(2);
  expect(bends[0].rate).toBeCloseTo(2 ** ((36.5 - 31) / 12));
  expect(bends[1].rate).toBeCloseTo(2 ** ((38 - 31) / 12));
  await seek(page, started, 4);
  const reversedGradient = page.locator('[data-bass-slide-path="2"] linearGradient');
  await expect(reversedGradient).toHaveAttribute("x1", "550");
  await expect(reversedGradient).toHaveAttribute("x2", "250");
  await slidePointer(page, 2, 5, 5, 52, "down");
  await seek(page, started, 4.5); await slidePointer(page, 2, 5, 3.5, 52, "move");
  await seek(page, started, 5); await slidePointer(page, 2, 5, 2, 52, "up");
  await expect(room).toHaveAttribute("data-bass-hits", "2");
  for (const [time, midi, dy] of [[6, 35, -40], [7, 38, 40]]) {
    await seek(page, started, time);
    const count = (await samplerStarts(page)).length;
    await hit(page, midi, 60); await hit(page, midi, 60, "move", dy); await hit(page, midi, 60, "up", dy);
    await expect(room).toHaveAttribute("data-bass-performance", /:slap:complete:perfect$/);
    expect((await samplerStarts(page)).length).toBe(count + 1);
  }
  await seek(page, started, 8); await hit(page, 40, 70);
  await seek(page, started, 9); await hit(page, 40, 70, "up");
  for (let i = 0; i < 8; i++) {
    await seek(page, started, 10 + i * 0.125);
    const control = page.locator(`[data-bass-fret="${i % 2 ? "2-0" : "3-5"}"]`);
    await control.dispatchEvent("pointerdown", { pointerId: 80 + i, pointerType: "touch", button: 0 });
    await control.dispatchEvent("pointerup", { pointerId: 80 + i, pointerType: "touch", button: 0 });
  }
  await expect(room).toHaveAttribute("data-bass-hits", "13");
  expect(await page.locator(".bass-fretboard").boundingBox()).toEqual(board);
  await seek(page, started, 12); await slidePointer(page, 0, 1, 1, 90, "down");
  await page.getByRole("button", { name: "演奏をポーズ" }).click();
  const frozen = await room.getAttribute("data-bass-elapsed"); await page.clock.fastForward(3000);
  expect(await room.getAttribute("data-bass-elapsed")).toBe(frozen);
  await page.getByRole("button", { name: "部屋に戻る", exact: true }).click(); await page.clock.runFor(32);
  await expect(page.locator('.bass-slide-paths [data-state="sliding"]')).toHaveCount(0);
  await expect(room).toHaveAttribute("data-bass-performance", /:slide:fail:miss$/);
  expect(errors).toEqual([]);
});

test("V2.1 実タッチのスライド・別弦失敗・キャンセルと同時入力", { tag: "@bass" }, async ({ page, context }) => {
  const room = await prepare(page); const started = await studyStart(page);
  await seek(page, started, 2);
  const cdp = await context.newCDPSession(page);
  const a = (await page.locator('[data-bass-fret="2-2"]').boundingBox())!;
  const b = (await page.locator('[data-bass-fret="2-5"]').boundingBox())!;
  const p1 = { id: 1, x: a.x + a.width / 2, y: a.y + a.height / 2 };
  const p2 = { id: 2, x: b.x + b.width / 2, y: b.y + b.height / 2 + 3 };
  const count = (await samplerStarts(page)).length;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [p1, p2] });
  await seek(page, started, 2.5);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ ...p1, x: (p1.x + p2.x) / 2 }, p2] });
  expect((await samplerStarts(page)).length).toBe(count + 2);
  await seek(page, started, 3);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ ...p1, x: p2.x }, p2] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect(room).toHaveAttribute("data-bass-hits", "1");
  await seek(page, started, 4);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ ...p1, x: p2.x }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ ...p1, x: p2.x - 35 }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ ...p1, x: p1.x, y: p1.y - a.height - 6 }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
  await expect(room).toHaveAttribute("data-bass-performance", /:slide:fail:miss$/);
  await expect(page.locator('[data-bass-slide-path="2"]')).toHaveCount(0);
  await seek(page, started, 6); await hit(page, 35, 101); await hit(page, 35, 101, "move", 40); await hit(page, 35, 101, "up", 40);
  await expect(room).toHaveAttribute("data-bass-hits", "2");
  expect(await page.evaluate(() => scrollY)).toBe(0);
});

for (const [width, height] of [[375, 667], [390, 844], [430, 932]]) {
  test(`V2.1 ${width}px 音高カラーとスライド予告の安定配置`, { tag: "@bass" }, async ({ page }) => {
    await page.setViewportSize({ width, height }); await prepare(page); const started = await studyStart(page);
    await seek(page, started, 1.5);
    await expect(page.locator('[data-bass-slide-path="1"]')).toBeVisible();
    const note = page.locator('[data-bass-note="1"]');
    const cell = page.locator('[data-bass-fret="2-2"]');
    expect(await note.evaluate(node => getComputedStyle(node).getPropertyValue("--tone").trim())).toBe(await cell.evaluate(node => getComputedStyle(node).getPropertyValue("--tone").trim()));
    for (const midi of [33, 38, 43]) {
      const colors = await page.locator(`[data-bass-fret][data-midi="${midi}"]`).evaluateAll(nodes => nodes.map(node => getComputedStyle(node).backgroundColor));
      expect(new Set(colors).size).toBe(1);
    }
    for (const control of await page.locator('[data-bass-fret]').all()) {
      const box = (await control.boundingBox())!; expect(box.width).toBeGreaterThanOrEqual(44); expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(width); expect(box.y + box.height).toBeLessThanOrEqual(height);
    }
    await page.clock.runFor(16); await page.screenshot({ path: `/tmp/bass-v21-${width}.png` });
  });
}

test("34〜37秒の原曲ミックスと3難易度のキメ入力音を同時レンダリングする", { tag: "@bass" }, async ({ page }) => {
  await page.goto("/");
  const profiles = (["easy", "normal", "hard"] as const).map(difficulty => ({ difficulty,
    notes: FINAL_HIT_CHARTS[difficulty].notes.filter(n => "kimeGroupId" in n && n.kimeGroupId === "K09").map(n => ({ time: n.timeSec, midi: n.midi })) }));
  const reports = await page.evaluate(async profiles => {
    const modulePath = "/src/room/bassSustain.ts";
    const { createBassSustainBuffer } = await import(modulePath) as typeof import("../../src/room/bassSustain");
    const [mixBytes, sampleBytes] = await Promise.all(["final-hit.mp3", "garden-party-bass.mp3"].map(async file => (await fetch(`/src/assets/audio/${file}`)).arrayBuffer()));
    const render = async (notes: { time: number; midi: number }[]) => {
      const context = new OfflineAudioContext(1, 3 * 48000, 48000);
      const [mix, sample] = await Promise.all([context.decodeAudioData(mixBytes.slice(0)), context.decodeAudioData(sampleBytes.slice(0))]);
      const backing = context.createBufferSource(); backing.buffer = mix; backing.connect(context.destination); backing.start(0, 34);
      const sustain = createBassSustainBuffer(context, sample);
      for (const note of notes) {
        const source = context.createBufferSource(), gain = context.createGain();
        source.buffer = sustain.buffer; source.playbackRate.value = 2 ** ((note.midi - 31) / 12);
        source.connect(gain).connect(context.destination);
        const time = note.time - 34;
        gain.gain.setValueAtTime(0.3, time); gain.gain.setValueAtTime(0.3, time + 0.12); gain.gain.linearRampToValueAtTime(0, time + 0.145);
        source.start(time, 0.317); source.stop(time + 0.15);
      }
      return (await context.startRendering()).getChannelData(0);
    };
    const backing = await render([]), reports = [];
    for (const profile of profiles) {
      const combined = await render(profile.notes);
      let outsideDelta = 0;
      for (let i = 0; i < combined.length; i++) {
        const time = i / 48000;
        if (!profile.notes.some(n => time >= n.time - 34 - 1 / 48000 && time <= n.time - 34 + 0.151)) outsideDelta = Math.max(outsideDelta, Math.abs(combined[i] - backing[i]));
      }
      const attacks = profile.notes.map(n => {
        const at = Math.ceil((n.time - 34) * 48000), size = 2400;
        return Math.sqrt(combined.slice(at, at + size).reduce((sum, value, i) => sum + (value - backing[at + i]) ** 2, 0) / size);
      });
      reports.push({ difficulty: profile.difficulty, count: profile.notes.length, attacks, outsideDelta });
    }
    return reports;
  }, profiles);
  for (const report of reports) {
    expect(report.count).toBe(report.difficulty === "easy" ? 3 : 6);
    expect(report.outsideDelta).toBeLessThan(0.000001); // 元の2音と休符は変更されない。
    for (const attack of report.attacks) expect(attack).toBeGreaterThan(0.005);
  }
});
