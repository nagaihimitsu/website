import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { createDisposalScope, withDisposalScope, type DisposalScope } from "../disposal";
import { createVisitor } from "./visitor";
import modelUrl from "../../assets/room/visitor.glb?url";

const MODEL_HEIGHT = 1.2765;
const FOOT_Y = 0.0015;
const WAVE_INTERVAL = 8;
const CROSSFADE_SECONDS = 0.25;
// +Z正面・既存の身長へ正規化し、手振り時と量子化分の余裕を含む境界。
const MODEL_BOUNDS = new THREE.Box3(
  new THREE.Vector3(-0.291, 0, -0.209),
  new THREE.Vector3(0.254, 1.279, 0.209),
);

/** GLTFLoaderが作ったGPU資源・骨格・ImageBitmapを、重複なく所有する。 */
function ownModel(root: THREE.Object3D) {
  const resources = createDisposalScope();
  const images = new Set<object>();
  const skeletons = new Set<THREE.Skeleton>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    if (object instanceof THREE.SkinnedMesh && !skeletons.has(object.skeleton)) {
      skeletons.add(object.skeleton);
      resources.own(object.skeleton);
    }
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

/** 提供GLBを非同期で表示。読み込み中は非表示にし、失敗時は従来のNPCを表示する。 */
export function createVisitorModel(onVisualChange?: () => void) {
  return withDisposalScope((scope) => buildVisitorModel(scope, onVisualChange));
}

function buildVisitorModel(scope: DisposalScope, onVisualChange?: () => void) {
  const group = new THREE.Group();
  group.name = "visitor-npc";
  group.userData.damageable = false;
  group.userData.modelStatus = "loading";
  const body = new THREE.Group();
  body.name = "visitor-model-body";
  group.add(body);
  const fallback = scope.own(createVisitor());
  fallback.group.visible = false;
  body.add(fallback.group);
  // 非同期読込の前から、保存位置の検証と小鳥の回避に同じ境界を渡す。
  const bounds = new THREE.Box3().setFromObject(fallback.group).union(MODEL_BOUNDS);
  const request = new AbortController();
  let disposed = false;
  let loaded = false;
  let mixer: THREE.AnimationMixer | undefined;
  let idle: THREE.AnimationAction | undefined;
  let wave: THREE.AnimationAction | undefined;
  let previousTime: number | undefined;
  let animationTime = 0;
  let nextWaveAt = WAVE_INTERVAL;
  let returnToIdleAt = 0;
  let waving = false;
  let motionStopped = false;
  let previouslyReduced = false;
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
      // 同じGLBに待機・手振りがある場合だけ再生し、旧版GLBにも対応する。
      const clips = gltf.animations ?? [];
      const idleClip = clips.find((clip) => clip.name.toLowerCase() === "idle");
      const waveClip = clips.find((clip) => clip.name.toLowerCase() === "wave");
      if (idleClip || waveClip) {
        mixer = new THREE.AnimationMixer(gltf.scene);
        idle = idleClip ? mixer.clipAction(idleClip) : undefined;
        wave = waveClip ? mixer.clipAction(waveClip) : undefined;
        idle?.play();
        const ownedMixer = mixer;
        scope.defer(() => { ownedMixer.stopAllAction(); ownedMixer.uncacheRoot(gltf.scene); });
      }
      body.add(fitted);
      fallback.dispose();
      loaded = true;
      group.userData.modelStatus = "ready";
      onVisualChange?.();
      return "ready" as const;
    } catch (error) {
      if (disposed) return "disposed" as const;
      group.userData.modelStatus = "fallback";
      fallback.group.visible = true;
      console.warn("NPC model could not be loaded; keeping the procedural visitor.", error);
      onVisualChange?.(); // 失敗時にも代替モデルとその影を描き直す。
      return "fallback" as const;
    }
  })();

  return {
    group, bounds, ready,
    animate(time: number, reducedMotion: boolean) {
      if (disposed) return;
      if (!loaded) { fallback.animate(time, reducedMotion); return; }
      const delta = previousTime === undefined ? 0 : Math.max(0, time - previousTime);
      previousTime = time;
      if (mixer) {
        if (reducedMotion) {
          if (!motionStopped) {
            mixer.stopAllAction(); // 元の姿勢に戻し、手を上げたまま停止しない。
            motionStopped = true;
            waving = false;
            nextWaveAt = animationTime + WAVE_INTERVAL;
          }
        } else {
          if (motionStopped) {
            idle?.reset().play();
            motionStopped = false;
          } else {
            animationTime += delta;
            if (wave && !waving && animationTime >= nextWaveAt) {
              wave.reset().setLoop(THREE.LoopOnce, 1);
              wave.clampWhenFinished = true;
              wave.play();
              if (idle) idle.crossFadeTo(wave, CROSSFADE_SECONDS, false);
              else wave.fadeIn(CROSSFADE_SECONDS);
              waving = true;
              returnToIdleAt = animationTime + Math.max(wave.getClip().duration - CROSSFADE_SECONDS, 0.1);
            } else if (wave && waving && animationTime >= returnToIdleAt) {
              if (idle) { idle.reset().play(); wave.crossFadeTo(idle, CROSSFADE_SECONDS, false); }
              else wave.fadeOut(CROSSFADE_SECONDS);
              waving = false;
              nextWaveAt = animationTime + WAVE_INTERVAL;
            }
            mixer.update(delta);
          }
        }
      }
      // 旧版GLBも含め、待機中はモデル全体をわずかに揺らす。
      const still = reducedMotion ? 0 : 1;
      body.position.y = Math.sin(time * 1.65) * 0.0014 * still;
      body.rotation.z = Math.sin(time * 0.7) * 0.003 * still;
      // 動作抑制中は静止した影を繰り返し描き直さない。
      if (mixer && (!reducedMotion || !previouslyReduced)) onVisualChange?.();
      previouslyReduced = reducedMotion;
    },
    dispose: scope.dispose,
  };
}
