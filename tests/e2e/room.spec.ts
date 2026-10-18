import { test, expect, type Page } from "@playwright/test";
import sharp from "sharp";

const destinations = {
  world: "世界地図を開く",
  japan: "日本地図を開く",
  mountains: "百名山を開く",
  pokemon: "スマートフォンでポケモン図鑑を開く",
};

async function savedPosition(
  page: Page,
  pose: {
    x: number;
    y?: number;
    z: number;
    yaw: number;
    pitch?: number;
    brokenIds?: string[];
  },
) {
  // Restore a legitimate saved visitor position; all actions still use real input.
  await page.addInitScript(
    ({ key, value }) => sessionStorage.setItem(key, JSON.stringify(value)),
    {
      key: "personal-atlas-room-position-v2",
      value: { y: 0, pitch: 0, brokenIds: [], ...pose },
    },
  );
}
async function enterRoom(page: Page) {
  await page.goto("/#/");
  const room = page.locator(".room-home");
  await expect(room).toHaveAttribute("data-room-status", "ready", {
    timeout: 30000,
  });
  await expect(page.locator(".room-canvas canvas")).toBeVisible();
  for (const coordinate of [
    "player-x",
    "player-z",
    "player-height",
    "yaw",
    "pitch",
  ])
    await expect(room).toHaveAttribute(
      `data-${coordinate}`,
      /^-?\d+(?:\.\d+)?$/,
    );
  return room;
}
async function position(page: Page) {
  return page.locator(".room-home").evaluate((element) => ({
    x: Number(element.getAttribute("data-player-x")),
    z: Number(element.getAttribute("data-player-z")),
    height: Number(element.getAttribute("data-player-height")),
    yaw: Number(element.getAttribute("data-yaw")),
    pitch: Number(element.getAttribute("data-pitch")),
  }));
}
async function blurControl(page: Page) {
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement)
      document.activeElement.blur();
  });
}
async function walk(page: Page, key = "KeyD") {
  await blurControl(page);
  const start = await position(page);
  await page.keyboard.down(key);
  try {
    await expect
      .poll(
        async () => {
          const current = await position(page);
          return Math.hypot(current.x - start.x, current.z - start.z);
        },
        { intervals: [50, 100] },
      )
      .toBeGreaterThan(0.15);
  } finally {
    await page.keyboard.up(key);
  }
  await page.waitForTimeout(150);
  return position(page);
}
async function openMenu(page: Page) {
  const toggle = page.locator(".room-menu-toggle");
  if ((await toggle.getAttribute("aria-expanded")) !== "true")
    await toggle.click();
  await expect(page.locator(".room-menu")).toBeVisible();
}
async function closeMenu(page: Page) {
  const toggle = page.locator(".room-menu-toggle");
  if ((await toggle.getAttribute("aria-expanded")) === "true")
    await page
      .locator(".room-menu")
      .getByRole("button", {
        name: "部屋に戻る",
        exact: true,
      })
      .click();
  await expect(page.locator(".room-menu")).not.toBeVisible();
}
async function openCollection(page: Page, section: keyof typeof destinations) {
  await openMenu(page);
  await page
    .locator(".room-menu")
    .getByRole("link", { name: destinations[section], exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`#/${section}$`));
  await expect(page.locator(".page-count strong")).toHaveText("0");
}
async function returnToRoom(page: Page) {
  await page.locator('nav a[href="#/"]').first().click();
  await expect(page.locator(".room-home")).toHaveAttribute(
    "data-room-status",
    "ready",
    { timeout: 30000 },
  );
}

