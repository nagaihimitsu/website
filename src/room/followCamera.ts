import { ROOM_CEILING } from "./movement";
import type { RoomObstacle } from "./types";

export const FOLLOW_TARGET_HEIGHT = 1.02;
export const DEFAULT_CAMERA_PITCH = 0.16;
export const MIN_CAMERA_PITCH = -0.48;
export const MAX_CAMERA_PITCH = 1.05;
export const FOLLOW_DISTANCE = 2.75;
export const CAMERA_RADIUS = 0.16;
export const INITIAL_PLAYER_POSITION = { x: 0.95, z: 0.65 };

export interface Point3 {
  x: number;
  y: number;
  z: number;
}

/** Rotation zero looks down -Z, matching Three.js and camera-relative input. */
export function orbitDirection(yaw: number, pitch: number): Point3 {
  return {
    x: Math.sin(yaw) * Math.cos(pitch),
    y: Math.sin(pitch),
    z: Math.cos(yaw) * Math.cos(pitch),
  };
}

export function shortestAngle(from: number, to: number) {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

/** A swept camera volume, not just its center, stays inside the architecture. */
export function cameraBoomLimit(
  origin: Point3,
  direction: Point3,
  wantedDistance: number,
  obstacles: readonly RoomObstacle[],
  radius = CAMERA_RADIUS,
): number {
  let distance = Math.max(0, wantedDistance);
  const roomMin = { x: -4.91 + radius, y: radius, z: -3.91 + radius };
  const roomMax = {
    x: 4.91 - radius,
    y: ROOM_CEILING - radius,
    z: 3.91 - radius,
  };
  for (const axis of ["x", "y", "z"] as const) {
    if (direction[axis] > 0.000001)
      distance = Math.min(
        distance,
        (roomMax[axis] - origin[axis]) / direction[axis],
      );
    else if (direction[axis] < -0.000001)
      distance = Math.min(
        distance,
        (roomMin[axis] - origin[axis]) / direction[axis],
      );
  }
  for (const obstacle of obstacles) {
    if (obstacle.enabled === false) continue;
    const min = {
      x: obstacle.x - obstacle.width / 2 - radius,
      y: obstacle.base - radius,
      z: obstacle.z - obstacle.depth / 2 - radius,
    };
    const max = {
      x: obstacle.x + obstacle.width / 2 + radius,
      y: obstacle.top + radius,
      z: obstacle.z + obstacle.depth / 2 + radius,
    };
    let entry = -Infinity;
    let exit = Infinity;
    for (const axis of ["x", "y", "z"] as const) {
      if (Math.abs(direction[axis]) < 0.000001) {
        if (origin[axis] < min[axis] || origin[axis] > max[axis]) {
          entry = Infinity;
          break;
        }
      } else {
        const a = (min[axis] - origin[axis]) / direction[axis];
        const b = (max[axis] - origin[axis]) / direction[axis];
        entry = Math.max(entry, Math.min(a, b));
        exit = Math.min(exit, Math.max(a, b));
      }
    }
    if (entry <= exit && exit >= 0) {
      // A valid player's torso lies outside expanded solids. The guard also
      // keeps a restored pose safe if a newly restored prop surrounds it.
      distance = Math.min(distance, Math.max(0, entry));
    }
  }
  return Math.max(0.035, distance);
}

/** Avoid a new obstruction immediately; ease outward after it clears. */
export function recoverCameraDistance(
  current: number,
  safe: number,
  elapsed: number,
) {
  if (safe <= current) return safe;
  return current + (safe - current) * (1 - Math.exp(-7 * Math.max(0, elapsed)));
}
