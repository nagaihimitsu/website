import * as THREE from "three";
import type { BassGameSnapshot, BassPerformanceEvent } from "../bassGame";
import { bassPitchColor } from "../bassFretboard";
import type { DisposalScope } from "../disposal";
import { bassFretY, bassStringX, bassStringZ, BASS_PICK_Y } from "./bassPose";

/** 強度・寿命・上限を集約。譜面・採点は所有せず、曲時計からだけ表示する。 */
export const BASS_EFFECT_CONFIG = Object.freeze({ capacity: 12, normalSeconds: 0.28, excellentSeconds: 0.48,
  slapSeconds: 0.4, slideSeconds: 0.5, glowOpacity: 0.62, comboMid: 20, comboHigh: 50 });
export const bassComboTier = (combo: number) => combo >= BASS_EFFECT_CONFIG.comboHigh ? 2 : combo >= BASS_EFFECT_CONFIG.comboMid ? 1 : 0;
export const successfulBassEvent = (event: BassPerformanceEvent) => event.stage === "complete" && ["perfect", "great", "good"].includes(event.grade);

export function createBassPerformanceEffects(scope: DisposalScope, instrument: THREE.Group) {
  const root = new THREE.Group();
  root.name = "bass-performance-effects";
  root.userData.roomRaycastIgnore = true;
  instrument.add(root);
  scope.defer(() => { root.removeFromParent(); root.clear(); });
  const sphere = scope.own(new THREE.SphereGeometry(1, 8, 6));
  const ringGeometry = scope.own(new THREE.TorusGeometry(1, 0.045, 4, 24));
  const starShape = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = i * Math.PI / 5, r = i % 2 ? 0.42 : 1;
    const x = Math.sin(a) * r, y = Math.cos(a) * r;
    if (!i) starShape.moveTo(x, y); else starShape.lineTo(x, y);
  }
  starShape.closePath();
  const starGeometry = scope.own(new THREE.ShapeGeometry(starShape));
  const material = () => scope.own(new THREE.MeshBasicMaterial({ color: "#fff1b8", transparent: true, depthWrite: false, side: THREE.DoubleSide }));
  const make = (geometry: THREE.BufferGeometry, parent: THREE.Group, mat: THREE.Material) => {
    const mesh = new THREE.Mesh(geometry, mat); mesh.renderOrder = 2; parent.add(mesh); return mesh;
  };
  const slots = Array.from({ length: BASS_EFFECT_CONFIG.capacity }, (_, i) => {
    const group = new THREE.Group(); group.name = `bass-performance-burst-${i}`; root.add(group); group.visible = false;
    const mat = material();
    return { group, mat, glow: make(sphere, group, mat), ring: make(ringGeometry, group, mat),
      stars: Array.from({ length: 5 }, () => make(starGeometry, group, mat)), event: null as BassPerformanceEvent | null };
  });
  const holds = Array.from({ length: 4 }, () => { const mat = material(); const mesh = make(sphere, root, mat); mesh.visible = false; return { mesh, mat }; });
  const slideGuides = Array.from({ length: 4 }, () => { const mat = material(); const mesh = make(sphere, root, mat); mesh.visible = false; return { mesh, mat }; });
  let lastSerial = 0, cursor = 0;
  function update(snapshot: BassGameSnapshot, reducedMotion: boolean) {
    const time = snapshot.elapsed;
    root.visible = snapshot.phase === "playing";
    root.userData.comboTier = bassComboTier(snapshot.combo);
    if (!root.visible) { for (const slot of slots) { slot.event = null; slot.group.visible = false; } }
    for (const event of snapshot.performanceEvents) {
      if (event.serial <= lastSerial) continue;
      lastSerial = event.serial;
      if (!root.visible || !successfulBassEvent(event) || time - event.time > 0.6) continue;
      const slot = slots[cursor++ % slots.length];
      slot.event = event; slot.group.userData.eventSerial = event.serial;
    }
    for (const slot of slots) {
      const event = slot.event;
      if (!event || !root.visible) { slot.group.visible = false; continue; }
      const duration = event.kind === "slide" ? BASS_EFFECT_CONFIG.slideSeconds : event.kind === "slap" ? BASS_EFFECT_CONFIG.slapSeconds :
        event.grade === "perfect" ? BASS_EFFECT_CONFIG.excellentSeconds : BASS_EFFECT_CONFIG.normalSeconds;
      const age = time - event.time, t = age / duration;
      slot.group.visible = t >= 0 && t < 1;
      if (!slot.group.visible) { slot.event = null; continue; }
      const excellent = event.grade === "perfect";
      const tier = bassComboTier(event.combo);
      const y = event.kind === "slide" ? THREE.MathUtils.lerp(bassFretY(event.fret), bassFretY(event.endFret!), reducedMotion ? 1 : t) : BASS_PICK_Y;
      const x = bassStringX(event.string, y), z = bassStringZ(y) + 0.012;
      slot.mat.opacity = (1 - t) * BASS_EFFECT_CONFIG.glowOpacity * (reducedMotion ? 0.45 : 1);
      slot.glow.position.set(x, y, z);
      slot.glow.scale.set(0.026, event.kind === "slide" || excellent ? 0.075 : 0.03, 0.007);
      slot.ring.visible = event.kind === "slap" && !reducedMotion;
      slot.ring.position.set(x, y, z + 0.005); slot.ring.scale.setScalar(0.025 + t * 0.12);
      for (const [i, star] of slot.stars.entries()) {
        star.visible = !reducedMotion && i < (excellent ? 3 : 1) + tier;
        const a = i * 2.4 + event.serial;
        star.position.set(x + Math.cos(a) * (0.035 + t * 0.13), y + Math.sin(a) * (0.035 + t * 0.15), z + 0.01);
        star.rotation.z = a + t * 0.4;
        star.scale.setScalar((excellent ? 0.018 : 0.011) * (1 - t * 0.6));
      }
    }
    for (let row = 0; row < 4; row++) {
      const hold = snapshot.notes.find(note => note.string === row && note.state === "holding");
      const sustained = holds[row]; sustained.mesh.visible = root.visible && Boolean(hold);
      if (hold) {
        sustained.mat.color.set(bassPitchColor(hold.midi)); sustained.mat.opacity = reducedMotion ? 0.16 : 0.28;
        sustained.mesh.position.set(bassStringX(row), BASS_PICK_Y, bassStringZ(BASS_PICK_Y) + 0.008);
        sustained.mesh.scale.set(0.015, 0.1, 0.006);
      }
      const slide = snapshot.notes.find(note => note.string === row && note.state === "sliding");
      const guide = slideGuides[row]; guide.mesh.visible = root.visible && Boolean(slide);
      if (slide) {
        const fret = slide.slideFret ?? slide.fret, y = bassFretY(fret);
        guide.mat.color.set(bassPitchColor(slide.midi + fret - slide.fret)); guide.mat.opacity = reducedMotion ? 0.2 : 0.45;
        guide.mesh.position.set(bassStringX(row, y), y, bassStringZ(y) + 0.008);
        guide.mesh.scale.set(0.024, 0.044, 0.006);
      }
    }
    root.userData.activeBursts = slots.filter(slot => slot.group.visible).length;
    root.userData.lastSerial = lastSerial;
  }
  return { root, update };
}
