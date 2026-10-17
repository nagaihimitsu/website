import world from "../catalogs/countries.json";
import japan from "../catalogs/prefectures.json";
import mountains from "../catalogs/mountains.json";
import pokemon from "../catalogs/pokemon.json";
import type { Entry, Section } from "./model";
export const catalogs: Record<Section, Entry[]> = {
  world,
  japan,
  mountains,
  pokemon,
};
export const sections: Section[] = ["world", "japan", "mountains", "pokemon"];
export const labels = {
  world: "訪れた国",
  japan: "訪れた都道府県",
  mountains: "登った百名山",
  pokemon: "出会ったポケモン",
};
export const english = {
  world: "WORLD",
  japan: "JAPAN",
  mountains: "MOUNTAINS",
  pokemon: "POKÉDEX",
};
