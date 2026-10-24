export type BassString = 0 | 1 | 2 | 3;
export const BASS_STRINGS = Object.freeze([
  Object.freeze({ name: "G", openMidi: 43 }),
  Object.freeze({ name: "D", openMidi: 38 }),
  Object.freeze({ name: "A", openMidi: 33 }),
  Object.freeze({ name: "E", openMidi: 28 }),
]);

export const BASS_FRET_COUNT = 6;
export interface BassFret { string: BassString; fret: number; midi: number; name: string; octave: number; color: string }
const PITCH_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;

/** 音高だけから決まる共通色。白文字のコントラストを保つ落ち着いた色味。 */
export const BASS_PITCH_COLORS = Object.freeze([
  { midi: 28, rgb: [55, 112, 155] }, { midi: 33, rgb: [41, 122, 143] },
  { midi: 38, rgb: [51, 124, 99] }, { midi: 43, rgb: [151, 107, 39] },
  { midi: 48, rgb: [174, 75, 82] },
] as const);
export function bassPitchColor(midi: number): string {
  const pitch = Math.max(28, Math.min(48, Number.isFinite(midi) ? midi : 28));
  const right = BASS_PITCH_COLORS.findIndex(stop => stop.midi >= pitch);
  const high = BASS_PITCH_COLORS[right], low = BASS_PITCH_COLORS[Math.max(0, right - 1)];
  const t = high.midi === low.midi ? 0 : (pitch - low.midi) / (high.midi - low.midi);
  return `#${low.rgb.map((channel, i) => Math.round(channel + (high.rgb[i] - channel) * t).toString(16).padStart(2, "0")).join("")}`;
}

export const BASS_FRETBOARD: readonly BassFret[] = Object.freeze(BASS_STRINGS.flatMap((tuning, string) =>
  Array.from({ length: BASS_FRET_COUNT }, (_, fret) => {
    const midi = tuning.openMidi + fret;
    return Object.freeze({ string: string as BassString, fret, ...bassPitch(midi) });
  }),
));

export const bassPositionsForMidi = (midi: number) => BASS_FRETBOARD.filter((position) => position.midi === midi);

export function bassPitch(midi: number) {
  const value = Number.isFinite(midi) ? Math.round(midi) : 28;
  return { midi: value, name: PITCH_NAMES[((value % 12) + 12) % 12], octave: Math.floor(value / 12) - 1,
    color: bassPitchColor(value) };
}
export const midiFrequency = (midi: number) => 440 * 2 ** ((midi - 69) / 12);
