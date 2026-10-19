import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import type { Archive } from "../data/model";
import type {
  RoomScene,
  RoomObstacle,
  RoomPortal,
  RoomBreakable,
} from "./types";
import { createBreakables } from "./art/breakables";
import { createCharacter } from "./art/character";
import { createBird } from "./art/bird";
import { createPhotoFrame } from "./art/photoFrame";
import { createTableCamera } from "./art/tableCamera";
import { createTablePolaroids } from "./art/tablePolaroids";
import type { RoomDestinationId } from "./destinations";
import { withDisposalScope, type DisposalScope } from "./disposal";
import { overlapsObstacle } from "./collision";
import { AVATAR_RADIUS, PLAYER_HEIGHT } from "./movement";
import {
  architectureLayout,
  architectureObstacle,
  createEntryDoorMotion,
  entryDoorLayout,
  entryDoorPose,
} from "./roomArchitecture";
import {
  createFurnitureGroup,
  furnitureLayout,
  furnitureObstacle,
  furniturePoint,
  partTop,
  sofaObstacles,
  type FurniturePart,
} from "./furnitureLayout";
import deskPhotoUrl from "../assets/room/rome-travel.jpg";
import polaroidPhotoUrl from "../assets/room/polaroid-travels.jpg";
import {
  createWorldMapTexture,
  createJapanMapTexture,
  createPhoneTexture,
} from "./art/textures";

/** All furniture and decorative objects are original geometry. Maps use the local atlas. */
export function createRoomScene(archive: Archive): RoomScene {
  return withDisposalScope((scope) => buildRoomScene(archive, scope));
}

