/** Original short songs share one active-time clock for guides, scoring and sound. */
export const BASS_PROXIMITY_SECONDS = 3;
export const BASS_PICKUP_SECONDS = 1.1;
export const BASS_GOOD_WINDOW = 0.18;
export const BASS_PERFECT_WINDOW = 0.085;

export type BassPhase = "idle" | "approaching" | "pickup" | "ready" | "countdown" | "playing" | "result";
export type BassNoteState = "pending" | "perfect" | "good" | "miss";
export type BassFeedback = Exclude<BassNoteState, "pending">;
export type BassDifficulty = "easy" | "normal" | "hard";
export type BassTechnique = "pick" | "slap";
/** Row order is shared by both hands, the chart and the instrument: G, D, A, E. */
export type BassString = 0 | 1 | 2 | 3;
export const BASS_STRINGS = Object.freeze([
  Object.freeze({ name: "G", openMidi: 43 }),
  Object.freeze({ name: "D", openMidi: 38 }),
  Object.freeze({ name: "A", openMidi: 33 }),
  Object.freeze({ name: "E", openMidi: 28 }),
]);
export interface BassPhrase {
  id: number;
  string: BassString;
  fret: number;
  start: number;
  end: number;
  prepareAt: number;
  previewAt: number;
  frequency: number;
  mode: "hold" | "tap";
}
export interface BassLeftGuide {
  string: BassString;
  fret: number;
  phraseId: number | null;
  required: boolean;
  heldFret: number | null;
  nextFret: number | null;
  nextPhraseId: number | null;
  needsRepress: boolean;
}
export interface BassNote {
  id: number;
  time: number;
  frequency: number;
  string: BassString;
  fret: number;
  phraseId: number;
  technique: BassTechnique;
  travelSeconds: number;
}
export interface BassSong {
  difficulty: BassDifficulty;
  label: string;
  bpm: number;
  beatSeconds: number;
  countdownSeconds: number;
  duration: number;
  beats: number;
  phrases: readonly BassPhrase[];
  notes: readonly BassNote[];
  chords: readonly { beat: number; midi: number; minor: boolean }[];
  /** Position of the swung offbeat within a beat; 0.5 is straight. */
  swing: number;
}
export interface BassGameNote extends BassNote { state: BassNoteState }
export interface BassJudgement {
  kind: BassFeedback;
  frequency: number | null;
  noteId: number | null;
}
export interface BassGameSnapshot {
  phase: BassPhase;
  difficulty: BassDifficulty;
  bpm: number;
  beatSeconds: number;
  proximityProgress: number;
  pickupProgress: number;
  countdown: number;
  countdownRemaining: number;
  elapsed: number;
  duration: number;
  score: number;
  combo: number;
  maxCombo: number;
  hits: number;
  misses: number;
  strayPlucks: number;
  accuracy: number;
  feedback: BassFeedback | null;
  feedbackAge: number;
  notes: readonly BassGameNote[];
  heldFrets: readonly (number | null)[];
  currentPhrase: BassPhrase | null;
  nextPhrase: BassPhrase | null;
  leftGuides: readonly BassLeftGuide[];
}

type PhraseInput = {
  string: BassString;
  fret: number;
  mode: BassPhrase["mode"];
  beat: number;
  pattern: readonly (readonly [number, BassTechnique])[];
};

function makeSong(difficulty: BassDifficulty, bpm: number, beats: number, swing: number,
  inputs: readonly PhraseInput[], chords: BassSong["chords"]): BassSong {
  const beatSeconds = 60 / bpm;
  const countdownSeconds = beatSeconds * 3;
  const notes: BassNote[] = [];
  const phrases: BassPhrase[] = [];
  for (const input of inputs) {
    const id = phrases.length;
    const start = input.beat * beatSeconds;
    const end = (input.beat + input.pattern[input.pattern.length - 1][0]) * beatSeconds;
    // The previous note retains its full late window; preparation then opens
    // before the next attack. Short tap pairs keep the same position.
    const prepareAt = id === 0 ? -countdownSeconds : phrases[id - 1].end + BASS_GOOD_WINDOW + 0.01;
    const frequency = 440 * 2 ** ((BASS_STRINGS[input.string].openMidi + input.fret - 69) / 12);
    phrases.push(Object.freeze({ id, string: input.string, fret: input.fret, mode: input.mode,
      start, end, prepareAt, previewAt: prepareAt - beatSeconds * 2, frequency }));
    for (const [offset, technique] of input.pattern) notes.push(Object.freeze({
      id: notes.length, time: (input.beat + offset) * beatSeconds, frequency,
      string: input.string, fret: input.fret, phraseId: id, technique,
      travelSeconds: technique === "slap" ? (difficulty === "hard" ? 0.7 : 0.85) : (difficulty === "hard" ? 1.9 : 2.1),
    }));
  }
  return Object.freeze({ difficulty, label: difficulty.toUpperCase(), bpm, beatSeconds, countdownSeconds,
    duration: (beats + 1) * beatSeconds, beats, swing,
    phrases: Object.freeze(phrases), notes: Object.freeze(notes),
    chords: Object.freeze(chords.map((chord) => Object.freeze(chord))),
  });
}

