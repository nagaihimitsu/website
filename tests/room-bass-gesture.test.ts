import { describe, expect, it } from "vitest";
import { createBassGesture } from "../src/room/bassGesture";

const start = { pointerId: 1, string: 2 as const, x: 100, y: 200, time: 0 };
const point = (x: number, y: number, time: number, pointerId = 1) => ({ pointerId, x, y, time });

describe("bass picking gestures", () => {
  it("waits until a short tap ends, then emits one pick on its captured string", () => {
    const gesture = createBassGesture();
    expect(gesture.begin(start)).toBe(true);
    expect(gesture.move(point(106, 205, 80))).toBeNull();
    expect(gesture.end(point(100, 200, 220))).toEqual({ string: 2, technique: "pick" });
    expect(gesture.end(point(100, 200, 220))).toBeNull();
  });

  it("emits one upward slap while moving and retains the starting string across rows", () => {
    const gesture = createBassGesture();
    gesture.begin({ ...start, string: 3 });
    expect(gesture.move(point(102, 180, 80))).toBeNull();
    expect(gesture.move(point(105, 170, 120))).toEqual({ string: 3, technique: "slap" });
    expect(gesture.move(point(105, 20, 160))).toBeNull();
    expect(gesture.end(point(100, 200, 180))).toBeNull();
  });

  it("recognizes a final upward sample on release without requiring a preceding move", () => {
    const gesture = createBassGesture();
    gesture.begin(start);
    expect(gesture.end(point(100, 176, 250))).toEqual({ string: 2, technique: "slap" });
    expect(gesture.end(point(100, 176, 251))).toBeNull();
  });

  it("accepts a downward slap with the same thresholds and one emission", () => {
    const gesture = createBassGesture();
    gesture.begin(start);
    expect(gesture.move(point(102, 230, 100))).toEqual({ string: 2, technique: "slap" });
    expect(gesture.move(point(102, 260, 150))).toBeNull();
    expect(gesture.end(point(102, 260, 160))).toBeNull();
  });

  it("ignores additional fingers without cancelling or stealing the first contact", () => {
    const gesture = createBassGesture();
    gesture.begin(start);
    expect(gesture.begin({ ...start, pointerId: 2, string: 0 })).toBe(false);
    expect(gesture.move(point(100, 100, 40, 2))).toBeNull();
    expect(gesture.end(point(100, 100, 60, 2))).toBeNull();
    gesture.cancel(2);
    expect(gesture.end(point(100, 200, 100))).toEqual({ string: 2, technique: "pick" });
  });

  it.each([
    ["long press", 100, 200, 221],
    ["slow upward swipe", 100, 170, 251],
    ["horizontal swipe", 150, 200, 100],
    ["diagonal swipe without enough upward motion", 130, 170, 100],
  ])("does not turn a %s into a pick", (_name, x, y, time) => {
    const gesture = createBassGesture();
    gesture.begin(start);
    expect(gesture.move(point(x as number, y as number, time as number))).toBeNull();
    expect(gesture.end(point(x as number, y as number, (time as number) + 1))).toBeNull();
  });

  it.each([[120, 200], [100, 220], [100, 180]])(
    "remembers an excursion to %s, %s even after the finger returns to the start", (x, y) => {
      const gesture = createBassGesture();
      gesture.begin(start);
      expect(gesture.move(point(x, y, 60))).toBeNull();
      expect(gesture.end(point(100, 200, 100))).toBeNull();
    },
  );

  it("allows small tap jitter but requires an upward-dominant swipe", () => {
    const gesture = createBassGesture();
    gesture.begin(start);
    expect(gesture.end(point(112, 200, 150))).toEqual({ string: 2, technique: "pick" });
    gesture.begin(start);
    expect(gesture.move(point(120, 173, 150))).toEqual({ string: 2, technique: "slap" });
  });

  it.each(["cancel", "reset"] as const)("%s abandons a contact and permits a fresh one", (action) => {
    const gesture = createBassGesture();
    gesture.begin(start);
    gesture.move(point(101, 198, 40));
    if (action === "cancel") gesture.cancel(1);
    else gesture.reset();
    expect(gesture.end(point(100, 200, 100))).toBeNull();
    expect(gesture.begin({ ...start, pointerId: 3 })).toBe(true);
    expect(gesture.end(point(100, 200, 100, 3))).toEqual({ string: 2, technique: "pick" });
  });

  it("rejects non-finite samples and backwards time without producing input", () => {
    const gesture = createBassGesture();
    expect(gesture.begin({ ...start, x: NaN })).toBe(false);
    expect(gesture.begin({ ...start, time: Infinity })).toBe(false);
    gesture.begin(start);
    expect(gesture.move(point(Infinity, 200, 60))).toBeNull();
    expect(gesture.end(point(100, 200, 100))).toBeNull();
    gesture.begin({ ...start, time: 100 });
    expect(gesture.move(point(100, 200, 150))).toBeNull();
    expect(gesture.end(point(100, 200, 140))).toBeNull();
  });
});
