import * as THREE from "three";
import type { CharacterBuilder } from "./characterBuilder";

const HEAD_WIDTH = 0.252;
const HEAD_HEIGHT = 0.222;
const HEAD_DEPTH = 0.205;
const EYE_X = 0.116;
const EYE_Y = 0.012;
const EYE_RADIUS_X = 0.04;
const EYE_RADIUS_Y = 0.05;

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
    0.057 *
    (gaussian(x, -0.104, 0.07) + gaussian(x, 0.104, 0.07)) *
    gaussian(y, -0.06, 0.063) *
    front ** 1.6;
  const muzzle =
    0.053 * gaussian(x, 0, 0.078) * gaussian(y, -0.055, 0.058) * front ** 2;
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
    (0.3 * (Math.abs(x) - EYE_X) + 0.32 * (y - EYE_Y)) *
    gaussian(Math.abs(x), EYE_X, 0.075) *
    gaussian(y, EYE_Y, 0.07) *
    THREE.MathUtils.smoothstep(Math.abs(x), 0.035, 0.085) *
    THREE.MathUtils.smoothstep(front, 0.15, 0.65);
  // Close both polar rings without a longitude-dependent gap at the crown.
  const pole =
    THREE.MathUtils.smoothstep(y, -HEAD_HEIGHT, -0.18) *
    (1 - THREE.MathUtils.smoothstep(y, 0.195, HEAD_HEIGHT));
  return (cheeks + muzzle + chin + brow - bridge + eyePlane) * pole;
}

