import * as THREE from "three";

type RegisteredObject = {
  object: THREE.Object3D;
  colors: string[];
  supportY: number;
  broken: boolean;
};

type Fragment = {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  spin: THREE.Vector3;
  restPosition: THREE.Vector3;
  restRotation: THREE.Euler;
  radius: number;
  surfaceY: number;
  age: number;
  settled: boolean;
};

type Batch = {
  group: THREE.Group;
  fragments: Fragment[];
  geometries: THREE.BufferGeometry[];
  materials: THREE.Material[];
  age: number;
};

const X_LIMIT = 4.7;
const Z_LIMIT = 3.7;
const FRAGMENTS_PER_OBJECT = 12;
const MAX_BATCHES = 5;
const clamp = THREE.MathUtils.clamp;

function seededRandom(key: string) {
  let state = 2166136261;
  for (let index = 0; index < key.length; index++) {
    state = Math.imul(state ^ key.charCodeAt(index), 16777619);
  }
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}

function isVisible(object: THREE.Object3D) {
  for (
    let current: THREE.Object3D | null = object;
    current;
    current = current.parent
  ) {
    if (!current.visible) return false;
  }
  return true;
}

/** Lightweight decorative fragments; owns only its fragments, never registered props. */
export function createBreakables(scene: THREE.Scene) {
  const registered = new Map<string, RegisteredObject>();
  const batches: Batch[] = [];
  let sequence = 0;
  let disposed = false;

  function clearBatch(batch: Batch) {
    batch.group.removeFromParent();
    batch.group.clear();
    for (const geometry of batch.geometries) geometry.dispose();
    for (const material of batch.materials) material.dispose();
    batch.fragments.length = 0;
  }

  function clearFragments() {
    for (const batch of batches) clearBatch(batch);
    batches.length = 0;
  }

  function register(
    id: string,
    object: THREE.Object3D,
    colors: string[],
    supportY = 0.02,
  ) {
    if (disposed) return;
    const previous = registered.get(id);
    if (
      previous &&
      previous.object !== object &&
      previous.object.userData.breakableId === id
    ) {
      delete previous.object.userData.breakableId;
    }
    object.userData.breakableId = id;
    registered.set(id, {
      object,
      colors:
        colors.length > 0 ? [...colors] : ["#c9b493", "#ddd2bd", "#a99676"],
      supportY: Number.isFinite(supportY) ? supportY : 0.02,
      broken: false,
    });
  }

  function breakObject(id: string, direction: THREE.Vector3) {
    const entry = registered.get(id);
    if (disposed || !entry || entry.broken || !isVisible(entry.object))
      return false;

    entry.object.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(entry.object);
    const center = box.isEmpty()
      ? entry.object.getWorldPosition(new THREE.Vector3())
      : box.getCenter(new THREE.Vector3());
    const size = box.isEmpty()
      ? new THREE.Vector3(0.3, 0.3, 0.3)
      : box.getSize(new THREE.Vector3());
    const extent = clamp(Math.max(size.x, size.y, size.z), 0.15, 1.4);
    const forward = direction.clone();
    if (![forward.x, forward.y, forward.z].every(Number.isFinite))
      forward.set(0, 0, -1);
    if (forward.lengthSq() > 0) forward.normalize();
    const random = seededRandom(`${id}:${sequence++}`);
    const group = new THREE.Group();
    group.name = `fragments:${id}`;
    const geometries = [
      new THREE.TetrahedronGeometry(1),
      new THREE.BoxGeometry(1, 1, 1),
    ];
    const materials = entry.colors.slice(0, 6).map(
      (color) =>
        new THREE.MeshStandardMaterial({
          color,
          roughness: 0.88,
          metalness: 0,
          flatShading: true,
          transparent: true,
        }),
    );
    const batch: Batch = {
      group,
      fragments: [],
      geometries,
      materials,
      age: 0,
    };

    for (let index = 0; index < FRAGMENTS_PER_OBJECT; index++) {
      const mesh = new THREE.Mesh(
        geometries[index % geometries.length],
        materials[index % materials.length],
      );
      const length = extent * (0.07 + random() * 0.065);
      mesh.scale.set(
        length,
        length * (0.25 + random() * 0.4),
        length * (0.45 + random() * 0.7),
      );
      const radius = length * 0.62;
      const surfaceY = entry.supportY;
      mesh.position.set(
        clamp(
          center.x + (random() - 0.5) * size.x * 0.55,
          -X_LIMIT + radius,
          X_LIMIT - radius,
        ),
        Math.max(surfaceY + radius, center.y + (random() - 0.5) * size.y * 0.6),
        clamp(
          center.z + (random() - 0.5) * size.z * 0.55,
          -Z_LIMIT + radius,
          Z_LIMIT - radius,
        ),
      );
      mesh.rotation.set(
        random() * Math.PI,
        random() * Math.PI,
        random() * Math.PI,
      );
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const scatterAngle = random() * Math.PI * 2;
      const scatterDistance = extent * (0.18 + random() * 0.32);
      const restPosition = new THREE.Vector3(
        clamp(
          center.x + Math.cos(scatterAngle) * scatterDistance,
          -X_LIMIT + radius,
          X_LIMIT - radius,
        ),
        surfaceY + radius,
        clamp(
          center.z + Math.sin(scatterAngle) * scatterDistance,
          -Z_LIMIT + radius,
          Z_LIMIT - radius,
        ),
      );
      batch.fragments.push({
        mesh,
        velocity: new THREE.Vector3(
          forward.x * (0.75 + random() * 0.7) + (random() - 0.5) * 1.7,
          1.15 + random() * 1.8 + Math.max(0, forward.y) * 0.5,
          forward.z * (0.75 + random() * 0.7) + (random() - 0.5) * 1.7,
        ),
        spin: new THREE.Vector3(
          (random() - 0.5) * 8,
          (random() - 0.5) * 8,
          (random() - 0.5) * 8,
        ),
        restPosition,
        restRotation: new THREE.Euler(
          0,
          random() * Math.PI * 2,
          (random() - 0.5) * 0.25,
        ),
        radius,
        surfaceY,
        age: 0,
        settled: false,
      });
      group.add(mesh);
    }

    entry.object.visible = false;
    entry.broken = true;
    scene.add(group);
    batches.push(batch);
    // A bounded amount of geometry even if every object in the room is broken.
    while (batches.length > MAX_BATCHES) clearBatch(batches.shift()!);
    return true;
  }

  function resetObjects() {
    if (disposed) return;
    clearFragments();
    for (const entry of registered.values()) {
      entry.object.visible = true;
      entry.broken = false;
    }
    sequence = 0;
  }

  function animate(delta: number, reducedMotion: boolean) {
    if (disposed) return;
    // Lifetime follows the active clock even when rendering is slow. Motion has a
    // separate catch-up budget so a suspended/slow frame cannot launch fragments.
    const elapsed = Number.isFinite(delta) ? Math.max(0, delta) : 0;
    const motionTime = Math.min(elapsed, 0.25);
    const stepCount = Math.ceil(motionTime / (1 / 60));
    const step = stepCount > 0 ? motionTime / stepCount : 0;
    for (let batchIndex = batches.length - 1; batchIndex >= 0; batchIndex--) {
      const batch = batches[batchIndex];
      batch.age += elapsed;
      if (batch.age >= 2) {
        clearBatch(batch);
        batches.splice(batchIndex, 1);
        continue;
      }
      const opacity = clamp((2 - batch.age) / 0.45, 0, 1);
      for (const material of batch.materials) material.opacity = opacity;
      for (const fragment of batch.fragments) {
        if (fragment.settled) continue;
        const { mesh, velocity, spin, radius, surfaceY } = fragment;
        if (reducedMotion) {
          mesh.position.copy(fragment.restPosition);
          mesh.rotation.copy(fragment.restRotation);
          fragment.settled = true;
          continue;
        }
        fragment.age += elapsed;
        for (
          let stepIndex = 0;
          stepIndex < stepCount && !fragment.settled;
          stepIndex++
        ) {
          velocity.y -= 7.8 * step;
          mesh.position.addScaledVector(velocity, step);
          mesh.rotation.x += spin.x * step;
          mesh.rotation.y += spin.y * step;
          mesh.rotation.z += spin.z * step;
          velocity.x *= Math.exp(-0.9 * step);
          velocity.z *= Math.exp(-0.9 * step);
          if (Math.abs(mesh.position.x) > X_LIMIT - radius) {
            mesh.position.x = clamp(
              mesh.position.x,
              -X_LIMIT + radius,
              X_LIMIT - radius,
            );
            velocity.x *= -0.28;
          }
          if (Math.abs(mesh.position.z) > Z_LIMIT - radius) {
            mesh.position.z = clamp(
              mesh.position.z,
              -Z_LIMIT + radius,
              Z_LIMIT - radius,
            );
            velocity.z *= -0.28;
          }
          if (mesh.position.y <= surfaceY + radius) {
            mesh.position.y = surfaceY + radius;
            velocity.y = Math.abs(velocity.y) * 0.28;
            velocity.x *= 0.65;
            velocity.z *= 0.65;
            spin.multiplyScalar(0.5);
            if (
              velocity.y < 0.26 &&
              Math.hypot(velocity.x, velocity.z) < 0.14
            ) {
              fragment.settled = true;
              mesh.rotation.x = fragment.restRotation.x;
              mesh.rotation.z = fragment.restRotation.z;
            }
          }
        }
        // Bound the effect duration even for a very high or unusually shaped prop.
        if (fragment.age >= 1.5) {
          mesh.position.y = surfaceY + radius;
          mesh.rotation.x = fragment.restRotation.x;
          mesh.rotation.z = fragment.restRotation.z;
          fragment.settled = true;
        }
      }
    }
  }

  function dispose() {
    if (disposed) return;
    clearFragments();
    for (const [id, { object }] of registered) {
      if (object.userData.breakableId === id)
        delete object.userData.breakableId;
    }
    registered.clear();
    disposed = true;
  }

  return {
    register,
    breakObject,
    resetObjects,
    animate,
    get brokenCount() {
      let count = 0;
      for (const entry of registered.values()) if (entry.broken) count++;
      return count;
    },
    dispose,
  };
}
