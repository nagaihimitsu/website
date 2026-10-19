import { describe, expect, it } from "vitest";
import {
  cameraBoomLimit,
  orbitDirection,
  recoverCameraDistance,
  shortestAngle,
} from "../src/room/followCamera";
import type { RoomObstacle } from "../src/room/types";

const origin = { x: 0, y: 1.02, z: 0 };
const architecture: RoomObstacle[] = [
  { id: "floor", x: 0, z: 0, width: 10.18, depth: 8.18, base: -0.2, top: 0, support: "ground" },
  { id: "roof", x: 0, z: 0, width: 10.18, depth: 8.18, base: 4.55, top: 4.75 },
  ...[-1, 1].flatMap((side) => [
    { id: `wall-x-${side}`, x: side * 5, z: 0, width: 0.18, depth: 8.18, base: 0, top: 4.55 },
    { id: `wall-z-${side}`, x: 0, z: side * 4, width: 10.18, depth: 0.18, base: 0, top: 4.55 },
  ]),
];

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
      const distance = cameraBoomLimit(position, direction, 2.75, architecture);
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
      cameraBoomLimit({ ...origin, y: 4.1 }, orbitDirection(0, 1), 3, architecture),
    ).toBeLessThan(0.35);
    const distance = cameraBoomLimit(origin, orbitDirection(0, -0.48), 3, architecture);
    expect(origin.y + Math.sin(-0.48) * distance).toBeCloseTo(0.16);
  });

  it("follows outside the former room bounds without inventing a ceiling or a floor", () => {
    const outside = { x: 0, y: 4.1, z: 7 };
    expect(cameraBoomLimit(outside, orbitDirection(0, 1), 3, architecture)).toBe(3);
    expect(cameraBoomLimit(outside, orbitDirection(0, 0), 3, architecture)).toBe(3);
    expect(cameraBoomLimit(outside, { x: 0, y: -1, z: 0 }, 6, architecture)).toBe(6);
    const terrace: RoomObstacle = {
      id: "terrace", x: 0, z: 7, width: 6, depth: 4, base: -0.2, top: 0, support: "ground",
    };
    expect(cameraBoomLimit(outside, { x: 0, y: -1, z: 0 }, 6, [terrace])).toBeCloseTo(3.94);
  });

  it("clears an opened doorway but still stops against the rotated door leaf", () => {
    const closed: RoomObstacle = {
      id: "door", x: 0, z: 1.5, width: 1.8, depth: 0.12, base: 0, top: 2.4,
    };
    const open = { ...closed, x: -0.9, z: 0.6, rotationY: Math.PI / 2 };
    expect(cameraBoomLimit(origin, orbitDirection(0, 0), 3, [closed])).toBeCloseTo(1.28);
    expect(cameraBoomLimit(origin, orbitDirection(0, 0), 3, [open])).toBe(3);
    expect(cameraBoomLimit({ x: -0.9, y: 1.02, z: -0.8 }, orbitDirection(0, 0), 3, [open])).toBeCloseTo(0.34);

    // A partially open leaf uses the same Three.js yaw convention, not only
    // the axis-aligned closed and fully open positions.
    const yaw = -Math.PI / 4;
    const diagonal = { ...closed, rotationY: yaw };
    expect(cameraBoomLimit(
      { x: closed.x - Math.sin(yaw) * 2, y: 1.02, z: closed.z - Math.cos(yaw) * 2 },
      { x: Math.sin(yaw), y: 0, z: Math.cos(yaw) }, 3, [diagonal],
    )).toBeCloseTo(1.78);
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
