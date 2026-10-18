import * as THREE from "three";
import type { CharacterBuilder } from "./characterBuilder";
import { buildCharacterTufts } from "./characterTufts";
import { buildCharacterEyes, createEyeLayouts, eyeSocketDepth, EYE_X, EYE_Y, EYE_RADIUS_X, EYE_RADIUS_Y } from "./characterEyes";

const HEAD_WIDTH = 0.252;
const HEAD_HEIGHT = 0.222;
const HEAD_DEPTH = 0.205;

// The reference has a narrow crown and broad low cheeks, not a round ball.
const skullWidth = (height: number) => HEAD_WIDTH * (1 - height * 0.26);

/**
 * One continuous surface joins the brow, paired cheeks, short muzzle and chin.
 * Each volume has its own centre: a height-only swell makes the three-quarter
 * face read as an egg, with no change of plane beside the nose. Local -Z is
 * the front of the traveller.
 */
function plushSwell(x: number, y: number, front: number) {
  const gaussian = (value: number, centre: number, width: number) =>
    Math.exp(-(((value - centre) / width) ** 2));
  const cheeks =
    0.036 *
    (gaussian(x, -0.104, 0.085) + gaussian(x, 0.104, 0.085)) *
    gaussian(y, -0.075, 0.085) *
    front ** 1.6;
  const muzzle =
    0.045 * gaussian(x, 0, 0.078) * gaussian(y, -0.055, 0.058) * front ** 2;
  const chin =
    0.066 * gaussian(x, 0, 0.145) * gaussian(y, -0.151, 0.07) * front ** 1.6;
  const brow = 0.02 * gaussian(y, 0.08, 0.075) * front ** 2;
  // A shallow bridge separates the brow from the snout. The eyes sit on the
  // broader planes to either side, without changing their approved placement.
  const bridge =
    0.007 * gaussian(x, 0, 0.055) * gaussian(y, 0.005, 0.047) * front ** 2;
  // The eye-bearing planes face forward more than the rounded lateral cheeks.
  // Correct both slopes locally: wrapping a lens over the skull otherwise
  // hides the far eye and tilts the near oval at a three-quarter angle. The
  // central gate leaves the short muzzle and nose untouched.
  const eyePlane =
    (0.28 * (Math.abs(x) - EYE_X) + 0.16 * (y - EYE_Y)) *
    gaussian(Math.abs(x), EYE_X, 0.09) *
    gaussian(y, EYE_Y, 0.09) *
    THREE.MathUtils.smoothstep(Math.abs(x), 0.035, 0.085) *
    THREE.MathUtils.smoothstep(front, 0.15, 0.65);
  // Close both polar rings without a longitude-dependent gap at the crown.
  const pole =
    THREE.MathUtils.smoothstep(y, -HEAD_HEIGHT, -0.18) *
    (1 - THREE.MathUtils.smoothstep(y, 0.195, HEAD_HEIGHT));
  return (cheeks + muzzle + chin + brow - bridge + eyePlane) * pole;
}

function rawFaceDepth(x: number, y: number) {
  const height = THREE.MathUtils.clamp(y / HEAD_HEIGHT, -0.9999, 0.9999);
  const latitude = Math.sqrt(1 - height * height);
  const width = skullWidth(height);
  const front = Math.sqrt(Math.max(0, latitude * latitude - (x / width) ** 2));
  return (
    -front * HEAD_DEPTH * (1 - height * 0.075) -
    plushSwell(x, y, latitude > 0 ? front / latitude : 0)
  );
}

const eyeLayouts = createEyeLayouts(rawFaceDepth);

function faceDepth(x: number, y: number) {
  return eyeSocketDepth(x, y, rawFaceDepth(x, y), eyeLayouts);
}

function faceNormal(x: number, y: number) {
  const epsilon = 0.0001;
  return new THREE.Vector3(
    (faceDepth(x + epsilon, y) - faceDepth(x - epsilon, y)) / (2 * epsilon),
    (faceDepth(x, y + epsilon) - faceDepth(x, y - epsilon)) / (2 * epsilon),
    -1,
  ).normalize();
}

