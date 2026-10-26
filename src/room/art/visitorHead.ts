import * as THREE from "three";
import type { VisitorArt, VisitorPoint } from "./visitorArt";

const TAU = Math.PI * 2;
const FACE_Y = 1.0945;
const FACE_HALF_HEIGHT = 0.1385;
const EYE_WIDTH = 0.0380;
const EYE_HEIGHT = 0.0320;
const EYE_OUTER_CORNER = 0.0040;

/** 短い顎と広い頬を持つ面。目・口もこの曲面から位置を求める。 */
function faceSection(y: number) {
  const n = THREE.MathUtils.clamp((y - FACE_Y) / FACE_HALF_HEIGHT, -1, 1);
  const round = Math.sqrt(Math.max(0, 1 - n * n));
  const jaw = THREE.MathUtils.smoothstep(-n, 0.12, 0.95);
  const temple = 1 - 0.08 * Math.exp(-(((y - 1.062) / 0.032) ** 2));
  const cheek = (1 + 0.02 * Math.exp(-(((y - 1.025) / 0.018) ** 2)))
    * (1 - 0.018 * Math.exp(-(((y - 1.001) / 0.010) ** 2)));
  return { width: 0.173 * 0.87 * round * (1 - jaw * 0.10) * temple * cheek, depth: 0.137 * round * (1 - jaw * 0.10) };
}

function faceZ(x: number, y: number) {
  const section = faceSection(y);
  const normalized = Math.min(1, Math.abs(x) / Math.max(0.00001, section.width));
  const cheek = 0.0045 * Math.exp(-(((Math.abs(x) - 0.083) / 0.052) ** 2) - ((y - 1.020) / 0.042) ** 2);
  const nose = 0.0085 * Math.exp(-((x / 0.019) ** 2) - ((y - 1.023) / 0.015) ** 2);
  const muzzle = 0.0030 * Math.exp(-((x / 0.049) ** 2) - ((y - 1.006) / 0.029) ** 2);
  const mouthRadius = Math.sqrt((x / 0.030) ** 2 + ((y - 0.994) / 0.016) ** 2);
  const mouthCavity = 0.005 * (1 - THREE.MathUtils.smoothstep(mouthRadius, 0.35, 1));
  // 顎を首より手前へ出し、下端が首に隠れて横一文字に見えるのを防ぐ。
  const chin = 0.037 * (1 - THREE.MathUtils.smoothstep(y, 0.944, 1.005))
    * Math.sqrt(Math.max(0, 1 - normalized * normalized));
  return 0.006 + section.depth * Math.pow(Math.max(0, 1 - normalized ** 2.2), 0.50) + cheek + nose + muzzle + chin - mouthCavity;
}

