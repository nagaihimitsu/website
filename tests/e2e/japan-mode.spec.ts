import { test, expect, type Page } from "@playwright/test";

async function fixture(page: Page, useWebGL = false) {
  if (!useWebGL) await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(this: HTMLCanvasElement, type: string, ...args: unknown[]) {
      if (/webgl/.test(type)) return null;
      return original.apply(this, [type, ...args] as Parameters<typeof original>);
    } as typeof original;
  });
  await page.route("**/data/*.txt", route => {
    const name = decodeURIComponent(route.request().url()).split("/").pop();
    route.fulfill({ contentType: "text/plain;charset=utf-8", body: name === "登頂した百名山.txt" ? "富士山\n北岳" : name === "訪問した都道府県.txt" ? "山梨県\n静岡県\n沖縄県" : "" });
  });
  await page.goto("/#/room/mountains");
  await expect(page.locator(".japan-mode")).toBeVisible({ timeout: 30000 });
}
async function centered(page: Page, id: string) {
  await expect(page.locator(".japan-mode")).toHaveAttribute("data-selected-mountain", id);
  const marker = page.locator(`.mountain-marker[data-id="${id}"]`);
  await expect(marker).toHaveClass(/selected-marker/);
  await expect.poll(async () => marker.evaluate(node => {
    const map = node.closest("svg")!.getBoundingClientRect(), point = new DOMPoint(0, 0).matrixTransform((node as SVGGraphicsElement).getScreenCTM()!);
    return Math.hypot(point.x - map.x - map.width / 2, point.y - map.y - map.height / 2);
  })).toBeLessThan(2);
  await expect(marker.locator(".japan-map-label")).toBeVisible();
  await expect(page.locator(".japan-map-pane .map-surface")).toHaveAttribute("data-japan-animating", "false");
}

