import { GARDEN_BASS_NOTES, GARDEN_TRACK, gardenTimeToBeat } from "./gardenTrack";

/** Guides, scoring, animation and recorded sound share one active media clock. */
export const BASS_PROXIMITY_SECONDS = 3;
export const BASS_PICKUP_SECONDS = 1.1;
export const BASS_GOOD_WINDOW = 0.18;
export const BASS_PERFECT_WINDOW = 0.085;

export type BassPhase = "idle" | "approaching" | "pickup" | "ready" | "countdown" | "playing" | "result";
export type BassNoteState = "pending" | "perfect" | "good" | "miss";
export type BassFeedback = Exclude<BassNoteState, "pending">;
export type BassDifficulty = "easy" | "normal" | "hard";
export type BassTechnique = "pick" | "slap";
/** Row order is shared by the picking controls, chart and instrument: G, D, A, E. */
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
  /** Fractional position on the recording's measured, gently drifting beat grid. */
  beat: number;
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
  currentPhrase: BassPhrase | null;
  nextPhrase: BassPhrase | null;
}

type RecordedAttack = { time: number; midi: number; string: BassString; fret: number };

/** Use a real fretted position without silently transposing a recorded note. */
function frettedAttack(note: Readonly<{ time: number; midi: number }>): RecordedAttack | null {
  let best: RecordedAttack | null = null;
  for (let row = 0; row < BASS_STRINGS.length; row++) {
    const fret = note.midi - BASS_STRINGS[row].openMidi;
    // Retain the recorded arrangement and the avatar's fretted playing positions.
    if (fret < 1 || fret > 5) continue;
    if (!best || Math.abs(fret - 3) < Math.abs(best.fret - 3))
      best = { ...note, string: row as BassString, fret };
  }
  return best;
}

function selectAttacks(difficulty: BassDifficulty): RecordedAttack[] {
  const samePositionGap = { easy: 0.52, normal: 0.38, hard: 0.22 }[difficulty];
  const changedPositionGap = { easy: 0.9, normal: 0.72, hard: 0.6 }[difficulty];
  const selected: RecordedAttack[] = [];
  const available = GARDEN_BASS_NOTES.map(frettedAttack).filter((note): note is RecordedAttack =>
    note !== null && (difficulty !== "easy" || [2, 3, 5].includes(note.fret)));
  const gap = (left: RecordedAttack, right: RecordedAttack) =>
    left.midi === right.midi ? samePositionGap : changedPositionGap;
  for (const note of available) {
    const previous = selected[selected.length - 1];
    if (!previous || note.time - previous.time >= gap(previous, note)) selected.push(note);
  }
  // Keep the final measured D2 attack, leaving the recorded ending and decay intact.
  const final = available[available.length - 1];
  if (selected[selected.length - 1] !== final) {
    while (selected.length && final.time - selected[selected.length - 1].time < gap(selected[selected.length - 1], final))
      selected.pop();
    selected.push(final);
  }
  return selected;
}

