// 既存マスターを保持し、百名山としての所属県だけを固定資料から補う。
import fs from "node:fs";
import crypto from "node:crypto";
import { geoDistance } from "d3-geo";
const source = JSON.parse(fs.readFileSync("scripts/catalogs/sources.json"))["mountain-prefectures.json"];
const bytes = fs.readFileSync(process.argv[2]);
if (crypto.createHash("sha256").update(bytes).digest("hex") !== source.sha256) throw new Error("所属県資料のSHA-256不一致");
const rows = JSON.parse(bytes), mountains = JSON.parse(fs.readFileSync("src/catalogs/mountains.json"));
const reference = new Map(rows.map(row => [row.no, row]));
if (rows.length !== 100 || reference.size !== 100) throw new Error("所属県資料の100番号が不正");
const result = Object.fromEntries(mountains.map(entry => {
  const row = reference.get(Number(entry.id.slice(1))), previous = entry.region.split("・");
  // 比較資料の白山・大台ヶ原は粗い座標。県情報だけを採用し、既存の山頂座標は使い続ける。
  const toleranceKm = entry.id === "m087" ? 30 : entry.id === "m090" ? 12 : 10;
  if (!row || geoDistance(entry.coordinates, [row.coordinates.lon, row.coordinates.lat]) > toleranceKm / 6371) throw new Error(`山の対応を要確認: ${entry.id}`);
  const prefectures = row.prefectures_ja.split(" / ");
  if (!previous.every(name => prefectures.includes(name))) throw new Error(`既存の所属県が資料にない: ${entry.id}`);
  return [entry.id, [...new Set([...previous, ...prefectures])]];
}));
fs.writeFileSync("src/catalogs/mountain-prefectures.json", JSON.stringify(result, null, 2) + "\n");
