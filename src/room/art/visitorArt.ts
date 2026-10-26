import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import type { DisposalScope } from "../disposal";

const TAU = Math.PI * 2;
export type VisitorPoint = [number, number, number];
type Point = VisitorPoint;

/** NPCの造形部品が共有する、所有権の明確なメッシュ生成。 */
export function createVisitorArt(scope: DisposalScope, body: THREE.Group) {
  const own = scope.own;
  const material = (color: string, roughness = 0.75) => own(new THREE.MeshPhysicalMaterial({
    color, roughness, metalness: 0, clearcoat: 0.04, clearcoatRoughness: 0.7,
    sheen: 0.12, sheenRoughness: 0.85, sheenColor: new THREE.Color(color),
  }));
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
      const reference = Math.abs(tangent.dot(preferred)) > 0.97 ? new THREE.Vector3(0, 1, 0) : preferred;
      const side = new THREE.Vector3().crossVectors(tangent, reference).normalize();
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

  return { scope, body, own, material, mesh, oval, roundedBox, thread, sweep, dataTexture };
}
export type VisitorArt = ReturnType<typeof createVisitorArt>;
