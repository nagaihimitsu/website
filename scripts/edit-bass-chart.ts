import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { resolve, dirname, basename, join } from "node:path";
import master from "../src/room/charts/final-hit/01_midi_all_notes.json";
import candidates from "../src/room/charts/final-hit/02_bass_4string_candidates.json";
import { importMidiChart, monophonicSelection, type ChartOverrides } from "../src/room/bassChartImport";

const args = process.argv.slice(2);
const options = new Map<string, string>();
for (let i = 0; i < args.length; i += 2) {
  if (!args[i].startsWith("--") || args[i + 1] === undefined) throw new Error("引数は --項目 値 で指定してください");
  options.set(args[i].slice(2), args[i + 1]);
}
const allowed = ["patch-file", "note", "string", "fret", "technique", "kind", "position-verified", "technique-verified", "exclude", "offset", "sync-verified", "positions", "report", "monophonic"];
for (const key of options.keys()) if (!allowed.includes(key)) throw new Error(`未対応の項目: ${key}`);
const patchPath = resolve(options.get("patch-file") ?? "src/room/charts/final-hit/overrides.json");
const patches: ChartOverrides = JSON.parse(readFileSync(patchPath, "utf8"));
const bool = (value: string) => { if (!["true", "false"].includes(value)) throw new Error("true/falseを指定してください"); return value === "true"; };
const number = (value: string) => { const n = Number(value); if (!Number.isFinite(n)) throw new Error("有限の数値が必要です"); return n; };
const output = (path: string, value: unknown) => {
  const temporary = join(dirname(path), `.${basename(path)}.tmp`);
  writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n");
  renameSync(temporary, path);
};
let changed = false;
if (options.has("offset")) { patches.audioOffsetSec = number(options.get("offset")!); patches.audioSyncVerified = false; changed = true; }
if (options.has("sync-verified")) { patches.audioSyncVerified = bool(options.get("sync-verified")!); changed = true; }
const id = options.get("note");
if (id) {
  const note = candidates.notes.find(n => n.id === id);
  if (!note) throw new Error(`候補にないノーツID: ${id}`);
  const patch = { ...patches.notes[id] };
  for (const [flag, key] of [["string", "stringNumber"], ["fret", "fret"]] as const) if (options.has(flag)) { patch[key] = number(options.get(flag)!); changed = true; }
  if (options.has("technique")) { patch.technique = options.get("technique") === "unknown" ? null : options.get("technique")!; changed = true; }
  if (options.has("kind")) { patch.kind = options.get("kind") as typeof patch.kind; changed = true; }
  else if (patch.technique === "slap") patch.kind = "slap";
  for (const [flag, key] of [["position-verified", "positionVerified"], ["technique-verified", "techniqueVerified"], ["exclude", "excluded"]] as const) if (options.has(flag)) { patch[key] = bool(options.get(flag)!); changed = true; }
  patches.notes[id] = patch;
} else if (["string", "fret", "technique", "kind", "position-verified", "technique-verified", "exclude"].some(key => options.has(key))) throw new Error("運指・奏法の変更には --note ID が必要です");
// 検証成功後だけ修正ファイルを置き換える。原本2ファイルへは書き込まない。
const chart = importMidiChart(master, candidates, patches);
if (changed) output(patchPath, patches);
if (options.has("positions")) {
  const n = candidates.notes.find(note => note.id === options.get("positions"));
  if (!n) throw new Error("ノーツIDが見つかりません");
  console.log(JSON.stringify(n.possiblePositions.map(p => ({ ...p, visibleOnCurrentBoard: p.fret <= 5 })), null, 2));
}
const report = { schemaVersion: "1.0.0", sourceNoteCount: chart.sourceNoteCount, candidateNoteCount: chart.candidateNoteCount,
  playableNoteCount: chart.notes.length, audioOffsetSec: chart.audioOffsetSec, audioSyncVerified: chart.audioSyncVerified, excludedNotes: chart.excluded };
if (options.has("report")) output(resolve(options.get("report")!), report);
if (options.has("monophonic")) {
  const playableIds = new Set(chart.notes.map(n => n.sourceId));
  const playable = candidates.notes.filter(n => playableIds.has(n.id));
  const { kept } = monophonicSelection(playable);
  const keptIds = new Set(kept.map(n => n.id));
  const path = resolve(options.get("monophonic")!);
  output(path, { ...candidates, developmentOnly: true, selectionRule: "lowest pitch at simultaneous onset; omit overlapping intervals without retiming",
    candidateNotesCount: kept.length, excludedNotesCount: master.notes.length - kept.length,
    excludedSourceNoteIds: master.notes.filter(n => !keptIds.has(n.id)).map(n => n.id), notes: kept });
  output(path.replace(/\.json$/i, "") + ".excluded.json", { notes: candidates.notes.filter(n => !keptIds.has(n.id)) });
}
console.log(`原本${chart.sourceNoteCount}音 / 候補${chart.candidateNoteCount}音 / 現行指板${chart.notes.length}音 / offset ${chart.audioOffsetSec}s`);
