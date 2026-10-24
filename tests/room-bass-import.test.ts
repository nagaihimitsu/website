import { describe, expect, it } from "vitest";
import master from "../src/room/charts/final-hit/01_midi_all_notes.json";
import candidates from "../src/room/charts/final-hit/02_bass_4string_candidates.json";
const overrides = { schemaVersion: "1.0.0", audioOffsetSec: 0, audioSyncVerified: false, notes: {} };
import { importMidiChart, monophonicSelection } from "../src/room/bassChartImport";
import { BASS_SONGS, createBassGame } from "../src/room/bassGame";
import { finalHitSong, FINAL_HIT_AUDIO_DURATION } from "../src/room/finalHitTrack";
import { BASS_FRETBOARD } from "../src/room/bassFretboard";
import { timelineX, chargeProgress } from "../src/room/bassVisuals";

function ready() { const game = createBassGame(); game.tick(4.1, true); return game; }
function playing() { const game = ready(); expect(game.selectSong("final-hit")).toBe(true); game.start(); game.tick(2, true); return game; }

describe("MIDI由来のJSON取り込み", () => {
  it("原本648音と候補557音を保ち、現行指板の315音だけを移調せず接続する", () => {
    const before = JSON.stringify({ master, candidates, overrides });
    const chart = importMidiChart(master, candidates, overrides);
    expect(chart).toMatchObject({ sourceNoteCount: 648, candidateNoteCount: 557, audioOffsetSec: 0, audioSyncVerified: false, midiDurationSec: 59.596875 });
    expect(master.notes[0]).toMatchObject({ id: "n0001", timeSec: 0.789583, midiNote: 52 });
    expect(chart.notes).toHaveLength(315);
    expect(chart.excluded.filter(n => n.reason === "outside-current-fretboard")).toHaveLength(242);
    expect(chart.excluded.filter(n => n.reason === "not-in-candidates")).toHaveLength(91);
    expect(chart.excluded).toContainEqual({ sourceId: "n0001", timeSec: 0.789583, midiNote: 52, reason: "outside-current-fretboard" });
    for (const n of chart.notes) {
      const original = master.notes.find(m => m.id === n.sourceId)!;
      expect(n).toMatchObject({ time: original.timeSec, midi: original.midiNote, sourceDurationSec: original.durationSec, velocity: original.velocity,
        kind: "tap", technique: null, importedTechnique: null, positionVerified: false, techniqueVerified: false });
      expect(BASS_FRETBOARD.some(cell => cell.midi === n.midi && cell.string === n.string && cell.fret === n.fret)).toBe(true);
    }
    expect(JSON.stringify({ master, candidates, overrides })).toBe(before);
  });
  it("120 BPMから再計算せず、正負のオフセットを目標時刻に加算する", () => {
    const positive = importMidiChart(master, candidates, { ...overrides, audioOffsetSec: 0.137 });
    const negative = importMidiChart(master, candidates, { ...overrides, audioOffsetSec: -0.137 });
    for (const [index, n] of positive.notes.entries()) {
      expect(n.time).toBe(n.sourceTimeSec! + 0.137);
      expect(negative.notes[index].time).toBe(n.sourceTimeSec! - 0.137);
      expect(timelineX(n.time, n.time)).toBe(32);
      expect(chargeProgress(n.time, n.time)).toBe(1);
    }
    expect(positive.notes.some(n => Math.abs(n.time * 2 - Math.round(n.time * 2)) > 0.01)).toBe(true);
  });
  it("未対応バージョン、件数、重複ID、時刻、音高不一致を拒否する", () => {
    for (const kind of ["schema", "count", "id", "time", "pitch", "position"] as const) {
      const changed = structuredClone(candidates);
      if (kind === "schema") changed.schemaVersion = "2.0.0";
      if (kind === "count") changed.candidateNotesCount--;
      if (kind === "id") changed.notes[1].id = changed.notes[0].id;
      if (kind === "time") changed.notes[0].timeSec = NaN;
      if (kind === "pitch") changed.notes[0].midiNote--;
      if (kind === "position") changed.notes[0].possiblePositions[0].fret--;
      expect(() => importMidiChart(master, changed)).toThrow(/MIDI譜面/);
    }
    expect(() => importMidiChart(master, candidates, { ...overrides, audioOffsetSec: -1 })).toThrow(/開始前/);
  });
  it("明示的な運指・奏法・保持の修正だけを適用し、不正な運指を保存対象にしない", () => {
    const original = candidates.notes.find(n => n.midiNote === 43)!;
    const chart = importMidiChart(master, candidates, { ...overrides, notes: { [original.id]: { stringNumber: 2, fret: 5, technique: "slap", techniqueVerified: true, positionVerified: true } } });
    expect(chart.notes.find(n => n.sourceId === original.id)).toMatchObject({ string: 1, fret: 5, kind: "slap", technique: "slap", positionVerified: true, techniqueVerified: true });
    const hold = importMidiChart(master, candidates, { ...overrides, notes: { [original.id]: { kind: "hold" } } }).notes.find(n => n.sourceId === original.id)!;
    expect(hold.endTime).toBe(hold.time + original.durationSec);
    expect(hold.technique).toBeNull();
    expect(() => importMidiChart(master, candidates, { ...overrides, notes: { [original.id]: { stringNumber: 4, fret: 2 } } })).toThrow(/修正運指/);
    expect(() => importMidiChart(master, candidates, { ...overrides, notes: { missing: { excluded: true } } })).toThrow(/存在しません/);
  });
  it("同時刻ノーツを独立して残し、モノフォニック化は別の出力でのみ行う", () => {
    const chart = importMidiChart(master, candidates);
    expect(new Set(chart.notes.map(n => n.id)).size).toBe(315);
    expect(new Set(chart.notes.map(n => n.time)).size).toBeLessThan(315);
    const input = [
      { id: "a", timeSec: 1, durationSec: 0.2, midiNote: 43, velocity: 80 },
      { id: "b", timeSec: 1, durationSec: 0.2, midiNote: 33, velocity: 80 },
      { id: "c", timeSec: 1.1, durationSec: 0.1, midiNote: 40, velocity: 80 },
      { id: "d", timeSec: 1.25, durationSec: 0.1, midiNote: 38, velocity: 80 },
    ];
    const result = monophonicSelection(input);
    expect(result.kept.map(n => n.id)).toEqual(["b", "d"]);
    expect(result.removed.map(n => n.id)).toEqual(["a", "c"]);
    expect(input).toHaveLength(4);
    expect(result.kept[1].timeSec).toBe(1.25);
  });
});

