import * as THREE from "three";

/** 閉眼時の目元を控えめに前へ出し、周囲の顔へ滑らかにつなぐ。 */
export function createVisitorEyeRelief(meshes: THREE.Mesh[]) {
  const clones = new Map<THREE.BufferGeometry, THREE.BufferGeometry>();
  const changed: { mesh: THREE.Mesh; original: THREE.BufferGeometry }[] = [];
  const smooth = (value: number) => {
    const t = THREE.MathUtils.clamp(value, 0, 1);
    return t * t * (3 - 2 * t);
  };
  try {
    for (const mesh of meshes) {
      const index = Object.entries(mesh.morphTargetDictionary ?? {})
        .find(([name]) => name.toLowerCase() === "blink")?.[1];
      const original = mesh.geometry;
      if (index === undefined || !original.morphTargetsRelative || !original.morphAttributes.position?.[index]) continue;
      let geometry = clones.get(original);
      if (!geometry) {
        geometry = original.clone();
        clones.set(original, geometry);
        const position = geometry.getAttribute("position");
        const blink = geometry.morphAttributes.position![index];
        if (!position || !blink || position.count !== blink.count) throw new Error("NPC eye morph has invalid attributes");
        const delta = new Float32Array(position.count * 3);
        for (let i = 0; i < position.count; i++) {
          // 配信用GLBの頂点座標は量子化により元の2倍。+Xが顔の前方。
          const x = position.getX(i) * 0.5;
          const y = position.getY(i) * 0.5;
          const z = position.getZ(i) * 0.5;
          const radius = Math.hypot((Math.abs(z) - 0.046) / 0.032, (y - 0.317) / 0.031);
          const weight = (1 - smooth((radius - 0.45) / 0.77))
            * smooth((x - 0.045) / 0.015) * (1 - smooth((x - 0.09) / 0.015))
            // 口や顎に近い部分では完全にゼロにし、閉眼時に口を引っ張らない。
            * smooth((y - 0.285) / 0.010);
          // 凹みの大きい側を中心に、目の外側では変位をゼロへ戻す。
          const relief = z < 0 ? 0.006 : 0.003;
          delta[i * 3] = blink.getX(i) + relief * weight * 2;
          delta[i * 3 + 1] = blink.getY(i);
          delta[i * 3 + 2] = blink.getZ(i);
        }
        const adjusted = new THREE.Float32BufferAttribute(delta, 3);
        adjusted.name = blink.name;
        geometry.morphAttributes.position![index] = adjusted;
      }
      mesh.geometry = geometry;
      changed.push({ mesh, original });
    }
  } catch (error) {
    for (const { mesh, original } of changed) mesh.geometry = original;
    for (const geometry of clones.values()) geometry.dispose();
    console.warn("NPC eye relief unavailable; keeping the original eye morph.", error);
    return undefined;
  }
  let disposed = false;
  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const { mesh, original } of changed) mesh.geometry = original;
      for (const geometry of clones.values()) geometry.dispose();
    },
  };
}
