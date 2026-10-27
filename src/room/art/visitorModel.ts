import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { createDisposalScope, withDisposalScope, type DisposalScope } from "../disposal";
import { createVisitor } from "./visitor";
import modelUrl from "../../assets/room/visitor.glb?url";

const MODEL_HEIGHT = 1.2765;
const FOOT_Y = 0.0015;
// 正面寄りの主人公を、首元を無理に伸ばさない範囲で控えめに見る。
const HEAD_TURN_LIMIT = THREE.MathUtils.degToRad(14);
const HEAD_PITCH_LIMIT = THREE.MathUtils.degToRad(6);
const VIEW_FULL_ANGLE = THREE.MathUtils.degToRad(45);
const VIEW_OUTER_ANGLE = THREE.MathUtils.degToRad(75);
// 正規化後の目のおおよその高さ。視線対象はワールド座標で受け取る。
const HEAD_EYE_Y = 1.045;
const HEAD_TURN_SPEED = 2.8;
// +Z正面・既存の身長へ正規化し、量子化分の余裕を含む境界。
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
  // 向きを変えても不変の衝突範囲。首の回転と揺れにも余裕を設ける。
  const radius = Math.hypot(
    Math.max(Math.abs(bounds.min.x), Math.abs(bounds.max.x)),
    Math.max(Math.abs(bounds.min.z), Math.abs(bounds.max.z)),
  ) + 0.04;
  bounds.min.x = bounds.min.z = -radius;
  bounds.max.x = bounds.max.z = radius;
  const request = new AbortController();
  let disposed = false;
  let loaded = false;
  let mixer: THREE.AnimationMixer | undefined;
  let idle: THREE.AnimationAction | undefined;
  let previousTime: number | undefined;
  let motionStopped = false;
  let previouslyReduced = false;
  let head: THREE.Bone | undefined;
  let headYaw = 0;
  let headPitch = 0;
  const localTarget = new THREE.Vector3();
  const headTurn = new THREE.Quaternion();
  const previousHeadTurn = new THREE.Quaternion();
  const inverseHeadTurn = new THREE.Quaternion();
  const turnAxis = new THREE.Vector3(0, 1, 0);
  // 提供GLBは +X 正面なので、頭のローカルZ軸が俯仰の軸になる。
  const pitchAxis = new THREE.Vector3(0, 0, 1);
  const pitchTurn = new THREE.Quaternion();
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
      const headObject = gltf.scene.getObjectByName("head");
      head = headObject instanceof THREE.Bone ? headObject : undefined;
      // 待機のみ再生し、旧版GLBにも対応する。手振りクリップは再生しない。
      const clips = gltf.animations ?? [];
      const idleClip = clips.find((clip) => clip.name.toLowerCase() === "idle");
      if (idleClip) {
        mixer = new THREE.AnimationMixer(gltf.scene);
        idle = mixer.clipAction(idleClip);
        idle.play();
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
    animate(time: number, reducedMotion: boolean, target?: THREE.Vector3) {
      if (disposed) return;
      if (!loaded) { fallback.animate(time, reducedMotion); return; }
      const delta = previousTime === undefined ? 0 : Math.max(0, time - previousTime);
      previousTime = time;
      // 先ほど加えた追従回転を取り除いてから、クリップの姿勢を評価する。
      // これにより停止・再開時やクリップのないモデルでも回転が累積しない。
      if (head) head.quaternion.multiply(inverseHeadTurn.copy(previousHeadTurn).invert());
      previousHeadTurn.identity();
      if (mixer) {
        if (reducedMotion) {
          if (!motionStopped) {
            mixer.stopAllAction(); // 元の姿勢に戻して静止する。
            motionStopped = true;
          }
        } else {
          if (motionStopped) {
            idle?.reset().play();
            motionStopped = false;
          } else {
            mixer.update(delta);
          }
        }
      }
      if (head) {
        let targetYaw = 0;
        let targetPitch = 0;
        if (!reducedMotion && target) {
          // グループの正面は +Z。主人公をNPCのローカル座標に変換する。
          group.updateWorldMatrix(true, false);
          localTarget.copy(target);
          group.worldToLocal(localTarget);
          const distance = Math.hypot(localTarget.x, localTarget.z);
          if (distance > 0.01) {
            const direction = Math.atan2(localTarget.x, localTarget.z);
            // 視界の縁では少しずつ追従を弱め、背後では正面に戻る。
            const visibility = 1 - THREE.MathUtils.smoothstep(
              Math.abs(direction), VIEW_FULL_ANGLE, VIEW_OUTER_ANGLE,
            );
            targetYaw = THREE.MathUtils.clamp(direction * 0.55, -HEAD_TURN_LIMIT, HEAD_TURN_LIMIT) * visibility;
            targetPitch = THREE.MathUtils.clamp(
              Math.atan2(localTarget.y - HEAD_EYE_Y, distance) * 0.6, -HEAD_PITCH_LIMIT, HEAD_PITCH_LIMIT,
            ) * visibility;
          }
        }
        headYaw = reducedMotion ? 0 : THREE.MathUtils.lerp(
          headYaw, targetYaw, 1 - Math.exp(-HEAD_TURN_SPEED * Math.min(delta, 0.1)),
        );
        headPitch = reducedMotion ? 0 : THREE.MathUtils.lerp(
          headPitch, targetPitch, 1 - Math.exp(-HEAD_TURN_SPEED * Math.min(delta, 0.1)),
        );
        headTurn.setFromAxisAngle(turnAxis, headYaw)
          .multiply(pitchTurn.setFromAxisAngle(pitchAxis, headPitch));
        head.quaternion.multiply(headTurn);
        previousHeadTurn.copy(headTurn);
      }
      // 旧版GLBも含め、待機中はモデル全体をわずかに揺らす。
      const still = reducedMotion ? 0 : 1;
      body.position.y = Math.sin(time * 1.65) * 0.0014 * still;
      body.rotation.z = Math.sin(time * 0.7) * 0.003 * still;
      // 動作抑制中は静止した影を繰り返し描き直さない。
      if ((mixer || head) && (!reducedMotion || !previouslyReduced)) onVisualChange?.();
      previouslyReduced = reducedMotion;
    },
    dispose: scope.dispose,
  };
}
