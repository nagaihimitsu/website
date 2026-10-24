/** キメを最初に固定し、その間だけ通常候補を選ぶ。時刻の量子化・一律間引きは行わない。 */
import fs from "node:fs";
import { BASS_FRETBOARD, midiFrequency } from "../src/room/bassFretboard";
import { FINAL_HIT_LIMITS, finalHitRequiredGap, validateFinalHitChart } from "../src/room/finalHitValidation";
import { requiredFinalHitKime, inFinalHitProtectedSpace, FINAL_HIT_KIME } from "../src/room/finalHitKime";
import type { BassNote, BassDifficulty } from "../src/room/bassGame";
import master from "../src/room/charts/final-hit/01_midi_all_notes.json";
import audio from "../src/room/charts/final-hit/audio-source.json";

const analysisPath = process.argv[2] ?? "docs/analysis/final-hit-audio.json";
interface Feature { sourceId: string; timeSec: number; midi: number; durationSec: number; pitchRelative: number; strength: number; onset: number; brightness: number; onsetDeltaSec: number }
const analysis = JSON.parse(fs.readFileSync(analysisPath, "utf8")) as { sourceSha256: string; features: Feature[] };
type Candidate = BassNote & { quality: number; feature?: Feature };
if (analysis.sourceSha256 !== audio.sha256 || FINAL_HIT_KIME.audioSha256 !== audio.sha256) throw new Error("解析した原音が異なります");
const features = new Map(analysis.features.map(f => [f.sourceId, f]));
function candidate(sourceId: string, midi: number, string: BassNote["string"], fret: number): Candidate {
  const id = master.notes.findIndex(n => n.id === sourceId), source = master.notes[id], feature = features.get(sourceId);
  if (!source) throw new Error(`原本にない音: ${sourceId}`);
  return { id, sourceId, sourceMidi: source.midiNote, time: source.timeSec, midi, string, fret, frequency: midiFrequency(midi), kind: "slap", technique: "slap",
    sourceTimeSec: source.timeSec, sourceDurationSec: source.durationSec, positionVerified: false, techniqueVerified: false, phraseId: 0, travelSeconds: 1.2,
    feature, quality: feature ? 1.8 * feature.pitchRelative + Math.log1p(feature.strength * 60) + 0.7 * Math.log1p(feature.onset * 3) : 0 };
}
const distance = (a: BassNote | undefined, b: BassNote) => a ? Math.abs(a.string - b.string) * 1.4 + Math.abs(a.fret - b.fret) * 0.7 : 0;
function protectedNotes(difficulty: BassDifficulty): Candidate[] {
  const fixed: Candidate[] = [];
  for (const event of requiredFinalHitKime(difficulty)) {
    const previous = fixed.at(-1);
    const positions = BASS_FRETBOARD.filter(c => c.midi === event.midi).map(c => candidate(event.sourceId, c.midi, c.string, c.fret));
    positions.sort((a, b) => distance(previous, a) - distance(previous, b));
    const note = positions.find(n => !previous || n.time - previous.time + 1e-8 >= finalHitRequiredGap(previous, n, difficulty));
    if (!note) throw new Error(`${difficulty}: 保護キメ ${event.id} の運指を見直してください（自動削除禁止）`);
    fixed.push({ ...note, kimeId: event.id, kimeGroupId: event.groupId, protected: true, pitchMapping: event.pitchMapping });
  }
  return fixed;
}
const candidates: Candidate[] = [];
for (const source of master.notes) {
  const f = features.get(source.id);
  if (inFinalHitProtectedSpace(source.timeSec) || !f || f.pitchRelative < 0.43 || Math.abs(f.onsetDeltaSec) > 0.15) continue;
  for (const cell of BASS_FRETBOARD.filter(c => c.midi === source.midiNote)) candidates.push(candidate(source.id, cell.midi, cell.string, cell.fret));
}
function fillGap(pool: Candidate[], left: Candidate | undefined, right: Candidate | undefined, difficulty: BassDifficulty) {
  const start = left?.time ?? 0, end = right?.time ?? audio.durationSec;
  const budget = Math.max(0, Math.floor((end - start) / ({ easy: 0.95, normal: 0.65, hard: 0.43 }[difficulty])) - 1);
  if (!budget) return [];
  const local = pool.filter(n => n.time > start && n.time < end &&
    (!left || n.time - left.time + 1e-8 >= finalHitRequiredGap(left, n, difficulty)) &&
    (!right || right.time - n.time + 1e-8 >= finalHitRequiredGap(n, right, difficulty))).sort((a, b) => a.time - b.time || a.id - b.id);
  type Path = { score: number; notes: Candidate[] };
  const states: (Path | undefined)[][] = local.map(() => []);
  const cost = (from: Candidate | undefined, to: Candidate) => Math.max(0, to.time - (from?.time ?? start) - 1.5) * 1.5 + distance(from, to) * 0.04;
  for (const [index, note] of local.entries()) {
    states[index][1] = { score: note.quality - cost(left, note), notes: [note] };
    for (let prior = 0; prior < index; prior++) {
      if (note.time - local[prior].time + 1e-8 < finalHitRequiredGap(local[prior], note, difficulty)) continue;
      for (let count = 2; count <= budget; count++) {
        const path = states[prior][count - 1]; if (!path) continue;
        const score = path.score + note.quality - cost(local[prior], note);
        if (!states[index][count] || score > states[index][count]!.score) states[index][count] = { score, notes: [...path.notes, note] };
      }
    }
  }
  let best: Path | undefined;
  for (let count = budget; count > 0 && !best; count--) for (const [index, paths] of states.entries()) {
    const path = paths[count]; if (!path) continue;
    const score = path.score - Math.max(0, end - local[index].time - 1.5) * 1.5;
    if (!best || score > best.score) best = { ...path, score };
  }
  return best?.notes ?? [];
}
function arrange(pool: Candidate[], difficulty: BassDifficulty) {
  const fixed = protectedNotes(difficulty), selected: Candidate[] = [];
  let left: Candidate | undefined;
  for (const right of [...fixed, undefined]) {
    selected.push(...fillGap(pool, left, right, difficulty));
    if (right) selected.push(right);
    left = right;
  }
  return selected;
}
// 下位難易度の通常フレーズは上位の採用音から選ぶ。保護キメは各難易度で先に独立確定する。
const hard = arrange(candidates, "hard");
const subset = (parent: Candidate[]) => candidates.filter(n => parent.some(p => p.id === n.id && !p.protected));
const normal = arrange(subset(hard), "normal");
const easy = arrange(subset(normal), "easy");
const reports = {} as Record<BassDifficulty, ReturnType<typeof validateFinalHitChart>>;
for (const difficulty of ["easy", "normal", "hard"] as const) {
  const selected = { easy, normal, hard }[difficulty];
  const slaps = new Set(selected.filter(n => n.protected).map(n => n.id));
  const additional = selected.filter(n => !n.protected).sort((a, b) =>
    ((b.feature?.brightness ?? 0) * 2 + (b.feature?.onset ?? 0)) - ((a.feature?.brightness ?? 0) * 2 + (a.feature?.onset ?? 0)));
  for (const note of additional.slice(0, Math.max(0, Math.round(selected.length * FINAL_HIT_LIMITS[difficulty].slapRatio) - slaps.size))) slaps.add(note.id);
  const notes: BassNote[] = selected.map((n, phraseId) => ({ ...n, phraseId, kind: slaps.has(n.id) ? "slap" : "tap", technique: slaps.has(n.id) ? "slap" : "pick" }));
  reports[difficulty] = validateFinalHitChart({ notes, duration: audio.durationSec, difficulty });
  const data = { schemaVersion: "1.0.0", songId: "final-hit", difficulty, audioOffsetSec: 0, audioSyncVerified: false,
    source: "提供キメ分析・原MIDI・原音と推定ステムの比較に基づくゲーム編曲。キメを先に保護。音高・奏法は推定であり聴音確定ではない。", sourceSha256: audio.sha256,
    sections: FINAL_HIT_KIME.groups,
    notes: notes.map(n => ({ id: n.id, sourceId: n.sourceId, timeSec: n.time, midi: n.midi, string: n.string, fret: n.fret, kind: n.kind, sourceMidi: n.sourceMidi,
      ...(n.kimeId ? { kimeId: n.kimeId, kimeGroupId: n.kimeGroupId, protected: true, pitchMapping: n.pitchMapping } : {}) })) };
  fs.writeFileSync(`src/room/charts/final-hit/${difficulty}.json`, JSON.stringify(data, null, 2) + "\n");
}
fs.writeFileSync("src/room/charts/final-hit/06_gameplay_validation.json", JSON.stringify({ analysisPath, policy: FINAL_HIT_KIME.policy, limits: FINAL_HIT_LIMITS, reports }, null, 2) + "\n");
console.log(JSON.stringify(reports, null, 2));
