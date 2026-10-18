import * as THREE from "three";
import type { CharacterBuilder } from "./characterBuilder";

export const EYE_X = 0.116;
export const EYE_Y = 0.012;
export const EYE_RADIUS_X = 0.044;
export const EYE_RADIUS_Y = 0.05;

type EyeLayout = {
  side: number;
  centre: THREE.Vector3;
  right: THREE.Vector3;
  up: THREE.Vector3;
  normal: THREE.Vector3;
};

/** Each oval has one rigid frame. Cheek curvature must not stretch its outline. */
export function createEyeLayouts(depth: (x: number, y: number) => number): EyeLayout[] {
  return [-1, 1].map((side) => {
    const normal = new THREE.Vector3(side * 0.27, 0.16, -1).normalize();
    const right = new THREE.Vector3(1, 0, side * 0.27).normalize();
    const up = new THREE.Vector3().crossVectors(right, normal).normalize();
    return {
      side,
      centre: new THREE.Vector3(side * EYE_X, EYE_Y, depth(side * EYE_X, EYE_Y)),
      right,
      up,
      normal,
    };
  });
}

/** Gently seat the eyes in the plush, without warping the eye or its stars. */
export function eyeSocketDepth(x: number, y: number, depth: number, eyes: EyeLayout[]) {
  for (const eye of eyes) {
    const dx = x - eye.centre.x;
    const dy = y - eye.centre.y;
    const plane = -(eye.normal.x * dx + eye.normal.y * dy) / eye.normal.z;
    const u = dx * eye.right.x + dy * eye.right.y + plane * eye.right.z;
    const v = dx * eye.up.x + dy * eye.up.y + plane * eye.up.z;
    const radius = Math.hypot(u / EYE_RADIUS_X, v / EYE_RADIUS_Y);
    const weight = 1 - THREE.MathUtils.smoothstep(radius, 1.15, 1.9);
    // Recess only the plush that would intersect the rigid lens. Pulling the
    // entire socket forward produces an artificial bright shelf below the eye.
    const seatedDepth = Math.max(depth, eye.centre.z + plane + 0.003);
    depth = THREE.MathUtils.lerp(depth, seatedDepth, weight);
  }
  return depth;
}

export function buildCharacterEyes(builder: CharacterBuilder, head: THREE.Group, eyes: EyeLayout[]) {
  const { remember, mesh, smoothNormals, surfaces } = builder;
  for (const eye of eyes) {
    const point = (u: number, v: number, lift = 0) => {
      const radiusSquared = (u / EYE_RADIUS_X) ** 2 + (v / EYE_RADIUS_Y) ** 2;
      const dome = 0.012 * Math.max(0, 1 - radiusSquared);
      return eye.centre.clone()
        .addScaledVector(eye.right, u)
        .addScaledVector(eye.up, v)
        .addScaledVector(eye.normal, dome + lift);
    };
    const rings = 18;
    const slices = 64;
    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    for (let ring = 0; ring <= rings; ring++) {
      const radius = ring < rings ? ring / (rings - 1) : 1.025;
      for (let slice = 0; slice <= slices; slice++) {
        const theta = slice / slices * Math.PI * 2;
        const u = Math.cos(theta) * radius * EYE_RADIUS_X;
        const v = Math.sin(theta) * radius * EYE_RADIUS_Y;
        positions.push(...point(u, v).toArray());
        uvs.push(u / (EYE_RADIUS_X * 2) + 0.5, v / (EYE_RADIUS_Y * 2) + 0.5);
        if (ring < rings && slice < slices) {
          const a = ring * (slices + 1) + slice;
          const b = a + slices + 1;
          indices.push(a, b + 1, b, a, a + 1, b + 1);
        }
      }
    }
    const geometry = remember(new THREE.BufferGeometry());
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.addGroup(0, (rings - 1) * slices * 6, 0);
    geometry.addGroup((rings - 1) * slices * 6, slices * 6, 1);
    smoothNormals(geometry);
    const lens = mesh(geometry, surfaces.eye, head);
    lens.material = [surfaces.eye, surfaces.eyeRim];
    lens.name = `${eye.side < 0 ? "left" : "right"}-rigid-oval-eye`;

    // Shape coordinates are local to the lens, not a second projection onto the
    // face. Stars retain their proportions as one rigid eye turns in 3D.
    for (const [offsetX, offsetY, radius, points, inner] of [
      [-eye.side * 0.009, 0.018, 0.0185, 5, 0.55],
      [eye.side * 0.023, -0.020, 0.0102, 4, 0.32],
    ]) {
      const star = new THREE.Shape();
      const corners = Array.from({ length: points * 2 }, (_, index) => {
        const theta = Math.PI / 2 + index * Math.PI / points;
        const size = radius * (index % 2 === 0 ? 1 : inner);
        return new THREE.Vector2(Math.cos(theta) * size, Math.sin(theta) * size);
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
      if (outline[0].distanceToSquared(outline[outline.length - 1]) < 1e-12) outline.pop();
      const starPositions: number[] = [];
      const starIndices: number[] = [];
      const starRings = 6;
      const starSlices = outline.length;
      for (let ring = 0; ring <= starRings; ring++) {
        for (let slice = 0; slice <= starSlices; slice++) {
          const edge = outline[slice % starSlices];
          starPositions.push(...point(offsetX + edge.x * ring / starRings,
            offsetY + edge.y * ring / starRings, 0.00045).toArray());
          if (ring < starRings && slice < starSlices) {
            const a = ring * (starSlices + 1) + slice;
            const b = a + starSlices + 1;
            starIndices.push(a, b + 1, b, a, a + 1, b + 1);
          }
        }
      }
      const starGeometry = remember(new THREE.BufferGeometry());
      starGeometry.setAttribute("position", new THREE.Float32BufferAttribute(starPositions, 3));
      starGeometry.setIndex(starIndices);
      starGeometry.computeVertexNormals();
      const sparkle = mesh(starGeometry, surfaces.eyeLight, head);
      sparkle.name = `${eye.side < 0 ? "left" : "right"}-eye-star-${points}`;
      sparkle.castShadow = false;
      sparkle.receiveShadow = false;
    }
  }
}
