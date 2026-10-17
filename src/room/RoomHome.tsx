import { useEffect, useRef, useState } from "react";
import type { Archive, Section } from "../data/model";
import { sections } from "../data/catalogs";
import { createRoomEngine } from "./roomEngine";
import type {
  Direction,
  RoomEngine,
  RoomProjection,
  RoomSnapshot,
} from "./types";
import "./room.css";

const destinations: Record<
  Section,
  {
    title: string;
    japanese: string;
    object: string;
    accessible: string;
    total?: number;
  }
> = {
  world: {
    title: "World",
    japanese: "国・地域",
    object: "世界地図",
    accessible: "世界地図を開く",
  },
  japan: {
    title: "Japan",
    japanese: "都道府県",
    object: "日本地図",
    accessible: "日本地図を開く",
    total: 47,
  },
  mountains: {
    title: "Mountains",
    japanese: "日本百名山",
    object: "登山の記録",
    accessible: "百名山を開く",
    total: 100,
  },
  pokemon: {
    title: "Pokédex",
    japanese: "全国図鑑",
    object: "スマートフォン",
    accessible: "スマートフォンでポケモン図鑑を開く",
    total: 1025,
  },
};
const arrows: { direction: Direction; label: string; rotation: number }[] = [
  { direction: "up", label: "前へ", rotation: 0 },
  { direction: "left", label: "左へ", rotation: -90 },
  { direction: "right", label: "右へ", rotation: 90 },
  { direction: "down", label: "後ろへ", rotation: 180 },
];

const MOTION_STORAGE_KEY = "personal-atlas-room-reduced-motion";
let motionOverride: boolean | null = (() => {
  try {
    const saved = sessionStorage.getItem(MOTION_STORAGE_KEY);
    return saved === "true" ? true : saved === "false" ? false : null;
  } catch {
    return null;
  }
})();

