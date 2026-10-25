import { useEffect, useMemo, useRef, useState } from "react";
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
export interface MapView { zoom: number; pan: number[]; }
export function Map({
  section,
  achieved,
  onSelect,
  preview = false,
  prefectures,
  focus,
  initialView,
  onViewChange,
  showVisits = true,
}: {
  section: Section;
  achieved: Set<string>;
  onSelect?: (e: Entry) => void;
  preview?: boolean;
  prefectures?: Set<string>;
  focus?: Entry;
  initialView?: MapView;
  onViewChange?: (view: MapView) => void;
  showVisits?: boolean;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const [markerScale, setMarkerScale] = useState(1);
  const [zoom, setZoom] = useState(initialView?.zoom ?? 1);
  const [pan, setPan] = useState(initialView?.pan ?? [0, 0]);
  const drag = useRef<{
    x: number;
    y: number;
    pan: number[];
    moved: boolean;
  } | null>(null);
  const touches = useRef(new MapConstructor<number, {x: number; y: number}>());
  const pinchDistance = useRef<number | null>(null);
  const [tip, setTip] = useState("");
  const isWorld = section === "world";
  const width = isWorld ? 900 : 850,
    height = isWorld ? 500 : 680;
  const entries = useMemo(
    () => new MapConstructor(catalogs[section].map((e) => [e.id, e])),
    [section],
  );
  const visibleLabels = useMemo(() => {
    const result = new Set<string>();
    if (section !== "mountains" || preview || zoom < 3) return result;
    const boxes: { x: number; y: number; w: number }[] = [];
    const priority = (entry: Entry) => entry.id === focus?.id ? 2 : achieved.has(entry.id) ? 1 : 0;
    const candidates = [...catalogs.mountains].sort((a, b) => priority(b) - priority(a));
    for (const entry of candidates) {
      const point = mountainProjection(entry.coordinates as [number, number]);
      if (!point) continue;
      const x = (point[0] - width / 2) * zoom + width / 2 + pan[0];
      const y = (point[1] - height / 2) * zoom + height / 2 + pan[1];
      if (x < 0 || x > width || y < 0 || y > height) continue;
      const box = { x: x / markerScale, y: y / markerScale - 9, w: entry.name.length * 12 + 12 };
      // Favor the selected summit, then completed summits, and avoid overlapping labels.
      if (boxes.some(other => Math.abs(other.y - box.y) < 20 && Math.abs(other.x - box.x) < (other.w + box.w) / 2)) continue;
      boxes.push(box);
      result.add(entry.id);
    }
    return result;
  }, [section, preview, zoom, pan, width, height, markerScale, focus, achieved]);
  useEffect(() => {
    if (preview || section !== "mountains" || !svg.current) return;
    // Marker symbols and touch targets keep their CSS-pixel size, including
    // letterboxed maps in the mobile sheet's three heights.
    const observer = new ResizeObserver(([entry]) => {
      const scale = Math.min(entry.contentRect.width / width, entry.contentRect.height / height);
      if (scale > 0) setMarkerScale(1 / scale);
    });
    observer.observe(svg.current);
    return () => observer.disconnect();
  }, [preview, section, width, height]);
  useEffect(() => {
    if (preview) return;
    const node = svg.current;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      setZoom(value => Math.max(1, Math.min(8, value * (event.deltaY < 0 ? 1.12 : 1 / 1.12))));
    };
    // React's passive wheel handler cannot stop the containing catalogue from scrolling.
    node?.addEventListener("wheel", wheel, { passive: false });
    return () => node?.removeEventListener("wheel", wheel);
  }, [preview]);
  useEffect(() => { onViewChange?.({ zoom, pan }); }, [zoom, pan, onViewChange]);
  const previousFocus = useRef(focus);
  useEffect(() => {
    if (previousFocus.current === focus) return;
    previousFocus.current = focus;
    if (!focus || preview) return;
    const point = section === "mountains" && focus.coordinates ? mountainProjection(focus.coordinates as [number, number]) :
      null;
    if (section === "mountains" && point) {
      const nextZoom = 4;
      setZoom(nextZoom);
      setPan([(width / 2 - point[0]) * nextZoom, (height / 2 - point[1]) * nextZoom]);
    }
  }, [focus, section, preview, width, height, isWorld]);
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
  const selectNearestSummit = (event: React.MouseEvent<SVGSVGElement>) => {
    if (preview || section !== "mountains" || drag.current?.moved) return;
    const inverse = event.currentTarget.getScreenCTM()?.inverse();
    if (!inverse) return;
    const click = new DOMPoint(event.clientX, event.clientY).matrixTransform(inverse);
    let nearest: Entry | undefined;
    let distance = 22;
    for (const entry of catalogs.mountains) {
      const point = mountainProjection(entry.coordinates as [number, number]);
      if (!point) continue;
      const x = (point[0] - width / 2) * zoom + width / 2 + pan[0];
      const y = (point[1] - height / 2) * zoom + height / 2 + pan[1];
      const pixels = Math.hypot(x - click.x, y - click.y) / markerScale;
      if (pixels < distance) { nearest = entry; distance = pixels; }
    }
    if (nearest) select(nearest.id);
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
        ref={svg}
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
        onClick={selectNearestSummit}
        onPointerDown={(e) => {
          if (preview) return;
          touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          if (touches.current.size === 2) {
            const [a, b] = [...touches.current.values()];
            pinchDistance.current = Math.hypot(a.x - b.x, a.y - b.y);
            if (drag.current) drag.current.moved = true;
            return;
          }
          drag.current = {
            x: e.clientX,
            y: e.clientY,
            pan: [...pan],
            moved: false,
          };
        }}
        onPointerMove={(e) => {
          if (touches.current.has(e.pointerId)) touches.current.set(e.pointerId, {x: e.clientX, y: e.clientY});
          if (touches.current.size === 2) {
            const [a, b] = [...touches.current.values()];
            const distance = Math.hypot(a.x - b.x, a.y - b.y);
            if (pinchDistance.current) setZoom(z => Math.max(1, Math.min(8, z * distance / pinchDistance.current!)));
            pinchDistance.current = distance;
            return;
          }
          const d = drag.current;
          if (!d) return;
          const inverse = e.currentTarget.getScreenCTM()?.inverse();
          if (!inverse) return;
          const from = new DOMPoint(d.x, d.y).matrixTransform(inverse);
          const to = new DOMPoint(e.clientX, e.clientY).matrixTransform(inverse);
          const dx = to.x - from.x, dy = to.y - from.y;
          if (Math.abs(dx) + Math.abs(dy) > 5) {
            d.moved = true;
            e.currentTarget.setPointerCapture(e.pointerId);
            setPan([d.pan[0] + dx, d.pan[1] + dy]);
          }
        }}
        onPointerUp={(e) => {
          touches.current.delete(e.pointerId);
          pinchDistance.current = null;
          setTimeout(() => {
            drag.current = null;
          }, 0);
        }}
        onPointerCancel={() => {
          touches.current.clear();
          pinchDistance.current = null;
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
            const active = section === "mountains" ? Boolean(prefectures?.has(id)) : achieved.has(id);
            return (
              <path
                key={`${id}-${i}`}
                d={path(f)}
                className={`land ${active && showVisits ? "visited" : ""} ${section === "mountains" ? "prefecture-layer" : ""}`}
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
                  transform={`translate(${point[0]} ${point[1]}) scale(${markerScale / zoom})`}
                  className={`mountain-marker ${done ? "visited" : ""} ${focus?.id === m.id ? "selected-marker" : ""}`}
                  data-id={m.id}
                  data-achieved={done}
                  role={preview ? undefined : "button"}
                  tabIndex={preview ? undefined : 0}
                  aria-label={`${m.name} ${done ? "登頂済み" : "未登頂"}`}
                  onKeyDown={(e) => key(e, m.id)}
                  onMouseEnter={() => setTip(m.name)}
                  onMouseLeave={() => setTip("")}
                >
                  <title>
                    {m.name} / {m.elevation}m
                  </title>
                  {/* A shared nearest-point picker supplies the 44px target without
                      overlapping invisible circles intercepting neighboring summits. */}
                  <circle r="22" fill="transparent" stroke="none" pointerEvents="none" />
                  <path d="M0 -5 L4.8 3.5 H-4.8 Z" />
                  {visibleLabels.has(m.id) && <text y="-9" textAnchor="middle" className="mountain-label">{m.name}</text>}
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
