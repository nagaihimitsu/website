import * as THREE from "three";
import type { Section } from "../data/model";
import { roomDestinations } from "./destinations";
import { createRoomTargeting, firstVisibleHit } from "./targeting";
import { withDisposalScope, type DisposalScope } from "./disposal";
import { createRoomScene } from "./roomScene";
import { createBirdMotion } from "./birdMotion";
import { worldRecovery } from "./roomArchitecture";
import { findRecoveryPosition } from "./worldRecovery";
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
  RoomDestination,
} from "./types";
import { cameraRelativeInput, smoothLocomotion } from "./locomotion";
import {
  CAMERA_RADIUS,
  DEFAULT_CAMERA_PITCH,
  FOLLOW_DISTANCE,
  FOLLOW_TARGET_HEIGHT,
  INITIAL_PLAYER_POSITION,
  MAX_CAMERA_PITCH,
  MIN_CAMERA_PITCH,
  cameraBoomLimit,
  orbitDirection,
  recoverCameraDistance,
  shortestAngle,
} from "./followCamera";

const STORAGE_KEY = "personal-atlas-room-position-v3";
const DESKTOP_FIELD_OF_VIEW = 68;
const PORTRAIT_FIELD_OF_VIEW = 76;
const PUNCH_DURATION = 420;
const PUNCH_IMPACT = 125;
const BIRD_FLOOR_OFFSET = 0.012;
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
  return withDisposalScope((scope) => initializeRoomEngine(options, scope));
}

