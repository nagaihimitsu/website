import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type RefObject,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { Archive, Section } from "../data/model";
import { createRoomEngine } from "./roomEngine";
import { stickInput } from "./locomotion";
import {
  roomDestinations,
  roomDestinationIds,
  type RoomDestinationDefinition,
} from "./destinations";
import { createRoomSnapshotReporter } from "./roomSnapshot";
import { createBassGameStore } from "./bassGameStore";
import { BassGameHUD } from "./BassGameHUD";
import type { BassAudioStatus } from "./bassAudio";
import type { Direction, RoomDestination, RoomEngine } from "./types";
import "./room.css";

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

function BassOverlay({ store, engine, paused, audioStatus, onPause }: {
  store: ReturnType<typeof createBassGameStore>;
  engine: RefObject<RoomEngine | null>;
  paused: boolean;
  audioStatus: BassAudioStatus;
  onPause: () => void;
}) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  return <BassGameHUD snapshot={snapshot} paused={paused} audioStatus={audioStatus}
    onStart={() => engine.current?.startBass()}
    onSong={(id) => {
      if (!engine.current?.selectBassSong(id)) return;
      try {
        const value = JSON.parse(localStorage.getItem("personal-atlas-bass-audio-offset-v1") ?? "{}")[id];
        if (typeof value === "number" && Number.isFinite(value) && value >= -0.75 && value <= 5) engine.current.setBassAudioOffset(value);
      } catch { /* 端末の設定保存が使えない場合も演奏は続ける。 */ }
    }}
    onOffset={(value) => {
      if (!engine.current?.setBassAudioOffset(value)) return;
      try {
        const offsets = JSON.parse(localStorage.getItem("personal-atlas-bass-audio-offset-v1") ?? "{}");
        localStorage.setItem("personal-atlas-bass-audio-offset-v1", JSON.stringify({ ...offsets, [snapshot.songId]: value }));
      } catch { /* 設定保存なしでも手動調整できる。 */ }
    }}
    onDifficulty={(difficulty) => engine.current?.setBassDifficulty(difficulty)}
    onInput={(input) => engine.current?.inputBass(input)}
    onPause={onPause}
    onLayout={(height) => engine.current?.setBassOverlayHeight(height)}
    onPutDown={() => engine.current?.putDownBass()} />;
}

