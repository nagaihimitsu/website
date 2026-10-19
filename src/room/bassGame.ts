/** A short original phrase: eight bars of three quarter-note plucks in E minor. */
export const BASS_BPM = 96;
export const BASS_BEAT_SECONDS = 60 / BASS_BPM;
export const BASS_COUNTDOWN_SECONDS = BASS_BEAT_SECONDS * 3;
export const BASS_DURATION = BASS_BEAT_SECONDS * 33;
export const BASS_PROXIMITY_SECONDS = 5;
export const BASS_PICKUP_SECONDS = 1.1;
export const BASS_GOOD_WINDOW = 0.18;
export const BASS_PERFECT_WINDOW = 0.085;

export type BassPhase = "idle" | "approaching" | "pickup" | "ready" | "countdown" | "playing" | "result";
export type BassNoteState = "pending" | "perfect" | "good" | "miss";
export type BassFeedback = Exclude<BassNoteState, "pending">;
export interface BassNote {
  id: number;
  time: number;
  frequency: number;
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
}

const phrase = [
  [40, 43, 47], [40, 43, 45], [36, 40, 43], [36, 43, 47],
  [43, 47, 50], [38, 42, 45], [40, 43, 45], [47, 43, 40],
];
export const BASS_CHART: readonly BassNote[] = Object.freeze(phrase.flatMap((bar, barIndex) =>
  bar.map((midi, beatIndex) => Object.freeze({
    id: barIndex * 3 + beatIndex,
    time: (barIndex * 4 + beatIndex + 1) * BASS_BEAT_SECONDS,
    frequency: 440 * 2 ** ((midi - 69) / 12),
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

  function resetScore() {
    countdownRemaining = BASS_COUNTDOWN_SECONDS;
    elapsed = score = combo = maxCombo = hits = misses = strayPlucks = feedbackAge = 0;
    feedback = null;
    notes = BASS_CHART.map((note) => ({ ...note, state: "pending" }));
  }
  resetScore();

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
    };
  }

  function tick(deltaSeconds: number, nearBass: boolean, paused = false): BassGameSnapshot {
    isPaused = paused;
    if (paused) return snapshot();
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
      if (elapsed >= BASS_DURATION) phase = "result";
    }
    return snapshot();
  }

  function start() {
    if (isPaused || (phase !== "ready" && phase !== "result")) return false;
    resetScore();
    phase = "countdown";
    return true;
  }

  function pluck(): BassJudgement | null {
    if (isPaused || phase !== "playing") return null;
    let closest: BassGameNote | undefined;
    let difference = Infinity;
    for (const note of notes) {
      const distance = Math.abs(elapsed - note.time);
      if (note.state === "pending" && distance < difference) {
        closest = note;
        difference = distance;
      }
    }
    feedbackAge = 0;
    if (!closest || difference > BASS_GOOD_WINDOW) {
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

  return { tick, start, pluck, cancel, snapshot };
}
