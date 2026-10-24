/** 推定ステムの解析結果から、アクセント・フレーズ・移動時間を評価して制作する。
 * 等間隔の削除や時刻の量子化は行わない。通常のビルドでは生成し直さない。 */
import fs from "node:fs";
import { BASS_FRETBOARD, midiFrequency } from "../src/room/bassFretboard";
import { FINAL_HIT_LIMITS, finalHitRequiredGap, validateFinalHitChart } from "../src/room/finalHitValidation";
import type { BassNote, BassDifficulty } from "../src/room/bassGame";
import master from "../src/room/charts/final-hit/01_midi_all_notes.json";
import audio from "../src/room/charts/final-hit/audio-source.json";

const analysisPath = process.argv[2] ?? "docs/analysis/final-hit-audio.json";
const analysis = JSON.parse(fs.readFileSync(analysisPath, "utf8")) as { sourceSha256: string; features: Feature[] };
interface Feature { sourceId: string; timeSec: number; midi: number; durationSec: number; pitchRelative: number; strength: number; onset: number; brightness: number; onsetDeltaSec: number }
type Candidate = BassNote & { feature: Feature; quality: number };
if (analysis.sourceSha256 !== audio.sha256) throw new Error("解析した原音が異なります");
// 推定ステムの反復音型と密度変化を確認した区間。BPM120のメタ値で発音時刻を作り直さない。
const sections = [
  { start: 0, end: 8.6, label: "導入・E/Bの応答", hard: 15, normal: 10, easy: 7 },
  { start: 8.6, end: 16.6, label: "C/Gの変化", hard: 19, normal: 13, easy: 8 },
  { start: 16.6, end: 24.2, label: "BとF#の反復", hard: 16, normal: 12, easy: 8 },
  { start: 24.2, end: 32.2, label: "高音の応答からEへ", hard: 18, normal: 12, easy: 8 },
  { start: 32.2, end: 40.7, label: "E/BとGの変奏", hard: 17, normal: 12, easy: 8 },
  { start: 40.7, end: 48.2, label: "C/Bのアクセント", hard: 18, normal: 13, easy: 8 },
  { start: 48.2, end: 52.2, label: "間奏・入力を休ませる", hard: 7, normal: 5, easy: 4 },
  { start: 52.2, end: audio.durationSec, label: "D/Eの応答と終止", hard: 17, normal: 13, easy: 9 },
];
const features = new Map(analysis.features.map(f => [f.sourceId, f]));
const candidates: Candidate[] = [];
for (const [id, source] of master.notes.entries()) {
  const feature = features.get(source.id);
  // 他楽器・不明瞭な候補を先に除き、音域外を無理にオクターブ移動しない。
  if (!feature || feature.pitchRelative < 0.43 || Math.abs(feature.onsetDeltaSec) > 0.15) continue;
  const quality = 1.8 * feature.pitchRelative + Math.log1p(feature.strength * 60) + 0.7 * Math.log1p(feature.onset * 3);
  for (const cell of BASS_FRETBOARD.filter(cell => cell.midi === feature.midi)) candidates.push({ id, sourceId: source.id, time: source.timeSec,
    midi: source.midiNote, string: cell.string, fret: cell.fret, frequency: midiFrequency(cell.midi), kind: "slap", technique: "slap",
    sourceTimeSec: source.timeSec, sourceDurationSec: source.durationSec, positionVerified: false, techniqueVerified: false,
    phraseId: 0, travelSeconds: 1.2, feature, quality });
}

