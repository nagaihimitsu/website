import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createRoomTargeting, createTargetAim, firstVisibleHit, portalAt } from "../src/room/targeting";
import type { RoomDestination, RoomPortal } from "../src/room/types";

function portal(destination: RoomDestination, object = new THREE.Group()): RoomPortal {
  return { destination, object, anchor: new THREE.Vector3(), lookAt: new THREE.Vector3() };
}
function hit(object: THREE.Object3D): THREE.Intersection {
  return { object, distance: 1, point: new THREE.Vector3() };
}

describe("room target selection", () => {
  it("holds an external target across the canvas gap and HUD, then releases on exit", () => {
    const aim = createTargetAim();
    const point = new THREE.Vector2(0.4, -0.6);
    aim.hover(portal("instagram"), point);
    point.set(1, 1); // Selection owns its coordinates rather than the mutable pointer.
    aim.hover(undefined, point);
    expect(aim.point.toArray()).toEqual([0.4, -0.6]);
    aim.leaveCanvas();
    aim.setTargetHovered(true);
    expect(aim.point.toArray()).toEqual([0.4, -0.6]);
    aim.setTargetHovered(false);
    expect(aim.point.toArray()).toEqual([0, 0]);
  });

  it("returns to center aiming after movement, drag, another collection or leaving the room", () => {
    const aim = createTargetAim();
    const point = new THREE.Vector2(0.5, 0.5);
    for (const reset of [
      () => aim.clear(),
      () => aim.hover(portal("world"), point),
      () => aim.leaveCanvas(),
    ]) {
      aim.hover(portal("instagram"), point);
      reset();
      expect(aim.point.toArray()).toEqual([0, 0]);
    }
  });

  it("matches nested objects by ownership, not arbitrary userData strings", () => {
    const target = portal("world");
    const nested = new THREE.Group();
    target.object.add(nested);
    const unrelated = new THREE.Group();
    unrelated.userData.section = "world";
    expect(portalAt(hit(nested), [target])).toBe(target);
    expect(portalAt(hit(unrelated), [target])).toBeUndefined();
  });

  it("filters hidden and ignored ancestors and includes transparent hit areas only for interaction", () => {
    const hidden = new THREE.Group();
    hidden.visible = false;
    const hiddenChild = new THREE.Mesh();
    hidden.add(hiddenChild);
    const ignored = new THREE.Group();
    ignored.userData.roomRaycastIgnore = true;
    const ignoredChild = new THREE.Mesh();
    ignored.add(ignoredChild);
    const hitArea = new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0 }));
    hitArea.userData.roomHitTarget = true;
    const solid = new THREE.Mesh();
    const hits = [hiddenChild, ignoredChild, hitArea, solid].map(hit);
    expect(firstVisibleHit(hits)?.object).toBe(solid);
    expect(firstVisibleHit(hits, true)?.object).toBe(hitArea);
    hitArea.material.visible = false;
    expect(firstVisibleHit(hits, true)?.object).toBe(solid);
  });

  it("uses the same occluded ray for pointer clicks and the center/E target", () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 20);
    camera.position.z = 4;
    camera.updateMatrixWorld();
    const target = portal("world");
    target.object.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()));
    scene.add(target.object);
    scene.updateMatrixWorld();
    const targeting = createRoomTargeting({ scene, camera, ignoredRoots: [camera], portals: [target],
      canvas: { getBoundingClientRect: () => ({ left: 10, top: 20, width: 200, height: 200 } as DOMRect) },
    });
    expect(targeting.current()).toBe(target);
    expect(targeting.atPointer({ clientX: 110, clientY: 120 })).toBe(target);
    const wall = new THREE.Mesh(new THREE.BoxGeometry(3, 3, 0.2), new THREE.MeshBasicMaterial());
    wall.position.z = 2;
    scene.add(wall);
    scene.updateMatrixWorld();
    expect(targeting.current()).toBeUndefined();
    expect(targeting.atPointer({ clientX: 110, clientY: 120 })).toBeUndefined();
    wall.visible = false;
    expect(targeting.current()).toBe(target);
  });
});
