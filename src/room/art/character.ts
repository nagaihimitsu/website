import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import type { RoomAvatarAnimation } from "../types";
import { createCharacterMaterials } from "./characterMaterials";
import { buildCharacterHead } from "./characterHead";
import { buildCharacterBody } from "./characterBody";
import type { CharacterBuilder } from "./characterBuilder";

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
  const { fur, fibers } = surfaces;
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

  const builder: CharacterBuilder = {
    surfaces,
    remember,
    smoothNormals,
    mesh,
    ellipsoid,
    thread,
    padded,
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
