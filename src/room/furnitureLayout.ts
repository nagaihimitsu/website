import * as THREE from "three";
import type { RoomObstacle } from "./types";

type Point = readonly [number, number, number];

/** A visible furniture part, expressed in its furniture group's coordinates. */
export interface FurniturePart {
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  readonly position: Point;
}

interface FurniturePlacement {
  readonly position: Point;
  readonly rotationY?: number;
}

function part(
  width: number,
  height: number,
  depth: number,
  x = 0,
  y = 0,
  z = 0,
): FurniturePart {
  return { width, height, depth, position: [x, y, z] };
}

// Dimensions here drive both the visible solids and their walking surfaces.
// Small support margins are explicit: cushions remain independently climbable.
export const furnitureLayout = {
  bed: {
    position: [-3.35, 0, -1.85] as Point,
    frame: part(2.25, 0.22, 3.6, 0, 0.4),
    mattress: part(2.12, 0.3, 3.43, 0, 0.63),
    headboard: part(2.18, 1.1, 0.12, 0, 0.96, -1.8),
    duvet: part(2.11, 0.2, 2.58, 0, 0.85, 0.37),
    fold: part(2.13, 0.12, 0.38, 0, 0.94, -0.83),
    pillow: part(0.89, 0.23, 0.59, 0, 0.91, -1.29),
    supportMargin: 0.005,
  },
  desk: {
    position: [3.18, 0, -2.67] as Point,
    tabletop: part(2.92, 0.14, 1.42, 0, 1.29),
  },
  chair: {
    position: [2.9, 0, -1.27] as Point,
    seat: part(0.82, 0.13, 0.75, 0, 0.78),
    back: part(0.85, 0.59, 0.1, 0, 1.14, 0.32),
  },
  console: {
    position: [4.15, 0, 0.05] as Point,
    shelf: part(1.22, 0.08, 1.3),
    side: part(0.08, 1.64, 1.3, 0, 0.85),
    shelfHeights: [0.25, 0.92, 1.59] as const,
  },
  sofa: {
    position: [-2.9, 0, 2.16] as Point,
    rotationY: Math.PI / 2,
    base: part(2.85, 0.33, 1.32, 0, 0.43),
    back: part(2.8, 0.91, 0.28, 0, 0.96, -0.53),
    arm: part(0.26, 0.53, 1.3, 0, 0.78),
    armOffsets: [-1.3, 1.3] as const,
    cushion: part(1.13, 0.22, 1.02, 0, 0.69, 0.08),
  },
  coffee: {
    position: [-0.15, 0, 1.88] as Point,
    tabletop: part(1.7, 0.11, 1.14, 0, 0.58),
  },
  bedside: {
    position: [-1.65, 0, -2.9] as Point,
    body: part(0.7, 0.7, 0.65, 0, 0.48),
    tabletop: part(0.6, 0.05, 0.64, 0, 0.87),
  },
} as const;

export const partTop = (value: FurniturePart) =>
  value.position[1] + value.height / 2;

export function createFurnitureGroup(
  parent: THREE.Object3D,
  layout: FurniturePlacement,
): THREE.Group {
  const group = new THREE.Group();
  group.position.set(...layout.position);
  group.rotation.y = layout.rotationY ?? 0;
  parent.add(group);
  return group;
}

/** Portal anchors and targets follow the same parent transform as their prop. */
export function furniturePoint(parent: THREE.Object3D, point: Point) {
  parent.updateWorldMatrix(true, false);
  return parent.localToWorld(new THREE.Vector3(...point));
}

/**
 * Make a world-space walking volume from a visible part's footprint. The lower
 * and upper surfaces are supplied independently for stepped furniture (sofa,
 * chair); rounding the rendered corners must not change the existing controls.
 */
export function furnitureObstacle(
  id: string,
  parent: THREE.Object3D,
  footprint: FurniturePart,
  top = partTop(footprint),
  base = 0,
): RoomObstacle {
  const [x, , z] = footprint.position;
  parent.updateWorldMatrix(true, false);
  const bounds = new THREE.Box3(
    new THREE.Vector3(x - footprint.width / 2, base, z - footprint.depth / 2),
    new THREE.Vector3(x + footprint.width / 2, top, z + footprint.depth / 2),
  ).applyMatrix4(parent.matrixWorld);
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  return {
    id,
    x: center.x,
    z: center.z,
    width: size.x,
    depth: size.z,
    base: bounds.min.y,
    top: bounds.max.y,
    enabled: true,
  };
}

/** Preserve the sofa's four landing levels rather than enclosing it in one box. */
export function sofaObstacles(parent: THREE.Object3D): RoomObstacle[] {
  const layout = furnitureLayout.sofa;
  const seatTop = partTop(layout.cushion);
  return [
    furnitureObstacle("sofa-seat", parent, layout.base, seatTop),
    furnitureObstacle(
      "sofa-back",
      parent,
      layout.back,
      partTop(layout.back),
      seatTop,
    ),
    ...layout.armOffsets.map((x, index) =>
      furnitureObstacle(
        index === 0 ? "sofa-arm-left" : "sofa-arm-right",
        parent,
        { ...layout.arm, position: [x, layout.arm.position[1], 0] },
        partTop(layout.arm),
        seatTop,
      ),
    ),
  ];
}