const easyPositions: readonly (readonly [BassString, number])[] = [[3, 3], [2, 3], [1, 2], [0, 2], [2, 5], [3, 3]];
const easyInputs = easyPositions.map(([string, fret], index): PhraseInput => ({ string, fret, mode: "hold", beat: index * 8 + 1,
  pattern: Array.from({ length: 14 }, (_, note) => [note / 2, "pick"] as const),
}));
const normalPositions: readonly (readonly [BassString, number])[] = [[3, 3], [2, 3], [1, 2], [0, 2], [2, 5], [2, 3], [1, 5], [3, 3]];
const normalInputs: PhraseInput[] = [];
for (const [block, [string, fret]] of normalPositions.entries()) {
  if (block === 0 || block === 4) {
    // Introduce the faster slap while the left thumb stays in one place.
    normalInputs.push({ string, fret, mode: "hold", beat: block * 8 + 1,
      pattern: Array.from({ length: 14 }, (_, note) => [Math.floor(note / 2) + (note % 2 ? 0.62 : 0),
        note > 0 && note % 4 === 0 ? "slap" : "pick"] as const) });
  } else {
    for (let pair = 0; pair < 4; pair++) for (let part = 0; part < 2; part++)
      normalInputs.push({ string, fret, mode: "tap", beat: block * 8 + 1 + pair * 2 + (part ? 0.62 : 0),
        pattern: [[0, part ? "pick" : "slap"]] });
  }
}

const hardPositions: readonly (readonly (readonly [BassString, number])[])[] = [
  [[3, 3]], [[2, 3], [1, 2], [0, 5], [2, 3]], [[2, 5], [1, 2], [0, 2], [2, 5]],
  [[1, 2]], [[3, 5], [2, 3], [0, 2], [3, 5]], [[2, 5], [1, 2], [0, 2], [2, 5]],
  [[1, 5]], [[1, 2], [2, 2], [3, 3], [1, 2]], [[3, 3], [2, 5], [1, 5], [3, 3]],
];
const hardInputs: PhraseInput[] = [];
for (const [block, positions] of hardPositions.entries()) {
  if (positions.length === 1) {
    const [string, fret] = positions[0];
    hardInputs.push({ string, fret, mode: "hold", beat: block * 8 + 1,
      pattern: [0, 0.5, 1.25, 2, 2.5, 3.25, 4, 4.5, 5.25, 6, 6.5]
        .map((offset, note) => [offset, note % 3 === 1 ? "slap" : "pick"] as const) });
  } else {
    for (const [pair, [string, fret]] of positions.entries()) for (let part = 0; part < 2; part++)
      hardInputs.push({ string, fret, mode: "tap", beat: block * 8 + 1 + pair * 2 + part * 0.75,
        pattern: [[0, part ? "slap" : "pick"]] });
  }
}

function chordsFor(roots: readonly (readonly [number, boolean])[]) {
  return roots.map(([midi, minor], index) => ({ beat: index * 8, midi, minor }));
}
export const BASS_SONGS: Readonly<Record<BassDifficulty, BassSong>> = Object.freeze({
  easy: makeSong("easy", 96, 48, 0.5, easyInputs, chordsFor([[55, false], [60, false], [64, true], [57, true], [62, false], [55, false]])),
  normal: makeSong("normal", 104, 64, 0.62, normalInputs, chordsFor([[55, false], [60, false], [64, true], [57, true], [62, false], [60, false], [55, false], [55, false]])),
  hard: makeSong("hard", 120, 72, 0.5, hardInputs, chordsFor([[55, false], [60, false], [62, false], [64, true], [57, true], [62, false], [55, false], [64, true], [55, false]])),
});
// Existing integrations and EASY fixtures keep their stable aliases.
export const BASS_BPM = BASS_SONGS.easy.bpm;
export const BASS_BEAT_SECONDS = BASS_SONGS.easy.beatSeconds;
export const BASS_COUNTDOWN_SECONDS = BASS_SONGS.easy.countdownSeconds;
export const BASS_DURATION = BASS_SONGS.easy.duration;
export const BASS_PHRASES = BASS_SONGS.easy.phrases;
export const BASS_CHART = BASS_SONGS.easy.notes;

