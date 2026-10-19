import * as THREE from "three";
import { withDisposalScope, type DisposalScope } from "../disposal";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

/** Small, unbranded silver-and-leather camera. Floor is Y=0; the lens faces +Z. */
export function createTableCamera() {
  return withDisposalScope((scope) => buildTableCamera(scope));
}

function buildTableCamera(scope: DisposalScope) {
  const group = new THREE.Group();
  group.name = "table-travel-camera";
  scope.defer(() => group.clear());
  const geometry = scope.own;
  const material = scope.own;
  const silver = material(new THREE.MeshStandardMaterial({ color: "#bcc0c4", roughness: 0.38, metalness: 0.55 }));
  const silverEdge = material(new THREE.MeshStandardMaterial({ color: "#d5d8da", roughness: 0.31, metalness: 0.65 }));
  const black = material(new THREE.MeshStandardMaterial({ color: "#17191b", roughness: 0.49, metalness: 0.12 }));
  const rubber = material(new THREE.MeshStandardMaterial({ color: "#3b3c40", roughness: 0.72, metalness: 0 }));
  const barrelMetal = material(new THREE.MeshStandardMaterial({ color: "#313336", roughness: 0.34, metalness: 0.55 }));
  const recess = material(new THREE.MeshStandardMaterial({ color: "#090b0e", roughness: 0.7, metalness: 0.05 }));
  const screen = material(new THREE.MeshStandardMaterial({ color: "#626d62", roughness: 0.39, metalness: 0.09 }));
  const windowGlass = material(new THREE.MeshPhysicalMaterial({ color: "#343a45", roughness: 0.18, metalness: 0.2, clearcoat: 0.8 }));
  const indicator = material(new THREE.MeshStandardMaterial({ color: "#bac9a2", roughness: 0.38, metalness: 0.1 }));

  // A low-contrast pebbled leather surface, generated locally, with independent
  // planar UVs on the wrap. The grain stays small on the front, back and sides.
  const size = 128, leatherPixels = new Uint8Array(size * size * 4);
  let seed = 57293;
  const grain = new Float32Array(size * size);
  for (let i = 0; i < grain.length; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    grain[i] = seed / 0x100000000;
  }
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const p = y * size + x;
    const local = (grain[p] * 2 + grain[y * size + (x + 1) % size] + grain[((y + 1) % size) * size + x]) / 4;
    const v = 62 + local * 21;
    leatherPixels[p * 4] = v; leatherPixels[p * 4 + 1] = v; leatherPixels[p * 4 + 2] = v + 1; leatherPixels[p * 4 + 3] = 255;
  }
  const leatherTexture = scope.own(new THREE.DataTexture(leatherPixels, size, size));
  leatherTexture.colorSpace = THREE.SRGBColorSpace;
  leatherTexture.wrapS = leatherTexture.wrapT = THREE.RepeatWrapping;
  leatherTexture.magFilter = THREE.LinearFilter;
  leatherTexture.minFilter = THREE.LinearMipmapLinearFilter;
  leatherTexture.generateMipmaps = true;
  leatherTexture.anisotropy = 4;
  leatherTexture.needsUpdate = true;
  const leather = material(new THREE.MeshStandardMaterial({ color: "#d4d4d4", map: leatherTexture, bumpMap: leatherTexture, bumpScale: 0.00065, roughness: 0.9, metalness: 0 }));

  function mesh(name: string, shape: THREE.BufferGeometry, surface: THREE.Material) {
    const item = new THREE.Mesh(shape, surface);
    item.name = name;
    item.castShadow = true;
    item.receiveShadow = true;
    group.add(item);
    return item;
  }
  function box(name: string, dimensions: [number, number, number], at: [number, number, number], surface: THREE.Material, radius = 0.004) {
    const shape = geometry(new RoundedBoxGeometry(...dimensions, radius <= 0.003 ? 1 : 2, radius));
    const item = mesh(name, shape, surface);
    item.position.set(...at);
    return item;
  }
  function cylinder(name: string, radius: number, length: number, at: [number, number, number], surface: THREE.Material, axis: "y" | "z" = "z", segments = 32) {
    const item = mesh(name, geometry(new THREE.CylinderGeometry(radius, radius, length, segments)), surface);
    if (axis === "z") item.rotation.x = Math.PI / 2;
    item.position.set(...at);
    return item;
  }
  function sphere(name: string, scale: [number, number, number], at: [number, number, number], surface: THREE.Material) {
    const item = mesh(name, geometry(new THREE.SphereGeometry(1, 20, 12)), surface);
    item.scale.set(...scale); item.position.set(...at);
    return item;
  }
  function torus(name: string, radius: number, tube: number, at: [number, number, number], surface: THREE.Material, axis: "y" | "z" = "z", segments = 48) {
    const item = mesh(name, geometry(new THREE.TorusGeometry(radius, tube, 6, segments)), surface);
    if (axis === "y") item.rotation.x = Math.PI / 2;
    item.position.set(...at);
    return item;
  }
  function knurl(name: string, radius: number, length: number, at: [number, number, number], count: number, axis: "y" | "z", surface: THREE.Material) {
    const tooth = geometry(new THREE.BoxGeometry(0.0022, length, 0.0018));
    const instanced = scope.own(new THREE.InstancedMesh(tooth, surface, count));
    instanced.name = name;
    instanced.castShadow = true; instanced.receiveShadow = true;
    const transform = new THREE.Object3D();
    for (let i = 0; i < count; i++) {
      const angle = i / count * Math.PI * 2;
      transform.position.set(Math.sin(angle) * radius, 0, Math.cos(angle) * radius);
      transform.rotation.set(0, angle, 0);
      transform.updateMatrix(); instanced.setMatrixAt(i, transform.matrix);
    }
    instanced.instanceMatrix.needsUpdate = true;
    if (axis === "z") instanced.rotation.x = Math.PI / 2;
    instanced.position.set(...at); group.add(instanced);
    return instanced;
  }

  // The leather wraps a metal chassis, leaving a narrow lower rim and the
  // broad silver shoulder exposed. Its front-left grip projects gently.
  box("camera-silver-chassis", [0.62, 0.326, 0.192], [0, 0.163, 0], silver, 0.019);
  const wrap = box("camera-pebbled-leather-wrap", [0.623, 0.229, 0.195], [0, 0.1435, 0], leather, 0.012);
  const wrapUvs = wrap.geometry.getAttribute("uv");
  const wrapPositions = wrap.geometry.getAttribute("position");
  const wrapNormals = wrap.geometry.getAttribute("normal");
  for (let i = 0; i < wrapUvs.count; i++) {
    const side = Math.abs(wrapNormals.getX(i)) > Math.abs(wrapNormals.getZ(i));
    wrapUvs.setXY(i, (side ? wrapPositions.getZ(i) : wrapPositions.getX(i)) * 6, wrapPositions.getY(i) * 6);
  }
  box("camera-lower-rim", [0.611, 0.017, 0.195], [0, 0.012, 0], silverEdge, 0.006);
  box("camera-front-leather-grip", [0.098, 0.231, 0.05], [-0.247, 0.146, 0.101], rubber, 0.018);
  box("camera-front-grip-inlay", [0.069, 0.194, 0.009], [-0.25, 0.139, 0.127], leather, 0.008);
  box("camera-shoulder-seam", [0.592, 0.003, 0.002], [0, 0.259, 0.098], black, 0.0005);

  // A real prism silhouette, with sloping shoulders and a flat hot-shoe seat.
  const prismOutline = new THREE.Shape();
  prismOutline.moveTo(-0.111, 0.319);
  prismOutline.lineTo(-0.067, 0.403);
  prismOutline.quadraticCurveTo(-0.062, 0.411, -0.054, 0.411);
  prismOutline.lineTo(0.054, 0.411);
  prismOutline.quadraticCurveTo(0.062, 0.411, 0.067, 0.403);
  prismOutline.lineTo(0.111, 0.319);
  prismOutline.closePath();
  const prism = mesh("camera-bevelled-prism-housing", geometry(new THREE.ExtrudeGeometry(prismOutline, { depth: 0.154, steps: 1, bevelEnabled: true, bevelSize: 0.004, bevelThickness: 0.004, bevelSegments: 2, curveSegments: 3 })), silver);
  // The front and back slope inward toward the roof as well as the sides;
  // a constant-depth extrusion would read as a rectangular block in profile.
  const prismVertices = prism.geometry.getAttribute("position");
  for (let i = 0; i < prismVertices.count; i++) {
    const rise = THREE.MathUtils.clamp((prismVertices.getY(i) - 0.319) / 0.092, 0, 1);
    const depthScale = THREE.MathUtils.lerp(1.14, 0.7, rise);
    prismVertices.setZ(i, 0.077 + (prismVertices.getZ(i) - 0.077) * depthScale);
  }
  prism.geometry.computeVertexNormals();
  prism.position.z = -0.077;
  box("camera-hot-shoe-seat", [0.099, 0.007, 0.075], [0, 0.417, -0.012], black, 0.0015);
  for (const side of [-1, 1]) box("camera-hot-shoe-rail", [0.007, 0.008, 0.077], [side * 0.044, 0.423, -0.012], silverEdge, 0.001);
  box("camera-hot-shoe-rear-stop", [0.081, 0.005, 0.007], [0, 0.422, -0.047], silverEdge, 0.001);
  cylinder("camera-hot-shoe-contact", 0.006, 0.001, [0, 0.422, -0.013], barrelMetal, "y", 16);

  // Top-plate controls have scalloped edges, but no invented make or labels.
  for (const [x, z, radius, height] of [[-0.149, 0.005, 0.041, 0.022], [0.233, -0.027, 0.037, 0.018], [0.147, 0.039, 0.029, 0.02]]) {
    cylinder("camera-top-command-dial", radius, height, [x, 0.326 + height / 2, z], black, "y");
    knurl("camera-top-dial-knurl", radius + 0.0005, height * 0.78, [x, 0.326 + height / 2, z], 36, "y", barrelMetal);
    cylinder("camera-command-dial-inset", radius - 0.005, 0.0015, [x, 0.327 + height, z], rubber, "y");
  }
  cylinder("camera-shutter-collar", 0.023, 0.009, [-0.244, 0.331, 0.034], black, "y", 28);
  cylinder("camera-shutter-button", 0.018, 0.008, [-0.244, 0.338, 0.034], silverEdge, "y", 28);
  cylinder("camera-top-small-button", 0.008, 0.005, [-0.284, 0.33, 0.033], black, "y", 20);

  cylinder("camera-front-indicator-surround", 0.017, 0.006, [-0.129, 0.291, 0.1], black, "z", 24);
  sphere("camera-front-indicator-glass", [0.0115, 0.0115, 0.003], [-0.129, 0.291, 0.105], indicator);
  box("camera-front-small-window-bezel", [0.081, 0.048, 0.009], [0.23, 0.291, 0.099], black, 0.006);
  box("camera-front-small-window", [0.061, 0.029, 0.002], [0.23, 0.291, 0.105], windowGlass, 0.002);

  const lensX = 0.035, lensY = 0.166;
  cylinder("camera-lens-metal-mount", 0.151, 0.017, [lensX, lensY, 0.105], barrelMetal);
  cylinder("camera-lens-rear-collar", 0.146, 0.032, [lensX, lensY, 0.128], black);
  cylinder("camera-lens-barrel", 0.132, 0.112, [lensX, lensY, 0.193], barrelMetal);
  cylinder("camera-lens-focus-ring", 0.141, 0.026, [lensX, lensY, 0.156], rubber);
  knurl("camera-lens-focus-ridges", 0.141, 0.022, [lensX, lensY, 0.156], 80, "z", black);
  cylinder("camera-lens-zoom-ring", 0.139, 0.027, [lensX, lensY, 0.23], rubber);
  knurl("camera-lens-zoom-ridges", 0.139, 0.023, [lensX, lensY, 0.23], 80, "z", black);

  // Closed profile around an open optical well: the glass is recessed behind
  // the protective front rim instead of pasted onto a solid cylinder cap.
  const rimProfile = [
    [0.133, 0.243], [0.135, 0.249], [0.135, 0.272], [0.132, 0.278],
    [0.121, 0.278], [0.117, 0.273], [0.114, 0.268], [0.108, 0.266],
    [0.091, 0.266], [0.086, 0.263], [0.081, 0.253], [0.078, 0.247],
    [0.078, 0.244], [0.133, 0.243],
  ].map(([r, z]) => new THREE.Vector2(r, z));
  const rim = mesh("camera-lens-open-front-rim", geometry(new THREE.LatheGeometry(rimProfile, 48)), barrelMetal);
  rim.rotation.x = Math.PI / 2;
  rim.position.set(lensX, lensY, 0);
  torus("camera-lens-front-lip", 0.128, 0.002, [lensX, lensY, 0.278], barrelMetal);
  torus("camera-lens-inner-optical-bezel", 0.085, 0.002, [lensX, lensY, 0.263], black);
  cylinder("camera-lens-optical-well", 0.079, 0.004, [lensX, lensY, 0.248], recess);

  // Planar optical UVs preserve the circular aperture. Soft colored coatings
  // and two restrained reflection blooms provide depth without a bright glow.
  const opticalSize = 128, opticalPixels = new Uint8Array(opticalSize * opticalSize * 4);
  for (let y = 0; y < opticalSize; y++) for (let x = 0; x < opticalSize; x++) {
    const u = x / (opticalSize - 1) * 2 - 1, v = y / (opticalSize - 1) * 2 - 1;
    const radius = Math.sqrt(u * u + v * v);
    const coating = 18 * Math.exp(-Math.pow((radius - 0.78) / 0.14, 2));
    const aperture = 1 - Math.exp(-Math.pow(radius / 0.58, 8));
    const upper = 74 * Math.exp(-Math.pow((u + 0.34) / 0.2, 2) - Math.pow((v - 0.39 - u * 0.5) / 0.11, 2));
    const lower = 16 * Math.exp(-Math.pow((u - 0.47) / 0.11, 2) - Math.pow((v + 0.39 - u * 0.4) / 0.22, 2));
    const p = (y * opticalSize + x) * 4;
    opticalPixels[p] = 22 + aperture * 11 + coating * 0.6 + upper * 0.85 + lower * 0.65;
    opticalPixels[p + 1] = 26 + aperture * 14 + coating * 0.8 + upper * 0.9 + lower * 0.85;
    opticalPixels[p + 2] = 35 + aperture * 19 + coating + upper + lower;
    opticalPixels[p + 3] = 255;
  }
  const opticalTexture = scope.own(new THREE.DataTexture(opticalPixels, opticalSize, opticalSize));
  opticalTexture.colorSpace = THREE.SRGBColorSpace;
  opticalTexture.magFilter = THREE.LinearFilter;
  opticalTexture.minFilter = THREE.LinearMipmapLinearFilter;
  opticalTexture.generateMipmaps = true;
  opticalTexture.needsUpdate = true;
  const optical = material(new THREE.MeshPhysicalMaterial({ map: opticalTexture, color: "#ffffff", roughness: 0.16, metalness: 0.08, clearcoat: 0.95, clearcoatRoughness: 0.1 }));
  // One shared centre vertex and a triangle fan avoid overlapping zero-area
  // faces at the optical axis and keep its convex normal continuous.
  const vertices: number[] = [0, 0, 0.264], uvs: number[] = [0.5, 0.5], indices: number[] = [];
  const radialSegments = 48, rings = 8;
  for (let ring = 1; ring <= rings; ring++) for (let segment = 0; segment <= radialSegments; segment++) {
    const r = ring / rings, angle = segment / radialSegments * Math.PI * 2;
    const x = Math.cos(angle) * r, y = Math.sin(angle) * r;
    vertices.push(x * 0.079, y * 0.079, 0.252 + 0.012 * (1 - r * r));
    uvs.push((x + 1) / 2, (y + 1) / 2);
  }
  for (let segment = 0; segment < radialSegments; segment++) indices.push(0, segment + 1, segment + 2);
  for (let ring = 1; ring < rings; ring++) for (let segment = 0; segment < radialSegments; segment++) {
    const a = 1 + (ring - 1) * (radialSegments + 1) + segment, b = a + radialSegments + 1;
    indices.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const opticalGeometry = geometry(new THREE.BufferGeometry());
  opticalGeometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  opticalGeometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  opticalGeometry.setIndex(indices); opticalGeometry.computeVertexNormals();
  const glass = mesh("camera-recessed-convex-optical-glass", opticalGeometry, optical);
  glass.position.set(lensX, lensY, 0); glass.castShadow = false;

  // The rear is independently modeled: blank LCD, eyecup, thumb rest and
  // directional controls remain legible when walking around the low table.
  box("camera-rear-screen-bezel", [0.194, 0.145, 0.013], [0.055, 0.155, -0.101], black, 0.008);
  box("camera-rear-inactive-display", [0.16, 0.112, 0.002], [0.055, 0.155, -0.109], screen, 0.002);
  box("camera-rear-viewfinder-eyecup", [0.113, 0.075, 0.027], [0, 0.309, -0.101], rubber, 0.012);
  box("camera-rear-viewfinder-glass", [0.071, 0.047, 0.003], [0, 0.31, -0.117], windowGlass, 0.007);
  box("camera-rear-thumb-grip", [0.127, 0.107, 0.035], [-0.239, 0.252, -0.104], rubber, 0.017);
  box("camera-rear-thumb-ridge", [0.013, 0.078, 0.011], [-0.273, 0.253, -0.124], black, 0.005);
  cylinder("camera-rear-control-wheel", 0.032, 0.009, [-0.124, 0.13, -0.103], black, "z", 32);
  cylinder("camera-rear-control-center", 0.012, 0.006, [-0.124, 0.13, -0.111], barrelMetal, "z", 24);
  for (const [dx, dy] of [[0, 0.026], [0.026, 0], [0, -0.026], [-0.026, 0]]) {
    box("camera-rear-direction-key", [0.018, 0.018, 0.006], [-0.124 - dx, 0.13 + dy, -0.108], rubber, 0.003);
  }
  box("camera-rear-menu-button", [0.032, 0.017, 0.006], [-0.116, 0.198, -0.104], rubber, 0.005);
  cylinder("camera-rear-small-button", 0.011, 0.006, [-0.093, 0.067, -0.104], rubber, "z", 20);

  // Metal lugs are through-holes, visible from both faces, with dark side
  // access doors and small lower screws rather than flat decoration.
  for (const sign of [-1, 1]) {
    box("camera-strap-lug-anchor", [0.02, 0.018, 0.028], [sign * 0.313, 0.269, 0], silver, 0.003);
    torus("camera-open-strap-lug", 0.013, 0.004, [sign * 0.326, 0.269, 0], silverEdge, "z", 20);
    box("camera-side-access-door", [0.002, 0.16, 0.109], [sign * 0.313, 0.141, -0.004], rubber, 0.001);
  }

  // A very shallow contact shadow anchors the flat chassis on the table.
  // Only the few millimetres beside the body remain visible; the projecting
  // lens keeps its ordinary directional shadow instead of a second blob.
  const shadowWidth = 64, shadowHeight = 32;
  const shadowPixels = new Uint8Array(shadowWidth * shadowHeight * 4);
  for (let y = 0; y < shadowHeight; y++) for (let x = 0; x < shadowWidth; x++) {
    const px = Math.abs((x / (shadowWidth - 1) - 0.5) * 0.66);
    const pz = Math.abs((y / (shadowHeight - 1) - 0.5) * 0.235);
    const qx = px - (0.305 - 0.016), qz = pz - (0.0935 - 0.016);
    const distance = Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0) - 0.016;
    const alpha = 1 - THREE.MathUtils.smoothstep(distance, -0.006, 0.022);
    const offset = (y * shadowWidth + x) * 4;
    shadowPixels[offset] = shadowPixels[offset + 1] = shadowPixels[offset + 2] = 255;
    shadowPixels[offset + 3] = Math.round(alpha * 255);
  }
  const contactTexture = scope.own(new THREE.DataTexture(shadowPixels, shadowWidth, shadowHeight));
  contactTexture.magFilter = THREE.LinearFilter;
  contactTexture.minFilter = THREE.LinearFilter;
  contactTexture.needsUpdate = true;
  const contactMaterial = material(new THREE.MeshBasicMaterial({
    color: "#302922", map: contactTexture, transparent: true, opacity: 0.24,
    depthWrite: false, toneMapped: false,
  }));
  const contact = mesh("camera-soft-body-contact-shadow", geometry(new THREE.PlaneGeometry(0.66, 0.235)), contactMaterial);
  contact.rotation.x = -Math.PI / 2;
  contact.position.y = 0.0008;
  contact.castShadow = false;
  contact.receiveShadow = false;

  scope.defer(() => group.removeFromParent());
  return { group, dispose: scope.dispose };
}
