import * as THREE from "three";
import type { CharacterBuilder } from "./characterBuilder";

type PackSection = { y: number; rx: number; rz: number };

/** Sewn canvas volume and the padded shoulder loops visible in the references. */
export function buildCharacterBackpack(
  builder: CharacterBuilder,
  body: THREE.Group,
): THREE.Group {
  const { remember, smoothNormals, mesh, thread } = builder;
  const { backpack, backpackLight, backpackTrim } = builder.surfaces;
  const tau = Math.PI * 2;
  const exponent = 0.73;

  function interpolate(values: number[], t: number) {
    const cursor = THREE.MathUtils.clamp(t, 0, 1) * (values.length - 1);
    const i = Math.min(values.length - 2, Math.floor(cursor));
    const f = cursor - i;
    const p0 = values[Math.max(0, i - 1)];
    const p1 = values[i];
    const p2 = values[i + 1];
    const p3 = values[Math.min(values.length - 1, i + 2)];
    const previous = p1 - p0;
    const delta = p2 - p1;
    const next = p3 - p2;
    const start = previous * delta > 0 ? (2 * previous * delta) / (previous + delta) : 0;
    const end = delta * next > 0 ? (2 * delta * next) / (delta + next) : 0;
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
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    smoothNormals(geometry);
    return mesh(geometry, material, parent);
  }

  // A changing oval/rounded-rectangle profile keeps the top domed and the
  // lower corners tucked in, with a full, gently convex central canvas panel.
  const sections: PackSection[] = [
    { y: -0.178, rx: 0, rz: 0 },
    { y: -0.17, rx: 0.075, rz: 0.044 },
    { y: -0.151, rx: 0.122, rz: 0.071 },
    { y: -0.112, rx: 0.141, rz: 0.081 },
    { y: -0.031, rx: 0.145, rz: 0.084 },
    { y: 0.05, rx: 0.143, rz: 0.082 },
    { y: 0.105, rx: 0.133, rz: 0.075 },
    { y: 0.14, rx: 0.113, rz: 0.06 },
    { y: 0.165, rx: 0.07, rz: 0.038 },
    { y: 0.172, rx: 0, rz: 0 },
  ];
  const ys = sections.map((section) => section.y);
  const rxs = sections.map((section) => section.rx);
  // The stuffed pack meets the back through its entire middle, rather than
  // leaving an air gap crossed by exposed shoulder-strap attachment tails.
  const rzs = sections.map((section) => {
    // The top dome tucks forward under the collapsed hood. Full canvas depth
    // begins below the shoulders, avoiding a deep block pushing the hood out.
    const upperTaper = THREE.MathUtils.smoothstep(section.y, 0.03, 0.14);
    return section.rz * 1.2 * (1 - upperTaper * 0.54);
  });
  function topDomeOffset(y: number) {
    return -0.035 * THREE.MathUtils.smoothstep(y, 0.04, 0.15);
  }
  function profile(y: number) {
    let low = 0;
    let high = 1;
    for (let iteration = 0; iteration < 22; iteration++) {
      const middle = (low + high) * 0.5;
      if (interpolate(ys, middle) < y) low = middle;
      else high = middle;
    }
    const t = (low + high) * 0.5;
    return { rx: interpolate(rxs, t), rz: interpolate(rzs, t) };
  }
  function rearDepth(x: number, y: number) {
    const { rx, rz } = profile(y);
    const a = Math.min(0.9999, Math.abs(x / Math.max(0.0001, rx)));
    return topDomeOffset(y) +
      rz * Math.max(0, 1 - a ** (2 / exponent)) ** (exponent / 2);
  }
  function sideWidth(y: number, z: number) {
    const { rx, rz } = profile(y);
    const a = Math.min(0.9999, Math.abs((z - topDomeOffset(y)) / Math.max(0.0001, rz)));
    return rx * Math.max(0, 1 - a ** (2 / exponent)) ** (exponent / 2);
  }

  const pack = new THREE.Group();
  pack.name = "padded-canvas-backpack";
  pack.position.set(0, 0.529, 0.205);
  // The reference fills most of the back between the sleeves. Scale the sewn
  // shell, rear pocket and bindings together, preserving their shared surface.
  // Shoulder loops stay on the body and their buried ends still meet the pack.
  pack.scale.x = 1.22;
  body.add(pack);
  surface(
    64,
    48,
    (u, v) => {
      const theta = u * tau;
      const c = Math.cos(theta);
      const s = Math.sin(theta);
      return new THREE.Vector3(
        Math.sign(c) * Math.abs(c) ** exponent * interpolate(rxs, v),
        interpolate(ys, v),
        topDomeOffset(interpolate(ys, v)) +
          Math.sign(s) * Math.abs(s) ** exponent * interpolate(rzs, v),
      );
    },
    backpack,
    pack,
    true,
  ).name = "stuffed-canvas-pack-shell";

  // The zipper follows the actual rear surface. Its fine raised edge gives a
  // sewn recess rather than the projecting frame of a rigid case.
  thread(
    [
      [-0.111, -0.13], [-0.131, -0.075], [-0.13, 0.071],
      [-0.106, 0.13], [-0.065, 0.154], [0, 0.161],
      [0.065, 0.154], [0.106, 0.13], [0.13, 0.071],
      [0.131, -0.075], [0.111, -0.13],
    ].map(([x, y]) => [x, y, rearDepth(x, y) + 0.0008]),
    0.0013,
    backpackTrim,
    pack,
    64,
  ).name = "inset-pack-zipper-seam";

  /** Soft, flattened webbing swept along a curve with capped rounded ends. */
  function strap(
    points: number[][],
    width: number,
    thickness: number,
    material: THREE.Material,
    parent: THREE.Object3D,
    wideAxis = new THREE.Vector3(1, 0, 0),
    rows = 48,
  ) {
    const curve = new THREE.CatmullRomCurve3(
      points.map(([x, y, z]) => new THREE.Vector3(x, y, z)),
    );
    const axis = wideAxis.clone().normalize();
    return surface(
      16,
      rows,
      (u, v) => {
        const center = curve.getPoint(v);
        const tangent = curve.getTangent(v).normalize();
        const across = axis.clone().addScaledVector(tangent, -axis.dot(tangent)).normalize();
        const normal = new THREE.Vector3().crossVectors(tangent, across).normalize();
        const phi = u * tau;
        const cap = Math.min(1, Math.sin(Math.PI * v) ** 0.45 * 2.2);
        return center
          .addScaledVector(across, Math.cos(phi) * width * 0.5 * cap)
          .addScaledVector(normal, Math.sin(phi) * thickness * 0.5 * cap);
      },
      material,
      parent,
    );
  }

  // One continuous convex pocket panel. Its boundary lies on the bag, while
  // the middle holds a little air; rounded corners recede into the sewn edge.
  function pocketPoint(angle: number, radius: number) {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const x = radius * Math.sign(c) * Math.abs(c) ** 0.52 * 0.12;
    const y = -0.099 + radius * Math.sign(s) * Math.abs(s) ** 0.52 * 0.052;
    const z = rearDepth(x, y) + 0.001 + 0.026 * Math.max(0, 1 - radius ** 2) ** 0.7;
    return new THREE.Vector3(x, y, z);
  }
  surface(
    64,
    16,
    (u, v) => pocketPoint(u * tau, v),
    backpackLight,
    pack,
    true,
  ).name = "convex-sewn-backpack-pocket";
  const pocketLip = [-1, -0.75, -0.35, 0, 0.35, 0.75, 1].map((t) => {
    const x = t * 0.109;
    const y = -0.058 + (1 - t * t) * 0.004;
    return [x, y, rearDepth(x, y) + 0.013 - Math.abs(t) * 0.003];
  });
  strap(pocketLip, 0.011, 0.004, backpack, pack, new THREE.Vector3(0, 1, 0), 32)
    .name = "sewn-pocket-zipper-lip";
  strap(
    [
      [-0.094, -0.059, rearDepth(-0.094, -0.059) + 0.013],
      [-0.096, -0.071, rearDepth(-0.096, -0.071) + 0.022],
      [-0.096, -0.085, rearDepth(-0.096, -0.085) + 0.025],
    ],
    0.007,
    0.003,
    backpackTrim,
    pack,
    new THREE.Vector3(1, 0, 0),
    16,
  ).name = "soft-pocket-zipper-pull";

  for (const side of [-1, 1]) {
    // A sewn side pocket rises only a few millimetres from the shell. The lip
    // conforms to its convex side instead of forming a horizontal shelf.
    function sidePocketPoint(u: number, v: number) {
      const y = -0.062 + v * 0.108;
      const z = topDomeOffset(y) - 0.004 +
        (u * 2 - 1) * (0.048 - 0.004 * (1 - v));
      const bulge = 0.007 * Math.sin(Math.PI * u) ** 0.7 * Math.sin(Math.PI * v) ** 0.65;
      return new THREE.Vector3(side * (sideWidth(y, z) + 0.0008 + bulge), y, z);
    }
    surface(24, 24, sidePocketPoint, backpackLight, pack, side > 0)
      .name = "sewn-canvas-side-pocket";
    const lip = [0, 0.15, 0.35, 0.5, 0.65, 0.85, 1].map((u) => {
      const p = sidePocketPoint(u, 0.96);
      p.x += side * 0.001;
      return [p.x, p.y, p.z];
    });
    strap(lip, 0.011, 0.0035, backpack, pack, new THREE.Vector3(0, 1, 0), 24)
      .name = "flush-side-pocket-binding";

    const sideZip = Array.from({ length: 25 }, (_, index) => {
      const y = THREE.MathUtils.lerp(0.142, -0.035, index / 24);
      const z = topDomeOffset(y) - 0.004;
      const v = THREE.MathUtils.clamp((y + 0.062) / 0.108, 0, 1);
      // Follow the pocket's actual padding as well as the underlying shell;
      // a straight chord would sink through its centre and leave a stray tip.
      const raised = 0.0025 + 0.007 * Math.sin(Math.PI * v) ** 0.65;
      return [side * (sideWidth(y, z) + raised), y, z];
    });
    strap(sideZip, 0.011, 0.003, backpackTrim, pack, new THREE.Vector3(0, 0, 1), 32)
      .name = "inset-side-zipper-placket";

    // Broad stuffed canvas embraces the shoulder. The inward front arc and
    // underarm return remain visible at a three-quarter angle; both endpoints
    // disappear into the bag, rather than hanging down like suspenders.
    strap(
      [
        [side * 0.07, 0.659, 0.19],
        [side * 0.09, 0.688, 0.15],
        [side * 0.135, 0.69, 0.05],
        [side * 0.154, 0.663, -0.04],
        [side * 0.132, 0.621, -0.105],
        [side * 0.122, 0.571, -0.128],
        [side * 0.135, 0.522, -0.126],
        [side * 0.166, 0.484, -0.103],
        [side * 0.17, 0.47, -0.07],
        [side * 0.165, 0.457, -0.005],
        [side * 0.07, 0.442, 0.08],
        [side * 0.07, 0.427, 0.17],
      ],
      0.043,
      0.016,
      backpackLight,
      body,
      new THREE.Vector3(1, 0, 0),
      64,
    ).name = "curved-padded-shoulder-loop";
  }

  strap(
    [[-0.032, 0.145, -0.012], [-0.03, 0.175, -0.01], [0, 0.184, -0.01],
      [0.03, 0.175, -0.01], [0.032, 0.145, -0.012]]
      .map(([x, y, z]) => [x, y, z + topDomeOffset(y)]),
    0.016,
    0.006,
    backpackTrim,
    pack,
    new THREE.Vector3(0, 0, 1),
    32,
  ).name = "folded-canvas-carry-loop";

  return pack;
}
