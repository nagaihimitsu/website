import { afterEach, describe, expect, it, vi } from "vitest";
import { createBassAudio } from "../src/room/bassAudio";
import {
  BASS_CHART, BASS_COUNTDOWN_SECONDS, BASS_DURATION, BASS_GOOD_WINDOW,
  BASS_PICKUP_SECONDS, BASS_PROXIMITY_SECONDS, BASS_PHRASES, BASS_STRINGS, BASS_BEAT_SECONDS, BASS_SONGS,
  type BassDifficulty, createBassGame,
} from "../src/room/bassGame";

function readyGame() {
  const game = createBassGame();
  game.tick(BASS_PROXIMITY_SECONDS, true);
  game.tick(BASS_PICKUP_SECONDS, true);
  return game;
}

function playingGame(difficulty: BassDifficulty = "easy") {
  const game = readyGame();
  game.setDifficulty(difficulty);
  game.start();
  game.tick(BASS_SONGS[difficulty].countdownSeconds, true);
  return game;
}

describe("terrace bass game", () => {
  it("provides four matching string rows and six steady eight-beat phrases with preparation rests", () => {
    expect(BASS_STRINGS.map((string) => string.name)).toEqual(["G", "D", "A", "E"]);
    expect(BASS_DURATION).toBeGreaterThanOrEqual(30);
    expect(BASS_DURATION).toBeLessThanOrEqual(40);
    expect(BASS_CHART).toHaveLength(84);
    expect(BASS_PHRASES.map((phrase) => [phrase.string, phrase.fret])).toEqual([[3, 3], [2, 3], [1, 2], [0, 2], [2, 5], [3, 3]]);
    for (const phrase of BASS_PHRASES) {
      const notes = BASS_CHART.filter((note) => note.phraseId === phrase.id);
      expect(notes).toHaveLength(14);
      expect(new Set(notes.map((note) => `${note.string}:${note.fret}:${note.frequency}`)).size).toBe(1);
      for (let index = 1; index < notes.length; index++)
        expect(notes[index].time - notes[index - 1].time).toBeCloseTo(BASS_BEAT_SECONDS / 2);
      if (phrase.id > 0) {
        const previous = BASS_PHRASES[phrase.id - 1];
        expect(phrase.start - previous.end).toBeGreaterThan(0.9);
        expect(phrase.prepareAt).toBeGreaterThan(previous.end + BASS_GOOD_WINDOW);
        expect(phrase.start - phrase.prepareAt).toBeGreaterThan(0.7);
        expect(phrase.previewAt).toBeLessThan(phrase.prepareAt - 1);
      }
    }
  });

  it("requires exactly three continuous nearby seconds and removes all progress on leaving", () => {
    const game = createBassGame();
    expect(game.start()).toBe(false);
    expect(game.tick(2.7, true).proximityProgress).toBe(0.9);
    expect(game.tick(0, false)).toMatchObject({ phase: "idle", proximityProgress: 0 });
    expect(game.tick(2.99, true).phase).toBe("approaching");
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
    expect(game.pluck(3)).toBeNull();
    const snapshot = game.tick(BASS_COUNTDOWN_SECONDS + 0.125, true);
    expect(snapshot).toMatchObject({ phase: "playing", countdown: 0, elapsed: 0.125 });
  });

  it("freezes pickup, countdown, notes and input throughout pauses, without catch-up misses", () => {
    const game = createBassGame();
    game.tick(2.4, true);
    expect(game.tick(60, true, true).proximityProgress).toBeCloseTo(0.8);
    game.tick(0.6 + BASS_PICKUP_SECONDS, true);
    game.start();
    const countdown = game.tick(0.4, true);
    expect(game.tick(300, true, true)).toEqual(countdown);
    game.tick(countdown.countdownRemaining, true);
    game.tick(BASS_CHART[0].time, true);
    game.hold(3, 3);
    const paused = game.tick(600, true, true);
    expect(paused.misses).toBe(0);
    expect(paused.heldFrets).toEqual([null, null, null, null]);
    expect(game.pluck(3)).toBeNull();
    expect(game.hold(3, 3)).toBe(false);
    game.tick(0, true);
    expect(game.pluck(3)?.frequency).toBeNull();
    game.hold(3, 3);
    expect(game.pluck(3)).toMatchObject({ kind: "perfect", noteId: 0 });
    expect(game.snapshot().elapsed).toBe(BASS_CHART[0].time);
  });

  it("judges the nearest pending note once and charges off-beat and duplicate plucks", () => {
    const game = playingGame();
    game.hold(3, 3);
    game.tick(BASS_CHART[0].time, true);
    expect(game.pluck(3)).toMatchObject({ kind: "perfect", noteId: 0, frequency: BASS_CHART[0].frequency });
    expect(game.pluck(3)).toEqual({ kind: "miss", noteId: null, frequency: null });
    expect(game.snapshot()).toMatchObject({ hits: 1, score: 750, combo: 0, maxCombo: 1, strayPlucks: 1 });
    game.tick(BASS_CHART[1].time - BASS_CHART[0].time - 0.13, true);
    expect(game.pluck(3)).toMatchObject({ kind: "good", noteId: 1 });
    expect(game.snapshot()).toMatchObject({ hits: 2, score: 1400, combo: 1 });
  });

  it("requires actual matching left contact at each right pluck, without tap-latching", () => {
    const game = playingGame();
    game.tick(BASS_CHART[0].time, true);
    expect(game.pluck(3)).toEqual({ kind: "miss", frequency: null, noteId: null });
    expect(game.hold(3, 2)).toBe(false);
    expect(game.pluck(3)?.frequency).toBeNull();
    expect(game.hold(3, 3)).toBe(true);
    expect(game.snapshot()).toMatchObject({ hits: 0, combo: 0, heldFrets: [null, null, null, 3] });
    expect(game.pluck(2)?.frequency).toBeNull();
    expect(game.snapshot().notes[0].state).toBe("pending");
    expect(game.pluck(3)).toMatchObject({ kind: "perfect", noteId: 0 });
    game.release(3);
    game.tick(BASS_BEAT_SECONDS / 2, true);
    expect(game.pluck(3)?.frequency).toBeNull();
    expect(game.snapshot().hits).toBe(1);
    game.hold(3, 3);
    expect(game.pluck(3)).toMatchObject({ kind: "perfect", noteId: 1 });
    game.tick(BASS_BEAT_SECONDS / 2, true);
    expect(game.pluck(3)).toMatchObject({ kind: "perfect", noteId: 2 });
    expect(game.snapshot().heldFrets[3]).toBe(3);
  });

  it("previews new fret positions but never moves an existing held contact to the new fret", () => {
    const game = playingGame();
    const firstA = BASS_PHRASES[1];
    const nextA = BASS_PHRASES[4];
    game.tick(firstA.prepareAt, true);
    expect(game.hold(2, 3)).toBe(true);
    game.tick(nextA.previewAt - game.snapshot().elapsed, true);
    expect(game.snapshot().nextPhrase?.id).toBe(nextA.id);
    expect(game.snapshot().leftGuides[2]).toMatchObject({ fret: 3, heldFret: 3, nextFret: 5 });
    game.tick(nextA.prepareAt - game.snapshot().elapsed, true);
    expect(game.snapshot().leftGuides[2]).toMatchObject({ fret: 5, heldFret: 3, required: true });
    expect(game.hold(2, 5)).toBe(false);
    game.tick(nextA.start - game.snapshot().elapsed, true);
    expect(game.pluck(2)?.frequency).toBeNull();
    game.release(2);
    expect(game.hold(2, 5)).toBe(true);
    expect(game.pluck(2)).toMatchObject({ kind: "perfect", frequency: nextA.frequency });
  });

  it("prepares the first phrase during countdown and clears contacts on replay or putting down", () => {
    const game = readyGame();
    expect(game.hold(3, 3)).toBe(false);
    game.start();
    expect(game.hold(3, 3)).toBe(true);
    expect(game.pluck(3)).toBeNull();
    game.tick(BASS_COUNTDOWN_SECONDS + BASS_CHART[0].time, true);
    expect(game.pluck(3)?.kind).toBe("perfect");
    game.tick(BASS_DURATION, true);
    expect(game.snapshot().heldFrets.every((fret) => fret === null)).toBe(true);
    game.start();
    game.hold(3, 3);
    game.cancel();
    expect(game.snapshot().heldFrets.every((fret) => fret === null)).toBe(true);
  });

  it("resolves missed notes and completes without requiring a final input", () => {
    const game = playingGame();
    game.hold(3, 3);
    game.tick(BASS_CHART[0].time, true);
    game.pluck(3);
    game.tick(BASS_CHART[1].time - BASS_CHART[0].time + BASS_GOOD_WINDOW + 0.001, true);
    expect(game.snapshot()).toMatchObject({ combo: 0, hits: 1, misses: 1, feedback: "miss" });
    const result = game.tick(BASS_DURATION, true);
    expect(result.phase).toBe("result");
    expect(result.elapsed).toBe(BASS_DURATION);
    expect(result.hits + result.misses).toBe(BASS_CHART.length);
    expect(result.notes.some((note) => note.state === "pending")).toBe(false);
    expect(game.pluck(3)).toBeNull();
  });

  it("rewards the original phrase and prevents rapid mashing from earning a perfect result", () => {
    const precise = playingGame();
    for (const note of BASS_CHART) {
      precise.tick(note.time - precise.snapshot().elapsed, true);
      if (precise.snapshot().heldFrets[note.string] !== note.fret) {
        precise.releaseAll();
        precise.hold(note.string, note.fret);
      }
      precise.pluck(note.string);
    }
    precise.tick(BASS_DURATION, true);
    expect(precise.snapshot()).toMatchObject({ accuracy: 100, combo: BASS_CHART.length, misses: 0 });
    const mashing = playingGame();
    for (let frame = 0; frame < BASS_DURATION * 20; frame++) {
      mashing.tick(0.05, true);
      const phrase = mashing.snapshot().currentPhrase;
      if (phrase) {
        mashing.releaseAll();
        mashing.hold(phrase.string, phrase.fret);
        mashing.pluck(phrase.string);
      }
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
    expect(game.tick(2.9, true).phase).toBe("approaching");
  });

  it("ignores invalid time and does not expose mutable scoring state through snapshots", () => {
    const game = playingGame();
    const before = game.snapshot();
    expect(game.tick(Infinity, true)).toEqual(before);
    expect(game.tick(-10, true)).toEqual(before);
    before.notes[0].state = "perfect";
    expect(game.snapshot().notes[0].state).toBe("pending");
  });

  it("switches difficulty only before a run or after a result, safely resetting selected-song state", () => {
    const game = createBassGame();
    expect(game.setDifficulty("hard")).toBe(false);
    game.tick(BASS_PROXIMITY_SECONDS + BASS_PICKUP_SECONDS, true);
    const before = game.snapshot();
    for (const invalid of ["legend", "EASY", "constructor", "__proto__", null]) {
      expect(game.setDifficulty(invalid as BassDifficulty)).toBe(false);
      expect(game.snapshot()).toEqual(before);
    }
    expect(game.setDifficulty("normal")).toBe(true);
    expect(game.snapshot()).toMatchObject({ difficulty: "normal", bpm: 104, beatSeconds: 60 / 104, duration: 37.5 });
    game.start();
    expect(game.setDifficulty("hard")).toBe(false);
    game.tick(BASS_SONGS.normal.countdownSeconds + BASS_SONGS.normal.duration, true);
    expect(game.snapshot().phase).toBe("result");
    expect(game.setDifficulty("hard")).toBe(true);
    expect(game.snapshot()).toMatchObject({ phase: "ready", difficulty: "hard", score: 0, hits: 0, misses: 0, elapsed: 0, bpm: 120 });
    expect(game.snapshot().notes).toHaveLength(BASS_SONGS.hard.notes.length);
    expect(game.snapshot().notes.every((note) => note.state === "pending")).toBe(true);
  });

  it.each(["easy", "normal", "hard"] as const)("allows every %s note to be performed perfectly with its actual left contact and technique", (difficulty) => {
    const game = playingGame(difficulty);
    const song = BASS_SONGS[difficulty];
    let lastPhrase: number | null = null;
    for (const note of song.notes) {
      game.tick(note.time - game.snapshot().elapsed, true);
      if (note.phraseId !== lastPhrase) {
        game.releaseAll();
        expect(game.hold(note.string, note.fret)).toBe(true);
        lastPhrase = note.phraseId;
      }
      expect(game.pluck(note.string, note.technique)).toEqual({ kind: "perfect", noteId: note.id, frequency: note.frequency });
    }
    game.tick(song.duration, true);
    expect(game.snapshot()).toMatchObject({ phase: "result", accuracy: 100, hits: song.notes.length,
      combo: song.notes.length, maxCombo: song.notes.length, score: song.notes.length * 1000, misses: 0, strayPlucks: 0 });
  });

  it("requires a fresh contact for the next tap phrase, while keeping release/repress recovery possible", () => {
    const game = playingGame("normal");
    const song = BASS_SONGS.normal;
    const first = song.notes.find((note) => song.phrases[note.phraseId].mode === "tap")!;
    const next = song.notes[first.id + 1];
    expect(next.string).toBe(first.string);
    expect(next.fret).toBe(first.fret);
    game.tick(first.time, true);
    game.hold(first.string, first.fret);
    expect(game.pluck(first.string, first.technique)?.kind).toBe("perfect");
    game.tick(next.time - first.time, true);
    expect(game.snapshot().leftGuides[next.string].needsRepress).toBe(true);
    expect(game.snapshot().heldFrets[next.string]).toBe(next.fret);
    game.hold(next.string, next.fret); // A repeated down does not replace a living contact.
    expect(game.pluck(next.string, next.technique)?.frequency).toBeNull();
    expect(game.snapshot().notes[next.id].state).toBe("pending");
    game.release(next.string);
    expect(game.hold(next.string, next.fret)).toBe(true);
    expect(game.snapshot().leftGuides[next.string].needsRepress).toBe(false);
    expect(game.pluck(next.string, next.technique)).toMatchObject({ kind: "perfect", noteId: next.id });
  });

  it("selects the nearest scheduled note before checking technique, without skipping to a matching later slap", () => {
    const game = playingGame("hard");
    const [pick, slap] = BASS_SONGS.hard.notes;
    expect(pick.technique).toBe("pick");
    expect(slap.technique).toBe("slap");
    const between = pick.time + 0.11;
    expect(slap.time - between).toBeLessThan(BASS_GOOD_WINDOW);
    game.tick(between, true);
    game.hold(pick.string, pick.fret);
    expect(game.pluck(pick.string, "slap")).toEqual({ kind: "miss", frequency: null, noteId: null });
    expect(game.snapshot().notes.slice(0, 2).map((note) => note.state)).toEqual(["pending", "pending"]);
    expect(game.pluck(pick.string, "pick")).toMatchObject({ kind: "good", noteId: pick.id });
    game.tick(slap.time - game.snapshot().elapsed, true);
    expect(game.pluck(slap.string, "pick")?.frequency).toBeNull();
    expect(game.pluck(slap.string, "slap")).toMatchObject({ kind: "perfect", noteId: slap.id });
    expect(game.snapshot().hits).toBe(2);
  });

  it("keeps all songs single-note playable with advance guides, safe slap recovery and real overtaking", () => {
    for (const song of Object.values(BASS_SONGS)) {
      expect(song.duration).toBeGreaterThanOrEqual(30);
      expect(song.duration).toBeLessThanOrEqual(45);
      for (let index = 0; index < song.notes.length; index++) {
        const note = song.notes[index], next = song.notes[index + 1];
        expect([2, 3, 5]).toContain(note.fret);
        if (next) {
          expect(next.time - note.time).toBeGreaterThanOrEqual(0.2);
          if (note.technique === "slap") expect(next.time - note.time).toBeGreaterThanOrEqual(0.26);
          if (note.string !== next.string || note.fret !== next.fret)
            expect(next.time - song.phrases[next.phraseId].prepareAt).toBeGreaterThanOrEqual(0.4);
        }
      }
      for (const phrase of song.phrases) {
        expect(phrase.prepareAt).toBeLessThan(phrase.start);
        expect(phrase.previewAt).toBeLessThanOrEqual(phrase.start - 1);
      }
      if (song.difficulty !== "easy") {
        const pair = song.notes.flatMap((slap, index) => {
          const pick = song.notes[index + 1];
          return slap.technique === "slap" && pick?.technique === "pick" &&
            slap.time - slap.travelSeconds > pick.time - pick.travelSeconds ? [[slap, pick]] : [];
        })[0];
        expect(pair).toBeDefined();
        const [slap, pick] = pair;
        expect(slap.time).toBeLessThan(pick.time);
        expect(slap.time - slap.travelSeconds).toBeGreaterThan(pick.time - pick.travelSeconds);
      }
    }
    expect(BASS_SONGS.normal.swing).toBeGreaterThan(0.5);
    expect(BASS_SONGS.hard.phrases.filter((phrase) => phrase.mode === "tap").length).toBeGreaterThan(20);
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

  it("resumes an interrupted Safari audio context on the next explicit gesture", () => {
    const { context, sources } = installAudio();
    const audio = createBassAudio();
    const game = playingGame();
    audio.unlock();
    context.state = "interrupted";
    audio.sync(game.snapshot());
    expect(context.resume).not.toHaveBeenCalled();
    expect(sources).toHaveLength(0);
    context.resume.mockImplementation(async () => { context.state = "running"; });
    audio.unlock();
    expect(context.resume).toHaveBeenCalledTimes(1);
    audio.sync(game.snapshot());
    expect(sources.length).toBeGreaterThan(0);
    audio.dispose();
  });

  it("sounds only right-hand notes and preserves their natural decay when the left contact releases", () => {
    const { sources } = installAudio();
    const game = playingGame();
    const audio = createBassAudio();
    audio.unlock();
    game.tick(BASS_CHART[0].time, true);
    audio.sync(game.snapshot());
    const backingCount = sources.length;
    game.hold(3, 3);
    audio.sync(game.snapshot());
    expect(sources).toHaveLength(backingCount);
    const hit = game.pluck(3)!;
    audio.pluck(hit.frequency);
    expect(sources.length).toBeGreaterThan(backingCount);
    const voiceCount = sources.length;
    const scheduledStops = sources.map((source) => source.stop.mock.calls.length);
    game.release(3);
    audio.sync(game.snapshot());
    expect(sources).toHaveLength(voiceCount);
    expect(sources.map((source) => source.stop.mock.calls.length)).toEqual(scheduledStops);
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
