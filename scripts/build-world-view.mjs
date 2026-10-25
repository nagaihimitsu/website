// 既存の固定Natural Earthから表示用属性だけを抽出する。地図・国マスター・TXTは変更しない。
import fs from "node:fs";
import crypto from "node:crypto";
import { geoArea } from "d3-geo";
const source = JSON.parse(fs.readFileSync("scripts/catalogs/sources.json"))["world.json"];
const bytes = fs.readFileSync(process.argv[2]);
if (crypto.createHash("sha256").update(bytes).digest("hex") !== source.sha256) throw new Error("固定ソースのSHA-256不一致");
const countries = JSON.parse(fs.readFileSync("src/catalogs/countries.json"));
const ids = new Set(countries.map(c => c.id));
const groups = new Map();
for (const feature of JSON.parse(bytes).features) {
  const p = feature.properties;
  const id = p.GU_A3 === "NJM" ? "SJM" : ids.has(p.ISO_A3_EH) ? p.ISO_A3_EH : ids.has(p.ISO_A3) ? p.ISO_A3 : p.ADM0_A3;
  if (!ids.has(id)) continue;
  if (!groups.has(id) || geoArea(feature) > geoArea(groups.get(id))) groups.set(id, feature);
}
const extras = {
  BVT: { region: "Antarctica", point: [3.35, -54.42], note: "地図形状なし · ブーベ島付近の代表点" },
  GIB: { region: "Europe", point: [-5.35, 36.14], note: "地図形状なし · ジブラルタル付近の代表点" },
  UMI: { region: "Oceania", point: [-177.37, 28.21], note: "地図形状なし · 分散する島々のうちミッドウェーを代表点として表示" },
};
const result = Object.fromEntries(countries.map(c => {
  const p = groups.get(c.id)?.properties;
  if (!p && !extras[c.id]) throw new Error(`表示属性なし: ${c.id}`);
  return [c.id, p ? { region: p.CONTINENT === "Seven seas (open ocean)" ? (p.REGION_UN === "Americas" ? "South America" : p.REGION_UN) : p.CONTINENT, point: [p.LABEL_X, p.LABEL_Y] } : extras[c.id]];
}));
fs.writeFileSync("src/catalogs/world-view.json", JSON.stringify(result, null, 2) + "\n");
