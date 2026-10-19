import * as THREE from "three";
import { withDisposalScope, type DisposalScope } from "../disposal";

type Point = readonly [number, number];
type Print = {
  name: string;
  /** Original reference pixels, clockwise from the top-left paper corner. */
  corners: readonly [Point, Point, Point, Point];
};

// These are the ten actual paper outlines in the supplied TOP reference, in
// back-to-front order. Mapping the original reference directly preserves its
// photographs and their existing occlusions; no missing imagery is invented.
const prints: readonly Print[] = [
  { name: "alpine-valley", corners: [[1075, 372], [1261, 394], [1244, 563], [1055, 542]] },
  { name: "group-portrait", corners: [[849, 365], [1068, 360], [1070, 539], [853, 545]] },
  { name: "desert-village", corners: [[670, 382], [846, 350], [886, 508], [692, 545]] },
  { name: "snowy-mountains", corners: [[817, 211], [1067, 204], [1057, 363], [849, 382]] },
  { name: "night-performance", corners: [[1066, 211], [1250, 247], [1222, 413], [1033, 377]] },
  { name: "mont-saint-michel", corners: [[836, 65], [980, 58], [992, 207], [852, 221]] },
  { name: "snowy-village", corners: [[670, 111], [830, 73], [862, 210], [694, 244]] },
  { name: "night-lights", corners: [[991, 43], [1110, 66], [1085, 228], [970, 207]] },
  { name: "night-travellers", corners: [[664, 237], [833, 199], [866, 353], [689, 388]] },
  { name: "canyon-travellers", corners: [[1114, 78], [1251, 105], [1222, 262], [1080, 232]] },
];

/**
 * A small spread of individual, solid photographic prints, resting at Y=0.
 * +Z is the lower edge of the source TOP view. The caller owns `reference`;
 * this object owns only its paper geometries, materials and contact texture.
 */
export function createTablePolaroids(reference: THREE.Texture) {
  return withDisposalScope((scope) => buildTablePolaroids(reference, scope));
}

