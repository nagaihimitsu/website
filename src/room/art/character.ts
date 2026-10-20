import * as THREE from "three";
import { withDisposalScope, type DisposalScope } from "../disposal";
import type { RoomAvatarAnimation } from "../types";
import { createCharacterMaterials } from "./characterMaterials";
import { buildCharacterHead } from "./characterHead";
import { buildCharacterBody } from "./characterBody";
import type { CharacterBuilder } from "./characterBuilder";
import {
  BASS_HELD_POSITION, BASS_HELD_ROTATION, BASS_HELD_SCALE, BASS_STRAP_UPPER, BASS_STRAP_TAIL,
  BASS_PICK_Y, BASS_SLAP_Y,
  bassFretY, bassStringX, bassStringZ, bassPosePoint,
} from "./bassPose";

/**
 * Original, fully volumetric little traveller, modelled from the supplied
 * front / side / rear character reference. Local -Z is forward; feet rest at Y=0.
 * Every material and geometry belongs to this model and is released by dispose.
 */
export function createCharacter() {
  return withDisposalScope(buildCharacter);
}

function buildCharacter(scope: DisposalScope) {
  const group = new THREE.Group();
  group.name = "little-traveller";
  group.scale.setScalar(0.98);
  group.userData.roomRaycastIgnore = true;
  const body = new THREE.Group();
  body.name = "traveller-torso";
  group.add(body);
  scope.defer(() => group.clear());
  const surfaces = scope.own(createCharacterMaterials());
  const { fur, fibers } = surfaces;
  // Tiny fibres collect diffuse light from surrounding fur; a small warm fill
  // avoids isolated dark subpixel tips against the softly scattering coat.
  fibers.emissive.copy(fur.color);
  fibers.emissiveIntensity = 0.08;
  const remember = scope.own;
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
  scope.defer(() => furPatches.clear());
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
  const builder: CharacterBuilder = {
    surfaces,
    remember,
    smoothNormals,
    mesh,
    ellipsoid,
    thread,
    pile,
  };
  const head = buildCharacterHead(builder, body);

  const { arms, legs, pack, tailRoot } = buildCharacterBody(builder, body);

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
    const strands = scope.own(new THREE.InstancedMesh(strandGeometry, fibers, capacity));
    strands.name = "short-velvet-pile";
    strands.castShadow = false;
    strands.receiveShadow = false;
    const rootInverse = root.matrixWorld.clone().invert();
    let instance = 0;
    for (const patch of patches) {
      const patchMaterial = patch.mesh.material;
      const patchColour =
        !Array.isArray(patchMaterial) && "color" in patchMaterial
          ? (patchMaterial.color as THREE.Color)
          : fur.color;
      // Paws have darker plush. Share the strand material and draw call while
      // tinting their pile to the local coat rather than leaving golden fibres.
      const patchTint = new THREE.Color(
        patchColour.r / fur.color.r,
        patchColour.g / fur.color.g,
        patchColour.b / fur.color.b,
      );
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
        tint.copy(patchTint).multiplyScalar(0.98 + random() * 0.035);
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
  }

  // The forearms bend around the instrument instead of pointing a whole sleeve
  // through its face. Rest vertices are retained exactly for walking/punching.
  const armSkins = arms.map((arm, index) => {
    const meshes = arm.children.filter((child): child is THREE.Mesh =>
      child instanceof THREE.Mesh && !(child instanceof THREE.InstancedMesh));
    const sections = new Map<number, {
      t: number; clamped: number; centre: THREE.Vector3; rotation: THREE.Quaternion;
    }>();
    for (const item of meshes) {
      if (item.name === "sculpted-soft-mitt") continue;
      const vertices = item.geometry.getAttribute("position");
      for (let vertex = 0; vertex < vertices.count; vertex++) {
        const y = vertices.getY(vertex);
        if (sections.has(y)) continue;
        const t = -y / 0.3, clamped = THREE.MathUtils.clamp(t, 0, 1);
        sections.set(y, { t, clamped, centre: new THREE.Vector3(), rotation: new THREE.Quaternion() });
      }
    }
    return {
      arm,
      sections,
      side: index === 0 ? -1 : 1,
      restPosition: arm.position.clone(),
      pile: arm.children.filter((child) => child instanceof THREE.InstancedMesh),
      surfaces: meshes.map((item) => {
        item.frustumCulled = false;
        const vertices = item.geometry.getAttribute("position");
        const seams = new Map<string, number[]>();
        for (let vertex = 0; vertex < vertices.count; vertex++) {
          const key = [vertices.getX(vertex), vertices.getY(vertex), vertices.getZ(vertex)]
            .map((value) => Math.round(value * 1e6)).join(",");
          const indices = seams.get(key) ?? [];
          indices.push(vertex);
          seams.set(key, indices);
        }
        return { item, positions: new Float32Array(item.geometry.getAttribute("position").array),
          normals: new Float32Array(item.geometry.getAttribute("normal").array),
          seams: [...seams.values()].filter((indices) => indices.length > 1),
          paw: item.name === "sculpted-soft-mitt" };
      }),
    };
  });
  scope.defer(() => { armSkins.length = 0; });
  const playingFingers = new THREE.Group();
  playingFingers.name = "bass-articulated-fingers";
  playingFingers.position.copy(BASS_HELD_POSITION);
  playingFingers.quaternion.copy(BASS_HELD_ROTATION);
  playingFingers.scale.setScalar(BASS_HELD_SCALE);
  playingFingers.visible = false;
  body.add(playingFingers);
  function liveFinger(name: string, radius: number) {
    const rings = 24, sides = 16;
    const geometry = remember(new THREE.BufferGeometry());
    const positions = new Float32Array((rings + 1) * (sides + 1) * 3);
    const normals = new Float32Array(positions.length);
    const uvs: number[] = [];
    const indices: number[] = [];
    for (let ring = 0; ring < rings; ring++) for (let side = 0; side < sides; side++) {
      const a = ring * (sides + 1) + side, b = a + sides + 1;
      indices.push(a, a + 1, b, a + 1, b + 1, b);
    }
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
    for (let ring = 0; ring <= rings; ring++) for (let side = 0; side <= sides; side++)
      uvs.push(side / sides, ring / rings);
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    const finger = mesh(geometry, surfaces.pawFur, playingFingers);
    finger.name = name;
    finger.frustumCulled = false;
    const end = new THREE.Object3D();
    end.name = `${name}-tip`;
    playingFingers.add(end);
    const points = Array.from({ length: 4 }, () => new THREE.Vector3());
    const curve = new THREE.CatmullRomCurve3(points);
    const centre = new THREE.Vector3(), tangent = new THREE.Vector3();
    const across = new THREE.Vector3(), around = new THREE.Vector3();
    const direction = new THREE.Vector3(), reference = new THREE.Vector3(0, 1, 0);
    return (shape: number[][]) => {
      points.forEach((point, i) => point.set(...shape[i] as [number, number, number]));
      end.position.copy(points[3]);
      for (let ring = 0; ring <= rings; ring++) {
        const t = ring / rings;
        curve.getPoint(t, centre);
        curve.getTangent(t, tangent).normalize();
        // Project the along-neck axis onto the pad instead of tangent × Z:
        // a curled finger can reverse its X tangent, which flipped the old
        // frame 180 degrees and twisted adjacent rings into a pinched seam.
        across.copy(reference).addScaledVector(tangent, -reference.dot(tangent));
        if (across.lengthSq() < 0.0001)
          across.set(1, 0, 0).addScaledVector(tangent, -tangent.x);
        across.normalize();
        around.crossVectors(tangent, across).normalize();
        // A plump paw digit has a broad pad and hemispherical ends, rather
        // than a thin articulated tube tapering into a pointed human finger.
        const cap = t < 0.22 ? (t - 0.22) / 0.22 : t > 0.72 ? (t - 0.72) / 0.28 : 0;
        const radial = Math.sqrt(Math.max(0, 1 - cap * cap));
        const r = radius * radial * (1 - 0.08 * t);
        for (let side = 0; side <= sides; side++) {
          const angle = side / sides * Math.PI * 2;
          // Broad, softly flattened pads blend into the palm. A circular tube
          // made the little digits read as separate beads from the side.
          direction.copy(across).multiplyScalar(Math.cos(angle)).addScaledVector(around, Math.sin(angle) * 0.86);
          const i = (ring * (sides + 1) + side) * 3;
          positions[i] = centre.x + direction.x * r;
          positions[i + 1] = centre.y + direction.y * r;
          positions[i + 2] = centre.z + direction.z * r;
          direction.copy(across).multiplyScalar(Math.cos(angle))
            .addScaledVector(around, Math.sin(angle) / 0.86)
            .multiplyScalar(radial).addScaledVector(tangent, cap).normalize();
          normals[i] = direction.x; normals[i + 1] = direction.y; normals[i + 2] = direction.z;
        }
      }
      geometry.getAttribute("position").needsUpdate = true;
      geometry.getAttribute("normal").needsUpdate = true;
      geometry.boundingBox = null;
    };
  }
  const pluckingIndex = liveFinger("bass-plucking-index", 0.0145);
  const pluckingMiddle = liveFinger("bass-plucking-middle", 0.014);
  const pluckingRing = liveFinger("bass-plucking-ring", 0.013);
  const pluckingThumb = liveFinger("bass-plucking-thumb", 0.016);
  const frettingIndex = liveFinger("bass-fretting-index", 0.0135);
  const frettingMiddle = liveFinger("bass-fretting-middle", 0.014);
  const frettingRing = liveFinger("bass-fretting-ring", 0.0125);
  const frettingThumb = liveFinger("bass-fretting-thumb", 0.016);

  // A flat leather strap follows the outside of the shoulder. The front tab
  // surrounds the real upper-horn button; it is not a leaf-shaped tube that
  // vanishes into the hood. The tail goes behind the backpack to the endpin.
  const strapSurface = remember(new THREE.MeshStandardMaterial({ color: "#4a4447", roughness: 0.72,
    side: THREE.DoubleSide, transparent: true, opacity: 0 }));
  const strapMetal = remember(new THREE.MeshStandardMaterial({ color: "#b8babc", roughness: 0.29,
    metalness: 0.48, transparent: true, opacity: 0 }));
  const bassStrap = new THREE.Group();
  bassStrap.name = "bass-shoulder-support-strap";
  bassStrap.visible = false;
  body.add(bassStrap);
  const upperStrapButton = bassPosePoint(...BASS_STRAP_UPPER.toArray());
  const shoulderFront = new THREE.Vector3(-0.115, 0.749, -0.205);
  const tabDirection = shoulderFront.clone().sub(upperStrapButton).normalize();
  const strapPoints = [
    upperStrapButton.clone().addScaledVector(tabDirection, -0.016),
    shoulderFront,
    // These shoulder supports follow the outer hood surface plus 9mm of
    // clearance, including its downward-facing rear fold.
    new THREE.Vector3(-0.194, 0.749, -0.124),
    new THREE.Vector3(-0.254, 0.747, -0.054),
    new THREE.Vector3(-0.255, 0.742, 0.078),
    new THREE.Vector3(-0.228, 0.708, 0.175),
    new THREE.Vector3(-0.153, 0.683, 0.233),
    new THREE.Vector3(-0.075, 0.572, 0.147),
    new THREE.Vector3(0.104, 0.475, 0.145),
    new THREE.Vector3(0.192, 0.422, 0.078),
    new THREE.Vector3(0.233, 0.362, -0.092),
    bassPosePoint(...BASS_STRAP_TAIL.toArray()),
  ];
  const strapCurve = new THREE.CatmullRomCurve3(strapPoints);
  const strapGuides = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, -1), new THREE.Vector3(-0.2, 0.05, -1),
    new THREE.Vector3(-0.50, 0.315, -0.806), new THREE.Vector3(-0.903, -0.196, -0.382),
    new THREE.Vector3(-0.866, -0.476, 0.154), new THREE.Vector3(-0.810, -0.397, 0.432),
    new THREE.Vector3(-0.382, -0.22, 0.9),
    new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, 1),
    new THREE.Vector3(1, 0, 0.5), new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(0.5, 0, -1),
  ]);
  const strapPositions: number[] = [], strapNormals: number[] = [], strapIndices: number[] = [];
  const strapAcross = new THREE.Vector3(), strapOut = new THREE.Vector3();
  // A softly bevelled rectangle retains two broad leather faces. An ellipse
  // changed apparent width continuously and made the old band look inflated.
  const strapSection = [[-1,-0.35],[-0.96,-1],[0.96,-1],[1,-0.35],
    [1,0.35],[0.96,1],[-0.96,1],[-1,0.35],[-1,-0.35]];
  const strapSides = strapSection.length - 1;
  const strapLength = strapCurve.getLength();
  for (let row = 0; row <= 160; row++) {
    const t = row / 160, curveT = strapCurve.getUtoTmapping(t, 0);
    const point = strapCurve.getPoint(curveT), tangent = strapCurve.getTangent(curveT);
    strapGuides.getPoint(curveT, strapOut).normalize();
    strapAcross.crossVectors(tangent, strapOut).normalize();
    strapOut.crossVectors(strapAcross, tangent).normalize();
    const distance = t * strapLength;
    const roundedTab = Math.sqrt(Math.max(0, 1 - Math.max(0, 1 - distance / 0.020) ** 2));
    const tailTaper = 1 - THREE.MathUtils.smoothstep(t, 0.97, 1);
    const halfWidth = THREE.MathUtils.lerp(0.021, 0.022,
      THREE.MathUtils.smoothstep(distance, 0.03, 0.08)) * roundedTab * tailTaper;
    for (let side = 0; side <= strapSides; side++) {
      const [across, depth] = strapSection[side];
      const w = across * halfWidth, thickness = depth * 0.0022;
      strapPositions.push(point.x + strapAcross.x * w + strapOut.x * thickness,
        point.y + strapAcross.y * w + strapOut.y * thickness,
        point.z + strapAcross.z * w + strapOut.z * thickness);
      // Give the two broad faces their own smooth surface normal. Averaging
      // long, thin triangles around the bevel made a zigzag of black facets.
      const broadFace = Math.abs(depth) === 1;
      const normal = strapOut.clone().multiplyScalar(broadFace ? Math.sign(depth) : Math.sign(depth) * 0.35)
        .addScaledVector(strapAcross, broadFace ? 0 : Math.sign(across) * 0.94).normalize();
      strapNormals.push(normal.x, normal.y, normal.z);
      if (row < 160 && side < strapSides) {
        const a = row * (strapSides + 1) + side, b = a + strapSides + 1;
        strapIndices.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
  }
  const strapGeometry = remember(new THREE.BufferGeometry());
  strapGeometry.setAttribute("position", new THREE.Float32BufferAttribute(strapPositions, 3));
  strapGeometry.setAttribute("normal", new THREE.Float32BufferAttribute(strapNormals, 3));
  strapGeometry.setIndex(strapIndices);
  const strapBand = mesh(strapGeometry, strapSurface, bassStrap);
  strapBand.name = "bass-flat-leather-shoulder-band";
  // This thin, folded sheet casts onto the hoodie, but cannot resolve its own
  // back face in the room shadow map without false triangular self-shadows.
  strapBand.receiveShadow = false;
  const strapLock = ellipsoid(0.010, 0.010, 0.0033, strapMetal, bassStrap,
    upperStrapButton.x, upperStrapButton.y, upperStrapButton.z - 0.0058);
  strapLock.name = "bass-round-strap-lock";

  group.traverse((object) => {
    object.userData.roomRaycastIgnore = true;
    // Picking and the camera test room objects only. Filtering avatar hits after
    // raycasting would still inspect thousands of fur instances each frame.
    if (object instanceof THREE.Mesh) object.raycast = () => undefined;
  });
  let disposed = false;
  scope.defer(() => group.removeFromParent());
  scope.defer(() => { disposed = true; });
  let previousTime: number | null = null;
  let stridePhase = 0;
  let easedSpeed = 0;
  let airBlend = 0;
  let airRise = 0;
  let previousBassLift = 0;
  let fingerboardY = bassFretY(3);
  let frettingX = bassStringX(0);
  const handTarget = new THREE.Vector3(), wrist = new THREE.Vector3();
  const skinPoint = new THREE.Vector3(), skinNormal = new THREE.Vector3();
  const direction = new THREE.Vector3();
  const frameRotation = new THREE.Quaternion(), palmRotation = new THREE.Quaternion();
  const identity = new THREE.Quaternion(), down = new THREE.Vector3(0, -1, 0);
  const sleeveCurve = new THREE.CubicBezierCurve3(new THREE.Vector3(), new THREE.Vector3(),
    new THREE.Vector3(), new THREE.Vector3());
  const forearmCurve = new THREE.CubicBezierCurve3(new THREE.Vector3(), new THREE.Vector3(),
    new THREE.Vector3(), new THREE.Vector3());
  const elbow = new THREE.Vector3(), elbowTangent = new THREE.Vector3();
  const ease = (current: number, target: number, rate: number, dt: number) =>
    THREE.MathUtils.lerp(current, target, 1 - Math.exp(-rate * dt));
  return {
    group,
    // The instrument follows breathing, the pickup lean and musical sway with
    // the hands, rather than floating independently on the character root.
    bassAnchor: body,
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
      body.position.x = 0;
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
      armSkins.forEach(({ arm, restPosition }) => arm.position.copy(restPosition));
      legs.forEach((leg, index) => {
        leg.position.set((index === 0 ? -1 : 1) * 0.073, 0.325, 0.006);
        leg.rotation.z = 0;
      });
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
      if (state.bass && state.bass.lift > 0) {
        const lift = THREE.MathUtils.clamp(state.bass.lift, 0, 1);
        const pluck = THREE.MathUtils.clamp(state.bass.pluck, 0, 1);
        const slap = THREE.MathUtils.clamp(state.bass.slap ?? 0, 0, 1);
        const fingerPluck = pluck * (1 - slap);
        const beat = state.bass.beat * Math.PI * 2;
        const groove = state.bass.playing && !state.reducedMotion;
        // A brief forward reach and settling bend makes picking up the bass an
        // action, while the sustained pose keeps the face readable above it.
        const reach = Math.sin(Math.PI * lift);
        body.rotation.x -= reach * 0.085;
        body.position.y -= reach * 0.012;
        body.rotation.z += groove ? Math.sin(beat * 0.5) * 0.028 * lift : 0;
        body.position.x = groove ? Math.sin(beat * 0.5) * 0.008 * lift : 0;
        body.position.y -= groove ? (1 - Math.cos(beat)) * 0.0045 * lift : 0;
        head.rotation.y = THREE.MathUtils.lerp(head.rotation.y, -0.065, lift);
        head.rotation.x = groove ? Math.sin(beat) * 0.027 * lift : 0;
        head.rotation.z += groove ? Math.cos(beat * 0.5) * 0.019 * lift : 0;
        tailRoot.rotation.y += groove ? Math.sin(beat * 0.5 - 0.6) * 0.075 * lift : 0;
        legs.forEach((leg, index) => {
          // Keep the shoes on the ground as the knees and weight settle into
          // the pulse; the performer does not float up and down as one block.
          leg.position.y -= body.position.y * lift;
          leg.position.x -= body.position.x * lift;
          leg.rotation.z -= body.rotation.z * 0.5 * lift;
          leg.rotation.x += groove ? Math.sin(beat + index * Math.PI) * 0.022 * lift : 0;
        });
        fingerboardY = ease(fingerboardY, bassFretY(state.bass.fret), 35, dt);
        frettingX = ease(frettingX, bassStringX(state.bass.string, fingerboardY), 45, dt);
        if (previousBassLift === 0) {
          fingerboardY = bassFretY(state.bass.fret);
          frettingX = bassStringX(state.bass.string, fingerboardY);
        }
        // Slapping at the fingerboard end moves the wrist as a whole. Keeping
        // the palm at the lower pickup would stretch a short paw thumb across
        // the instrument instead of making a believable change of technique.
        const pickingY = THREE.MathUtils.lerp(BASS_PICK_Y, BASS_SLAP_Y - 0.030, slap);
        const pickX = bassStringX(state.bass.pluckString ?? state.bass.string, pickingY);
        const thumbX = bassStringX(state.bass.pluckString ?? state.bass.string, BASS_SLAP_Y);
        const touchZ = bassStringZ(fingerboardY) + (state.bass.fretting ? 0 : 0.014);
        playingFingers.visible = lift > 0.65;
        playingFingers.scale.setScalar(BASS_HELD_SCALE * THREE.MathUtils.smoothstep(lift, 0.65, 1));
        // A slap straightens the thumb onto the chosen string while the other
        // fingers lift clear. The small wrist rotation is input feedback even
        // with reduced motion, without moving the elbow through the instrument.
        // The fingers grow out of a broad rounded mitt. Their short pads overlap
        // at the knuckles and curl only at the strings; no long human phalanges.
        const pickPalmX = THREE.MathUtils.lerp(-0.050 + pickX * 0.75, thumbX - 0.045, slap);
        pluckingIndex([[pickPalmX + 0.014, pickingY + 0.009, 0.073 + slap * 0.004],
          [pickX - 0.025, pickingY + 0.009, 0.076 + slap * 0.008],
          [pickX - 0.009, pickingY + 0.005, 0.059 + slap * 0.014],
          [pickX - fingerPluck * 0.007, pickingY, bassStringZ(pickingY) + 0.002 + fingerPluck * 0.003 + slap * 0.015]]);
        pluckingMiddle([[pickPalmX + 0.015, pickingY - 0.014, 0.072 + slap * 0.004],
          [pickX - 0.026, pickingY - 0.015, 0.073 + slap * 0.008],
          [pickX - 0.020, pickingY - 0.019, 0.056 + slap * 0.013],
          [pickX - 0.018, pickingY - 0.023, 0.045 + slap * 0.016]]);
        pluckingRing([[pickPalmX + 0.011, pickingY - 0.035, 0.069 + slap * 0.004],
          [pickX - 0.031, pickingY - 0.037, 0.069 + slap * 0.008],
          [pickX - 0.028, pickingY - 0.038, 0.056 + slap * 0.012],
          [pickX - 0.030, pickingY - 0.040, 0.048 + slap * 0.015]]);
        pluckingThumb([[pickPalmX - 0.002, pickingY + 0.016, 0.076 - slap * 0.006],
          [pickPalmX + 0.010, pickingY + 0.025, 0.076 - slap * 0.007],
          [THREE.MathUtils.lerp(pickX - 0.032, thumbX - 0.012, slap),
            THREE.MathUtils.lerp(pickingY + 0.027, BASS_SLAP_Y - 0.006, slap), 0.062],
          [THREE.MathUtils.lerp(pickX - 0.027, thumbX, slap), THREE.MathUtils.lerp(pickingY + 0.023, BASS_SLAP_Y, slap),
            THREE.MathUtils.lerp(0.052, bassStringZ(BASS_SLAP_Y) + 0.0008, slap)]]);
        frettingIndex([[0.033, fingerboardY + 0.001, 0.070],
          [0.019, fingerboardY + 0.002, 0.077],
          [frettingX + 0.003, fingerboardY + 0.001, touchZ + 0.017],
          [frettingX, fingerboardY, touchZ + 0.0008]]);
        frettingMiddle([[0.040, fingerboardY - 0.014, 0.078],
          [0.017, fingerboardY - 0.014, 0.079],
          [-0.007, fingerboardY - 0.018, 0.067],
          [-0.015, fingerboardY - 0.024, 0.041]]);
        frettingRing([[0.038, fingerboardY - 0.035, 0.074],
          [0.014, fingerboardY - 0.038, 0.078],
          [-0.009, fingerboardY - 0.043, 0.062],
          [-0.013, fingerboardY - 0.047, 0.043]]);
        // A short tucked thumb cups the rounded maple back. The first bend
        // clears the neck's shoulder before the pad curls in toward its centre.
        frettingThumb([[0.054, fingerboardY - 0.015, 0.050],
          [0.050, fingerboardY - 0.017, 0.02],
          [0.027, fingerboardY - 0.023, -0.017],
          [0.008, fingerboardY - 0.019, -0.01]]);
        bassStrap.visible = lift > 0.55;
        strapSurface.opacity = strapMetal.opacity = THREE.MathUtils.smoothstep(lift, 0.55, 1);
        for (let index = 0; index < armSkins.length; index++) {
          const rig = armSkins[index], { arm, side } = rig;
          const picking = index === 1;
          // The shoulder stays inside the hoodie, directly under the backpack
          // strap. Moving the entire arm toward the bass detached it in profile.
          arm.quaternion.slerp(identity, lift);
          rig.pile.forEach((item) => { item.visible = lift < 0.01; });
          // Palm position is expressed in instrument space, separate from the
          // string-contacting fingertips. Only the wrist shifts on a pluck.
          if (picking) bassPosePoint(pickPalmX - fingerPluck * 0.002, pickingY - 0.011,
            0.098 + fingerPluck * 0.001 + slap * 0.003, handTarget);
          else {
            const reach = THREE.MathUtils.smoothstep(fingerboardY, 0.42, 0.61);
            bassPosePoint(0.031 + 0.012 * reach, fingerboardY - 0.010, 0.070 + 0.020 * reach, handTarget);
          }
          palmRotation.copy(BASS_HELD_ROTATION).multiply(frameRotation.setFromAxisAngle(
            new THREE.Vector3(0, 1, 0), picking ? -0.15 : 0.30));
          palmRotation.multiply(frameRotation.setFromAxisAngle(
            new THREE.Vector3(0, 0, 1), (picking ? Math.PI / 2 : -Math.PI / 2)
              + (picking ? fingerPluck * 0.07 + slap * 0.10
                : -0.70 * THREE.MathUtils.smoothstep(fingerboardY, 0.42, 0.61))));
          sleeveCurve.v0.set(0, 0.012, 0);
          wrist.copy(handTarget).sub(arm.position);
          // The picking elbow folds forward along the bass's outer edge, with
          // a short turn into the cuff instead of a wide lateral loop. Its
          // measured resting sleeve length matches the fretting side (~142%
          // of the walking sleeve). Keep the shoulder and fingertip contacts
          // fixed; the cuff meets the proximal edge of the paw.
          elbow.set(side * 0.055,
            picking ? -0.070 + slap * 0.012 : -0.075 + Math.max(0, wrist.y) * 0.30,
            picking ? -0.20 : -0.110);
          elbowTangent.set(picking ? 0.025 : side * 0.010,
            picking ? -0.005 : 0.022 + Math.max(0, wrist.y) * 0.10, picking ? -0.07 : -0.063);
          if (!picking) {
            const reach = THREE.MathUtils.smoothstep(fingerboardY, 0.42, 0.61);
            // Only a high reach needs the full detour around the neck.
            // Keeping it at the resting fret folded the inner sleeve rings.
            elbowTangent.add(direction.set(0.075 + 0.045 * reach, 0, 0).applyQuaternion(BASS_HELD_ROTATION));
            elbowTangent.z -= 0.035 * reach;
          }
          sleeveCurve.v1.set(side * 0.025, picking ? -0.06 : -0.045, -0.008);
          sleeveCurve.v2.copy(elbow).addScaledVector(elbowTangent, -0.65);
          sleeveCurve.v3.copy(elbow);
          forearmCurve.v0.copy(elbow);
          forearmCurve.v1.copy(elbow).add(elbowTangent);
          direction.set(0, 1, 0).applyQuaternion(palmRotation);
          forearmCurve.v3.copy(wrist).addScaledVector(direction, 0.027);
          forearmCurve.v2.copy(forearmCurve.v3).addScaledVector(direction, picking ? 0.050 : 0.045);
          // Every ring shares a centre and tangent. Evaluate each section once,
          // rather than repeating curve sampling for its 49 surface vertices.
          for (const section of rig.sections.values()) {
            const curve = section.clamped > 0.52 ? forearmCurve : sleeveCurve;
            const curveT = section.clamped > 0.52
              ? (section.clamped - 0.52) / 0.48 : section.clamped / 0.52;
            curve.getPoint(curveT, section.centre);
            if (!picking && curve === forearmCurve) {
              // The padded forearm cups the side of the neck; it must not
              // cut diagonally through it when reaching the first frets.
              const reach = THREE.MathUtils.smoothstep(fingerboardY, 0.42, 0.61);
              const aroundNeck = 0.025 * reach * Math.sin(Math.PI * curveT) ** 2;
              section.centre.addScaledVector(direction.set(1, 0, 0).applyQuaternion(BASS_HELD_ROTATION), aroundNeck);
            }
            curve.getTangent(curveT, direction).normalize();
            section.centre.addScaledVector(direction, (section.t - section.clamped) * 0.3);
            section.rotation.setFromUnitVectors(down, direction);
          }
          for (const skin of rig.surfaces) {
            const positions = skin.item.geometry.getAttribute("position");
            const normals = skin.item.geometry.getAttribute("normal");
            for (let vertex = 0; vertex < positions.count; vertex++) {
              const i = vertex * 3;
              const x = skin.positions[i], y = skin.positions[i + 1], z = skin.positions[i + 2];
              skinNormal.set(skin.normals[i], skin.normals[i + 1], skin.normals[i + 2]);
              if (skin.paw) {
                const palmWidth = picking ? 1.10 : 1.08;
                const palmLength = picking ? 0.94 : 0.96;
                const palmDepth = picking ? 1.02 : 0.88;
                skinPoint.set((x - side * 0.025) * palmWidth,
                  (y + 0.319) * palmLength, (z + 0.02) * palmDepth)
                  .applyQuaternion(palmRotation).add(handTarget).sub(arm.position);
                skinNormal.set(skinNormal.x / palmWidth, skinNormal.y / palmLength, skinNormal.z / palmDepth)
                  .normalize().applyQuaternion(palmRotation);
              } else {
                const section = rig.sections.get(y)!;
                const sleeveWidth = 1.10
                  - 0.10 * THREE.MathUtils.smoothstep(section.clamped, 0.35, 0.65)
                  + 0.07 * THREE.MathUtils.smoothstep(section.clamped, 0.85, 1)
                  - (picking ? 0.10 * THREE.MathUtils.smoothstep(section.clamped, 0.52, 0.70)
                    * (1 - THREE.MathUtils.smoothstep(section.clamped, 0.90, 1)) : 0);
                skinPoint.set((x - side * 0.024 * section.clamped) * sleeveWidth, 0,
                  (z + 0.02 * section.clamped) * sleeveWidth)
                  .applyQuaternion(section.rotation);
                if (picking && skinPoint.z < 0) {
                  const innerElbow = Math.sin(Math.PI * THREE.MathUtils.clamp(
                    (section.clamped - 0.42) / 0.22, 0, 1)) ** 2;
                  skinPoint.z *= 1 - 0.10 * innerElbow;
                }
                skinNormal.applyQuaternion(section.rotation);
                skinPoint.add(section.centre);
              }
              positions.setXYZ(vertex, THREE.MathUtils.lerp(x, skinPoint.x, lift),
                THREE.MathUtils.lerp(y, skinPoint.y, lift), THREE.MathUtils.lerp(z, skinPoint.z, lift));
              skinNormal.set(THREE.MathUtils.lerp(skin.normals[i], skinNormal.x, lift),
                THREE.MathUtils.lerp(skin.normals[i + 1], skinNormal.y, lift),
                THREE.MathUtils.lerp(skin.normals[i + 2], skinNormal.z, lift)).normalize();
              normals.setXYZ(vertex, skinNormal.x, skinNormal.y, skinNormal.z);
            }
            if (!skin.paw) {
              // Bending and gathering change the longitudinal surface slope.
              // Rebuild its normals, welding the precomputed seam/pole groups,
              // so the elbow reads as soft folded cloth rather than a flat tube.
              skin.item.geometry.computeVertexNormals();
              for (const seam of skin.seams) {
                skinNormal.set(0, 0, 0);
                for (const vertex of seam) {
                  skinNormal.x += normals.getX(vertex);
                  skinNormal.y += normals.getY(vertex);
                  skinNormal.z += normals.getZ(vertex);
                }
                skinNormal.normalize();
                for (const vertex of seam)
                  normals.setXYZ(vertex, skinNormal.x, skinNormal.y, skinNormal.z);
              }
            }
            positions.needsUpdate = normals.needsUpdate = true;
            skin.item.geometry.boundingBox = null;
          }
        }
        previousBassLift = lift;
      } else {
        // Head pitch belongs only to this interaction; explicitly release it
        // when returning the instrument so later walking stays unchanged.
        head.rotation.x = 0;
        playingFingers.visible = bassStrap.visible = false;
        if (previousBassLift > 0) {
          for (const rig of armSkins) {
            rig.pile.forEach((item) => { item.visible = true; });
            for (const skin of rig.surfaces) {
              const positions = skin.item.geometry.getAttribute("position");
              const normals = skin.item.geometry.getAttribute("normal");
              (positions.array as Float32Array).set(skin.positions);
              (normals.array as Float32Array).set(skin.normals);
              positions.needsUpdate = normals.needsUpdate = true;
              skin.item.geometry.boundingBox = null;
            }
          }
          previousBassLift = 0;
        }
      }
    },
    dispose: scope.dispose,
  };
}
