import * as THREE from "three";
import type { CharacterBuilder } from "./characterBuilder";

/** One padded, collapsed hood: the front opening and hanging back share a skin. */
export function buildCharacterHood(builder: CharacterBuilder, body: THREE.Group) {
  const { remember, smoothNormals, mesh, ellipsoid } = builder;
  const { hoodie, hoodInterior, cord } = builder.surfaces;
  const tau = Math.PI * 2;

  // The section is a folded padded cloth envelope, with two broad rounded
  // volumes joined by a shallow saddle. Explicit controls avoid an extruded
  // narrow groove or the sharp flare of a perturbed torus.
  const section = new THREE.CatmullRomCurve3([
    [-0.01, 1], [0.028, 0.84], [0.041, 0.35], [0.032, -0.05],
    [0.038, -0.5], [0.02, -0.97], [-0.025, -0.82], [-0.033, 0.2],
  ].map(([radius, height]) => new THREE.Vector3(radius, height * 0.065, 0)), true);

  const hangingSection = new THREE.CatmullRomCurve3([
    [-0.01, 1], [0.028, 0.84], [0.047, 0.35], [0.045, -0.05],
    [0.038, -0.5], [0.02, -0.97], [-0.025, -0.82], [-0.033, 0.2],
  ].map(([radius, height]) => new THREE.Vector3(radius, height * 0.065, 0)), true);

  function hoodPoint(theta: number, phi: number) {
    const sine = Math.sin(theta);
    const front = Math.max(0, -sine);
    const back = Math.max(0, sine);
    const cheekRise = (Math.sqrt(Math.cos(theta) ** 2 + 0.0016) - 0.04) /
      (Math.sqrt(1.0016) - 0.04);
    const upper = sine < 0 ? 0.682 + cheekRise ** 0.78 * 0.112 : 0.794 + 0.038 * back ** 1.7;
    // Cloth rises over both rear shoulders; only the central back pouch hangs.
    const lower = sine < 0 ? 0.65 + cheekRise * 0.024 :
      0.674 + 0.052 * back - 0.067 * back ** 4 - 0.01 * back ** 8;
    const centreY = (upper + lower) * 0.5;
    const radiusY = (upper - lower) * 0.5;
    const sectionT = THREE.MathUtils.euclideanModulo(phi / tau, 1);
    const point = section.getPoint(sectionT).lerp(
      hangingSection.getPoint(sectionT), Math.max(back ** 2, 0.85 * front ** 8),
    );
    const height = point.y / 0.065;
    const xRadius = 0.216 + point.x;
    const frontDepth = 0.139 + point.x * 0.85 -
      0.028 * front ** 10 * (1 - height) * 0.5;
    const backDepth = 0.203 + point.x * 0.9 + 0.037 * (1 - height) * 0.5 +
      0.006 * back ** 8 * Math.max(0, -height) ** 2;
    const acrossBack = back * (1.7 - 0.7 * back);
    return new THREE.Vector3(
      Math.cos(theta) * xRadius,
      centreY + radiusY * height,
      acrossBack * backDepth - front * frontDepth,
    );
  }

  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const columns = 128;
  const rows = 64;
  for (let row = 0; row <= rows; row++) {
    const v = row / rows;
    for (let column = 0; column <= columns; column++) {
      const u = column / columns;
      const p = hoodPoint(u * tau, v * tau);
      positions.push(p.x, p.y, p.z);
      uvs.push(u * 2, v * 0.5);
      if (row < rows && column < columns) {
        const a = row * (columns + 1) + column;
        const b = a + columns + 1;
        indices.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
  }
  const geometry = remember(new THREE.BufferGeometry());
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  const outerIndexCount = (rows * 5 / 8) * columns * 6;
  geometry.addGroup(0, outerIndexCount, 0);
  geometry.addGroup(outerIndexCount, indices.length - outerIndexCount, 1);
  smoothNormals(geometry);
  const hood = mesh(geometry, hoodie, body);
  hood.material = [hoodie, hoodInterior];
  hood.name = "continuous-collapsed-cotton-hood";

  // The narrow shadow at the inner neck opening is buried beneath the plush
  // jaw. It gives the folded fabric depth without a visible collar component.
  ellipsoid(0.128, 0.034, 0.14, hoodInterior, body, 0, 0.696, -0.004).name =
    "buried-hood-lining";

  for (const side of [-1, 1]) {
    // The cord pierces the rolled opening itself. There is no separate lip
    // geometry to terminate abruptly on the side of the folded hood.
    const exitTheta = -Math.PI / 2 + side * 0.19;
    const exitPhi = 1.08;
    const exit = hoodPoint(exitTheta, exitPhi);
    const along = hoodPoint(exitTheta + 0.001, exitPhi)
      .sub(hoodPoint(exitTheta - 0.001, exitPhi));
    const across = hoodPoint(exitTheta, exitPhi + 0.001)
      .sub(hoodPoint(exitTheta, exitPhi - 0.001));
    const normal = along.cross(across).normalize();
    const orientation = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 0, 1), normal,
    );
    const hole = mesh(remember(new THREE.CircleGeometry(0.0062, 24)), hoodInterior, body);
    hole.position.copy(exit).addScaledVector(normal, 0.00025);
    hole.quaternion.copy(orientation);
    hole.name = "recessed-hood-cord-eyelet";
    const binding = mesh(
      remember(new THREE.TorusGeometry(0.0065, 0.0012, 8, 24)), hoodie, body,
    );
    binding.position.copy(exit).addScaledVector(normal, 0.0007);
    binding.quaternion.copy(orientation);
    binding.name = "cloth-bound-cord-eyelet";

    const path = new THREE.CatmullRomCurve3([
      exit.clone().addScaledVector(normal, -0.003),
      exit.clone().addScaledVector(normal, 0.003),
      new THREE.Vector3(exit.x, exit.y - 0.022, -0.176),
      new THREE.Vector3(exit.x - side * 0.001, exit.y - 0.06, -0.18),
      new THREE.Vector3(exit.x - side * 0.002, exit.y - 0.096, -0.181),
    ]);
    const cordGeometry = remember(new THREE.TubeGeometry(path, 48, 0.0044, 12, false));
    const cordUvs = cordGeometry.getAttribute("uv");
    for (let index = 0; index < cordUvs.count; index++)
      cordUvs.setX(index, cordUvs.getX(index) * path.getLength() / 0.012);
    mesh(cordGeometry, cord, body).name = "soft-braided-hood-cord";

    const knotY = exit.y - 0.091;
    const knotGeometry = remember(new THREE.SphereGeometry(1, 24, 16));
    const knotPositions = knotGeometry.getAttribute("position");
    for (let index = 0; index < knotPositions.count; index++) {
      const x = knotPositions.getX(index);
      const y = knotPositions.getY(index);
      const z = knotPositions.getZ(index);
      const twist = 1 + Math.sin(Math.atan2(z, x) * 3 + y * 2) * 0.065;
      knotPositions.setXYZ(index, x * 0.0075 * twist, y * 0.0065, z * 0.0068 * twist);
    }
    smoothNormals(knotGeometry);
    mesh(knotGeometry, cord, body, exit.x - side * 0.002, knotY, -0.181).name = "soft-cord-knot";
    const aglet = ellipsoid(
      0.0038, 0.009, 0.0038, cord, body,
      exit.x - side * 0.0035, knotY - 0.0125, -0.179,
    );
    aglet.rotation.x = -0.18;
    aglet.rotation.z = -side * 0.12;
    aglet.name = "bound-cotton-cord-end";
  }
}
