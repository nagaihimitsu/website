import { describe, it, expect } from "vitest";
import { geoArea } from "d3-geo";
import type { Feature } from "geojson";
import {
  parseArchive,
  validDate,
  formatDate,
  safePhoto,
  pokemonCounts,
  representative,
  resolveEntry,
} from "../src/data/parser";
import { files } from "../src/data/model";
import { catalogs } from "../src/data/catalogs";
import world from "../src/catalogs/world.json";
import japan from "../src/catalogs/japan.json";
import provenance from "../src/catalogs/provenance.json";
const data = (values: Partial<Record<keyof typeof files, string>>) =>
  Object.fromEntries(
    Object.entries(values).map(([k, v]) => [files[k as keyof typeof files], v]),
  );
describe("TXTと集計", () => {
  it("T01 日本・アメリカ・イギリスを同じID集合にする", () => {
    const a = parseArchive(data({ world: "日本,アメリカ,イギリス" }));
    expect([...a.achieved.world]).toEqual(["JPN", "USA", "GBR"]);
    expect(a.issues).toEqual([]);
    for (const id of a.achieved.world)
      expect(world.features.some((f) => f.id === id)).toBe(true);
  });
  it("T02 都道府県と山は独立", () => {
    const a = parseArchive(
      data({ japan: "東京都\n埼玉県", mountains: "富士山" }),
    );
    expect([...a.achieved.japan]).toEqual(["13", "11"]);
    expect(a.achieved.mountains.size).toBe(1);
  });
  it("T03 主峰を同じ百名山に正規化", () => {
    const a = parseArchive(data({ mountains: "富士山\n奥穂高岳" }));
    expect([...a.achieved.mountains]).toEqual(["m072", "m055"]);
  });
  it("T04 燕岳は行番号付きでエラー", () => {
    const a = parseArchive(data({ mountains: "# コメント\n燕岳" }));
    expect(a.issues[0]).toMatchObject({
      line: 2,
      file: files.mountains,
      severity: "error",
    });
    expect(a.issues[0].message).toContain("対象外");
  });
  it("T05 通常色・色違いの4状態と和集合", () => {
    const a = parseArchive(data({ normal: "1,25", shiny: "25,150" }));
    expect(pokemonCounts(a)).toEqual({
      normal: 2,
      shiny: 2,
      both: 1,
      total: 3,
    });
    expect(a.normal.has("150")).toBe(false);
    expect(a.shiny.has("1")).toBe(false);
    expect(a.achieved.pokemon.has("2")).toBe(false);
  });
  it("T06 図鑑番号・名前・先頭ゼロの重複は警告", () => {
    const a = parseArchive(data({ normal: "25\nピカチュウ\n025" }));
    expect(a.normal.size).toBe(1);
    expect(a.issues).toHaveLength(2);
    expect(a.issues.every((i) => i.severity === "warning")).toBe(true);
  });
  it("BOM、CRLF、空白、コメント、カンマ、波括弧に対応", () => {
    const a = parseArchive(
      data({
        world: "\uFEFF# heading\r\n\r\n　{日本,アメリカ}　\r\n イギリス \r\n",
      }),
    );
    expect(a.achieved.world.size).toBe(3);
    expect(a.issues).toEqual([]);
  });
  it("別名重複・未知名は区別し候補を表示", () => {
    const a = parseArchive(data({ world: "アメリカ,アメリカ合衆国,アメリア" }));
    expect(a.achieved.world.size).toBe(1);
    expect(a.issues.map((x) => x.severity)).toEqual(["warning", "error"]);
    expect(a.issues[1].message).toContain("候補");
  });
  it("T09 同日複数記録を保持、日付不明は末尾", () => {
    const a = parseArchive(
      data({
        world: "日本",
        worldRecords:
          "日本||\n日本|2024|\n日本|2025-01|a.webp,b.jpg\n日本|2025-01|c.avif",
      }),
      () => true,
    );
    expect(a.achieved.world.size).toBe(1);
    expect(a.records.world).toHaveLength(4);
    expect(a.records.world.map((r) => r.date)).toEqual([
      "2025-01",
      "2025-01",
      "2024",
      "",
    ]);
    expect(representative(a.records.world)).toBe("a.webp");
    expect(a.issues).toEqual([]);
  });
  it("詳細だけでは実績を追加しない", () => {
    const a = parseArchive(data({ worldRecords: "日本|2024|" }));
    expect(a.achieved.world.size).toBe(0);
    expect(a.issues[0].message).toContain("実績TXT");
  });
  it("詳細の色ごとの整合性を検証", () => {
    const a = parseArchive(
      data({ normal: "25", pokemonRecords: "25|shiny|2024|" }),
    );
    expect(a.shiny.size).toBe(0);
    expect(a.issues[0].message).toContain("shiny");
  });
  it("区切りとvariantを検証", () => {
    const a = parseArchive(
      data({
        world: "日本",
        normal: "25",
        worldRecords: "日本|2024",
        pokemonRecords: "25|other||",
      }),
    );
    expect(a.issues).toHaveLength(2);
  });
  it("T10 未記入の年月日・写真は正常", () => {
    const a = parseArchive(data({ world: "日本", worldRecords: "日本||" }));
    expect(a.issues).toEqual([]);
    expect(a.records.world[0]).toMatchObject({ date: "", photos: [] });
  });
  it("T11 空データは正常、未達成を隠さない", () => {
    const a = parseArchive({});
    expect(a.issues).toEqual([]);
    expect(pokemonCounts(a).total).toBe(0);
    expect(catalogs.mountains).toHaveLength(100);
  });
  it("T15 欠損画像をエラーにする", () => {
    const a = parseArchive(
      data({ world: "日本", worldRecords: "日本||missing.webp" }),
      () => false,
    );
    expect(a.issues[0]).toMatchObject({ line: 1, severity: "error" });
    expect(a.issues[0].message).toContain("見つかりません");
  });
  it("HTML文字列は未知名として扱う", () => {
    const a = parseArchive(data({ world: "<script>alert(1)</script>" }));
    expect(a.issues).toHaveLength(1);
    expect(a.achieved.world.size).toBe(0);
  });
});
describe("日付の精度と実在性", () => {
  it.each([
    "2024",
    "2024-05",
    "2024-05-12",
    "",
    "2024-02-29",
    "2000-02-29",
    "0001-01-01",
  ])("有効: %s", (d) => expect(validDate(d)).toBe(true));
  it.each([
    "2024-02-30",
    "2025-02-29",
    "1900-02-29",
    "2025-13",
    "2024-00",
    "2024-01-00",
    "2024-04-31",
    "0000",
    "2024-2",
    "2024/01/01",
    "2024-05-12T00:00",
  ])("無効: %s", (d) => expect(validDate(d)).toBe(false));
  it("T07 入力した精度を保つ", () =>
    expect(["2024", "2024-05", "2024-05-12", ""].map(formatDate)).toEqual([
      "2024年",
      "2024年5月",
      "2024年5月12日",
      "",
    ]));
  it("T08 不正な日付は解析時にエラー", () =>
    expect(
      parseArchive(data({ world: "日本", worldRecords: "日本|2024-02-30|" }))
        .issues[0].message,
    ).toContain("不正な日付"));
});
describe("写真パス", () => {
  it.each([
    "../secret.jpg",
    "/root.jpg",
    "https://example.com/a.jpg",
    "a/../b.jpg",
    "a\\b.jpg",
    "a.svg",
    "a%2f.jpg",
    "a//b.jpg",
    "a/./b.jpg",
    "a.jpg?x=1",
  ])("拒否: %s", (p) => expect(safePhoto(p)).toBe(false));
  it.each(["countries/japan/01.webp", "富士山/写真 01.JPG", "image.avif"])(
    "許可: %s",
    (p) => expect(safePhoto(p)).toBe(true),
  );
});
describe("静的マスターの完全性", () => {
  it("海外領域を独立したISO IDに対応し、D3の地図方向を維持", () => {
    for (const id of [
      "FRA",
      "GUF",
      "GLP",
      "MTQ",
      "MYT",
      "REU",
      "SJM",
      "BES",
      "CXR",
      "CCK",
    ])
      expect(world.features.some((f) => f.id === id)).toBe(true);
    for (const f of world.features)
      expect(geoArea(f as Feature)).toBeLessThan(2 * Math.PI);
  });
  it("47県すべてに形状がある", () => {
    expect(catalogs.japan).toHaveLength(47);
    expect(new Set(japan.features.map((f) => f.id))).toEqual(
      new Set(catalogs.japan.map((e) => e.id)),
    );
  });
  it("全基本種の番号と日本語名が欠けない", () => {
    expect(catalogs.pokemon).toHaveLength(provenance.pokemonSpeciesCount);
    catalogs.pokemon.forEach((p, i) => {
      expect(p.speciesId).toBe(i + 1);
      expect(p.name).toBeTruthy();
    });
    expect(catalogs.pokemon.at(-1)?.name).toBe("モモワロウ");
  });
  it("100座のID・名称・座標・根拠が揃う", () => {
    expect(catalogs.mountains).toHaveLength(100);
    expect(new Set(catalogs.mountains.map((m) => m.id)).size).toBe(100);
    catalogs.mountains.forEach((m) => {
      expect(m.coordinates?.every(Number.isFinite)).toBe(true);
      expect(m.source).toContain("maps.gsi.go.jp");
      expect(m.coordinateBasis).toBeTruthy();
    });
  });
  it("同名別山を混入させない", () => {
    expect(resolveEntry("mountains", "乗鞍岳")?.elevation).toBe(3026);
    expect(resolveEntry("mountains", "薬師岳")?.coordinates?.[0]).toBeCloseTo(
      137.54,
      1,
    );
    expect(resolveEntry("mountains", "男体山")?.region).toBe("栃木県");
    expect(resolveEntry("mountains", "木曽駒ヶ岳")?.elevation).toBe(2956);
    expect(resolveEntry("mountains", "燕岳")).toBeUndefined();
  });
});
