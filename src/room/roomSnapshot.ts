import { INITIAL_PLAYER_POSITION } from "./followCamera";
import type { RoomSnapshot } from "./types";

export const INITIAL_ROOM_SNAPSHOT: Readonly<RoomSnapshot> = {
  x: INITIAL_PLAYER_POSITION.x,
  z: INITIAL_PLAYER_POSITION.z,
  height: 0,
  moving: false,
  grounded: true,
  supportId: null,
  yaw: 0,
  pitch: 0,
  facing: 0,
  cameraDistance: 2.75,
  cameraX: 0,
  cameraY: 0,
  cameraZ: 0,
  punching: false,
  brokenCount: 0,
  birdX: 0,
  birdZ: 0,
  birdHeight: 0,
  birdMoving: false,
};

/** Preserve the public diagnostics used by browser checks without React renders. */
export function writeRoomDiagnostics(
  element: Pick<HTMLElement, "dataset">,
  snapshot: Readonly<RoomSnapshot>,
) {
  const attributes = {
    playerX: snapshot.x.toFixed(3),
    playerZ: snapshot.z.toFixed(3),
    playerHeight: snapshot.height.toFixed(3),
    grounded: String(snapshot.grounded),
    supportId: snapshot.supportId ?? "",
    yaw: snapshot.yaw.toFixed(3),
    pitch: snapshot.pitch.toFixed(3),
    facing: snapshot.facing.toFixed(3),
    cameraDistance: snapshot.cameraDistance.toFixed(3),
    cameraX: snapshot.cameraX.toFixed(3),
    cameraY: snapshot.cameraY.toFixed(3),
    cameraZ: snapshot.cameraZ.toFixed(3),
    punching: String(snapshot.punching),
    brokenCount: String(snapshot.brokenCount),
    birdX: snapshot.birdX.toFixed(3),
    birdZ: snapshot.birdZ.toFixed(3),
    birdHeight: snapshot.birdHeight.toFixed(3),
    birdMoving: String(snapshot.birdMoving),
  };
  for (const [name, value] of Object.entries(attributes)) {
    if (element.dataset[name] !== value) element.dataset[name] = value;
  }
}

/** Only the punch indicator needs to update React when an engine snapshot arrives. */
export function createRoomSnapshotReporter(
  element: Pick<HTMLElement, "dataset">,
  onPunchingChange: (punching: boolean) => void,
) {
  let punching: boolean | undefined;
  const report = (snapshot: Readonly<RoomSnapshot>) => {
    writeRoomDiagnostics(element, snapshot);
    if (punching !== snapshot.punching) {
      punching = snapshot.punching;
      onPunchingChange(punching);
    }
  };
  report(INITIAL_ROOM_SNAPSHOT);
  return report;
}
