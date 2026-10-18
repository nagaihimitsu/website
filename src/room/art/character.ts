import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import type { RoomAvatarAnimation } from "../types";

/**
 * Original, fully volumetric little traveller, modelled from the supplied
 * front / side / rear character reference. Local -Z is forward; feet rest at Y=0.
 * Every material and geometry belongs to this model and is released by dispose.
 */
export function createCharacter() {
  const group = new THREE.Group();
  group.name = "little-traveller";
  group.scale.setScalar(0.98);
  group.userData.roomRaycastIgnore = true;
  const body = new THREE.Group();
  group.add(body);
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const remember = <T extends THREE.BufferGeometry>(geometry: T): T => {
    geometries.add(geometry);
    return geometry;
  };
  const material = (color: string, roughness = 0.75) => {
    const result = new THREE.MeshStandardMaterial({ color, roughness });
    materials.add(result);
    return result;
  };
  const fur = material("#b98559", 0.53);
  const muzzle = material("#bd8b62", 0.57);
  const earInner = material("#865c4b", 0.69);
  const earRim = material("#ba885d", 0.55);
  const hoodie = material("#7f838c", 0.91);
  const ribbing = material("#737781", 0.94);
  const hoodInterior = material("#676c76", 0.94);
  const pocketFabric = material("#858992", 0.91);
  const pants = material("#33373e", 0.91);
  const pantCuffs = material("#454952", 0.91);
  const shoeUpper = material("#41454c", 0.84);
  const shoeSole = material("#d8d6ce", 0.73);
  const ivory = material("#eeeae1", 0.74);
  const backpack = material("#d9d1c0", 0.82);
  const backpackTrim = material("#bdb3a0", 0.85);
  const backpackLight = material("#e3dbcd", 0.8);
  const feature = material("#27201e", 0.33);
  const eye = new THREE.MeshPhysicalMaterial({
    color: "#181517",
    roughness: 0.12,
    clearcoat: 1,
    clearcoatRoughness: 0.12,
  });
  materials.add(eye);
  const eyeLight = new THREE.MeshBasicMaterial({ color: "#fffdf5" });
  materials.add(eyeLight);
  const sphereGeometry = remember(new THREE.SphereGeometry(1, 24, 16));

  function mesh(
    geometry: THREE.BufferGeometry,
    surface: THREE.Material,
    parent: THREE.Object3D = body,
    x = 0,
    y = 0,
    z = 0,
  ) {
    const result = new THREE.Mesh(geometry, surface);
    result.position.set(x, y, z);
    result.castShadow = true;
    result.receiveShadow = true;
    result.userData.roomRaycastIgnore = true;
    parent.add(result);
    return result;
  }
  function ellipsoid(
    rx: number,
    ry: number,
    rz: number,
    surface: THREE.Material,
    parent: THREE.Object3D,
    x: number,
    y: number,
    z: number,
  ) {
    const result = mesh(sphereGeometry, surface, parent, x, y, z);
    result.scale.set(rx, ry, rz);
    return result;
  }
  function rounded(
    w: number,
    h: number,
    d: number,
    radius: number,
    surface: THREE.Material,
    parent: THREE.Object3D,
    x: number,
    y: number,
    z: number,
  ) {
    return mesh(
      remember(new RoundedBoxGeometry(w, h, d, 3, radius)),
      surface,
      parent,
      x,
      y,
      z,
    );
  }
  function thread(
    points: number[][],
    radius: number,
    surface: THREE.Material,
    parent: THREE.Object3D = body,
    segments = 24,
  ) {
    const curve = new THREE.CatmullRomCurve3(
      points.map(([x, y, z]) => new THREE.Vector3(x, y, z)),
    );
    return mesh(
      remember(new THREE.TubeGeometry(curve, segments, radius, 8, false)),
      surface,
      parent,
    );
  }
  function softLathe(
    points: number[][],
    surface: THREE.Material,
    parent: THREE.Object3D,
  ) {
    const profile = new THREE.SplineCurve(
      points.map(([radius, y]) => new THREE.Vector2(radius, y)),
    );
    return mesh(
      remember(new THREE.LatheGeometry(profile.getPoints(32), 32)),
      surface,
      parent,
    );
  }

  // Continuous pear-shaped head; the slightly fuller cheeks avoid a stack of balls.
  const head = new THREE.Group();
  head.position.set(0, 0.916, -0.006);
  body.add(head);
  const headGeometry = remember(new THREE.SphereGeometry(1, 48, 32));
  const headPositions = headGeometry.attributes.position;
  for (let index = 0; index < headPositions.count; index++) {
    const y = headPositions.getY(index);
    headPositions.setXYZ(
      index,
      headPositions.getX(index) * (1 - y * 0.13) * 0.235,
      y * 0.214,
      headPositions.getZ(index) * (1 - y * 0.075) * 0.205,
    );
  }
  headGeometry.computeVertexNormals();
  mesh(headGeometry, fur, head);

  // Concave ear cups have a recessed centre and a soft rolled rim.
  for (const side of [-1, 1]) {
    const ear = new THREE.Group();
    ear.position.set(side * 0.18, 0.182, 0.012);
    ear.rotation.z = side * -0.2;
    head.add(ear);
    // An actual open shell, rather than a dark disc sitting over a solid sphere.
    const shellProfile = [
      [0, 0.055],
      [0.35, 0.051],
      [0.65, 0.042],
      [0.86, 0.024],
      [0.99, 0],
      [1.01, -0.026],
      [0.95, -0.045],
      [0.8, -0.051],
    ];
    const shellPositions: number[] = [];
    const shellIndices: number[] = [];
    for (let ring = 0; ring < shellProfile.length; ring++) {
      const [radius, z] = shellProfile[ring];
      for (let segment = 0; segment <= 40; segment++) {
        const angle = (segment / 40) * Math.PI * 2;
        shellPositions.push(
          Math.cos(angle) * radius * 0.1,
          Math.sin(angle) * radius * 0.122,
          z,
        );
        if (ring < shellProfile.length - 1 && segment < 40) {
          const a = ring * 41 + segment;
          const b = a + 41;
          shellIndices.push(a, b, b + 1, a, b + 1, a + 1);
        }
      }
    }
    const shell = remember(new THREE.BufferGeometry());
    shell.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(shellPositions, 3),
    );
    shell.setIndex(shellIndices);
    shell.computeVertexNormals();
    mesh(shell, fur, ear);
    const cupPositions: number[] = [];
    const cupIndices: number[] = [];
    const rings = 12;
    const slices = 40;
    for (let ring = 0; ring <= rings; ring++) {
      const radius = ring / rings;
      for (let segment = 0; segment <= slices; segment++) {
        const angle = (segment / slices) * Math.PI * 2;
        cupPositions.push(
          Math.cos(angle) * radius * 0.078,
          Math.sin(angle) * radius * 0.099,
          0.01 - radius * radius * 0.066,
        );
        if (ring < rings && segment < slices) {
          const a = ring * (slices + 1) + segment;
          const b = a + slices + 1;
          cupIndices.push(a, b + 1, b, a, a + 1, b + 1);
        }
      }
    }
    const cup = remember(new THREE.BufferGeometry());
    cup.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(cupPositions, 3),
    );
    cup.setIndex(cupIndices);
    cup.computeVertexNormals();
    mesh(cup, earInner, ear);
    const rim = mesh(
      remember(new THREE.TorusGeometry(0.088, 0.015, 10, 40)),
      earRim,
      ear,
      0,
      0,
      -0.05,
    );
    rim.scale.set(1.02, 1.255, 0.85);
    for (let tuft = 0; tuft < 3; tuft++) {
      const petal = ellipsoid(
        0.014,
        0.025,
        0.015,
        fur,
        ear,
        -side * (0.058 - tuft * 0.016),
        -0.063 + tuft * 0.014,
        -0.061,
      );
      petal.rotation.z = side * (0.5 + tuft * 0.18);
    }
  }

  ellipsoid(0.089, 0.048, 0.036, muzzle, head, 0, -0.08, -0.182);
  ellipsoid(0.028, 0.02, 0.02, feature, head, 0, -0.067, -0.225);
  thread(
    [
      [-0.058, -0.094, -0.219],
      [-0.042, -0.11, -0.224],
      [-0.022, -0.11, -0.23],
      [0, -0.094, -0.235],
      [0.022, -0.11, -0.23],
      [0.042, -0.11, -0.224],
      [0.058, -0.094, -0.219],
    ],
    0.004,
    feature,
    head,
    32,
  );

  const star = new THREE.Shape();
  for (let index = 0; index < 10; index++) {
    const angle = Math.PI / 2 + (index * Math.PI) / 5;
    const radius = index % 2 === 0 ? 0.013 : 0.0067;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    if (index === 0) star.moveTo(x, y);
    else star.lineTo(x, y);
  }
  star.closePath();
  const starGeometry = remember(new THREE.ShapeGeometry(star));
  for (const side of [-1, 1]) {
    const eyeGroup = new THREE.Group();
    eyeGroup.position.set(side * 0.104, -0.002, -0.185);
    eyeGroup.rotation.y = side * -0.18;
    head.add(eyeGroup);
    ellipsoid(0.041, 0.052, 0.028, eye, eyeGroup, 0, 0, 0);
    const highlight = mesh(
      starGeometry,
      eyeLight,
      eyeGroup,
      -0.009,
      0.017,
      -0.0275,
    );
    highlight.rotation.y = Math.PI;
    highlight.castShadow = false;
    highlight.receiveShadow = false;
    const sparkle = ellipsoid(
      0.005,
      0.008,
      0.002,
      eyeLight,
      eyeGroup,
      0.018,
      -0.021,
      -0.021,
    );
    sparkle.rotation.z = -0.35;
    sparkle.castShadow = false;
  }

  // A shaped hoodie, with hem, padded collar, kangaroo pocket and real drawstrings.
  const torso = softLathe(
    [
      [0, 0.35],
      [0.135, 0.35],
      [0.169, 0.38],
      [0.181, 0.48],
      [0.17, 0.6],
      [0.156, 0.68],
      [0.11, 0.715],
      [0, 0.717],
    ],
    hoodie,
    body,
  );
  torso.scale.z = 0.79;
  const hem = softLathe(
    [
      [0, 0.349],
      [0.151, 0.349],
      [0.164, 0.36],
      [0.165, 0.377],
      [0.153, 0.384],
      [0, 0.384],
    ],
    ribbing,
    body,
  );
  hem.scale.z = 0.8;
  ellipsoid(0.217, 0.091, 0.125, hoodie, body, 0, 0.722, 0.055);
  ellipsoid(0.169, 0.055, 0.095, hoodInterior, body, 0, 0.745, -0.009);
  thread(
    [
      [-0.183, 0.752, -0.045],
      [-0.16, 0.705, -0.104],
      [-0.1, 0.686, -0.141],
      [0, 0.673, -0.145],
      [0.1, 0.686, -0.141],
      [0.16, 0.705, -0.104],
      [0.183, 0.752, -0.045],
    ],
    0.027,
    hoodie,
    body,
    40,
  );
  for (const side of [-1, 1]) {
    thread(
      [
        [side * 0.045, 0.688, -0.16],
        [side * 0.039, 0.646, -0.157],
        [side * 0.04, 0.605, -0.161],
      ],
      0.0052,
      ivory,
      body,
      12,
    );
    ellipsoid(0.008, 0.007, 0.007, ivory, body, side * 0.04, 0.605, -0.161);
    rounded(
      0.007,
      0.019,
      0.007,
      0.003,
      ivory,
      body,
      side * 0.04,
      0.591,
      -0.161,
    );
  }
  const pocket = new THREE.Shape();
  pocket.moveTo(-0.118, 0.414);
  pocket.quadraticCurveTo(-0.13, 0.43, -0.113, 0.451);
  pocket.lineTo(-0.073, 0.501);
  pocket.quadraticCurveTo(-0.066, 0.51, -0.055, 0.51);
  pocket.lineTo(0.055, 0.51);
  pocket.quadraticCurveTo(0.066, 0.51, 0.073, 0.501);
  pocket.lineTo(0.113, 0.451);
  pocket.quadraticCurveTo(0.13, 0.43, 0.118, 0.414);
  pocket.quadraticCurveTo(0, 0.405, -0.118, 0.414);
  mesh(
    remember(
      new THREE.ExtrudeGeometry(pocket, {
        depth: 0.011,
        bevelEnabled: true,
        bevelThickness: 0.005,
        bevelSize: 0.005,
        bevelSegments: 3,
        steps: 1,
      }),
    ),
    pocketFabric,
    body,
    0,
    0,
    -0.143,
  );
  for (const side of [-1, 1]) {
    thread(
      [
        [side * 0.076, 0.499, -0.149],
        [side * 0.094, 0.475, -0.15],
        [side * 0.113, 0.451, -0.148],
      ],
      0.0019,
      ribbing,
      body,
      10,
    );
  }

  const arms: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    const arm = new THREE.Group();
    arm.name = side < 0 ? "right-arm" : "left-arm";
    arm.position.set(side * 0.165, 0.667, 0);
    body.add(arm);
    arms.push(arm);
    const sleeve = softLathe(
      [
        [0, -0.26],
        [0.043, -0.258],
        [0.053, -0.225],
        [0.06, -0.13],
        [0.064, -0.052],
        [0.041, -0.008],
        [0, 0.009],
      ],
      hoodie,
      arm,
    );
    sleeve.scale.z = 0.85;
    sleeve.rotation.z = side * 0.1;
    const cuff = softLathe(
      [
        [0, -0.275],
        [0.044, -0.272],
        [0.046, -0.252],
        [0.043, -0.245],
        [0, -0.245],
      ],
      ribbing,
      arm,
    );
    cuff.position.x = side * 0.024;
    cuff.scale.z = 0.86;
    const paw = ellipsoid(
      0.037,
      0.041,
      0.033,
      fur,
      arm,
      side * 0.026,
      -0.291,
      -0.001,
    );
    paw.rotation.z = side * 0.12;
    // Thumb silhouette stays visible when the arm extends into a punch.
    ellipsoid(0.014, 0.022, 0.02, fur, arm, side * 0.004, -0.281, -0.017);
  }

  const legs: THREE.Group[] = [];
  // The pelvis is mostly hidden by the loose hoodie hem.
  ellipsoid(0.132, 0.062, 0.098, pants, body, 0, 0.343, 0.013);
  for (const side of [-1, 1]) {
    const leg = new THREE.Group();
    leg.position.set(side * 0.082, 0.352, 0.008);
    body.add(leg);
    legs.push(leg);
    const trouser = softLathe(
      [
        [0, -0.255],
        [0.046, -0.254],
        [0.053, -0.206],
        [0.057, -0.12],
        [0.063, -0.025],
        [0.055, 0.015],
        [0, 0.023],
      ],
      pants,
      leg,
    );
    trouser.scale.z = 0.88;
    const cuff = softLathe(
      [
        [0, -0.266],
        [0.049, -0.264],
        [0.058, -0.251],
        [0.059, -0.227],
        [0.052, -0.223],
        [0, -0.223],
      ],
      pantCuffs,
      leg,
    );
    cuff.scale.z = 0.92;
    rounded(0.119, 0.024, 0.175, 0.011, shoeSole, leg, 0, -0.34, -0.025);
    rounded(0.11, 0.068, 0.157, 0.031, shoeUpper, leg, 0, -0.302, -0.018);
    ellipsoid(0.054, 0.032, 0.059, ivory, leg, 0, -0.309, -0.065);
  }

  // The backpack is especially important in the following camera: padded seams,
  // a sewn front pocket, side pockets and straps are all actual geometry.
  const pack = new THREE.Group();
  pack.position.set(0, 0.551, 0.191);
  body.add(pack);
  rounded(0.261, 0.321, 0.144, 0.052, backpack, pack, 0, 0, 0);
  rounded(0.229, 0.112, 0.066, 0.025, backpackLight, pack, 0, -0.084, 0.081);
  rounded(0.235, 0.024, 0.068, 0.011, backpack, pack, 0, -0.035, 0.089);
  thread(
    [
      [-0.102, -0.112, 0.074],
      [-0.115, 0.044, 0.066],
      [-0.096, 0.12, 0.063],
      [0, 0.144, 0.062],
      [0.096, 0.12, 0.063],
      [0.115, 0.044, 0.066],
      [0.102, -0.112, 0.074],
    ],
    0.0035,
    backpackTrim,
    pack,
    40,
  );
  thread(
    [
      [-0.032, 0.142, 0],
      [-0.033, 0.178, 0],
      [0.033, 0.178, 0],
      [0.032, 0.142, 0],
    ],
    0.008,
    backpackTrim,
    pack,
    16,
  );
  rounded(
    0.009,
    0.037,
    0.007,
    0.003,
    backpackTrim,
    pack,
    -0.085,
    -0.065,
    0.117,
  );
  for (const side of [-1, 1]) {
    rounded(
      0.034,
      0.105,
      0.09,
      0.015,
      backpackLight,
      pack,
      side * 0.137,
      -0.031,
      -0.005,
    );
    rounded(
      0.039,
      0.014,
      0.094,
      0.005,
      backpackTrim,
      pack,
      side * 0.138,
      0.018,
      -0.005,
    );
    thread(
      [
        [side * 0.116, 0.425, 0.082],
        [side * 0.145, 0.485, -0.082],
        [side * 0.145, 0.605, -0.109],
        [side * 0.137, 0.685, -0.081],
        [side * 0.115, 0.724, 0.025],
        [side * 0.096, 0.699, 0.158],
      ],
      0.014,
      backpackLight,
      body,
      28,
    );
  }

  const tailRoot = new THREE.Group();
  tailRoot.position.set(0, 0.359, 0.103);
  body.add(tailRoot);
  const tailCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0.005, -0.066, 0.077),
    new THREE.Vector3(0.018, -0.147, 0.175),
    new THREE.Vector3(0.045, -0.187, 0.283),
    new THREE.Vector3(0.07, -0.172, 0.357),
  ]);
  const tailGeometry = remember(
    new THREE.TubeGeometry(tailCurve, 32, 1, 14, false),
  );
  const tailPositions = tailGeometry.attributes.position;
  for (let ring = 0; ring <= 32; ring++) {
    const t = ring / 32;
    const centre = tailCurve.getPointAt(t);
    const radius = 0.039 * Math.pow(1 - t, 0.7) + 0.003;
    for (let segment = 0; segment <= 14; segment++) {
      const index = ring * 15 + segment;
      tailPositions.setXYZ(
        index,
        centre.x + (tailPositions.getX(index) - centre.x) * radius,
        centre.y + (tailPositions.getY(index) - centre.y) * radius,
        centre.z + (tailPositions.getZ(index) - centre.z) * radius,
      );
    }
  }
  tailGeometry.computeVertexNormals();
  mesh(tailGeometry, fur, tailRoot);
  ellipsoid(0.003, 0.003, 0.003, fur, tailRoot, 0.07, -0.172, 0.357);

  group.traverse((object) => {
    object.userData.roomRaycastIgnore = true;
  });
  let disposed = false;
  return {
    group,
    animate(state: RoomAvatarAnimation) {
      if (disposed) return;
      const speed = THREE.MathUtils.clamp(state.speed, 0, 1);
      const stride = state.time * (speed > 0.65 ? 11 : 8.5);
      const walking = state.grounded ? speed : 0;
      const amplitude = state.reducedMotion ? 0.25 : 0.5;
      const swing = Math.sin(stride) * walking * amplitude;
      const breath = state.reducedMotion
        ? 0
        : Math.sin(state.time * 2.1) * 0.002;
      body.position.y = state.reducedMotion
        ? 0
        : breath + Math.abs(Math.sin(stride)) * walking * 0.012;
      body.rotation.x = speed * -0.045;
      body.rotation.z = state.reducedMotion
        ? 0
        : Math.cos(stride) * walking * 0.018;
      head.rotation.y = state.reducedMotion
        ? 0
        : Math.sin(state.time * 0.7) * (1 - speed) * 0.035;
      head.rotation.z = state.reducedMotion
        ? 0
        : Math.sin(state.time * 1.1) * (1 - speed) * 0.014;
      arms[0].rotation.set(swing, 0, -0.07);
      arms[1].rotation.set(-swing, 0, 0.07);
      legs[0].rotation.x = -swing;
      legs[1].rotation.x = swing;
      pack.rotation.x = state.reducedMotion
        ? 0
        : Math.abs(Math.sin(stride)) * walking * 0.018;
      tailRoot.rotation.x = state.reducedMotion
        ? 0
        : Math.sin(state.time * 2.5) * 0.045;
      tailRoot.rotation.y = state.reducedMotion
        ? 0
        : Math.sin(stride * 0.5) * (0.06 + walking * 0.11);
      if (!state.grounded) {
        const rising = state.velocityY > 0;
        arms[0].rotation.x = rising ? -0.48 : -0.22;
        arms[1].rotation.x = rising ? -0.48 : -0.22;
        arms[0].rotation.z = -0.23;
        arms[1].rotation.z = 0.23;
        legs[0].rotation.x = rising ? 0.32 : -0.1;
        legs[1].rotation.x = rising ? -0.2 : 0.1;
      }
      if (state.punchProgress !== null) {
        const t = THREE.MathUtils.clamp(state.punchProgress, 0, 1);
        // The quick extension peaks at impact, then settles over the recovery.
        const extension =
          t < 0.32
            ? Math.sin(((t / 0.32) * Math.PI) / 2)
            : Math.pow(1 - (t - 0.32) / 0.68, 1.5);
        arms[0].rotation.x = extension * 1.55;
        arms[0].rotation.z = -0.07 + extension * 0.18;
        arms[1].rotation.x = extension * 0.35;
        body.rotation.y = -extension * 0.12;
        body.rotation.x -= extension * 0.045;
      } else {
        body.rotation.y = 0;
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      group.removeFromParent();
      group.clear();
      for (const geometry of geometries) geometry.dispose();
      for (const surface of materials) surface.dispose();
      geometries.clear();
      materials.clear();
    },
  };
}
