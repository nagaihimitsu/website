import { test, expect } from "@playwright/test";
test("WebKitの縦画面・横画面で一覧だけをスクロールし、選択を保持する", async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(this: HTMLCanvasElement, type: string, ...args: unknown[]) {
      if (/webgl/.test(type)) return null;
      return original.apply(this, [type, ...args] as Parameters<typeof original>);
    } as typeof original;
  });
  await page.route("**/data/*.txt", route => route.fulfill({ contentType: "text/plain;charset=utf-8", body: decodeURIComponent(route.request().url()).endsWith("/訪問した国.txt") ? "日本\nイギリス" : "" }));
  await page.goto("/#/room/world");
  await expect(page.locator(".world-mode")).toBeVisible();
  // WebKit/LinuxのGPU有無によらずSafari用レイアウトとタッチ入力を検査できる2D表示を使用。
  await page.getByRole("button", { name: "2D 地図", exact: true }).tap();
  await expect(page.locator(".world-mode .land")).toHaveCount(250);
  for (const viewport of [{ width:390, height:844 }, { width:390, height:680 }, { width:844, height:390 }]) {
    await page.setViewportSize(viewport);
    const bounds = await page.locator(".world-viewport").boundingBox();
    await page.getByRole("button", { name:"すべて", exact:true }).tap();
    const list=page.locator(".world-country-list");
    await list.evaluate(node => { node.scrollTop = node.scrollHeight; });
    expect(await list.evaluate(node => Math.abs(node.scrollHeight-node.scrollTop-node.clientHeight))).toBeLessThanOrEqual(2);
    expect((await page.locator(".world-viewport").boundingBox())?.y).toBeCloseTo(bounds!.y, 1);
    expect(await page.evaluate(() => document.documentElement.scrollHeight-innerHeight)).toBeLessThanOrEqual(1);
    await page.getByRole("searchbox").fill("Japan");
    await page.locator('.country-row[data-country-id="JPN"]').tap();
    await expect(page.locator(".world-map-label text")).toHaveText("日本");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.setViewportSize({ ...viewport, height: viewport.height - 40 });
    await expect(page.locator(".world-mode")).toHaveAttribute("data-selected-country", "JPN");
    await expect(page.locator(".world-map-label text")).toHaveText("日本");
    await page.getByRole("button", { name:"表示リセット", exact:true }).tap();
    await expect(page.locator(".world-mode")).toHaveAttribute("data-selected-country", "");
    await page.getByRole("searchbox").fill("");
  }
});