function buildTablePolaroids(reference: THREE.Texture, scope: DisposalScope) {
  const group = new THREE.Group();
  group.name = "scattered-travel-polaroids";
  scope.defer(() => group.clear());
  const unitsPerPixel = 0.68 / (1261 - 664);
  const centreX = (1261 + 664) / 2;
  const centreY = (563 + 43) / 2;
  const paperThickness = 0.00062;
  const segments = 8;

  // Original image colors are retained, as with the photograph on the desk.
  // Lighting is supplied by the physical edges and soft contact underneath;
  // the bright room key light must not wash out these small printed pictures.
  const face = scope.own(new THREE.MeshBasicMaterial({ map: reference, toneMapped: false }));
  const paper = scope.own(new THREE.MeshStandardMaterial({ color: "#eae3d6", roughness: 0.96, metalness: 0 }));

  // The room's shadow bias is larger than a sheet of paper. A tiny feathered
  // contact below each card retains the layered edges without dark outlines.
  const shadowSize = 64;
  const shadowPixels = new Uint8Array(shadowSize * shadowSize * 4);
  for (let y = 0; y < shadowSize; y++) for (let x = 0; x < shadowSize; x++) {
    const u = x / (shadowSize - 1), v = y / (shadowSize - 1);
    const edge = Math.min(u, 1 - u, v, 1 - v);
    const alpha = THREE.MathUtils.smoothstep(edge, 0, 0.085);
    const index = (y * shadowSize + x) * 4;
    shadowPixels[index] = 62;
    shadowPixels[index + 1] = 47;
    shadowPixels[index + 2] = 34;
    shadowPixels[index + 3] = Math.round(alpha * 255);
  }
  const shadowTexture = scope.own(new THREE.DataTexture(shadowPixels, shadowSize, shadowSize));
  shadowTexture.colorSpace = THREE.SRGBColorSpace;
  shadowTexture.magFilter = THREE.LinearFilter;
  shadowTexture.minFilter = THREE.LinearFilter;
  shadowTexture.needsUpdate = true;
  const shadowMaterial = scope.own(new THREE.MeshBasicMaterial({
    map: shadowTexture, transparent: true, opacity: 0.16,
    depthWrite: false, toneMapped: false,
  }));

  function sourcePoint(corners: Print["corners"], u: number, v: number): Point {
    const topX = THREE.MathUtils.lerp(corners[0][0], corners[1][0], u);
    const topY = THREE.MathUtils.lerp(corners[0][1], corners[1][1], u);
    const bottomX = THREE.MathUtils.lerp(corners[3][0], corners[2][0], u);
    const bottomY = THREE.MathUtils.lerp(corners[3][1], corners[2][1], u);
    return [THREE.MathUtils.lerp(topX, bottomX, v), THREE.MathUtils.lerp(topY, bottomY, v)];
  }

  prints.forEach((print, layer) => {
    const positions: number[] = [], uvs: number[] = [], indices: number[] = [];
    const base = 0.00012 + layer * 0.00075;
    const gridSize = segments + 1;
    const gridVertices = gridSize * gridSize;
    const curl = (u: number, v: number) =>
      0.00003 * (Math.pow(2 * u - 1, 4) + Math.pow(2 * v - 1, 4))
      + 0.00004 * Math.pow(layer % 2 ? u * v : (1 - u) * v, 3);
    const addVertex = (u: number, v: number, top: boolean) => {
      const [x, y] = sourcePoint(print.corners, u, v);
      positions.push((x - centreX) * unitsPerPixel, base + curl(u, v) + (top ? paperThickness : 0), (y - centreY) * unitsPerPixel);
      // Three.js TextureLoader keeps flipY=true for the untouched JPEG.
      uvs.push(x / 1280, 1 - y / 960);
    };
    for (const top of [true, false]) {
      for (let row = 0; row <= segments; row++) for (let col = 0; col <= segments; col++) {
        addVertex(col / segments, row / segments, top);
      }
    }
    // Upper paper face, wound upward; its UVs always match the exact point in
    // the complete source image, even on these mildly skewed quadrilaterals.
    for (let row = 0; row < segments; row++) for (let col = 0; col < segments; col++) {
      const a = row * gridSize + col, b = a + 1, c = a + gridSize, d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
    const topIndexCount = indices.length;
    for (let row = 0; row < segments; row++) for (let col = 0; col < segments; col++) {
      const a = gridVertices + row * gridSize + col, b = a + 1, c = a + gridSize, d = c + 1;
      indices.push(a, b, c, b, d, c);
    }
    // The blank back and four thin cream edges are solid geometry. Duplicate
    // edge vertices keep the printed surface's normal separate from its rim.
    const perimeter: Point[] = [];
    for (let n = 0; n < segments; n++) perimeter.push([n / segments, 0]);
    for (let n = 0; n < segments; n++) perimeter.push([1, n / segments]);
    for (let n = 0; n < segments; n++) perimeter.push([1 - n / segments, 1]);
    for (let n = 0; n < segments; n++) perimeter.push([0, 1 - n / segments]);
    perimeter.forEach(([u, v], index) => {
      const [nextU, nextV] = perimeter[(index + 1) % perimeter.length];
      const start = positions.length / 3;
      addVertex(u, v, true);
      addVertex(nextU, nextV, true);
      addVertex(u, v, false);
      addVertex(nextU, nextV, false);
      indices.push(start, start + 1, start + 2, start + 1, start + 3, start + 2);
    });
    const geometry = scope.own(new THREE.BufferGeometry());
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.addGroup(0, topIndexCount, 0);
    geometry.addGroup(topIndexCount, indices.length - topIndexCount, 1);
    geometry.computeVertexNormals();
    const sheet = new THREE.Mesh(geometry, [face, paper]);
    sheet.name = `polaroid-${print.name}`;
    // Submillimetre sheets are below the room's shadow-map bias. Casting
    // those shadows produces a striped halo; the contact meshes below
    // provide the paper shadows while retaining genuine solid edge geometry.
    sheet.castShadow = false;
    sheet.receiveShadow = true;
    group.add(sheet);

    const shadowGeometry = scope.own(new THREE.BufferGeometry());
    const shadowPositions: number[] = [];
    const cardCentreX = print.corners.reduce((sum, point) => sum + point[0], 0) / 4;
    const cardCentreY = print.corners.reduce((sum, point) => sum + point[1], 0) / 4;
    for (const [x, y] of print.corners) {
      shadowPositions.push(
        (cardCentreX + (x - cardCentreX) * 1.045 - centreX) * unitsPerPixel,
        Math.max(0.000035, base - 0.000085),
        (cardCentreY + (y - cardCentreY) * 1.045 - centreY) * unitsPerPixel,
      );
    }
    shadowGeometry.setAttribute("position", new THREE.Float32BufferAttribute(shadowPositions, 3));
    shadowGeometry.setAttribute("uv", new THREE.Float32BufferAttribute([0, 1, 1, 1, 1, 0, 0, 0], 2));
    shadowGeometry.setIndex([0, 2, 1, 0, 3, 2]);
    shadowGeometry.computeVertexNormals();
    const shadow = new THREE.Mesh(shadowGeometry, shadowMaterial);
    shadow.name = `polaroid-${print.name}-contact`;
    group.add(shadow);
  });

  scope.defer(() => group.removeFromParent());
  return { group, dispose: scope.dispose };
}
