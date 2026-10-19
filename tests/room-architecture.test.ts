import { describe, expect, it } from "vitest";
import { overlapsObstacle } from "../src/room/collision";
import {
  architectureLayout,
  architectureObstacle,
  createEntryDoorMotion,
  entryDoorLayout,
  entryDoorPose,
} from "../src/room/roomArchitecture";
import type { RoomObstacle } from "../src/room/types";

const solids = architectureLayout.map(architectureObstacle);
const groundedAt = (x: number, z: number) => solids.some((solid) =>
  solid.support === "ground" && solid.top === 0 &&
  x >= solid.x - solid.width / 2 && x <= solid.x + solid.width / 2 &&
  z >= solid.z - solid.depth / 2 && z <= solid.z + solid.depth / 2,
);

describe("finite room and terrace architecture", () => {
  it("provides continuous ground across the doorway and no invisible ground beyond the terrace", () => {
    for (const z of [3.7, 3.91, 4, 4.05, 4.14, 4.3, 7.7])
      expect(groundedAt(entryDoorLayout.centerX, z), `ground at doorway z=${z}`).toBe(true);
    expect(groundedAt(entryDoorLayout.centerX, 8.5)).toBe(false);
    expect(groundedAt(-2, 6)).toBe(false);
  });

  it("leaves the entry opening clear while its adjoining walls and header remain physical", () => {
    const entry = solids.filter((solid) => solid.id.startsWith("room-wall-entry"));
    const blocks = (x: number, y: number) => entry.some((solid) =>
      y < solid.top && y + 1.28 > solid.base && overlapsObstacle(x, 4.05, 0.22, solid),
    );
    expect(blocks(entryDoorLayout.centerX, 0)).toBe(false);
    expect(blocks(entryDoorLayout.openingLeft - 0.1, 0)).toBe(true);
    expect(blocks(entryDoorLayout.openingRight + 0.1, 0)).toBe(true);
    expect(blocks(entryDoorLayout.centerX, 2)).toBe(true);
  });

  it("makes the ceiling and closed window finite solids, separate from the outdoor air", () => {
    const ceiling = solids.find((solid) => solid.id === "room-ceiling")!;
    const window = solids.find((solid) => solid.id === "room-window")!;
    expect(ceiling.base).toBeCloseTo(4.6);
    expect(overlapsObstacle(0, 0, 0.22, ceiling)).toBe(true);
    expect(overlapsObstacle(2.75, 6, 0.22, ceiling)).toBe(false);
    expect(overlapsObstacle(-4.9, -0.82, 0.22, window)).toBe(true);
    expect(window.base).toBeCloseTo(0.85);
    expect(window.top).toBeCloseTo(3.755);
  });
});

describe("entry door opening", () => {
  function leaf(angle: number): RoomObstacle {
    return {
      id: "entry-door", ...entryDoorPose(angle),
      width: entryDoorLayout.width, depth: entryDoorLayout.depth,
      base: 0, top: entryDoorLayout.height, enabled: true,
    };
  }

  it("keeps the right hinge fixed and moves the solid leaf outside the clear passage", () => {
    for (const angle of [0, Math.PI / 4, Math.PI / 2]) {
      const pose = entryDoorPose(angle);
      expect(pose.x + entryDoorLayout.width / 2 * Math.cos(angle)).toBeCloseTo(entryDoorLayout.hingeX);
      expect(pose.z - entryDoorLayout.width / 2 * Math.sin(angle)).toBeCloseTo(entryDoorLayout.hingeZ);
    }
    expect(overlapsObstacle(2.75, 4.05, 0.22, leaf(0))).toBe(true);
    expect(overlapsObstacle(2.75, 4.05, 0.22, leaf(Math.PI / 2))).toBe(false);
    expect(overlapsObstacle(3.475, 4.7, 0.22, leaf(Math.PI / 2))).toBe(true);
  });

  it("opens once in half a second and ignores repeat punches", () => {
    let angle = -1;
    const motion = createEntryDoorMotion((value) => { angle = value; });
    expect(angle).toBe(0);
    expect(motion.isOpen()).toBe(false);
    expect(motion.open()).toBe(true);
    motion.animate(0.25, false);
    expect(angle).toBeCloseTo(Math.PI / 4);
    expect(motion.open()).toBe(false);
    motion.animate(0.25, false);
    expect(angle).toBeCloseTo(Math.PI / 2);
    expect(motion.isOpen()).toBe(true);
  });

  it.each([false, true])("pauses before a visitor, then resumes without sweeping through them (reduced motion: %s)", (reduced) => {
    let angle = 0;
    let visitorPresent = true;
    const visitor = { x: 2.8, z: 4.65 };
    const motion = createEntryDoorMotion(
      (value) => { angle = value; },
      (value) => visitorPresent && overlapsObstacle(visitor.x, visitor.z, 0.22, leaf(value)),
    );
    motion.open();
    motion.animate(0.5, reduced);
    expect(angle).toBeGreaterThan(0);
    expect(angle).toBeLessThan(Math.PI / 2);
    expect(overlapsObstacle(visitor.x, visitor.z, 0.22, leaf(angle))).toBe(false);
    visitorPresent = false;
    motion.animate(0.5, reduced);
    expect(angle).toBeCloseTo(Math.PI / 2);
  });

  it("restores an already opened leaf immediately before a saved visitor is validated", () => {
    let angle = 0;
    const motion = createEntryDoorMotion((value) => { angle = value; }, () => true);
    expect(motion.open(true)).toBe(true);
    expect(angle).toBeCloseTo(Math.PI / 2);
    expect(motion.open()).toBe(false);
  });
});
