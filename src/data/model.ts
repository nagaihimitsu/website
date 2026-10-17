export type Section = "world" | "japan" | "mountains" | "pokemon";
export type Variant = "normal" | "shiny";
export interface Entry {
  id: string;
  name: string;
  aliases: string[];
  english?: string;
  speciesId?: number;
  generation?: number;
  coordinates?: number[];
  elevation?: number;
  region?: string;
  representativePeak?: string;
  source?: string;
  coordinateBasis?: string;
  hasGeometry?: boolean;
}
export interface RecordItem {
  id: string;
  date: string;
  photos: string[];
  variant?: Variant;
  line: number;
}
export interface Issue {
  file: string;
  line: number;
  message: string;
  severity: "error" | "warning";
}
export interface Archive {
  achieved: Record<Section, Set<string>>;
  normal: Set<string>;
  shiny: Set<string>;
  records: Record<Section, RecordItem[]>;
  issues: Issue[];
}
export const files = {
  world: "訪問した国.txt",
  japan: "訪問した都道府県.txt",
  mountains: "登頂した百名山.txt",
  normal: "ポケモン_通常色.txt",
  shiny: "ポケモン_色違い.txt",
  worldRecords: "記録_国.txt",
  japanRecords: "記録_都道府県.txt",
  mountainsRecords: "記録_百名山.txt",
  pokemonRecords: "記録_ポケモン.txt",
};
