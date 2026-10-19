import { describe, expect, it } from "vitest";
import {
  AVATAR_RADIUS,
  PLAYER_HEIGHT,
  createPlayer,
  movementVector,
  positionIsClear,
  stepPlayer,
  validatePlayerPosition,
  type RoomPlayer,
} from "../src/room/movement";
import type { RoomObstacle } from "../src/room/types";
import { obstacleLocalPoint, overlapsObstacle } from "../src/room/collision";

const still = { x: 0, z: 0 };
const ROOM_CEILING = 4.55;
const ROOM_LIMITS = { minX: -4.7, maxX: 4.7, minZ: -3.7, maxZ: 3.7 };
const floor: RoomObstacle = {
  id: "room-floor", x: 0, z: 0, width: 9.4, depth: 7.4,
  base: -0.25, top: 0, support: "ground",
};
// Architecture is supplied by the scene, never inferred by the movement code.
const architecture: RoomObstacle[] = [
  floor,
  { id: "left-wall", x: -4.8, z: 0, width: 0.2, depth: 7.8, base: 0, top: 4.7 },
  { id: "right-wall", x: 4.8, z: 0, width: 0.2, depth: 7.8, base: 0, top: 4.7 },
  { id: "back-wall", x: 0, z: -3.8, width: 9.8, depth: 0.2, base: 0, top: 4.7 },
  { id: "front-wall", x: 0, z: 3.8, width: 9.8, depth: 0.2, base: 0, top: 4.7 },
  { id: "ceiling", x: 0, z: 0, width: 9.8, depth: 7.8, base: ROOM_CEILING, top: 4.7 },
];
const world = (...obstacles: RoomObstacle[]) => [...architecture, ...obstacles];
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
    const direct = stepPlayer(createPlayer(0, 0), { x: 1, z: 0 }, 0.4, world());
    const diagonalStep = stepPlayer(createPlayer(0, 0), diagonal, 0.4, world());
    expect(Math.hypot(diagonalStep.x, diagonalStep.z)).toBeCloseTo(direct.x);
  });

  it("keeps the entire body inside the walls", () => {
    let player = createPlayer(0, 0);
    for (let frame = 0; frame < 4; frame++)
      player = stepPlayer(player, { x: 1, z: -1 }, 1, world());
    expect(player.x).toBeLessThanOrEqual(ROOM_LIMITS.maxX - AVATAR_RADIUS);
    expect(player.x).toBeGreaterThan(ROOM_LIMITS.maxX - AVATAR_RADIUS - 0.016);
    expect(player.z).toBeGreaterThanOrEqual(ROOM_LIMITS.minZ + AVATAR_RADIUS);
    expect(player.z).toBeLessThan(ROOM_LIMITS.minZ + AVATAR_RADIUS + 0.016);
    expect(positionIsClear(NaN, 0, world())).toBe(false);
    expect(positionIsClear(Infinity, 0, world())).toBe(false);
    expect(positionIsClear(4.6, 0, world())).toBe(false);
  });

  it("cannot cross a thin solid obstacle during a slow frame", () => {
    const divider = { ...bed, width: 0.1, depth: 3, top: 2 };
    const player = stepPlayer(createPlayer(-2, 0), { x: 1, z: 0 }, 1, world(divider));
    expect(player.x).toBeLessThanOrEqual(-0.05 - AVATAR_RADIUS);
    expect(player.x).toBeGreaterThan(-0.3);
    expect(positionIsClear(player.x, player.z, world(divider), player.y)).toBe(true);
  });

  it("slides along furniture sides while moving diagonally", () => {
    const cabinet = { ...bed, width: 1, depth: 3, top: 2 };
    const player = stepPlayer(createPlayer(-0.75, -1), { x: 1, z: 1 }, 0.5, world(cabinet));
    expect(player.x).toBeLessThanOrEqual(-0.5 - AVATAR_RADIUS);
    expect(player.z).toBeGreaterThan(-0.1);
    expect(positionIsClear(player.x, player.z, world(cabinet), player.y)).toBe(true);
  });
});

