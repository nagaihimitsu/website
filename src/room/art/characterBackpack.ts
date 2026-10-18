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
  const exponent = 0.62;

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

  // The reference is a softly stuffed rectangular pack: its upper and lower
  // side walls have the same depth. Only the rounded corners turn inward;
  // the body must not lean backward or taper into a narrow shoulder wedge.
  const sections: PackSection[] = [
    { y: -0.178, rx: 0, rz: 0 },
    { y: -0.175, rx: 0.09, rz: 0.043 },
    { y: -0.165, rx: 0.126, rz: 0.066 },
    { y: -0.145, rx: 0.141, rz: 0.078 },
    { y: -0.105, rx: 0.145, rz: 0.08 },
    { y: -0.025, rx: 0.145, rz: 0.081 },
    { y: 0.055, rx: 0.145, rz: 0.08 },
    { y: 0.112, rx: 0.14, rz: 0.078 },
    { y: 0.14, rx: 0.126, rz: 0.068 },
    { y: 0.16, rx: 0.099, rz: 0.053 },
    { y: 0.174, rx: 0.06, rz: 0.03 },
    { y: 0.179, rx: 0, rz: 0 },
  ];
  const ys = sections.map((section) => section.y);
  const rxs = sections.map((section) => section.rx);
  const rzs = sections.map((section) => section.rz);
  // A small inward roll at the top fits beneath the hanging hood, while the
  // broad canvas panel beneath remains upright and softly convex.
  function topDomeOffset(y: number) {
    return -0.01 * THREE.MathUtils.smoothstep(y, 0.11, 0.175);
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
  pack.position.set(0, 0.529, 0.211);
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
  const zipperLine = new THREE.CatmullRomCurve3([
    [-0.119, -0.146], [-0.135, -0.094], [-0.135, 0.079],
    [-0.118, 0.139], [-0.067, 0.165], [0, 0.17],
    [0.067, 0.165], [0.118, 0.139], [0.135, 0.079],
    [0.135, -0.094], [0.119, -0.146],
  ].map(([x, y]) => new THREE.Vector3(x, y, 0)));
  thread(
    Array.from({ length: 97 }, (_, index) => {
      const point = zipperLine.getPoint(index / 96);
      return [point.x, point.y, rearDepth(point.x, point.y) + 0.0015];
    }),
    0.0013,
    backpackTrim,
    pack,
    96,
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
    followsTorso = false,
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
        // At the lower return, canvas lies vertically against the side of
        // the torso. Transporting its frame around the body prevents the
        // webbing from turning into an edge-on horizontal shelf under the arm.
        const outward = followsTorso
          ? new THREE.Vector3(center.x / 0.17 ** 2, 0, center.z / 0.135 ** 2).normalize()
          : null;
        const across = outward
          ? new THREE.Vector3().crossVectors(outward, tangent).normalize()
          : axis.clone().addScaledVector(tangent, -axis.dot(tangent)).normalize();
        const normal = new THREE.Vector3().crossVectors(tangent, across).normalize();
        const phi = u * tau;
        const cap = Math.min(1, Math.sin(Math.PI * v) ** 0.45 * 2.2);
        const lowerWebbing = followsTorso ? THREE.MathUtils.smoothstep(v, 0.62, 0.85) : 0;
        return center
          .addScaledVector(across, Math.cos(phi) * width * (1 - lowerWebbing * 0.49) * 0.5 * cap)
          .addScaledVector(normal, Math.sin(phi) * thickness * (1 - lowerWebbing * 0.55) * 0.5 * cap);
      },
      material,
      parent,
    );
  }

  // One continuous convex pocket panel. Its boundary lies on the bag, while
  // the middle holds a little air; rounded corners recede into the sewn edge.
  function pocketDepth(x: number, y: number) {
    const radius = (
      Math.abs(x / 0.12) ** (2 / 0.52) +
      Math.abs((y + 0.105) / 0.052) ** (2 / 0.52)
    ) ** (0.52 / 2);
    return rearDepth(x, y) + 0.001 +
      0.026 * (1 - THREE.MathUtils.smoothstep(radius, 0.76, 1));
  }
  function pocketPoint(angle: number, radius: number) {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const x = radius * Math.sign(c) * Math.abs(c) ** 0.52 * 0.12;
    const y = -0.105 + radius * Math.sign(s) * Math.abs(s) ** 0.52 * 0.052;
    const z = pocketDepth(x, y);
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
  thread(
    Array.from({ length: 65 }, (_, index) => {
      const point = pocketPoint(index / 64 * tau, 0.995);
      return [point.x, point.y, point.z + 0.0007];
    }),
    0.0009,
    backpackTrim,
    pack,
    80,
  ).name = "stitched-pocket-perimeter";
  const pocketLip = [-1, -0.75, -0.35, 0, 0.35, 0.75, 1].map((t) => {
    const x = t * 0.109;
    const y = -0.065 + (1 - t * t) * 0.003;
    return [x, y, pocketDepth(x, y) + 0.0018];
  });
  strap(pocketLip, 0.011, 0.004, backpack, pack, new THREE.Vector3(0, 1, 0), 32)
    .name = "sewn-pocket-zipper-lip";
  strap(
    [
      [-0.094, -0.064, pocketDepth(-0.094, -0.064) + 0.0018],
      [-0.096, -0.077, pocketDepth(-0.096, -0.077) + 0.002],
      [-0.096, -0.09, pocketDepth(-0.096, -0.09) + 0.001],
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

    // The shoulder padding is one continuous sewn strap. Its top end is
    // buried in the upper back panel, and its thinner underarm return wraps
    // behind the sleeve into the lower lateral anchor. The return remains
    // visible from the rear quarter instead of stopping at the front armpit.
    strap(
      [
        [side * 0.082, 0.669, 0.19],
        [side * 0.105, 0.691, 0.143],
        [side * 0.139, 0.691, 0.053],
        [side * 0.162, 0.663, -0.04],
        [side * 0.15, 0.621, -0.098],
        [side * 0.158, 0.573, -0.112],
        [side * 0.167, 0.548, -0.107],
        [side * 0.18, 0.519, -0.083],
        [side * 0.194, 0.486, -0.06],
        [side * 0.195, 0.46, -0.036],
        [side * 0.187, 0.442, 0.009],
        [side * 0.181, 0.44, 0.086],
        [side * 0.172, 0.442, 0.13],
        [side * 0.159, 0.446, 0.161],
        [side * 0.15, 0.448, 0.193],
      ],
      0.043,
      0.018,
      backpackLight,
      body,
      new THREE.Vector3(1, 0, 0),
      80,
      true,
    ).name = "connected-padded-shoulder-strap";

    // A short reinforced tab sits on the side panel over each lower anchor;
    // both ends enter the canvas instead of leaving an unattached free tail.
    strap(
      [
        [side * 0.139, -0.09, -0.055],
        [side * 0.146, -0.081, -0.035],
        [side * 0.146, -0.076, -0.006],
      ],
      0.019,
      0.004,
      backpack,
      pack,
      new THREE.Vector3(0, 1, 0),
      20,
    ).name = "sewn-lower-strap-anchor";
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
