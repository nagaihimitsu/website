import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  createFurnitureGroup,
  furnitureLayout,
  furnitureObstacle,
  furniturePoint,
  partTop,
  sofaObstacles,
  type FurniturePart,
} from "../src/room/furnitureLayout";
import type { RoomObstacle } from "../src/room/types";

function expectBounds(
  actual: RoomObstacle,
  expected: Omit<RoomObstacle, "enabled">,
) {
  expect(actual.id).toBe(expected.id);
  for (const key of ["x", "z", "width", "depth", "base", "top"] as const)
    expect(actual[key], `${actual.id}.${key}`).toBeCloseTo(expected[key], 12);
}

describe("furniture layout and walking surfaces", () => {
  it.each([
    ["desk", "desk", 3.18, -2.67, 2.92, 1.42, 1.36],
    ["coffee", "coffee-table", -0.15, 1.88, 1.7, 1.14, 0.635],
  ] as const)(
    "preserves the existing %s footprint and support height",
    (key, id, x, z, width, depth, top) => {
      const layout = furnitureLayout[key];
      const parent = createFurnitureGroup(new THREE.Group(), layout);
      expectBounds(furnitureObstacle(id, parent, layout.tabletop), {
        id,
        x,
        z,
        width,
        depth,
        top,
        base: 0,
      });
    },
  );

  it("keeps props, targets and the surface together after a table is resized and transformed", () => {
    // Exercise an edited layout rather than merely rechecking today's constants.
    const tabletop: FurniturePart = {
      width: 2.4,
      height: 0.2,
      depth: 1.2,
      position: [0, 0.9, 0],
    };
    const outer = new THREE.Group();
    outer.position.set(0.4, 0.2, -0.3);
    outer.rotation.y = -0.2;
    const table = createFurnitureGroup(outer, {
      position: [1.1, 0.3, -0.5],
      rotationY: Math.PI / 3,
    });
    table.scale.set(1.1, 1.3, 0.8);
    const geometry = new THREE.BoxGeometry(
      tabletop.width,
      tabletop.height,
      tabletop.depth,
    );
    const material = new THREE.MeshBasicMaterial();
    const visibleTop = new THREE.Mesh(geometry, material);
    visibleTop.position.set(...tabletop.position);
    table.add(visibleTop);
    const prop = new THREE.Group();
    prop.position.set(0.36, partTop(tabletop), 0.09);
    table.add(prop);
    outer.updateMatrixWorld(true);

    const visibleBounds = new THREE.Box3().setFromObject(visibleTop);
    const collider = furnitureObstacle("table", table, tabletop);
    const target = furniturePoint(prop, [0, 0.005, 0]);
    expect(collider.top).toBeCloseTo(visibleBounds.max.y, 6);
    expect(collider.width).toBeCloseTo(
      visibleBounds.max.x - visibleBounds.min.x,
      6,
    );
    expect(collider.depth).toBeCloseTo(
      visibleBounds.max.z - visibleBounds.min.z,
      6,
    );
    expect(prop.getWorldPosition(new THREE.Vector3()).y).toBeCloseTo(
      collider.top,
      12,
    );
    expect(target.y).toBeCloseTo(collider.top + 0.005 * table.scale.y, 12);
    expect(target.x).toBeCloseTo(
      prop.getWorldPosition(new THREE.Vector3()).x,
      12,
    );
    expect(target.z).toBeCloseTo(
      prop.getWorldPosition(new THREE.Vector3()).z,
      12,
    );
    geometry.dispose();
    material.dispose();
  });

  it("preserves the sofa seat, back and two arms as separate landing volumes", () => {
    const sofa = createFurnitureGroup(new THREE.Group(), furnitureLayout.sofa);
    const obstacles = sofaObstacles(sofa);
    const baseline = [
      {
        id: "sofa-seat",
        x: -2.9,
        z: 2.16,
        width: 1.32,
        depth: 2.85,
        top: 0.8,
        base: 0,
      },
      {
        id: "sofa-back",
        x: -3.43,
        z: 2.16,
        width: 0.28,
        depth: 2.8,
        top: 1.415,
        base: 0.8,
      },
      {
        id: "sofa-arm-left",
        x: -2.9,
        z: 3.46,
        width: 1.3,
        depth: 0.26,
        top: 1.045,
        base: 0.8,
      },
      {
        id: "sofa-arm-right",
        x: -2.9,
        z: 0.86,
        width: 1.3,
        depth: 0.26,
        top: 1.045,
        base: 0.8,
      },
    ];
    expect(obstacles).toHaveLength(baseline.length);
    obstacles.forEach((actual, index) => expectBounds(actual, baseline[index]));

    sofa.position.set(0, 0.2, 0);
    sofa.rotation.y = 0;
    const moved = sofaObstacles(sofa);
    expectBounds(moved[2], {
      id: "sofa-arm-left",
      x: -1.3,
      z: 0,
      width: 0.26,
      depth: 1.3,
      top: 1.245,
      base: 1,
    });
  });
});
