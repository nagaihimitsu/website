import type { BassDifficulty, BassNote, BassSong } from "./bassGame";
import { BASS_STRINGS, midiFrequency, type BassString } from "./bassFretboard";
import { GARDEN_BASS_NOTES, GARDEN_TRACK, gardenBeatToTime, gardenTimeToBeat } from "./gardenTrack";

/** 手書きの練習用編曲。NORMALの前半を維持し、録音の終止まで演奏する。 */
export function makeTechniqueStudy(backing: BassSong, difficulty: BassDifficulty = "normal"): BassSong {
  const notes: BassNote[] = [];
  function add(time: number, string: BassString, fret: number, kind: BassNote["kind"] = "tap", endTime?: number, endFret?: number) {
    const midi = BASS_STRINGS[string].openMidi + fret;
    notes.push({ id: notes.length, time, string, fret, midi, frequency: midiFrequency(midi), kind,
      phraseId: notes.length, technique: kind === "slide" ? "slide" : kind === "slap" ? "slap" : "pick", travelSeconds: 1.2,
      ...(endTime !== undefined ? { endTime } : {}),
      ...(endFret !== undefined ? { endFret, endString: string, endMidi: BASS_STRINGS[string].openMidi + endFret } : {}),
    });
  }
  // 既存の30秒までの練習はNORMALの導入としてそのまま残す。
  add(1, 2, 2); add(2, 2, 2, "slide", 3, 5); add(4, 2, 5, "slide", 5, 2);
  add(6, 2, 2, "slap"); add(7, 2, 5, "slap"); add(8, 1, 2, "hold", 9);
  for (let i = 0; i < 8; i++) add(10 + i * 0.125, 3, 5);
  add(12, 0, 1, "slide", 13.2, 5); add(14, 0, 5, "slide", 15.2, 1);
  add(16, 3, 1, "hold", 17); add(18, 3, 3, "slap");
  add(19, 1, 1, "slide", 20.2, 4); add(21, 1, 4, "slide", 22.2, 1);
  for (let i = 0; i < 8; i++) add(24 + i * 0.125, 2, 2);
  add(26, 2, 2, "hold", 27); add(28, 2, 2, "slap"); add(29, 2, 2, "slide", 30, 5);

  // 後半は既存録音の実測拍へ合わせる。BPMから等間隔に作り直さない。
  const beat = (start: number, string: BassString, fret: number, kind: BassNote["kind"] = "tap", end?: number, endFret?: number) =>
    add(gardenBeatToTime(start), string, fret, kind, end === undefined ? undefined : gardenBeatToTime(end), endFret);
  beat(54, 3, 3); beat(55, 3, 5, "slap");
  beat(56, 2, 1, "slide", 58, 4); beat(59, 2, 4, "slide", 61, 1);
  beat(62, 1, 2, "hold", 63); beat(64, 1, 2, "slap");
  beat(65, 1, 4); beat(66, 1, 5); beat(67, 0, 2);
  beat(68, 0, 1, "slide", 70, 4); beat(71, 0, 4, "slide", 73, 1);
  beat(74, 3, 2, "hold", 75); beat(76, 3, 3, "slap"); beat(77, 2, 2);
  for (let i = 0; i < 4; i++) beat(78 + i * 0.5, 2, 5);
  beat(80, 2, 5, "slide", 82, 2); beat(83, 1, 2); beat(84, 1, 2, "hold", 85);
  beat(86, 3, 3, "slap"); beat(87, 3, 5, "slap"); beat(88, 3, 5, "slide", 90, 2);
  beat(91, 2, 2); beat(92, 1, 3); beat(93, 1, 3, "slap"); beat(94, 1, 2); beat(95, 2, 3);
  // 録音最後の実測D2アタック。終端の減衰は既存の音源・曲長を維持する。
  const endingAttack = GARDEN_BASS_NOTES.at(-1)!;
  add(endingAttack.time, 2, endingAttack.midi - BASS_STRINGS[2].openMidi, "hold", GARDEN_TRACK.fadeStart);

  let arranged = notes;
  if (difficulty === "easy") {
    let freeAt = -Infinity, slaps = 0;
    arranged = notes.filter(note => {
      if (note.time < freeAt + 0.55) return false;
      freeAt = note.endTime ?? note.time;
      return true;
    });
    // 音数を減らしても終止音は必ず残す。
    const ending = notes.at(-1)!;
    arranged = arranged.filter(note => note !== ending && (note.endTime ?? note.time) + 0.55 <= ending.time);
    arranged.push(ending);
    arranged = arranged.map(note => {
      if (note.kind === "slide") {
        const endFret = note.fret + Math.sign(note.endFret! - note.fret) * Math.min(2, Math.abs(note.endFret! - note.fret));
        return { ...note, endFret, endMidi: BASS_STRINGS[note.string].openMidi + endFret };
      }
      if (note.kind === "slap" && ++slaps % 2 === 0) return { ...note, kind: "tap" as const, technique: "pick" as const };
      return note;
    });
  } else if (difficulty === "hard") {
    const fills: BassNote[] = [];
    for (let index = 0; index < notes.length - 1; index++) {
      const note = notes[index], next = notes[index + 1];
      const freeAt = (note.endTime ?? note.time) + (note.kind === "tap" ? 0.24 : 0.32);
      const firstBeat = Math.ceil((gardenTimeToBeat(freeAt) - 1e-8) * 2) / 2;
      for (let position = firstBeat; gardenBeatToTime(position) <= next.time - 0.24; position += 0.5) {
        const fromFret = note.endFret ?? note.fret;
        const fret = fromFret + (fills.length % 2 ? 0 : fromFret === 5 ? -1 : 1);
        const midi = BASS_STRINGS[note.string].openMidi + fret;
        fills.push({ id: 0, phraseId: 0, time: gardenBeatToTime(position), string: note.string, fret, midi,
          frequency: midiFrequency(midi), kind: "tap", technique: "pick", travelSeconds: 1.2 });
      }
    }
    arranged = [...notes, ...fills].sort((a, b) => a.time - b.time);
  }
  const chart = Object.freeze(arranged.map((note, id) => Object.freeze({ ...note, id, phraseId: id })));
  return Object.freeze({ ...backing, id: "technique-study", title: "奏法練習 · Garden-Party", difficulty, label: difficulty.toUpperCase(),
    notes: chart, phrases: Object.freeze(chart.map(note => ({ id: note.phraseId, string: note.string,
      fret: note.fret, start: note.time, end: note.endTime ?? note.time, prepareAt: note.time - 0.5,
      previewAt: note.time - 1.2, frequency: note.frequency, mode: "tap" as const }))),
  });
}
