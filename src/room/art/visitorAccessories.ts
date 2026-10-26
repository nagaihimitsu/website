import * as THREE from "three";
import type { VisitorArt, VisitorPoint } from "./visitorArt";

const TAU = Math.PI * 2;

/** 参考写真の編み鞄、革ひも、手足と、折り目のある小さな黄色いリボン。 */
export function createVisitorAccessories(art: VisitorArt): void {
  const { body, own, material, mesh, oval, thread, sweep, dataTexture } = art;
  const skin = material("#f9d5bc", 0.7);
  const leather = material("#8b593c", 0.77);
  const leatherEdge = material("#6f4932", 0.84);
  const binding = material("#986842", 0.8);
  const stitch = material("#a27a53", 0.9);

  // 経糸と緯糸を交互に浮かせた小さな横長の網目。色にも陰影を残す。
  const size = 512;
  const colour = new Uint8Array(size * size * 4);
  const relief = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const row = Math.floor(y / 19);
    const sx = (x + (row % 2) * 15) % 30;
    const sy = y % 19;
    const roundedRidge = Math.sin(Math.PI * (sx + 0.5) / 30) ** 0.28 *
      Math.sin(Math.PI * (sy + 0.5) / 19) ** 0.4;
    const cord = 0.65 + 0.35 * Math.cos((sy - 7) * Math.PI / 9);
    const grain = Math.sin(x * 2.9 + y * 0.5) * 2 + Math.sin(y * 3.7) * 2;
    const value = roundedRidge * cord;
    const i = (y * size + x) * 4;
    colour.set([95 + value * 44 + grain, 61 + value * 30 + grain, 40 + value * 22 + grain, 255], i);
    const h = Math.round(48 + value * 192);
    relief.set([h, h, h, 255], i);
  }
  const woven = material("#ffffff", 0.9);
  woven.map = dataTexture("visitor-rattan-colour", size, colour);
  woven.bumpMap = dataTexture("visitor-rattan-relief", size, relief);
  woven.bumpMap.colorSpace = THREE.NoColorSpace;
  woven.bumpScale = 0.00125;
  woven.sheen = 0.08;

  function uvXY(geometry: THREE.BufferGeometry, width: number, height: number) {
    const p = geometry.getAttribute("position");
    const uv = new Float32Array(p.count * 2);
    for (let i = 0; i < p.count; i++) {
      uv[i * 2] = p.getX(i) / width + 0.5;
      uv[i * 2 + 1] = p.getY(i) / height + 0.5;
    }
    geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    return geometry;
  }

  // 底も側面も丸い、少し膨らんだ編み地のサッチェル。
  const bag = new THREE.Group();
  bag.name = "visitor-woven-crossbody-bag";
  bag.position.set(0.171, 0.551, 0.125);
  bag.rotation.y = 0.10;
  bag.rotation.z = -0.065;
  body.add(bag);
  const bagOutline = new THREE.Shape();
  bagOutline.moveTo(-0.049, 0.079);
  bagOutline.bezierCurveTo(-0.064, 0.079, -0.068, 0.064, -0.068, 0.044);
  bagOutline.lineTo(-0.064, -0.052);
  bagOutline.bezierCurveTo(-0.063, -0.073, -0.052, -0.082, -0.032, -0.084);
  bagOutline.quadraticCurveTo(0, -0.088, 0.033, -0.083);
  bagOutline.bezierCurveTo(0.054, -0.081, 0.063, -0.07, 0.064, -0.05);
  bagOutline.lineTo(0.066, 0.048);
  bagOutline.bezierCurveTo(0.066, 0.071, 0.057, 0.079, 0.042, 0.079);
  bagOutline.closePath();
  const bagGeometry = own(new THREE.ExtrudeGeometry(bagOutline, {
    depth: 0.041, bevelEnabled: true, bevelSegments: 5,
    steps: 1, bevelSize: 0.0055, bevelThickness: 0.008, curveSegments: 20,
  }));
  bagGeometry.translate(0, 0, -0.022);
  uvXY(bagGeometry, 0.145, 0.177);
  mesh("visitor-rounded-woven-satchel", bagGeometry, woven, bag);

  const flap = new THREE.Shape();
  flap.moveTo(-0.062, 0.073);
  flap.quadraticCurveTo(0, 0.083, 0.06, 0.073);
  flap.lineTo(0.06, 0.029);
  flap.bezierCurveTo(0.058, 0.001, 0.039, -0.012, 0, -0.015);
  flap.bezierCurveTo(-0.038, -0.012, -0.059, 0.001, -0.061, 0.029);
  flap.closePath();
  const flapGeometry = own(new THREE.ExtrudeGeometry(flap, {
    depth: 0.008, bevelEnabled: true, bevelSegments: 4,
    bevelSize: 0.003, bevelThickness: 0.002, curveSegments: 20,
  }));
  flapGeometry.translate(0, 0, 0.026);
  uvXY(flapGeometry, 0.145, 0.177);
  mesh("visitor-rounded-rattan-flap", flapGeometry, woven, bag);
  const flapBinding: VisitorPoint[] = [
    [-0.06, 0.072, 0.037], [-0.061, 0.04, 0.037], [-0.055, 0.014, 0.038],
    [-0.036, -0.003, 0.038], [0, -0.012, 0.038], [0.035, -0.003, 0.038],
    [0.054, 0.014, 0.038], [0.06, 0.04, 0.037], [0.06, 0.072, 0.037],
  ];
  thread("visitor-flap-dark-bound-edge", flapBinding, 0.0023, leatherEdge, bag, 66);
  thread("visitor-flap-inner-stitched-edge", flapBinding.map(([x, y, z]) => [x * 0.92, y * 0.94 + 0.003, z + 0.0005]),
    0.00075, stitch, bag, 66);
  for (const side of [-1, 1]) {
    thread("visitor-satchel-side-binding", [
      [side * 0.062, 0.066, 0.016], [side * 0.065, 0.025, 0.023],
      [side * 0.061, -0.05, 0.023], [side * 0.042, -0.078, 0.024],
      [0, -0.081, 0.024],
    ], 0.00165, binding, bag, 38);
    const attachment = oval("visitor-satchel-side-strap-tab", [0.010, 0.025, 0.006],
      [side * 0.061, 0.053, 0.016], leather, bag);
    attachment.rotation.z = side * 0.15;
    oval("visitor-satchel-side-rivet", [0.004, 0.004, 0.002], [side * 0.06, 0.059, 0.023], binding, bag);
  }
  const tab = new THREE.Shape();
  tab.moveTo(-0.009, 0.015); tab.lineTo(0.009, 0.015); tab.lineTo(0.009, -0.015);
  tab.quadraticCurveTo(0, -0.025, -0.009, -0.015); tab.closePath();
  const tabGeometry = own(new THREE.ExtrudeGeometry(tab, {
    depth: 0.0035, bevelEnabled: true, bevelSegments: 2, bevelSize: 0.001, bevelThickness: 0.001,
  }));
  const tabMesh = mesh("visitor-satchel-fastening-tab", tabGeometry, leather, bag);
  tabMesh.position.set(0, 0.002, 0.038);
  oval("visitor-satchel-covered-button", [0.006, 0.007, 0.0035], [0, 0.008, 0.045], binding, bag);

  // 肩から胸・背中を経て鞄の両側へ続く厚みのある細い革帯。
  sweep("visitor-crossbody-front-leather-strap", [
    [-0.110, 0.907, 0], [-0.110, 0.900, 0.040], [-0.103, 0.888, 0.074],
    [-0.091, 0.851, 0.083], [-0.061, 0.801, 0.095], [-0.015, 0.738, 0.103],
    [0.039, 0.679, 0.110], [0.080, 0.637, 0.120], [0.115, 0.612, 0.141],
  ], Array(9).fill(0.006), Array(9).fill(0.0024), leather, body, 90, 10);
  sweep("visitor-crossbody-back-leather-strap", [
    [-0.110, 0.907, 0], [-0.110, 0.899, -0.035], [-0.105, 0.880, -0.064],
    [-0.080, 0.845, -0.088], [-0.006, 0.744, -0.105], [0.096, 0.652, -0.087],
    [0.153, 0.617, -0.048], [0.178, 0.608, 0.017], [0.213, 0.606, 0.055],
    [0.229, 0.605, 0.099],
  ], Array(10).fill(0.006), Array(10).fill(0.0024), leather, body, 110, 10);

  // 指を別々の珠にせず、掌・丸い指先・親指の膨らみを一枚の皮膚につなぐ。
  for (const side of [-1, 1]) {
    const handGeometry = own(new THREE.SphereGeometry(1, 40, 30));
    const p = handGeometry.getAttribute("position");
    for (let i = 0; i < p.count; i++) {
      const ux = p.getX(i), uy = p.getY(i), uz = p.getZ(i);
      const thumb = Math.exp(-(((ux * side + 0.78) / 0.34) ** 2) - ((uy - 0.25) / 0.34) ** 2);
      const fingertip = Math.max(0, (-uy - 0.68) / 0.32) * (Math.cos((ux + 1) * Math.PI * 3.6) * 0.0011);
      p.setXYZ(i, ux * 0.027 - side * thumb * 0.0085,
        uy * 0.039 + thumb * 0.006 + fingertip, uz * 0.021 + thumb * 0.003);
    }
    handGeometry.computeVertexNormals();
    const hand = mesh("visitor-soft-mitten-hand", handGeometry, skin);
    hand.position.set(side * 0.239, 0.513, 0.022);
    hand.rotation.z = side * -0.40;
    // 袖の先に皮膚が自然につながる細い手首。
    oval("visitor-small-wrist", [0.0195, 0.030, 0.019], [side * 0.226, 0.541, 0.021], skin);
  }

  // 薄い扁平な底、爪先の開口、甲を横切る幅のある二本の革帯。
  for (const side of [-1, 1]) {
    const foot = new THREE.Group();
    foot.name = "visitor-sandal-foot";
    foot.position.set(side * 0.074, 0, 0.005);
    foot.rotation.y = side * 0.075;
    body.add(foot);
    const sole = new THREE.Shape();
    sole.moveTo(-0.021, 0.043);
    sole.bezierCurveTo(-0.032, 0.042, -0.035, 0.017, -0.036, -0.035);
    sole.bezierCurveTo(-0.038, -0.074, -0.033, -0.099, -0.016, -0.101);
    sole.bezierCurveTo(0, -0.108, 0.028, -0.099, 0.033, -0.086);
    sole.bezierCurveTo(0.041, -0.06, 0.035, 0.01, 0.029, 0.031);
    sole.quadraticCurveTo(0.024, 0.048, -0.021, 0.043);
    const soleGeometry = own(new THREE.ExtrudeGeometry(sole, {
      depth: 0.008, bevelEnabled: true, bevelSegments: 3, bevelSize: 0.0015, bevelThickness: 0.0015,
      curveSegments: 18,
    }));
    soleGeometry.rotateX(-Math.PI / 2);
    soleGeometry.translate(0, 0.003, 0);
    mesh("visitor-sandal-shaped-flat-sole", soleGeometry, leatherEdge, foot);
    oval("visitor-sandal-ankle", [0.0255, 0.075, 0.025], [0, 0.116, -0.008], skin, foot);
    oval("visitor-sandal-foot-skin", [0.031, 0.025, 0.063], [0, 0.033, 0.027], skin, foot);
    for (let toe = 0; toe < 5; toe++) {
      const toeSize = 0.0083 - toe * 0.0008;
      oval("visitor-sandal-rounded-toe", [toeSize, 0.009, 0.012],
        [side * (-0.023 + toe * 0.0115), 0.028, 0.084 - toe * 0.0017], skin, foot);
    }
    const strap = (name: string, z: number, peak: number, width: number) => {
      const positions: number[] = [], uv: number[] = [], index: number[] = [];
      const columns = 32;
      for (let layer = 0; layer < 2; layer++) for (let i = 0; i <= columns; i++) {
        const u = i / columns * 2 - 1;
        const x = u * 0.0335;
        const y = 0.021 + Math.sqrt(Math.max(0, 1 - u * u)) * (peak - 0.021) - layer * 0.003;
        for (const edge of [-1, 1]) {
          positions.push(x, y, z + edge * width / 2 + u * side * 0.006);
          uv.push(i / columns, (edge + 1) / 2);
        }
      }
      const rowCount = (columns + 1) * 2;
      for (let i = 0; i < columns; i++) {
        const a = i * 2, b = a + 2;
        index.push(a, a + 1, b, a + 1, b + 1, b);
        index.push(a + rowCount, b + rowCount, a + 1 + rowCount,
          a + 1 + rowCount, b + rowCount, b + 1 + rowCount);
        for (const edge of [0, 1]) {
          const c = a + edge, d = b + edge;
          if (edge === 0) index.push(c, d, c + rowCount, d, d + rowCount, c + rowCount);
          else index.push(c, c + rowCount, d, d, c + rowCount, d + rowCount);
        }
      }
      for (const i of [0, columns]) {
        const a = i * 2;
        if (i === 0) index.push(a, a + rowCount, a + 1, a + 1, a + rowCount, a + rowCount + 1);
        else index.push(a, a + 1, a + rowCount, a + 1, a + rowCount + 1, a + rowCount);
      }
      const geometry = own(new THREE.BufferGeometry());
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
      geometry.setIndex(index); geometry.computeVertexNormals();
      mesh(name, geometry, leather, foot);
    };
    strap("visitor-sandal-wide-toe-strap", 0.057, 0.058, 0.018);
    strap("visitor-sandal-wide-instep-strap", -0.003, 0.077, 0.018);
    thread("visitor-sandal-heel-strap", [[-0.029, 0.025, -0.021], [-0.028, 0.053, -0.031],
      [0, 0.056, -0.036], [0.028, 0.053, -0.031], [0.029, 0.025, -0.021]], 0.0045, leather, foot, 32);
    oval("visitor-sandal-side-buckle", [0.004, 0.006, 0.002], [side * 0.031, 0.047, -0.002], binding, foot);
  }

  // 小さな結び目から扇状に折れた上部と、その下に垂れる短い端。
  const ribbon = material("#edb83f", 0.62);
  const ribbonShade = material("#e3aa36", 0.7);
  const bow = new THREE.Group();
  bow.name = "visitor-yellow-folded-bow";
  bow.position.set(0.152, 1.176, 0.070);
  bow.rotation.y = 0.85;
  bow.scale.x = 1.35;
  bow.rotation.z = 0.10;
  body.add(bow);
  const clothPanel = (name: string, side: number, tail: boolean) => {
    const rows = 24, columns = 20;
    const vertices: number[] = [], uv: number[] = [], indices: number[] = [];
    for (let layer = 0; layer < 2; layer++) for (let row = 0; row <= rows; row++) {
      const t = row / rows;
      const centreX = tail ? 0.006 + Math.sin(t * 2.1) * 0.002 : side * Math.sin(t * Math.PI * 0.77) * 0.009;
      const centreY = tail ? -0.048 - t * 0.061 : -t * 0.064;
      const width = tail ? 0.013 + t * 0.003 : 0.0025 + Math.sin(Math.min(1, t / 0.85) * Math.PI / 2) ** 1.3 * 0.018;
      for (let column = 0; column <= columns; column++) {
        const u = column / columns * 2 - 1;
        const fold = (1 - Math.abs(u)) * (tail ? 0.003 : 0.009) + Math.sin(t * Math.PI) * 0.004;
        vertices.push(centreX + u * width,
          centreY + (tail ? Math.abs(u) * t ** 8 * 0.003 : u * side * Math.sin(Math.PI * t) * 0.006 + (u * side * 0.008 + u * u * 0.004) * t ** 6),
          (tail ? 0.008 + t * 0.020 : 0.009) + fold - layer * 0.003);
        uv.push(column / columns, t);
      }
    }
    const stride = columns + 1, layerSize = (rows + 1) * stride;
    for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
      const a = row * stride + column, b = a + stride;
      indices.push(a, b, a + 1, a + 1, b, b + 1,
        a + layerSize, a + 1 + layerSize, b + layerSize,
        a + 1 + layerSize, b + 1 + layerSize, b + layerSize);
    }
    for (const column of [0, columns]) for (let row = 0; row < rows; row++) {
      const a = row * stride + column, b = a + stride;
      if (column === 0) indices.push(a, a + layerSize, b, b, a + layerSize, b + layerSize);
      else indices.push(a, b, a + layerSize, b, b + layerSize, a + layerSize);
    }
    for (const row of [0, rows]) for (let column = 0; column < columns; column++) {
      const a = row * stride + column;
      if (row === 0) indices.push(a, a + 1, a + layerSize, a + 1, a + 1 + layerSize, a + layerSize);
      else indices.push(a, a + layerSize, a + 1, a + 1, a + layerSize, a + 1 + layerSize);
    }
    const geometry = own(new THREE.BufferGeometry());
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    geometry.setIndex(indices); geometry.computeVertexNormals();
    mesh(name, geometry, tail ? ribbonShade : ribbon, bow);
  };
  clothPanel("visitor-bow-short-hanging-tail", 0, true);
  clothPanel("visitor-bow-left-fold", -1, false);
  clothPanel("visitor-bow-right-fold", 1, false);
  oval("visitor-bow-small-top-knot", [0.008, 0.0075, 0.0075], [0, -0.003, 0.012], ribbon, bow);
}
