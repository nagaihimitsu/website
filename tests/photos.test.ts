import { it, expect } from "vitest";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import sharp from "sharp";
it("写真を書き出すと縮小・EXIF除去され、既存写真を上書きしない", async () => {
  const dir = await mkdtemp(join(tmpdir(), "atlas-photos-"));
  const script = resolve("scripts/optimize-photos.ts");
  const tsx = resolve("node_modules/tsx/dist/cli.mjs");
  try {
    await mkdir(join(dir, "public/photos"), { recursive: true });
    const input = join(dir, "original.jpg");
    await sharp({
      create: { width: 2400, height: 1200, channels: 3, background: "#426b68" },
    })
      .withExif({ IFD0: { Artist: "Private photographer" } })
      .jpeg()
      .toFile(input);
    expect((await sharp(input).metadata()).exif).toBeTruthy();
    const run = () =>
      spawnSync(
        process.execPath,
        [tsx, script, input, "public/photos/output.webp"],
        { cwd: dir, encoding: "utf8" },
      );
    const result = run();
    expect(result.status, result.stderr).toBe(0);
    const m = await sharp(join(dir, "public/photos/output.webp")).metadata();
    expect(m.width).toBe(1920);
    expect(m.height).toBe(960);
    expect(m.exif).toBeUndefined();
    expect(run().status).not.toBe(0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
