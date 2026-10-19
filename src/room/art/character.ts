import * as THREE from "three";
import { withDisposalScope, type DisposalScope } from "../disposal";
import type { RoomAvatarAnimation } from "../types";
import { createCharacterMaterials } from "./characterMaterials";
import { buildCharacterHead } from "./characterHead";
import { buildCharacterBody } from "./characterBody";
import type { CharacterBuilder } from "./characterBuilder";
import {
  BASS_HELD_POSITION, BASS_HELD_ROTATION, BASS_HELD_SCALE,
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
      t: number; clamped: number; width: number; centre: THREE.Vector3; rotation: THREE.Quaternion;
    }>();
    for (const item of meshes) {
      if (item.name === "sculpted-soft-mitt") continue;
      const vertices = item.geometry.getAttribute("position");
      for (let vertex = 0; vertex < vertices.count; vertex++) {
        const y = vertices.getY(vertex);
        if (sections.has(y)) continue;
        const t = -y / 0.3, clamped = THREE.MathUtils.clamp(t, 0, 1);
        sections.set(y, { t, clamped,
          width: 1 - 0.23 * THREE.MathUtils.smoothstep(clamped, 0.3, 1),
          centre: new THREE.Vector3(), rotation: new THREE.Quaternion() });
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
        return { item, positions: new Float32Array(item.geometry.getAttribute("position").array),
          normals: new Float32Array(item.geometry.getAttribute("normal").array),
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
    const rings = 16, sides = 8;
    const geometry = remember(new THREE.BufferGeometry());
    const positions = new Float32Array((rings + 1) * (sides + 1) * 3);
    const normals = new Float32Array(positions.length);
    const uvs: number[] = [];
    const indices: number[] = [];
    for (let ring = 0; ring < rings; ring++) for (let side = 0; side < sides; side++) {
      const a = ring * (sides + 1) + side, b = a + sides + 1;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
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
    const direction = new THREE.Vector3(), reference = new THREE.Vector3(0, 0, 1);
    return (shape: number[][]) => {
      points.forEach((point, i) => point.set(...shape[i] as [number, number, number]));
      end.position.copy(points[3]);
      for (let ring = 0; ring <= rings; ring++) {
        const t = ring / rings;
        curve.getPoint(t, centre);
        curve.getTangent(t, tangent).normalize();
        across.crossVectors(tangent, reference).normalize();
        if (across.lengthSq() < 0.01) across.set(1, 0, 0);
        around.crossVectors(tangent, across).normalize();
        const r = radius * Math.sin(Math.PI * t) ** 0.24;
        for (let side = 0; side <= sides; side++) {
          const angle = side / sides * Math.PI * 2;
          direction.copy(across).multiplyScalar(Math.cos(angle)).addScaledVector(around, Math.sin(angle));
          const i = (ring * (sides + 1) + side) * 3;
          positions[i] = centre.x + direction.x * r;
          positions[i + 1] = centre.y + direction.y * r;
          positions[i + 2] = centre.z + direction.z * r;
          normals[i] = direction.x; normals[i + 1] = direction.y; normals[i + 2] = direction.z;
        }
      }
      geometry.getAttribute("position").needsUpdate = true;
      geometry.getAttribute("normal").needsUpdate = true;
      geometry.boundingBox = null;
    };
  }
  const pluckingIndex = liveFinger("bass-plucking-index", 0.009);
  const pluckingMiddle = liveFinger("bass-plucking-middle", 0.009);
  const pluckingThumb = liveFinger("bass-plucking-thumb", 0.011);
  const frettingIndex = liveFinger("bass-fretting-index", 0.0095);
  const frettingMiddle = liveFinger("bass-fretting-middle", 0.009);
  const frettingThumb = liveFinger("bass-fretting-thumb", 0.011);

  // A narrow cloth strap bears the instrument over the shoulder, with its back
  // section naturally hidden underneath the traveller's existing backpack.
  const strapSurface = remember(new THREE.MeshStandardMaterial({ color: "#665341", roughness: 0.93,
    side: THREE.DoubleSide, transparent: true, opacity: 0 }));
  const strapPoints = [
    bassPosePoint(-0.086, 0.23, 0), new THREE.Vector3(0.135, 0.70, -0.145),
    new THREE.Vector3(0.135, 0.735, -0.025), new THREE.Vector3(0.12, 0.70, 0.11),
    new THREE.Vector3(-0.075, 0.61, 0.145), new THREE.Vector3(-0.16, 0.57, 0.1),
    new THREE.Vector3(-0.2, 0.51, -0.07), bassPosePoint(0.13, -0.13, 0),
  ];
  const strapCurve = new THREE.CatmullRomCurve3(strapPoints);
  const strapPositions: number[] = [], strapIndices: number[] = [];
  const strapAcross = new THREE.Vector3(), strapOut = new THREE.Vector3();
  const strapSides = 8;
  for (let row = 0; row <= 96; row++) {
    const point = strapCurve.getPoint(row / 96), tangent = strapCurve.getTangent(row / 96);
    strapOut.set(point.x, 0, point.z).normalize();
    strapAcross.crossVectors(tangent, strapOut).normalize();
    strapOut.crossVectors(strapAcross, tangent).normalize();
    for (let side = 0; side <= strapSides; side++) {
      const angle = side / strapSides * Math.PI * 2;
      const w = Math.cos(angle) * 0.019, thickness = Math.sin(angle) * 0.0022;
      strapPositions.push(point.x + strapAcross.x * w + strapOut.x * thickness,
        point.y + strapAcross.y * w + strapOut.y * thickness,
        point.z + strapAcross.z * w + strapOut.z * thickness);
      if (row < 96 && side < strapSides) { const a = row * (strapSides + 1) + side, b = a + strapSides + 1;
        strapIndices.push(a, a + 1, b, b, a + 1, b + 1); }
    }
  }
  const strapGeometry = remember(new THREE.BufferGeometry());
  strapGeometry.setAttribute("position", new THREE.Float32BufferAttribute(strapPositions, 3));
  strapGeometry.setIndex(strapIndices);
  strapGeometry.computeVertexNormals();
  const bassStrap = mesh(strapGeometry, strapSurface, body);
  bassStrap.name = "bass-shoulder-support-strap";
  bassStrap.visible = false;

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
        const pickX = bassStringX(state.bass.pluckString ?? state.bass.string);
        const touchZ = bassStringZ(fingerboardY) + (state.bass.fretting ? 0 : 0.014);
        playingFingers.visible = lift > 0.65;
        playingFingers.scale.setScalar(BASS_HELD_SCALE * THREE.MathUtils.smoothstep(lift, 0.65, 1));
        pluckingIndex([[0.065, 0.011, 0.101], [0.043, 0.02, 0.097],
          [pickX + 0.01, 0.02, 0.068], [pickX - pluck * 0.007, 0.015, bassStringZ(0.015) + 0.002 + pluck * 0.003]]);
        pluckingMiddle([[0.065, -0.011, 0.101], [0.043, -0.006, 0.097],
          [pickX + 0.013, -0.008, 0.064], [pickX + 0.003, -0.009, 0.049]]);
        pluckingThumb([[0.068, 0.033, 0.093], [0.055, 0.062, 0.088],
          [0.032, 0.07, 0.063], [0.025, 0.067, 0.046]]);
        frettingIndex([[-0.057, fingerboardY - 0.02, 0.079], [-0.036, fingerboardY + 0.005, 0.084],
          [frettingX - 0.006, fingerboardY + 0.006, touchZ + 0.023], [frettingX, fingerboardY, touchZ + 0.0008]]);
        frettingMiddle([[-0.058, fingerboardY - 0.041, 0.076], [-0.035, fingerboardY - 0.02, 0.078],
          [-0.01, fingerboardY - 0.02, 0.061], [0.006, fingerboardY - 0.023, 0.046]]);
        frettingThumb([[-0.061, fingerboardY - 0.022, 0.053], [-0.043, fingerboardY - 0.025, 0.006],
          [-0.009, fingerboardY - 0.024, -0.027], [0.017, fingerboardY - 0.02, -0.013]]);
        bassStrap.visible = lift > 0.55;
        strapSurface.opacity = THREE.MathUtils.smoothstep(lift, 0.55, 1);
        for (let index = 0; index < armSkins.length; index++) {
          const rig = armSkins[index], { arm, side } = rig;
          arm.position.z -= 0.045 * lift;
          arm.quaternion.slerp(identity, lift);
          rig.pile.forEach((item) => { item.visible = lift < 0.01; });
          // Palm position is expressed in instrument space, separate from the
          // string-contacting fingertips. Only the wrist shifts on a pluck.
          if (index === 0) bassPosePoint(0.07 - pluck * 0.003, 0.007, 0.105 + pluck * 0.001, handTarget);
          else bassPosePoint(-0.055, fingerboardY - 0.022, 0.079, handTarget);
          sleeveCurve.v0.set(0, 0.012, 0);
          sleeveCurve.v1.set(side * 0.04, -0.11, -0.04);
          sleeveCurve.v2.set(side * 0.085, -0.17, -0.15);
          wrist.copy(handTarget).sub(arm.position);
          direction.copy(sleeveCurve.v2).sub(wrist).normalize();
          sleeveCurve.v3.copy(wrist).addScaledVector(direction, 0.032);
          if (index === 0) {
            // The plucking sleeve goes around the bass's outside edge before
            // coming in over its face. A straight shoulder-to-hand chord cuts
            // through the body even when the torso itself has ample clearance.
            sleeveCurve.v1.set(-0.13, 0.025, -0.06);
            sleeveCurve.v2.set(-0.2, 0.075, -0.34);
            sleeveCurve.v3.copy(wrist).add(new THREE.Vector3(-0.025, 0.012, 0.002));
          }
          palmRotation.copy(BASS_HELD_ROTATION).multiply(frameRotation.setFromAxisAngle(
            new THREE.Vector3(0, 0, 1), (index === 0 ? -Math.PI / 2 : Math.PI / 2) + (index === 0 ? -pluck * 0.09 : 0)));
          // Every ring shares a centre and tangent. Evaluate each section once,
          // rather than repeating curve sampling for its 49 surface vertices.
          for (const section of rig.sections.values()) {
            sleeveCurve.getPoint(section.clamped, section.centre);
            sleeveCurve.getTangent(section.clamped, direction).normalize();
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
                skinPoint.set((x - side * 0.025) * 0.72, (y + 0.319) * 0.83, (z + 0.02) * 0.7)
                  .applyQuaternion(palmRotation).add(handTarget).sub(arm.position);
                skinNormal.applyQuaternion(palmRotation);
              } else {
                const section = rig.sections.get(y)!;
                skinPoint.set((x - side * 0.024 * section.clamped) * section.width, 0,
                  (z + 0.02 * section.clamped) * section.width)
                  .applyQuaternion(section.rotation).add(section.centre);
                skinNormal.applyQuaternion(section.rotation);
              }
              positions.setXYZ(vertex, THREE.MathUtils.lerp(x, skinPoint.x, lift),
                THREE.MathUtils.lerp(y, skinPoint.y, lift), THREE.MathUtils.lerp(z, skinPoint.z, lift));
              skinNormal.set(THREE.MathUtils.lerp(skin.normals[i], skinNormal.x, lift),
                THREE.MathUtils.lerp(skin.normals[i + 1], skinNormal.y, lift),
                THREE.MathUtils.lerp(skin.normals[i + 2], skinNormal.z, lift)).normalize();
              normals.setXYZ(vertex, skinNormal.x, skinNormal.y, skinNormal.z);
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
