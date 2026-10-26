import * as THREE from "three";
import type { Section } from "../data/model";
import { roomDestinations } from "./destinations";
import { createRoomTargeting, firstVisibleHit } from "./targeting";
import { withDisposalScope, type DisposalScope } from "./disposal";
import { createRoomScene } from "./roomScene";
import { createBirdMotion } from "./birdMotion";
import { worldRecovery } from "./roomArchitecture";
import { findRecoveryPosition } from "./worldRecovery";
import { createBassGame, type BassDifficulty, type BassSongId, type BassString, type BassTechnique } from "./bassGame";
import { createBassContacts, type BassPointerInput } from "./bassInput";
import { createBassAudio } from "./bassAudio";
import { BASS_REST_FRET } from "./art/bassPose";
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
import { createPinchZoom, pinchAvatarOpacity } from "./pinchZoom";
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
const BASS_VIEW_YAW = Math.PI;
// A three-quarter presentation shows the supporting shoulder, backpack and
// carved body depth while keeping the garden behind the live performance.
const BASS_PERFORMER_YAW = Math.PI + BASS_VIEW_YAW - (30 * Math.PI) / 180;
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
  const room = scope.own(createRoomScene(options.archive, () => {
    // 非同期GLBへの切替後、静止中でも旧モデルの影を描き直す。
    renderer.shadowMap.needsUpdate = true;
  }));
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
    "部屋の3D表示。ドラッグで360度見回す、2本指で触れた場所を一時的に拡大・縮小、矢印キーで移動、Rで視点を戻す。",
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
  // Use the same screen-space coverage mask for every part of the traveller.
  // Alpha blending each mesh would reveal its face through the back of its head.
  // Opaque depth remains intact in covered pixels; uncovered pixels show scenery.
  const avatarCoverage = { value: 1 };
  function maskAvatarMaterial(material: THREE.Material) {
    const compile = material.onBeforeCompile;
    const cacheKey = material.customProgramCacheKey();
    material.onBeforeCompile = function (shader, webgl) {
      compile.call(this, shader, webgl);
      shader.uniforms.roomAvatarCoverage = avatarCoverage;
      shader.fragmentShader = `uniform float roomAvatarCoverage;\n${shader.fragmentShader}`
        .replace("#include <clipping_planes_fragment>", `
          #include <clipping_planes_fragment>
          if (roomAvatarCoverage < 1.0) {
            float coverage = fract(52.9829189 * fract(dot(floor(gl_FragCoord.xy), vec2(0.06711056, 0.00583715))));
            if (coverage >= roomAvatarCoverage) discard;
          }
        `);
    };
    material.customProgramCacheKey = () => `${cacheKey}:room-avatar-coverage-v1`;
    material.needsUpdate = true;
  }
  for (const material of avatarMaterials.keys()) maskAvatarMaterial(material);
  const avatarShadow = scope.own(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }));
  maskAvatarMaterial(avatarShadow);
  room.avatar.traverse((object) => {
    if (object instanceof THREE.Mesh && object.castShadow) object.customDepthMaterial = avatarShadow;
  });
  let lastAvatarOpacity = 1;
  let lastWallOpacity = 1;
  const cameraTarget = new THREE.Vector3();
  const boomDirection = new THREE.Vector3();
  const cameraRay = new THREE.Raycaster();
  let cameraDistance = FOLLOW_DISTANCE;
  let cameraInitialized = false;
  let returningView: { yaw: number } | null = null;
  const pinchZoom = createPinchZoom();
  const canvasTouches = new Map<number, { x: number; y: number }>();
  let pinchPair: [number, number] | null = null;
  // Once a pinch ends, consume every remaining finger until all have lifted.
  // The surviving finger must never become a drag or a portal click.
  let pinchConsumed = false;
  const pinchControlsLocked = () => {
    const state = pinchZoom.snapshot();
    return state.active || state.returning || pinchConsumed;
  };

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
  const bassGame = createBassGame();
  const bassAudio = scope.own(createBassAudio((status) => {
    if (!disposed && !failed) options.onBassAudioStatus?.(status);
  }));
  let bassState = bassGame.snapshot();
  let bassPreviousTime = performance.now();
  let bassReportedTime = -Infinity;
  let bassVisualLift = 0;
  let bassPluckPulse = 0;
  let bassSlapPulse = 0;
  let bassSuccessPulse = 0;
  let bassPluckString: BassString = 3;
  let bassOverlayHeight = 0;
  const bassContacts = createBassContacts();
  let bassViewOffset = 0;
  let bassNeedsExit = false;
  let bassStartGeneration = 0;
  let bassStartPending = false;
  let bassPickupStart = { x: 0, z: 0 };
  const bassHeld = () => !["idle", "approaching"].includes(bassState.phase);
  const bassControlsLocked = () => bassHeld() || bassVisualLift > 0;
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
  let homeCamera: { position: THREE.Vector3; rotation: THREE.Quaternion; fov: number } | null = null;

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
    const id = viewPointer?.id;
    viewPointer = null;
    if (id !== undefined && canvas.hasPointerCapture(id))
      canvas.releasePointerCapture(id);
  }

  function clearMovementInputs() {
    keyboard.clear();
    pad.clear();
    analog.x = 0;
    analog.z = 0;
    moveVelocity = { x: 0, z: 0 };
    jumpRequested = false;
  }

  function cancelPinch() {
    const wasZoomed = pinchControlsLocked();
    const ids = [...canvasTouches.keys()];
    canvasTouches.clear();
    pinchPair = null;
    pinchConsumed = false;
    pinchZoom.reset();
    for (const id of ids)
      if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
    if (wasZoomed) {
      camera.zoom = 1;
      camera.clearViewOffset();
      camera.updateProjectionMatrix();
      updateAvatarVisibility();
    }
  }

  function clearInputs() {
    clearMovementInputs();
    bassState = bassGame.snapshot();
    releaseViewPointer();
    cancelPinch();
  }

  function reportBass(time = performance.now(), immediate = false) {
    if (immediate || (bassState.phase !== "idle" && time - bassReportedTime >= 1000 / 30)) {
      bassReportedTime = time;
      options.onBassSnapshot?.(bassState);
    }
  }

  function advanceBass(time: number) {
    time = Math.max(time, bassPreviousTime);
    const delta = Math.max(0, (time - bassPreviousTime) / 1000);
    bassPreviousTime = time;
    const near = player.grounded && Math.abs(player.y) < 0.03 &&
      Math.hypot(player.x - room.bass.anchor.x, player.z - room.bass.anchor.z) <= room.bass.radius;
    if (!near) bassNeedsExit = false;
    const phase = bassState.phase;
    const performing = phase === "countdown" || phase === "playing";
    const playbackTime = bassAudio.playbackTime();
    const timeline = phase === "countdown" ? -bassState.countdownRemaining : bassState.elapsed;
    // The device's sample clock owns the score. Wall/RAF clocks may run at a
    // different rate under load; seeking the recording to them would skip audio.
    // A missing transport freezes the score until sync() anchors its resume.
    const musicDelta = playbackTime === null ? 0 : Math.max(0, playbackTime - timeline);
    bassState = bassGame.tick(performing ? musicDelta : delta,
      near && !bassNeedsExit && !opening && !opened && !pinchControlsLocked());
    for (const contact of bassContacts.values()) {
      const note = bassState.notes.find(note => note.id === contact.noteId);
      if ((note?.kind === "slide" && note.state !== "sliding" && note.state !== "pending") ||
        (note?.kind === "hold" && note.state !== "holding" && note.state !== "pending")) bassAudio.releaseMidi(contact.id);
    }
    if (bassState.phase === "result") bassContacts.clear();
    if (phase === "idle" && bassState.phase === "approaching") void bassAudio.preload();
    if ((phase === "idle" || phase === "approaching") && bassHeld()) {
      bassPickupStart = { x: player.x, z: player.z };
      clearInputs();
      punchStarted = null;
      targeting.clear();
      setHovered(null);
      // Stay in the same world and ease around to a clear view of the performer.
      returningView = { yaw: BASS_VIEW_YAW };
    }
    bassAudio.sync(bassState);
    reportBass(time, phase !== bassState.phase);
  }

  function startBass() {
    const resumeOnly = ["countdown", "playing"].includes(bassState.phase) && !bassAudio.isRunning();
    if (disposed || failed || paused || document.hidden || bassStartPending ||
      (!resumeOnly && bassState.phase !== "ready")) return;
    bassAudio.unlock(); // Must run synchronously inside this key/tap gesture.
    const generation = ++bassStartGeneration;
    bassStartPending = true;
    void bassAudio.prepare().then((loaded) => {
      if (!loaded || generation !== bassStartGeneration || disposed || failed || paused || document.hidden ||
        !(resumeOnly ? ["countdown", "playing"] : ["ready"]).includes(bassState.phase)) return;
      bassPreviousTime = performance.now();
      if (resumeOnly) clearInputs();
      else {
        if (!bassGame.start()) return;
        bassContacts.clear();
      }
      bassPluckPulse = bassSlapPulse = bassSuccessPulse = 0;
      bassState = bassGame.snapshot();
      bassAudio.sync(bassState);
      reportBass(bassPreviousTime, true);
    }).finally(() => {
      if (generation === bassStartGeneration) bassStartPending = false;
    });
  }

  function cancelBassStart() {
    bassStartGeneration++;
    bassStartPending = false;
  }

  function setBassDifficulty(difficulty: BassDifficulty) {
    if (disposed || failed || paused || document.hidden || !bassGame.setDifficulty(difficulty)) return;
    cancelBassStart();
    bassAudio.stop();
    clearInputs();
    bassPluckPulse = bassSlapPulse = bassSuccessPulse = 0;
    bassPreviousTime = performance.now();
    reportBass(bassPreviousTime, true);
  }

  function selectBassSong(id: BassSongId) {
    if (disposed || failed || paused || document.hidden || !bassGame.selectSong(id)) return false;
    cancelBassStart();
    bassContacts.clear();
    bassAudio.selectSong(id);
    bassState = bassGame.snapshot();
    bassPreviousTime = performance.now();
    reportBass(bassPreviousTime, true);
    void bassAudio.preload();
    return true;
  }
  function continueBass() {
    if (disposed || failed || paused || document.hidden || !bassGame.continueFromResult()) return false;
    cancelBassStart();
    bassContacts.clear();
    bassAudio.stop();
    clearInputs();
    bassPluckPulse = bassSlapPulse = bassSuccessPulse = 0;
    bassPreviousTime = performance.now();
    reportBass(bassPreviousTime, true);
    return true;
  }
  function setBassAudioOffset(seconds: number) {
    if (disposed || failed || paused || document.hidden || !bassGame.setAudioOffset(seconds)) return false;
    cancelBassStart(); bassAudio.stop();
    bassState = bassGame.snapshot(); reportBass(performance.now(), true);
    return true;
  }
  function seekBass(seconds: number) {
    if (disposed || failed || document.hidden || !bassGame.seek(seconds)) return false;
    bassContacts.clear();
    bassState = bassGame.snapshot();
    bassAudio.seek(bassState, paused);
    bassPreviousTime = performance.now();
    reportBass(bassPreviousTime, true);
    return true;
  }

  function inputBass(input: BassPointerInput) {
    if (disposed || failed || paused || document.hidden || bassState.phase !== "playing") return;
    bassAudio.unlock();
    if (!bassAudio.isRunning()) return;
    advanceBass(performance.now());
    const stamp = input.time > 1e12 ? input.time - performance.timeOrigin : input.time;
    const inputTime = bassState.elapsed - Math.max(0, performance.now() - stamp) / 1000;
    if (input.action === "down") {
      if (!bassContacts.begin(input, inputTime)) return;
      const result = bassGame.beginInput(input.id, input.midi, inputTime, input);
      if (!result) { bassContacts.end(input, inputTime); return; }
      bassContacts.get(input.id)!.noteId = result.noteId;
      const note = bassState.notes.find(note => note.id === result.noteId);
      bassContacts.get(input.id)!.expectedKind = note?.kind ?? null;
      bassAudio.playMidi(input.id, input.midi, result.technique, note?.kind === "hold" || note?.kind === "slide");
      bassPluckPulse = 1;
      bassPluckString = input.string;
      bassSlapPulse = result.technique === "slap" ? 1 : 0;
    } else if (bassContacts.has(input.id)) {
      if (input.action !== "cancel" && bassContacts.move(input)) {
        if (bassGame.slapInput(input.id)) bassSlapPulse = bassSuccessPulse = 1;
      }
      const contact = bassContacts.get(input.id)!;
      if (contact.gesture === "slide" || contact.gesture === "invalid" || contact.gesture === "slap") {
        const slide = bassGame.slideInput(input.id, contact.currentFret, contact.gesture === "slide", inputTime);
        if (contact.gesture === "slide") bassAudio.bendMidi(input.id, slide?.midi ?? contact.currentMidi);
        if (slide?.finished || contact.cancelled) bassAudio.releaseMidi(input.id);
      }
      if (input.action === "up" || input.action === "cancel") {
        bassContacts.end(input, inputTime);
        bassGame.endInput(input.id, input.action === "cancel" || contact.cancelled, inputTime);
        bassAudio.releaseMidi(input.id);
      }
    }
    bassState = bassGame.snapshot();
    const event = bassState.performanceEvents.at(-1);
    bassSuccessPulse = event?.stage === "complete" && event.time >= inputTime - 0.01 ? 1 : 0;
    reportBass(performance.now(), true);
  }

  function pluckBass(string: BassString, technique: BassTechnique = "pick") {
    if (disposed || failed || paused || document.hidden || bassState.phase !== "playing") return;
    if (!bassAudio.isRunning()) return;
    advanceBass(performance.now()); // Judge at input time, independently of render FPS.
    const judgement = bassGame.pluck(string, technique);
    if (!judgement) return;
    bassAudio.unlock();
    bassState = bassGame.snapshot();
    bassAudio.pluck(judgement.frequency, technique, bassState, judgement.noteId);
    bassPluckPulse = 1;
    bassSlapPulse = technique === "slap" ? 1 : 0;
    bassPluckString = string;
    bassSuccessPulse = judgement.kind === "miss" ? 0 : 1;
    reportBass(performance.now(), true);
  }

  function putDownBass() {
    bassContacts.clear();
    if (disposed || failed) return;
    cancelBassStart();
    bassAudio.stop();
    bassGame.cancel();
    bassState = bassGame.snapshot();
    bassPreviousTime = performance.now();
    bassNeedsExit = true;
    bassPluckPulse = 0;
    bassSlapPulse = 0;
    bassSuccessPulse = 0;
    clearInputs();
    reportBass(bassPreviousTime, true);
    savePosition();
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
      cameraZoom: camera.zoom,
      cameraOffsetX: camera.view?.enabled ? camera.view.offsetX / camera.view.fullWidth : 0,
      cameraOffsetY: camera.view?.enabled ? camera.view.offsetY / camera.view.fullHeight : 0,
      pinching: pinchZoom.snapshot().active,
      avatarOpacity: lastAvatarOpacity,
      avatarVisible: room.avatar.visible,
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
    if (bounds.width !== width || bounds.height !== height) clearInputs();
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
    if (disposed || failed || opening || opened || bassHeld() || pinchControlsLocked()) return;
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
    homeCamera = { position: camera.position.clone(), rotation: camera.quaternion.clone(), fov: camera.fov };
    options.onOpening(destinationDefinition.section);
    clearInputs();
    savePosition();
    setHovered(section);
    if (reducedMotion) {
      opened = true;
      options.onOpen(destinationDefinition.section);
      return;
    }
    // Approach from the visible face, avoiding a flight through room furniture.
    const destination = portal.lookAt.clone().add(
      section === "japan" ? new THREE.Vector3(0, .15, 2.2) :
      section === "pokemon" ? new THREE.Vector3(0, 0.35, 1.5) : new THREE.Vector3(0, 0.45, 2.2));
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
      !player.grounded || bassControlsLocked() || pinchControlsLocked()
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
      punchStarted !== null || bassControlsLocked() || pinchControlsLocked()
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
    if (disposed || failed || opening || opened || pinchControlsLocked()) return;
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
      opened ||
      pinchControlsLocked()
    )
      return;
    if (bassHeld()) {
      if (event.code === "Escape") {
        event.preventDefault();
        if (!event.repeat) putDownBass();
      } else if (["Space", "Enter"].includes(event.code)) {
        if (["Space", "Enter"].includes(event.code) && event.target instanceof HTMLElement && event.target.closest("button, a")) return;
        event.preventDefault();
        if (!event.repeat) {
          if (bassState.phase === "ready") startBass();
          else if (bassState.phase === "result") continueBass();
        }
      } else if (event.code === "KeyR") {
        event.preventDefault();
        if (!event.repeat) resetView();
      } else if (KEY_DIRECTIONS[event.code]) event.preventDefault();
      return;
    }
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
    if (event.button !== 0 || disposed || failed || paused || document.hidden || opening || opened)
      return;
    if (event.pointerType === "touch" && !bassControlsLocked()) {
      canvasTouches.set(event.pointerId, { x: event.clientX, y: event.clientY });
      canvas.setPointerCapture(event.pointerId);
      if (canvasTouches.size === 2 && !pinchConsumed) {
        pinchPair = [...canvasTouches.keys()] as [number, number];
        pinchConsumed = true;
        viewPointer = null; // Keep both captures owned by the pinch.
        clearMovementInputs();
        returningView = null;
        punchStarted = null;
        targeting.clear();
        setHovered(null);
        const [a, b] = pinchPoints();
        pinchZoom.begin(a, b, { width, height });
        event.preventDefault();
        return;
      }
      if (pinchControlsLocked() || canvasTouches.size > 1) return;
    }
    if (viewPointer || pinchControlsLocked()) return;
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

  function pinchPoints() {
    const bounds = canvas.getBoundingClientRect();
    return pinchPair!.map((id) => {
      const point = canvasTouches.get(id)!;
      return { x: point.x - bounds.left, y: point.y - bounds.top };
    }) as [{ x: number; y: number }, { x: number; y: number }];
  }

  function pointerMove(event: PointerEvent) {
    if (paused || opening || opened) return;
    if (canvasTouches.has(event.pointerId)) {
      canvasTouches.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pinchPair?.includes(event.pointerId)) {
        const [a, b] = pinchPoints();
        pinchZoom.move(a, b, { width, height });
      }
    }
    if (pinchControlsLocked()) return;
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

  function releaseTouch(event: PointerEvent) {
    if (!canvasTouches.delete(event.pointerId)) return false;
    if (pinchPair?.includes(event.pointerId)) {
      pinchPair = null;
      pinchZoom.end();
    }
    if (!pinchConsumed) return false;
    if (canvasTouches.size === 0) pinchConsumed = false;
    if (canvas.hasPointerCapture(event.pointerId))
      canvas.releasePointerCapture(event.pointerId);
    return true;
  }

  function pointerUp(event: PointerEvent) {
    if (releaseTouch(event)) return;
    if (!viewPointer || viewPointer.id !== event.pointerId) return;
    const clicked =
      !viewPointer.moved &&
      Math.hypot(
        event.clientX - viewPointer.startX,
        event.clientY - viewPointer.startY,
      ) <= 8;
    releaseViewPointer();
    if (clicked && !paused && !bassHeld()) {
      const portal = targeting.atPointer(event);
      if (portal) open(portal.destination);
      else {
        targeting.clear();
        aimTime = -Infinity;
      }
    }
  }

  function pointerCancel(event: PointerEvent) {
    if (releaseTouch(event)) return;
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
    bassContacts.clear();
    bassGame.suspendInputs();
    cancelBassStart();
    clearInputs();
    reportBass(performance.now(), true);
    bassAudio.stop();
    bassPreviousTime = performance.now();
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
    if (pinchControlsLocked()) {
      const zoom = pinchZoom.snapshot();
      // Optical zoom and an off-axis frustum preserve the touched image point
      // without moving the camera through walls or changing the orbit.
      camera.zoom = zoom.zoom;
      camera.setViewOffset(width, height,
        zoom.offsetX * width, zoom.offsetY * height, width, height);
      camera.updateProjectionMatrix();
      updateAvatarVisibility();
      return;
    }
    camera.zoom = 1;
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
    // Frame the performer above the compact play bar, with the garden behind.
    const shortLandscape = height < 500 && camera.aspect > 1.2;
    const targetHeight = THREE.MathUtils.lerp(FOLLOW_TARGET_HEIGHT,
      shortLandscape ? 0.65 : 0.6, bassVisualLift);
    cameraTarget.set(player.x, player.y + targetHeight, player.z);
    const direction = orbitDirection(yaw, pitch);
    boomDirection.set(direction.x, direction.y, direction.z);
    const wantedDistance = THREE.MathUtils.lerp(
      FOLLOW_DISTANCE + (camera.aspect < 0.8 ? 0.1 : 0),
      shortLandscape ? 2.85 : 2.2, bassVisualLift,
    );
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
    camera.fov = baseFov() + Math.max(0, 750 - height) * 0.07 * bassVisualLift;
    // Keep the live room full-screen while framing the performer in the space
    // above the actual control deck, including phone rotation and safe areas.
    const topReserve = Math.min(110, height * 0.16);
    const wantedOffset = Math.max(0, Math.min(bassOverlayHeight, height * 0.76) - topReserve) * 0.5 * bassVisualLift;
    bassViewOffset = THREE.MathUtils.damp(bassViewOffset, wantedOffset, 9, elapsed);
    if (bassViewOffset > 0.1) camera.setViewOffset(width, height, 0, bassViewOffset, width, height);
    else camera.clearViewOffset();
    camera.updateProjectionMatrix();
    updateAvatarVisibility();
  }

  function updateAvatarVisibility() {
    // In an unavoidable wall corner, keep the room visible instead of putting
    // the camera inside an opaque head. Preserve that behavior through the old
    // 3x zoom limit; only the new close-up range fades the whole traveller away.
    const zoomOpacity = pinchAvatarOpacity(camera.zoom);
    const wallOpacity = THREE.MathUtils.smoothstep(cameraDistance, 0.12, 0.78);
    lastAvatarOpacity = wallOpacity * zoomOpacity;
    if (avatarCoverage.value !== zoomOpacity) {
      avatarCoverage.value = zoomOpacity;
      renderer.shadowMap.needsUpdate = true;
    }
    const visible = zoomOpacity > 0;
    if (room.avatar.visible !== visible) {
      room.avatar.visible = visible;
      // Static room shadows are cached. Removing/restoring the whole character
      // must also remove/restore its shadow, even while movement is frozen.
      renderer.shadowMap.needsUpdate = true;
    }
    if (lastWallOpacity !== wallOpacity &&
      (wallOpacity === 0 || wallOpacity === 1 || Math.abs(lastWallOpacity - wallOpacity) > 0.00001)) {
      for (const [material, initial] of avatarMaterials) {
        const transparent = wallOpacity < 1 || initial.transparent;
        if (material.transparent !== transparent) {
          material.transparent = transparent;
          material.needsUpdate = true;
        }
        material.opacity = wallOpacity * initial.opacity;
        material.depthWrite = wallOpacity > 0.5 && initial.depthWrite;
      }
      lastWallOpacity = wallOpacity;
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
    pinchZoom.step(elapsed, reducedMotion);
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
    if (!opening && !opened && !bassControlsLocked() && !pinchControlsLocked()) {
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
    advanceBass(time);
    if (bassState.phase === "pickup" || bassState.phase === "ready") {
      // A small step away from the stand keeps the instrument, flowers and amp
      // in the same view. It uses normal collisions, never a teleport/scene cut.
      const progress = THREE.MathUtils.smoothstep(bassState.pickupProgress, 0, 1);
      const wantedX = THREE.MathUtils.lerp(bassPickupStart.x, 2.6, progress);
      const wantedZ = THREE.MathUtils.lerp(bassPickupStart.z, 6.25, progress);
      const stepTime = Math.min(1, elapsed);
      if (stepTime > 0) player = stepPlayer(player, {
        x: (wantedX - player.x) / (2.8 * stepTime),
        z: (wantedZ - player.z) / (2.8 * stepTime),
      }, stepTime, room.obstacles);
    }
    if (bassHeld()) facing += shortestAngle(facing, BASS_PERFORMER_YAW) * (1 - Math.exp(-8 * elapsed));
    const liftTarget = bassHeld() ? (bassState.phase === "pickup" ? bassState.pickupProgress : 1) : 0;
    bassVisualLift = bassHeld() ? liftTarget : Math.max(0, bassVisualLift - elapsed * 2.5);
    bassPluckPulse *= Math.exp(-12 * elapsed);
    bassSlapPulse *= Math.exp(-12 * elapsed);
    bassSuccessPulse *= Math.exp(-5 * elapsed);
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
      const automaticPhrase = bassState.phase === "playing"
        ? bassState.currentPhrase ?? bassState.nextPhrase : null;
      const sliding = bassState.notes.find(note => note.state === "sliding");
      const bassLeft = sliding ? { string: sliding.string, fret: sliding.slideFret ?? sliding.fret } : automaticPhrase ?? { string: 3, fret: BASS_REST_FRET };
      const bassBeat = bassState.beat;
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
        bass: {
          lift: bassVisualLift, pluck: bassPluckPulse, playing: bassState.phase === "playing",
          beat: bassBeat, string: bassLeft.string, fret: bassLeft.fret,
          fretting: automaticPhrase !== null || Boolean(sliding), pluckString: bassPluckString,
          slap: bassSlapPulse,
        },
      });
      room.bass.animate(animationTime, bassVisualLift, bassPluckPulse,
        bassState.notes.length ? bassState.hits / bassState.notes.length : 0, reducedMotion,
        { snapshot: bassState, playing: bassState.phase === "playing", beat: bassBeat, success: bassSuccessPulse, string: bassPluckString, slap: bassSlapPulse });
      room.scene.updateMatrixWorld();
      if (time - aimTime >= 100 && !opening && !opened && !bassHeld() && !pinchControlsLocked()) {
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
        bassHeld() || bassVisualLift > 0 ||
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
  reportBass(performance.now(), true);
  frame = requestAnimationFrame(render);

  return {
    direction(direction, pressed) {
      if (disposed || failed || paused || opening || opened || bassControlsLocked() || pinchControlsLocked()) return;
      if (pressed) targeting.clear();
      if (pressed) pad.add(direction);
      else pad.delete(direction);
    },
    move(x, z) {
      if (disposed || failed || paused || opening || opened || bassControlsLocked() || pinchControlsLocked()) return;
      const length = Math.hypot(x, z);
      if (!Number.isFinite(length)) return;
      if (length > 0) targeting.clear();
      analog.x = x / Math.max(1, length);
      analog.z = z / Math.max(1, length);
    },
    jump,
    punch,
    startBass,
    continueBass,
    setBassDifficulty,
    selectBassSong,
    setBassAudioOffset,
    seekBass,
    pluckBass,
    inputBass,
    putDownBass,
    setBassOverlayHeight(value) { bassOverlayHeight = Number.isFinite(value) ? Math.max(0, value) : 0; },
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
    closeCollection() {
      if (disposed || failed) return;
      opening = null;
      opened = false;
      clearInputs();
      if (homeCamera) {
        camera.position.copy(homeCamera.position);
        camera.quaternion.copy(homeCamera.rotation);
        camera.fov = baseFov();
        camera.updateProjectionMatrix();
        homeCamera = null;
      }
      setHovered(null);
      snapshot();
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
      cancelBassStart();
      disposed = true;
      savePosition();
      scope.dispose();
    },
  };
}
