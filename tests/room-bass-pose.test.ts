import * as THREE from "three";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCharacter } from "../src/room/art/character";
import { createBassGarden } from "../src/room/art/bassGarden";
import { BASS_HELD_POSITION, BASS_HELD_ROTATION, BASS_HELD_SCALE, BASS_REST_FRET } from "../src/room/art/bassPose";
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
    const shoulders = ["right-arm", "left-arm"].map((name) => {
      const arm = character.group.getObjectByName(name)!;
      return { arm, attachment: arm.position.clone() };
    });
    for (const lift of [0.2, 0.7, 1, 1, 1, 1, 0.6, 0.1]) {
      pose({ lift, pluck: time % 1, slap: Math.floor(time * 20) % 2, playing: true, beat: time * 1.6,
        string: Math.floor(time * 10) % 4, fret: 2 + Math.floor(time * 10) % 4, fretting: true });
      for (const { mesh } of originals) {
        expect(Array.from(mesh.geometry.getAttribute("position").array).every(Number.isFinite)).toBe(true);
        expect(Array.from(mesh.geometry.getAttribute("normal").array).every(Number.isFinite)).toBe(true);
      }
      for (const { arm, attachment } of shoulders)
        expect(arm.position.distanceTo(attachment), `${arm.name} stays attached under its shoulder strap`).toBeLessThan(1e-6);
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

  it("matches the resting fretting sleeve's 142% length and limits extension during picking", () => {
    pose();
    // Measure the rendered sleeve's centreline, not shoulder-to-wrist distance:
    // a bent sleeve can become much longer without changing that chord. Keep
    // the same material landmarks in both poses and exclude the paw/fingers.
    const armLengths = ["left-arm", "right-arm"].map((name) => {
      const arm = character.group.getObjectByName(name)!;
      const sleeve = arm.getObjectByName("rounded-bag-sleeve") as THREE.Mesh;
      const cuff = arm.children.find((item): item is THREE.Mesh =>
        item instanceof THREE.Mesh && !(item instanceof THREE.InstancedMesh)
        && item !== sleeve && item.name !== "sculpted-soft-mitt")!;
      const parts = [sleeve, cuff].map((mesh) => {
        const vertices = mesh.geometry.getAttribute("position");
        // The loft has 48 unique radial samples plus the repeated seam vertex.
        const rows = Array.from({ length: vertices.count / 49 }, (_, row) => ({
          y: vertices.getY(row * 49), start: row * 49,
        }));
        return () => rows.map(({ y, start }) => {
          const centre = new THREE.Vector3();
          for (let i = 0; i < 48; i++) centre.add(point.fromBufferAttribute(vertices, start + i));
          return { y, centre: centre.divideScalar(48).applyMatrix4(mesh.matrixWorld) };
        }).sort((a, b) => b.y - a.y);
      });
      type Ring = ReturnType<typeof parts[number]>[number];
      const at = (rows: Ring[], y: number) => {
        const i = rows.findIndex((row, index) => row.y >= y && rows[index + 1]?.y <= y);
        if (i < 0) throw new Error(`Missing sleeve landmark ${y}`);
        return rows[i].centre.clone().lerp(rows[i + 1].centre,
          (rows[i].y - y) / (rows[i].y - rows[i + 1].y));
      };
      const path = (rows: Ring[], from: number, to: number) => [
        at(rows, from), ...rows.filter((row) => row.y < from && row.y > to).map((row) => row.centre),
        at(rows, to),
      ];
      const measure = () => {
        const centres = [...path(parts[0](), 0, -0.278), ...path(parts[1](), -0.278, -0.300)];
        return centres.slice(1).reduce((length, centre, i) => length + centre.distanceTo(centres[i]), 0);
      };
      return { measure, normal: measure() };
    });
    const held = { lift: 1, playing: false, beat: 0, string: 3, pluckString: 3,
      fret: BASS_REST_FRET, fretting: true, pluck: 0, slap: 0 };
    pose(held);
    const [picking, fretting] = armLengths;
    const restingRatio = picking.measure() / picking.normal;
    expect(restingRatio).toBeGreaterThan(1.40);
    expect(restingRatio).toBeLessThan(1.44);
    expect(fretting.measure() / fretting.normal).toBeCloseTo(1.42, 2);
    for (const string of [0, 1, 2, 3]) for (const pluck of [0, 1]) for (const slap of [0, 0.5, 1]) {
      pose({ ...held, playing: true, beat: string / 4, string, pluckString: string, pluck, slap });
      const ratio = picking.measure() / picking.normal;
      const stroke = JSON.stringify({ string, pluck, slap, ratio });
      // Reaching across all four strings changes the sleeve's path slightly;
      // it must stay below the previous playing range of 170–183%.
      expect(ratio, stroke).toBeGreaterThan(1.39);
      expect(ratio, stroke).toBeLessThan(1.58);
    }
    pose();
  });

  it("keeps the torso, sleeves, paws and actual fingers outside the wooden body and neck at every stroke extreme", () => {
    const bassBody = garden.instrument.getObjectByName("bass-carved-sunburst-body") as THREE.Mesh;
    const fingerboard = garden.instrument.getObjectByName("bass-tapered-rosewood-fingerboard") as THREE.Mesh;
    const neck = garden.instrument.children.find((item): item is THREE.Mesh =>
      item instanceof THREE.Mesh && item.userData.sourcePartNames?.includes("bass-rounded-maple-neck"));
    expect(neck).toBeDefined();
    const inspectionMaterial = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    const solids = [bassBody, fingerboard, neck!].map((source) => {
      const mesh = new THREE.Mesh(source.geometry, inspectionMaterial);
      mesh.position.copy(source.position);
      mesh.quaternion.copy(source.quaternion);
      mesh.scale.copy(source.scale);
      mesh.updateMatrixWorld(true);
      return { mesh, name: source.name, bounds: new THREE.Box3().setFromObject(mesh) };
    });
    const fingers = character.group.getObjectByName("bass-articulated-fingers")!.children
      .filter((item): item is THREE.Mesh => item instanceof THREE.Mesh);
    expect(fingers).toHaveLength(8);
    const pickingSleeve = character.group.getObjectByName("left-arm")!
      .getObjectByName("rounded-bag-sleeve") as THREE.Mesh;
    const edges = new Map<string, [number, number]>();
    const indices = pickingSleeve.geometry.index!;
    for (let i = 0; i < indices.count; i += 3) {
      const triangle = [indices.getX(i), indices.getX(i + 1), indices.getX(i + 2)];
      for (let corner = 0; corner < 3; corner++) {
        const a = triangle[corner], b = triangle[(corner + 1) % 3];
        edges.set(`${Math.min(a, b)}:${Math.max(a, b)}`, [a, b]);
      }
    }
    const ray = new THREE.Raycaster();
    const direction = new THREE.Vector3(0, 0, 1);
    try {
      pose({ lift: 1, pluck: 0, playing: true, beat: 0, string: 3, fret: BASS_REST_FRET, fretting: true });
      const instrumentInverse = garden.instrument.matrixWorld.clone().invert();
      // These clothes and the bass share the torso anchor, so their relative
      // clearance is unchanged by the animated torso's sway. Compare their
      // actual overlapping surfaces once, not unrelated global Z extrema.
      for (const name of ["loose-cotton-body", "sewn-kangaroo-pocket", "continuous-collapsed-cotton-hood"]) {
        const mesh = character.group.getObjectByName(name) as THREE.Mesh;
        const vertices = mesh.geometry.getAttribute("position");
        let clearance = Infinity, overlappingSamples = 0;
        for (let i = 0; i < vertices.count; i++) {
          point.fromBufferAttribute(vertices, i).applyMatrix4(mesh.matrixWorld).applyMatrix4(instrumentInverse);
          for (const solid of solids) {
            if (point.x < solid.bounds.min.x || point.x > solid.bounds.max.x ||
              point.y < solid.bounds.min.y || point.y > solid.bounds.max.y) continue;
            ray.set(new THREE.Vector3(point.x, point.y, -1), direction);
            const hits = ray.intersectObject(solid.mesh, false);
            if (!hits.length) continue;
            // Instrument +Z faces outward; its first ray hit is the rear
            // surface that must remain in front of the sampled hoodie point.
            clearance = Math.min(clearance, hits[0].point.z - point.z);
            overlappingSamples++;
          }
        }
        expect(overlappingSamples, name).toBeGreaterThan(0);
        expect(clearance, `${name} to actual bass rear surface`).toBeGreaterThan(0.003);
      }
      for (const fret of [3, BASS_REST_FRET]) for (const beat of [0, 0.25, 0.5, 0.75, 1]) for (const pluck of [0, 1]) for (const slap of [0, 0.5, 1]) {
        pose({ lift: 1, pluck, slap, playing: true, beat, string: Math.floor(beat * 4) % 4, fret, fretting: true });
        const instrumentInverse = garden.instrument.matrixWorld.clone().invert();
        let penetratingVertices = 0;
        const intersections = new Map<string, number>();
        for (const mesh of [...armSurfaces(), ...fingers]) {
          const vertices = mesh.geometry.getAttribute("position");
          for (let i = 0; i < vertices.count; i++) {
            point.fromBufferAttribute(vertices, i).applyMatrix4(mesh.matrixWorld).applyMatrix4(instrumentInverse);
            for (const solid of solids) {
              if (!solid.bounds.containsPoint(point)) continue;
              ray.set(new THREE.Vector3(point.x, point.y, -1), direction);
              const hits = ray.intersectObject(solid.mesh, false);
              if (hits.length < 2) continue;
              const first = Math.min(...hits.map((hit) => hit.point.z));
              const last = Math.max(...hits.map((hit) => hit.point.z));
              if (point.z > first + 0.00001 && point.z < last - 0.00001) {
                penetratingVertices++;
                const key = `${mesh.parent?.name}/${mesh.name} in ${solid.name}`;
                intersections.set(key, (intersections.get(key) ?? 0) + 1);
              }
            }
          }
        }
        expect(penetratingVertices, JSON.stringify({ fret, beat, pluck, slap,
          intersections: Object.fromEntries(intersections) })).toBe(0);
        if (fret === BASS_REST_FRET && beat === 0 && pluck === 0 && slap < 1) {
          // Clear vertices alone are insufficient: a sleeve triangle can
          // still cut from the back of the wooden bout through its front.
          const vertices = pickingSleeve.geometry.getAttribute("position");
          const transform = instrumentInverse.clone().multiply(pickingSleeve.matrixWorld);
          const edgeRay = new THREE.Raycaster(), a = new THREE.Vector3(), b = new THREE.Vector3();
          const edgeBounds = new THREE.Box3(), wood = solids[0];
          for (const [from, to] of edges.values()) {
            a.fromBufferAttribute(vertices, from).applyMatrix4(transform);
            b.fromBufferAttribute(vertices, to).applyMatrix4(transform);
            edgeBounds.setFromPoints([a, b]);
            const length = a.distanceTo(b);
            if (length < 1e-6 || !edgeBounds.intersectsBox(wood.bounds)) continue;
            edgeRay.set(a, b.clone().sub(a).divideScalar(length));
            edgeRay.near = 1e-6;
            edgeRay.far = length - 1e-6;
            const hits = edgeRay.intersectObject(wood.mesh, false);
            const traversed = hits.length < 2 ? 0 : hits[hits.length - 1].distance - hits[0].distance;
            expect(traversed, `sleeve edge ${from}-${to}, slap=${slap}`).toBeLessThan(1e-5);
          }
        }
      }
    } finally { inspectionMaterial.dispose(); }
  }, 30_000);
});
