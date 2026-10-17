import { catalogs, sections } from "./catalogs";
import {
  files,
  type Archive,
  type Entry,
  type Section,
  type RecordItem,
  type Variant,
} from "./model";
export function lines(text: string) {
  return text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((text, i) => ({ text: text.trim(), line: i + 1 }))
    .filter((x) => x.text && !x.text.startsWith("#"));
}
export function resolveEntry(
  section: Section,
  input: string,
): Entry | undefined {
  const value = input.trim();
  const id =
    section === "pokemon" && /^\d+$/.test(value)
      ? String(Number(value))
      : value;
  return catalogs[section].find(
    (e) => e.id === id || e.name === value || e.aliases.includes(value),
  );
}
export function validDate(value: string): boolean {
  if (!value) return true;
  if (!/^\d{4}(-\d{2}){0,2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  if (y < 1) return false;
  if (m !== undefined && (m < 1 || m > 12)) return false;
  if (d !== undefined) {
    const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
    return (
      d >= 1 &&
      d <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]
    );
  }
  return true;
}
export function safePhoto(path: string) {
  return (
    !/[\\:%?#|\u0000-\u001f]/.test(path) &&
    !path.startsWith("/") &&
    !path.split("/").some((s) => !s || s === "." || s === "..") &&
    /\.(jpe?g|png|webp|avif)$/i.test(path)
  );
}
function distance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 0; i < a.length; i++) {
    const next = [i + 1];
    for (let j = 0; j < b.length; j++)
      next.push(
        Math.min(next[j] + 1, prev[j + 1] + 1, prev[j] + Number(a[i] !== b[j])),
      );
    prev = next;
  }
  return prev[b.length];
}
export function parseArchive(
  texts: Record<string, string>,
  photoExists?: (path: string) => boolean,
): Archive {
  const result: Archive = {
    achieved: {
      world: new Set(),
      japan: new Set(),
      mountains: new Set(),
      pokemon: new Set(),
    },
    normal: new Set(),
    shiny: new Set(),
    records: { world: [], japan: [], mountains: [], pokemon: [] },
    issues: [],
  };
  const issue = (
    file: string,
    line: number,
    message: string,
    severity: "error" | "warning" = "error",
  ) => result.issues.push({ file, line, message, severity });
  const lookup = (
    section: Section,
    value: string,
    file: string,
    line: number,
  ) => {
    const e = resolveEntry(section, value);
    if (!e) {
      const candidates = [...catalogs[section]]
        .sort((a, b) => distance(value, a.name) - distance(value, b.name))
        .slice(0, 3)
        .map((x) => x.name)
        .join("、");
      issue(
        file,
        line,
        `不明な項目「${value}」。候補: ${candidates}${value === "燕岳" ? "。燕岳は日本百名山の対象外です。" : ""}`,
      );
    }
    return e;
  };
  for (const [key, section] of [
    ["world", "world"],
    ["japan", "japan"],
    ["mountains", "mountains"],
    ["normal", "pokemon"],
    ["shiny", "pokemon"],
  ] as const) {
    const file = files[key];
    const target =
      key === "normal" || key === "shiny"
        ? result[key]
        : result.achieved[section];
    for (const row of lines(texts[file] ?? "")) {
      for (const input of row.text.replace(/^\{(.*)\}$/, "$1").split(",")) {
        if (!input.trim()) continue;
        const e = lookup(section, input.trim(), file, row.line);
        if (!e) continue;
        if (target.has(e.id))
          issue(
            file,
            row.line,
            `「${e.name}」が重複しています。1件として集計します。`,
            "warning",
          );
        target.add(e.id);
      }
    }
  }
  result.achieved.pokemon = new Set([...result.normal, ...result.shiny]);
  for (const section of sections) {
    const file = files[`${section}Records`];
    for (const row of lines(texts[file] ?? "")) {
      const columns = row.text.split("|").map((x) => x.trim());
      if (columns.length !== (section === "pokemon" ? 4 : 3)) {
        issue(file, row.line, "区切り「|」の数が正しくありません。");
        continue;
      }
      const [name, ...rest] = columns;
      const variant = section === "pokemon" ? rest.shift() : undefined;
      const [date, photoText] = rest;
      const e = lookup(section, name, file, row.line);
      if (!e) continue;
      if (
        section === "pokemon" &&
        variant !== "normal" &&
        variant !== "shiny"
      ) {
        issue(file, row.line, "色は normal または shiny を指定してください。");
        continue;
      }
      const achieved = variant
        ? result[variant as Variant]
        : result.achieved[section];
      if (!achieved.has(e.id))
        issue(
          file,
          row.line,
          `「${e.name}」${variant ? " (" + variant + ")" : ""}が実績TXTにありません。`,
        );
      if (!validDate(date))
        issue(
          file,
          row.line,
          `不正な日付「${date}」。YYYY / YYYY-MM / YYYY-MM-DD を使用してください。`,
        );
      const photos = photoText ? photoText.split(",").map((x) => x.trim()) : [];
      for (const p of photos) {
        if (!safePhoto(p))
          issue(file, row.line, `安全でない写真パス「${p}」。`);
        else if (photoExists && !photoExists(p))
          issue(file, row.line, `写真が見つかりません「${p}」。`);
      }
      result.records[section].push({
        id: e.id,
        date,
        photos,
        variant: variant as Variant | undefined,
        line: row.line,
      });
    }
    result.records[section].sort(
      (a, b) => b.date.localeCompare(a.date) || a.line - b.line,
    );
  }
  return result;
}
export function pokemonCounts(a: Archive) {
  return {
    normal: a.normal.size,
    shiny: a.shiny.size,
    both: [...a.normal].filter((x) => a.shiny.has(x)).length,
    total: a.achieved.pokemon.size,
  };
}
export function formatDate(date: string) {
  if (!date) return "";
  const [y, m, d] = date.split("-");
  return `${y}年${m ? `${Number(m)}月` : ""}${d ? `${Number(d)}日` : ""}`;
}
export function representative(records: RecordItem[]) {
  return records.find((r) => r.photos.length)?.photos[0];
}
export const assetUrl = (path: string) =>
  `${import.meta.env.BASE_URL}${path.split("/").map(encodeURIComponent).join("/")}`;
export async function loadArchive() {
  const pairs = await Promise.all(
    Object.values(files).map(async (file) => {
      const r = await fetch(assetUrl(`data/${file}`), { cache: "no-cache" });
      if (!r.ok) throw new Error(`${file} を読み込めません (${r.status})`);
      return [file, await r.text()];
    }),
  );
  const result = parseArchive(Object.fromEntries(pairs));
  if (result.issues.some((x) => x.severity === "error"))
    throw new Error(
      result.issues
        .filter((x) => x.severity === "error")
        .map((x) => `${x.file}:${x.line} ${x.message}`)
        .join("\n"),
    );
  return result;
}
