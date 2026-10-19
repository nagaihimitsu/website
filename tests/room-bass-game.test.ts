import { describe, expect, it } from "vitest";
import {
  BASS_CHART, BASS_COUNTDOWN_SECONDS, BASS_DURATION, BASS_GOOD_WINDOW,
  BASS_PICKUP_SECONDS, BASS_PROXIMITY_SECONDS, BASS_PHRASES, BASS_STRINGS, BASS_SONGS,
  type BassDifficulty, createBassGame,
} from "../src/room/bassGame";
import { GARDEN_TRACK, GARDEN_BEAT_TIMES, GARDEN_BASS_NOTES, gardenBeatToTime, gardenTimeToBeat } from "../src/room/gardenTrack";

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

const first = BASS_CHART[0];
const second = BASS_CHART[1];

describe("Garden-Party Groove chart and clock", () => {
  it("uses measured recording beats, including the offset and tempo drift, in both directions", () => {
    expect(gardenBeatToTime(0)).toBe(0.171592);
    expect(gardenBeatToTime(16)).toBe(9.323986);
    expect(gardenBeatToTime(96)).toBe(55.137863);
    expect(GARDEN_TRACK.duration).toBe(56.14);
    expect(gardenBeatToTime(96)).toBeLessThan(GARDEN_TRACK.fadeStart);
    expect(GARDEN_TRACK.fadeStart).toBeLessThan(GARDEN_TRACK.duration);
    for (let index = 0; index < GARDEN_BEAT_TIMES.length; index++) {
      expect(gardenBeatToTime(index)).toBeCloseTo(GARDEN_BEAT_TIMES[index], 8);
      expect(gardenTimeToBeat(GARDEN_BEAT_TIMES[index])).toBeCloseTo(index, 8);
    }
    for (const beat of [-4, -0.5, 0.5, 23.25, 95.75, 104, 105])
      expect(gardenTimeToBeat(gardenBeatToTime(beat))).toBeCloseTo(beat, 8);
    expect(gardenBeatToTime(16) - gardenBeatToTime(0)).not.toBeCloseTo(gardenBeatToTime(96) - gardenBeatToTime(80), 2);
  });

  it("shares the native recording duration and four-beat count-in across all difficulties", () => {
    expect(BASS_STRINGS.map((string) => string.name)).toEqual(["G", "D", "A", "E"]);
    for (const song of Object.values(BASS_SONGS)) {
      expect(song.bpm).toBe(GARDEN_TRACK.bpm);
      expect(song.duration).toBe(GARDEN_TRACK.duration);
      expect(song.countdownSeconds).toBeCloseTo(song.beatSeconds * 4);
      expect(song.chords).toEqual([]); // No unrelated generated chord progression over the recording.
      expect(song.notes.at(-1)!.time).toBeLessThan(GARDEN_TRACK.fadeStart);
      expect(song.phrases.every((phrase) => phrase.prepareAt < phrase.start)).toBe(true);
    }
    expect(BASS_CHART.length).toBeLessThan(BASS_SONGS.normal.notes.length);
    expect(BASS_SONGS.normal.notes.length).toBeLessThan(BASS_SONGS.hard.notes.length);
    expect(BASS_PHRASES.every((phrase) => phrase.mode === "hold")).toBe(true);
    expect(BASS_CHART.every((note) => note.technique === "pick")).toBe(true);
  });

  it("keeps the measured beat frozen during pauses and aligned with the active media position", () => {
    const game = playingGame();
    game.tick(gardenBeatToTime(32.5), true);
    expect(game.snapshot().beat).toBeCloseTo(32.5, 8);
    const paused = game.tick(600, true, true);
    expect(paused.beat).toBeCloseTo(32.5, 8);
    game.tick(gardenBeatToTime(33) - paused.elapsed, true);
    expect(game.snapshot().beat).toBeCloseTo(33, 8);
  });

  it("uses only measured bass attacks at their native times and octaves, preserving the real rest and ending", () => {
    for (const song of Object.values(BASS_SONGS)) {
      for (const note of song.notes) {
        const midi = BASS_STRINGS[note.string].openMidi + note.fret;
        expect(GARDEN_BASS_NOTES.some((source) => source.time === note.time && source.midi === midi)).toBe(true);
        expect(note.frequency).toBeCloseTo(440 * 2 ** ((midi - 69) / 12), 8);
      }
      expect(song.notes.some((note) => note.time >= 2.9 && note.time <= 9.2)).toBe(false);
      expect(song.notes.at(-1)).toMatchObject({ time: 55.027, string: 2, fret: 5 });
      expect(playingGame(song.difficulty).snapshot().currentPhrase).toMatchObject({ string: song.notes[0].string, fret: song.notes[0].fret });
    }
  });
});

