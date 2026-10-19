import { obstacleLocalPoint } from "./collision";
import type { RoomObstacle } from "./types";

export const FOLLOW_TARGET_HEIGHT = 1.02;
export const DEFAULT_CAMERA_PITCH = 0.16;
export const MIN_CAMERA_PITCH = -0.48;
export const MAX_CAMERA_PITCH = 1.05;
export const FOLLOW_DISTANCE = 2.75;
export const CAMERA_RADIUS = 0.16;
// Leave enough floor behind a new visitor to turn and walk toward the viewer
// before the following camera has to shorten against the entry wall.
export const INITIAL_PLAYER_POSITION = { x: 0.95, z: -0.45 };

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

/** Sweep the camera volume against actual solids, indoors and outdoors. */
export function cameraBoomLimit(
  origin: Point3,
  direction: Point3,
  wantedDistance: number,
  obstacles: readonly RoomObstacle[],
  radius = CAMERA_RADIUS,
): number {
  let distance = Math.max(0, wantedDistance);
  for (const obstacle of obstacles) {
    if (obstacle.enabled === false) continue;
    // The swept volume is expanded in each solid's local coordinates, so a
    // hinged door blocks its actual rotated footprint rather than its old AABB.
    const localOrigin = {
      ...obstacleLocalPoint(origin.x, origin.z, obstacle),
      y: origin.y,
    };
    const yaw = obstacle.rotationY ?? 0;
    const cosine = Math.cos(yaw);
    const sine = Math.sin(yaw);
    const localDirection = {
      x: cosine * direction.x - sine * direction.z,
      y: direction.y,
      z: sine * direction.x + cosine * direction.z,
    };
    const min = {
      x: -obstacle.width / 2 - radius,
      y: obstacle.base - radius,
      z: -obstacle.depth / 2 - radius,
    };
    const max = {
      x: obstacle.width / 2 + radius,
      y: obstacle.top + radius,
      z: obstacle.depth / 2 + radius,
    };
    let entry = -Infinity;
    let exit = Infinity;
    for (const axis of ["x", "y", "z"] as const) {
      if (Math.abs(localDirection[axis]) < 0.000001) {
        if (localOrigin[axis] < min[axis] || localOrigin[axis] > max[axis]) {
          entry = Infinity;
          break;
        }
      } else {
        const a = (min[axis] - localOrigin[axis]) / localDirection[axis];
        const b = (max[axis] - localOrigin[axis]) / localDirection[axis];
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