test("部屋全体を一人称で描画し、大きな見出しや入口ラベルで覆わない", async ({
  page,
}) => {
  const external: string[] = [],
    errors: string[] = [];
  page.on("request", (request) => {
    const url = request.url();
    if (!url.startsWith("http://127.0.0.1") && !/^(data|blob):/.test(url))
      external.push(url);
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await enterRoom(page);
  await expect(page.locator(".room-portal, .room-heading")).toHaveCount(0);
  await expect(page.locator(".room-menu")).not.toBeVisible();
  await expect(page.locator(".room-menu-toggle")).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await expect(page.locator(".room-crosshair")).toBeVisible();
  const canvas = page.locator(".room-canvas canvas");
  const box = await canvas.boundingBox();
  expect(box!.width).toBeGreaterThanOrEqual(page.viewportSize()!.width * 0.95);
  expect(box!.height).toBeGreaterThanOrEqual(
    page.viewportSize()!.height * 0.95,
  );
  // A visible canvas alone can still be blank after a WebGL/context failure.
  const rendered = await canvas.screenshot();
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

test("マウスで見回し、その向きに歩き、Spaceで床へ着地する", async ({
  page,
}) => {
  const room = await enterRoom(page);
  const beforeLook = await position(page);
  const box = await page.locator(".room-canvas canvas").boundingBox();
  await page.mouse.move(box!.x + box!.width * 0.5, box!.y + box!.height * 0.45);
  await page.mouse.down();
  await page.mouse.move(
    box!.x + box!.width * 0.65,
    box!.y + box!.height * 0.5,
    { steps: 10 },
  );
  await page.mouse.up();
  await expect
    .poll(async () => Math.abs((await position(page)).yaw - beforeLook.yaw))
    .toBeGreaterThan(0.1);
  await expect
    .poll(async () => Math.abs((await position(page)).pitch - beforeLook.pitch))
    .toBeGreaterThan(0.03);
  await expect(page).toHaveURL(/#\/$/);
  const start = await position(page),
    end = await walk(page, "KeyW");
  const forward =
    (end.x - start.x) * -Math.sin(start.yaw) +
    (end.z - start.z) * -Math.cos(start.yaw);
  expect(forward).toBeGreaterThan(0.1);
  await page.keyboard.press("Space");
  await expect
    .poll(async () => (await position(page)).height, {
      timeout: 3000,
      intervals: [50, 100],
    })
    .toBeGreaterThan(0.05);
  await expect(room).toHaveAttribute("data-grounded", "true", {
    timeout: 5000,
  });
  await expect
    .poll(async () => (await position(page)).height)
    .toBeLessThanOrEqual(0.02);
  const stopped = await position(page);
  await page.waitForTimeout(250);
  const later = await position(page);
  expect(later.x).toBeCloseTo(stopped.x, 2);
  expect(later.z).toBeCloseTo(stopped.z, 2);
});

for (const furniture of [
  {
    name: "机",
    id: "desk",
    start: { x: 1.35, z: -2.67, yaw: -Math.PI / 2 },
    targetX: 2.05,
    top: 1.36,
    direction: 1,
  },
  {
    name: "ベッド",
    id: "bed",
    start: { x: -1.7, z: -1.5, yaw: Math.PI / 2 },
    targetX: -2.5,
    top: 1.03,
    direction: -1,
  },
]) {
  test(`${furniture.name}へ実際にジャンプし、家具の上で着地する`, async ({
    page,
  }) => {
    await savedPosition(page, furniture.start);
    const room = await enterRoom(page);
    await expect
      .poll(async () => (await position(page)).x)
      .toBeCloseTo(furniture.start.x, 2);
    await blurControl(page);
    await page.keyboard.down("KeyW");
    try {
      await page.keyboard.press("Space");
      await expect
        .poll(
          async () =>
            furniture.direction *
            ((await position(page)).x - furniture.targetX),
          {
            timeout: 5000,
            intervals: [25, 50],
          },
        )
        .toBeGreaterThan(0);
    } finally {
      await page.keyboard.up("KeyW");
    }
    await expect(room).toHaveAttribute("data-support-id", furniture.id, {
      timeout: 5000,
    });
    await expect(room).toHaveAttribute("data-grounded", "true");
    await expect
      .poll(async () => (await position(page)).height)
      .toBeCloseTo(furniture.top, 1);
  });
}

test("遠い物は壊せず、近づいてパンチすると小物だけが壊れ、元に戻せる", async ({
  page,
}) => {
  // Aim down toward the small floor sculpture, outside the 2 m punch range.
  // After approaching, aim again at the object's actual position on screen.
  await savedPosition(page, {
    x: 1.4,
    z: 3.35,
    yaw: 0,
    pitch: -Math.atan2(1.3, 2.05),
  });
  const room = await enterRoom(page);
  await page.keyboard.press("KeyF");
  await page.waitForTimeout(650);
  await expect(room).toHaveAttribute("data-broken-count", "0");
  const start = await position(page);
  await page.keyboard.down("KeyW");
  try {
    await expect
      .poll(
        async () => {
          const current = await position(page);
          return Math.hypot(current.x - start.x, current.z - start.z);
        },
        { intervals: [25, 50] },
      )
      .toBeGreaterThan(0.5);
  } finally {
    await page.keyboard.up("KeyW");
  }
  // Software rendering may finish a held movement well past the first poll.
  // Wait for released input to render, then look down from the observed pose.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
  const current = await position(page);
  const desiredPitch = Math.atan2(
    0.7 - (current.height + 1.5),
    Math.hypot(current.x - 1.4, current.z - 1.3),
  );
  const canvasBox = await page.locator(".room-canvas canvas").boundingBox();
  const pointerX = canvasBox!.x + canvasBox!.width / 2;
  const pointerY = canvasBox!.y + canvasBox!.height / 2;
  await page.mouse.move(pointerX, pointerY);
  await page.mouse.down();
  await page.mouse.move(
    pointerX,
    pointerY + (current.pitch - desiredPitch) / 0.0036,
    {
      steps: 12,
    },
  );
  await page.mouse.up();
  await page.keyboard.press("KeyF");
  await expect(room).toHaveAttribute("data-broken-count", "1");
  await openCollection(page, "pokemon");
  await returnToRoom(page);
  await expect(room).toHaveAttribute("data-broken-count", "1");
  await openCollection(page, "world");
  await returnToRoom(page);
  await openMenu(page);
  await page
    .getByRole("button", { name: "部屋の小物を元に戻す", exact: true })
    .click();
  await expect(room).toHaveAttribute("data-broken-count", "0");
});

test("壊した小物の場所に立ったまま復元しても閉じ込められない", async ({
  page,
}) => {
  await savedPosition(page, {
    x: 1.4,
    z: 1.3,
    yaw: 0,
    brokenIds: ["entry-vase"],
  });
  const room = await enterRoom(page);
  await expect(room).toHaveAttribute("data-broken-count", "1");
  const initial = await position(page);
  expect(initial.x).toBeCloseTo(1.4, 2);
  expect(initial.z).toBeCloseTo(1.3, 2);
  await openMenu(page);
  await page
    .getByRole("button", {
      name: "部屋の小物を元に戻す",
      exact: true,
    })
    .click();
  await expect(room).toHaveAttribute("data-broken-count", "0");
  await expect
    .poll(async () => {
      const current = await position(page);
      return Math.hypot(current.x - 1.4, current.z - 1.3);
    })
    .toBeGreaterThan(0.5);
  await expect(room).toHaveAttribute("data-grounded", "true");
  await walk(page);
});

test("スマートフォン本体をクリックすると図鑑を開く", async ({ page }) => {
  // A legitimate saved floor position in front of the desk, aimed at the glass.
  await savedPosition(page, { x: 2.15, z: -0.65, yaw: -0.3085, pitch: 0.231 });
  await enterRoom(page);
  const box = await page.locator(".room-canvas canvas").boundingBox();
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await expect(page).toHaveURL(/#\/pokemon$/);
  await expect(page.locator(".page-count strong")).toHaveText("0");
});

test("隠したメニューから4コレクションへ進み、戻ると位置と視線を保つ", async ({
  page,
}) => {
  await enterRoom(page);
  const before = await walk(page);
  for (const section of Object.keys(
    destinations,
  ) as (keyof typeof destinations)[]) {
    await openCollection(page, section);
    await returnToRoom(page);
    await expect(page.locator(".room-menu")).not.toBeVisible();
    const restored = await position(page);
    expect(restored.x).toBeCloseTo(before.x, 1);
    expect(restored.z).toBeCloseTo(before.z, 1);
    expect(restored.yaw).toBeCloseTo(before.yaw, 2);
    expect(restored.pitch).toBeCloseTo(before.pitch, 2);
  }
});

test("WebGL非対応時も全コレクションへ進める", async ({ page }) => {
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
  for (const section of Object.keys(
    destinations,
  ) as (keyof typeof destinations)[]) {
    await openCollection(page, section);
    await page.locator('nav a[href="#/"]').first().click();
    await expect(page.locator(".room-home")).toHaveAttribute(
      "data-room-status",
      "fallback",
    );
  }
});

test("動きの設定を往復後も保持し、WebGL喪失後も記録へ進める", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const room = await enterRoom(page);
  await openMenu(page);
  const motion = page.getByRole("button", {
    name: "動きを減らす",
    exact: true,
  });
  await expect(motion).toHaveAttribute("aria-pressed", "true");
  await motion.click();
  for (const retained of ["false", "true"]) {
    if (retained === "true") {
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await motion.click();
    }
    await expect(motion).toHaveAttribute("aria-pressed", retained);
    await openCollection(page, "pokemon");
    await returnToRoom(page);
    await openMenu(page);
    await expect(motion).toHaveAttribute("aria-pressed", retained);
  }
  await closeMenu(page);
  await walk(page);
  await page.keyboard.press("Space");
  await expect
    .poll(async () => (await position(page)).height, {
      timeout: 3000,
      intervals: [50, 100],
    })
    .toBeGreaterThan(0.05);
  await expect(room).toHaveAttribute("data-grounded", "true", {
    timeout: 5000,
  });
  const lost = await page.locator(".room-canvas canvas").evaluate((canvas) => {
    const extension = (canvas as HTMLCanvasElement)
      .getContext("webgl2")
      ?.getExtension("WEBGL_lose_context");
    if (!extension) return false;
    extension.loseContext();
    return true;
  });
  expect(lost, "実際にWebGLコンテキストを失わせる").toBe(true);
  await expect(room).toHaveAttribute("data-room-status", "fallback");
  await expect(page.locator(".room-jump")).toBeDisabled();
  await expect(page.locator(".room-jump")).not.toBeVisible();
  await openCollection(page, "pokemon");
});

test.describe("タッチ操作", () => {
  test.use({
    viewport: { width: 360, height: 800 },
    hasTouch: true,
    isMobile: true,
  });

  test("指で見回し、方向パッド長押しとジャンプ・パンチを操作できる", async ({
    page,
    context,
  }) => {
    const room = await enterRoom(page);
    const cdp = await context.newCDPSession(page);
    const beforeLook = await position(page);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: 180, y: 320 }],
    });
    for (let step = 1; step <= 6; step++)
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: 180 + step * 12, y: 320 - step * 4 }],
      });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await expect
      .poll(async () => Math.abs((await position(page)).yaw - beforeLook.yaw))
      .toBeGreaterThan(0.1);
    await expect(page).toHaveURL(/#\/$/);
    const box = await page
      .getByRole("button", { name: "右へ", exact: true })
      .boundingBox();
    const start = await position(page);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [
        { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 },
      ],
    });
    try {
      await expect
        .poll(
          async () => {
            const current = await position(page);
            return Math.hypot(current.x - start.x, current.z - start.z);
          },
          { intervals: [50, 100] },
        )
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
      .poll(async () => (await position(page)).height, {
        timeout: 3000,
        intervals: [50, 100],
      })
      .toBeGreaterThan(0.05);
    await expect(room).toHaveAttribute("data-grounded", "true", {
      timeout: 5000,
    });
    await page.getByRole("button", { name: "パンチ", exact: true }).tap();
    await expect(room).toHaveAttribute("data-punching", "true");
    await expect(room).toHaveAttribute("data-punching", "false");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });

  test("横向きでも操作部が画面に収まり、メニューから記録を開ける", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 844, height: 390 });
    await enterRoom(page);
    for (const name of [
      "前へ",
      "後ろへ",
      "左へ",
      "右へ",
      "ジャンプ",
      "パンチ",
      "記録と設定を開く",
    ]) {
      const control = page.getByRole("button", { name, exact: true });
      await expect(control).toBeVisible();
      const box = await control.boundingBox();
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
    await openMenu(page);
    await page
      .locator(".room-menu")
      .getByRole("link", { name: destinations.pokemon, exact: true })
      .tap();
    await expect(page).toHaveURL(/#\/pokemon$/);
    await expect(page.locator(".page-count strong")).toHaveText("0");
  });
});
