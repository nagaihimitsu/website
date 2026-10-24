import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import fixture from "./fixtures/bass-sustain-g1.json" with { type: "json" };
import { describe, expect, it } from "vitest";
import { bassSustainSamples, BASS_SUSTAIN_CONFIG as CONFIG } from "../src/room/bassSustain";
import { createBassContacts, type BassPointerInput } from "../src/room/bassInput";

describe("1回のアタックと連続した持続波形", () => {
  it.each([24000, 44100, 48000])("%iHzでアタックを維持し、持続部分を周期・位相・振幅が同じループにする", rate => {
    const source = Float32Array.from({ length: rate }, (_, i) => 0.1 * Math.sin(2 * Math.PI * 49 * i / rate) * Math.exp(-Math.max(0, i / rate - 0.4) * 8));
    const { samples, loopStart, loopEnd } = bassSustainSamples(source, rate);
    const offset = Math.round(CONFIG.attackOffset * rate), attackEnd = offset + Math.round(CONFIG.blendStart * rate);
    expect([...samples.slice(offset, attackEnd)]).toEqual([...source.slice(offset, attackEnd)]);
    const start = Math.round(loopStart * rate), end = Math.round(loopEnd * rate), period = (end - start) / CONFIG.loopCycles;
    for (let i = start; i < end - period; i++) expect(samples[i]).toBeCloseTo(samples[i + period], 7);
    expect(Math.abs(samples[end - 1] - samples[start])).toBeLessThan(0.005);
    expect(samples.every(Number.isFinite)).toBe(true);
  });
  it("実際の既存MP3の継ぎ目・繰り返し減衰を除き、1／2／4秒とも再アタックしない", () => {
    const bytes = readFileSync("tests/fixtures/bass-sustain-g1.f32");
    const sha = (data: Buffer) => createHash("sha256").update(data).digest("hex");
    expect(sha(readFileSync(fixture.sourcePath))).toBe(fixture.sourceSha256);
    expect(sha(bytes)).toBe(fixture.sha256); expect(bytes.length).toBe(fixture.frames * 4);
    const source = Float32Array.from({ length: fixture.frames }, (_, index) => bytes.readFloatLE(index * 4));
    const { samples, loopStart, loopEnd } = bassSustainSamples(source, 24000);
    const start = Math.round(loopStart * 24000), end = Math.round(loopEnd * 24000);
    const jump = Math.abs(samples[end - 1] - samples[start]);
    const oldJump = Math.abs(source[Math.round(0.55 * 24000) - 1] - source[Math.round(0.39 * 24000)]);
    expect(jump).toBeLessThan(oldJump / 10);
    const rms = (data: Float32Array) => Math.sqrt(data.reduce((sum, value) => sum + value * value, 0) / data.length);
    for (const seconds of [1, 2, 4]) {
      const rendered = Float32Array.from({ length: seconds * 24000 }, (_, i) => samples[start + i % (end - start)]);
      const energy = Array.from({ length: Math.floor(rendered.length / (end - start)) }, (_, i) => rms(rendered.slice(i * (end - start), (i + 1) * (end - start))));
      expect(Math.min(...energy)).toBeGreaterThan(0.01);
      expect(Math.max(...energy) / Math.min(...energy)).toBeLessThan(1.001);
    }
  });
});

const pointer = (id = 1, x = 100, y = 200, time = 100): BassPointerInput => ({ id, action: "down", x, y, time, midi: 35, string: 2, fret: 2, fretWidth: 50, rowTop: 175, rowBottom: 225 });
describe("端末サイズと揺れに対応した排他的なジェスチャー", () => {
  it.each([-1, 1])("縦%fフリックの横ぶれを許容し、開始位置で1回のみスラップ", direction => {
    const contacts = createBassContacts(); contacts.begin(pointer(), 1);
    expect(contacts.move(pointer(1, 110, 200 + direction * 30, 180))).toBe(true);
    expect(contacts.get(1)).toMatchObject({ gesture: "slap", midi: 35, fret: 2 });
    expect(contacts.move(pointer(1, 250, 200, 200))).toBe(false);
    expect(contacts.get(1)?.gesture).toBe("slap");
  });
  it.each([-1, 1])("横移動の縦%f方向のぶれと端付近の揺れを許容", direction => {
    const contacts = createBassContacts(); contacts.begin(pointer(1, 100, 223), 1);
    contacts.move(pointer(1, 150, 223 + direction * 6, 200));
    expect(contacts.get(1)).toMatchObject({ gesture: "slide", currentFret: 3, currentMidi: 36, speedX: 0.5 });
    contacts.move(pointer(1, 250, 223 + direction * 8, 400));
    expect(contacts.get(1)).toMatchObject({ gesture: "slide", currentFret: 5 });
  });
  it("45度は未確定のまま継続し、主方向が決まってから一方だけ確定", () => {
    const contacts = createBassContacts(); contacts.begin(pointer(), 1);
    contacts.move(pointer(1, 125, 225, 150)); expect(contacts.get(1)?.gesture).toBe("pending");
    expect(contacts.move(pointer(1, 125, 245, 180))).toBe(true);
    expect(contacts.get(1)?.gesture).toBe("slap");
  });
  it.each([44, 56, 72])("高さ%iのボタンでも過大な移動を要求しない", height => {
    const contacts = createBassContacts();
    contacts.begin({ ...pointer(), rowTop: 200 - height / 2, rowBottom: 200 + height / 2 }, 1);
    expect(contacts.move(pointer(1, 102, 200 + height * 0.44, 180))).toBe(true);
  });
  it("別弦やキャンセルで状態を解放し、他の指を維持", () => {
    const contacts = createBassContacts(); contacts.begin(pointer(), 1); contacts.begin(pointer(2), 1);
    contacts.move(pointer(1, 180, 200, 200)); contacts.move(pointer(1, 180, 260, 220));
    expect(contacts.get(1)).toMatchObject({ gesture: "invalid", cancelled: true });
    contacts.end({ ...pointer(), action: "cancel" }, 1.2);
    expect(contacts.get(1)).toBeUndefined(); expect(contacts.get(2)?.gesture).toBe("pending");
    contacts.clear(); expect(contacts.size).toBe(0);
  });
});
