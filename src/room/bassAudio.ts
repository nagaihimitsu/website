import { BASS_BEAT_SECONDS, BASS_COUNTDOWN_SECONDS, BASS_DURATION, type BassGameSnapshot } from "./bassGame";

type Sound = "count" | "kick" | "snare" | "hat" | "chord";
interface Event { time: number; sound: Sound; bar?: number }
const events: Event[] = [];
for (let beat = 0; beat < 3; beat++)
  events.push({ time: -BASS_COUNTDOWN_SECONDS + beat * BASS_BEAT_SECONDS, sound: "count" });
for (let beat = 0; beat < 32; beat++) {
  const time = beat * BASS_BEAT_SECONDS;
  events.push({ time, sound: beat % 2 === 0 ? "kick" : "snare" });
  events.push({ time, sound: "hat" }, { time: time + BASS_BEAT_SECONDS / 2, sound: "hat" });
  if (beat % 4 === 0) events.push({ time, sound: "chord", bar: beat / 4 });
}
events.sort((a, b) => a.time - b.time);

/** Procedural original backing: no downloaded song, sample, or third-party recording. */
export function createBassAudio() {
  let context: AudioContext | null = null;
  let master: GainNode | null = null;
  let noise: AudioBuffer | null = null;
  let disposed = false;
  let cursor = 0;
  let lastTimeline: number | null = null;
  const voices = new Set<AudioScheduledSourceNode>();

  function track(source: AudioScheduledSourceNode, nodes: AudioNode[], end: number) {
    voices.add(source);
    source.onended = () => {
      voices.delete(source);
      source.disconnect();
      for (const node of nodes) node.disconnect();
    };
    source.stop(end);
  }

  function tone(frequency: number, time: number, duration: number, volume: number, type: OscillatorType = "sine", bend?: number) {
    if (!context || !master) return;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, time);
    if (bend) oscillator.frequency.exponentialRampToValueAtTime(bend, time + duration * 0.7);
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(volume, time + 0.006);
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

  function schedule(event: Event, time: number) {
    switch (event.sound) {
      case "count": tone(660, time, 0.055, 0.1); break;
      case "kick": tone(115, time, 0.19, 0.28, "sine", 42); break;
      case "snare":
        hiss(time, 0.09, 0.085, 1400);
        tone(165, time, 0.06, 0.045, "triangle");
        break;
      case "hat": hiss(time, 0.035, 0.035, 6800); break;
      case "chord": {
        const roots = [52, 52, 48, 48, 55, 50, 52, 52];
        const root = roots[event.bar ?? 0];
        for (const interval of [0, root === 52 ? 3 : 4, 7])
          tone(440 * 2 ** ((root + interval - 69) / 12), time, 1.15, 0.016, "triangle");
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
      if (context.state === "suspended") void context.resume().catch(() => undefined);
    } catch {
      // Visual play remains available on browsers/devices without usable Web Audio.
      stop();
    }
  }

  function stop() {
    for (const voice of voices) {
      try { voice.stop(); } catch { /* A source may have ended since the previous frame. */ }
      voice.disconnect();
    }
    voices.clear();
    cursor = 0;
    lastTimeline = null;
  }

  /** Only schedules ~120 ms ahead, anchored to the same active time as visual notes. */
  function sync(snapshot: BassGameSnapshot, paused = false) {
    if (disposed) return;
    if (paused || (snapshot.phase !== "countdown" && snapshot.phase !== "playing")) {
      stop();
      return;
    }
    if (!context || context.state !== "running") return;
    const timeline = snapshot.phase === "countdown" ? -snapshot.countdownRemaining : snapshot.elapsed;
    if (lastTimeline === null || timeline < lastTimeline || timeline - lastTimeline > 0.25) {
      stop();
      cursor = events.findIndex((event) => event.time >= timeline - 0.02);
      if (cursor < 0) cursor = events.length;
    }
    lastTimeline = timeline;
    const audioNow = context.currentTime;
    while (cursor < events.length && events[cursor].time <= Math.min(BASS_DURATION, timeline + 0.12)) {
      const event = events[cursor++];
      if (event.time < timeline - 0.02) continue;
      schedule(event, audioNow + Math.max(0, event.time - timeline));
    }
  }

  function pluck(frequency: number | null) {
    if (disposed || !context || context.state !== "running") return;
    const time = context.currentTime;
    if (frequency === null) {
      tone(85, time, 0.045, 0.12, "triangle", 55);
      return;
    }
    tone(frequency, time, 0.43, 0.32, "triangle");
    tone(frequency * 2, time, 0.18, 0.065, "sine");
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
