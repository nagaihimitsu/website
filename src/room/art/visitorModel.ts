import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { createDisposalScope, withDisposalScope, type DisposalScope } from "../disposal";
import { createVisitor } from "./visitor";
import modelUrl from "../../assets/room/visitor.glb?url";

const MODEL_HEIGHT = 1.2765;
const FOOT_Y = 0.0015;
// 提供GLBを+Z正面・既存の身長へ正規化した境界。量子化分の余裕を含む。
const MODEL_BOUNDS = new THREE.Box3(
  new THREE.Vector3(-0.254, 0, -0.209),
  new THREE.Vector3(0.254, 1.279, 0.209),
);

/** GLTFLoaderが作ったGPU資源とImageBitmapを、重複なく所有する。 */
function ownModel(root: THREE.Object3D) {
  const resources = createDisposalScope();
  const images = new Set<object>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    resources.own(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      resources.own(material);
      for (const value of Object.values(material)) {
        if (!(value instanceof THREE.Texture)) continue;
        resources.own(value);
        const image = value.source.data as { close?: () => void } | undefined;
        if (image && typeof image.close === "function" && !images.has(image)) {
          images.add(image);
          resources.defer(() => image.close!());
        }
      }
    }
  });
  resources.defer(() => { root.removeFromParent(); root.clear(); });
  return resources;
}

/** 提供GLBを非同期で表示。読み込み中・失敗時も従来のNPCを維持する。 */
export function createVisitorModel(onLoaded?: () => void) {
  return withDisposalScope((scope) => buildVisitorModel(scope, onLoaded));
}

function buildVisitorModel(scope: DisposalScope, onLoaded?: () => void) {
  const group = new THREE.Group();
  group.name = "visitor-npc";
  group.userData.damageable = false;
  group.userData.modelStatus = "loading";
  const body = new THREE.Group();
  body.name = "visitor-model-body";
  group.add(body);
  const fallback = scope.own(createVisitor());
  body.add(fallback.group);
  // 非同期読込の前から、保存位置の検証と小鳥の回避に同じ境界を渡す。
  const bounds = new THREE.Box3().setFromObject(fallback.group).union(MODEL_BOUNDS);
  const request = new AbortController();
  let disposed = false;
  let loaded = false;
  scope.defer(() => { group.removeFromParent(); group.clear(); });
  scope.defer(() => { disposed = true; request.abort(); });

  const ready = (async () => {
    try {
      const response = await fetch(modelUrl, { signal: request.signal });
      if (!response.ok) throw new Error(`NPC model: HTTP ${response.status}`);
      const data = await response.arrayBuffer();
      if (disposed) return "disposed" as const;
      const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
      const gltf = await loader.parseAsync(data, "");
      const resources = ownModel(gltf.scene);
      // 画像のデコード中に退室した場合も、遅れて完成した資源を回収する。
      if (disposed) { resources.dispose(); return "disposed" as const; }
      scope.own(resources);
      const fitted = new THREE.Group();
      fitted.name = "visitor-imported-model";
      fitted.rotation.y = -Math.PI / 2; // 提供モデルは+X正面。
      fitted.add(gltf.scene);
      const sourceBounds = new THREE.Box3().setFromObject(fitted);
      const center = sourceBounds.getCenter(new THREE.Vector3());
      const height = sourceBounds.max.y - sourceBounds.min.y;
      if (!Number.isFinite(height) || height <= 0) {
        resources.dispose();
        throw new Error("NPC model has no finite standing bounds");
      }
      const scale = MODEL_HEIGHT / height;
      fitted.scale.setScalar(scale);
      fitted.position.set(-center.x * scale, FOOT_Y - sourceBounds.min.y * scale, -center.z * scale);
      gltf.scene.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.castShadow = true;
          object.receiveShadow = true;
        }
      });
      body.add(fitted);
      fallback.dispose();
      loaded = true;
      group.userData.modelStatus = "ready";
      onLoaded?.();
      return "ready" as const;
    } catch (error) {
      if (disposed) return "disposed" as const;
      group.userData.modelStatus = "fallback";
      console.warn("NPC model could not be loaded; keeping the procedural visitor.", error);
      return "fallback" as const;
    }
  })();

  return {
    group, bounds, ready,
    animate(time: number, reducedMotion: boolean) {
      if (disposed) return;
      if (!loaded) { fallback.animate(time, reducedMotion); return; }
      // GLBにボーンや表情モーフはないため、待機中の小さな揺れだけを付ける。
      const still = reducedMotion ? 0 : 1;
      body.position.y = Math.sin(time * 1.65) * 0.0014 * still;
      body.rotation.z = Math.sin(time * 0.7) * 0.003 * still;
    },
    dispose: scope.dispose,
  };
}
