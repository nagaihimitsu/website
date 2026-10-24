import type { BassNote, BassSong } from "./bassGame";
import { BASS_STRINGS, midiFrequency, type BassString } from "./bassFretboard";

/** 手書きの検証・練習用。原曲の採譜やMIDI原本には追加しない。 */
export function makeTechniqueStudy(backing: BassSong): BassSong {
  const notes: BassNote[] = [];
  function add(time: number, string: BassString, fret: number, kind: BassNote["kind"] = "tap", endTime?: number, endFret?: number) {
    const midi = BASS_STRINGS[string].openMidi + fret;
    notes.push(Object.freeze({ id: notes.length, time, string, fret, midi, frequency: midiFrequency(midi), kind,
      phraseId: notes.length, technique: kind === "slide" ? "slide" : kind === "slap" ? "slap" : "pick", travelSeconds: 1.2,
      ...(endTime !== undefined ? { endTime } : {}),
      ...(endFret !== undefined ? { endFret, endString: string, endMidi: BASS_STRINGS[string].openMidi + endFret } : {}),
    }));
  }
  add(1, 2, 2); add(2, 2, 2, "slide", 3, 5); add(4, 2, 5, "slide", 5, 2);
  add(6, 2, 2, "slap"); add(7, 2, 5, "slap"); add(8, 1, 2, "hold", 9);
  for (let i = 0; i < 8; i++) add(10 + i * 0.125, 3, 5);
  add(12, 0, 1, "slide", 13.2, 5); add(14, 0, 5, "slide", 15.2, 1);
  add(16, 3, 1, "hold", 17); add(18, 3, 3, "slap");
  add(19, 1, 1, "slide", 20.2, 4); add(21, 1, 4, "slide", 22.2, 1);
  for (let i = 0; i < 8; i++) add(24 + i * 0.125, 2, 2);
  add(26, 2, 2, "hold", 27); add(28, 2, 2, "slap"); add(29, 2, 2, "slide", 30, 5);
  return Object.freeze({ ...backing, id: "technique-study", title: "奏法練習 · Garden-Party", label: "奏法練習",
    notes: Object.freeze(notes), phrases: Object.freeze(notes.map(note => ({ id: note.phraseId, string: note.string,
      fret: note.fret, start: note.time, end: note.endTime ?? note.time, prepareAt: note.time - 0.5,
      previewAt: note.time - 1.2, frequency: note.frequency, mode: "tap" as const }))),
  });
}