describe("曲選択と共通楽曲時計", () => {
  it("開始前に2曲を切り替え、既存曲と難易度を保持し、プレイ中の変更を拒否する", () => {
    const game = ready(); game.setDifficulty("hard");
    const garden = game.snapshot();
    game.selectSong("final-hit");
    expect(game.snapshot()).toMatchObject({ songId: "final-hit", songTitle: "最終のヒット", duration: FINAL_HIT_AUDIO_DURATION, importSummary: { playableCount: finalHitSong().notes.length } });
    expect(game.setDifficulty("easy")).toBe(false);
    game.selectSong("garden-party");
    expect(game.snapshot().notes).toEqual(garden.notes);
    expect(game.snapshot().difficulty).toBe("hard");
    expect(game.snapshot().duration).toBe(BASS_SONGS.hard.duration);
    game.selectSong("final-hit"); game.start();
    expect(game.selectSong("garden-party")).toBe(false);
    expect(game.setAudioOffset(0.1)).toBe(false);
  });
  it("全315音を同時刻を含めて音声時刻で判定し、元音源の余韻まで完走する", () => {
    const game = playing();
    const song = finalHitSong();
    const events = song.notes.flatMap(note => [
      { time: note.time, note, action: "down" },
      { time: note.endTime ?? note.time, note, action: "up" },
    ]).sort((a, b) => a.time - b.time || Number(a.action === "up") - Number(b.action === "up") || a.note.id - b.note.id);
    for (const event of events) {
      game.tick(event.time - game.snapshot().elapsed, true);
      if (event.action === "down") {
        expect(game.beginInput(event.note.id, event.note.midi)?.noteId).toBe(event.note.id);
        if (event.note.kind === "slap") game.slapInput(event.note.id);
      } else game.endInput(event.note.id);
    }
    game.tick(FINAL_HIT_AUDIO_DURATION - 0.01 - game.snapshot().elapsed, true);
    expect(game.snapshot().phase).toBe("playing");
    game.tick(0.02, true);
    expect(game.snapshot()).toMatchObject({ phase: "result", hits: song.notes.length, misses: 0, combo: song.notes.length, accuracy: 100 });
  });
  it("停止・再開・シークで絶対位置から描き直し、シーク前の音を重複採点しない", () => {
    const game = playing(); game.tick(8, true);
    const before = game.snapshot();
    expect(game.tick(60, true, true)).toEqual(before);
    expect(game.seek(30)).toBe(true);
    const seeked = game.snapshot();
    expect(seeked).toMatchObject({ elapsed: 30, score: 0, combo: 0, misses: 0 });
    expect(seeked.notes.some(n => n.state === "skipped")).toBe(true);
    game.tick(0, true);
    const next = game.snapshot().notes.find(n => n.state === "pending" && n.time >= 30)!;
    game.tick(next.time - 30, true); game.beginInput(1, next.midi); game.endInput(1);
    expect(game.snapshot().hits).toBe(1);
    expect(game.seek(0)).toBe(true);
    expect(game.snapshot().notes.every(n => n.state === "pending")).toBe(true);
  });
  it("曲単位の調整を反映し、長い正オフセットでも終了前に音符を捨てない", () => {
    const game = ready(); game.selectSong("final-hit");
    expect(game.setAudioOffset(1)).toBe(true);
    expect(game.snapshot().audioOffsetSec).toBe(1);
    expect(game.snapshot().notes[0].time).toBe(game.snapshot().notes[0].sourceTimeSec! + 1);
    expect(game.snapshot().duration).toBeGreaterThanOrEqual(master.durationSec + 1);
    expect(game.setAudioOffset(-5)).toBe(false);
    game.selectSong("garden-party");
    expect(game.snapshot().audioOffsetSec).toBe(0);
  });
});

