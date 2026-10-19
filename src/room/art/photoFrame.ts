import * as THREE from "three";
import { withDisposalScope, type DisposalScope } from "../disposal";

/** A tabletop oak frame. The supplied photograph remains owned by the caller. */
export function createPhotoFrame(photo: THREE.Texture) {
  return withDisposalScope((scope) => buildPhotoFrame(photo, scope));
}

function buildPhotoFrame(photo: THREE.Texture, scope: DisposalScope) {
  const group = new THREE.Group();
  group.name = "desk-travel-photo-frame";
  const frame = new THREE.Group();
  frame.name = "photo-frame-leaning-assembly";
  group.add(frame);
  scope.defer(() => group.clear());
  const ownGeometry = scope.own;
  const ownMaterial = scope.own;

  // Long oak fibres with wandering latewood lines and subtle pores. Each of
  // the four rails has its own lengthwise UV direction, including the mitres.
  const woodWidth = 256, woodHeight = 1024;
  const woodPixels = new Uint8Array(woodWidth * woodHeight * 4);
  let noiseSeed = 14391;
  for (let y = 0; y < woodHeight; y++) {
    for (let x = 0; x < woodWidth; x++) {
      const u = x / woodWidth, v = y / woodHeight;
      const wander = 0.021 * Math.sin(v * 12.8 + u * 2.3)
        + 0.012 * Math.sin(v * 24.5 + u * 5.8)
        + 0.008 * Math.sin(v * 5.2 + u * 21);
      const grain = u + wander;
      const broad = Math.sin(grain * 44 + Math.sin(v * 9) * 0.5);
      const ring = Math.pow(Math.max(0, Math.sin(grain * 173 + Math.sin(v * 16 + u * 3))), 9);
      const fine = Math.sin(grain * 396 + Math.sin(v * 36) * 1.2);
      noiseSeed = (Math.imul(noiseSeed, 1664525) + 1013904223) >>> 0;
      const noise = noiseSeed / 0x100000000 - 0.5;
      const shade = broad * 10 - ring * 19 + fine * 2.1 + noise * 5;
      const offset = (y * woodWidth + x) * 4;
      woodPixels[offset] = 144 + shade;
      woodPixels[offset + 1] = 101 + shade * 0.76;
      woodPixels[offset + 2] = 66 + shade * 0.5;
      woodPixels[offset + 3] = 255;
    }
  }
  const woodTexture = scope.own(new THREE.DataTexture(woodPixels, woodWidth, woodHeight));
  woodTexture.colorSpace = THREE.SRGBColorSpace;
  woodTexture.wrapS = woodTexture.wrapT = THREE.RepeatWrapping;
  woodTexture.magFilter = THREE.LinearFilter;
  woodTexture.minFilter = THREE.LinearMipmapLinearFilter;
  woodTexture.generateMipmaps = true;
  woodTexture.anisotropy = 4;
  woodTexture.needsUpdate = true;
  const wood = ownMaterial(new THREE.MeshStandardMaterial({
    map: woodTexture, color: "#ffffff", roughness: 0.57, metalness: 0,
    vertexColors: true,
  }));
  const backWood = ownMaterial(new THREE.MeshStandardMaterial({
    map: woodTexture, color: "#e8dccf", roughness: 0.74, metalness: 0,
  }));
  const standWood = ownMaterial(new THREE.MeshStandardMaterial({
    map: woodTexture, color: "#e5d0b9", roughness: 0.59, metalness: 0,
  }));
  const mat = ownMaterial(new THREE.MeshStandardMaterial({
    color: "#e9e2d4", roughness: 0.94, metalness: 0,
  }));
  const matEdge = ownMaterial(new THREE.MeshStandardMaterial({
    color: "#f8f0e0", roughness: 0.88, metalness: 0,
  }));
  const darkMetal = ownMaterial(new THREE.MeshStandardMaterial({
    color: "#403b36", roughness: 0.56, metalness: 0.6,
  }));
  const screwMetal = ownMaterial(new THREE.MeshStandardMaterial({
    color: "#655d50", roughness: 0.39, metalness: 0.72,
  }));
  const screwSlot = ownMaterial(new THREE.MeshStandardMaterial({
    color: "#24211e", roughness: 0.8, metalness: 0.1,
  }));
  const photoMaterial = ownMaterial(new THREE.MeshBasicMaterial({
    map: photo, color: "#ffffff", toneMapped: false,
  }));

  function mesh(name: string, geometry: THREE.BufferGeometry, material: THREE.Material | THREE.Material[], parent: THREE.Object3D = frame) {
    const item = new THREE.Mesh(geometry, material);
    item.name = name;
    item.castShadow = true;
    item.receiveShadow = true;
    parent.add(item);
    return item;
  }
  function box(name: string, size: [number, number, number], position: [number, number, number], material: THREE.Material, parent: THREE.Object3D = frame) {
    const item = mesh(name, ownGeometry(new THREE.BoxGeometry(...size)), material, parent);
    item.position.set(...position);
    return item;
  }
  function roundedOutline(width: number, height: number, radius: number) {
    const x = width / 2, y = height / 2, r = Math.min(radius, x, y);
    const path = new THREE.Shape();
    path.moveTo(-x + r, -y);
    path.lineTo(x - r, -y);
    path.quadraticCurveTo(x, -y, x, -y + r);
    path.lineTo(x, y - r);
    path.quadraticCurveTo(x, y, x - r, y);
    path.lineTo(-x + r, y);
    path.quadraticCurveTo(-x, y, -x, y - r);
    path.lineTo(-x, -y + r);
    path.quadraticCurveTo(-x, -y, -x + r, -y);
    return path;
  }
  function roundedPlate(name: string, width: number, height: number, depth: number, radius: number, position: [number, number, number], material: THREE.Material, parent: THREE.Object3D = frame) {
    const geometry = ownGeometry(new THREE.ExtrudeGeometry(roundedOutline(width, height, radius), {
      depth, bevelEnabled: false, curveSegments: 5,
    }));
    const item = mesh(name, geometry, material, parent);
    item.position.set(...position);
    return item;
  }

  // A shaped rail section: softened outer edge, broad convex face, recessed
  // dark inner cove, and a small raised lip holding the glazing. The changing
  // rectangle size cuts all four pieces at a real 45-degree mitre.
  const railProfile = [
    [0.376, 0.496, -0.034, 0.76],
    [0.380, 0.500, -0.028, 0.88],
    [0.380, 0.500, 0.015, 0.96],
    [0.378, 0.498, 0.024, 1],
    [0.371, 0.491, 0.030, 1],
    [0.360, 0.480, 0.032, 1],
    [0.343, 0.463, 0.025, 0.98],
    [0.326, 0.446, 0.012, 0.88],
    [0.312, 0.432, 0.004, 0.72],
    [0.306, 0.426, 0.005, 0.84],
    [0.303, 0.423, 0.002, 0.90],
    [0.303, 0.423, -0.026, 0.69],
    [0.310, 0.430, -0.034, 0.73],
    [0.376, 0.496, -0.034, 0.76],
  ];
  const railNames = ["bottom", "right", "top", "left"];
  railNames.forEach((name, side) => {
    const positions: number[] = [], uvs: number[] = [], colors: number[] = [], indices: number[] = [];
    const columns = 10;
    railProfile.forEach(([halfWidth, halfHeight, depth, shade], row) => {
      // Each rail owns half of each rounded corner. They still meet along
      // the 45-degree mitre, while the exterior silhouette loses its sharp tip.
      const radius = 0.0003 + 0.013 * THREE.MathUtils.smoothstep(halfWidth, 0.343, 0.38);
      const along = side % 2 ? halfHeight : halfWidth;
      const across = side % 2 ? halfWidth : halfHeight;
      const cosine = [1, 0, -1, 0][side], sine = [0, 1, 0, -1][side];
      for (let end = 0; end < 2; end++) {
        for (let step = 0; step <= 4; step++) {
          const angle = Math.PI * (end === 0 ? 1.25 : 1.5) + step * Math.PI / 16;
          const u = (end === 0 ? -1 : 1) * (along - radius) + Math.cos(angle) * radius;
          const v = -across + radius + Math.sin(angle) * radius;
          const x = u * cosine - v * sine, y = u * sine + v * cosine;
          positions.push(x * 0.9996, y * 0.9996 + 0.5, depth);
          uvs.push((0.38 - halfWidth) / 0.077 + side * 0.29, ((u + along) / (2 * along)) * (side % 2 ? 1.3 : 1));
          colors.push(shade, shade, shade);
        }
      }
      if (row < railProfile.length - 1) {
        for (let column = 0; column < columns - 1; column++) {
          const a = row * columns + column;
          indices.push(a, a + 1, a + columns, a + 1, a + columns + 1, a + columns);
        }
      }
    });
    const geometry = ownGeometry(new THREE.BufferGeometry());
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    mesh(`photo-frame-mitred-${name}-rail`, geometry, wood);
  });

  const rearPanel = roundedPlate("photo-frame-recessed-wood-back", 0.613, 0.853, 0.017, 0.008, [0, 0.5, -0.041], backWood);
  const rearUv = rearPanel.geometry.getAttribute("uv");
  for (let i = 0; i < rearUv.count; i++) {
    rearUv.setXY(i, rearUv.getX(i) / 0.613 + 0.5, rearUv.getY(i) / 0.853 + 0.5);
  }
  // The photograph is shown in full; the lower mat margin is deliberately
  // broader, as in the supplied reference. Its pixels are never cropped.
  const photoWidth = 0.518, photoHeight = photoWidth * 1280 / 1102;
  const photoCenterY = 0.533;
  const matShape = new THREE.Shape();
  matShape.moveTo(-0.305, 0.076);
  matShape.lineTo(0.305, 0.076);
  matShape.lineTo(0.305, 0.924);
  matShape.lineTo(-0.305, 0.924);
  matShape.closePath();
  const opening = new THREE.Path();
  opening.moveTo(-photoWidth / 2, photoCenterY - photoHeight / 2);
  opening.lineTo(-photoWidth / 2, photoCenterY + photoHeight / 2);
  opening.lineTo(photoWidth / 2, photoCenterY + photoHeight / 2);
  opening.lineTo(photoWidth / 2, photoCenterY - photoHeight / 2);
  opening.closePath();
  matShape.holes.push(opening);
  const matGeometry = ownGeometry(new THREE.ExtrudeGeometry(matShape, {
    depth: 0.004, bevelEnabled: true, bevelSize: 0.002, bevelThickness: 0.0015,
    bevelSegments: 1, curveSegments: 1,
  }));
  const matMesh = mesh("photo-frame-cream-bevel-cut-mat", matGeometry, [mat, matEdge]);
  matMesh.position.z = -0.011;
  const printedWidth = photoWidth + 0.0006;
  const photograph = mesh("photo-frame-full-uncropped-photograph", ownGeometry(new THREE.PlaneGeometry(printedWidth, printedWidth * 1280 / 1102)), photoMaterial);
  photograph.position.set(0, photoCenterY, -0.0095);
  photograph.castShadow = false;
  photograph.receiveShadow = false;
  const glazingMaterial = ownMaterial(new THREE.MeshPhysicalMaterial({
    color: "#ffffff", transparent: true, opacity: 0.018, roughness: 0.11,
    metalness: 0, clearcoat: 0.22, clearcoatRoughness: 0.13, depthWrite: false,
  }));
  const glazing = mesh("photo-frame-subtle-glazing", ownGeometry(new THREE.PlaneGeometry(0.604, 0.844)), glazingMaterial);
  glazing.position.set(0, 0.5, -0.003);
  glazing.castShadow = false;
  glazing.receiveShadow = false;

  const screwGeometry = ownGeometry(new THREE.CylinderGeometry(0.0032, 0.0032, 0.0024, 12));
  function screw(name: string, x: number, y: number, z: number, parent: THREE.Object3D = frame) {
    const head = mesh(name, screwGeometry, screwMetal, parent);
    head.rotation.x = Math.PI / 2;
    head.position.set(x, y, z);
    box(`${name}-slot`, [0.0041, 0.0007, 0.0004], [x, y, z - 0.0014], screwSlot, parent).rotation.z = 0.3;
  }
  for (const x of [-0.286, 0.286]) {
    for (const y of [0.245, 0.76]) {
      const clip = roundedPlate("photo-frame-rear-turning-clip", 0.054, 0.018, 0.004, 0.008, [x, y, -0.047], darkMetal);
      clip.rotation.z = Math.sign(x) * 0.15;
      screw("photo-frame-clip-screw", x + Math.sign(x) * 0.012, y + 0.002, -0.048);
    }
  }
  roundedPlate("photo-frame-hanger-anchor", 0.023, 0.041, 0.003, 0.007, [0, 0.886, -0.047], darkMetal);
  screw("photo-frame-hanger-screw", 0, 0.881, -0.049);
  const hangerPath = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.013, 0.904, -0.049), new THREE.Vector3(0, 0.936, -0.049),
    new THREE.Vector3(0.013, 0.904, -0.049), new THREE.Vector3(-0.013, 0.904, -0.049),
  ], false, "catmullrom", 0.15);
  mesh("photo-frame-small-triangular-hanger", ownGeometry(new THREE.TubeGeometry(hangerPath, 20, 0.0021, 6, false)), darkMetal);

  // A separate, tapered hinged easel carries the frame's weight. Its lower
  // bevel is cut parallel to the desk so both the rail and stand sit on it.
  frame.rotation.x = THREE.MathUtils.degToRad(-9);
  frame.position.y = 0.0045;
  const hinge = new THREE.Vector3(0, 0.578, -0.056).applyMatrix4(frame.matrix.clone().compose(frame.position, frame.quaternion, frame.scale));
  const standFoot = new THREE.Vector3(0, 0.006, -0.347);
  const standVector = standFoot.clone().sub(hinge);
  const standLength = standVector.length();
  const stand = new THREE.Group();
  stand.name = "photo-frame-open-rear-kickstand";
  stand.position.copy(hinge);
  stand.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), standVector.normalize());
  group.add(stand);
  const standShape = new THREE.Shape();
  standShape.moveTo(-0.043, 0);
  standShape.lineTo(0.043, 0);
  standShape.lineTo(0.091, -standLength + 0.006);
  standShape.quadraticCurveTo(0.094, -standLength, 0.085, -standLength);
  standShape.lineTo(-0.085, -standLength);
  standShape.quadraticCurveTo(-0.094, -standLength, -0.091, -standLength + 0.006);
  standShape.closePath();
  const standGeometry = ownGeometry(new THREE.ExtrudeGeometry(standShape, {
    depth: 0.019, bevelEnabled: true, bevelSize: 0.003, bevelThickness: 0.002,
    bevelSegments: 2, curveSegments: 5,
  }));
  // ExtrudeGeometry's world-space UVs would compress the fibres into a small
  // patch. Give the easel a complete vertical-grain board instead.
  const standUv = standGeometry.getAttribute("uv");
  for (let i = 0; i < standUv.count; i++) standUv.setXY(i, standUv.getX(i) * 5 + 0.4, standUv.getY(i) / standLength + 1);
  const plank = mesh("photo-frame-tapered-wooden-easel", standGeometry, standWood, stand);
  plank.position.z = -0.011;
  roundedPlate("photo-frame-easel-hinge-upper-leaf", 0.079, 0.025, 0.004, 0.003, [0, 0.597, -0.05], darkMetal);
  const hingeBarrel = mesh("photo-frame-easel-hinge-barrel", ownGeometry(new THREE.CylinderGeometry(0.006, 0.006, 0.08, 12)), darkMetal);
  hingeBarrel.rotation.z = Math.PI / 2;
  hingeBarrel.position.set(0, 0.578, -0.054);
  roundedPlate("photo-frame-easel-hinge-lower-leaf", 0.076, 0.027, 0.004, 0.003, [0, -0.022, -0.014], darkMetal, stand);
  for (const x of [-0.025, 0.025]) {
    screw("photo-frame-hinge-top-screw", x, 0.598, -0.052);
    screw("photo-frame-hinge-easel-screw", x, -0.022, -0.016, stand);
  }

  // Normalize only the tiny bevel/contact offset; do not leave the object
  // floating when the caller places its local origin on a table surface.
  group.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(group);
  for (const child of group.children) child.position.y -= bounds.min.y;
  group.updateMatrixWorld(true);
  group.userData.photoFrame = { imageAspect: 1102 / 1280, front: "+Z", leanDegrees: 9 };
  scope.defer(() => group.removeFromParent());
  return { group, dispose: scope.dispose };
}
