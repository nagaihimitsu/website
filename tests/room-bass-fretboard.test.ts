import { describe, expect, it } from "vitest";
import { BASS_FRETBOARD, bassPositionsForMidi, bassPitch, midiFrequency } from "../src/room/bassFretboard";
import { BASS_SONGS, createBassGame, type BassNote } from "../src/room/bassGame";
import { createBassContacts, type BassPointerInput } from "../src/room/bassInput";
import { chargeProgress, nextCharge, timelineX } from "../src/room/bassVisuals";

const note = (id: number, time: number, midi = 33, kind: BassNote["kind"] = "tap", endTime?: number): BassNote => ({
  id, time, midi, kind, endTime, string: 2, fret: 0, frequency: midiFrequency(midi), phraseId: 0,
  technique: kind === "slap" ? "slap" : "pick", travelSeconds: 1.2,
});
function playing(chart: BassNote[]) {
  const game = createBassGame(chart);
  game.tick(4.1, true);
  game.start();
  game.tick(BASS_SONGS.easy.countdownSeconds, true);
  return game;
}
const pointer = (id: number, x = 0, y = 0, time = 0): BassPointerInput => ({ id, x, y, time, action: "down", midi: 33, string: 2, fret: 0 });

describe("24-position bass fretboard", () => {
  it("generates all labels, native MIDI pitches and octave colors in row order", () => {
    expect(BASS_FRETBOARD).toHaveLength(24);
    expect(BASS_FRETBOARD.map(cell => cell.name).join(" ")).toBe("G G# A A# B C D D# E F F# G A A# B C C# D E F F# G G# A");
    for (let row = 0; row < 4; row++) for (let fret = 0; fret < 6; fret++) {
      const cell = BASS_FRETBOARD[row * 6 + fret];
      expect(cell).toMatchObject({ string: row, fret, midi: [43, 38, 33, 28][row] + fret });
      expect(cell.color).toBe(cell.midi < 40 ? "blue" : "red");
    }
    expect(bassPositionsForMidi(33).map(cell => [cell.string, cell.fret])).toEqual([[2, 0], [3, 5]]);
    expect(bassPositionsForMidi(38)).toHaveLength(2);
    expect(bassPositionsForMidi(43)).toHaveLength(2);
    expect(bassPitch(33)).toMatchObject({ name: "A", octave: 1, color: "blue" });
    expect(bassPitch(45)).toMatchObject({ name: "A", octave: 2, color: "red" });
  });
  it("preserves every old chart's known string/fret pitch, native attack and unique ID", () => {
    for (const song of Object.values(BASS_SONGS)) {
      expect(new Set(song.notes.map(n => n.id)).size).toBe(song.notes.length);
      for (const n of song.notes) {
        expect(BASS_FRETBOARD[n.string * 6 + n.fret].midi).toBe(n.midi);
        expect(n.frequency).toBeCloseTo(midiFrequency(n.midi));
        if (n.kind === "hold") {
          expect(n.endTime).toBeGreaterThan(n.time);
          expect(n.endTime).toBeLessThan(song.notes[n.id + 1]?.time ?? song.duration);
        }
      }
    }
    expect(BASS_SONGS.normal.notes.some(n => n.kind === "hold")).toBe(true);
    expect(BASS_SONGS.normal.notes.some(n => n.kind === "slap")).toBe(true);
  });
});

