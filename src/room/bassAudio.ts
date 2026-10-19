import { BASS_SONGS, type BassDifficulty, type BassGameSnapshot, type BassTechnique } from "./bassGame";

type Sound = "count" | "kick" | "snare" | "hat" | "chord";
interface Event { time: number; sound: Sound; midi?: number; minor?: boolean; accent?: number }

function backingEvents(difficulty: BassDifficulty): readonly Event[] {
  const song = BASS_SONGS[difficulty];
  const events: Event[] = [];
  const add = (beat: number, sound: Sound, extra: Partial<Event> = {}) => {
    if (beat < song.beats) events.push({ time: beat * song.beatSeconds, sound, ...extra });
  };
  for (let beat = 0; beat < 3; beat++)
    events.push({ time: -song.countdownSeconds + beat * song.beatSeconds, sound: "count" });
  for (let beat = 0; beat < song.beats; beat++) {
    const inBar = beat % 4;
    add(beat, "hat", { accent: difficulty === "easy" || inBar === 0 ? 1 : 0.85 });
    add(beat + song.swing, "hat", { accent: difficulty === "easy" ? 1 : 0.7 });
    if (difficulty === "easy") {
      add(beat, beat % 2 === 0 ? "kick" : "snare");
    } else {
      if (inBar === 1 || inBar === 3) add(beat, "snare");
      if (inBar === 0 || inBar === 2) add(beat, "kick");
      if (difficulty === "normal" && inBar === 2 && Math.floor(beat / 4) % 2 === 1)
        add(beat + song.swing, "kick", { accent: 0.65 });
      if (difficulty === "hard" && (inBar === 1 || (inBar === 3 && Math.floor(beat / 4) % 2 === 0)))
        add(beat + 0.5, "kick", { accent: 0.8 });
    }
  }
  for (let bar = 0; bar * 4 < song.beats; bar++) {
    // The rhythm section leaves rests between stabs. All melodic backing is
    // above the bass register, so missing a player note leaves a real gap.
    const offsets = difficulty === "easy" ? [0] : difficulty === "normal" ? [song.swing, 2 + song.swing] : [0, 1.5, 2.75, 3.5];
    for (const offset of offsets) {
      const beat = bar * 4 + offset;
      let chord = song.chords[0];
      for (const entry of song.chords) {
        if (entry.beat > beat) break;
        chord = entry;
      }
      if (chord) add(beat, "chord", { midi: chord.midi, minor: chord.minor });
    }
  }
  return events.sort((a, b) => a.time - b.time);
}
const backing = {
  easy: backingEvents("easy"), normal: backingEvents("normal"), hard: backingEvents("hard"),
};

