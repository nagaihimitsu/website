import type { Direction, RoomObstacle } from "./types";

export const ROOM_LIMITS = { minX: -4.7, maxX: 4.7, minZ: -3.7, maxZ: 3.7 };
export const AVATAR_RADIUS = 0.22;

/** Screen-relative directions for the room's fixed, southeast camera. */
export function movementVector(directions: ReadonlySet<Direction>): {
  x: number;
  z: number;
} {
  const horizontal =
    Number(directions.has("right")) - Number(directions.has("left"));
  const vertical =
    Number(directions.has("down")) - Number(directions.has("up"));
  const x = horizontal * 13 + vertical * 11;
  const z = horizontal * -11 + vertical * 13;
  const length = Math.hypot(x, z);
  return length > 0 ? { x: x / length, z: z / length } : { x: 0, z: 0 };
}

export function positionIsClear(
  x: number,
  z: number,
  obstacles: readonly RoomObstacle[],
): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return false;
  if (
    x < ROOM_LIMITS.minX + AVATAR_RADIUS ||
    x > ROOM_LIMITS.maxX - AVATAR_RADIUS ||
    z < ROOM_LIMITS.minZ + AVATAR_RADIUS ||
    z > ROOM_LIMITS.maxZ - AVATAR_RADIUS
  )
    return false;
  return !obstacles.some((obstacle) => {
    const nearestX = Math.max(
      obstacle.x - obstacle.width / 2,
      Math.min(x, obstacle.x + obstacle.width / 2),
    );
    const nearestZ = Math.max(
      obstacle.z - obstacle.depth / 2,
      Math.min(z, obstacle.z + obstacle.depth / 2),
    );
    return Math.hypot(x - nearestX, z - nearestZ) < AVATAR_RADIUS;
  });
}

/** Short substeps prevent thin furniture from being crossed during a slow frame. */
export function walkStep(
  position: { x: number; z: number },
  delta: { x: number; z: number },
  obstacles: readonly RoomObstacle[],
): { x: number; z: number } {
  let { x, z } = position;
  const count = Math.max(
    1,
    Math.ceil(Math.hypot(delta.x, delta.z) / (AVATAR_RADIUS / 2)),
  );
  const stepX = delta.x / count;
  const stepZ = delta.z / count;
  for (let index = 0; index < count; index++) {
    const nextX = Math.max(
      ROOM_LIMITS.minX + AVATAR_RADIUS,
      Math.min(ROOM_LIMITS.maxX - AVATAR_RADIUS, x + stepX),
    );
    const nextZ = Math.max(
      ROOM_LIMITS.minZ + AVATAR_RADIUS,
      Math.min(ROOM_LIMITS.maxZ - AVATAR_RADIUS, z + stepZ),
    );
    if (positionIsClear(nextX, z, obstacles)) x = nextX;
    if (positionIsClear(x, nextZ, obstacles)) z = nextZ;
  }
  return { x, z };
}

/** Sample one jump by active elapsed seconds, independent of the render cadence. */
export function sampleJump(elapsedSeconds: number): {
  height: number;
  landed: boolean;
} {
  const initialSpeed = 4.05;
  const gravity = 10.5;
  if (
    !Number.isFinite(elapsedSeconds) ||
    elapsedSeconds >= (2 * initialSpeed) / gravity
  ) {
    return { height: 0, landed: true };
  }
  const time = Math.max(0, elapsedSeconds);
  return {
    height: initialSpeed * time - 0.5 * gravity * time ** 2,
    landed: false,
  };
}
