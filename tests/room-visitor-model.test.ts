import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createVisitorModel } from "../src/room/art/visitorModel";

const { parse } = vi.hoisted(() => ({ parse: vi.fn() }));
vi.mock("three/addons/loaders/GLTFLoader.js", () => ({
  GLTFLoader: class {
    setMeshoptDecoder() { return this; }
    parseAsync(...args: unknown[]) { return parse(...args); }
  },
}));
// 旧モデルの造形は専用テストに残し、ここでは非同期の寿命と配置を検証する。
vi.mock("../src/room/art/visitor", async () => {
  const THREE = await import("three");
  return { createVisitor() {
    const group = new THREE.Group(); group.name = "procedural-fallback";
    const geometry = new THREE.BoxGeometry(0.558, 1.2765, 0.409);
    const material = new THREE.MeshBasicMaterial();
    const mesh = new THREE.Mesh(geometry, material); mesh.position.y = 0.63975; group.add(mesh);
    let disposed = false;
    return { group, animate: vi.fn(), dispose() {
      if (disposed) return; disposed = true;
      geometry.dispose(); material.dispose(); group.removeFromParent(); group.clear();
    } };
  } };
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function model() {
  const scene = new THREE.Group();
  const geometry = new THREE.BoxGeometry(0.326, 1, 0.397);
  const image = { close: vi.fn() };
  const texture = new THREE.Texture(); texture.source.data = image;
  const material = new THREE.MeshStandardMaterial({ map: texture, normalMap: texture });
  scene.add(new THREE.Mesh(geometry, material), new THREE.Mesh(geometry, material));
  const front = new THREE.Object3D(); front.name = "source-front"; front.position.x = 0.16; scene.add(front);
  return { scene, front, geometry, texture, material, image };
}

// 実モデルと同じスキンメッシュ。2つのプリミティブが素材と形状を共有する場合も検証する。
function addSkinnedMeshes(asset: ReturnType<typeof model>) {
  for (const child of [...asset.scene.children]) if (child instanceof THREE.Mesh) asset.scene.remove(child);
  const count = asset.geometry.attributes.position.count;
  const skinWeights = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) skinWeights[i * 4] = 1;
  asset.geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(new Uint16Array(count * 4), 4));
  asset.geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute(skinWeights, 4));
  const meshes = [0, 1].map(() => {
    const mesh = new THREE.SkinnedMesh(asset.geometry, asset.material);
    const root = new THREE.Bone();
    mesh.add(root);
    mesh.bind(new THREE.Skeleton([root]));
    asset.scene.add(mesh);
    return mesh;
  });
  return meshes;
}

const visitors: ReturnType<typeof createVisitorModel>[] = [];
function create(onLoaded?: () => void) {
  const visitor = createVisitorModel(onLoaded); visitors.push(visitor); return visitor;
}
beforeEach(() => {
  parse.mockReset();
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => new Response(new ArrayBuffer(8))));
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  visitors.splice(0).forEach((visitor) => visitor.dispose());
  vi.unstubAllGlobals(); vi.restoreAllMocks();
});

