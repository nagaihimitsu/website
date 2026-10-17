import { test, expect, type Page } from "@playwright/test";
import sharp from "sharp";

async function enterRoom(page: Page) {
  await page.goto("/#/");
  const room = page.locator(".room-home");
  await expect(room).toHaveAttribute("data-room-status", "ready", {
    timeout: 30000,
  });
  await expect(page.locator(".room-canvas canvas")).toBeVisible();
  for (const coordinate of ["x", "z", "height"])
    await expect(room).toHaveAttribute(
      `data-player-${coordinate}`,
      /^-?\d+(?:\.\d+)?$/,
    );
  return room;
}

async function position(page: Page) {
  return page.locator(".room-home").evaluate((element) => ({
    x: Number(element.getAttribute("data-player-x")),
    z: Number(element.getAttribute("data-player-z")),
    height: Number(element.getAttribute("data-player-height")),
  }));
}

async function walk(page: Page, key = "ArrowRight") {
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement)
      document.activeElement.blur();
  });
  const start = await position(page);
  await page.keyboard.down(key);
  try {
    await expect
      .poll(async () => {
        const current = await position(page);
        return Math.hypot(current.x - start.x, current.z - start.z);
      })
      .toBeGreaterThan(0.15);
  } finally {
    await page.keyboard.up(key);
  }
  // Runtime publishes snapshots at 10 Hz; capture the settled position.
  await page.waitForTimeout(150);
  return position(page);
}

test("部屋は外部通信なしで実際の立体を描画する", async ({ page }) => {
  const external: string[] = [];
  const errors: string[] = [];
  page.on("request", (request) => {
    const url = request.url();
    if (!url.startsWith("http://127.0.0.1") && !/^(data|blob):/.test(url))
      external.push(url);
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await enterRoom(page);
  await expect(page.locator(".room-portal")).toHaveCount(4);
  await expect(page.locator(".room-shortcuts a")).toHaveCount(4);

  // A visible canvas alone can be blank after a WebGL/context failure.
  // Check the rendered image has both tonal range and substantial detail.
  const rendered = await page.locator(".room-canvas canvas").screenshot();
  const stats = await sharp(rendered).stats();
  expect(stats.isOpaque).toBe(true);
  expect(
    Math.max(...stats.channels.slice(0, 3).map((channel) => channel.stdev)),
  ).toBeGreaterThan(20);
  const pixels = await sharp(rendered)
    .resize(96, 96)
    .removeAlpha()
    .raw()
    .toBuffer();
  const colors = new Set<string>();
  for (let index = 0; index < pixels.length; index += 3)
    colors.add(
      [pixels[index], pixels[index + 1], pixels[index + 2]]
        .map((channel) => Math.floor(channel / 16))
        .join(","),
    );
  expect(colors.size).toBeGreaterThan(50);
  await page.screenshot({
    path: "docs/screenshots/home-desktop.png",
    fullPage: true,
    animations: "disabled",
  });
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
});

test("矢印キーで歩き、Spaceでジャンプして着地する", async ({ page }) => {
  await enterRoom(page);
  await walk(page);
  await page.keyboard.press("Space");
  await expect
    .poll(async () => (await position(page)).height, { timeout: 3000 })
    .toBeGreaterThan(0.05);
  await expect
    .poll(async () => (await position(page)).height, { timeout: 5000 })
    .toBeLessThanOrEqual(0.02);
  const stopped = await position(page);
  await page.waitForTimeout(250);
  const later = await position(page);
  expect(later.x).toBeCloseTo(stopped.x, 2);
  expect(later.z).toBeCloseTo(stopped.z, 2);
});

test("スマートフォンを開いて戻ると立ち位置を保ち、四つの入口が使える", async ({
  page,
}) => {
  await enterRoom(page);
  const before = await walk(page);
  for (const section of ["pokemon", "world", "japan", "mountains"]) {
    const portal = page.locator(`.room-portal[data-section="${section}"]`);
    await expect(portal).toBeVisible();
    if (section === "pokemon")
      await expect(portal).toHaveAccessibleName(
        "スマートフォンでポケモン図鑑を開く",
      );
    await portal.click();
    await expect(page).toHaveURL(new RegExp(`#/${section}$`));
    await expect(page.locator(".page-count strong")).toHaveText("0");
    await page.locator('nav a[href="#/"]').first().click();
    await expect(page.locator(".room-home")).toHaveAttribute(
      "data-room-status",
      "ready",
      { timeout: 30000 },
    );
    const restored = await position(page);
    expect(restored.x).toBeCloseTo(before.x, 1);
    expect(restored.z).toBeCloseTo(before.z, 1);
  }
});

test("WebGL非対応時も部屋から全コレクションへ進める", async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      type: string,
      ...args: unknown[]
    ) {
      if (/webgl/.test(type)) return null;
      return original.apply(this, [type, ...args] as Parameters<
        typeof original
      >);
    } as typeof original;
  });
  await page.goto("/#/");
  await expect(page.locator(".room-home")).toHaveAttribute(
    "data-room-status",
    "fallback",
  );
  for (const section of ["world", "japan", "mountains", "pokemon"]) {
    await page.locator(`.room-shortcuts a[href="#/${section}"]`).click();
    await expect(page).toHaveURL(new RegExp(`#/${section}$`));
    await expect(page.locator(".page-count strong")).toHaveText("0");
    await page.locator('nav a[href="#/"]').first().click();
    await expect(page.locator(".room-home")).toHaveAttribute(
      "data-room-status",
      "fallback",
    );
  }
});

