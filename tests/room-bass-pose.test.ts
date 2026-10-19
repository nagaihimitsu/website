import * as THREE from "three";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCharacter } from "../src/room/art/character";
import { createBassGarden } from "../src/room/art/bassGarden";
import { BASS_HELD_POSITION, BASS_HELD_ROTATION, BASS_HELD_SCALE } from "../src/room/art/bassPose";
import type { RoomAvatarAnimation } from "../src/room/types";

describe("the actual bass-performing model", () => {
  let character: ReturnType<typeof createCharacter>;
  let garden: ReturnType<typeof createBassGarden>;
  let time = 0;
  const base = { speed: 0, grounded: true, velocityY: 0, punchProgress: null, reducedMotion: false };
  const point = new THREE.Vector3();

  function pose(bass?: RoomAvatarAnimation["bass"]) {
    character.animate({ ...base, time: time += 0.05, bass });
    character.group.updateMatrixWorld(true);
  }
  function armSurfaces() {
    return ["right-arm", "left-arm"].flatMap((name) =>
      character.group.getObjectByName(name)!.children.filter((item): item is THREE.Mesh =>
        item instanceof THREE.Mesh && !(item instanceof THREE.InstancedMesh)));
  }
  beforeAll(() => {
    character = createCharacter();
    garden = createBassGarden();
    character.bassAnchor.add(garden.instrument);
    garden.instrument.position.copy(BASS_HELD_POSITION);
    garden.instrument.quaternion.copy(BASS_HELD_ROTATION);
    garden.instrument.scale.setScalar(BASS_HELD_SCALE);
    pose();
  });
  afterAll(() => { character.dispose(); garden.dispose(); });

  it("restores every sleeve, cuff and paw vertex and normal after playing and putting down", () => {
    pose();
    const originals = armSurfaces().map((mesh) => ({ mesh,
      vertices: Array.from(mesh.geometry.getAttribute("position").array),
      normals: Array.from(mesh.geometry.getAttribute("normal").array),
    }));
    for (const lift of [0.2, 0.7, 1, 1, 1, 1, 0.6, 0.1]) {
      pose({ lift, pluck: time % 1, slap: Math.floor(time * 20) % 2, playing: true, beat: time * 1.6,
        string: Math.floor(time * 10) % 4, fret: 2 + Math.floor(time * 10) % 4, fretting: true });
      for (const { mesh } of originals) {
        expect(Array.from(mesh.geometry.getAttribute("position").array).every(Number.isFinite)).toBe(true);
        expect(Array.from(mesh.geometry.getAttribute("normal").array).every(Number.isFinite)).toBe(true);
      }
    }
    pose();
    for (const { mesh, vertices, normals } of originals) {
      expect(Array.from(mesh.geometry.getAttribute("position").array)).toEqual(vertices);
      expect(Array.from(mesh.geometry.getAttribute("normal").array)).toEqual(normals);
    }
    expect(character.group.getObjectByName("bass-articulated-fingers")!.visible).toBe(false);
    expect(character.group.getObjectByName("bass-shoulder-support-strap")!.visible).toBe(false);
  });

  it("places fretting, plucking and slap-thumb tips on their actual strings", () => {
    const strings = garden.instrument.children.filter((item): item is THREE.Mesh<THREE.CylinderGeometry> =>
      item instanceof THREE.Mesh && item.name === "bass-steel-string");
    expect(strings).toHaveLength(4);
    for (let string = 0; string < 4; string++) {
      for (let step = 0; step < 12; step++) pose({ lift: 1, pluck: 0, playing: true,
        beat: time * 1.6, string, fret: string % 2 ? 5 : 2, fretting: true, pluckString: string });
      const actualString = strings[3 - string];
      const halfLength = actualString.geometry.parameters.height / 2;
      const axis = new THREE.Line3(
        new THREE.Vector3(0, -halfLength, 0).applyMatrix4(actualString.matrixWorld),
        new THREE.Vector3(0, halfLength, 0).applyMatrix4(actualString.matrixWorld),
      );
      for (const [name, tolerance] of [["bass-fretting-index-tip", 0.0015], ["bass-plucking-index-tip", 0.003]] as const) {
        const tip = character.group.getObjectByName(name)!.getWorldPosition(new THREE.Vector3());
        expect(tip.distanceTo(axis.closestPointToPoint(tip, true, point))).toBeLessThan(tolerance);
      }
      pose({ lift: 1, pluck: 1, slap: 1, playing: true, beat: time * 1.6,
        string, fret: string % 2 ? 5 : 2, fretting: true, pluckString: string });
      // The input gesture changes hands, while the next beat may move the whole
      // performer. Rebuild the real string's world axis after this new pose.
      axis.start.set(0, -halfLength, 0).applyMatrix4(actualString.matrixWorld);
      axis.end.set(0, halfLength, 0).applyMatrix4(actualString.matrixWorld);
      const thumb = character.group.getObjectByName("bass-plucking-thumb-tip")!.getWorldPosition(new THREE.Vector3());
      expect(thumb.distanceTo(axis.closestPointToPoint(thumb, true, point))).toBeLessThan(0.0015);
      const liftedIndex = character.group.getObjectByName("bass-plucking-index-tip")!.getWorldPosition(new THREE.Vector3());
      expect(liftedIndex.distanceTo(axis.closestPointToPoint(liftedIndex, true, point))).toBeGreaterThan(0.01);
    }
  });

  it("keeps the torso and both cloth sleeves outside the actual bass body at every beat and stroke extreme", () => {
    const bassBody = garden.instrument.getObjectByName("bass-carved-sunburst-body") as THREE.Mesh;
    const inspectionMaterial = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    const inspectionBody = new THREE.Mesh(bassBody.geometry, inspectionMaterial);
    inspectionBody.position.copy(bassBody.position);
    inspectionBody.updateMatrixWorld(true);
    const bodyBounds = new THREE.Box3().setFromObject(inspectionBody);
    const ray = new THREE.Raycaster();
    const direction = new THREE.Vector3(0, 0, 1);
    try {
      for (const beat of [0, 0.25, 0.5, 0.75, 1]) for (const pluck of [0, 1]) for (const slap of [0, 0.5, 1]) {
        pose({ lift: 1, pluck, slap, playing: true, beat, string: Math.floor(beat * 4) % 4, fret: 3, fretting: true });
        const torsoInverse = character.bassAnchor.matrixWorld.clone().invert();
        let torsoFront = Infinity, bassBack = -Infinity;
        for (const name of ["loose-cotton-body", "sewn-kangaroo-pocket"]) {
          const mesh = character.group.getObjectByName(name) as THREE.Mesh;
          const vertices = mesh.geometry.getAttribute("position");
          for (let i = 0; i < vertices.count; i++) {
            point.fromBufferAttribute(vertices, i).applyMatrix4(mesh.matrixWorld).applyMatrix4(torsoInverse);
            torsoFront = Math.min(torsoFront, point.z);
          }
        }
        garden.instrument.traverse((item) => {
          if (!(item instanceof THREE.Mesh)) return;
          const vertices = item.geometry.getAttribute("position");
          for (let i = 0; i < vertices.count; i++) {
            point.fromBufferAttribute(vertices, i).applyMatrix4(item.matrixWorld).applyMatrix4(torsoInverse);
            bassBack = Math.max(bassBack, point.z);
          }
        });
        expect(torsoFront - bassBack).toBeGreaterThan(0.045);
        const instrumentInverse = garden.instrument.matrixWorld.clone().invert();
        let penetratingCloth = 0;
        for (const mesh of armSurfaces()) {
          const vertices = mesh.geometry.getAttribute("position");
          for (let i = 0; i < vertices.count; i++) {
            point.fromBufferAttribute(vertices, i).applyMatrix4(mesh.matrixWorld).applyMatrix4(instrumentInverse);
            if (!bodyBounds.containsPoint(point)) continue;
            ray.set(new THREE.Vector3(point.x, point.y, -1), direction);
            const hits = ray.intersectObject(inspectionBody, false);
            if (hits.length < 2) continue;
            const first = Math.min(...hits.map((hit) => hit.point.z));
            const last = Math.max(...hits.map((hit) => hit.point.z));
            if (point.z > first + 0.00001 && point.z < last - 0.00001) penetratingCloth++;
          }
        }
        expect(penetratingCloth).toBe(0);
      }
    } finally { inspectionMaterial.dispose(); }
  });
});
