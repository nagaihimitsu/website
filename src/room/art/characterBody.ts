import * as THREE from "three";
import type { CharacterBuilder } from "./characterBuilder";

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
    hoodInterior,
    pocketFabric,
    pants,
    pantCuffs,
    shoeUpper,
    shoeSole,
    ivory,
    backpack,
    backpackTrim,
    backpackLight,
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

  // A broad, folded sheet: high at the nape and low at the front. The varying
  // cross-section makes a collapsed hood, with two folds, rather than a neck ring.
  const hoodRadial = [
    0.82, 0.88, 1.01, 1.055, 0.995, 1.055, 1.005, 0.87, 0.76, 0.82,
  ];
  const hoodFrontRadial = [
    0.82, 0.88, 1.015, 1.025, 1.015, 1.01, 0.96, 0.87, 0.76, 0.82,
  ];
  const hoodHeight = [0.76, 0.95, 1, 0.83, 0.58, 0.36, 0.16, 0.04, 0.26, 0.76];
  const hood = surface(
    80,
    32,
    (u, v) => {
      const theta = u * tau;
      const back = (Math.sin(theta) + 1) * 0.5;
      const radial = THREE.MathUtils.lerp(
        interpolate(hoodFrontRadial, v),
        interpolate(hoodRadial, v),
        back,
      );
      const height = interpolate(hoodHeight, v);
      const isFront = Math.sin(theta) < 0;
      const lapelRise = Math.abs(Math.cos(theta));
      // Each front half falls diagonally from the cheek to the low centre.
      // A linear rise makes folded lapels instead of a horizontal neck ring.
      const lower = isFront ? 0.632 + lapelRise * 0.033 : 0.67 - back * 0.01;
      const thickness = isFront
        ? 0.058 + lapelRise * 0.112
        : 0.1675 + back * 0.005;
      // Lower only the high cheek rim; the low V and lower folds keep their
      // reference-aligned positions. The two half surfaces agree at the sides.
      const upperRimDrop = 0.035 * (isFront ? lapelRise : 1 - Math.sin(theta));
      const width = 0.252 - Math.max(0, Math.sin(theta)) * 0.044;
      const folds =
        Math.sin(theta * 3 + v * 4) * 0.0027 * Math.sin(Math.PI * v);
      return new THREE.Vector3(
        Math.cos(theta) * width * radial,
        lower + height * thickness - upperRimDrop * height ** 2 + folds,
        0.012 + Math.sin(theta) * (0.135 + back * 0.045) * radial,
      );
    },
    hoodie,
    body,
  );
  hood.name = "folded-fabric-hood";
  // Two broad, padded folds cross at the low point of the V. Their ends disappear
  // into the parent cloth, so the visible edges read as folded fabric surfaces.
  for (const side of [-1, 1]) {
    const lapel = new THREE.CatmullRomCurve3([
      new THREE.Vector3(side * 0.235, 0.775, -0.045),
      new THREE.Vector3(side * 0.178, 0.746, -0.09),
      new THREE.Vector3(side * 0.1, 0.709, -0.119),
      new THREE.Vector3(side * 0.03, 0.677, -0.132 - (side < 0 ? 0.002 : 0)),
      new THREE.Vector3(-side * 0.012, 0.667, -0.123),
    ]);
    surface(
      40,
      16,
      (u, v) => {
        const center = lapel.getPoint(u);
        const tangent = lapel.getTangent(u).normalize();
        const across = new THREE.Vector3(-tangent.y, tangent.x, 0).normalize();
        const taper = Math.sin(Math.PI * u) ** 0.3;
        const phi = v * tau;
        const halfWidth = (0.042 - u * 0.022) * taper;
        return center
          .addScaledVector(across, Math.cos(phi) * halfWidth)
          .add(new THREE.Vector3(0, 0, -Math.sin(phi) * 0.012 * taper));
      },
      hoodie,
      body,
    ).name = "overlapping-hood-lapel";
  }
  // The inner cloth comes up under the jaw. No exposed neck/bib sits between
  // the plush head and its dropped hood in the supplied reference.
  ellipsoid(0.13, 0.05, 0.065, hoodInterior, body, 0, 0.72, 0.07).name =
    "hood-inner-fold";
  // The shadowed inside follows the opening instead of a separate collar bead.
  surface(
    64,
    8,
    (u, v) => {
      const theta = u * tau;
      const back = (Math.sin(theta) + 1) * 0.5;
      const openingY =
        Math.sin(theta) < 0
          ? 0.674 + Math.abs(Math.cos(theta)) * 0.09
          : 0.764 + Math.sin(theta) * 0.053;
      return new THREE.Vector3(
        Math.cos(theta) * (0.19 + v * 0.018),
        openingY + v * 0.016,
        0.013 + Math.sin(theta) * (0.109 + back * 0.032 + v * 0.008),
      );
    },
    hoodInterior,
    body,
  );

  for (const side of [-1, 1]) {
    thread(
      [
        [side * 0.045, 0.708, -0.143],
        [side * 0.043, 0.663, -0.151],
        [side * 0.047, 0.622, -0.16],
        [side * 0.044, 0.602, -0.164],
      ],
      0.0046,
      ivory,
      body,
      28,
    );
    ellipsoid(0.007, 0.006, 0.007, ivory, body, side * 0.045, 0.607, -0.164);
    const aglet = ellipsoid(
      0.004,
      0.01,
      0.004,
      ivory,
      body,
      side * 0.044,
      0.591,
      -0.164,
    );
    aglet.rotation.x = -0.14;
  }

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
    const paw = ellipsoid(
      0.044,
      0.038,
      0.043,
      fur,
      arm,
      side * 0.024,
      -0.316,
      -0.019,
    );
    pile(arm, paw, 70, 0.0011);
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

    // Both sole and upper have rounded toes and heels. No rectangular bottom
    // plate remains; the thin pale rim follows the same continuous outline.
    const shoeSections = (values: number[][]) =>
      values.map(([y, rx, rz]) => ({
        y: y - 0.325,
        rx,
        rz,
        x: side * 0.004,
        z: -0.025,
      }));
    loft(
      shoeSections([
        [0.001, 0, 0],
        [0.002, 0.049, 0.077],
        [0.006, 0.056, 0.084],
        [0.02, 0.056, 0.084],
        [0.025, 0.052, 0.08],
        [0.026, 0, 0],
      ]),
      shoeSole,
      leg,
      { rows: 24 },
    ).name = "rounded-thin-shoe-sole";
    loft(
      shoeSections([
        [0.02, 0, 0],
        [0.021, 0.053, 0.08],
        [0.029, 0.061, 0.09],
        [0.038, 0.062, 0.091],
        [0.058, 0.053, 0.081],
        [0.076, 0.03, 0.05],
        [0.081, 0, 0],
      ]),
      shoeUpper,
      leg,
      { rows: 32 },
    ).name = "soft-round-shoe-upper";
  }

  // The pack is a broad stuffed rectangle that sits against the back. Its side
  // volume and seams matter from the user's requested side-by-side viewpoint.
  const pack = new THREE.Group();
  pack.name = "padded-canvas-backpack";
  pack.position.set(0, 0.529, 0.205);
  body.add(pack);
  const packSections: Section[] = [
    { y: -0.177, rx: 0, rz: 0 },
    { y: -0.174, rx: 0.096, rz: 0.058 },
    { y: -0.153, rx: 0.133, rz: 0.079 },
    { y: -0.112, rx: 0.145, rz: 0.085 },
    { y: 0.065, rx: 0.146, rz: 0.085 },
    { y: 0.132, rx: 0.13, rz: 0.078 },
    { y: 0.158, rx: 0.082, rz: 0.057 },
    { y: 0.173, rx: 0, rz: 0 },
  ];
  loft(packSections, backpack, pack, { exponent: 0.62, rows: 40 });
  const rearPocket = builder.padded(
    0.25,
    0.103,
    0.06,
    0.027,
    backpackLight,
    pack,
    0,
    -0.103,
    0.084,
  );
  rearPocket.name = "backpack-sewn-front-pocket";
  builder.padded(0.257, 0.019, 0.061, 0.008, backpack, pack, 0, -0.057, 0.092);
  function packSeam(x: number, y: number) {
    let low = 0;
    let high = 1;
    for (let iteration = 0; iteration < 20; iteration++) {
      const middle = (low + high) * 0.5;
      if (
        interpolate(
          packSections.map((s) => s.y),
          middle,
        ) < y
      )
        low = middle;
      else high = middle;
    }
    const t = (low + high) * 0.5;
    const rx = interpolate(
      packSections.map((s) => s.rx),
      t,
    );
    const rz = interpolate(
      packSections.map((s) => s.rz),
      t,
    );
    const cosine = Math.min(0.999, Math.abs(x / rx)) ** (1 / 0.62);
    return [x, y, rz * (1 - cosine * cosine) ** (0.62 / 2) + 0.0008];
  }
  thread(
    [
      [-0.117, -0.126],
      [-0.131, -0.067],
      [-0.132, 0.076],
      [-0.105, 0.135],
      [0, 0.158],
      [0.105, 0.135],
      [0.132, 0.076],
      [0.131, -0.067],
      [0.117, -0.126],
    ].map(([x, y]) => packSeam(x, y)),
    0.0022,
    backpackTrim,
    pack,
    64,
  );
  builder.padded(
    0.009,
    0.028,
    0.006,
    0.003,
    backpackTrim,
    pack,
    -0.1,
    -0.075,
    0.122,
  );

  /** Padded webbing: a flattened rounded section, never cylindrical rope. */
  function strap(
    points: number[][],
    width: number,
    thickness: number,
    material: THREE.Material,
    parent: THREE.Object3D,
    wideAxis = new THREE.Vector3(1, 0, 0),
  ) {
    const curve = new THREE.CatmullRomCurve3(
      points.map(([x, y, z]) => new THREE.Vector3(x, y, z)),
    );
    const axis = wideAxis.clone().normalize();
    return surface(
      12,
      40,
      (u, v) => {
        const center = curve.getPoint(v);
        const tangent = curve.getTangent(v).normalize();
        const across = axis
          .clone()
          .addScaledVector(tangent, -axis.dot(tangent))
          .normalize();
        const normal = new THREE.Vector3()
          .crossVectors(tangent, across)
          .normalize();
        const theta = u * tau;
        const a = Math.cos(theta);
        const b = Math.sin(theta);
        return center
          .addScaledVector(
            across,
            Math.sign(a) * Math.abs(a) ** 0.6 * width * 0.5,
          )
          .addScaledVector(
            normal,
            Math.sign(b) * Math.abs(b) ** 0.6 * thickness * 0.5,
          );
      },
      material,
      parent,
    );
  }
  for (const side of [-1, 1]) {
    const sidePocket = builder.padded(
      0.035,
      0.117,
      0.111,
      0.016,
      backpackLight,
      pack,
      side * 0.142,
      -0.002,
      -0.004,
    );
    sidePocket.name = "backpack-soft-side-pocket";
    builder.padded(
      0.04,
      0.016,
      0.114,
      0.007,
      backpack,
      pack,
      side * 0.144,
      0.049,
      -0.004,
    );
    strap(
      [
        [side * 0.103, 0.148, -0.005],
        [side * 0.138, 0.113, -0.006],
        [side * 0.146, 0.051, -0.007],
        [side * 0.146, -0.008, -0.007],
        [side * 0.144, -0.047, -0.007],
      ],
      0.012,
      0.005,
      backpackTrim,
      pack,
      new THREE.Vector3(0, 0, 1),
    );
    strap(
      [
        [side * 0.12, 0.66, 0.2],
        [side * 0.16, 0.68, 0.12],
        [side * 0.18, 0.695, 0.065],
        [side * 0.184, 0.705, 0.015],
        [side * 0.184, 0.687, -0.037],
        [side * 0.184, 0.66, -0.067],
        [side * 0.183, 0.626, -0.08],
        [side * 0.184, 0.566, -0.101],
        [side * 0.181, 0.503, -0.116],
        [side * 0.171, 0.454, -0.107],
        [side * 0.148, 0.417, -0.078],
        [side * 0.118, 0.415, 0],
        [side * 0.1, 0.42, 0.05],
      ],
      0.032,
      0.01,
      backpackLight,
      body,
    ).name = "flat-padded-shoulder-strap";
  }
  strap(
    [
      [-0.033, 0.144, -0.012],
      [-0.031, 0.181, -0.01],
      [0, 0.191, -0.01],
      [0.031, 0.181, -0.01],
      [0.033, 0.144, -0.012],
    ],
    0.015,
    0.007,
    backpackTrim,
    pack,
    new THREE.Vector3(0, 0, 1),
  );

  const tailRoot = new THREE.Group();
  tailRoot.name = "soft-tapered-tail";
  tailRoot.position.set(0, 0.309, 0.101);
  body.add(tailRoot);
  const tailCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0.004, -0.055, 0.073),
    new THREE.Vector3(0.011, -0.127, 0.162),
    new THREE.Vector3(0.025, -0.19, 0.27),
    new THREE.Vector3(0.043, -0.22, 0.361),
    new THREE.Vector3(0.055, -0.227, 0.405),
  ]);
  const tailGeometry = remember(
    new THREE.TubeGeometry(tailCurve, 56, 1, 28, false),
  );
  const tailPositions = tailGeometry.getAttribute("position");
  for (let ring = 0; ring <= 56; ring++) {
    const t = ring / 56;
    const center = tailCurve.getPointAt(t);
    const radius = 0.052 * Math.pow(1 - t, 0.72) + 0.005;
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
  ellipsoid(0.005, 0.005, 0.005, fur, tailRoot, 0.055, -0.227, 0.405);

  return { arms, legs, pack, tailRoot };
}
