import * as THREE from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCharacter } from "../src/room/art/character";
import { createCharacterMaterials } from "../src/room/art/characterMaterials";
import { createBird } from "../src/room/art/bird";
import { createBreakables } from "../src/room/art/breakables";

afterEach(() => vi.restoreAllMocks());

function trackResources() {
  const geometry = vi.spyOn(THREE.BufferGeometry.prototype, "dispose");
  const material = vi.spyOn(THREE.Material.prototype, "dispose");
  const texture = vi.spyOn(THREE.Texture.prototype, "dispose");
  const instances = vi.spyOn(THREE.InstancedMesh.prototype, "dispose");
  return { geometry, material, texture, instances };
}

function expectOncePerResource(releases: { mock: { contexts: unknown[] } }) {
  expect(new Set(releases.mock.contexts).size).toBe(releases.mock.contexts.length);
}

describe("model construction rollback", () => {
  it("releases a texture even when its configuration fails before the first textile is returned", () => {
    const failure = new Error("texture configuration");
    const resources = trackResources();
    vi.spyOn(THREE.Vector2.prototype, "set").mockImplementationOnce(() => { throw failure; });
    expect(() => createCharacterMaterials()).toThrow(failure);
    expect(resources.texture).toHaveBeenCalledOnce();
  });

  it("releases character surfaces, geometry and the in-progress fur instance buffer", () => {
    const failure = new Error("fur instance data");
    const resources = trackResources();
    vi.spyOn(THREE.InstancedMesh.prototype, "setColorAt").mockImplementationOnce(() => { throw failure; });
    expect(() => createCharacter()).toThrow(failure);
    expect(resources.instances).toHaveBeenCalledOnce();
    expect(resources.geometry).toHaveBeenCalled();
    expect(resources.material).toHaveBeenCalled();
    expect(resources.texture).toHaveBeenCalled();
    for (const release of Object.values(resources)) expectOncePerResource(release);
  });

  it("releases welded bird geometry and temporary foot pieces when toe placement fails", () => {
    const failure = new Error("foot placement");
    const resources = trackResources();
    vi.spyOn(THREE.BufferGeometry.prototype, "translate").mockImplementationOnce(() => { throw failure; });
    expect(() => createBird()).toThrow(failure);
    expect(resources.geometry).toHaveBeenCalled();
    expect(resources.material).toHaveBeenCalled();
    expectOncePerResource(resources.geometry);
    expectOncePerResource(resources.material);
  });

  it("releases bird scratch geometry eagerly and only once across normal teardown", () => {
    const resources = trackResources();
    const bird = createBird();
    const temporaryCount = resources.geometry.mock.calls.length;
    expect(temporaryCount).toBeGreaterThan(0);
    const parent = new THREE.Group();
    parent.add(bird.group);
    const sculpture = bird.group.children[0];
    const pose = sculpture.matrix.clone();
    bird.dispose();
    bird.dispose();
    bird.animate({ time: 10, hopPhase: 0.5, heading: 1, moving: true, reducedMotion: false });
    sculpture.updateMatrix();
    expect(sculpture.matrix.equals(pose)).toBe(true);
    expect(parent.children).toHaveLength(0);
    expect(resources.geometry.mock.calls.length).toBeGreaterThan(temporaryCount);
    expectOncePerResource(resources.geometry);
    expectOncePerResource(resources.material);
  });
});

function breakableFixture() {
  const scene = new THREE.Scene();
  const prop = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
  const borrowedGeometry = vi.fn();
  const borrowedMaterial = vi.fn();
  prop.geometry.addEventListener("dispose", borrowedGeometry);
  prop.material.addEventListener("dispose", borrowedMaterial);
  scene.add(prop);
  const system = createBreakables(scene);
  system.register("prop", prop, ["#aaa", "#bbb"]);
  return { scene, prop, system, borrowedGeometry, borrowedMaterial };
}

describe("fragment batch ownership", () => {
  it("rolls back an unfinished batch without hiding or disposing the borrowed prop", () => {
    const { scene, prop, system, borrowedGeometry, borrowedMaterial } = breakableFixture();
    const failure = new Error("scene attachment");
    const resources = trackResources();
    vi.spyOn(scene, "add").mockImplementationOnce(() => { throw failure; });
    expect(() => system.breakObject("prop", new THREE.Vector3())).toThrow(failure);
    expect(scene.children).toEqual([prop]);
    expect(prop.visible).toBe(true);
    expect(system.brokenCount).toBe(0);
    expect(resources.geometry).toHaveBeenCalled();
    expect(resources.material).toHaveBeenCalled();
    expectOncePerResource(resources.geometry);
    expectOncePerResource(resources.material);
    expect(system.breakObject("prop", new THREE.Vector3())).toBe(true);
    system.dispose();
    expect(borrowedGeometry).not.toHaveBeenCalled();
    expect(borrowedMaterial).not.toHaveBeenCalled();
    expect(prop.userData.breakableId).toBeUndefined();
    prop.geometry.dispose();
    prop.material.dispose();
  });

  it("detaches fragments and unregisters borrowed props even when one resource release throws", () => {
    const { scene, prop, system, borrowedGeometry, borrowedMaterial } = breakableFixture();
    system.breakObject("prop", new THREE.Vector3());
    const batch = scene.children.find((child) => child.name.startsWith("fragments:"))!;
    const fragment = batch.children[0] as THREE.Mesh;
    fragment.geometry.addEventListener("dispose", () => { throw new Error("geometry release"); });
    const materials = trackResources().material;
    expect(() => system.dispose()).toThrow(AggregateError);
    expect(() => system.dispose()).not.toThrow();
    expect(scene.children).toEqual([prop]);
    expect(prop.userData.breakableId).toBeUndefined();
    expect(materials).toHaveBeenCalledTimes(2);
    expect(borrowedGeometry).not.toHaveBeenCalled();
    expect(borrowedMaterial).not.toHaveBeenCalled();
    prop.geometry.dispose();
    prop.material.dispose();
  });
});
