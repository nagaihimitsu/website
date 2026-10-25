import metadata from "../catalogs/mountain-prefectures.json";
import type { Entry } from "../data/model";
const prefectures: Record<string, string[]> = metadata;
/** 所属県の不足分だけを出典付きアダプターで補う。既存regionや記録IDを変更しない。 */
export const mountainPrefectures = (entry: Entry) => prefectures[entry.id] ?? entry.region?.split("・") ?? [];
export const mountainRegion = (entry: Entry) => mountainPrefectures(entry).join("・");
