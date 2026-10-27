import { test, expect } from "@playwright/test";
import { collectPageErrors, enterRoom, position, savedPosition } from "./helpers/room";

test("実モデルが手を振り、動作抑制で元の姿勢へ戻り、衝突範囲に収まる", { tag: "@npc" }, async ({ page }) => {
  await page.goto("/scripts/visitor-model-study.html?view=front");
  await page.waitForFunction(() => document.body.dataset.ready === "true");
  const result = await page.evaluate(async () => {
    const threePath = "/node_modules/.vite/deps/three.js";
    const THREE = await import(threePath) as typeof import("three");
    const { visitor } = (window as unknown as { visitorStudy: { visitor: ReturnType<typeof import("../../src/room/art/visitorModel").createVisitorModel> } }).visitorStudy;
    const arm = visitor.group.getObjectByName("forearm");
    if (!arm) throw new Error("GLBに前腕のボーンがありません");
    const rest = arm.quaternion.clone();
    const allowed = visitor.bounds.clone().expandByScalar(0.018);
    const samples = new Set([0, 50, 83, 87, 92, 110]);
    const boxes: { time: number; contained: boolean; min: number[]; max: number[] }[] = [];
    let greatestArmAngle = 0;
    for (let step = 0; step <= 110; step++) {
      const time = step / 10;
      visitor.animate(time, false);
      if (!samples.has(step)) continue;
      visitor.group.updateMatrixWorld(true);
      // SkinnedMesh の変形後の頂点から境界を求める（静的なキャッシュを使わない）。
      const box = new THREE.Box3().setFromObject(visitor.group, true);
      boxes.push({ time, contained: allowed.containsBox(box), min: box.min.toArray(), max: box.max.toArray() });
      if (time >= 8) greatestArmAngle = Math.max(greatestArmAngle, rest.angleTo(arm.quaternion));
    }
    visitor.animate(11.1, true);
    const stoppedAngle = rest.angleTo(arm.quaternion);
    const stopped = arm.quaternion.clone();
    visitor.animate(12, true);
    return { status: visitor.group.userData.modelStatus, greatestArmAngle, stoppedAngle, stillAngle: stopped.angleTo(arm.quaternion), boxes };
  });
  expect(result.status).toBe("ready");
  expect(result.greatestArmAngle).toBeGreaterThan(0.05);
  expect(result.stoppedAngle).toBeLessThan(0.001);
  expect(result.stillAngle).toBeLessThan(0.001);
  expect(result.boxes.filter((box) => !box.contained)).toEqual([]);
});

