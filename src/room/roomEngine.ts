import * as THREE from "three";
import { createRoomScene } from "./roomScene";
import {
  createPlayer,
  movementVector,
  positionIsClear,
  stepPlayer,
  validatePlayerPosition,
} from "./movement";
import type {
  Direction,
  RoomEngine,
  RoomEngineOptions,
  RoomPortal,
} from "./types";
import type { Section } from "../data/model";

const STORAGE_KEY = "personal-atlas-room-position-v2";
const EYE_HEIGHT = 1.5;
const DESKTOP_FIELD_OF_VIEW = 68;
const PORTRAIT_FIELD_OF_VIEW = 86;
const PUNCH_DURATION = 420;
const PUNCH_IMPACT = 125;
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

function capturesKeyboard(target: EventTarget | null) {
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
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;
  const shadowLights: THREE.DirectionalLight[] = [];
  room.scene.traverse((object) => {
    if (object instanceof THREE.DirectionalLight && object.castShadow)
      shadowLights.push(object);
  });
  const canvas = renderer.domElement;
  canvas.tabIndex = 0;
  canvas.setAttribute(
    "aria-label",
    "部屋の3D表示。ドラッグで見回す、矢印キーで移動。",
  );
  canvas.style.touchAction = "none";
  host.append(canvas);

  const camera = new THREE.PerspectiveCamera(
    DESKTOP_FIELD_OF_VIEW,
    1,
    0.035,
    60,
  );
  camera.rotation.order = "YXZ";
  room.scene.add(camera);
  room.avatar.visible = false;

  // Original, deliberately simple view model: a sleeve, fist and four knuckles.
  const hand = new THREE.Group();
  hand.userData.roomRaycastIgnore = true;
  const handGeometries: THREE.BufferGeometry[] = [];
  const skin = new THREE.MeshStandardMaterial({
    color: "#c9a481",
    roughness: 0.85,
    depthTest: false,
    depthWrite: false,
  });
  const sleeve = new THREE.MeshStandardMaterial({
    color: "#687c73",
    roughness: 0.95,
    depthTest: false,
    depthWrite: false,
  });
  const handMesh = (
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
  ) => {
    handGeometries.push(geometry);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = 20;
    hand.add(mesh);
    return mesh;
  };
  const arm = handMesh(
    new THREE.CylinderGeometry(0.078, 0.105, 0.28, 12),
    sleeve,
  );
  arm.rotation.x = Math.PI / 2;
  arm.position.set(0, -0.035, 0.18);
  const fist = handMesh(new THREE.SphereGeometry(0.095, 12, 10), skin);
  fist.scale.set(1, 0.82, 1.18);
  for (const x of [-0.057, -0.019, 0.019, 0.057]) {
    const knuckle = handMesh(new THREE.SphereGeometry(0.026, 8, 6), skin);
    knuckle.position.set(x, 0.03, -0.068);
  }
  camera.add(hand);

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const centerPointer = new THREE.Vector2();
  const keyboard = new Set<string>();
  const pad = new Set<Direction>();
  let player = createPlayer(0.95, 3.05);
  let yaw = 0;
  let pitch = -0.04;
  let reducedMotion = options.reducedMotion;
  let paused = false;
  let disposed = false;
  let failed = false;
  let ready = false;
  let frame = 0;
  let previousTime = performance.now();
  let animationTime = 0;
  let snapshotTime = -Infinity;
  let aimTime = -Infinity;
  let shadowDynamicUntil = 0;
  let width = 1;
  let height = 1;
  let jumpRequested = false;
  let suspensionStarted: number | null = document.hidden
    ? performance.now()
    : null;
  let hovered: Section | null = null;
  let punchStarted: number | null = null;
  let punchImpacted = false;
  let viewPointer: {
    id: number;
    startX: number;
    startY: number;
    x: number;
    y: number;
    moved: boolean;
  } | null = null;
  let opening: {
    portal: RoomPortal;
    started: number;
    from: THREE.Vector3;
    to: THREE.Vector3;
    rotation: THREE.Quaternion;
    targetRotation: THREE.Quaternion;
    fov: number;
  } | null = null;
  let opened = false;

  try {
    const serialized = sessionStorage.getItem(STORAGE_KEY);
    if (serialized) {
      const saved: unknown = JSON.parse(serialized);
      if (typeof saved === "object" && saved !== null) {
        if ("brokenIds" in saved && Array.isArray(saved.brokenIds)) {
          for (const id of saved.brokenIds) {
            if (
              typeof id === "string" &&
              room.breakables.some((item) => item.id === id)
            ) {
              room.breakObject(id, new THREE.Vector3());
              shadowDynamicUntil = performance.now() + 2500;
            }
          }
        }
        const restored = validatePlayerPosition(saved, room.obstacles);
        if (restored) {
          player = restored;
          if (
            "yaw" in saved &&
            typeof saved.yaw === "number" &&
            Number.isFinite(saved.yaw)
          )
            yaw = saved.yaw % (2 * Math.PI);
          if (
            "pitch" in saved &&
            typeof saved.pitch === "number" &&
            Number.isFinite(saved.pitch)
          )
            pitch = THREE.MathUtils.clamp(saved.pitch, -1.18, 1.18);
        }
      }
    }
  } catch {
    /* Storage is optional; a fresh room remains fully usable. */
  }

  function savePosition() {
    try {
      sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          x: player.x,
          y: player.y,
          z: player.z,
          yaw,
          pitch,
          brokenIds: room.breakables
            .filter((item) => item.broken)
            .map((item) => item.id),
        }),
      );
    } catch {
      /* Private browsing can disable storage. */
    }
  }

  function releaseViewPointer() {
    if (viewPointer && canvas.hasPointerCapture(viewPointer.id))
      canvas.releasePointerCapture(viewPointer.id);
    viewPointer = null;
  }

  function clearInputs() {
    keyboard.clear();
    pad.clear();
    jumpRequested = false;
    releaseViewPointer();
  }

  function setHovered(section: Section | null) {
    if (hovered === section) return;
    hovered = section;
    shadowDynamicUntil = performance.now() + 800;
    for (const portal of room.portals)
      portal.object.userData.active = portal.section === section;
    options.onHover(section);
  }

  function snapshot(moving = false) {
    options.onSnapshot({
      x: player.x,
      z: player.z,
      height: player.y,
      moving,
      grounded: player.grounded,
      supportId: player.supportId,
      yaw,
      pitch,
      punching: punchStarted !== null,
      brokenCount: room.breakables.filter((item) => item.broken).length,
    });
  }

  function baseFov() {
    return camera.aspect < 0.8 ? PORTRAIT_FIELD_OF_VIEW : DESKTOP_FIELD_OF_VIEW;
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
    camera.aspect = width / height;
    if (!opening && !opened) camera.fov = baseFov();
    camera.updateProjectionMatrix();
    const resolution = width < 700 ? 1024 : 2048;
    for (const light of shadowLights) {
      if (light.shadow.mapSize.x !== resolution) {
        light.shadow.mapSize.set(resolution, resolution);
        light.shadow.map?.dispose();
        light.shadow.map = null;
      }
    }
    renderer.shadowMap.needsUpdate = true;
  }

  function visibleHit(
    ndc: THREE.Vector2,
    reach = 60,
    includeHitAreas = true,
  ): THREE.Intersection | undefined {
    raycaster.setFromCamera(ndc, camera);
    raycaster.far = reach;
    const hits = raycaster.intersectObjects(room.scene.children, true);
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
            (material.transparent &&
              material.opacity === 0 &&
              !(includeHitAreas && hit.object.userData.roomHitTarget)))
        )
          continue;
      }
      return hit;
    }
  }

  function portalAt(hit: THREE.Intersection | undefined) {
    for (
      let object: THREE.Object3D | null = hit?.object ?? null;
      object;
      object = object.parent
    ) {
      const portal = room.portals.find(
        (candidate) =>
          candidate.object === object ||
          candidate.section === object?.userData.section,
      );
      if (portal) return portal;
    }
  }

  function pointerHit(event: PointerEvent) {
    const bounds = canvas.getBoundingClientRect();
    pointer.set(
      ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
      1 - ((event.clientY - bounds.top) / bounds.height) * 2,
    );
    return visibleHit(pointer);
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
    const direction = portal.lookAt.clone().sub(camera.position);
    const distance = direction.length();
    const destination = camera.position
      .clone()
      .addScaledVector(direction.normalize(), Math.min(distance * 0.12, 0.55));
    const rotation = new THREE.Quaternion().setFromRotationMatrix(
      new THREE.Matrix4().lookAt(destination, portal.lookAt, camera.up),
    );
    opening = {
      portal,
      started: performance.now(),
      from: camera.position.clone(),
      to: destination,
      rotation: camera.quaternion.clone(),
      targetRotation: rotation,
      fov: camera.fov,
    };
    shadowDynamicUntil = performance.now() + 800;
  }

  function jump() {
    if (
      disposed ||
      failed ||
      paused ||
      document.hidden ||
      opening ||
      opened ||
      !player.grounded
    )
      return;
    jumpRequested = true;
  }

  function punch() {
    if (
      disposed ||
      failed ||
      paused ||
      document.hidden ||
      opening ||
      opened ||
      punchStarted !== null
    )
      return;
    punchStarted = performance.now();
    punchImpacted = false;
    snapshot();
  }

  function strike() {
    const hit = visibleHit(centerPointer, 2, false);
    for (
      let object: THREE.Object3D | null = hit?.object ?? null;
      object;
      object = object.parent
    ) {
      const id: unknown = object.userData.breakableId;
      if (typeof id !== "string") continue;
      const item = room.breakables.find(
        (candidate) => candidate.id === id && !candidate.broken,
      );
      if (!item) return;
      const impulse = new THREE.Vector3(0, 0.4, -1)
        .applyQuaternion(camera.quaternion)
        .normalize()
        .multiplyScalar(3);
      if (room.breakObject(id, impulse)) {
        shadowDynamicUntil = performance.now() + 2500;
        options.onBreak(item.label);
        savePosition();
        snapshot();
      }
      return;
    }
  }

  function keyDown(event: KeyboardEvent) {
    if (
      capturesKeyboard(event.target) ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      disposed ||
      failed ||
      paused ||
      opening ||
      opened
    )
      return;
    if (KEY_DIRECTIONS[event.code]) {
      event.preventDefault();
      keyboard.add(event.code);
    } else if (event.code === "Space") {
      // HUD buttons keep native Space activation; locomotion and other game keys
      // continue to work when focus remains on those buttons after a click.
      if (
        event.target instanceof HTMLElement &&
        event.target.closest("button, a")
      )
        return;
      event.preventDefault();
      if (!event.repeat) jump();
    } else if (event.code === "KeyF" || event.code === "KeyJ") {
      event.preventDefault();
      if (!event.repeat) punch();
    } else if (event.code === "KeyE") {
      event.preventDefault();
      if (!event.repeat) {
        const portal = portalAt(visibleHit(centerPointer));
        if (portal) open(portal.section);
      }
    }
  }

  function keyUp(event: KeyboardEvent) {
    keyboard.delete(event.code);
  }

  function pointerDown(event: PointerEvent) {
    if (event.button !== 0 || viewPointer || paused || opening || opened)
      return;
    canvas.focus({ preventScroll: true });
    viewPointer = {
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      moved: false,
    };
    canvas.setPointerCapture(event.pointerId);
  }

  function pointerMove(event: PointerEvent) {
    if (paused || opening || opened) return;
    if (viewPointer?.id === event.pointerId) {
      if (
        Math.hypot(
          event.clientX - viewPointer.startX,
          event.clientY - viewPointer.startY,
        ) > 5
      )
        viewPointer.moved = true;
      if (viewPointer.moved) {
        yaw -= (event.clientX - viewPointer.x) * 0.0042;
        pitch = THREE.MathUtils.clamp(
          pitch - (event.clientY - viewPointer.y) * 0.0036,
          -1.18,
          1.18,
        );
        yaw %= 2 * Math.PI;
        aimTime = -Infinity;
      }
      viewPointer.x = event.clientX;
      viewPointer.y = event.clientY;
    } else if (event.pointerType === "mouse") {
      canvas.style.cursor = portalAt(pointerHit(event)) ? "pointer" : "grab";
    }
  }

  function pointerUp(event: PointerEvent) {
    if (!viewPointer || viewPointer.id !== event.pointerId) return;
    const clicked =
      !viewPointer.moved &&
      Math.hypot(
        event.clientX - viewPointer.startX,
        event.clientY - viewPointer.startY,
      ) <= 8;
    releaseViewPointer();
    if (clicked && !paused) {
      const portal = portalAt(pointerHit(event));
      if (portal) open(portal.section);
    }
  }

  function pointerCancel(event: PointerEvent) {
    if (viewPointer?.id === event.pointerId) releaseViewPointer();
  }

  function pointerLeave() {
    canvas.style.cursor = "";
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

  function syncSuspension() {
    clearInputs();
    if (paused || document.hidden) {
      if (suspensionStarted === null) suspensionStarted = performance.now();
      cancelAnimationFrame(frame);
      savePosition();
      snapshot();
    } else if (!disposed && !failed) {
      const now = performance.now();
      const duration = suspensionStarted === null ? 0 : now - suspensionStarted;
      if (punchStarted !== null) punchStarted += duration;
      if (opening) opening.started += duration;
      shadowDynamicUntil += duration;
      suspensionStarted = null;
      previousTime = now;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(render);
    }
  }

  function setCameraFromPlayer(moving: boolean) {
    const bob =
      !reducedMotion && moving && player.grounded
        ? Math.sin(animationTime * 12) * 0.009
        : 0;
    camera.position.set(player.x, player.y + EYE_HEIGHT + bob, player.z);
    camera.rotation.set(pitch, yaw, 0, "YXZ");
    camera.fov = baseFov();
    camera.updateProjectionMatrix();
  }

  function updateHand(time: number, moving: boolean) {
    let extension = 0;
    if (punchStarted !== null) {
      const elapsed = time - punchStarted;
      if (elapsed >= PUNCH_IMPACT && !punchImpacted) {
        punchImpacted = true;
        strike();
      }
      const phase = Math.min(1, elapsed / PUNCH_DURATION);
      extension =
        phase < 0.3
          ? 1 - (1 - phase / 0.3) ** 3
          : (1 - (phase - 0.3) / 0.7) ** 2;
      if (phase >= 1) punchStarted = null;
    }
    if (reducedMotion) extension = 0.25;
    const baseX = Math.min(
      0.29,
      Math.tan(THREE.MathUtils.degToRad(baseFov() / 2)) *
        camera.aspect *
        0.55 *
        0.72,
    );
    const bob =
      !reducedMotion && moving ? Math.sin(animationTime * 12) * 0.006 : 0;
    hand.position.set(
      baseX * (1 - extension * 0.6),
      -0.31 + extension * 0.17 + bob,
      -0.53 - extension * 0.47,
    );
    hand.rotation.set(-0.12 - extension * 0.12, -0.15, -0.2 + extension * 0.28);
    hand.visible = punchStarted !== null && !opening && !opened;
  }

  function render(time: number) {
    if (disposed || failed || paused || document.hidden) return;
    const elapsed = Math.max((time - previousTime) / 1000, 0);
    previousTime = time;
    animationTime += elapsed;
    const directions = new Set(pad);
    for (const code of keyboard) directions.add(KEY_DIRECTIONS[code]);
    const oldPosition = { x: player.x, y: player.y, z: player.z };
    if (!opening && !opened)
      player = stepPlayer(
        player,
        movementVector(directions, yaw),
        elapsed,
        room.obstacles,
        jumpRequested,
      );
    jumpRequested = false;
    const moving =
      Math.hypot(player.x - oldPosition.x, player.z - oldPosition.z) > 0.0001;
    room.avatar.position.set(player.x, player.y, player.z);
    if (opening) {
      const progress = Math.min(1, (time - opening.started) / 500);
      const eased = progress * progress * (3 - 2 * progress);
      camera.position.lerpVectors(opening.from, opening.to, eased);
      camera.quaternion.slerpQuaternions(
        opening.rotation,
        opening.targetRotation,
        eased,
      );
      camera.fov = THREE.MathUtils.lerp(
        opening.fov,
        opening.portal.section === "pokemon" ? 40 : 52,
        eased,
      );
      camera.updateProjectionMatrix();
      if (progress === 1 && !opened) {
        opened = true;
        options.onOpen(opening.portal.section);
        if (disposed) return;
      }
    } else setCameraFromPlayer(moving);
    camera.updateMatrixWorld();
    try {
      room.animate(animationTime, moving, reducedMotion);
      room.scene.updateMatrixWorld();
      updateHand(time, moving);
      if (time - aimTime >= 100 && !opening && !opened) {
        aimTime = time;
        setHovered(portalAt(visibleHit(centerPointer))?.section ?? null);
      }
      renderer.shadowMap.needsUpdate =
        renderer.shadowMap.needsUpdate || time < shadowDynamicUntil;
      renderer.render(room.scene, camera);
    } catch {
      fail();
      return;
    }
    if (!ready) {
      ready = true;
      options.onReady();
    }
    if (time - snapshotTime >= 100) {
      snapshotTime = time;
      snapshot(moving);
    }
    frame = requestAnimationFrame(render);
  }

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(host);
  window.addEventListener("keydown", keyDown);
  window.addEventListener("keyup", keyUp);
  window.addEventListener("blur", clearInputs);
  document.addEventListener("visibilitychange", syncSuspension);
  canvas.addEventListener("pointerdown", pointerDown);
  canvas.addEventListener("pointermove", pointerMove);
  canvas.addEventListener("pointerup", pointerUp);
  canvas.addEventListener("pointercancel", pointerCancel);
  canvas.addEventListener("lostpointercapture", pointerCancel);
  canvas.addEventListener("pointerleave", pointerLeave);
  canvas.addEventListener("webglcontextlost", contextLost);
  resize();
  setCameraFromPlayer(false);
  camera.updateMatrixWorld();
  snapshot();
  frame = requestAnimationFrame(render);

  return {
    direction(direction, pressed) {
      if (disposed || failed || paused || opening || opened) return;
      if (pressed) pad.add(direction);
      else pad.delete(direction);
    },
    jump,
    punch,
    open,
    resetObjects() {
      if (disposed || failed) return;
      clearInputs();
      punchStarted = null;
      punchImpacted = false;
      hand.visible = false;
      room.resetObjects();
      // A restored prop may occupy the spot the visitor walked into after
      // breaking it. Preserve valid airborne positions, but escape solid overlap.
      if (!positionIsClear(player.x, player.z, room.obstacles, player.y)) {
        player = createPlayer(0.95, 3.05);
        room.avatar.position.set(player.x, player.y, player.z);
        setCameraFromPlayer(false);
        camera.updateMatrixWorld();
        setHovered(null);
        aimTime = -Infinity;
      }
      shadowDynamicUntil = performance.now() + 1000;
      renderer.shadowMap.needsUpdate = true;
      savePosition();
      snapshot();
      if (paused && ready) {
        try {
          room.scene.updateMatrixWorld();
          renderer.render(room.scene, camera);
        } catch {
          fail();
        }
      }
    },
    setPaused(value) {
      if (paused === value || disposed) return;
      paused = value;
      syncSuspension();
    },
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
      document.removeEventListener("visibilitychange", syncSuspension);
      canvas.removeEventListener("pointerdown", pointerDown);
      canvas.removeEventListener("pointermove", pointerMove);
      canvas.removeEventListener("pointerup", pointerUp);
      canvas.removeEventListener("pointercancel", pointerCancel);
      canvas.removeEventListener("lostpointercapture", pointerCancel);
      canvas.removeEventListener("pointerleave", pointerLeave);
      canvas.removeEventListener("webglcontextlost", contextLost);
      camera.remove(hand);
      room.scene.remove(camera);
      handGeometries.forEach((geometry) => geometry.dispose());
      skin.dispose();
      sleeve.dispose();
      room.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    },
  };
}