function faceDepth(x: number, y: number) {
  const height = THREE.MathUtils.clamp(y / HEAD_HEIGHT, -0.9999, 0.9999);
  const latitude = Math.sqrt(1 - height * height);
  const width = skullWidth(height);
  const front = Math.sqrt(Math.max(0, latitude * latitude - (x / width) ** 2));
  return (
    -front * HEAD_DEPTH * (1 - height * 0.075) -
    plushSwell(x, y, latitude > 0 ? front / latitude : 0)
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
  const { fur, earInner, feature, eye, eyeRim, eyeLight } = surfaces;
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
      x * skullWidth(y),
      y * HEAD_HEIGHT,
      z * HEAD_DEPTH * (1 - y * 0.075) -
        plushSwell(x * skullWidth(y), y * HEAD_HEIGHT, front),
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
      ((Math.abs(point.x) - EYE_X) / (EYE_RADIUS_X * 1.15)) ** 2 +
      ((point.y - EYE_Y) / (EYE_RADIUS_Y * 1.15)) ** 2;
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
        Math.cos(theta) * radius * 0.114,
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
    ear.position.set(side * 0.158, 0.207, 0.022);
    ear.rotation.set(0.025, -side * 0.3, -side * 0.28);
    head.add(ear);
    const shell = mesh(earGeometry, fur, ear);
    shell.material = [fur, earInner];
    // The root is hidden inside the skull, like sewn plush ears rather than
    // an upright disc balanced on the crown.
    for (let tuft = 0; tuft < 3; tuft++) {
      // Broad roots disappear into the crown; only the soft, swept tips rise
      // toward the ear rim. Tapering each lobe avoids a row of upright beads.
      const rootX = side * (0.104 + tuft * 0.031);
      const rootY = 0.177 - tuft * 0.024;
      const tuftGeometry = remember(new THREE.SphereGeometry(1, 28, 24));
      const tuftPositions = tuftGeometry.getAttribute("position");
      for (let vertex = 0; vertex < tuftPositions.count; vertex++) {
        const t = (tuftPositions.getY(vertex) + 1) / 2;
        tuftPositions.setXYZ(
          vertex,
          tuftPositions.getX(vertex) * (0.025 - tuft * 0.0015) * (1 - t * 0.2) +
            side * (0.022 + tuft * 0.002) * t ** 1.2,
          (t - 0.12 * t ** 5) * (0.058 - tuft * 0.006) - 0.01,
          tuftPositions.getZ(vertex) * (0.017 - tuft * 0.001) * (1 - t * 0.15) +
            0.004 * t * t,
        );
      }
      smoothNormals(tuftGeometry);
      const tuftMesh = mesh(
        tuftGeometry,
        fur,
        head,
        rootX,
        rootY,
        faceDepth(rootX, rootY) + 0.02,
      );
      tuftMesh.name = `${side < 0 ? "left" : "right"}-crown-tuft-${tuft + 1}`;
    }
  }

  // Eyes are shallow lenses directly sampled from the cheek surface. Even in
  // exact side view the far eye remains occluded and no eyeball floats out.
  for (const side of [-1, 1]) {
    const eyeX = side * EYE_X;
    const eyeY = EYE_Y;
    const radiusX = EYE_RADIUS_X;
    const radiusY = EYE_RADIUS_Y;
    const lensPoint = (x: number, y: number, extra = 0) => {
      const radiusSquared =
        ((x - eyeX) / radiusX) ** 2 + ((y - eyeY) / radiusY) ** 2;
      const lift =
        0.0005 + 0.0055 * Math.max(0, 1 - radiusSquared) ** 0.72 + extra;
      return facePoint(x, y, lift);
    };
    const lensRings = 17;
    const lensSlices = 48;
    const lensPositions: number[] = [];
    const lensUvs: number[] = [];
    const lensIndices: number[] = [];
    for (let ring = 0; ring <= lensRings; ring++) {
      const radius = ring <= 16 ? ring / 16 : 1.065;
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
    lensGeometry.addGroup(0, 16 * lensSlices * 6, 0);
    lensGeometry.addGroup(16 * lensSlices * 6, lensSlices * 6, 1);
    smoothNormals(lensGeometry);
    const lens = mesh(lensGeometry, eye, head);
    lens.material = [eye, eyeRim];
    lens.name = side < 0 ? "left-inset-eye" : "right-inset-eye";

    // Mirror the highlights: a soft five-point star at the upper inner corner,
    // and a small four-point sparkle at the lower outer corner of each eye.
    for (const [offsetX, offsetY, radius, points, inner] of [
      [-side * 0.0072, 0.0162, 0.01665, 5, 0.55],
      [side * 0.0198, -0.0207, 0.00855, 4, 0.28],
    ]) {
      const star = new THREE.Shape();
      const corners = Array.from({ length: points * 2 }, (_, index) => {
        const theta = Math.PI / 2 + (index * Math.PI) / points;
        const size = radius * (index % 2 === 0 ? 1 : inner);
        return new THREE.Vector2(
          Math.cos(theta) * size,
          Math.sin(theta) * size,
        );
      });
      for (let index = 0; index < corners.length; index++) {
        const corner = corners[index];
        const previous = corners[(index + corners.length - 1) % corners.length];
        const next = corners[(index + 1) % corners.length];
        const start = corner.clone().lerp(previous, 0.22);
        const end = corner.clone().lerp(next, 0.22);
        if (index === 0) star.moveTo(start.x, start.y);
        else star.lineTo(start.x, start.y);
        star.quadraticCurveTo(corner.x, corner.y, end.x, end.y);
      }
      star.closePath();
      const outline = star.getPoints(5);
      if (outline[0].distanceToSquared(outline[outline.length - 1]) < 1e-12)
        outline.pop();
      const starPositions: number[] = [];
      const starIndices: number[] = [];
      const rings = 6;
      const slices = outline.length;
      // Tessellate the interior as well as the outline. Large flat triangles
      // otherwise cut through the curved lens and leave a dark hole in a star.
      for (let ring = 0; ring <= rings; ring++) {
        for (let slice = 0; slice <= slices; slice++) {
          const edge = outline[slice % slices];
          const point = lensPoint(
            eyeX + offsetX + (edge.x * ring) / rings,
            eyeY + offsetY + (edge.y * ring) / rings,
            0.0006,
          );
          starPositions.push(point.x, point.y, point.z);
          if (ring < rings && slice < slices) {
            const a = ring * (slices + 1) + slice;
            const b = a + slices + 1;
            starIndices.push(a, b + 1, b, a, a + 1, b + 1);
          }
        }
      }
      const starGeometry = remember(new THREE.BufferGeometry());
      starGeometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(starPositions, 3),
      );
      starGeometry.setIndex(starIndices);
      starGeometry.computeVertexNormals();
      const sparkle = mesh(starGeometry, eyeLight, head);
      sparkle.castShadow = false;
      sparkle.receiveShadow = false;
    }
  }

  const nosePoint = facePoint(0, -0.04, 0.006);
  const noseGeometry = remember(new THREE.SphereGeometry(1, 40, 28));
  const nosePositions = noseGeometry.getAttribute("position");
  for (let index = 0; index < nosePositions.count; index++) {
    const y = nosePositions.getY(index);
    // A wide, domed top and a softly tapered lower point, like a plush nose.
    nosePositions.setXYZ(
      index,
      nosePositions.getX(index) * 0.033 * (1 + y * 0.32),
      y * 0.023,
      nosePositions.getZ(index) * 0.018,
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
