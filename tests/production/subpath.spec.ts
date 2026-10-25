import { test, expect } from "@playwright/test";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import sharp from "sharp";
test("本番ビルドを /website/ 配下から読み込み、3Dの部屋・TXT・写真・ハッシュ再読み込みが動く", async ({
  page,
}) => {
  // 部屋と地球儀の初期化・再読込をソフトウェアWebGLでも検査する。
  test.setTimeout(90000);
  const sourcePaths = ["public/data/訪問した国.txt", "public/data/記録_国.txt"];
  const sourcesBefore = await Promise.all(sourcePaths.map(path => readFile(path, "utf8")));
  // Synthetic records exist only in the isolated test build, never public/ or dist/.
  await mkdir(".test-build/photos/test", { recursive: true });
  await sharp({
    create: { width: 64, height: 40, channels: 3, background: "#487b72" },
  })
    .webp()
    .toFile(".test-build/photos/test/image.webp");
  await writeFile(".test-build/data/訪問した国.txt", "日本");
  await writeFile(
    ".test-build/data/記録_国.txt",
    "日本|2024-05|test/image.webp",
  );
  const failed: string[] = [];
  page.on("response", (r) => {
    if (r.status() >= 400) failed.push(r.url());
  });
  await page.goto("http://127.0.0.1:4174/website/#/");
  await expect(page.locator(".room-home")).toHaveAttribute(
    "data-room-status",
    "ready",
    { timeout: 20000 },
  );
  await expect(page.locator(".room-canvas canvas")).toBeVisible();
  await expect(page.locator(".room-menu")).not.toBeVisible();
  await page
    .getByRole("button", { name: "記録と設定を開く", exact: true })
    .click();
  await expect(page.locator(".room-menu")).toBeVisible();
  for (const [section, label] of [
    ["world", "地球儀を開く"],
    ["mountains", "日本地図・百名山を開く"],
    ["pokemon", "図鑑端末を開く"],
  ])
    await expect(
      page.locator(`.room-menu a[href="#/${section}"]`),
    ).toHaveAccessibleName(label);
  const timeOrigin = await page.evaluate(() => performance.timeOrigin);
  await page.getByRole("link", { name: "地球儀を開く", exact: true }).click();
  await expect(page).toHaveURL("http://127.0.0.1:4174/website/#/room/world");
  expect(await page.evaluate(() => performance.timeOrigin)).toBe(timeOrigin);
  await expect(page.locator(".page-count strong")).toHaveText("1");
  await page.reload();
  await expect(page.locator(".page-count strong")).toHaveText("1");
  await page.getByRole("searchbox").fill("日本");
  await page.locator(".entry").click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.locator(".world-records summary").click();
  const image = page.locator(".world-records img");
  await expect(image).toHaveAttribute("src", "/website/photos/test/image.webp");
  await expect(image).toBeVisible();
  expect(
    await image.evaluate(
      (i: HTMLImageElement) => i.complete && i.naturalWidth === 64,
    ),
  ).toBe(true);
  // 旧URLの直アクセスもサブパス配信のまま残す。
  await page.goto("http://127.0.0.1:4174/website/#/world");
  await page.reload();
  await expect(page.locator(".page-count strong")).toHaveText("1");
  await expect(page.locator('path[data-id="JPN"]')).toHaveAttribute("data-achieved", "true");
  expect(failed).toEqual([]);
  // Production records already include Japan. Compare both original files
  // exactly rather than assuming that the user's real records are empty.
  expect(await Promise.all(sourcePaths.map(path => readFile(path, "utf8")))).toEqual(sourcesBefore);
});
