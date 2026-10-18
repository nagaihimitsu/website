import { afterEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { createBreakables } from "../src/room/art/breakables";

const cleanups: Array<() => void> = [];
const direction = new THREE.Vector3(1, 0, -1);

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function fixture(count = 1, supportY = 0.02) {
  const scene = new THREE.Scene();
  const helper = createBreakables(scene);
  const originals = Array.from({ length: count }, (_, index) => {
    const object = new THREE.Mesh(
      new THREE.BoxGeometry(0.3, 0.5, 0.3),
      new THREE.MeshStandardMaterial({ color: "#d3c7ae" }),
    );
    object.position.set(0, supportY + 0.25, 0);
    scene.add(object);
    helper.register(`prop-${index}`, object, ["#c9b493", "#ddd2bd"], supportY);
    return object;
  });
  cleanups.push(() => {
    helper.dispose();
    for (const object of originals) {
      object.geometry.dispose();
      object.material.dispose();
    }
    scene.clear();
  });
  const groups = () =>
    scene.children.filter((child) => child.name.startsWith("fragments:"));
  const breakProp = (index = 0) =>
    helper.breakObject(`prop-${index}`, direction);
  return { scene, helper, originals, groups, breakProp };
}

function observeResources(root: THREE.Object3D) {
  const resources = new Set<THREE.BufferGeometry | THREE.Material>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    resources.add(object.geometry);
    for (const material of Array.isArray(object.material)
      ? object.material
      : [object.material]) {
      resources.add(material);
    }
  });
  return [...resources].map((resource) => {
    const disposed = vi.fn();
    resource.addEventListener("dispose", disposed);
    return disposed;
  });
}

describe("room breakable fragments", () => {
  it("expires after two real seconds even at two frames per second", () => {
    const { helper, groups, originals, breakProp } = fixture();
    expect(breakProp()).toBe(true);
    const disposals = observeResources(groups()[0]);
    for (let frame = 0; frame < 3; frame++) helper.animate(0.5, false);
    expect(groups()).toHaveLength(1);
    helper.animate(0.5, false);
    expect(groups()).toHaveLength(0);
    expect(helper.brokenCount).toBe(1);
    expect(originals[0].visible).toBe(false);
    for (const disposed of disposals) expect(disposed).toHaveBeenCalledTimes(1);
  });

  it("fades before expiry, then releases its shared resources only once", () => {
    const { helper, groups, breakProp } = fixture();
    breakProp();
    const group = groups()[0];
    const disposals = observeResources(group);
    helper.animate(1.8, false);
    expect(groups()).toHaveLength(1);
    for (const child of group.children) {
      const mesh = child as THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
      expect(mesh.material.opacity).toBeGreaterThan(0);
      expect(mesh.material.opacity).toBeLessThan(1);
    }
    helper.animate(0.2, false);
    helper.resetObjects();
    helper.dispose();
    helper.dispose();
    expect(groups()).toHaveLength(0);
    for (const disposed of disposals) expect(disposed).toHaveBeenCalledTimes(1);
  });

  it("repeated resets restore props and free fragments without disposing original assets", () => {
    const { scene, helper, originals, groups, breakProp } = fixture();
    const originalDisposals = observeResources(originals[0]);
    for (let cycle = 0; cycle < 10; cycle++) {
      expect(breakProp()).toBe(true);
      expect(helper.brokenCount).toBe(1);
      const disposals = observeResources(groups()[0]);
      helper.animate(0.3, false);
      helper.resetObjects();
      expect(helper.brokenCount).toBe(0);
      expect(originals[0].visible).toBe(true);
      expect(scene.children).toEqual(originals);
      for (const disposed of disposals)
        expect(disposed).toHaveBeenCalledTimes(1);
    }
    helper.dispose();
    for (const disposed of originalDisposals)
      expect(disposed).not.toHaveBeenCalled();
  });

  it("bounds simultaneous debris to five batches and disposes evicted batches", () => {
    const { helper, groups, breakProp, originals } = fixture(9);
    const disposalBatches: ReturnType<typeof observeResources>[] = [];
    for (let index = 0; index < originals.length; index++) {
      breakProp(index);
      const batch = groups().find(
        (group) => group.name === `fragments:prop-${index}`,
      )!;
      disposalBatches.push(observeResources(batch));
      expect(groups().length).toBeLessThanOrEqual(5);
      expect(
        groups().reduce((sum, group) => sum + group.children.length, 0),
      ).toBeLessThan(100);
    }
    expect(groups()).toHaveLength(5);
    expect(helper.brokenCount).toBe(9);
    for (let index = 0; index < disposalBatches.length; index++) {
      for (const disposed of disposalBatches[index]) {
        expect(disposed).toHaveBeenCalledTimes(index < 4 ? 1 : 0);
      }
    }
    helper.dispose();
    for (const batch of disposalBatches) {
      for (const disposed of batch) expect(disposed).toHaveBeenCalledTimes(1);
    }
    expect(groups()).toHaveLength(0);
  });

  it("uses a static nearby scatter with reduced motion and still expires on time", () => {
    const { helper, groups, breakProp } = fixture(1, 0.8);
    breakProp();
    helper.animate(0, true);
    const fragments = groups()[0].children;
    const positions = fragments.map((fragment) => fragment.position.clone());
    const rotations = fragments.map((fragment) => fragment.quaternion.clone());
    for (const position of positions) {
      expect(position.y).toBeGreaterThanOrEqual(0.8);
      expect(position.y).toBeLessThan(0.9);
      expect(Math.hypot(position.x, position.z)).toBeLessThan(0.5);
    }
    helper.animate(1, true);
    fragments.forEach((fragment, index) => {
      expect(fragment.position.equals(positions[index])).toBe(true);
      expect(fragment.quaternion.equals(rotations[index])).toBe(true);
    });
    helper.animate(1, true);
    expect(groups()).toHaveLength(0);
  });

  it("rejects missing, invisible, and already broken targets", () => {
    const { scene, helper, originals, breakProp, groups } = fixture();
    expect(helper.breakObject("unknown", direction)).toBe(false);
    const hiddenParent = new THREE.Group();
    scene.add(hiddenParent);
    hiddenParent.add(originals[0]);
    hiddenParent.visible = false;
    expect(breakProp()).toBe(false);
    expect(helper.brokenCount).toBe(0);
    expect(groups()).toHaveLength(0);
    hiddenParent.visible = true;
    expect(breakProp()).toBe(true);
    expect(breakProp()).toBe(false);
    expect(helper.brokenCount).toBe(1);
    expect(groups()).toHaveLength(1);
  });
});
