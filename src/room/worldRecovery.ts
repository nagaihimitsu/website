import { validatePlayerPosition } from "./movement";
import type { RoomObstacle } from "./types";

/** Recover onto a real, unoccupied support near the scene's chosen spawn. */
export function findRecoveryPosition(
  preferred: { x: number; y: number; z: number },
  obstacles: readonly RoomObstacle[],
) {
  const candidates = [{ ...preferred }];
  for (let x = -4; x <= 4; x += 0.5)
    for (let z = -4; z <= 4; z += 0.5)
      candidates.push({ x: preferred.x + x, y: preferred.y, z: preferred.z + z });
  candidates.sort((a, b) =>
    Math.hypot(a.x - preferred.x, a.z - preferred.z) -
    Math.hypot(b.x - preferred.x, b.z - preferred.z),
  );
  for (const candidate of candidates) {
    const player = validatePlayerPosition(candidate, obstacles);
    if (player) return player;
  }
  return null;
}