test("女の子NPCの読み込み中は旧モデルを表示せず、完了後にGLBを表示する", { tag: "@npc" }, async ({ page }) => {
  await page.route("**/visitor-loading-check", (route) => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>NPC loading</title>" }));
  await page.goto("/visitor-loading-check");
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route(/\/visitor\.glb(?:\?.*)?$/, async (route) => {
    if (route.request().resourceType() !== "fetch") return route.continue();
    await gate;
    await route.continue();
  });
  const requested = page.waitForRequest((request) => /\/visitor\.glb(?:\?.*)?$/.test(request.url()) && request.resourceType() === "fetch");
  try {
    const loading = await page.evaluate(async () => {
      const modelPath = "/src/room/art/visitorModel.ts";
      const { createVisitorModel } = await import(modelPath) as typeof import("../../src/room/art/visitorModel");
      const visitor = createVisitorModel();
      (window as unknown as { loadingVisitor: typeof visitor }).loadingVisitor = visitor;
      return { status: visitor.group.userData.modelStatus };
    });
    await requested;
    expect(loading.status).toBe("loading");
    // body の子である旧NPCを確認し、ダウンロード中に表示されないことを保証する。
    const oldVisible = await page.evaluate(() => {
      const visitor = (window as unknown as { loadingVisitor: ReturnType<typeof import("../../src/room/art/visitorModel").createVisitorModel> }).loadingVisitor;
      return visitor.group.getObjectByName("visitor-model-body")?.children[0]?.visible;
    });
    expect(oldVisible).toBe(false);
    release();
    const loaded = await page.evaluate(async () => {
      const visitor = (window as unknown as { loadingVisitor: ReturnType<typeof import("../../src/room/art/visitorModel").createVisitorModel> }).loadingVisitor;
      const status = await visitor.ready;
      const imported = visitor.group.getObjectByName("visitor-imported-model")?.visible;
      const old = visitor.group.getObjectByName("visitor-body");
      visitor.dispose();
      return { status, imported, hasOld: Boolean(old) };
    });
    expect(loaded).toEqual({ status: "ready", imported: true, hasOld: false });
  } finally {
    release();
  }
});

test("女の子NPCをすり抜けず、パンチ・小物の復元でも消えない", { tag: "@npc" }, async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await savedPosition(page, { x: 1.85, z: 0.30, yaw: 0 });
  const errors = collectPageErrors(page);
  const room = await enterRoom(page);
  // 本番と同じシーンの可視形状・衝突体・破壊登録を調べる。新たな診断用DOMは追加しない。
  const visitor = await page.evaluate(async () => {
    const scenePath = "/src/room/roomScene.ts";
    const parserPath = "/src/data/parser.ts";
    const { createRoomScene } = await import(scenePath) as typeof import("../../src/room/roomScene");
    const { loadArchive } = await import(parserPath) as typeof import("../../src/data/parser");
    const scene = createRoomScene(await loadArchive());
    try {
      const object = scene.scene.getObjectByName("room-visitor")!;
      const collider = scene.obstacles.find((obstacle) => obstacle.id === "room-visitor")!;
      const canBreak = scene.breakables.some((prop) => prop.object === object);
      scene.resetObjects();
      return { collider, canBreak, visible: object.visible, attached: object.parent === scene.scene };
    } finally {
      scene.dispose();
    }
  });
  expect(visitor.visible && visitor.attached).toBe(true);
  expect(visitor.canBreak).toBe(false);
  const front = visitor.collider.z + visitor.collider.depth / 2;
  await page.keyboard.down("ArrowUp");
  try {
    await expect.poll(async () => (await position(page)).z).toBeLessThan(0.20);
    await expect.poll(async () => (await position(page)).z).toBeLessThan(front + 0.25);
    await page.waitForTimeout(400);
  } finally {
    await page.keyboard.up("ArrowUp");
  }
  const stopped = await position(page);
  expect(stopped.z - front).toBeGreaterThanOrEqual(0.219);
  expect(stopped.z - front).toBeLessThan(0.25);
  await page.keyboard.press("KeyF");
  await expect(room).toHaveAttribute("data-punching", "true");
  await expect(room).toHaveAttribute("data-punching", "false");
  await expect(room).toHaveAttribute("data-broken-count", "0");
  await page.locator(".room-menu-toggle").click();
  await page.getByRole("button", { name: "小物を元に戻す" }).click();
  await expect(page.locator(".room-menu")).toBeHidden();
  await expect(room).toHaveAttribute("data-room-status", "ready");
  await page.keyboard.down("ArrowUp");
  await page.waitForTimeout(350);
  await page.keyboard.up("ArrowUp");
  expect((await position(page)).z - front).toBeGreaterThanOrEqual(0.219);
  expect(errors).toEqual([]);
});

test("追加NPCと重なる古い保存位置から安全な初期位置へ戻れる", { tag: "@npc" }, async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await savedPosition(page, { x: 1.85, z: -0.70, yaw: 0 });
  const errors = collectPageErrors(page);
  await enterRoom(page);
  const player = await position(page);
  expect(player.x).toBeCloseTo(0.95, 2);
  expect(player.z).toBeCloseTo(-0.45, 2);
  expect(errors).toEqual([]);
});
