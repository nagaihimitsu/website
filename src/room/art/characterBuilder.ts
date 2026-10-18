import type * as THREE from "three";
import type { createCharacterMaterials } from "./characterMaterials";

/** Shared ownership and sculpting helpers for the articulated character. */
export interface CharacterBuilder {
  surfaces: ReturnType<typeof createCharacterMaterials>;
  remember<T extends THREE.BufferGeometry>(geometry: T): T;
  smoothNormals(geometry: THREE.BufferGeometry): void;
  mesh(
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    parent: THREE.Object3D,
    x?: number,
    y?: number,
    z?: number,
  ): THREE.Mesh;
  ellipsoid(
    rx: number,
    ry: number,
    rz: number,
    material: THREE.Material,
    parent: THREE.Object3D,
    x: number,
    y: number,
    z: number,
  ): THREE.Mesh;
  thread(
    points: number[][],
    radius: number,
    material: THREE.Material,
    parent: THREE.Object3D,
    segments?: number,
  ): THREE.Mesh;
  pile(
    root: THREE.Group,
    surface: THREE.Mesh,
    count: number,
    length?: number,
    allow?: (point: THREE.Vector3) => boolean,
  ): void;
}
