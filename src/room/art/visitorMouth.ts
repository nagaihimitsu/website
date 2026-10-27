import * as THREE from "three";

/**
 * 提供モデルの口を閉じる試作。まばたき用の画像とシェーダーを共有する。
 * この処理は量子化された現在のGLBの座標に合わせている。
 */
export function createVisitorMouth(face: THREE.Mesh, meshes: THREE.Mesh[]) {
  if (!(face instanceof THREE.SkinnedMesh) || Array.isArray(face.material)
      || !(face.material instanceof THREE.MeshStandardMaterial)) return undefined;
  const clones = new Map<THREE.BufferGeometry, THREE.BufferGeometry>();
  const changed: { mesh: THREE.Mesh; original: THREE.BufferGeometry }[] = [];
  const smooth = (v: number) => {
    const t = THREE.MathUtils.clamp(v, 0, 1);
    return t * t * (3 - 2 * t);
  };
  try {
    for (const mesh of meshes) {
      const index = Object.entries(mesh.morphTargetDictionary ?? {})
        .find(([name]) => name.toLowerCase() === "mouth")?.[1];
      const original = mesh.geometry;
      if (index === undefined || !original.morphTargetsRelative || !original.morphAttributes.position?.[index]) continue;
      let geometry = clones.get(original);
      if (!geometry) {
        geometry = original.clone();
        const position = geometry.getAttribute("position");
        const delta = new Float32Array(position.count * 3);
        for (let i = 0; i < position.count; i++) {
          // 配信用GLBのMeshopt量子化でローカル座標は原本の2倍。
          const x = position.getX(i) * 0.5;
          const y = position.getY(i) * 0.5;
          const z = position.getZ(i) * 0.5;
          const radius = Math.hypot(z / 0.027, (y - 0.261) / 0.019);
          const weight = (1 - smooth((radius - 0.75) / 0.65))
            * smooth((x - 0.05) / 0.014) * (1 - smooth((x - 0.095) / 0.015));
          const target = 0.075 - 0.9 * z * z - 0.7 * (y - 0.261) ** 2;
          delta[i * 3] = (target - x) * weight * 2;
        }
        const morph = new THREE.Float32BufferAttribute(delta, 3);
        morph.name = "mouth";
        geometry.morphAttributes.position![index] = morph;
        clones.set(original, geometry);
      }
      mesh.geometry = geometry;
      changed.push({ mesh, original });
    }
    if (!changed.some(({ mesh }) => mesh === face)) throw new Error("NPC face mouth morph unavailable");
  } catch (error) {
    for (const { mesh, original } of changed) mesh.geometry = original;
    for (const geometry of clones.values()) geometry.dispose();
    console.warn("NPC mouth morph unavailable; keeping the original mouth.", error);
    return undefined;
  }
  const material = face.material;
  const beforeCompile = material.onBeforeCompile;
  const cacheKey = material.customProgramCacheKey;
  const phase = { value: 0 };
  let disposed = false;
  // まばたき側が挿入する座標・法線・テクスチャを使用し、同じ顔に合成する。
  material.onBeforeCompile = (shader, renderer) => {
    beforeCompile.call(material, shader, renderer);
    shader.uniforms.visitorMouthPhase = phase;
    shader.fragmentShader = `uniform float visitorMouthPhase;\n${shader.fragmentShader}`;
    shader.fragmentShader = shader.fragmentShader.replace("#include <map_fragment>", `#include <map_fragment>
      float mouthX = vVisitorFacePos.z / 0.025;
      float mouthY = (vVisitorFacePos.y - 0.261) / 0.018;
      float mouthZone = (1.0 - smoothstep(0.8, 1.4, length(vec2(mouthX, mouthY))))
        * smoothstep(0.05, 0.065, vVisitorFacePos.x);
      vec3 mouthSkin = texture2D(visitorBlinkImage, vec2(0.5, 0.378)).rgb * vec3(0.7708, 0.6862, 0.611);
      float mouthEdge = mix(0.245, 0.283, visitorMouthPhase);
      float mouthMask = mouthZone * smoothstep(0.0, 0.1, visitorMouthPhase)
        * (1.0 - smoothstep(mouthEdge - 0.0015, mouthEdge + 0.0015, vVisitorFacePos.y));
      diffuseColor.rgb = mix(diffuseColor.rgb, mouthSkin, mouthMask);
      float mouthLineY = 0.260 + 0.002 * mouthX * mouthX;
      float mouthLine = (1.0 - smoothstep(0.00025, 0.0008, abs(vVisitorFacePos.y - mouthLineY)))
        * (1.0 - smoothstep(0.65, 0.85, abs(mouthX))) * mouthZone;
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.31, 0.13, 0.11),
        mouthLine * 0.5 * smoothstep(0.25, 0.7, visitorMouthPhase));`);
    shader.fragmentShader = shader.fragmentShader.replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>
      normal = normalize(mix(normal, vVisitorFaceNormal, mouthZone * visitorMouthPhase));`);
    shader.fragmentShader = shader.fragmentShader.replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>
      roughnessFactor = mix(roughnessFactor, 0.98, mouthZone * visitorMouthPhase);`);
    shader.fragmentShader = shader.fragmentShader.replace("#include <metalnessmap_fragment>", `#include <metalnessmap_fragment>
      metalnessFactor = mix(metalnessFactor, 0.0, mouthZone * visitorMouthPhase);`);
  };
  material.customProgramCacheKey = () => `${cacheKey.call(material)}|visitor-mouth-1`;
  material.needsUpdate = true;
  return {
    setPhase(value: number, imageReady: boolean) {
      phase.value = !disposed && imageReady ? value : 0;
      return !disposed && imageReady;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      phase.value = 0;
      material.onBeforeCompile = beforeCompile;
      material.customProgramCacheKey = cacheKey;
      for (const { mesh, original } of changed) mesh.geometry = original;
      for (const geometry of clones.values()) geometry.dispose();
    },
  };
}
