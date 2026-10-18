import * as THREE from "three";
import type { CharacterBuilder } from "./characterBuilder";
import { buildCharacterBackpack } from "./characterBackpack";
import { buildCharacterHood } from "./characterHood";
import { buildCharacterPaw, buildCharacterShoe } from "./characterExtremities";

type Section = {
  y: number;
  rx: number;
  rz: number;
  x?: number;
  z?: number;
};

/** Sewn, padded shapes with continuous silhouettes, rather than stacked primitives. */
export function buildCharacterBody(
  builder: CharacterBuilder,
  body: THREE.Group,
) {
  const { remember, smoothNormals, mesh, ellipsoid, thread, pile } = builder;
  const {
    fur,
    hoodie,
    ribbing,
    pocketFabric,
    pants,
    pantCuffs,
    shoeSole,
  } = builder.surfaces;
  const tau = Math.PI * 2;

  function interpolate(values: number[], t: number) {
    const cursor = t * (values.length - 1);
    const i = Math.min(values.length - 2, Math.floor(cursor));
    const f = cursor - i;
    const p0 = values[Math.max(0, i - 1)];
    const p1 = values[i];
    const p2 = values[i + 1];
    const p3 = values[Math.min(values.length - 1, i + 2)];
    const previous = p1 - p0;
    const delta = p2 - p1;
    const next = p3 - p2;
    const start =
      previous * delta > 0 ? (2 * previous * delta) / (previous + delta) : 0;
    const end = delta * next > 0 ? (2 * delta * next) / (delta + next) : 0;
    // Monotone Hermite interpolation avoids a bulging seam when the profile
    // turns sharply toward a cap (plain Catmull-Rom overshoots these profiles).
    return (
      (2 * f ** 3 - 3 * f ** 2 + 1) * p1 +
      (f ** 3 - 2 * f ** 2 + f) * start +
      (-2 * f ** 3 + 3 * f ** 2) * p2 +
      (f ** 3 - f ** 2) * end
    );
  }

  function surface(
    columns: number,
    rows: number,
    point: (u: number, v: number) => THREE.Vector3,
    material: THREE.Material,
    parent: THREE.Object3D,
    reverse = false,
  ) {
    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    for (let row = 0; row <= rows; row++) {
      for (let column = 0; column <= columns; column++) {
        const u = column / columns;
        const v = row / rows;
        const p = point(u, v);
        positions.push(p.x, p.y, p.z);
        uvs.push(u, v);
        if (row < rows && column < columns) {
          const a = row * (columns + 1) + column;
          const b = a + columns + 1;
          if (reverse) indices.push(a, b, a + 1, a + 1, b, b + 1);
          else indices.push(a, a + 1, b, a + 1, b + 1, b);
        }
      }
    }
    const geometry = remember(new THREE.BufferGeometry());
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3),
    );
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    smoothNormals(geometry);
    return mesh(geometry, material, parent);
  }

  /** A lightly gathered ellipse/rounded-rectangle loft, capped at both poles. */
  function loft(
    sections: Section[],
    material: THREE.Material,
    parent: THREE.Object3D,
    options: { exponent?: number; folds?: number; rows?: number } = {},
  ) {
    const ys = sections.map((section) => section.y);
    const xs = sections.map((section) => section.x ?? 0);
    const zs = sections.map((section) => section.z ?? 0);
    const rxs = sections.map((section) => section.rx);
    const rzs = sections.map((section) => section.rz);
    const exponent = options.exponent ?? 1;
    return surface(
      48,
      options.rows ?? 40,
      (u, v) => {
        const theta = u * tau;
        const rx = Math.max(0, interpolate(rxs, v));
        const rz = Math.max(0, interpolate(rzs, v));
        const cosine = Math.cos(theta);
        const sine = Math.sin(theta);
        const fold =
          (options.folds ?? 0) *
          Math.sin(Math.PI * v) ** 2 *
          (Math.sin(theta * 5 + v * 4) * 0.55 +
            Math.sin(theta * 9 - v * 5) * 0.45);
        return new THREE.Vector3(
          interpolate(xs, v) +
            Math.sign(cosine) * Math.abs(cosine) ** exponent * rx +
            cosine * fold,
          interpolate(ys, v),
          interpolate(zs, v) +
            Math.sign(sine) * Math.abs(sine) ** exponent * rz +
            sine * fold,
        );
      },
      material,
      parent,
      true,
    );
  }

  // The body is broad through the belly, with a dropped, softly gathered hem.
  const torso = loft(
    [
      { y: 0.319, rx: 0, rz: 0, z: -0.006 },
      { y: 0.323, rx: 0.162, rz: 0.134, z: -0.006 },
      { y: 0.362, rx: 0.184, rz: 0.149, z: -0.008 },
      { y: 0.438, rx: 0.191, rz: 0.153, z: -0.009 },
      { y: 0.538, rx: 0.184, rz: 0.145, z: -0.006 },
      { y: 0.615, rx: 0.177, rz: 0.129, z: 0.003 },
      { y: 0.665, rx: 0.157, rz: 0.111, z: 0.01 },
      { y: 0.697, rx: 0.113, rz: 0.081, z: 0.009 },
      { y: 0.701, rx: 0, rz: 0, z: 0.009 },
    ],
    hoodie,
    body,
    { folds: 0.0014 },
  );
  torso.name = "loose-cotton-body";
  loft(
    [
      { y: 0.314, rx: 0, rz: 0, z: -0.007 },
      { y: 0.315, rx: 0.157, rz: 0.13, z: -0.007 },
      { y: 0.319, rx: 0.175, rz: 0.144, z: -0.007 },
      { y: 0.335, rx: 0.179, rz: 0.145, z: -0.007 },
      { y: 0.343, rx: 0.175, rz: 0.139, z: -0.007 },
      { y: 0.344, rx: 0, rz: 0, z: -0.007 },
    ],
    ribbing,
    body,
    { rows: 24, folds: 0.0006 },
  ).name = "soft-ribbed-hem";

  buildCharacterHood(builder, body);

  // A cloth pocket follows the actual curvature of the belly; its centre has
  // enough volume to read in profile, while the sewn boundary sits on the body.
  function pocketPoint(u: number, v: number) {
    const width = interpolate([0.108, 0.134, 0.135, 0.115, 0.075], v);
    const x = (u * 2 - 1) * width;
    const y = 0.355 + v * 0.145;
    const rx = 0.19;
    const rz = 0.151;
    const bulge =
      Math.sin(Math.PI * u) ** 0.7 * Math.sin(Math.PI * v) ** 0.7 * 0.022;
    return new THREE.Vector3(
      x,
      y,
      -0.01 - rz * Math.sqrt(Math.max(0.01, 1 - (x / rx) ** 2)) - 0.002 - bulge,
    );
  }
  surface(40, 24, pocketPoint, pocketFabric, body, true).name =
    "sewn-kangaroo-pocket";
  for (const side of [0, 1]) {
    const points = [0.5, 0.62, 0.76, 0.88, 1].map((v) => {
      const p = pocketPoint(side, v);
      return [p.x, p.y, p.z - 0.001];
    });
    thread(points, 0.0012, ribbing, body, 16);
  }

  const arms: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    const arm = new THREE.Group();
    arm.name = side < 0 ? "right-arm" : "left-arm";
    arm.position.set(side * 0.171, 0.663, 0.006);
    body.add(arm);
    arms.push(arm);
    loft(
      [
        { y: -0.292, rx: 0, rz: 0, x: side * 0.024, z: -0.018 },
        { y: -0.283, rx: 0.047, rz: 0.049, x: side * 0.024, z: -0.02 },
        { y: -0.251, rx: 0.072, rz: 0.075, x: side * 0.028, z: -0.018 },
        { y: -0.195, rx: 0.083, rz: 0.086, x: side * 0.025, z: -0.011 },
        { y: -0.13, rx: 0.08, rz: 0.08, x: side * 0.022, z: 0.008 },
        { y: -0.063, rx: 0.076, rz: 0.077, x: side * 0.014, z: 0.011 },
        { y: -0.013, rx: 0.067, rz: 0.068, x: side * 0.004, z: 0.006 },
        { y: 0.021, rx: 0.042, rz: 0.041, x: -side * 0.006, z: 0.002 },
        { y: 0.031, rx: 0, rz: 0, x: -side * 0.01 },
      ],
      hoodie,
      arm,
      { folds: 0.0016, rows: 36 },
    ).name = "rounded-bag-sleeve";
    loft(
      [
        { y: -0.308, rx: 0, rz: 0, x: side * 0.024, z: -0.02 },
        { y: -0.305, rx: 0.048, rz: 0.049, x: side * 0.024, z: -0.02 },
        { y: -0.299, rx: 0.056, rz: 0.057, x: side * 0.024, z: -0.02 },
        { y: -0.282, rx: 0.058, rz: 0.06, x: side * 0.024, z: -0.018 },
        { y: -0.277, rx: 0.05, rz: 0.052, x: side * 0.024, z: -0.018 },
        { y: -0.276, rx: 0, rz: 0, x: side * 0.024, z: -0.018 },
      ],
      ribbing,
      arm,
      { rows: 20 },
    );
    buildCharacterPaw(builder, arm, side);
  }

  const legs: THREE.Group[] = [];
  ellipsoid(0.139, 0.043, 0.109, pants, body, 0, 0.347, 0.006);
  for (const side of [-1, 1]) {
    const leg = new THREE.Group();
    leg.name = side < 0 ? "right-leg" : "left-leg";
    leg.position.set(side * 0.073, 0.325, 0.006);
    body.add(leg);
    legs.push(leg);
    loft(
      [
        { y: -0.242, rx: 0, rz: 0 },
        { y: -0.239, rx: 0.052, rz: 0.054, x: side * 0.004, z: -0.004 },
        { y: -0.208, rx: 0.058, rz: 0.063, x: side * 0.004, z: -0.002 },
        { y: -0.153, rx: 0.064, rz: 0.071, x: side * 0.002 },
        { y: -0.082, rx: 0.071, rz: 0.082, z: 0.004 },
        { y: -0.012, rx: 0.075, rz: 0.092, x: -side * 0.004, z: 0.007 },
        { y: 0.024, rx: 0.058, rz: 0.069, x: -side * 0.007, z: 0.007 },
        { y: 0.029, rx: 0, rz: 0, z: 0.007 },
      ],
      pants,
      leg,
      { folds: 0.001, rows: 32 },
    ).name = "tapered-trousers";
    loft(
      [
        { y: -0.255, rx: 0, rz: 0, x: side * 0.004, z: -0.005 },
        { y: -0.252, rx: 0.05, rz: 0.053, x: side * 0.004, z: -0.005 },
        { y: -0.246, rx: 0.062, rz: 0.063, x: side * 0.004, z: -0.005 },
        { y: -0.222, rx: 0.064, rz: 0.067, x: side * 0.004, z: -0.004 },
        { y: -0.213, rx: 0.055, rz: 0.058, x: side * 0.004, z: -0.003 },
        { y: -0.212, rx: 0, rz: 0, x: side * 0.004, z: -0.003 },
      ],
      pantCuffs,
      leg,
      { rows: 20 },
    );

    // The soft rubber rim follows the foot; the cap and dark cloth upper share
    // a sculpted surface so the large rounded pale toe is not an added sphere.
    const shoeSections = (values: number[][]) =>
      values.map(([y, rx, rz]) => ({
        y: y - 0.325,
        rx,
        rz,
        x: side * 0.004,
        z: -0.024,
      }));
    loft(
      shoeSections([
        [0.001, 0, 0],
        [0.002, 0.053, 0.08],
        [0.005, 0.059, 0.087],
        [0.012, 0.061, 0.089],
        [0.018, 0.0605, 0.089],
        [0.019, 0, 0],
      ]),
      shoeSole,
      leg,
      { rows: 24 },
    ).name = "rounded-thin-shoe-sole";
    buildCharacterShoe(builder, leg, side);
  }

  const pack = buildCharacterBackpack(builder, body);

  const tailRoot = new THREE.Group();
  tailRoot.name = "soft-tapered-tail";
  // Bury the root below the sweatshirt hem; its thicker base should emerge
  // from the trousers rather than cut an angular notch into the ribbed band.
  tailRoot.position.set(0, 0.295, 0.075);
  body.add(tailRoot);
  const tailCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0.004, -0.036, 0.085),
    new THREE.Vector3(0.007, -0.085, 0.163),
    new THREE.Vector3(0.014, -0.139, 0.248),
    new THREE.Vector3(0.022, -0.167, 0.312),
    new THREE.Vector3(0.026, -0.17, 0.351),
  ]);
  const tailGeometry = remember(
    new THREE.TubeGeometry(tailCurve, 56, 1, 28, false),
  );
  const tailPositions = tailGeometry.getAttribute("position");
  for (let ring = 0; ring <= 56; ring++) {
    const t = ring / 56;
    const center = tailCurve.getPointAt(t);
    const rootBlend = THREE.MathUtils.smoothstep(t, 0, 0.2);
    const rootTaper = 1 - 0.1 * (1 - THREE.MathUtils.smoothstep(t, 0.12, 0.38));
    const radius = (0.058 * Math.pow(1 - t, 0.78) + 0.008) *
      (0.8 + 0.2 * rootBlend) * rootTaper;
    for (let segment = 0; segment <= 28; segment++) {
      const index = ring * 29 + segment;
      tailPositions.setXYZ(
        index,
        center.x + (tailPositions.getX(index) - center.x) * radius,
        center.y + (tailPositions.getY(index) - center.y) * radius,
        center.z + (tailPositions.getZ(index) - center.z) * radius,
      );
    }
  }
  smoothNormals(tailGeometry);
  const tail = mesh(tailGeometry, fur, tailRoot);
  pile(tailRoot, tail, 220, 0.0014);
  ellipsoid(0.008, 0.008, 0.008, fur, tailRoot, 0.026, -0.17, 0.351);

  return { arms, legs, pack, tailRoot };
}
