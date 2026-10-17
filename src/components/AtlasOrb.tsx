import { useEffect, useRef } from "react";
import { geoGraticule, geoOrthographic, geoPath } from "d3-geo";
import type { FeatureCollection } from "geojson";
import worldJson from "../catalogs/world.json";
import "./AtlasOrb.css";

// A geographic illustration of the same Natural Earth data used by the atlas.
// The camera is centred on East Asia; it does not imply a recorded destination.
const projection = geoOrthographic()
  .rotate([-125, -24, -16])
  .translate([380, 380])
  .scale(294)
  .precision(0.4);
const path = geoPath(projection);
const features = (worldJson as FeatureCollection).features.map(
  (feature, i) => ({
    key: `${feature.id}-${i}`,
    id: String(feature.id),
    path: path(feature) || "",
  }),
);
const grid = path(geoGraticule().step([15, 15])()) || "";
const equator =
  path({
    type: "LineString",
    coordinates: Array.from({ length: 181 }, (_, i) => [-180 + i * 2, 0]),
  }) || "";
const ticks = Array.from({ length: 120 }, (_, i) => {
  const angle = (i * Math.PI) / 60;
  const inner = i % 10 === 0 ? 307 : i % 5 === 0 ? 311 : 314;
  return {
    x1: 380 + Math.sin(angle) * inner,
    y1: 380 - Math.cos(angle) * inner,
    x2: 380 + Math.sin(angle) * 318,
    y2: 380 - Math.cos(angle) * 318,
    major: i % 10 === 0,
  };
});

export function AtlasOrb({ achieved }: { achieved: Set<string> }) {
  const graphic = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = graphic.current;
    if (!element) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    const reset = () => {
      element.style.setProperty("--orb-x", "0px");
      element.style.setProperty("--orb-y", "0px");
    };
    const move = (event: PointerEvent) => {
      if (reducedMotion.matches || event.pointerType !== "mouse") return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const bounds = element.getBoundingClientRect();
        const x = Math.max(
          -1,
          Math.min(
            1,
            (event.clientX - bounds.x - bounds.width / 2) / bounds.width,
          ),
        );
        const y = Math.max(
          -1,
          Math.min(
            1,
            (event.clientY - bounds.y - bounds.height / 2) / bounds.height,
          ),
        );
        element.style.setProperty("--orb-x", `${x * 8}px`);
        element.style.setProperty("--orb-y", `${y * 8}px`);
      });
    };
    const motionChange = () => {
      cancelAnimationFrame(frame);
      reset();
    };
    window.addEventListener("pointermove", move, { passive: true });
    document.documentElement.addEventListener("pointerleave", reset);
    reducedMotion.addEventListener("change", motionChange);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", move);
      document.documentElement.removeEventListener("pointerleave", reset);
      reducedMotion.removeEventListener("change", motionChange);
    };
  }, []);

  return (
    <div className="atlas-orb" aria-hidden="true">
      <div className="atlas-orb-parallax" ref={graphic}>
        <svg viewBox="0 0 760 760" focusable="false">
          <g className="atlas-orb-instrument">
            <circle cx="380" cy="380" r="333" />
            <path d="M380 32v16 M380 712v16 M32 380h16 M712 380h16" />
            {ticks.map((tick, i) => (
              <line
                key={i}
                x1={tick.x1}
                y1={tick.y1}
                x2={tick.x2}
                y2={tick.y2}
                className={tick.major ? "atlas-orb-tick-major" : undefined}
              />
            ))}
          </g>
          <circle className="atlas-orb-ocean" cx="380" cy="380" r="294" />
          <g className="atlas-orb-geography">
            {features.map((feature) => (
              <path
                key={feature.key}
                d={feature.path}
                className={
                  achieved.has(feature.id)
                    ? "atlas-orb-land atlas-orb-achieved"
                    : "atlas-orb-land"
                }
              />
            ))}
          </g>
          <path className="atlas-orb-graticule" d={grid} />
          <path className="atlas-orb-equator" d={equator} />
          <circle className="atlas-orb-rim" cx="380" cy="380" r="294" />
          <g className="atlas-orb-labels">
            <text x="380" y="20" textAnchor="middle">
              ORTHOGRAPHIC
            </text>
            <text
              className="atlas-orb-coordinate"
              x="380"
              y="36"
              textAnchor="middle"
            >
              125° E / 24° N
            </text>
          </g>
        </svg>
      </div>
    </div>
  );
}
