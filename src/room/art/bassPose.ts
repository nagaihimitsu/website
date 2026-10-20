import * as THREE from "three";

/** Shared by the instrument, sleeves and fingertips; all points are torso-local. */
export const BASS_HELD_POSITION = new THREE.Vector3(0.065, 0.43, -0.25);
export const BASS_HELD_ROTATION = new THREE.Quaternion().setFromEuler(
  new THREE.Euler(0, Math.PI, (-42 * Math.PI) / 180),
);
export const BASS_HELD_SCALE = 1.04;
/** Relaxed supporting grip between phrases; sounding notes use their real frets. */
export const BASS_REST_FRET = 9;
/** One physical scale for the nut, bridge, fret wires and performing paws. */
export const BASS_DIMENSIONS = {
  nutY: 0.75,
  bridgeY: -0.19,
  fingerboardEndY: 0.058,
  fretCount: 22,
  bridgeStringSpacing: 0.018,
  nutStringSpacing: 0.013,
  bridgeStringZ: 0.042,
  nutStringZ: 0.033,
} as const;
export const BASS_PICK_Y = -0.025;
export const BASS_SLAP_Y = 0.08;
/** Instrument-local strap-button ends, shared by the hardware and shoulder strap. */
export const BASS_STRAP_UPPER = new THREE.Vector3(-0.112, 0.235, 0.027);
export const BASS_STRAP_TAIL = new THREE.Vector3(0, -0.265, -0.003);

function stringProgress(y: number) {
  return (y - BASS_DIMENSIONS.bridgeY) / (BASS_DIMENSIONS.nutY - BASS_DIMENSIONS.bridgeY);
}

/** HUD order is G, D, A, E; the model's thick E string is at negative X. */
export function bassStringX(string: number, y = BASS_PICK_Y) {
  const spacing = THREE.MathUtils.lerp(
    BASS_DIMENSIONS.bridgeStringSpacing, BASS_DIMENSIONS.nutStringSpacing, stringProgress(y),
  );
  return (1.5 - THREE.MathUtils.clamp(string, 0, 3)) * spacing;
}

/** Equal temperament measured from the actual string's nut-to-saddle span. */
export function bassFretWireY(fret: number) {
  const scale = BASS_DIMENSIONS.nutY - BASS_DIMENSIONS.bridgeY;
  return BASS_DIMENSIONS.nutY - scale * (1 - 2 ** (-fret / 12));
}

export function bassFretY(fret: number) {
  // A fingertip presses just behind the fret wire, towards the nut.
  return bassFretWireY(THREE.MathUtils.clamp(fret, 1, BASS_DIMENSIONS.fretCount) - 0.35);
}

export function bassStringZ(y: number) {
  return THREE.MathUtils.lerp(
    BASS_DIMENSIONS.bridgeStringZ, BASS_DIMENSIONS.nutStringZ, stringProgress(y),
  );
}

export function bassPosePoint(x: number, y: number, z: number, target = new THREE.Vector3()) {
  return target.set(x, y, z).multiplyScalar(BASS_HELD_SCALE)
    .applyQuaternion(BASS_HELD_ROTATION).add(BASS_HELD_POSITION);
}

export function bassFingerboardContact(string: number, fret: number, target = new THREE.Vector3()) {
  const y = bassFretY(fret);
  return bassPosePoint(bassStringX(string, y), y, bassStringZ(y), target);
}

export function bassPluckingContact(string: number, target = new THREE.Vector3()) {
  return bassPosePoint(bassStringX(string), BASS_PICK_Y, bassStringZ(BASS_PICK_Y), target);
}
