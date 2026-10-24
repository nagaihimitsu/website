import { afterEach, describe, expect, it, vi } from "vitest";
import { createBassAudio, type BassAudioStatus } from "../src/room/bassAudio";
import { BASS_SONGS, createBassGame, type BassGameSnapshot } from "../src/room/bassGame";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function installAudio() {
  const parameter = () => ({ value: 0, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(), cancelScheduledValues: vi.fn() });
  const node = () => ({ connect: vi.fn(function (this: unknown, destination: unknown) { return destination; }), disconnect: vi.fn() });
  function source(kind: "recording" | "tone") {
    return { ...node(), kind, buffer: null as unknown, loop: false, playbackRate: parameter(), loopStart: 0, loopEnd: 0, type: "sine", frequency: parameter(),
      start: vi.fn(), stop: vi.fn(), onended: null as (() => void) | null };
  }
  const sources: ReturnType<typeof source>[] = [];
  const gains: { gain: ReturnType<typeof parameter>; disconnect: ReturnType<typeof vi.fn> }[] = [];
  const context = {
    state: "running", currentTime: 10, destination: node(),
    createGain: () => { const gain = { ...node(), gain: parameter() }; gains.push(gain); return gain; },
    createBufferSource: () => { const voice = source("recording"); sources.push(voice); return voice; },
    createOscillator: () => { const voice = source("tone"); sources.push(voice); return voice; },
    decodeAudioData: vi.fn(async () => ({ duration: 56.14 } as AudioBuffer)),
    resume: vi.fn(async () => { context.state = "running"; }), close: vi.fn(async () => { context.state = "closed"; }),
  };
  const constructor = vi.fn(function () { return context; });
  const fetcher = vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(16) }));
  vi.stubGlobal("window", { AudioContext: constructor });
  vi.stubGlobal("fetch", fetcher);
  return { context, sources, gains, constructor, fetcher,
    recordings: () => sources.filter((voice) => voice.kind === "recording"),
    tones: () => sources.filter((voice) => voice.kind === "tone") };
}

function snapshot(elapsed = 0): BassGameSnapshot {
  const song = BASS_SONGS.easy;
  return { ...createBassGame().snapshot(), phase: "playing", elapsed, duration: song.duration,
    notes: [1, 2, 3].map((time, id) => ({ ...song.notes[0], id, time, state: "pending" as const })) };
}
function success(state: BassGameSnapshot, index: number) {
  state.notes = state.notes.map((note, id) => id === index ? { ...note, state: "perfect" } : note);
  return state;
}
async function ready() {
  const fake = installAudio();
  const audio = createBassAudio();
  audio.unlock();
  expect(await audio.prepare()).toBe(true);
  return { ...fake, audio };
}