export default function RoomHome({ archive }: { archive: Archive }) {
  const room = useRef<HTMLElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const targetInteraction = useRef({ hovered: false, focused: false });
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
  const [punching, setPunching] = useState(false);
  const [bassStore] = useState(createBassGameStore);
  const [bassHeld, setBassHeld] = useState(false);
  const [bassAudioStatus, setBassAudioStatus] = useState<BassAudioStatus>("idle");
  const [reducedMotion, setReducedMotion] = useState(prefersReducedMotion);
  const [held, setHeld] = useState<Set<Direction>>(new Set());

  useEffect(() => {
    if (!host.current || !room.current) return;
    let disposed = false;
    const reportSnapshot = createRoomSnapshotReporter(room.current, setPunching);
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
        onDoorOpen: () => {
          if (!disposed) setNotice("ドアを開けました");
        },
        onBassSnapshot: (value) => {
          if (disposed) return;
          const held = !["idle", "approaching"].includes(value.phase);
          setBassHeld((previous) => previous === held ? previous : held);
          if (room.current) {
            room.current.dataset.bassPhase = value.phase;
            room.current.dataset.bassDifficulty = value.difficulty;
            room.current.dataset.bassSong = value.songId;
            room.current.dataset.bassAudioOffset = String(value.audioOffsetSec);
            room.current.dataset.bassBpm = String(value.bpm);
            room.current.dataset.bassProgress = value.proximityProgress.toFixed(3);
            room.current.dataset.bassElapsed = value.elapsed.toFixed(3);
            room.current.dataset.bassHits = String(value.hits);
            room.current.dataset.bassScore = String(value.score);
          }
          bassStore.publish(value);
        },
        onBassAudioStatus: (value) => {
          if (disposed) return;
          setBassAudioStatus(value);
          if (room.current) room.current.dataset.bassAudio = value;
        },
        onSnapshot: (value) => {
          if (!disposed) reportSnapshot(value);
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
      if (!["idle", "approaching"].includes(bassStore.getSnapshot().phase))
        host.current?.querySelector("canvas")?.focus({ preventScroll: true });
      else menuButton.current?.focus();
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
  const target = hover ? roomDestinations[hover] : null;
  const targetVisible =
    status === "ready" && target !== null && !opening && !menuOpen && !bassHeld;
  const updateTargetInteraction = (
    kind: "hovered" | "focused",
    value: boolean,
  ) => {
    targetInteraction.current[kind] = value;
    const { hovered, focused } = targetInteraction.current;
    engine.current?.setTargetHovered(hovered || focused);
  };
  const targetEvents = {
    onPointerEnter: () => updateTargetInteraction("hovered", true),
    onPointerLeave: () => updateTargetInteraction("hovered", false),
    onFocus: () => updateTargetInteraction("focused", true),
    onBlur: () => updateTargetInteraction("focused", false),
  };
  useEffect(() => {
    return () => {
      targetInteraction.current = { hovered: false, focused: false };
      engine.current?.setTargetHovered(false);
    };
  }, [hover, targetVisible]);

  const links = (className: string) => (
    <nav className={className} aria-label="コレクションの記録">
      {roomDestinationIds.map((id, index) => {
        const destination: RoomDestinationDefinition = roomDestinations[id];
        const external = destination.kind === "external";
        return (
          <a
            key={id}
            href={external ? destination.href : `#/${destination.section}`}
            target={external ? destination.target : undefined}
            rel={external ? destination.rel : undefined}
            aria-label={destination.label}
          >
            <span className="room-link-number">
              {String(index + 1).padStart(2, "0")}
            </span>
            <span>{destination.title}</span>
            {external ? (
              <span className="room-link-external">{destination.hint}</span>
            ) : (
              <span className="room-link-count">
                {archive.achieved[destination.section].size}
                {destination.total ? ` / ${destination.total}` : ""}
              </span>
            )}
            {external ? <ExternalLink /> : <span aria-hidden="true">↗</span>}
          </a>
        );
      })}
    </nav>
  );

  return (
    <section
      ref={room}
      className={`room-home room-third-person${reducedMotion ? " is-still" : ""}${opening ? " is-opening" : ""}`}
      aria-label="コレクションルーム"
      data-view="third-person"
      data-character="traveler"
      data-room-status={status}
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
          {targetVisible &&
            target &&
            hover &&
            (target.kind === "external" ? (
              <a
                className="room-target room-target-external"
                href={target.href}
                target={target.target}
                rel={target.rel}
                aria-label={target.label}
                {...targetEvents}
              >
                <span className="room-target-copy">
                  <span>{target.title}</span>
                  <small>{target.hint}</small>
                </span>
                <ExternalLink />
                <kbd>E</kbd>
              </a>
            ) : (
              <button
                className="room-target"
                onClick={() => engine.current?.open(hover)}
                aria-label={target.label}
                {...targetEvents}
              >
                {target.title}
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
      <BassOverlay onPause={() => setMenuOpen(true)} store={bassStore} engine={engine} audioStatus={bassAudioStatus} paused={menuOpen || status !== "ready" || Boolean(opening)} />
      <div className="room-controls" style={bassHeld ? { display: "none" } : undefined}>
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
            className={`room-punch${punching ? " is-active" : ""}`}
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
          (opening ? `${roomDestinations[opening].title}を開いています` : "")}
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
              <dt>拡大・縮小</dt>
              <dd>景色を2本指でピンチ。指を離すと元に戻ります。</dd>
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
