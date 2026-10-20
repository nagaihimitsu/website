import * as THREE from "three";

/** Shared by the instrument, sleeves and fingertips; all points are torso-local. */
export const BASS_HELD_POSITION = new THREE.Vector3(0.065, 0.44, -0.25);
export const BASS_HELD_ROTATION = new THREE.Quaternion().setFromEuler(
  new THREE.Euler(0, Math.PI, (-55 * Math.PI) / 180),
);
export const BASS_HELD_SCALE = 0.9;
/** Instrument-local strap-button ends, shared by the hardware and shoulder strap. */
export const BASS_STRAP_UPPER = new THREE.Vector3(-0.087, 0.266, -0.002);
export const BASS_STRAP_TAIL = new THREE.Vector3(0.012, -0.251, -0.003);

/** HUD order is G, D, A, E; the model's thick E string is at negative X. */
export function bassStringX(string: number, y = 0.015) {
  const bridgeX = (1.5 - THREE.MathUtils.clamp(string, 0, 3)) * 0.013;
  return bridgeX * THREE.MathUtils.lerp(1, 0.82, (y + 0.142) / 0.745);
}

export function bassFretY(fret: number) {
  // A fingertip presses just behind the fret wire, towards the nut.
  return 0.602 - 0.69 * (1 - 2 ** (-(THREE.MathUtils.clamp(fret, 1, 18) - 0.35) / 12));
}

export function bassStringZ(y: number) {
  return THREE.MathUtils.lerp(0.042, 0.033, (y + 0.142) / 0.745);
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
  return bassPosePoint(bassStringX(string), 0.015, bassStringZ(0.015), target);
}
