import { geoAzimuthalEqualArea, geoPath } from "d3-geo";
import type { FeatureCollection, Polygon, MultiPolygon } from "geojson";
import japanJson from "../catalogs/japan.json";

export const japanFeatures = japanJson as FeatureCollection<Polygon | MultiPolygon>;
// jpn-atlasの既存投影。県境と山頂を同じ平面へ載せる。
export const mountainProjection = geoAzimuthalEqualArea().center([138.5, 36 - 18 / 60])
  .rotate([-138.5, -36 + 18 / 60]).scale(1700).translate([2500, -1930]);
const bounds = geoPath().bounds(japanFeatures);
const polygons = japanFeatures.features.flatMap(f => f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates);
export interface JapanView { zoom: number; pan: number[]; }
export function fitJapan(width: number, height: number): JapanView {
  const zoom = Math.min(width / (bounds[1][0] - bounds[0][0]), height / (bounds[1][1] - bounds[0][1])) * .9;
  return { zoom, pan: [(width / 2 - (bounds[0][0] + bounds[1][0]) / 2) * zoom,
    (height / 2 - (bounds[0][1] + bounds[1][1]) / 2) * zoom] };
}
function inRing(x: number, y: number, ring: number[][]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
/** 矩形の範囲だけでなく県境との距離も制限し、拡大時に海だけの画面になるのを防ぐ。 */
export function constrainJapan(view: JapanView, width: number, height: number): JapanView {
  const fit = fitJapan(width, height);
  const zoom = Math.max(fit.zoom, Math.min(fit.zoom * 32, view.zoom));
  const center = [width / 2 - view.pan[0] / zoom, height / 2 - view.pan[1] / zoom];
  if (polygons.some(p => inRing(center[0], center[1], p[0]) && !p.slice(1).some(r => inRing(center[0], center[1], r)))) return { zoom, pan: view.pan };
  let nearest = center, distance = Infinity;
  for (const polygon of polygons) for (const ring of polygon) for (let i = 1; i < ring.length; i++) {
    const a = ring[i - 1], b = ring[i], dx = b[0] - a[0], dy = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((center[0] - a[0]) * dx + (center[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
    const point = [a[0] + t * dx, a[1] + t * dy];
    const d = Math.hypot(center[0] - point[0], center[1] - point[1]);
    if (d < distance) { nearest = point; distance = d; }
  }
  const radius = Math.min(width, height) * .35 / zoom;
  if (distance <= radius) return { zoom, pan: view.pan };
  const point = nearest.map((value, i) => value + (center[i] - value) * radius / distance);
  return { zoom, pan: [(width / 2 - point[0]) * zoom, (height / 2 - point[1]) * zoom] };
}
