import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { BASS_SONGS, BASS_TECHNIQUE_STUDY, BASS_TECHNIQUE_STUDIES, createBassGame, validateBassSlide, type BassNote, type BassGameSnapshot } from "../src/room/bassGame";
import { BASS_FRETBOARD, BASS_STRINGS, bassPitchColor, bassPositionsForMidi, bassPitch, midiFrequency } from "../src/room/bassFretboard";
import { GARDEN_BASS_NOTES, GARDEN_TRACK, gardenBeatToTime, gardenTimeToBeat } from "../src/room/gardenTrack";
import { createBassContacts, type BassPointerInput } from "../src/room/bassInput";
import { chargeProgress, nextCharge, timelineX } from "../src/room/bassVisuals";
import { createBassPerformanceEffects, bassComboTier, successfulBassEvent, BASS_EFFECT_CONFIG } from "../src/room/art/bassPerformanceEffects";
import { createDisposalScope } from "../src/room/disposal";
import { importMidiChart } from "../src/room/bassChartImport";
import master from "../src/room/charts/final-hit/01_midi_all_notes.json";
import candidates from "../src/room/charts/final-hit/02_bass_4string_candidates.json";

const slide = (fret = 2, endFret = 5, id = 0, time = 1): BassNote => ({ id, time, endTime: time + 1, string: 2, fret, midi: 33 + fret,
  endString: 2, endFret, endMidi: 33 + endFret, kind: "slide", technique: "slide", frequency: midiFrequency(33 + fret), phraseId: id, travelSeconds: 1.2 });
const tap = (id: number, time: number): BassNote => ({ ...slide(2, 5, id, time), kind: "tap", technique: "pick", endTime: undefined });
function playing(chart: readonly BassNote[] = [slide()]) {
  const game = createBassGame(chart); game.tick(4.1, true); game.start(); game.tick(BASS_SONGS.easy.countdownSeconds, true); return game;
}
const input = (id = 1, x = 100, y = 200, time = 100): BassPointerInput => ({ id, action: "down", x, y, time, string: 2, fret: 2, midi: 35, fretWidth: 50, rowTop: 175, rowBottom: 225 });

