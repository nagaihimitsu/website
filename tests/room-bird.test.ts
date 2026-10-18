import { describe, expect, it } from "vitest";
import { BIRD_COLLIDER_ID, BIRD_RADIUS, createBirdMotion } from "../src/room/birdMotion";
import { AVATAR_RADIUS, ROOM_LIMITS, createPlayer, stepPlayer } from "../src/room/movement";
import type { RoomObstacle } from "../src/room/types";

const furniture: RoomObstacle[] = [
  { id: "bed", x: -3.35, z: -1.85, width: 2.25, depth: 3.6, base: 0, top: 1.03 },
  { id: "desk", x: 3.18, z: -2.67, width: 2.92, depth: 1.42, base: 0, top: 1.36 },
  { id: "sofa", x: -2.9, z: 2.16, width: 1.32, depth: 2.85, base: 0, top: 0.8 },
  { id: "table", x: -0.15, z: 1.88, width: 1.7, depth: 1.14, base: 0, top: 0.635 },
  { id: "blocks", x: -0.8, z: -1, width: 0.5, depth: 0.45, base: 0, top: 0.6 },
];

function distanceToRectangle(x: number, z: number, box: RoomObstacle) {
  return Math.hypot(
    Math.max(0, Math.abs(x - box.x) - box.width / 2),
    Math.max(0, Math.abs(z - box.z) - box.depth / 2),
  );
}