describe("recorded bass transport", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("prefetches without an audio context, then caches both decoded stems across replay", async () => {
    const { constructor, fetcher, context, recordings } = installAudio();
    const audio = createBassAudio();
    expect(await audio.preload()).toBe(true);
    expect(constructor).not.toHaveBeenCalled();
    expect(context.decodeAudioData).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledTimes(2);
    audio.unlock();
    expect(await audio.prepare()).toBe(true);
    expect(constructor).toHaveBeenCalledTimes(1);
    expect(context.decodeAudioData).toHaveBeenCalledTimes(2);
    audio.sync(snapshot());
    expect(recordings()).toHaveLength(2);
    expect(recordings().map((voice) => voice.start.mock.calls)).toEqual([[[10, 0]], [[10, 0]]]);
    audio.stop();
    expect(await audio.prepare()).toBe(true);
    audio.sync(snapshot());
    expect(recordings()).toHaveLength(4);
    expect(context.decodeAudioData).toHaveBeenCalledTimes(2);
    expect(fetcher).toHaveBeenCalledTimes(2);
    audio.dispose();
  });

  it("uses identical future start times for both stems after the four-beat count-in", async () => {
    const { audio, recordings, tones, context } = await ready();
    const remaining = BASS_SONGS.easy.countdownSeconds;
    const state = { ...snapshot(), phase: "countdown" as const, countdownRemaining: remaining };
    audio.sync(state);
    expect(recordings().map((voice) => voice.start.mock.calls[0])).toEqual([[10 + remaining, 0], [10 + remaining, 0]]);
    expect(tones()).toHaveLength(1);
    audio.sync(state);
    expect(tones()).toHaveLength(1);
    context.currentTime += remaining;
    audio.sync(snapshot());
    expect(recordings()).toHaveLength(2);
    audio.dispose();
  });

  it("exposes sample-clock musical time through countdown and playback, but not while stopped or interrupted", async () => {
    const { audio, context } = await ready();
    expect(audio.playbackTime()).toBeNull();
    const remaining = BASS_SONGS.easy.countdownSeconds;
    audio.sync({ ...snapshot(), phase: "countdown", countdownRemaining: remaining });
    expect(audio.playbackTime()).toBeCloseTo(-remaining, 10);
    context.currentTime += 0.4;
    expect(audio.playbackTime()).toBeCloseTo(-remaining + 0.4, 10);
    context.currentTime = 10 + remaining + 0.25;
    audio.sync(snapshot(0.25));
    expect(audio.playbackTime()).toBeCloseTo(0.25, 10);
    // No wall-time or frame-time estimate replaces a running device's sample clock.
    context.currentTime += 0.17;
    expect(audio.playbackTime()).toBeCloseTo(0.42, 10);
    context.state = "interrupted";
    expect(audio.playbackTime()).toBeNull();
    audio.sync(snapshot(0.42));
    audio.unlock();
    await audio.prepare();
    expect(audio.playbackTime()).toBeNull();
    context.currentTime = 50;
    audio.sync(snapshot(0.42));
    expect(audio.playbackTime()).toBeCloseTo(0.42, 10);
    audio.sync(snapshot(0.42), true);
    expect(audio.playbackTime()).toBeNull();
    audio.dispose();
    expect(audio.playbackTime()).toBeNull();
  });

  it("keeps a continuous source through slow frames and seeks both stems after pause or true drift", async () => {
    const { audio, context, recordings } = await ready();
    audio.sync(snapshot());
    context.currentTime = 10.8; // An 800 ms render stall, with no audio/game drift.
    audio.sync(snapshot(0.8));
    expect(recordings()).toHaveLength(2);
    audio.sync(snapshot(0.8), true);
    for (const source of recordings()) expect(source.stop).toHaveBeenCalledWith();
    context.currentTime = 40;
    audio.sync(snapshot(0.8));
    expect(recordings().slice(2).map((voice) => voice.start.mock.calls[0])).toEqual([[40, 0.8], [40, 0.8]]);
    context.currentTime = 41;
    audio.sync(snapshot(5)); // Real interruption or an explicit test-clock seek.
    expect(recordings().slice(4).map((voice) => voice.start.mock.calls[0])).toEqual([[41, 5], [41, 5]]);
    audio.dispose();
  });

  it("keeps bass muted until a successful note and schedules early success at the note itself", async () => {
    const { audio, context, gains, tones } = await ready();
    audio.sync(snapshot());
    const gate = gains[2].gain;
    expect(gate.value).toBe(0);
    expect(gate.linearRampToValueAtTime).not.toHaveBeenCalled();
    context.currentTime = 10.9;
    audio.pluck(82.4, "pick", success(snapshot(0.9), 0), 0);
    expect(gate.setValueAtTime).toHaveBeenCalledWith(0, 11);
    expect(gate.linearRampToValueAtTime).toHaveBeenCalledWith(2, 11.006);
    expect(gate.linearRampToValueAtTime).toHaveBeenCalledWith(0, 12);
    expect(tones()).toHaveLength(0); // Success reveals the real bass, never doubled synth.
    const scheduled = gate.linearRampToValueAtTime.mock.calls.length;
    context.currentTime = 12.3;
    const missed = success(snapshot(2.3), 0);
    missed.notes = missed.notes.map((note, id) => id === 1 ? { ...note, state: "miss" } : note);
    audio.sync(missed);
    expect(gate.linearRampToValueAtTime).toHaveBeenCalledTimes(scheduled);
    audio.dispose();
  });

  it("opens only the remainder of a late hit and never retroactively plays its missed beginning", async () => {
    const { audio, context, gains } = await ready();
    audio.sync(snapshot());
    context.currentTime = 11.14;
    audio.pluck(82.4, "slap", success(snapshot(1.14), 0), 0);
    const gate = gains[2].gain;
    expect(gate.cancelScheduledValues).toHaveBeenCalledWith(11.14);
    expect(gate.linearRampToValueAtTime).toHaveBeenCalledWith(2, 11.146);
    expect(gate.linearRampToValueAtTime).toHaveBeenCalledWith(0, 12);
    for (const [, time] of gate.setValueAtTime.mock.calls) expect(time).toBeGreaterThanOrEqual(11.14);
    audio.dispose();
  });

  it("sustains adjacent successful notes and stops at the next unplayed note", async () => {
    const { audio, context, gains } = await ready();
    audio.sync(snapshot());
    context.currentTime = 10.95;
    audio.pluck(82.4, "pick", success(snapshot(0.95), 0), 0);
    context.currentTime = 11.95;
    const next = success(success(snapshot(1.95), 0), 1);
    audio.pluck(82.4, "slap", next, 1);
    const gate = gains[2].gain;
    expect(gate.cancelScheduledValues).toHaveBeenLastCalledWith(11.95);
    expect(gate.linearRampToValueAtTime).toHaveBeenLastCalledWith(0, 13);
    // The old scheduled fade at 12 is canceled, not left under the sustained segment.
    expect(gate.setValueAtTime).toHaveBeenLastCalledWith(2, 12.988);
    audio.dispose();
  });

  it("makes a failed strike quiet without opening the stem or adding a pitched accompaniment", async () => {
    const { audio, gains, tones } = await ready();
    audio.sync(snapshot());
    audio.pluck(null, "slap", snapshot(), null);
    expect(tones()).toHaveLength(1);
    expect(gains[2].gain.linearRampToValueAtTime).not.toHaveBeenCalled();
    expect(gains[3].gain.linearRampToValueAtTime).toHaveBeenCalledWith(0.035, 10.003);
    audio.dispose();
  });

  it("reports a failed fetch, retries explicitly and shares concurrent preparations", async () => {
    const { fetcher, context } = installAudio();
    const statuses: BassAudioStatus[] = [];
    const audio = createBassAudio((status) => statuses.push(status));
    fetcher.mockRejectedValueOnce(new Error("offline"));
    audio.unlock();
    expect(await audio.prepare()).toBe(false);
    expect(audio.status()).toBe("error");
    expect(context.decodeAudioData).not.toHaveBeenCalled();
    const retry = audio.prepare();
    expect(audio.prepare()).toBe(retry);
    expect(await retry).toBe(true);
    expect(audio.status()).toBe("ready");
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(statuses).toContain("error");
    audio.dispose();
  });

  it("reports corrupt or unaligned recordings without starting a partial band", async () => {
    const { context, recordings } = installAudio();
    const audio = createBassAudio();
    context.decodeAudioData.mockResolvedValueOnce({ duration: 55 } as AudioBuffer);
    audio.unlock();
    expect(await audio.prepare()).toBe(false);
    expect(audio.status()).toBe("error");
    audio.sync(snapshot());
    expect(recordings()).toHaveLength(0);
    expect(await audio.prepare()).toBe(true);
    audio.dispose();
  });

  it("never resurrects audio or publishes ready after disposal during decoding", async () => {
    const { context, recordings } = installAudio();
    const statuses: BassAudioStatus[] = [];
    const pending = deferred<AudioBuffer>();
    context.decodeAudioData.mockReturnValue(pending.promise);
    const audio = createBassAudio((status) => statuses.push(status));
    audio.unlock();
    const preparation = audio.prepare();
    await vi.waitFor(() => expect(context.decodeAudioData).toHaveBeenCalledTimes(2));
    audio.dispose();
    pending.resolve({ duration: 56.14 } as AudioBuffer);
    expect(await preparation).toBe(false);
    audio.sync(snapshot());
    expect(statuses).not.toContain("ready");
    expect(recordings()).toHaveLength(0);
    expect(context.close).toHaveBeenCalledTimes(1);
    audio.dispose();
    expect(context.close).toHaveBeenCalledTimes(1);
  });

  it("aborts pending fetches on disposal and ignores a late response", async () => {
    const { fetcher, constructor } = installAudio();
    const pending = deferred<{ ok: boolean; arrayBuffer: () => Promise<ArrayBuffer> }>();
    fetcher.mockReturnValue(pending.promise);
    const audio = createBassAudio();
    const loading = audio.preload();
    const signal = (fetcher.mock.calls[0] as unknown as [string, { signal: AbortSignal }])[1].signal;
    audio.dispose();
    expect(signal.aborted).toBe(true);
    pending.resolve({ ok: true, arrayBuffer: async () => new ArrayBuffer(16) });
    expect(await loading).toBe(false);
    expect(constructor).not.toHaveBeenCalled();
  });

  it("resumes Safari interruption only on a gesture and cleans every source and gain", async () => {
    const { audio, context, recordings, gains } = await ready();
    audio.sync(snapshot());
    context.state = "interrupted";
    audio.sync(snapshot(0.5));
    expect(context.resume).not.toHaveBeenCalled();
    expect(recordings()).toHaveLength(2);
    audio.unlock();
    expect(context.resume).toHaveBeenCalledTimes(1);
    await audio.prepare();
    context.currentTime = 50;
    audio.sync(snapshot(0.5));
    expect(recordings().slice(2).map((voice) => voice.start.mock.calls[0])).toEqual([[50, 0.5], [50, 0.5]]);
    audio.dispose();
    for (const source of recordings()) {
      expect(source.stop).toHaveBeenCalledWith();
      expect(source.disconnect).toHaveBeenCalled();
    }
    for (const gain of gains) expect(gain.disconnect).toHaveBeenCalled();
  });

  it("reports active interruptions so the engine can freeze time, then resumes cached audio on a gesture", async () => {
    const { context, recordings, fetcher } = installAudio();
    const statuses: BassAudioStatus[] = [];
    const audio = createBassAudio((status) => statuses.push(status));
    expect(audio.isRunning()).toBe(false);
    audio.unlock();
    await audio.prepare();
    audio.sync(snapshot());
    expect(audio.isRunning()).toBe(true);
    context.state = "interrupted";
    audio.sync(snapshot(0.5));
    expect(audio.isRunning()).toBe(false);
    expect(audio.status()).toBe("unavailable");
    expect(statuses.at(-1)).toBe("unavailable");
    for (const source of recordings()) expect(source.stop).toHaveBeenCalledWith();
    audio.sync(snapshot(0.5));
    expect(recordings()).toHaveLength(2);
    expect(context.resume).not.toHaveBeenCalled();
    audio.unlock();
    expect(await audio.prepare()).toBe(true);
    expect(audio.isRunning()).toBe(true);
    expect(audio.status()).toBe("ready");
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(context.decodeAudioData).toHaveBeenCalledTimes(2);
    context.currentTime = 50;
    audio.sync(snapshot(0.5));
    expect(recordings().slice(2).map((voice) => voice.start.mock.calls[0])).toEqual([[50, 0.5], [50, 0.5]]);
    // A normal UI pause must not be presented as an audio failure.
    audio.sync(snapshot(0.5), true);
    expect(audio.status()).toBe("ready");
    audio.dispose();
    expect(audio.isRunning()).toBe(false);
  });

  it("clears the unavailable status when the browser itself resumes its audio context", async () => {
    const { context, recordings, fetcher } = installAudio();
    const statuses: BassAudioStatus[] = [];
    const audio = createBassAudio((status) => statuses.push(status));
    audio.unlock();
    await audio.prepare();
    audio.sync(snapshot());
    context.state = "interrupted";
    audio.sync(snapshot(0.75));
    expect(audio.status()).toBe("unavailable");
    context.state = "running"; // Device/browser recovery, with no resume button press.
    context.currentTime = 40;
    audio.sync(snapshot(0.75));
    expect(audio.status()).toBe("ready");
    expect(statuses.slice(-2)).toEqual(["unavailable", "ready"]);
    expect(recordings().slice(2).map((voice) => voice.start.mock.calls[0])).toEqual([[40, 0.75], [40, 0.75]]);
    expect(context.resume).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(context.decodeAudioData).toHaveBeenCalledTimes(2);
    audio.dispose();
  });

  it("does not start after interruption during decode, but preserves both decoded stems for the retry", async () => {
    const { context, recordings, fetcher } = installAudio();
    const pending = deferred<AudioBuffer>();
    const statuses: BassAudioStatus[] = [];
    context.decodeAudioData.mockReturnValue(pending.promise);
    const audio = createBassAudio((status) => statuses.push(status));
    audio.unlock();
    const preparation = audio.prepare();
    await vi.waitFor(() => expect(context.decodeAudioData).toHaveBeenCalledTimes(2));
    context.state = "interrupted";
    pending.resolve({ duration: 56.14 } as AudioBuffer);
    expect(await preparation).toBe(false);
    expect(audio.status()).toBe("unavailable");
    expect(statuses).not.toContain("ready");
    audio.sync(snapshot());
    expect(recordings()).toHaveLength(0);
    audio.unlock();
    expect(await audio.prepare()).toBe(true);
    expect(audio.status()).toBe("ready");
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(context.decodeAudioData).toHaveBeenCalledTimes(2);
    audio.sync(snapshot());
    expect(recordings()).toHaveLength(2);
    audio.dispose();
  });

  it("reports unsupported audio without throwing or pretending the music is ready", async () => {
    vi.stubGlobal("window", {});
    const audio = createBassAudio();
    audio.unlock();
    expect(await audio.prepare()).toBe(false);
    expect(audio.status()).toBe("unavailable");
    expect(() => { audio.sync(snapshot()); audio.pluck(null); audio.dispose(); }).not.toThrow();
  });
});


