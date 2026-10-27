import { test, expect } from "@playwright/test";
import { collectPageErrors, enterRoom, position, savedPosition } from "./helpers/room";

test("UV整理モデルは色と凹凸にそれぞれ対応するUVを使う", { tag: "@npc" }, async ({ page }) => {
  const errors = collectPageErrors(page);
  await page.goto("/scripts/visitor-model-study.html?view=front");
  await page.waitForFunction(() => document.body.dataset.ready === "true");
  const result = await page.evaluate(async () => {
    const threePath = "/node_modules/.vite/deps/three.js";
    const THREE = await import(threePath) as typeof import("three");
    const { visitor } = (window as unknown as { visitorStudy: { visitor: ReturnType<typeof import("../../src/room/art/visitorModel").createVisitorModel> } }).visitorStudy;
    const meshes: {
      uv: boolean; uv1: boolean; color: boolean; vertexColors: boolean;
      map: number | null; size: number[] | null; normal: number | null;
      roughness: number | null; metalness: number | null; morphs: string[];
    }[] = [];
    visitor.group.traverse((object) => {
      if (!(object instanceof THREE.SkinnedMesh) || Array.isArray(object.material)
        || !(object.material instanceof THREE.MeshStandardMaterial)) return;
      const mat = object.material;
      const image = mat.map?.image as { width?: number; height?: number } | undefined;
      meshes.push({
        uv: !!object.geometry.getAttribute("uv"), uv1: !!object.geometry.getAttribute("uv1"),
        color: !!object.geometry.getAttribute("color"), vertexColors: mat.vertexColors,
        map: mat.map?.channel ?? null, size: image ? [image.width ?? 0, image.height ?? 0] : null,
        normal: mat.normalMap?.channel ?? null, roughness: mat.roughnessMap?.channel ?? null,
        metalness: mat.metalnessMap?.channel ?? null,
        morphs: Object.keys(object.morphTargetDictionary ?? {}).map((name) => name.toLowerCase()),
      });
    });
    return {
      status: visitor.group.userData.modelStatus,
      head: visitor.group.getObjectByName("head") instanceof THREE.Bone,
      root: visitor.group.getObjectByName("root") instanceof THREE.Bone,
      meshes,
    };
  });
  expect(result.status).toBe("ready");
  expect(result.head && result.root).toBe(true);
  expect(result.meshes).toHaveLength(7);
  for (const mesh of result.meshes) {
    // 色は新UVへ焼き付け済み。頂点色を再乗算せず、画像を新UVで読む。
    expect(mesh.uv && mesh.uv1).toBe(true);
    expect(mesh.color || mesh.vertexColors).toBe(false);
    expect(mesh.map).toBe(1);
    expect(mesh.size).toEqual([4096, 4096]);
    expect(mesh.morphs).toEqual(expect.arrayContaining(["mouth", "breath", "blink", "skirt"]));
    // 凹凸・質感は旧UVのまま保持する。
    for (const channel of [mesh.normal, mesh.roughness, mesh.metalness])
      if (channel !== null) expect(channel).toBe(0);
  }
  expect(result.meshes.some((mesh) => mesh.normal === 0 && mesh.roughness === 0 && mesh.metalness === 0)).toBe(true);
  expect(errors).toEqual([]);
});

