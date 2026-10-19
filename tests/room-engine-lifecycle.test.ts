import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Archive } from "../src/data/model";
import type { RoomEngineOptions, RoomScene } from "../src/room/types";
import { createRoomEngine } from "../src/room/roomEngine";

const factories = vi.hoisted(() => ({ renderer: vi.fn(), room: vi.fn() }));

// Keep Three's scene graph, cameras, raycasting and math real. A GPU/context is
// unnecessary for checking ownership of resources created during engine setup.
vi.mock("three", async (original) => ({
  ...await original<typeof import("three")>(),
  WebGLRenderer: vi.fn(function () { return factories.renderer(); }),
}));
vi.mock("../src/room/roomScene", () => ({
  createRoomScene: (...args: unknown[]) => factories.room(...args),
}));

class TestElement extends EventTarget {
  style: Record<string, string> = {};
  tabIndex = -1;
  parentElement: TestElement | null = null;
  children: TestElement[] = [];
  setAttribute = vi.fn();
  focus = vi.fn();
  hasPointerCapture = vi.fn(() => false);
  releasePointerCapture = vi.fn();
  getBoundingClientRect = () => ({ width: 1280, height: 800, left: 0, top: 0 });
  closest = () => null;
  append = (element: TestElement) => {
    this.children.push(element);
    element.parentElement = this;
  };
  remove = vi.fn(() => {
    if (this.parentElement) {
      this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
      this.parentElement = null;
    }
  });
}

function trackListeners(target: EventTarget) {
  return {
    add: vi.spyOn(target, "addEventListener"),
    remove: vi.spyOn(target, "removeEventListener"),
  };
}

function createHarness() {
  const host = new TestElement();
  const canvas = new TestElement();
  const testWindow = Object.assign(new EventTarget(), { devicePixelRatio: 1, open: vi.fn() });
  const testDocument = Object.assign(new EventTarget(), { hidden: false, activeElement: null });
  const listeners = [testWindow, testDocument, canvas].map(trackListeners);
  const observers: { observe: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }[] = [];
  const scheduled = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;
  const cancelFrame = vi.fn((id: number) => scheduled.delete(id));
  vi.stubGlobal("window", testWindow);
  vi.stubGlobal("document", testDocument);
  vi.stubGlobal("HTMLElement", TestElement);
  vi.stubGlobal("sessionStorage", { getItem: vi.fn(() => null), setItem: vi.fn() });
  vi.stubGlobal("ResizeObserver", class {
    observe = vi.fn();
    disconnect = vi.fn();
    constructor() { observers.push(this); }
  });
  vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
    const id = ++nextFrame;
    scheduled.set(id, callback);
    return id;
  }));
  vi.stubGlobal("cancelAnimationFrame", cancelFrame);

  const renderer = {
    domElement: canvas,
    shadowMap: {},
    setClearColor: vi.fn(),
    setPixelRatio: vi.fn(),
    setSize: vi.fn(),
    render: vi.fn(),
    dispose: vi.fn(),
    forceContextLoss: vi.fn(),
  };
  const scene = new THREE.Scene();
  const avatar = new THREE.Group();
  const bird = new THREE.Group();
  scene.add(avatar, bird);
  const room: RoomScene = {
    scene, avatar, bird,
    obstacles: [{ id: "floor", x: 0, z: 0, width: 10, depth: 8,
      base: -0.1, top: 0, support: "ground", enabled: true }],
    portals: [], breakables: [],
    door: { object: new THREE.Group(), open: vi.fn(() => false), isOpen: () => false },
    breakObject: vi.fn(() => false),
    resetObjects: vi.fn(),
    animate: vi.fn(),
    animateAvatar: vi.fn(),
    animateBird: vi.fn(),
    dispose: vi.fn(),
  };
  factories.renderer.mockReturnValue(renderer);
  factories.room.mockReturnValue(room);
  const options: RoomEngineOptions = {
    host: host as unknown as HTMLElement,
    archive: {} as Archive, // Scene construction is stubbed; no archive data is read.
    reducedMotion: true,
    onReady: vi.fn(), onError: vi.fn(), onOpening: vi.fn(), onOpen: vi.fn(),
    onHover: vi.fn(), onBreak: vi.fn(), onSnapshot: vi.fn(),
  };
  return { host, canvas, listeners, observers, scheduled, renderer, room, options };
}

function expectListenersReleased(listeners: ReturnType<typeof trackListeners>[]) {
  for (const { add, remove } of listeners) {
    expect(add.mock.calls.length).toBeGreaterThan(0);
    expect(remove.mock.calls).toHaveLength(add.mock.calls.length);
    for (const [name, listener] of add.mock.calls) {
      expect(remove.mock.calls.filter(([removedName, removedListener]) =>
        removedName === name && removedListener === listener,
      )).toHaveLength(1);
    }
  }
}

