export interface MoveInput {
  x: number;
  z: number;
}

/** A radial dead zone treats pulling down exactly like every other direction. */
export function stickInput(x: number, y: number, radius: number): MoveInput {
  if (![x, y, radius].every(Number.isFinite) || radius <= 0)
    return { x: 0, z: 0 };
  const length = Math.hypot(x, y) / radius;
  const magnitude = Math.max(0, Math.min(1, (length - 0.12) / 0.88));
  if (magnitude === 0) return { x: 0, z: 0 };
  const scale = length > 0 ? magnitude / length / radius : 0;
  return { x: x * scale, z: y * scale };
}

/** Screen-down is toward the viewer; yaw belongs to the camera, not the body. */
export function cameraRelativeInput(input: MoveInput, yaw: number): MoveInput {
  return {
    x: input.x * Math.cos(yaw) + input.z * Math.sin(yaw),
    z: -input.x * Math.sin(yaw) + input.z * Math.cos(yaw),
  };
}

/**
 * Ease acceleration over 70ms and release over 40ms. The integrated average
 * makes a 15fps frame travel the same distance as four 60fps frames. A full
 * release coasts at most 0.112m at the room's 2.8m/s running speed.
 */
export function smoothLocomotion(
  current: MoveInput,
  target: MoveInput,
  elapsedSeconds: number,
): { velocity: MoveInput; average: MoveInput } {
  const elapsed = Number.isFinite(elapsedSeconds)
    ? Math.max(0, Math.min(1, elapsedSeconds))
    : 0;
  if (elapsed === 0)
    return { velocity: { ...current }, average: { ...current } };
  const releasing = Math.hypot(target.x, target.z) < 0.0001;
  const responseTime = releasing ? 0.04 : 0.07;
  const decay = Math.exp(-elapsed / responseTime);
  const averageDecay = (responseTime * (1 - decay)) / elapsed;
  const velocity = {
    x: target.x + (current.x - target.x) * decay,
    z: target.z + (current.z - target.z) * decay,
  };
  const average = {
    x: target.x + (current.x - target.x) * averageDecay,
    z: target.z + (current.z - target.z) * averageDecay,
  };
  if (releasing && Math.hypot(velocity.x, velocity.z) < 0.0001) {
    velocity.x = 0;
    velocity.z = 0;
  }
  return { velocity, average };
}
