import type { Direction, RoomObstacle } from "./types";

export const ROOM_LIMITS = { minX: -4.7, maxX: 4.7, minZ: -3.7, maxZ: 3.7 };
export const ROOM_CEILING = 4.55;
export const AVATAR_RADIUS = 0.22;
export const PLAYER_HEIGHT = 1.28;
export const PLAYER_SPEED = 2.8;
export const JUMP_SPEED = 6.6;
export const GRAVITY = 12;

const EPSILON = 0.000001;
const MAX_STEP = 1 / 180;
const MAX_ELAPSED = 1;

export interface RoomPlayer {
  x: number;
  /** Height of the feet above the room floor. */
  y: number;
  z: number;
  velocityY: number;
  grounded: boolean;
  supportId: string | null;
}

type Vector = { x: number; z: number };

export function createPlayer(x = 0.95, z = 3.05): RoomPlayer {
  return { x, y: 0, z, velocityY: 0, grounded: true, supportId: null };
}

/** Three.js camera yaw: zero faces -Z; a positive quarter turn faces -X. */
export function movementVector(
  directions: ReadonlySet<Direction>,
  yaw = 0,
): Vector {
  const horizontal =
    Number(directions.has("right")) - Number(directions.has("left"));
  const vertical =
    Number(directions.has("down")) - Number(directions.has("up"));
  const angle = Number.isFinite(yaw) ? yaw : 0;
  const x = horizontal * Math.cos(angle) + vertical * Math.sin(angle);
  const z = -horizontal * Math.sin(angle) + vertical * Math.cos(angle);
  const length = Math.hypot(x, z);
  return length > 0 ? { x: x / length, z: z / length } : { x: 0, z: 0 };
}

function overlapsFootprint(x: number, z: number, obstacle: RoomObstacle) {
  if (obstacle.enabled === false) return false;
  const nearestX = Math.max(
    obstacle.x - obstacle.width / 2,
    Math.min(x, obstacle.x + obstacle.width / 2),
  );
  const nearestZ = Math.max(
    obstacle.z - obstacle.depth / 2,
    Math.min(z, obstacle.z + obstacle.depth / 2),
  );
  return Math.hypot(x - nearestX, z - nearestZ) < AVATAR_RADIUS - EPSILON;
}

function insideWalls(x: number, z: number) {
  return (
    x >= ROOM_LIMITS.minX + AVATAR_RADIUS &&
    x <= ROOM_LIMITS.maxX - AVATAR_RADIUS &&
    z >= ROOM_LIMITS.minZ + AVATAR_RADIUS &&
    z <= ROOM_LIMITS.maxZ - AVATAR_RADIUS
  );
}

/** Test the complete upright body, including furniture sides and undersides. */
export function positionIsClear(
  x: number,
  z: number,
  obstacles: readonly RoomObstacle[],
  y = 0,
): boolean {
  if (
    ![x, y, z].every(Number.isFinite) ||
    !insideWalls(x, z) ||
    y < -EPSILON ||
    y + PLAYER_HEIGHT > ROOM_CEILING + EPSILON
  )
    return false;
  return !obstacles.some(
    (obstacle) =>
      y < obstacle.top - EPSILON &&
      y + PLAYER_HEIGHT > obstacle.base + EPSILON &&
      overlapsFootprint(x, z, obstacle),
  );
}

function supportAt(
  player: Pick<RoomPlayer, "x" | "y" | "z">,
  obstacles: readonly RoomObstacle[],
): RoomObstacle | "floor" | null {
  if (Math.abs(player.y) <= EPSILON) return "floor";
  return (
    obstacles.find(
      (obstacle) =>
        Math.abs(player.y - obstacle.top) <= EPSILON &&
        overlapsFootprint(player.x, player.z, obstacle),
    ) ?? null
  );
}

