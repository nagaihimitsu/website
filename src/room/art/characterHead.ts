import * as THREE from "three";
import type { CharacterBuilder } from "./characterBuilder";

const HEAD_WIDTH = 0.242;
const HEAD_HEIGHT = 0.208;
const HEAD_DEPTH = 0.205;

/**
 * The cheek, muzzle and forehead are one continuous piece of plush. The small
 * forward swell is concentrated below the eyes instead of attaching a second
 * ball to a spherical skull. Local -Z is the front of the traveller.
 */
function muzzleSwell(y: number, front: number) {
  // A generous lower cheek keeps the side silhouette round beneath the nose.
  // The taper closes the polar rings at one point without a pinched seam.
  const pole = THREE.MathUtils.smoothstep(y, -HEAD_HEIGHT, -0.18);
  return (
    (0.044 * Math.exp(-(((y + 0.07) / 0.075) ** 2)) * front ** 4 +
      0.072 * Math.exp(-(((y + 0.15) / 0.072) ** 2)) * front ** 2.4 +
      // Full forehead, a shallow bridge, then a short round snout. This
      // changes the profile's curvature without narrowing the rounded jaw.
      0.018 * Math.exp(-(((y - 0.075) / 0.06) ** 2)) * front ** 2 +
      (0.011 * Math.exp(-(((y + 0.062) / 0.032) ** 2)) -
        0.007 * Math.exp(-(((y + 0.028) / 0.025) ** 2))) *
        front ** 6) *
    pole
  );
}

function faceDepth(x: number, y: number) {
  const height = THREE.MathUtils.clamp(y / HEAD_HEIGHT, -0.9999, 0.9999);
  const latitude = Math.sqrt(1 - height * height);
  const width = HEAD_WIDTH * (1 - height * 0.1);
  const front = Math.sqrt(Math.max(0, latitude * latitude - (x / width) ** 2));
  return (
    -front * HEAD_DEPTH * (1 - height * 0.075) -
    muzzleSwell(y, latitude > 0 ? front / latitude : 0)
  );
}

function facePoint(x: number, y: number, lift = 0) {
  const epsilon = 0.0001;
  const normal = new THREE.Vector3(
    (faceDepth(x + epsilon, y) - faceDepth(x - epsilon, y)) / (2 * epsilon),
    (faceDepth(x, y + epsilon) - faceDepth(x, y - epsilon)) / (2 * epsilon),
    -1,
  ).normalize();
  return new THREE.Vector3(x, y, faceDepth(x, y)).addScaledVector(normal, lift);
}