function buildRoomScene(archive: Archive, scope: DisposalScope): RoomScene {
  const scene = new THREE.Scene();
  // The open terrace sees a pale daytime sky; the room keeps its own lighting.
  scene.background = new THREE.Color("#dceaf0");
  scope.defer(() => scene.clear());
  const portals: RoomPortal[] = [];
  const obstacles: RoomObstacle[] = [];
  const fractureSystem = scope.own(createBreakables(scene));
  const breakables: RoomBreakable[] = [];
  const registerBreakable = (
    id: string,
    label: string,
    object: THREE.Object3D,
    colors: string[],
    supportY = 0,
  ) => {
    fractureSystem.register(id, object, colors, supportY);
    breakables.push({ id, label, object, broken: false });
  };
  let lastAnimationTime = 0;
  const mat = (color: string, roughness = 0.75, metalness = 0) => {
    const value = new THREE.MeshStandardMaterial({
      color,
      roughness,
      metalness,
    });
    scope.own(value);
    return value;
  };
  const cream = mat("#eee9dc");
  const wall = mat("#e9e7dd");
  const wood = mat("#bf9469");
  const woodLight = mat("#d0ad83");
  const woodDark = mat("#846747");
  const linen = mat("#e6e0cf");
  const blue = mat("#718f99");
  const blueLight = mat("#b4c5c3");
  const dark = mat("#334742");
  const brass = mat("#b09460", 0.35, 0.55);
  const charcoal = mat("#29352e", 0.45);
  const white = mat("#f4f0df");
  const green = mat("#57755b");
  const terracotta = mat("#b67b60");
  const clay = mat("#d7c1a3");
  const books = [
    mat("#789093"),
    mat("#b29378"),
    mat("#eee2c7"),
    mat("#4e625b"),
    mat("#b8aa8b"),
  ];
  const rounded = (
    w: number,
    h: number,
    d: number,
    material: THREE.Material,
    radius = 0.04,
    parent: THREE.Object3D = scene,
    x = 0,
    y = 0,
    z = 0,
  ) => {
    const mesh = new THREE.Mesh(
      scope.own(
        new RoundedBoxGeometry(
          w,
          h,
          d,
          2,
          Math.min(radius, w / 2, h / 2, d / 2),
        ),
      ),
      material,
    );
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };
  const box = (
    w: number,
    h: number,
    d: number,
    material: THREE.Material,
    parent: THREE.Object3D = scene,
    x = 0,
    y = 0,
    z = 0,
  ) => {
    const mesh = new THREE.Mesh(
      scope.own(new THREE.BoxGeometry(w, h, d)),
      material,
    );
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };
  const cylinder = (
    top: number,
    bottom: number,
    height: number,
    material: THREE.Material,
    parent: THREE.Object3D,
    x: number,
    y: number,
    z: number,
    segments = 24,
  ) => {
    const mesh = new THREE.Mesh(
      scope.own(new THREE.CylinderGeometry(top, bottom, height, segments)),
      material,
    );
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };
  const sphere = (
    r: number,
    material: THREE.Material,
    parent: THREE.Object3D,
    x: number,
    y: number,
    z: number,
  ) => {
    const mesh = new THREE.Mesh(
      scope.own(new THREE.SphereGeometry(r, 20, 14)),
      material,
    );
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };
  const group = (
    x: number,
    y: number,
    z: number,
    parent: THREE.Object3D = scene,
  ) => {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    parent.add(g);
    return g;
  };
  const portal = (
    destination: RoomDestinationId,
    object: THREE.Object3D,
    anchor: THREE.Vector3,
    lookAt: THREE.Vector3,
  ) => {
    portals.push({ destination, object, anchor, lookAt });
  };
  const furniturePart = (
    part: FurniturePart,
    material: THREE.Material,
    radius: number,
    parent: THREE.Object3D,
  ) =>
    rounded(
      part.width,
      part.height,
      part.depth,
      material,
      radius,
      parent,
      ...part.position,
    );
  const obstruction = (
    id: string,
    x: number,
    z: number,
    width: number,
    depth: number,
    height: number,
    base = 0,
  ) => {
    obstacles.push({
      id,
      x,
      z,
      width,
      depth,
      top: base + height,
      base,
      enabled: true,
    });
  };

  // Lighting belongs to the room; the renderer enables real shadow maps.
  scene.add(new THREE.HemisphereLight("#fff9e8", "#b0a28e", 2.05));
  const sun = new THREE.DirectionalLight("#fff0cc", 3.5);
  scope.defer(() => sun.shadow.map?.dispose());
  sun.position.set(-4, 9, 4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -9;
  sun.shadow.camera.right = 9;
  sun.shadow.camera.top = 9;
  sun.shadow.camera.bottom = -9;
  sun.shadow.camera.near = 0.1;
  sun.shadow.camera.far = 30;
  sun.shadow.normalBias = 0.04;
  sun.shadow.bias = -0.0001;
  sun.shadow.radius = 4;
  sun.target.position.set(0, 0, -1);
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight("#dbe6eb", 0.65);
  fill.position.set(5, 5, -5);
  scene.add(fill);

  // A thick architectural plinth and individual timber floorboards.
  rounded(10.3, 0.34, 8.3, cream, 0.09, scene, 0, -0.24, 0);
  const terrace = mat("#cfc5b0");
  const ceilingMaterial = mat("#f4f0e4");
  ceilingMaterial.emissive.set("#ded8c6");
  ceilingMaterial.emissiveIntensity = 0.24;
  const architectureMaterials = { wall, woodDark, terrace, ceiling: ceilingMaterial };
  for (const part of architectureLayout) {
    obstacles.push(architectureObstacle(part));
    if ("visible" in part && part.visible === false) continue;
    const mesh = box(
      part.width,
      part.height,
      part.depth,
      architectureMaterials[part.material],
      scene,
      ...part.position,
    );
    mesh.name = part.id;
    if (part.id === "room-ceiling") mesh.castShadow = false;
  }
  const plankMats = ["#c9ac87", "#d0b28c", "#ccb08c", "#d3b995", "#cbb18d"].map(
    (c) => mat(c),
  );
  for (let col = 0; col < 20; col++) {
    for (let row = 0; row < 4; row++) {
      const x = -4.75 + col * 0.5;
      const z = -3 + row * 2;
      box(
        0.493,
        0.055,
        1.988,
        plankMats[(col * 7 + row * 3) % plankMats.length],
        scene,
        x,
        -0.02,
        z,
      );
    }
  }
  // Tiny grain lines are deliberately sparse, not phototextures or runtime assets.
  const grain = mat("#ad8d67");
  for (let i = 0; i < 55; i++) {
    const x = -4.8 + ((i * 37) % 97) / 10;
    const z = -3.7 + ((i * 19) % 73) / 10;
    box(0.006, 0.002, 0.3 + (i % 5) * 0.11, grain, scene, x, 0.009, z);
  }
  // Mouldings remain decorative; the shared solids above provide the walls.
  box(10.05, 0.13, 0.06, white, scene, 0, 0.08, -3.91);
  box(0.06, 0.13, 8, white, scene, -4.91, 0.08, 0);
  box(10.2, 0.08, 0.21, white, scene, 0, 4.62, -4.05);

  // Complete the architecture for an eye-level view in every direction.
  box(0.06, 0.13, 8, white, scene, 4.91, 0.08, 0);
  for (const [left, right] of [[-5.025, entryDoorLayout.openingLeft], [entryDoorLayout.openingRight, 5.025]])
    box(right - left, 0.13, 0.06, white, scene, (left + right) / 2, 0.08, 3.91);
  for (const x of [-4.9, 4.9]) box(0.09, 0.1, 8.0, white, scene, x, 4.54, 0);
  for (const z of [-3.9, 3.9]) box(9.8, 0.1, 0.09, white, scene, 0, 4.54, z);

  // The ash leaf swings outwards through a real opening in the entry wall.
  const doorFrame = group(entryDoorLayout.centerX, 0, entryDoorLayout.hingeZ);
  for (const x of [-0.79, 0.79])
    rounded(0.09, 2.9, 0.11, white, 0.014, doorFrame, x, 1.45, -0.045);
  rounded(1.67, 0.09, 0.11, white, 0.014, doorFrame, 0, 2.91, -0.045);
  // Lined jambs bridge the thickness of the wall instead of exposing its cut.
  for (const x of [-0.765, 0.765])
    box(0.04, 2.865, 0.23, white, doorFrame, x, 1.4325, 0.12);
  box(1.57, 0.04, 0.23, white, doorFrame, 0, 2.885, 0.12);
  const doorLeaf = group(entryDoorLayout.hingeX, 0, entryDoorLayout.hingeZ);
  doorLeaf.name = "entry-door";
  const leafCenterX = -entryDoorLayout.width / 2;
  rounded(entryDoorLayout.width, entryDoorLayout.height, entryDoorLayout.depth, woodLight, 0.025,
    doorLeaf, leafCenterX, entryDoorLayout.height / 2, 0);
  for (const y of [0.68, 1.9])
    for (const side of [-1, 1])
      rounded(1.13, 0.94, 0.025, wood, 0.025, doorLeaf, leafCenterX, y, side * 0.065);
  for (const side of [-1, 1]) {
    rounded(0.07, 0.22, 0.035, brass, 0.02, doorLeaf, leafCenterX - 0.54, 1.25, side * 0.087);
    rounded(0.22, 0.035, 0.07, brass, 0.015, doorLeaf, leafCenterX - 0.46, 1.27, side * 0.12);
  }
  const doorCollider: RoomObstacle = {
    id: "entry-door",
    ...entryDoorPose(0),
    width: entryDoorLayout.width,
    depth: entryDoorLayout.depth,
    base: 0,
    top: entryDoorLayout.height,
    enabled: true,
  };
  obstacles.push(doorCollider);
  const doorMotion = createEntryDoorMotion(
    (angle) => {
      doorLeaf.rotation.y = angle;
      Object.assign(doorCollider, entryDoorPose(angle));
    },
    (angle) => {
      if (avatar.position.y >= doorCollider.top || avatar.position.y + PLAYER_HEIGHT <= doorCollider.base)
        return false;
      return overlapsObstacle(avatar.position.x, avatar.position.z, AVATAR_RADIUS,
        { ...doorCollider, ...entryDoorPose(angle) });
    },
  );
  rounded(0.15, 0.19, 0.035, white, 0.014, scene, 1.65, 1.3, 3.91);
  rounded(0.065, 0.09, 0.018, cream, 0.01, scene, 1.65, 1.3, 3.886);

  // A small sunlit terrace is continuous with the floor beyond the doorway.
  // Subtle paving joints and two planted pots keep its scale domestic.
  const pavingJoint = mat("#b8ae98");
  for (const x of [1.04, 2.08, 3.12, 4.16])
    box(0.009, 0.002, 3.82, pavingJoint, scene, x, 0.001, 6.04);
  for (const z of [5.04, 6.08, 7.12])
    box(5.04, 0.002, 0.009, pavingJoint, scene, 2.6, 0.001, z);
  for (const x of [0.6, 4.6]) {
    const pot = group(x, 0, 7.45);
    cylinder(0.32, 0.25, 0.56, terracotta, pot, 0, 0.28, 0, 32);
    cylinder(0.29, 0.29, 0.025, woodDark, pot, 0, 0.555, 0, 32);
    for (let index = 0; index < 7; index++) {
      const angle = index * 2.4;
      const leaf = sphere(0.21, green, pot, Math.sin(angle) * 0.17, 0.72 + (index % 3) * 0.13,
        Math.cos(angle) * 0.17);
      leaf.scale.set(0.72, 1.45, 0.72);
      leaf.rotation.z = Math.cos(angle) * 0.34;
    }
    obstruction(`terrace-planter-${x < 2.6 ? "left" : "right"}`, x, 7.45, 0.64, 0.64, 0.56);
  }

  // Original geometric wall art and a shallow ledge, with no fabricated records.
  const wallArt = group(4.9, 2.8, 1.65);
  wallArt.rotation.y = -Math.PI / 2;
  rounded(1.45, 1.65, 0.06, woodDark, 0.02, wallArt);
  box(1.34, 1.54, 0.025, linen, wallArt, 0, 0, 0.045);
  const artDisc = cylinder(
    0.38,
    0.38,
    0.012,
    terracotta,
    wallArt,
    0.13,
    0.25,
    0.068,
    48,
  );
  artDisc.rotation.x = Math.PI / 2;
  rounded(0.7, 0.5, 0.015, blueLight, 0.08, wallArt, -0.22, -0.31, 0.071);
  rounded(0.64, 0.08, 0.02, dark, 0.02, wallArt, 0.26, -0.42, 0.085);
  rounded(0.24, 0.1, 2.6, woodLight, 0.025, scene, 4.78, 1.77, 1.7);
  // A compact ceiling shade leaves the room airy and the jump space clear.
  cylinder(0.022, 0.022, 0.27, brass, scene, 0.4, 4.42, 0.1, 12);
  cylinder(0.28, 0.58, 0.25, linen, scene, 0.4, 4.17, 0.1, 48);
  cylinder(0.45, 0.45, 0.025, white, scene, 0.4, 4.045, 0.1, 48);

  // Window and a subtle exterior gradient, intentionally no invented scenery.
  const skyCanvas = document.createElement("canvas");
  skyCanvas.width = 16;
  skyCanvas.height = 256;
  const skyCtx = skyCanvas.getContext("2d")!;
  const skyGradient = skyCtx.createLinearGradient(0, 0, 0, 256);
  skyGradient.addColorStop(0, "#aecbd2");
  skyGradient.addColorStop(0.7, "#e2ebe4");
  skyGradient.addColorStop(1, "#e9e5cd");
  skyCtx.fillStyle = skyGradient;
  skyCtx.fillRect(0, 0, 16, 256);
  const skyTexture = new THREE.CanvasTexture(skyCanvas);
  skyTexture.colorSpace = THREE.SRGBColorSpace;
  scope.own(skyTexture);
  const skyMaterial = new THREE.MeshBasicMaterial({
    map: skyTexture,
    side: THREE.DoubleSide,
  });
  scope.own(skyMaterial);
  const sky = new THREE.Mesh(
    scope.own(new THREE.PlaneGeometry(4.1, 2.95)),
    skyMaterial,
  );
  sky.rotation.y = Math.PI / 2;
  sky.position.set(-5.02, 2.32, -0.82);
  scene.add(sky);
  for (const z of [-2.98, 1.34])
    box(0.23, 3.1, 0.09, woodLight, scene, -4.91, 2.3, z);
  for (const y of [0.77, 3.86])
    box(0.24, 0.09, 4.4, woodLight, scene, -4.91, y, -0.82);
  box(0.17, 2.95, 0.055, white, scene, -4.8, 2.31, -0.82);
  box(0.18, 0.055, 4.22, white, scene, -4.8, 2.21, -0.82);
  rounded(0.55, 0.11, 4.65, white, 0.025, scene, -4.74, 0.76, -0.82);
  const rod = cylinder(0.025, 0.025, 4.9, brass, scene, -4.62, 4.04, -0.82, 12);
  rod.rotation.x = Math.PI / 2;
  const curtain = new THREE.Group();
  curtain.position.set(-4.58, 2.35, -0.82);
  scene.add(curtain);
  for (const side of [-1, 1]) {
    for (let i = 0; i < 8; i++) {
      const fold = cylinder(
        0.066,
        0.085,
        3.25 - i * 0.008,
        linen,
        curtain,
        Math.sin(i * 0.9) * 0.045,
        0,
        side * (1.72 + i * 0.075),
        12,
      );
      fold.scale.x = 0.55;
    }
  }
  // Sunlit rectangles echo the window mullions across the floor.
  const sunlight = new THREE.MeshBasicMaterial({
    color: "#fff2c7",
    transparent: true,
    opacity: 0.14,
    depthWrite: false,
  });
  scope.own(sunlight);
  for (const z of [-1.5, 0.1]) {
    const patch = new THREE.Mesh(
      scope.own(new THREE.PlaneGeometry(3.1, 1.37)),
      sunlight,
    );
    patch.rotation.x = -Math.PI / 2;
    patch.rotation.z = -0.15;
    patch.position.set(-2.4, 0.014, z);
    scene.add(patch);
  }

  // Low ash bed, layered linen, gently rumpled duvet represented with soft solids.
  const bedLayout = furnitureLayout.bed;
  const bed = createFurnitureGroup(scene, bedLayout);
  for (const x of [-0.88, 0.88])
    for (const z of [-1.52, 1.52])
      cylinder(0.065, 0.05, 0.42, woodDark, bed, x, 0.2, z, 12);
  furniturePart(bedLayout.frame, woodLight, 0.07, bed);
  furniturePart(bedLayout.mattress, white, 0.13, bed);
  furniturePart(bedLayout.headboard, woodLight, 0.06, bed);
  furniturePart(bedLayout.duvet, blueLight, 0.09, bed);
  furniturePart(bedLayout.fold, linen, 0.04, bed);
  for (const x of [-0.53, 0.53]) {
    const pillow = furniturePart(bedLayout.pillow, linen, 0.11, bed);
    pillow.position.x = x;
    pillow.rotation.y = x * 0.08;
  }
  const throwBlanket = rounded(
    2.12,
    0.06,
    0.79,
    blue,
    0.025,
    bed,
    0,
    0.97,
    0.94,
  );
  throwBlanket.rotation.y = 0.025;
  for (let i = 0; i < 12; i++)
    box(0.011, 0.006, 0.74, blueLight, bed, -0.99 + i * 0.18, 1.004, 0.94);
  obstacles.push(
    furnitureObstacle(
      "bed",
      bed,
      bedLayout.frame,
      partTop(bedLayout.pillow) + bedLayout.supportMargin,
    ),
    furnitureObstacle("bed-headboard", bed, bedLayout.headboard),
  );

  // Atlas prints, real geography and achieved state, sit inside thin oak frames.
  const print = (
    section: "world" | "japan",
    x: number,
    y: number,
    w: number,
    h: number,
  ) => {
    const g = group(x, y, -3.86);
    rounded(w + 0.15, h + 0.15, 0.09, woodDark, 0.025, g);
    box(w + 0.04, h + 0.04, 0.045, white, g, 0, 0, 0.06);
    const texture =
      section === "world"
        ? createWorldMapTexture(archive.achieved.world)
        : createJapanMapTexture(archive.achieved.japan);
    scope.own(texture);
    const paper = new THREE.MeshStandardMaterial({
      map: texture,
      roughness: 0.96,
    });
    scope.own(paper);
    const mesh = new THREE.Mesh(
      scope.own(new THREE.PlaneGeometry(w, h)),
      paper,
    );
    mesh.position.z = 0.087;
    g.add(mesh);
    portal(
      section,
      g,
      furniturePoint(g, [
        0,
        section === "world" ? h / 2 + 0.12 : -h / 2 - 0.2,
        0.21,
      ]),
      furniturePoint(g, [0, 0, 0.16]),
    );
  };
  print("world", 0.35, 3.05, 4.0, 2.34);
  print("japan", -3.35, 3.16, 1.12, 1.6);

  // Slim work desk and a clearly legible, original phone screen.
  const deskLayout = furnitureLayout.desk;
  const desk = createFurnitureGroup(scene, deskLayout);
  const deskSurface = partTop(deskLayout.tabletop);
  furniturePart(deskLayout.tabletop, woodLight, 0.06, desk);
  const deskLegHeight = deskSurface - 0.11;
  for (const sideX of [-1, 1])
    for (const sideZ of [-1, 1])
      rounded(
        0.09,
        deskLegHeight,
        0.09,
        woodDark,
        0.02,
        desk,
        sideX * (deskLayout.tabletop.width / 2 - 0.26),
        deskLegHeight / 2 + 0.005,
        sideZ * (deskLayout.tabletop.depth / 2 - 0.19),
      );
  rounded(0.85, 0.4, 1.1, wood, 0.03, desk, 0.78, deskSurface - 0.35, 0);
  rounded(
    0.17,
    0.035,
    0.035,
    brass,
    0.015,
    desk,
    0.78,
    deskSurface - 0.33,
    0.56,
  );
  // Phone on a fine angled stand: flat metal sides, pill camera cutout, no brand mark.
  const phone = group(-0.45, deskSurface + 0.59, 0.2, desk);
  phone.rotation.x = -0.2;
  phone.rotation.y = -0.18;
  const titanium = mat("#9a9b91", 0.31, 0.8);
  rounded(0.74, 1.38, 0.085, titanium, 0.075, phone);
  rounded(0.706, 1.34, 0.018, charcoal, 0.065, phone, 0, 0, 0.049);
  const phoneTexture = createPhoneTexture(
    archive.normal.size,
    archive.shiny.size,
  );
  scope.own(phoneTexture);
  const phoneScreenMaterial = new THREE.MeshBasicMaterial({
    map: phoneTexture,
    color: new THREE.Color().setRGB(0.65, 0.65, 0.65),
  });
  scope.own(phoneScreenMaterial);
  const screen = rounded(
    0.657,
    1.275,
    0.008,
    phoneScreenMaterial,
    0.056,
    phone,
    0,
    0,
    0.061,
  );
  screen.castShadow = false;
  rounded(0.22, 0.057, 0.013, charcoal, 0.028, phone, 0, 0.553, 0.07);
  rounded(0.24, 0.012, 0.008, charcoal, 0.006, phone, 0, -0.586, 0.07);
  rounded(0.014, 0.14, 0.027, titanium, 0.006, phone, -0.38, 0.18, 0);
  rounded(0.014, 0.2, 0.027, titanium, 0.006, phone, 0.38, 0.12, 0);
  rounded(
    0.5,
    0.045,
    0.36,
    titanium,
    0.02,
    desk,
    -0.45,
    deskSurface + 0.03,
    0.07,
  );
  rounded(
    0.25,
    0.3,
    0.045,
    titanium,
    0.02,
    desk,
    -0.45,
    deskSurface + 0.17,
    -0.01,
  );
  desk.updateMatrixWorld(true);
  portal(
    "pokemon",
    phone,
    furniturePoint(desk, [
      phone.position.x - 0.03,
      phone.position.y + 0.87,
      phone.position.z + 0.07,
    ]),
    furniturePoint(desk, [
      phone.position.x - 0.03,
      phone.position.y + 0.01,
      phone.position.z + 0.02,
    ]),
  );
  // Invisible hit volume belongs to the phone, comfortably wider than the physical glass.
  const hitMaterial = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  scope.own(hitMaterial);
  const phoneHitTarget = box(1.1, 1.64, 0.18, hitMaterial, phone, 0, 0, 0.02);
  phoneHitTarget.userData.roomHitTarget = true;
  phoneHitTarget.castShadow = false;
  // The owner's complete illustration sits in a freestanding wooden frame.
  const deskPhoto = new THREE.TextureLoader().load(deskPhotoUrl);
  deskPhoto.colorSpace = THREE.SRGBColorSpace;
  deskPhoto.anisotropy = 4;
  scope.own(deskPhoto);
  const photoFrame = scope.own(createPhotoFrame(deskPhoto));
  photoFrame.group.name = "desk-photo-frame";
  photoFrame.group.position.set(0.65, deskSurface, 0.24);
  photoFrame.group.rotation.y = -0.18;
  desk.add(photoFrame.group);
  desk.updateMatrixWorld(true);
  const frameBounds = new THREE.Box3().setFromObject(photoFrame.group);
  const frameCentre = frameBounds.getCenter(new THREE.Vector3());
  const frameSize = frameBounds.getSize(new THREE.Vector3());
  obstruction(
    "desk-photo-frame",
    frameCentre.x,
    frameCentre.z,
    frameSize.x,
    frameSize.z,
    frameSize.y,
    frameBounds.min.y,
  );

  // Existing desk lamp, next to the phone and the photograph.
  cylinder(0.21, 0.21, 0.035, dark, desk, -1.06, deskSurface + 0.03, -0.31);
  cylinder(
    0.025,
    0.025,
    0.78,
    dark,
    desk,
    -1.06,
    deskSurface + 0.44,
    -0.31,
    12,
  );
  const lampShade = cylinder(
    0.12,
    0.23,
    0.21,
    cream,
    desk,
    -1.06,
    deskSurface + 0.86,
    -0.31,
  );
  lampShade.rotation.z = -0.16;
  obstacles.push(furnitureObstacle("desk", desk, deskLayout.tabletop));

  const chairLayout = furnitureLayout.chair;
  const chair = createFurnitureGroup(scene, chairLayout);
  for (const x of [-0.32, 0.32])
    for (const z of [-0.28, 0.28])
      cylinder(0.03, 0.025, 0.72, woodDark, chair, x, 0.36, z, 12);
  furniturePart(chairLayout.seat, blueLight, 0.06, chair);
  furniturePart(chairLayout.back, woodLight, 0.06, chair);
  obstacles.push(
    furnitureObstacle("chair-seat", chair, chairLayout.seat),
    furnitureObstacle(
      "chair-back",
      chair,
      chairLayout.back,
      partTop(chairLayout.back),
      partTop(chairLayout.seat),
    ),
  );

  // A mountain model and field books in a low, open console.
  const consoleLayout = furnitureLayout.console;
  const console = createFurnitureGroup(scene, consoleLayout);
  for (const y of consoleLayout.shelfHeights)
    furniturePart(
      { ...consoleLayout.shelf, position: [0, y, 0] },
      woodLight,
      0.025,
      console,
    );
  for (const x of [-0.57, 0.57])
    furniturePart(
      {
        ...consoleLayout.side,
        position: [x, consoleLayout.side.position[1], 0],
      },
      wood,
      0.025,
      console,
    );
  for (let i = 0; i < 6; i++) {
    const b = rounded(
      0.11 + (i % 2) * 0.035,
      0.45 + (i % 3) * 0.05,
      0.75,
      books[i % books.length],
      0.01,
      console,
      -0.38 + i * 0.15,
      0.52,
      0.03,
    );
    box(0.065, 0.01, 0.003, cream, b, 0, 0.11, 0.378);
  }
  rounded(0.69, 0.14, 0.72, linen, 0.015, console, 0, 1.03, 0.05);
  rounded(0.76, 0.09, 0.78, blue, 0.015, console, 0.02, 1.16, 0.02);
  const mountain = group(
    0,
    consoleLayout.shelfHeights[2] + consoleLayout.shelf.height / 2 + 0.02,
    0,
    console,
  );
  cylinder(0.53, 0.53, 0.055, woodDark, mountain, 0, 0, 0, 48);
  const mountainMat = mat("#8e9d8a");
  for (const [x, z, r, h] of [
    [-0.18, 0.08, 0.36, 0.56],
    [0.15, -0.12, 0.32, 0.84],
    [0.27, 0.2, 0.24, 0.43],
  ]) {
    const peak = new THREE.Mesh(
      scope.own(new THREE.ConeGeometry(r, h, 5)),
      mountainMat,
    );
    peak.position.set(x, h / 2 + 0.025, z);
    peak.castShadow = true;
    mountain.add(peak);
    const snow = new THREE.Mesh(
      scope.own(new THREE.ConeGeometry(r * 0.28, h * 0.28, 5)),
      white,
    );
    snow.position.set(x, h * 0.86 + 0.025, z);
    mountain.add(snow);
  }
  portal(
    "mountains",
    console,
    furniturePoint(console, [0, mountain.position.y + 1.07, 0]),
    furniturePoint(console, [0, mountain.position.y + 0.2, 0]),
  );
  obstacles.push(
    furnitureObstacle(
      "mountain-console",
      console,
      consoleLayout.shelf,
      partTop(consoleLayout.side),
    ),
  );

  // Woven rug, with a restrained stitched border, and a softly upholstered sofa.
  // A thin woven surface rests on the planks instead of swallowing the avatar's shoes.
  rounded(4.6, 0.008, 3.6, linen, 0.08, scene, -0.05, 0.0115, 1.55);
  const rugThread = mat("#b5af96");
  for (let i = 0; i < 30; i++)
    box(4.25, 0.001, 0.007, rugThread, scene, -0.05, 0.0165, -0.05 + i * 0.11);
  for (const z of [-0.13, 3.23])
    box(4.35, 0.002, 0.025, clay, scene, -0.05, 0.017, z);
  const sofaLayout = furnitureLayout.sofa;
  const sofa = createFurnitureGroup(scene, sofaLayout);
  for (const x of [-1.15, 1.15])
    for (const z of [-0.42, 0.42])
      cylinder(0.055, 0.045, 0.26, woodDark, sofa, x, 0.14, z, 12);
  furniturePart(sofaLayout.base, linen, 0.13, sofa);
  furniturePart(sofaLayout.back, linen, 0.12, sofa);
  for (const x of sofaLayout.armOffsets)
    furniturePart(
      { ...sofaLayout.arm, position: [x, sofaLayout.arm.position[1], 0] },
      linen,
      0.12,
      sofa,
    );
  for (const x of [-0.62, 0.62]) {
    furniturePart(
      {
        ...sofaLayout.cushion,
        position: [
          x,
          sofaLayout.cushion.position[1],
          sofaLayout.cushion.position[2],
        ],
      },
      cream,
      0.1,
      sofa,
    );
    const pillow = rounded(1.08, 0.59, 0.23, cream, 0.11, sofa, x, 1.04, -0.31);
    pillow.rotation.x = -0.12;
  }
  const accent = rounded(0.53, 0.55, 0.19, blue, 0.09, sofa, -0.8, 1.1, 0.07);
  accent.rotation.z = -0.15;
  accent.rotation.x = -0.16;
  const accent2 = rounded(
    0.44,
    0.47,
    0.17,
    terracotta,
    0.07,
    sofa,
    0.84,
    1.02,
    0.03,
  );
  accent2.rotation.z = 0.22;
  obstacles.push(...sofaObstacles(sofa));

  const coffeeLayout = furnitureLayout.coffee;
  const coffee = createFurnitureGroup(scene, coffeeLayout);
  const coffeeSurface = partTop(coffeeLayout.tabletop);
  const coffeeLegHeight = coffeeSurface - 0.135;
  for (const sideX of [-1, 1])
    for (const sideZ of [-1, 1])
      cylinder(
        0.045,
        0.035,
        coffeeLegHeight,
        woodDark,
        coffee,
        sideX * (coffeeLayout.tabletop.width / 2 - 0.23),
        coffeeLegHeight / 2 + 0.03,
        sideZ * (coffeeLayout.tabletop.depth / 2 - 0.17),
        12,
      );
  furniturePart(coffeeLayout.tabletop, woodLight, 0.2, coffee);
  // A silver-and-leather camera replaces the magazine on the low table.
  const tableCamera = scope.own(createTableCamera());
  tableCamera.group.name = "coffee-table-camera";
  tableCamera.group.scale.setScalar(0.82);
  tableCamera.group.position.set(-0.34, coffeeSurface, -0.12);
  tableCamera.group.rotation.y = 0.3;
  coffee.add(tableCamera.group);
  coffee.updateMatrixWorld(true);
  const cameraBounds = new THREE.Box3().setFromObject(tableCamera.group);
  const cameraCentre = cameraBounds.getCenter(new THREE.Vector3());
  const cameraSize = cameraBounds.getSize(new THREE.Vector3());
  obstruction(
    "coffee-table-camera",
    cameraCentre.x,
    cameraCentre.z,
    cameraSize.x,
    cameraSize.z,
    cameraSize.y,
    cameraBounds.min.y,
  );
  // Thin, overlapping travel prints replace the cup and its coaster.
  const polaroidPhoto = new THREE.TextureLoader().load(polaroidPhotoUrl);
  polaroidPhoto.colorSpace = THREE.SRGBColorSpace;
  polaroidPhoto.anisotropy = 8;
  scope.own(polaroidPhoto);
  const tablePolaroids = scope.own(createTablePolaroids(polaroidPhoto));
  tablePolaroids.group.name = "coffee-table-polaroids";
  tablePolaroids.group.position.set(0.36, coffeeSurface, 0.09);
  coffee.add(tablePolaroids.group);
  portal(
    "instagram",
    tablePolaroids.group,
    furniturePoint(tablePolaroids.group, [0, 0.015, 0]),
    furniturePoint(tablePolaroids.group, [0, 0.005, 0]),
  );
  obstacles.push(
    furnitureObstacle("coffee-table", coffee, coffeeLayout.tabletop),
  );

  // Leaf geometry, handcrafted with elongated ellipsoids, casts soft botanical shadows.
  const plant = (
    x: number,
    y: number,
    z: number,
    size: number,
    parent: THREE.Object3D = scene,
  ) => {
    const g = group(x, y, z, parent);
    g.scale.setScalar(size);
    cylinder(0.21, 0.16, 0.39, clay, g, 0, 0.2, 0);
    cylinder(0.18, 0.18, 0.018, woodDark, g, 0, 0.399, 0);
    for (let i = 0; i < 8; i++) {
      const angle = i * 2.399;
      const height = 0.65 + (i % 3) * 0.13;
      const stem = cylinder(
        0.009,
        0.009,
        height - 0.35,
        green,
        g,
        Math.cos(angle) * 0.045,
        (height + 0.35) / 2,
        Math.sin(angle) * 0.045,
        6,
      );
      stem.rotation.z = Math.cos(angle) * 0.14;
      const leaf = sphere(
        0.13,
        green,
        g,
        Math.cos(angle) * 0.19,
        height,
        Math.sin(angle) * 0.19,
      );
      leaf.scale.set(0.55, 1.9, 0.85);
      leaf.rotation.z = Math.cos(angle) * -0.7;
      leaf.rotation.x = Math.sin(angle) * 0.7;
    }
    return g;
  };
  const windowPlant = plant(-4.56, 0.82, 1.03, 0.85);
  registerBreakable(
    "window-planter",
    "窓辺の鉢",
    windowPlant,
    ["#d7c1a3", "#57755b"],
    0.82,
  );
  const floorPlant = plant(4.15, 0, 2.44, 1.7);
  registerBreakable("floor-planter", "床の鉢", floorPlant, [
    "#d7c1a3",
    "#57755b",
  ]);
  obstruction("floor-planter", 4.15, 2.44, 0.65, 0.65, 0.68);
  const bedsideLayout = furnitureLayout.bedside;
  const bedside = createFurnitureGroup(scene, bedsideLayout);
  const bedsideSurface = partTop(bedsideLayout.tabletop);
  furniturePart(bedsideLayout.body, woodLight, 0.035, bedside);
  furniturePart(bedsideLayout.tabletop, wood, 0.018, bedside);
  const bedsidePlant = plant(0, bedsideSurface + 0.005, 0, 0.58, bedside);
  registerBreakable(
    "bedside-planter",
    "ベッドサイドの鉢",
    bedsidePlant,
    ["#d7c1a3", "#57755b"],
    furniturePoint(bedside, [0, bedsideSurface, 0]).y,
  );
  obstacles.push(
    furnitureObstacle("bedside", bedside, bedsideLayout.body, bedsideSurface),
  );

  // A freestanding ceramic sculpture is deliberately reachable from the entry.
  const entrySculpture = group(1.4, 0.121, 1.3);
  entrySculpture.scale.setScalar(0.55);
  cylinder(0.27, 0.28, 0.22, woodLight, entrySculpture, 0, -0.11, 0, 32);
  cylinder(0.26, 0.28, 0.16, terracotta, entrySculpture, 0, 0.08, 0, 32);
  cylinder(0.25, 0.28, 0.54, terracotta, entrySculpture, 0, 0.43, 0, 32);
  const sculptedBody = sphere(0.27, clay, entrySculpture, 0, 0.88, 0);
  sculptedBody.scale.set(1, 1.35, 1);
  cylinder(0.13, 0.16, 0.18, clay, entrySculpture, 0, 1.19, 0, 24);
  cylinder(0.106, 0.106, 0.009, woodDark, entrySculpture, 0, 1.284, 0, 24);
  registerBreakable("entry-vase", "陶器のオブジェ", entrySculpture, [
    "#b67b60",
    "#d7c1a3",
    "#bf9469",
  ]);
  obstruction("entry-vase", 1.4, 1.3, 0.308, 0.308, 0.82775);

  const woodBlocks = group(-0.85, 0, -1.0);
  for (let i = 0; i < 3; i++) {
    const block = rounded(
      0.3,
      0.2,
      0.3,
      i === 1 ? blue : woodLight,
      0.025,
      woodBlocks,
      (i % 2) * 0.12,
      0.1 + i * 0.2,
      0,
    );
    block.rotation.y = i * 0.3;
  }
  registerBreakable("wood-blocks", "積み木", woodBlocks, [
    "#d0ad83",
    "#718f99",
  ]);
  obstruction("wood-blocks", -0.8, -1, 0.5, 0.45, 0.6);

  const character = scope.own(createCharacter());
  const avatar = character.group;
  scene.add(avatar);
  // The bird is a living, solid room occupant, never a destructible prop.
  const bird = scope.own(createBird());
  scene.add(bird.group);

  return {
    scene,
    avatar,
    bird: bird.group,
    portals,
    obstacles,
    breakables,
    door: {
      object: doorLeaf,
      open: doorMotion.open,
      isOpen: doorMotion.isOpen,
    },
    animateAvatar: character.animate,
    animateBird: bird.animate,
    breakObject(id, impulse) {
      const target = breakables.find((item) => item.id === id);
      if (!target || target.broken || !fractureSystem.breakObject(id, impulse))
        return false;
      target.broken = true;
      for (const collider of obstacles)
        if (collider.id === id) collider.enabled = false;
      return true;
    },
    resetObjects() {
      fractureSystem.resetObjects();
      for (const target of breakables) target.broken = false;
      for (const collider of obstacles)
        if (breakables.some((target) => target.id === collider.id)) collider.enabled = true;
    },
    animate(time, _moving, reducedMotion) {
      const delta = Math.max(0, time - lastAnimationTime);
      lastAnimationTime = time;
      doorMotion.animate(delta, reducedMotion);
      fractureSystem.animate(delta, reducedMotion);
      for (const entry of portals) {
        const target = entry.object.userData.active ? 1.025 : 1;
        const scale = reducedMotion
          ? target
          : THREE.MathUtils.lerp(entry.object.scale.x, target, 0.16);
        entry.object.scale.setScalar(scale);
      }
      const brightnessTarget = phone.userData.active ? 1 : 0.65;
      const brightness = reducedMotion
        ? brightnessTarget
        : THREE.MathUtils.lerp(
            phoneScreenMaterial.color.r,
            brightnessTarget,
            0.12,
          );
      phoneScreenMaterial.color.setRGB(brightness, brightness, brightness);
      if (!reducedMotion) curtain.rotation.z = Math.sin(time * 0.55) * 0.007;
    },
    dispose: scope.dispose,
  };
}
