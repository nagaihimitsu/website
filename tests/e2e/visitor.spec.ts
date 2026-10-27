import { test, expect } from "@playwright/test";
import { collectPageErrors, enterRoom, position, savedPosition } from "./helpers/room";

test("実モデルは体を回さず正面の主人公へ控えめに顔を向ける", { tag: "@npc" }, async ({ page }) => {
  await page.goto("/scripts/visitor-model-study.html?view=front");
  await page.waitForFunction(() => document.body.dataset.ready === "true");
  const result = await page.evaluate(async () => {
    const threePath = "/node_modules/.vite/deps/three.js";
    const THREE = await import(threePath) as typeof import("three");
    const { visitor } = (window as unknown as { visitorStudy: { visitor: ReturnType<typeof import("../../src/room/art/visitorModel").createVisitorModel> } }).visitorStudy;
    const head = visitor.group.getObjectByName("head");
    if (!head) throw new Error("GLBに頭のボーンがありません");
    const target = new THREE.Vector3();
    const allowed = visitor.bounds.clone().expandByScalar(0.018);
    const arm = visitor.group.getObjectByName("forearm");
    if (!arm) throw new Error("GLBに前腕のボーンがありません");
    const hand = visitor.group.getObjectByName("hand");
    if (!hand) throw new Error("GLBに手のボーンがありません");
    const armRest = arm.quaternion.clone();
    const handRest = hand.quaternion.clone();
    const angles: number[] = [];
    const outside: number[] = [];
    const body = visitor.group.getObjectByName("visitor-model-body")!;
    let greatestBodyYaw = 0;
    let time = 0;
    for (let direction = 0; direction < 8; direction++) {
      const angle = direction * Math.PI / 4;
      target.set(Math.sin(angle) * 3, 1, Math.cos(angle) * 3);
      for (let step = 0; step < 360; step++) {
        visitor.animate(time += 1 / 60, false, target);
        greatestBodyYaw = Math.max(greatestBodyYaw, Math.abs(body.rotation.y));
      }
      visitor.group.updateMatrixWorld(true);
      const front = new THREE.Vector3(1, 0, 0).applyQuaternion(head.getWorldQuaternion(new THREE.Quaternion())).setY(0).normalize();
      angles.push(Math.atan2(front.x, front.z));
      if (!allowed.containsBox(new THREE.Box3().setFromObject(visitor.group, true))) outside.push(direction);
    }
    let armAngle = 0;
    let handAngle = 0;
    for (let step = 1; step <= 140; step++) {
      visitor.animate(time += 0.1, false, target);
      armAngle = Math.max(armAngle, armRest.angleTo(arm.quaternion));
      handAngle = Math.max(handAngle, handRest.angleTo(hand.quaternion));
      if (step % 10 !== 0) continue;
      visitor.group.updateMatrixWorld(true);
      if (!allowed.containsBox(new THREE.Box3().setFromObject(visitor.group, true))) outside.push(8 + step);
    }
    return { angles, outside, armAngle, handAngle, greatestBodyYaw };
  });
  expect(Math.abs(result.angles[0])).toBeLessThan(0.03);
  expect(result.angles[1]).toBeGreaterThan(0.1);
  expect(result.angles[1]).toBeLessThan(0.27);
  for (const angle of result.angles.slice(2, 7)) expect(Math.abs(angle)).toBeLessThan(0.03);
  expect(result.angles[7]).toBeLessThan(-0.1);
  expect(result.angles[7]).toBeGreaterThan(-0.27);
  expect(result.greatestBodyYaw).toBeLessThan(0.00001);
  expect(result.armAngle).toBeLessThan(0.001);
  expect(result.handAngle).toBeLessThan(0.001);
  expect(result.outside).toEqual([]);

  // 部屋の更新経路からも、実際の主人公の位置がNPCに渡されることを確認する。
  const roomDirection = await page.evaluate(async () => {
    const threePath = "/node_modules/.vite/deps/three.js";
    const scenePath = "/src/room/roomScene.ts";
    const parserPath = "/src/data/parser.ts";
    const THREE = await import(threePath) as typeof import("three");
    const { createRoomScene } = await import(scenePath) as typeof import("../../src/room/roomScene");
    const { loadArchive } = await import(parserPath) as typeof import("../../src/data/parser");
    const room = createRoomScene(await loadArchive());
    try {
      const npc = room.scene.getObjectByName("room-visitor")!;
      for (let retry = 0; npc.userData.modelStatus === "loading" && retry < 600; retry++)
        await new Promise((resolve) => setTimeout(resolve, 50));
      if (npc.userData.modelStatus !== "ready") throw new Error("NPC GLBの読み込みに失敗しました");
      const head = npc.getObjectByName("head");
      if (!head) throw new Error("GLBに頭のボーンがありません");
      npc.updateWorldMatrix(true, false);
      const target = npc.localToWorld(new THREE.Vector3(1.5, 0, 3));
      room.avatar.position.set(target.x, 0, target.z);
      for (let step = 0; step <= 360; step++) room.animate(step / 60, false, false);
      room.scene.updateMatrixWorld(true);
      const front = new THREE.Vector3(1, 0, 0).applyQuaternion(head.getWorldQuaternion(new THREE.Quaternion()));
      const vertical = front.y;
      const yaw = Math.atan2(front.x, front.z) - npc.rotation.y;
      return { angle: Math.atan2(Math.sin(yaw), Math.cos(yaw)), vertical };
    } finally {
      room.dispose();
    }
  });
  expect(roomDirection.angle).toBeGreaterThan(0.1);
  expect(roomDirection.angle).toBeLessThan(0.27);
  expect(roomDirection.vertical).toBeLessThan(-0.03);
  expect(roomDirection.vertical).toBeGreaterThan(-0.2);
});

