import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import type { Archive, Section } from "../data/model";
import type { RoomScene, RoomObstacle, RoomPortal } from "./types";
import {
  createWorldMapTexture,
  createJapanMapTexture,
  createPhoneTexture,
} from "./art/textures";

/** All furniture and the visitor are original geometry. Maps use the site's local atlas. */
export function createRoomScene(archive: Archive): RoomScene {
  const scene = new THREE.Scene();
  const portals: RoomPortal[] = [];
  const obstacles: RoomObstacle[] = [];
  const materials: THREE.Material[] = [];
  const textures: THREE.Texture[] = [];
  const mat = (color: string, roughness = 0.75, metalness = 0) => {
    const value = new THREE.MeshStandardMaterial({
      color,
      roughness,
      metalness,
    });
    materials.push(value);
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
      new RoundedBoxGeometry(w, h, d, 2, Math.min(radius, w / 2, h / 2, d / 2)),
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
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
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
      new THREE.CylinderGeometry(top, bottom, height, segments),
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
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 20, 14), material);
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
    section: Section,
    object: THREE.Object3D,
    anchor: THREE.Vector3,
    lookAt: THREE.Vector3,
  ) => {
    object.userData.section = section;
    portals.push({ section, object, anchor, lookAt });
  };
  const obstruction = (x: number, z: number, width: number, depth: number) =>
    obstacles.push({ x, z, width, depth });

  // Lighting belongs to the room; the renderer enables real shadow maps.
  scene.add(new THREE.HemisphereLight("#fff9e8", "#b0a28e", 2.05));
  const sun = new THREE.DirectionalLight("#fff0cc", 3.5);
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
  box(10, 0.09, 8, woodDark, scene, 0, -0.075, 0);
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
  box(10.2, 4.65, 0.18, wall, scene, 0, 2.28, -4.05);
  // Left wall is cut around an actual luminous window opening.
  box(0.18, 4.65, 1.1, wall, scene, -5.05, 2.28, -3.5);
  box(0.18, 4.65, 2.65, wall, scene, -5.05, 2.28, 2.72);
  box(0.18, 0.9, 4.25, wall, scene, -5.05, 0.4, -0.85);
  box(0.18, 0.85, 4.25, wall, scene, -5.05, 4.18, -0.85);
  box(10.05, 0.13, 0.06, white, scene, 0, 0.08, -3.91);
  box(0.06, 0.13, 8, white, scene, -4.91, 0.08, 0);
  box(10.2, 0.08, 0.21, white, scene, 0, 4.62, -4.05);

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
  textures.push(skyTexture);
  const skyMaterial = new THREE.MeshBasicMaterial({
    map: skyTexture,
    side: THREE.DoubleSide,
  });
  materials.push(skyMaterial);
  const sky = new THREE.Mesh(new THREE.PlaneGeometry(4.1, 2.95), skyMaterial);
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
  materials.push(sunlight);
  for (const z of [-1.5, 0.1]) {
    const patch = new THREE.Mesh(new THREE.PlaneGeometry(3.1, 1.37), sunlight);
    patch.rotation.x = -Math.PI / 2;
    patch.rotation.z = -0.15;
    patch.position.set(-2.4, 0.014, z);
    scene.add(patch);
  }

  // Low ash bed, layered linen, gently rumpled duvet represented with soft solids.
  const bed = group(-3.35, 0, -1.85);
  for (const x of [-0.88, 0.88])
    for (const z of [-1.52, 1.52])
      cylinder(0.065, 0.05, 0.42, woodDark, bed, x, 0.2, z, 12);
  rounded(2.25, 0.22, 3.6, woodLight, 0.07, bed, 0, 0.4, 0);
  rounded(2.12, 0.3, 3.43, white, 0.13, bed, 0, 0.63, 0);
  rounded(2.18, 1.1, 0.12, woodLight, 0.06, bed, 0, 0.96, -1.8);
  rounded(2.11, 0.2, 2.58, blueLight, 0.09, bed, 0, 0.85, 0.37);
  rounded(2.13, 0.12, 0.38, linen, 0.04, bed, 0, 0.94, -0.83);
  for (const x of [-0.53, 0.53]) {
    const pillow = rounded(0.89, 0.23, 0.59, linen, 0.11, bed, x, 0.91, -1.29);
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
  obstruction(-3.35, -1.85, 2.35, 3.65);

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
    textures.push(texture);
    const paper = new THREE.MeshStandardMaterial({
      map: texture,
      roughness: 0.96,
    });
    materials.push(paper);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), paper);
    mesh.position.z = 0.087;
    g.add(mesh);
    portal(
      section,
      g,
      new THREE.Vector3(
        x,
        section === "world" ? y + h / 2 + 0.12 : y - h / 2 - 0.2,
        -3.65,
      ),
      new THREE.Vector3(x, y, -3.7),
    );
  };
  print("world", 0.35, 3.05, 4.0, 2.34);
  print("japan", -3.35, 3.16, 1.12, 1.6);

  // Slim work desk and a clearly legible, original phone screen.
  const desk = group(3.18, 0, -2.67);
  rounded(2.92, 0.14, 1.42, woodLight, 0.06, desk, 0, 1.29, 0);
  for (const x of [-1.2, 1.2])
    for (const z of [-0.52, 0.52])
      rounded(0.09, 1.25, 0.09, woodDark, 0.02, desk, x, 0.63, z);
  rounded(0.85, 0.4, 1.1, wood, 0.03, desk, 0.78, 1.01, 0);
  rounded(0.17, 0.035, 0.035, brass, 0.015, desk, 0.78, 1.03, 0.56);
  // Phone on a fine angled stand: flat metal sides, pill camera cutout, no brand mark.
  const phone = group(-0.45, 1.95, 0.2, desk);
  phone.rotation.x = -0.2;
  phone.rotation.y = -0.18;
  const titanium = mat("#9a9b91", 0.31, 0.8);
  rounded(0.74, 1.38, 0.085, titanium, 0.075, phone);
  rounded(0.706, 1.34, 0.018, charcoal, 0.065, phone, 0, 0, 0.049);
  const phoneTexture = createPhoneTexture(
    archive.normal.size,
    archive.shiny.size,
  );
  textures.push(phoneTexture);
  const phoneScreenMaterial = new THREE.MeshBasicMaterial({
    map: phoneTexture,
    color: new THREE.Color().setRGB(0.65, 0.65, 0.65),
  });
  materials.push(phoneScreenMaterial);
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
  rounded(0.5, 0.045, 0.36, titanium, 0.02, desk, -0.45, 1.39, 0.07);
  rounded(0.25, 0.3, 0.045, titanium, 0.02, desk, -0.45, 1.53, -0.01);
  desk.updateMatrixWorld(true);
  portal(
    "pokemon",
    phone,
    new THREE.Vector3(2.7, 2.82, -2.4),
    new THREE.Vector3(2.7, 1.96, -2.45),
  );
  // Invisible hit volume belongs to the phone, comfortably wider than the physical glass.
  const hitMaterial = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  materials.push(hitMaterial);
  const phoneHitTarget = box(1.1, 1.64, 0.18, hitMaterial, phone, 0, 0, 0.02);
  phoneHitTarget.userData.roomHitTarget = true;
  phoneHitTarget.castShadow = false;
  // Closed notebook, pen, small ceramic cup, desk lamp.
  const notebook = rounded(
    0.57,
    0.055,
    0.77,
    dark,
    0.025,
    desk,
    0.52,
    1.398,
    0.18,
  );
  notebook.rotation.y = -0.12;
  box(0.008, 0.007, 0.68, brass, notebook, 0.16, 0.032, 0);
  const pen = cylinder(0.014, 0.014, 0.5, brass, desk, 0.97, 1.39, 0.1, 10);
  pen.rotation.x = Math.PI / 2;
  pen.rotation.z = 0.35;
  cylinder(0.12, 0.095, 0.23, cream, desk, 1.03, 1.47, -0.36);
  cylinder(0.1, 0.1, 0.008, woodDark, desk, 1.03, 1.59, -0.36);
  cylinder(0.21, 0.21, 0.035, dark, desk, -1.06, 1.39, -0.31);
  cylinder(0.025, 0.025, 0.78, dark, desk, -1.06, 1.8, -0.31, 12);
  const lampShade = cylinder(0.12, 0.23, 0.21, cream, desk, -1.06, 2.22, -0.31);
  lampShade.rotation.z = -0.16;
  obstruction(3.18, -2.67, 3.05, 1.48);

  const chair = group(2.9, 0, -1.27);
  for (const x of [-0.32, 0.32])
    for (const z of [-0.28, 0.28])
      cylinder(0.03, 0.025, 0.72, woodDark, chair, x, 0.36, z, 12);
  rounded(0.82, 0.13, 0.75, blueLight, 0.06, chair, 0, 0.78, 0);
  rounded(0.85, 0.59, 0.1, woodLight, 0.06, chair, 0, 1.14, 0.32);
  obstruction(2.9, -1.27, 0.85, 0.8);

  // A mountain model and field books in a low, open console.
  const console = group(4.15, 0, 0.05);
  for (const y of [0.25, 0.92, 1.59])
    rounded(1.22, 0.08, 1.3, woodLight, 0.025, console, 0, y, 0);
  for (const x of [-0.57, 0.57])
    rounded(0.08, 1.64, 1.3, wood, 0.025, console, x, 0.85, 0);
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
  const mountain = group(0, 1.65, 0, console);
  cylinder(0.53, 0.53, 0.055, woodDark, mountain, 0, 0, 0, 48);
  const mountainMat = mat("#8e9d8a");
  for (const [x, z, r, h] of [
    [-0.18, 0.08, 0.36, 0.56],
    [0.15, -0.12, 0.32, 0.84],
    [0.27, 0.2, 0.24, 0.43],
  ]) {
    const peak = new THREE.Mesh(new THREE.ConeGeometry(r, h, 5), mountainMat);
    peak.position.set(x, h / 2 + 0.025, z);
    peak.castShadow = true;
    mountain.add(peak);
    const snow = new THREE.Mesh(
      new THREE.ConeGeometry(r * 0.28, h * 0.28, 5),
      white,
    );
    snow.position.set(x, h * 0.86 + 0.025, z);
    mountain.add(snow);
  }
  portal(
    "mountains",
    console,
    new THREE.Vector3(4.15, 2.72, 0.05),
    new THREE.Vector3(4.15, 1.85, 0.05),
  );
  obstruction(4.15, 0.05, 1.28, 1.38);

  // Woven rug, with a restrained stitched border, and a softly upholstered sofa.
  rounded(4.6, 0.035, 3.6, linen, 0.08, scene, -0.05, 0.035, 1.55);
  const rugThread = mat("#b5af96");
  for (let i = 0; i < 30; i++)
    box(4.25, 0.003, 0.007, rugThread, scene, -0.05, 0.056, -0.05 + i * 0.11);
  for (const z of [-0.13, 3.23])
    box(4.35, 0.005, 0.025, clay, scene, -0.05, 0.06, z);
  const sofa = group(-2.9, 0, 2.16);
  sofa.rotation.y = Math.PI / 2;
  for (const x of [-1.15, 1.15])
    for (const z of [-0.42, 0.42])
      cylinder(0.055, 0.045, 0.26, woodDark, sofa, x, 0.14, z, 12);
  rounded(2.85, 0.33, 1.32, linen, 0.13, sofa, 0, 0.43, 0);
  rounded(2.8, 0.91, 0.28, linen, 0.12, sofa, 0, 0.96, -0.53);
  for (const x of [-1.3, 1.3])
    rounded(0.26, 0.53, 1.3, linen, 0.12, sofa, x, 0.78, 0);
  for (const x of [-0.62, 0.62]) {
    rounded(1.13, 0.22, 1.02, cream, 0.1, sofa, x, 0.69, 0.08);
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
  obstruction(-2.9, 2.16, 1.45, 2.95);

  const coffee = group(-0.15, 0, 1.88);
  for (const x of [-0.62, 0.62])
    for (const z of [-0.4, 0.4])
      cylinder(0.045, 0.035, 0.5, woodDark, coffee, x, 0.28, z, 12);
  rounded(1.7, 0.11, 1.14, woodLight, 0.2, coffee, 0, 0.58, 0);
  const magazine = rounded(
    0.5,
    0.035,
    0.63,
    cream,
    0.01,
    coffee,
    -0.36,
    0.655,
    -0.08,
  );
  magazine.rotation.y = -0.15;
  rounded(0.38, 0.008, 0.35, blueLight, 0.003, magazine, 0, 0.023, -0.05);
  cylinder(0.12, 0.12, 0.025, woodDark, coffee, 0.38, 0.66, 0.17);
  cylinder(0.09, 0.07, 0.14, white, coffee, 0.38, 0.74, 0.17);
  cylinder(0.07, 0.07, 0.004, woodDark, coffee, 0.38, 0.812, 0.17);
  obstruction(-0.15, 1.88, 1.72, 1.17);

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
  plant(-4.56, 0.82, 1.03, 0.85);
  plant(4.15, 0, 2.44, 1.7);
  obstruction(4.15, 2.44, 0.65, 0.65);
  const bedside = group(-1.65, 0, -2.9);
  rounded(0.7, 0.7, 0.65, woodLight, 0.035, bedside, 0, 0.48, 0);
  rounded(0.6, 0.05, 0.64, wood, 0.018, bedside, 0, 0.87, 0);
  plant(0, 0.9, 0, 0.58, bedside);
  obstruction(-1.65, -2.9, 0.74, 0.7);

  // An original little visitor, with a knitted cap, simple clothing and a backpack.
  const avatar = new THREE.Group();
  scene.add(avatar);
  const skin = mat("#c9a180");
  const shirt = mat("#6b8582");
  const pants = mat("#626c66");
  const shoes = mat("#e9e2cc");
  const leftLeg = group(-0.105, 0.34, 0, avatar);
  const rightLeg = group(0.105, 0.34, 0, avatar);
  rounded(0.14, 0.28, 0.16, pants, 0.045, leftLeg, 0, -0.12, 0);
  rounded(0.14, 0.28, 0.16, pants, 0.045, rightLeg, 0, -0.12, 0);
  rounded(0.17, 0.12, 0.24, shoes, 0.05, leftLeg, 0, -0.28, 0.045);
  rounded(0.17, 0.12, 0.24, shoes, 0.05, rightLeg, 0, -0.28, 0.045);
  rounded(0.37, 0.39, 0.25, shirt, 0.1, avatar, 0, 0.53, 0);
  const leftArm = group(-0.23, 0.68, 0, avatar);
  const rightArm = group(0.23, 0.68, 0, avatar);
  for (const arm of [leftArm, rightArm]) {
    rounded(0.13, 0.28, 0.14, shirt, 0.05, arm, 0, -0.1, 0);
    sphere(0.07, skin, arm, 0, -0.25, 0);
  }
  cylinder(0.062, 0.065, 0.08, skin, avatar, 0, 0.775, 0, 12);
  const head = sphere(0.19, skin, avatar, 0, 0.94, 0.008);
  head.scale.set(0.91, 1.03, 0.93);
  const cap = sphere(0.194, dark, avatar, 0, 1.035, -0.007);
  cap.scale.set(1, 0.64, 1.01);
  cylinder(0.19, 0.19, 0.055, dark, avatar, 0, 1.015, -0.007, 24);
  sphere(0.044, dark, avatar, 0, 1.17, -0.007);
  for (const x of [-0.055, 0.055])
    sphere(0.014, charcoal, avatar, x, 0.95, 0.172);
  rounded(0.23, 0.28, 0.11, terracotta, 0.055, avatar, 0, 0.55, -0.17);
  for (const x of [-0.115, 0.115])
    rounded(0.035, 0.34, 0.035, terracotta, 0.01, avatar, x, 0.55, 0.13);
  // Contact shadow remains directly below the avatar at any jumping height.
  const contact = new THREE.Mesh(
    new THREE.CircleGeometry(0.28, 32),
    new THREE.MeshBasicMaterial({
      color: "#514c3b",
      transparent: true,
      opacity: 0.12,
      depthWrite: false,
    }),
  );
  materials.push(contact.material);
  contact.rotation.x = -Math.PI / 2;
  contact.position.y = 0.015;
  scene.add(contact);

  return {
    scene,
    avatar,
    portals,
    obstacles,
    animate(time, moving, reducedMotion) {
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
      const swing = moving ? Math.sin(time * 10) * 0.48 : 0;
      leftLeg.rotation.x = swing;
      rightLeg.rotation.x = -swing;
      leftArm.rotation.x = -swing * 0.8;
      rightArm.rotation.x = swing * 0.8;
      if (!reducedMotion) curtain.rotation.z = Math.sin(time * 0.55) * 0.007;
      contact.position.x = avatar.position.x;
      contact.position.z = avatar.position.z;
      contact.scale.setScalar(1 + Math.max(0, avatar.position.y) * 0.3);
      (contact.material as THREE.MeshBasicMaterial).opacity =
        0.12 / (1 + Math.max(0, avatar.position.y));
    },
    dispose() {
      const geometries = new Set<THREE.BufferGeometry>();
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh) geometries.add(object.geometry);
      });
      geometries.forEach((g) => g.dispose());
      materials.forEach((m) => m.dispose());
      textures.forEach((t) => t.dispose());
      sun.shadow.map?.dispose();
      scene.clear();
    },
  };
}
