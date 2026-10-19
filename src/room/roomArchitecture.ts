import type { RoomObstacle } from "./types";

type Point = readonly [number, number, number];
type ArchitectureMaterial = "wall" | "woodDark" | "terrace" | "ceiling";

export interface ArchitecturePart {
  readonly id: string;
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  readonly position: Point;
  readonly material: ArchitectureMaterial;
  readonly support?: "ground" | "platform";
  /** The closed window already has its sky/glass surface in the window model. */
  readonly visible?: boolean;
}

const part = (
  id: string,
  width: number,
  height: number,
  depth: number,
  position: Point,
  material: ArchitectureMaterial,
  support?: "ground" | "platform",
): ArchitecturePart => ({ id, width, height, depth, position, material, support });

/** The bird's indoor habitat is independent of the visitor's walkable world. */
export const ROOM_BIRD_HABITAT = {
  minX: -4.7,
  maxX: 4.7,
  minZ: -3.7,
  maxZ: 3.7,
} as const;

export const worldRecovery = {
  position: { x: 0.95, y: 0, z: -0.45 },
  fallBelow: -6,
} as const;

export const entryDoorLayout = {
  centerX: 2.75,
  hingeX: 3.475,
  hingeZ: 3.91,
  width: 1.45,
  height: 2.8,
  depth: 0.09,
  openingLeft: 2.005,
  openingRight: 3.495,
  openingTop: 2.865,
  duration: 0.5,
} as const;

const roomWall = { left: -5.1, right: 5.1, base: -0.045, top: 4.605, z: 4.05 };
const entryWallPart = (id: string, left: number, right: number, base: number, top: number) =>
  part(id, right - left, top - base, 0.18, [(left + right) / 2, (base + top) / 2, roomWall.z], "wall");

// These finite solids build both the architecture and its physical surfaces.
// There is no enclosing world rectangle or invisible floor outside these parts.
export const architectureLayout = [
  part("room-floor", 10, 0.09, 8, [0, -0.045, 0], "woodDark", "ground"),
  part("room-wall-rear", 10.2, 4.65, 0.18, [0, 2.28, -4.05], "wall"),
  part("room-wall-left-rear", 0.18, 4.65, 1.1, [-5.05, 2.28, -3.5], "wall"),
  part("room-wall-left-front", 0.18, 4.65, 2.65, [-5.05, 2.28, 2.72], "wall"),
  part("room-wall-window-bottom", 0.18, 0.9, 4.25, [-5.05, 0.4, -0.85], "wall"),
  part("room-wall-window-top", 0.18, 0.85, 4.25, [-5.05, 4.18, -0.85], "wall"),
  {
    ...part("room-window", 0.18, 2.905, 4.345, [-5.05, 2.3025, -0.7775], "wall"),
    visible: false,
  },
  part("room-wall-right", 0.18, 4.65, 8.2, [5.05, 2.28, 0], "wall"),
  entryWallPart("room-wall-entry-left", roomWall.left, entryDoorLayout.openingLeft, roomWall.base, roomWall.top),
  entryWallPart("room-wall-entry-right", entryDoorLayout.openingRight, roomWall.right, roomWall.base, roomWall.top),
  entryWallPart("room-wall-entry-header", entryDoorLayout.openingLeft, entryDoorLayout.openingRight,
    entryDoorLayout.openingTop, roomWall.top),
  part("room-ceiling", 10.2, 0.14, 8.2, [0, 4.67, 0], "ceiling"),
  part("terrace-floor", 5.36, 0.24, 4.24, [2.6, -0.12, 6.02], "terrace", "ground"),
  part("terrace-wall-left", 0.16, 0.8, 4.18, [0, 0.38, 6.05], "wall"),
  part("terrace-wall-right", 0.16, 0.8, 4.18, [5.2, 0.38, 6.05], "wall"),
  part("terrace-wall-end", 5.36, 0.8, 0.16, [2.6, 0.38, 8.06], "wall"),
] as const satisfies readonly ArchitecturePart[];

export function architectureObstacle(value: ArchitecturePart): RoomObstacle {
  return {
    id: value.id,
    x: value.position[0],
    z: value.position[2],
    width: value.width,
    depth: value.depth,
    base: value.position[1] - value.height / 2,
    top: value.position[1] + value.height / 2,
    support: value.support,
    enabled: true,
  };
}

/** Exact leaf position, shared by the hinged mesh and its oriented collider. */
export function entryDoorPose(angle: number) {
  return {
    x: entryDoorLayout.hingeX - (entryDoorLayout.width / 2) * Math.cos(angle),
    z: entryDoorLayout.hingeZ + (entryDoorLayout.width / 2) * Math.sin(angle),
    rotationY: angle,
  };
}

/** A single opening gesture; repeated punches cannot restart or close the door. */
export function createEntryDoorMotion(
  apply: (angle: number) => void,
  blocked: (angle: number) => boolean = () => false,
) {
  let requested = false;
  let elapsed = 0;
  apply(0);
  return {
    open(immediate = false) {
      if (requested) return false;
      requested = true;
      if (immediate) {
        elapsed = entryDoorLayout.duration;
        apply(Math.PI / 2);
      }
      return true;
    },
    isOpen: () => requested,
    animate(delta: number, reducedMotion: boolean) {
      if (!requested || elapsed >= entryDoorLayout.duration) return;
      const wanted = reducedMotion
        ? entryDoorLayout.duration
        : Math.min(
            entryDoorLayout.duration,
            elapsed + (Number.isFinite(delta) ? Math.max(0, delta) : 0),
          );
      // Sweep even with reduced motion: the leaf must never teleport through
      // a visitor standing on the terrace. Resume when that space clears.
      while (elapsed < wanted) {
        const next = Math.min(wanted, elapsed + 1 / 240);
        const t = next / entryDoorLayout.duration;
        const angle = (Math.PI / 2) * t * t * (3 - 2 * t);
        if (blocked(angle)) break;
        elapsed = next;
        apply(angle);
      }
    },
  };
}
