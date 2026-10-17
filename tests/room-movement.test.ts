import { describe, expect, it } from "vitest";
import {
  AVATAR_RADIUS,
  ROOM_LIMITS,
  movementVector,
  positionIsClear,
  sampleJump,
  walkStep,
} from "../src/room/movement";

describe("room movement", () => {
  it("moves relative to the southeast camera and normalizes diagonals", () => {
    const up = movementVector(new Set(["up"]));
    expect(up.x).toBeLessThan(0);
    expect(up.z).toBeLessThan(0);
    const right = movementVector(new Set(["right"]));
    expect(right.x).toBeGreaterThan(0);
    expect(right.z).toBeLessThan(0);
    const diagonal = movementVector(new Set(["up", "right"]));
    expect(Math.hypot(diagonal.x, diagonal.z)).toBeCloseTo(1);
    expect(movementVector(new Set(["up", "down", "left", "right"]))).toEqual({
      x: 0,
      z: 0,
    });
  });

  it("keeps the entire avatar inside the walls", () => {
    const next = walkStep({ x: 0, z: 0 }, { x: 20, z: -20 }, []);
    expect(next.x).toBeCloseTo(ROOM_LIMITS.maxX - AVATAR_RADIUS);
    expect(next.z).toBeCloseTo(ROOM_LIMITS.minZ + AVATAR_RADIUS);
    expect(positionIsClear(NaN, 0, [])).toBe(false);
    expect(positionIsClear(Infinity, 0, [])).toBe(false);
    expect(positionIsClear(4.6, 0, [])).toBe(false);
  });

  it("cannot tunnel through narrow furniture after a large movement", () => {
    const divider = [{ x: 0, z: 0, width: 0.1, depth: 3 }];
    const next = walkStep({ x: -2, z: 0 }, { x: 4, z: 0 }, divider);
    expect(next.x).toBeLessThanOrEqual(-0.05 - AVATAR_RADIUS);
    expect(next.x).toBeGreaterThan(-0.5);
    expect(positionIsClear(next.x, next.z, divider)).toBe(true);
  });

  it("slides along furniture instead of trapping diagonal movement", () => {
    const cabinet = [{ x: 0, z: 0, width: 1, depth: 3 }];
    const next = walkStep({ x: -0.75, z: -1 }, { x: 1, z: 1 }, cabinet);
    expect(next.x).toBeLessThanOrEqual(-0.5 - AVATAR_RADIUS);
    expect(next.z).toBeCloseTo(0);
    expect(positionIsClear(next.x, next.z, cabinet)).toBe(true);
  });

  it("checks the circular avatar at furniture corners for session restores", () => {
    const table = [{ x: 0, z: 0, width: 1, depth: 1 }];
    expect(positionIsClear(0, 0, table)).toBe(false);
    expect(positionIsClear(0.6, 0.6, table)).toBe(false);
    expect(positionIsClear(0.7, 0.7, table)).toBe(true);
  });
});

describe("room jump timing", () => {
  it("lands during the first second at 2, 15 and 60 frames per second", () => {
    for (const framesPerSecond of [2, 15, 60]) {
      const samples = Array.from(
        { length: framesPerSecond + 1 },
        (_, frame) => ({
          elapsed: frame / framesPerSecond,
          ...sampleJump(frame / framesPerSecond),
        }),
      );
      expect(samples[0]).toMatchObject({ height: 0, landed: false });
      expect(
        Math.max(...samples.map((sample) => sample.height)),
      ).toBeGreaterThan(0.6);
      const landing = samples.find((sample) => sample.landed)!;
      expect(landing.elapsed).toBeGreaterThan(0.7);
      expect(landing.elapsed).toBeLessThanOrEqual(0.8 + 1 / framesPerSecond);
      expect(samples.at(-1)).toMatchObject({ height: 0, landed: true });
    }
  });

  it("finishes on the next frame after a long stall instead of stretching the jump", () => {
    const samples = [0, 0.1, 0.2, 5].map(sampleJump);
    expect(samples[2].height).toBeGreaterThan(samples[1].height);
    expect(samples.at(-1)).toEqual({ height: 0, landed: true });
    expect(samples.every((sample) => sample.height >= 0)).toBe(true);
    // Sampling again after the landing never starts another jump.
    expect(sampleJump(8)).toEqual({ height: 0, landed: true });
  });
});
