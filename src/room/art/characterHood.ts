import * as THREE from "three";
import type { CharacterBuilder } from "./characterBuilder";

/** One padded, collapsed hood: the front opening and hanging back share a skin. */
export function buildCharacterHood(builder: CharacterBuilder, body: THREE.Group) {
  const { remember, smoothNormals, mesh, ellipsoid } = builder;
  const { hoodie, hoodInterior, cord } = builder.surfaces;
  const tau = Math.PI * 2;

  // The cross-section leans out over the bag at the back, but folds tightly
  // under the chin at the front. There is no separate flap or neck ring.
  function hoodPoint(theta: number, phi: number) {
    const sine = Math.sin(theta);
    const front = Math.max(0, -sine);
    const back = Math.max(0, sine);
    const cheekRise = (Math.sqrt(Math.cos(theta) ** 2 + 0.0016) - 0.04) /
      (Math.sqrt(1.0016) - 0.04);
    const frontUpper = 0.675 + cheekRise * 0.112;
    const frontLower = 0.642 + cheekRise * 0.048;
    const upper = sine < 0 ? frontUpper : 0.787 + 0.02 * back ** 1.5;
    const lower = sine < 0 ? frontLower : 0.69 + 0.024 * back - 0.067 * back ** 3;
    const centreY = (upper + lower) * 0.5;
    const radiusY = (upper - lower) * 0.5;
    const crossSin = Math.sin(phi);
    const crossCos = Math.cos(phi);
    // Two compressed folds are sculpted into this same cloth cross-section:
    // a turned-over lip, an inset crease and a plump lower fold. A flat outer
    // ellipse reads as a cape even when its silhouette is nominally correct.
    const outer = THREE.MathUtils.smoothstep(crossSin, 0, 0.25);
    const strength = (0.65 + 0.35 * Math.abs(Math.cos(theta))) *
      (sine < 0 ? 0.2 + 0.8 * (1 - front) ** 2 : 1);
    const fold = outer * strength * (
      0.013 * Math.exp(-(((phi - 0.72) / 0.56) ** 2)) -
      0.008 * Math.exp(-(((phi - 1.4) / 0.38) ** 2)) +
      0.005 * Math.exp(-(((phi - 2.1) / 0.55) ** 2))
    );
    const xRadius = 0.226 + 0.023 * crossSin - 0.009 * crossCos + fold;
    const frontDepth = 0.143 + 0.02 * crossSin - 0.006 * crossCos + fold;
    const backDepth = 0.257 + 0.026 * crossSin - 0.037 * crossCos + fold;
    const acrossBack = back * (1.7 - 0.7 * back);
    return new THREE.Vector3(
      Math.cos(theta) * xRadius,
      centreY + radiusY * crossCos,
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
  const outerIndexCount = (rows / 2) * columns * 6;
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
    // The actual turned-over opening has two padded cloth ends. They tuck
    // into the shell at the cheek and at the centre, leaving a small soft V.
    const lip = new THREE.CatmullRomCurve3([
      new THREE.Vector3(side * 0.225, 0.76, 0.015),
      new THREE.Vector3(side * 0.184, 0.744, -0.102),
      new THREE.Vector3(side * 0.11, 0.715, -0.141),
      new THREE.Vector3(side * 0.046, 0.689, -0.153),
      new THREE.Vector3(side * 0.004, 0.667, -0.14),
    ]);
    function lipPoint(t: number, angle: number) {
      const centre = lip.getPoint(t);
      const tangent = lip.getTangent(t).normalize();
      const across = new THREE.Vector3(-tangent.y, tangent.x, 0).normalize();
      const depth = new THREE.Vector3().crossVectors(tangent, across).normalize();
      const taper = Math.sin(Math.PI * t) ** 0.38;
      return centre
        .addScaledVector(across, Math.cos(angle) * (0.026 - t * 0.006) * taper)
        .addScaledVector(depth, -Math.sin(angle) * 0.016 * taper);
    }
    const lipPositions: number[] = [];
    const lipUvs: number[] = [];
    const lipIndices: number[] = [];
    for (let row = 0; row <= 48; row++) {
      for (let column = 0; column <= 20; column++) {
        const p = lipPoint(row / 48, column / 20 * tau);
        lipPositions.push(p.x, p.y, p.z);
        lipUvs.push(row / 48, column / 20);
        if (row < 48 && column < 20) {
          const a = row * 21 + column;
          const b = a + 21;
          lipIndices.push(a, b, a + 1, a + 1, b, b + 1);
        }
      }
    }
    const lipGeometry = remember(new THREE.BufferGeometry());
    lipGeometry.setAttribute("position", new THREE.Float32BufferAttribute(lipPositions, 3));
    lipGeometry.setAttribute("uv", new THREE.Float32BufferAttribute(lipUvs, 2));
    lipGeometry.setIndex(lipIndices);
    smoothNormals(lipGeometry);
    mesh(lipGeometry, hoodie, body).name = "padded-turned-hood-opening";

    const exitT = 0.76;
    const exitAngle = side < 0 ? Math.PI - 1.9 : 1.9;
    const exit = lipPoint(exitT, exitAngle);
    const along = lipPoint(exitT + 0.001, exitAngle).sub(lipPoint(exitT - 0.001, exitAngle));
    const across = lipPoint(exitT, exitAngle + 0.001).sub(lipPoint(exitT, exitAngle - 0.001));
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
