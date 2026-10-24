export type BassString = 0 | 1 | 2 | 3;
export const BASS_STRINGS = Object.freeze([
  Object.freeze({ name: "G", openMidi: 43 }),
  Object.freeze({ name: "D", openMidi: 38 }),
  Object.freeze({ name: "A", openMidi: 33 }),
  Object.freeze({ name: "E", openMidi: 28 }),
]);

export const BASS_FRET_COUNT = 6;
export interface BassFret { string: BassString; fret: number; midi: number; name: string; octave: number; color: "blue" | "red" }
const PITCH_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;

export const BASS_FRETBOARD: readonly BassFret[] = Object.freeze(BASS_STRINGS.flatMap((tuning, string) =>
  Array.from({ length: BASS_FRET_COUNT }, (_, fret) => {
    const midi = tuning.openMidi + fret;
    return Object.freeze({ string: string as BassString, fret, ...bassPitch(midi) });
  }),
));

export const bassPositionsForMidi = (midi: number) => BASS_FRETBOARD.filter((position) => position.midi === midi);

export function bassPitch(midi: number) {
  return { midi, name: PITCH_NAMES[midi % 12], octave: Math.floor(midi / 12) - 1,
    color: midi <= 39 ? "blue" as const : "red" as const };
}
export const midiFrequency = (midi: number) => 440 * 2 ** ((midi - 69) / 12);
