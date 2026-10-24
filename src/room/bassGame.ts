import { finalHitSong } from "./finalHitTrack";
import type { ImportedChart } from "./bassChartImport";
import { BASS_STRINGS, midiFrequency, type BassString } from "./bassFretboard";
export { BASS_STRINGS, type BassString } from "./bassFretboard";
import { GARDEN_BASS_NOTES, GARDEN_TRACK, gardenTimeToBeat } from "./gardenTrack";

/** Guides, scoring, animation and recorded sound share one active media clock. */
export const BASS_PROXIMITY_SECONDS = 3;
export const BASS_PICKUP_SECONDS = 1.1;
export const BASS_GOOD_WINDOW = 0.18;
export const BASS_PERFECT_WINDOW = 0.085;

export type BassPhase = "idle" | "approaching" | "pickup" | "ready" | "countdown" | "playing" | "result";
export type BassNoteState = "pending" | "holding" | "skipped" | "perfect" | "great" | "good" | "bad" | "miss";
export type BassFeedback = Exclude<BassNoteState, "pending" | "holding" | "skipped">;
export type BassDifficulty = "easy" | "normal" | "hard";
export type BassSongId = "garden-party" | "final-hit";
export const BASS_TRACKS = [
  { id: "garden-party", title: GARDEN_TRACK.title, draft: false },
  { id: "final-hit", title: "最終のヒット", draft: true },
] as const;
export type BassTechnique = "pick" | "slap";
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
export type BassNoteKind = "tap" | "hold" | "slap";
export interface BassNote {
  sourceId?: string;
  sourceTimeSec?: number;
  sourceDurationSec?: number;
  sourceStringNumber?: number;
  sourceFret?: number;
  sourcePositionVerified?: boolean;
  velocity?: number;
  positionVerified?: boolean;
  techniqueVerified?: boolean;
  importedTechnique?: string | null;
  midi: number;
  kind: BassNoteKind;
  endTime?: number;
  id: number;
  time: number;
  frequency: number;
  string: BassString;
  fret: number;
  phraseId: number;
  technique: BassTechnique | null;
  travelSeconds: number;
}
export interface BassSong {
  id: BassSongId;
  title: string;
  importInfo?: ImportedChart;
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
  songId: BassSongId;
  songTitle: string;
  countdownSeconds: number;
  audioOffsetSec: number;
  importSummary?: { sourceCount: number; candidateCount: number; playableCount: number; excludedCount: number; audioSyncVerified: boolean };
  directInput?: boolean;
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
    if (fret < 0 || fret > 5) continue;
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
    const frequency = midiFrequency(first.midi);
    phrases.push(Object.freeze({ id, string: first.string, fret: first.fret, mode,
      start: first.time, end: last.time, prepareAt,
      previewAt: Math.min(prepareAt - beatSeconds * 2, first.time - 1.25), frequency }));
    for (const [index, attack] of attacks.entries()) {
      const next = selected[selected.indexOf(attack) + 1];
      const canRecover = !next || next.time - attack.time >= 0.26;
      const accent = difficulty === "normal" ? (runOffset + index) % 2 === 0 : (runOffset + index) % 2 === 1;
      const technique: BassTechnique = difficulty !== "easy" && repeated && attack.time >= 10 && accent && canRecover ? "slap" : "pick";
      // The old phrase.mode describes automatic fretting, not a sustained sound.
      // Only isolated attacks become holds; repeated attacks stay independent.
      const gap = (next?.time ?? GARDEN_TRACK.fadeStart) - attack.time;
      const hold = difficulty !== "easy" && technique === "pick" && gap >= 1.1 && notes.length > 0;
      notes.push(Object.freeze({ id: notes.length, time: attack.time, frequency,
        midi: attack.midi, kind: technique === "slap" ? "slap" : hold ? "hold" : "tap",
        ...(hold ? { endTime: attack.time + Math.min(0.8, gap - 0.3) } : {}),
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
  return Object.freeze({ id: "garden-party", title: GARDEN_TRACK.title, difficulty, label: difficulty.toUpperCase(), bpm: GARDEN_TRACK.bpm,
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
export function createBassGame(chart?: readonly BassNote[]) {
  let phase: BassPhase = "idle";
  let difficulty: BassDifficulty = "easy";
  let activeSong: BassSong = BASS_SONGS[difficulty];
  const song = () => activeSong;
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
  let directInput = false;
  let notes: BassGameNote[] = [];
  const contacts = new Map<number, { midi: number; time: number; noteId: number | null; grade: BassFeedback }>();
  const grade = (delta: number): BassFeedback => delta <= 0.045 ? "perfect" : delta <= BASS_PERFECT_WINDOW ? "great" : delta <= 0.14 ? "good" : "bad";
  const points: Record<BassFeedback, number> = { perfect: 1000, great: 850, good: 650, bad: 250, miss: 0 };
  function finish(note: BassGameNote, kind: BassFeedback) {
    note.state = kind;
    score += points[kind];
    if (kind === "miss") misses++; else hits++;
    if (kind === "miss" || kind === "bad") combo = 0; else combo++;
    maxCombo = Math.max(maxCombo, combo);
    feedback = kind;
    feedbackAge = 0;
  }
  function nearest(midi: number, time = elapsed) {
    return notes.filter(note => note.state === "pending" && note.midi === midi &&
      ![...contacts.values()].some(contact => contact.noteId === note.id) &&
      Math.abs(note.time - time) <= BASS_GOOD_WINDOW)
      .sort((a, b) => Math.abs(a.time - time) - Math.abs(b.time - time) || a.time - b.time)[0];
  }
  function wrong() { strayPlucks++; combo = 0; feedback = "miss"; feedbackAge = 0; }
  function beginInput(id: number, midi: number, time = elapsed) {
    if (isPaused || phase !== "playing" || contacts.has(id) || !Number.isInteger(midi) || midi < 28 || midi > 48) return null;
    // A hold detached by pause can be caught again without consuming a new note.
    const held = notes.find(note => note.state === "holding" && note.midi === midi &&
      ![...contacts.values()].some(contact => contact.noteId === note.id));
    const note = held ?? nearest(midi, time);
    const contact = { midi, time, noteId: note?.id ?? null, grade: grade(Math.abs(time - (note?.time ?? time))) };
    directInput = true;
    contacts.set(id, contact);
    if (!note) wrong();
    else if (held) contact.grade = "good";
    else if (note.kind === "hold") { note.state = "holding"; feedback = contact.grade; feedbackAge = 0; }
    else if (note.kind === "tap") finish(note, contact.grade);
    return { technique: note?.kind === "slap" ? "slap" as const : "pick" as const, noteId: note?.id ?? null };
  }
  function slapInput(id: number) {
    const contact = contacts.get(id);
    if (!contact || isPaused || phase !== "playing") return false;
    const note = notes.find(note => note.id === contact.noteId);
    if (!note || note.kind !== "slap" || note.state !== "pending") return false;
    finish(note, contact.grade);
    return true;
  }
  function endInput(id: number, cancelled = false, time = elapsed) {
    const contact = contacts.get(id);
    contacts.delete(id);
    if (!contact || isPaused || phase !== "playing") return;
    const note = notes.find(note => note.id === contact.noteId);
    if (!note) return;
    if (note.state === "holding") {
      const delta = Math.abs(time - note.endTime!);
      const endGrade = cancelled || delta > BASS_GOOD_WINDOW ? "miss" : grade(delta);
      finish(note, points[endGrade] < points[contact.grade] ? endGrade : contact.grade);
    } else if (note.kind === "slap" && note.state === "pending") finish(note, "miss");
  }
  function suspendInputs() { contacts.clear(); }


  function resetScore() {
    countdownRemaining = song().countdownSeconds;
    elapsed = score = combo = maxCombo = hits = misses = strayPlucks = feedbackAge = 0;
    feedback = null;
    contacts.clear();
    directInput = false;
    notes = (chart ?? song().notes).map((note) => ({ ...note, state: "pending" }));
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
      phase, songId: song().id, songTitle: song().title, countdownSeconds: song().countdownSeconds,
      audioOffsetSec: song().importInfo?.audioOffsetSec ?? 0,
      ...(song().importInfo ? { importSummary: { sourceCount: song().importInfo!.sourceNoteCount,
        candidateCount: song().importInfo!.candidateNoteCount, playableCount: song().notes.length,
        excludedCount: song().importInfo!.excluded.filter(n => n.reason === "outside-current-fretboard").length,
        audioSyncVerified: song().importInfo!.audioSyncVerified } } : {}),
      directInput, difficulty, bpm: song().bpm, beatSeconds: song().beatSeconds,
      beat: song().id === "garden-party" ? gardenTimeToBeat(phase === "countdown" ? -countdownRemaining : elapsed) :
        (phase === "countdown" ? -countdownRemaining : elapsed) / song().beatSeconds,
      proximityProgress: Math.min(1, proximityTime / BASS_PROXIMITY_SECONDS),
      pickupProgress: Math.min(1, pickupTime / BASS_PICKUP_SECONDS),
      countdown: phase === "countdown" ? Math.max(1, Math.ceil(countdownRemaining / song().beatSeconds)) : 0,
      countdownRemaining: phase === "countdown" ? countdownRemaining : 0,
      elapsed, duration: song().duration, score: penalizedScore, combo, maxCombo, hits, misses, strayPlucks,
      accuracy: Math.round(penalizedScore / Math.max(1, notes.filter(n => n.state !== "skipped").length * 1000) * 100),
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
        if (note.state === "holding") {
          if (elapsed > note.endTime! + BASS_GOOD_WINDOW) finish(note, "bad");
          continue;
        }
        const reserved = [...contacts.values()].find(contact => contact.noteId === note.id);
        const deadline = note.kind === "slap" && reserved ? Math.max(note.time + BASS_GOOD_WINDOW, reserved.time + 0.25) : note.time + BASS_GOOD_WINDOW;
        if (note.state !== "pending" || elapsed <= deadline) continue;
        note.state = "miss";
        misses++;
        combo = 0;
        feedback = "miss";
        feedbackAge = 0;
      }
      if (elapsed >= song().duration) {
        contacts.clear();
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

  function selectSong(id: BassSongId) {
    if (isPaused || !["ready", "result"].includes(phase) || !BASS_TRACKS.some(track => track.id === id)) return false;
    activeSong = id === "garden-party" ? BASS_SONGS[difficulty] : finalHitSong();
    resetScore(); phase = "ready"; return true;
  }
  function setAudioOffset(offset: number) {
    if (isPaused || !["ready", "result"].includes(phase) || song().id !== "final-hit" || !Number.isFinite(offset)) return false;
    try { activeSong = finalHitSong(offset); } catch { return false; }
    resetScore(); phase = "ready"; return true;
  }
  function seek(time: number) {
    if (phase !== "playing" || !Number.isFinite(time)) return false;
    resetScore(); elapsed = Math.max(0, Math.min(song().duration, time));
    notes.forEach(note => { if (note.time < elapsed - BASS_GOOD_WINDOW) note.state = "skipped"; });
    return true;
  }

  function setDifficulty(value: BassDifficulty) {
    if (song().id !== "garden-party" || isPaused || (phase !== "ready" && phase !== "result") ||
      typeof value !== "string" || !Object.hasOwn(BASS_SONGS, value)) return false;
    difficulty = value;
    activeSong = BASS_SONGS[difficulty];
    resetScore();
    phase = "ready";
    return true;
  }

  function pluck(string: BassString, technique: BassTechnique | null = "pick"): BassJudgement | null {
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
    if (!closest || difference > BASS_GOOD_WINDOW || (closest.technique !== null && closest.technique !== technique)) {
      strayPlucks++;
      combo = 0;
      feedback = "miss";
      return { kind: "miss", frequency: null, noteId: null };
    }
    const kind = difference <= BASS_PERFECT_WINDOW ? "perfect" : "good";
    finish(closest, kind);
    return { kind, frequency: closest.frequency, noteId: closest.id };
  }

  function cancel() {
    phase = "idle";
    isPaused = false;
    proximityTime = pickupTime = 0;
    resetScore();
  }

  return { tick, start, setDifficulty, selectSong, setAudioOffset, seek, pluck, beginInput, slapInput, endInput, suspendInputs, cancel, snapshot };
}
