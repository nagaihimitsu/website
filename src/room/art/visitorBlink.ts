import * as THREE from "three";
import blinkImageUrl from "../../assets/room/visitor-blink-reference.png?url";

/** 顔の目元だけに閉眼画像を重ねる。未読込・失敗時は目を開いたままにする。 */
export function createVisitorBlink(mesh: THREE.Mesh, onVisualChange?: () => void) {
  if (Array.isArray(mesh.material) || !(mesh.material instanceof THREE.MeshStandardMaterial)) return undefined;
  const material = mesh.material;
  const phase = { value: 0 };
  let loaded = false;
  let disposed = false;
  let texture: THREE.Texture;
  try {
    texture = new THREE.TextureLoader().load(blinkImageUrl, () => {
      if (disposed) return;
      loaded = true;
      onVisualChange?.();
    }, undefined, () => {
      if (!disposed) console.warn("NPC blink image could not be loaded; keeping eyes open.");
    });
  } catch {
    // DOMのない環境や画像取得不可の場合も、元のモデルはそのまま使える。
    return undefined;
  }
  texture.colorSpace = THREE.SRGBColorSpace;
  const beforeCompile = material.onBeforeCompile;
  const cacheKey = material.customProgramCacheKey;
  material.onBeforeCompile = (shader, renderer) => {
    beforeCompile.call(material, shader, renderer);
    shader.uniforms.visitorBlinkPhase = phase;
    shader.uniforms.visitorBlinkImage = { value: texture };
    shader.vertexShader = `varying vec3 vVisitorFacePos;\nvarying vec3 vVisitorFaceNormal;\n${shader.vertexShader}`;
    shader.vertexShader = shader.vertexShader.replace("#include <begin_vertex>", `#include <begin_vertex>
      // 配信用GLBはMeshopt量子化により元座標の2倍で保持される。
      vVisitorFacePos = position * 0.5;`);
    shader.vertexShader = shader.vertexShader.replace("#include <skinnormal_vertex>", `#include <skinnormal_vertex>
      vec3 visitorNormal = vec3(1.0, 0.05, sign(position.z) * 0.15);
      #ifdef USE_SKINNING
        visitorNormal = (skinMatrix * vec4(visitorNormal, 0.0)).xyz;
      #endif
      vVisitorFaceNormal = normalize(normalMatrix * visitorNormal);`);
    shader.fragmentShader = `uniform sampler2D visitorBlinkImage;\nuniform float visitorBlinkPhase;\nvarying vec3 vVisitorFacePos;\nvarying vec3 vVisitorFaceNormal;\n${shader.fragmentShader}`;
    shader.fragmentShader = shader.fragmentShader.replace("#include <map_fragment>", `#include <map_fragment>
      float visitorPart = 0.0;
      // 通常は顔以外も同じ素材を使う。閉眼中だけ投影処理を行う。
      if (visitorBlinkPhase > 0.0) {
      float visitorX = (abs(vVisitorFacePos.z) - 0.046) / 0.032;
      float visitorY = (vVisitorFacePos.y - 0.317) / 0.031;
      float visitorDist = length(vec2(visitorX, visitorY));
      visitorPart = (1.0 - smoothstep(0.95, 1.28, visitorDist)) * smoothstep(0.045, 0.06, vVisitorFacePos.x);
      float visitorEdge = clamp(abs(visitorX), 0.0, 1.0);
      float visitorLidY = mix(0.333, 0.302, visitorBlinkPhase)
        + 0.0016 * (1.0 - visitorEdge * visitorEdge) * sin(3.14159265 * visitorBlinkPhase)
        - (vVisitorFacePos.z < 0.0 ? 0.004 : 0.0) * sin(3.14159265 * visitorBlinkPhase);
      float visitorCurtain = smoothstep(visitorLidY - 0.0025, visitorLidY + 0.0025, vVisitorFacePos.y);
      visitorPart *= mix(visitorCurtain, 1.0, smoothstep(0.74, 0.84, visitorBlinkPhase)) * smoothstep(0.0, 0.03, visitorBlinkPhase);
      visitorPart *= mix(1.0, 1.0 - smoothstep(0.70, 1.05, abs(visitorX)),
        (1.0 - smoothstep(0.74, 0.84, visitorBlinkPhase)) * (1.0 - smoothstep(0.002, 0.007, abs(vVisitorFacePos.y - visitorLidY))));
      // 前髪と顔が同じメッシュなので、色が紫に寄る前髪は描き替えない。
      visitorPart *= 1.0 - smoothstep(0.078, 0.09, vVisitorFacePos.x) * smoothstep(0.005, 0.035, diffuseColor.b - diffuseColor.r);
      vec2 visitorUv = vec2(0.512 - 4.12 * vVisitorFacePos.z,
        1.0 - (0.518 + (vVisitorFacePos.z < 0.0 ? 0.020 : 0.0) - 3.15 * (vVisitorFacePos.y - visitorLidY + 0.003)));
      vec3 visitorSkin = texture2D(visitorBlinkImage, visitorUv).rgb * vec3(0.93, 0.87, 0.80);
      diffuseColor.rgb = mix(diffuseColor.rgb, visitorSkin, visitorPart);
      }`);
    shader.fragmentShader = shader.fragmentShader.replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>
      normal = normalize(mix(normal, vVisitorFaceNormal, visitorPart));`);
    shader.fragmentShader = shader.fragmentShader.replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>
      roughnessFactor = mix(roughnessFactor, 0.99, visitorPart);`);
  };
  material.customProgramCacheKey = () => `${cacheKey.call(material)}|visitor-blink-1`;
  material.needsUpdate = true;
  return {
    setPhase(value: number) {
      phase.value = loaded && !disposed ? value : 0;
      return loaded && !disposed;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      loaded = false;
      phase.value = 0;
      material.onBeforeCompile = beforeCompile;
      material.customProgramCacheKey = cacheKey;
      texture.dispose();
    },
  };
}