function expectAcquiredResourcesReleased(harness: ReturnType<typeof createHarness>) {
  const { host, canvas, listeners, observers, scheduled, renderer, room } = harness;
  expect(host.children).toHaveLength(0);
  expect(canvas.remove).toHaveBeenCalledOnce();
  expect(room.dispose).toHaveBeenCalledOnce();
  expect(renderer.dispose).toHaveBeenCalledOnce();
  expect(renderer.forceContextLoss).toHaveBeenCalledOnce();
  expect(room.scene.children.some((child) => child instanceof THREE.Camera)).toBe(false);
  expect(observers).toHaveLength(1);
  expect(observers[0].observe).toHaveBeenCalledWith(host);
  expect(observers[0].disconnect).toHaveBeenCalledOnce();
  expectListenersReleased(listeners);
  expect(scheduled.size).toBe(0);
}

function thrownBy(action: () => unknown) {
  try { action(); } catch (error) { return error; }
  throw new Error("Expected construction to fail");
}

beforeEach(() => {
  factories.renderer.mockReset();
  factories.room.mockReset();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("room engine construction and cleanup", () => {
  it.each(["resize", "snapshot"] as const)(
    "releases every acquired resource when initial %s fails",
    (stage) => {
      const harness = createHarness();
      const failure = new Error(`initial ${stage}`);
      if (stage === "resize") harness.renderer.setSize.mockImplementation(() => { throw failure; });
      else harness.options.onSnapshot = () => { throw failure; };

      expect(thrownBy(() => createRoomEngine(harness.options))).toBe(failure);
      expectAcquiredResourcesReleased(harness);
    },
  );

  it("releases the renderer/context when scene construction fails before a canvas is appended", () => {
    const harness = createHarness();
    const failure = new Error("scene construction");
    factories.room.mockImplementation(() => { throw failure; });

    expect(thrownBy(() => createRoomEngine(harness.options))).toBe(failure);
    expect(harness.renderer.dispose).toHaveBeenCalledOnce();
    expect(harness.renderer.forceContextLoss).toHaveBeenCalledOnce();
    expect(harness.room.dispose).not.toHaveBeenCalled();
    expect(harness.host.children).toHaveLength(0);
    expect(harness.observers).toHaveLength(0);
    expect(harness.scheduled.size).toBe(0);
    for (const { add } of harness.listeners) expect(add).not.toHaveBeenCalled();
  });

  it("preserves the setup error and completes cleanup even when a disposer also throws", () => {
    const harness = createHarness();
    const failure = new Error("initial resize");
    const cleanupFailure = new Error("renderer cleanup");
    const diagnostic = vi.spyOn(console, "error").mockImplementation(() => {});
    harness.renderer.setSize.mockImplementation(() => { throw failure; });
    harness.renderer.dispose.mockImplementation(() => { throw cleanupFailure; });

    expect(thrownBy(() => createRoomEngine(harness.options))).toBe(failure);
    expectAcquiredResourcesReleased(harness);
    expect(diagnostic).toHaveBeenCalled();
  });

  it("detaches the live canvas/camera, cancels the pending frame and disposes once across repeated calls", () => {
    const harness = createHarness();
    const engine = createRoomEngine(harness.options);
    expect(harness.host.children).toEqual([harness.canvas]);
    expect(harness.scheduled.size).toBe(1);
    expect(harness.room.scene.children.some((child) => child instanceof THREE.Camera)).toBe(true);
    expect(harness.options.onSnapshot).toHaveBeenCalledOnce();

    engine.dispose();
    engine.dispose();

    expectAcquiredResourcesReleased(harness);
  });

  it("immediately releases the failed runtime before fallback, with later disposal remaining a no-op", () => {
    const harness = createHarness();
    harness.options.reducedMotion = false;
    harness.room.portals.push({
      destination: "world", object: new THREE.Group(),
      anchor: new THREE.Vector3(), lookAt: new THREE.Vector3(),
    });
    const engine = createRoomEngine(harness.options);
    engine.open("world");
    expect(harness.options.onOpening).toHaveBeenCalledWith("world");
    const lostContext = new Event("webglcontextlost", { cancelable: true });

    harness.canvas.dispatchEvent(lostContext);

    expect(lostContext.defaultPrevented).toBe(true);
    expect(harness.options.onError).toHaveBeenCalledOnce();
    expectAcquiredResourcesReleased(harness);
    engine.setReducedMotion(true);
    expect(harness.options.onOpen).not.toHaveBeenCalled();
    engine.dispose();
    harness.canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    expect(harness.options.onError).toHaveBeenCalledOnce();
    expectAcquiredResourcesReleased(harness);
  });
});