for (const mobile of [false, true]) test.describe(mobile ? "JAPAN touch" : "JAPAN desktop", () => {
  test.use({ viewport: mobile ? { width:390, height:844 } : { width:1440, height:900 }, hasTouch:mobile, isMobile:mobile });
  test("固定地図・全山の情報・双方向選択・フィルター・画面サイズ変更", async ({ page }) => {
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    await fixture(page);
    const origin = await page.evaluate(() => performance.timeOrigin), map = page.locator(".japan-map-pane"), list = page.locator(".japan-mountain-list");
    await expect.poll(async () => Math.abs((await map.locator("svg").boundingBox())!.height - (await map.boundingBox())!.height)).toBeLessThan(2);
    await expect(page.locator(".japan-progress")).toContainText("2/ 100 座");
    await expect(page.locator(".prefecture-progress")).toContainText("3 / 47");
    await expect(page.locator(".mountain-row")).toHaveCount(100);
    await expect(page.locator(".prefecture-layer.visited")).toHaveCount(3);
    await expect(page.getByRole("searchbox")).toHaveCount(0);
    await expect(page.getByRole("checkbox")).toHaveCount(0);
    for (const name of ["最小", "中間", "最大"]) await expect(page.getByRole("button", { name, exact:true })).toHaveCount(0);
    for (const id of ["m021", "m087", "m088"]) {
      const row = page.locator(`.mountain-row[data-mountain-id="${id}"]`);
      await expect(row.locator(".mountain-meta")).toContainText(/\d[\d,]*m.*[都道府県]/);
      await expect(row).toContainText("未登頂");
    }
    await expect(page.locator('.mountain-row[data-mountain-id="m087"]')).toContainText("岐阜県・石川県");
    await expect(page.locator('.mountain-row[data-mountain-id="m046"]')).toContainText("富山県・長野県");
    await expect(page.locator('.mountain-row[data-mountain-id="m066"]')).toContainText("埼玉県・東京都・山梨県");
    const box = await map.boundingBox();
    await list.evaluate(node => { node.scrollTop = node.scrollHeight; });
    expect(await list.evaluate(node => node.scrollHeight - node.clientHeight - node.scrollTop)).toBeLessThan(2);
    expect((await map.boundingBox())!.y).toBeCloseTo(box!.y, 1);
    await page.locator('.mountain-row[data-mountain-id="m100"]').click();
    await centered(page, "m100");
    // 移動中に別の山を選んだ場合も、最後の選択へ向かう。
    await page.locator('.mountain-row[data-mountain-id="m001"]').click();
    await page.locator('.mountain-row[data-mountain-id="m072"]').click();
    await centered(page, "m072");
    await expect(page.locator(".japan-map-label")).toContainText("3,776m · 登頂済み");
    await expect(page.locator(".japan-map-label")).toContainText("山梨県・静岡県");
    await page.screenshot({ path:`/tmp/japan-selected-${mobile ? "mobile" : "desktop"}.png` });
    if (mobile) {
      await page.setViewportSize({ width:390, height:780 });
      await centered(page, "m072");
      await expect.poll(async () => Math.abs((await map.locator("svg").boundingBox())!.height - (await map.boundingBox())!.height)).toBeLessThan(2);
    }
    await expect(page.getByRole("dialog")).toHaveCount(0);
    // 実際の中心マーカーをクリックして、一覧側へ逆連動する。
    await list.evaluate(node => { node.scrollTop = 0; });
    const point = await page.locator('.mountain-marker[data-id="m072"]').evaluate(node => {
      const p = new DOMPoint(0,0).matrixTransform((node as SVGGraphicsElement).getScreenCTM()!); return { x:p.x, y:p.y };
    });
    await page.mouse.click(point.x, point.y);
    await expect.poll(() => list.evaluate(node => node.scrollTop)).toBeGreaterThan(100);
    await expect(page.locator('.mountain-row[data-mountain-id="m072"]')).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name:"未登頂", exact:true }).click();
    await expect(page.locator(".mountain-row")).toHaveCount(98);
    await expect(page.locator(".mountain-marker")).toHaveCount(98);
    await expect(page.locator(".japan-map-label")).toHaveCount(0);
    await page.getByRole("button", { name:"登頂済み", exact:true }).click();
    await expect(page.locator(".mountain-marker")).toHaveCount(2);
    await expect(page.locator(".mountain-row")).toHaveCount(2);
    await page.locator('.mountain-row[data-mountain-id="m080"]').click();
    await centered(page, "m080");
    if (!mobile) {
      const surface = page.locator(".japan-map-pane .map-surface"), beforeZoom = Number(await surface.getAttribute("data-japan-zoom"));
      await map.locator("svg").hover();
      await page.mouse.wheel(0, -100);
      await expect.poll(async () => Number(await surface.getAttribute("data-japan-zoom"))).toBeGreaterThan(beforeZoom);
      expect((await map.boundingBox())!.y).toBeCloseTo(box!.y, 1);
    }
    for (let i = 0; i < 6; i++) await page.getByRole("button", { name:"地図を拡大", exact:true }).click();
    await expect.poll(async () => Number(await page.locator(".japan-map-pane .map-surface").getAttribute("data-japan-zoom"))).toBe(32);
    await centered(page, "m080");
    // 南アルプスの北岳・間ノ岳を最大倍率で個別に狙えることを確認する。
    await page.getByRole("button", { name:"すべて", exact:true }).click();
    const peaks = await page.locator('.mountain-marker[data-id="m080"], .mountain-marker[data-id="m081"]').evaluateAll(nodes => nodes.map(node => {
      const point = new DOMPoint(0, 0).matrixTransform((node as SVGGraphicsElement).getScreenCTM()!);
      return { id:node.getAttribute("data-id"), x:point.x, y:point.y };
    }));
    expect(Math.hypot(peaks[0].x-peaks[1].x, peaks[0].y-peaks[1].y)).toBeGreaterThan(9);
    const aino = peaks.find(point => point.id === "m081")!;
    await page.mouse.click(aino.x, aino.y);
    await centered(page, "m081");
    await expect(page.locator(".japan-map-label")).toContainText("未登頂");
    await page.getByRole("button", { name:"登頂済み", exact:true }).click();
    await page.getByRole("button", { name:"地図をリセット", exact:true }).click();
    await expect(page.locator(".japan-mode")).toHaveAttribute("data-selected-mountain", "");
    await expect.poll(async () => Number(await page.locator(".japan-map-pane .map-surface").getAttribute("data-japan-zoom"))).toBeCloseTo(1, 3);
    await expect(page.getByRole("button", { name:"登頂済み", exact:true })).toHaveAttribute("aria-pressed", "true");
    for (const viewport of mobile ? [{ width:390, height:680 }, { width:844, height:390 }] : [{ width:1024, height:768 }]) {
      await page.setViewportSize(viewport);
      await expect.poll(async () => Math.abs((await map.locator("svg").boundingBox())!.height - (await map.boundingBox())!.height)).toBeLessThan(2);
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(true);
      await expect(page.locator(".japan-map-pane")).toBeVisible();
      await expect(page.locator(".japan-mountain-list")).toBeVisible();
    }
    expect(await page.evaluate(() => performance.timeOrigin)).toBe(origin);
    await page.screenshot({ path:`/tmp/japan-fixed-${mobile ? "mobile" : "desktop"}.png` });
    await page.getByRole("button", { name:"部屋に戻る" }).click();
    await expect(page).toHaveURL(/#\/$/);
    expect(errors).toEqual([]);
  });
});

