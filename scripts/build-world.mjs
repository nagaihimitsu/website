// Rebuild the geographic snapshot only; never modifies personal TXT records.
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { geoArea } from "d3-geo";
const raw = JSON.parse(fs.readFileSync(".cache/catalogs/world.json"));
const countries = JSON.parse(fs.readFileSync("src/catalogs/countries.json"));
const iso = new Set(countries.map((c) => c.id));
const groups = new Map();
for (const feature of raw.features) {
  const p = feature.properties;
  // Jan Mayen and Svalbard share the ISO-assigned SJM code.
  const id =
    p.GU_A3 === "NJM"
      ? "SJM"
      : iso.has(p.ISO_A3_EH)
        ? p.ISO_A3_EH
        : iso.has(p.ISO_A3)
          ? p.ISO_A3
          : p.ADM0_A3;
  const polygons =
    feature.geometry.type === "Polygon"
      ? [feature.geometry.coordinates]
      : feature.geometry.coordinates;
  if (groups.has(id)) groups.get(id).geometry.coordinates.push(...polygons);
  else
    groups.set(id, {
      type: "Feature",
      id,
      properties: {
        id,
        name: countries.find((c) => c.id === id)?.name || p.NAME_JA || p.NAME,
      },
      geometry: { type: "MultiPolygon", coordinates: polygons },
    });
}
fs.writeFileSync(
  ".cache/catalogs/world-normalized.json",
  JSON.stringify({ type: "FeatureCollection", features: [...groups.values()] }),
);
execFileSync(
  "npx",
  [
    "--yes",
    "mapshaper@0.7.88",
    ".cache/catalogs/world-normalized.json",
    "-simplify",
    "18%",
    "keep-shapes",
    "-o",
    ".cache/catalogs/world-small.json",
    "format=geojson",
    "precision=0.0001",
    "force",
  ],
  { stdio: "inherit" },
);
const world = JSON.parse(fs.readFileSync(".cache/catalogs/world-small.json"));
for (const f of world.features) {
  if (geoArea(f) > 2 * Math.PI) {
    if (f.geometry.type === "Polygon")
      f.geometry.coordinates.forEach((r) => r.reverse());
    else f.geometry.coordinates.forEach((p) => p.forEach((r) => r.reverse()));
  }
}
fs.writeFileSync("src/catalogs/world.json", JSON.stringify(world) + "\n");
for (const c of countries)
  c.hasGeometry = world.features.some((f) => f.id === c.id);
fs.writeFileSync(
  "src/catalogs/countries.json",
  JSON.stringify(countries) + "\n",
);
console.log(
  "Geometries:",
  world.features.length,
  "List only:",
  countries.filter((c) => !c.hasGeometry).map((c) => c.name),
);
