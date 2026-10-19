import { useEffect, useRef, type KeyboardEvent, type PointerEvent } from "react";
import { BASS_STRINGS, type BassGameSnapshot, type BassString } from "./bassGame";
import "./bassGame.css";

type BassGameHUDProps = {
  snapshot: BassGameSnapshot;
  onStart: () => void;
  onHold: (string: BassString, fret: number) => void;
  onRelease: (string: BassString) => void;
  onPluck: (string: BassString) => void;
  onPutDown: () => void;
  paused: boolean;
  onLayout?: (occupiedBottomHeight: number) => void;
};

const LOOK_AHEAD = 2;
const HOLD_KEYS = ["1", "2", "3", "4"];
const PICK_KEYS = ["7", "8", "9", "0"];
const activationKey = (event: KeyboardEvent) => event.code === "Space" || event.code === "Enter";
const fretPosition = (fret: number) => fret <= 2 ? "near" : fret >= 5 ? "far" : "middle";

function Flower() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 7.1c-5.5-7.4-9.3.1-4.1 3.7-9 2.4-3.3 8.7 2.2 5.1 0 9.4 7.7 6 6.1-.7 8.9 2.7 7.9-5.6.8-6 5.2-7.7-2.9-9.6-5-2.1Z" fill="currentColor" opacity=".25" />
      <circle cx="12" cy="12" r="3.1" fill="currentColor" />
    </svg>
  );
}

function Note() {
  return (
    <svg viewBox="0 0 24 28" fill="none" aria-hidden="true">
      <path d="M15 21V5c1 4 6 3 6 8" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" />
      <ellipse cx="9.5" cy="22" rx="5.8" ry="4.2" transform="rotate(-20 9.5 22)" fill="currentColor" />
    </svg>
  );
}

type HoldButtonProps = {
  string: BassString;
  fret: number;
  heldFret: number | null;
  required: boolean;
  nextFret: number | null;
  onHold: BassGameHUDProps["onHold"];
  onRelease: BassGameHUDProps["onRelease"];
};