test.describe("JAPANタッチ入力", () => {
  test.use({ viewport:{ width:390, height:844 }, hasTouch:true, isMobile:true });
  test("ピンチ・ドラッグ・一覧スワイプが互いに干渉せず移動範囲を保つ", async ({ page }) => {
    await fixture(page);
    const session = await page.context().newCDPSession(page), map = page.locator(".japan-map-pane .map-surface"), svg = map.locator("svg");
    const box = (await svg.boundingBox())!, x = box.x + box.width / 2, y = box.y + box.height / 2;
    const touch = async (type: "touchStart" | "touchMove" | "touchEnd", points: {x:number;y:number;id:number}[]) => session.send("Input.dispatchTouchEvent", { type, touchPoints:points });
    await touch("touchStart", [{ x:x-30,y,id:1 },{ x:x+30,y,id:2 }]);
    for (let d=35;d<=90;d+=10) await touch("touchMove", [{ x:x-d,y,id:1 },{ x:x+d,y,id:2 }]);
    await touch("touchEnd", []);
    await expect.poll(async () => Number(await map.getAttribute("data-japan-zoom"))).toBeGreaterThan(1.5);
    await expect(page.locator(".japan-mode")).toHaveAttribute("data-selected-mountain", "");
    for (let i=0;i<4;i++) {
      await touch("touchStart", [{ x:x-100,y,id:1 }]);
      await touch("touchMove", [{ x:x+100,y:y+100,id:1 }]);
      await touch("touchEnd", []);
    }
    const pan = await map.getAttribute("data-pan-x");
    const list = page.locator(".japan-mountain-list"), lb = (await list.boundingBox())!;
    await touch("touchStart", [{ x:200,y:lb.y+lb.height-20,id:1 }]);
    for (let i=1;i<=6;i++) await touch("touchMove", [{ x:200,y:lb.y+lb.height-20-i*25,id:1 }]);
    await touch("touchEnd", []);
    await expect.poll(() => list.evaluate(node=>node.scrollTop)).toBeGreaterThan(30);
    expect(await map.getAttribute("data-pan-x")).toBe(pan);
    expect(await page.evaluate(()=>scrollY)).toBe(0);
    // 地図操作後も日本のいずれかの県が表示領域へ残る。
    expect(await svg.locator(".land").evaluateAll(nodes => nodes.some(node => {
      const a=node.getBoundingClientRect(), b=node.closest("svg")!.getBoundingClientRect();
      return a.right>b.left && a.left<b.right && a.bottom>b.top && a.top<b.bottom;
    }))).toBe(true);
  });
});
