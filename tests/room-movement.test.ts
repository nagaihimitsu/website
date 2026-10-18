import { describe, expect, it } from "vitest";
import {
  AVATAR_RADIUS,
  PLAYER_HEIGHT,
  ROOM_CEILING,
  ROOM_LIMITS,
  createPlayer,
  movementVector,
  positionIsClear,
  stepPlayer,
  validatePlayerPosition,
  type RoomPlayer,
} from "../src/room/movement";
import type { RoomObstacle } from "../src/room/types";

const still = { x: 0, z: 0 };
const bed: RoomObstacle = {
  id: "bed",
  x: 0,
  z: 0,
  width: 2,
  depth: 2,
  base: 0,
  top: 0.85,
};
const desk: RoomObstacle = {
  id: "desk-top",
  x: 0,
  z: 0,
  width: 2,
  depth: 1.4,
  base: 1.2,
  top: 1.36,
};
function settle(player: RoomPlayer, obstacles: RoomObstacle[]) {
  return stepPlayer(
    stepPlayer(player, still, 1, obstacles),
    still,
    1,
    obstacles,
  );
}

describe("room movement", () => {
  it("follows camera yaw and keeps diagonal movement at the same speed", () => {
    expect(movementVector(new Set(["up"]))).toEqual({ x: 0, z: -1 });
    const turned = movementVector(new Set(["up"]), Math.PI / 2);
    expect(turned.x).toBeCloseTo(-1);
    expect(turned.z).toBeCloseTo(0);
    const right = movementVector(new Set(["right"]), Math.PI / 2);
    expect(right.x).toBeCloseTo(0);
    expect(right.z).toBeCloseTo(-1);
    const diagonal = movementVector(new Set(["up", "right"]), 1.2);
    expect(Math.hypot(diagonal.x, diagonal.z)).toBeCloseTo(1);
    expect(movementVector(new Set(["up", "down", "left", "right"]))).toEqual({
      x: 0,
      z: 0,
    });
    const direct = stepPlayer(createPlayer(0, 0), { x: 1, z: 0 }, 0.4, []);
    const diagonalStep = stepPlayer(createPlayer(0, 0), diagonal, 0.4, []);
    expect(Math.hypot(diagonalStep.x, diagonalStep.z)).toBeCloseTo(direct.x);
  });

  it("keeps the entire body inside the walls", () => {
    let player = createPlayer(0, 0);
    for (let frame = 0; frame < 4; frame++)
      player = stepPlayer(player, { x: 1, z: -1 }, 1, []);
    expect(player.x).toBeCloseTo(ROOM_LIMITS.maxX - AVATAR_RADIUS);
    expect(player.z).toBeCloseTo(ROOM_LIMITS.minZ + AVATAR_RADIUS);
    expect(positionIsClear(NaN, 0, [])).toBe(false);
    expect(positionIsClear(Infinity, 0, [])).toBe(false);
    expect(positionIsClear(4.6, 0, [])).toBe(false);
  });

  it("cannot cross a thin solid obstacle during a slow frame", () => {
    const divider = { ...bed, width: 0.1, depth: 3, top: 2 };
    const player = stepPlayer(createPlayer(-2, 0), { x: 1, z: 0 }, 1, [
      divider,
    ]);
    expect(player.x).toBeLessThanOrEqual(-0.05 - AVATAR_RADIUS);
    expect(player.x).toBeGreaterThan(-0.3);
    expect(positionIsClear(player.x, player.z, [divider], player.y)).toBe(true);
  });

  it("slides along furniture sides while moving diagonally", () => {
    const cabinet = { ...bed, width: 1, depth: 3, top: 2 };
    const player = stepPlayer(createPlayer(-0.75, -1), { x: 1, z: 1 }, 0.5, [
      cabinet,
    ]);
    expect(player.x).toBeLessThanOrEqual(-0.5 - AVATAR_RADIUS);
    expect(player.z).toBeGreaterThan(-0.1);
    expect(positionIsClear(player.x, player.z, [cabinet], player.y)).toBe(true);
  });
});

