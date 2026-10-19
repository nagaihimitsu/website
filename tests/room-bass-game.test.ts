import { afterEach, describe, expect, it, vi } from "vitest";
import { createBassAudio } from "../src/room/bassAudio";
import {
  BASS_CHART, BASS_COUNTDOWN_SECONDS, BASS_DURATION, BASS_GOOD_WINDOW,
  BASS_PICKUP_SECONDS, BASS_PROXIMITY_SECONDS, createBassGame,
} from "../src/room/bassGame";

function readyGame() {
  const game = createBassGame();
  game.tick(BASS_PROXIMITY_SECONDS, true);
  game.tick(BASS_PICKUP_SECONDS, true);
  return game;
}

function playingGame() {
  const game = readyGame();
  game.start();
  game.tick(BASS_COUNTDOWN_SECONDS, true);
  return game;
}

describe("terrace bass game", () => {
  it("requires five continuous nearby seconds and removes all progress on leaving", () => {
    const game = createBassGame();
    expect(game.start()).toBe(false);
    expect(game.tick(4.5, true).proximityProgress).toBe(0.9);
    expect(game.tick(0, false)).toMatchObject({ phase: "idle", proximityProgress: 0 });
    expect(game.tick(4.99, true).phase).toBe("approaching");
    expect(game.tick(0.01, true).phase).toBe("pickup");
    expect(game.snapshot().pickupProgress).toBeCloseTo(0);
    expect(game.start()).toBe(false);
    expect(game.tick(BASS_PICKUP_SECONDS / 2, true).pickupProgress).toBeCloseTo(0.5);
    expect(game.tick(BASS_PICKUP_SECONDS / 2, true).phase).toBe("ready");
    expect(game.tick(30, true).phase).toBe("ready");
  });

  it("only starts through an explicit gesture, with a countdown and exact active timing", () => {
    const game = readyGame();
    expect(game.start()).toBe(true);
    expect(game.snapshot()).toMatchObject({ phase: "countdown", countdown: 3, elapsed: 0 });
    expect(game.start()).toBe(false);
    expect(game.pluck()).toBeNull();
    const snapshot = game.tick(BASS_COUNTDOWN_SECONDS + 0.125, true);
    expect(snapshot).toMatchObject({ phase: "playing", countdown: 0, elapsed: 0.125 });
  });

  it("freezes pickup, countdown, notes and input throughout pauses, without catch-up misses", () => {
    const game = createBassGame();
    game.tick(4, true);
    expect(game.tick(60, true, true).proximityProgress).toBe(0.8);
    game.tick(1 + BASS_PICKUP_SECONDS, true);
    game.start();
    const countdown = game.tick(0.4, true);
    expect(game.tick(300, true, true)).toEqual(countdown);
    game.tick(countdown.countdownRemaining, true);
    game.tick(BASS_CHART[0].time, true);
    const paused = game.tick(600, true, true);
    expect(paused.misses).toBe(0);
    expect(game.pluck()).toBeNull();
    game.tick(0, true);
    expect(game.pluck()).toMatchObject({ kind: "perfect", noteId: 0 });
    expect(game.snapshot().elapsed).toBe(BASS_CHART[0].time);
  });

  it("judges the nearest pending note once and charges off-beat and duplicate plucks", () => {
    const game = playingGame();
    game.tick(BASS_CHART[0].time, true);
    expect(game.pluck()).toMatchObject({ kind: "perfect", noteId: 0, frequency: BASS_CHART[0].frequency });
    expect(game.pluck()).toEqual({ kind: "miss", noteId: null, frequency: null });
    expect(game.snapshot()).toMatchObject({ hits: 1, score: 750, combo: 0, maxCombo: 1, strayPlucks: 1 });
    game.tick(BASS_CHART[1].time - BASS_CHART[0].time - 0.13, true);
    expect(game.pluck()).toMatchObject({ kind: "good", noteId: 1 });
    expect(game.snapshot()).toMatchObject({ hits: 2, score: 1400, combo: 1 });
  });

  it("resolves missed notes and completes without requiring a final input", () => {
    const game = playingGame();
    game.tick(BASS_CHART[0].time, true);
    game.pluck();
    game.tick(BASS_CHART[1].time - BASS_CHART[0].time + BASS_GOOD_WINDOW + 0.001, true);
    expect(game.snapshot()).toMatchObject({ combo: 0, hits: 1, misses: 1, feedback: "miss" });
    const result = game.tick(BASS_DURATION, true);
    expect(result.phase).toBe("result");
    expect(result.elapsed).toBe(BASS_DURATION);
    expect(result.hits + result.misses).toBe(BASS_CHART.length);
    expect(result.notes.some((note) => note.state === "pending")).toBe(false);
    expect(game.pluck()).toBeNull();
  });

  it("rewards the original phrase and prevents rapid mashing from earning a perfect result", () => {
    const precise = playingGame();
    for (const note of BASS_CHART) {
      precise.tick(note.time - precise.snapshot().elapsed, true);
      precise.pluck();
    }
    precise.tick(BASS_DURATION, true);
    expect(precise.snapshot()).toMatchObject({ accuracy: 100, combo: BASS_CHART.length, misses: 0 });
    const mashing = playingGame();
    for (let frame = 0; frame < BASS_DURATION * 20; frame++) {
      mashing.tick(0.05, true);
      mashing.pluck();
    }
    expect(mashing.snapshot().accuracy).toBeLessThan(20);
    expect(mashing.snapshot().strayPlucks).toBeGreaterThan(BASS_CHART.length);
  });

  it("replays while holding the bass, but putting it down requires another full proximity hold", () => {
    const game = playingGame();
    game.tick(BASS_DURATION, true);
    expect(game.start()).toBe(true);
    expect(game.snapshot()).toMatchObject({ phase: "countdown", score: 0, misses: 0, hits: 0 });
    game.cancel();
    expect(game.snapshot()).toMatchObject({ phase: "idle", elapsed: 0, proximityProgress: 0, pickupProgress: 0 });
    expect(game.start()).toBe(false);
    expect(game.tick(4.9, true).phase).toBe("approaching");
  });

  it("ignores invalid time and does not expose mutable scoring state through snapshots", () => {
    const game = playingGame();
    const before = game.snapshot();
    expect(game.tick(Infinity, true)).toEqual(before);
    expect(game.tick(-10, true)).toEqual(before);
    before.notes[0].state = "perfect";
    expect(game.snapshot().notes[0].state).toBe("pending");
  });
});