test("動きの設定を移動後も保持し、WebGL喪失後は直接リンクへ切り替わる", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const room = await enterRoom(page);
  const motion = page.getByRole("button", {
    name: "動きを減らす",
    exact: true,
  });
  await expect(motion).toHaveAttribute("aria-pressed", "true");
  await expect(room).toHaveClass(/is-still/);
  await walk(page);
  await page.keyboard.press("Space");
  await expect
    .poll(async () => (await position(page)).height, { timeout: 3000 })
    .toBeGreaterThan(0.05);
  await expect
    .poll(async () => (await position(page)).height, { timeout: 5000 })
    .toBeLessThanOrEqual(0.02);
  await motion.click();
  await expect(motion).toHaveAttribute("aria-pressed", "false");
  await expect(room).not.toHaveClass(/is-still/);

  // Keep a manual choice through route remounts, including a choice that
  // differs from the operating system's prefers-reduced-motion setting.
  for (const retained of ["false", "true"]) {
    if (retained === "true") {
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await motion.click();
    }
    await expect(motion).toHaveAttribute("aria-pressed", retained);
    await page.locator('.room-portal[data-section="pokemon"]').click();
    await expect(page).toHaveURL(/#\/pokemon$/);
    await expect(page.locator(".page-count strong")).toHaveText("0");
    await page.locator('nav a[href="#/"]').first().click();
    await expect(room).toHaveAttribute("data-room-status", "ready", {
      timeout: 30000,
    });
    await expect(motion).toHaveAttribute("aria-pressed", retained);
  }

  const lost = await page.locator(".room-canvas canvas").evaluate((canvas) => {
    const context = (canvas as HTMLCanvasElement).getContext("webgl2");
    const extension = context?.getExtension("WEBGL_lose_context");
    if (!extension) return false;
    extension.loseContext();
    return true;
  });
  expect(lost, "実際のWebGLコンテキストを失わせて復帰導線を検証").toBe(true);
  await expect(room).toHaveAttribute("data-room-status", "fallback");
  await expect(
    page.getByRole("button", { name: "ジャンプ", exact: true }),
  ).toBeDisabled();
  await page.locator('.room-shortcuts a[href="#/pokemon"]').click();
  await expect(page).toHaveURL(/#\/pokemon$/);
  await expect(page.locator(".page-count strong")).toHaveText("0");
});

test.describe("タッチ操作", () => {
  test.use({
    viewport: { width: 360, height: 800 },
    hasTouch: true,
    isMobile: true,
  });

  test("方向パッドの長押しとタップジャンプが使え、横にはみ出さない", async ({
    page,
    context,
  }) => {
    await enterRoom(page);
    const control = page.getByRole("button", { name: "右へ", exact: true });
    const box = await control.boundingBox();
    expect(box).toBeTruthy();
    const start = await position(page);
    const cdp = await context.newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [
        { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 },
      ],
    });
    try {
      await expect
        .poll(async () => {
          const current = await position(page);
          return Math.hypot(current.x - start.x, current.z - start.z);
        })
        .toBeGreaterThan(0.15);
    } finally {
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
      await cdp.detach();
    }
    await page.getByRole("button", { name: "ジャンプ", exact: true }).tap();
    await expect
      .poll(async () => (await position(page)).height, { timeout: 3000 })
      .toBeGreaterThan(0.05);
    await expect
      .poll(async () => (await position(page)).height, { timeout: 5000 })
      .toBeLessThanOrEqual(0.02);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });

  test("横向きでも移動とジャンプが画面内にあり、スマートフォンをタップできる", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 844, height: 390 });
    await enterRoom(page);
    for (const name of ["前へ", "後ろへ", "左へ", "右へ", "ジャンプ"]) {
      const control = page.getByRole("button", { name, exact: true });
      await expect(control).toBeVisible();
      const box = await control.boundingBox();
      expect(box, `${name}の操作部を描画する`).toBeTruthy();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.y).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(844);
      expect(box!.y + box!.height).toBeLessThanOrEqual(390);
    }
    expect(
      await page.evaluate(() => ({
        horizontal: document.documentElement.scrollWidth > innerWidth,
        vertical: document.documentElement.scrollHeight > innerHeight,
      })),
    ).toEqual({ horizontal: false, vertical: false });
    await page.screenshot({
      path: "docs/screenshots/home-landscape.png",
      fullPage: true,
      animations: "disabled",
    });
    await page.locator('.room-portal[data-section="pokemon"]').tap();
    await expect(page).toHaveURL(/#\/pokemon$/);
    await expect(page.locator(".page-count strong")).toHaveText("0");
  });
});