describe("furniture platform jumps", () => {
  it.each([bed, desk])("can jump from the floor onto $id", (platform) => {
    let player = createPlayer(0, platform.depth / 2 + 0.4);
    player = stepPlayer(player, { x: 0, z: -1 }, 0.55, [platform], true);
    expect(player.y).toBeGreaterThan(platform.top);
    expect(player.z).toBeLessThan(platform.depth / 2);
    player = settle(player, [platform]);
    expect(player.y).toBeCloseTo(platform.top);
    expect(player.grounded).toBe(true);
    expect(player.supportId).toBe(platform.id);
    expect(positionIsClear(player.x, player.z, [platform], player.y)).toBe(
      true,
    );
  });

  it("falls to the floor after walking off a furniture edge", () => {
    const initial = validatePlayerPosition({ x: 0, y: bed.top, z: 0 }, [bed])!;
    const player = stepPlayer(initial, { x: 1, z: 0 }, 0.9, [bed]);
    expect(player.x).toBeGreaterThan(bed.width / 2 + AVATAR_RADIUS);
    expect(player.y).toBe(0);
    expect(player.grounded).toBe(true);
    expect(player.supportId).toBeNull();
  });

  it("stops at the underside of a thin elevated surface", () => {
    const overhead = { ...desk, base: 2.1, top: 2.2 };
    const player = stepPlayer(createPlayer(0, 0), still, 0.2, [overhead], true);
    expect(player.y).toBeLessThanOrEqual(overhead.base - PLAYER_HEIGHT);
    expect(player.velocityY).toBeLessThanOrEqual(0);
    expect(player.supportId).toBeNull();
    expect(settle(player, [overhead]).y).toBe(0);
  });

  it("cannot jump through the room ceiling from a high platform", () => {
    const high = { ...bed, top: 2.4 };
    const initial = validatePlayerPosition({ x: 0, y: high.top, z: 0 }, [
      high,
    ])!;
    const player = stepPlayer(initial, still, 0.15, [high], true);
    expect(player.y).toBeLessThanOrEqual(ROOM_CEILING - PLAYER_HEIGHT);
    expect(player.velocityY).toBeLessThanOrEqual(0);
    const landed = settle(player, [high]);
    expect(landed.y).toBe(high.top);
    expect(landed.supportId).toBe(high.id);
  });

  it("ignores a second jump in midair", () => {
    const rising = stepPlayer(createPlayer(0, 0), still, 0.2, [], true);
    const repeated = stepPlayer(rising, still, 0.2, [], true);
    const normal = stepPlayer(rising, still, 0.2, []);
    expect(repeated).toEqual(normal);
    expect(repeated.velocityY).toBeLessThan(rising.velocityY);
  });

  it("lands with the same timing at 2, 15, and 60 FPS", () => {
    for (const fps of [2, 15, 60]) {
      let player = createPlayer(0, 0);
      let highest = 0;
      for (let frame = 0; frame < fps * 1.5; frame++) {
        player = stepPlayer(player, still, 1 / fps, [], frame === 0);
        highest = Math.max(highest, player.y);
      }
      expect(highest).toBeGreaterThan(1.7);
      expect(player.y).toBe(0);
      expect(player.grounded).toBe(true);
    }
  });

  it("integrates slow frames without tunneling through thin platform tops", () => {
    const descending: RoomPlayer = {
      ...createPlayer(0, 0),
      y: 2.5,
      velocityY: -7,
      grounded: false,
    };
    const player = stepPlayer(descending, still, 0.5, [desk]);
    expect(player.y).toBe(desk.top);
    expect(player.supportId).toBe(desk.id);
    expect(player.grounded).toBe(true);
  });

  it("falls when a supporting breakable object is removed", () => {
    const initial = validatePlayerPosition({ x: 0, y: bed.top, z: 0 }, [bed])!;
    const player = stepPlayer(initial, still, 1, [{ ...bed, enabled: false }]);
    expect(player.y).toBe(0);
    expect(player.supportId).toBeNull();
  });
});

describe("saved room positions", () => {
  it("restores floor and furniture-top positions with a stable grounded state", () => {
    expect(validatePlayerPosition({ x: 3, z: 3 }, [bed])).toEqual(
      createPlayer(3, 3),
    );
    expect(
      validatePlayerPosition({ x: 0, y: bed.top + 0.001, z: 0 }, [bed]),
    ).toMatchObject({
      x: 0,
      y: bed.top,
      z: 0,
      velocityY: 0,
      grounded: true,
      supportId: bed.id,
    });
  });

  it("rejects airborne, inside-furniture, outside-room, and invalid saves", () => {
    for (const saved of [
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0.4, z: 0 },
      { x: 3, y: 1, z: 3 },
      { x: 4.7, y: 0, z: 0 },
      { x: NaN, y: 0, z: 0 },
      { x: 2, y: Infinity, z: 0 },
      { x: "2", y: 0, z: 0 },
      null,
    ])
      expect(validatePlayerPosition(saved, [bed])).toBeNull();
    expect(
      validatePlayerPosition({ x: 0, y: bed.top, z: 0 }, [
        { ...bed, enabled: false },
      ]),
    ).toBeNull();
  });

  it("checks body radius at furniture corners and headroom over saved tops", () => {
    const table = { ...bed, width: 1, depth: 1 };
    expect(positionIsClear(0.6, 0.6, [table])).toBe(false);
    expect(positionIsClear(0.7, 0.7, [table])).toBe(true);
    const tooHigh = { ...bed, top: 3.2 };
    expect(
      validatePlayerPosition({ x: 0, y: tooHigh.top, z: 0 }, [tooHigh]),
    ).toBeNull();
    const overhead = { ...desk, id: "overhead", base: 2, top: 2.1 };
    expect(
      validatePlayerPosition({ x: 0, y: bed.top, z: 0 }, [bed, overhead]),
    ).toBeNull();
  });
});
