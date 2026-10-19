import { useEffect, useRef, type KeyboardEvent, type PointerEvent } from "react";
import {
  BASS_PROXIMITY_SECONDS,
  BASS_SONGS,
  BASS_STRINGS,
  type BassDifficulty,
  type BassGameSnapshot,
  type BassString,
  type BassTechnique,
} from "./bassGame";
import { createBassGesture } from "./bassGesture";
import type { BassAudioStatus } from "./bassAudio";
import { GARDEN_TRACK } from "./gardenTrack";
import "./bassGame.css";

type BassGameHUDProps = {
  snapshot: BassGameSnapshot;
  onStart: () => void;
  onDifficulty: (difficulty: BassDifficulty) => void;
  onPluck: (string: BassString, technique?: BassTechnique) => void;
  onPutDown: () => void;
  paused: boolean;
  audioStatus: BassAudioStatus;
  onLayout?: (occupiedBottomHeight: number) => void;
};

const DIFFICULTIES: readonly BassDifficulty[] = ["easy", "normal", "hard"];
const DIFFICULTY_HINTS = { easy: "タップ", normal: "スラップ", hard: "テクニカル" };
const PICK_KEYS = ["7", "8", "9", "0"];
const activationKey = (event: KeyboardEvent) => event.code === "Space" || event.code === "Enter";

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

