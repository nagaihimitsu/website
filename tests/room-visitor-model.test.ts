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
    visitor.animate(1, false); expect(body.position.y).not.toBe(0);
    expect(visitor.group.position.equals(position)).toBe(true);
    expect(visitor.group.quaternion.equals(rotation)).toBe(true);
    visitor.animate(7, true); expect(body.position.y).toBeCloseTo(0, 8); expect(body.rotation.z).toBeCloseTo(0, 8);
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

    target.set(100, 1, 0.1);
    advance(3);
    const extreme = yaw();
    expect(extreme).toBeGreaterThan(0.1);
    // 胴体が回る場合も、首自体は大きくねじれない。
    expect(head.quaternion.angleTo(tilt)).toBeLessThan(Math.PI / 3);
    advance(0.8);
    expect(asset.front.position.y).toBeCloseTo(0, 5); // 追従中も手振りは再生しない。
    expect(yaw()).toBeGreaterThan(0.1);
    visitor.animate(time + 0.1, true, target);
    expect(Math.abs(yaw())).toBeLessThan(0.001);
    expect(head.quaternion.angleTo(new THREE.Quaternion())).toBeLessThan(0.001);
    visitor.animate(time + 1, true, target);
    expect(Math.abs(yaw())).toBeLessThan(0.001);
  });

  it("turns toward a player behind a rotated NPC and returns to the front when no target is supplied", async () => {
    const asset = model();
    const head = new THREE.Bone(); head.name = "head"; head.position.y = 0.8; asset.scene.add(head);
    parse.mockResolvedValue({ ...asset, animations: [] });
    const visitor = create(); await visitor.ready;
    visitor.group.position.set(2, 0, -1);
    visitor.group.rotation.y = Math.PI / 2;
    visitor.group.updateMatrixWorld(true);
    const target = visitor.group.localToWorld(new THREE.Vector3(0.01, 1, -3));
    const yawRelativeToGroup = () => {
      visitor.group.updateMatrixWorld(true);
      const forward = new THREE.Vector3(1, 0, 0).applyQuaternion(head.getWorldQuaternion(new THREE.Quaternion()));
      return Math.atan2(forward.x, forward.z) - visitor.group.rotation.y;
    };
    let time = 0;
    visitor.animate(time, false, target);
    for (let i = 0; i < 8 * 60; i++) visitor.animate(time += 1 / 60, false, target);
    expect(Math.cos(yawRelativeToGroup())).toBeLessThan(-0.95);
    expect(head.quaternion.angleTo(new THREE.Quaternion())).toBeLessThan(Math.PI / 7 + 0.01);

    for (let i = 0; i < 8 * 60; i++) visitor.animate(time += 1 / 60, false);
    expect(Math.cos(yawRelativeToGroup())).toBeGreaterThan(0.99);
    expect(head.quaternion.angleTo(new THREE.Quaternion())).toBeLessThan(0.03);
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
    expect(forwardY()).toBeLessThan(Math.sin(8 * Math.PI / 180) + 0.01);
    target.y = -20;
    advance(2);
    expect(forwardY()).toBeLessThan(-0.09);
    expect(forwardY()).toBeGreaterThan(-Math.sin(8 * Math.PI / 180) - 0.01);
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
