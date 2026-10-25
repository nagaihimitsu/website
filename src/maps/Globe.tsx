import { useEffect, useRef, useState, useMemo } from "react";
import { geoCentroid } from "d3-geo";
import { MeshPhongMaterial } from "three";
import Globe, { type GlobeMethods } from "react-globe.gl";
import { worldFeatures } from "./Map";
import { catalogs } from "../data/catalogs";
import type { Entry } from "../data/model";
export default function WorldGlobe({
  achieved,
  onSelect,
  onFail,
  focus,
}: {
  achieved: Set<string>;
  focus?: Entry;
  onSelect: (entry: Entry) => void;
  onFail: () => void;
}) {
  const material = useMemo(
    () => new MeshPhongMaterial({ color: "#17252d", shininess: 8 }),
    [],
  );
  const parent = useRef<HTMLDivElement>(null);
  const globe = useRef<GlobeMethods | undefined>(undefined);
  const [width, setWidth] = useState(700);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.min(850, entry.contentRect.width)),
    );
    if (parent.current) observer.observe(parent.current);
    useEffect(() => {
    if (!focus) return;
    const feature = worldFeatures.find(f => String(f.id) === focus.id);
    if (feature) {
      const [lng, lat] = geoCentroid(feature);
      globe.current?.pointOfView({ lat, lng, altitude: 1.7 }, window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 500);
    }
  }, [focus]);
  useEffect(() => () => { material.dispose(); }, [material]);
  return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const node = parent.current;
    const lost = (event: Event) => {
      event.preventDefault();
      onFail();
    };
    node?.addEventListener("webglcontextlost", lost, true);
    return () => node?.removeEventListener("webglcontextlost", lost, true);
  }, [onFail]);
  return (
    <div className="globe" ref={parent} data-testid="globe">
      <Globe
        ref={globe}
        width={width}
        height={Math.min(550, width * 0.8 + 100)}
        backgroundColor="#0e1214"
        showGlobe
        globeMaterial={material}
        showAtmosphere
        atmosphereColor="#7dbeb6"
        atmosphereAltitude={0.12}
        showGraticules
        polygonsData={worldFeatures}
        polygonAltitude={0.006}
        polygonCapColor={(f) =>
          achieved.has(String((f as { id: string }).id)) ? "#6cd8be" : "#334956"
        }
        polygonSideColor={() => "#263845"}
        polygonStrokeColor={() => "#70818a"}
        polygonLabel={() => ""}
        onPolygonClick={(f) => {
          const entry = catalogs.world.find(
            (c) => c.id === String((f as { id: string }).id),
          );
          if (entry) onSelect(entry);
        }}
        onGlobeReady={() => {
          globe.current?.renderer().setPixelRatio(1);
          globe.current?.pointOfView({ lat: 25, lng: 135, altitude: 2.1 });
          const controls = globe.current?.controls();
          if (controls) {
            controls.autoRotate = false;
            controls.enableZoom = true;
            controls.minDistance = 125;
            controls.maxDistance = 500;
          }
        }}
      />
      <div className="map-coordinates">
        3D EARTH<span>ドラッグで回転 / スクロール・ピンチで拡大縮小</span>
      </div>
    </div>
  );
}
