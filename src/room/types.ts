import type * as THREE from "three";
import type { Archive, Section } from "../data/model";
import type { BirdAnimationState } from "./art/bird";

export type Direction = "up" | "down" | "left" | "right";
export interface RoomObstacle {
  id: string;
  x: number;
  z: number;
  width: number;
  depth: number;
  base: number;
  top: number;
  enabled?: boolean;
}
export interface RoomBreakable {
  id: string;
  label: string;
  object: THREE.Object3D;
  broken: boolean;
}
export interface RoomPortal {
  section: Section;
  object: THREE.Object3D;
  anchor: THREE.Vector3;
  lookAt: THREE.Vector3;
}
export interface RoomAvatarAnimation {
  time: number;
  speed: number;
  grounded: boolean;
  velocityY: number;
  punchProgress: number | null;
  reducedMotion: boolean;
}
export interface RoomScene {
  scene: THREE.Scene;
  avatar: THREE.Group;
  bird: THREE.Group;
  portals: RoomPortal[];
  obstacles: RoomObstacle[];
  breakables: RoomBreakable[];
  breakObject: (id: string, impulse: THREE.Vector3) => boolean;
  resetObjects: () => void;
  animate: (time: number, moving: boolean, reducedMotion: boolean) => void;
  animateAvatar: (state: RoomAvatarAnimation) => void;
  animateBird: (state: BirdAnimationState) => void;
  dispose: () => void;
}
export interface RoomSnapshot {
  x: number;
  z: number;
  height: number;
  moving: boolean;
  grounded: boolean;
  supportId: string | null;
  yaw: number;
  pitch: number;
  facing: number;
  cameraDistance: number;
  cameraX: number;
  cameraY: number;
  cameraZ: number;
  punching: boolean;
  brokenCount: number;
  birdX: number;
  birdZ: number;
  birdHeight: number;
  birdMoving: boolean;
}
export interface RoomEngineOptions {
  host: HTMLElement;
  archive: Archive;
  reducedMotion: boolean;
  onReady: () => void;
  onError: () => void;
  onOpening: (section: Section) => void;
  onOpen: (section: Section) => void;
  onHover: (section: Section | null) => void;
  onBreak: (label: string) => void;
  onSnapshot: (snapshot: RoomSnapshot) => void;
}
export interface RoomEngine {
  direction: (direction: Direction, pressed: boolean) => void;
  move: (x: number, z: number) => void;
  resetView: () => void;
  jump: () => void;
  punch: () => void;
  resetObjects: () => void;
  open: (section: Section) => void;
  setPaused: (value: boolean) => void;
  setReducedMotion: (value: boolean) => void;
  dispose: () => void;
}
