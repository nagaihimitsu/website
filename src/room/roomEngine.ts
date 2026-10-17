import * as THREE from "three";
import { createRoomScene } from "./roomScene";
import {
  movementVector,
  positionIsClear,
  sampleJump,
  walkStep,
} from "./movement";
import type {
  Direction,
  RoomEngine,
  RoomEngineOptions,
  RoomPortal,
} from "./types";
import type { Section } from "../data/model";

const STORAGE_KEY = "personal-atlas-room-position-v1";
const KEY_DIRECTIONS: Record<string, Direction> = {
  ArrowUp: "up",
  KeyW: "up",
  ArrowDown: "down",
  KeyS: "down",
  ArrowLeft: "left",
  KeyA: "left",
  ArrowRight: "right",
  KeyD: "right",
};
const CAMERA_OFFSET = new THREE.Vector3(11, 10, 13);
// Center the architecture vertically: floor -0.45 through top wall 4.7.
const CENTER = new THREE.Vector3(0, 2.1, 0);

function isEditable(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    Boolean(target.closest('input, textarea, select, [contenteditable="true"]'))
  );
}

export function createRoomEngine(options: RoomEngineOptions): RoomEngine {
  const { host } = options;
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false,
    powerPreference: "high-performance",
  });
  let room: ReturnType<typeof createRoomScene>;
  try {
    room = createRoomScene(options.archive);
  } catch (error) {
    renderer.dispose();
    renderer.forceContextLoss();
    throw error;
  }
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.setClearColor("#eeeae1");
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  // The room's architecture is static. Rebuild its shadow map only while a
  // moving visitor or an interactive object actually changes the silhouette.
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;
  const shadowLights: THREE.DirectionalLight[] = [];
  room.scene.traverse((object) => {
    if (object instanceof THREE.DirectionalLight && object.castShadow)
      shadowLights.push(object);
  });
  renderer.domElement.setAttribute("aria-hidden", "true");
  renderer.domElement.style.touchAction = "none";
  host.append(renderer.domElement);

  const camera = new THREE.OrthographicCamera(-8, 8, 6, -6, 0.1, 70);
  const lookAt = CENTER.clone();
  camera.position.copy(CENTER).add(CAMERA_OFFSET);
  camera.lookAt(lookAt);
  camera.updateMatrixWorld();
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const keyboard = new Set<string>();
  const pad = new Set<Direction>();
  const pointerStart = new Map<number, { x: number; y: number }>();
  let reducedMotion = options.reducedMotion;
  let disposed = false;
  let failed = false;
  let ready = false;
  let frame = 0;
  let previousTime = performance.now();
  let animationTime = 0;
  let projectTime = -Infinity;
  let snapshotTime = -Infinity;
  let pointerSampleTime = -Infinity;
  let shadowDynamicUntil = 0;
  let previousMoving = false;
  let previousJumpHeight = 0;
  let previousYaw = room.avatar.rotation.y;
  let width = 1;
  let height = 1;
  let jumpStartedAt: number | null = null;
  let hiddenStartedAt: number | null = document.hidden
    ? performance.now()
    : null;
  let jumpHeight = 0;
  let hovered: Section | null = null;
  let opening: {
    portal: RoomPortal;
    started: number;
    from: THREE.Vector3;
    zoom: number;
  } | null = null;
  let opened = false;
  const groundY = room.avatar.position.y;

  try {
    const serialized = sessionStorage.getItem(STORAGE_KEY);
    if (serialized) {
      const saved: unknown = JSON.parse(serialized);
      if (
        typeof saved === "object" &&
        saved !== null &&
        "x" in saved &&
        "z" in saved &&
        "yaw" in saved &&
        typeof saved.x === "number" &&
        typeof saved.z === "number" &&
        typeof saved.yaw === "number" &&
        Number.isFinite(saved.yaw) &&
        positionIsClear(saved.x, saved.z, room.obstacles)
      ) {
        room.avatar.position.set(saved.x, groundY, saved.z);
        room.avatar.rotation.y = saved.yaw % (2 * Math.PI);
      }
    }
  } catch {
    /* Storage is optional (private browsing and disabled cookies). */
  }

  function savePosition() {
    try {
      sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          x: room.avatar.position.x,
          z: room.avatar.position.z,
          yaw: room.avatar.rotation.y,
        }),
      );
    } catch {
      /* The room remains usable without storage. */
    }
  }

  function clearInputs() {
    keyboard.clear();
    pad.clear();
    pointerStart.clear();
  }

  function setHovered(section: Section | null) {
    if (hovered === section) return;
    hovered = section;
    shadowDynamicUntil = performance.now() + 800;
    for (const portal of room.portals)
      portal.object.userData.active = portal.section === section;
    renderer.domElement.style.cursor = section ? "pointer" : "";
    options.onHover(section);
  }

  function resize() {
    if (disposed) return;
    const bounds = host.getBoundingClientRect();
    width = Math.max(1, bounds.width);
    height = Math.max(1, bounds.height);
    renderer.setPixelRatio(
      Math.min(window.devicePixelRatio || 1, width < 700 ? 1.25 : 1.5),
    );
    renderer.setSize(width, height);
    const shadowResolution = width < 700 ? 1024 : 2048;
    for (const light of shadowLights) {
      if (light.shadow.mapSize.x !== shadowResolution) {
        light.shadow.mapSize.set(shadowResolution, shadowResolution);
        light.shadow.map?.dispose();
        light.shadow.map = null;
      }
    }
    renderer.shadowMap.needsUpdate = true;
    const aspect = width / height;
    // Fit the complete room, including the top of the back wall, at every aspect ratio.
    const baselineCamera = camera.clone();
    baselineCamera.position.copy(CENTER).add(CAMERA_OFFSET);
    baselineCamera.lookAt(CENTER);
    baselineCamera.updateMatrixWorld();
    let projectedWidth = 0;
    let projectedHeight = 0;
    for (const x of [-5.1, 5.1])
      for (const y of [-0.45, 4.7])
        for (const z of [-4.1, 4.1]) {
          const point = new THREE.Vector3(x, y, z).applyMatrix4(
            baselineCamera.matrixWorldInverse,
          );
          projectedWidth = Math.max(projectedWidth, Math.abs(point.x));
          projectedHeight = Math.max(projectedHeight, Math.abs(point.y));
        }
    const halfHeight =
      Math.max(projectedHeight, projectedWidth / aspect) * 1.055;
    camera.left = -halfHeight * aspect;
    camera.right = halfHeight * aspect;
    camera.top = halfHeight;
    camera.bottom = -halfHeight;
    camera.updateProjectionMatrix();
    projectTime = -Infinity;
  }

  function pick(event: PointerEvent): RoomPortal | undefined {
    const bounds = renderer.domElement.getBoundingClientRect();
    pointer.set(
      ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
      (-(event.clientY - bounds.top) / bounds.height) * 2 + 1,
    );
    raycaster.setFromCamera(pointer, camera);
    // A piece of furniture in front of a portal must remain an obstruction.
    // Raycasting only portal meshes would make hidden objects clickable through walls.
    const hits = raycaster.intersectObjects(room.scene.children, true);
    for (const hit of hits) {
      let visible = true;
      for (
        let ancestor: THREE.Object3D | null = hit.object;
        ancestor;
        ancestor = ancestor.parent
      ) {
        if (!ancestor.visible) {
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
            (material.transparent &&
              material.opacity === 0 &&
              !hit.object.userData.roomHitTarget))
        )
          continue;
      }
      let object: THREE.Object3D | null = hit.object;
      while (object) {
        const match = room.portals.find(
          (portal) =>
            portal.object === object ||
            portal.section === object?.userData.section,
        );
        if (match) return match;
        object = object.parent;
      }
      return undefined;
    }
  }

  function open(section: Section) {
    if (disposed || failed || opening || opened) return;
    const portal = room.portals.find(
      (candidate) => candidate.section === section,
    );
    if (!portal) return;
    options.onOpening(section);
    clearInputs();
    savePosition();
    setHovered(section);
    if (reducedMotion) {
      opened = true;
      options.onOpen(section);
      return;
    }
    shadowDynamicUntil = performance.now() + 800;
    opening = {
      portal,
      started: performance.now(),
      from: lookAt.clone(),
      zoom: camera.zoom,
    };
  }

  function jump() {
    if (
      disposed ||
      failed ||
      opening ||
      opened ||
      document.hidden ||
      jumpStartedAt !== null
    )
      return;
    jumpStartedAt = performance.now();
  }

  function keyDown(event: KeyboardEvent) {
    if (
      isEditable(event.target) ||
      (event.target instanceof HTMLElement &&
        event.target.closest("button, a")) ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      disposed ||
      failed ||
      opening ||
      opened
    )
      return;
    if (KEY_DIRECTIONS[event.code]) {
      event.preventDefault();
      keyboard.add(event.code);
    } else if (
      event.code === "Space" &&
      !(
        event.target instanceof HTMLElement && event.target.closest("button, a")
      )
    ) {
      event.preventDefault();
      if (!event.repeat) jump();
    }
  }

  function keyUp(event: KeyboardEvent) {
    keyboard.delete(event.code);
  }

  function pointerDown(event: PointerEvent) {
    if (event.button !== 0) return;
    pointerStart.set(event.pointerId, { x: event.clientX, y: event.clientY });
  }

  function pointerMove(event: PointerEvent) {
    if (opening || opened) return;
    const now = performance.now();
    if (now - pointerSampleTime < 24) return;
    pointerSampleTime = now;
    setHovered(pick(event)?.section ?? null);
  }

  function pointerUp(event: PointerEvent) {
    const start = pointerStart.get(event.pointerId);
    pointerStart.delete(event.pointerId);
    if (
      !start ||
      Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10
    )
      return;
    const portal = pick(event);
    if (portal) open(portal.section);
  }

  function pointerLeave() {
    pointerStart.clear();
    if (!opening) setHovered(null);
  }

  function fail() {
    if (disposed || failed) return;
    failed = true;
    clearInputs();
    cancelAnimationFrame(frame);
    options.onError();
  }

  function contextLost(event: Event) {
    event.preventDefault();
    fail();
  }

  function visibilityChanged() {
    clearInputs();
    if (document.hidden) {
      hiddenStartedAt = performance.now();
      cancelAnimationFrame(frame);
      savePosition();
    } else if (!disposed && !failed) {
      const now = performance.now();
      const paused = hiddenStartedAt === null ? 0 : now - hiddenStartedAt;
      if (jumpStartedAt !== null) jumpStartedAt += paused;
      if (opening) opening.started += paused;
      shadowDynamicUntil += paused;
      hiddenStartedAt = null;
      previousTime = now;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(render);
    }
  }

  function render(time: number) {
    if (disposed || failed || document.hidden) return;
    const elapsed = Math.max((time - previousTime) / 1000, 0);
    // Bound locomotion catch-up, while essential animation durations remain real-time.
    // The collision helper subdivides this displacement to prevent tunneling.
    const delta = Math.min(elapsed, 0.25);
    previousTime = time;
    animationTime += elapsed;
    const directions = new Set(pad);
    for (const code of keyboard) directions.add(KEY_DIRECTIONS[code]);
    const vector = movementVector(directions);
    const oldX = room.avatar.position.x;
    const oldZ = room.avatar.position.z;
    if (!opening && !opened) {
      const next = walkStep(
        { x: oldX, z: oldZ },
        { x: vector.x * 2.3 * delta, z: vector.z * 2.3 * delta },
        room.obstacles,
      );
      room.avatar.position.x = next.x;
      room.avatar.position.z = next.z;
      if (vector.x || vector.z) {
        const desiredYaw = Math.atan2(vector.x, vector.z);
        const difference = Math.atan2(
          Math.sin(desiredYaw - room.avatar.rotation.y),
          Math.cos(desiredYaw - room.avatar.rotation.y),
        );
        room.avatar.rotation.y += difference * Math.min(1, delta * 14);
      }
    }
    if (jumpStartedAt !== null) {
      const airborneTime = Math.max(0, (time - jumpStartedAt) / 1000);
      const sample = sampleJump(airborneTime);
      jumpHeight = sample.height;
      if (sample.landed) jumpStartedAt = null;
    }
    room.avatar.position.y = groundY + jumpHeight;
    const moving =
      Math.hypot(room.avatar.position.x - oldX, room.avatar.position.z - oldZ) >
      0.0001;

    if (opening) {
      const progress = Math.min(1, (time - opening.started) / 650);
      const eased = progress * progress * (3 - 2 * progress);
      lookAt.lerpVectors(opening.from, opening.portal.lookAt, eased);
      camera.zoom = THREE.MathUtils.lerp(
        opening.zoom,
        opening.portal.section === "pokemon" ? 3 : 1.85,
        eased,
      );
      camera.updateProjectionMatrix();
      if (progress === 1 && !opened) {
        opened = true;
        const section = opening.portal.section;
        options.onOpen(section);
        if (disposed) return;
      }
    } else if (!reducedMotion) {
      const destination = CENTER.clone().add(
        new THREE.Vector3(
          room.avatar.position.x * 0.055,
          0,
          room.avatar.position.z * 0.055,
        ),
      );
      lookAt.lerp(destination, 1 - Math.exp(-elapsed * 2.8));
      if (lookAt.distanceToSquared(destination) < 0.00000625)
        lookAt.copy(destination);
    } else {
      lookAt.copy(CENTER);
    }
    camera.position.copy(lookAt).add(CAMERA_OFFSET);
    camera.lookAt(lookAt);
    camera.updateMatrixWorld();
    try {
      room.animate(animationTime, moving, reducedMotion);
      // Portal and avatar matrices must be fresh for both projection and pointer picking.
      room.scene.updateMatrixWorld();
      renderer.shadowMap.needsUpdate =
        renderer.shadowMap.needsUpdate ||
        moving ||
        previousMoving ||
        jumpHeight > 0 ||
        previousJumpHeight > 0 ||
        time < shadowDynamicUntil ||
        Math.abs(room.avatar.rotation.y - previousYaw) > 0.0001;
      renderer.render(room.scene, camera);
      previousMoving = moving;
      previousJumpHeight = jumpHeight;
      previousYaw = room.avatar.rotation.y;
    } catch {
      fail();
      return;
    }
    if (!ready) {
      ready = true;
      options.onReady();
    }
    if (time - projectTime >= 50) {
      projectTime = time;
      options.onProject(
        room.portals.map((portal) => {
          const projected = portal.anchor.clone().project(camera);
          return {
            section: portal.section,
            x: Math.round((projected.x + 1) * width) / 2,
            y: Math.round((1 - projected.y) * height) / 2,
            visible:
              Math.abs(projected.x) <= 1 &&
              Math.abs(projected.y) <= 1 &&
              projected.z >= -1 &&
              projected.z <= 1,
          };
        }),
      );
    }
    if (time - snapshotTime >= 100) {
      snapshotTime = time;
      options.onSnapshot({
        x: room.avatar.position.x,
        z: room.avatar.position.z,
        height: jumpHeight,
        moving,
      });
    }
    frame = requestAnimationFrame(render);
  }

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(host);
  window.addEventListener("keydown", keyDown);
  window.addEventListener("keyup", keyUp);
  window.addEventListener("blur", clearInputs);
  document.addEventListener("visibilitychange", visibilityChanged);
  renderer.domElement.addEventListener("pointerdown", pointerDown);
  renderer.domElement.addEventListener("pointermove", pointerMove);
  renderer.domElement.addEventListener("pointerup", pointerUp);
  renderer.domElement.addEventListener("pointerleave", pointerLeave);
  renderer.domElement.addEventListener("pointercancel", pointerLeave);
  renderer.domElement.addEventListener("webglcontextlost", contextLost);
  resize();
  options.onSnapshot({
    x: room.avatar.position.x,
    z: room.avatar.position.z,
    height: 0,
    moving: false,
  });
  frame = requestAnimationFrame(render);

  return {
    direction(direction, pressed) {
      if (disposed || failed || opening || opened) return;
      if (pressed) pad.add(direction);
      else pad.delete(direction);
    },
    jump,
    open,
    setReducedMotion(value) {
      reducedMotion = value;
      if (value && opening && !opened) {
        opened = true;
        options.onOpen(opening.portal.section);
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      savePosition();
      clearInputs();
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      window.removeEventListener("keydown", keyDown);
      window.removeEventListener("keyup", keyUp);
      window.removeEventListener("blur", clearInputs);
      document.removeEventListener("visibilitychange", visibilityChanged);
      renderer.domElement.removeEventListener("pointerdown", pointerDown);
      renderer.domElement.removeEventListener("pointermove", pointerMove);
      renderer.domElement.removeEventListener("pointerup", pointerUp);
      renderer.domElement.removeEventListener("pointerleave", pointerLeave);
      renderer.domElement.removeEventListener("pointercancel", pointerLeave);
      renderer.domElement.removeEventListener("webglcontextlost", contextLost);
      room.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    },
  };
}
