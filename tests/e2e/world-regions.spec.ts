import { test, expect } from "@playwright/test";

test("WORLDの小地域ごとの訪問件数・検索・選択が同じ分類を使う", async ({ page }) => {
  // 分類の変更だけを確認するため、3D描画・カメラ・楽器の試験は実行しない。
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(this: HTMLCanvasElement, type: string, ...args: unknown[]) {
      if (/webgl/.test(type)) return null;
      return original.apply(this, [type, ...args] as Parameters<typeof original>);
    } as typeof original;
  });
  await page.route("**/data/*.txt", route => route.fulfill({ contentType: "text/plain;charset=utf-8",
    body: decodeURIComponent(route.request().url()).endsWith("/訪問した国.txt") ? "日本\nタイ\nインド\nイギリス\nアメリカ\nフィジー" : "" }));
  await page.goto("/#/room/world");
  await expect(page.locator(".world-mode")).toBeVisible({ timeout: 30000 });
  await expect(page.locator(".world-total strong")).toHaveText("6");
  const regions = page.locator(".world-region");
  await expect(regions).toHaveCount(6);
  for (const [name, country] of [["東アジア", "JPN"], ["東南アジア", "THA"], ["南アジア", "IND"],
    ["北ヨーロッパ", "GBR"], ["北アメリカ", "USA"], ["メラネシア", "FJI"]]) {
    const group = regions.filter({ has: page.getByRole("button", { name: new RegExp(`^▾ ${name} 1件`) }) });
    await expect(group.locator(`.country-row[data-country-id="${country}"]`)).toHaveCount(1);
  }
  await page.getByRole("searchbox").fill("タイ");
  await expect(regions).toHaveCount(1);
  await expect(regions.locator(".world-region-heading")).toContainText("東南アジア");
  await page.locator('.country-row[data-country-id="THA"]').click();
  await expect(page.locator(".world-selection")).toContainText("東南アジア · 訪問済み");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("searchbox").fill("");
  await page.getByRole("button", { name: "すべて", exact: true }).click();
  await expect(regions).toHaveCount(23);
  await expect(page.locator(".world-country-list .country-row")).toHaveCount(249);
});