function facePoint(x: number, y: number, lift = 0) {
  return new THREE.Vector3(x, y, faceDepth(x, y)).addScaledVector(faceNormal(x, y), lift);
}

export function buildCharacterHead(
  builder: CharacterBuilder,
  body: THREE.Group,
): THREE.Group {
  const { remember, smoothNormals, mesh, ellipsoid, thread, pile, surfaces } =
    builder;
  const { fur, earOuter, earInner, feature } = surfaces;
  const head = new THREE.Group();
  head.name = "traveller-sculpted-head";
  head.position.set(0, 0.914, -0.006);
  body.add(head);

  const skull = remember(new THREE.SphereGeometry(1, 112, 80));
  const positions = skull.getAttribute("position");
  for (let index = 0; index < positions.count; index++) {
    const x = positions.getX(index);
    const y = positions.getY(index);
    const z = positions.getZ(index);
    const latitude = Math.hypot(x, z);
    const front = latitude > 0 ? Math.max(0, -z / latitude) : 0;
    const px = x * skullWidth(y);
    const faceY = y * HEAD_HEIGHT;
    // Continue the lowest jaw rings into a short plush throat. The smooth
    // transition sits below the facial features; its pole is buried inside
    // the hoodie, with one shared surface instead of a visible head/neck seam.
    const throat = 1 - THREE.MathUtils.smootherstep(y, -1, -0.79);
    const py = faceY - 0.044 * throat;
    const rawDepth = z * HEAD_DEPTH * (1 - y * 0.075) - plushSwell(px, faceY, front);
    positions.setXYZ(index, px, py, z < 0 ? eyeSocketDepth(px, faceY, rawDepth, eyeLayouts) : rawDepth);
  }
  smoothNormals(skull);
  const skullMesh = mesh(skull, fur, head);
  skullMesh.name = "continuous-cheek-and-muzzle";
  // Keep the velour nap very short. At walking distance it should soften the
  // silhouette, rather than turn into isolated, glittering dots on the face.
  pile(head, skullMesh, 1500, 0.00085, (point) => {
    if (point.z > -0.125) return true;
    const eyeDistance =
      ((Math.abs(point.x) - EYE_X) / (EYE_RADIUS_X * 1.15)) ** 2 +
      ((point.y - EYE_Y) / (EYE_RADIUS_Y * 1.15)) ** 2;
    return eyeDistance > 1.2 && !(Math.abs(point.x) < 0.08 && point.y < -0.035);
  });

  // A single closed profile makes a thick stuffed ear: round back, rolled
  // outer edge and an inset bowl. The brown lining shares the same surface at
  // the rim, so no thin disc or disconnected torus is visible in profile.
  const earProfile = new THREE.SplineCurve(
    [
      [0, 0.039],
      [0.35, 0.038],
      [0.68, 0.029],
      [0.9, 0.013],
      [1, -0.007],
      [1.015, -0.021],
      [0.98, -0.035],
      [0.9, -0.044],
      [0.79, -0.044],
      [0.72, -0.033],
      [0.66, -0.016],
      [0.56, -0.003],
      [0.34, 0.004],
      [0.15, 0.006],
      [0, 0.006],
    ].map(([radius, depth]) => new THREE.Vector2(radius, depth)),
  );
  const earRings = 52;
  const earSlices = 56;
  const earPositions: number[] = [];
  const earUvs: number[] = [];
  const earIndices: number[] = [];
  const liningStart = 32;
  for (let ring = 0; ring <= earRings; ring++) {
    const { x: radius, y: profileDepth } = earProfile.getPoint(ring / earRings);
    // A flat tangent at the centre gives the lining a rounded dish, with no
    // cone point where all radial rings meet.
    const bowlBlend = ring > 35 ? 1 - THREE.MathUtils.smoothstep(radius, 0.42, 0.66) : 0;
    const depth = THREE.MathUtils.lerp(
      profileDepth,
      0.006 - 0.022 * (Math.max(0, radius) / 0.66) ** 2.2,
      bowlBlend,
    );
    for (let slice = 0; slice <= earSlices; slice++) {
      const theta = (slice / earSlices) * Math.PI * 2;
      earPositions.push(
        Math.cos(theta) * radius * 0.114,
        Math.sin(theta) * radius * 0.117,
        depth,
      );
      // Planar fabric UVs avoid pinching the nap into radial spokes at the
      // bowl centre. Every coincident pole vertex now samples the same texel.
      earUvs.push((Math.cos(theta) * radius + 1) / 2, (Math.sin(theta) * radius + 1) / 2);
      if (ring < earRings && slice < earSlices) {
        const a = ring * (earSlices + 1) + slice;
        const b = a + earSlices + 1;
        earIndices.push(a, b, b + 1, a, b + 1, a + 1);
      }
    }
  }
  const earGeometry = remember(new THREE.BufferGeometry());
  earGeometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(earPositions, 3),
  );
  earGeometry.setAttribute("uv", new THREE.Float32BufferAttribute(earUvs, 2));
  earGeometry.setIndex(earIndices);
  earGeometry.addGroup(0, liningStart * earSlices * 6, 0);
  earGeometry.addGroup(
    liningStart * earSlices * 6,
    (earRings - liningStart) * earSlices * 6,
    1,
  );
  smoothNormals(earGeometry);
  for (const side of [-1, 1]) {
    const ear = new THREE.Group();
    ear.name = side < 0 ? "left-stuffed-ear" : "right-stuffed-ear";
    ear.position.set(side * 0.158, 0.207, 0.005);
    // The opening turns outward, so the lining remains visible from the
    // side. The old almost-forward ear became a deep narrow tube in profile.
    ear.rotation.set(0.1, -side * 0.56, -side * 0.24);
    head.add(ear);
    const shell = mesh(earGeometry, earOuter, ear);
    shell.material = [earOuter, earInner];
  }
  buildCharacterTufts(builder, head, faceDepth);

  buildCharacterEyes(builder, head, eyeLayouts);

  const nosePoint = facePoint(0, -0.046, -0.001);
  const noseGeometry = remember(new THREE.SphereGeometry(1, 40, 28));
  const nosePositions = noseGeometry.getAttribute("position");
  for (let index = 0; index < nosePositions.count; index++) {
    const y = nosePositions.getY(index);
    // The top is a soft broad dome, with a smaller rounded lower tip.
    // Its back is buried in the muzzle: from the side this reads as a short
    // padded animal nose, rather than a thin vertical bead on the face.
    const z = nosePositions.getZ(index);
    nosePositions.setXYZ(
      index,
      nosePositions.getX(index) * 0.033 * (1 + y * 0.26),
      y * 0.0235,
      z * (z < 0 ? 0.022 : 0.018) * (1 + y * 0.13),
    );
  }
  smoothNormals(noseGeometry);
  const nose = mesh(
    noseGeometry,
    feature,
    head,
    nosePoint.x,
    nosePoint.y,
    nosePoint.z,
  );
  // Follow the snout's inclined attachment plane. An upright sphere leaves
  // its top floating above the brow slope and looks like a separate bead.
  nose.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), faceNormal(0, -0.046));
  nose.name = "rounded-triangular-nose";
  const smile = [
    [-0.064, -0.075],
    [-0.052, -0.091],
    [-0.033, -0.098],
    [-0.015, -0.092],
    [0, -0.078],
    [0.015, -0.092],
    [0.033, -0.098],
    [0.052, -0.091],
    [0.064, -0.075],
  ].map(([x, y]) => facePoint(x, y, 0.0019).toArray());
  const mouth = thread(smile, 0.0045, feature, head, 64);
  mouth.name = "surface-following-embroidered-smile";
  for (const end of [smile[0], smile[smile.length - 1]])
    ellipsoid(0.0045, 0.0045, 0.0045, feature, head, end[0], end[1], end[2]);
  return head;
}
