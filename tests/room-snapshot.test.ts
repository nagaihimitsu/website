import { describe, expect, it } from "vitest";
import {
  createRoomSnapshotReporter,
  INITIAL_ROOM_SNAPSHOT,
} from "../src/room/roomSnapshot";

// The engine's diagnostic DOM contract remains available to the browser tests;
// position-only updates must not schedule React updates for the room controls.
describe("room snapshot reporting", () => {
  it("keeps live player, camera and bird diagnostics while only notifying visible punch changes", () => {
    const element = { dataset: {} as DOMStringMap };
    const punchChanges: boolean[] = [];
    const report = createRoomSnapshotReporter(element, (value) => punchChanges.push(value));
    expect(element.dataset.playerX).toBe(INITIAL_ROOM_SNAPSHOT.x.toFixed(3));
    expect(element.dataset.supportId).toBe("");
    expect(element.dataset.grounded).toBe("true");
    expect(punchChanges).toEqual([false]);

    for (let tick = 1; tick <= 100; tick++) {
      report({
        ...INITIAL_ROOM_SNAPSHOT,
        x: tick / 10,
        z: -1.25,
        height: 0.635,
        supportId: "coffee-table",
        yaw: 0.56789,
        pitch: -0.24681,
        facing: 1.11111,
        cameraDistance: 2.12567,
        cameraX: 2.11111,
        cameraY: 3.22222,
        cameraZ: 4.33333,
        brokenCount: 2,
        birdX: tick / 20,
        birdZ: -1.5,
        birdHeight: 0.12345,
        birdMoving: true,
      });
    }
    expect(element.dataset).toEqual({
      playerX: "10.000", playerZ: "-1.250", playerHeight: "0.635",
      grounded: "true", supportId: "coffee-table",
      yaw: "0.568", pitch: "-0.247", facing: "1.111",
      cameraDistance: "2.126", cameraX: "2.111", cameraY: "3.222", cameraZ: "4.333",
      punching: "false", brokenCount: "2",
      birdX: "5.000", birdZ: "-1.500", birdHeight: "0.123", birdMoving: "true",
    });
    expect(punchChanges).toEqual([false]);

    report({ ...INITIAL_ROOM_SNAPSHOT, punching: true });
    report({ ...INITIAL_ROOM_SNAPSHOT, punching: true, x: 2 });
    report(INITIAL_ROOM_SNAPSHOT);
    expect(punchChanges).toEqual([false, true, false]);
    expect(element.dataset.supportId).toBe("");
    expect(element.dataset.punching).toBe("false");
  });

  it("does not rewrite diagnostic attributes that have not changed", () => {
    let writes = 0;
    const element = {
      dataset: new Proxy({} as DOMStringMap, {
        set(target, key, value) {
          writes++;
          return Reflect.set(target, key, value);
        },
      }),
    };
    const report = createRoomSnapshotReporter(element, () => {});
    const initialWrites = writes;
    report(INITIAL_ROOM_SNAPSHOT);
    expect(writes).toBe(initialWrites);
    report({ ...INITIAL_ROOM_SNAPSHOT, x: 1.23456 });
    expect(writes).toBe(initialWrites + 1);
    expect(element.dataset.playerX).toBe("1.235");
  });
});