describe("provided visitor GLB", () => {
  it("hides the fallback while downloading and decoding, then fits the loaded model without changing collision bounds", async () => {
    const pending = deferred<{ scene: THREE.Group }>(); parse.mockReturnValue(pending.promise);
    const onLoaded = vi.fn(); const visitor = create(onLoaded);
    const bounds = visitor.bounds.clone();
    expect(visitor.group.getObjectByName("procedural-fallback")?.visible).toBe(false);
    expect(bounds.isEmpty()).toBe(false);
    await vi.waitFor(() => expect(parse).toHaveBeenCalledTimes(1));
    expect(visitor.group.getObjectByName("procedural-fallback")?.visible).toBe(false);
    expect(visitor.group.getObjectByName("visitor-imported-model")).toBeUndefined();
    const asset = model(); pending.resolve(asset);
    expect(await visitor.ready).toBe("ready");
    expect(visitor.group.getObjectByName("procedural-fallback")).toBeUndefined();
    const actual = new THREE.Box3().setFromObject(visitor.group);
    expect(actual.min.y).toBeCloseTo(0.0015, 5);
    expect(actual.max.y).toBeCloseTo(1.278, 5);
    expect(visitor.bounds.equals(bounds)).toBe(true);
    expect(bounds.containsBox(actual)).toBe(true);
    expect(asset.front.getWorldPosition(new THREE.Vector3()).z).toBeGreaterThan(0.2);
    expect(onLoaded).toHaveBeenCalledTimes(1);
    expect(visitor.group.userData.modelStatus).toBe("ready");
  });

  it("retains the visible fallback when the asset request fails", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 503 }));
    const onLoaded = vi.fn(); const visitor = create(onLoaded);
    expect(await visitor.ready).toBe("fallback");
    expect(visitor.group.getObjectByName("procedural-fallback")?.visible).toBe(true);
    expect(onLoaded).toHaveBeenCalledTimes(1);
    expect(parse).not.toHaveBeenCalled();
  });

  it("aborts a pending download on exit and never decodes or attaches it afterwards", async () => {
    const pending = deferred<Response>(); vi.mocked(fetch).mockReturnValue(pending.promise);
    const visitor = create(); const signal = vi.mocked(fetch).mock.calls[0][1]!.signal!;
    visitor.dispose(); expect(signal.aborted).toBe(true);
    pending.resolve(new Response(new ArrayBuffer(8)));
    expect(await visitor.ready).toBe("disposed");
    expect(parse).not.toHaveBeenCalled();
    expect(visitor.group.children).toHaveLength(0);
  });

  it("releases late decoded geometry, shared textures and ImageBitmaps once without resurrecting the NPC", async () => {
    const pending = deferred<{ scene: THREE.Group }>(); parse.mockReturnValue(pending.promise);
    const onLoaded = vi.fn(); const visitor = create(onLoaded);
    await vi.waitFor(() => expect(parse).toHaveBeenCalledTimes(1));
    const asset = model();
    const releases = [asset.geometry, asset.material, asset.texture].map((resource) => vi.spyOn(resource, "dispose"));
    visitor.dispose(); pending.resolve(asset);
    expect(await visitor.ready).toBe("disposed"); visitor.dispose();
    releases.forEach((release) => expect(release).toHaveBeenCalledTimes(1));
    expect(asset.image.close).toHaveBeenCalledTimes(1);
    expect(visitor.group.children).toHaveLength(0);
    expect(onLoaded).not.toHaveBeenCalled();
  });

  it("keeps room placement fixed while idling, honors reduced motion and releases a loaded model on exit", async () => {
    const asset = model(); parse.mockResolvedValue(asset);
    const visitor = create(); await visitor.ready;
    const releases = [asset.geometry, asset.material, asset.texture].map((resource) => vi.spyOn(resource, "dispose"));
    visitor.group.position.set(1.85, 0.012, -0.7); visitor.group.rotation.y = -0.2;
    const position = visitor.group.position.clone(); const rotation = visitor.group.quaternion.clone();
    const body = visitor.group.getObjectByName("visitor-model-body")!;
    visitor.animate(1, false); visitor.animate(1.1, false);
    expect(body.position.y).toBe(0);
    expect(body.rotation.z).not.toBe(0);
    expect(body.rotation.x).not.toBe(0);
    expect(visitor.group.position.equals(position)).toBe(true);
    expect(visitor.group.quaternion.equals(rotation)).toBe(true);
    visitor.animate(7, true); expect(body.position.y).toBeCloseTo(0, 8); expect(body.rotation.z).toBeCloseTo(0, 8); expect(body.rotation.x).toBeCloseTo(0, 8);
    visitor.animate(30, false);
    expect(Math.abs(body.rotation.z)).toBeLessThan(0.001);
    expect(Math.abs(body.rotation.x)).toBeLessThan(0.001);
    visitor.dispose(); visitor.dispose(); visitor.animate(10, false);
    expect(body.position.y).toBeCloseTo(0, 8);
    releases.forEach((release) => expect(release).toHaveBeenCalledTimes(1));
    expect(asset.image.close).toHaveBeenCalledTimes(1);
  });

  it("plays idle without playing the wave clip, restores the rest pose for reduced motion, and releases the mixer", async () => {
    const asset = model();
    const idle = new THREE.AnimationClip("idle", 2, [
      new THREE.NumberKeyframeTrack("source-front.position[y]", [0, 2], [0.03, 0.03]),
    ]);
    const wave = new THREE.AnimationClip("wave", 2, [
      new THREE.NumberKeyframeTrack("source-front.position[y]", [0, 1, 2], [0, 0.4, 0]),
    ]);
    parse.mockResolvedValue({ ...asset, animations: [idle, wave] });
    const onVisualChange = vi.fn();
    const uncache = vi.spyOn(THREE.AnimationMixer.prototype, "uncacheRoot");
    const visitor = create(onVisualChange); await visitor.ready;

    // 以前の手振りが何度か再生される時間を通して、待機姿勢を維持する。
    for (let i = 0; i <= 350; i++) {
      visitor.animate(i / 10, false);
      expect(asset.front.position.y).toBeCloseTo(0.03, 2);
    }

    visitor.animate(35.1, true);
    expect(asset.front.position.y).toBeCloseTo(0, 5);
    const notifications = onVisualChange.mock.calls.length;
    visitor.animate(35.2, true);
    expect(asset.front.position.y).toBeCloseTo(0, 5);
    expect(onVisualChange).toHaveBeenCalledTimes(notifications);
    visitor.animate(35.3, false); visitor.animate(35.4, false);
    expect(asset.front.position.y).toBeCloseTo(0.03, 2);

    visitor.dispose(); visitor.dispose();
    expect(asset.front.position.y).toBeCloseTo(0, 5);
    expect(uncache).toHaveBeenCalledTimes(1);
    expect(uncache).toHaveBeenCalledWith(asset.scene);
  });

  it("animates expression morphs across meshes and resets them for reduced motion", async () => {
    const asset = model();
    const meshes = addSkinnedMeshes(asset);
    const blinkTexture = new THREE.Texture<HTMLImageElement>();
    const blinkDispose = vi.spyOn(blinkTexture, "dispose");
    vi.spyOn(THREE.TextureLoader.prototype, "load").mockImplementation((_url, onLoad) => {
      queueMicrotask(() => onLoad?.(blinkTexture));
      return blinkTexture;
    });
    const vertexCount = asset.geometry.attributes.position.count;
    asset.geometry.morphTargetsRelative = true;
    asset.geometry.morphAttributes.position = ["Mouth", "breath", "Blink", "Skirt"].map((name) => {
      const attribute = new THREE.Float32BufferAttribute(new Float32Array(vertexCount * 3), 3);
      attribute.name = name;
      return attribute;
    });
    meshes.forEach((mesh) => mesh.updateMorphTargets());
    parse.mockResolvedValue({ ...asset, animations: [] });
    const onVisualChange = vi.fn();
    const visitor = create(onVisualChange); await visitor.ready;
    const shader = {
      uniforms: {} as Record<string, { value: unknown }>,
      vertexShader: "#include <begin_vertex>\n#include <skinnormal_vertex>",
      fragmentShader: "#include <map_fragment>\n#include <normal_fragment_maps>\n#include <roughnessmap_fragment>",
    };
    asset.material.onBeforeCompile(shader as unknown as Parameters<typeof asset.material.onBeforeCompile>[0], {} as THREE.WebGLRenderer);
    expect(shader.uniforms.visitorBlinkImage.value).toBe(blinkTexture);
    expect(shader.uniforms.visitorBlinkPhase.value).toBe(0);
    expect(shader.uniforms.visitorMouthPhase.value).toBe(0);
    expect(meshes[0].geometry).not.toBe(asset.geometry);
    expect(meshes[1].geometry).toBe(meshes[0].geometry);
    const temporaryGeometry = meshes[0].geometry;
    const temporaryDispose = vi.spyOn(temporaryGeometry, "dispose");
    const maxima = [0, 0, 0, 0];
    let skirtMinimum = 0;
    const blinkSamples = new Map<number, number>();
    visitor.animate(0, false);
    for (let step = 1; step <= 220; step++) {
      visitor.animate(step / 20, false);
      const values = meshes[0].morphTargetInfluences!;
      expect(meshes[1].morphTargetInfluences).toEqual(values);
      expect(shader.uniforms.visitorBlinkPhase.value).toBe(values[2]);
      expect(shader.uniforms.visitorMouthPhase.value).toBe(values[0]);
      if ([40, 52, 80, 144, 180].includes(step)) blinkSamples.set(step, values[2]);
      values.forEach((value, i) => {
        expect(value).toBeGreaterThanOrEqual(i === 3 ? -1 : 0);
        expect(value).toBeLessThanOrEqual(1);
        maxima[i] = Math.max(maxima[i], value);
        if (i === 3) skirtMinimum = Math.min(skirtMinimum, value);
      });
    }
    expect(maxima[0]).toBeGreaterThan(0.5);
    expect(maxima[1]).toBeGreaterThan(0.9);
    expect(maxima[2]).toBeGreaterThan(0.8);
    expect(maxima[3]).toBeGreaterThan(0.7);
    expect(skirtMinimum).toBeLessThan(-0.7);
    expect(blinkSamples.get(40)).toBe(0);
    expect(blinkSamples.get(52)).toBeGreaterThan(0.8);
    expect(blinkSamples.get(80)).toBe(0);
    expect(blinkSamples.get(144)).toBeGreaterThan(0.8);
    expect(blinkSamples.get(180)).toBe(0);
    visitor.animate(11.05, true);
    expect(meshes[0].morphTargetInfluences).toEqual([0, 0, 0, 0]);
    expect(meshes[1].morphTargetInfluences).toEqual([0, 0, 0, 0]);
    expect(shader.uniforms.visitorBlinkPhase.value).toBe(0);
    expect(shader.uniforms.visitorMouthPhase.value).toBe(0);
    const notifications = onVisualChange.mock.calls.length;
    visitor.animate(11.1, true);
    expect(meshes[0].morphTargetInfluences).toEqual([0, 0, 0, 0]);
    expect(onVisualChange).toHaveBeenCalledTimes(notifications);
    visitor.animate(11.15, false);
    expect(meshes[0].morphTargetInfluences![0]).toBe(0);
    expect(meshes[0].morphTargetInfluences![1]).toBeLessThan(0.01);
    expect(meshes[0].morphTargetInfluences![2]).toBe(0);
    expect(Math.abs(meshes[0].morphTargetInfluences![3])).toBeLessThan(0.01);
    visitor.dispose(); visitor.dispose();
    expect(blinkDispose).toHaveBeenCalledTimes(1);
    expect(temporaryDispose).toHaveBeenCalledTimes(1);
    expect(shader.uniforms.visitorBlinkPhase.value).toBe(0);
    expect(shader.uniforms.visitorMouthPhase.value).toBe(0);
  });

  it("keeps eyes and mouth open while the shared image is unavailable, and releases late resources", async () => {
    const asset = model();
    const meshes = addSkinnedMeshes(asset);
    const count = asset.geometry.attributes.position.count;
    asset.geometry.morphTargetsRelative = true;
    const blink = new THREE.Float32BufferAttribute(new Float32Array(count * 3), 3); blink.name = "blink";
    const mouth = new THREE.Float32BufferAttribute(new Float32Array(count * 3), 3); mouth.name = "mouth";
    asset.geometry.morphAttributes.position = [blink, mouth];
    meshes.forEach((mesh) => mesh.updateMorphTargets());
    const image = new THREE.Texture<HTMLImageElement>();
    const imageDispose = vi.spyOn(image, "dispose");
    let finish: ((texture: THREE.Texture<HTMLImageElement>) => void) | undefined;
    let fail: ((event: unknown) => void) | undefined;
    vi.spyOn(THREE.TextureLoader.prototype, "load").mockImplementation((_url, onLoad, _progress, onError) => {
      finish = onLoad;
      fail = onError;
      return image;
    });
    parse.mockResolvedValue({ ...asset, animations: [] });
    const visualChange = vi.fn();
    const originalCompile = asset.material.onBeforeCompile;
    const originalCacheKey = asset.material.customProgramCacheKey;
    const visitor = create(visualChange); await visitor.ready;
    const clone = meshes[0].geometry;
    expect(clone).not.toBe(asset.geometry);
    const cloneDispose = vi.spyOn(clone, "dispose");
    for (let i = 0; i <= 60; i++) visitor.animate(i / 20, false);
    expect(meshes[0].morphTargetInfluences).toEqual([0, 0]);
    expect(meshes[1].morphTargetInfluences).toEqual([0, 0]);
    fail?.(new Error("image unavailable"));
    expect(visitor.group.userData.modelStatus).toBe("ready");
    for (let i = 61; i <= 145; i++) visitor.animate(i / 20, false);
    expect(meshes[0].morphTargetInfluences).toEqual([0, 0]);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("blink image"));
    visitor.dispose();
    const countBeforeLateLoad = visualChange.mock.calls.length;
    finish?.(image);
    expect(imageDispose).toHaveBeenCalledTimes(1);
    expect(cloneDispose).toHaveBeenCalledTimes(1);
    expect(meshes[0].geometry).toBe(asset.geometry);
    expect(meshes[1].geometry).toBe(asset.geometry);
    expect(asset.material.onBeforeCompile).toBe(originalCompile);
    expect(asset.material.customProgramCacheKey).toBe(originalCacheKey);
    expect(visualChange).toHaveBeenCalledTimes(countBeforeLateLoad);
  });

  it("smoothly looks toward the player within a limited angle while preserving idle and reduced-motion poses", async () => {
    const asset = model();
    const head = new THREE.Bone(); head.name = "head"; head.position.y = 0.8; asset.scene.add(head);
    // 待機クリップ自身も頭を傾ける。追従でクリップの姿勢が消えないことを確かめる。
    const tilt = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.035);
    const idle = new THREE.AnimationClip("idle", 2, [
      new THREE.QuaternionKeyframeTrack("head.quaternion", [0, 2], [...tilt.toArray(), ...tilt.toArray()]),
    ]);
    const wave = new THREE.AnimationClip("wave", 2, [
      new THREE.QuaternionKeyframeTrack("head.quaternion", [0, 2], [...tilt.toArray(), ...tilt.toArray()]),
      new THREE.NumberKeyframeTrack("source-front.position[y]", [0, 1, 2], [0, 0.4, 0]),
    ]);
    parse.mockResolvedValue({ ...asset, animations: [idle, wave] });
    const visitor = create(); await visitor.ready;
    const target = new THREE.Vector3(0, 1, 3);
    // 元GLBの正面は +X。配置後は +Z を向くため、世界座標の水平角で比較する。
    const yaw = () => {
      visitor.group.updateMatrixWorld(true);
      const forward = new THREE.Vector3(1, 0, 0).applyQuaternion(head.getWorldQuaternion(new THREE.Quaternion()));
      return Math.atan2(forward.x, forward.z);
    };
    let time = 0;
    const advance = (seconds: number) => {
      for (let i = 0; i < seconds * 60; i++) { time += 1 / 60; visitor.animate(time, false, target); }
    };
    visitor.animate(time, false, target);
    advance(1);
    expect(Math.abs(yaw())).toBeLessThan(0.08);
    expect(head.quaternion.angleTo(new THREE.Quaternion())).toBeGreaterThan(0.02);

    target.set(3, 1, 3);
    advance(1 / 60);
    const firstStep = yaw();
    advance(2);
    const right = yaw();
    expect(right).toBeGreaterThan(0.1);
    expect(firstStep).toBeGreaterThanOrEqual(0);
    expect(firstStep).toBeLessThan(right * 0.5);

    target.set(-3, 1, 3);
    advance(2);
    const left = yaw();
    expect(left).toBeLessThan(-0.1);

    // 真横は視界の外。頭が滑らかに正面へ戻り、胴体は回らない。
    target.set(100, 1, 0.1);
    advance(3);
    expect(Math.abs(yaw())).toBeLessThan(0.02);
    expect(visitor.group.getObjectByName("visitor-model-body")!.rotation.y).toBeCloseTo(0, 8);
    expect(head.quaternion.angleTo(tilt)).toBeLessThan(0.3);
    advance(0.8);
    expect(asset.front.position.y).toBeCloseTo(0, 5); // 追従中も手振りは再生しない。
    target.set(3, 1, 3);
    advance(2);
    expect(yaw()).toBeGreaterThan(0.1);
    visitor.animate(time + 0.1, true, target);
    expect(Math.abs(yaw())).toBeLessThan(0.001);
    expect(head.quaternion.angleTo(new THREE.Quaternion())).toBeLessThan(0.001);
    visitor.animate(time + 1, true, target);
    expect(Math.abs(yaw())).toBeLessThan(0.001);
  });

  it("keeps the body still and returns the head to front when the player is behind a rotated NPC", async () => {
    const asset = model();
    const head = new THREE.Bone(); head.name = "head"; head.position.y = 0.8; asset.scene.add(head);
    parse.mockResolvedValue({ ...asset, animations: [] });
    const visitor = create(); await visitor.ready;
    visitor.group.position.set(2, 0, -1);
    visitor.group.rotation.y = Math.PI / 2;
    visitor.group.updateMatrixWorld(true);
    const body = visitor.group.getObjectByName("visitor-model-body")!;
    const target = visitor.group.localToWorld(new THREE.Vector3(2, 1.045, 3));
    const yawRelativeToGroup = () => {
      visitor.group.updateMatrixWorld(true);
      const forward = new THREE.Vector3(1, 0, 0).applyQuaternion(head.getWorldQuaternion(new THREE.Quaternion()));
      return Math.atan2(Math.sin(Math.atan2(forward.x, forward.z) - visitor.group.rotation.y),
        Math.cos(Math.atan2(forward.x, forward.z) - visitor.group.rotation.y));
    };
    let time = 0;
    visitor.animate(time, false, target);
    for (let i = 0; i < 3 * 60; i++) {
      visitor.animate(time += 1 / 60, false, target);
      expect(body.rotation.y).toBeCloseTo(0, 8);
    }
    expect(yawRelativeToGroup()).toBeGreaterThan(0.1);
    expect(yawRelativeToGroup()).toBeLessThan(0.3);

    target.copy(visitor.group.localToWorld(new THREE.Vector3(0.01, 1.045, -3)));
    const previous = yawRelativeToGroup();
    visitor.animate(time += 1 / 60, false, target);
    expect(yawRelativeToGroup()).toBeGreaterThan(0); // 飛び戻らず徐々に戻る。
    expect(yawRelativeToGroup()).toBeLessThan(previous);
    for (let i = 0; i < 5 * 60; i++) {
      visitor.animate(time += 1 / 60, false, target);
      expect(body.rotation.y).toBeCloseTo(0, 8);
    }
    expect(Math.abs(yawRelativeToGroup())).toBeLessThan(0.02);
    expect(head.quaternion.angleTo(new THREE.Quaternion())).toBeLessThan(0.03);
    target.copy(visitor.group.localToWorld(new THREE.Vector3(-2, 1.045, 3)));
    for (let i = 0; i < 3 * 60; i++) visitor.animate(time += 1 / 60, false, target);
    expect(yawRelativeToGroup()).toBeLessThan(-0.1);
    for (let i = 0; i < 5 * 60; i++) visitor.animate(time += 1 / 60, false);
    expect(Math.abs(yawRelativeToGroup())).toBeLessThan(0.02);
    expect(body.rotation.y).toBeCloseTo(0, 8);
  });

  it("smoothly fades attention at the edge of the field of view and bounds the neck rotation", async () => {
    const asset = model();
    const head = new THREE.Bone(); head.name = "head"; head.position.y = 0.8; asset.scene.add(head);
    parse.mockResolvedValue({ ...asset, animations: [] });
    const visitor = create(); await visitor.ready;
    const body = visitor.group.getObjectByName("visitor-model-body")!;
    const target = new THREE.Vector3();
    let time = 0;
    const settleAt = (degrees: number) => {
      const angle = THREE.MathUtils.degToRad(degrees);
      target.set(Math.sin(angle) * 3, 1.045, Math.cos(angle) * 3);
      for (let i = 0; i < 5 * 60; i++) {
        visitor.animate(time += 1 / 60, false, target);
        expect(body.rotation.y).toBeCloseTo(0, 8);
      }
      visitor.group.updateMatrixWorld(true);
      const forward = new THREE.Vector3(1, 0, 0).applyQuaternion(head.getWorldQuaternion(new THREE.Quaternion()));
      return Math.atan2(forward.x, forward.z);
    };
    const inside = settleAt(35);
    const edge = settleAt(55);
    const outside = settleAt(75);
    const behind = settleAt(180);
    expect(inside).toBeGreaterThan(0.1);
    expect(inside).toBeLessThan(0.3);
    expect(edge).toBeGreaterThan(0.02);
    expect(edge).toBeLessThan(inside);
    expect(Math.abs(outside)).toBeLessThan(0.02);
    expect(Math.abs(behind)).toBeLessThan(0.02);
  });

  it("looks up and down toward the player's eye height within the neck limit and returns to rest for reduced motion", async () => {
    const asset = model();
    const head = new THREE.Bone(); head.name = "head"; head.position.y = 0.8; asset.scene.add(head);
    parse.mockResolvedValue({ ...asset, animations: [] });
    const visitor = create(); await visitor.ready;
    const target = new THREE.Vector3(0, 1.045, 3);
    const forwardY = () => {
      visitor.group.updateMatrixWorld(true);
      return new THREE.Vector3(1, 0, 0).applyQuaternion(head.getWorldQuaternion(new THREE.Quaternion())).y;
    };
    let time = 0;
    visitor.animate(time, false, target);
    const advance = (seconds: number) => {
      for (let i = 0; i < seconds * 60; i++) visitor.animate(time += 1 / 60, false, target);
    };
    advance(1);
    expect(Math.abs(forwardY())).toBeLessThan(0.01);
    target.y = 20;
    advance(2);
    expect(forwardY()).toBeGreaterThan(0.09);
    expect(forwardY()).toBeLessThan(Math.sin(6 * Math.PI / 180) + 0.01);
    target.y = -20;
    advance(2);
    expect(forwardY()).toBeLessThan(-0.09);
    expect(forwardY()).toBeGreaterThan(-Math.sin(6 * Math.PI / 180) - 0.01);
    visitor.animate(time + 0.1, true, target);
    expect(Math.abs(forwardY())).toBeLessThan(0.001);
    expect(head.quaternion.angleTo(new THREE.Quaternion())).toBeLessThan(0.001);
    visitor.animate(time + 1, true, target);
    expect(Math.abs(forwardY())).toBeLessThan(0.001);
  });

  it("releases a skeleton shared by multiple skinned meshes once", async () => {
    const scene = new THREE.Group();
    const geometry = new THREE.BoxGeometry(0.326, 1, 0.397);
    const vertices = geometry.getAttribute("position").count;
    geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(new Uint16Array(vertices * 4), 4));
    const weights = new Float32Array(vertices * 4);
    for (let i = 0; i < vertices; i++) weights[i * 4] = 1;
    geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute(weights, 4));
    const material = new THREE.MeshBasicMaterial();
    const bone = new THREE.Bone();
    const skeleton = new THREE.Skeleton([bone]);
    const first = new THREE.SkinnedMesh(geometry, material);
    const second = new THREE.SkinnedMesh(geometry, material);
    first.bind(skeleton); second.bind(skeleton);
    scene.add(bone, first, second);
    const releaseSkeleton = vi.spyOn(skeleton, "dispose");
    parse.mockResolvedValue({ scene, animations: [] });
    const visitor = create();
    expect(await visitor.ready).toBe("ready");
    visitor.dispose(); visitor.dispose();
    expect(releaseSkeleton).toHaveBeenCalledTimes(1);
  });
});