function arrange(pool: Candidate[], difficulty: BassDifficulty) {
  const selected: Candidate[] = [];
  for (const section of sections) {
    const local = pool.filter(n => n.time >= section.start && n.time < section.end).sort((a, b) => a.time - b.time || a.id - b.id);
    const previous = selected.at(-1);
    type Path = { score: number; notes: Candidate[] };
    const states: (Path | undefined)[][] = local.map(() => []);
    const cost = (from: Candidate | undefined, to: Candidate) => {
      const gap = to.time - (from?.time ?? section.start);
      const distance = from ? Math.abs(to.string - from.string) * 1.4 + Math.abs(to.fret - from.fret) * 0.7 : 0;
      return Math.max(0, gap - 1.5) * 1.5 + distance * 0.04;
    };
    for (const [index, note] of local.entries()) {
      // 最後の原音E2は全難易度に残す。重複するオクターブ候補の採用ではない。
      const value = note.quality + (note.sourceId === "n0645" ? 12 : 0);
      if (!previous || note.time - previous.time + 1e-8 >= finalHitRequiredGap(previous, note, difficulty)) states[index][1] = { score: value - cost(previous, note), notes: [note] };
      for (let prior = 0; prior < index; prior++) {
        if (note.time - local[prior].time + 1e-8 < finalHitRequiredGap(local[prior], note, difficulty)) continue;
        for (let count = 2; count <= section[difficulty]; count++) {
          const path = states[prior][count - 1]; if (!path) continue;
          const score = path.score + value - cost(local[prior], note);
          if (!states[index][count] || score > states[index][count]!.score) states[index][count] = { score, notes: [...path.notes, note] };
        }
      }
    }
    let best: Path | undefined;
    for (let count = section[difficulty]; count > 0 && !best; count--) {
      for (const [index, paths] of states.entries()) {
        const path = paths[count]; if (!path) continue;
        const score = path.score - Math.max(0, section.end - local[index].time - 1.5) * 1.5;
        if (!best || score > best.score) best = { ...path, score };
      }
    }
    if (!best) throw new Error(`${difficulty}: ${section.label}の候補不足`);
    selected.push(...best.notes);
  }
  return selected;
}

const hard = arrange(candidates, "hard");
const subset = (parent: Candidate[]) => candidates.filter(n => parent.some(p => p.id === n.id));
const normal = arrange(subset(hard), "normal");
const easy = arrange(subset(normal), "easy");
const reports = {} as Record<BassDifficulty, ReturnType<typeof validateFinalHitChart>>;
for (const difficulty of ["easy", "normal", "hard"] as const) {
  const selected = { easy, normal, hard }[difficulty];
  const holds = new Set(selected.filter((n, i) => n.sourceDurationSec! >= 0.35 &&
    (selected[i + 1]?.time ?? audio.durationSec) - n.time >= n.sourceDurationSec! + 0.25).slice(0, 2).map(n => n.id));
  const slapOrder = selected.filter(n => !holds.has(n.id)).sort((a, b) =>
    (b.feature.brightness * 2 + b.feature.onset - b.sourceDurationSec! * 0.2) - (a.feature.brightness * 2 + a.feature.onset - a.sourceDurationSec! * 0.2));
  const slaps = new Set(slapOrder.slice(0, Math.round(selected.length * FINAL_HIT_LIMITS[difficulty].slapRatio)).map(n => n.id));
  const notes: BassNote[] = selected.map((n, phraseId) => ({ ...n, phraseId,
    kind: holds.has(n.id) ? "hold" : slaps.has(n.id) ? "slap" : "tap", technique: slaps.has(n.id) ? "slap" : "pick",
    ...(holds.has(n.id) ? { endTime: n.time + n.sourceDurationSec! } : {}) }));
  reports[difficulty] = validateFinalHitChart({ notes, duration: audio.durationSec, difficulty });
  const data = { schemaVersion: "1.0.0", songId: "final-hit", difficulty, audioOffsetSec: 0, audioSyncVerified: false,
    source: "原MIDIとKUIELab推定ベースを照合したゲーム用編曲。運指・奏法は推定。耳で確認済みではない。", sourceSha256: audio.sha256,
    sections: sections.map(s => ({ start: s.start, end: s.end, label: s.label })),
    notes: notes.map(n => ({ id: n.id, sourceId: n.sourceId, timeSec: n.time, midi: n.midi, string: n.string, fret: n.fret, kind: n.kind,
      ...(n.endTime === undefined ? {} : { endTimeSec: n.endTime }) })) };
  fs.writeFileSync(`src/room/charts/final-hit/${difficulty}.json`, JSON.stringify(data, null, 2) + "\n");
}
fs.writeFileSync("src/room/charts/final-hit/06_gameplay_validation.json", JSON.stringify({ analysisPath, limits: FINAL_HIT_LIMITS, reports }, null, 2) + "\n");
console.log(JSON.stringify(reports, null, 2));
