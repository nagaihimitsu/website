import { describe, expect, it } from "vitest";
import { catalogs } from "../src/data/catalogs";
import { constrainJapan, fitJapan, japanFeatures, mountainProjection } from "../src/maps/japanView";
import { geoPath } from "d3-geo";
import { mountainPrefectures, mountainRegion } from "../src/maps/mountainData";
import prefectures from "../src/catalogs/mountain-prefectures.json";

describe("JAPANの表示データと移動範囲", () => {
  it("100座すべてに番号・標高・実在する所属県があり、複数県も保持する", () => {
    expect(catalogs.mountains).toHaveLength(100);
    expect(Object.keys(prefectures).sort()).toEqual(catalogs.mountains.map(entry => entry.id).sort());
    const names = new Set(catalogs.japan.map(entry => entry.name));
    catalogs.mountains.forEach((entry, index) => {
      expect(entry.id).toBe(`m${String(index + 1).padStart(3, "0")}`);
      expect(entry.elevation).toBeGreaterThan(0);
      expect(entry.region).toBeTruthy();
      for (const name of mountainPrefectures(entry)) expect(names).toContain(name);
      for (const name of entry.region!.split("・")) expect(mountainPrefectures(entry)).toContain(name);
    });
    expect(catalogs.mountains.find(entry => entry.id === "m087")?.region).toBe("岐阜県・石川県");
    expect(catalogs.mountains.find(entry => entry.id === "m067")?.region).toBe("埼玉県・山梨県・長野県");
    expect(mountainRegion(catalogs.mountains.find(entry => entry.id === "m012")!)).toBe("岩手県・秋田県");
    expect(mountainRegion(catalogs.mountains.find(entry => entry.id === "m046")!)).toBe("富山県・長野県");
    expect(mountainRegion(catalogs.mountains.find(entry => entry.id === "m066")!)).toBe("埼玉県・東京都・山梨県");
  });
  for (const height of [400, 680, 950]) it(`高さ${height}でも北海道・沖縄を含む47県が初期範囲に収まる`, () => {
    const view = fitJapan(850, height), bounds = geoPath().bounds(japanFeatures);
    for (const point of bounds) {
      const x = (point[0] - 425) * view.zoom + 425 + view.pan[0];
      const y = (point[1] - height / 2) * view.zoom + height / 2 + view.pan[1];
      expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThanOrEqual(850);
      expect(y).toBeGreaterThanOrEqual(0); expect(y).toBeLessThanOrEqual(height);
    }
  });
  it("全100座へ中央移動でき、極端なドラッグ・倍率を制限する", () => {
    const width = 850, height = 800, fit = fitJapan(width, height);
    for (const entry of catalogs.mountains) {
      const [x, y] = mountainProjection(entry.coordinates as [number, number])!;
      const zoom = fit.zoom * 6;
      const view = constrainJapan({ zoom, pan: [(width / 2 - x) * zoom, (height / 2 - y) * zoom] }, width, height);
      expect((x - width / 2) * view.zoom + width / 2 + view.pan[0]).toBeCloseTo(width / 2, 4);
      expect((y - height / 2) * view.zoom + height / 2 + view.pan[1]).toBeCloseTo(height / 2, 4);
    }
    for (const delta of [-1e6, 1e6]) {
      const limited = constrainJapan({ zoom: fit.zoom * 100, pan: [delta, delta] }, width, height);
      expect(limited.zoom / fit.zoom).toBe(32);
      expect(Math.abs(limited.pan[0])).toBeLessThan(1e5);
      expect(Math.abs(limited.pan[1])).toBeLessThan(1e5);
      const again = constrainJapan(limited, width, height);
      expect(again.pan[0]).toBeCloseTo(limited.pan[0], 7);
      expect(again.pan[1]).toBeCloseTo(limited.pan[1], 7);
    }
    expect(constrainJapan({ zoom: .01, pan: [0, 0] }, width, height).zoom).toBe(fit.zoom);
  });
});