describe("terrace bass game", () => {
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
    expect(game.snapshot()).toMatchObject({ phase: "countdown", countdown: 4, elapsed: 0 });
    expect(game.start()).toBe(false);
    expect(game.pluck(first.string)).toBeNull();
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
    game.tick(first.time, true);
    const paused = game.tick(600, true, true);
    expect(paused.misses).toBe(0);
    expect(game.pluck(first.string)).toBeNull();
    game.tick(0, true);
    expect(game.pluck(first.string)).toMatchObject({ kind: "perfect", noteId: 0 });
    expect(game.snapshot().elapsed).toBe(first.time);
  });

  it("judges the nearest pending note once and charges off-beat and duplicate plucks", () => {
    const game = playingGame();
    game.tick(first.time, true);
    expect(game.pluck(first.string)).toMatchObject({ kind: "perfect", noteId: 0, frequency: first.frequency });
    expect(game.pluck(first.string)).toEqual({ kind: "miss", noteId: null, frequency: null });
    expect(game.snapshot()).toMatchObject({ hits: 1, score: 750, combo: 0, maxCombo: 1, strayPlucks: 1 });
    game.tick(second.time - first.time - 0.13, true);
    expect(game.pluck(second.string)).toMatchObject({ kind: "good", noteId: 1 });
    expect(game.snapshot()).toMatchObject({ hits: 2, score: 1400, combo: 1 });
  });

  it("judges a right-hand input by string and timing with no left contact requirement", () => {
    const game = playingGame();
    expect(game.pluck(first.string)).toEqual({ kind: "miss", frequency: null, noteId: null });
    expect(game.snapshot().notes[0].state).toBe("pending");
    game.tick(first.time, true);
    expect(game.pluck(((first.string + 1) % 4) as typeof first.string)).toEqual({ kind: "miss", frequency: null, noteId: null });
    expect(game.snapshot().notes[0].state).toBe("pending");
    expect(game.pluck(first.string)).toMatchObject({ kind: "perfect", noteId: 0, frequency: first.frequency });
    game.tick(second.time - first.time, true);
    expect(game.pluck(second.string)).toMatchObject({ kind: "perfect", noteId: 1, frequency: second.frequency });
    expect(game.snapshot()).toMatchObject({ hits: 2, combo: 2 });
  });

  it("moves the avatar's prepared fret automatically as the recorded phrase changes", () => {
    const game = playingGame();
    const earlier = BASS_PHRASES.find((phrase) => BASS_PHRASES.some((later) => later.id > phrase.id && later.string === phrase.string && later.fret !== phrase.fret))!;
    const next = BASS_PHRASES.find((phrase) => phrase.id > earlier.id && phrase.string === earlier.string && phrase.fret !== earlier.fret)!;
    expect(earlier).toBeDefined();
    game.tick(Math.max(0, earlier.prepareAt), true);
    expect(game.snapshot().currentPhrase).toMatchObject({ id: earlier.id, string: earlier.string, fret: earlier.fret });
    game.tick(next.prepareAt - game.snapshot().elapsed, true);
    expect(game.snapshot().currentPhrase).toMatchObject({ id: next.id, string: next.string, fret: next.fret });
    game.tick(next.start - game.snapshot().elapsed, true);
    expect(game.pluck(next.string)).toMatchObject({ kind: "perfect", frequency: next.frequency });
  });

  it("prepares the first automatic fret during countdown and resets the score on replay or putting down", () => {
    const game = readyGame();
    game.start();
    expect(game.snapshot().currentPhrase).toMatchObject({ string: first.string, fret: first.fret });
    expect(game.pluck(first.string)).toBeNull();
    game.tick(BASS_COUNTDOWN_SECONDS + first.time, true);
    expect(game.pluck(first.string)?.kind).toBe("perfect");
    game.tick(BASS_DURATION, true);
    expect(game.snapshot().currentPhrase).toBeNull();
    expect(game.start()).toBe(true);
    expect(game.snapshot()).toMatchObject({ hits: 0, score: 0, currentPhrase: { string: first.string, fret: first.fret } });
    game.cancel();
    expect(game.snapshot()).toMatchObject({ phase: "idle", currentPhrase: null, nextPhrase: null, hits: 0, score: 0 });
  });

  it("resolves missed notes and completes after the recording tail without requiring a final input", () => {
    const game = playingGame();
    game.tick(first.time, true);
    game.pluck(first.string);
    game.tick(second.time - first.time + BASS_GOOD_WINDOW + 0.001, true);
    expect(game.snapshot()).toMatchObject({ combo: 0, hits: 1, misses: 1, feedback: "miss" });
    const result = game.tick(BASS_DURATION, true);
    expect(result.phase).toBe("result");
    expect(result.elapsed).toBe(GARDEN_TRACK.duration);
    expect(result.hits + result.misses).toBe(BASS_CHART.length);
    expect(result.notes.some((note) => note.state === "pending")).toBe(false);
    expect(game.pluck(first.string)).toBeNull();
  });

  it("prevents rapid mashing from earning a perfect result", () => {
    const mashing = playingGame();
    for (let frame = 0; frame < BASS_DURATION * 20; frame++) {
      mashing.tick(0.05, true);
      const phrase = mashing.snapshot().currentPhrase;
      if (phrase) {
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

  it("switches difficulty only outside a run, while preserving native recording speed", () => {
    const game = createBassGame();
    expect(game.setDifficulty("hard")).toBe(false);
    game.tick(BASS_PROXIMITY_SECONDS + BASS_PICKUP_SECONDS, true);
    const before = game.snapshot();
    for (const invalid of ["legend", "EASY", "constructor", "__proto__", null]) {
      expect(game.setDifficulty(invalid as BassDifficulty)).toBe(false);
      expect(game.snapshot()).toEqual(before);
    }
    expect(game.setDifficulty("normal")).toBe(true);
    expect(game.snapshot()).toMatchObject({ difficulty: "normal", bpm: GARDEN_TRACK.bpm, duration: GARDEN_TRACK.duration });
    game.start();
    expect(game.setDifficulty("hard")).toBe(false);
    game.tick(BASS_SONGS.normal.countdownSeconds + BASS_SONGS.normal.duration, true);
    expect(game.setDifficulty("hard")).toBe(true);
    expect(game.snapshot()).toMatchObject({ phase: "ready", difficulty: "hard", score: 0, hits: 0, misses: 0, elapsed: 0, bpm: GARDEN_TRACK.bpm });
    expect(game.snapshot().notes).toHaveLength(BASS_SONGS.hard.notes.length);
    expect(game.snapshot().notes.every((note) => note.state === "pending")).toBe(true);
  });

  it.each(["easy", "normal", "hard"] as const)("allows every %s note to be performed perfectly with picking or slap alone", (difficulty) => {
    const game = playingGame(difficulty);
    const song = BASS_SONGS[difficulty];
    for (const note of song.notes) {
      game.tick(note.time - game.snapshot().elapsed, true);
      expect(game.pluck(note.string, note.technique)).toEqual({ kind: "perfect", noteId: note.id, frequency: note.frequency });
    }
    game.tick(song.duration, true);
    expect(game.snapshot()).toMatchObject({ phase: "result", accuracy: 100, hits: song.notes.length,
      combo: song.notes.length, maxCombo: song.notes.length, score: song.notes.length * 1000, misses: 0, strayPlucks: 0 });
  });

  it("plays successive NORMAL accents with right-hand input alone", () => {
    const game = playingGame("normal");
    const song = BASS_SONGS.normal;
    const first = song.notes.find((note, index) => {
      const next = song.notes[index + 1];
      return next && next.phraseId !== note.phraseId && song.phrases[next.phraseId].mode === "tap" &&
        next.string === note.string && next.fret === note.fret;
    })!;
    expect(first).toBeDefined();
    const next = song.notes[first.id + 1];
    game.tick(first.time, true);
    expect(game.pluck(first.string, first.technique)?.kind).toBe("perfect");
    game.tick(next.time - first.time, true);
    expect(game.snapshot().currentPhrase).toMatchObject({ id: next.phraseId, string: next.string, fret: next.fret });
    expect(game.pluck(next.string, next.technique)).toMatchObject({ kind: "perfect", noteId: next.id });
    expect(game.snapshot()).toMatchObject({ hits: 2, combo: 2 });
  });

  it("selects the nearest scheduled note before checking technique, without skipping ahead", () => {
    const game = playingGame("hard");
    const song = BASS_SONGS.hard;
    const pick = song.notes.find((note, index) => {
      const next = song.notes[index + 1];
      return note.technique === "pick" && next?.technique === "slap" && next.string === note.string &&
        next.fret === note.fret && next.time - note.time < BASS_GOOD_WINDOW * 2;
    })!;
    expect(pick).toBeDefined();
    const slap = song.notes[pick.id + 1];
    const between = (pick.time + slap.time) / 2 - 0.01;
    game.tick(between, true);
    expect(game.pluck(pick.string, "slap")).toEqual({ kind: "miss", frequency: null, noteId: null });
    expect(game.snapshot().notes.slice(pick.id, slap.id + 1).map((note) => note.state)).toEqual(["pending", "pending"]);
    expect(game.pluck(pick.string, "pick")).toMatchObject({ kind: "good", noteId: pick.id });
    game.tick(slap.time - game.snapshot().elapsed, true);
    expect(game.pluck(slap.string, "pick")?.frequency).toBeNull();
    expect(game.pluck(slap.string, "slap")).toMatchObject({ kind: "perfect", noteId: slap.id });
    expect(game.snapshot().hits).toBe(2);
  });

  it("keeps single-note charts playable with preparation time, slap recovery and overtaking", () => {
    for (const song of Object.values(BASS_SONGS)) {
      for (let index = 0; index < song.notes.length; index++) {
        const note = song.notes[index], next = song.notes[index + 1];
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
        expect(song.notes.some((slap, index) => {
          const pick = song.notes[index + 1];
          return slap.technique === "slap" && pick?.technique === "pick" &&
            slap.time - slap.travelSeconds > pick.time - pick.travelSeconds;
        })).toBe(true);
      }
    }
  });
});