describe("furniture platform jumps", () => {
  it.each([bed, desk])("can jump from the floor onto $id", (platform) => {
    let player = createPlayer(0, platform.depth / 2 + 0.4);
    player = stepPlayer(player, { x: 0, z: -1 }, 0.55, world(platform), true);
    expect(player.y).toBeGreaterThan(platform.top);
    expect(player.z).toBeLessThan(platform.depth / 2);
    player = settle(player, world(platform));
    expect(player.y).toBeCloseTo(platform.top);
    expect(player.grounded).toBe(true);
    expect(player.supportId).toBe(platform.id);
    expect(positionIsClear(player.x, player.z, world(platform), player.y)).toBe(
      true,
    );
  });

  it("falls to the floor after walking off a furniture edge", () => {
    const initial = validatePlayerPosition({ x: 0, y: bed.top, z: 0 }, world(bed))!;
    const player = stepPlayer(initial, { x: 1, z: 0 }, 0.9, world(bed));
    expect(player.x).toBeGreaterThan(bed.width / 2 + AVATAR_RADIUS);
    expect(player.y).toBe(0);
    expect(player.grounded).toBe(true);
    expect(player.supportId).toBeNull();
  });

  it("stops at the underside of a thin elevated surface", () => {
    const overhead = { ...desk, base: 2.1, top: 2.2 };
    const player = stepPlayer(createPlayer(0, 0), still, 0.2, world(overhead), true);
    expect(player.y).toBeLessThanOrEqual(overhead.base - PLAYER_HEIGHT);
    expect(player.velocityY).toBeLessThanOrEqual(0);
    expect(player.supportId).toBeNull();
    expect(settle(player, world(overhead)).y).toBe(0);
  });

  it("cannot jump through the room ceiling from a high platform", () => {
    const high = { ...bed, top: ROOM_CEILING - PLAYER_HEIGHT - 0.6 };
    const initial = validatePlayerPosition({ x: 0, y: high.top, z: 0 }, world(high))!;
    const player = stepPlayer(initial, still, 0.15, world(high), true);
    expect(player.y).toBeLessThanOrEqual(ROOM_CEILING - PLAYER_HEIGHT);
    expect(player.velocityY).toBeLessThanOrEqual(0);
    const landed = settle(player, world(high));
    expect(landed.y).toBe(high.top);
    expect(landed.supportId).toBe(high.id);
  });

  it("ignores a second jump in midair", () => {
    const rising = stepPlayer(createPlayer(0, 0), still, 0.2, world(), true);
    const repeated = stepPlayer(rising, still, 0.2, world(), true);
    const normal = stepPlayer(rising, still, 0.2, world());
    expect(repeated).toEqual(normal);
    expect(repeated.velocityY).toBeLessThan(rising.velocityY);
  });

  it("lands with the same timing at 2, 15, and 60 FPS", () => {
    for (const fps of [2, 15, 60]) {
      let player = createPlayer(0, 0);
      let highest = 0;
      for (let frame = 0; frame < fps * 1.5; frame++) {
        player = stepPlayer(player, still, 1 / fps, world(), frame === 0);
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
    const player = stepPlayer(descending, still, 0.5, world(desk));
    expect(player.y).toBe(desk.top);
    expect(player.supportId).toBe(desk.id);
    expect(player.grounded).toBe(true);
  });

  it("falls when a supporting breakable object is removed", () => {
    const initial = validatePlayerPosition({ x: 0, y: bed.top, z: 0 }, world(bed))!;
    const player = stepPlayer(initial, still, 1, world({ ...bed, enabled: false }));
    expect(player.y).toBe(0);
    expect(player.supportId).toBeNull();
  });
});

describe("saved room positions", () => {
  it("restores floor and furniture-top positions with a stable grounded state", () => {
    expect(validatePlayerPosition({ x: 3, z: 3 }, world(bed))).toEqual(
      createPlayer(3, 3),
    );
    expect(
      validatePlayerPosition({ x: 0, y: bed.top + 0.001, z: 0 }, world(bed)),
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
      expect(validatePlayerPosition(saved, world(bed))).toBeNull();
    expect(
      validatePlayerPosition({ x: 0, y: bed.top, z: 0 }, world({ ...bed, enabled: false })),
    ).toBeNull();
  });

  it("checks body radius at furniture corners and headroom over saved tops", () => {
    const table = { ...bed, width: 1, depth: 1 };
    expect(positionIsClear(0.6, 0.6, world(table))).toBe(false);
    expect(positionIsClear(0.7, 0.7, world(table))).toBe(true);
    const tooHigh = { ...bed, top: ROOM_CEILING - PLAYER_HEIGHT + 0.1 };
    expect(
      validatePlayerPosition({ x: 0, y: tooHigh.top, z: 0 }, world(tooHigh)),
    ).toBeNull();
    const overhead = { ...desk, id: "overhead", base: 2, top: 2.1 };
    expect(
      validatePlayerPosition({ x: 0, y: bed.top, z: 0 }, world(bed, overhead)),
    ).toBeNull();
  });
});

describe("finite world architecture", () => {
  it("walks through a doorway onto adjacent ground beyond the old room boundary", () => {
    const courtyard: RoomObstacle = {
      ...floor, id: "courtyard", x: 7.4, width: 5.4,
    };
    const doorway = [
      { id: "door-left", x: 4.8, z: -2.35, width: 0.2, depth: 2.7, base: 0, top: 3 },
      { id: "door-right", x: 4.8, z: 2.35, width: 0.2, depth: 2.7, base: 0, top: 3 },
      { id: "door-lintel", x: 4.8, z: 0, width: 0.2, depth: 2, base: 2.8, top: 3 },
    ];
    const solids = [floor, courtyard, ...doorway];
    const player = stepPlayer(createPlayer(4, 0), { x: 1, z: 0 }, 1, solids);
    expect(player.x).toBeCloseTo(6.8);
    expect(player.y).toBe(0);
    expect(player.grounded).toBe(true);
    expect(player.supportId).toBeNull();
    expect(validatePlayerPosition(player, solids)).toEqual(player);
    const blocked = stepPlayer(createPlayer(4, 2), { x: 1, z: 0 }, 1, solids);
    expect(blocked.x).toBeLessThan(4.7);
  });

  it("falls below zero after leaving finite ground instead of landing on an invisible floor", () => {
    const island = { ...floor, width: 2, depth: 2 };
    const player = stepPlayer(createPlayer(0, 0), { x: 1, z: 0 }, 1, [island]);
    expect(player.x).toBeCloseTo(2.8);
    expect(player.y).toBeLessThan(-1);
    expect(player.grounded).toBe(false);
    expect(player.velocityY).toBeLessThan(0);
    expect(validatePlayerPosition({ x: 3, y: 0, z: 0 }, [island])).toBeNull();
    expect(positionIsClear(30, -20, [], -4)).toBe(true);
    const unsupported = stepPlayer(createPlayer(0, 0), still, 0.5, [], true);
    expect(unsupported.y).toBeCloseTo(-1.5);
    expect(unsupported.grounded).toBe(false);
  });

  it.each([-3, 6])("lands and restores on explicit ground at elevation %s", (height) => {
    const terrain = {
      ...floor, id: "terrain", x: 14, z: -12, base: height - 0.3, top: height,
    };
    const falling = {
      ...createPlayer(14, -12), y: height + 2, grounded: false, velocityY: -2,
    };
    const landed = stepPlayer(falling, still, 1, [terrain]);
    expect(landed).toMatchObject({
      x: 14, y: height, z: -12, grounded: true, velocityY: 0, supportId: null,
    });
    expect(validatePlayerPosition({ ...landed, y: height + 0.01 }, [terrain]))
      .toEqual(landed);
    expect(validatePlayerPosition(landed, [{ ...terrain, enabled: false }]))
      .toBeNull();
    const removed = stepPlayer(landed, still, 0.5, [{ ...terrain, enabled: false }]);
    expect(removed.y).toBeLessThan(height);
    expect(removed.grounded).toBe(false);
    const jump = stepPlayer(landed, still, 0.5, [terrain], true);
    expect(jump.y).toBeGreaterThan(height + 1.7);
  });

  it("collides with the actual position of a hinged door, including its rotated leaf", () => {
    const closedDoor: RoomObstacle = {
      id: "door", x: 0, z: 0, width: 1.8, depth: 0.08, base: 0, top: 2.8,
    };
    const openDoor = { ...closedDoor, x: -0.9, z: 0.9, rotationY: -Math.PI / 2 };
    const approach = createPlayer(0, -1.5);
    const stopped = stepPlayer(approach, { x: 0, z: 1 }, 1, [floor, closedDoor]);
    expect(stopped.z).toBeLessThanOrEqual(-0.04 - AVATAR_RADIUS);
    const through = stepPlayer(approach, { x: 0, z: 1 }, 1, [floor, openDoor]);
    expect(through.z).toBeCloseTo(1.3);
    const againstLeaf = stepPlayer(createPlayer(0.5, 0.9), { x: -1, z: 0 }, 1, [floor, openDoor]);
    expect(againstLeaf.x).toBeGreaterThanOrEqual(-0.9 + 0.04 + AVATAR_RADIUS);
    expect(positionIsClear(againstLeaf.x, againstLeaf.z, [openDoor])).toBe(true);
  });

  it("uses the oriented footprint rather than a rotated box's larger enclosing rectangle", () => {
    const diagonal: RoomObstacle = {
      ...bed, x: 7, z: -6, width: 3, depth: 0.08, top: 3,
      rotationY: Math.PI / 4,
    };
    const worldX = diagonal.x + Math.cos(Math.PI / 4);
    const worldZ = diagonal.z - Math.sin(Math.PI / 4);
    expect(obstacleLocalPoint(worldX, worldZ, diagonal).x).toBeCloseTo(1);
    expect(obstacleLocalPoint(worldX, worldZ, diagonal).z).toBeCloseTo(0);
    expect(overlapsObstacle(worldX, worldZ, AVATAR_RADIUS, diagonal)).toBe(true);
    expect(overlapsObstacle(7.8, -5.2, AVATAR_RADIUS, diagonal)).toBe(false);
    expect(overlapsObstacle(worldX, worldZ, AVATAR_RADIUS, { ...diagonal, enabled: false })).toBe(false);
    const ground = { ...floor, x: 7, z: -6 };
    const normal = { x: Math.sin(Math.PI / 4), z: Math.cos(Math.PI / 4) };
    const start = createPlayer(7 - normal.x * 2, -6 - normal.z * 2);
    const blocked = stepPlayer(start, normal, 1, [ground, diagonal]);
    expect(obstacleLocalPoint(blocked.x, blocked.z, diagonal).z)
      .toBeLessThanOrEqual(-diagonal.depth / 2 - AVATAR_RADIUS + 0.000001);
    expect(positionIsClear(blocked.x, blocked.z, [diagonal])).toBe(true);
  });
});
