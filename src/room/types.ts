import type * as THREE from "three";
import type { Archive, Section } from "../data/model";

export type Direction = "up" | "down" | "left" | "right";
export interface RoomObstacle {
  x: number;
  z: number;
  width: number;
  depth: number;
}
export interface RoomPortal {
  section: Section;
  object: THREE.Object3D;
  anchor: THREE.Vector3;
  lookAt: THREE.Vector3;
}
export interface RoomScene {
  scene: THREE.Scene;
  avatar: THREE.Group;
  portals: RoomPortal[];
  obstacles: RoomObstacle[];
  animate: (time: number, moving: boolean, reducedMotion: boolean) => void;
  dispose: () => void;
}
export interface RoomProjection {
  section: Section;
  x: number;
  y: number;
  visible: boolean;
}
export interface RoomSnapshot {
  x: number;
  z: number;
  height: number;
  moving: boolean;
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
  onProject: (portals: RoomProjection[]) => void;
  onSnapshot: (snapshot: RoomSnapshot) => void;
}
export interface RoomEngine {
  direction: (direction: Direction, pressed: boolean) => void;
  jump: () => void;
  open: (section: Section) => void;
  setReducedMotion: (value: boolean) => void;
  dispose: () => void;
}