export function createVisitorHead(art: VisitorArt) {
  const { own, material, dataTexture } = art;
  const body = new THREE.Group();
  body.name = "visitor-head";
  body.scale.x = 0.875;
  art.body.add(body);
  const mesh: VisitorArt["mesh"] = (name, geometry, surface, parent = body) => art.mesh(name, geometry, surface, parent);
  const oval: VisitorArt["oval"] = (name, size, position, surface, parent = body) => art.oval(name, size, position, surface, parent);
  const thread: VisitorArt["thread"] = (name, points, radius, surface, parent = body, segments = 20) =>
    art.thread(name, points, radius, surface, parent, segments);
  const skin = material("#ffffff", 0.64);
  skin.vertexColors = true;
  skin.sheen = 0.09;
  skin.emissive.set("#ff5942");
  skin.emissiveIntensity = 0.40;
  const skinPlain = material("#f6c5aa", 0.64);
  const hair = material("#9e85bc", 0.60);
  const fringeMaterial = material("#9e85bc", 0.60);
  hair.clearcoat = fringeMaterial.clearcoat = 0.10;
  hair.clearcoatRoughness = fringeMaterial.clearcoatRoughness = 0.58;
  hair.sheen = fringeMaterial.sheen = 0.10;
  const browMaterial = material("#a58ab5", 0.8);

  const positions: number[] = [], colors: number[] = [], indices: number[] = [];
  const rows = 96, columns = 128;
  const skinColour = new THREE.Color("#ffceb6"), blushColour = new THREE.Color("#f29e96");
  for (let row = 0; row <= rows; row++) {
    const phi = row / rows * Math.PI;
    const y = FACE_Y + Math.cos(phi) * FACE_HALF_HEIGHT;
    const section = faceSection(y);
    for (let column = 0; column <= columns; column++) {
      const angle = column / columns * TAU;
      const x = Math.sin(angle) * section.width;
      const front = Math.cos(angle);
      const z = front >= 0 ? faceZ(x, y) : 0.006 + front * section.depth;
      const back = THREE.MathUtils.smoothstep(-front, 0.05, 0.80);
      const underside = 1 - THREE.MathUtils.smoothstep(y, 0.961, 0.982);
      // 顎の見える先端は短くし、奥の下面だけを既存の首へつなぐ。
      const backY = Math.max(0, 1.035 - y) * back * 0.60 * (1 - underside)
        - 0.012 * underside * back;
      positions.push(x, y + backY, z);
      const cheek = Math.exp(-(((Math.abs(x) - 0.090) / 0.047) ** 2) - ((y - 1.024) / 0.023) ** 2)
        * Math.max(0, front) * 0.72;
      const colour = skinColour.clone().lerp(blushColour, cheek);
      colors.push(colour.r, colour.g, colour.b);
      if (row < rows && column < columns) {
        const a = row * (columns + 1) + column, b = a + columns + 1;
        indices.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
  }
  const faceGeometry = own(new THREE.BufferGeometry());
  faceGeometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  faceGeometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  faceGeometry.setIndex(indices);
  faceGeometry.computeVertexNormals();
  mesh("visitor-soft-face", faceGeometry, skin);
  oval("visitor-neck", [0.044, 0.028, 0.038], [0, 0.922, 0.002], skinPlain);
  for (const side of [-1, 1]) {
    oval("visitor-ear", [0.016, 0.026, 0.015], [side * 0.147, 1.026, 0.023], skinPlain);
    const earShade = material("#eeb39e", 0.72);
    oval("visitor-ear-inner-fold", [0.005, 0.016, 0.009], [side * 0.160, 1.026, 0.027], earShade);
  }

  function colourAt(top: number[], bottom: number[], t: number) {
    return top.map((value, i) => Math.round(THREE.MathUtils.lerp(value, bottom[i], THREE.MathUtils.clamp(t, 0, 1))));
  }
  function eyeTexture(side: number) {
    const size = 512, pixels = new Uint8Array(size * size * 4);
    for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
      const u = (px + 0.5) / size * 2 - 1, v = (py + 0.5) / size * 2 - 1;
      const boundary = Math.sqrt(u * u + v * v);
      let c = colourAt([193, 177, 196], [250, 237, 227], THREE.MathUtils.smoothstep(-v, -0.80, 0.10));
      // 上まぶたは濃く、下まぶたは細く。白目を輪にせず、横の端へ残す。
      const rim = v > 0 ? 0.065 + Math.max(0, v) * 0.045 : 0.010;
      if (boundary > 1 - rim) c = v > -0.18 ? [39, 29, 48] : [106, 68, 94];
      const ix = (u + side * 0.12) / 0.65, iy = (v + 0.032) / 1.035;
      const irisRadius = Math.sqrt(ix * ix + iy * iy);
      if (irisRadius < 1 && boundary < 1 - rim * 0.65) {
        const light = THREE.MathUtils.smoothstep(-v, -0.45, 0.85);
        c = colourAt([62, 43, 85], [177, 118, 172], light);
        const fibre = (Math.sin(Math.atan2(iy, ix) * 42 + irisRadius * 8) + 1) / 2;
        const glow = Math.max(0, 1 - Math.abs(irisRadius - 0.70) / 0.25) * Math.max(0, -v) * 0.05;
        c = c.map((value, i) => Math.min(255, value + glow * [42, 28, 48][i] + fibre * 0.4));
        if (irisRadius > 0.92) c = colourAt(c, [62, 38, 77], THREE.MathUtils.smoothstep(irisRadius, 0.92, 0.995));
        const pupil = (ix / 0.35) ** 2 + ((iy - 0.07) / 0.32) ** 2;
        const pupilFade = 1 - THREE.MathUtils.smoothstep(iy, 0.11, 0.36);
        if (pupil < 1) c = colourAt(c, colourAt([65, 34, 90], [90, 47, 112], Math.max(0, -v)), pupilFade);
        if (pupil > 0.75 && pupil < 1.10) c = colourAt(c, [43, 26, 61],
          1 - THREE.MathUtils.smoothstep(iy, 0.10, 0.25));
        // 参考の瞳の下側にある、淡い結晶状の光を描く。
        const petalTop = -0.26 - Math.abs(ix) * 0.57;
        const petal = THREE.MathUtils.smoothstep(petalTop - iy, 0, 0.055);
        const petalColour = colourAt([211, 145, 189], [230, 174, 205],
          THREE.MathUtils.smoothstep(-iy, 0.35, 0.98));
        c = colourAt(c, petalColour, petal);
        const facetEdge = Math.abs(iy - petalTop);
        const facetInk = (1 - THREE.MathUtils.smoothstep(facetEdge, 0.018, 0.045))
          * THREE.MathUtils.smoothstep(-iy, 0.31, 0.42);
        c = colourAt(c, [111, 65, 125], facetInk * 0.90);
        // 虹彩の下辺だけを短い水平線と細い側縁で閉じる。
        const lowerIrisEdge = Math.max(THREE.MathUtils.smoothstep(irisRadius, 0.91, 0.985),
          1 - THREE.MathUtils.smoothstep(iy, -0.91, -0.865))
          * (1 - THREE.MathUtils.smoothstep(iy, -0.50, -0.18));
        c = colourAt(c, [74, 43, 84], lowerIrisEdge * 0.95);
        if ((ix + 0.35) ** 2 / 0.23 ** 2 + (iy - 0.60) ** 2 / 0.15 ** 2 < 1) c = [255, 252, 244];
        if ((ix - 0.47) ** 2 / 0.044 ** 2 + (iy + 0.45) ** 2 / 0.055 ** 2 < 1) c = [255, 242, 243];
        if ((ix - 0.03) ** 2 / 0.042 ** 2 + (iy - 0.44) ** 2 / 0.042 ** 2 < 1) c = [246, 230, 245];
      }
      const offset = (py * size + px) * 4;
      pixels.set([...c, Math.round(THREE.MathUtils.clamp((1 - boundary) * 160, 0, 1) * 255)], offset);
    }
    return dataTexture("visitor-painted-purple-iris", size, pixels);
  }

  const eyes: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    const eyeX = side * 0.071, eyeY = 1.060;
    const eye = new THREE.Group();
    eye.name = side < 0 ? "visitor-left-eye" : "visitor-right-eye";
    eye.position.set(eyeX, eyeY, 0);
    body.add(eye); eyes.push(eye);
    const eyeMaterial = material("#ffffff", 0.64);
    eyeMaterial.map = eyeTexture(side);
    eyeMaterial.transparent = true;
    eyeMaterial.alphaTest = 0.04;
    eyeMaterial.clearcoat = 0;
    eyeMaterial.specularIntensity = 0.18;
    eyeMaterial.envMapIntensity = 0.45;
    eyeMaterial.clearcoatRoughness = 0.60;
    eyeMaterial.sheen = 0;
    const p: number[] = [], uv: number[] = [], index: number[] = [];
    const rings = 22, sectors = 88;
    for (let ring = 0; ring <= rings; ring++) for (let sector = 0; sector <= sectors; sector++) {
      const r = ring / rings, angle = sector / sectors * TAU;
      const u = Math.cos(angle) * r, v = Math.sin(angle) * r;
      const x = eyeX + u * EYE_WIDTH * (1 + v * 0.10)
        + side * EYE_OUTER_CORNER * Math.max(0, side * u) ** 6;
      const y = eyeY + (v < -0.50 ? -0.50 - 0.3425 * Math.sqrt((-v - 0.50) / 0.50) : v) * EYE_HEIGHT + side * u * 0.001;
      const z = faceZ(x, y) + 0.0008 + (1 - r * r) * 0.0016;
      p.push(x - eyeX, y - eyeY, z); uv.push((u + 1) / 2, (v + 1) / 2);
      if (ring < rings && sector < sectors) {
        const a = ring * (sectors + 1) + sector, b = a + sectors + 1;
        index.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
    const geometry = own(new THREE.BufferGeometry());
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    geometry.setIndex(index); geometry.computeVertexNormals();
    mesh("visitor-curved-purple-eye", geometry, eyeMaterial, eye);
    const eyelash = material("#2c2335", 0.72);
    eyelash.clearcoat = 0; eyelash.sheen = 0; eyelash.specularIntensity = 0.15;
    // まつ毛の上縁は丸い管でなく、顔へ沿う先細りの帯。
    const lidPositions: number[] = [], lidIndices: number[] = [];
    for (let i = 0; i <= 64; i++) {
      const angle = Math.PI * (0.015 + i / 64 * 0.97);
      const u = Math.cos(angle), v = Math.sin(angle);
      const thickness = 0.0007 + 0.0044 * v ** 0.35 * (0.69 + 0.34 * side * u);
      for (let edge = 0; edge < 2; edge++) {
        const x = eyeX + u * EYE_WIDTH * (1 + v * 0.10)
          + side * EYE_OUTER_CORNER * Math.max(0, side * u) ** 6 + u * (edge * thickness - (1 - edge) * 0.0015);
        const y = eyeY + v * EYE_HEIGHT + v * (edge * thickness - (1 - edge) * 0.0015);
        lidPositions.push(x, y, faceZ(x, y) + 0.0022);
      }
      if (i < 64) {const a = i * 2; lidIndices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);}
    }
    const lidGeometry = own(new THREE.BufferGeometry());
    lidGeometry.setAttribute("position", new THREE.Float32BufferAttribute(lidPositions, 3));
    lidGeometry.setIndex(lidIndices); lidGeometry.computeVertexNormals();
    mesh("visitor-flat-upper-eyelid", lidGeometry, eyelash).castShadow = false;
    // 上まぶたの近くにある、短く淡い折り目。
    const crease: VisitorPoint[] = [];
    const creaseMaterial = material("#9b7169", 0.92);
    creaseMaterial.clearcoat = 0; creaseMaterial.sheen = 0;
    for (let i = 0; i <= 22; i++) {
      const angle = Math.PI * (0.33 + i / 22 * 0.28);
      const x = eyeX + side * Math.cos(angle) * EYE_WIDTH * 0.94;
      const y = eyeY + Math.sin(angle) * (EYE_HEIGHT + 0.0065);
      crease.push([x, y, faceZ(x, y) + 0.0010]);
    }
    thread("visitor-upper-lid-crease", crease, 0.00065, creaseMaterial, body, 30).castShadow = false;
    const brow: VisitorPoint[] = [];
    for (let i = 0; i <= 12; i++) {
      const x = eyeX + (i / 12 - 0.5) * 0.049;
      const y = 1.119 + Math.sin(i / 12 * Math.PI) * 0.004;
      brow.push([x, y, faceZ(x, y) + 0.0009]);
    }
    thread("visitor-soft-eyebrow", brow, 0.0010, browMaterial, body, 20);
    const wingPositions: number[] = [], wingIndex: number[] = [];
    for (let i = 0; i <= 28; i++) {
      const t = i / 28, angle = -0.24 + t * 1.44;
      const wedge = Math.max(0, 1 - Math.abs(t - 0.22) / 0.52);
      const thickness = 0.0080 * wedge ** 1.10 * THREE.MathUtils.smoothstep(t, 0, 0.07);
      for (let edge = 0; edge < 2; edge++) {
        const x = eyeX + side * Math.cos(angle) * (EYE_WIDTH * (1 + Math.sin(angle) * 0.1) + edge * thickness)
          + side * EYE_OUTER_CORNER * Math.max(0, Math.cos(angle)) ** 6;
        const y = eyeY + Math.sin(angle) * (EYE_HEIGHT + edge * thickness);
        wingPositions.push(x, y, faceZ(x, y) + 0.0026);
      }
      if (i < 28) {
        const a = i * 2;
        if (side > 0) wingIndex.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
        else wingIndex.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
    const wingGeometry = own(new THREE.BufferGeometry());
    wingGeometry.setAttribute("position", new THREE.Float32BufferAttribute(wingPositions, 3));
    wingGeometry.setIndex(wingIndex); wingGeometry.computeVertexNormals();
    mesh("visitor-outer-lid-wing", wingGeometry, eyelash).castShadow = false;
    // 外側と上側へ短い睫毛を置き、根元は上まぶたの帯へ重ねる。
    const lashAngles = [0.24, 0.99, 1.48];
    for (const [i, angle] of lashAngles.entries()) {
      const nx = side * Math.cos(angle), ny = Math.sin(angle);
      const x = eyeX + nx * (EYE_WIDTH + 0.0032) * (1 + ny * 0.10)
        + side * EYE_OUTER_CORNER * Math.cos(angle) ** 6;
      const y = eyeY + ny * (EYE_HEIGHT + 0.0032);
      const length = [0.0060, 0.0040, 0.0035][i];
      const halfBase = i === 0 ? 0.0017 : 0.00125;
      const lashPoints = [
        [x - side * ny * halfBase, y + Math.cos(angle) * halfBase],
        [x + (i === 0 ? side * length : side * 0.0004), y + (i === 0 ? 0.0014 : length)],
        [x + side * ny * halfBase, y - Math.cos(angle) * halfBase],
      ];
      const g = own(new THREE.BufferGeometry());
      g.setAttribute("position", new THREE.Float32BufferAttribute(lashPoints.flatMap(([lx, ly]) =>
        [lx, ly, faceZ(lx, ly) + 0.0028]), 3));
      g.setIndex(side > 0 ? [0, 2, 1] : [0, 1, 2]); g.computeVertexNormals();
      mesh("visitor-tapered-eyelash", g, eyelash).castShadow = false;
    }
  }

  // 楕円を重ねず、顔へ沿った上辺とU字の底を持つ開いた笑顔。
  const mouthShape = new THREE.Shape();
  mouthShape.moveTo(-0.026, 0.008);
  mouthShape.quadraticCurveTo(0, -0.001, 0.026, 0.008);
  mouthShape.bezierCurveTo(0.030, 0.010, 0.033, 0.005, 0.032, -0.002);
  mouthShape.bezierCurveTo(0.031, -0.016, 0.021, -0.023, 0, -0.023);
  mouthShape.bezierCurveTo(-0.021, -0.023, -0.031, -0.016, -0.032, -0.002);
  mouthShape.bezierCurveTo(-0.033, 0.005, -0.030, 0.010, -0.026, 0.008);
  // 境界だけの三角形は頬の曲面へ埋まるため、内部も細かく割って沿わせる。
  const mouthContour = mouthShape.getPoints(48);
  const mouthPoints: number[] = [], mouthColors: number[] = [], mouthIndices: number[] = [];
  const mouthRings = 18, mouthColumns = mouthContour.length;
  const mouthTop = new THREE.Color("#ca5b54"), mouthBottom = new THREE.Color("#e9766d");
  for (let ring = 0; ring <= mouthRings; ring++) for (let col = 0; col < mouthColumns; col++) {
    const r = ring / mouthRings;
    const x = mouthContour[col].x * r, localY = -0.005 + (mouthContour[col].y + 0.005) * r;
    const y = 1.001 + localY;
    mouthPoints.push(x, y, faceZ(x, y) + 0.0020);
    const colour = mouthTop.clone().lerp(mouthBottom, THREE.MathUtils.smoothstep(-localY, -0.005, 0.020));
    const tongue = Math.exp(-((x / 0.020) ** 2) - (((localY + 0.016) / 0.009) ** 2)) * 0.10;
    colour.lerp(new THREE.Color("#ed8c7f"), tongue);
    const upperEdge = 0.0035 + (x / 0.026) ** 2 * 0.0045;
    const tooth = THREE.MathUtils.smoothstep(localY, upperEdge - 0.0035, upperEdge - 0.0003)
      * (1 - THREE.MathUtils.smoothstep(Math.abs(x), 0.022, 0.027));
    colour.lerp(new THREE.Color("#ffd8c5"), tooth * 0.35);
    if (r > 0.93 && localY < 0.002) colour.lerp(new THREE.Color("#a8414a"), (r - 0.93) / 0.07 * 0.26);
    mouthColors.push(colour.r, colour.g, colour.b);
    if (ring < mouthRings && col < mouthColumns - 1) {
      const a = ring * mouthColumns + col, b = a + mouthColumns;
      mouthIndices.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  const mouthGeometry = own(new THREE.BufferGeometry());
  mouthGeometry.setAttribute("position", new THREE.Float32BufferAttribute(mouthPoints, 3));
  mouthGeometry.setAttribute("color", new THREE.Float32BufferAttribute(mouthColors, 3));
  mouthGeometry.setIndex(mouthIndices);
  mouthGeometry.computeVertexNormals();
  const mouthMaterial = material("#ffffff", 0.72); mouthMaterial.vertexColors = true;
  mouthMaterial.clearcoat = 0;
  mouthMaterial.sheen = 0;
  mouthMaterial.specularIntensity = 0.15;
  mouthMaterial.envMapIntensity = 0.25;
  mesh("visitor-open-happy-smile", mouthGeometry, mouthMaterial);
  // 鼻先は顔本体に連続する起伏で作り、白い球の継ぎ目を作らない。

  // 顔の輪郭調整で髪を動かさないため、既存の髪の支持面を独立させる。
  function fringeSupportSection(y: number) {
    const n = THREE.MathUtils.clamp((y - 1.083) / 0.150, -1, 1);
    const round = Math.sqrt(Math.max(0, 1 - n * n));
    const jaw = THREE.MathUtils.smoothstep(-n, 0.12, 0.95);
    return { width: 0.173 * round * (1 - jaw * 0.23), depth: 0.137 * round * (1 - jaw * 0.10) };
  }

  function fringeSupportZ(x: number, y: number) {
    const section = fringeSupportSection(y);
    const normalized = Math.min(1, Math.abs(x) / Math.max(0.00001, section.width));
    const cheek = 0.0035 * Math.exp(-(((Math.abs(x) - 0.083) / 0.052) ** 2) - ((y - 1.020) / 0.042) ** 2);
    const nose = 0.0160 * Math.exp(-((x / 0.014) ** 2) - ((y - 1.023) / 0.019) ** 2);
    const muzzle = 0.0080 * Math.exp(-((x / 0.049) ** 2) - ((y - 0.996) / 0.029) ** 2);
    const mouthRadius = Math.sqrt((x / 0.030) ** 2 + ((y - 0.984) / 0.016) ** 2);
    const mouthCavity = 0.005 * (1 - THREE.MathUtils.smoothstep(mouthRadius, 0.35, 1));
    return 0.006 + section.depth * Math.pow(Math.max(0, 1 - normalized ** 2.2), 0.50) + cheek + nose + muzzle - mouthCavity;
  }

  // 上半分は丸く、耳の下は少し直線的に落ちるボブの連続した土台。
  function bobPoint(phi: number, angle: number, lift = 0) {
    const radial = Math.sin(phi) + THREE.MathUtils.smoothstep(phi, 1.40, 2.34) * 0.095;
    return new THREE.Vector3(Math.sin(angle) * (0.192 * radial + lift),
      1.084 + Math.cos(phi) * 0.194,
      -0.012 + Math.cos(angle) * (0.171 * radial + lift));
  }
  const capPositions: number[] = [], capUvs: number[] = [], capIndices: number[] = [], capColors: number[] = [];
  const capRows = 80, capColumns = 192;
  const hem: THREE.Vector3[] = [];
  for (let row = 0; row <= capRows; row++) for (let column = 0; column <= capColumns; column++) {
    const t = row / capRows, angle = column / capColumns * TAU;
    const front = THREE.MathUtils.smoothstep(Math.cos(angle), Math.cos(1.28), Math.cos(0.87));
    const scallop = Math.pow(0.5 + 0.5 * Math.cos(angle * 14 + Math.sin(angle * 3) * 0.6), 0.55);
    const endPhi = THREE.MathUtils.lerp(2.32 + scallop * 0.035, 1.10, front);
    const phi = t * endPhi;
    const groove = Math.cos(angle * 13 + 0.8 * Math.sin(phi)) * 0.0007 * Math.sin(phi) ** 1.5 * (1 - front);
    const recess = THREE.MathUtils.smoothstep(phi, 1.48, 2.13) * 0.018;
    const point = bobPoint(phi, angle, groove - recess);
    capPositions.push(...point.toArray()); capUvs.push(column / capColumns, t);
    const shade = 1 - THREE.MathUtils.smoothstep(phi, 1.52, 2.12) * 0.17;
    capColors.push(shade, shade, shade);
    if (row === capRows) hem.push(point);
    if (row < capRows && column < capColumns) {
      const a = row * (capColumns + 1) + column, b = a + capColumns + 1;
      capIndices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  // 毛先を内側へ巻き込み、薄い殻の切断面から背景を見せない。
  const innerStart = capPositions.length / 3;
  for (const point of hem) {
    capPositions.push(point.x * 0.87, point.y + 0.015, -0.012 + (point.z + 0.012) * 0.87);
    capUvs.push(0, 1); capColors.push(0.80, 0.80, 0.80);
  }
  for (let col = 0; col < capColumns; col++) {
    const a = capRows * (capColumns + 1) + col, b = innerStart + col;
    capIndices.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const capGeometry = own(new THREE.BufferGeometry());
  capGeometry.setAttribute("position", new THREE.Float32BufferAttribute(capPositions, 3));
  capGeometry.setAttribute("uv", new THREE.Float32BufferAttribute(capUvs, 2));
  capGeometry.setAttribute("color", new THREE.Float32BufferAttribute(capColors, 3));
  hair.vertexColors = true;
  capGeometry.setIndex(capIndices); capGeometry.computeVertexNormals();
  const crownNormals = capGeometry.getAttribute("normal");
  for (let column = 0; column <= capColumns; column++) crownNormals.setXYZ(column, 0, 1, 0);
  mesh("visitor-lilac-bob-crown", capGeometry, hair);
  // 内側の共有球には頂点色がないため、殻とは別の同色素材を使う。
  const hairLining = material("#9e85bc", 0.66);
  for (const side of [-1, 1]) {
    oval("visitor-bob-inner-volume", [0.025, 0.070, 0.045], [side * 0.163, 1.072, -0.016], hairLining);
    oval("visitor-inner-nape-volume", [0.028, 0.040, 0.030], [side * 0.127, 0.987, -0.006], hairLining);
  }

  // 等間隔の板を並べず、広いS字の中央束と細い脇の束を重ねる。
  const layeredHair = material("#9e85bc", 0.60);
  layeredHair.vertexColors = true;
  layeredHair.clearcoat = 0.08; layeredHair.clearcoatRoughness = 0.62;
  const bobLocks = [
    [0.94, 0.20, -0.06, 2.40], [1.23, 0.22, -0.12, 2.44],
    [1.55, 0.25, -0.16, 2.39], [1.88, 0.27, -0.10, 2.47],
    [2.23, 0.29, 0.04, 2.38], [2.56, 0.28, 0.17, 2.48],
    [2.95, 0.28, 0.43, 2.40], [3.32, 0.27, 0.09, 2.49],
    [3.67, 0.28, 0.05, 2.41], [3.98, 0.28, -0.06, 2.47],
    [4.32, 0.25, -0.06, 2.45], [4.65, 0.24, -0.12, 2.40],
    [4.98, 0.22, -0.15, 2.46], [5.28, 0.20, -0.05, 2.39],
    [2.36, 0.20, 0.13, 2.38, -0.010], [2.87, 0.23, 0.04, 2.39, -0.010],
    [3.43, 0.20, -0.02, 2.38, -0.010], [3.94, 0.20, -0.05, 2.37, -0.010],
    [0.91, 0.21, 0.08, 2.43, -0.021], [5.33, 0.21, -0.08, 2.43, -0.021],
  ];
  for (const [strand, [centre, width, bend, endPhi, depthOffset = 0]] of bobLocks.entries()) {
    const p: number[] = [], uv: number[] = [], index: number[] = [], colors: number[] = [];
    const rows = 80, columns = 32;
    for (let row = 0; row <= rows; row++) {
      const t = row / rows;
      const phi = THREE.MathUtils.lerp(0.07 + (strand % 3) * 0.035, endPhi, t);
      const taper = Math.sqrt(1 - THREE.MathUtils.smoothstep(t, 0.70, 1));
      const halfWidth = width * (0.62 + Math.sin(Math.PI * t) * 0.38) * Math.max(0.002, taper);
      const adjustedCentre = 1.25 + (centre - 0.94) * (TAU - 2.50) / 4.34;
      const flow = adjustedCentre + bend * THREE.MathUtils.smoothstep(t, 0.24, 1)
        - Math.sin(t * Math.PI) * bend * 0.40;
      const emerge = THREE.MathUtils.smoothstep(t, 0.03, 0.25);
      for (let col = 0; col <= columns; col++) {
        const around = col / columns * TAU, u = Math.cos(around), dome = Math.sin(around);
        const angle = flow + u * halfWidth * 0.90;
        const tip = 1 - THREE.MathUtils.smoothstep(t, 0.96, 1);
        const relief = (dome >= 0 ? dome * 0.015 : dome * 0.004)
          * THREE.MathUtils.smoothstep(t, 0.02, 0.26) * tip;
        const overlap = strand === 6 ? 0.005 * Math.sin(t * Math.PI) : 0;
        const lift = (0.0018 + relief + overlap + depthOffset) * emerge - (1 - emerge) * 0.004;
        const point = bobPoint(phi, angle, lift);
        p.push(...point.toArray()); uv.push(col / columns, t);
        const shade = 1 - (0.18 - Math.max(0, dome) * 0.18) * THREE.MathUtils.smoothstep(t, 0.16, 0.40);
        colors.push(shade, shade, shade);
        if (row < rows && col < columns) {
          const a = row * (columns + 1) + col, b = a + columns + 1;
          index.push(a, a + 1, b, a + 1, b + 1, b);
        }
      }
    }
    const geometry = own(new THREE.BufferGeometry());
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(index); geometry.computeVertexNormals();
    const normals = geometry.getAttribute("normal");
    const vertices = geometry.getAttribute("position");
    for (let row = 0; row <= rows; row++) {
      for (let col = 0; col <= columns; col++) {
        const i = row * (columns + 1) + col;
        const position = new THREE.Vector3().fromBufferAttribute(vertices, i);
        const scalpNormal = new THREE.Vector3(position.x / 0.192 ** 2,
          (position.y - 1.084) / 0.194 ** 2, (position.z + 0.012) / 0.171 ** 2).normalize();
        const normal = scalpNormal.lerp(new THREE.Vector3().fromBufferAttribute(normals, i),
          THREE.MathUtils.smoothstep(row / rows, 0.12, 0.32)).normalize();
        normals.setXYZ(i, normal.x, normal.y, normal.z);
      }
      const first = row * (columns + 1), last = first + columns;
      const normal = new THREE.Vector3().fromBufferAttribute(normals, first)
        .add(new THREE.Vector3().fromBufferAttribute(normals, last)).normalize();
      normals.setXYZ(first, normal.x, normal.y, normal.z); normals.setXYZ(last, normal.x, normal.y, normal.z);
    }
    const strandMesh = mesh("visitor-layered-bob-lock", geometry, layeredHair);
    strandMesh.castShadow = true;
  }

  // 根元から先端まで閉じた扁平な断面。表裏を別の板にせず、輪郭の法線も連続させる。
  function lock(name: string, points: VisitorPoint[], widths: number[], depth: number) {
    const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)));
    const p: number[] = [], uv: number[] = [], index: number[] = [], vertexColors: number[] = [];
    const length = 72, across = 40;
    for (let row = 0; row <= length; row++) {
      const t = row / length, center = curve.getPoint(t);
      const q = t * (widths.length - 1), n = Math.min(widths.length - 2, Math.floor(q));
      const width = THREE.MathUtils.lerp(widths[n], widths[n + 1], THREE.MathUtils.smoothstep(q - n, 0, 1));
      for (let col = 0; col <= across; col++) {
        const angle = col / across * TAU;
        const u = Math.cos(angle), dome = Math.sin(angle);
        const x = center.x + u * width, y = center.y;
        const scalp = -0.012 + 0.171 * Math.sqrt(Math.max(0,
          1 - ((y - 1.084) / 0.194) ** 2 - (x / 0.192) ** 2));
        const relief = depth * dome * Math.pow(Math.sin(Math.PI * t), 0.65);
        const skinSurface = fringeSupportZ(x, y);
        const surface = THREE.MathUtils.lerp(scalp, Math.max(scalp, skinSurface + 0.0035),
          1 - THREE.MathUtils.smoothstep(y, 1.105, 1.210));
        let z: number;
        if (name === "visitor-sculpted-bang") {
          const emerge = THREE.MathUtils.smoothstep(t, 0.02, 0.23);
          z = surface + (dome >= 0 ? relief * emerge + 0.0008 : relief * 0.4)
            - (1 - emerge) * 0.004;
        } else {
          const frontZ = Math.max(center.z, skinSurface + 0.003);
          z = THREE.MathUtils.lerp(frontZ + relief, surface + relief,
            THREE.MathUtils.smoothstep(y, 1.14, 1.225));
        }
        p.push(x, y, z); uv.push(col / across, t);
        const shade = 1 - (0.20 - 0.20 * Math.max(0, dome) ** 0.35) * THREE.MathUtils.smoothstep(t, 0.16, 0.42);
        vertexColors.push(shade, shade, shade);
        if (row < length && col < across) {
          const a = row * (across + 1) + col, b = a + across + 1;
          index.push(a, a + 1, b, a + 1, b + 1, b);
        }
      }
    }
    const geometry = own(new THREE.BufferGeometry());
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    geometry.setIndex(index); geometry.computeVertexNormals();
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(vertexColors, 3));
    fringeMaterial.vertexColors = true;
    const normals = geometry.getAttribute("normal");
    const vertices = geometry.getAttribute("position");
    for (let row = 0; row <= length; row++) for (let col = 0; col <= across; col++) {
      const i = row * (across + 1) + col;
      const position = new THREE.Vector3().fromBufferAttribute(vertices, i);
      const scalpNormal = new THREE.Vector3(position.x / 0.192 ** 2,
        (position.y - 1.084) / 0.194 ** 2, (position.z + 0.012) / 0.171 ** 2).normalize();
      const normal = scalpNormal.lerp(new THREE.Vector3().fromBufferAttribute(normals, i),
        THREE.MathUtils.smoothstep(row / length, 0.10, 0.35)).normalize();
      normals.setXYZ(i, normal.x, normal.y, normal.z);
    }
    for (let row = 0; row <= length; row++) {
      const first = row * (across + 1), last = first + across;
      const normal = new THREE.Vector3().fromBufferAttribute(normals, first)
        .add(new THREE.Vector3().fromBufferAttribute(normals, last)).normalize();
      normals.setXYZ(first, normal.x, normal.y, normal.z); normals.setXYZ(last, normal.x, normal.y, normal.z);
    }
    const strandMesh = mesh(name, geometry, fringeMaterial);
    strandMesh.castShadow = true;
    return strandMesh;
  }
  const fringe = [
    { x: -0.150, tip: 1.059, lean: -0.010, width: 0.026 },
    { x: -0.105, tip: 1.110, lean: -0.006, width: 0.026 },
    { x: -0.059, tip: 1.100, lean: 0.011, width: 0.029 },
    { x: -0.010, tip: 1.083, lean: 0.023, width: 0.030 },
    { x: 0.040, tip: 1.110, lean: 0.022, width: 0.028 },
    { x: 0.087, tip: 1.098, lean: 0.020, width: 0.027 },
    { x: 0.111, tip: 1.075, lean: 0.016, width: 0.026 },
    { x: 0.135, tip: 1.016, lean: -0.016, width: 0.029 },
  ];
  const scalpZ = (x: number, y: number) => -0.012 + 0.171 * Math.sqrt(Math.max(0,
    1 - ((y - 1.084) / 0.194) ** 2 - (x / 0.192) ** 2));
  for (const bang of fringe) {
    const spread = Math.abs(bang.x) / 0.16;
    const rootX = bang.x * 0.55, rootY = 1.265 - spread * 0.025;
    const cheekBang = bang.x > 0.12;
    const upperX = cheekBang ? 0.112 : bang.x * 0.68, upperY = 1.236 - spread * 0.01;
    const middleX = cheekBang ? 0.153 : bang.x * 0.94;
    const lowerX = cheekBang ? 0.148 : bang.x + bang.lean * 0.50, lowerY = bang.tip + 0.025;
    const tipX = bang.x + bang.lean;
    // 頭頂で束が浮いて背面の隙間が見えないよう、前髪の根元も頭の楕円へ沿わせる。
    lock("visitor-sculpted-bang", [[rootX, rootY, scalpZ(rootX, rootY) - 0.004],
      [upperX, upperY, scalpZ(upperX, upperY) - 0.002],
      [middleX, 1.163, scalpZ(middleX, 1.163) + 0.002],
      [lowerX, lowerY, Math.max(scalpZ(lowerX, lowerY) + 0.003, fringeSupportZ(lowerX, lowerY) + 0.004)],
      [tipX, bang.tip, Math.max(scalpZ(tipX, bang.tip) + 0.004, fringeSupportZ(tipX, bang.tip) + 0.005)]],
    [0.002, bang.width * 0.87, bang.width * (cheekBang ? 0.86 : 1),
      bang.width * (cheekBang ? 0.43 : 0.61), 0.00018], 0.012);
  }
  // リボン側の短い頬束は最後の前髪と一体化し、独立した棒状の先端を作らない。
  lock("visitor-cheek-framing-lock", [
    [-0.144, 1.207, scalpZ(-0.144, 1.207) - 0.004],
    [-0.175, 1.138, 0.047], [-0.176, 1.039, 0.058],
    [-0.168, 0.975, 0.061], [-0.146, 0.947, 0.050],
  ], [0.012, 0.027, 0.027, 0.016, 0.0005], 0.011);
  return { eyes };
}
