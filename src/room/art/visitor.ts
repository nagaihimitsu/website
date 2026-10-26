import * as THREE from "three";
import { withDisposalScope, type DisposalScope } from "../disposal";
import { createVisitorArt } from "./visitorArt";
import { createVisitorHead } from "./visitorHead";
import { createVisitorClothes } from "./visitorClothes";
import { createVisitorAccessories } from "./visitorAccessories";

/** 提供画像をもとにした全方向の自作立体。正面+Z、足裏Y=0。 */
export function createVisitor() {
  return withDisposalScope(buildVisitor);
}

function buildVisitor(scope: DisposalScope) {
  const group = new THREE.Group();
  group.name = "visitor-npc";
  group.userData.damageable = false;
  const body = new THREE.Group();
  body.name = "visitor-body";
  group.add(body);
  scope.defer(() => group.clear());
  const art = createVisitorArt(scope, body);
  createVisitorClothes(art);
  createVisitorAccessories(art);
  const { eyes } = createVisitorHead(art);

  let disposed = false;
  scope.defer(() => group.removeFromParent());
  scope.defer(() => { disposed = true; });
  return {
    group,
    animate(time: number, reducedMotion: boolean) {
      if (disposed) return;
      const still = reducedMotion ? 0 : 1;
      body.position.y = Math.sin(time * 1.65) * 0.0014 * still;
      body.rotation.z = Math.sin(time * 0.7) * 0.003 * still;
      const blinkClock = (time + 1.3) % 5.7;
      const blink = blinkClock < 0.17 ? Math.sin(blinkClock / 0.17 * Math.PI) : 0;
      for (const eye of eyes) eye.scale.y = 1 - blink * 0.96 * still;
    },
    dispose: scope.dispose,
  };
}
