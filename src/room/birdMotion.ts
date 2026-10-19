import { obstacleLocalPoint, overlapsObstacle } from "./collision";
import { AVATAR_RADIUS, createPlayer, type RoomPlayer } from "./movement";
import { ROOM_BIRD_HABITAT } from "./roomArchitecture";
import type { RoomObstacle } from "./types";

export const BIRD_RADIUS = 0.21;
export const BIRD_HEIGHT = 0.46;
export const BIRD_COLLIDER_ID = "room-bird";

// Enclose the entire little hop, so the player cannot enter its space between
// frames or descend through it. The visual feet still land on the floor.
const COLLIDER_TOP = 0.62;
const PLAYER_MARGIN = 0.025;
const STEP = 1 / 120;
const MAX_ELAPSED = 1;
const TAU = Math.PI * 2;

export interface BirdMotionState {
  x: number;
  y: number;
  z: number;
  /** The model faces local -Z, like the player. */
  heading: number;
  hopPhase: number | null;
  moving: boolean;
}

interface BirdMotionOptions {
  random?: () => number;
  spawn?: { x: number; z: number };
  /** The indoor companion's habitat, independent of the player's world. */
  habitat?: { minX: number; maxX: number; minZ: number; maxZ: number };
}

interface Hop {
  startX: number;
  startZ: number;
  endX: number;
  endZ: number;
  duration: number;
  height: number;
  elapsed: number;
  blocked: boolean;
}

function seededRandom() {
  let seed = 0x70b17d;
  return () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 0x100000000;
  };
}

function rectangleDistance(
  x: number,
  z: number,
  centerX: number,
  centerZ: number,
  halfWidth: number,
  halfDepth: number,
) {
  return Math.hypot(
    Math.max(0, Math.abs(x - centerX) - halfWidth),
    Math.max(0, Math.abs(z - centerZ) - halfDepth),
  );
}

