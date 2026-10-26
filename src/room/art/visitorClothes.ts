import * as THREE from "three";
import type { VisitorArt, VisitorPoint } from "./visitorArt";

const TAU = Math.PI * 2;
type Point = VisitorPoint;

/** 参考の細いケーブル編みと、不揃いの花・枝葉を持つロングワンピース。 */
export function createVisitorClothes(art: VisitorArt): void {
  const { body, own, material, mesh, oval, thread, sweep, dataTexture } = art;
  const knit = material("#e5cfb3", 0.91);
  const edging = material("#dcc3a3", 0.91);
  const knitLight = material("#e8d2b6", 0.91);
  const cableKnit = material("#ddc9b1", 0.94);
  knit.sheen = knitLight.sheen = 0.14;
  knit.sheenColor.set("#f2e5d4");
  const knitSize = 512;
  const knitPixels = new Uint8Array(knitSize * knitSize * 4);
  const ribPixels = new Uint8Array(knitSize * knitSize * 4);
  for (let y = 0; y < knitSize; y++) for (let x = 0; x < knitSize; x++) {
    const u = x / knitSize, v = y / knitSize;
    const lane = u * 4, local = lane % 1;
    const twist = Math.sin(v * TAU * 5) * 0.075;
    const cableA = Math.exp(-Math.pow((local - 0.34 - twist) / 0.052, 2));
    const cableB = Math.exp(-Math.pow((local - 0.58 + twist) / 0.052, 2));
    const stitchV = (v * 54) % 1;
    const fine = Math.cos((u * 96 + Math.abs(stitchV - 0.5) * 0.85) * TAU);
    const rib = Math.cos(u * TAU * 56) * 0.5 + 0.5;
    const h = Math.round(107 + Math.max(cableA, cableB) * 89 + rib * 13 + fine * 12);
    const i = (y * knitSize + x) * 4;
    knitPixels.set([h, h, h, 255], i);
    const r = Math.round(124 + Math.cos(u * TAU * 48) * 47 + Math.cos(v * TAU * 48) * 4);
    ribPixels.set([r, r, r, 255], i);
  }
  const knitTexture = dataTexture("visitor-fine-cable-knit", knitSize, knitPixels, [3.5, 2]);
  knitTexture.colorSpace = THREE.NoColorSpace;
  const sleeveTexture = dataTexture("visitor-sleeve-cable-knit", knitSize, knitPixels, [1.45, 2.7]);
  sleeveTexture.colorSpace = THREE.NoColorSpace;
  const ribTexture = dataTexture("visitor-hem-and-cuff-ribbing", knitSize, ribPixels, [1, 1]);
  ribTexture.colorSpace = THREE.NoColorSpace;
  knit.bumpMap = knitTexture; knit.bumpScale = 0.0019;
  edging.bumpMap = ribTexture; edging.bumpScale = 0.0014;
  knitLight.bumpMap = sleeveTexture; knitLight.bumpScale = 0.0019;

  // すべての花弁・枝葉を周期的に描き、継ぎ目も同じ濃度にする。
  const size = 1024, pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4;
    const grain = ((x * 19 + y * 31) % 9 - 4) * 0.32;
    pixels.set([25 + grain, 39 + grain, 76 + grain, 255], i);
  }
  const colour = (hex: number) => [hex >> 16 & 255, hex >> 8 & 255, hex & 255];
  function pixel(x: number, y: number, c: number[], alpha = 1) {
    const i = (((y % size + size) % size) * size + ((x % size + size) % size)) * 4;
    for (let k = 0; k < 3; k++) pixels[i + k] = Math.round(THREE.MathUtils.lerp(pixels[i + k], c[k], alpha));
  }
  function polygon(points: [number, number][], hex: number, alpha = 1) {
    const c = colour(hex);
    const minY = Math.floor(Math.min(...points.map(p => p[1]))), maxY = Math.ceil(Math.max(...points.map(p => p[1])));
    for (let y = minY; y <= maxY; y++) {
      const intersections: number[] = [];
      for (let i = 0; i < points.length; i++) {
        const a = points[i], b = points[(i + 1) % points.length];
        if ((a[1] <= y + 0.5 && b[1] > y + 0.5) || (b[1] <= y + 0.5 && a[1] > y + 0.5))
          intersections.push(a[0] + (y + 0.5 - a[1]) / (b[1] - a[1]) * (b[0] - a[0]));
      }
      intersections.sort((a, b) => a - b);
      for (let j = 0; j + 1 < intersections.length; j += 2) {
        const left = intersections[j], right = intersections[j + 1];
        for (let x = Math.floor(left); x <= right; x++) {
          const coverage = Math.max(0, Math.min(x + 1, right) - Math.max(x, left));
          if (coverage > 0) pixel(x, y, c, coverage * alpha);
        }
      }
    }
  }
  function stroke(points: [number, number][], width: number, hex: number, alpha = 1) {
    const c = colour(hex);
    for (let i = 0; i + 1 < points.length; i++) {
      const a = points[i], b = points[i + 1], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const steps = Math.max(1, Math.ceil(len));
      for (let j = 0; j <= steps; j++) {
        const t = j / steps, cx = THREE.MathUtils.lerp(a[0], b[0], t), cy = THREE.MathUtils.lerp(a[1], b[1], t);
        for (let y = Math.floor(cy - width - 1); y <= cy + width + 1; y++)
          for (let x = Math.floor(cx - width - 1); x <= cx + width + 1; x++) {
            const coverage = THREE.MathUtils.clamp(width + 0.6 - Math.hypot(x + 0.5 - cx, y + 0.5 - cy), 0, 1);
            if (coverage) pixel(x, y, c, alpha * coverage);
          }
      }
    }
  }
  function leaf(cx: number, cy: number, length: number, width: number, angle: number, hex: number, bend = 0.15) {
    const d: [number, number] = [Math.cos(angle), Math.sin(angle)], n: [number, number] = [-d[1], d[0]];
    const point = (t: number, side: number): [number, number] => {
      const wobble = Math.sin(t * Math.PI) * length * bend;
      const w = Math.pow(Math.sin(t * Math.PI), 0.82) * width * side;
      return [cx + d[0] * length * t + n[0] * (wobble + w), cy + d[1] * length * t + n[1] * (wobble + w)];
    };
    const points: [number, number][] = [];
    for (let i = 0; i <= 14; i++) points.push(point(i / 14, 1));
    for (let i = 14; i >= 0; i--) points.push(point(i / 14, -1));
    polygon(points, hex);
    stroke(Array.from({ length: 10 }, (_, i) => point(i / 10, 0)), 0.65, 0xa6b4c4, 0.48);
  }
  function petal(cx: number, cy: number, length: number, width: number, angle: number, hex: number, variation: number) {
    const dx = Math.cos(angle), dy = Math.sin(angle), nx = -dy, ny = dx;
    const points: [number, number][] = [];
    for (let side of [1, -1]) {
      for (let i = 0; i <= 18; i++) {
        const t = side === 1 ? i / 18 : 1 - i / 18;
        const flare = Math.pow(Math.sin(t * Math.PI), 0.62) * (0.7 + t * 0.48);
        const lobes = 1 + Math.sin(t * Math.PI * 5 + variation) * 0.11;
        const centre = Math.sin(t * Math.PI) * variation * width * 0.22;
        const w = width * flare * lobes * side;
        points.push([cx + dx * length * t + nx * (w + centre), cy + dy * length * t + ny * (w + centre)]);
      }
    }
    polygon(points, hex);
    stroke([[cx, cy], [cx + dx * length * 0.45, cy + dy * length * 0.45], [cx + dx * length * 0.82 + nx * width * 0.14, cy + dy * length * 0.82 + ny * width * 0.14]],
      0.7, 0xf2ca76, 0.55);
  }
  function frond(cx: number, cy: number, length: number, angle: number, white: boolean) {
    const dx = Math.cos(angle), dy = Math.sin(angle), nx = -dy, ny = dx;
    const points: [number, number][] = [];
    for (let i = 0; i <= 12; i++) {
      const t = i / 12;
      points.push([cx + dx * length * t + nx * Math.sin(t * Math.PI) * length * 0.12,
        cy + dy * length * t + ny * Math.sin(t * Math.PI) * length * 0.12]);
    }
    stroke(points, 0.85, white ? 0xdedcca : 0x7494b2);
    for (let i = 2; i <= 10; i++) for (const side of [-1, 1]) {
      const p = points[i], t = i / 12, reach = length * (0.28 - t * 0.16);
      leaf(p[0], p[1], reach, reach * 0.11, angle + side * (0.6 + t * 0.3),
        white ? (i % 2 ? 0xf0e7d3 : 0xcbd0cd) : (i % 2 ? 0x678bae : 0x93a5bc), side * 0.05);
    }
  }
  // 花から独立した枝葉を先に置き、黄色だけが規則的に並ぶのを避ける。
  const branchPalette = [0x6486a7, 0x829db7, 0x355f76, 0x43817e, 0x4d7192];
  for (let i = 0; i < 49; i++) {
    const cx = (i * 277 + 39) % size, cy = (i * 419 + 97) % size, a = i * 2.399;
    for (let side = 0; side < 3; side++) {
      leaf(cx + Math.cos(a) * side * 14, cy + Math.sin(a) * side * 14,
        79 + (i * 17 + side * 9) % 62, 15 + (i * 7) % 12,
        a + (side - 1) * 0.65, branchPalette[(i + side) % branchPalette.length], (side - 1) * 0.12);
    }
  }
  for (let i = 0; i < 23; i++) frond((i * 367 + 107) % size, (i * 193 + 231) % size,
    112 + (i * 13) % 69, i * 1.83, i % 3 === 0);
  const blooms = [
    [83, 117, 1.12, 0.1], [386, 74, 0.88, 1.2], [738, 179, 1.03, 0.6],
    [212, 357, 1.13, 2.2], [584, 341, 0.83, 0.8], [944, 413, 1.0, 2.8],
    [41, 650, 0.89, 0.9], [404, 641, 1.07, 0.3], [743, 706, 1.13, 1.4],
    [184, 949, 0.96, 2.0], [597, 947, 0.86, 1.1], [941, 945, 0.93, 0.4],
  ];
  blooms.forEach(([cx, cy, s, rotation], b) => {
    const pale = b === 4 || b === 8;
    for (let p = 0; p < 5; p++) {
      const angle = rotation + p * TAU / 5 + Math.sin(b + p * 1.3) * 0.13;
      const length = (75 + (p + b) % 3 * 17) * s;
      const hex = pale ? [0xe3e0ca, 0xf3ead1, 0xc6d0d0][p % 3] : [0xd99a38, 0xeeb250, 0xcd8e32, 0xe5b45f, 0xe5a93d][(p + b) % 5];
      petal(cx, cy, length, (23 + p % 2 * 8) * s, angle, hex, Math.sin(b * 2 + p));
    }
    for (let ray = 0; ray < 6; ray++) {
      const a = ray * TAU / 6, length = (10 + ray % 2 * 7) * s;
      stroke([[cx, cy], [cx + Math.cos(a) * length, cy + Math.sin(a) * length]], 1.7 * s, 0x263f5a);
    }
  });
  for (let i = 0; i < 18; i++) {
    const cx = (i * 271 + 139) % size, cy = (i * 353 + 47) % size, a = i * 1.13;
    const outline: [number, number][] = [];
    for (let p = 0; p <= 28; p++) {
      const t = p / 28 * TAU, r = 11 + Math.cos(t * 3) * 2;
      outline.push([cx + Math.cos(t) * r * 0.65 + Math.sin(t) * 4, cy + Math.sin(t) * r]);
    }
    stroke(outline, 1.05, 0xd8ad62);
    stroke([[cx, cy + 12], [cx + Math.cos(a) * 13, cy + 23], [cx + Math.cos(a) * 23, cy + 21]], 0.9, 0xd8ad62);
  }
  const print = dataTexture("visitor-dense-navy-botanical-print", size, pixels, [2.55, 1.18]);
  const dress = material("#ffffff", 0.88);
  dress.map = print; dress.sheen = 0.22;
  const darkHem = material("#263d5a", 0.9);
  const skirtProfile = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.267, 0.134, 0), new THREE.Vector3(0.270, 0.150, 0),
    new THREE.Vector3(0.253, 0.238, 0), new THREE.Vector3(0.215, 0.399, 0),
    new THREE.Vector3(0.166, 0.558, 0), new THREE.Vector3(0.118, 0.689, 0),
    new THREE.Vector3(0.106, 0.720, 0),
  ]);
  const skirtGeo = own(new THREE.LatheGeometry(skirtProfile.getPoints(56).map(p => new THREE.Vector2(p.x, p.y)), 112));
  const sp = skirtGeo.getAttribute("position"), suv = skirtGeo.getAttribute("uv");
  for (let i = 0; i < sp.count; i++) {
    const x = sp.getX(i), y = sp.getY(i), z = sp.getZ(i), a = Math.atan2(z, x), t = (0.72 - y) / 0.586;
    const flute = 1 + Math.sin(a * 12 + 0.24 + t * 0.06) * (0.011 + t * 0.018) + Math.cos(a * 5 - 0.4) * 0.006 * t;
    sp.setXYZ(i, x * flute, y + Math.sin(a * 5) * 0.0016 * t ** 4, z * 0.735 * flute);
    suv.setY(i, (y - 0.134) / 0.586);
  }
  skirtGeo.computeVertexNormals();
  mesh("visitor-floral-full-length-skirt", skirtGeo, dress);
  const hem: Point[] = [];
  for (let i = 0; i <= 112; i++) {
    const a = i / 112 * TAU, flute = 1 + Math.sin(a * 12 + 0.30) * 0.029 + Math.cos(a * 5 - 0.4) * 0.006;
    hem.push([Math.cos(a) * 0.267 * flute, 0.134 + Math.sin(a * 5) * 0.0016, Math.sin(a) * 0.267 * 0.735 * flute]);
  }
  thread("visitor-subtle-dress-hem-stitch", hem, 0.0011, darkHem, body, 144);

  const bodiceGeo = own(new THREE.LatheGeometry([
    new THREE.Vector2(0.106, 0.717), new THREE.Vector2(0.108, 0.743),
    new THREE.Vector2(0.123, 0.827), new THREE.Vector2(0.119, 0.862),
    new THREE.Vector2(0.095, 0.899), new THREE.Vector2(0.051, 0.917),
  ], 80));
  const bp = bodiceGeo.getAttribute("position"), buv = bodiceGeo.getAttribute("uv");
  for (let i = 0; i < bp.count; i++) {
    const x = bp.getX(i), y = bp.getY(i), z = bp.getZ(i);
    const front = Math.max(0, z) / Math.max(0.0001, Math.hypot(x, z));
    const neckDrop = 0.015 * front * front * THREE.MathUtils.smoothstep(y, 0.875, 0.917);
    const back = THREE.MathUtils.smoothstep(-z / Math.max(0.0001, Math.hypot(x, z)), -0.25, 0.30);
    bp.setXYZ(i, x, y - neckDrop - Math.max(0, y - 0.875) * back, z * 0.72);
    buv.setY(i, (y - 0.134) / 0.586);
  }
  bodiceGeo.computeVertexNormals();
  mesh("visitor-round-neck-floral-bodice", bodiceGeo, dress);
  const neckline: Point[] = [];
  for (let i = 0; i <= 80; i++) {
    const a = i / 80 * TAU, front = Math.max(0, Math.cos(a));
    const back = THREE.MathUtils.smoothstep(-Math.cos(a), -0.25, 0.30);
    neckline.push([Math.sin(a) * 0.051, 0.917 - front * front * 0.015 - back * 0.042, Math.cos(a) * 0.051 * 0.72]);
  }
  thread("visitor-round-neck-sewn-edge", neckline, 0.0006, darkHem, body, 96);
  const waist: Point[] = [];
  for (let i = 0; i <= 80; i++) { const a = i / 80 * TAU; waist.push([Math.sin(a) * 0.107, 0.720, Math.cos(a) * 0.077]); }
  thread("visitor-soft-gathered-waist-seam", waist, 0.0012, darkHem, body, 96);

  // 身頃は中のワンピースより外へ。裾では広がったスカートも包む。
  const sweaterRadius = (t: number) => {
    const controls = [0.165, 0.146, 0.133, 0.138, 0.141, 0.067];
    const f = THREE.MathUtils.clamp(t, 0, 1) * (controls.length - 1);
    const i = Math.min(controls.length - 2, Math.floor(f));
    return THREE.MathUtils.lerp(controls[i], controls[i + 1], THREE.MathUtils.smootherstep(f - i, 0, 1));
  };
  const opening = (t: number) => THREE.MathUtils.lerp(0.91, 0.34, t) + Math.sin(t * Math.PI) * 0.015
    + THREE.MathUtils.smoothstep(t, 0.85, 1) * 0.55;
  const sweaterPoint = (t: number, angle: number, inset = 0): Point => {
    const r = sweaterRadius(t) - inset;
    const y = 0.592 + t * 0.333 - Math.pow(t, 10) * Math.pow(Math.abs(Math.sin(angle)), 1.8) * 0.020;
    const softFold = Math.cos(angle * 20) * 0.00045 * Math.sin(t * Math.PI);
    return [Math.sin(angle) * (r + softFold), y, Math.cos(angle) * (r * 0.73 + softFold) + Math.max(0, Math.cos(angle)) * 0.004];
  };
  function sweaterShell(name: string, lo: number, hi: number, surface: THREE.Material, offset: number, rows: number) {
    const columns = 92, positions: number[] = [], uv: number[] = [], indices: number[] = [];
    for (let layer = 0; layer < 2; layer++) for (let row = 0; row <= rows; row++) {
      const t = THREE.MathUtils.lerp(lo, hi, row / rows), gap = opening(t);
      for (let col = 0; col <= columns; col++) {
        const u = col / columns, a = gap + (TAU - gap * 2) * u;
        const p = sweaterPoint(t, a, layer * 0.006 - offset);
        positions.push(...p); uv.push(u, t);
      }
    }
    const stride = columns + 1, count = stride * (rows + 1);
    for (let row = 0; row < rows; row++) for (let col = 0; col < columns; col++) {
      const a = row * stride + col, b = a + stride;
      indices.push(a, a + 1, b, a + 1, b + 1, b);
      indices.push(a + count, b + count, a + 1 + count, a + 1 + count, b + count, b + 1 + count);
    }
    for (const col of [0, columns]) for (let row = 0; row < rows; row++) {
      const a = row * stride + col, b = a + stride;
      if (col === 0) indices.push(a, b, a + count, b, b + count, a + count);
      else indices.push(a, a + count, b, b, a + count, b + count);
    }
    for (const row of [0, rows]) for (let col = 0; col < columns; col++) {
      const a = row * stride + col;
      if (row === 0) indices.push(a, a + count, a + 1, a + 1, a + count, a + count + 1);
      else indices.push(a, a + 1, a + count, a + 1, a + count + 1, a + count);
    }
    const g = own(new THREE.BufferGeometry());
    g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(indices); g.computeVertexNormals(); mesh(name, g, surface);
  }
  sweaterShell("visitor-open-soft-cable-cardigan", 0, 1, knit, 0, 36);
  sweaterShell("visitor-cardigan-ribbed-bottom-band", 0, 0.061, edging, 0.002, 4);

  // 首元は身頃そのものを絞った連続曲面とし、張り出した折襟を作らない。
  // 前端も編みの帯として曲線に沿わせ、シャツの上へ自然に開く。
  for (const side of [-1, 1]) {
    const band: Point[] = [];
    for (let i = 0; i <= 36; i++) {
      const t = i / 36, p = sweaterPoint(t, side > 0 ? opening(t) : TAU - opening(t), -0.0018);
      band.push(p);
    }
    sweep("visitor-curved-cardigan-front-placket", band, [0.006, 0.006, 0.0058], [0.0032, 0.0032, 0.003], edging, body, 48, 10);
    const shoulder = oval("visitor-cardigan-rounded-shoulder", [0.041, 0.043, 0.046], [side * 0.117, 0.872, -0.002], knitLight);
    shoulder.rotation.z = side * -0.23;
    const sleeves: Point[] = [[side * 0.119, 0.878, -0.002], [side * 0.140, 0.826, 0.001],
      [side * 0.177, 0.698, 0.012], [side * 0.217, 0.570, 0.027], [side * 0.222, 0.551, 0.030]];
    sweep("visitor-soft-tapered-cable-sleeve", sleeves, [0.038, 0.044, 0.044, 0.037, 0.0305],
      [0.042, 0.045, 0.044, 0.038, 0.031], knitLight, body, 42, 24);
    // 袖の断面と同じ計算で、細い二本撚りを布表面へ載せる。
    const sleeveCurve = new THREE.CatmullRomCurve3(sleeves.map(p => new THREE.Vector3(...p)));
    const widthControls = [0.038, 0.044, 0.044, 0.037, 0.0305];
    const depthControls = [0.042, 0.045, 0.044, 0.038, 0.031];
    const sectionRadius = (values: number[], t: number) => {
      const f = t * (values.length - 1), i = Math.min(values.length - 2, Math.floor(f));
      return THREE.MathUtils.lerp(values[i], values[i + 1], f - i);
    };
    for (let lane = 0; lane < 10; lane++) for (const phase of [0, Math.PI]) {
      const points: Point[] = [];
      for (let i = 0; i <= 60; i++) {
        const t = 0.045 + i / 60 * 0.855, centre = sleeveCurve.getPoint(t), tangent = sleeveCurve.getTangent(t).normalize();
        const across = new THREE.Vector3().crossVectors(tangent, new THREE.Vector3(0, 0, 1)).normalize();
        const normal = new THREE.Vector3().crossVectors(across, tangent).normalize();
        const angle = lane / 10 * TAU + Math.sin(t * TAU * 14 + phase) * 0.034;
        const relief = 0.00085 + Math.cos(t * TAU * 14 + phase) * 0.00027;
        const point = centre.clone()
          .addScaledVector(across, Math.cos(angle) * (sectionRadius(widthControls, t) + relief))
          .addScaledVector(normal, Math.sin(angle) * (sectionRadius(depthControls, t) + relief));
        points.push([point.x, point.y, point.z]);
      }
      thread("visitor-sleeve-fine-knit-cable", points, 0.00058, cableKnit, body, 68);
    }
    const cuff = oval("visitor-cardigan-ribbed-cuff", [0.0317, 0.0165, 0.032], [side * 0.222, 0.549, 0.030], edging);
    cuff.rotation.z = side * -0.27;
    for (let rib = 0; rib < 16; rib++) {
      const a = rib / 16 * TAU, p: Point[] = [];
      for (let j = 0; j < 3; j++) p.push([side * (0.220 + j * 0.0016) + Math.cos(a) * 0.0315,
        0.563 - j * 0.014, 0.029 + Math.sin(a) * 0.0315]);
      thread("visitor-fine-cuff-rib", p, 0.00075, knitLight, body, 8);
    }
  }
  // 前身頃は開きの曲線に平行な4列。陰影で読める高さだけを加える。
  for (const side of [-1, 1]) for (let lane = 0; lane < 4; lane++) for (const phase of [0, Math.PI]) {
    const points: Point[] = [];
    for (let i = 0; i <= 56; i++) {
      const t = 0.073 + i / 56 * 0.857;
      const gap = opening(t), fraction = (lane + 0.7) / 4.7;
      const base = THREE.MathUtils.lerp(gap + 0.07, 1.45, fraction);
      const angle = side > 0 ? base : TAU - base;
      const a = angle + Math.sin(t * TAU * 13 + phase) * 0.009;
      points.push(sweaterPoint(t, a, -0.00085 - Math.cos(t * TAU * 13 + phase) * 0.00027));
    }
    thread("visitor-front-fine-knit-cable", points, 0.00062, cableKnit, body, 64);
  }
  // 背面にも控えめな立体ケーブルを通す。太いロープ状にはしない。
  for (let col = 0; col < 11; col++) for (const phase of [0, Math.PI]) {
    const baseAngle = 1.48 + col / 10 * (Math.PI * 2 - 2.96), points: Point[] = [];
    for (let i = 0; i <= 36; i++) {
      const t = 0.075 + i / 36 * 0.855;
      const a = baseAngle + Math.sin(t * TAU * 6 + phase) * 0.007;
      const p = sweaterPoint(t, a, -0.0009 - Math.cos(t * TAU * 6 + phase) * 0.00045);
      points.push(p);
    }
    thread("visitor-back-fine-knit-cable", points, 0.00055, edging, body, 44);
  }
  // 微細な編み糸の自己シャドウは縮小時に黒い点線になるため、布本体の影で表現する。
  for (const part of body.children) {
    if (part instanceof THREE.Mesh && /fine-knit-cable|fine-cuff-rib/.test(part.name)) {
      part.castShadow = false;
    }
  }
}