describe("MIDIカラーの一元管理", () => {
  it("21音を一意の連続スケールにし、どの位置でも同音は同色", () => {
    const colors = Array.from({ length: 21 }, (_, i) => bassPitchColor(28 + i));
    expect(new Set(colors).size).toBe(21);
    expect([28, 33, 38, 43, 48].map(bassPitchColor)).toEqual(["#37709b", "#297a8f", "#337c63", "#976b27", "#ae4b52"]);
    for (const cell of BASS_FRETBOARD) {
      expect(cell.color).toBe(bassPitch(cell.midi).color);
      expect(bassPositionsForMidi(cell.midi).every(other => other.color === cell.color)).toBe(true);
    }
    expect(bassPitch(33).color).not.toBe(bassPitch(45).color);
  });
  it.each([NaN, Infinity, -Infinity, -1, 1000, 38.5])("範囲外の%fでも描画可能な色を返す", midi => {
    expect(bassPitchColor(midi)).toMatch(/^#[0-9a-f]{6}$/);
    expect(bassPitch(midi).name).toBeTruthy();
  });
  it("全21色で白文字の通常コントラストを4.5以上確保", () => {
    for (let midi = 28; midi <= 48; midi++) {
      const rgb = bassPitchColor(midi).slice(1).match(/../g)!.map(hex => parseInt(hex, 16) / 255).map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
      const luminance = rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
      expect(1.05 / (luminance + 0.05), `MIDI ${midi}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe("捕捉した接触の排他的な奏法認識", () => {
  it.each([-1, 1])("縦%f方向フリックは同じ開始音高のスラップ1回", direction => {
    const contacts = createBassContacts(); contacts.begin(input(), 1);
    expect(contacts.move({ ...input(1, 102, 200 + direction * 30, 200), midi: 48, string: 0 })).toBe(true);
    expect(contacts.get(1)).toMatchObject({ gesture: "slap", midi: 35, string: 2 });
    expect(contacts.move(input(1, 250, 200, 220))).toBe(false);
    expect(contacts.get(1)?.gesture).toBe("slap");
    contacts.end({ ...input(), action: "up" }, 1.2); expect(contacts.size).toBe(0);
  });
  it.each([[2, 5], [5, 2]])("%iFから%iFへ連続音高、通過セルの入力は作らない", (start, end) => {
    const contacts = createBassContacts(); const pointer = { ...input(), fret: start, midi: 33 + start };
    contacts.begin(pointer, 1);
    for (let i = 1; i <= 6; i++) {
      contacts.move({ ...pointer, x: 100 + (end - start) * 50 * i / 6, time: 100 + i * 100 });
      expect(contacts.size).toBe(1);
      expect(contacts.get(1)?.currentMidi).toBeCloseTo(33 + start + (end - start) * i / 6);
    }
    expect(contacts.get(1)).toMatchObject({ gesture: "slide", currentFret: end, slap: false });
    contacts.move({ ...pointer, x: 100, y: 150, time: 750 });
    expect(contacts.get(1)?.gesture).toBe("invalid"); // 別弦へ移動した経路は復帰しても失効
  });
  it("斜めの主方向で確定し、横から縦へ変わってもスラップにしない", () => {
    const contacts = createBassContacts(); contacts.begin(input(), 1);
    expect(contacts.move(input(1, 125, 215, 140))).toBe(false);
    expect(contacts.get(1)?.gesture).toBe("slide");
    expect(contacts.move(input(1, 130, 245, 170))).toBe(false);
    expect(contacts.get(1)?.gesture).toBe("invalid");
  });
  it("曖昧な斜め・遅いフリック・0Fをスライド成功にしない", () => {
    const contacts = createBassContacts(); contacts.begin(input(), 1);
    contacts.move(input(1, 125, 225, 200)); expect(contacts.get(1)?.gesture).toBe("pending");
    contacts.move(input(1, 100, 235, 400)); expect(contacts.get(1)?.gesture).toBe("pending");
    contacts.clear(); contacts.begin({ ...input(), fret: 0 }, 1);
    contacts.move(input(1, 160, 200, 180)); expect(contacts.get(1)?.gesture).toBe("invalid");
  });
  it("複数指の位置・時刻・キャンセルが混線しない", () => {
    const contacts = createBassContacts(); contacts.begin(input(), 1); contacts.begin(input(2), 1.01);
    contacts.move(input(1, 150, 200, 200)); contacts.move(input(2, 100, 230, 200));
    expect(contacts.get(1)?.gesture).toBe("slide"); expect(contacts.get(2)?.gesture).toBe("slap");
    expect(contacts.end({ ...input(), action: "cancel" }, 1.2)?.cancelled).toBe(true);
    expect(contacts.size).toBe(1); contacts.clear(); expect(contacts.size).toBe(0);
  });
  it("非有限・逆行時刻の移動を失効させる", () => {
    const contacts = createBassContacts(); contacts.begin(input(), 1);
    contacts.move(input(1, 150, 200, 200)); contacts.move(input(1, 160, 200, 190));
    expect(contacts.get(1)).toMatchObject({ gesture: "invalid", cancelled: true });
  });
});

describe("スライドの共通譜面・時計・判定", () => {
  it.each([[2, 5], [5, 2]])("左右%i→%iを始点・終点で評価して一度だけ加点", (fret, endFret) => {
    const game = playing([slide(fret, endFret), tap(1, 2.125)]); game.tick(1, true);
    expect(game.beginInput(1, 33 + fret, 1, { string: 2, fret })?.technique).toBe("slide");
    expect(game.snapshot()).toMatchObject({ hits: 0, score: 0 });
    game.tick(0.5, true); game.slideInput(1, (fret + endFret) / 2);
    expect(game.snapshot().notes[0]).toMatchObject({ state: "sliding", slideProgress: 0.5 });
    game.tick(0.5, true); expect(game.slideInput(1, endFret)).toMatchObject({ finished: true, success: true, midi: 33 + endFret });
    expect(game.slideInput(1, endFret)).toBeNull(); expect(game.slapInput(1)).toBe(false); game.endInput(1);
    expect(game.snapshot()).toMatchObject({ hits: 1, score: 1000, combo: 1, misses: 0 });
    expect(game.snapshot().performanceEvents.filter(successfulBassEvent)).toHaveLength(1);
    game.tick(0.125, true); game.beginInput(2, 35); game.endInput(2);
    expect(game.snapshot()).toMatchObject({ hits: 2, score: 2000, combo: 2 });
  });
  it.each([[0, "perfect", 1000], [0.06, "great", 850], [0.12, "good", 650], [0.16, "bad", 250], [-0.3, "miss", 0]] as const)("終点の差%f秒を%sと判定", (offset, state, score) => {
    const game = playing(); game.tick(1, true); game.beginInput(1, 35, 1, { string: 2, fret: 2 });
    game.tick(1 + offset, true); game.slideInput(1, 5);
    expect(game.snapshot()).toMatchObject({ feedback: state, score });
    expect(game.snapshot().notes[0].arrivedAt).toBeCloseTo(2 + offset);
  });
  it("始点の悪い判定を終点Excellentで上書きしない", () => {
    const game = playing(); game.tick(1.16, true); game.beginInput(1, 35, 1.16, { string: 2, fret: 2 });
    game.tick(0.84, true); game.slideInput(1, 5);
    expect(game.snapshot()).toMatchObject({ feedback: "bad", score: 250, combo: 0 });
  });
  it("同じMIDIでも別弦・別フレットではスライド開始にならない", () => {
    const game = playing([slide(5, 2)]); game.tick(1, true);
    expect(game.beginInput(1, 38, 1, { string: 1, fret: 0 })?.noteId).toBeNull();
    expect(game.slideInput(1, 2)).toBeNull(); game.endInput(1);
    expect(game.snapshot().notes[0].state).toBe("pending");
    game.beginInput(2, 38, 1, { string: 2, fret: 5 }); expect(game.snapshot().notes[0].state).toBe("sliding");
  });
  it.each(["release", "cancel", "row", "reverse", "timeout", "pause"])("%s時にMiss・表示解除し再加点しない", action => {
    const game = playing(); game.tick(1, true); game.beginInput(1, 35, 1, { string: 2, fret: 2 });
    if (action === "release" || action === "cancel") game.endInput(1, action === "cancel");
    if (action === "row") game.slideInput(1, 3, false);
    if (action === "reverse") { game.slideInput(1, 3); game.slideInput(1, 2); }
    if (action === "timeout") game.tick(1.181, true);
    if (action === "pause") game.suspendInputs();
    expect(game.snapshot()).toMatchObject({ misses: 1, hits: 0, score: 0 });
    expect(game.snapshot().notes[0].state).toBe("miss");
    expect(game.slideInput(1, 5)).toBeNull(); game.endInput(1);
    expect(game.snapshot().misses).toBe(1);
    expect(game.snapshot().performanceEvents.some(successfulBassEvent)).toBe(false);
  });
  it("2本の指のスライドとホールドを別々に採点", () => {
    const game = playing([slide(), { ...tap(1, 1), string: 0, fret: 2, midi: 45, kind: "hold", endTime: 2 }]);
    game.tick(1, true); game.beginInput(1, 35, 1, { string: 2, fret: 2 }); game.beginInput(2, 45);
    game.tick(1, true); game.slideInput(1, 5); game.endInput(1); game.endInput(2);
    expect(game.snapshot()).toMatchObject({ hits: 2, combo: 2, score: 2000 });
  });
  it("開始位置だけにチャージし、同じ時計で始点・終点と帯を置く", () => {
    const game = playing([slide(5, 2)]); const notes = game.snapshot().notes;
    expect(nextCharge(notes, 38, { string: 1, fret: 0 })).toBeUndefined();
    expect(nextCharge(notes, 38, { string: 2, fret: 5 })?.id).toBe(0);
    expect(chargeProgress(1, 1)).toBe(1);
    expect(timelineX(2, 1) - timelineX(1, 1)).toBe(200);
    expect(timelineX(2, 2)).toBe(32);
    game.tick(1, true); game.beginInput(1, 38, 1, { string: 2, fret: 5 });
    const before = game.snapshot(); expect(game.tick(60, true, true)).toEqual(before);
    game.tick(0, true); game.seek(2.3); expect(nextCharge(game.snapshot().notes, 38)).toBeUndefined();
  });
  it.each([{ endString: 1 }, { fret: 0 }, { endFret: 0 }, { endFret: 2 }, { endTime: 1 }, { endMidi: 40 }])("不正なスライド%jを拒否", patch => {
    expect(() => validateBassSlide({ ...slide(), ...patch } as BassNote)).toThrow("Invalid bass slide");
  });
  it("既存曲へ自動追加せず、検証用譜面のみ明示的に含む", () => {
    for (const song of Object.values(BASS_SONGS)) expect(song.notes.some(n => n.kind === "slide")).toBe(false);
    expect(new Set(BASS_TECHNIQUE_STUDY.notes.map(n => n.kind))).toEqual(new Set(["tap", "hold", "slap", "slide"]));
    for (const n of BASS_TECHNIQUE_STUDY.notes) expect(() => validateBassSlide(n)).not.toThrow();
    const game = playing(); game.tick(60, true); expect(game.snapshot().phase).toBe("result");
    expect(game.selectSong("technique-study")).toBe(true); expect(game.snapshot().songId).toBe("technique-study");
  });
  it.each(["easy", "normal", "hard"] as const)("練習%s全曲を4奏法で完走し、最終スコアとコンボを1音1回に保つ", difficulty => {
    const song = BASS_TECHNIQUE_STUDIES[difficulty];
    const game = createBassGame(); game.tick(4.1, true); game.selectSong("technique-study"); game.setDifficulty(difficulty);
    game.start(); game.tick(song.countdownSeconds, true);
    for (const note of song.notes) {
      game.tick(note.time - game.snapshot().elapsed, true);
      game.beginInput(note.id, note.midi, note.time, note);
      if (note.kind === "slap") game.slapInput(note.id);
      if (note.kind === "slide") {
        game.tick((note.endTime! - note.time) / 2, true);
        game.slideInput(note.id, (note.fret + note.endFret!) / 2);
        game.tick(note.endTime! - game.snapshot().elapsed, true);
        game.slideInput(note.id, note.endFret!);
      }
      if (note.kind === "hold") game.tick(note.endTime! - game.snapshot().elapsed, true);
      game.endInput(note.id);
    }
    game.tick(60, true);
    expect(game.snapshot()).toMatchObject({ phase: "result", hits: song.notes.length,
      score: song.notes.length * 1000, combo: song.notes.length, misses: 0, strayPlucks: 0, difficulty });
    expect(game.snapshot().result).toMatchObject({ total: song.notes.length, achievement: 100, rank: "SS", maxCombo: song.notes.length,
      counts: { excellent: song.notes.length, great: 0, good: 0, bad: 0, miss: 0 } });
  });
  it("MIDI修正は明示的な始点・終点で保存可能、原本・確認状態は維持", () => {
    const original = JSON.stringify([master, candidates]);
    const source = candidates.notes.find(n => n.midiNote === 35)!;
    const result = importMidiChart(master, candidates, { schemaVersion: "1.0.0", notes: { [source.id]: {
      kind: "slide", technique: "slide", stringNumber: 3, fret: 2, endStringNumber: 3, endFret: 5, endTimeSec: source.timeSec + 1,
    } } });
    expect(result.notes.find(n => n.sourceId === source.id)).toMatchObject({ kind: "slide", endMidi: 38, endFret: 5, techniqueVerified: false });
    expect(JSON.stringify([master, candidates])).toBe(original);
    expect(() => importMidiChart(master, candidates, { schemaVersion: "1.0.0", notes: { [source.id]: { kind: "slide" } } })).toThrow();
  });
});

describe("奏法練習の完全版と3難易度", () => {
  it.each(["easy", "normal", "hard"] as const)("%sは録音終止まで4奏法を持ち、重複や保持中の次音を作らない", difficulty => {
    const song = BASS_TECHNIQUE_STUDIES[difficulty];
    expect(song).toMatchObject({ id: "technique-study", difficulty, label: difficulty.toUpperCase(), duration: GARDEN_TRACK.duration });
    expect(new Set(song.notes.map(n => n.kind))).toEqual(new Set(["tap", "hold", "slap", "slide"]));
    expect(song.notes.at(-1)).toMatchObject({ time: GARDEN_BASS_NOTES.at(-1)!.time, midi: 38, kind: "hold", endTime: GARDEN_TRACK.fadeStart });
    expect(new Set(song.notes.map(n => n.id)).size).toBe(song.notes.length);
    for (const [index, note] of song.notes.entries()) {
      expect(note.id).toBe(index); expect(note.phraseId).toBe(index);
      expect(note.midi).toBe(BASS_STRINGS[note.string].openMidi + note.fret);
      expect(note.frequency).toBeCloseTo(midiFrequency(note.midi));
      expect(note.fret).toBeGreaterThanOrEqual(1); expect(note.fret).toBeLessThanOrEqual(5);
      expect(() => validateBassSlide(note)).not.toThrow();
      expect(note.endTime ?? note.time).toBeLessThanOrEqual(song.duration);
      if (index) {
        const previous = song.notes[index - 1];
        const gap = note.time - (previous.endTime ?? previous.time);
        expect(gap).toBeGreaterThan(0); expect(gap).toBeLessThanOrEqual(1.81);
      }
    }
    for (const start of [0, 10, 20, 30, 40, 50]) expect(song.notes.some(n => n.time >= start && n.time < start + 10)).toBe(true);
    expect(song.phrases).toHaveLength(song.notes.length);
  });
  it("NORMALの既存31音を維持し、EASYは間引き・短い移動、HARDは拍に合う音を追加", () => {
    const { easy, normal, hard } = BASS_TECHNIQUE_STUDIES;
    expect(BASS_TECHNIQUE_STUDY).toBe(normal);
    expect([easy.notes.length, normal.notes.length, hard.notes.length]).toEqual([46, 61, 102]);
    expect(normal.notes.slice(0, 31).map(n => n.time)).toEqual([
      1, 2, 4, 6, 7, 8, ...Array.from({ length: 8 }, (_, i) => 10 + i * 0.125),
      12, 14, 16, 18, 19, 21, ...Array.from({ length: 8 }, (_, i) => 24 + i * 0.125), 26, 28, 29,
    ]);
    expect(normal.notes[31].time).toBe(gardenBeatToTime(54));
    for (const note of easy.notes.filter(n => n.kind === "slide")) expect(Math.abs(note.endFret! - note.fret)).toBeLessThanOrEqual(2);
    expect(normal.notes.some(n => n.kind === "slide" && Math.abs(n.endFret! - n.fret) > 2)).toBe(true);
    const signature = ({ id: _id, phraseId: _phraseId, ...note }: BassNote) => JSON.stringify(note);
    const originals = new Set(normal.notes.map(signature));
    for (const note of normal.notes) expect(hard.notes.map(signature)).toContain(signature(note));
    for (const note of hard.notes.filter(n => !originals.has(signature(n)))) {
      expect(note.kind).toBe("tap");
      expect(gardenTimeToBeat(note.time) * 2).toBeCloseTo(Math.round(gardenTimeToBeat(note.time) * 2));
    }
  });
  it("曲ごとに難易度を保持し、練習はNORMALを初期選択、演奏中やポーズ中は変更しない", () => {
    const game = createBassGame(); game.tick(4.1, true);
    expect(game.setDifficulty("hard")).toBe(true);
    expect(game.selectSong("technique-study")).toBe(true);
    expect(game.snapshot()).toMatchObject({ difficulty: "normal", notes: expect.any(Array) });
    expect(game.snapshot().notes).toHaveLength(61);
    expect(game.setDifficulty("easy")).toBe(true); expect(game.snapshot().notes).toHaveLength(46);
    game.tick(0, true, true); expect(game.setDifficulty("hard")).toBe(false);
    game.tick(0, true); game.start(); expect(game.setDifficulty("hard")).toBe(false);
    game.tick(BASS_TECHNIQUE_STUDIES.easy.countdownSeconds + 1, true);
    game.beginInput(1, 35); game.endInput(1);
    expect(game.snapshot().hits).toBe(1); expect(game.setDifficulty("hard")).toBe(false);
    game.tick(60, true); expect(game.setDifficulty("hard")).toBe(true);
    expect(game.snapshot()).toMatchObject({ phase: "ready", difficulty: "hard", score: 0, combo: 0, hits: 0, elapsed: 0 });
    expect(game.snapshot().notes).toHaveLength(102);
    game.selectSong("garden-party"); expect(game.snapshot().difficulty).toBe("hard");
    game.setDifficulty("normal"); game.selectSong("technique-study"); expect(game.snapshot().difficulty).toBe("hard");
    game.selectSong("final-hit"); expect(game.setDifficulty("easy")).toBe(true);
    game.selectSong("garden-party"); expect(game.snapshot().difficulty).toBe("normal");
  });
});

describe("判定イベントを使う主人公の演奏演出", () => {
  function scene(snapshot: BassGameSnapshot) {
    const scope = createDisposalScope(), instrument = new THREE.Group();
    const effects = createBassPerformanceEffects(scope, instrument); effects.update(snapshot, false); return { scope, effects, instrument };
  }
  it.each(["tap", "slap", "slide"] as const)("%s成功で発光、専用形状、再描画で二重発生しない", kind => {
    const game = playing([{ ...slide(), kind }]); game.tick(1, true); game.beginInput(1, 35, 1, { string: 2, fret: 2 });
    if (kind === "slap") game.slapInput(1);
    if (kind === "slide") { game.tick(1, true); game.slideInput(1, 5); }
    const snapshot = game.snapshot(); const { scope, effects } = scene(snapshot);
    expect(effects.root.userData.activeBursts).toBe(1);
    const ring = effects.root.children.find(child => child.visible && child.name.includes("burst"))!.children[1];
    expect(ring.visible).toBe(kind === "slap");
    effects.update(snapshot, false); expect(effects.root.userData.activeBursts).toBe(1);
    effects.update({ ...snapshot, elapsed: snapshot.elapsed + 1 }, false); expect(effects.root.userData.activeBursts).toBe(0);
    scope.dispose(); expect(effects.root.parent).toBeNull();
  });
  it("Excellentで星が増え、20/50コンボで段階が変わる", () => {
    expect([0, 19, 20, 49, 50, 100].map(bassComboTier)).toEqual([0, 0, 1, 1, 2, 2]);
    const game = playing([tap(0, 1)]); game.tick(1, true); game.beginInput(1, 35);
    const snapshot = game.snapshot(); const { scope, effects } = scene(snapshot);
    const slot = effects.root.children.find(c => c.visible && c.name.includes("burst"))!;
    expect(slot.children.filter(c => c.visible)).toHaveLength(4); // glow + 3 stars
    effects.update({ ...snapshot, combo: 50 }, false); expect(effects.root.userData.comboTier).toBe(2);
    scope.dispose();
  });
  it("保持中の持続光は終了・キャンセルで解除する", () => {
    const game = playing([{ ...tap(0, 1), kind: "hold", endTime: 2 }]); game.tick(1, true); game.beginInput(1, 35);
    const { scope, effects } = scene(game.snapshot());
    expect(effects.root.children.slice(-8).filter(c => c.visible)).toHaveLength(1);
    game.endInput(1, true); effects.update(game.snapshot(), false);
    expect(effects.root.children.filter(c => c.visible)).toHaveLength(0); scope.dispose();
  });
  it("Miss/Badで成功演出を出さず、大量連打も固定プール内、ポーズで時間不変", () => {
    const game = playing([tap(0, 1)]); game.tick(1.16, true); game.beginInput(1, 35);
    const snapshot = game.snapshot(); const { scope, effects } = scene(snapshot);
    expect(effects.root.userData.activeBursts).toBe(0);
    const events = Array.from({ length: 100 }, (_, serial) => ({ ...snapshot.performanceEvents[0], serial: serial + 10, stage: "complete" as const, grade: "perfect" as const, time: 1.16 }));
    effects.update({ ...snapshot, performanceEvents: events }, false);
    expect(effects.root.userData.activeBursts).toBe(BASS_EFFECT_CONFIG.capacity);
    const count = effects.root.children.length;
    effects.update({ ...snapshot, performanceEvents: events }, false);
    expect(effects.root.children).toHaveLength(count);
    effects.update({ ...snapshot, elapsed: 2 }, false); expect(effects.root.userData.activeBursts).toBe(0);
    scope.dispose();
  });
});
