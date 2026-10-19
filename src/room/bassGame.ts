/** Original EASY: twelve bars, six sustained left-hand positions and eighth-note plucks. */
export const BASS_BPM = 96;
export const BASS_BEAT_SECONDS = 60 / BASS_BPM;
export const BASS_COUNTDOWN_SECONDS = BASS_BEAT_SECONDS * 3;
export const BASS_DURATION = BASS_BEAT_SECONDS * 49;
export const BASS_PROXIMITY_SECONDS = 5;
export const BASS_PICKUP_SECONDS = 1.1;
export const BASS_GOOD_WINDOW = 0.18;
export const BASS_PERFECT_WINDOW = 0.085;

export type BassPhase = "idle" | "approaching" | "pickup" | "ready" | "countdown" | "playing" | "result";
export type BassNoteState = "pending" | "perfect" | "good" | "miss";
export type BassFeedback = Exclude<BassNoteState, "pending">;
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
}
export interface BassLeftGuide {
  string: BassString;
  fret: number;
  phraseId: number | null;
  required: boolean;
  heldFret: number | null;
  nextFret: number | null;
  nextPhraseId: number | null;
}
export interface BassNote {
  id: number;
  time: number;
  frequency: number;
  string: BassString;
  fret: number;
  phraseId: number;
}
export interface BassGameNote extends BassNote { state: BassNoteState }
export interface BassJudgement {
  kind: BassFeedback;
  frequency: number | null;
  noteId: number | null;
}
export interface BassGameSnapshot {
  phase: BassPhase;
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

const positions: readonly (readonly [BassString, number])[] = [[3, 3], [2, 3], [1, 2], [0, 2], [2, 5], [3, 3]];
export const BASS_PHRASES: readonly BassPhrase[] = Object.freeze(positions.map(([string, fret], id) => {
  const start = (id * 8 + 1) * BASS_BEAT_SECONDS;
  const prepareAt = id === 0 ? -BASS_COUNTDOWN_SECONDS : start - BASS_BEAT_SECONDS * 1.5 + BASS_GOOD_WINDOW + 0.01;
  return Object.freeze({
    id, string, fret, start, end: start + 6.5 * BASS_BEAT_SECONDS, prepareAt,
    previewAt: prepareAt - BASS_BEAT_SECONDS * 2,
    frequency: 440 * 2 ** ((BASS_STRINGS[string].openMidi + fret - 69) / 12),
  });
}));
export const BASS_CHART: readonly BassNote[] = Object.freeze(BASS_PHRASES.flatMap((phrase) =>
  Array.from({ length: 14 }, (_, index) => Object.freeze({
    id: phrase.id * 14 + index,
    time: phrase.start + index * BASS_BEAT_SECONDS / 2,
    frequency: phrase.frequency,
    string: phrase.string,
    fret: phrase.fret,
    phraseId: phrase.id,
  })),
));

/** The engine supplies active elapsed time; a menu/background pause never ages notes. */
export function createBassGame() {
  let phase: BassPhase = "idle";
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

  function releaseAll() {
    heldFrets.fill(null);
  }

  function resetScore() {
    countdownRemaining = BASS_COUNTDOWN_SECONDS;
    elapsed = score = combo = maxCombo = hits = misses = strayPlucks = feedbackAge = 0;
    feedback = null;
    releaseAll();
    notes = BASS_CHART.map((note) => ({ ...note, state: "pending" }));
  }
  resetScore();

  function guideState() {
    const showingGuides = phase === "ready" || phase === "countdown" || phase === "playing";
    const time = phase === "playing" ? elapsed : phase === "countdown" ? -countdownRemaining : -BASS_COUNTDOWN_SECONDS;
    const prepared = showingGuides ? BASS_PHRASES.filter((phrase) => phrase.prepareAt <= time) : [];
    const latest = prepared[prepared.length - 1] ?? null;
    const currentPhrase = latest && time <= latest.end + BASS_GOOD_WINDOW ? latest : null;
    const nextPhrase = showingGuides ? BASS_PHRASES.find((phrase) => phrase.prepareAt > time && phrase.previewAt <= time) ?? null : null;
    const leftGuides: BassLeftGuide[] = BASS_STRINGS.map((_, row) => {
      const string = row as BassString;
      const available = prepared.filter((phrase) => phrase.string === string);
      const target = available[available.length - 1];
      const initial = BASS_PHRASES.find((phrase) => phrase.string === string)!;
      return {
        string, fret: target?.fret ?? initial.fret, phraseId: target?.id ?? null,
        required: currentPhrase?.string === string,
        heldFret: heldFrets[string],
        nextFret: nextPhrase?.string === string ? nextPhrase.fret : null,
        nextPhraseId: nextPhrase?.string === string ? nextPhrase.id : null,
      };
    });
    return { currentPhrase, nextPhrase, leftGuides };
  }

  function snapshot(): BassGameSnapshot {
    const penalizedScore = Math.max(0, score - strayPlucks * 250);
    return {
      phase,
      proximityProgress: Math.min(1, proximityTime / BASS_PROXIMITY_SECONDS),
      pickupProgress: Math.min(1, pickupTime / BASS_PICKUP_SECONDS),
      countdown: phase === "countdown" ? Math.max(1, Math.ceil(countdownRemaining / BASS_BEAT_SECONDS)) : 0,
      countdownRemaining: phase === "countdown" ? countdownRemaining : 0,
      elapsed, duration: BASS_DURATION, score: penalizedScore, combo, maxCombo, hits, misses, strayPlucks,
      accuracy: Math.round(penalizedScore / (BASS_CHART.length * 1000) * 100),
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
      if (pickupTime >= BASS_PICKUP_SECONDS) phase = "ready";
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
      elapsed = Math.min(BASS_DURATION, elapsed + remaining);
      for (const note of notes) {
        if (note.state !== "pending" || elapsed - note.time <= BASS_GOOD_WINDOW) continue;
        note.state = "miss";
        misses++;
        combo = 0;
        feedback = "miss";
        feedbackAge = 0;
      }
      if (elapsed >= BASS_DURATION) {
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

  /** A held contact keeps its fret until release; left-hand input never emits a note. */
  function hold(string: BassString, fret: number) {
    if (isPaused || (phase !== "countdown" && phase !== "playing") || !Number.isInteger(string) || string < 0 || string > 3) return false;
    if (heldFrets[string] !== null) return heldFrets[string] === fret;
    const guide = guideState().leftGuides[string];
    if (guide.phraseId === null || guide.fret !== fret) return false;
    heldFrets[string] = fret;
    return true;
  }

  function release(string: BassString) {
    if (Number.isInteger(string) && string >= 0 && string < 4) heldFrets[string] = null;
  }

  function pluck(string: BassString): BassJudgement | null {
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
    if (!closest || difference > BASS_GOOD_WINDOW || heldFrets[string] !== closest.fret) {
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

  return { tick, start, hold, release, releaseAll, pluck, cancel, snapshot };
}
