import { useEffect, useRef, useState } from "react";
import type { Archive, Section } from "../data/model";
import { sections } from "../data/catalogs";
import { createRoomEngine } from "./roomEngine";
import type { Direction, RoomEngine, RoomSnapshot } from "./types";
import "./room.css";

const destinations: Record<
  Section,
  { title: string; label: string; total?: number }
> = {
  world: { title: "World", label: "世界地図を開く" },
  japan: { title: "Japan", label: "日本地図を開く", total: 47 },
  mountains: { title: "Mountains", label: "百名山を開く", total: 100 },
  pokemon: {
    title: "Pokédex",
    label: "スマートフォンでポケモン図鑑を開く",
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
function Fist() {
  return (
    <svg viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <path
        d="M10 26v-5l-4-5a3 3 0 0 1 4-4l2 2V7a2 2 0 0 1 4 0v5-6a2 2 0 0 1 4 0v6-5a2 2 0 0 1 4 0v6-3a2 2 0 0 1 4 0v8c0 3-2 5-4 7v1H10Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M12 15h8m-9 11h13"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default function RoomHome({ archive }: { archive: Archive }) {
  const host = useRef<HTMLDivElement>(null);
  const engine = useRef<RoomEngine | null>(null);
  const menu = useRef<HTMLDialogElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "fallback">(
    "loading",
  );
  const [hover, setHover] = useState<Section | null>(null);
  const [opening, setOpening] = useState<Section | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [snapshot, setSnapshot] = useState<RoomSnapshot>({
    x: 0.95,
    z: 3.05,
    height: 0,
    moving: false,
    grounded: true,
    supportId: null,
    yaw: 0,
    pitch: 0,
    punching: false,
    brokenCount: 0,
  });
  const [reducedMotion, setReducedMotion] = useState(prefersReducedMotion);
  const [held, setHeld] = useState<Set<Direction>>(new Set());

  useEffect(() => {
    if (!host.current) return;
    let disposed = false;
    const failed = () => {
      if (disposed) return;
      setStatus("fallback");
      setOpening(null);
      setHover(null);
    };
    try {
      engine.current = createRoomEngine({
        host: host.current,
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
        onBreak: (label) => {
          if (!disposed) setNotice(`${label}を壊しました`);
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
    engine.current?.setPaused(menuOpen);
    setHeld(new Set());
  }, [menuOpen, status]);
  useEffect(() => {
    if (menuOpen && !menu.current?.open) {
      menu.current?.showModal();
      closeButton.current?.focus();
    } else if (!menuOpen && menu.current?.open) {
      menu.current.close();
      menuButton.current?.focus();
    }
  }, [menuOpen]);
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
      /* Optional storage. */
    }
    setReducedMotion(motionOverride);
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
  const unavailable = status !== "ready" || Boolean(opening) || menuOpen;
  const links = (className: string) => (
    <nav className={className} aria-label="コレクションの記録">
      {sections.map((section, index) => (
        <a
          key={section}
          href={`#/${section}`}
          aria-label={destinations[section].label}
        >
          <span className="room-link-number">0{index + 1}</span>
          <span>{destinations[section].title}</span>
          <span className="room-link-count">
            {archive.achieved[section].size}
            {destinations[section].total
              ? ` / ${destinations[section].total}`
              : ""}
          </span>
          <span aria-hidden="true">↗</span>
        </a>
      ))}
    </nav>
  );

  return (
    <section
      className={`room-home room-first-person${reducedMotion ? " is-still" : ""}${opening ? " is-opening" : ""}`}
      aria-label="コレクションルーム"
      data-view="first-person"
      data-room-status={status}
      data-player-x={snapshot.x.toFixed(3)}
      data-player-z={snapshot.z.toFixed(3)}
      data-player-height={snapshot.height.toFixed(3)}
      data-grounded={snapshot.grounded}
      data-support-id={snapshot.supportId ?? ""}
      data-yaw={snapshot.yaw.toFixed(3)}
      data-pitch={snapshot.pitch.toFixed(3)}
      data-punching={snapshot.punching}
      data-broken-count={snapshot.brokenCount}
    >
      <h1 className="room-sr-only">コレクションルーム</h1>
      <div
        ref={host}
        className="room-canvas"
        aria-label="ドラッグで見回す3Dの部屋"
      />
      <header className="room-hud-header">
        <span className="room-wordmark" aria-label="Personal Atlas">
          <svg viewBox="0 0 32 32" fill="none" aria-hidden="true">
            <path
              d="M3 27L16 4l13 23H3ZM10 27l6-11 6 11M9 17h14"
              stroke="currentColor"
              strokeWidth="1.3"
            />
          </svg>
          <span>ATLAS</span>
        </span>
        <button
          ref={menuButton}
          className="room-menu-toggle"
          aria-label="記録と設定を開く"
          aria-expanded={menuOpen}
          aria-controls="room-menu"
          onClick={() => setMenuOpen(true)}
        >
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M4 8h16M4 16h16"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </header>
      {status === "loading" && (
        <div className="room-loading" role="status">
          <span className="room-loader" />
          部屋を準備しています
        </div>
      )}
      {status === "ready" && (
        <>
          <span
            className={`room-crosshair${hover ? " has-target" : ""}`}
            aria-hidden="true"
          />
          {hover && !opening && !menuOpen && (
            <button
              className="room-target"
              onClick={() => engine.current?.open(hover)}
              aria-label={destinations[hover].label}
            >
              {destinations[hover].title}
              <span aria-hidden="true">↗</span>
              <kbd>E</kbd>
            </button>
          )}
        </>
      )}
      {status === "fallback" && (
        <div className="room-fallback">
          <span className="room-menu-eyebrow">PERSONAL COLLECTION</span>
          <h2>Collection index.</h2>
          <p>この環境では3Dを表示できません。こちらから記録を開けます。</p>
          {links("room-fallback-links")}
        </div>
      )}
      <div className="room-controls">
        <div className="direction-pad" role="group" aria-label="移動">
          <span className="pad-center" aria-hidden="true" />
          {arrows.map(({ direction, label, rotation }) => (
            <button
              key={direction}
              className={`direction-${direction}${held.has(direction) ? " is-held" : ""}`}
              aria-label={label}
              disabled={unavailable}
              onPointerDown={(event) => {
                event.preventDefault();
                event.currentTarget.setPointerCapture(event.pointerId);
                press(direction, true);
              }}
              onPointerUp={(event) => {
                press(direction, false);
                if (event.currentTarget.hasPointerCapture(event.pointerId))
                  event.currentTarget.releasePointerCapture(event.pointerId);
              }}
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
        </div>
        <div className="room-actions">
          <button
            className={`room-punch${snapshot.punching ? " is-active" : ""}`}
            aria-label="パンチ"
            title="パンチ（F / J）"
            disabled={unavailable}
            onClick={() => engine.current?.punch()}
          >
            <Fist />
          </button>
          <button
            className="room-jump"
            aria-label="ジャンプ"
            title="ジャンプ（Space）"
            disabled={unavailable}
            onClick={() => engine.current?.jump()}
          >
            <svg viewBox="0 0 32 32" fill="none" aria-hidden="true">
              <path
                d="M6 26h7m6 0h7M9 21V14a7 7 0 0 1 14 0v7M12 10l4-5 4 5"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      </div>
      <p className="room-sr-only" role="status" aria-live="polite">
        {notice ||
          (opening ? `${destinations[opening].title}を開いています` : "")}
      </p>
      <dialog
        ref={menu}
        id="room-menu"
        className="room-menu"
        aria-labelledby="room-menu-title"
        onClose={() => setMenuOpen(false)}
        onCancel={() => setMenuOpen(false)}
        onClick={(event) => {
          if (event.target === event.currentTarget) setMenuOpen(false);
        }}
      >
        <div className="room-menu-panel">
          <header>
            <span className="room-menu-eyebrow">PERSONAL ATLAS</span>
            <button
              ref={closeButton}
              className="room-menu-close"
              aria-label="部屋に戻る"
              onClick={() => setMenuOpen(false)}
            >
              ×
            </button>
          </header>
          <h2 id="room-menu-title">Collections.</h2>
          {links("room-menu-links")}
          <div className="room-menu-settings">
            <button
              className="motion-toggle"
              aria-label="動きを減らす"
              aria-pressed={reducedMotion}
              onClick={toggleMotion}
            >
              <span>動きを減らす</span>
              <span>{reducedMotion ? "ON" : "OFF"}</span>
            </button>
            <button
              aria-label="部屋の小物を元に戻す"
              disabled={status !== "ready"}
              onClick={() => {
                engine.current?.resetObjects();
                setNotice("部屋の小物を元に戻しました");
                setMenuOpen(false);
              }}
            >
              小物を元に戻す<span aria-hidden="true">↶</span>
            </button>
          </div>
          <dl className="room-controls-guide">
            <div>
              <dt>見回す</dt>
              <dd>ドラッグ / スワイプ</dd>
            </div>
            <div>
              <dt>移動</dt>
              <dd>WASD / 矢印 / 左下パッド</dd>
            </div>
            <div>
              <dt>ジャンプ</dt>
              <dd>Space / ↥ ボタン</dd>
            </div>
            <div>
              <dt>パンチ</dt>
              <dd>F・J / 拳ボタン</dd>
            </div>
            <div>
              <dt>記録を開く</dt>
              <dd>物をタップ / E</dd>
            </div>
          </dl>
          <a className="room-index-link" href="#/index">
            一覧で見る <span aria-hidden="true">↗</span>
          </a>
        </div>
      </dialog>
    </section>
  );
}
