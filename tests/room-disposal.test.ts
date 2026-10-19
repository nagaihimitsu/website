import * as THREE from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDisposalScope, withDisposalScope } from "../src/room/disposal";
import { createPhotoFrame } from "../src/room/art/photoFrame";
import { createTableCamera } from "../src/room/art/tableCamera";
import { createTablePolaroids } from "../src/room/art/tablePolaroids";

afterEach(() => vi.restoreAllMocks());

describe("room resource ownership", () => {
  it("unwinds dependencies once and allows reentrant cleanup", () => {
    const scope = createDisposalScope();
    const released: string[] = [];
    const texture = { dispose: () => released.push("texture") };
    scope.own(texture);
    scope.own({ dispose: () => released.push("material") });
    scope.own(texture);
    scope.defer(() => {
      released.push("detach");
      scope.dispose();
    });

    scope.dispose();
    scope.dispose();
    expect(released).toEqual(["detach", "material", "texture"]);
  });

  it("finishes cleanup after failures, reports all failures, and stays disposed", () => {
    const scope = createDisposalScope();
    const firstError = new Error("texture release");
    const lastError = new Error("detach");
    const middle = vi.fn();
    scope.defer(() => { throw firstError; });
    scope.defer(middle);
    scope.defer(() => { throw lastError; });

    let failure: unknown;
    try { scope.dispose(); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toEqual([lastError, firstError]);
    expect(middle).toHaveBeenCalledOnce();
    expect(() => scope.dispose()).not.toThrow();
  });

  it("immediately releases late resources without releasing a shared resource twice", () => {
    const scope = createDisposalScope();
    const earlier = { dispose: vi.fn() };
    const late = { dispose: vi.fn() };
    const listener = vi.fn();
    scope.own(earlier);
    scope.dispose();
    scope.own(earlier);
    expect(scope.own(late)).toBe(late);
    scope.own(late);
    scope.defer(listener);
    expect(earlier.dispose).toHaveBeenCalledOnce();
    expect(late.dispose).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledOnce();
  });

  it("preserves the construction failure when partial cleanup also fails", () => {
    const buildFailure = new Error("model construction");
    const cleanupFailure = new Error("cleanup");
    const release = vi.fn();
    const diagnostic = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => withDisposalScope((scope) => {
      scope.defer(release);
      scope.defer(() => { throw cleanupFailure; });
      throw buildFailure;
    })).toThrow(buildFailure);
    expect(release).toHaveBeenCalledOnce();
    expect(diagnostic).toHaveBeenCalledWith(
      "Resource cleanup after initialization failed",
      expect.any(AggregateError),
    );
  });
});

describe("tabletop model ownership", () => {
  it.each([
    { name: "photo frame", create: createPhotoFrame },
    { name: "camera", create: createTableCamera },
    { name: "polaroids", create: createTablePolaroids },
  ])("releases $name geometry, materials and instance buffers while retaining borrowed photos", ({ create }) => {
    const borrowed = new THREE.Texture();
    const borrowedDispose = vi.spyOn(borrowed, "dispose");
    const model = create(borrowed);
    const parent = new THREE.Group();
    parent.add(model.group);
    const resources = new Set<THREE.BufferGeometry | THREE.Material | THREE.Texture | THREE.InstancedMesh>();
    model.group.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      resources.add(object.geometry);
      if (object instanceof THREE.InstancedMesh) resources.add(object);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        resources.add(material);
        for (const value of Object.values(material)) {
          if (value instanceof THREE.Texture && value !== borrowed) resources.add(value);
        }
      }
    });
    const releases = [...resources].map((resource) => vi.spyOn(resource, "dispose"));
    expect(releases.length).toBeGreaterThan(0);

    model.dispose();
    model.dispose();

    expect(parent.children).toHaveLength(0);
    expect(model.group.children).toHaveLength(0);
    for (const release of releases) expect(release).toHaveBeenCalledOnce();
    expect(borrowedDispose).not.toHaveBeenCalled();
  });

  it("releases a partly constructed print collection without disposing its supplied photo", () => {
    const failure = new Error("normal generation");
    const borrowed = new THREE.Texture();
    const geometryDispose = vi.spyOn(THREE.BufferGeometry.prototype, "dispose");
    const textureDispose = vi.spyOn(THREE.Texture.prototype, "dispose");
    const materialDispose = vi.spyOn(THREE.Material.prototype, "dispose");
    vi.spyOn(THREE.BufferGeometry.prototype, "computeVertexNormals").mockImplementationOnce(() => { throw failure; });

    expect(() => createTablePolaroids(borrowed)).toThrow(failure);
    expect(geometryDispose).toHaveBeenCalled();
    expect(materialDispose).toHaveBeenCalled();
    expect(textureDispose).toHaveBeenCalled();
    expect(textureDispose.mock.contexts).not.toContain(borrowed);
  });
});
