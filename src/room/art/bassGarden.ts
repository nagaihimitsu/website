import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { withDisposalScope, type DisposalScope } from "../disposal";

export const BASS_GARDEN_LAYOUT = {
  interaction: { x: 1.65, z: 5.65, radius: 0.85 },
  amplifier: { x: 0.8, z: 6.5, width: 0.66, depth: 0.37, height: 0.67 },
  flowerbed: { x: 1.25, z: 7.5, width: 2, depth: 0.76, height: 0.24 },
} as const;

export type BassGardenPerformance = {
  playing: boolean;
  /** Fractional beats elapsed in the current song, independent of render rate. */
  beat: number;
  /** Successful-note pulse only; an off-beat pluck must not celebrate. */
  success: number;
  /** Last physically plucked HUD row: G=0, D=1, A=2, E=3. */
  string?: number;
};

/**
 * Original, unbranded garden instrument. The instrument's origin is its body
 * centre, neck is +Y and face is +Z. It can be reparented to the avatar; the
 * cable follows its actual jack in world space without replacing geometries.
 */
export function createBassGarden() {
  return withDisposalScope((scope) => buildBassGarden(scope));
}

function buildBassGarden(scope: DisposalScope) {
  const group = new THREE.Group();
  group.name = "terrace-bass-garden";
  const instrument = new THREE.Group();
  instrument.name = "garden-four-string-bass";
  group.add(instrument);
  scope.defer(() => { instrument.removeFromParent(); group.removeFromParent(); group.clear(); });

  const own = scope.own;
  const surface = (color: string, roughness = 0.65, metalness = 0) => own(new THREE.MeshStandardMaterial({ color, roughness, metalness }));
  const ink = surface("#25282a", 0.74);
  const rubber = surface("#15191a", 0.88);
  const silver = surface("#c1c3bb", 0.28, 0.72);
  const warmMetal = surface("#a7a28e", 0.43, 0.54);
  const ivory = surface("#ede2c9", 0.41);
  const maple = surface("#c79d63", 0.53);
  const rosewood = surface("#4d342c", 0.67);
  const clay = surface("#b9856b", 0.94);
  const clayLight = surface("#c89478", 0.94);
  const clayDark = surface("#a87460", 0.96);
  const soil = surface("#524c39", 1);
  const stemMaterial = surface("#667452", 0.89);
  const leafMaterial = surface("#87906b", 0.9);
  const flowerMaterials = ["#d99785", "#dfbd70", "#b4a5bc", "#e7dfc1", "#b77574"].map((color) => surface(color, 0.83));
  const pollenMaterial = surface("#a78a50", 0.96);
  const emissive = own(new THREE.MeshStandardMaterial({ color: "#b7d795", emissive: "#83a95c", emissiveIntensity: 0.35, roughness: 0.43 }));

  const sphereGeometry = own(new THREE.SphereGeometry(1, 16, 10));
  function mesh(name: string, geometry: THREE.BufferGeometry, material: THREE.Material, parent: THREE.Object3D = group) {
    const item = new THREE.Mesh(geometry, material);
    item.name = name;
    item.castShadow = true;
    item.receiveShadow = true;
    parent.add(item);
    return item;
  }
  function box(name: string, size: [number, number, number], position: [number, number, number], material: THREE.Material, parent: THREE.Object3D = group, radius = 0.008) {
    const item = mesh(name, own(new RoundedBoxGeometry(...size, 1, radius)), material, parent);
    item.position.set(...position);
    return item;
  }
  function sphere(name: string, size: [number, number, number], position: [number, number, number], material: THREE.Material, parent: THREE.Object3D = group) {
    const item = mesh(name, sphereGeometry, material, parent);
    item.scale.set(...size);
    item.position.set(...position);
    return item;
  }
  function rod(name: string, a: THREE.Vector3, b: THREE.Vector3, radius: number, material: THREE.Material, parent: THREE.Object3D = group, segments = 8, lengthSegments = 1) {
    const item = mesh(name, own(new THREE.CylinderGeometry(radius, radius, a.distanceTo(b), segments, lengthSegments)), material, parent);
    item.position.copy(a).add(b).multiplyScalar(0.5);
    item.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    return item;
  }
  function plate(name: string, outline: THREE.Shape, depth: number, z: number, material: THREE.Material, parent: THREE.Object3D = instrument, bevel = 0.002) {
    const item = mesh(name, own(new THREE.ExtrudeGeometry(outline, {
      depth, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel,
      bevelSegments: 2, curveSegments: 10, steps: 1,
    })), material, parent);
    item.position.z = z;
    return item;
  }
  function frontDisc(name: string, radius: number, depth: number, at: [number, number, number], material: THREE.Material, parent: THREE.Object3D) {
    const item = mesh(name, own(new THREE.CylinderGeometry(radius, radius, depth, 20)), material, parent);
    item.rotation.x = Math.PI / 2;
    item.position.set(...at);
    return item;
  }

  // The sunburst is evaluated in object space, so its edge colour continues
  // naturally around the softened sides and never stretches with camera yaw.
  const bodyOutline = new THREE.Shape();
  bodyOutline.moveTo(-0.034, 0.161);
  bodyOutline.bezierCurveTo(-0.052, 0.171, -0.056, 0.253, -0.089, 0.248);
  bodyOutline.bezierCurveTo(-0.14, 0.239, -0.147, 0.164, -0.112, 0.102);
  bodyOutline.bezierCurveTo(-0.092, 0.06, -0.107, 0.039, -0.141, 0.01);
  bodyOutline.bezierCurveTo(-0.2, -0.053, -0.169, -0.151, -0.111, -0.179);
  bodyOutline.bezierCurveTo(-0.061, -0.211, 0.083, -0.217, 0.139, -0.16);
  bodyOutline.bezierCurveTo(0.2, -0.095, 0.168, -0.035, 0.13, 0.008);
  bodyOutline.bezierCurveTo(0.099, 0.047, 0.093, 0.066, 0.113, 0.096);
  bodyOutline.bezierCurveTo(0.15, 0.152, 0.126, 0.192, 0.098, 0.187);
  bodyOutline.bezierCurveTo(0.071, 0.18, 0.072, 0.144, 0.034, 0.15);
  bodyOutline.closePath();
  const lacquer = own(new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.31, metalness: 0, clearcoat: 0.7, clearcoatRoughness: 0.26 }));
  const body = plate("bass-carved-sunburst-body", bodyOutline, 0.045, -0.026, lacquer, instrument, 0.009);
  const bodyPosition = body.geometry.getAttribute("position");
  const colors: number[] = [];
  const centerColor = new THREE.Color("#c18b48"), middleColor = new THREE.Color("#a45a31"), edgeColor = new THREE.Color("#54332c");
  const color = new THREE.Color();
  for (let i = 0; i < bodyPosition.count; i++) {
    const x = bodyPosition.getX(i), y = bodyPosition.getY(i), z = bodyPosition.getZ(i);
    const edge = Math.hypot(x / 0.18, (y + 0.035) / 0.255);
    color.copy(centerColor).lerp(middleColor, THREE.MathUtils.smoothstep(edge, 0.15, 0.76));
    color.lerp(edgeColor, Math.max(THREE.MathUtils.smoothstep(edge, 0.69, 1.04), z < 0.004 ? 0.53 : 0));
    colors.push(color.r, color.g, color.b);
  }
  body.geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));

  const pickguard = new THREE.Shape();
  pickguard.moveTo(-0.037, 0.154);
  pickguard.lineTo(-0.061, 0.173);
  pickguard.bezierCurveTo(-0.091, 0.174, -0.08, 0.083, -0.108, 0.045);
  pickguard.bezierCurveTo(-0.14, -0.001, -0.13, -0.075, -0.09, -0.096);
  pickguard.bezierCurveTo(-0.044, -0.12, 0.08, -0.117, 0.096, -0.069);
  pickguard.bezierCurveTo(0.101, -0.038, 0.037, 0.001, 0.038, 0.062);
  pickguard.lineTo(0.037, 0.154);
  pickguard.closePath();
  plate("bass-ivory-pickguard", pickguard, 0.0018, 0.03, ivory, instrument, 0.0007);
  // The rear has its own heel and electronics cover rather than a second face.
  box("bass-rear-control-cover", [0.075, 0.092, 0.002], [0.084, -0.075, -0.037], rosewood, instrument, 0.012);
  box("bass-maple-neck", [0.055, 0.469, 0.031], [0, 0.366, -0.003], maple, instrument, 0.009);
  box("bass-rosewood-fingerboard", [0.058, 0.445, 0.01], [0, 0.377, 0.017], rosewood, instrument, 0.003);
  box("bass-neck-heel", [0.071, 0.074, 0.008], [0, 0.132, -0.032], silver, instrument, 0.004);
  box("bass-nut", [0.058, 0.008, 0.014], [0, 0.604, 0.022], ivory, instrument, 0.001);

  const headstock = new THREE.Shape();
  headstock.moveTo(-0.027, 0.606);
  headstock.lineTo(-0.035, 0.732);
  headstock.bezierCurveTo(-0.042, 0.765, -0.014, 0.792, 0.018, 0.784);
  headstock.bezierCurveTo(0.053, 0.775, 0.065, 0.748, 0.048, 0.727);
  headstock.bezierCurveTo(0.035, 0.707, 0.033, 0.642, 0.027, 0.606);
  headstock.closePath();
  plate("bass-rounded-maple-headstock", headstock, 0.024, -0.015, maple, instrument, 0.004);
  for (let i = 0; i < 4; i++) {
    const y = 0.637 + i * 0.039;
    frontDisc("bass-tuning-post", 0.007, 0.02, [-0.013, y, 0.017], silver, instrument);
    rod("bass-tuner-shaft", new THREE.Vector3(-0.026, y, -0.001), new THREE.Vector3(-0.05, y, -0.001), 0.0038, silver, instrument);
    sphere("bass-tuner-paddle", [0.009, 0.013, 0.004], [-0.052, y, -0.001], silver, instrument);
  }
  for (let fret = 1; fret <= 18; fret++) {
    const y = 0.602 - 0.69 * (1 - Math.pow(2, -fret / 12));
    box("bass-fret-wire", [0.057, 0.0018, 0.002], [0, y, 0.023], warmMetal, instrument, 0.0003);
    if ([3, 5, 7, 9, 12, 15, 17].includes(fret)) {
      const next = 0.602 - 0.69 * (1 - Math.pow(2, -(fret - 0.5) / 12));
      for (const x of fret === 12 ? [-0.01, 0.01] : [0]) frontDisc("bass-fingerboard-inlay", 0.0033, 0.0006, [x, next, 0.023], ivory, instrument);
    }
  }
  box("bass-bridge-plate", [0.078, 0.04, 0.006], [0, -0.129, 0.029], silver, instrument, 0.003);
  for (const y of [-0.033, 0.026]) box("bass-magnetic-pickup", [0.075, 0.018, 0.009], [0, y, 0.037], ink, instrument, 0.003);
  const vibratingStrings: { mesh: THREE.Mesh; rest: Float32Array; length: number; phase: number }[] = [];
  for (let i = 0; i < 4; i++) {
    const x = (i - 1.5) * 0.013;
    box("bass-individual-bridge-saddle", [0.011, 0.014, 0.007], [x, -0.128, 0.035], warmMetal, instrument, 0.002);
    const bridge = new THREE.Vector3(x, -0.142, 0.042), nut = new THREE.Vector3(x * 0.82, 0.603, 0.033);
    const string = rod("bass-steel-string", bridge, nut, 0.00055 + (3 - i) * 0.00013, silver, instrument, 5, 16);
    string.userData.bassVibratingString = true;
    const positions = string.geometry.getAttribute("position") as THREE.BufferAttribute;
    positions.setUsage(THREE.DynamicDrawUsage);
    string.geometry.computeBoundingSphere();
    if (string.geometry.boundingSphere) string.geometry.boundingSphere.radius += 0.003;
    vibratingStrings.push({ mesh: string, rest: new Float32Array(positions.array), length: bridge.distanceTo(nut), phase: i * 0.71 });
    rod("bass-headstock-string", new THREE.Vector3(x * 0.82, 0.603, 0.033), new THREE.Vector3(-0.013, 0.637 + i * 0.039, 0.028), 0.00055 + (3 - i) * 0.00013, silver, instrument, 5);
  }
  for (const [x, y] of [[0.095, -0.08], [0.115, -0.116]]) {
    frontDisc("bass-knurled-volume-knob", 0.011, 0.013, [x, y, 0.035], warmMetal, instrument);
    box("bass-knob-index", [0.002, 0.006, 0.001], [x, y + 0.003, 0.042], ivory, instrument, 0.0002);
  }
  for (const [x, y] of [[-0.066, 0.134], [-0.105, -0.035], [-0.071, -0.087], [0.065, -0.075]]) frontDisc("bass-pickguard-screw", 0.0021, 0.001, [x, y, 0.034], silver, instrument);
  const cableJack = new THREE.Object3D();
  cableJack.name = "bass-output-jack-anchor";
  cableJack.position.set(0.148, -0.1, 0);
  instrument.add(cableJack);
  rod("bass-output-plug", new THREE.Vector3(0.14, -0.1, 0), new THREE.Vector3(0.174, -0.105, 0), 0.005, silver, instrument);
  cableJack.position.x = 0.176;

  const restPosition = new THREE.Vector3(1.65, 0.27, 6.45);
  const restQuaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.06, Math.PI, 0.08));
  instrument.position.copy(restPosition);
  instrument.quaternion.copy(restQuaternion);
  // A narrow padded stand stays on the terrace when the bass is picked up.
  const stand = new THREE.Group();
  stand.name = "bass-empty-padded-stand";
  stand.position.set(1.65, 0, 6.48);
  group.add(stand);
  rod("bass-stand-spine", new THREE.Vector3(0, 0.04, 0.04), new THREE.Vector3(0, 0.56, 0.055), 0.009, ink, stand);
  for (const [x, z] of [[-0.16, -0.09], [0.16, -0.09], [0, 0.18]]) {
    rod("bass-stand-tripod", new THREE.Vector3(0, 0.15, 0.04), new THREE.Vector3(x, 0.018, z), 0.009, ink, stand);
    sphere("bass-stand-rubber-foot", [0.018, 0.012, 0.022], [x, 0.013, z], rubber, stand);
  }
  for (const x of [-0.09, 0.09]) rod("bass-stand-padded-cradle", new THREE.Vector3(x, 0.08, 0.025), new THREE.Vector3(x, 0.082, -0.072), 0.013, rubber, stand);

  // A cloth-wrapped combo amp: recessed speaker, woven grille, metal corner
  // protectors, a real carry handle and a restrained green power indicator.
  const amplifier = new THREE.Group();
  amplifier.name = "garden-bass-amplifier";
  amplifier.position.set(0.8, 0, 6.5);
  amplifier.rotation.y = Math.PI;
  group.add(amplifier);
  box("amp-black-cabinet", [0.66, 0.57, 0.37], [0, 0.345, 0], ink, amplifier, 0.026);
  box("amp-front-recess", [0.593, 0.437, 0.012], [0, 0.296, 0.187], rubber, amplifier, 0.015);
  const cone = mesh("amp-recessed-speaker-cone", own(new THREE.LatheGeometry([
    new THREE.Vector2(0, 0), new THREE.Vector2(0.065, 0.014), new THREE.Vector2(0.079, 0.004),
    new THREE.Vector2(0.164, 0.018), new THREE.Vector2(0.189, 0.023), new THREE.Vector2(0.199, 0.018),
    new THREE.Vector2(0.207, 0.023), new THREE.Vector2(0.211, 0.015),
  ], 40)), surface("#35383a", 0.78), amplifier);
  cone.rotation.x = Math.PI / 2;
  cone.position.set(0, 0.294, 0.191);
  const textureSize = 128;
  const weavePixels = new Uint8Array(textureSize * textureSize * 4);
  for (let y = 0; y < textureSize; y++) for (let x = 0; x < textureSize; x++) {
    const crossing = (x % 4 < 2 ? 1 : 0) + (y % 4 < 2 ? 1 : 0);
    const value = 57 + crossing * 11 + Math.sin(x * 5.7 + y * 2.3) * 4;
    const i = (y * textureSize + x) * 4;
    weavePixels[i] = value; weavePixels[i + 1] = value + 2; weavePixels[i + 2] = value + 1;
    weavePixels[i + 3] = crossing ? 185 : 55;
  }
  const weave = own(new THREE.DataTexture(weavePixels, textureSize, textureSize));
  weave.colorSpace = THREE.SRGBColorSpace;
  weave.wrapS = weave.wrapT = THREE.RepeatWrapping;
  weave.repeat.set(2, 1.5);
  weave.magFilter = THREE.LinearFilter;
  weave.minFilter = THREE.LinearMipmapLinearFilter;
  weave.generateMipmaps = true;
  weave.anisotropy = 4;
  weave.needsUpdate = true;
  const grille = own(new THREE.MeshStandardMaterial({ map: weave, color: "#959a98", transparent: true, roughness: 0.94, depthWrite: false }));
  const grilleMesh = mesh("amp-woven-speaker-grille", own(new THREE.PlaneGeometry(0.563, 0.414)), grille, amplifier);
  grilleMesh.position.set(0, 0.296, 0.218);
  grilleMesh.castShadow = false;
  box("amp-brushed-control-panel", [0.565, 0.065, 0.01], [0, 0.559, 0.188], warmMetal, amplifier, 0.006);
  for (const x of [-0.135, -0.055, 0.025, 0.105]) {
    frontDisc("amp-control-knob", 0.015, 0.013, [x, 0.559, 0.2], ink, amplifier);
    box("amp-knob-marker", [0.002, 0.007, 0.001], [x, 0.565, 0.207], ivory, amplifier, 0.0003);
  }
  frontDisc("amp-input-socket", 0.012, 0.008, [-0.235, 0.559, 0.199], silver, amplifier);
  frontDisc("amp-input-plug", 0.006, 0.039, [-0.235, 0.559, 0.218], ink, amplifier);
  sphere("amp-power-indicator", [0.006, 0.006, 0.003], [0.185, 0.56, 0.197], emissive, amplifier);
  box("amp-power-rocker", [0.026, 0.037, 0.011], [0.236, 0.559, 0.2], surface("#a75d51", 0.6), amplifier, 0.003);
  for (const side of [-1, 1]) {
    box("amp-handle-bracket", [0.035, 0.009, 0.048], [side * 0.105, 0.635, 0], warmMetal, amplifier, 0.004);
    box("amp-handle-upright", [0.014, 0.027, 0.029], [side * 0.092, 0.645, 0], rubber, amplifier, 0.006);
    for (const z of [-0.132, 0.132]) box("amp-rubber-foot", [0.077, 0.055, 0.068], [side * 0.251, 0.03, z], rubber, amplifier, 0.009);
    for (const y of [0.087, 0.607]) box("amp-metal-corner", [0.059, 0.047, 0.052], [side * 0.303, y, 0.163], warmMetal, amplifier, 0.009);
  }
  box("amp-padded-carry-handle", [0.185, 0.016, 0.031], [0, 0.66, 0], rubber, amplifier, 0.007);
  box("amp-back-service-panel", [0.51, 0.38, 0.004], [0, 0.31, -0.187], rubber, amplifier, 0.015);
  for (let i = 0; i < 7; i++) box("amp-rear-vent", [0.24, 0.006, 0.002], [0, 0.26 + i * 0.023, -0.19], ink, amplifier, 0.001);

  const bed = new THREE.Group();
  bed.name = "garden-low-brick-flowerbed";
  bed.position.set(1.25, 0, 7.5);
  group.add(bed);
  box("flowerbed-soil", [1.83, 0.18, 0.59], [0, 0.09, 0], soil, bed, 0.025);
  const brickGeometry = own(new RoundedBoxGeometry(0.272, 0.112, 0.105, 1, 0.008));
  const brickMaterials = [clay, clayLight, clayDark];
  const brickTransforms: { position: [number, number, number]; yaw: number; shade: number }[] = [];
  for (let row = 0; row < 2; row++) {
    for (const z of [-0.328, 0.328]) for (let i = 0; i < 7; i++) {
      brickTransforms.push({ position: [-0.855 + i * 0.285, 0.059 + row * 0.116, z], yaw: 0, shade: (i + row) % 3 });
    }
    for (const x of [-0.945, 0.945]) for (let i = 0; i < 2; i++) {
      brickTransforms.push({ position: [x, 0.059 + row * 0.116, -0.15 + i * 0.3], yaw: Math.PI / 2, shade: (i + row + 1) % 3 });
    }
  }
  const brickTransform = new THREE.Object3D();
  brickMaterials.forEach((material, shade) => {
    const transforms = brickTransforms.filter((brick) => brick.shade === shade);
    const bricks = own(new THREE.InstancedMesh(brickGeometry, material, transforms.length));
    bricks.name = "flowerbed-rounded-terracotta-bricks";
    bricks.castShadow = bricks.receiveShadow = true;
    transforms.forEach((brick, index) => {
      brickTransform.position.set(...brick.position);
      brickTransform.rotation.y = brick.yaw;
      brickTransform.updateMatrix();
      bricks.setMatrixAt(index, brickTransform.matrix);
    });
    bricks.instanceMatrix.needsUpdate = true;
    bed.add(bricks);
  });

  // Individual stems have an irregular planted rhythm. Each petal crown is
  // merged to one mesh, keeping the playful garden modest on mobile GPUs.
  const flowers: {
    stem: THREE.Group;
    crown: THREE.Group;
    petals: THREE.Mesh;
    face: THREE.Mesh;
    leaves: THREE.Mesh[];
    crownRotation: THREE.Euler;
    phase: number;
  }[] = [];
  const petalSource = own(new THREE.SphereGeometry(1, 10, 6));
  const leafSource = own(new THREE.SphereGeometry(1, 10, 6));
  const faceParts: THREE.BufferGeometry[] = [];
  for (const x of [-0.115, 0.115]) {
    const eye = new THREE.SphereGeometry(1, 8, 6);
    eye.scale(0.04, 0.059, 0.025);
    eye.translate(x, 0.035, 0.359);
    faceParts.push(eye.toNonIndexed());
    eye.dispose();
  }
  const smile = new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(-0.105, -0.067, 0.354),
    new THREE.Vector3(0, -0.185, 0.374),
    new THREE.Vector3(0.105, -0.067, 0.354),
  ), 8, 0.015, 5, false);
  faceParts.push(smile.toNonIndexed());
  smile.dispose();
  const faceGeometry = mergeGeometries(faceParts);
  faceParts.forEach((geometry) => geometry.dispose());
  if (!faceGeometry) throw new Error("Could not build garden flower expressions");
  own(faceGeometry);
  const faceMaterial = surface("#544733", 0.82);
  for (let i = 0; i < 13; i++) {
    const stem = new THREE.Group();
    stem.name = "garden-flower-stem";
    const row = i % 2;
    stem.position.set(-0.82 + i * 0.137, 0.19, row ? 0.16 : -0.14);
    bed.add(stem);
    const height = 0.27 + ((i * 7) % 5) * 0.065 + (row ? 0.07 : 0);
    const bend = Math.sin(i * 4.1) * 0.048;
    const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(), new THREE.Vector3(-bend, height * 0.66, 0), new THREE.Vector3(bend, height, 0));
    mesh("flower-soft-curved-stem", own(new THREE.TubeGeometry(curve, 8, 0.0075, 5, false)), stemMaterial, stem);
    const leaves: THREE.Mesh[] = [];
    for (const side of [-1, 1]) {
      const leaf = mesh("flower-pointed-leaf", leafSource, leafMaterial, stem);
      leaf.position.set(side * 0.048, height * (side < 0 ? 0.37 : 0.59), 0);
      leaf.scale.set(0.076, 0.021, 0.031);
      leaf.rotation.z = side * 0.61;
      leaf.rotation.y = side * 0.32;
      leaves.push(leaf);
    }
    const crown = new THREE.Group();
    crown.name = "garden-flower-bloom";
    crown.position.set(bend, height, 0);
    // Flowers look toward the terrace approach, with a small upward tilt.
    crown.rotation.set(-0.17 + Math.sin(i) * 0.14, Math.PI + Math.sin(i * 2) * 0.22, Math.sin(i * 3) * 0.16);
    stem.add(crown);
    const radius = 0.073 + (i % 3) * 0.007;
    const petals: THREE.BufferGeometry[] = [];
    for (let petal = 0; petal < 7; petal++) {
      const angle = petal / 7 * Math.PI * 2;
      const geometry = petalSource.clone();
      geometry.scale(radius * 0.37, radius * 0.67, radius * 0.22);
      geometry.rotateZ(-angle);
      geometry.translate(Math.sin(angle) * radius * 0.55, Math.cos(angle) * radius * 0.55, 0);
      petals.push(geometry);
    }
    const petalGeometry = mergeGeometries(petals);
    petals.forEach((geometry) => geometry.dispose());
    if (!petalGeometry) throw new Error("Could not build garden flower petals");
    const petalMesh = mesh("flower-rounded-petal-crown", own(petalGeometry), flowerMaterials[i % flowerMaterials.length], crown);
    sphere("flower-pollen-centre", [radius * 0.35, radius * 0.35, radius * 0.18], [0, 0, radius * 0.19], pollenMaterial, crown);
    const face = mesh("flower-little-performance-smile", faceGeometry, faceMaterial, crown);
    face.scale.setScalar(radius);
    face.visible = false;
    face.castShadow = false;
    flowers.push({ stem, crown, petals: petalMesh, face, leaves, crownRotation: crown.rotation.clone(), phase: i * 1.71 });
  }

  // Small hardware is modeled independently above, then batched by material.
  // The bass, amplifier and stand each keep their own movable parent without
  // spending a draw call on every fret, tuner or control-panel screw.
  function batchStaticParts(parent: THREE.Group) {
    const batches = new Map<THREE.Material, THREE.Mesh[]>();
    for (const child of parent.children) {
      if (!(child instanceof THREE.Mesh) || Array.isArray(child.material) || child.userData.bassVibratingString) continue;
      const items = batches.get(child.material) ?? [];
      items.push(child);
      batches.set(child.material, items);
    }
    for (const [material, items] of batches) {
      if (items.length < 2) continue;
      const parts: THREE.BufferGeometry[] = [];
      try {
        for (const item of items) {
          item.updateMatrix();
          const geometry = item.geometry.index ? item.geometry.toNonIndexed() : item.geometry.clone();
          geometry.applyMatrix4(item.matrix);
          parts.push(geometry);
        }
        const merged = mergeGeometries(parts);
        if (!merged) throw new Error("Could not batch garden instrument hardware");
        const combined = mesh(`${parent.name}-batched-details`, own(merged), material, parent);
        combined.castShadow = items.some((item) => item.castShadow);
        combined.receiveShadow = items.some((item) => item.receiveShadow);
        for (const item of items) parent.remove(item);
      } finally {
        for (const geometry of parts) geometry.dispose();
      }
    }
  }
  batchStaticParts(instrument);
  batchStaticParts(amplifier);
  batchStaticParts(stand);

  // A continuous cable has fixed vertex buffers. Only its last arc follows
  // the moving jack; the grounded coil retains believable weight and slack.
  const cablePoints = [
    new THREE.Vector3(1.035, 0.559, 6.262), new THREE.Vector3(1.03, 0.07, 6.1),
    new THREE.Vector3(0.98, 0.016, 5.94), new THREE.Vector3(1.41, 0.016, 5.79),
    new THREE.Vector3(1.96, 0.016, 5.92), new THREE.Vector3(2.02, 0.025, 6.19),
    new THREE.Vector3(1.62, 0.14, 6.35), new THREE.Vector3(),
  ];
  const cableCurve = new THREE.CatmullRomCurve3(cablePoints);
  const cableSegments = 56, cableRadial = 6, cableRadius = 0.007;
  const cablePositions = new Float32Array((cableSegments + 1) * (cableRadial + 1) * 3);
  const cableNormals = new Float32Array(cablePositions.length);
  const cableIndices: number[] = [];
  for (let i = 0; i < cableSegments; i++) for (let j = 0; j < cableRadial; j++) {
    const a = i * (cableRadial + 1) + j, b = a + cableRadial + 1;
    cableIndices.push(a, a + 1, b, b, a + 1, b + 1);
  }
  const cableGeometry = own(new THREE.BufferGeometry());
  cableGeometry.setAttribute("position", new THREE.BufferAttribute(cablePositions, 3).setUsage(THREE.DynamicDrawUsage));
  cableGeometry.setAttribute("normal", new THREE.BufferAttribute(cableNormals, 3).setUsage(THREE.DynamicDrawUsage));
  cableGeometry.setIndex(cableIndices);
  const cable = mesh("bass-connected-coiled-cable", cableGeometry, rubber);
  cable.frustumCulled = false;
  const lastJack = new THREE.Vector3(Infinity, Infinity, Infinity);
  const jack = new THREE.Vector3(), center = new THREE.Vector3(), tangent = new THREE.Vector3();
  const normal = new THREE.Vector3(), binormal = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0), side = new THREE.Vector3(1, 0, 0);
  function updateCable() {
    cableJack.getWorldPosition(jack);
    group.worldToLocal(jack);
    if (lastJack.distanceToSquared(jack) < 0.0000001) return;
    lastJack.copy(jack);
    cablePoints[7].copy(jack);
    cablePoints[6].copy(jack).add(new THREE.Vector3(0, -Math.min(0.18, jack.y * 0.6), 0.06));
    cablePoints[6].y = Math.max(cableRadius, cablePoints[6].y);
    cableCurve.updateArcLengths();
    for (let i = 0; i <= cableSegments; i++) {
      const u = i / cableSegments;
      cableCurve.getPoint(u, center);
      // Catmull-Rom overshoot should not push the grounded coil through stone.
      center.y = Math.max(cableRadius + 0.002, center.y);
      cableCurve.getTangent(u, tangent);
      normal.crossVectors(tangent, Math.abs(tangent.y) > 0.94 ? side : up).normalize();
      binormal.crossVectors(tangent, normal).normalize();
      for (let j = 0; j <= cableRadial; j++) {
        const angle = j / cableRadial * Math.PI * 2;
        const nx = normal.x * Math.cos(angle) + binormal.x * Math.sin(angle);
        const ny = normal.y * Math.cos(angle) + binormal.y * Math.sin(angle);
        const nz = normal.z * Math.cos(angle) + binormal.z * Math.sin(angle);
        const index = (i * (cableRadial + 1) + j) * 3;
        cablePositions[index] = center.x + nx * cableRadius;
        cablePositions[index + 1] = center.y + ny * cableRadius;
        cablePositions[index + 2] = center.z + nz * cableRadius;
        cableNormals[index] = nx; cableNormals[index + 1] = ny; cableNormals[index + 2] = nz;
      }
    }
    cableGeometry.getAttribute("position").needsUpdate = true;
    cableGeometry.getAttribute("normal").needsUpdate = true;
  }

  // Success flourishes reuse a small, fixed pool. They are actual little
  // petals and musical notes in the garden, never a screen-covering overlay.
  const effects = new THREE.Group();
  effects.name = "garden-success-petals-and-notes";
  effects.userData.roomRaycastIgnore = true;
  group.add(effects);
  const floatingPetalGeometry = own(new THREE.SphereGeometry(1, 8, 5));
  floatingPetalGeometry.scale(0.5, 1, 0.22);
  const floatingPetalMaterial = surface("#ffffff", 0.79);
  const noteParts: THREE.BufferGeometry[] = [];
  const noteHead = new THREE.Shape();
  noteHead.absellipse(-0.18, -0.44, 0.27, 0.19, 0, Math.PI * 2, false, -0.4);
  noteParts.push(new THREE.ShapeGeometry(noteHead, 12));
  const noteStem = new THREE.Shape();
  noteStem.moveTo(-0.005, -0.46);
  noteStem.lineTo(0.105, -0.46);
  noteStem.lineTo(0.105, 0.65);
  noteStem.lineTo(-0.005, 0.65);
  noteStem.closePath();
  noteParts.push(new THREE.ShapeGeometry(noteStem));
  const noteFlag = new THREE.Shape();
  noteFlag.moveTo(0.08, 0.65);
  noteFlag.bezierCurveTo(0.36, 0.55, 0.48, 0.27, 0.25, 0.06);
  noteFlag.bezierCurveTo(0.36, 0.36, 0.15, 0.32, 0.08, 0.37);
  noteFlag.closePath();
  noteParts.push(new THREE.ShapeGeometry(noteFlag, 8));
  const noteGeometry = mergeGeometries(noteParts);
  noteParts.forEach((geometry) => geometry.dispose());
  if (!noteGeometry) throw new Error("Could not build garden musical notes");
  own(noteGeometry);
  const noteMaterial = own(new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.75, side: THREE.DoubleSide }));
  type Particle = {
    active: boolean;
    start: number;
    lifetime: number;
    origin: THREE.Vector3;
    velocity: THREE.Vector3;
    spin: number;
    rotation: number;
    size: number;
  };
  function createPool(capacity: number, geometry: THREE.BufferGeometry, material: THREE.Material, name: string) {
    const instances = own(new THREE.InstancedMesh(geometry, material, capacity));
    instances.name = name;
    instances.frustumCulled = false;
    instances.castShadow = false;
    instances.receiveShadow = false;
    instances.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    effects.add(instances);
    const particles: Particle[] = [];
    const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let index = 0; index < capacity; index++) {
      instances.setMatrixAt(index, hidden);
      instances.setColorAt(index, flowerMaterials[index % flowerMaterials.length].color);
      particles.push({ active: false, start: 0, lifetime: 1, origin: new THREE.Vector3(), velocity: new THREE.Vector3(), spin: 0, rotation: 0, size: 0.03 });
    }
    return { instances, particles, cursor: 0 };
  }
  const petalPool = createPool(24, floatingPetalGeometry, floatingPetalMaterial, "garden-floating-petal-pool");
  const notePool = createPool(8, noteGeometry, noteMaterial, "garden-floating-music-note-pool");
  const particleTransform = new THREE.Object3D();
  let effectSeed = 38143, flourishCount = 0;
  const random = () => {
    effectSeed = (Math.imul(effectSeed, 1664525) + 1013904223) >>> 0;
    return effectSeed / 0x100000000;
  };
  function launchSuccess(time: number) {
    for (const pool of [petalPool, notePool]) {
      const isNote = pool === notePool;
      for (let i = 0; i < (isNote ? 2 : 5); i++) {
        const particle = pool.particles[pool.cursor];
        pool.cursor = (pool.cursor + 1) % pool.particles.length;
        const flower = flowers[(flourishCount * 3 + i * 3 + (isNote ? 2 : 0)) % flowers.length];
        flower.crown.getWorldPosition(particle.origin);
        group.worldToLocal(particle.origin);
        particle.origin.z -= 0.035;
        particle.active = true;
        particle.start = time;
        particle.lifetime = isNote ? 1.1 + random() * 0.25 : 0.8 + random() * 0.35;
        particle.velocity.set((random() - 0.5) * 0.27, 0.3 + random() * 0.25, -0.08 - random() * 0.14);
        particle.rotation = (random() - 0.5) * 0.8;
        particle.spin = (random() - 0.5) * (isNote ? 0.8 : 3.5);
        particle.size = isNote ? 0.076 + random() * 0.014 : 0.021 + random() * 0.015;
      }
    }
    flourishCount++;
  }
  function animateParticles(time: number, reducedMotion: boolean) {
    for (const pool of [petalPool, notePool]) {
      let changed = false;
      for (let index = 0; index < pool.particles.length; index++) {
        const particle = pool.particles[index];
        if (!particle.active) continue;
        const age = Math.max(0, time - particle.start), progress = age / particle.lifetime;
        if (progress >= 1 || reducedMotion) {
          particle.active = false;
          particleTransform.scale.setScalar(0);
        } else {
          const envelope = Math.sin(Math.PI * progress) ** 0.6;
          particleTransform.position.copy(particle.origin).addScaledVector(particle.velocity, age);
          particleTransform.position.y -= (pool === petalPool ? 0.12 : 0.04) * age * age;
          particleTransform.rotation.set(
            pool === petalPool ? progress * 1.4 : 0,
            Math.PI + Math.sin(progress * 3 + particle.rotation) * 0.25,
            particle.rotation + age * particle.spin,
          );
          particleTransform.scale.setScalar(particle.size * envelope);
        }
        particleTransform.updateMatrix();
        pool.instances.setMatrixAt(index, particleTransform.matrix);
        changed = true;
      }
      if (changed) pool.instances.instanceMatrix.needsUpdate = true;
    }
  }

  let previousTime = 0, performanceAmount = 0, previousSuccess = 0;
  pollenMaterial.emissive.set("#6b4b20");
  pollenMaterial.emissiveIntensity = 0;
  function animate(timeSeconds: number, hitPulse = 0, bloom = 0, reducedMotion = false, performance?: BassGardenPerformance) {
    const pulse = THREE.MathUtils.clamp(hitPulse, 0, 1);
    const growth = THREE.MathUtils.clamp(bloom, 0, 1);
    const success = THREE.MathUtils.clamp(performance?.success ?? 0, 0, 1);
    const delta = Math.max(0, Math.min(0.1, timeSeconds - previousTime));
    previousTime = timeSeconds;
    performanceAmount = THREE.MathUtils.damp(performanceAmount, performance?.playing ? 1 : 0, 7, delta);
    const beat = performance?.beat ?? 0;
    if (!reducedMotion && performance?.playing && success > 0.35 && success > previousSuccess + 0.2) launchSuccess(timeSeconds);
    previousSuccess = success;
    for (let i = 0; i < flowers.length; i++) {
      const flower = flowers[i];
      const sway = Math.sin(beat * Math.PI + i * 0.21);
      const nod = Math.sin(beat * Math.PI * 2 + i * 0.34);
      flower.stem.rotation.z = reducedMotion ? 0 :
        Math.sin(timeSeconds * 1.25 + flower.phase) * 0.016 * (1 - performanceAmount)
        + sway * 0.13 * performanceAmount + Math.sin(flower.phase) * success * 0.09;
      flower.stem.rotation.x = reducedMotion ? 0 : (nod * 0.045 * performanceAmount + success * 0.035);
      flower.crown.rotation.copy(flower.crownRotation);
      if (!reducedMotion) {
        flower.crown.rotation.x += nod * 0.13 * performanceAmount;
        flower.crown.rotation.z += sway * 0.075 * performanceAmount;
      }
      flower.crown.scale.setScalar(0.87 + growth * 0.13 + (reducedMotion ? 0 : success * 0.055));
      const opening = reducedMotion ? growth * 0.035 : performanceAmount * 0.09 + success * 0.08 + growth * 0.035;
      flower.petals.scale.set(1 + opening, 1 + opening, 1 - opening * 0.7);
      flower.face.visible = performanceAmount > 0.08;
      for (let leafIndex = 0; leafIndex < flower.leaves.length; leafIndex++) {
        const side = leafIndex === 0 ? -1 : 1;
        const leaf = flower.leaves[leafIndex];
        leaf.rotation.z = side * 0.61 + (reducedMotion ? 0 : Math.sin(beat * Math.PI + i * 0.31 + side * 0.8) * 0.18 * performanceAmount);
        leaf.rotation.y = side * 0.32 + (reducedMotion ? 0 : nod * 0.1 * performanceAmount);
      }
    }
    for (const [geometryIndex, string] of vibratingStrings.entries()) {
      const positions = string.mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
      // Geometry is built from negative X (thick E) to positive X (G),
      // matching bassStringX's reverse mapping from the HUD's G/D/A/E rows.
      const selected = performance?.string === undefined || performance.string === 3 - geometryIndex;
      const amplitude = reducedMotion || !selected ? 0 : pulse * Math.sin(timeSeconds * 145 + string.phase) * 0.0018;
      for (let vertex = 0; vertex < positions.count; vertex++) {
        const index = vertex * 3;
        const along = string.rest[index + 1] / string.length + 0.5;
        positions.setX(vertex, string.rest[index] + Math.sin(along * Math.PI) * amplitude);
      }
      positions.needsUpdate = true;
    }
    emissive.emissiveIntensity = 0.35 + pulse * (reducedMotion ? 0.08 : 0.35);
    pollenMaterial.emissiveIntensity = success * (reducedMotion ? 0.08 : 0.14);
    animateParticles(timeSeconds, reducedMotion);
    updateCable();
  }
  animate(0);
  return { group, instrument, amplifier, flowerbed: bed, restPosition, restQuaternion, cableJack, animate, dispose: scope.dispose };
}