test("実モデルのまばたき・口パク・呼吸・裾が動き、動作抑制で元に戻る", { tag: "@npc" }, async ({ page }) => {
  const shaderErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && /WebGLProgram|shader error/i.test(message.text())) shaderErrors.push(message.text());
  });
  const errors = collectPageErrors(page);
  await page.goto("/scripts/visitor-model-study.html?view=front&focus=face");
  await page.waitForFunction(() => document.body.dataset.ready === "true");
  const result = await page.evaluate(async () => {
    const threePath = "/node_modules/.vite/deps/three.js";
    const THREE = await import(threePath) as typeof import("three");
    const { visitor } = (window as unknown as { visitorStudy: { visitor: ReturnType<typeof import("../../src/room/art/visitorModel").createVisitorModel> } }).visitorStudy;
    const meshes: import("three").Mesh[] = [];
    visitor.group.traverse((object) => {
      if (object instanceof THREE.Mesh && object.morphTargetDictionary && object.morphTargetInfluences) meshes.push(object);
    });
    const names = ["mouth", "breath", "blink", "skirt"] as const;
    const maxima = Object.fromEntries(names.map((name) => [name, 0]));
    const mouthSamples = new Map<number, number>();
    let skirtMinimum = 0;
    const maxDelta = Object.fromEntries(names.map((name) => [name, 0]));
    const bindings = names.map((name) => meshes.flatMap((mesh) => {
      const entry = Object.entries(mesh.morphTargetDictionary!).find(([key]) => key.toLowerCase() === name);
      if (!entry) return [];
      const morph = mesh.geometry.morphAttributes.position?.[entry[1]];
      if (morph) for (let i = 0; i < morph.count; i++) {
        maxDelta[name] = Math.max(maxDelta[name], Math.hypot(morph.getX(i), morph.getY(i), morph.getZ(i)));
      }
      return [{ mesh, index: entry[1] }];
    }));
    visitor.animate(0, false);
    for (let step = 1; step <= 220; step++) {
      visitor.animate(step / 20, false);
      names.forEach((name, i) => {
        for (const { mesh, index } of bindings[i]) {
          const value = mesh.morphTargetInfluences![index];
          maxima[name] = Math.max(maxima[name], value);
          if (name === "skirt") skirtMinimum = Math.min(skirtMinimum, value);
        }
      });
      const mouth = bindings[0][0];
      if (mouth && [20, 42, 48, 56, 66, 100].includes(step)) {
        mouthSamples.set(step, mouth.mesh.morphTargetInfluences![mouth.index]);
      }
    }
    visitor.animate(11.05, true);
    const stopped = bindings.map((group) => group.map(({ mesh, index }) => mesh.morphTargetInfluences![index]));
    visitor.animate(12, true);
    const still = bindings.map((group) => group.map(({ mesh, index }) => mesh.morphTargetInfluences![index]));
    return { counts: bindings.map((group) => group.length), maxima, maxDelta, skirtMinimum, stopped, still, mouthSamples: Object.fromEntries(mouthSamples) };
  });
  expect(result.counts.every((count) => count > 0)).toBe(true);
  expect(result.maxima.mouth).toBeGreaterThan(0.5);
  expect(result.mouthSamples[20]).toBe(0); // 開いている状態
  expect(result.mouthSamples[42]).toBeGreaterThan(0); // 閉じ始め
  expect(result.mouthSamples[48]).toBeGreaterThan(0.99); // 閉じた状態
  expect(result.mouthSamples[56]).toBeGreaterThan(0.9); // 開き始め
  expect(result.mouthSamples[66]).toBe(0); // 再び開く
  expect(result.maxima.breath).toBeGreaterThan(0.9);
  expect(result.maxima.blink).toBeGreaterThan(0.8);
  expect(result.maxima.skirt).toBeGreaterThan(0.7);
  expect(result.skirtMinimum).toBeLessThan(-0.7);
  for (const name of ["mouth", "breath", "blink", "skirt"] as const) expect(result.maxDelta[name]).toBeGreaterThan(0.00001);
  expect(result.stopped.flat().every((value) => value === 0)).toBe(true);
  expect(result.still).toEqual(result.stopped);
  expect(shaderErrors).toEqual([]);
  expect(errors).toEqual([]);
});

test("表情画像の取得に失敗してもモデルを表示し、目と口を開いたままにする", { tag: "@npc" }, async ({ page }) => {
  let markAborted!: () => void;
  const aborted = new Promise<void>((resolve) => { markAborted = resolve; });
  // Viteの?importモジュールは通し、画像としての取得のみを失敗させる。
  await page.route("**/visitor-blink-reference.png**", (route) => {
    if (route.request().resourceType() !== "image") return route.continue();
    markAborted();
    return route.abort();
  });
  const errors = collectPageErrors(page);
  await page.goto("/scripts/visitor-model-study.html?view=front&focus=face");
  await page.waitForFunction(() => document.body.dataset.ready === "true");
  await aborted;
  const result = await page.evaluate(async () => {
    const threePath = "/node_modules/.vite/deps/three.js";
    const THREE = await import(threePath) as typeof import("three");
    const { visitor } = (window as unknown as { visitorStudy: { visitor: ReturnType<typeof import("../../src/room/art/visitorModel").createVisitorModel> } }).visitorStudy;
    let maximum = 0;
    let mouthMaximum = 0;
    visitor.animate(0, false);
    for (let i = 1; i <= 400; i++) {
      visitor.animate(i / 100, false);
      visitor.group.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        const index = Object.entries(object.morphTargetDictionary ?? {}).find(([name]) => name.toLowerCase() === "blink")?.[1];
        if (index !== undefined && object.morphTargetInfluences) maximum = Math.max(maximum, object.morphTargetInfluences[index]);
        const mouth = Object.entries(object.morphTargetDictionary ?? {}).find(([name]) => name.toLowerCase() === "mouth")?.[1];
        if (mouth !== undefined && object.morphTargetInfluences) mouthMaximum = Math.max(mouthMaximum, object.morphTargetInfluences[mouth]);
      });
    }
    return { status: visitor.group.userData.modelStatus, maximum, mouthMaximum };
  });
  expect(result.status).toBe("ready");
  expect(result.maximum).toBe(0);
  expect(result.mouthMaximum).toBe(0);
  expect(errors).toEqual([]);
});

