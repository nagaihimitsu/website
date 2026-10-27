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
});
