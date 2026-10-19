import type { BassGameSnapshot } from "./bassGame";
import "./bassGame.css";

type BassGameHUDProps = {
  snapshot: BassGameSnapshot;
  onStart: () => void;
  onPluck: () => void;
  onPutDown: () => void;
  paused: boolean;
};

const HIT_LINE = 18;
const LOOK_AHEAD = 3;

function Flower() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 7.1c-5.5-7.4-9.3.1-4.1 3.7-9 2.4-3.3 8.7 2.2 5.1 0 9.4 7.7 6 6.1-.7 8.9 2.7 7.9-5.6.8-6 5.2-7.7-2.9-9.6-5-2.1Z"
        fill="currentColor"
        opacity=".25"
      />
      <circle cx="12" cy="12" r="3.1" fill="currentColor" />
    </svg>
  );
}

function Note() {
  return (
    <svg viewBox="0 0 24 28" fill="none" aria-hidden="true">
      <path
        d="M15 21V5c1 4 6 3 6 8"
        stroke="currentColor"
        strokeWidth="2.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <ellipse
        cx="9.5"
        cy="22"
        rx="5.8"
        ry="4.2"
        transform="rotate(-20 9.5 22)"
        fill="currentColor"
      />
    </svg>
  );
}

export function BassGameHUD({
  snapshot,
  onStart,
  onPluck,
  onPutDown,
  paused,
}: BassGameHUDProps) {
  const { phase } = snapshot;
  if (paused || phase === "idle") return null;

  if (phase === "approaching" || phase === "pickup") {
    const progress = phase === "pickup" ? 1 : snapshot.proximityProgress;
    return (
      <div
        className={`bass-approach ${phase === "pickup" ? "is-picking-up" : ""}`}
        data-bass-phase={phase}
      >
        <div
          className="bass-approach-ring"
          role="progressbar"
          aria-label={
            phase === "pickup"
              ? "ベースを手に取る"
              : "近くで5秒待つとベースを持ちます"
          }
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress * 100)}
        >
          <svg viewBox="0 0 48 48" aria-hidden="true">
            <circle className="bass-ring-track" cx="24" cy="24" r="20" />
            <circle
              className="bass-ring-progress"
              cx="24"
              cy="24"
              r="20"
              pathLength="100"
              strokeDasharray="100"
              strokeDashoffset={100 - Math.min(1, Math.max(0, progress)) * 100}
            />
          </svg>
          <span className="bass-approach-icon"><Note /></span>
        </div>
        <span>{phase === "pickup" ? "ベースを手に取る" : "そばで待つと演奏"}</span>
      </div>
    );
  }

  const playing = phase === "playing";
  const flowers = Math.round(
    (snapshot.hits / Math.max(1, snapshot.notes.length)) * 100,
  );
  const feedback =
    snapshot.feedback && snapshot.feedbackAge < 0.7
      ? { perfect: "PERFECT", good: "GOOD", miss: "MISS" }[snapshot.feedback]
      : "";
  const progress = Math.min(
    1,
    Math.max(0, snapshot.elapsed / Math.max(1, snapshot.duration)),
  );

  return (
    <section
      className={`bass-hud bass-phase-${phase}`}
      data-bass-phase={phase}
      aria-label="ベース演奏 EASY"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="bass-hud-heading">
        <div className="bass-hud-title">
          <span className="bass-difficulty">EASY</span>
          {phase === "ready" ? (
            <span className="bass-ready-copy">音符が線に重なったら弾く</span>
          ) : (
            <span className="bass-flower-progress" aria-label={`開花率 ${flowers}%`}>
              <Flower /><span>{flowers}<small>%</small></span>
            </span>
          )}
        </div>
        <button
          type="button"
          className="bass-put-down"
          onClick={onPutDown}
          aria-label="ベースを置く"
        >
          置く <kbd>Esc</kbd>
        </button>
      </div>

      {phase === "ready" ? (
        <div className="bass-ready-actions">
          <span className="bass-key-hint"><kbd>Space</kbd> / タップ</span>
          <button type="button" className="bass-start" onClick={onStart}>
            演奏する <span aria-hidden="true">→</span>
          </button>
        </div>
      ) : phase === "result" ? (
        <div className="bass-result">
          <div className="bass-result-numbers" role="status" aria-live="polite" aria-atomic="true">
            <div className="bass-result-score">
              <span>SCORE</span>
              <strong>{snapshot.score.toLocaleString()}</strong>
            </div>
            <dl>
              <div><dt>精度</dt><dd>{Math.round(snapshot.accuracy)}<small>%</small></dd></div>
              <div><dt>最高コンボ</dt><dd>{snapshot.maxCombo}</dd></div>
            </dl>
          </div>
          <button type="button" className="bass-start" onClick={onStart}>
            もう一度 <span aria-hidden="true">↻</span>
          </button>
        </div>
      ) : (
        <>
          <div className="bass-lane" aria-hidden="true">
            <div className="bass-staff" />
            <div className="bass-hit-line"><span /></div>
            <div className="bass-notes">
              {snapshot.notes.map((note) => {
                const offset = note.time - snapshot.elapsed;
                if (
                  offset > LOOK_AHEAD + 0.3 ||
                  offset < -0.65 ||
                  note.state === "perfect" ||
                  note.state === "good"
                ) return null;
                return (
                  <span
                    key={note.id}
                    className={`bass-note ${note.state === "miss" ? "is-missed" : ""}`}
                    style={{ left: `${HIT_LINE + (offset / LOOK_AHEAD) * (100 - HIT_LINE)}%` }}
                  >
                    <Note />
                  </span>
                );
              })}
            </div>
            {phase === "countdown" && (
              <div className="bass-countdown">{snapshot.countdown || "♪"}</div>
            )}
            <span className={`bass-feedback bass-feedback-${snapshot.feedback ?? "none"}`}>
              {feedback}
            </span>
          </div>
          <div className="bass-playback-progress" aria-hidden="true">
            <span style={{ transform: `scaleX(${progress})` }} />
          </div>
          <div className="bass-play-actions">
            <div className="bass-performance">
              <span className="bass-combo"><strong>{snapshot.combo}</strong> COMBO</span>
              <span className="bass-current-score">{snapshot.score.toLocaleString()}</span>
            </div>
            <button
              type="button"
              className="bass-pluck"
              aria-label="ベースを弾く"
              disabled={!playing}
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                event.preventDefault();
                onPluck();
              }}
              onClick={(event) => {
                if (event.detail === 0) onPluck();
              }}
            >
              <Note /><span>弾く</span><kbd>Space</kbd>
            </button>
          </div>
        </>
      )}
    </section>
  );
}
