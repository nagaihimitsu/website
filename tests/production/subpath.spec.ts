import { test, expect } from "@playwright/test";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import sharp from "sharp";
test("本番ビルドを /website/ 配下から読み込み、TXT・写真・ハッシュ再読み込みが動く", async ({
  page,
}) => {
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
  await page.goto("http://127.0.0.1:4174/website/#/world");
  await expect(page.locator(".page-count strong")).toHaveText("1");
  await page.reload();
  await expect(page.locator(".page-count strong")).toHaveText("1");
  await page.getByRole("searchbox").fill("日本");
  await page.locator(".entry").click();
  const image = page.locator(".photo-main img");
  await expect(image).toHaveAttribute("src", "/website/photos/test/image.webp");
  await expect(image).toBeVisible();
  expect(
    await image.evaluate(
      (i: HTMLImageElement) => i.complete && i.naturalWidth === 64,
    ),
  ).toBe(true);
  expect(failed).toEqual([]);
  // Ensure production sources remain empty.
  expect(await readFile("public/data/訪問した国.txt", "utf8")).not.toMatch(
    /^日本$/m,
  );
});