describe("bass audio lifecycle", () => {
  afterEach(() => vi.unstubAllGlobals());

  function installAudio() {
    const sources: { start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }[] = [];
    const parameter = () => ({
      value: 0, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn(),
    });
    const node = () => ({ connect: vi.fn(function (this: unknown, destination: unknown) { return destination; }), disconnect: vi.fn() });
    const context = {
      state: "running", currentTime: 10, sampleRate: 8000, destination: node(),
      createGain: () => ({ ...node(), gain: parameter() }),
      createBuffer: (_channels: number, length: number) => ({ getChannelData: () => new Float32Array(length) }),
      createBiquadFilter: () => ({ ...node(), frequency: parameter() }),
      createOscillator: () => {
        const source = { ...node(), start: vi.fn(), stop: vi.fn(), frequency: parameter() };
        sources.push(source);
        return source;
      },
      createBufferSource: () => {
        const source = { ...node(), start: vi.fn(), stop: vi.fn() };
        sources.push(source);
        return source;
      },
      resume: vi.fn(async () => undefined), close: vi.fn(async () => undefined),
    };
    const constructor = vi.fn(function () { return context; });
    vi.stubGlobal("window", { AudioContext: constructor });
    return { context, sources, constructor };
  }

  it("creates audio only on a user gesture and cancels queued voices on pause/dispose", () => {
    const { constructor, context, sources } = installAudio();
    const audio = createBassAudio();
    const game = readyGame();
    audio.sync(game.snapshot());
    expect(constructor).not.toHaveBeenCalled();
    audio.unlock();
    expect(constructor).toHaveBeenCalledTimes(1);
    game.start();
    audio.sync(game.snapshot());
    expect(sources).toHaveLength(1);
    expect(sources[0].start).toHaveBeenCalledWith(10);
    audio.sync(game.snapshot(), true);
    expect(sources[0].stop).toHaveBeenCalledWith();
    expect(sources[0].disconnect).toHaveBeenCalled();
    audio.dispose();
    audio.dispose();
    audio.unlock();
    expect(context.close).toHaveBeenCalledTimes(1);
    expect(constructor).toHaveBeenCalledTimes(1);
  });

  it("does not accumulate backing events after a long pause or schedule more than 120 ms ahead", () => {
    const { context, sources } = installAudio();
    const audio = createBassAudio();
    const game = playingGame();
    audio.unlock();
    audio.sync(game.snapshot());
    const initialSources = sources.length;
    audio.sync(game.snapshot());
    expect(sources).toHaveLength(initialSources);
    audio.stop();
    context.currentTime = 100;
    game.tick(12, true);
    audio.sync(game.snapshot());
    for (const source of sources.slice(initialSources)) {
      const start = source.start.mock.calls[0][0] as number;
      expect(start).toBeGreaterThanOrEqual(100);
      expect(start).toBeLessThanOrEqual(100.12);
    }
    expect(sources.length - initialSources).toBeLessThan(8);
    audio.dispose();
  });

  it("keeps the visual game usable when Web Audio is absent", () => {
    vi.stubGlobal("window", {});
    const audio = createBassAudio();
    expect(() => {
      audio.unlock(); audio.sync(playingGame().snapshot()); audio.pluck(82.4); audio.stop(); audio.dispose();
    }).not.toThrow();
  });
});
