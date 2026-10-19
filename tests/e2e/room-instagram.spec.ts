import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { enterRoom, projectRoomPoint, savedPosition } from "./helpers/room";

const instagram = "https://instagram.com/nagaihimitsu/";
const linkName = "Instagramを開く（外部リンク・新しいタブ）";

async function enterPhotoRoom(page: Page, context: BrowserContext) {
  // Only the external destination is stubbed. The real room, prints and
  // raycasting are exercised without sending requests to Instagram.
  await context.route("https://instagram.com/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<title>Instagram destination</title>",
    }),
  );
  await savedPosition(page, { x: 0.9, z: 2.9, yaw: 0.5, pitch: 0.45 });
  await enterRoom(page);
}

async function photoPoint(page: Page) {
  // A point on the actual Mont-Saint-Michel print, away from the camera prop
  // and visible above the avatar even in the narrow portrait viewport.
  const point = await projectRoomPoint(page, [0.15, 0.64, 1.72]);
  expect(Math.abs(point.normalized.x)).toBeLessThan(0.95);
  expect(Math.abs(point.normalized.y)).toBeLessThan(0.95);
  return point;
}

async function opensSeparatePage(
  page: Page, context: BrowserContext, action: () => Promise<unknown>,
) {
  const roomUrl = page.url();
  const popupPromise = context.waitForEvent("page");
  await action();
  const popup = await popupPromise;
  await popup.waitForURL(instagram);
  expect(await popup.evaluate(() => window.opener === null)).toBe(true);
  await expect(page).toHaveURL(roomUrl);
  await expect(page.locator(".room-home")).toHaveAttribute(
    "data-room-status", "ready",
  );
  await expect(page.locator(".room-home")).not.toHaveClass(/is-opening/);
  await popup.close();
  await page.bringToFront();
}

test("写真本体・外部リンク表示・EキーでInstagramを別タブに開き、部屋を操作し続けられる", { tag: "@links" }, async ({ page, context }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await enterPhotoRoom(page, context);
  const point = await photoPoint(page);
  await page.mouse.move(point.x, point.y);
  const link = page.getByRole("link", { name: linkName, exact: true });
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute("href", instagram);
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("rel", /noopener/);
  await expect(link).toHaveAttribute("rel", /noreferrer/);
  await expect(link).toContainText("外部リンク・新しいタブ");

  await opensSeparatePage(page, context, () => page.mouse.click(point.x, point.y));
  await page.mouse.move(point.x, point.y);
  await opensSeparatePage(page, context, () => page.keyboard.press("KeyE"));
  await page.mouse.move(point.x, point.y);
  await expect(link).toBeVisible();
  const label = (await link.boundingBox())!;
  // The hint must remain reachable across the canvas between it and the photo.
  await page.mouse.move(label.x + label.width / 2, label.y + label.height / 2, {
    steps: 12,
  });
  await expect(link).toBeVisible();
  await opensSeparatePage(page, context, () => link.click());
  expect(context.pages()).toHaveLength(1);
  // Adding an external destination must preserve the existing internal links.
  await page.locator(".room-menu-toggle").click();
  await page.locator(".room-menu")
    .getByRole("link", { name: "世界地図を開く", exact: true }).click();
  await expect(page).toHaveURL(/#\/world$/);
});

test.describe("タッチ操作", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("写真のタップは別タブを開き、写真からの視点ドラッグでは開かない", { tag: "@links" }, async ({ page, context }) => {
    await enterPhotoRoom(page, context);
    const point = await photoPoint(page);
    await opensSeparatePage(page, context, () =>
      page.touchscreen.tap(point.x, point.y),
    );
    const previousYaw = await page.locator(".room-home").getAttribute("data-yaw");
    const cdp = await context.newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart", touchPoints: [{ x: point.x, y: point.y }],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove", touchPoints: [{ x: point.x + 45, y: point.y }],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd", touchPoints: [],
    });
    await expect(page.locator(".room-home")).not.toHaveAttribute(
      "data-yaw", previousYaw!,
    );
    expect(context.pages()).toHaveLength(1);
    await expect(page).toHaveURL(/#\/$/);
    await expect(page.locator(".room-home")).toHaveAttribute(
      "data-room-status", "ready",
    );
    await cdp.detach();
  });
});
