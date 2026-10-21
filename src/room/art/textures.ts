import { CanvasTexture, SRGBColorSpace } from "three";
import { geoGraticule10, geoIdentity, geoNaturalEarth1, geoPath } from "d3-geo";
import type { FeatureCollection } from "geojson";
import worldJson from "../../catalogs/world.json";
import japanJson from "../../catalogs/japan.json";
import pokemonJson from "../../catalogs/pokemon.json";

const paper = "#f3eddf";
const ink = "#364c48";
const land = "#bac6aa";
const achievedLand = "#567b66";
const rule = "#c4c5b2";

function surface(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("The room artwork needs a 2D canvas context.");
  context.fillStyle = paper;
  context.fillRect(0, 0, width, height);
  return { canvas, context };
}

function texture(canvas: HTMLCanvasElement) {
  const result = new CanvasTexture(canvas);
  result.colorSpace = SRGBColorSpace;
  result.anisotropy = 4;
  return result;
}

function line(
  context: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color = rule,
) {
  context.beginPath();
  context.moveTo(x1, y1);
  context.lineTo(x2, y2);
  context.strokeStyle = color;
  context.lineWidth = 1.5;
  context.stroke();
}

function label(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  size = 18,
  color = ink,
) {
  context.fillStyle = color;
  context.font = `500 ${size}px Arial, sans-serif`;
  context.fillText(text, x, y);
}

function north(context: CanvasRenderingContext2D, x: number, y: number) {
  context.save();
  context.translate(x, y);
  context.textAlign = "center";
  label(context, "N", 0, -25, 16);
  context.beginPath();
  context.moveTo(0, -12);
  context.lineTo(7, 12);
  context.lineTo(0, 7);
  context.closePath();
  context.fillStyle = ink;
  context.fill();
  line(context, 0, -12, -7, 12, ink);
  line(context, -7, 12, 0, 7, ink);
  context.restore();
}

/** Printed with the same real country boundaries and achievement IDs as the atlas. */
export function createWorldMapTexture(achieved: Set<string>, aspect = 9 / 4): CanvasTexture {
  // Match the wall's aspect before projecting. Enlarging the old portrait-ish
  // poster UVs would widen countries and lettering; the mural uses its empty
  // polar corners for compact headings instead of reserving a tall title band.
  const width = 2304, height = Math.round(width / aspect);
  const { canvas, context } = surface(width, height);
  const projection = geoNaturalEarth1().fitExtent(
    [
      [50, 28],
      [width - 50, height - 70],
    ],
    { type: "Sphere" },
  );
  const path = geoPath(projection, context);
  context.beginPath();
  path({ type: "Sphere" });
  context.fillStyle = "#dce5dc";
  context.fill();
  context.strokeStyle = "#b0c0b6";
  context.lineWidth = 1.8;
  context.stroke();
  context.beginPath();
  path(geoGraticule10());
  context.strokeStyle = "#c4d2c7";
  context.lineWidth = 0.8;
  context.stroke();
  for (const feature of (worldJson as FeatureCollection).features) {
    context.beginPath();
    path(feature);
    context.fillStyle = achieved.has(String(feature.id)) ? achievedLand : land;
    context.fill();
    context.strokeStyle = "#7c9283";
    context.lineWidth = 0.8;
    context.stroke();
  }
  label(context, "PERSONAL COLLECTION  /  01", 64, 58, 15);
  context.font = "400 48px Georgia, serif";
  context.fillStyle = ink;
  context.fillText("WORLD ATLAS", 61, 118);
  context.textAlign = "right";
  label(context, `${achieved.size} VISITED`, width - 64, 104, 24);
  context.textAlign = "left";
  north(context, width - 110, 190);
  line(context, 64, height - 47, width - 64, height - 47);
  label(context, "NATURAL EARTH", 64, height - 18, 15, "#778174");
  context.textAlign = "right";
  label(context, "NATURAL EARTH PROJECTION", width - 64, height - 18, 15, "#778174");
  return texture(canvas);
}

