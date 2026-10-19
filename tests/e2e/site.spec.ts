import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import sharp from "sharp";
import { tsImport } from "tsx/esm/api";
import { files } from "../../src/data/model";
async function fixture(page: Page) {
  const texts: Record<string, string> = {
    "訪問した国.txt": "日本,アメリカ,イギリス",
    "訪問した都道府県.txt": "東京都\n埼玉県",
    "登頂した百名山.txt": "富士山\n奥穂高岳",
    "ポケモン_通常色.txt": "1,25",
    "ポケモン_色違い.txt": "25,150",
    "記録_国.txt":
      "日本|2024|test/a.webp,test/b.webp\n日本|2025-04-02|\n日本||",
    "記録_都道府県.txt": "",
    "記録_百名山.txt": "",
    "記録_ポケモン.txt": "25|normal|2024|\n25|shiny|2025-05|",
  };
  await page.route("**/data/*.txt", (route) => {
    const file = decodeURIComponent(
      new URL(route.request().url()).pathname.split("/").at(-1)!,
    );
    return route.fulfill({
      contentType: "text/plain;charset=utf-8",
      body: texts[file] ?? "",
    });
  });
  const image = await sharp({
    create: { width: 640, height: 400, channels: 3, background: "#487b72" },
  })
    .webp()
    .toBuffer();
  await page.route("**/photos/test/*.webp", (route) =>
    route.fulfill({ contentType: "image/webp", body: image }),
  );
}
test("公開TXTの件数が4コレクションのカードと詳細に一致", { tag: "@records" }, async ({ page }) => {
  // Match the Vite/tsx JSON loader used by the app and data validation scripts.
  const { catalogs, sections }: typeof import("../../src/data/catalogs") =
    await tsImport("../../src/data/catalogs.ts", import.meta.url);
  const { parseArchive }: typeof import("../../src/data/parser") =
    await tsImport("../../src/data/parser.ts", import.meta.url);
  const archive = parseArchive(
    Object.fromEntries(
      Object.values(files).map((file) => [
        file,
        readFileSync(new URL(`../../public/data/${file}`, import.meta.url), "utf8"),
      ]),
    ),
  );
  await page.goto("/#/index");
  await expect(page.locator(".card-count strong")).toHaveText(
    sections.map((section) => String(archive.achieved[section].size)),
  );
  await expect(page.locator(".collection-card")).toHaveCount(4);
  await page.screenshot({
    path: "docs/screenshots/index-desktop.png",
    fullPage: true,
    animations: "disabled",
  });
  for (const s of sections) {
    await page.goto("/#/" + s);
    await expect(page.locator(".page-count strong")).toHaveText(
      String(archive.achieved[s].size),
    );
    if (s !== "pokemon") {
      const expected = catalogs[s]
        .filter(
          (entry) =>
            (s !== "world" || entry.hasGeometry) &&
            archive.achieved[s].has(entry.id),
        )
        .map((entry) => entry.id)
        .sort();
      await expect
        .poll(() =>
          page
            .locator(s === "mountains" ? ".mountain-marker.visited" : ".land.visited")
            .evaluateAll((elements) =>
              elements.map((element) => element.getAttribute("data-id")).sort(),
            ),
        )
        .toEqual(expected);
    } else {
      await expect(page.locator(".dex-stats strong")).toHaveText([
        String(archive.normal.size),
        String(archive.shiny.size),
        String([...archive.normal].filter((id) => archive.shiny.has(id)).length),
      ]);
    }
    await expect(page.locator("h1")).toBeVisible();
  }
});
test("TXT更新により2Dの着色・100マーカー・件数が一致", async ({ page }) => {
  await fixture(page);
  await page.goto("/#/world");
  await expect(page.locator(".page-count strong")).toHaveText("3");
  for (const id of ["JPN", "USA", "GBR"])
    await expect(page.locator(`path[data-id="${id}"]`)).toHaveAttribute(
      "data-achieved",
      "true",
    );
  await page.goto("/#/japan");
  await expect(page.locator("path.land")).toHaveCount(47);
  await expect(page.locator("path.visited")).toHaveCount(2);
  await page.goto("/#/mountains");
  await expect(page.locator(".mountain-marker")).toHaveCount(100);
  await expect(page.locator(".mountain-marker.visited")).toHaveCount(2);
  await page.locator('[data-id="m072"]').click();
  await expect(page.getByRole("dialog")).toContainText("富士山");
  await expect(page.getByRole("dialog")).toContainText("登頂済み");
});
test("図鑑は4状態・検索・全件ページング", async ({ page }) => {
  await fixture(page);
  await page.goto("/#/pokemon");
  await expect(page.locator(".page-count strong")).toHaveText("3");
  await expect(page.locator(".dex-stats strong")).toHaveText(["2", "2", "1"]);
  await expect(
    page.getByRole("button", {
      name: "フシギダネ 通常色捕獲済み 色違い未捕獲",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "フシギソウ 通常色未捕獲 色違い未捕獲",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("searchbox").fill("025");
  await expect(page.locator(".pokemon-card")).toHaveCount(1);
  await expect(page.locator(".pokemon-card")).toHaveAccessibleName(
    "ピカチュウ 通常色捕獲済み 色違い捕獲済み",
  );
  await page.getByRole("searchbox").fill("150");
  await expect(page.locator(".pokemon-card")).toHaveAccessibleName(
    "ミュウツー 通常色未捕獲 色違い捕獲済み",
  );
  await page.getByRole("searchbox").fill("1025");
  await expect(page.locator(".pokemon-card")).toContainText("モモワロウ");
  await page.getByRole("searchbox").fill("");
  await page.getByRole("button", { name: "捕獲済み", exact: true }).click();
  await expect(page.locator(".pokemon-card")).toHaveCount(3);
  await page.getByRole("button", { name: "すべて", exact: true }).click();
  await page.getByRole("button", { name: "次へ →" }).click();
  await expect(page.locator(".pokemon-card").first()).toContainText("NO. 0061");
});
test("再訪・任意日付・複数写真・拡大とEscape・フォーカス復帰", async ({
  page,
}) => {
  await fixture(page);
  await page.goto("/#/world");
  await page.getByRole("searchbox").fill("日本");
  const entry = page.locator(".entry");
  await entry.click();
  const panel = page.getByRole("dialog");
  await expect(panel.locator(".record")).toHaveCount(3);
  await expect(panel.locator("time")).toHaveText(["2025年4月2日", "2024年"]);
  await expect(panel.locator(".photo-main img")).toHaveAttribute(
    "src",
    /a.webp$/,
  );
  await panel.getByRole("button", { name: "次の写真" }).click();
  await expect(panel.locator(".photo-main img")).toHaveAttribute(
    "src",
    /b.webp$/,
  );
  await panel.getByRole("button", { name: "日本の写真を拡大" }).click();
  await expect(page.locator(".lightbox")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".lightbox")).toHaveCount(0);
  await expect(panel).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(entry).toBeFocused();
});
test("WebGLが使えない場合も2Dと一覧を維持", async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      type: string,
      ...args: unknown[]
    ) {
      if (type.startsWith("webgl")) return null;
      return original.apply(this, [type, ...args] as Parameters<
        typeof original
      >);
    } as typeof original;
  });
  await page.goto("/#/world");
  await page.getByRole("button", { name: "3D 地球儀" }).click();
  await expect(page.getByRole("status")).toContainText("2D");
  await expect(page.locator(".map-surface")).toBeVisible();
  await expect(page.locator(".entry")).toHaveCount(249);
});
test("3D地球儀を描画、回転・ズームし2Dへ戻れる", async ({ page }) => {
  test.setTimeout(90000);
  await fixture(page);
  await page.goto("/#/world");
  await page.getByRole("button", { name: "3D 地球儀" }).click();
  const canvas = page.locator(".globe canvas");
  await expect(canvas).toBeVisible();
  await page.waitForTimeout(2500);
  const png = await canvas.screenshot();
  const pixels = await sharp(png)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height } = pixels.info;
  let chosen: { x: number; y: number } | undefined;
  const mint = (x: number, y: number) => {
    const i = (y * width + x) * 3;
    const [r, g, b] = pixels.data.subarray(i, i + 3);
    return r > 45 && g > 145 && g > r * 1.35 && b > 100 && b < g * 1.1;
  };
  for (let y = 4; y < height - 4 && !chosen; y++)
    for (let x = 4; x < width - 4; x++)
      if (
        mint(x, y) &&
        mint(x - 2, y) &&
        mint(x + 2, y) &&
        mint(x, y - 2) &&
        mint(x, y + 2)
      ) {
        chosen = { x, y };
        break;
      }
  expect(chosen, "訪問済み国が3Dでも青緑で描かれる").toBeTruthy();
  await canvas.click({ position: chosen! });
  await expect(page.getByRole("dialog")).toContainText("訪問済み");
  await page.getByRole("button", { name: "詳細を閉じる" }).click();
  const box = await canvas.boundingBox();
  expect(box).toBeTruthy();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    box!.x + box!.width / 2 + 100,
    box!.y + box!.height / 2 + 40,
    { steps: 12 },
  );
  await page.mouse.up();
  await page.mouse.wheel(0, -180);
  await expect(page.locator(".page-count strong")).toHaveText("3");
  await page.screenshot({ path: "test-results/globe-fixture.png" });
  await page.getByRole("button", { name: "2D 地図" }).click();
  await expect(page.locator('path[data-id="JPN"]')).toHaveAttribute(
    "data-achieved",
    "true",
  );
});
test("360pxの各画面で横はみ出しなし、ボトムシート操作", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  for (const s of ["", "world", "japan", "mountains", "pokemon"]) {
    await page.goto("/#/" + s);
    await expect(page.locator(s ? ".page-count" : ".room-home")).toBeVisible();
    if (!s)
      await expect(page.locator(".room-home")).toHaveAttribute(
        "data-room-status",
        /^(ready|fallback)$/,
        { timeout: 30000 },
      );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `docs/screenshots/${s || "home"}-mobile.png`,
      fullPage: true,
      animations: "disabled",
    });
  }
  await page.locator(".pokemon-card").first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  const box = await page.getByRole("dialog").boundingBox();
  expect(box!.y).toBeGreaterThan(0);
  await page.getByRole("button", { name: "詳細を閉じる" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
test("公開画面は外部API・画像リクエスト不要、主要画面を撮影", async ({
  page,
}) => {
  const external: string[] = [];
  page.on("request", (r) => {
    if (!r.url().startsWith("http://127.0.0.1") && !r.url().startsWith("data:"))
      external.push(r.url());
  });
  for (const s of ["world", "japan", "mountains", "pokemon"]) {
    await page.goto("/#/" + s);
    await expect(page.locator(`nav a[href="#/${s}"]`)).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(page.locator(".page-count")).toBeVisible();
    await page.screenshot({
      path: `docs/screenshots/${s}-desktop.png`,
      fullPage: true,
      animations: "disabled",
    });
  }
  expect(external).toEqual([]);
});
