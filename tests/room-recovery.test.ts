import { describe, expect, it } from "vitest";
import { findRecoveryPosition } from "../src/room/worldRecovery";
import { positionIsClear } from "../src/room/movement";
import type { RoomObstacle } from "../src/room/types";

const floor: RoomObstacle = { id: "floor", x: 0, z: 0, width: 6, depth: 6,
  base: -0.2, top: 0, support: "ground", enabled: true };

describe("recovery after falling beyond finite terrain", () => {
  it("finds supported free ground when an occupant blocks the preferred position", () => {
    const obstacles = [floor, { id: "occupant", x: 0, z: 0, width: 0.8, depth: 0.8,
      base: 0, top: 1, enabled: true }];
    const recovered = findRecoveryPosition({ x: 0, y: 0, z: 0 }, obstacles)!;
    expect(recovered).not.toBeNull();
    expect(positionIsClear(recovered.x, recovered.z, obstacles, recovered.y)).toBe(true);
    expect(recovered.grounded).toBe(true);
    expect(recovered.y).toBe(0);
    expect(Math.hypot(recovered.x, recovered.z)).toBeLessThan(2);
  });

  it("does not invent a ground plane when the recovery floor is absent or disabled", () => {
    expect(findRecoveryPosition({ x: 0, y: 0, z: 0 }, [])).toBeNull();
    expect(findRecoveryPosition({ x: 0, y: 0, z: 0 }, [{ ...floor, enabled: false }])).toBeNull();
  });
});