/** Procedural original backing: no downloaded song, sample, or third-party recording. */
export function createBassAudio() {
  let context: AudioContext | null = null;
  let master: GainNode | null = null;
  let noise: AudioBuffer | null = null;
  let disposed = false;
  let difficulty: BassDifficulty | null = null;
  let cursor = 0;
  let lastTimeline: number | null = null;
  const voices = new Map<AudioScheduledSourceNode, AudioNode[]>();

  function track(source: AudioScheduledSourceNode, nodes: AudioNode[], end: number) {
    voices.set(source, nodes);
    source.onended = () => {
      voices.delete(source);
      source.disconnect();
      for (const node of nodes) node.disconnect();
    };
    source.stop(end);
  }

  function tone(frequency: number, time: number, duration: number, volume: number, type: OscillatorType = "sine", bend?: number, attack = 0.006) {
    if (!context || !master) return;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, time);
    if (bend) oscillator.frequency.exponentialRampToValueAtTime(bend, time + duration * 0.7);
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(volume, time + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    oscillator.connect(gain).connect(master);
    oscillator.start(time);
    track(oscillator, [gain], time + duration + 0.01);
  }

  function hiss(time: number, duration: number, volume: number, cutoff: number) {
    if (!context || !master || !noise) return;
    const source = context.createBufferSource();
    const gain = context.createGain();
    const filter = context.createBiquadFilter();
    source.buffer = noise;
    filter.type = "highpass";
    filter.frequency.setValueAtTime(cutoff, time);
    gain.gain.setValueAtTime(volume, time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    source.connect(filter).connect(gain).connect(master);
    source.start(time);
    track(source, [filter, gain], time + duration + 0.01);
  }

  function schedule(event: Event, time: number, mode: BassDifficulty) {
    const accent = event.accent ?? 1;
    switch (event.sound) {
      case "count": tone(660, time, 0.055, 0.1); break;
      case "kick": tone(115, time, 0.19, 0.28 * accent, "sine", 42); break;
      case "snare":
        hiss(time, 0.09, 0.085, 1400);
        tone(165, time, 0.06, 0.045, "triangle");
        break;
      case "hat": hiss(time, 0.035, 0.035 * accent, 6800); break;
      case "chord": {
        let root = 440 * 2 ** (((event.midi ?? 55) - 69) / 12);
        while (root < 180) root *= 2;
        const duration = mode === "easy" ? 1.15 : mode === "normal" ? 0.13 : 0.17;
        const volume = mode === "easy" ? 0.014 : 0.018;
        for (const interval of [0, event.minor ? 3 : 4, 7])
          tone(root * 2 ** (interval / 12), time, duration, volume, "triangle");
        if (mode === "hard") {
          // A restrained upper-register edge gives the original syncopated
          // rock accompaniment bite without doubling the playable bass line.
          tone(root * 2, time, 0.075, 0.008, "sawtooth");
        }
        break;
      }
    }
  }

  /** Call directly from a click/key handler. Merely standing nearby never creates audio. */
  function unlock() {
    if (disposed || typeof window === "undefined") return;
    try {
      if (!context) {
        const AudioContextConstructor = window.AudioContext ??
          (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AudioContextConstructor) return;
        context = new AudioContextConstructor();
        master = context.createGain();
        master.gain.value = 0.48;
        master.connect(context.destination);
        noise = context.createBuffer(1, Math.ceil(context.sampleRate * 0.25), context.sampleRate);
        const samples = noise.getChannelData(0);
        let seed = 8191;
        for (let index = 0; index < samples.length; index++) {
          seed = (seed * 1664525 + 1013904223) >>> 0;
          samples[index] = seed / 2147483648 - 1;
        }
      }
      // Safari can report "interrupted" after a device/app interruption. Resume
      // from either inactive state on this explicit gesture, never from sync().
      if (context.state !== "running" && context.state !== "closed")
        void context.resume().catch(() => undefined);
    } catch {
      // Visual play remains available on browsers/devices without usable Web Audio.
      stop();
    }
  }

  function stop() {
    for (const [voice, nodes] of voices) {
      try { voice.stop(); } catch { /* A source may have ended since the previous frame. */ }
      voice.onended = null;
      voice.disconnect();
      for (const node of nodes) node.disconnect();
    }
    voices.clear();
    cursor = 0;
    lastTimeline = null;
    difficulty = null;
  }

  /** Only schedules ~120 ms ahead, anchored to the same active time as visual notes. */
  function sync(snapshot: BassGameSnapshot, paused = false) {
    if (disposed) return;
    if (paused || (snapshot.phase !== "countdown" && snapshot.phase !== "playing")) {
      stop();
      return;
    }
    if (!context || context.state !== "running") return;
    const song = BASS_SONGS[snapshot.difficulty];
    const events = backing[snapshot.difficulty];
    const timeline = snapshot.phase === "countdown" ? -snapshot.countdownRemaining : snapshot.elapsed;
    if (difficulty !== snapshot.difficulty || lastTimeline === null || timeline < lastTimeline || timeline - lastTimeline > 0.25) {
      stop();
      difficulty = snapshot.difficulty;
      cursor = events.findIndex((event) => event.time >= timeline - 0.02);
      if (cursor < 0) cursor = events.length;
    }
    lastTimeline = timeline;
    const audioNow = context.currentTime;
    while (cursor < events.length && events[cursor].time <= Math.min(song.duration, timeline + 0.12)) {
      const event = events[cursor++];
      if (event.time < timeline - 0.02) continue;
      schedule(event, audioNow + Math.max(0, event.time - timeline), snapshot.difficulty);
    }
  }

  function pluck(frequency: number | null, technique: BassTechnique = "pick") {
    if (disposed || !context || context.state !== "running") return;
    const time = context.currentTime;
    if (frequency === null) {
      tone(85, time, 0.045, 0.12, "triangle", 55);
      return;
    }
    if (technique === "slap") {
      // Short, bright overtones and a string-on-fret transient distinguish a
      // thumb strike from the rounder picked note, at the same musical pitch.
      tone(frequency, time, 0.27, 0.32, "sine", undefined, 0.001);
      tone(frequency * 2, time, 0.13, 0.11, "triangle", undefined, 0.001);
      tone(frequency * 3, time, 0.075, 0.065, "triangle", undefined, 0.001);
      tone(frequency * 5, time, 0.045, 0.035, "sine", undefined, 0.001);
      hiss(time, 0.038, 0.07, 2700);
      return;
    }
    tone(frequency, time, 0.34, 0.32, "triangle");
    tone(frequency * 2, time, 0.15, 0.065, "sine");
    hiss(time, 0.018, 0.025, 2400);
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    stop();
    master?.disconnect();
    if (context && context.state !== "closed") void context.close().catch(() => undefined);
    context = null;
    master = null;
    noise = null;
  }

  return { unlock, sync, pluck, stop, dispose };
}