function prefersReducedMotion() {
  return (
    motionOverride ??
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function Arrow({ rotation = 0 }: { rotation?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      style={{ transform: `rotate(${rotation}deg)` }}
    >
      <path
        d="M12 19V5m-6 6 6-6 6 6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function RoomHome({ archive }: { archive: Archive }) {
  const host = useRef<HTMLDivElement>(null);
  const engine = useRef<RoomEngine | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "fallback">(
    "loading",
  );
  const [projected, setProjected] = useState<RoomProjection[]>([]);
  const [hover, setHover] = useState<Section | null>(null);
  const [opening, setOpening] = useState<Section | null>(null);
  const [snapshot, setSnapshot] = useState<RoomSnapshot>({
    x: 0,
    z: 0,
    height: 0,
    moving: false,
  });
  const [reducedMotion, setReducedMotion] = useState(prefersReducedMotion);
  const [held, setHeld] = useState<Set<Direction>>(new Set());

  useEffect(() => {
    const node = host.current;
    if (!node) return;
    let disposed = false;
    const failed = () => {
      if (disposed) return;
      setStatus("fallback");
      setProjected([]);
      setOpening(null);
    };
    try {
      engine.current = createRoomEngine({
        host: node,
        archive,
        reducedMotion: prefersReducedMotion(),
        onReady: () => {
          if (!disposed) setStatus("ready");
        },
        onError: failed,
        onOpening: (section) => {
          if (!disposed) setOpening(section);
        },
        onOpen: (section) => {
          if (!disposed) window.location.hash = `/${section}`;
        },
        onHover: (section) => {
          if (!disposed) setHover(section);
        },
        onProject: (portals) => {
          if (!disposed) setProjected(portals);
        },
        onSnapshot: (value) => {
          if (!disposed) setSnapshot(value);
        },
      });
    } catch {
      failed();
    }
    return () => {
      disposed = true;
      engine.current?.dispose();
      engine.current = null;
    };
  }, [archive]);

  useEffect(() => {
    engine.current?.setReducedMotion(reducedMotion);
  }, [reducedMotion]);
  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => {
      if (motionOverride === null) setReducedMotion(preference.matches);
    };
    preference.addEventListener("change", update);
    const clear = () => {
      for (const { direction } of arrows)
        engine.current?.direction(direction, false);
      setHeld(new Set());
    };
    window.addEventListener("blur", clear);
    return () => {
      preference.removeEventListener("change", update);
      window.removeEventListener("blur", clear);
    };
  }, []);

  const toggleMotion = () => {
    motionOverride = !reducedMotion;
    try {
      sessionStorage.setItem(MOTION_STORAGE_KEY, String(motionOverride));
    } catch {
      // The in-memory choice still survives navigation when storage is blocked.
    }
    setReducedMotion(motionOverride);
  };

  const open = (section: Section) => {
    if (opening) return;
    if (status !== "ready" || !engine.current) {
      window.location.hash = `/${section}`;
      return;
    }
    engine.current.open(section);
  };
  const press = (direction: Direction, value: boolean) => {
    engine.current?.direction(direction, value);
    setHeld((previous) => {
      const next = new Set(previous);
      if (value) next.add(direction);
      else next.delete(direction);
      return next;
    });
  };

  return (
    <section
      className={`room-home${reducedMotion ? " is-still" : ""}${opening ? " is-opening" : ""}`}
      aria-labelledby="room-title"
      data-room-status={status}
      data-player-x={snapshot.x.toFixed(3)}
      data-player-z={snapshot.z.toFixed(3)}
      data-player-height={snapshot.height.toFixed(3)}
    >
      <header className="room-header">
        <a className="room-brand" href="#/" aria-label="Personal Atlas ホーム">
          <svg viewBox="0 0 32 32" fill="none" aria-hidden="true">
            <path
              d="M3 27L16 4l13 23H3Z M10 27l6-11 6 11 M9 17h14"
              stroke="currentColor"
              strokeWidth="1.4"
            />
          </svg>
          <span>
            PERSONAL
            <br />
            ATLAS.
          </span>
        </a>
        <div className="room-header-actions">
          <button
            className="motion-toggle"
            aria-label="動きを減らす"
            aria-pressed={reducedMotion}
            onClick={toggleMotion}
          >
            <span className="motion-indicator" aria-hidden="true" />
            MOTION <span>{reducedMotion ? "OFF" : "ON"}</span>
          </button>
          <a className="room-index-link" href="#/index">
            一覧で見る <span aria-hidden="true">↗</span>
          </a>
        </div>
      </header>
      <div className="room-heading">
        <div className="room-kicker">
          <span className="room-sun" aria-hidden="true">
            ☼
          </span>{" "}
          PERSONAL COLLECTION
        </div>
        <h1 id="room-title">
          My room<span>.</span>
        </h1>
      </div>
      <div
        className="room-canvas"
        ref={host}
        aria-label="歩いて探索できるコレクションの部屋"
      />
      <div className="room-portals" aria-label="部屋の中のコレクション">
        {status === "ready" &&
          projected
            .filter((p) => p.visible)
            .map((p) => (
              <button
                key={p.section}
                className={`room-portal portal-${p.section}${hover === p.section ? " is-hovered" : ""}`}
                data-section={p.section}
                aria-label={destinations[p.section].accessible}
                style={{ left: p.x, top: p.y }}
                onPointerEnter={() => setHover(p.section)}
                onPointerLeave={() => setHover(null)}
                onClick={() => open(p.section)}
                disabled={Boolean(opening)}
              >
                <span className="portal-point" aria-hidden="true">
                  <span />
                </span>
                <span className="portal-caption">
                  <span className="portal-number">
                    0{sections.indexOf(p.section) + 1}
                  </span>
                  {destinations[p.section].object}
                  <span className="portal-arrow" aria-hidden="true">
                    ↗
                  </span>
                </span>
              </button>
            ))}
      </div>
      {status === "loading" && (
        <div className="room-loading" role="status">
          <span className="room-loader" />
          部屋を準備しています
        </div>
      )}
      {status === "fallback" && (
        <div className="room-fallback">
          <span className="room-kicker">COLLECTION INDEX</span>
          <h2>コレクション</h2>
          <p role="status">
            この環境では3Dの部屋を表示できません。記録はここからご覧いただけます。
          </p>
          <div className="fallback-grid">
            {sections.map((section, i) => (
              <a href={`#/${section}`} key={section}>
                <span>0{i + 1}</span>
                <strong>{destinations[section].title}</strong>
                <span>
                  {destinations[section].japanese}{" "}
                  <b>{archive.achieved[section].size}</b>
                </span>
                <Arrow rotation={45} />
              </a>
            ))}
          </div>
        </div>
      )}
      <div className="room-bottom">
        <div className="room-movement" aria-label="部屋の移動操作">
          <div className="direction-pad">
            {arrows.map(({ direction, label, rotation }) => (
              <button
                key={direction}
                className={`direction-${direction}${held.has(direction) ? " is-held" : ""}`}
                aria-label={label}
                disabled={status !== "ready" || Boolean(opening)}
                onPointerDown={(event) => {
                  event.preventDefault();
                  event.currentTarget.setPointerCapture(event.pointerId);
                  press(direction, true);
                }}
                onPointerUp={() => press(direction, false)}
                onPointerCancel={() => press(direction, false)}
                onLostPointerCapture={() => press(direction, false)}
                onKeyDown={(event) => {
                  if (event.key === " " || event.key === "Enter") {
                    event.preventDefault();
                    press(direction, true);
                  }
                }}
                onKeyUp={(event) => {
                  if (event.key === " " || event.key === "Enter") {
                    event.preventDefault();
                    press(direction, false);
                  }
                }}
                onBlur={() => press(direction, false)}
              >
                <Arrow rotation={rotation} />
              </button>
            ))}
            <span className="pad-center" aria-hidden="true" />
          </div>
          <span className="control-caption">
            MOVE <span>W A S D / 矢印キー</span>
          </span>
        </div>
        <div className="room-instruction">
          <span className="instruction-dot" />
          <span>
            {opening
              ? `${destinations[opening].japanese}を開いています`
              : "部屋のアイテムをクリック / タップ"}
          </span>
        </div>
        <div className="room-jump">
          <button
            aria-label="ジャンプ"
            disabled={status !== "ready" || Boolean(opening)}
            onClick={() => engine.current?.jump()}
          >
            <svg viewBox="0 0 36 36" fill="none" aria-hidden="true">
              <path
                d="M8 25c1-11 4-17 10-17s9 6 10 17M13 13l5-5 5 5M6 29h8m8 0h8"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <span className="control-caption">
            JUMP <span>SPACE / タップ</span>
          </span>
        </div>
      </div>
      <nav className="room-shortcuts" aria-label="コレクションへの直接リンク">
        {sections.map((section, i) => (
          <a href={`#/${section}`} key={section}>
            <span className="shortcut-number">0{i + 1}</span>
            <span className="shortcut-title">
              {destinations[section].title}
            </span>
            <span className="shortcut-count">
              <strong>{archive.achieved[section].size}</strong>
              {destinations[section].total
                ? ` / ${destinations[section].total}`
                : ""}
            </span>
            <span className="shortcut-arrow" aria-hidden="true">
              ↗
            </span>
          </a>
        ))}
      </nav>
    </section>
  );
}
