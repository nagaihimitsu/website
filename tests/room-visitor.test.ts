import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createVisitor } from "../src/room/art/visitor";

function pose(group: THREE.Group) {
  group.updateMatrixWorld(true);
  const matrices: number[] = [];
  group.traverse((object) => matrices.push(...object.matrixWorld.elements));
  return matrices;
}

describe("room visitor model", () => {
  it("builds finite, indexed surfaces with depth and a standing footprint", () => {
    const visitor = createVisitor();
    try {
      const geometries = new Set<THREE.BufferGeometry>();
      visitor.group.traverse((object) => {
        if (object instanceof THREE.Mesh) geometries.add(object.geometry);
      });
      expect(geometries.size).toBeGreaterThan(0);
      for (const geometry of geometries) {
        const positions = geometry.getAttribute("position");
        expect(positions.count).toBeGreaterThan(2);
        for (const attribute of Object.values(geometry.attributes)) {
          expect(Array.from(attribute.array).every(Number.isFinite)).toBe(true);
        }
        if (geometry.index) {
          expect(Array.from(geometry.index.array).every((index) =>
            Number.isInteger(index) && index >= 0 && index < positions.count,
          )).toBe(true);
        }
      }
      const bounds = new THREE.Box3().setFromObject(visitor.group);
      const size = bounds.getSize(new THREE.Vector3());
      // A freestanding room occupant must have volume in every viewing direction.
      expect(size.x).toBeGreaterThan(0.25);
      expect(size.z).toBeGreaterThan(0.15);
      expect(size.y).toBeGreaterThan(1);
      expect(size.y).toBeLessThan(1.6);
      expect(Math.abs(bounds.min.y)).toBeLessThan(0.03);
    } finally {
      visitor.dispose();
    }
  });

  it("keeps the bob crown triangles facing outward so the hair is visible from every side", () => {
    const visitor = createVisitor();
    try {
      const crown = visitor.group.getObjectByName("visitor-lilac-bob-crown") as THREE.Mesh;
      expect(crown).toBeInstanceOf(THREE.Mesh);
      const geometry = crown.geometry;
      geometry.computeBoundingBox();
      const centre = geometry.boundingBox!.getCenter(new THREE.Vector3());
      const positions = geometry.getAttribute("position");
      const indices = geometry.index!;
      const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
      const normal = new THREE.Vector3(), edge = new THREE.Vector3(), radial = new THREE.Vector3();
      let surfaces = 0;
      for (let index = 0; index < indices.count; index += 3) {
        a.fromBufferAttribute(positions, indices.getX(index));
        b.fromBufferAttribute(positions, indices.getX(index + 1));
        c.fromBufferAttribute(positions, indices.getX(index + 2));
        normal.subVectors(b, a).cross(edge.subVectors(c, a));
        // Repeated vertices at the crown pole have no visible area.
        if (normal.lengthSq() < 1e-18) continue;
        radial.copy(a).add(b).add(c).multiplyScalar(1 / 3).sub(centre);
        // Check winding itself: reversing only shading normals does not fix culling.
        expect(normal.dot(radial)).toBeGreaterThan(0);
        surfaces++;
      }
      expect(surfaces).toBeGreaterThan(0);
    } finally {
      visitor.dispose();
    }
  });

  it("animates locally while keeping the standing position fixed, and respects reduced motion", () => {
    const visitor = createVisitor();
    try {
      visitor.group.position.set(2.1, 0.012, -0.7);
      visitor.group.rotation.y = -0.2;
      const position = visitor.group.position.clone();
      const rotation = visitor.group.quaternion.clone();
      visitor.animate(0, false);
      const initial = pose(visitor.group);
      visitor.animate(1.23, false);
      expect(pose(visitor.group)).not.toEqual(initial);
      expect(visitor.group.position.equals(position)).toBe(true);
      expect(visitor.group.quaternion.equals(rotation)).toBe(true);
      visitor.animate(3, true);
      const reduced = pose(visitor.group);
      visitor.animate(11, true);
      expect(pose(visitor.group)).toEqual(reduced);
    } finally {
      visitor.dispose();
    }
  });

  it("detaches and releases GPU resources once, with no animation after disposal", () => {
    const visitor = createVisitor();
    const parent = new THREE.Group();
    parent.add(visitor.group);
    const resources = new Set<THREE.BufferGeometry | THREE.Material | THREE.Texture>();
    visitor.group.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      resources.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        resources.add(material);
        for (const value of Object.values(material)) {
          if (value instanceof THREE.Texture) resources.add(value);
        }
      }
    });
    const releases = new Map<object, number>();
    for (const resource of resources) {
      releases.set(resource, 0);
      resource.addEventListener("dispose", () => {
        releases.set(resource, releases.get(resource)! + 1);
      });
    }
    visitor.animate(2, false);
    visitor.dispose();
    const detached = pose(visitor.group);
    visitor.dispose();
    visitor.animate(20, false);
    expect(pose(visitor.group)).toEqual(detached);
    expect(parent.children).toHaveLength(0);
    expect(resources.size).toBeGreaterThan(0);
    for (const count of releases.values()) expect(count).toBe(1);
  });
});