function initializeRoomEngine(
  options: RoomEngineOptions,
  scope: DisposalScope,
): RoomEngine {
  const { host } = options;
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false,
    powerPreference: "high-performance",
  });
  // Register before each subsequent initialization step can fail.
  scope.defer(() => renderer.forceContextLoss());
  scope.own(renderer);
  const room = scope.own(createRoomScene(options.archive));
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
    "部屋の3D表示。ドラッグで360度見回す、矢印キーで移動、Rで視点を戻す。",
  );
  canvas.style.touchAction = "none";
  scope.defer(() => canvas.remove());
  host.append(canvas);

  const camera = new THREE.PerspectiveCamera(
    DESKTOP_FIELD_OF_VIEW,
    1,
    0.035,
    60,
  );
  camera.rotation.order = "YXZ";
  room.scene.add(camera);
  scope.defer(() => room.scene.remove(camera));
  room.avatar.visible = true;
  room.avatar.userData.roomRaycastIgnore = true;
  const avatarMaterials = new Map<
    THREE.Material,
    {
      opacity: number;
      transparent: boolean;
      depthWrite: boolean;
    }
  >();
  room.avatar.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const materials = Array.isArray(object.material)
      ? object.material
      : [object.material];
    for (const material of materials)
      avatarMaterials.set(material, {
        opacity: material.opacity,
        transparent: material.transparent,
        depthWrite: material.depthWrite,
      });
  });
  let lastAvatarOpacity = 1;
  const cameraTarget = new THREE.Vector3();
  const boomDirection = new THREE.Vector3();
  const cameraRay = new THREE.Raycaster();
  let cameraDistance = FOLLOW_DISTANCE;
  let cameraInitialized = false;
  let returningView: { yaw: number } | null = null;

  const raycaster = new THREE.Raycaster();
  const targeting = createRoomTargeting({
    scene: room.scene,
    camera,
    ignoredRoots: [room.avatar, camera],
    canvas,
    portals: room.portals,
  });
  const keyboard = new Set<string>();
  const pad = new Set<Direction>();
  const analog = { x: 0, z: 0 };
  let moveVelocity = { x: 0, z: 0 };
  let player = createPlayer(
    INITIAL_PLAYER_POSITION.x,
    INITIAL_PLAYER_POSITION.z,
  );
  let yaw = 0;
  let pitch = DEFAULT_CAMERA_PITCH;
  let facing = 0;
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
  let hovered: RoomDestination | null = null;
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
    section: Section;
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
        if ("doorOpen" in saved && saved.doorOpen === true) room.door.open(true);
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
            pitch = THREE.MathUtils.clamp(
              saved.pitch,
              MIN_CAMERA_PITCH,
              MAX_CAMERA_PITCH,
            );
          if (
            "facing" in saved &&
            typeof saved.facing === "number" &&
            Number.isFinite(saved.facing)
          )
            facing = saved.facing % (2 * Math.PI);
        }
      }
    }
  } catch {
    /* Storage is optional; a fresh room remains fully usable. */
  }

  // Spawn after restoring the visitor so neither occupant begins inside the other.
  let birdMotion = createBirdMotion(room.obstacles, player);
  room.obstacles.push(birdMotion.collider);
  room.bird.position.set(birdMotion.state.x, BIRD_FLOOR_OFFSET, birdMotion.state.z);
  room.bird.rotation.y = birdMotion.state.heading;

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
          facing,
          doorOpen: room.door.isOpen(),
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
    analog.x = 0;
    analog.z = 0;
    moveVelocity = { x: 0, z: 0 };
    jumpRequested = false;
    releaseViewPointer();
  }

  function setHovered(section: RoomDestination | null) {
    if (hovered === section) return;
    hovered = section;
    shadowDynamicUntil = performance.now() + 800;
    for (const portal of room.portals)
      portal.object.userData.active = portal.destination === section;
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
      facing,
      cameraDistance,
      cameraX: camera.position.x,
      cameraY: camera.position.y,
      cameraZ: camera.position.z,
      punching: punchStarted !== null,
      brokenCount: room.breakables.filter((item) => item.broken).length,
      birdX: birdMotion.state.x,
      birdZ: birdMotion.state.z,
      birdHeight: birdMotion.state.y,
      birdMoving: birdMotion.state.moving,
      doorOpen: room.door.isOpen(),
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

  function open(section: RoomDestination) {
    if (disposed || failed || opening || opened) return;
    const portal = room.portals.find(
      (candidate) => candidate.destination === section,
    );
    if (!portal) return;
    const destinationDefinition = roomDestinations[portal.destination];
    if (destinationDefinition.kind === "external") {
      clearInputs();
      savePosition();
      // Keep this synchronous with click/tap/keydown so browsers allow the
      // new tab. External destinations never enter the in-room transition.
      window.open(
        destinationDefinition.href,
        destinationDefinition.target,
        "noopener,noreferrer",
      );
      return;
    }
    options.onOpening(destinationDefinition.section);
    clearInputs();
    savePosition();
    setHovered(section);
    if (reducedMotion) {
      opened = true;
      options.onOpen(destinationDefinition.section);
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
      section: destinationDefinition.section,
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
    // The action belongs to the character: orbiting the camera cannot strike
    // something behind their back or extend the fist from the camera position.
    const origin = new THREE.Vector3(player.x, player.y + 0.76, player.z);
    const forward = new THREE.Vector3(-Math.sin(facing), 0, -Math.cos(facing));
    if (!room.door.isOpen()) {
      const bounds = new THREE.Box3().setFromObject(room.door.object);
      const target = bounds.getCenter(new THREE.Vector3());
      target.y = Math.max(bounds.min.y, Math.min(origin.y, bounds.max.y));
      const nearest = bounds.clampPoint(origin, new THREE.Vector3());
      const direction = target.clone().sub(origin);
      if (
        nearest.distanceTo(origin) <= 1.25 &&
        direction.clone().setY(0).normalize().dot(forward) >= 0.55
      ) {
        raycaster.set(origin, direction.clone().normalize());
        raycaster.far = direction.length() + 0.03;
        const hit = firstVisibleHit(raycaster.intersectObjects(targeting.roots(), true));
        for (let object: THREE.Object3D | null = hit?.object ?? null; object; object = object.parent) {
          if (object === room.door.object && room.door.open()) {
            shadowDynamicUntil = performance.now() + 1000;
            options.onDoorOpen?.();
            savePosition();
            snapshot();
            return;
          }
        }
      }
    }
    const candidates = room.breakables
      .flatMap((item) => {
        if (item.broken) return [];
        const bounds = new THREE.Box3().setFromObject(item.object);
        const center = bounds.getCenter(new THREE.Vector3());
        const nearest = bounds.clampPoint(origin, new THREE.Vector3());
        const flatDirection = center.clone().sub(origin).setY(0).normalize();
        if (
          nearest.distanceTo(origin) > 1.25 ||
          flatDirection.dot(forward) < 0.55
        )
          return [];
        return [{ item, center, distance: nearest.distanceTo(origin) }];
      })
      .sort((a, b) => a.distance - b.distance);
    for (const { item, center } of candidates) {
      const direction = center.clone().sub(origin);
      raycaster.set(origin, direction.clone().normalize());
      raycaster.far = direction.length() + 0.03;
      const hit = firstVisibleHit(
        raycaster.intersectObjects(targeting.roots(), true),
      );
      let hitId: unknown;
      for (
        let object: THREE.Object3D | null = hit?.object ?? null;
        object;
        object = object.parent
      ) {
        if (typeof object.userData.breakableId === "string") {
          hitId = object.userData.breakableId;
          break;
        }
      }
      if (hitId !== item.id) continue;
      const impulse = forward.clone().setY(0.4).normalize().multiplyScalar(3);
      if (room.breakObject(item.id, impulse)) {
        shadowDynamicUntil = performance.now() + 2500;
        options.onBreak(item.label);
        savePosition();
        snapshot();
      }
      return;
    }
  }

  function resetView() {
    if (disposed || failed || opening || opened) return;
    returningView = { yaw: facing };
    if (reducedMotion) {
      yaw = facing;
      pitch = DEFAULT_CAMERA_PITCH;
      returningView = null;
      setCameraFromPlayer(0);
      camera.updateMatrixWorld();
      snapshot();
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
      targeting.clear();
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
    } else if (event.code === "KeyR") {
      event.preventDefault();
      if (!event.repeat) resetView();
    } else if (event.code === "KeyE") {
      event.preventDefault();
      if (!event.repeat) {
        const portal = targeting.current();
        if (portal) open(portal.destination);
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
        targeting.clear();
        returningView = null;
        yaw -= (event.clientX - viewPointer.x) * 0.0042;
        pitch = THREE.MathUtils.clamp(
          pitch + (event.clientY - viewPointer.y) * 0.0036,
          MIN_CAMERA_PITCH,
          MAX_CAMERA_PITCH,
        );
        yaw %= 2 * Math.PI;
        aimTime = -Infinity;
      }
      viewPointer.x = event.clientX;
      viewPointer.y = event.clientY;
    } else if (event.pointerType === "mouse") {
      const portal = targeting.hoverPointer(event);
      if (portal && roomDestinations[portal.destination].kind === "external")
        setHovered(portal.destination);
      // Retain the photo selection over the gap to its accessible link.
      // A drag, blank click, another portal or leaving the room clears it.
      canvas.style.cursor = portal ? "pointer" : "grab";
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
      const portal = targeting.atPointer(event);
      if (portal) open(portal.destination);
      else {
        targeting.clear();
        aimTime = -Infinity;
      }
    }
  }

  function pointerCancel(event: PointerEvent) {
    if (viewPointer?.id === event.pointerId) releaseViewPointer();
  }

  function pointerLeave() {
    canvas.style.cursor = "";
    targeting.leaveCanvas();
  }

  function fail() {
    if (disposed || failed) return;
    failed = true;
    savePosition();
    try {
      scope.dispose();
    } catch (error) {
      console.error("Room cleanup after rendering failed", error);
    }
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

  function setCameraFromPlayer(elapsed: number) {
    if (returningView) {
      const blend = 1 - Math.exp(-10 * elapsed);
      yaw += shortestAngle(yaw, returningView.yaw) * blend;
      pitch += (DEFAULT_CAMERA_PITCH - pitch) * blend;
      if (
        Math.abs(shortestAngle(yaw, returningView.yaw)) < 0.001 &&
        Math.abs(pitch - DEFAULT_CAMERA_PITCH) < 0.001
      ) {
        yaw = returningView.yaw;
        pitch = DEFAULT_CAMERA_PITCH;
        returningView = null;
      }
    }
    cameraTarget.set(player.x, player.y + FOLLOW_TARGET_HEIGHT, player.z);
    const direction = orbitDirection(yaw, pitch);
    boomDirection.set(direction.x, direction.y, direction.z);
    const wantedDistance = FOLLOW_DISTANCE + (camera.aspect < 0.8 ? 0.1 : 0);
    let safeDistance = cameraBoomLimit(
      cameraTarget,
      boomDirection,
      wantedDistance,
      room.obstacles,
    );
    // The swept volume covers actual walls, ground, doors and furniture. This
    // extra ray catches smaller visible fixtures such as lamps and picture ledges.
    cameraRay.set(cameraTarget, boomDirection);
    cameraRay.far = safeDistance + CAMERA_RADIUS;
    const hit = firstVisibleHit(
      cameraRay.intersectObjects(targeting.roots(), true),
    );
    if (hit)
      safeDistance = Math.max(
        0.035,
        Math.min(safeDistance, hit.distance - CAMERA_RADIUS),
      );
    cameraDistance = cameraInitialized
      ? recoverCameraDistance(cameraDistance, safeDistance, elapsed)
      : safeDistance;
    cameraInitialized = true;
    camera.position
      .copy(cameraTarget)
      .addScaledVector(boomDirection, cameraDistance);
    camera.lookAt(cameraTarget);
    camera.fov = baseFov();
    camera.updateProjectionMatrix();
    // In an unavoidable wall corner, keep the room visible instead of putting
    // the camera inside an opaque head. The normal following view is fully solid.
    const opacity = THREE.MathUtils.smoothstep(cameraDistance, 0.12, 0.78);
    if (Math.abs(lastAvatarOpacity - opacity) > 0.001) {
      for (const [material, initial] of avatarMaterials) {
        material.transparent = opacity < 1 || initial.transparent;
        material.opacity = opacity * initial.opacity;
        material.depthWrite = opacity > 0.5 && initial.depthWrite;
      }
      lastAvatarOpacity = opacity;
    }
  }

  function updatePunch(time: number) {
    if (punchStarted === null) return null;
    const elapsed = time - punchStarted;
    if (elapsed >= PUNCH_IMPACT && !punchImpacted) {
      punchImpacted = true;
      strike();
    }
    const progress = Math.min(1, elapsed / PUNCH_DURATION);
    if (progress >= 1) {
      punchStarted = null;
      return null;
    }
    return progress;
  }

  function render(time: number) {
    if (disposed || failed || paused || document.hidden) return;
    try {
      advanceFrame(time);
    } catch {
      fail();
    }
  }

  function advanceFrame(time: number) {
    const elapsed = Math.max((time - previousTime) / 1000, 0);
    previousTime = time;
    animationTime += elapsed;
    const directions = new Set(pad);
    for (const code of keyboard) directions.add(KEY_DIRECTIONS[code]);
    const oldPosition = { x: player.x, y: player.y, z: player.z };
    const oldFacing = facing;
    const digitalInput = movementVector(directions, yaw);
    const input =
      directions.size > 0 ? digitalInput : cameraRelativeInput(analog, yaw);
    const birdChanged = birdMotion.update(
      elapsed,
      player,
      reducedMotion || Boolean(opening) || opened,
    );
    if (!opening && !opened) {
      if (Math.hypot(input.x, input.z) > 0.01) {
        const targetFacing = Math.atan2(-input.x, -input.z);
        facing +=
          shortestAngle(facing, targetFacing) * (1 - Math.exp(-18 * elapsed));
        facing %= Math.PI * 2;
      }
      const locomotion = smoothLocomotion(moveVelocity, input, elapsed);
      moveVelocity = locomotion.velocity;
      player = stepPlayer(
        player,
        locomotion.average,
        elapsed,
        room.obstacles,
        jumpRequested,
      );
    }
    jumpRequested = false;
    if (player.y < worldRecovery.fallBelow) {
      const recovered = findRecoveryPosition(worldRecovery.position, room.obstacles);
      if (!recovered) throw new Error("No supported recovery position is available.");
      player = recovered;
      moveVelocity = { x: 0, z: 0 };
      cameraInitialized = false;
      clearInputs();
      savePosition();
    }
    const moving =
      Math.hypot(player.x - oldPosition.x, player.z - oldPosition.z) > 0.0001;
    room.avatar.position.set(player.x, player.y, player.z);
    room.avatar.rotation.y = facing;
    room.bird.position.set(
      birdMotion.state.x,
      birdMotion.state.y + BIRD_FLOOR_OFFSET,
      birdMotion.state.z,
    );
    room.bird.rotation.y = birdMotion.state.heading;
    const doorAngle = room.door.object.rotation.y;
    room.animate(animationTime, moving, reducedMotion);
    if (Math.abs(room.door.object.rotation.y - doorAngle) > 0.000001)
      shadowDynamicUntil = Math.max(shadowDynamicUntil, time + 120);
    room.scene.updateMatrixWorld();
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
        opening.section === "pokemon" ? 40 : 52,
        eased,
      );
      camera.updateProjectionMatrix();
      if (progress === 1 && !opened) {
        opened = true;
        options.onOpen(opening.section);
        if (disposed) return;
      }
    } else setCameraFromPlayer(elapsed);
    camera.updateMatrixWorld();
    try {
      room.animateBird({
        time: animationTime,
        hopPhase: birdMotion.state.hopPhase,
        heading: birdMotion.state.heading,
        moving: birdMotion.state.moving,
        reducedMotion,
      });
      const punchProgress = updatePunch(time);
      room.animateAvatar({
        time: animationTime,
        speed:
          elapsed > 0
            ? Math.min(
                1,
                Math.hypot(player.x - oldPosition.x, player.z - oldPosition.z) /
                  elapsed /
                  2.8,
              )
            : 0,
        grounded: player.grounded,
        velocityY: player.velocityY,
        punchProgress,
        reducedMotion,
      });
      room.scene.updateMatrixWorld();
      if (time - aimTime >= 100 && !opening && !opened) {
        aimTime = time;
        setHovered(
          targeting.current()?.destination ?? null,
        );
      }
      if (
        moving ||
        birdChanged ||
        !player.grounded ||
        punchStarted !== null ||
        Math.abs(shortestAngle(oldFacing, facing)) > 0.0001
      )
        shadowDynamicUntil = Math.max(shadowDynamicUntil, time + 120);
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

  // A single lifetime owns listeners, observer, animation frame and GPU state.
  // This same stack runs if resize, snapshot or any later setup step throws.
  scope.defer(() => { disposed = true; });
  scope.defer(() => clearInputs());
  scope.defer(() => cancelAnimationFrame(frame));
  const resizeObserver = new ResizeObserver(resize);
  scope.defer(() => resizeObserver.disconnect());
  resizeObserver.observe(host);
  function listen<T extends Event>(
    target: EventTarget,
    type: string,
    listener: (event: T) => void,
  ) {
    const handler = listener as EventListener;
    scope.defer(() => target.removeEventListener(type, handler));
    target.addEventListener(type, handler);
  }
  listen(window, "keydown", keyDown);
  listen(window, "keyup", keyUp);
  listen(window, "blur", clearInputs);
  listen(document, "visibilitychange", syncSuspension);
  listen(canvas, "pointerdown", pointerDown);
  listen(canvas, "pointermove", pointerMove);
  listen(canvas, "pointerup", pointerUp);
  listen(canvas, "pointercancel", pointerCancel);
  listen(canvas, "lostpointercapture", pointerCancel);
  listen(canvas, "pointerleave", pointerLeave);
  listen(canvas, "webglcontextlost", contextLost);
  resize();
  room.avatar.position.set(player.x, player.y, player.z);
  room.avatar.rotation.y = facing;
  room.scene.updateMatrixWorld();
  setCameraFromPlayer(0);
  camera.updateMatrixWorld();
  snapshot();
  frame = requestAnimationFrame(render);

  return {
    direction(direction, pressed) {
      if (disposed || failed || paused || opening || opened) return;
      if (pressed) targeting.clear();
      if (pressed) pad.add(direction);
      else pad.delete(direction);
    },
    move(x, z) {
      if (disposed || failed || paused || opening || opened) return;
      const length = Math.hypot(x, z);
      if (!Number.isFinite(length)) return;
      if (length > 0) targeting.clear();
      analog.x = x / Math.max(1, length);
      analog.z = z / Math.max(1, length);
    },
    jump,
    punch,
    open,
    resetView,
    setTargetHovered(value) {
      if (!disposed) targeting.setTargetHovered(value);
    },
    resetObjects() {
      if (disposed || failed) return;
      clearInputs();
      punchStarted = null;
      punchImpacted = false;
      room.resetObjects();
      // A restored prop may occupy the spot the visitor walked into after
      // breaking it. Preserve valid airborne positions, but escape solid overlap.
      if (!positionIsClear(player.x, player.z, room.obstacles, player.y)) {
        player = createPlayer(
          INITIAL_PLAYER_POSITION.x,
          INITIAL_PLAYER_POSITION.z,
        );
        room.avatar.position.set(player.x, player.y, player.z);
        room.scene.updateMatrixWorld();
        cameraInitialized = false;
        setCameraFromPlayer(0);
        camera.updateMatrixWorld();
        setHovered(null);
        aimTime = -Infinity;
      }
      // Restored props may now occupy the bird's former route. Choose the
      // nearest safe floor position, also respecting a relocated visitor.
      const birdColliderIndex = room.obstacles.indexOf(birdMotion.collider);
      birdMotion = createBirdMotion(room.obstacles, player, {
        spawn: { x: birdMotion.state.x, z: birdMotion.state.z },
      });
      room.obstacles[birdColliderIndex] = birdMotion.collider;
      room.bird.position.set(birdMotion.state.x, BIRD_FLOOR_OFFSET, birdMotion.state.z);
      room.bird.rotation.y = birdMotion.state.heading;
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
      if (disposed || failed) return;
      reducedMotion = value;
      if (value && opening && !opened) {
        opened = true;
        options.onOpen(opening.section);
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      savePosition();
      scope.dispose();
    },
  };
}
