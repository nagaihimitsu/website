import { useEffect, useMemo, useRef, useState } from "react";
import {
  geoPath,
  geoNaturalEarth1,
  geoGraticule10,
} from "d3-geo";
import type { FeatureCollection } from "geojson";
import worldJson from "../catalogs/world.json";
import { japanFeatures as japan, mountainProjection, fitJapan, constrainJapan } from "./japanView";
import { catalogs } from "../data/catalogs";
import { mountainRegion } from "./mountainData";
import type { Section, Entry } from "../data/model";
export const worldFeatures = (worldJson as FeatureCollection).features;
const worldProjection = geoNaturalEarth1().fitExtent(
  [
    [18, 24],
    [882, 476],
  ],
  { type: "Sphere" },
);
const worldPath = geoPath(worldProjection);
const japanPath = geoPath();
export interface MapView { zoom: number; pan: number[]; viewportHeight?: number; }
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
  focusPoint,
  focusToken = 0,
  onReset,
  japanMode = false,
  mountainEntries = catalogs.mountains,
  resetToken = 0,
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
  focusPoint?: [number, number];
  focusToken?: number;
  onReset?: () => void;
  japanMode?: boolean;
  mountainEntries?: Entry[];
  resetToken?: number;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const [markerScale, setMarkerScale] = useState(1);
  const [japanHeight, setJapanHeight] = useState(initialView?.viewportHeight ?? 680);
  const isWorld = section === "world";
  const width = isWorld ? 900 : 850, height = isWorld ? 500 : japanMode ? japanHeight : 680;
  const [zoom, setZoom] = useState(initialView?.zoom ?? (japanMode ? fitJapan(width, height).zoom : 1));
  const [pan, setPan] = useState(initialView?.pan ?? (japanMode ? fitJapan(width, height).pan : [0, 0]));
  const view = useRef<MapView>({ zoom, pan });
  view.current = { zoom, pan };
  const animation = useRef<number | undefined>(undefined);
  const suppressClick = useRef(false);
  const stopAnimation = () => {
    if (animation.current !== undefined) cancelAnimationFrame(animation.current);
    animation.current = undefined;
    if (japanMode && svg.current?.parentElement) svg.current.parentElement.dataset.japanAnimating = "false";
  };
  const move = (next: MapView, animate = false) => {
    stopAnimation();
    const target = japanMode ? constrainJapan(next, width, height) : next;
    if (!animate || matchMedia("(prefers-reduced-motion: reduce)").matches) { setZoom(target.zoom); setPan(target.pan); return; }
    const from = view.current, start = performance.now();
    if (japanMode && svg.current?.parentElement) svg.current.parentElement.dataset.japanAnimating = "true";
    const step = (now: number) => {
      const progress = Math.min(1, (now - start) / 350), t = 1 - (1 - progress) ** 3;
      setZoom(from.zoom + (target.zoom - from.zoom) * t);
      setPan(from.pan.map((value, i) => value + (target.pan[i] - value) * t));
      if (progress < 1) animation.current = requestAnimationFrame(step); else {
        animation.current = undefined;
        if (japanMode && svg.current?.parentElement) svg.current.parentElement.dataset.japanAnimating = "false";
      }
    };
    animation.current = requestAnimationFrame(step);
  };
  const zoomAt = (factor: number, anchor = [width / 2, height / 2]) => {
    if (!japanMode) { setZoom(z => Math.max(1, Math.min(8, z * factor))); return; }
    const current = view.current, fit = fitJapan(width, height);
    const nextZoom = Math.max(fit.zoom, Math.min(fit.zoom * 32, current.zoom * factor)), ratio = nextZoom / current.zoom;
    move({ zoom: nextZoom, pan: anchor.map((value, i) => value - [width / 2, height / 2][i] - (value - [width / 2, height / 2][i] - current.pan[i]) * ratio) });
  };
  useEffect(() => () => stopAnimation(), []);
  const drag = useRef<{
    x: number;
    y: number;
    pan: number[];
    moved: boolean;
  } | null>(null);
  const touches = useRef(new MapConstructor<number, {x: number; y: number}>());
  const pinchDistance = useRef<number | null>(null);
  const [tip, setTip] = useState("");
  const entries = useMemo(
    () => new MapConstructor(catalogs[section].map((e) => [e.id, e])),
    [section],
  );
  // 選択ラベルが後続のマーカーで覆われないよう、選択した山を最後に描画する。
  const renderedMountains = useMemo(() => japanMode ? [...mountainEntries].sort((a, b) =>
    Number(a.id === focus?.id) - Number(b.id === focus?.id)) : mountainEntries, [japanMode, mountainEntries, focus]);
  const visibleLabels = useMemo(() => {
    const result = new Set<string>();
    if (section !== "mountains" || preview || (!japanMode && zoom < 3)) return result;
    const boxes: { x: number; y: number; w: number; h: number }[] = [];
    if (japanMode) boxes.push({ x: width / markerScale - 34, y: 78, w: 52, h: 144 });
    if (japanMode && focus?.coordinates) {
      const point = mountainProjection(focus.coordinates as [number, number])!;
      boxes.push({ x: ((point[0] - width / 2) * zoom + width / 2 + pan[0]) / markerScale,
        y: ((point[1] - height / 2) * zoom + height / 2 + pan[1]) / markerScale - 52, w: 224, h: 90 });
    }
    const limit = japanMode ? (zoom / fitJapan(width, height).zoom < 3 ? 12 : zoom / fitJapan(width, height).zoom < 8 ? 35 : 100) : 100;
    const priority = (entry: Entry) => entry.id === focus?.id ? 2 : achieved.has(entry.id) ? 1 : 0;
    const candidates = [...mountainEntries].sort((a, b) => priority(b) - priority(a));
    for (const entry of candidates) {
      if (result.size >= limit) break;
      if (japanMode && entry.id === focus?.id) continue;
      const point = mountainProjection(entry.coordinates as [number, number]);
      if (!point) continue;
      const x = (point[0] - width / 2) * zoom + width / 2 + pan[0];
      const y = (point[1] - height / 2) * zoom + height / 2 + pan[1];
      if (x < 0 || x > width || y < 0 || y > height) continue;
      const box = { x: x / markerScale, y: y / markerScale - 9, w: entry.name.length * 12 + 12, h: 20 };
      if (japanMode && (box.x - box.w / 2 < 4 || box.x + box.w / 2 > width / markerScale - 4 || box.y < 10)) continue;
      // 選択した山・登頂済みの順に配置し、情報ラベルと他の山名の重なりを避ける。
      if (boxes.some(other => Math.abs(other.y - box.y) < (other.h + box.h) / 2 && Math.abs(other.x - box.x) < (other.w + box.w) / 2)) continue;
      boxes.push(box);
      result.add(entry.id);
    }
    return result;
  }, [section, preview, zoom, pan, width, height, markerScale, focus, achieved, japanMode, mountainEntries]);
  useEffect(() => {
    if (preview || !svg.current) return;
    // 画面比率や倍率が変わっても、マーカーと選択範囲をCSSピクセルで保つ。
    const observer = new ResizeObserver(([entry]) => {
      if (japanMode && entry.contentRect.width > 0 && entry.contentRect.height > 0) setJapanHeight(width * entry.contentRect.height / entry.contentRect.width);
      const scale = Math.min(entry.contentRect.width / width, entry.contentRect.height / height);
      if (scale > 0) setMarkerScale(1 / scale);
    });
    observer.observe(svg.current);
    return () => observer.disconnect();
  }, [preview, section, width, height, japanMode]);
  useEffect(() => {
    if (preview) return;
    const node = svg.current;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const inverse = node?.getScreenCTM()?.inverse();
      const point = inverse ? new DOMPoint(event.clientX, event.clientY).matrixTransform(inverse) : undefined;
      zoomAt(event.deltaY < 0 ? 1.12 : 1 / 1.12, point ? [point.x, point.y] : undefined);
    };
    // React's passive wheel handler cannot stop the containing catalogue from scrolling.
    node?.addEventListener("wheel", wheel, { passive: false });
    return () => node?.removeEventListener("wheel", wheel);
  }, [preview, japanMode, width, height]);
  useEffect(() => { onViewChange?.({ zoom, pan, ...(japanMode ? { viewportHeight: height } : {}) }); }, [zoom, pan, onViewChange, japanMode, height]);
  const oldHeight = useRef(height);
  useEffect(() => {
    const before = oldHeight.current; oldHeight.current = height;
    if (!japanMode || before === height) return;
    const current = view.current, ratio = fitJapan(width, height).zoom / fitJapan(width, before).zoom;
    const nextZoom = current.zoom * ratio;
    move({ zoom: nextZoom, pan: [current.pan[0] * ratio,
      (height / 2 - (before / 2 - current.pan[1] / current.zoom)) * nextZoom] });
  }, [height, width, japanMode]);
  const previousReset = useRef(resetToken);
  useEffect(() => {
    if (!japanMode || previousReset.current === resetToken) return;
    previousReset.current = resetToken;
    move(fitJapan(width, height), true);
  }, [resetToken, japanMode, width, height]);
  const previousToken = useRef(focusToken);
  const previousFocus = useRef(initialView ? focus : undefined);
  useEffect(() => {
    if (previousFocus.current === focus && previousToken.current === focusToken) return;
    previousToken.current = focusToken;
    previousFocus.current = focus;
    if (!focus || preview) return;
    if (isWorld && focusPoint) {
      const point = worldProjection(focusPoint);
      if (point) {
        const nextZoom = focus.hasGeometry === false ? 6 : 3.5;
        setZoom(nextZoom);
        setPan([(width / 2 - point[0]) * nextZoom, (height / 2 - point[1]) * nextZoom]);
      }
      return;
    }
    const point = section === "mountains" && focus.coordinates ? mountainProjection(focus.coordinates as [number, number]) :
      null;
    if (section === "mountains" && point) {
      const nextZoom = japanMode ? Math.max(view.current.zoom, fitJapan(width, height).zoom * 6) : 4;
      const target = { zoom: nextZoom, pan: [(width / 2 - point[0]) * nextZoom, (height / 2 - point[1]) * nextZoom] };
      if (japanMode) move(target, true); else { setZoom(target.zoom); setPan(target.pan); }
    }
  }, [focus, focusToken, focusPoint, section, preview, width, height, isWorld, japanMode]);
  const select = (id: string) => {
    if (drag.current?.moved || (japanMode && suppressClick.current)) return;
    const e = entries.get(id);
    if (e) onSelect?.(e);
  };
  const key = (event: React.KeyboardEvent, id: string) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (japanMode) suppressClick.current = false;
      select(id);
    }
  };
  const selectNearestSummit = (event: React.MouseEvent<SVGSVGElement>) => {
    if (preview || section !== "mountains" || drag.current?.moved || (japanMode && suppressClick.current)) return;
    const inverse = event.currentTarget.getScreenCTM()?.inverse();
    if (!inverse) return;
    const click = new DOMPoint(event.clientX, event.clientY).matrixTransform(inverse);
    let nearest: Entry | undefined;
    let distance = 22;
    for (const entry of mountainEntries) {
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
    <div className={`map-surface ${preview ? "map-preview" : ""}`} data-japan-animating={japanMode ? "false" : undefined} data-japan-zoom={japanMode ? zoom / fitJapan(width, height).zoom : undefined} data-pan-x={japanMode ? pan[0] : undefined} data-pan-y={japanMode ? pan[1] : undefined}>
      {!preview && (
        <div className="map-tools">
          <button
            aria-label="地図を拡大"
            onClick={() => zoomAt(1.5)}
          >
            ＋
          </button>
          <button
            aria-label="地図を縮小"
            onClick={() => zoomAt(1 / 1.5)}
          >
            −
          </button>
          <button
            aria-label="地図をリセット"
            onClick={() => {
              if (japanMode) { if (onReset) onReset(); else move(fitJapan(width, height), true); return; }
              setZoom(1);
              setPan([0, 0]);
              onReset?.();
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
          if (japanMode) { stopAnimation(); if (!touches.current.size) suppressClick.current = false; e.currentTarget.setPointerCapture(e.pointerId); }
          touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          if (touches.current.size === 2) {
            const [a, b] = [...touches.current.values()];
            pinchDistance.current = Math.hypot(a.x - b.x, a.y - b.y);
            if (drag.current) drag.current.moved = true;
            if (japanMode) suppressClick.current = true;
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
            if (pinchDistance.current) {
              const inverse = e.currentTarget.getScreenCTM()?.inverse();
              const point = inverse ? new DOMPoint((a.x + b.x) / 2, (a.y + b.y) / 2).matrixTransform(inverse) : undefined;
              zoomAt(distance / pinchDistance.current, point ? [point.x, point.y] : undefined);
            }
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
            if (japanMode) { suppressClick.current = true; move({ zoom: view.current.zoom, pan: [d.pan[0] + dx, d.pan[1] + dy] }); }
            else setPan([d.pan[0] + dx, d.pan[1] + dy]);
          }
        }}
        onPointerUp={(e) => {
          touches.current.delete(e.pointerId);
          pinchDistance.current = null;
          if (japanMode) drag.current = null;
          else setTimeout(() => { drag.current = null; }, 0);
        }}
        onPointerCancel={() => {
          touches.current.clear();
          pinchDistance.current = null;
          drag.current = null;
          if (japanMode) suppressClick.current = true;
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
          fill={japanMode ? "#f6f3ed" : `url(#ocean-${section}-${preview})`}
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
                className={`land ${active && showVisits ? "visited" : ""} ${section === "mountains" ? "prefecture-layer" : ""} ${focusPoint && focus?.id === id ? "selected-land" : ""}`}
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
          {isWorld && focus && focusPoint && (() => {
            const point = worldProjection(focusPoint);
            return point && <g className="world-map-label" transform={`translate(${point[0]} ${point[1]}) scale(${markerScale / zoom})`} pointerEvents="none">
              <circle r="3" fill="#b17d32" /><text y="-12" textAnchor="middle">{focus.name}</text>
            </g>;
          })()}
          {section === "mountains" &&
            renderedMountains.map((m) => {
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
                  {japanMode && focus?.id === m.id && <foreignObject className="japan-map-label" x="-110" y="-98" width="220" height="88" pointerEvents="none">
                    <div><strong>{m.name}</strong><span>{m.elevation?.toLocaleString("ja-JP")}m · {done ? "登頂済み" : "未登頂"}</span><span>{mountainRegion(m)}</span></div>
                  </foreignObject>}
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
