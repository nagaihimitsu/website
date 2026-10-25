import { test, expect } from "@playwright/test";
import { enterRoom, position, savedPosition, projectRoomPoint } from "./helpers/room";

async function openMode(page: import('@playwright/test').Page, label: string) {
  await page.getByRole('button', { name: '記録と設定を開く' }).click();
  await page.locator('.room-menu').getByRole('link', { name: label, exact: true }).click();
  // 500msのカメラ補間をソフトウェアWebGLでも描画し終えるまで待つ。
  await expect(page.getByRole('region', {name: 'コレクションモード'})).toBeVisible({timeout:15000});
}
for (const mobile of [false, true]) test.describe(mobile ? "touch" : "desktop", () => {
  test.use({ viewport: mobile ? {width:390,height:844} : {width:1440,height:900}, hasTouch: mobile, isMobile: mobile });
  test(`モード統合・状態保持・カメラ復元 ${mobile ? 'touch' : 'desktop'}`, async ({page}) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await savedPosition(page, {x:0,z:1,yaw:.3});
  await enterRoom(page);
  const before = await position(page);
  const timeOrigin = await page.evaluate(() => performance.timeOrigin);
  const canvas = await page.locator('.room-canvas canvas').elementHandle();
  await openMode(page, '日本地図・百名山を開く');
  await expect(page.locator('.collection-modes .mountain-marker')).toHaveCount(100);
  await expect(page.locator('.collection-modes .land')).toHaveCount(47);
  await expect(page.locator('.collection-modes .land.visited')).toHaveCount(35);
  const search = page.getByRole('searchbox', {name:'名前を検索'});
  await search.fill('富士山');
  await page.locator('.collection-modes .entry').click();
  await expect(page.getByRole('dialog')).toContainText('富士山');
  await expect(page.getByRole('dialog')).toContainText('3,776');
  await page.getByRole('button', {name:'詳細を閉じる'}).click();
  await expect(page.locator('.entry[aria-pressed="true"]')).toContainText('富士山');
  if (mobile) {
    await page.getByRole('button', {name:'最大',exact:true}).click();
    await expect(page.locator('.integrated-japan')).toHaveAttribute('data-sheet','max');
  }
  await page.getByLabel('県のみ表示').check();
  await expect(page.locator('.collection-modes .mountain-marker')).toHaveCount(0);
  await expect(page.locator('.mode-scroll:visible .entry')).toHaveCount(47);
  await page.getByRole('button', {name:'訪問済み',exact:true}).click();
  await expect(page.locator('.mode-scroll:visible .entry')).toHaveCount(35);
  await page.getByLabel('県の訪問色').uncheck();
  await expect(page.locator('.collection-modes .land.visited')).toHaveCount(0);
  await expect(page.locator('.collection-modes .land[data-achieved="true"]')).toHaveCount(35);
  await page.getByLabel('県の訪問色').check();
  await page.getByLabel('県のみ表示').uncheck();
  const japanView = await page.locator('.mode-scroll:visible .map-surface > svg > g').getAttribute('transform');
  await page.getByRole('button', {name:'部屋に戻る'}).click();
  await expect(page.getByRole('region', {name:'コレクションモード'})).toBeHidden();
  await expect.poll(async()=> (await position(page)).yaw).toBeCloseTo(before.yaw, 2);
  const restored = await position(page);
  for (const key of ["x", "z", "pitch", "cameraX", "cameraY", "cameraZ"] as const) expect(restored[key]).toBeCloseTo(before[key], 2);
  expect(await page.evaluate(() => performance.timeOrigin)).toBe(timeOrigin);
  expect(await page.locator('.room-canvas canvas').evaluate((node, original) => node === original, canvas)).toBe(true);
  await openMode(page, '図鑑端末を開く');
  await page.getByRole('searchbox').fill('25');
  await page.locator('.pokemon-card').click();
  await expect(page.getByRole('dialog')).toContainText('ピカチュウ');
  await page.getByRole('button',{name:'詳細を閉じる'}).click();
  await page.getByRole('button',{name:'部屋に戻る'}).click();
  await openMode(page, '日本地図・百名山を開く');
  await expect(search).toHaveValue('富士山');
  await expect(page.locator('.mode-scroll:visible .map-surface > svg > g')).toHaveAttribute('transform', japanView!);
  await page.goBack();
  await expect(page.getByRole('region', {name:'コレクションモード'})).toBeHidden();
  await page.goForward();
  await expect(page.locator('.collection-modes')).toBeVisible();
  await expect(search).toHaveValue('富士山');
  await page.getByRole('button', {name:'部屋に戻る'}).click();
  await expect(page.locator('.collection-modes')).toBeHidden();
  await openMode(page, '地球儀を開く');
  await expect(page.getByTestId('globe')).toBeVisible({timeout:30000});
  await page.getByRole('button',{name:'2D 地図',exact:true}).click();
  await expect(page.locator('.collection-modes .land')).toHaveCount(250);
  await page.getByRole('searchbox').fill('日本');
  await page.locator('.mode-scroll:visible .entry').click();
  await expect(page.locator('.world-selection')).toContainText('訪問済み');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.screenshot({path:`/tmp/collection-${mobile ? 'mobile':'desktop'}.png`});
  await page.getByRole('button',{name:'部屋に戻る'}).click();
  await expect(page.locator('canvas')).toHaveCount(1);
  expect(errors).toEqual([]);
});
});

