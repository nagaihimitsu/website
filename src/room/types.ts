import type { BassPointerInput } from "./bassInput";
import type * as THREE from "three";
import type { Archive, Section } from "../data/model";
import type { BirdAnimationState } from "./art/bird";
import type { RoomDestinationId } from "./destinations";
import type { BassDifficulty, BassGameSnapshot, BassSongId, BassString, BassTechnique } from "./bassGame";
import type { BassAudioStatus } from "./bassAudio";

export type Direction = "up" | "down" | "left" | "right";
export type RoomDestination = RoomDestinationId;
export interface RoomObstacle {
  id: string;
  x: number;
  z: number;
  width: number;
  depth: number;
  base: number;
  top: number;
  enabled?: boolean;
  /** Rotation about the solid's center, using Three.js Y-axis convention. */
  rotationY?: number;
  /** Ground contacts keep the visitor's supportId independent of floor tiles. */
  support?: "ground" | "platform";
}
export interface RoomBreakable {
  id: string;
  label: string;
  object: THREE.Object3D;
  broken: boolean;
}
export interface RoomPortal {
  destination: RoomDestination;
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
  bass?: {
    lift: number; pluck: number; playing: boolean;
    beat: number; string: number; fret: number; fretting: boolean; pluckString?: number; slap?: number;
  };
}
export interface RoomScene {
  scene: THREE.Scene;
  avatar: THREE.Group;
  bird: THREE.Group;
  portals: RoomPortal[];
  obstacles: RoomObstacle[];
  breakables: RoomBreakable[];
  door: {
    object: THREE.Object3D;
    open: (immediate?: boolean) => boolean;
    isOpen: () => boolean;
  };
  bass: {
    anchor: { x: number; z: number };
    radius: number;
    animate: (time: number, lift: number, pluck: number, bloom: number, reducedMotion: boolean,
      performance?: { playing: boolean; beat: number; success: number; string?: number; slap?: number; snapshot?: BassGameSnapshot }) => void;
  };
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
  cameraZoom: number;
  cameraOffsetX: number;
  cameraOffsetY: number;
  pinching: boolean;
  avatarOpacity: number;
  avatarVisible: boolean;
  punching: boolean;
  brokenCount: number;
  birdX: number;
  birdZ: number;
  birdHeight: number;
  birdMoving: boolean;
  doorOpen: boolean;
}
export interface RoomEngineOptions {
  host: HTMLElement;
  archive: Archive;
  reducedMotion: boolean;
  onReady: () => void;
  onError: () => void;
  onOpening: (section: Section) => void;
  onOpen: (section: Section) => void;
  onHover: (section: RoomDestination | null) => void;
  onBreak: (label: string) => void;
  onDoorOpen?: () => void;
  onBassSnapshot?: (snapshot: BassGameSnapshot) => void;
  onBassAudioStatus?: (status: BassAudioStatus) => void;
  onSnapshot: (snapshot: RoomSnapshot) => void;
}
export interface RoomEngine {
  direction: (direction: Direction, pressed: boolean) => void;
  move: (x: number, z: number) => void;
  resetView: () => void;
  jump: () => void;
  punch: () => void;
  startBass: () => void;
  continueBass: () => boolean;
  selectBassSong: (id: BassSongId) => boolean;
  setBassAudioOffset: (seconds: number) => boolean;
  seekBass: (seconds: number) => boolean;
  setBassDifficulty: (difficulty: BassDifficulty) => void;
  inputBass: (input: BassPointerInput) => void;
  pluckBass: (string: BassString, technique?: BassTechnique) => void;
  putDownBass: () => void;
  setBassOverlayHeight: (height: number) => void;
  resetObjects: () => void;
  open: (section: RoomDestination) => void;
  setTargetHovered: (value: boolean) => void;
  setPaused: (value: boolean) => void;
  setReducedMotion: (value: boolean) => void;
  dispose: () => void;
}
