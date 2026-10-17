import { readFileSync, existsSync, realpathSync, statSync } from "node:fs";
import { resolve, relative } from "node:path";
import { catalogs, sections } from "../src/data/catalogs";
import { files } from "../src/data/model";
import { parseArchive } from "../src/data/parser";
import world from "../src/catalogs/world.json";
import japan from "../src/catalogs/japan.json";
import provenance from "../src/catalogs/provenance.json";
const errors: string[] = [];
const check = (ok: boolean, message: string) => {
  if (!ok) errors.push(message);
};
check(catalogs.japan.length === 47, "都道府県は47件必要です。");
check(catalogs.mountains.length === 100, "百名山は100件必要です。");
check(
  catalogs.pokemon.length === provenance.pokemonSpeciesCount,
  "全国図鑑のスナップショット件数が一致しません。",
);
for (const section of sections) {
  const entries = catalogs[section];
  check(
    new Set(entries.map((e) => e.id)).size === entries.length,
    `${section}: ID重複`,
  );
  check(
    new Set(entries.map((e) => e.name)).size === entries.length,
    `${section}: 名称重複`,
  );
  const aliases = new Map<string, string>();
  for (const e of entries) {
    for (const alias of new Set([e.id, e.name, ...e.aliases])) {
      check(
        !aliases.has(alias) || aliases.get(alias) === e.id,
        `${section}: 別名「${alias}」が複数項目に一致します。`,
      );
      aliases.set(alias, e.id);
    }
  }
}
for (let i = 0; i < catalogs.pokemon.length; i++) {
  const p = catalogs.pokemon[i];
  check(
    p.speciesId === i + 1 && p.id === String(i + 1) && !!p.name && !!p.english,
    `図鑑番号 ${i + 1}: 欠損`,
  );
}
const prefectureIds = new Set(japan.features.map((f) => f.id));
check(prefectureIds.size === 47, "県境データは47件必要です。");
for (const e of catalogs.japan)
  check(prefectureIds.has(e.id), "県境欠損: " + e.name);
for (const e of catalogs.mountains) {
  const [lon, lat] = e.coordinates ?? [];
  check(
    Number.isFinite(lon) &&
      Number.isFinite(lat) &&
      lon >= 128 &&
      lon <= 146 &&
      lat >= 30 &&
      lat <= 46,
    `百名山座標不正: ${e.name}`,
  );
  check(
    !!e.source && !!e.coordinateBasis && !!e.representativePeak,
    `百名山の出典・代表峰欠損: ${e.name}`,
  );
}
check(
  !catalogs.mountains.some((m) => m.name === "燕岳"),
  "燕岳は日本百名山ではありません。",
);
for (const e of catalogs.world)
  check(
    e.hasGeometry === world.features.some((f) => f.id === e.id),
    `国のポリゴン対応不整合: ${e.name}`,
  );
const photoRoot = resolve("public/photos");
const texts = Object.fromEntries(
  Object.values(files).map((file) => {
    try {
      return [file, readFileSync(resolve("public/data", file), "utf8")];
    } catch {
      errors.push(`TXTが見つかりません: ${file}`);
      return [file, ""];
    }
  }),
);
const archive = parseArchive(texts, (p) => {
  const path = resolve(photoRoot, p);
  if (!existsSync(path) || !statSync(path).isFile()) return false;
  const real = realpathSync(path);
  return !relative(realpathSync(photoRoot), real).startsWith("..");
});
for (const issue of archive.issues) {
  const message = `${issue.file}:${issue.line}: ${issue.message}`;
  if (issue.severity === "error") errors.push(message);
  else console.warn("WARNING " + message);
}
if (errors.length) {
  for (const error of errors) console.error("ERROR " + error);
  process.exitCode = 1;
} else {
  console.log(
    `検証成功: 都道府県 ${catalogs.japan.length} / 百名山 ${catalogs.mountains.length} / 全国図鑑 ${catalogs.pokemon.length}`,
  );
  console.log(
    `実績: 国 ${archive.achieved.world.size}, 県 ${archive.achieved.japan.size}, 山 ${archive.achieved.mountains.size}, ポケモン ${archive.achieved.pokemon.size}`,
  );
  console.log(
    "地図形状なし（一覧で表示）: " +
      catalogs.world
        .filter((c) => !c.hasGeometry)
        .map((c) => c.name)
        .join("、"),
  );
}
