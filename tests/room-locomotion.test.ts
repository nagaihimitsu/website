import { describe, expect, it } from "vitest";
import {
  cameraRelativeInput,
  smoothLocomotion,
  stickInput,
} from "../src/room/locomotion";

describe("camera-relative analog movement", () => {
  it("pulling the stick down walks toward the viewer at every camera azimuth", () => {
    const down = stickInput(0, 48, 42);
    expect(down).toEqual({ x: 0, z: 1 });
    for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2, 2.4]) {
      const travel = cameraRelativeInput(down, yaw);
      // The camera's horizontal boom points from the character toward the viewer.
      expect(travel.x).toBeCloseTo(Math.sin(yaw), 12);
      expect(travel.z).toBeCloseTo(Math.cos(yaw), 12);
      expect(Math.hypot(travel.x, travel.z)).toBeCloseTo(1, 12);
    }
  });

  it("uses the same walk/run range in every direction, without faster diagonals", () => {
    for (const angle of [0, Math.PI / 4, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      const gentle = stickInput(18 * Math.cos(angle), 18 * Math.sin(angle), 42);
      const full = stickInput(60 * Math.cos(angle), 60 * Math.sin(angle), 42);
      expect(Math.hypot(gentle.x, gentle.z)).toBeCloseTo(
        (18 / 42 - 0.12) / 0.88,
        12,
      );
      expect(Math.hypot(full.x, full.z)).toBeCloseTo(1, 12);
      expect(gentle.x * full.z - gentle.z * full.x).toBeCloseTo(0, 12);
    }
  });

  it("a centered or invalid stick cannot creep", () => {
    for (const point of [
      [0, 0, 42],
      [1, 3, 42],
      [0, 48, 0],
      [NaN, 0, 42],
    ])
      expect(stickInput(point[0], point[1], point[2])).toEqual({ x: 0, z: 0 });
  });
});

describe("responsive start and release", () => {
  it("travels the same distance at 15, 30 and 60fps, including a full reversal", () => {
    function travel(fps: number) {
      let velocity = { x: 0, z: 0 };
      let distance = 0;
      for (const targetZ of [-1, 1, 0]) {
        for (let frame = 0; frame < fps; frame++) {
          const result = smoothLocomotion(
            velocity,
            { x: 0, z: targetZ },
            1 / fps,
          );
          velocity = result.velocity;
          distance += (result.average.z * 2.8) / fps;
        }
      }
      return { distance, velocity };
    }
    const baseline = travel(60);
    for (const fps of [15, 30]) {
      const result = travel(fps);
      expect(result.distance).toBeCloseTo(baseline.distance, 4);
      expect(result.velocity).toEqual({ x: 0, z: 0 });
    }
  });

  it("starts gently, reverses toward the requested direction and stops without sliding", () => {
    const start = smoothLocomotion({ x: 0, z: 0 }, { x: 0, z: -1 }, 1 / 60);
    expect(start.average.z).toBeLessThan(0);
    expect(start.average.z).toBeGreaterThan(-0.2);
    const reverse = smoothLocomotion({ x: 0, z: -1 }, { x: 0, z: 1 }, 0.25);
    expect(reverse.velocity.z).toBeGreaterThan(0.94);
    const release = smoothLocomotion({ x: 0, z: 1 }, { x: 0, z: 0 }, 0.5);
    expect(release.velocity).toEqual({ x: 0, z: 0 });
    expect(release.average.z * 0.5 * 2.8).toBeLessThanOrEqual(0.112);
    const remainingAfter150ms = 0.04 * 2.8 * Math.exp(-0.15 / 0.04);
    expect(remainingAfter150ms).toBeLessThan(0.003);
  });
});