/** Each left contact owns its capture; a right-hand tap cannot release it. */
function HoldButton({ string, fret, heldFret, required, nextFret, onHold, onRelease }: HoldButtonProps) {
  const pointers = useRef(new Set<number>());
  const keyboard = useRef(false);
  const callbacks = useRef({ onHold, onRelease });
  callbacks.current = { onHold, onRelease };
  const hasContact = () => pointers.current.size > 0 || keyboard.current;
  const releaseAll = () => {
    const wasHeld = hasContact();
    pointers.current.clear();
    keyboard.current = false;
    if (wasHeld) callbacks.current.onRelease(string);
  };

  useEffect(() => {
    const releaseWhenHidden = () => { if (document.hidden) releaseAll(); };
    window.addEventListener("blur", releaseAll);
    document.addEventListener("visibilitychange", releaseWhenHidden);
    return () => {
      releaseAll();
      window.removeEventListener("blur", releaseAll);
      document.removeEventListener("visibilitychange", releaseWhenHidden);
    };
  }, [string]);

  const releasePointer = (event: PointerEvent<HTMLButtonElement>) => {
    if (!pointers.current.delete(event.pointerId)) return;
    if (!hasContact()) callbacks.current.onRelease(string);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const held = heldFret !== null;
  const displayedFret = heldFret ?? fret;
  // A held finger stays at its original fret even after the upcoming target
  // becomes current. The outline shows where the next fresh contact belongs.
  const previewFret = nextFret ?? (held && heldFret !== fret ? fret : null);
  const movedPreview = previewFret !== null && previewFret !== displayedFret;
  return (
    <div className="bass-hold-area">
      {movedPreview && (
        <span
          className={`bass-fret-preview ${previewFret < displayedFret ? "is-before" : ""}`}
          data-bass-fret-position={fretPosition(previewFret)}
          data-bass-next-fret={previewFret}
          aria-hidden="true"
        >
          <span>{previewFret}<small>F</small></span>
        </span>
      )}
    <button
      type="button"
      className={`bass-hold ${held ? "is-held" : ""} ${required ? "is-required" : ""}`}
      data-bass-hold={string}
      data-fret={fret}
      data-held-fret={heldFret ?? -1}
      data-bass-fret-position={fretPosition(displayedFret)}
      aria-label={`左手 ${BASS_STRINGS[string].name}弦 ${displayedFret}フレットを押さえる`}
      aria-pressed={held}
      aria-keyshortcuts={HOLD_KEYS[string]}
      onPointerDown={(event) => {
        if (event.button !== 0 || pointers.current.has(event.pointerId)) return;
        event.preventDefault();
        const alreadyHeld = hasContact();
        pointers.current.add(event.pointerId);
        event.currentTarget.setPointerCapture(event.pointerId);
        if (!alreadyHeld) callbacks.current.onHold(string, fret);
      }}
      onPointerUp={releasePointer}
      onPointerCancel={releasePointer}
      onLostPointerCapture={releasePointer}
      onKeyDown={(event) => {
        if (!activationKey(event)) return;
        event.preventDefault();
        event.stopPropagation();
        if (event.repeat || keyboard.current) return;
        const alreadyHeld = hasContact();
        keyboard.current = true;
        if (!alreadyHeld) callbacks.current.onHold(string, fret);
      }}
      onKeyUp={(event) => {
        if (!activationKey(event)) return;
        event.preventDefault();
        event.stopPropagation();
        keyboard.current = false;
        if (!hasContact()) callbacks.current.onRelease(string);
      }}
      onBlur={releaseAll}
      onClick={(event) => event.preventDefault()}
    >
      <span className="bass-string-name">{BASS_STRINGS[string].name}</span>
      <span className="bass-fret">{displayedFret}<small>F</small></span>
      <kbd>{HOLD_KEYS[string]}</kbd>
      {required && <span className="bass-hold-indicator" aria-hidden="true" />}
      {nextFret !== null && !required && !movedPreview && <span className="bass-next-tag">次</span>}
    </button>
    </div>
  );
}

function PickButton({ string, enabled, onPluck }: { string: BassString; enabled: boolean; onPluck: BassGameHUDProps["onPluck"] }) {
  const keyboard = useRef(false);
  const pointer = useRef<number | null>(null);
  useEffect(() => {
    const clearContacts = () => {
      keyboard.current = false;
      pointer.current = null;
    };
    const clearWhenHidden = () => { if (document.hidden) clearContacts(); };
    window.addEventListener("blur", clearContacts);
    document.addEventListener("visibilitychange", clearWhenHidden);
    return () => {
      window.removeEventListener("blur", clearContacts);
      document.removeEventListener("visibilitychange", clearWhenHidden);
    };
  }, []);
  const releasePointer = (event: PointerEvent<HTMLButtonElement>) => {
    if (pointer.current !== event.pointerId) return;
    pointer.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  return (
    <button
      type="button"
      className="bass-pick"
      data-bass-pick={string}
      disabled={!enabled}
      aria-label={`右手 ${BASS_STRINGS[string].name}弦を弾く`}
      aria-keyshortcuts={PICK_KEYS[string]}
      onPointerDown={(event) => {
        if (event.button !== 0 || pointer.current !== null) return;
        event.preventDefault();
        pointer.current = event.pointerId;
        event.currentTarget.setPointerCapture(event.pointerId);
        onPluck(string);
      }}
      onPointerUp={releasePointer}
      onPointerCancel={releasePointer}
      onLostPointerCapture={releasePointer}
      onKeyDown={(event) => {
        if (!activationKey(event)) return;
        event.preventDefault();
        event.stopPropagation();
        if (event.repeat || keyboard.current) return;
        keyboard.current = true;
        onPluck(string);
      }}
      onKeyUp={(event) => {
        if (!activationKey(event)) return;
        event.preventDefault();
        event.stopPropagation();
        keyboard.current = false;
      }}
      onBlur={() => { keyboard.current = false; }}
      onClick={(event) => {
        // The contact already plucked on down; its click must not play twice.
        event.preventDefault();
      }}
    >
      <span className="bass-pick-ring" aria-hidden="true" />
      <span className="bass-string-name">{BASS_STRINGS[string].name}</span>
      <kbd>{PICK_KEYS[string]}</kbd>
    </button>
  );
}

export function BassGameHUD({ snapshot, onStart, onHold, onRelease, onPluck, onPutDown, paused, onLayout }: BassGameHUDProps) {
  const { phase } = snapshot;
  const hud = useRef<HTMLElement>(null);
  const layoutCallback = useRef(onLayout);
  layoutCallback.current = onLayout;
  const hasHUD = !paused && phase !== "idle" && phase !== "approaching" && phase !== "pickup";
  useEffect(() => {
    const element = hud.current;
    if (!hasHUD || !element) {
      layoutCallback.current?.(0);
      return;
    }
    const reportLayout = () => {
      layoutCallback.current?.(Math.max(0, Math.ceil(window.innerHeight - element.getBoundingClientRect().top)));
    };
    const observer = new ResizeObserver(reportLayout);
    observer.observe(element);
    window.addEventListener("resize", reportLayout);
    window.visualViewport?.addEventListener("resize", reportLayout);
    reportLayout();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", reportLayout);
      window.visualViewport?.removeEventListener("resize", reportLayout);
      layoutCallback.current?.(0);
    };
  }, [hasHUD]);
  if (paused || phase === "idle") return null;
  if (phase === "approaching" || phase === "pickup") {
    const progress = phase === "pickup" ? 1 : snapshot.proximityProgress;
    return (
      <div className="bass-approach" data-bass-phase={phase}>
        <div className="bass-approach-ring" role="progressbar" aria-label={phase === "pickup" ? "ベースを手に取る" : "近くで5秒待つとベースを持ちます"} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
          <svg viewBox="0 0 48 48" aria-hidden="true">
            <circle className="bass-ring-track" cx="24" cy="24" r="20" />
            <circle className="bass-ring-progress" cx="24" cy="24" r="20" pathLength="100" strokeDasharray="100" strokeDashoffset={100 - Math.min(1, Math.max(0, progress)) * 100} />
          </svg>
          <span className="bass-approach-icon"><Note /></span>
        </div>
        <span>{phase === "pickup" ? "ベースを手に取る" : "そばで待つと演奏"}</span>
      </div>
    );
  }

  const playing = phase === "playing";
  const performing = playing || phase === "countdown";
  const flowers = Math.round((snapshot.hits / Math.max(1, snapshot.notes.length)) * 100);
  const progress = Math.min(1, Math.max(0, snapshot.elapsed / Math.max(1, snapshot.duration)));
  const feedback = snapshot.feedback && snapshot.feedbackAge < 0.6 ? { perfect: "PERFECT", good: "GOOD", miss: "MISS" }[snapshot.feedback] : "";
  const current = snapshot.currentPhrase;
  const next = snapshot.nextPhrase;
  const visualTime = phase === "countdown" ? -snapshot.countdownRemaining : snapshot.elapsed;

  return (
    <section ref={hud} className={`bass-hud bass-phase-${phase}`} data-bass-phase={phase} aria-label="ベース演奏 EASY" onPointerDown={(event) => event.stopPropagation()} onPointerMove={(event) => event.stopPropagation()} onPointerUp={(event) => event.stopPropagation()} onContextMenu={(event) => event.preventDefault()}>
      <div className="bass-hud-heading">
        <div className="bass-hud-title">
          <span className="bass-difficulty">EASY</span>
          {performing ? (
            <div className="bass-phrase-guide" aria-label="押弦ガイド">
              {current && <span className="bass-phrase-now"><small>今</small> {BASS_STRINGS[current.string].name} <b>{current.fret}F</b></span>}
              {next && <span className="bass-phrase-next"><span aria-hidden="true">→</span> <small>次</small> {BASS_STRINGS[next.string].name} <b>{next.fret}F</b></span>}
            </div>
          ) : <span className="bass-ready-copy">左で押さえて、右で弾く</span>}
        </div>
        <button type="button" className="bass-put-down" onClick={onPutDown} aria-label="ベースを置く">置く <kbd>Esc</kbd></button>
      </div>
      {phase === "ready" ? (
        <div className="bass-ready-actions">
          <p className="bass-key-hint">同じ段の左を押し続けて<br />右の輪に音符が来たらタップ</p>
          <button type="button" className="bass-start" onClick={onStart}>演奏する <span aria-hidden="true">→</span></button>
        </div>
      ) : phase === "result" ? (
        <div className="bass-result">
          <div className="bass-result-numbers" role="status" aria-live="polite" aria-atomic="true">
            <div className="bass-result-score"><span>SCORE</span><strong>{snapshot.score.toLocaleString()}</strong></div>
            <dl><div><dt>精度</dt><dd>{Math.round(snapshot.accuracy)}<small>%</small></dd></div><div><dt>最高コンボ</dt><dd>{snapshot.maxCombo}</dd></div></dl>
          </div>
          <button type="button" className="bass-start" onClick={onStart}>もう一度 <span aria-hidden="true">↻</span></button>
        </div>
      ) : (
        <>
          <div className="bass-string-board">
            {BASS_STRINGS.map((_, index) => {
              const string = index as BassString;
              const guide = snapshot.leftGuides[string];
              const held = guide.heldFret !== null;
              const recentHit = snapshot.notes.some((note) => note.string === string && (note.state === "perfect" || note.state === "good") && snapshot.elapsed - note.time > -0.2 && snapshot.elapsed - note.time < 0.2);
              return (
                <div className={`bass-string-row ${held ? "is-held" : ""} ${recentHit ? "is-resonating" : ""}`} key={string} data-bass-string={string}>
                  <div className="bass-string-track" aria-hidden="true">
                    <div className="bass-string-wire" />
                    {snapshot.notes.map((note) => {
                      const offset = note.time - visualTime;
                      if (note.string !== string || offset > LOOK_AHEAD || offset < -0.15 || note.state === "perfect" || note.state === "good") return null;
                      return <span key={note.id} className={`bass-note ${note.state === "miss" ? "is-missed" : ""}`} style={{ left: `${100 - offset / LOOK_AHEAD * 100}%` }} />;
                    })}
                  </div>
                  <HoldButton string={string} fret={guide.fret} heldFret={guide.heldFret} required={guide.required} nextFret={guide.nextFret} onHold={onHold} onRelease={onRelease} />
                  <span className="bass-row-space" aria-hidden="true" />
                  <PickButton string={string} enabled={playing} onPluck={onPluck} />
                </div>
              );
            })}
          </div>
          <div className="bass-playback-progress" aria-hidden="true"><span style={{ transform: `scaleX(${progress})` }} /></div>
          <div className="bass-performance">
            <span className="bass-hand-hint">押し続ける <span aria-hidden="true">→</span> 弾く</span>
            {phase === "countdown" ? <span className="bass-countdown" aria-label={`演奏開始まで ${snapshot.countdown}`}>{snapshot.countdown}</span> : <span className={`bass-feedback bass-feedback-${snapshot.feedback ?? "none"}`} aria-hidden="true">{feedback}</span>}
            <span className="bass-combo"><strong>{snapshot.combo}</strong> COMBO</span>
            <span className="bass-flower-progress" aria-label={`開花率 ${flowers}%`}><Flower />{flowers}<small>%</small></span>
          </div>
        </>
      )}
    </section>
  );
}
