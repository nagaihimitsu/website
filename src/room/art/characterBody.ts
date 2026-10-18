import * as THREE from "three";
import type { CharacterBuilder } from "./characterBuilder";
import { buildCharacterBackpack } from "./characterBackpack";
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
    hoodInterior,
    pocketFabric,
    pants,
    pantCuffs,
    shoeSole,
    cord,
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

  // The collapsed hood has two front lapels and one broad rear drape. Its
  // padded lower centre falls over the upper backpack instead of circling the
  // neck as two level rolls. The rear section has a single soft convex fold.
  const hoodRadial = [
    0.79, 0.88, 1.0, 1.04, 1.05, 1.055, 1.015, 0.92, 0.77, 0.79,
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
      const lower = 0.632 + lapelRise * 0.033;
      const thickness = 0.058 + lapelRise * 0.112;
      const upperRimDrop = 0.035 * lapelRise;
      const folds =
        Math.sin(theta * 3 + v * 4) * 0.0027 * Math.sin(Math.PI * v);
      const frontPoint = new THREE.Vector3(
        Math.cos(theta) * 0.252 * radial,
        lower + height * thickness - upperRimDrop * height ** 2 + folds,
        0.012 + Math.sin(theta) * (0.135 + back * 0.045) * radial,
      );
      if (isFront) return frontPoint;

      // A compact oval section forms the rolled edge at the nape. The broad
      // hanging pouch below stays visible beneath this small upper fold.
      const sine = Math.max(0, Math.sin(theta));
      // The rear is only a compact nape roll; the separate padded pouch
      // below supplies the drooping outline and the low central fold.
      const rearWeight = sine * (1.35 - 0.35 * sine);
      const phi = (v - 0.2) * tau;
      const radialRear = 0.92 + 0.1 * Math.sin(phi);
      const rearY = 0.77 + 0.035 * Math.cos(phi);
      const rearZ = 0.164 - 0.01 * Math.cos(phi) + 0.026 * Math.sin(phi);
      // The upper roll hugs the nape through the shoulders.
      const depthAcross = sine * (1.1 - 0.1 * sine);
      return new THREE.Vector3(
        Math.cos(theta) * (0.252 - sine * 0.014) *
          THREE.MathUtils.lerp(radial, radialRear, rearWeight),
        THREE.MathUtils.lerp(frontPoint.y, rearY, rearWeight),
        0.012 + depthAcross * (rearZ - 0.012),
      );
    },
    hoodie,
    body,
  );
  hood.name = "folded-fabric-hood";
  // A collapsed hood is a hanging pouch, not a toroidal collar. This closed
  // padded piece tucks beneath the nape roll and tapers into a soft lower V.
  // Its boundary is buried at the shoulders; its centre sits over the upper
  // canvas dome. Front/back hemispheres keep an actual cloth volume at the tip.
  surface(
    64,
    40,
    (u, v) => {
      const angle = u * tau;
      const radius = Math.sin(v * Math.PI);
      const sx = Math.cos(angle) * radius;
      const sy = Math.sin(angle) * radius;
      const x = 0.23 * sx * (1 + sy * 0.18);
      const y = 0.715 + 0.08 * sy - 0.005 * sy ** 2 + 0.025 * sx ** 2;
      // One smooth support plane through the shared poles: interpolating
      // depth independently along each spoke leaves a crease across the pouch.
      const z = 0.2 - (y - 0.715) * 0.55 - 0.08 * (x / 0.23) ** 2;
      return new THREE.Vector3(x, y, z + Math.cos(v * Math.PI) * 0.045);
    },
    hoodie,
    body,
    true,
  ).name = "padded-hanging-hood-pouch";
  // Two broad, padded folds cross at the low point of the V. Their ends disappear
  // into the parent cloth, so the visible edges read as folded fabric surfaces.
  for (const side of [-1, 1]) {
    const lapel = new THREE.CatmullRomCurve3([
      new THREE.Vector3(side * 0.228, 0.771, -0.045),
      new THREE.Vector3(side * 0.178, 0.742, -0.09),
      new THREE.Vector3(side * 0.1, 0.707, -0.121),
      new THREE.Vector3(side * 0.03, 0.678, -0.135 - (side < 0 ? 0.002 : 0)),
      new THREE.Vector3(-side * 0.012, 0.669, -0.127),
    ]);
    surface(
      40,
      16,
      (u, v) => {
        const center = lapel.getPoint(u);
        const tangent = lapel.getTangent(u).normalize();
        const across = new THREE.Vector3(-tangent.y, tangent.x, 0).normalize();
        const taper = Math.sin(Math.PI * u) ** 0.22;
        const phi = v * tau;
        const halfWidth = (0.047 - u * 0.023) * taper;
        return center
          .addScaledVector(across, Math.cos(phi) * halfWidth)
          .add(new THREE.Vector3(0, 0, -Math.sin(phi) * 0.021 * taper));
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
    const path = new THREE.CatmullRomCurve3(
      [
        [side * 0.045, 0.711, -0.148],
        [side * 0.047, 0.69, -0.163],
        [side * 0.046, 0.654, -0.176],
        [side * 0.047, 0.623, -0.18],
        [side * 0.045, 0.607, -0.18],
      ].map(([x, y, z]) => new THREE.Vector3(x, y, z)),
    );
    const cordGeometry = remember(new THREE.TubeGeometry(path, 48, 0.0055, 12, false));
    const cordUvs = cordGeometry.getAttribute("uv");
    for (let index = 0; index < cordUvs.count; index++)
      cordUvs.setX(index, cordUvs.getX(index) * path.getLength() / 0.012);
    mesh(cordGeometry, cord, body).name = "soft-braided-hood-cord";

    // A compressed, softly irregular overhand knot followed by a short bound
    // cotton end. The ends bow away from the chest under their own weight.
    const knotGeometry = remember(new THREE.SphereGeometry(1, 24, 16));
    const knotPositions = knotGeometry.getAttribute("position");
    for (let index = 0; index < knotPositions.count; index++) {
      const x = knotPositions.getX(index);
      const y = knotPositions.getY(index);
      const z = knotPositions.getZ(index);
      const twist = 1 + Math.sin(Math.atan2(z, x) * 3 + y * 2) * 0.065;
      knotPositions.setXYZ(index, x * 0.0085 * twist, y * 0.007, z * 0.0075 * twist);
    }
    smoothNormals(knotGeometry);
    mesh(knotGeometry, cord, body, side * 0.045, 0.609, -0.18).name = "soft-cord-knot";
    const aglet = ellipsoid(
      0.0043,
      0.0105,
      0.0043,
      cord,
      body,
      side * 0.0435,
      0.595,
      -0.178,
    );
    aglet.rotation.x = -0.18;
    aglet.rotation.z = -side * 0.12;
    aglet.name = "bound-cotton-cord-end";
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
