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
    expect(view("JPN").region).toBe("Asia");
    expect(view("UMI").note).toContain("ミッドウェー");
  });
});
