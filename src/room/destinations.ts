import type { Section } from "../data/model";

export const INSTAGRAM_URL = "https://instagram.com/nagaihimitsu/";

export type RoomDestinationDefinition =
  | {
      kind: "collection";
      section: Section;
      title: string;
      label: string;
      total?: number;
    }
  | {
      kind: "external";
      href: string;
      title: string;
      label: string;
      hint: string;
      target: "_blank";
      rel: "noopener noreferrer";
    };

/** Shared by the scene, engine and both the in-room and fallback navigation. */
export const roomDestinations = {
  world: {
    kind: "collection",
    section: "world",
    title: "World",
    label: "地球儀を開く",
  },
  japan: {
    kind: "collection",
    section: "mountains",
    title: "Japan",
    label: "日本地図・百名山を開く",
    total: 100,
  },
  mountains: {
    kind: "collection",
    section: "mountains",
    title: "Mountains",
    label: "百名山を開く",
    total: 100,
  },
  pokemon: {
    kind: "collection",
    section: "pokemon",
    title: "Pokédex",
    label: "図鑑端末を開く",
    total: 1025,
  },
  instagram: {
    kind: "external",
    href: INSTAGRAM_URL,
    title: "Instagram",
    label: "Instagramを開く（外部リンク・新しいタブ）",
    hint: "外部リンク・新しいタブ",
    target: "_blank",
    rel: "noopener noreferrer",
  },
} as const satisfies Record<string, RoomDestinationDefinition>;

export type RoomDestinationId = keyof typeof roomDestinations;
export const roomDestinationIds = Object.keys(
  roomDestinations,
) as RoomDestinationId[];
