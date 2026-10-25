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
  GIB: { region: "Southern Europe", point: [-5.35, 36.14], note: "地図形状なし · ジブラルタル付近の代表点" },
  UMI: { region: "Micronesia", point: [-177.37, 28.21], note: "地図形状なし · 分散する島々のうちミッドウェーを代表点として表示" },
};
// 元資料の「外洋」は小地域ではないため、所在する地理区域へ明示的に割り当てる。
// 南極周辺の島は南極とまとめ、統治国の所在による分類や重複登録を避ける。
const oceanRegions = { SGS: "Antarctica", ATF: "Antarctica", HMD: "Antarctica", IOT: "Eastern Africa" };
const result = Object.fromEntries(countries.map(c => {
  const p = groups.get(c.id)?.properties;
  if (!p && !extras[c.id]) throw new Error(`表示属性なし: ${c.id}`);
  const region = p?.SUBREGION === "Seven seas (open ocean)" ? oceanRegions[c.id] : p?.SUBREGION;
  if (p && !region) throw new Error(`小地域分類なし: ${c.id}`);
  return [c.id, p ? { region, point: [p.LABEL_X, p.LABEL_Y] } : extras[c.id]];
}));
fs.writeFileSync("src/catalogs/world-view.json", JSON.stringify(result, null, 2) + "\n");