test('3D地球儀の実物クリックから起動し部屋を保持', async ({page}) => {
  await savedPosition(page,{x:0,z:-.8,yaw:0});
  await enterRoom(page);
  const point = await projectRoomPoint(page,[-0.8,2.12,-3.05]);
  await page.mouse.click(point.x,point.y);
  await expect(page.getByTestId('globe')).toBeVisible({timeout:30000});
  await page.getByRole('button',{name:'部屋に戻る'}).click();
  await expect(page.locator('.room-canvas canvas')).toBeVisible();
});

test('日本模型の実物クリックと地図・一覧の連動', async ({page}) => {
  await savedPosition(page, {x:3.1,z:1.8,yaw:-.5,pitch:.4});
  await enterRoom(page);
  const point = await projectRoomPoint(page, [4.15,1.72,.05]);
  await page.mouse.click(point.x,point.y);
  await expect(page.locator('.integrated-japan')).toBeVisible({timeout:15000});
  const map = page.locator('.mode-scroll:visible .map-surface > svg');
  const view = await map.locator(':scope > g').getAttribute('transform');
  await map.hover();
  // Playwright may scroll the map into view before placing the mouse.
  const scroll = await page.locator('.mode-scroll:visible').evaluate(node => node.scrollTop);
  await page.mouse.wheel(0, -100);
  await expect(map.locator(':scope > g')).not.toHaveAttribute('transform', view!);
  expect(await page.locator('.mode-scroll:visible').evaluate(node => node.scrollTop)).toBe(scroll);
  const marker = page.locator('.mountain-marker[data-id="m072"]');
  await marker.press('Enter');
  await expect(page.getByRole('dialog')).toContainText('富士山');
  await page.getByRole('button',{name:'詳細を閉じる'}).click();
  await expect(page.locator('.entry[aria-pressed="true"]')).toContainText('富士山');
  await page.screenshot({path:'/tmp/japan-mode-desktop.png'});
});

test('モードの直URLから戻るとURLもホームへ復帰', async ({page}) => {
  await page.goto('/#/room/pokemon');
  await expect(page.locator('.pokemon-grid')).toBeVisible();
  await page.getByRole('button',{name:'部屋に戻る'}).click();
  await expect(page).toHaveURL(/#\/$/);
  await expect(page.locator('.collection-modes')).toBeHidden();
});