/** A small autonomous floor companion; no attack target or breakable state. */
export function createBirdMotion(
  obstacles: readonly RoomObstacle[],
  initialPlayer: RoomPlayer = createPlayer(),
  options: BirdMotionOptions = {},
) {
  const random = options.random ?? seededRandom();
  const habitat = options.habitat ?? ROOM_BIRD_HABITAT;

  // This companion lives on the room's level floor. Its entire footprint needs
  // real support; a habitat rectangle alone must never create invisible ground.
  const hasFloor = (x: number, z: number) => obstacles.some((obstacle) => {
    if (obstacle.enabled === false || obstacle.support !== "ground" ||
      Math.abs(obstacle.top) > 0.000001) return false;
    const local = obstacleLocalPoint(x, z, obstacle);
    return Math.abs(local.x) + BIRD_RADIUS <= obstacle.width / 2 &&
      Math.abs(local.z) + BIRD_RADIUS <= obstacle.depth / 2;
  });

  const isClear = (x: number, z: number, player: RoomPlayer) => {
    if (
      x < habitat.minX + BIRD_RADIUS ||
      x > habitat.maxX - BIRD_RADIUS ||
      z < habitat.minZ + BIRD_RADIUS ||
      z > habitat.maxZ - BIRD_RADIUS ||
      !hasFloor(x, z)
    ) return false;

    // Check the player's circle against the bird's *square collider*, rather
    // than just its narrower visible body. Height is deliberately ignored:
    // the bird must not move underneath a jumping/standing player either.
    if (rectangleDistance(
      player.x, player.z, x, z, BIRD_RADIUS, BIRD_RADIUS,
    ) < AVATAR_RADIUS + PLAYER_MARGIN) return false;

    return !obstacles.some((obstacle) =>
      obstacle.id !== BIRD_COLLIDER_ID &&
      obstacle.top > 0 && obstacle.base < COLLIDER_TOP &&
      overlapsObstacle(x, z, BIRD_RADIUS + 0.008, obstacle),
    );
  };

  // Sampling uses a margin larger than half a sample interval, so even a very
  // thin furniture leg cannot fall between samples and be crossed unnoticed.
  const pathIsClear = (
    x: number, z: number, endX: number, endZ: number, player: RoomPlayer,
  ) => {
    const samples = Math.max(1, Math.ceil(Math.hypot(endX - x, endZ - z) / 0.012));
    for (let sample = 0; sample <= samples; sample++) {
      const t = sample / samples;
      if (!isClear(x + (endX - x) * t, z + (endZ - z) * t, player)) return false;
    }
    return true;
  };

  let spawn = options.spawn ?? { x: 0.05, z: -1.45 };
  if (!isClear(spawn.x, spawn.z, initialPlayer)) {
    const candidates: { x: number; z: number }[] = [];
    for (let x = habitat.minX + BIRD_RADIUS + 0.02; x < habitat.maxX - BIRD_RADIUS; x += 0.25)
      for (let z = habitat.minZ + BIRD_RADIUS + 0.02; z < habitat.maxZ - BIRD_RADIUS; z += 0.25)
        if (isClear(x, z, initialPlayer)) candidates.push({ x, z });
    candidates.sort((a, b) =>
      Math.hypot(a.x - spawn.x, a.z - spawn.z) - Math.hypot(b.x - spawn.x, b.z - spawn.z),
    );
    if (!candidates.length) throw new Error("The room has no free floor space for its bird.");
    spawn = candidates[0];
  }

  const state: BirdMotionState = {
    ...spawn,
    y: 0,
    heading: Math.atan2(spawn.x - initialPlayer.x, spawn.z - initialPlayer.z),
    hopPhase: null,
    moving: false,
  };
  const collider: RoomObstacle = {
    id: BIRD_COLLIDER_ID,
    x: state.x,
    z: state.z,
    width: BIRD_RADIUS * 2,
    depth: BIRD_RADIUS * 2,
    base: 0,
    top: COLLIDER_TOP,
    enabled: true,
  };
  let accumulator = 0;
  let rest = 0.65;
  let hop: Hop | null = null;
  let targetHeading = state.heading;

  const planHop = (player: RoomPlayer) => {
    for (let attempt = 0; attempt < 20; attempt++) {
      // A few hops in a similar direction, then a curious turn. Shorter escape
      // hops let it leave narrow furniture corners instead of waiting forever.
      const heading = attempt < 3
        ? targetHeading + (random() - 0.5) * 1.8
        : random() * TAU;
      const distance = attempt < 14 ? 0.25 + random() * 0.23 : 0.13 + random() * 0.12;
      const endX = state.x - Math.sin(heading) * distance;
      const endZ = state.z - Math.cos(heading) * distance;
      if (!pathIsClear(state.x, state.z, endX, endZ, player)) continue;
      targetHeading = heading;
      hop = {
        startX: state.x, startZ: state.z, endX, endZ,
        duration: 0.46 + random() * 0.13,
        height: 0.1 + random() * 0.035,
        elapsed: 0,
        blocked: false,
      };
      state.hopPhase = 0;
      state.moving = true;
      return;
    }
    rest = 0.25 + random() * 0.35;
  };

  const tick = (player: RoomPlayer, reducedMotion: boolean) => {
    if (!hop) {
      if (reducedMotion) return;
      rest -= STEP;
      if (rest <= 0) planHop(player);
      return;
    }

    hop.elapsed = Math.min(hop.duration, hop.elapsed + STEP);
    const phase = hop.elapsed / hop.duration;
    const eased = phase * phase * (3 - 2 * phase);
    const x = hop.startX + (hop.endX - hop.startX) * eased;
    const z = hop.startZ + (hop.endZ - hop.startZ) * eased;
    if (!hop.blocked) {
      if (pathIsClear(state.x, state.z, x, z, player)) {
        state.x = x;
        state.z = z;
      } else {
        // Finish the current vertical arc in place; never jump sideways or
        // suddenly resume the abandoned path after the player has moved away.
        hop.blocked = true;
      }
    }
    const angle = Math.atan2(Math.sin(targetHeading - state.heading), Math.cos(targetHeading - state.heading));
    state.heading += angle * (1 - Math.exp(-12 * STEP));
    state.y = 4 * hop.height * phase * (1 - phase);
    state.hopPhase = phase;
    collider.x = state.x;
    collider.z = state.z;

    if (phase === 1) {
      hop = null;
      state.y = 0;
      state.hopPhase = null;
      state.moving = false;
      rest = random() < 0.16 ? 1.1 + random() * 1.1 : 0.22 + random() * 0.55;
    }
  };

  return {
    state,
    collider,
    update(elapsedSeconds: number, player: RoomPlayer, reducedMotion: boolean) {
      const before = [state.x, state.y, state.z, state.heading, state.hopPhase];
      const elapsed = Number.isFinite(elapsedSeconds)
        ? Math.max(0, Math.min(MAX_ELAPSED, elapsedSeconds)) : 0;
      accumulator += elapsed;
      while (accumulator + 1e-10 >= STEP) {
        tick(player, reducedMotion);
        accumulator -= STEP;
      }
      return before.some((value, index) =>
        value !== [state.x, state.y, state.z, state.heading, state.hopPhase][index],
      );
    },
  };
}