function makeSong(difficulty: BassDifficulty): BassSong {
  const beatSeconds = 60 / GARDEN_TRACK.bpm;
  const countdownSeconds = beatSeconds * 4;
  const selected = selectAttacks(difficulty);
  const runs: RecordedAttack[][] = [];
  for (const attack of selected) {
    const run = runs[runs.length - 1];
    const previous = run?.[run.length - 1];
    if (previous && previous.midi === attack.midi && attack.time - previous.time < 1.6) run.push(attack);
    else runs.push([attack]);
  }
  const notes: BassNote[] = [];
  const phrases: BassPhrase[] = [];
  let repeatedRun = 0;
  function addPhrase(attacks: readonly RecordedAttack[], mode: BassPhrase["mode"], runOffset: number, repeated: boolean) {
    const first = attacks[0], last = attacks[attacks.length - 1];
    const id = phrases.length;
    const prepareAt = id === 0 ? -countdownSeconds : phrases[id - 1].end + BASS_GOOD_WINDOW + 0.01;
    const frequency = 440 * 2 ** ((first.midi - 69) / 12);
    phrases.push(Object.freeze({ id, string: first.string, fret: first.fret, mode,
      start: first.time, end: last.time, prepareAt,
      previewAt: Math.min(prepareAt - beatSeconds * 2, first.time - 1.25), frequency }));
    for (const [index, attack] of attacks.entries()) {
      const next = selected[selected.indexOf(attack) + 1];
      const canRecover = !next || next.time - attack.time >= 0.26;
      const accent = difficulty === "normal" ? (runOffset + index) % 2 === 0 : (runOffset + index) % 2 === 1;
      const technique: BassTechnique = difficulty !== "easy" && repeated && attack.time >= 10 && accent && canRecover ? "slap" : "pick";
      notes.push(Object.freeze({ id: notes.length, time: attack.time, frequency,
        string: attack.string, fret: attack.fret, phraseId: id, technique,
        travelSeconds: technique === "slap" ? (difficulty === "hard" ? 0.7 : 0.85) : (difficulty === "hard" ? 1.9 : 2.1),
      }));
    }
  }
  for (const run of runs) {
    const repeated = run.length > 1;
    const repeatIndex = repeated ? repeatedRun++ : -1;
    const enoughRepressTime = run.every((note, index) => index === 0 || note.time - run[index - 1].time >= 0.38);
    const tap = difficulty === "normal" ? repeated && repeatIndex % 2 === 1 :
      difficulty === "hard" && run[0].time >= 13 && enoughRepressTime;
    if (tap) run.forEach((note, index) => addPhrase([note], "tap", index, repeated));
    else addPhrase(run, "hold", 0, repeated);
  }
  return Object.freeze({ difficulty, label: difficulty.toUpperCase(), bpm: GARDEN_TRACK.bpm,
    beatSeconds, countdownSeconds, duration: GARDEN_TRACK.duration, beats: GARDEN_TRACK.beats,
    phrases: Object.freeze(phrases), notes: Object.freeze(notes),
    // Harmony, drums, swing and timbre come from the recording, never a second generated song.
    chords: Object.freeze([]), swing: 0.5,
  });
}

export const BASS_SONGS: Readonly<Record<BassDifficulty, BassSong>> = Object.freeze({
  easy: makeSong("easy"), normal: makeSong("normal"), hard: makeSong("hard"),
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

  function resetScore() {
    countdownRemaining = song().countdownSeconds;
    elapsed = score = combo = maxCombo = hits = misses = strayPlucks = feedbackAge = 0;
    feedback = null;
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
    return { currentPhrase, nextPhrase };
  }

  function snapshot(): BassGameSnapshot {
    const penalizedScore = Math.max(0, score - strayPlucks * 250);
    return {
      phase, difficulty, bpm: song().bpm, beatSeconds: song().beatSeconds,
      beat: gardenTimeToBeat(phase === "countdown" ? -countdownRemaining : elapsed),
      proximityProgress: Math.min(1, proximityTime / BASS_PROXIMITY_SECONDS),
      pickupProgress: Math.min(1, pickupTime / BASS_PICKUP_SECONDS),
      countdown: phase === "countdown" ? Math.max(1, Math.ceil(countdownRemaining / song().beatSeconds)) : 0,
      countdownRemaining: phase === "countdown" ? countdownRemaining : 0,
      elapsed, duration: song().duration, score: penalizedScore, combo, maxCombo, hits, misses, strayPlucks,
      accuracy: Math.round(penalizedScore / (song().notes.length * 1000) * 100),
      feedback, feedbackAge,
      notes: notes.map((note) => ({ ...note })),
      ...guideState(),
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
    if (!closest || difference > BASS_GOOD_WINDOW || closest.technique !== technique) {
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

  return { tick, start, setDifficulty, pluck, cancel, snapshot };
}
