import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { Archive, Section } from "../data/model";
import { sections } from "../data/catalogs";
import { createRoomEngine } from "./roomEngine";
import { stickInput } from "./locomotion";
import { INITIAL_PLAYER_POSITION } from "./followCamera";
import { INSTAGRAM_URL } from "./destinations";
import type {
  Direction,
  RoomDestination,
  RoomEngine,
  RoomSnapshot,
} from "./types";
import "./room.css";

const destinations: Record<
  RoomDestination,
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
  instagram: {
    title: "Instagram",
    label: "Instagramを開く（外部リンク・新しいタブ）",
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
function ExternalLink() {
  return (
    <svg
      className="room-external-icon"
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M11 3h6v6m0-6-8 8M8 4H4a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1v-4"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
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
  const joystick = useRef<HTMLDivElement>(null);
  const stickPointer = useRef<number | null>(null);
  const [stick, setStick] = useState({ x: 0, z: 0 });
  const [status, setStatus] = useState<"loading" | "ready" | "fallback">(
    "loading",
  );
  const [hover, setHover] = useState<RoomDestination | null>(null);
  const [opening, setOpening] = useState<Section | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [snapshot, setSnapshot] = useState<RoomSnapshot>({
    x: INITIAL_PLAYER_POSITION.x,
    z: INITIAL_PLAYER_POSITION.z,
    height: 0,
    moving: false,
    grounded: true,
    supportId: null,
    yaw: 0,
    pitch: 0,
    facing: 0,
    cameraDistance: 2.75,
    cameraX: 0,
    cameraY: 0,
    cameraZ: 0,
    punching: false,
    brokenCount: 0,
    birdX: 0,
    birdZ: 0,
    birdHeight: 0,
    birdMoving: false,
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
    releaseStick();
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
      releaseStick();
    };
    window.addEventListener("blur", clear);
    document.addEventListener("visibilitychange", clear);
    return () => {
      preference.removeEventListener("change", update);
      window.removeEventListener("blur", clear);
      document.removeEventListener("visibilitychange", clear);
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
  function releaseStick() {
    const id = stickPointer.current;
    stickPointer.current = null;
    if (id !== null && joystick.current?.hasPointerCapture(id))
      joystick.current.releasePointerCapture(id);
    engine.current?.move(0, 0);
    setStick({ x: 0, z: 0 });
  }
  function updateStick(event: ReactPointerEvent<HTMLDivElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const next = stickInput(
      event.clientX - bounds.left - bounds.width / 2,
      event.clientY - bounds.top - bounds.height / 2,
      bounds.width * 0.3,
    );
    setStick(next);
    engine.current?.move(next.x, next.z);
  }
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
      <a
        href={INSTAGRAM_URL}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={destinations.instagram.label}
      >
        <span className="room-link-number">05</span>
        <span>Instagram</span>
        <span className="room-link-external">外部リンク・新しいタブ</span>
        <ExternalLink />
      </a>
    </nav>
  );

  return (
    <section
      className={`room-home room-third-person${reducedMotion ? " is-still" : ""}${opening ? " is-opening" : ""}`}
      aria-label="コレクションルーム"
      data-view="third-person"
      data-character="traveler"
      data-room-status={status}
      data-player-x={snapshot.x.toFixed(3)}
      data-player-z={snapshot.z.toFixed(3)}
      data-player-height={snapshot.height.toFixed(3)}
      data-grounded={snapshot.grounded}
      data-support-id={snapshot.supportId ?? ""}
      data-yaw={snapshot.yaw.toFixed(3)}
      data-pitch={snapshot.pitch.toFixed(3)}
      data-facing={snapshot.facing.toFixed(3)}
      data-camera-distance={snapshot.cameraDistance.toFixed(3)}
      data-camera-x={snapshot.cameraX.toFixed(3)}
      data-camera-y={snapshot.cameraY.toFixed(3)}
      data-camera-z={snapshot.cameraZ.toFixed(3)}
      data-punching={snapshot.punching}
      data-broken-count={snapshot.brokenCount}
      data-bird-x={snapshot.birdX.toFixed(3)}
      data-bird-z={snapshot.birdZ.toFixed(3)}
      data-bird-height={snapshot.birdHeight.toFixed(3)}
      data-bird-moving={snapshot.birdMoving}
    >
      <h1 className="room-sr-only">コレクションルーム</h1>
      <div
        ref={host}
        className="room-canvas"
        aria-label="キャラクターを操作し、360度見回せる3Dの部屋"
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
        <div className="room-hud-tools">
          <button
            className="room-view-reset"
            aria-label="視点を背後に戻す"
            title="視点を背後に戻す（R）"
            disabled={unavailable}
            onClick={() => engine.current?.resetView()}
          >
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M19 8a8 8 0 1 0 1 7M19 3v5h-5"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <circle
                cx="12"
                cy="12"
                r="3"
                stroke="currentColor"
                strokeWidth="1.3"
              />
            </svg>
          </button>
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
        </div>
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
          {hover &&
            !opening &&
            !menuOpen &&
            (hover === "instagram" ? (
              <a
                className="room-target room-target-external"
                href={INSTAGRAM_URL}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={destinations.instagram.label}
              >
                <span className="room-target-copy">
                  <span>Instagram</span>
                  <small>外部リンク・新しいタブ</small>
                </span>
                <ExternalLink />
                <kbd>E</kbd>
              </a>
            ) : (
              <button
                className="room-target"
                onClick={() => engine.current?.open(hover)}
                aria-label={destinations[hover].label}
              >
                {destinations[hover].title}
                <span aria-hidden="true">↗</span>
                <kbd>E</kbd>
              </button>
            ))}
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
        <div
          ref={joystick}
          className={`room-joystick${stickPointer.current !== null ? " is-held" : ""}`}
          role="group"
          aria-label="移動スティック"
          aria-describedby="room-stick-help"
          aria-disabled={unavailable}
          data-stick-x={stick.x.toFixed(3)}
          data-stick-z={stick.z.toFixed(3)}
          onPointerDown={(event) => {
            if (
              unavailable ||
              event.button !== 0 ||
              stickPointer.current !== null ||
              (event.target instanceof Element &&
                event.target.closest("button"))
            )
              return;
            event.preventDefault();
            stickPointer.current = event.pointerId;
            event.currentTarget.setPointerCapture(event.pointerId);
            updateStick(event);
          }}
          onPointerMove={(event) => {
            if (stickPointer.current === event.pointerId) updateStick(event);
          }}
          onPointerUp={(event) => {
            if (stickPointer.current === event.pointerId) releaseStick();
          }}
          onPointerCancel={(event) => {
            if (stickPointer.current === event.pointerId) releaseStick();
          }}
          onLostPointerCapture={(event) => {
            if (stickPointer.current === event.pointerId) releaseStick();
          }}
        >
          <span id="room-stick-help" className="room-sr-only">
            画面の上下左右に移動します。下に倒すと手前を向いて歩きます。
            小さく倒すと歩き、大きく倒すと走ります。カメラの向きは保たれます。
          </span>
          <span className="room-stick-track" aria-hidden="true" />
          <span className="room-stick-marks" aria-hidden="true">
            {arrows.map(({ direction, rotation }) => (
              <span key={direction} className={`mark-${direction}`}>
                <Arrow rotation={rotation} />
              </span>
            ))}
          </span>
          <span
            className="room-stick-thumb"
            aria-hidden="true"
            style={{
              transform: `translate(${stick.x * 76}%, ${stick.z * 76}%)`,
            }}
          />
          {arrows.map(({ direction, label, rotation }) => (
            <button
              key={direction}
              className={`room-stick-direction room-sr-only direction-${direction}`}
              aria-label={label}
              aria-pressed={held.has(direction)}
              disabled={unavailable}
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
              <dd>ドラッグ / スワイプ（360°）</dd>
            </div>
            <div>
              <dt>移動</dt>
              <dd>WASD / 矢印 / 左下スティック</dd>
            </div>
            <div>
              <dt>手前に歩く</dt>
              <dd>↓ / S / スティックを下へ</dd>
            </div>
            <div>
              <dt>カメラ</dt>
              <dd>位置に追従。移動では向きを変えません</dd>
            </div>
            <div>
              <dt>視点を戻す</dt>
              <dd>R / 右上の回転矢印</dd>
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
