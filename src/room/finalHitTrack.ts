import audioSource from "./charts/final-hit/audio-source.json" with { type: "json" };
import master from "./charts/final-hit/01_midi_all_notes.json" with { type: "json" };
import candidates from "./charts/final-hit/02_bass_4string_candidates.json" with { type: "json" };
import overrides from "./charts/final-hit/overrides.json" with { type: "json" };
import { importMidiChart, importedBassSong } from "./bassChartImport";

export const FINAL_HIT_AUDIO_DURATION = audioSource.durationSec;
export function finalHitSong(offset?: number) {
  return importedBassSong(importMidiChart(master, candidates, offset === undefined ? overrides : {
    ...overrides, audioOffsetSec: offset, audioSyncVerified: offset === overrides.audioOffsetSec && overrides.audioSyncVerified,
  }), FINAL_HIT_AUDIO_DURATION);
}
