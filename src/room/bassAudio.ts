import backingUrl from "../assets/audio/garden-party-backing.mp3?url";
import finalHitUrl from "../assets/audio/final-hit.mp3?url";
import bassUrl from "../assets/audio/garden-party-bass.mp3?url";
import { BASS_SONGS, type BassGameSnapshot, type BassTechnique, type BassSongId } from "./bassGame";
import { BASS_GESTURE_CONFIG } from "./bassGesture";

export type BassAudioStatus = "idle" | "loading" | "ready" | "error" | "unavailable";
type Stems = readonly [AudioBuffer, AudioBuffer];
type Bytes = readonly [ArrayBuffer, ArrayBuffer];
type Window = { start: number; end: number };
const ATTACK = 0.006;
const RELEASE = 0.012;
const DRIFT_LIMIT = 0.12;
const SUCCESS_BASS_GAIN = 2; // +6 dB relative to the accompaniment.

/** The supplied recording and its isolated bass share one sample-accurate transport. */
export function createBassAudio(onStatusChange?: (status: BassAudioStatus) => void) {
  let context: AudioContext | null = null;
  let master: GainNode | null = null;
  let state: BassAudioStatus = "idle";
  let disposed = false;
  let generation = 0;
  let songId: BassSongId = "garden-party";
  const cache = new Map<BassSongId, { bytes?: Bytes; stems?: Stems }>();
  let bytes: Bytes | null = null;
  let stems: Stems | null = null;
  let loading: Promise<boolean> | null = null;
  let preparing: Promise<boolean> | null = null;
  let resuming: Promise<void> | null = null;
  let controller: AbortController | null = null;
  let transport: { sources: AudioBufferSourceNode[]; gains: GainNode[]; anchor: number; difficulty: string } | null = null;
  let windows: Window[] = [];
  const heldVoices = new Map<number, { source: AudioBufferSourceNode; gain: GainNode; start: number; midi: number; sustained: boolean; volume: number }>();
  const seenHits = new Set<number>();
  const countTicks = new Set<number>();
  const voices = new Map<AudioScheduledSourceNode, AudioNode[]>();

  function setStatus(status: BassAudioStatus) {
    if (disposed || state === status) return;
    state = status;
    onStatusChange?.(status);
  }

  function selectSong(id: BassSongId) {
    if (disposed || !["garden-party", "final-hit", "technique-study"].includes(id)) return false;
    if (id === "technique-study") id = "garden-party";
    if (id === songId) return true;
    generation++;
    controller?.abort(); controller = null;
    stop();
    songId = id;
    bytes = cache.get(id)?.bytes ?? null;
    stems = cache.get(id)?.stems ?? null;
    loading = preparing = null;
    setStatus(stems ? "ready" : "idle");
    return true;
  }

  /** Fetching is silent and does not create or unlock an AudioContext. */
  function preload(): Promise<boolean> {
    if (disposed) return Promise.resolve(false);
    if (bytes) return Promise.resolve(true);
    if (loading) return loading;
    const requestGeneration = generation;
    const request = new AbortController();
    controller = request;
    setStatus("loading");
    const load = Promise.all([songId === "final-hit" ? finalHitUrl : backingUrl, bassUrl].map(async (url) => {
      const response = await fetch(url, { signal: request.signal });
      if (!response.ok) throw new Error("The music file could not be loaded.");
      return response.arrayBuffer();
    })).then((result) => {
      if (disposed || requestGeneration !== generation) return false;
      bytes = result as unknown as Bytes;
      cache.set(songId, { ...cache.get(songId), bytes });
      if (!preparing) setStatus("idle");
      return true;
    }).catch(() => {
      request.abort();
      if (!disposed && requestGeneration === generation) setStatus("error");
      return false;
    }).finally(() => {
      if (loading === load) loading = null;
      if (controller === request) controller = null;
    });
    loading = load;
    return load;
  }

  /** Call directly from a click/key handler; proximity alone never unlocks sound. */
  function unlock() {
    if (disposed || typeof window === "undefined") return;
    try {
      if (!context) {
        const AudioContextConstructor = window.AudioContext ??
          (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AudioContextConstructor) { setStatus("unavailable"); return; }
        context = new AudioContextConstructor({ latencyHint: "interactive" });
        master = context.createGain();
        // Leave mix headroom; successful bass segments have their own boost.
        master.gain.value = 0.9;
        master.connect(context.destination);
      }
      if (context.state !== "running" && context.state !== "closed" && !resuming) {
        stop(); // An interrupted device clock invalidates the old playback anchor.
        const resume = context.resume().then(() => {
          if (context?.state === "running" && stems) setStatus("ready");
        }).catch(() => { setStatus("unavailable"); }).finally(() => {
          if (resuming === resume) resuming = null;
        });
        resuming = resume;
      }
    } catch {
      stop();
      setStatus("unavailable");
    }
  }

  /** Decode after unlock(), before the engine starts its countdown. Safe to retry. */
  function prepare(): Promise<boolean> {
    if (disposed) return Promise.resolve(false);
    if (preparing) return preparing;
    if (!context || !master) { setStatus("unavailable"); return Promise.resolve(false); }
    const audio = context;
    const requestGeneration = generation;
    setStatus("loading");
    const preparation = (async () => {
      if (resuming) await resuming;
      if (audio.state !== "running" || disposed || requestGeneration !== generation) return false;
      if (!stems) {
        if (!await preload() || !bytes || disposed || requestGeneration !== generation) return false;
        // decodeAudioData may detach its input; preserve fetched bytes for an explicit retry.
        const decoded = await Promise.all(bytes.map((data) => audio.decodeAudioData(data.slice(0))));
        if (disposed || requestGeneration !== generation) return false;
        if (decoded.some((buffer) => !Number.isFinite(buffer.duration) || buffer.duration <= 0) ||
          (songId === "garden-party" && Math.abs(decoded[0].duration - decoded[1].duration) > 0.05)) throw new Error("Unaligned music stems.");
        stems = decoded as unknown as Stems;
        cache.set(songId, { ...cache.get(songId), stems });
      }
      if (audio.state !== "running") { setStatus("unavailable"); return false; }
      setStatus("ready");
      return true;
    })().catch(() => {
      if (!disposed && requestGeneration === generation) setStatus("error");
      return false;
    }).finally(() => {
      if (preparing === preparation) preparing = null;
      if (!disposed && requestGeneration === generation && state === "loading") setStatus(audio.state === "running" ? "error" : "unavailable");
    });
    preparing = preparation;
    return preparation;
  }

  function clearVoices() {
    for (const [source, nodes] of voices) {
      source.onended = null;
      try { source.stop(); } catch { /* A source can already have ended. */ }
      source.disconnect();
      nodes.forEach((node) => node.disconnect());
    }
    voices.clear();
    heldVoices.clear();
  }

  function stopTransport() {
    if (transport) {
      transport.sources.forEach((source) => {
        source.onended = null;
        try { source.stop(); } catch { /* A source can already have ended. */ }
        source.disconnect();
      });
      transport.gains.forEach((gain) => gain.disconnect());
      transport = null;
    }
    windows = [];
    seenHits.clear();
    countTicks.clear();
  }

  /** Keep decoded music for replay; pause/put-down cancels every scheduled sound. */
  function stop() {
    stopTransport();
    clearVoices();
  }

  function tone(frequency: number, time: number, duration: number, volume: number) {
    if (!context || !master) return;
    const source = context.createOscillator();
    const gain = context.createGain();
    source.type = "sine";
    source.frequency.setValueAtTime(frequency, time);
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(volume, time + 0.003);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    source.connect(gain).connect(master);
    voices.set(source, [gain]);
    source.onended = () => {
      voices.delete(source);
      source.disconnect();
      gain.disconnect();
    };
    source.start(time);
    source.stop(time + duration + 0.01);
  }

  function startTransport(snapshot: BassGameSnapshot, timeline: number) {
    if (!context || !master || !stems) return;
    stop();
    const now = context.currentTime;
    const offset = Math.max(0, timeline);
    if (songId === "garden-party" && offset >= Math.min(stems[0].duration, stems[1].duration)) return;
    const anchor = now - timeline;
    const when = Math.max(now, anchor);
    const sources: AudioBufferSourceNode[] = [];
    const gains: GainNode[] = [];
    for (const [index, buffer] of stems.entries()) {
      if ((songId === "final-hit" && index === 1) || offset >= buffer.duration) continue;
      const source = context.createBufferSource();
      const gain = context.createGain();
      source.buffer = buffer;
      source.loop = false;
      gain.gain.value = index === 0 ? 1 : 0;
      source.connect(gain).connect(master);
      sources.push(source);
      gains.push(gain);
      source.start(when, offset);
    }
    transport = { sources, gains, anchor, difficulty: `${songId}:${snapshot.difficulty}` };
  }

  function levelAt(time: number, intervals: Window[]) {
    return intervals.reduce((level, interval) => {
      if (time < interval.start || time >= interval.end) return level;
      const attack = Math.min(ATTACK, (interval.end - interval.start) / 2);
      const release = Math.min(RELEASE, (interval.end - interval.start) / 2);
      return Math.max(level, Math.min(1, (time - interval.start) / attack, (interval.end - time) / release));
    }, 0);
  }

  function scheduleGate(snapshot: BassGameSnapshot, timeline: number) {
    if (!context || !transport) return;
    const prior = windows;
    let changed = false;
    for (let index = 0; index < snapshot.notes.length; index++) {
      const note = snapshot.notes[index];
      if ((note.state !== "perfect" && note.state !== "good") || seenHits.has(note.id)) continue;
      seenHits.add(note.id);
      const start = Math.max(note.time, timeline);
      const end = Math.min(snapshot.notes[index + 1]?.time ?? snapshot.duration,
        stems![1].duration, snapshot.duration);
      if (end > start) { windows = [...windows, { start, end }]; changed = true; }
    }
    if (!changed) return;
    const now = context.currentTime;
    const parameter = transport.gains[1].gain;
    // Merge adjoining successful segments. A missed next note leaves its entire
    // interval muted; two early successes sustain naturally through their boundary.
    const merged: Window[] = [];
    for (const interval of [...windows].sort((a, b) => a.start - b.start)) {
      const last = merged[merged.length - 1];
      if (last && interval.start <= last.end + 1e-6) last.end = Math.max(last.end, interval.end);
      else merged.push({ ...interval });
    }
    windows = merged;
    parameter.cancelScheduledValues(now);
    const oldLevel = levelAt(timeline, prior) * SUCCESS_BASS_GAIN;
    parameter.setValueAtTime(oldLevel, now);
    for (const interval of windows) {
      if (interval.end <= timeline) continue;
      const attack = Math.min(ATTACK, (interval.end - interval.start) / 2);
      const release = Math.min(RELEASE, (interval.end - interval.start) / 2);
      const start = Math.max(now, transport.anchor + interval.start);
      const end = transport.anchor + interval.end;
      if (start > now) parameter.setValueAtTime(0, start);
      const riseEnd = Math.min(end - release, Math.max(start + attack, now + ATTACK));
      if (riseEnd > now) parameter.linearRampToValueAtTime(SUCCESS_BASS_GAIN, riseEnd);
      parameter.setValueAtTime(SUCCESS_BASS_GAIN, Math.max(now, end - release));
      parameter.linearRampToValueAtTime(0, end);
    }
  }

  /** One continuous recording; slow rendered frames do not restart or age the music. */
  function sync(snapshot: BassGameSnapshot, paused = false) {
    if (disposed) return;
    selectSong(snapshot.songId ?? "garden-party");
    if (paused || (snapshot.phase !== "countdown" && snapshot.phase !== "playing")) { stop(); return; }
    if (!context || context.state !== "running") {
      stop();
      if (context) setStatus("unavailable");
      return;
    }
    if (!stems) return;
    if (state === "unavailable") setStatus("ready");
    const timeline = snapshot.phase === "countdown" ? -snapshot.countdownRemaining : snapshot.elapsed;
    if (!transport || transport.difficulty !== `${songId}:${snapshot.difficulty}` ||
      Math.abs(context.currentTime - transport.anchor - timeline) > DRIFT_LIMIT) startTransport(snapshot, timeline);
    if (!transport) return;
    const song = { beatSeconds: snapshot.beatSeconds, countdownSeconds: snapshot.countdownSeconds ?? BASS_SONGS[snapshot.difficulty].countdownSeconds };
    if (snapshot.phase === "countdown") {
      for (let index = 0; index < Math.round(song.countdownSeconds / song.beatSeconds); index++) {
        const tick = -song.countdownSeconds + index * song.beatSeconds;
        if (countTicks.has(index) || tick < timeline - 0.02 || tick > timeline + 0.12) continue;
        countTicks.add(index);
        tone(660, Math.max(context.currentTime, transport.anchor + tick), 0.05, 0.075);
      }
    }
    if (songId === "garden-party" && !snapshot.directInput) scheduleGate(snapshot, timeline);
  }

  /** Compatibility entry point for callers of the original string-based API. */
  function pluck(frequency: number | null, _technique: BassTechnique = "pick",
    snapshot?: BassGameSnapshot, noteId?: number | null) {
    if (disposed || !context || context.state !== "running") return;
    if (frequency === null) {
      tone(85, context.currentTime, 0.03, 0.035);
      return;
    }
    if (snapshot && noteId !== null && noteId !== undefined &&
      snapshot.notes.some((note) => note.id === noteId && (note.state === "perfect" || note.state === "good"))) sync(snapshot);
  }


  /** Reuse the isolated G1 attack as a pitched sampler. One source per contact,
   * including wrong notes. Slap uses the same attack with a stronger envelope;
   * gesture confirmation never starts a second source. */
  function playMidi(id: number, midi: number, technique: BassTechnique, hold: boolean) {
    if (disposed || !context || !master || !stems || context.state !== "running" || heldVoices.has(id)) return;
    const source = context.createBufferSource();
    const gain = context.createGain();
    const now = context.currentTime;
    source.buffer = stems[1];
    source.playbackRate.value = 2 ** ((midi - 31) / 12);
    source.loop = true;
    source.loopStart = 0.39;
    source.loopEnd = 0.55;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime((technique === "slap" ? 1.8 : 1.35) * (songId === "final-hit" ? 0.45 : 1), now + 0.004);
    if (!hold) gain.gain.linearRampToValueAtTime(0, now + 0.35);
    source.connect(gain).connect(master);
    voices.set(source, [gain]);
    heldVoices.set(id, { source, gain, start: now, midi, sustained: hold, volume: (technique === "slap" ? 1.8 : 1.35) * (songId === "final-hit" ? 0.45 : 1) });
    source.onended = () => {
      voices.delete(source);
      if (heldVoices.get(id)?.source === source) heldVoices.delete(id);
      source.disconnect();
      gain.disconnect();
    };
    source.start(now, 0.317);
    source.stop(now + (hold ? 30 : 0.36));
  }
  /** 同じサンプラーの再生率だけを補間し、通過フレットでは再発音しない。 */
  function bendMidi(id: number, midi: number) {
    const voice = heldVoices.get(id);
    if (!voice || !context || context.state !== "running" || !Number.isFinite(midi)) return false;
    const now = context.currentTime;
    if (!voice.sustained) {
      voice.sustained = true;
      voice.gain.gain.cancelScheduledValues(now);
      voice.gain.gain.setValueAtTime(voice.gain.gain.value, now);
      voice.gain.gain.linearRampToValueAtTime(voice.volume, now + BASS_GESTURE_CONFIG.pitchRampSeconds);
      voice.source.stop(now + 30);
    }
    const rate = voice.source.playbackRate;
    const target = 2 ** ((Math.max(28, Math.min(48, midi)) - 31) / 12);
    // cancelAndHold preserves the value inside an in-flight ramp on Safari/Chromium.
    if (rate.cancelAndHoldAtTime) rate.cancelAndHoldAtTime(now);
    else { rate.cancelScheduledValues(now); rate.setValueAtTime(rate.value, now); }
    rate.linearRampToValueAtTime(target, now + BASS_GESTURE_CONFIG.pitchRampSeconds);
    voice.midi = midi;
    return true;
  }
  function releaseMidi(id: number) {
    const voice = heldVoices.get(id);
    if (!voice || !context) return;
    heldVoices.delete(id);
    const end = Math.max(context.currentTime, voice.start + 0.1);
    if (voice.gain.gain.cancelAndHoldAtTime) voice.gain.gain.cancelAndHoldAtTime(end);
    else {
      voice.gain.gain.cancelScheduledValues(end);
      voice.gain.gain.setValueAtTime(voice.gain.gain.value, end);
    }
    voice.gain.gain.linearRampToValueAtTime(0, end + 0.025);
    voice.source.stop(end + 0.03);
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    generation++;
    controller?.abort();
    controller = null;
    stop();
    master?.disconnect();
    if (context && context.state !== "closed") void context.close().catch(() => undefined);
    context = null;
    master = null;
    bytes = null;
    stems = null;
    cache.clear();
  }

  /** Musical time comes from the sample clock, including the negative count-in. */
  function playbackTime(): number | null {
    if (!context || context.state !== "running" || !transport) return null;
    return context.currentTime - transport.anchor;
  }

  return { unlock, preload, prepare, selectSong, seek: (snapshot: BassGameSnapshot, paused = false) => { stop(); sync(snapshot, paused); }, status: () => state,
    isRunning: () => context?.state === "running", playbackTime, sync, pluck, playMidi, bendMidi, releaseMidi, stop, dispose };
}
