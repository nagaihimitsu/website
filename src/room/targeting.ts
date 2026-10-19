import * as THREE from "three";
import { roomDestinations } from "./destinations";
import type { RoomPortal } from "./types";

/** Shared visibility rules for interactions, the camera boom and punches. */
export function firstVisibleHit(
  hits: THREE.Intersection[],
  includeHitAreas = false,
) {
  for (const hit of hits) {
    let visible = true;
    for (
      let ancestor: THREE.Object3D | null = hit.object;
      ancestor;
      ancestor = ancestor.parent
    ) {
      if (!ancestor.visible || ancestor.userData.roomRaycastIgnore) {
        visible = false;
        break;
      }
    }
    if (!visible) continue;
    if (hit.object instanceof THREE.Mesh) {
      const material = Array.isArray(hit.object.material)
        ? hit.object.material[hit.face?.materialIndex ?? 0]
        : hit.object.material;
      if (
        material &&
        (!material.visible ||
          (material.transparent && material.opacity === 0 &&
            !(includeHitAreas && hit.object.userData.roomHitTarget)))
      ) continue;
    }
    return hit;
  }
}

export function portalAt(
  hit: THREE.Intersection | undefined,
  portals: RoomPortal[],
) {
  for (
    let object: THREE.Object3D | null = hit?.object ?? null;
    object;
    object = object.parent
  ) {
    const portal = portals.find((candidate) => candidate.object === object);
    if (portal) return portal;
  }
}

/** Retains the external target while crossing the canvas to its native link. */
export function createTargetAim() {
  const center = new THREE.Vector2();
  let mouse: THREE.Vector2 | null = null;
  let hudActive = false;
  let canvasExited = false;
  const clear = () => {
    mouse = null;
  };
  return {
    get point() {
      if (canvasExited && !hudActive) clear();
      return mouse ?? center;
    },
    clear,
    hover(portal: RoomPortal | undefined, point: THREE.Vector2) {
      canvasExited = false;
      if (!portal) return;
      mouse = roomDestinations[portal.destination].kind === "external"
        ? point.clone()
        : null;
    },
    setTargetHovered(active: boolean) {
      if (hudActive && !active) clear();
      hudActive = active;
    },
    leaveCanvas() {
      // Resolve on the next aim sample, after React reports HUD pointer/focus
      // ownership. The engine does not need to inspect the overlay's DOM/CSS.
      canvasExited = true;
    },
  };
}

export function createRoomTargeting(options: {
  scene: THREE.Scene;
  camera: THREE.Camera;
  ignoredRoots: THREE.Object3D[];
  canvas: Pick<HTMLCanvasElement, "getBoundingClientRect">;
  portals: RoomPortal[];
}) {
  const aim = createTargetAim();
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const roots = () =>
    options.scene.children.filter(
      (object) =>
        !options.ignoredRoots.includes(object) && !object.userData.roomRaycastIgnore,
    );
  const at = (point: THREE.Vector2) => {
    raycaster.setFromCamera(point, options.camera);
    raycaster.far = 60;
    return portalAt(
      firstVisibleHit(raycaster.intersectObjects(roots(), true), true),
      options.portals,
    );
  };
  const atPointer = (event: Pick<PointerEvent, "clientX" | "clientY">) => {
    const bounds = options.canvas.getBoundingClientRect();
    pointer.set(
      ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
      1 - ((event.clientY - bounds.top) / bounds.height) * 2,
    );
    return at(pointer);
  };
  return {
    roots,
    current: () => at(aim.point),
    atPointer,
    hoverPointer(event: Pick<PointerEvent, "clientX" | "clientY">) {
      const portal = atPointer(event);
      aim.hover(portal, pointer);
      return portal;
    },
    clear: aim.clear,
    setTargetHovered: aim.setTargetHovered,
    leaveCanvas: aim.leaveCanvas,
  };
}
