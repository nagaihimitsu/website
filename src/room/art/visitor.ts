import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { withDisposalScope, type DisposalScope } from "../disposal";

const TAU = Math.PI * 2;
type Point = [number, number, number];

/**
 * 提供された四方向の参考画像から造形した、自作の立体NPC。
 * 正面はローカル +Z、足裏は Y=0。外部画像・モデルは使わず、花柄も生成する。
 */
export function createVisitor() {
  return withDisposalScope(buildVisitor);
}

function buildVisitor(scope: DisposalScope) {
  const group = new THREE.Group();
  group.name = "visitor-npc";
  group.userData.damageable = false;
  const body = new THREE.Group();
  body.name = "visitor-body";
  group.add(body);
  scope.defer(() => group.clear());
  const own = scope.own;
  const material = (color: string, roughness = 0.75) => own(new THREE.MeshPhysicalMaterial({
    color, roughness, metalness: 0, clearcoat: 0.04, clearcoatRoughness: 0.7,
    sheen: 0.12, sheenRoughness: 0.85, sheenColor: new THREE.Color(color),
  }));
  const skin = material("#f6c5a9", 0.65);
  const cheek = material("#edb4aa", 0.72);
  const hair = material("#c2a9da", 0.52);
  const hairLight = material("#ccb4e2", 0.52);
  const hairDark = material("#b49acc", 0.55);
  const knit = material("#ead8bd", 0.96);
  const knitBand = material("#e0ccb0", 0.95);
  const leather = material("#976443", 0.85);
  const leatherEdge = material("#70472f", 0.86);
  const flapMaterial = material("#ae7951", 0.9);
  const ribbonMaterial = material("#edb842", 0.71);
  const ribbonLight = material("#f5c95e", 0.7);
  const soleMaterial = material("#73503c", 0.92);
  const eyeLine = material("#483349", 0.48);
  const white = material("#fff7ed", 0.45);
  const irisDark = material("#4c306a", 0.3);
  const iris = material("#9264b4", 0.3);
  const irisLight = material("#b68bd1", 0.3);
  const pupil = material("#30213f", 0.2);
  const mouth = material("#b8524f", 0.6);
  const tongue = material("#ef8b7b", 0.65);
  const glint = own(new THREE.MeshBasicMaterial({ color: "#fffaf0", toneMapped: false }));
  const sphere = own(new THREE.SphereGeometry(1, 28, 20));
  const smallSphere = own(new THREE.SphereGeometry(1, 16, 12));
  const rounded = own(new RoundedBoxGeometry(1, 1, 1, 5, 0.12));

  function mesh(name: string, geometry: THREE.BufferGeometry, surface: THREE.Material, parent: THREE.Object3D = body) {
    const result = new THREE.Mesh(geometry, surface);
    result.name = name;
    result.castShadow = result.receiveShadow = true;
    parent.add(result);
    return result;
  }
  function oval(name: string, size: Point, position: Point, surface: THREE.Material, parent: THREE.Object3D = body) {
    const result = mesh(name, Math.max(...size) < 0.02 ? smallSphere : sphere, surface, parent);
    result.position.set(...position);
    result.scale.set(...size);
    return result;
  }
  function roundedBox(name: string, size: Point, position: Point, surface: THREE.Material, parent: THREE.Object3D = body) {
    const result = mesh(name, rounded, surface, parent);
    result.position.set(...position);
    result.scale.set(...size);
    return result;
  }
  function thread(name: string, points: Point[], radius: number, surface: THREE.Material, parent: THREE.Object3D = body, segments = 20) {
    const curve = new THREE.CatmullRomCurve3(points.map((point) => new THREE.Vector3(...point)));
    return mesh(name, own(new THREE.TubeGeometry(curve, segments, radius, 7, false)), surface, parent);
  }
  // 楕円断面の軟らかい立体。先端を閉じ、髪・袖・ストラップに共用する。
  function sweep(name: string, points: Point[], widths: number[], depths: number[], surface: THREE.Material,
    parent: THREE.Object3D = body, segments = 28, radial = 12, axis: "front" | "side" = "front") {
    const curve = new THREE.CatmullRomCurve3(points.map((point) => new THREE.Vector3(...point)));
    const positions: number[] = [], uvs: number[] = [], indices: number[] = [];
    const preferred = new THREE.Vector3(...(axis === "front" ? [0, 0, 1] : [1, 0, 0]) as Point);
    const sample = (values: number[], t: number) => {
      const f = t * (values.length - 1), index = Math.min(values.length - 2, Math.floor(f));
      return THREE.MathUtils.lerp(values[index], values[index + 1], f - index);
    };
    for (let j = 0; j <= segments; j++) {
      const t = j / segments, centre = curve.getPoint(t), tangent = curve.getTangent(t).normalize();
      const side = new THREE.Vector3().crossVectors(tangent, preferred).normalize();
      const normal = new THREE.Vector3().crossVectors(side, tangent).normalize();
      const width = sample(widths, t), depth = sample(depths, t);
      for (let i = 0; i <= radial; i++) {
        const angle = i / radial * TAU;
        const p = centre.clone().addScaledVector(side, Math.cos(angle) * width).addScaledVector(normal, Math.sin(angle) * depth);
        positions.push(p.x, p.y, p.z); uvs.push(i / radial, t);
        if (j < segments && i < radial) {
          const a = j * (radial + 1) + i, b = a + radial + 1;
          indices.push(a, b, a + 1, a + 1, b, b + 1);
        }
      }
    }
    // 非ゼロ断面で終わる袖・ベルトも、端面を閉じて室内の斜め視点で穴を見せない。
    const startCentre = positions.length / 3;
    const firstPoint = curve.getPoint(0), lastPoint = curve.getPoint(1);
    positions.push(firstPoint.x, firstPoint.y, firstPoint.z, lastPoint.x, lastPoint.y, lastPoint.z);
    uvs.push(0.5, 0, 0.5, 1);
    for (let i = 0; i < radial; i++) {
      const end = segments * (radial + 1) + i;
      indices.push(startCentre, i, i + 1, startCentre + 1, end + 1, end);
    }
    const geometry = own(new THREE.BufferGeometry());
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices); geometry.computeVertexNormals();
    return mesh(name, geometry, surface, parent);
  }

  function dataTexture(name: string, size: number, pixels: Uint8Array, repeat: [number, number] = [1, 1]) {
    const texture = own(new THREE.DataTexture(pixels, size, size));
    texture.name = name;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.repeat.set(...repeat);
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    texture.anisotropy = 8;
    texture.needsUpdate = true;
    return texture;
  }
  // 周期的なケーブル編みと細いV字の目。無通信、Canvasなしで同じ結果を作る。
  const knitSize = 256, knitPixels = new Uint8Array(knitSize * knitSize * 4);
  const weavePixels = new Uint8Array(knitSize * knitSize * 4);
  for (let y = 0; y < knitSize; y++) for (let x = 0; x < knitSize; x++) {
    const u = x / knitSize, v = y / knitSize;
    const wave = Math.sin(v * TAU * 3) * 0.17;
    const cable = Math.exp(-((Math.sin((u + wave) * TAU * 2)) ** 2) * 55);
    const rib = (Math.cos(u * TAU * 24) + 1) / 2;
    const stitch = Math.cos((u * 32 + Math.abs((v * 64 % 1) - 0.5) * 0.6) * TAU);
    const value = Math.round(122 + cable * 69 + rib * 13 + stitch * 10);
    const i = (y * knitSize + x) * 4;
    knitPixels.set([value, value, value, 255], i);
    const warp = Math.sin(x * TAU / 9), weft = Math.sin(y * TAU / 7);
    const w = Math.round(125 + warp * 26 + weft * 22 + ((Math.floor(x / 9) + Math.floor(y / 7)) % 2) * 22);
    weavePixels.set([w, w, w, 255], i);
  }
  const knitTexture = dataTexture("visitor-cable-knit-relief", knitSize, knitPixels, [3, 2]);
  knitTexture.colorSpace = THREE.NoColorSpace;
  knit.bumpMap = knitTexture; knit.bumpScale = 0.0018;
  const weave = dataTexture("visitor-woven-bag-relief", knitSize, weavePixels, [2, 2]);
  weave.colorSpace = THREE.NoColorSpace;
  leather.bumpMap = flapMaterial.bumpMap = weave;
  leather.bumpScale = flapMaterial.bumpScale = 0.0008;

  // 紺地に花・枝葉を直接描く。プリントは曲面に貼り、輪郭は全て立体形状。
  const tileSize = 1024, flowerPixels = new Uint8Array(tileSize * tileSize * 4);
  for (let y = 0; y < tileSize; y++) for (let x = 0; x < tileSize; x++) {
    const i = (y * tileSize + x) * 4;
    const grain = ((x * 13 + y * 17) % 7) - 3;
    flowerPixels.set([36 + grain, 59 + grain, 91 + grain, 255], i);
  }
  const rgb = (hex: number): [number, number, number] => [hex >> 16 & 255, hex >> 8 & 255, hex & 255];
  function paintEllipse(cx: number, cy: number, rx: number, ry: number, angle: number, colour: number) {
    const bound = Math.ceil(Math.max(rx, ry) + 2), cosine = Math.cos(angle), sine = Math.sin(angle);
    const col = rgb(colour);
    for (let y = Math.floor(cy - bound); y <= cy + bound; y++) for (let x = Math.floor(cx - bound); x <= cx + bound; x++) {
      const dx = x - cx, dy = y - cy;
      const a = (dx * cosine + dy * sine) / rx, b = (-dx * sine + dy * cosine) / ry;
      const distance = a * a + b * b;
      if (distance > 1.03) continue;
      const coverage = THREE.MathUtils.clamp((1.03 - distance) * 35, 0, 1);
      const i = (((y % tileSize + tileSize) % tileSize) * tileSize + ((x % tileSize + tileSize) % tileSize)) * 4;
      for (let channel = 0; channel < 3; channel++) flowerPixels[i + channel] = Math.round(THREE.MathUtils.lerp(flowerPixels[i + channel], col[channel], coverage));
    }
  }
  const motifs = [
    [85, 105, 1, 0.3], [386, 63, 0.8, 1.2], [738, 139, 1.12, 0.5],
    [209, 381, 1.2, 1.8], [557, 333, 0.85, 0.1], [921, 415, 1.0, 2.5],
    [40, 702, 0.86, 1.1], [419, 675, 1.08, 0.7], [742, 689, 0.9, 2.0],
    [224, 941, 1.0, 0.5], [622, 960, 0.8, 1.6], [955, 936, 0.92, 2.8],
  ];
  motifs.forEach(([cx, cy, scale, rotation], motif) => {
    for (let branch = 0; branch < 5; branch++) {
      const angle = rotation + branch * 1.27;
      const distance = (89 + branch % 2 * 18) * scale;
      paintEllipse(cx + Math.cos(angle) * distance, cy + Math.sin(angle) * distance,
        16 * scale, 52 * scale, angle - Math.PI / 2 + 0.2,
        [0x728bb2, 0x377f80, 0xc2c5c0, 0x6b93aa, 0x4e6e92][(motif + branch) % 5]);
      paintEllipse(cx + Math.cos(angle + 0.2) * distance * 1.3, cy + Math.sin(angle + 0.2) * distance * 1.3,
        8 * scale, 35 * scale, angle - Math.PI / 2 - 0.25, 0x8da4b8);
    }
    const yellow = motif % 4 !== 1;
    for (let petal = 0; petal < 5; petal++) {
      const angle = rotation + petal * TAU / 5;
      paintEllipse(cx + Math.cos(angle) * 35 * scale, cy + Math.sin(angle) * 35 * scale,
        (32 + petal % 2 * 4) * scale, 17 * scale, angle,
        yellow ? (petal % 2 ? 0xdeb168 : 0xefc578) : (petal % 2 ? 0xd8dbce : 0xf0ebd7));
      paintEllipse(cx + Math.cos(angle) * 28 * scale, cy + Math.sin(angle) * 28 * scale,
        25 * scale, 3.5 * scale, angle, yellow ? 0xf4d59b : 0xf8f1df);
    }
    paintEllipse(cx, cy, 12 * scale, 12 * scale, 0, 0x314c68);
    for (let dot = 0; dot < 6; dot++) {
      const angle = dot * TAU / 6;
      paintEllipse(cx + Math.cos(angle) * 8 * scale, cy + Math.sin(angle) * 8 * scale, 2.3 * scale, 2.3 * scale, 0, 0xcea357);
    }
  });
  const flowerTexture = dataTexture("visitor-navy-botanical-print", tileSize, flowerPixels, [3.2, 1.6]);
  const dress = material("#ffffff", 0.9);
  dress.map = flowerTexture;
  dress.sheen = 0.22;
  const dressHem = material("#233e60", 0.9);

  // 足首丈の裾。径を連続的に変え、浅いひだを縫い目まで通す。
  const skirtProfile = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.238, 0.143, 0), new THREE.Vector3(0.239, 0.158, 0),
    new THREE.Vector3(0.218, 0.255, 0), new THREE.Vector3(0.183, 0.397, 0),
    new THREE.Vector3(0.145, 0.531, 0), new THREE.Vector3(0.108, 0.656, 0),
  ]);
  const profile = skirtProfile.getPoints(40).map((point) => new THREE.Vector2(point.x, point.y));
  const skirtGeometry = own(new THREE.LatheGeometry(profile, 96));
  const skirtPositions = skirtGeometry.getAttribute("position");
  for (let i = 0; i < skirtPositions.count; i++) {
    const x = skirtPositions.getX(i), y = skirtPositions.getY(i), z = skirtPositions.getZ(i);
    const angle = Math.atan2(z, x);
    const pleat = 1 + Math.cos(angle * 12 + 0.2) * (0.013 + (0.656 - y) * 0.025);
    skirtPositions.setXYZ(i, x * pleat, y, z * 0.78 * pleat);
  }
  skirtGeometry.computeVertexNormals();
  mesh("visitor-floral-full-length-skirt", skirtGeometry, dress);
  const hemCurve: Point[] = [];
  for (let i = 0; i <= 96; i++) {
    const angle = i / 96 * TAU, pleat = 1 + Math.cos(angle * 12 + 0.2) * 0.026;
    hemCurve.push([Math.cos(angle) * 0.238 * pleat, 0.144, Math.sin(angle) * 0.238 * 0.78 * pleat]);
  }
  thread("visitor-thin-dress-hem", hemCurve, 0.0022, dressHem, body, 120);
  const bodiceGeometry = own(new THREE.LatheGeometry([
    new THREE.Vector2(0.106, 0.647), new THREE.Vector2(0.112, 0.707),
    new THREE.Vector2(0.128, 0.81), new THREE.Vector2(0.114, 0.848),
    new THREE.Vector2(0.055, 0.875),
  ], 48));
  const bodicePositions = bodiceGeometry.getAttribute("position");
  for (let i = 0; i < bodicePositions.count; i++) bodicePositions.setZ(i, bodicePositions.getZ(i) * 0.66);
  bodiceGeometry.computeVertexNormals();
  mesh("visitor-floral-bodice", bodiceGeometry, dress);
  oval("visitor-neck", [0.05, 0.076, 0.043], [0, 0.881, 0], skin);
  const waist = own(new THREE.TorusGeometry(0.108, 0.003, 6, 64));
  const waistMesh = mesh("visitor-gathered-waist", waist, dressHem);
  waistMesh.rotation.x = Math.PI / 2; waistMesh.position.y = 0.656; waistMesh.scale.y = 0.7;

  // 開いたカーディガンは背面までつながる厚みのあるシェル。
  const shellPositions: number[] = [], shellUvs: number[] = [], shellIndices: number[] = [];
  const shellRows = 20, shellColumns = 64;
  for (let layer = 0; layer < 2; layer++) for (let row = 0; row <= shellRows; row++) {
    const t = row / shellRows, y = THREE.MathUtils.lerp(0.596, 0.865, t);
    const radius = 0.123 + Math.sin(t * Math.PI) * 0.009 + t * 0.01 - layer * 0.008;
    const opening = 0.30 + t * 0.09;
    for (let column = 0; column <= shellColumns; column++) {
      const u = column / shellColumns, angle = opening + u * (TAU - opening * 2);
      const front = Math.max(0, Math.cos(angle));
      shellPositions.push(Math.sin(angle) * radius,
        y - t ** 8 * Math.abs(Math.sin(angle)) * 0.023,
        Math.cos(angle) * radius * 0.70 + front * 0.009);
      shellUvs.push(u, t);
    }
  }
  const shellStride = shellColumns + 1, shellCount = (shellRows + 1) * shellStride;
  for (let row = 0; row < shellRows; row++) for (let column = 0; column < shellColumns; column++) {
    const a = row * shellStride + column, b = a + shellStride;
    shellIndices.push(a, a + 1, b, a + 1, b + 1, b);
    shellIndices.push(a + shellCount, b + shellCount, a + 1 + shellCount, a + 1 + shellCount, b + shellCount, b + 1 + shellCount);
  }
  for (const column of [0, shellColumns]) for (let row = 0; row < shellRows; row++) {
    const a = row * shellStride + column, b = a + shellStride;
    shellIndices.push(a, a + shellCount, b, b, a + shellCount, b + shellCount);
  }
  for (const row of [0, shellRows]) for (let column = 0; column < shellColumns; column++) {
    const a = row * shellStride + column;
    shellIndices.push(a, a + 1, a + shellCount, a + 1, a + 1 + shellCount, a + shellCount);
  }
  const shellGeometry = own(new THREE.BufferGeometry());
  shellGeometry.setAttribute("position", new THREE.Float32BufferAttribute(shellPositions, 3));
  shellGeometry.setAttribute("uv", new THREE.Float32BufferAttribute(shellUvs, 2));
  shellGeometry.setIndex(shellIndices); shellGeometry.computeVertexNormals();
  // 内外の法線を分けたシェルで、開いた襟の内側も描く。
  mesh("visitor-open-cable-cardigan", shellGeometry, knit);
  for (const side of [-1, 1]) {
    thread("visitor-cardigan-front-band", [
      [side * 0.035, 0.596, 0.094], [side * 0.039, 0.68, 0.099],
      [side * 0.048, 0.782, 0.101], [side * 0.051, 0.86, 0.09],
    ], 0.008, knitBand);
    oval("visitor-soft-cardigan-shoulder", [0.043, 0.040, 0.047], [side * 0.126, 0.824, 0], knit);
    const sleevePoints: Point[] = [[side * 0.125, 0.829, 0], [side * 0.153, 0.776, 0.006],
      [side * 0.177, 0.662, 0.013], [side * 0.208, 0.553, 0.03]];
    sweep("visitor-soft-cardigan-sleeve", sleevePoints, [0.043, 0.047, 0.041, 0.033],
      [0.045, 0.047, 0.042, 0.034], knit, body, 28, 20);
    const cuff = oval("visitor-ribbed-cuff", [0.035, 0.019, 0.034], [side * 0.208, 0.552, 0.031], knitBand);
    cuff.rotation.z = side * -0.25;
    for (let rib = 0; rib < 10; rib++) {
      const a = rib / 10 * TAU;
      thread("visitor-cuff-rib", [[side * 0.208 + Math.cos(a) * 0.034, 0.541, 0.031 + Math.sin(a) * 0.034],
        [side * 0.205 + Math.cos(a) * 0.034, 0.561, 0.031 + Math.sin(a) * 0.034]], 0.0011, knit);
    }
    const hand = oval("visitor-relaxed-hand", [0.028, 0.043, 0.023], [side * 0.22, 0.504, 0.034], skin);
    hand.rotation.z = side * -0.35;
    oval("visitor-thumb", [0.013, 0.023, 0.014], [side * 0.199, 0.51, 0.05], skin).rotation.z = side * 0.5;
    for (let finger = 0; finger < 3; finger++) oval("visitor-fingertip", [0.008, 0.014, 0.012],
      [side * (0.215 + finger * 0.01), 0.476 + finger * 0.003, 0.036], skin);
  }
  const sweaterHem: Point[] = [];
  for (let i = 0; i <= 56; i++) {
    const angle = 0.3 + i / 56 * (TAU - 0.6);
    sweaterHem.push([Math.sin(angle) * 0.123, 0.6, Math.cos(angle) * 0.086 + Math.max(0, Math.cos(angle)) * 0.009]);
  }
  thread("visitor-cardigan-ribbed-hem", sweaterHem, 0.006, knitBand, body, 80);


  for (const front of [true, false]) for (const side of [-1, 1]) {
    for (const xOffset of front ? [0.073, 0.103] : [0.03, 0.078]) {
      for (const twist of [0, Math.PI]) {
        const cablePoints: Point[] = [];
        for (let i = 0; i <= 28; i++) {
          const t = i / 28, y = 0.617 + t * 0.20;
          const radius = 0.123 + Math.sin((y - 0.596) / 0.269 * Math.PI) * 0.009 + (y - 0.596) / 0.269 * 0.01;
          const x = side * xOffset + Math.sin(t * TAU * 3 + twist) * 0.002;
          const z = Math.sqrt(Math.max(0.001, radius * radius - x * x)) * 0.70;
          cablePoints.push([x, y, (front ? 1 : -1) * (z + (front ? 0.010 : 0.001) + Math.cos(t * TAU * 3 + twist) * 0.0008)]);
        }
        thread("visitor-sweater-fine-cable", cablePoints, 0.0011, knitBand, body, 42);
      }
    }
  }

  // 顔と耳。額から顎へ一体の丸い頬、目はその曲面の接線方向へ載せる。
  oval("visitor-soft-face", [0.158, 0.177, 0.137], [0, 1.04, 0.006], skin);
  for (const side of [-1, 1]) {
    oval("visitor-ear", [0.024, 0.041, 0.025], [side * 0.15, 1.007, 0.001], skin);
    oval("visitor-ear-inner", [0.012, 0.023, 0.012], [side * 0.164, 1.008, 0.012], cheek);
    oval("visitor-cheek", [0.029, 0.012, 0.002], [side * 0.099, 0.981, 0.118], cheek).rotation.y = side * 0.45;
  }
  const eyes: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    const eye = new THREE.Group();
    eye.name = side < 0 ? "visitor-left-eye" : "visitor-right-eye";
    eye.position.set(side * 0.068, 1.034, 0.129);
    eye.rotation.y = side * 0.3;
    body.add(eye); eyes.push(eye);
    oval("visitor-eye-outline", [0.039, 0.050, 0.003], [0, 0, 0], eyeLine, eye);
    oval("visitor-eye-white", [0.037, 0.047, 0.003], [0, -0.001, 0.0018], white, eye);
    oval("visitor-purple-iris-rim", [0.033, 0.043, 0.0025], [side * -0.001, -0.002, 0.0045], irisDark, eye);
    oval("visitor-purple-iris", [0.030, 0.040, 0.002], [0, -0.004, 0.006], iris, eye);
    oval("visitor-iris-lower-light", [0.026, 0.020, 0.0014], [0, -0.021, 0.008], irisLight, eye);
    oval("visitor-dark-pupil", [0.013, 0.029, 0.0015], [0, 0.001, 0.009], pupil, eye);
    oval("visitor-eye-large-glint", [0.008, 0.010, 0.0012], [-0.011, 0.019, 0.011], glint, eye);
    oval("visitor-eye-small-glint", [0.004, 0.0048, 0.001], [0.014, -0.020, 0.010], glint, eye);
    thread("visitor-upper-eyelash", [[-0.036, 0.018, 0.009], [-0.023, 0.043, 0.007],
      [0, 0.049, 0.006], [0.022, 0.041, 0.008], [0.038, 0.018, 0.007]], 0.0028, eyeLine, eye);
    thread("visitor-outer-eyelash", [[side * 0.028, 0.032, 0.008], [side * 0.041, 0.036, 0.007],
      [side * 0.046, 0.043, 0.003]], 0.0021, eyeLine, eye);
    thread("visitor-soft-eyebrow", [[side * 0.035, 1.107, 0.115], [side * 0.064, 1.116, 0.123],
      [side * 0.092, 1.109, 0.111]], 0.0021, hairDark);
  }
  oval("visitor-small-nose", [0.006, 0.007, 0.005], [0, 0.992, 0.14], skin);
  oval("visitor-smile", [0.031, 0.026, 0.005], [0, 0.954, 0.125], mouth);
  oval("visitor-smile-tongue", [0.024, 0.013, 0.0025], [0, 0.943, 0.131], tongue);
  oval("visitor-smile-upper-tooth", [0.022, 0.004, 0.0015], [0, 0.972, 0.130], white);

  // 丸いボブの頭頂。前側だけ開き、後頭部は顎の高さまで包む。
  const capPositions: number[] = [], capUvs: number[] = [], capIndices: number[] = [];
  const capRows = 34, capColumns = 80;
  for (let row = 0; row <= capRows; row++) for (let column = 0; column <= capColumns; column++) {
    const u = column / capColumns, angle = u * TAU;
    const front = THREE.MathUtils.smoothstep(Math.cos(angle), 0.15, 0.8);
    const phi = row / capRows * THREE.MathUtils.lerp(2.25, 1.28, front);
    const flute = 1 + Math.cos(angle * 14 + phi * 0.35) * 0.008;
    capPositions.push(Math.sin(angle) * Math.sin(phi) * 0.187 * flute,
      1.077 + Math.cos(phi) * 0.201,
      -0.024 + Math.cos(angle) * Math.sin(phi) * 0.167 * flute);
    capUvs.push(u, row / capRows);
    if (row < capRows && column < capColumns) {
      const a = row * (capColumns + 1) + column, b = a + capColumns + 1;
      capIndices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const capGeometry = own(new THREE.BufferGeometry());
  capGeometry.setAttribute("position", new THREE.Float32BufferAttribute(capPositions, 3));
  capGeometry.setAttribute("uv", new THREE.Float32BufferAttribute(capUvs, 2));
  capGeometry.setIndex(capIndices); capGeometry.computeVertexNormals();
  mesh("visitor-lilac-bob-crown", capGeometry, hair);
  // 側面から背面まで、頭に沿う丸い束を重ね、毛先を自然に内側へ巻く。
  for (let strand = 0; strand < 13; strand++) {
    const angle = 0.96 + strand / 12 * (TAU - 1.92);
    const sx = Math.sin(angle), sz = Math.cos(angle);
    const tipY = 0.908 + Math.sin(strand * 1.8) * 0.012;
    sweep("visitor-bob-rounded-lock", [
      [sx * 0.112, 1.224, sz * 0.097 - 0.025],
      [sx * 0.173, 1.128, sz * 0.153 - 0.028],
      [sx * 0.185, 1.006, sz * 0.159 - 0.026],
      [sx * 0.16, tipY + 0.015, sz * 0.141 - 0.018],
      [sx * 0.14, tipY, sz * 0.125 - 0.012],
    ], [0.025, 0.038, 0.038, 0.026, 0.001], [0.006, 0.017, 0.021, 0.017, 0.001],
      strand % 4 === 0 ? hairLight : strand % 4 === 1 ? hairDark : hair, body, 30, 12);
  }
  // 額の七つの前髪。一本ずつ立体の先端をずらし、目の中央を隠さない。
  for (let strand = 0; strand < 7; strand++) {
    const x = (strand - 3) * 0.042;
    const endY = [1.056, 1.075, 1.081, 1.052, 1.076, 1.075, 1.044][strand];
    const spread = Math.abs(x) / 0.13;
    const forward = 0.147 - spread * 0.027;
    sweep("visitor-sculpted-bang", [
      [x * 0.48, 1.253 - spread * 0.018, 0.058],
      [x * 0.84, 1.207, forward - 0.014],
      [x, 1.13, forward + 0.014],
      [x + 0.011, endY + 0.017, forward + 0.006],
      [x + 0.018, endY, forward - 0.003],
    ], [0.017, 0.027, 0.025, 0.016, 0.0004], [0.005, 0.014, 0.017, 0.012, 0.0004],
      strand % 3 === 0 ? hairLight : hair, body, 28, 12);
  }
  for (const side of [-1, 1]) {
    sweep("visitor-cheek-framing-lock", [
      [side * 0.139, 1.185, 0.084], [side * 0.173, 1.102, 0.087],
      [side * 0.175, 0.982, 0.091], [side * 0.139, 0.927, 0.089],
      [side * 0.13, 0.922, 0.079],
    ], [0.018, 0.03, 0.026, 0.014, 0.0004], [0.007, 0.018, 0.023, 0.014, 0.0004], hairLight);
  }
  // 柔らかな黄色いリボン。輪と垂れはそれぞれ厚みのある曲面。
  const bow = new THREE.Group();
  bow.name = "visitor-yellow-hair-bow";
  bow.position.set(0.172, 1.112, 0.032);
  bow.rotation.z = -0.12;
  bow.rotation.y = 0.25;
  body.add(bow);
  sweep("visitor-bow-upper-loop", [[0, 0, 0], [0.016, 0.041, 0.006], [0.022, 0.070, 0.004], [0.032, 0.026, 0.008], [0, 0, 0]],
    [0.007, 0.024, 0.020, 0.023, 0.007], [0.007, 0.009, 0.006, 0.01, 0.007], ribbonLight, bow);
  sweep("visitor-bow-lower-loop", [[0, 0, 0.004], [0.018, -0.028, 0.01], [0.031, -0.044, 0.008], [0.014, -0.065, 0.005]],
    [0.009, 0.025, 0.025, 0.019], [0.007, 0.009, 0.008, 0.003], ribbonMaterial, bow);
  oval("visitor-ribbon-knot", [0.015, 0.019, 0.014], [0.004, 0.003, 0.012], ribbonMaterial, bow);

  // 斜め掛けバッグは前後をつなぐ革ひも、編み地、丸いフラップと留め具。
  sweep("visitor-crossbody-front-strap", [[-0.109, 0.863, 0.068], [-0.084, 0.793, 0.111],
    [-0.012, 0.686, 0.112], [0.073, 0.573, 0.123], [0.14, 0.52, 0.135]],
    [0.007, 0.007, 0.007, 0.007, 0.007], [0.003, 0.003, 0.003, 0.003, 0.003], leather, body, 48, 8);
  sweep("visitor-crossbody-back-strap", [[-0.109, 0.863, 0.068], [-0.105, 0.877, -0.02], [-0.096, 0.825, -0.09],
    [-0.005, 0.677, -0.104], [0.115, 0.538, -0.099], [0.178, 0.526, 0.08]],
    [0.007, 0.007, 0.007, 0.007, 0.007, 0.007], [0.003, 0.003, 0.003, 0.003, 0.003, 0.003], leather, body, 56, 8);
  const bag = new THREE.Group();
  bag.name = "visitor-woven-crossbody-bag";
  bag.position.set(0.15, 0.507, 0.119);
  bag.rotation.y = 0.12;
  bag.rotation.z = -0.08;
  body.add(bag);
  roundedBox("visitor-woven-bag-body", [0.119, 0.143, 0.052], [0, 0, 0], leather, bag);
  roundedBox("visitor-bag-flap", [0.124, 0.079, 0.014], [0, 0.04, 0.031], flapMaterial, bag);
  thread("visitor-bag-rounded-binding", [[-0.055, 0.071, 0.041], [-0.056, 0.026, 0.041], [-0.035, 0.004, 0.041],
    [0, -0.004, 0.041], [0.035, 0.004, 0.041], [0.056, 0.026, 0.041], [0.055, 0.071, 0.041]], 0.0024, leatherEdge, bag, 40);
  roundedBox("visitor-bag-fastening-tab", [0.016, 0.032, 0.008], [0, 0.006, 0.044], leather, bag);
  oval("visitor-bag-brass-button", [0.007, 0.007, 0.0035], [0, 0.015, 0.049], material("#bb8d55", 0.5), bag);
  for (const side of [-1, 1]) oval("visitor-bag-strap-rivet", [0.005, 0.005, 0.003], [side * 0.047, 0.064, 0.042], leatherEdge, bag);

  // スカートの下の足首と、薄い底・二本のベルトを持つサンダル。
  for (const side of [-1, 1]) {
    const foot = new THREE.Group(); foot.name = "visitor-sandal-foot";
    foot.position.set(side * 0.073, 0, 0.008);
    foot.rotation.y = side * 0.075;
    group.add(foot);
    oval("visitor-ankle", [0.026, 0.075, 0.027], [0, 0.123, -0.006], skin, foot);
    roundedBox("visitor-thin-sandal-sole", [0.074, 0.016, 0.139], [0, 0.01, 0.025], soleMaterial, foot);
    oval("visitor-sandal-foot-skin", [0.033, 0.027, 0.064], [0, 0.038, 0.028], skin, foot);
    for (let toe = 0; toe < 4; toe++) oval("visitor-sandal-toe", [0.0077, 0.010, 0.011],
      [-0.023 + toe * 0.015, 0.034, 0.085 - Math.abs(toe - 1) * 0.002], skin, foot);
    sweep("visitor-sandal-front-strap", [[-0.034, 0.022, 0.06], [-0.023, 0.054, 0.067],
      [0, 0.061, 0.069], [0.023, 0.054, 0.067], [0.034, 0.022, 0.06]],
      [0.009, 0.009, 0.009, 0.009, 0.009], [0.003, 0.003, 0.003, 0.003, 0.003], leather, foot, 24, 8, "side");
    sweep("visitor-sandal-instep-strap", [[-0.032, 0.022, 0], [-0.026, 0.059, 0.011],
      [0, 0.074, 0.019], [0.026, 0.059, 0.011], [0.032, 0.022, 0]],
      [0.009, 0.009, 0.009, 0.009, 0.009], [0.003, 0.003, 0.003, 0.003, 0.003], leather, foot, 24, 8, "side");
    thread("visitor-sandal-heel-strap", [[-0.031, 0.022, -0.021], [-0.029, 0.055, -0.027],
      [0, 0.058, -0.035], [0.029, 0.055, -0.027], [0.031, 0.022, -0.021]], 0.005, leather, foot);
  }

  let disposed = false;
  scope.defer(() => group.removeFromParent());
  scope.defer(() => { disposed = true; });
  return {
    group,
    animate(time: number, reducedMotion: boolean) {
      if (disposed) return;
      const still = reducedMotion ? 0 : 1;
      body.position.y = Math.sin(time * 1.65) * 0.0014 * still;
      body.rotation.z = Math.sin(time * 0.7) * 0.003 * still;
      const blinkClock = (time + 1.3) % 5.7;
      const blink = blinkClock < 0.17 ? Math.sin(blinkClock / 0.17 * Math.PI) : 0;
      for (const eye of eyes) eye.scale.y = 1 - blink * 0.96 * still;
    },
    dispose: scope.dispose,
  };
}
