import { describe, expect, it } from "vitest";
import { catalogs } from "../src/data/catalogs";
import { countryView, groupCountries, worldRegions } from "../src/maps/worldData";
import metadata from "../src/catalogs/world-view.json";
describe("WORLD表示アダプター", () => {
  it("既存249IDを重複・欠落なく地域に分類し、有効な代表点を持つ", () => {
    expect(Object.keys(metadata).sort()).toEqual(catalogs.world.map(entry => entry.id).sort());
    const groups = groupCountries("", "all", new Set());
    expect(groups.flatMap(group => group.entries.map(entry => entry.id)).sort()).toEqual(catalogs.world.map(entry => entry.id).sort());
    for (const entry of catalogs.world) {
      const view = countryView(entry);
      expect(worldRegions.map(([id]) => id)).toContain(view.region);
      expect(view.point[0]).toBeGreaterThanOrEqual(-180); expect(view.point[0]).toBeLessThanOrEqual(180);
      expect(view.point[1]).toBeGreaterThanOrEqual(-90); expect(view.point[1]).toBeLessThanOrEqual(90);
    }
  });
  it("検索・訪問フィルターと地域件数が同じID集合を扱う", () => {
    const visited = new Set(["JPN", "GBR", "USA"]);
    expect(groupCountries("", "done", visited).flatMap(g => g.entries.map(e => e.id)).sort()).toEqual([...visited].sort());
    expect(groupCountries("", "todo", visited).flatMap(g => g.entries)).toHaveLength(catalogs.world.length - 3);
    expect(groupCountries("JAPAN", "all", visited).flatMap(g => g.entries.map(e => e.id))).toEqual(["JPN"]);
    expect(groupCountries("GBR", "all", visited).flatMap(g => g.entries.map(e => e.id))).toEqual(["GBR"]);
    for (const group of groupCountries("", "all", visited)) {
      expect(group.visited).toBe(group.entries.filter(entry => visited.has(entry.id)).length);
      const firstUnvisited = group.entries.findIndex(entry => !visited.has(entry.id));
      if (firstUnvisited >= 0) expect(group.entries.slice(firstUnvisited).every(entry => !visited.has(entry.id))).toBe(true);
    }
  });
  it("大国・日付変更線の国も経度の平均でなく元資料のラベル点を使う", () => {
    const view = (id: string) => countryView(catalogs.world.find(entry => entry.id === id)!);
    expect(Math.abs(view("FJI").point[0])).toBeGreaterThan(160);
    expect(view("RUS").point[0]).toBeGreaterThan(30);
    expect(view("GBR").point[0]).toBeGreaterThan(-10);
    expect(view("JPN").region).toBe("Eastern Asia");
    expect(view("UMI").note).toContain("ミッドウェー");
  });
  it("小地域と境界地域・海外領土を一意に分類する", () => {
    expect(worldRegions).toHaveLength(23);
    const expected = {
      JPN: "Eastern Asia", TWN: "Eastern Asia", THA: "South-Eastern Asia", IND: "Southern Asia",
      IRN: "Southern Asia", KAZ: "Central Asia", TUR: "Western Asia", CYP: "Western Asia",
      RUS: "Eastern Europe", GBR: "Northern Europe", FRA: "Western Europe", GIB: "Southern Europe",
      MEX: "Central America", CUB: "Caribbean", GUF: "South America", USA: "Northern America",
      EGY: "Northern Africa", IOT: "Eastern Africa", ZAF: "Southern Africa",
      AUS: "Australia and New Zealand", FJI: "Melanesia", UMI: "Micronesia", WSM: "Polynesia",
      ATA: "Antarctica", BVT: "Antarctica", SGS: "Antarctica", ATF: "Antarctica", HMD: "Antarctica",
    };
    for (const [id, region] of Object.entries(expected)) {
      expect(countryView(catalogs.world.find(entry => entry.id === id)!)).toMatchObject({ region });
    }
  });
});
