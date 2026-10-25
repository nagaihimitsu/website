import metadata from "../catalogs/world-view.json";
import { catalogs } from "../data/catalogs";
import type { Entry } from "../data/model";
export const worldRegions = [
  ["Eastern Asia", "東アジア"], ["South-Eastern Asia", "東南アジア"], ["Southern Asia", "南アジア"],
  ["Central Asia", "中央アジア"], ["Western Asia", "西アジア"],
  ["Northern Europe", "北ヨーロッパ"], ["Western Europe", "西ヨーロッパ"],
  ["Eastern Europe", "東ヨーロッパ"], ["Southern Europe", "南ヨーロッパ"],
  ["Northern America", "北アメリカ"], ["Central America", "中央アメリカ"],
  ["Caribbean", "カリブ海地域"], ["South America", "南アメリカ"],
  ["Northern Africa", "北アフリカ"], ["Western Africa", "西アフリカ"], ["Middle Africa", "中部アフリカ"],
  ["Eastern Africa", "東アフリカ"], ["Southern Africa", "南部アフリカ"],
  ["Australia and New Zealand", "オーストラリア・ニュージーランド"],
  ["Melanesia", "メラネシア"], ["Micronesia", "ミクロネシア"], ["Polynesia", "ポリネシア"],
  ["Antarctica", "南極・南極周辺"],
] as const;
export interface CountryView { region: string; point: [number, number]; note?: string; }
const views: Record<string, CountryView> = {};
for (const [id, value] of Object.entries(metadata)) {
  if (value.point.length !== 2 || !value.point.every(Number.isFinite)) throw new Error(`国の代表点が不正: ${id}`);
  views[id] = { ...value, point: [value.point[0], value.point[1]] };
}
export const countryView = (entry: Entry) => views[entry.id];
export const regionName = (region: string) => worldRegions.find(([id]) => id === region)?.[1] ?? region;
export function groupCountries(query: string, filter: string, achieved: Set<string>) {
  const q = query.trim().toLocaleLowerCase();
  return worldRegions.map(([id, name]) => {
    const all = catalogs.world.filter(entry => countryView(entry).region === id);
    const entries = all.filter(entry =>
      (!q || [entry.id, entry.name, entry.english ?? "", ...entry.aliases].some(value => value.toLocaleLowerCase().includes(q))) &&
      (filter === "all" || (filter === "done" ? achieved.has(entry.id) : !achieved.has(entry.id)))
    ).sort((a, b) => Number(achieved.has(b.id)) - Number(achieved.has(a.id)) || a.name.localeCompare(b.name, "ja"));
    return { id, name, entries, total: all.length, visited: all.filter(entry => achieved.has(entry.id)).length };
  });
}
