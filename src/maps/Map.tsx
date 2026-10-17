import { useMemo, useRef, useState } from "react";
import {
  geoPath,
  geoNaturalEarth1,
  geoGraticule10,
  geoAzimuthalEqualArea,
} from "d3-geo";
import type { FeatureCollection } from "geojson";
import worldJson from "../catalogs/world.json";
import japanJson from "../catalogs/japan.json";
import { catalogs } from "../data/catalogs";
import type { Section, Entry } from "../data/model";
export const worldFeatures = (worldJson as FeatureCollection).features;
const japan = japanJson as FeatureCollection;
const worldProjection = geoNaturalEarth1().fitExtent(
  [
    [18, 24],
    [882, 476],
  ],
  { type: "Sphere" },
);
const worldPath = geoPath(worldProjection);
const japanPath = geoPath();
// Same projection as jpn-atlas 1.0.2's prepare script. Its polygons are already projected.
const mountainProjection = geoAzimuthalEqualArea()
  .center([138.5, 36 - 18 / 60])
  .rotate([-138.5, -36 + 18 / 60])
  .scale(1700)
  .translate([2500, -1930]);
export function Map({
  section,
  achieved,
  onSelect,
  preview = false,
}: {
  section: Section;
  achieved: Set<string>;
  onSelect?: (e: Entry) => void;
  preview?: boolean;
}) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState([0, 0]);
  const drag = useRef<{
    x: number;
    y: number;
    pan: number[];
    moved: boolean;
  } | null>(null);
  const [tip, setTip] = useState("");
  const isWorld = section === "world";
  const width = isWorld ? 900 : 850,
    height = isWorld ? 500 : 680;
  const entries = useMemo(
    () => new MapConstructor(catalogs[section].map((e) => [e.id, e])),
    [section],
  );
  const select = (id: string) => {
    if (drag.current?.moved) return;
    const e = entries.get(id);
    if (e) onSelect?.(e);
  };
  const key = (event: React.KeyboardEvent, id: string) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      select(id);
    }
  };
  const path = (feature: (typeof worldFeatures)[number]) =>
    (isWorld ? worldPath : japanPath)(feature) || "";
  return (
    <div className={`map-surface ${preview ? "map-preview" : ""}`}>
      {!preview && (
        <div className="map-tools">
          <button
            aria-label="地図を拡大"
            onClick={() => setZoom((z) => Math.min(z * 1.5, 8))}
          >
            ＋
          </button>
          <button
            aria-label="地図を縮小"
            onClick={() => setZoom((z) => Math.max(z / 1.5, 1))}
          >
            −
          </button>
          <button
            aria-label="地図をリセット"
            onClick={() => {
              setZoom(1);
              setPan([0, 0]);
            }}
          >
            ↺
          </button>
        </div>
      )}
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={
          isWorld
            ? "世界地図"
            : section === "mountains"
              ? "日本百名山100座の地図"
              : "47都道府県の地図"
        }
        style={{ touchAction: preview ? "auto" : "none" }}
        onPointerDown={(e) => {
          if (preview) return;
          drag.current = {
            x: e.clientX,
            y: e.clientY,
            pan: [...pan],
            moved: false,
          };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const rect = e.currentTarget.getBoundingClientRect();
          const dx = ((e.clientX - d.x) * width) / rect.width,
            dy = ((e.clientY - d.y) * height) / rect.height;
          if (Math.abs(dx) + Math.abs(dy) > 5) {
            d.moved = true;
            e.currentTarget.setPointerCapture(e.pointerId);
            setPan([d.pan[0] + dx, d.pan[1] + dy]);
          }
        }}
        onPointerUp={() => {
          setTimeout(() => {
            drag.current = null;
          }, 0);
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
      >
        <defs>
          <radialGradient id={`ocean-${section}-${preview}`}>
            <stop stopColor="#1a2226" stopOpacity=".55" />
            <stop offset="1" stopColor="#0e1214" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect
          width={width}
          height={height}
          fill={`url(#ocean-${section}-${preview})`}
        />
        <g
          transform={`translate(${pan[0] + width / 2} ${pan[1] + height / 2}) scale(${zoom}) translate(${-width / 2} ${-height / 2})`}
        >
          {isWorld && (
            <>
              <path
                className="sphere"
                d={worldPath({ type: "Sphere" }) || ""}
              />
              <path
                className="graticule"
                d={worldPath(geoGraticule10()) || ""}
              />
            </>
          )}
          {(isWorld ? worldFeatures : japan.features).map((f, i) => {
            const id = String(f.id);
            const e = entries.get(id);
            const active = achieved.has(id);
            return (
              <path
                key={`${id}-${i}`}
                d={path(f)}
                className={`land ${active && section !== "mountains" ? "visited" : ""}`}
                data-id={id}
                data-achieved={active}
                tabIndex={!preview && onSelect && e ? 0 : undefined}
                role={preview ? "presentation" : e ? "button" : undefined}
                aria-label={
                  e ? `${e.name} ${active ? "訪問済み" : "未訪問"}` : undefined
                }
                onClick={() => section !== "mountains" && select(id)}
                onKeyDown={(event) => key(event, id)}
                onMouseEnter={() => setTip(e?.name || "")}
                onMouseLeave={() => setTip("")}
              >
                <title>{e?.name || f.properties?.name}</title>
              </path>
            );
          })}
          {section === "mountains" &&
            catalogs.mountains.map((m) => {
              const point = mountainProjection(
                m.coordinates as [number, number],
              );
              if (!point) return null;
              const done = achieved.has(m.id);
              return (
                <g
                  key={m.id}
                  transform={`translate(${point[0]} ${point[1]}) scale(${1 / zoom})`}
                  className={`mountain-marker ${done ? "visited" : ""}`}
                  data-id={m.id}
                  data-achieved={done}
                  role={preview ? undefined : "button"}
                  tabIndex={preview ? undefined : 0}
                  aria-label={`${m.name} ${done ? "登頂済み" : "未登頂"}`}
                  onClick={() => select(m.id)}
                  onKeyDown={(e) => key(e, m.id)}
                  onMouseEnter={() => setTip(m.name)}
                  onMouseLeave={() => setTip("")}
                >
                  <title>
                    {m.name} / {m.elevation}m
                  </title>
                  <circle r="10" fill="transparent" stroke="none" />
                  <path d="M0 -5 L4.8 3.5 H-4.8 Z" />
                  {done && <circle r="1.3" cy="1" fill="#0b1118" />}
                </g>
              );
            })}
        </g>
      </svg>
      {!preview && (
        <>
          <div className="map-coordinates">
            {isWorld ? "180° W — 180° E" : "24° N — 46° N"}
            <span>{tip || "ドラッグで移動 / ＋ − で拡大縮小"}</span>
          </div>
          <div className="map-legend">
            <span>
              <i className="legend-dot active" />
              {section === "mountains" ? "登頂済み" : "訪問済み"}
            </span>
            <span>
              <i className="legend-dot" />
              {section === "mountains" ? "未登頂" : "未訪問"}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
// Avoid shadowing the native Map with the component name.
const MapConstructor = globalThis.Map;
