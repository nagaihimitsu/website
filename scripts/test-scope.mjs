import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const roomSpecs = [
  "tests/e2e/room.spec.ts",
  "tests/e2e/room-instagram.spec.ts",
  "tests/e2e/bird.spec.ts",
  "tests/e2e/outdoors.spec.ts",
  "tests/e2e/bass.spec.ts",
  "tests/e2e/pinch.spec.ts",
  "tests/e2e/visitor.spec.ts",
];
const roomUnits = readdirSync(new URL("../tests/", import.meta.url))
  .filter((file) => /^room-.*\.test\.ts$/.test(file))
  .sort()
  .map((file) => `tests/${file}`);
const scopes = {
  japan: { units: ["tests/japan-view.test.ts"], browser: ["tests/e2e/japan-mode.spec.ts", "tests/e2e/collection-modes.spec.ts", "--grep", "JAPAN|日本ポスター"] },
  "world-regions": { units: ["tests/world-data.test.ts"], browser: ["tests/e2e/world-regions.spec.ts"] },
  world: { units: ["tests/world-data.test.ts"], browser: ["tests/e2e/world-mode.spec.ts", "tests/e2e/world-regions.spec.ts"] },
  visual: { browser: [roomSpecs[0], "--grep", "@visual"] },
  links: { browser: [roomSpecs[0], roomSpecs[1], "--grep", "@links|@visual"] },
  movement: {
    units: [
      "tests/room-movement.test.ts", "tests/room-locomotion.test.ts",
      "tests/room-camera.test.ts", "tests/room-pinch-zoom.test.ts", "tests/room-breakables.test.ts",
    ],
    browser: [roomSpecs[0], "tests/e2e/pinch.spec.ts", "--grep", "@movement|@pinch|@visual"],
  },
  npc: {
    units: ["tests/room-bird.test.ts", "tests/room-visitor.test.ts", "tests/room-movement.test.ts"],
    browser: [roomSpecs[0], roomSpecs[2], "tests/e2e/visitor.spec.ts", "--grep", "@npc|@visual"],
  },
  records: {
    units: ["tests/parser.test.ts", "tests/photos.test.ts"],
    browser: ["tests/e2e/site.spec.ts", "--grep", "@records"],
  },
  room: { units: roomUnits, browser: [...roomSpecs, "tests/e2e/collection-modes.spec.ts", "tests/e2e/world-mode.spec.ts"] },
  outdoors: {
    units: roomUnits,
    browser: [roomSpecs[0], roomSpecs[2], roomSpecs[3], "--grep", "@outdoors|@movement|@npc|@visual"],
  },
  music: {
    units: ["tests/room-bass-game.test.ts", "tests/room-bass-v21.test.ts", "tests/room-bass-result.test.ts", "tests/room-bass-import.test.ts", "tests/room-final-hit-arrangement.test.ts", "tests/room-bass-sustain.test.ts", "tests/room-bass-fretboard.test.ts", "tests/room-bass-gesture.test.ts", "tests/room-bass-audio.test.ts", "tests/room-bass-pose.test.ts", "tests/room-engine-lifecycle.test.ts", "tests/room-model-lifecycle.test.ts"],
    browser: [roomSpecs[0], roomSpecs[3], roomSpecs[4], "--grep", "@bass|@outdoors|@visual"],
  },
  full: { units: [], browser: [], subpath: true },
};
// Refactoring the room uses the same complete room scope, with no unrelated
// map/globe/Pokédex browser tests. Keep the alias in this single source of truth.
scopes.refactor = scopes.room;

const [requested, ...options] = process.argv.slice(2);
const scope = Object.hasOwn(scopes, requested ?? "") ? scopes[requested] : null;
if (!scope || options.some((option) => !["--dry-run", "--list"].includes(option))) {
  console.error(`Usage: npm run test:scope -- <${Object.keys(scopes).join("|")}> [--dry-run|--list]`);
  process.exit(1);
}

const listing = options.includes("--list");
const reporter = process.env.CI ? ["--reporter=list,github"] : ["--reporter=list"];
const commands = [];
if (scope.units) {
  commands.push([
    "node_modules/vitest/vitest.mjs",
    ...(listing ? ["list", "--filesOnly"] : ["run"]),
    ...scope.units,
  ]);
}
commands.push([
  "node_modules/@playwright/test/cli.js", "test", ...scope.browser,
  ...(listing ? ["--list"] : reporter),
]);
if (scope.subpath) {
  // Listing never builds or launches a browser.
  if (!listing) commands.push([
    "node_modules/vite/bin/vite.js", "build", "--base", "/website/",
    "--outDir", ".test-build",
  ]);
  commands.push([
    "node_modules/@playwright/test/cli.js", "test",
    "--config", "playwright.subpath.config.ts",
    ...(listing ? ["--list"] : reporter),
  ]);
}

for (const args of commands) {
  console.log(`\n[${requested}] node ${args.map((arg) => JSON.stringify(arg)).join(" ")}`);
  if (options.includes("--dry-run")) continue;
  // No shell interpolation: scope names only select fixed executable arguments.
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: "inherit" });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}
