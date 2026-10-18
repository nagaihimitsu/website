import { describe, expect, it } from "vitest";
import {
  cameraBoomLimit,
  orbitDirection,
  recoverCameraDistance,
  shortestAngle,
} from "../src/room/followCamera";

const origin = { x: 0, y: 1.02, z: 0 };

describe("third-person camera volume", () => {
  it("orbits continuously through a full turn at eye level", () => {
    for (const yaw of [-Math.PI * 2, 0, Math.PI * 2]) {
      const direction = orbitDirection(yaw, 0.16);
      expect(direction.x).toBeCloseTo(0);
      expect(direction.y).toBeCloseTo(Math.sin(0.16));
      expect(direction.z).toBeCloseTo(Math.cos(0.16));
      expect(cameraBoomLimit(origin, direction, 2.75, [])).toBe(2.75);
    }
  });

  it("keeps the near-plane volume inside each wall", () => {
    for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      const direction = orbitDirection(yaw, 0);
      const position = { x: direction.x * 4.5, y: 1.02, z: direction.z * 3.45 };
      const distance = cameraBoomLimit(position, direction, 2.75, []);
      const camera = {
        x: position.x + direction.x * distance,
        z: position.z + direction.z * distance,
      };
      expect(Math.abs(camera.x)).toBeLessThanOrEqual(4.750001);
      expect(Math.abs(camera.z)).toBeLessThanOrEqual(3.750001);
    }
  });

  it("stops before the ceiling during a jump and before the floor when looking upward", () => {
    expect(
      cameraBoomLimit({ ...origin, y: 4.1 }, orbitDirection(0, 1), 3, []),
    ).toBeLessThan(0.35);
    const distance = cameraBoomLimit(origin, orbitDirection(0, -0.48), 3, []);
    expect(origin.y + Math.sin(-0.48) * distance).toBeCloseTo(0.16);
  });

  it("shortens before a furniture edge even when its center ray would miss", () => {
    const cabinet = {
      id: "cabinet",
      x: 0.6,
      z: 1.5,
      width: 1,
      depth: 0.5,
      base: 0,
      top: 2,
    };
    expect(
      cameraBoomLimit(origin, orbitDirection(0, 0), 3, [cabinet]),
    ).toBeCloseTo(1.09);
    expect(
      cameraBoomLimit(origin, orbitDirection(0, 0), 3, [
        { ...cabinet, enabled: false },
      ]),
    ).toBe(3);
  });

  it("can pass above furniture after jumping onto it", () => {
    const desk = {
      id: "desk",
      x: 0,
      z: 0,
      width: 2,
      depth: 1,
      base: 0,
      top: 1.36,
    };
    expect(
      cameraBoomLimit({ ...origin, y: 2.38 }, orbitDirection(0, 0.16), 2.75, [
        desk,
      ]),
    ).toBe(2.75);
  });

  it("avoids instantly and recovers smoothly independently of frame rate", () => {
    expect(recoverCameraDistance(2.75, 0.4, 1 / 60)).toBe(0.4);
    let distance = 0.4;
    for (let i = 0; i < 60; i++)
      distance = recoverCameraDistance(distance, 2.75, 1 / 60);
    expect(distance).toBeCloseTo(recoverCameraDistance(0.4, 2.75, 1));
    expect(distance).toBeLessThan(2.75);
  });

  it("returns behind the character by the shortest arc across the yaw seam", () => {
    expect(shortestAngle(Math.PI - 0.1, -Math.PI + 0.1)).toBeCloseTo(0.2);
  });
});