describe("one pitch input, one chart event", () => {
  it.each([2, 3, 4, 8])("plays %i sixteenth-note attacks at 120 BPM with alternating equivalent positions", count => {
    const game = playing(Array.from({ length: count }, (_, id) => note(id, 1 + id * 0.125)));
    for (let id = 0; id < count; id++) {
      game.tick(1 + id * 0.125 - game.snapshot().elapsed, true);
      const cell = bassPositionsForMidi(33)[id % 2];
      expect(game.beginInput(id, cell.midi)?.noteId).toBe(id);
      game.endInput(id);
      expect(game.snapshot().hits).toBe(id + 1);
      expect(nextCharge(game.snapshot().notes, 33)?.id).toBe(id + 1 < count ? id + 1 : undefined);
    }
    expect(game.snapshot()).toMatchObject({ score: count * 1000, combo: count, misses: 0, strayPlucks: 0 });
  });
  it("does not consume a correct or later note on a wrong octave or duplicate contact", () => {
    const game = playing([note(0, 1), note(1, 1.125)]);
    game.tick(1, true);
    game.beginInput(1, 45);
    expect(game.snapshot().notes.map(n => n.state)).toEqual(["pending", "pending"]);
    game.beginInput(2, 33);
    expect(game.beginInput(2, 33)).toBeNull();
    expect(game.snapshot().hits).toBe(1);
    expect(game.snapshot().notes[1].state).toBe("pending");
  });
  it("advances a missed pulse without hiding the following attack", () => {
    const game = playing([note(0, 1), note(1, 1.25)]);
    game.tick(1.181, true);
    expect(nextCharge(game.snapshot().notes, 33)?.id).toBe(1);
    game.tick(0.069, true);
    game.beginInput(1, 33);
    expect(game.snapshot()).toMatchObject({ hits: 1, misses: 1, combo: 1 });
  });
  it.each([[0, "perfect", 1000], [0.06, "great", 850], [0.12, "good", 650], [0.16, "bad", 250]] as const)("grades an offset of %f without changing the 180ms outer window", (offset, state, score) => {
    const game = playing([note(0, 1)]);
    game.tick(1 + offset, true);
    game.beginInput(0, 33);
    expect(game.snapshot()).toMatchObject({ score, feedback: state });
  });
  it("uses captured input time, independently of the last drawn frame", () => {
    const game = playing([note(0, 1)]);
    game.tick(1.1, true);
    game.beginInput(0, 33, 1.001);
    expect(game.snapshot().feedback).toBe("perfect");
  });
  it("judges hold start and release, then accepts fast tap/slap transitions", () => {
    const game = playing([note(0, 1, 33, "hold", 1.8), note(1, 1.925, 38, "slap"), note(2, 2.05), note(3, 2.175, 38)]);
    game.tick(1, true); game.beginInput(0, 33);
    expect(game.snapshot()).toMatchObject({ hits: 0, combo: 0 });
    expect(game.snapshot().notes[0].state).toBe("holding");
    game.tick(0.8, true); game.endInput(0);
    game.tick(0.125, true); game.beginInput(1, 38);
    expect(game.slapInput(1)).toBe(true);
    expect(game.slapInput(1)).toBe(false);
    game.endInput(1);
    game.tick(0.125, true); game.beginInput(2, 33); game.endInput(2);
    game.tick(0.125, true); game.beginInput(3, 38); game.endInput(3);
    expect(game.snapshot()).toMatchObject({ hits: 4, combo: 4, score: 4000 });
  });
  it("misses early releases and absent flicks, and releases cancelled holds", () => {
    const game = playing([note(0, 1, 33, "hold", 1.8), note(1, 2, 38, "slap")]);
    game.tick(1, true); game.beginInput(0, 33); game.endInput(0, true);
    game.tick(1, true); game.beginInput(1, 38); game.endInput(1);
    expect(game.snapshot()).toMatchObject({ misses: 2, hits: 0, combo: 0 });
  });
  it("reserves a slap through the gesture interval and never gives an extra tap", () => {
    const game = playing([note(0, 1, 33, "slap"), note(1, 1.125)]);
    game.tick(1, true); game.beginInput(0, 33);
    game.tick(0.2, true);
    expect(game.snapshot().notes[0].state).toBe("pending");
    expect(game.slapInput(0)).toBe(true);
    game.endInput(0);
    expect(game.snapshot().hits).toBe(1);
    expect(game.snapshot().notes[1].state).toBe("pending");
  });
  it("freezes hold and timeline on pause and allows recatching the hold on resume", () => {
    const game = playing([note(0, 1, 33, "hold", 2)]);
    game.tick(1, true); game.beginInput(0, 33); game.suspendInputs();
    const before = game.snapshot();
    expect(game.tick(60, true, true)).toEqual(before);
    expect(game.beginInput(1, 33)).toBeNull();
    game.tick(0, true); game.beginInput(1, 33);
    game.tick(1, true); game.endInput(1);
    expect(game.snapshot()).toMatchObject({ hits: 1, misses: 0 });
  });
});

describe("independent captured contacts", () => {
  it("keeps origins, pitch, deltas, timing, single flick and release for multi-touch", () => {
    const contacts = createBassContacts();
    const first = contacts.begin(pointer(1), 1)!;
    contacts.begin({ ...pointer(2), midi: 38 }, 1.01);
    expect(contacts.begin(pointer(1), 1)).toBeNull();
    expect(contacts.move({ ...pointer(1, 2, -30, 90), midi: 45 })).toBe(true);
    expect(first).toMatchObject({ midi: 33, songTime: 1, dx: 2, dy: -30, duration: 90 });
    expect(contacts.move(pointer(1, 5, -60, 120))).toBe(false);
    expect(contacts.end(pointer(1), 1.2)?.endTime).toBe(1.2);
    expect(contacts.size).toBe(1);
    contacts.clear(); expect(contacts.size).toBe(0);
  });
  it("rejects sideways and slow flicks", () => {
    const contacts = createBassContacts();
    contacts.begin(pointer(1), 0);
    expect(contacts.move(pointer(1, 40, -25, 50))).toBe(false);
    expect(contacts.move(pointer(1, 0, -50, 300))).toBe(false);
  });
});

describe("timeline and charge share chart seconds", () => {
  it("keeps temporal distances, judgement position, hold length and repeated IDs", () => {
    expect(timelineX(1, 1)).toBe(32);
    expect(timelineX(1.125, 1) - timelineX(1, 1)).toBe(25);
    expect(timelineX(2, 1) - timelineX(1, 1)).toBe(200);
    expect(timelineX(1, 2)).toBe(-168); // Absolute clock also supports seeking backward.
    expect(timelineX(1, 0.5)).toBe(132);
    expect(chargeProgress(1, -0.2)).toBe(0);
    expect(chargeProgress(1, 0.4)).toBeCloseTo(0.5);
    expect(chargeProgress(1, 1)).toBe(1);
    expect(chargeProgress(1, 1.18)).toBe(1);
  });
});


describe("complete direct-input chart regression", () => {
  it.each(["easy", "normal", "hard"] as const)("plays every %s event through MIDI start, hold release and flick", difficulty => {
    const game = createBassGame();
    game.tick(4.1, true); game.setDifficulty(difficulty); game.start();
    game.tick(BASS_SONGS[difficulty].countdownSeconds, true);
    for (const note of BASS_SONGS[difficulty].notes) {
      game.tick(note.time - game.snapshot().elapsed, true);
      expect(game.beginInput(note.id, note.midi)?.noteId).toBe(note.id);
      if (note.kind === "slap") expect(game.slapInput(note.id)).toBe(true);
      if (note.kind === "hold") game.tick(note.endTime! - game.snapshot().elapsed, true);
      game.endInput(note.id);
    }
    game.tick(BASS_SONGS[difficulty].duration, true);
    expect(game.snapshot()).toMatchObject({ phase: "result", accuracy: 100, misses: 0, strayPlucks: 0,
      hits: BASS_SONGS[difficulty].notes.length, combo: BASS_SONGS[difficulty].notes.length });
  });
});
