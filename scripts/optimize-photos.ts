import sharp from "sharp";
import { mkdir, access } from "node:fs/promises";
import { dirname, resolve, relative } from "node:path";
const [input, output] = process.argv.slice(2);
if (!input || !output || !output.endsWith(".webp"))
  throw new Error(
    "使い方: npm run photos -- /原本/写真.jpg public/photos/countries/japan/01.webp",
  );
const root = resolve("public/photos"),
  target = resolve(output),
  rel = relative(root, target);
if (rel.startsWith("..") || rel === "")
  throw new Error("出力先は public/photos 内にしてください。");
try {
  await access(target);
  throw new Error("出力先が存在します。別名で保存してください。");
} catch (e) {
  if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
}
await mkdir(dirname(target), { recursive: true });
await sharp(input)
  .rotate()
  .resize({
    width: 1920,
    height: 1920,
    fit: "inside",
    withoutEnlargement: true,
  })
  .webp({ quality: 84 })
  .toFile(target);
console.log(
  `保存しました: ${output}（最大1920px / EXIFを含むメタデータは保持しません）`,
);
