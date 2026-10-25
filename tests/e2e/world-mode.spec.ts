import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
const metadata: Record<string, { point: number[] }> = JSON.parse(readFileSync(new URL("../../src/catalogs/world-view.json", import.meta.url), "utf8"));

async function fixture(page: Page) {
  await page.route('**/data/*.txt', route => route.fulfill({contentType:'text/plain;charset=utf-8', body: decodeURIComponent(route.request().url()).endsWith('/訪問した国.txt') ? '日本\nイギリス\nアメリカ\nフィジー' : ''}));
}
async function open(page: Page) {
  await fixture(page);
  await page.goto('/#/room/world');
  await expect(page.locator('.world-globe')).toHaveAttribute('data-world-ready','true',{timeout:30000});
}
async function centered(page: Page, id: keyof typeof metadata) {
  const [lng,lat] = metadata[id].point;
  await expect.poll(async()=>Number(await page.locator('.world-globe').getAttribute('data-view-lat')),{timeout:5000}).toBeCloseTo(lat,0);
  await expect.poll(async()=> {
    const current = Number(await page.locator('.world-globe').getAttribute('data-view-lng'));
    return ((current-lng+540)%360)-180;
  }).toBeCloseTo(0,0);
  await expect(page.locator(`.world-country-label[data-country-id="${id}"]`)).toBeVisible();
}
for (const mobile of [false,true]) test.describe(mobile?'WORLD touch':'WORLD desktop',()=>{
  test.use({viewport:mobile?{width:390,height:844}:{width:1440,height:900},hasTouch:mobile,isMobile:mobile});
  test('固定表示・地域一覧・最新選択・リセット・復帰',async({page})=>{
    const errors:string[]=[]; page.on('pageerror',error=>errors.push(error.message));
    await open(page);
    await expect(page.locator('.page-count strong')).toHaveText('4');
    await expect(page.getByRole('button',{name:'訪問済み',exact:true})).toHaveAttribute('aria-pressed','true');
    const timeOrigin=await page.evaluate(()=>performance.timeOrigin);
    const globe=page.locator('.world-viewport');const bounds=await globe.boundingBox();
    await page.locator('.country-row[data-country-id="GBR"]').click();
    await centered(page,'GBR');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.locator('.country-row[data-country-id="JPN"]').click();
    await page.locator('.country-row[data-country-id="FJI"]').click();
    await centered(page,'FJI');
    await expect(page.locator('.country-row[aria-pressed="true"]')).toHaveAttribute('data-country-id','FJI');
    await page.getByRole('button',{name:'すべて',exact:true}).click();
    const list=page.locator('.world-country-list');
    await list.evaluate(node=>{node.scrollTop=node.scrollHeight;});
    expect((await list.evaluate(node=>Math.abs(node.scrollHeight-node.scrollTop-node.clientHeight)))).toBeLessThanOrEqual(2);
    const after=await globe.boundingBox();expect(after?.y).toBeCloseTo(bounds!.y,1);expect(after?.height).toBeCloseTo(bounds!.height,1);
    expect(await page.evaluate(()=>document.documentElement.scrollHeight-innerHeight)).toBeLessThanOrEqual(1);
    await page.getByRole('searchbox',{name:'国名を検索'}).fill('Japan');
    await page.getByRole('button',{name:'表示リセット',exact:true}).click();
    await expect(page.locator('.world-mode')).toHaveAttribute('data-selected-country','');
    await expect(page.locator('.world-country-label')).toHaveCount(0);
    await expect(page.getByRole('searchbox')).toHaveValue('Japan');
    await expect.poll(async()=>Number(await page.locator('.world-globe').getAttribute('data-view-altitude'))).toBeCloseTo(2.1,1);
    expect(await page.evaluate(()=>performance.timeOrigin)).toBe(timeOrigin);
    await page.screenshot({path:`/tmp/world-mode-${mobile?'mobile':'desktop'}.png`});
    await page.getByRole('button',{name:'部屋に戻る'}).click();
    await expect(page.locator('.collection-modes')).toBeHidden();
    expect(errors).toEqual([]);
  });
});
test('2D逆連動は一覧だけを展開・スクロールし、3Dへ選択を引き継ぐ',async({page})=>{
  await open(page);
  await page.getByRole('button',{name:'2D 地図',exact:true}).click();
  await page.getByRole('button',{name:/北アメリカ.*件/}).click();
  await page.getByRole('searchbox').fill('イギリス');
  const before=await page.locator('.world-viewport').boundingBox();
  await page.locator('.world-mode .land[data-id="CAN"]').press('Enter');
  await expect(page.getByRole('searchbox')).toHaveValue('');
  await expect(page.getByRole('button',{name:'すべて',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('.country-row[aria-pressed="true"]')).toHaveAttribute('data-country-id','CAN');
  await expect(page.locator('.world-map-label text')).toHaveText('カナダ');
  await expect(page.locator('.world-mode .land.selected-land')).toHaveAttribute('data-id','CAN');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect.poll(()=>page.locator('.country-row[data-country-id="CAN"]').evaluate(node=>{
    const row=node.getBoundingClientRect(), list=node.closest('.world-country-list')!.getBoundingClientRect();return row.top>=list.top && row.bottom<=list.bottom;
  })).toBe(true);
  expect((await page.locator('.world-viewport').boundingBox())?.y).toBeCloseTo(before!.y,1);
  await page.getByRole('button',{name:'3D 地球儀',exact:true}).click();
  await centered(page,'CAN');
});
test('地球儀の実クリック・ドラッグ・ホイール',async({page})=>{
  await open(page);
  await page.locator('.country-row[data-country-id="GBR"]').click();
  await centered(page,'GBR');
  const canvas=page.locator('.world-globe canvas');const bounds=(await canvas.boundingBox())!;
  await page.getByRole("searchbox").fill("Japan");
  await canvas.click({position:{x:bounds.width/2,y:bounds.height/2}});
  await expect(page.getByRole("searchbox")).toHaveValue("");
  await expect(page.locator(".country-row[aria-pressed=true]")).toHaveAttribute("data-country-id", "GBR");
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const before=Number(await page.locator('.world-globe').getAttribute('data-view-lng'));
  await page.mouse.move(bounds.x+bounds.width*.5,bounds.y+bounds.height*.55);await page.mouse.down();await page.mouse.move(bounds.x+bounds.width*.5+80,bounds.y+bounds.height*.55+20,{steps:8});await page.mouse.up();
  await expect.poll(async()=>Math.abs(Number(await page.locator('.world-globe').getAttribute('data-view-lng'))-before)).toBeGreaterThan(3);
  await expect(page.locator(".world-mode")).toHaveAttribute("data-selected-country", "GBR");
  const altitude=Number(await page.locator('.world-globe').getAttribute('data-view-altitude'));
  await page.mouse.wheel(0,-180);
  await expect.poll(async()=>Number(await page.locator('.world-globe').getAttribute('data-view-altitude'))).toBeLessThan(altitude);
  await page.getByRole('searchbox').fill('イギリス');await page.locator('.country-row[data-country-id="GBR"]').click();await centered(page,'GBR');
});
test.describe('WORLD pinch',()=>{
 test.use({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 test('実タッチのピンチと回転が一覧・ページを動かさない',async({page,context})=>{
  await open(page);const cdp=await context.newCDPSession(page);const bounds=(await page.locator('.world-globe canvas').boundingBox())!;
  const cx=bounds.x+bounds.width/2,cy=bounds.y+bounds.height/2;
  const before=Number(await page.locator('.world-globe').getAttribute('data-view-altitude'));
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:cx-25,y:cy,id:1},{x:cx+25,y:cy,id:2}]});
  for(let n=1;n<=6;n++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:cx-25-n*8,y:cy,id:1},{x:cx+25+n*8,y:cy,id:2}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await expect.poll(async()=>Number(await page.locator('.world-globe').getAttribute('data-view-altitude'))).toBeLessThan(before-.1);
  expect(await page.evaluate(()=>window.scrollY)).toBe(0);
  expect(await page.locator('.world-country-list').evaluate(node=>node.scrollTop)).toBe(0);
  const globeLng=Number(await page.locator('.world-globe').getAttribute('data-view-lng'));
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:cx,y:cy,id:3}]});
  for(let n=1;n<=6;n++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:cx+n*10,y:cy,id:3}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await expect.poll(async()=>Math.abs(Number(await page.locator('.world-globe').getAttribute('data-view-lng'))-globeLng)).toBeGreaterThan(2);
  expect(await page.locator('.world-country-list').evaluate(node=>node.scrollTop)).toBe(0);
  const region=(await page.locator('.world-country-list').boundingBox())!;
  const globeBeforeList=Number(await page.locator('.world-globe').getAttribute('data-view-lng'));
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:region.x+100,y:region.y+region.height-25,id:4}]});
  for(let n=1;n<=6;n++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:region.x+100,y:region.y+region.height-25-n*25,id:4}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await expect.poll(()=>page.locator('.world-country-list').evaluate(node=>node.scrollTop)).toBeGreaterThan(20);
  expect(Number(await page.locator('.world-globe').getAttribute('data-view-lng'))).toBeCloseTo(globeBeforeList,1);
  expect(await page.evaluate(()=>window.scrollY)).toBe(0);
  await expect(page.locator('.world-mode')).toHaveAttribute('data-selected-country','');
  await cdp.detach();
 });
});