test("視線追従中も口と顎の頂点が頭と一緒に動く", { tag: "@npc" }, async ({ page }) => {
  await page.goto("/scripts/visitor-model-study.html?view=front&focus=face");
  await page.waitForFunction(() => document.body.dataset.ready === "true");
  const result = await page.evaluate(async () => {
    const threePath = "/node_modules/.vite/deps/three.js";
    const THREE = await import(threePath) as typeof import("three");
    const { visitor } = (window as unknown as { visitorStudy: { visitor: ReturnType<typeof import("../../src/room/art/visitorModel").createVisitorModel> } }).visitorStudy;
    const head = visitor.group.getObjectByName("head");
    if (!head) throw new Error("GLBに頭のボーンがありません");
    let mesh: import("three").SkinnedMesh | undefined;
    visitor.group.traverse((object) => {
      if (object instanceof THREE.SkinnedMesh && (!mesh || object.geometry.attributes.position.count > mesh.geometry.attributes.position.count)) mesh = object;
    });
    if (!mesh) throw new Error("GLBに顔を含むスキンメッシュがありません");
    const face = mesh as import("three").SkinnedMesh;
    const positions = face.geometry.attributes.position;
    const indices: number[] = [];
    // このGLBのデコード後座標。顔前面中央の口・顎を含み、首と髪を避ける。
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
      if (x > 0.14 && x < 0.20 && y > 0.51 && y < 0.57 && Math.abs(z) < 0.07) indices.push(i);
    }
    if (indices.length < 100) throw new Error("口・顎の頂点範囲を検出できません");
    const vertex = new THREE.Vector3();
    const headInverse = new THREE.Matrix4();
    const relativeVertices = (blink = 0) => {
      // 口パクなどの表情を両時点で同じにし、頭の回転だけによる追従を比較する。
      visitor.group.traverse((object) => {
        if (object instanceof THREE.Mesh && object.morphTargetInfluences) {
          object.morphTargetInfluences.fill(0);
          const blinkIndex = Object.entries(object.morphTargetDictionary ?? {})
            .find(([key]) => key.toLowerCase() === "blink")?.[1];
          if (blinkIndex !== undefined) object.morphTargetInfluences[blinkIndex] = blink;
        }
      });
      visitor.group.updateMatrixWorld(true);
      headInverse.copy(head.matrixWorld).invert();
      return indices.map((index) => face.getVertexPosition(index, vertex).applyMatrix4(face.matrixWorld).applyMatrix4(headInverse).clone());
    };
    visitor.animate(0, true);
    const rest = relativeVertices();
    // 目を閉じても、前回修正した口・顎の形と位置を変えない。
    const closedMouth = relativeVertices(1);
    let blinkMouthDrift = 0;
    for (let i = 0; i < rest.length; i++) blinkMouthDrift = Math.max(blinkMouthDrift, rest[i].distanceTo(closedMouth[i]));
    const headRest = head.quaternion.clone();
    let time = 0;
    let greatestDrift = 0;
    let greatestTurn = 0;
    for (const x of [-2, 2]) {
      const target = new THREE.Vector3(x, 0.4, 3);
      for (let step = 0; step < 360; step++) visitor.animate(time += 1 / 60, false, target);
      greatestTurn = Math.max(greatestTurn, headRest.angleTo(head.quaternion));
      const posed = relativeVertices();
      for (let i = 0; i < rest.length; i++) greatestDrift = Math.max(greatestDrift, rest[i].distanceTo(posed[i]));
    }
    return { count: indices.length, greatestDrift, greatestTurn, blinkMouthDrift };
  });
  expect(result.count).toBeGreaterThan(100);
  expect(result.greatestTurn).toBeGreaterThan(0.1);
  expect(result.greatestDrift).toBeLessThan(0.00001);
  // 保守的に選んだ口周辺504頂点のうち、実際の口の横外側の1点のみが
  // 量子化したInt16の2刻み分動く（頭座標で約0.0000305）。
  expect(result.blinkMouthDrift).toBeLessThan(0.00004);
});

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
