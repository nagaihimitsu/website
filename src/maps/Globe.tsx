import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { MeshPhongMaterial } from "three";
import Globe, { type GlobeMethods } from "react-globe.gl";
import { worldFeatures } from "./Map";
import { catalogs } from "../data/catalogs";
import { countryView, regionName } from "./worldData";
import type { Entry } from "../data/model";
export interface GlobeView { lat: number; lng: number; altitude?: number; }
const defaultView = { lat: 25, lng: 135, altitude: 2.1 };
export default function WorldGlobe({ achieved, onSelect, onFail, focus, initialView, onViewChange, paper = false, resetToken = 0, focusToken = 0 }: {
  achieved: Set<string>;
  focus?: Entry;
  initialView?: GlobeView;
  onViewChange?: (view: GlobeView) => void;
  onSelect: (entry: Entry) => void;
  onFail: () => void;
  paper?: boolean;
  resetToken?: number;
  focusToken?: number;
}) {
  const material = useMemo(() => new MeshPhongMaterial({ color: paper ? "#e3e8df" : "#17252d", shininess: paper ? 3 : 8 }), [paper]);
  const gesture = useRef({ pointers: new Map<number, { x: number; y: number }>(), moved: false });
  const parent = useRef<HTMLDivElement>(null);
  const globe = useRef<GlobeMethods | undefined>(undefined);
  const [size, setSize] = useState({ width: 700, height: 550 });
  const [ready, setReady] = useState(false);
  const previous = useRef<{ focus?: Entry; reset: number; token: number; initialized: boolean }>({ focus, reset: resetToken, token: focusToken, initialized: false });
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => {
      const width = Math.max(1, paper ? entry.contentRect.width : Math.min(850, entry.contentRect.width));
      setSize({ width, height: paper ? Math.max(1, entry.contentRect.height) : Math.min(550, width * .8 + 100) });
    });
    if (parent.current) observer.observe(parent.current);
    return () => observer.disconnect();
  }, [paper]);
  useEffect(() => {
    const node = parent.current;
    const lost = (event: Event) => { event.preventDefault(); onFail(); };
    node?.addEventListener("webglcontextlost", lost, true);
    return () => node?.removeEventListener("webglcontextlost", lost, true);
  }, [onFail]);
  useEffect(() => {
    if (!ready) return;
    const last = previous.current;
    const changed = last.focus !== focus || last.reset !== resetToken || last.token !== focusToken;
    if (!changed && last.initialized) return;
    const target = !changed && initialView ? initialView : focus
      ? { lat: countryView(focus).point[1], lng: countryView(focus).point[0], altitude: 1.65 }
      : defaultView;
    // pointOfViewは既存の補間を止め、経度差180度以内の短い経路で最新選択へ移動する。
    globe.current?.pointOfView(target, changed && !window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 500 : 0);
    previous.current = { focus, reset: resetToken, token: focusToken, initialized: true };
  }, [focus, focusToken, resetToken, ready, initialView]);
  useEffect(() => () => { material.dispose(); }, [material]);
  const labels = useMemo(() => paper && focus ? [focus] : [], [paper, focus]);
  const labelElement = useCallback((object: object) => {
    const entry = object as Entry;
    const label = document.createElement("span");
    label.className = "world-country-label";
    label.textContent = entry.name;
    label.title = `${entry.name} · ${regionName(countryView(entry).region)}`;
    label.dataset.countryId = entry.id;
    return label;
  }, []);
  // 検索入力で同じ国境のジオメトリを再構築しないよう、描画用アクセサーを保持する。
  const polygonAltitude = useCallback((f: object) => paper && String((f as { id: string }).id) === focus?.id ? .014 : .006, [paper, focus]);
  const polygonCapColor = useCallback((f: object) => {
    const id = String((f as { id: string }).id);
    return paper ? (achieved.has(id) ? "#42684e" : "#cbd3c8") : (achieved.has(id) ? "#6cd8be" : "#334956");
  }, [paper, achieved]);
  const polygonStrokeColor = useCallback((f: object) => paper && String((f as { id: string }).id) === focus?.id ? "#b17d32" : paper ? "#f6f5ef" : "#70818a", [paper, focus]);
  return <div className={`globe${paper ? " world-globe" : ""}`} ref={parent} data-testid="globe" data-world-ready={ready} data-focus-id={focus?.id ?? ""}
    onPointerDownCapture={event => {
      const state = gesture.current;
      if (!state.pointers.size) state.moved = false;
      state.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (state.pointers.size > 1) state.moved = true;
    }}
    onPointerMoveCapture={event => {
      const start = gesture.current.pointers.get(event.pointerId);
      if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 6) gesture.current.moved = true;
    }}
    onPointerUpCapture={event => { gesture.current.pointers.delete(event.pointerId); }}
    onPointerCancelCapture={event => { gesture.current.pointers.delete(event.pointerId); gesture.current.moved = true; }}
  >
    <Globe ref={globe} width={size.width} height={size.height}
      backgroundColor={paper ? "#f6f3ed" : "#0e1214"} showGlobe globeMaterial={material}
      showAtmosphere={!paper} atmosphereColor="#7dbeb6" atmosphereAltitude={.12} showGraticules={!paper}
      polygonsData={worldFeatures} polygonAltitude={polygonAltitude} polygonCapColor={polygonCapColor}
      polygonSideColor={paper ? "#afbda9" : "#263845"} polygonStrokeColor={polygonStrokeColor}
      polygonLabel={() => ""} polygonsTransitionDuration={200}
      onPolygonClick={f => { if (paper && gesture.current.moved) return; const entry = catalogs.world.find(c => c.id === String((f as {id:string}).id)); if (entry) onSelect(entry); }}
      htmlElementsData={labels} htmlLat={d => countryView(d as Entry).point[1]} htmlLng={d => countryView(d as Entry).point[0]}
      htmlAltitude={.025} htmlElement={labelElement} htmlTransitionDuration={0}
      onZoom={view => {
        if (parent.current) {
          parent.current.dataset.viewLat = String(view.lat);
          parent.current.dataset.viewLng = String(view.lng);
          parent.current.dataset.viewAltitude = String(view.altitude);
        }
        onViewChange?.(view);
      }}
      onGlobeReady={() => {
        globe.current?.renderer().setPixelRatio(1);
        const controls = globe.current?.controls();
        if (controls) {
          // 選択補間後にドラッグの残留慣性が国の中心をずらさないよう、専用モードは指に直接追従させる。
          if (paper) controls.enableDamping = false;
          controls.autoRotate = false; controls.enableZoom = true; controls.enablePan = false;
          controls.minDistance = 125; controls.maxDistance = 500;
        }
        setReady(true);
      }}
    />
    {!paper && <div className="map-coordinates">3D EARTH<span>ドラッグで回転 / スクロール・ピンチで拡大縮小</span></div>}
  </div>;
}
