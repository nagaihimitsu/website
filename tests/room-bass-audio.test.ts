import { afterEach, describe, expect, it, vi } from "vitest";
import { createBassAudio } from "../src/room/bassAudio";
import { BASS_SONGS, createBassGame, type BassDifficulty, type BassGameSnapshot } from "../src/room/bassGame";

function installAudio() {
  const parameter = () => ({
    value: 0, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn(),
  });
  const node = () => ({
    connect: vi.fn(function (this: unknown, destination: unknown) { return destination; }), disconnect: vi.fn(),
  });
  const sources: ReturnType<typeof source>[] = [];
  const processing: ReturnType<typeof node>[] = [];
  function source(kind: "tone" | "noise") {
    return { ...node(), kind, type: "sine", frequency: parameter(), start: vi.fn(), stop: vi.fn(), onended: null };
  }
  const context = {
    state: "running", currentTime: 10, sampleRate: 8000, destination: node(),
    createGain: () => {
      const gain = { ...node(), gain: parameter() };
      processing.push(gain);
      return gain;
    },
    createBuffer: (_channels: number, length: number) => ({ getChannelData: () => new Float32Array(length) }),
    createBiquadFilter: () => {
      const filter = { ...node(), frequency: parameter() };
      processing.push(filter);
      return filter;
    },
    createOscillator: () => { const voice = source("tone"); sources.push(voice); return voice; },
    createBufferSource: () => { const voice = source("noise"); sources.push(voice); return voice; },
    resume: vi.fn(async () => undefined), close: vi.fn(async () => undefined),
  };
  vi.stubGlobal("window", { AudioContext: vi.fn(function () { return context; }) });
  return { context, sources, processing };
}

function playing(difficulty: BassDifficulty, elapsed = 0): BassGameSnapshot {
  const song = BASS_SONGS[difficulty];
  return { ...createBassGame().snapshot(), difficulty, bpm: song.bpm, beatSeconds: song.beatSeconds,
    phase: "playing", elapsed, duration: song.duration };
}

describe("difficulty-specific bass sound", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("gives a slap a faster transient and higher harmonics without changing the bass pitch", () => {
    const { sources } = installAudio();
    const audio = createBassAudio();
    audio.unlock();
    audio.pluck(82.4, "pick");
    const picked = [...sources];
    audio.pluck(82.4, "slap");
    const slapped = sources.slice(picked.length);
    const frequencies = (voices: typeof sources) => voices.filter((voice) => voice.kind === "tone")
      .map((voice) => voice.frequency.setValueAtTime.mock.calls[0][0] as number);
    expect(frequencies(picked)[0]).toBe(82.4);
    expect(frequencies(slapped)[0]).toBe(82.4);
    expect(Math.max(...frequencies(slapped))).toBeGreaterThan(Math.max(...frequencies(picked)));
    const attack = (voice: typeof sources[number]) => {
      const gain = voice.connect.mock.calls[0][0] as { gain: ReturnType<typeof parameterShape> };
      return gain.gain.linearRampToValueAtTime.mock.calls[0][1] as number;
    };
    expect(attack(slapped[0])).toBeLessThan(attack(picked[0]));
    expect(slapped.some((voice) => voice.kind === "noise")).toBe(true);
    audio.dispose();
  });

  it.each(["easy", "normal", "hard"] as const)("follows the %s song tempo and shuffle instead of the EASY clock", (difficulty) => {
    const { context, sources } = installAudio();
    const audio = createBassAudio();
    audio.unlock();
    const song = BASS_SONGS[difficulty];
    // Small real-time-sized updates expose scheduled audio times rather than
    // inspecting the event table used by the implementation.
    for (let elapsed = 0; elapsed <= song.beatSeconds * 2; elapsed += 0.02) {
      context.currentTime = 10 + elapsed;
      audio.sync(playing(difficulty, elapsed));
    }
    const hatStarts = sources.filter((voice) => {
      if (voice.kind !== "noise") return false;
      const filter = voice.connect.mock.calls[0][0] as { frequency: ReturnType<typeof parameterShape> };
      return filter.frequency.setValueAtTime.mock.calls[0][0] === 6800;
    }).map((voice) => voice.start.mock.calls[0][0] as number);
    for (const beat of [0, song.swing, 1, 1 + song.swing])
      expect(hatStarts.some((start) => Math.abs(start - (10 + beat * song.beatSeconds)) < 1e-8)).toBe(true);
    if (difficulty === "normal")
      expect(hatStarts.some((start) => Math.abs(start - (10 + song.beatSeconds / 2)) < 0.02)).toBe(false);
    // The accompaniment's oscillators are percussion or upper-register chords;
    // it never schedules the player's bass melody without a pluck gesture.
    const pitches = sources.filter((voice) => voice.kind === "tone")
      .map((voice) => voice.frequency.setValueAtTime.mock.calls[0][0] as number);
    expect(pitches.every((pitch) => pitch === 115 || pitch === 165 || pitch >= 180)).toBe(true);
    audio.dispose();
  });

  it("cancels old-mode and replay voices, including their filters and gains, without duplicated scheduling", () => {
    const { context, sources, processing } = installAudio();
    const audio = createBassAudio();
    audio.unlock();
    audio.sync(playing("easy"));
    const oldSources = [...sources];
    const oldProcessing = processing.slice(1); // master remains connected until disposal.
    context.currentTime = 30;
    audio.sync(playing("normal"));
    for (const voice of oldSources) {
      expect(voice.stop).toHaveBeenCalledWith();
      expect(voice.disconnect).toHaveBeenCalled();
    }
    for (const node of oldProcessing) expect(node.disconnect).toHaveBeenCalled();
    const count = sources.length;
    audio.sync(playing("normal"));
    expect(sources).toHaveLength(count);
    audio.sync(playing("normal", 8));
    const beforeReplay = [...sources];
    context.currentTime = 40;
    audio.sync(playing("normal"));
    for (const voice of beforeReplay) expect(voice.stop).toHaveBeenCalledWith();
    for (const voice of sources.slice(beforeReplay.length)) {
      const start = voice.start.mock.calls[0][0] as number;
      expect(start).toBeGreaterThanOrEqual(40);
      expect(start).toBeLessThanOrEqual(40.12);
    }
    audio.sync(playing("hard"), true);
    for (const voice of sources) expect(voice.stop).toHaveBeenCalledWith();
    audio.dispose();
    expect(processing[0].disconnect).toHaveBeenCalled();
    const finalCount = sources.length;
    audio.sync(playing("hard"));
    audio.pluck(82.4, "slap");
    expect(sources).toHaveLength(finalCount);
  });
});

// Shared structural shape for the recorded AudioParam calls above.
function parameterShape() {
  return { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() };
}
