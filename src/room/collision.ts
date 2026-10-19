import type { RoomObstacle } from "./types";

export const COLLISION_EPSILON = 0.000001;

/** World point in a solid's centered local footprint (Three.js Y rotation). */
export function obstacleLocalPoint(
  x: number,
  z: number,
  obstacle: RoomObstacle,
) {
  const yaw = obstacle.rotationY ?? 0;
  const cosine = Math.cos(yaw);
  const sine = Math.sin(yaw);
  const dx = x - obstacle.x;
  const dz = z - obstacle.z;
  return { x: cosine * dx - sine * dz, z: sine * dx + cosine * dz };
}

/** A circular footprint against an optionally rotated, finite solid. */
export function overlapsObstacle(
  x: number,
  z: number,
  radius: number,
  obstacle: RoomObstacle,
) {
  if (obstacle.enabled === false) return false;
  const local = obstacleLocalPoint(x, z, obstacle);
  const dx = Math.max(0, Math.abs(local.x) - obstacle.width / 2);
  const dz = Math.max(0, Math.abs(local.z) - obstacle.depth / 2);
  return Math.hypot(dx, dz) < radius - COLLISION_EPSILON;
}
