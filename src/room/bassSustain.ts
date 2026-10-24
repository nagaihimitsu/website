import { midiFrequency } from "./bassFretboard";

export const BASS_SUSTAIN_CONFIG = Object.freeze({ attackOffset: 0.317, blendStart: 0.08, blendEnd: 0.16,
  analysisStart: 0.4, analysisEnd: 0.49, harmonics: 12, loopCycles: 4, sourceMidi: 31 });

/** 分離録音の1回のアタックから、位相と音量の安定した持続部へ接続する。
 * 元の160ms区間は減衰と大きな継ぎ目を含むため、そのまま繰り返さない。 */
export function bassSustainSamples(source: Float32Array, sampleRate: number) {
  const c = BASS_SUSTAIN_CONFIG;
  const period = Math.round(sampleRate / midiFrequency(c.sourceMidi));
  const offset = Math.round(c.attackOffset * sampleRate), blendStart = Math.round(c.blendStart * sampleRate);
  const loopStart = offset + Math.round(c.blendEnd * sampleRate), loopEnd = loopStart + period * c.loopCycles;
  const output = new Float32Array(loopEnd);
  const from = Math.round(c.analysisStart * sampleRate), to = Math.min(source.length, Math.round(c.analysisEnd * sampleRate));
  const cos = new Float64Array(c.harmonics), sin = new Float64Array(c.harmonics);
  let weight = 0, energy = 0;
  for (let i = from; i < to; i++) {
    const window = 0.5 - 0.5 * Math.cos(2 * Math.PI * (i - from) / Math.max(1, to - from - 1));
    const sample = source[i] || 0;
    weight += window; energy += window * sample * sample;
    for (let h = 0; h < c.harmonics; h++) {
      const phase = 2 * Math.PI * (h + 1) * (i - offset) / period;
      cos[h] += sample * Math.cos(phase) * window; sin[h] += sample * Math.sin(phase) * window;
    }
  }
  const cycle = new Float32Array(period);
  for (let i = 0; i < period; i++) for (let h = 0; h < c.harmonics; h++) {
    const phase = 2 * Math.PI * (h + 1) * i / period;
    cycle[i] += 2 * (cos[h] * Math.cos(phase) + sin[h] * Math.sin(phase)) / Math.max(1, weight);
  }
  const rms = Math.sqrt(cycle.reduce((sum, sample) => sum + sample * sample, 0) / period);
  const scale = rms ? Math.min(1.2, Math.sqrt(energy / Math.max(1, weight)) / rms) * 0.85 : 0;
  for (let i = offset; i < loopEnd; i++) {
    const blend = Math.max(0, Math.min(1, (i - offset - blendStart) / (loopStart - offset - blendStart)));
    const smooth = blend * blend * (3 - 2 * blend);
    output[i] = (source[i] || 0) * (1 - smooth) + cycle[(i - offset) % period] * scale * smooth;
  }
  return { samples: output, loopStart: loopStart / sampleRate, loopEnd: loopEnd / sampleRate };
}

export function createBassSustainBuffer(context: BaseAudioContext, source: AudioBuffer) {
  const channels = Array.from({ length: source.numberOfChannels }, (_, index) => bassSustainSamples(source.getChannelData(index), source.sampleRate));
  const buffer = context.createBuffer(channels.length, channels[0].samples.length, source.sampleRate);
  channels.forEach((channel, index) => buffer.getChannelData(index).set(channel.samples));
  return { buffer, loopStart: channels[0].loopStart, loopEnd: channels[0].loopEnd };
}