test("実モデルの手は待機中に動かず、動作抑制で元の姿勢へ戻り、衝突範囲に収まる", { tag: "@npc" }, async ({ page }) => {
  await page.goto("/scripts/visitor-model-study.html?view=front");
  await page.waitForFunction(() => document.body.dataset.ready === "true");
  const result = await page.evaluate(async () => {
    const threePath = "/node_modules/.vite/deps/three.js";
    const THREE = await import(threePath) as typeof import("three");
    const { visitor } = (window as unknown as { visitorStudy: { visitor: ReturnType<typeof import("../../src/room/art/visitorModel").createVisitorModel> } }).visitorStudy;
    const arm = visitor.group.getObjectByName("forearm");
    if (!arm) throw new Error("GLBに前腕のボーンがありません");
    const hand = visitor.group.getObjectByName("hand");
    if (!hand) throw new Error("GLBに手のボーンがありません");
    const head = visitor.group.getObjectByName("head");
    if (!head) throw new Error("GLBに頭のボーンがありません");
    const rest = arm.quaternion.clone();
    const handRest = hand.quaternion.clone();
    const headRest = head.quaternion.clone();
    const allowed = visitor.bounds.clone().expandByScalar(0.018);
    const samples = new Set([0, 50, 83, 87, 92, 110]);
    const boxes: { time: number; contained: boolean; min: number[]; max: number[] }[] = [];
    let greatestArmAngle = 0;
    let greatestHandAngle = 0;
    let greatestHeadAngle = 0;
    for (let step = 0; step <= 350; step++) {
      const time = step / 10;
      visitor.animate(time, false);
      greatestArmAngle = Math.max(greatestArmAngle, rest.angleTo(arm.quaternion));
      greatestHandAngle = Math.max(greatestHandAngle, handRest.angleTo(hand.quaternion));
      greatestHeadAngle = Math.max(greatestHeadAngle, headRest.angleTo(head.quaternion));
      if (!samples.has(step)) continue;
      visitor.group.updateMatrixWorld(true);
      // SkinnedMesh の変形後の頂点から境界を求める（静的なキャッシュを使わない）。
      const box = new THREE.Box3().setFromObject(visitor.group, true);
      boxes.push({ time, contained: allowed.containsBox(box), min: box.min.toArray(), max: box.max.toArray() });
    }
    visitor.animate(35.1, true);
    const stoppedAngle = rest.angleTo(arm.quaternion);
    const stopped = arm.quaternion.clone();
    visitor.animate(36, true);
    return { status: visitor.group.userData.modelStatus, greatestArmAngle, greatestHandAngle, greatestHeadAngle, stoppedAngle, stillAngle: stopped.angleTo(arm.quaternion), boxes };
  });
  expect(result.status).toBe("ready");
  expect(result.greatestArmAngle).toBeLessThan(0.001);
  expect(result.greatestHandAngle).toBeLessThan(0.001);
  expect(result.greatestHeadAngle).toBeGreaterThan(0.02);
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