describe("room bird companion", () => {
  it("spawns clear of furniture and restored player positions, and ignores its own collider", () => {
    const player = createPlayer(0.05, -1.45);
    const bird = createBirdMotion(furniture, player);
    expect(distanceToRectangle(player.x, player.z, bird.collider)).toBeGreaterThan(AVATAR_RADIUS);
    for (const obstacle of furniture)
      expect(distanceToRectangle(bird.state.x, bird.state.z, obstacle)).toBeGreaterThan(BIRD_RADIUS);
    const sceneObstacles = [...furniture];
    const withOwnCollider = createBirdMotion(sceneObstacles);
    sceneObstacles.push(withOwnCollider.collider);
    for (let frame = 0; frame < 300; frame++) withOwnCollider.update(1 / 60, createPlayer(), false);
    expect(Math.hypot(withOwnCollider.state.x - 0.05, withOwnCollider.state.z + 1.45)).toBeGreaterThan(0.1);
    expect(withOwnCollider.collider.id).toBe(BIRD_COLLIDER_ID);
  });

  it("makes small hops and pauses while roaming within walls and outside furniture", () => {
    const player = createPlayer();
    const bird = createBirdMotion(furniture, player);
    let highest = 0;
    let hops = 0;
    let rests = 0;
    let furthest = 0;
    for (let frame = 0; frame < 15 * 120; frame++) {
      const wasMoving = bird.state.moving;
      bird.update(1 / 15, player, false);
      const { x, y, z, moving } = bird.state;
      if (!wasMoving && moving) hops++;
      if (wasMoving && !moving) rests++;
      highest = Math.max(highest, y);
      furthest = Math.max(furthest, Math.hypot(x - 0.05, z + 1.45));
      expect(x).toBeGreaterThanOrEqual(ROOM_LIMITS.minX + BIRD_RADIUS);
      expect(x).toBeLessThanOrEqual(ROOM_LIMITS.maxX - BIRD_RADIUS);
      expect(z).toBeGreaterThanOrEqual(ROOM_LIMITS.minZ + BIRD_RADIUS);
      expect(z).toBeLessThanOrEqual(ROOM_LIMITS.maxZ - BIRD_RADIUS);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(0.135);
      for (const obstacle of furniture)
        expect(distanceToRectangle(x, z, obstacle)).toBeGreaterThanOrEqual(BIRD_RADIUS);
      expect(distanceToRectangle(player.x, player.z, bird.collider)).toBeGreaterThanOrEqual(AVATAR_RADIUS);
      expect(bird.collider.x).toBe(x);
      expect(bird.collider.z).toBe(z);
    }
    expect(highest).toBeGreaterThan(0.1);
    expect(furthest).toBeGreaterThan(2);
    expect(hops).toBeGreaterThan(30);
    expect(rests).toBeGreaterThan(30);
  });

  it("sweeps thin obstacles, ignores removed props, and fits beneath high surfaces", () => {
    const divider = { id: "thin-leg", x: 0, z: 0, width: 0.01, depth: 7.4, base: 0, top: 0.03 };
    const player = createPlayer(4, 0);
    const options = { spawn: { x: -1, z: 0 }, random: () => 0.5 };
    const blocked = createBirdMotion([divider], player, options);
    const removed = createBirdMotion([{ ...divider, enabled: false }], player, options);
    const overhead = createBirdMotion([{ ...divider, base: 0.8, top: 0.9 }], player, options);
    for (let frame = 0; frame < 24; frame++) {
      blocked.update(0.5, player, false);
      removed.update(0.5, player, false);
      overhead.update(0.5, player, false);
      expect(blocked.state.x).toBeLessThanOrEqual(-BIRD_RADIUS - 0.005);
    }
    expect(removed.state.x).toBeGreaterThan(0);
    expect(overhead.state.x).toBe(removed.state.x);
  });

  it("blocks a player walking directly into it and never moves its collider into the player", () => {
    let player = createPlayer(1, 0);
    const obstacles: RoomObstacle[] = [];
    const bird = createBirdMotion(obstacles, player, { spawn: { x: 0, z: 0 } });
    obstacles.push(bird.collider);
    for (let frame = 0; frame < 600; frame++) {
      bird.update(1 / 60, player, false);
      const dx = bird.state.x - player.x;
      const dz = bird.state.z - player.z;
      const distance = Math.hypot(dx, dz);
      player = stepPlayer(player, { x: dx / distance, z: dz / distance }, 1 / 60, obstacles);
      expect(distanceToRectangle(player.x, player.z, bird.collider)).toBeGreaterThanOrEqual(AVATAR_RADIUS - 1e-6);
    }
    expect(player.x).toBeGreaterThan(bird.collider.x + BIRD_RADIUS);
  });

  it("settles in place if the player lands above it, without sliding its support away", () => {
    const bird = createBirdMotion([]);
    bird.update(0.9, createPlayer(), false);
    expect(bird.state.moving).toBe(true);
    const x = bird.state.x;
    const z = bird.state.z;
    const above = { ...createPlayer(x, z), y: bird.collider.top, supportId: bird.collider.id };
    for (let frame = 0; frame < 180; frame++) bird.update(1 / 60, above, false);
    expect(bird.state.x).toBe(x);
    expect(bird.state.z).toBe(z);
    expect(bird.state.y).toBe(0);
    expect(bird.state.hopPhase).toBeNull();
  });

  it("finishes a hop before resting for reduced motion, and resumes without a phase jump", () => {
    const bird = createBirdMotion([]);
    const player = createPlayer();
    bird.update(0.85, player, false);
    const before = { ...bird.state };
    expect(before.y).toBeGreaterThan(0);
    bird.update(1 / 120, player, true);
    expect(bird.state.y).toBeGreaterThan(0);
    expect(Math.abs(bird.state.y - before.y)).toBeLessThan(0.01);
    bird.update(1, player, true);
    expect(bird.state.y).toBe(0);
    expect(bird.state.hopPhase).toBeNull();
    const rested = { ...bird.state };
    expect(bird.update(1, player, true)).toBe(false);
    expect(bird.state).toEqual(rested);
    bird.update(0.1, player, false);
    expect(bird.state).toEqual(rested);
    for (let frame = 0; frame < 180; frame++) bird.update(1 / 60, player, false);
    expect(Math.hypot(bird.state.x - rested.x, bird.state.z - rested.z)).toBeGreaterThan(0.1);
  });

  it("follows the same route at 2, 15 and 60 FPS and bounds a resumed tab's elapsed time", () => {
    const player = createPlayer();
    const states = [2, 15, 60].map((fps) => {
      const bird = createBirdMotion(furniture, player);
      for (let frame = 0; frame < fps * 30; frame++) bird.update(1 / fps, player, false);
      return { ...bird.state };
    });
    expect(states[0]).toEqual(states[1]);
    expect(states[1]).toEqual(states[2]);
    const resumed = createBirdMotion([]);
    const normal = createBirdMotion([]);
    resumed.update(3600, player, false);
    normal.update(1, player, false);
    expect(resumed.state).toEqual(normal.state);
    const before = { ...normal.state };
    for (const invalid of [NaN, Infinity, -1]) expect(normal.update(invalid, player, false)).toBe(false);
    expect(normal.state).toEqual(before);
  });
});