import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

describe("修正と開発用出力の保存", () => {
  it("修正を別ファイルへ保存し、無効な変更を拒み、原本を変えずに間引きと除外を出力する", () => {
    const dir = mkdtempSync(join(tmpdir(), "bass-midi-edit-"));
    const paths = ["src/room/charts/final-hit/01_midi_all_notes.json", "src/room/charts/final-hit/02_bass_4string_candidates.json"];
    const before = paths.map(p => readFileSync(p, "utf8"));
    const patchFile = join(dir, "patch.json");
    writeFileSync(patchFile, JSON.stringify(overrides));
    const id = candidates.notes.find(n => n.midiNote === 43)!.id;
    const run = (...args: string[]) => spawnSync(process.execPath, ["--import", "tsx", "scripts/edit-bass-chart.ts", "--patch-file", patchFile, ...args], { encoding: "utf8" });
    try {
      const saved = run("--note", id, "--string", "2", "--fret", "5", "--technique", "slap", "--position-verified", "true", "--offset", "0.13");
      expect(saved.status, saved.stderr).toBe(0);
      const patch = JSON.parse(readFileSync(patchFile, "utf8"));
      expect(patch.notes[id]).toMatchObject({ stringNumber: 2, fret: 5, technique: "slap", kind: "slap", positionVerified: true });
      expect(patch.audioOffsetSec).toBe(0.13);
      expect(patch.audioSyncVerified).toBe(false);
      const previous = readFileSync(patchFile, "utf8");
      expect(run("--note", id, "--fret", "4").status).not.toBe(0);
      expect(readFileSync(patchFile, "utf8")).toBe(previous);
      const monoPath = join(dir, "mono.json");
      const exported = run("--monophonic", monoPath);
      expect(exported.status, exported.stderr).toBe(0);
      const mono = JSON.parse(readFileSync(monoPath, "utf8"));
      const removed = JSON.parse(readFileSync(join(dir, "mono.excluded.json"), "utf8"));
      expect(mono.notes.length).toBeLessThan(315);
      expect(mono.notes.length + removed.notes.length).toBe(557);
      for (const n of mono.notes) expect(candidates.notes.find(source => source.id === n.id)?.timeSec).toBe(n.timeSec);
      expect(paths.map(p => readFileSync(p, "utf8"))).toEqual(before);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
