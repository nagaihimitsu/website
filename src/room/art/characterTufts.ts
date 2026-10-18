import * as THREE from "three";
import type { CharacterBuilder } from "./characterBuilder";

type Lobe = {
  centre: THREE.Vector3;
  up: THREE.Vector3;
  across: THREE.Vector3;
  depth: THREE.Vector3;
  radius: THREE.Vector3;
};

/**
 * Three short, rounded locks grow out of one buried root beside each ear.
 * They follow the crown down toward the outer ear rather than sweeping across
 * the forehead. A smooth union keeps the intersections soft in oblique views.
 */
export function buildCharacterTufts(
  builder: CharacterBuilder,
  head: THREE.Group,
  faceDepth: (x: number, y: number) => number,
) {
  const lobes: Lobe[] = [];
  for (let lock = 0; lock < 3; lock++) {
    const root = new THREE.Vector3(
      0.104 + lock * 0.023,
      0.172 - lock * 0.023,
      0,
    );
    // Keep the broad lower half inside the skull. The former shallow root
    // exposed a long strip of each lobe along the forehead in side view.
    root.z = faceDepth(root.x, root.y) + 0.045;
    const tip = new THREE.Vector3(
      0.107 + lock * 0.024,
      0.218 - lock * 0.025,
      -0.023 - lock * 0.0015,
    );
    const up = tip.clone().sub(root).normalize();
    const across = new THREE.Vector3(1, 0, 0);
    across.addScaledVector(up, -across.dot(up)).normalize();
    const depth = new THREE.Vector3().crossVectors(across, up).normalize();
    lobes.push({
      centre: root.clone().add(tip).multiplyScalar(0.5),
      up,
      across,
      depth,
      radius: new THREE.Vector3(
        (lock === 1 ? 0.018 : 0.0175) - lock * 0.001,
        root.distanceTo(tip) * 0.5,
        0.016 - lock * 0.0008,
      ),
    });
  }

  const smoothUnion = (a: number, b: number) => {
    const blend = Math.max(0, 0.005 - Math.abs(a - b)) / 0.005;
    return Math.min(a, b) - blend * blend * 0.00125;
  };
  const field = (x: number, y: number, z: number) => {
    let distance = Infinity;
    for (const { centre, across, up, depth, radius } of lobes) {
      const dx = x - centre.x;
      const dy = y - centre.y;
      const dz = z - centre.z;
      const v = (dx * up.x + dy * up.y + dz * up.z) / radius.y;
      // A soft rounded cone, rather than a bead: the hidden root is full,
      // while the upper third narrows gently into the padded tip.
      const taper = 1 - THREE.MathUtils.clamp(v, -1, 1) * 0.28;
      const width = radius.x * taper;
      const thickness = radius.z * taper;
      const u = (dx * across.x + dy * across.y + dz * across.z) / width;
      const w = (dx * depth.x + dy * depth.y + dz * depth.z) / thickness;
      const length = Math.hypot(u, v, w);
      const gradient = Math.hypot(u / width, v / radius.y, w / thickness);
      const lobe =
        gradient > 1e-8 ? (length * (length - 1)) / gradient : -radius.z;
      distance = smoothUnion(distance, lobe);
    }
    return distance;
  };

  // Only this tiny patch is sampled. The shared indexed mesh is mirrored for
  // the other ear; no per-frame sculpting or extra material is needed.
  const step = 0.0028;
  const min = new THREE.Vector3(0.08, 0.108, -0.125);
  const [nx, ny, nz] = [34, 44, 43];
  const strideY = nx + 1;
  const strideZ = strideY * (ny + 1);
  const samples = new Float32Array(strideZ * (nz + 1));
  const samplePosition = (index: number) => {
    const z = Math.floor(index / strideZ);
    const remainder = index - z * strideZ;
    const y = Math.floor(remainder / strideY);
    const x = remainder - y * strideY;
    return new THREE.Vector3(
      min.x + x * step,
      min.y + y * step,
      min.z + z * step,
    );
  };
  for (let z = 0; z <= nz; z++) {
    for (let y = 0; y <= ny; y++) {
      for (let x = 0; x <= nx; x++) {
        samples[x + y * strideY + z * strideZ] = field(
          min.x + x * step,
          min.y + y * step,
          min.z + z * step,
        );
      }
    }
  }

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const edges = new Map<string, number>();
  const vertex = (a: number, b: number) => {
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    const cached = edges.get(key);
    if (cached !== undefined) return cached;
    const point = samplePosition(a).lerp(
      samplePosition(b),
      samples[a] / (samples[a] - samples[b]),
    );
    const epsilon = 0.0001;
    const normal = new THREE.Vector3(
      field(point.x + epsilon, point.y, point.z) -
        field(point.x - epsilon, point.y, point.z),
      field(point.x, point.y + epsilon, point.z) -
        field(point.x, point.y - epsilon, point.z),
      field(point.x, point.y, point.z + epsilon) -
        field(point.x, point.y, point.z - epsilon),
    ).normalize();
    const index = positions.length / 3;
    positions.push(point.x, point.y, point.z);
    normals.push(normal.x, normal.y, normal.z);
    uvs.push((point.x - min.x) * 8, (point.y - min.y) * 8);
    edges.set(key, index);
    return index;
  };
  const triangle = (a: number, b: number, c: number) => {
    const pointA = new THREE.Vector3().fromArray(positions, a * 3);
    const pointB = new THREE.Vector3().fromArray(positions, b * 3);
    const pointC = new THREE.Vector3().fromArray(positions, c * 3);
    const normal = new THREE.Vector3().fromArray(normals, a * 3);
    const orientation = pointB.sub(pointA).cross(pointC.sub(pointA)).dot(normal);
    indices.push(a, orientation > 0 ? b : c, orientation > 0 ? c : b);
  };
  const tetrahedra = [
    [0, 5, 1, 6],
    [0, 1, 2, 6],
    [0, 2, 3, 6],
    [0, 3, 7, 6],
    [0, 7, 4, 6],
    [0, 4, 5, 6],
  ];
  for (let z = 0; z < nz; z++) {
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        const a = x + y * strideY + z * strideZ;
        const cube = [
          a,
          a + 1,
          a + 1 + strideY,
          a + strideY,
          a + strideZ,
          a + 1 + strideZ,
          a + 1 + strideY + strideZ,
          a + strideY + strideZ,
        ];
        const count = cube.reduce(
          (sum, corner) => sum + Number(samples[corner] < 0),
          0,
        );
        if (count === 0 || count === 8) continue;
        for (const tetrahedron of tetrahedra) {
          const corners = tetrahedron.map((corner) => cube[corner]);
          const inside = corners.filter((corner) => samples[corner] < 0);
          const outside = corners.filter((corner) => samples[corner] >= 0);
          if (inside.length === 1) {
            triangle(
              vertex(inside[0], outside[0]),
              vertex(inside[0], outside[1]),
              vertex(inside[0], outside[2]),
            );
          } else if (inside.length === 3) {
            triangle(
              vertex(outside[0], inside[0]),
              vertex(outside[0], inside[1]),
              vertex(outside[0], inside[2]),
            );
          } else if (inside.length === 2) {
            const aa = vertex(inside[0], outside[0]);
            const ab = vertex(inside[0], outside[1]);
            const bb = vertex(inside[1], outside[1]);
            const ba = vertex(inside[1], outside[0]);
            triangle(aa, ab, bb);
            triangle(aa, bb, ba);
          }
        }
      }
    }
  }
  const geometry = builder.remember(new THREE.BufferGeometry());
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  for (const side of [-1, 1]) {
    const crest = builder.mesh(geometry, builder.surfaces.fur, head);
    crest.name = `${side < 0 ? "left" : "right"}-soft-ear-tuft-crest`;
    crest.scale.x = side;
  }
}