export function buildCharacterHead(
  builder: CharacterBuilder,
  body: THREE.Group,
): THREE.Group {
  const { remember, smoothNormals, mesh, ellipsoid, thread, pile, surfaces } =
    builder;
  const { fur, earInner, feature, eye, eyeLight } = surfaces;
  const head = new THREE.Group();
  head.name = "traveller-sculpted-head";
  head.position.set(0, 0.914, -0.006);
  body.add(head);

  const skull = remember(new THREE.SphereGeometry(1, 80, 56));
  const positions = skull.getAttribute("position");
  for (let index = 0; index < positions.count; index++) {
    const x = positions.getX(index);
    const y = positions.getY(index);
    const z = positions.getZ(index);
    const latitude = Math.hypot(x, z);
    const front = latitude > 0 ? Math.max(0, -z / latitude) : 0;
    positions.setXYZ(
      index,
      x * HEAD_WIDTH * (1 - y * 0.1),
      y * HEAD_HEIGHT,
      z * HEAD_DEPTH * (1 - y * 0.075) - muzzleSwell(y * HEAD_HEIGHT, front),
    );
  }
  smoothNormals(skull);
  const skullMesh = mesh(skull, fur, head);
  skullMesh.name = "continuous-cheek-and-muzzle";
  // Keep the velour nap very short. At walking distance it should soften the
  // silhouette, rather than turn into isolated, glittering dots on the face.
  pile(head, skullMesh, 1500, 0.00085, (point) => {
    if (point.z > -0.125) return true;
    const eyeDistance =
      ((Math.abs(point.x) - 0.124) / 0.045) ** 2 +
      ((point.y - 0.009) / 0.059) ** 2;
    return eyeDistance > 1.2 && !(Math.abs(point.x) < 0.08 && point.y < -0.035);
  });

  // A single closed profile makes a thick stuffed ear: round back, rolled
  // outer edge and an inset bowl. The brown lining shares the same surface at
  // the rim, so no thin disc or disconnected torus is visible in profile.
  const earProfile = new THREE.SplineCurve(
    [
      [0, 0.054],
      [0.35, 0.053],
      [0.68, 0.042],
      [0.9, 0.023],
      [1, -0.005],
      [1.015, -0.023],
      [0.98, -0.04],
      [0.91, -0.052],
      [0.79, -0.053],
      [0.71, -0.041],
      [0.66, -0.021],
      [0.6, -0.002],
      [0.37, 0.012],
      [0, 0.017],
    ].map(([radius, depth]) => new THREE.Vector2(radius, depth)),
  );
  const earRings = 52;
  const earSlices = 56;
  const earPositions: number[] = [];
  const earUvs: number[] = [];
  const earIndices: number[] = [];
  const liningStart = 34;
  for (let ring = 0; ring <= earRings; ring++) {
    const { x: radius, y: depth } = earProfile.getPoint(ring / earRings);
    for (let slice = 0; slice <= earSlices; slice++) {
      const theta = (slice / earSlices) * Math.PI * 2;
      earPositions.push(
        Math.cos(theta) * radius * 0.101,
        Math.sin(theta) * radius * 0.117,
        depth,
      );
      earUvs.push(slice / earSlices, ring / earRings);
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
    ear.position.set(side * 0.17, 0.207, 0.022);
    ear.rotation.set(0.025, -side * 0.34, -side * 0.23);
    head.add(ear);
    const shell = mesh(earGeometry, fur, ear);
    shell.material = [fur, earInner];
    // The root is hidden inside the skull, like sewn plush ears rather than
    // an upright disc balanced on the crown.
    for (let tuft = 0; tuft < 3; tuft++) {
      const tuftMesh = ellipsoid(
        0.0115,
        0.02 - tuft * 0.001,
        0.013,
        fur,
        ear,
        -side * (0.055 - tuft * 0.015),
        -0.057 + tuft * 0.014,
        -0.047,
      );
      tuftMesh.rotation.z = side * (0.5 + tuft * 0.16);
    }
  }

  // Eyes are shallow lenses directly sampled from the cheek surface. Even in
  // exact side view the far eye remains occluded and no eyeball floats out.
  for (const side of [-1, 1]) {
    const eyeX = side * 0.124;
    const eyeY = 0.009;
    const radiusX = 0.0345;
    const radiusY = 0.0475;
    const lensPoint = (x: number, y: number, extra = 0) => {
      const radiusSquared =
        ((x - eyeX) / radiusX) ** 2 + ((y - eyeY) / radiusY) ** 2;
      const lift =
        0.0005 + 0.0055 * Math.max(0, 1 - radiusSquared) ** 0.72 + extra;
      return facePoint(x, y, lift);
    };
    const lensRings = 16;
    const lensSlices = 48;
    const lensPositions: number[] = [];
    const lensUvs: number[] = [];
    const lensIndices: number[] = [];
    for (let ring = 0; ring <= lensRings; ring++) {
      const radius = ring / lensRings;
      for (let slice = 0; slice <= lensSlices; slice++) {
        const theta = (slice / lensSlices) * Math.PI * 2;
        const point = lensPoint(
          eyeX + Math.cos(theta) * radius * radiusX,
          eyeY + Math.sin(theta) * radius * radiusY,
        );
        lensPositions.push(point.x, point.y, point.z);
        lensUvs.push(
          0.5 + Math.cos(theta) * radius * 0.5,
          0.5 + Math.sin(theta) * radius * 0.5,
        );
        if (ring < lensRings && slice < lensSlices) {
          const a = ring * (lensSlices + 1) + slice;
          const b = a + lensSlices + 1;
          lensIndices.push(a, b + 1, b, a, a + 1, b + 1);
        }
      }
    }
    const lensGeometry = remember(new THREE.BufferGeometry());
    lensGeometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(lensPositions, 3),
    );
    lensGeometry.setAttribute(
      "uv",
      new THREE.Float32BufferAttribute(lensUvs, 2),
    );
    lensGeometry.setIndex(lensIndices);
    smoothNormals(lensGeometry);
    const lens = mesh(lensGeometry, eye, head);
    lens.name = side < 0 ? "left-inset-eye" : "right-inset-eye";

    for (const [offsetX, offsetY, radius] of [
      [-0.007, 0.016, 0.0105],
      [0.011, -0.021, 0.006],
    ]) {
      const star = new THREE.Shape();
      for (let index = 0; index < 10; index++) {
        const theta = Math.PI / 2 + (index * Math.PI) / 5;
        const size = radius * (index % 2 === 0 ? 1 : 0.47);
        const x = Math.cos(theta) * size;
        const y = Math.sin(theta) * size;
        if (index === 0) star.moveTo(x, y);
        else star.lineTo(x, y);
      }
      star.closePath();
      const starGeometry = remember(new THREE.ShapeGeometry(star));
      const starPositions = starGeometry.getAttribute("position");
      for (let index = 0; index < starPositions.count; index++) {
        const point = lensPoint(
          eyeX + offsetX + starPositions.getX(index),
          eyeY + offsetY + starPositions.getY(index),
          0.00045,
        );
        starPositions.setXYZ(index, point.x, point.y, point.z);
      }
      const indices = starGeometry.getIndex()!;
      for (let index = 0; index < indices.count; index += 3) {
        const second = indices.getX(index + 1);
        indices.setX(index + 1, indices.getX(index + 2));
        indices.setX(index + 2, second);
      }
      starGeometry.computeVertexNormals();
      const sparkle = mesh(starGeometry, eyeLight, head);
      sparkle.castShadow = false;
      sparkle.receiveShadow = false;
    }
  }

  const nosePoint = facePoint(0, -0.065, 0.004);
  const nose = ellipsoid(
    0.0245,
    0.017,
    0.016,
    feature,
    head,
    nosePoint.x,
    nosePoint.y,
    nosePoint.z,
  );
  nose.rotation.x = -0.18;
  nose.name = "soft-button-nose";
  const smile = [
    [-0.058, -0.096],
    [-0.047, -0.111],
    [-0.029, -0.115],
    [-0.013, -0.111],
    [0, -0.099],
    [0.013, -0.111],
    [0.029, -0.115],
    [0.047, -0.111],
    [0.058, -0.096],
  ].map(([x, y]) => facePoint(x, y, 0.0012).toArray());
  const mouth = thread(smile, 0.0032, feature, head, 48);
  mouth.name = "surface-following-embroidered-smile";
  return head;
}
