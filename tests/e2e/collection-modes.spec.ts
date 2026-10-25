import { test, expect } from "@playwright/test";
import { enterRoom, position, savedPosition, projectRoomPoint } from "./helpers/room";

async function openMode(page: import('@playwright/test').Page, label: string) {
  await page.getByRole('button', { name: '記録と設定を開く' }).click();
  await page.locator('.room-menu').getByRole('link', { name: label, exact: true }).click();
  await expect(page.getByRole('region', {name: 'コレクションモード'})).toBeVisible();
}
for (const mobile of [false, true]) test(`モード統合・状態保持・カメラ復元 ${mobile ? 'touch' : 'desktop'}`, async ({page}) => {
  await page.setViewportSize(mobile ? {width:390,height:844} : {width:1440,height:900});
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await savedPosition(page, {x:0,z:1,yaw:.3});
  await enterRoom(page);
  const before = await position(page);
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
  await page.getByLabel('県のみ表示').uncheck();
  await page.getByRole('button', {name:'部屋に戻る'}).click();
  await expect(page.getByRole('region', {name:'コレクションモード'})).toBeHidden();
  await expect.poll(async()=> (await position(page)).yaw).toBeCloseTo(before.yaw, 2);
  expect(await page.locator('.room-canvas canvas').evaluate((node, original) => node === original, canvas)).toBe(true);
  await openMode(page, '図鑑端末を開く');
  await page.getByRole('searchbox').fill('25');
  await page.locator('.pokemon-card').click();
  await expect(page.getByRole('dialog')).toContainText('ピカチュウ');
  await page.getByRole('button',{name:'詳細を閉じる'}).click();
  await page.getByRole('button',{name:'部屋に戻る'}).click();
  await openMode(page, '日本地図・百名山を開く');
  await expect(search).toHaveValue('富士山');
  await page.goBack();
  await expect(page.getByRole('region', {name:'コレクションモード'})).toBeHidden();
  await openMode(page, '地球儀を開く');
  await expect(page.getByTestId('globe')).toBeVisible({timeout:30000});
  await page.getByRole('button',{name:'2D 地図',exact:true}).click();
  await expect(page.locator('.collection-modes .land')).toHaveCount(242);
  await page.getByRole('searchbox').fill('日本');
  await page.locator('.mode-scroll:visible .entry').click();
  await expect(page.getByRole('dialog')).toContainText('訪問済み');
  await page.getByRole('button',{name:'詳細を閉じる'}).click();
  await page.screenshot({path:`/tmp/collection-${mobile ? 'mobile':'desktop'}.png`});
  await page.getByRole('button',{name:'部屋に戻る'}).click();
  expect(errors).toEqual([]);
});

test('3D地球儀の実物クリックから起動し部屋を保持', async ({page}) => {
  await savedPosition(page,{x:0,z:-.8,yaw:0});
  await enterRoom(page);
  const point = await projectRoomPoint(page,[0,2.12,-3.05]);
  await page.mouse.click(point.x,point.y);
  await expect(page.getByTestId('globe')).toBeVisible({timeout:30000});
  await page.getByRole('button',{name:'部屋に戻る'}).click();
  await expect(page.locator('.room-canvas canvas')).toBeVisible();
});
