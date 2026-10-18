import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import type { RoomAvatarAnimation } from "../types";
import { createCharacterMaterials } from "./characterMaterials";

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
  const surfaces = createCharacterMaterials();
  const {
    fur,
    muzzle,
    earInner,
    earRim,
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
    feature,
    eye,
    eyeLight,
    fibers,
  } = surfaces;
  // Tiny fibres collect diffuse light from surrounding fur; a small warm fill
  // avoids isolated dark subpixel tips against the softly scattering coat.
  fibers.emissive.copy(fur.color);
  fibers.emissiveIntensity = 0.08;
  const remember = <T extends THREE.BufferGeometry>(geometry: T): T => {
    geometries.add(geometry);
    return geometry;
  };
  function smoothNormals(geometry: THREE.BufferGeometry) {
    geometry.computeVertexNormals();
    const positions = geometry.getAttribute("position");
    const normals = geometry.getAttribute("normal");
    const coincident = new Map<
      string,
      { sum: THREE.Vector3; indices: number[] }
    >();
    for (let index = 0; index < positions.count; index++) {
      const key = `${Math.round(positions.getX(index) * 1e6)},${Math.round(positions.getY(index) * 1e6)},${Math.round(positions.getZ(index) * 1e6)}`;
      const entry = coincident.get(key) ?? {
        sum: new THREE.Vector3(),
        indices: [],
      };
      entry.sum.x += normals.getX(index);
      entry.sum.y += normals.getY(index);
      entry.sum.z += normals.getZ(index);
      entry.indices.push(index);
      coincident.set(key, entry);
    }
    for (const { sum, indices } of coincident.values()) {
      sum.normalize();
      for (const index of indices) normals.setXYZ(index, sum.x, sum.y, sum.z);
    }
    normals.needsUpdate = true;
  }
  const sphereGeometry = remember(new THREE.SphereGeometry(1, 24, 16));
  const largeSphereGeometry = remember(new THREE.SphereGeometry(1, 36, 24));
  type FurPatch = {
    mesh: THREE.Mesh;
    count: number;
    length: number;
    allow?: (position: THREE.Vector3) => boolean;
  };
  const furPatches = new Map<THREE.Group, FurPatch[]>();
  function pile(
    root: THREE.Group,
    surface: THREE.Mesh,
    count: number,
    length = 0.0028,
    allow?: FurPatch["allow"],
  ) {
    const patches = furPatches.get(root) ?? [];
    patches.push({ mesh: surface, count, length, allow });
    furPatches.set(root, patches);
  }

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
    const result = mesh(
      Math.max(rx, ry, rz) > 0.08 ? largeSphereGeometry : sphereGeometry,
      surface,
      parent,
      x,
      y,
      z,
    );
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
      remember(new RoundedBoxGeometry(w, h, d, 5, radius)),
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
    const isCuff = surface === ribbing || surface === pantCuffs;
    const geometry = remember(
      new THREE.LatheGeometry(
        profile.getPoints(isCuff ? 24 : 40),
        isCuff ? 32 : 40,
      ),
    );
    if (surface === hoodie || surface === pants) {
      const positions = geometry.getAttribute("position");
      const ys = points.map((point) => point[1]);
      const minY = Math.min(...ys);
      const height = Math.max(...ys) - minY;
      for (let index = 0; index < positions.count; index++) {
        const x = positions.getX(index);
        const y = positions.getY(index);
        const z = positions.getZ(index);
        const radius = Math.hypot(x, z);
        if (radius < 0.015) continue;
        const v = (y - minY) / height;
        const angle = Math.atan2(z, x);
        // Small sewn gathers, concentrated at the hem and sleeve shoulders.
        const gathers =
          Math.exp(-(((v - 0.13) / 0.16) ** 2)) * 0.0022 +
          Math.exp(-(((v - 0.84) / 0.14) ** 2)) * 0.0014;
        const fold =
          Math.sin(angle * 9 + v * 3) * gathers +
          Math.sin(angle * 5 - v * 4) * 0.0008;
        positions.setXYZ(
          index,
          x * (1 + fold / radius),
          y,
          z * (1 + fold / radius),
        );
      }
      smoothNormals(geometry);
    }
    return mesh(geometry, surface, parent);
  }
  function padded(
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
    const geometry = remember(new RoundedBoxGeometry(w, h, d, 6, radius));
    const positions = geometry.getAttribute("position");
    for (let index = 0; index < positions.count; index++) {
      const px = positions.getX(index);
      const py = positions.getY(index);
      const pz = positions.getZ(index);
      const centre =
        Math.max(0, 1 - (px / (w * 0.54)) ** 2) *
        Math.max(0, 1 - (py / (h * 0.54)) ** 2);
      positions.setZ(
        index,
        pz + Math.sign(pz) * centre * Math.min(0.009, d * 0.12),
      );
    }
    smoothNormals(geometry);
    return mesh(geometry, surface, parent, x, y, z);
  }

  // Continuous pear-shaped head; the slightly fuller cheeks avoid a stack of balls.
  const head = new THREE.Group();
  head.position.set(0, 0.916, -0.006);
  body.add(head);
  const headGeometry = remember(new THREE.SphereGeometry(1, 64, 48));
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
  smoothNormals(headGeometry);
  const headMesh = mesh(headGeometry, fur, head);
  pile(head, headMesh, 3000, 0.0044, (point) => {
    // Velvet ends at the embroidered face and glass eye seams.
    if (point.z > -0.14) return true;
    const eyeDistance =
      ((Math.abs(point.x) - 0.104) / 0.052) ** 2 +
      ((point.y + 0.002) / 0.062) ** 2;
    return (
      eyeDistance > 1.1 &&
      !(Math.abs(point.x) < 0.088 && point.y < -0.055 && point.y > -0.13)
    );
  });

  // Concave ear cups have a recessed centre and a soft rolled rim.
  for (const side of [-1, 1]) {
    const ear = new THREE.Group();
    ear.position.set(side * 0.18, 0.182, 0.012);
    ear.rotation.z = side * -0.2;
    head.add(ear);
    // An actual open shell, rather than a dark disc sitting over a solid sphere.
    const shellControlPoints = [
      [0, 0.055],
      [0.35, 0.051],
      [0.65, 0.042],
      [0.86, 0.024],
      [0.99, 0],
      [1.01, -0.026],
      [0.95, -0.045],
      [0.8, -0.051],
    ];
    const shellProfile = new THREE.SplineCurve(
      shellControlPoints.map(([radius, z]) => new THREE.Vector2(radius, z)),
    ).getPoints(48);
    const shellPositions: number[] = [];
    const shellUvs: number[] = [];
    const shellIndices: number[] = [];
    for (let ring = 0; ring < shellProfile.length; ring++) {
      const { x: radius, y: z } = shellProfile[ring];
      for (let segment = 0; segment <= 40; segment++) {
        const angle = (segment / 40) * Math.PI * 2;
        shellPositions.push(
          Math.cos(angle) * radius * 0.1,
          Math.sin(angle) * radius * 0.122,
          z,
        );
        shellUvs.push(segment / 40, ring / (shellProfile.length - 1));
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
    shell.setAttribute("uv", new THREE.Float32BufferAttribute(shellUvs, 2));
    shell.setIndex(shellIndices);
    smoothNormals(shell);
    const shellMesh = mesh(shell, fur, ear);
    pile(head, shellMesh, 440, 0.0035);
    const cupPositions: number[] = [];
    const cupUvs: number[] = [];
    const cupIndices: number[] = [];
    const rings = 28;
    const slices = 48;
    for (let ring = 0; ring <= rings; ring++) {
      const radius = ring / rings;
      for (let segment = 0; segment <= slices; segment++) {
        const angle = (segment / slices) * Math.PI * 2;
        cupPositions.push(
          Math.cos(angle) * radius * 0.078,
          Math.sin(angle) * radius * 0.099,
          0.01 - radius * radius * 0.066,
        );
        cupUvs.push(
          0.5 + Math.cos(angle) * radius * 0.5,
          0.5 + Math.sin(angle) * radius * 0.5,
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
    cup.setAttribute("uv", new THREE.Float32BufferAttribute(cupUvs, 2));
    cup.setIndex(cupIndices);
    smoothNormals(cup);
    mesh(cup, earInner, ear);
    const rim = mesh(
      remember(new THREE.TorusGeometry(0.088, 0.014, 20, 64)),
      earRim,
      ear,
      0,
      0,
      -0.05,
    );
    rim.scale.set(1.02, 1.255, 0.85);
    pile(head, rim, 140, 0.0026);
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

  const cheek = ellipsoid(0.089, 0.048, 0.036, muzzle, head, 0, -0.08, -0.182);
  pile(
    head,
    cheek,
    120,
    0.0016,
    (point) => point.y > -0.08 || Math.abs(point.x) > 0.062,
  );
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
  // The dropped hood is broad folded fabric, with soft asymmetric creases.
  ellipsoid(0.206, 0.081, 0.119, hoodie, body, 0, 0.733, 0.061);
  ellipsoid(0.157, 0.043, 0.081, hoodInterior, body, 0, 0.751, -0.008);
  const hoodPositions: number[] = [];
  const hoodUvs: number[] = [];
  const hoodIndices: number[] = [];
  const hoodSegments = 80;
  const foldSegments = 24;
  for (let ring = 0; ring <= hoodSegments; ring++) {
    const theta = (ring / hoodSegments) * Math.PI * 2;
    const front = Math.max(0, -Math.sin(theta));
    const back = Math.max(0, Math.sin(theta));
    const centreY = 0.731 - front * 0.033 + back * 0.018;
    const centreX = Math.cos(theta) * 0.178;
    const centreZ = Math.sin(theta) * 0.099 + 0.013;
    for (let section = 0; section <= foldSegments; section++) {
      const phi = (section / foldSegments) * Math.PI * 2;
      const gather =
        1 +
        Math.sin(theta * 3 + phi * 2) * 0.07 +
        Math.sin(theta * 7 - phi) * 0.025;
      const width = (0.037 + back * 0.007) * Math.cos(phi) * gather;
      hoodPositions.push(
        centreX + Math.cos(theta) * width,
        centreY + Math.sin(phi) * (0.037 + front * 0.011) * gather,
        centreZ + Math.sin(theta) * width,
      );
      hoodUvs.push(ring / hoodSegments, section / foldSegments);
      if (ring < hoodSegments && section < foldSegments) {
        const a = ring * (foldSegments + 1) + section;
        const b = a + foldSegments + 1;
        hoodIndices.push(a, a + 1, b, b, a + 1, b + 1);
      }
    }
  }
  const hoodGeometry = remember(new THREE.BufferGeometry());
  hoodGeometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(hoodPositions, 3),
  );
  hoodGeometry.setAttribute("uv", new THREE.Float32BufferAttribute(hoodUvs, 2));
  hoodGeometry.setIndex(hoodIndices);
  smoothNormals(hoodGeometry);
  mesh(hoodGeometry, hoodie, body);
  // Low relief fold below the opening; it joins into the padded sides.
  thread(
    [
      [-0.166, 0.72, -0.083],
      [-0.122, 0.694, -0.12],
      [-0.032, 0.68, -0.133],
      [0.054, 0.686, -0.13],
      [0.14, 0.713, -0.103],
    ],
    0.008,
    pocketFabric,
    body,
    36,
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
        [0.058, -0.012],
        [0.039, 0.012],
        [0, 0.025],
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
    pile(arm, paw, 90, 0.0018);
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
  padded(0.261, 0.321, 0.144, 0.062, backpack, pack, 0, 0, 0);
  padded(0.229, 0.112, 0.066, 0.03, backpackLight, pack, 0, -0.084, 0.081);
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
  smoothNormals(tailGeometry);
  const tailMesh = mesh(tailGeometry, fur, tailRoot);
  pile(tailRoot, tailMesh, 320, 0.0034);
  ellipsoid(0.003, 0.003, 0.003, fur, tailRoot, 0.07, -0.172, 0.357);

  // A short velvet pile softens the silhouette without transparent shell layers.
  // One shared tapered strand and one instanced draw per moving body part keep
  // the entire coat at four draw calls; strands never cast noisy tiny shadows.
  const strandPositions: number[] = [];
  const strandIndices: number[] = [];
  for (let ring = 0; ring <= 2; ring++) {
    const t = ring / 2;
    const radius = (1 - t) * 0.055 + 0.002;
    for (let side = 0; side <= 3; side++) {
      const angle = (side / 3) * Math.PI * 2;
      strandPositions.push(
        Math.cos(angle) * radius + t * t * 0.18,
        t,
        Math.sin(angle) * radius,
      );
      if (ring < 2 && side < 3) {
        const a = ring * 4 + side;
        strandIndices.push(a, a + 4, a + 1, a + 1, a + 4, a + 5);
      }
    }
  }
  const strandGeometry = remember(new THREE.BufferGeometry());
  strandGeometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(strandPositions, 3),
  );
  strandGeometry.setIndex(strandIndices);
  strandGeometry.computeVertexNormals();
  let seed = 0x29bc7a31;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const furInstances: THREE.InstancedMesh[] = [];
  group.updateMatrixWorld(true);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const edge = new THREE.Vector3();
  const point = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const nap = new THREE.Vector3();
  const across = new THREE.Vector3();
  const na = new THREE.Vector3();
  const nb = new THREE.Vector3();
  const nc = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const dummy = new THREE.Object3D();
  const tint = new THREE.Color();
  for (const [root, patches] of furPatches) {
    const capacity = patches.reduce((sum, patch) => sum + patch.count, 0);
    const strands = new THREE.InstancedMesh(strandGeometry, fibers, capacity);
    strands.name = "short-velvet-pile";
    strands.castShadow = false;
    strands.receiveShadow = false;
    const rootInverse = root.matrixWorld.clone().invert();
    let instance = 0;
    for (const patch of patches) {
      const geometry = patch.mesh.geometry;
      const positions = geometry.getAttribute("position");
      const normals = geometry.getAttribute("normal");
      const indices = geometry.index;
      const count = indices ? indices.count : positions.count;
      const transform = new THREE.Matrix4().multiplyMatrices(
        rootInverse,
        patch.mesh.matrixWorld,
      );
      const normalTransform = new THREE.Matrix3().getNormalMatrix(transform);
      const vertexIndex = (index: number) =>
        indices ? indices.getX(index) : index;
      const cumulative: number[] = [];
      let area = 0;
      for (let index = 0; index < count; index += 3) {
        a.fromBufferAttribute(positions, vertexIndex(index)).applyMatrix4(
          transform,
        );
        b.fromBufferAttribute(positions, vertexIndex(index + 1)).applyMatrix4(
          transform,
        );
        c.fromBufferAttribute(positions, vertexIndex(index + 2)).applyMatrix4(
          transform,
        );
        area += edge.subVectors(b, a).cross(c.sub(a)).length() * 0.5;
        cumulative.push(area);
      }
      let added = 0;
      for (
        let attempt = 0;
        attempt < patch.count * 4 && added < patch.count;
        attempt++
      ) {
        const target = random() * area;
        let low = 0;
        let high = cumulative.length - 1;
        while (low < high) {
          const middle = (low + high) >>> 1;
          if (cumulative[middle] < target) low = middle + 1;
          else high = middle;
        }
        const i0 = vertexIndex(low * 3);
        const i1 = vertexIndex(low * 3 + 1);
        const i2 = vertexIndex(low * 3 + 2);
        const u = Math.sqrt(random());
        const v = random();
        const wa = 1 - u;
        const wb = u * (1 - v);
        const wc = u * v;
        a.fromBufferAttribute(positions, i0);
        b.fromBufferAttribute(positions, i1);
        c.fromBufferAttribute(positions, i2);
        point
          .copy(a)
          .multiplyScalar(wa)
          .addScaledVector(b, wb)
          .addScaledVector(c, wc)
          .applyMatrix4(transform);
        if (patch.allow && !patch.allow(point)) continue;
        na.fromBufferAttribute(normals, i0);
        nb.fromBufferAttribute(normals, i1);
        nc.fromBufferAttribute(normals, i2);
        normal
          .copy(na)
          .multiplyScalar(wa)
          .addScaledVector(nb, wb)
          .addScaledVector(nc, wc)
          .applyMatrix3(normalTransform)
          .normalize();
        // Short pile lies along the surface instead of pointing straight at
        // the viewer. The visible curved sides read as fibres, not dark dots.
        nap.set(0, -1, 0).addScaledVector(normal, normal.y);
        if (nap.lengthSq() < 0.02)
          nap.set(0, 0, 1).addScaledVector(normal, -normal.z);
        nap.normalize();
        across.crossVectors(normal, nap).normalize();
        nap.addScaledVector(across, (random() - 0.5) * 0.5).normalize();
        dummy.position.copy(point).addScaledVector(normal, -0.00012);
        normal.multiplyScalar(0.48).addScaledVector(nap, 0.88).normalize();
        const length = patch.length * (0.72 + random() * 0.38);
        dummy.quaternion.setFromUnitVectors(up, normal);
        dummy.rotateY(random() * Math.PI * 2);
        dummy.scale.setScalar(length);
        dummy.updateMatrix();
        strands.setMatrixAt(instance, dummy.matrix);
        tint.setScalar(0.98 + random() * 0.035);
        strands.setColorAt(instance, tint);
        instance++;
        added++;
      }
    }
    strands.count = instance;
    strands.instanceMatrix.needsUpdate = true;
    if (strands.instanceColor) strands.instanceColor.needsUpdate = true;
    strands.computeBoundingSphere();
    root.add(strands);
    furInstances.push(strands);
  }

  group.traverse((object) => {
    object.userData.roomRaycastIgnore = true;
    // Picking and the camera test room objects only. Filtering avatar hits after
    // raycasting would still inspect thousands of fur instances each frame.
    if (object instanceof THREE.Mesh) object.raycast = () => undefined;
  });
  let disposed = false;
  let previousTime: number | null = null;
  let stridePhase = 0;
  let easedSpeed = 0;
  let airBlend = 0;
  let airRise = 0;
  const ease = (current: number, target: number, rate: number, dt: number) =>
    THREE.MathUtils.lerp(current, target, 1 - Math.exp(-rate * dt));
  return {
    group,
    animate(state: RoomAvatarAnimation) {
      if (disposed) return;
      const dt =
        previousTime === null
          ? 0
          : THREE.MathUtils.clamp(state.time - previousTime, 0, 0.05);
      previousTime = state.time;
      const speed = THREE.MathUtils.clamp(state.speed, 0, 1);
      easedSpeed = ease(easedSpeed, speed, 11, dt);
      airBlend = ease(airBlend, state.grounded ? 0 : 1, 18, dt);
      airRise = ease(
        airRise,
        THREE.MathUtils.clamp((state.velocityY + 0.6) / 3.2, 0, 1),
        12,
        dt,
      );
      // Integrating cadence keeps the pose continuous when walking becomes running.
      // The former absolute-time frequency switch jumped to an unrelated stride.
      stridePhase =
        (stridePhase +
          dt * (6.5 + easedSpeed * 5) * Math.min(1, easedSpeed * 5)) %
        (Math.PI * 4);
      const walking = easedSpeed * (1 - airBlend);
      const amplitude = state.reducedMotion ? 0.25 : 0.5;
      const swing = Math.sin(stridePhase) * walking * amplitude;
      const breath = state.reducedMotion
        ? 0
        : Math.sin(state.time * 2.1) * 0.0015 * (1 - walking);
      const bounce = (1 - Math.cos(stridePhase * 2)) * 0.5;
      body.position.y = state.reducedMotion
        ? 0
        : breath + bounce * walking * 0.009;
      body.rotation.x = easedSpeed * -0.045;
      body.rotation.z = state.reducedMotion
        ? 0
        : Math.cos(stridePhase) * walking * 0.013;
      head.rotation.y = state.reducedMotion
        ? 0
        : Math.sin(state.time * 0.7) * (1 - easedSpeed) * 0.028;
      head.rotation.z = state.reducedMotion
        ? 0
        : Math.sin(state.time * 1.1) * (1 - easedSpeed) * 0.011;
      const airborneArm = THREE.MathUtils.lerp(-0.22, -0.48, airRise);
      arms[0].rotation.set(
        THREE.MathUtils.lerp(swing, airborneArm, airBlend),
        0,
        -0.07 - airBlend * 0.16,
      );
      arms[1].rotation.set(
        THREE.MathUtils.lerp(-swing, airborneArm, airBlend),
        0,
        0.07 + airBlend * 0.16,
      );
      legs[0].rotation.x = THREE.MathUtils.lerp(
        -swing,
        THREE.MathUtils.lerp(-0.1, 0.32, airRise),
        airBlend,
      );
      legs[1].rotation.x = THREE.MathUtils.lerp(
        swing,
        THREE.MathUtils.lerp(0.1, -0.2, airRise),
        airBlend,
      );
      pack.rotation.x = state.reducedMotion ? 0 : bounce * walking * 0.015;
      tailRoot.rotation.x = state.reducedMotion
        ? 0
        : Math.sin(state.time * 2.5) * 0.035;
      tailRoot.rotation.y = state.reducedMotion
        ? 0
        : Math.sin(stridePhase * 0.5) * (0.045 + walking * 0.08);
      if (state.punchProgress !== null) {
        const t = THREE.MathUtils.clamp(state.punchProgress, 0, 1);
        // Peak remains at the 125 ms gameplay impact; smoothstep gives zero
        // velocity at wind-up, extension and release, without an idle pose snap.
        const impact = 0.125 / 0.42;
        const extension =
          t < impact
            ? THREE.MathUtils.smoothstep(t / impact, 0, 1)
            : 1 - THREE.MathUtils.smoothstep((t - impact) / (1 - impact), 0, 1);
        arms[0].rotation.x = THREE.MathUtils.lerp(
          arms[0].rotation.x,
          1.55,
          extension,
        );
        arms[0].rotation.z += extension * 0.18;
        arms[1].rotation.x = THREE.MathUtils.lerp(
          arms[1].rotation.x,
          0.35,
          extension,
        );
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
      for (const instances of furInstances) instances.dispose();
      surfaces.dispose();
      geometries.clear();
      furPatches.clear();
    },
  };
}