/** jpn-atlas coordinates are already projected: geoIdentity must not reflect Y. */
export function createJapanMapTexture(achieved: Set<string>): CanvasTexture {
  const { canvas, context } = surface(700, 1000);
  label(context, "PERSONAL COLLECTION  /  02", 53, 60, 17);
  context.font = "400 91px Georgia, serif";
  context.fillStyle = ink;
  context.fillText("JAPAN", 49, 159);
  label(context, "47 PREFECTURES", 55, 202, 20);
  line(context, 54, 229, 646, 229);
  const features = japanJson as FeatureCollection;
  const projection = geoIdentity().fitExtent(
    [
      [57, 277],
      [643, 865],
    ],
    features,
  );
  const path = geoPath(projection, context);
  for (const feature of features.features) {
    context.beginPath();
    path(feature);
    context.fillStyle = achieved.has(String(feature.id)) ? achievedLand : land;
    context.fill();
    context.strokeStyle = "#788b77";
    context.lineWidth = 1.4;
    context.stroke();
  }
  north(context, 110, 320);
  line(context, 54, 910, 646, 910);
  label(context, "VISITED", 54, 956, 20, "#778174");
  context.textAlign = "right";
  label(context, `${achieved.size} / 47`, 646, 957, 29);
  return texture(canvas);
}

function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  fill: string,
) {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
  context.fillStyle = fill;
  context.fill();
}

function progressRing(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  count: number,
  total: number,
  color: string,
) {
  context.lineWidth = 8;
  context.beginPath();
  context.arc(x, y, 36, 0, Math.PI * 2);
  context.strokeStyle = "rgba(47, 64, 57, 0.13)";
  context.stroke();
  if (count > 0) {
    context.beginPath();
    context.arc(
      x,
      y,
      36,
      -Math.PI / 2,
      -Math.PI / 2 + Math.PI * 2 * Math.min(1, count / total),
    );
    context.strokeStyle = color;
    context.lineCap = "round";
    context.stroke();
    context.lineCap = "butt";
  }
  context.beginPath();
  context.arc(x, y, 5, 0, Math.PI * 2);
  context.fillStyle = color;
  context.fill();
}

/** Original screen UI; no Apple marks, Pokémon artwork, or invented captures. */
export function createPhoneTexture(
  normal: number,
  shiny: number,
): CanvasTexture {
  const { canvas, context } = surface(512, 1024);
  const total = pokemonJson.length;
  label(context, "PERSONAL ATLAS", 43, 118, 17, "#7b8277");
  context.fillStyle = "#273d36";
  context.font = "600 69px Arial, sans-serif";
  context.fillText("Pokédex", 38, 206);
  label(
    context,
    `${total.toLocaleString("en-US")} SPECIES`,
    44,
    250,
    19,
    "#7b8277",
  );
  line(context, 43, 285, 469, 285, "#ccd0c0");

  const cards = [
    {
      y: 322,
      value: normal,
      title: "NORMAL",
      fill: "#dce5d6",
      accent: "#51705c",
    },
    {
      y: 572,
      value: shiny,
      title: "SHINY",
      fill: "#e8dfc8",
      accent: "#9a8052",
    },
  ];
  for (const card of cards) {
    roundedRect(context, 35, card.y, 442, 220, 24, card.fill);
    label(context, card.title, 62, card.y + 46, 18, card.accent);
    context.fillStyle = "#273d36";
    context.font = "400 90px Arial, sans-serif";
    context.fillText(String(card.value), 57, card.y + 148);
    label(
      context,
      `OF ${total.toLocaleString("en-US")}`,
      63,
      card.y + 184,
      16,
      card.accent,
    );
    progressRing(context, 400, card.y + 118, card.value, total, card.accent);
  }

  roundedRect(context, 35, 841, 442, 81, 40, "#314b40");
  context.textAlign = "center";
  label(context, "OPEN COLLECTION", 245, 890, 21, "#f3eddf");
  context.strokeStyle = "#f3eddf";
  context.lineWidth = 2.5;
  context.beginPath();
  context.moveTo(417, 874);
  context.lineTo(426, 883);
  context.lineTo(417, 892);
  context.stroke();
  roundedRect(context, 177, 985, 158, 5, 3, "#68736a");
  return texture(canvas);
}
