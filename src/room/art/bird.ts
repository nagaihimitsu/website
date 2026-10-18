import * as THREE from "three";
import { mergeGeometries, mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";

export interface BirdAnimationState {
  time: number;
  /** 0 … 1 through a single hop; null while both feet are on the floor. */
  hopPhase: number | null;
  heading: number;
  moving: boolean;
  reducedMotion: boolean;
}

/**
 * Original little room bird, sculpted against the supplied three-view reference.
 * Local -Z is forward and the soles rest at Y=0; total height is 0.45 metres.
 * Root position / rotation belongs to the NPC controller, never the animation.
 */
export function createBird() {
  const group = new THREE.Group();
  group.name = "bird-npc";
  group.userData.damageable = false;
  const sculpture = new THREE.Group();
  sculpture.name = "bird-soft-body";
  group.add(sculpture);
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const remember = <T extends THREE.BufferGeometry>(geometry: T): T => {
    geometries.add(geometry);
    return geometry;
  };
  function smoothSculpt(geometry: THREE.BufferGeometry) {
    // Weld the UV seam and pole vertices after sculpting. Otherwise smooth
    // normals on a deformed sphere leave a visible stripe down the silhouette.
    geometry.deleteAttribute("normal");
    geometry.deleteAttribute("uv");
    const welded = mergeVertices(geometry, 0.000001);
    welded.computeVertexNormals();
    geometry.dispose();
    return remember(welded);
  }
  const satin = (color: string, roughness: number) => {
    const result = new THREE.MeshPhysicalMaterial({
      color,
      roughness,
      metalness: 0,
      clearcoat: 0.07,
      clearcoatRoughness: 0.48,
      sheen: 0.16,
      sheenRoughness: 0.8,
      sheenColor: new THREE.Color(color),
    });
    materials.add(result);
    return result;
  };
  const white = satin("#f4f1ee", 0.66);
  const wingMaterial = satin("#ffffff", 0.62);
  wingMaterial.vertexColors = true;
  const tailMaterial = satin("#575c68", 0.64);
  const feetMaterial = satin("#654332", 0.66);
  const beakMaterial = satin("#ffffff", 0.38);
  beakMaterial.vertexColors = true;
  const eyeMaterial = satin("#211a16", 0.14);
  eyeMaterial.clearcoat = 0.8;
  eyeMaterial.clearcoatRoughness = 0.1;
  const glintMaterial = new THREE.MeshBasicMaterial({
    color: "#fffaf0",
    toneMapped: false,
  });
  materials.add(glintMaterial);
  const sphere = remember(new THREE.SphereGeometry(1, 24, 16));

  function mesh(
    name: string,
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    parent: THREE.Object3D = sculpture,
  ) {
    const result = new THREE.Mesh(geometry, material);
    result.name = name;
    result.castShadow = true;
    result.receiveShadow = true;
    parent.add(result);
    return result;
  }
  function oval(
    name: string,
    size: [number, number, number],
    position: [number, number, number],
    material: THREE.Material,
    parent: THREE.Object3D = sculpture,
  ) {
    const result = mesh(name, sphere, material, parent);
    result.position.set(...position);
    result.scale.set(...size);
    return result;
  }

  // A single continuous pear, with a full lower breast and a narrow soft crown.
  // The head is not an intersecting sphere: there is no neck seam in any view.
  const profile = new THREE.CatmullRomCurve3(
    [
      [0, 0.069, 0],
      [0.028, 0.069, 0.025],
      [0.064, 0.081, 0.058],
      [0.111, 0.119, 0.093],
      [0.135, 0.181, 0.117],
      [0.133, 0.236, 0.119],
      [0.113, 0.294, 0.104],
      [0.106, 0.353, 0.098],
      [0.093, 0.399, 0.086],
      [0.059, 0.436, 0.056],
      [0.027, 0.45, 0.025],
      [0, 0.45, 0],
    ].map(([x, y, z]) => new THREE.Vector3(x, y, z)),
    false,
    "catmullrom",
    0.45,
  );
  const bodyGeometry = new THREE.SphereGeometry(1, 48, 64);
  const bodyPositions = bodyGeometry.getAttribute("position");
  for (let i = 0; i < bodyPositions.count; i++) {
    const unitY = THREE.MathUtils.clamp(bodyPositions.getY(i), -1, 1);
    const t = 1 - Math.acos(unitY) / Math.PI;
    const point = profile.getPoint(t);
    const azimuth = Math.atan2(bodyPositions.getZ(i), bodyPositions.getX(i));
    const centreZ = 0.008 - Math.sin(t * Math.PI) * 0.008;
    bodyPositions.setXYZ(
      i,
      Math.cos(azimuth) * point.x,
      point.y,
      centreZ + Math.sin(azimuth) * point.z,
    );
  }
  mesh("bird-continuous-white-pear", smoothSculpt(bodyGeometry), white);

  // Folded teardrop wings: the shoulder sits forward, the dark tip folds back.
  // Colour is on the sculpt itself, so there are no floating feather overlays.
  const wingGeometry = new THREE.SphereGeometry(1, 48, 40);
  const wingPositions = wingGeometry.getAttribute("position");
  const wingColors: number[] = [];
  const shoulderColor = new THREE.Color("#92949e");
  const featherColor = new THREE.Color("#505460");
  const color = new THREE.Color();
  for (let i = 0; i < wingPositions.count; i++) {
    const x = wingPositions.getX(i);
    const y = wingPositions.getY(i);
    const z = wingPositions.getZ(i);
    const t = (1 - y) / 2;
    const taper = 1 - t * 0.4;
    const depth = z * 0.1 * taper;
    wingPositions.setXYZ(i, x * 0.035, y * 0.074, depth + t * 0.085);
    // Oblique folded-feather boundary, softly transitioning over a narrow lip.
    const dark = THREE.MathUtils.smoothstep(t + z * 0.18, 0.62, 0.75);
    color.copy(shoulderColor).lerp(featherColor, dark);
    wingColors.push(color.r, color.g, color.b);
  }
  wingGeometry.setAttribute("color", new THREE.Float32BufferAttribute(wingColors, 3));
  const smoothWingGeometry = smoothSculpt(wingGeometry);
  const wings = [-1, 1].map((side) => {
    const root = new THREE.Group();
    root.name = side < 0 ? "bird-left-wing-pivot" : "bird-right-wing-pivot";
    root.position.set(side * 0.13, 0.205, 0.018);
    sculpture.add(root);
    const wing = mesh("bird-folded-wing", smoothWingGeometry, wingMaterial, root);
    wing.rotation.z = side * -0.12;
    wing.rotation.y = side * -0.58;
    return root;
  });

  const tail = new THREE.Group();
  tail.name = "bird-tail-pivot";
  tail.position.set(0, 0.158, 0.103);
  sculpture.add(tail);
  const tailShape = oval("bird-short-tail", [0.035, 0.014, 0.05], [0, 0, 0.032], tailMaterial, tail);
  tailShape.rotation.x = 0.15;

  const eyes = [-1, 1].map((side) => {
    const root = new THREE.Group();
    root.name = side < 0 ? "bird-left-eye" : "bird-right-eye";
    root.position.set(side * 0.06, 0.355, -0.076);
    root.rotation.y = side * -0.49;
    root.rotation.x = -0.02;
    sculpture.add(root);
    oval("bird-glossy-eye", [0.0096, 0.0131, 0.0061], [0, 0, -0.001], eyeMaterial, root);
    const glint = oval("bird-eye-small-softbox", [0.0016, 0.0023, 0.0006], [-0.0025, 0.0049, -0.0062], glintMaterial, root);
    glint.castShadow = false;
    glint.receiveShadow = false;
    return root;
  });

  const beakGeometry = remember(new THREE.SphereGeometry(1, 32, 20));
  const beakPositions = beakGeometry.getAttribute("position");
  const beakColors: number[] = [];
  const upperBeak = new THREE.Color("#e9ba2c");
  const lowerBeak = new THREE.Color("#a37a27");
  for (let i = 0; i < beakPositions.count; i++) {
    const x = beakPositions.getX(i);
    const y = beakPositions.getY(i);
    const z = beakPositions.getZ(i);
    const front = (1 - z) / 2;
    // The broad root narrows into a rounded, gently lowered bill, not a cone.
    beakPositions.setXYZ(i, x * 0.029 * (1 - front * 0.24), y * 0.016 - front * 0.003, z * 0.031);
    color.copy(lowerBeak).lerp(upperBeak, THREE.MathUtils.smoothstep(y, -0.36, 0.25));
    beakColors.push(color.r, color.g, color.b);
  }
  beakGeometry.setAttribute("color", new THREE.Float32BufferAttribute(beakColors, 3));
  beakGeometry.computeVertexNormals();
  mesh("bird-rounded-yellow-bill", beakGeometry, beakMaterial).position.set(0, 0.341, -0.121);

  const feet = [-1, 1].map((side) => {
    const root = new THREE.Group();
    root.name = side < 0 ? "bird-left-foot-pivot" : "bird-right-foot-pivot";
    root.position.set(side * 0.047, 0, 0.003);
    group.add(root);
    const pieces: THREE.BufferGeometry[] = [];
    const tube = (points: number[][], radius: number) => {
      const curve = new THREE.CatmullRomCurve3(points.map(([x, y, z]) => new THREE.Vector3(x, y, z)));
      pieces.push(new THREE.TubeGeometry(curve, 9, radius, 8, false));
    };
    tube([[0, 0.089, 0.002], [0, 0.054, 0.001], [0, 0.018, 0], [0, 0.01, -0.01]], 0.0087);
    for (const splay of [-1, 0, 1]) {
      const toeX = splay * 0.023;
      const toeZ = splay === 0 ? -0.037 : -0.026;
      tube([[0, 0.012, -0.005], [toeX * 0.5, 0.009, toeZ * 0.65], [toeX, 0.008, toeZ]], 0.0074);
      pieces.push(sphere.clone().scale(0.0074, 0.0074, 0.0074).translate(toeX, 0.008, toeZ));
    }
    tube([[0, 0.011, 0], [side * 0.003, 0.008, 0.016], [side * 0.006, 0.008, 0.021]], 0.006);
    pieces.push(sphere.clone().scale(0.006, 0.006, 0.006).translate(side * 0.006, 0.008, 0.021));
    const geometry = remember(mergeGeometries(pieces)!);
    for (const piece of pieces) piece.dispose();
    mesh("bird-brown-three-toed-foot", geometry, feetMaterial, root);
    return root;
  });

  let disposed = false;
  return {
    group,
    animate({ time, hopPhase, moving, reducedMotion }: BirdAnimationState) {
      if (disposed) return;
      const airborne = hopPhase !== null;
      const phase = hopPhase ?? 0;
      const lift = airborne ? Math.sin(phase * Math.PI) : 0;
      const decoration = reducedMotion ? 0 : 1;
      // Flight stretches by a few percent, with a compact soft landing at each
      // end of the hop; the controller owns the actual ballistic root motion.
      const squash = airborne
        ? 0.055 * lift ** 2 - 0.065 * Math.sin(phase * Math.PI * 2) ** 2
        : 0;
      sculpture.scale.set(1 - squash * 0.42 * decoration, 1 + squash * decoration, 1 - squash * 0.42 * decoration);
      sculpture.rotation.x = (airborne ? Math.sin(phase * Math.PI * 2) * 0.065 : 0) * decoration;
      sculpture.rotation.z = (!moving ? Math.sin(time * 1.1) * 0.018 : 0) * decoration;
      sculpture.position.y = (!moving ? Math.sin(time * 2.1) * 0.0014 : 0) * decoration;
      for (let i = 0; i < wings.length; i++) {
        const side = i === 0 ? -1 : 1;
        wings[i].rotation.z = side * (lift * 0.095 + Math.sin(time * 1.7) * 0.008) * decoration;
      }
      tail.rotation.x = (lift * -0.1 + Math.sin(time * 1.6) * 0.018) * decoration;
      for (const foot of feet) {
        foot.rotation.x = lift * -0.22 * decoration;
        foot.position.y = lift * 0.012 * decoration;
      }
      // A quick, infrequent blink reads naturally without constantly twitching.
      const blinkClock = (time + 0.8) % 5.3;
      const blink = blinkClock < 0.15 ? Math.sin((blinkClock / 0.15) * Math.PI) : 0;
      for (const eye of eyes) eye.scale.y = 1 - blink * 0.93 * decoration;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      group.removeFromParent();
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
      group.clear();
    },
  };
}