/** Advance every elapsed second in small physics steps, independently of rendering. */
export function stepPlayer(
  state: RoomPlayer,
  input: Vector,
  elapsedSeconds: number,
  obstacles: readonly RoomObstacle[],
  jumpRequested = false,
): RoomPlayer {
  const player = { ...state };
  const support = supportAt(player, obstacles);
  player.grounded = player.grounded && support !== null;
  player.supportId =
    player.grounded && support !== "floor" ? (support?.id ?? null) : null;
  if (jumpRequested && player.grounded) {
    player.velocityY = JUMP_SPEED;
    player.grounded = false;
    player.supportId = null;
  }
  const elapsed = Number.isFinite(elapsedSeconds)
    ? Math.max(0, Math.min(MAX_ELAPSED, elapsedSeconds))
    : 0;
  if (elapsed === 0) return player;
  const count = Math.max(1, Math.ceil(elapsed / MAX_STEP));
  const delta = elapsed / count;
  const inputLength = Math.hypot(input.x, input.z);
  const speed = Number.isFinite(inputLength)
    ? PLAYER_SPEED / Math.max(1, inputLength)
    : 0;
  const stepX = speed === 0 ? 0 : input.x * speed * delta;
  const stepZ = speed === 0 ? 0 : input.z * speed * delta;

  for (let index = 0; index < count; index++) {
    const previousY = player.y;
    const wantedY =
      previousY + player.velocityY * delta - 0.5 * GRAVITY * delta ** 2;
    player.velocityY -= GRAVITY * delta;
    // The higher feet position permits clearing an edge during ascent and
    // crossing an edge before the vertical sweep lands on its top.
    const sideY = Math.min(
      ROOM_CEILING - PLAYER_HEIGHT,
      Math.max(previousY, wantedY),
    );
    const nextX = Math.max(
      ROOM_LIMITS.minX + AVATAR_RADIUS,
      Math.min(ROOM_LIMITS.maxX - AVATAR_RADIUS, player.x + stepX),
    );
    const nextZ = Math.max(
      ROOM_LIMITS.minZ + AVATAR_RADIUS,
      Math.min(ROOM_LIMITS.maxZ - AVATAR_RADIUS, player.z + stepZ),
    );
    if (positionIsClear(nextX, player.z, obstacles, sideY)) player.x = nextX;
    if (positionIsClear(player.x, nextZ, obstacles, sideY)) player.z = nextZ;

    player.grounded = false;
    player.supportId = null;
    if (wantedY > previousY) {
      let headLimit = ROOM_CEILING;
      for (const obstacle of obstacles) {
        if (
          overlapsFootprint(player.x, player.z, obstacle) &&
          previousY + PLAYER_HEIGHT <= obstacle.base + EPSILON &&
          wantedY + PLAYER_HEIGHT >= obstacle.base - EPSILON
        )
          headLimit = Math.min(headLimit, obstacle.base);
      }
      player.y = Math.min(wantedY, headLimit - PLAYER_HEIGHT);
      if (player.y < wantedY) player.velocityY = 0;
    } else {
      let landingHeight = 0;
      let landingId: string | null = null;
      for (const obstacle of obstacles) {
        if (
          obstacle.top >= landingHeight &&
          previousY >= obstacle.top - EPSILON &&
          wantedY <= obstacle.top + EPSILON &&
          overlapsFootprint(player.x, player.z, obstacle)
        ) {
          landingHeight = obstacle.top;
          landingId = obstacle.id;
        }
      }
      player.y = Math.max(wantedY, landingHeight);
      if (wantedY <= landingHeight) {
        player.velocityY = 0;
        player.grounded = true;
        player.supportId = landingId;
      }
    }
  }
  return player;
}

/** Only restore safe standing positions; stale airborne or embedded saves reset. */
export function validatePlayerPosition(
  value: unknown,
  obstacles: readonly RoomObstacle[],
): RoomPlayer | null {
  if (!value || typeof value !== "object") return null;
  const saved = value as Partial<RoomPlayer>;
  if (typeof saved.x !== "number" || typeof saved.z !== "number") return null;
  const y = saved.y === undefined ? 0 : saved.y;
  if (typeof y !== "number" || ![saved.x, y, saved.z].every(Number.isFinite))
    return null;
  const player = { ...createPlayer(saved.x, saved.z), y };
  if (Math.abs(y) < 0.03) player.y = 0;
  else {
    const support = obstacles.find(
      (obstacle) =>
        Math.abs(y - obstacle.top) < 0.03 &&
        overlapsFootprint(player.x, player.z, obstacle),
    );
    if (!support) return null;
    player.y = support.top;
    player.supportId = support.id;
  }
  return positionIsClear(player.x, player.z, obstacles, player.y)
    ? player
    : null;
}
