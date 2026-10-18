import * as THREE from "three";
import type { CharacterBuilder } from "./characterBuilder";

const TAU = Math.PI * 2;

/** Soft mitts: a short wrist, broad knuckles and an integrated tucked thumb. */
export function buildCharacterPaw(
  builder: CharacterBuilder,
  arm: THREE.Group,
  side: number,
) {
  const geometry = builder.remember(new THREE.SphereGeometry(1, 48, 32));
  const positions = geometry.getAttribute("position");
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i);
    const y = positions.getY(i);
    const z = positions.getZ(i);
    // The wrist is buried in the cuff. Below it the palm tapers gently, with
    // three quiet knuckle lobes rather than a perfectly spherical orange bead.
    const lower = (1 - y) * 0.5;
    const width = 0.043 * (1.04 - lower * 0.3);
    const knuckles =
      0.0015 *
      Math.exp(-(((y + 0.55) / 0.32) ** 2)) *
      Math.cos((x + 0.08) * Math.PI * 2.6);
    const thumb =
      Math.exp(-(((x * side + 0.38) / 0.4) ** 2)) *
      Math.exp(-(((y + 0.18) / 0.35) ** 2)) *
      Math.exp(-(((z + 0.8) / 0.5) ** 2));
    const crease =
      Math.exp(-(((x * side + 0.1) / 0.11) ** 2)) *
      Math.exp(-(((y + 0.2) / 0.29) ** 2)) *
      Math.exp(-(((z + 0.9) / 0.3) ** 2));
    positions.setXYZ(
      i,
      side * (0.024 + lower * lower * 0.007) + x * width - side * thumb * 0.004,
      -0.32 + y * 0.039 + lower * lower * 0.002 + knuckles,
      -0.02 + z * (0.031 - lower * 0.006) - thumb * 0.007 + crease * 0.0034,
    );
  }
  builder.smoothNormals(geometry);
  const paw = builder.mesh(geometry, builder.surfaces.pawFur, arm);
  paw.name = "sculpted-soft-mitt";
  builder.pile(arm, paw, 70, 0.0011);
  return paw;
}

/** A single, continuous sneaker surface with a genuine curved toe-cap seam. */
export function buildCharacterShoe(
  builder: CharacterBuilder,
  leg: THREE.Group,
  side: number,
) {
  const columns = 64;
  const capRows = 12;
  const rows = 36;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const shoeDepth = (height: number) =>
    0.089 * Math.sqrt(Math.max(0, 1 - height ** 1.8));
  const shoeCenterZ = (height: number) => -0.024 + height ** 1.4 * 0.021;
  // A transverse seam cuts the dome into a genuinely rounded toe cap. An
  // angular paint mask instead makes a pointed white triangle from the front.
  const capHeights = Array.from({ length: columns + 1 }, (_, column) => {
    const sine = Math.sin((column / columns) * TAU);
    const toeBoundary = -0.073;
    if (shoeCenterZ(0) + sine * shoeDepth(0) >= toeBoundary) return 0.016;
    let low = 0;
    let high = 1;
    for (let iteration = 0; iteration < 24; iteration++) {
      const height = (low + high) * 0.5;
      if (shoeCenterZ(height) + sine * shoeDepth(height) < toeBoundary)
        low = height;
      else high = height;
    }
    return 0.016 + ((low + high) * 0.5) * 0.07;
  });
  for (let row = 0; row <= rows; row++) {
    for (let column = 0; column <= columns; column++) {
      const u = column / columns;
      const theta = u * TAU;
      // The pale cap rises over the whole rounded toe, then sweeps down into
      // the sole at either side. It shares vertices with the dark cloth upper.
      const seamHeight = capHeights[column];
      const y =
        row <= capRows
          ? THREE.MathUtils.lerp(0.016, seamHeight, row / capRows)
          : THREE.MathUtils.lerp(
              seamHeight,
              0.086,
              (row - capRows) / (rows - capRows),
            );
      const height = (y - 0.016) / 0.07;
      const width =
        0.0605 * Math.sqrt(Math.max(0, 1 - height ** 1.75)) +
        Math.sin(Math.PI * height) * 0.002;
      const depth = shoeDepth(height);
      positions.push(
        side * 0.004 + Math.cos(theta) * width,
        y - 0.325,
        shoeCenterZ(height) + Math.sin(theta) * depth,
      );
      uvs.push(u, height);
      if (row < rows && column < columns) {
        const a = row * (columns + 1) + column;
        const b = a + columns + 1;
        indices.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
  }
  const geometry = builder.remember(new THREE.BufferGeometry());
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.addGroup(0, capRows * columns * 6, 0);
  geometry.addGroup(capRows * columns * 6, (rows - capRows) * columns * 6, 1);
  builder.smoothNormals(geometry);
  const shoe = builder.mesh(geometry, builder.surfaces.shoeSole, leg);
  shoe.material = [builder.surfaces.shoeSole, builder.surfaces.shoeUpper];
  shoe.name = "sculpted-sneaker-with-rounded-toe-cap";
  return shoe;
}