describe("direct MIDI sampler", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("uses the existing stem and correct pitch rates, including wrong pitches, once per contact", async () => {
    const { audio, recordings } = await ready();
    for (let midi = 28; midi <= 48; midi++) {
      audio.playMidi(midi, midi, "pick", false);
      audio.playMidi(midi, midi, "slap", false); // same contact must not retrigger
      const voice = recordings().at(-1)!;
      expect(voice.playbackRate.value).toBeCloseTo(2 ** ((midi - 31) / 12));
      expect(voice.start).toHaveBeenCalledTimes(1);
      expect(voice.start).toHaveBeenCalledWith(10, 0.317);
      audio.releaseMidi(midi);
    }
    expect(recordings()).toHaveLength(21);
    audio.stop();
    expect(recordings().every(voice => voice.disconnect.mock.calls.length > 0)).toBe(true);
  });
  it("sustains a hold, releases its own voice and silences all contacts on background/pause", async () => {
    const { audio, recordings } = await ready();
    audio.playMidi(1, 33, "pick", true);
    audio.playMidi(2, 38, "slap", false);
    const [hold, slap] = recordings();
    expect(hold.loop).toBe(true);
    expect(hold.stop).toHaveBeenCalledWith(40);
    audio.releaseMidi(1);
    expect(hold.stop.mock.calls.at(-1)![0]).toBeCloseTo(10.13);
    expect(slap.stop).toHaveBeenCalledTimes(1);
    audio.stop();
    expect(slap.stop).toHaveBeenCalledTimes(2);
  });
  it("never opens the continuous bass gate on top of direct voices", async () => {
    const { audio, gains } = await ready();
    const state = success(snapshot(1), 0);
    state.directInput = true;
    audio.sync(state);
    expect(gains[2].gain.linearRampToValueAtTime).not.toHaveBeenCalled();
  });
});
