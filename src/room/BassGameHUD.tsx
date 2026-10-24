import { useEffect, useRef, useState, type PointerEvent } from "react";
import { BASS_PROXIMITY_SECONDS, BASS_SONGS, type BassDifficulty, type BassGameSnapshot } from "./bassGame";
import { BASS_FRETBOARD, bassPitch } from "./bassFretboard";
import type { BassPointerInput } from "./bassInput";
import { BASS_VISUAL_CONFIG, chargeProgress, nextCharge, timelineX } from "./bassVisuals";
import type { BassAudioStatus } from "./bassAudio";
import { GARDEN_TRACK } from "./gardenTrack";
import "./bassGame.css";

type Props = {
  snapshot: BassGameSnapshot;
  onStart: () => void;
  onDifficulty: (difficulty: BassDifficulty) => void;
  onInput: (input: BassPointerInput) => void;
  onPutDown: () => void;
  onPause: () => void;
  paused: boolean;
  audioStatus: BassAudioStatus;
  onLayout?: (occupiedBottomHeight: number) => void;
};
const FEEDBACK = { perfect: "Excellent", great: "Great", good: "Good", bad: "Bad", miss: "Miss" };

function Timeline({ snapshot, time }: { snapshot: BassGameSnapshot; time: number }) {
  const host = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(350);
  useEffect(() => {
    if (!host.current) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  return <div ref={host} className="bass-timeline" aria-label="演奏タイムライン" data-bass-timeline>
    <svg viewBox={`0 0 ${width} 76`} role="img" aria-label="右から左へ流れる音名。縦線で演奏">
      <line className="bass-time-axis" x1="0" x2={width} y1="38" y2="38" />
      <line className="bass-judge-line" x1={BASS_VISUAL_CONFIG.judgeX} x2={BASS_VISUAL_CONFIG.judgeX} y1="8" y2="66" />
      {snapshot.notes.map((note, index) => {
        const x = timelineX(note.time, time);
        const endX = timelineX(note.endTime ?? note.time, time);
        if (note.time - time > BASS_VISUAL_CONFIG.futureSeconds || endX < -24 || x > width + 24) return null;
        const pitch = bassPitch(note.midi);
        const dense = snapshot.notes.some(other => other.id !== note.id && Math.abs(other.time - note.time) < 0.2);
        const y = dense ? index % 2 ? 49 : 25 : 38;
        const radius = dense ? 12 : 17;
        const resolved = note.state !== "pending" && note.state !== "holding";
        return <g key={note.id} data-bass-note={note.id} data-kind={note.kind} data-midi={note.midi}
          className={`bass-time-note bass-tone-${pitch.color} ${resolved ? "is-resolved" : ""}`}>
          {note.kind === "hold" && <g className="bass-hold-tail"><rect x={x} y={y - 5} width={Math.max(0, endX - x)} height="10" rx="5" /><line x1={endX} x2={endX} y1={y - 12} y2={y + 12} /></g>}
          <circle cx={x} cy={y} r={radius} />
          <text x={x} y={y + 4} textAnchor="middle" fontSize={dense ? 10 : 13}>{pitch.name}<tspan fontSize="8" dy="2">{pitch.octave}</tspan></text>
          {note.kind === "slap" && <text className="bass-slap-arrow" x={x} y={y - radius - 2} textAnchor="middle">↑</text>}
        </g>;
      })}
    </svg>
  </div>;
}

export function BassGameHUD({ snapshot, paused, onStart, onDifficulty, onInput, onPause, onPutDown, onLayout, audioStatus }: Props) {
  const { phase } = snapshot;
  const deck = useRef<HTMLDivElement>(null);
  const contacts = useRef(new Map<number, BassPointerInput>());
  const callback = useRef(onInput);
  callback.current = onInput;
  const layoutCallback = useRef(onLayout);
  layoutCallback.current = onLayout;
  const enabled = !paused && phase === "playing";
  const visible = !paused && ["ready", "countdown", "playing", "result"].includes(phase);
  useEffect(() => {
    const clear = () => {
      for (const contact of contacts.current.values()) callback.current({ ...contact, action: "cancel", time: performance.now() });
      contacts.current.clear();
    };
    if (!enabled) clear();
    window.addEventListener("blur", clear);
    document.addEventListener("visibilitychange", clear);
    return () => { clear(); window.removeEventListener("blur", clear); document.removeEventListener("visibilitychange", clear); };
  }, [enabled]);
  useEffect(() => {
    const element = deck.current;
    if (!visible || !element) { layoutCallback.current?.(0); return; }
    const report = () => layoutCallback.current?.(Math.ceil(window.innerHeight - element.getBoundingClientRect().top));
    const observer = new ResizeObserver(report);
    observer.observe(element);
    report();
    return () => { observer.disconnect(); layoutCallback.current?.(0); };
  }, [visible]);
  if (paused || phase === "idle") return null;
  if (phase === "approaching" || phase === "pickup") return <div className="bass-approach" data-bass-phase={phase}>
    <div className="bass-approach-ring" role="progressbar" aria-label={`近くで${BASS_PROXIMITY_SECONDS}秒待つと演奏`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(snapshot.proximityProgress * 100)}>
      <svg viewBox="0 0 48 48" aria-hidden="true"><circle className="bass-ring-track" cx="24" cy="24" r="20" /><circle className="bass-ring-progress" cx="24" cy="24" r="20" pathLength="100" strokeDasharray="100" strokeDashoffset={100 - snapshot.proximityProgress * 100} /></svg><span>♪</span>
    </div><span>{phase === "pickup" ? "ベースを手に取る" : "そばで待つと演奏"}</span>
  </div>;
  const time = phase === "countdown" ? -snapshot.countdownRemaining : snapshot.elapsed;
  const busy = audioStatus === "loading";
  const feedback = snapshot.feedback && snapshot.feedbackAge < 0.6 ? FEEDBACK[snapshot.feedback] : "";
  const progress = Math.min(1, snapshot.elapsed / snapshot.duration);
  const send = (event: PointerEvent<HTMLElement>, action: BassPointerInput["action"]) => {
    const contact = contacts.current.get(event.pointerId);
    if (!contact) return;
    const input = { ...contact, action, x: event.clientX, y: event.clientY, time: event.timeStamp };
    onInput(input);
    if (action === "up" || action === "cancel") contacts.current.delete(event.pointerId);
  };
  return <section className={`bass-hud bass-phase-${phase}`} data-bass-phase={phase} data-selected-difficulty={snapshot.difficulty} aria-label="ベース演奏"
    onPointerDown={event => event.stopPropagation()} onPointerMove={event => event.stopPropagation()} onPointerUp={event => event.stopPropagation()} onContextMenu={event => event.preventDefault()}>
    <header className="bass-top-hud">
      <div className="bass-title"><strong>{GARDEN_TRACK.title}</strong><span>{BASS_SONGS[snapshot.difficulty].label}</span></div>
      <button className="bass-pause" type="button" onClick={onPause} aria-label="演奏をポーズ">Ⅱ</button>
      <div className="bass-live-score"><span>SCORE <strong>{snapshot.score.toLocaleString()}</strong></span><span>COMBO <strong>{snapshot.combo}</strong></span></div>
      <div className="bass-playback-progress" role="progressbar" aria-label="曲の進行" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}><span style={{ transform: `scaleX(${progress})` }} /></div>
    </header>
    <div className="bass-deck" ref={deck}>
      <div className="bass-status-line"><span className={`bass-feedback bass-feedback-${snapshot.feedback ?? "none"}`} role="status">{phase === "countdown" ? snapshot.countdown : feedback}</span><button type="button" onClick={onPutDown} aria-label="ベースを置く">置く</button></div>
      <Timeline snapshot={snapshot} time={time} />
      <div className="bass-fret-labels" aria-hidden="true">{[0, 1, 2, 3, 4, 5].map(fret => <span key={fret}>{fret}F</span>)}</div>
      <div className="bass-fretboard" aria-label="ベース指板 1弦から4弦、0から5フレット"
        onPointerMove={event => send(event, "move")} onPointerUp={event => send(event, "up")} onPointerCancel={event => send(event, "cancel")}
        onLostPointerCapture={event => send(event, "cancel")}>
        {BASS_FRETBOARD.map((cell, index) => {
          const note = nextCharge(snapshot.notes, cell.midi);
          const holding = note?.state === "holding";
          const charge = note ? chargeProgress(holding ? note.endTime! : note.time, time, holding ? note.endTime! - note.time : BASS_VISUAL_CONFIG.leadTime) : 0;
          const recentHit = snapshot.notes.some(hit => hit.midi === cell.midi && !["pending", "holding", "miss"].includes(hit.state) && time >= hit.time && time - hit.time < 0.12);
          const active = Boolean(note && (holding || note.time - time <= BASS_VISUAL_CONFIG.leadTime));
          return <button type="button" key={index} className={`bass-fret bass-tone-${cell.color} ${active ? "is-charging" : ""} ${holding ? "is-holding" : ""} ${recentHit ? "is-hit" : ""}`}
            data-bass-fret={`${cell.string}-${cell.fret}`} data-midi={cell.midi} data-charge-note={active ? note?.id : undefined} data-charge={active ? charge.toFixed(3) : "0"}
            disabled={!enabled} aria-label={`${cell.string + 1}弦 ${cell.fret}フレット ${cell.name}${cell.octave}`} style={{ boxShadow: active ? `0 0 ${charge * 10}px #f2ce8766` : undefined }}
            onPointerDown={event => {
              if (event.button !== 0 || !enabled) return;
              event.preventDefault();
              const input: BassPointerInput = { id: event.pointerId, action: "down", midi: cell.midi, string: cell.string, fret: cell.fret, x: event.clientX, y: event.clientY, time: event.timeStamp };
              contacts.current.set(event.pointerId, input);
              if (event.isTrusted) event.currentTarget.setPointerCapture(event.pointerId);
              onInput(input);
            }}
            onKeyDown={event => {
              if (!["Space", "Enter"].includes(event.code)) return;
              event.preventDefault(); event.stopPropagation();
              const id = -index - 1;
              if (event.repeat || contacts.current.has(id)) return;
              const input: BassPointerInput = { id, action: "down", midi: cell.midi, string: cell.string, fret: cell.fret, x: 0, y: 0, time: performance.now() };
              contacts.current.set(id, input); onInput(input);
              if (event.shiftKey) onInput({ ...input, action: "move", y: -30, time: input.time + 1 });
            }}
            onKeyUp={event => {
              if (!["Space", "Enter"].includes(event.code)) return;
              event.preventDefault(); event.stopPropagation();
              const input = contacts.current.get(-index - 1);
              if (input) onInput({ ...input, action: "up", time: performance.now() });
              contacts.current.delete(-index - 1);
            }} onClick={event => event.preventDefault()}>
            <span className="bass-fret-fill" aria-hidden="true" style={{ transform: `scaleY(${active ? charge : 0})` }} />
            <svg className="bass-fret-clock" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><rect x="4" y="4" width="92" height="92" rx="16" pathLength="100" strokeDasharray={`${active ? charge * 100 : 0} 100`} /></svg>
            <span className="bass-fret-name">{cell.name}<small>{cell.octave}</small></span>
            {active && <span className="bass-fret-technique" aria-hidden="true">{holding ? "HOLD" : note?.kind === "slap" ? "↑" : note?.kind === "hold" ? "―" : ""}</span>}
          </button>;
        })}
      </div>
      {(phase === "ready" || phase === "result") && <div className="bass-setup">
        {phase === "result" && <div className="bass-result" role="status">SCORE {snapshot.score.toLocaleString()} · 精度 {Math.round(snapshot.accuracy)}% · 最高コンボ {snapshot.maxCombo}</div>}
        <div className="bass-difficulty-selector" role="group" aria-label="難易度">{(["easy", "normal", "hard"] as const).map(value => <button key={value} data-bass-difficulty={value} aria-pressed={value === snapshot.difficulty} onClick={() => onDifficulty(value)}>{BASS_SONGS[value].label}</button>)}</div>
        <p>音名をタップ · 帯は長押し · ↑は上フリック</p>
        <button className="bass-start" onClick={onStart} disabled={busy}>{busy ? "曲を準備中…" : audioStatus === "error" ? "曲の読み込みを再試行" : audioStatus === "unavailable" ? "音声を再試行" : phase === "result" ? "もう一度" : "演奏する"}</button>
      </div>}
      {enabled && (audioStatus === "unavailable" || audioStatus === "error") && <button className="bass-audio-resume" onClick={onStart}>音声を再開</button>}
    </div>
  </section>;
}