function PickButton({ string, enabled, instantPick, onPluck }: { string: BassString; enabled: boolean; instantPick: boolean; onPluck: BassGameHUDProps["onPluck"] }) {
  const keyboard = useRef(false);
  const pointer = useRef<number | null>(null);
  const gesture = useRef(createBassGesture());
  useEffect(() => {
    const clearContacts = () => {
      keyboard.current = false;
      pointer.current = null;
      gesture.current.reset();
    };
    const clearWhenHidden = () => { if (document.hidden) clearContacts(); };
    window.addEventListener("blur", clearContacts);
    document.addEventListener("visibilitychange", clearWhenHidden);
    return () => {
      clearContacts();
      window.removeEventListener("blur", clearContacts);
      document.removeEventListener("visibilitychange", clearWhenHidden);
    };
  }, []);
  const point = (event: PointerEvent<HTMLButtonElement>) => ({
    pointerId: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    time: event.timeStamp,
  });
  const clearPointer = (event: PointerEvent<HTMLButtonElement>) => {
    if (pointer.current !== event.pointerId) return;
    pointer.current = null;
    gesture.current.cancel(event.pointerId);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const releasePointer = (event: PointerEvent<HTMLButtonElement>) => {
    if (pointer.current !== event.pointerId) return;
    if (!instantPick && enabled) {
      const input = gesture.current.end(point(event));
      if (input) onPluck(input.string, input.technique);
    }
    clearPointer(event);
  };
  return (
    <button
      type="button"
      className="bass-pick"
      data-bass-pick={string}
      disabled={!enabled}
      aria-label={`右手 ${BASS_STRINGS[string].name}弦を弾く`}
      aria-description={instantPick ? "タップでピッキング" : "タップでピッキング。上に素早く払うとスラップ"}
      aria-keyshortcuts={instantPick ? PICK_KEYS[string] : `${PICK_KEYS[string]} Shift+${PICK_KEYS[string]}`}
      onPointerDown={(event) => {
        if (event.button !== 0 || pointer.current !== null) return;
        event.preventDefault();
        if (!instantPick && !gesture.current.begin({ ...point(event), string })) return;
        pointer.current = event.pointerId;
        event.currentTarget.setPointerCapture(event.pointerId);
        if (instantPick) onPluck(string, "pick");
      }}
      onPointerMove={(event) => {
        if (instantPick || !enabled || pointer.current !== event.pointerId) return;
        const input = gesture.current.move(point(event));
        if (input) onPluck(input.string, input.technique);
      }}
      onPointerUp={releasePointer}
      onPointerCancel={clearPointer}
      onLostPointerCapture={clearPointer}
      onKeyDown={(event) => {
        if (!activationKey(event)) return;
        event.preventDefault();
        event.stopPropagation();
        if (event.repeat || keyboard.current) return;
        keyboard.current = true;
        onPluck(string, event.shiftKey ? "slap" : "pick");
      }}
      onKeyUp={(event) => {
        if (!activationKey(event)) return;
        event.preventDefault();
        event.stopPropagation();
        keyboard.current = false;
      }}
      onBlur={() => { keyboard.current = false; }}
      onClick={(event) => {
        // The contact or key already emitted its one input, never a second click.
        event.preventDefault();
      }}
    >
      <span className="bass-pick-ring" aria-hidden="true" />
      <span className="bass-string-name">{BASS_STRINGS[string].name}</span>
      <kbd>{PICK_KEYS[string]}</kbd>
      {!instantPick && <span className="bass-pick-slap-hint" aria-hidden="true">↑</span>}
    </button>
  );
}

export function BassGameHUD({ snapshot, onStart, onDifficulty, onPluck, onPutDown, paused, onLayout, audioStatus }: BassGameHUDProps) {
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
        <div className="bass-approach-ring" role="progressbar" aria-label={phase === "pickup" ? "ベースを手に取る" : `近くで${BASS_PROXIMITY_SECONDS}秒待つとベースを持ちます`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
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
  const easy = snapshot.difficulty === "easy";
  const audioBusy = audioStatus === "loading";
  const audioUnavailable = audioStatus === "unavailable";
  const startLabel = audioBusy ? "曲を準備中…" : audioUnavailable ? "音声を再試行" : audioStatus === "error" ? "曲の読み込みを再試行" : phase === "result" ? "もう一度" : "演奏する";
  const song = BASS_SONGS[snapshot.difficulty];
  const flowers = Math.round((snapshot.hits / Math.max(1, snapshot.notes.length)) * 100);
  const progress = Math.min(1, Math.max(0, snapshot.elapsed / Math.max(1, snapshot.duration)));
  const feedback = snapshot.feedback && snapshot.feedbackAge < 0.6 ? { perfect: "PERFECT", good: "GOOD", miss: "MISS" }[snapshot.feedback] : "";
  const visualTime = phase === "countdown" ? -snapshot.countdownRemaining : snapshot.elapsed;

  return (
    <section ref={hud} className={`bass-hud bass-phase-${phase}`} data-bass-phase={phase} data-selected-difficulty={snapshot.difficulty} aria-label={`ベース演奏 ${song.label}`} onPointerDown={(event) => event.stopPropagation()} onPointerMove={(event) => event.stopPropagation()} onPointerUp={(event) => event.stopPropagation()} onContextMenu={(event) => event.preventDefault()}>
      <div className="bass-hud-heading">
        <div className="bass-hud-title">
          <span className="bass-difficulty">{song.label}</span>
          <span className="bass-ready-copy">{GARDEN_TRACK.title} · 0:56</span>
        </div>
        <button type="button" className="bass-put-down" onClick={onPutDown} aria-label="ベースを置く">置く <kbd>Esc</kbd></button>
      </div>
      {(phase === "ready" || phase === "result") && (
        <div className="bass-difficulty-selector" role="group" aria-label="難易度">
          {DIFFICULTIES.map((difficulty) => (
            <button
              key={difficulty}
              type="button"
              data-bass-difficulty={difficulty}
              aria-label={BASS_SONGS[difficulty].label}
              aria-pressed={snapshot.difficulty === difficulty}
              onClick={() => onDifficulty(difficulty)}
            >
              <span>{BASS_SONGS[difficulty].label}</span>
              <small>{DIFFICULTY_HINTS[difficulty]}</small>
            </button>
          ))}
        </div>
      )}
      {phase === "ready" ? (
        <div className="bass-ready-actions">
          <p className="bass-key-hint">
            {easy ? <>音符が輪に来たらタップ</> : <>● タップ / ↑ 上に払う</>}
            <span className="bass-keyboard-technique">7 / 8 / 9 / 0{!easy && <> · <kbd>Shift</kbd>＋同じキーで ↑</>}</span>
          </p>
          <button type="button" className="bass-start" onClick={onStart} disabled={audioBusy} aria-busy={audioBusy}>{startLabel} <span aria-hidden="true">→</span></button>
        </div>
      ) : phase === "result" ? (
        <div className="bass-result">
          <div className="bass-result-numbers" role="status" aria-live="polite" aria-atomic="true">
            <div className="bass-result-score"><span>SCORE</span><strong>{snapshot.score.toLocaleString()}</strong></div>
            <dl><div><dt>精度</dt><dd>{Math.round(snapshot.accuracy)}<small>%</small></dd></div><div><dt>最高コンボ</dt><dd>{snapshot.maxCombo}</dd></div></dl>
          </div>
          <button type="button" className="bass-start" onClick={onStart} disabled={audioBusy} aria-busy={audioBusy}>{startLabel} <span aria-hidden="true">↻</span></button>
        </div>
      ) : (
        <>
          {(audioUnavailable || audioBusy) && <button type="button" className="bass-audio-resume" onClick={onStart} disabled={audioBusy} aria-busy={audioBusy}>{audioBusy ? "音声を準備中…" : "音声を再開"}</button>}
          <div className="bass-string-board">
            {BASS_STRINGS.map((_, index) => {
              const string = index as BassString;
              const recentHit = snapshot.notes.some((note) => note.string === string && (note.state === "perfect" || note.state === "good") && snapshot.elapsed - note.time > -0.2 && snapshot.elapsed - note.time < 0.2);
              return (
                <div className={`bass-string-row ${recentHit ? "is-resonating" : ""}`} key={string} data-bass-string={string}>
                  <div className="bass-string-track" aria-hidden="true">
                    <div className="bass-string-wire" />
                    {snapshot.notes.map((note) => {
                      const offset = note.time - visualTime;
                      const travel = Math.max(0.05, note.travelSeconds);
                      if (note.string !== string || offset > travel || offset < -0.15 || note.state === "perfect" || note.state === "good") return null;
                      return (
                        <span
                          key={note.id}
                          className={`bass-note ${note.technique === "slap" ? "bass-note-slap" : ""} ${note.state === "miss" ? "is-missed" : ""}`}
                          data-bass-note={note.id}
                          data-technique={note.technique}
                          data-travel-seconds={note.travelSeconds}
                          style={{ left: `${100 - offset / travel * 100}%` }}
                        >
                          {note.technique === "slap" && <svg viewBox="0 0 18 22" fill="none"><path d="M9 19V3M3.5 8.5 9 3l5.5 5.5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                        </span>
                      );
                    })}
                  </div>
                  <span className="bass-row-space" aria-hidden="true" />
                  <PickButton string={string} enabled={playing} instantPick={easy} onPluck={onPluck} />
                </div>
              );
            })}
          </div>
          <div className="bass-playback-progress" aria-hidden="true"><span style={{ transform: `scaleX(${progress})` }} /></div>
          <div className="bass-performance">
            <span className="bass-hand-hint">{easy ? "音符が輪に来たらタップ" : "● タップ / ↑ 上に払う"}</span>
            {phase === "countdown" ? <span className="bass-countdown" aria-label={`演奏開始まで ${snapshot.countdown}`}>{snapshot.countdown}</span> : <span className={`bass-feedback bass-feedback-${snapshot.feedback ?? "none"}`} aria-hidden="true">{feedback}</span>}
            <span className="bass-combo"><strong>{snapshot.combo}</strong> COMBO</span>
            <span className="bass-flower-progress" aria-label={`開花率 ${flowers}%`}><Flower />{flowers}<small>%</small></span>
          </div>
        </>
      )}
    </section>
  );
}