/** The engine supplies active elapsed time; a menu/background pause never ages notes. */
export function createBassGame() {
  let phase: BassPhase = "idle";
  let difficulty: BassDifficulty = "easy";
  const song = () => BASS_SONGS[difficulty];
  let proximityTime = 0;
  let pickupTime = 0;
  let countdownRemaining = BASS_COUNTDOWN_SECONDS;
  let elapsed = 0;
  let score = 0;
  let combo = 0;
  let maxCombo = 0;
  let hits = 0;
  let misses = 0;
  let strayPlucks = 0;
  let feedback: BassFeedback | null = null;
  let feedbackAge = 0;
  let isPaused = false;
  let notes: BassGameNote[] = [];
  const heldFrets: (number | null)[] = [null, null, null, null];
  const heldPhraseIds: (number | null)[] = [null, null, null, null];

  function releaseAll() {
    heldFrets.fill(null);
    heldPhraseIds.fill(null);
  }

  function resetScore() {
    countdownRemaining = song().countdownSeconds;
    elapsed = score = combo = maxCombo = hits = misses = strayPlucks = feedbackAge = 0;
    feedback = null;
    releaseAll();
    notes = song().notes.map((note) => ({ ...note, state: "pending" }));
  }
  resetScore();

  function guideState() {
    const showingGuides = phase === "ready" || phase === "countdown" || phase === "playing";
    const time = phase === "playing" ? elapsed : phase === "countdown" ? -countdownRemaining : -song().countdownSeconds;
    const prepared = showingGuides ? song().phrases.filter((phrase) => phrase.prepareAt <= time) : [];
    const latest = prepared[prepared.length - 1] ?? null;
    const currentPhrase = latest && time <= latest.end + BASS_GOOD_WINDOW ? latest : null;
    const nextPhrase = showingGuides ? song().phrases.find((phrase) => phrase.prepareAt > time && phrase.previewAt <= time) ?? null : null;
    const leftGuides: BassLeftGuide[] = BASS_STRINGS.map((_, row) => {
      const string = row as BassString;
      const available = prepared.filter((phrase) => phrase.string === string);
      const target = available[available.length - 1];
      const initial = song().phrases.find((phrase) => phrase.string === string)!;
      return {
        string, fret: target?.fret ?? initial.fret, phraseId: target?.id ?? null,
        required: currentPhrase?.string === string,
        heldFret: heldFrets[string],
        nextFret: nextPhrase?.string === string ? nextPhrase.fret : null,
        nextPhraseId: nextPhrase?.string === string ? nextPhrase.id : null,
        needsRepress: heldFrets[string] !== null && currentPhrase?.string === string &&
          currentPhrase.mode === "tap" && heldPhraseIds[string] !== currentPhrase.id,
      };
    });
    return { currentPhrase, nextPhrase, leftGuides };
  }

  function snapshot(): BassGameSnapshot {
    const penalizedScore = Math.max(0, score - strayPlucks * 250);
    return {
      phase, difficulty, bpm: song().bpm, beatSeconds: song().beatSeconds,
      proximityProgress: Math.min(1, proximityTime / BASS_PROXIMITY_SECONDS),
      pickupProgress: Math.min(1, pickupTime / BASS_PICKUP_SECONDS),
      countdown: phase === "countdown" ? Math.max(1, Math.ceil(countdownRemaining / song().beatSeconds)) : 0,
      countdownRemaining: phase === "countdown" ? countdownRemaining : 0,
      elapsed, duration: song().duration, score: penalizedScore, combo, maxCombo, hits, misses, strayPlucks,
      accuracy: Math.round(penalizedScore / (song().notes.length * 1000) * 100),
      feedback, feedbackAge,
      notes: notes.map((note) => ({ ...note })),
      heldFrets: [...heldFrets],
      ...guideState(),
    };
  }

  function tick(deltaSeconds: number, nearBass: boolean, paused = false): BassGameSnapshot {
    isPaused = paused;
    if (paused) {
      releaseAll();
      return snapshot();
    }
    let remaining = Number.isFinite(deltaSeconds) ? Math.max(0, deltaSeconds) : 0;
    if (feedback) {
      feedbackAge += remaining;
      if (feedbackAge > 0.7) feedback = null;
    }
    if (phase === "idle" || phase === "approaching") {
      if (!nearBass) {
        phase = "idle";
        proximityTime = 0;
        return snapshot();
      }
      phase = "approaching";
      const consumed = Math.min(remaining, BASS_PROXIMITY_SECONDS - proximityTime);
      proximityTime += consumed;
      remaining -= consumed;
      if (proximityTime < BASS_PROXIMITY_SECONDS) return snapshot();
      phase = "pickup";
    }
    if (phase === "pickup") {
      pickupTime = Math.min(BASS_PICKUP_SECONDS, pickupTime + remaining);
      if (pickupTime + 1e-9 >= BASS_PICKUP_SECONDS) {
        pickupTime = BASS_PICKUP_SECONDS;
        phase = "ready";
      }
      return snapshot();
    }
    if (phase === "countdown") {
      const consumed = Math.min(remaining, countdownRemaining);
      countdownRemaining -= consumed;
      remaining -= consumed;
      if (countdownRemaining > 0) return snapshot();
      phase = "playing";
    }
    if (phase === "playing") {
      elapsed = Math.min(song().duration, elapsed + remaining);
      for (const note of notes) {
        if (note.state !== "pending" || elapsed - note.time <= BASS_GOOD_WINDOW) continue;
        note.state = "miss";
        misses++;
        combo = 0;
        feedback = "miss";
        feedbackAge = 0;
      }
      if (elapsed >= song().duration) {
        phase = "result";
        releaseAll();
      }
    }
    return snapshot();
  }

  function start() {
    if (isPaused || (phase !== "ready" && phase !== "result")) return false;
    resetScore();
    phase = "countdown";
    return true;
  }

  function setDifficulty(value: BassDifficulty) {
    if (isPaused || (phase !== "ready" && phase !== "result") ||
      typeof value !== "string" || !Object.hasOwn(BASS_SONGS, value)) return false;
    difficulty = value;
    resetScore();
    phase = "ready";
    return true;
  }

  /** A held contact keeps its fret until release; left-hand input never emits a note. */
  function hold(string: BassString, fret: number) {
    if (isPaused || (phase !== "countdown" && phase !== "playing") || !Number.isInteger(string) || string < 0 || string > 3) return false;
    if (heldFrets[string] !== null) return heldFrets[string] === fret;
    const guide = guideState().leftGuides[string];
    if (guide.phraseId === null || guide.fret !== fret) return false;
    heldFrets[string] = fret;
    heldPhraseIds[string] = guide.phraseId;
    return true;
  }

  function release(string: BassString) {
    if (Number.isInteger(string) && string >= 0 && string < 4) {
      heldFrets[string] = null;
      heldPhraseIds[string] = null;
    }
  }

  function pluck(string: BassString, technique: BassTechnique = "pick"): BassJudgement | null {
    if (isPaused || phase !== "playing") return null;
    let closest: BassGameNote | undefined;
    let difference = Infinity;
    for (const note of notes) {
      const distance = Math.abs(elapsed - note.time);
      if (note.string === string && note.state === "pending" && distance < difference) {
        closest = note;
        difference = distance;
      }
    }
    feedbackAge = 0;
    if (!closest || difference > BASS_GOOD_WINDOW || heldFrets[string] !== closest.fret ||
      closest.technique !== technique ||
      (song().phrases[closest.phraseId].mode === "tap" && heldPhraseIds[string] !== closest.phraseId)) {
      strayPlucks++;
      combo = 0;
      feedback = "miss";
      return { kind: "miss", frequency: null, noteId: null };
    }
    const kind = difference <= BASS_PERFECT_WINDOW ? "perfect" : "good";
    closest.state = kind;
    score += kind === "perfect" ? 1000 : 650;
    hits++;
    combo++;
    maxCombo = Math.max(maxCombo, combo);
    feedback = kind;
    return { kind, frequency: closest.frequency, noteId: closest.id };
  }

  function cancel() {
    phase = "idle";
    isPaused = false;
    proximityTime = pickupTime = 0;
    resetScore();
  }

  return { tick, start, setDifficulty, hold, release, releaseAll, pluck, cancel, snapshot };
}
