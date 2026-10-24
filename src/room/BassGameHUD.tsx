import { useEffect, useRef, useState, type CSSProperties, type PointerEvent, type KeyboardEvent } from "react";
import { BASS_PROXIMITY_SECONDS, BASS_SONGS, BASS_TRACKS, type BassSongId, type BassDifficulty, type BassGameSnapshot } from "./bassGame";
import { BASS_FRETBOARD, bassPitch } from "./bassFretboard";
import type { BassPointerInput } from "./bassInput";
import { BASS_VISUAL_CONFIG, chargeProgress, nextCharge, timelineX } from "./bassVisuals";
import type { BassAudioStatus } from "./bassAudio";
import "./bassGame.css";

type Props = {
  snapshot: BassGameSnapshot;
  onStart: () => void;
  onContinue: () => void;
  onSong: (id: BassSongId) => void;
  onOffset: (seconds: number) => void;
  onDifficulty: (difficulty: BassDifficulty) => void;
  onInput: (input: BassPointerInput) => void;
  onPutDown: () => void;
  onPause: () => void;
  paused: boolean;
  audioStatus: BassAudioStatus;
  onLayout?: (occupiedBottomHeight: number) => void;
};
const FEEDBACK = { perfect: "Excellent", great: "Great", good: "Good", bad: "Bad", miss: "Miss" };

function BassResultScreen({ snapshot, onContinue, onQuit }: { snapshot: BassGameSnapshot; onContinue: () => void; onQuit: () => void }) {
  const panel = useRef<HTMLDivElement>(null);
  const leaving = useRef(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { panel.current?.focus({ preventScroll: true }); }, []);
  const result = snapshot.result!;
  const leave = (action: () => void) => {
    if (leaving.current) return;
    leaving.current = true; setBusy(true); action();
  };
  const keys = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); leave(onQuit); }
    if (event.key !== "Tab") return;
    const buttons = panel.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)");
    if (!buttons?.length) return;
    const first = buttons[0], last = buttons[buttons.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel.current)) { event.preventDefault(); first.focus(); }
  };
  return <div className="bass-result-backdrop">
    <div className="bass-result" ref={panel} role="dialog" aria-modal="true" aria-labelledby="bass-result-title" tabIndex={-1} onKeyDown={keys}>
      <header><p className="bass-result-caption">RESULT</p><h2 id="bass-result-title">{snapshot.songTitle}</h2><p className="bass-result-difficulty">{snapshot.difficulty.toUpperCase()}</p></header>
      <div className="bass-result-rating"><div><span>総合評価</span><strong className="bass-result-rank">{result.rank}</strong></div><div><span>達成率</span><strong className="bass-result-achievement">{result.achievement.toFixed(2)}<small>%</small></strong></div></div>
      <dl className="bass-result-counts">
        {(["excellent", "great", "good", "bad", "miss"] as const).map(key => <div key={key} data-bass-result-count={key}><dt>{key === "excellent" ? "Excellent" : key[0].toUpperCase() + key.slice(1)}</dt><dd>{result.counts[key]}</dd></div>)}
        <div data-bass-result-count="max-combo"><dt>最大コンボ</dt><dd>{result.maxCombo}</dd></div>
      </dl>
      <p className="bass-result-score">SCORE <strong>{snapshot.score.toLocaleString()}</strong></p>
      <div className="bass-result-actions"><button type="button" disabled={busy} onClick={() => leave(onContinue)}>続ける</button><button type="button" disabled={busy} onClick={() => leave(onQuit)}>やめる</button></div>
    </div>
  </div>;
}

function Timeline({ snapshot, time }: { snapshot: BassGameSnapshot; time: number }) {
  const host = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(350);
  useEffect(() => {
    if (!host.current) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  const speed = snapshot.importSummary ? BASS_VISUAL_CONFIG.importedPixelsPerSecond : BASS_VISUAL_CONFIG.pixelsPerSecond;
  return <div ref={host} className="bass-timeline" aria-label="演奏タイムライン" data-bass-timeline>
    <svg viewBox={`0 0 ${width} 76`} role="img" aria-label="右から左へ流れる音名。縦線で演奏">
      <line className="bass-time-axis" x1="0" x2={width} y1="38" y2="38" />
      <line className="bass-judge-line" x1={BASS_VISUAL_CONFIG.judgeX} x2={BASS_VISUAL_CONFIG.judgeX} y1="8" y2="66" />
      {snapshot.notes.map((note, index) => {
        const x = timelineX(note.time, time, BASS_VISUAL_CONFIG.judgeX, speed);
        const endX = timelineX(note.endTime ?? note.time, time, BASS_VISUAL_CONFIG.judgeX, speed);
        if (note.time - time > BASS_VISUAL_CONFIG.futureSeconds || endX < -24 || x > width + 24) return null;
        const pitch = bassPitch(note.midi);
        const dense = (snapshot.notes[index - 1] && note.time - snapshot.notes[index - 1].time < 0.2) || (snapshot.notes[index + 1] && snapshot.notes[index + 1].time - note.time < 0.2);
        const y = dense ? snapshot.importSummary ? 16 + (index % 3) * 22 : index % 2 ? 49 : 25 : 38;
        const radius = dense ? snapshot.importSummary ? 10 : 12 : 17;
        const resolved = !["pending", "holding", "sliding"].includes(note.state);
        return <g key={note.id} data-bass-note={note.id} data-kind={note.kind} data-midi={note.midi}
          style={{ "--tone": pitch.color } as CSSProperties}
          className={`bass-time-note ${resolved ? "is-resolved" : ""}`}>
          {note.kind === "hold" && <g className="bass-hold-tail"><rect x={x} y={y - 5} width={Math.max(0, endX - x)} height="10" rx="5" /><line x1={endX} x2={endX} y1={y - 12} y2={y + 12} /></g>}
          {note.kind === "slide" && <g className="bass-slide-tail" data-bass-slide-tail>
            <defs><linearGradient id={`timeline-slide-${note.id}`}><stop stopColor={pitch.color} /><stop offset="1" stopColor={bassPitch(note.endMidi!).color} /></linearGradient></defs>
            <rect x={x} y={y - 5} width={Math.max(0, endX - x)} height="10" rx="5" fill={`url(#timeline-slide-${note.id})`} />
            <text className="bass-slide-direction" x={(x + endX) / 2} y={y - 9} textAnchor="middle">{note.endFret! > note.fret ? "SLIDE →" : "SLIDE ←"}</text>
            <circle cx={endX} cy={y} r={radius} style={{ fill: bassPitch(note.endMidi!).color }} />
            <text x={endX} y={y + 4} textAnchor="middle" fontSize={dense ? 10 : 13}>{bassPitch(note.endMidi!).name}<tspan fontSize="8" dy="2">{bassPitch(note.endMidi!).octave}</tspan></text>
            <line className="bass-slide-end-line" x1={endX} x2={endX} y1={y + radius + 1} y2={y + radius + 7} />
          </g>}
          {note.kind === "slap" ? <path className="bass-slap-outline" d={Array.from({ length: 20 }, (_, i) => { const a = i * Math.PI / 10; const r = radius * (i % 2 ? 0.86 : 1.08); return `${i ? "L" : "M"}${x + Math.sin(a) * r},${y + Math.cos(a) * r}`; }).join(" ") + "Z"} /> : <circle cx={x} cy={y} r={radius} />}
          <text x={x} y={y + 4} textAnchor="middle" fontSize={dense ? 10 : 13}>{pitch.name}<tspan fontSize="8" dy="2">{pitch.octave}</tspan></text>
          {note.kind === "slap" && <text className="bass-slap-arrow" x={x} y={y - radius - 2} textAnchor="middle">↕</text>}
        </g>;
      })}
    </svg>
  </div>;
}

/** 同じ譜面イベントの座標だけを描画し、判定状態や時計を所有しない。 */
function SlidePaths({ snapshot, time }: { snapshot: BassGameSnapshot; time: number }) {
  return <svg className="bass-slide-paths" viewBox="0 0 600 400" preserveAspectRatio="none" aria-hidden="true">
    {snapshot.notes.filter(note => note.kind === "slide").map(note => {
      const success = ["perfect", "great", "good"].includes(note.state) && time - (note.resolvedAt ?? -10) < 0.25;
      if (!success && note.state !== "sliding" && (note.state !== "pending" || note.time - time > BASS_VISUAL_CONFIG.leadTime)) return null;
      const x = (note.fret + 0.5) * 100, endX = (note.endFret! + 0.5) * 100, y = (note.string + 0.5) * 100 + 29;
      const movingX = success ? x + (endX - x) * Math.min(1, (time - note.resolvedAt!) / 0.2) : ((note.slideFret ?? note.fret) + 0.5) * 100;
      return <g key={note.id} data-bass-slide-path={note.id} data-state={note.state} className={success ? "is-slide-success" : note.state === "sliding" ? "is-sliding" : ""}>
        <defs><linearGradient id={`board-slide-${note.id}`} gradientUnits="userSpaceOnUse" x1={x} x2={endX} y1={y} y2={y}><stop stopColor={bassPitch(note.midi).color} /><stop offset="1" stopColor={bassPitch(note.endMidi!).color} /></linearGradient></defs>
        <line x1={x} x2={endX} y1={y} y2={y} stroke={`url(#board-slide-${note.id})`} className="bass-slide-route-shadow" />
        <line x1={x} x2={endX} y1={y} y2={y} stroke="#fff2b8" className="bass-slide-route" />
        <path d={`M${endX - Math.sign(endX - x) * 12},${y - 7} L${endX},${y} L${endX - Math.sign(endX - x) * 12},${y + 7}`} className="bass-slide-route-arrow" />
        {(note.state === "sliding" || success) && <><line className="bass-slide-trail" x1={movingX - Math.sign(endX - x) * 20} x2={movingX} y1={y} y2={y} /><circle className="bass-slide-traveller" cx={movingX} cy={y} r="6" /></>}
      </g>;
    })}
  </svg>;
}

export function BassGameHUD({ snapshot, paused, onStart, onContinue, onSong, onOffset, onDifficulty, onInput, onPause, onPutDown, onLayout, audioStatus }: Props) {
  const { phase } = snapshot;
  const deck = useRef<HTMLDivElement>(null);
  const contacts = useRef(new Map<number, BassPointerInput>());
  const callback = useRef(onInput);
  callback.current = onInput;
  const layoutCallback = useRef(onLayout);
  layoutCallback.current = onLayout;
  const enabled = !paused && phase === "playing";
  const visible = !paused && ["ready", "countdown", "playing"].includes(phase);
  const previousPhase = useRef(phase);
  useEffect(() => {
    if (phase === "ready" && previousPhase.current === "result") deck.current?.querySelector<HTMLSelectElement>(".bass-song-select select")?.focus({ preventScroll: true });
    previousPhase.current = phase;
  }, [phase]);
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
  if (phase === "result" && snapshot.result) return <section className="bass-hud bass-phase-result" data-bass-phase={phase} data-selected-difficulty={snapshot.difficulty} aria-label="ベース演奏"
    onPointerDown={event => event.stopPropagation()} onPointerMove={event => event.stopPropagation()} onPointerUp={event => event.stopPropagation()}>
    <BassResultScreen snapshot={snapshot} onContinue={onContinue} onQuit={onPutDown} />
  </section>;
  return <section className={`bass-hud bass-phase-${phase}`} data-bass-phase={phase} data-selected-difficulty={snapshot.difficulty} aria-label="ベース演奏"
    onPointerDown={event => event.stopPropagation()} onPointerMove={event => event.stopPropagation()} onPointerUp={event => event.stopPropagation()} onContextMenu={event => event.preventDefault()}>
    <header className="bass-top-hud">
      <div className="bass-title"><strong>{snapshot.songTitle}</strong><span>{snapshot.importSummary ? "MIDI仮譜面" : BASS_SONGS[snapshot.difficulty].label}</span></div>
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
          const note = nextCharge(snapshot.notes, cell.midi, cell);
          const holding = note?.state === "holding";
          const slideEnd = snapshot.notes.find(n => n.kind === "slide" && n.endString === cell.string && n.endFret === cell.fret &&
            (n.state === "sliding" || (n.state === "pending" && n.time - time <= BASS_VISUAL_CONFIG.leadTime)));
          const endProgress = slideEnd ? chargeProgress(slideEnd.endTime!, time, slideEnd.endTime! - slideEnd.time) : 0;
          const passing = snapshot.notes.some(n => n.state === "sliding" && n.string === cell.string && Math.abs((n.slideFret ?? -10) - cell.fret) < 0.4);
          const charge = note ? chargeProgress(holding ? note.endTime! : note.time, time, holding ? note.endTime! - note.time : BASS_VISUAL_CONFIG.leadTime) : 0;
          const recentHit = snapshot.notes.some(hit => (hit.kind === "slide" ? hit.endMidi : hit.midi) === cell.midi && !["pending", "holding", "sliding", "skipped", "miss", "bad"].includes(hit.state) && time >= (hit.resolvedAt ?? hit.time) && time - (hit.resolvedAt ?? hit.time) < 0.12);
          const active = Boolean(note && (holding || note.time - time <= BASS_VISUAL_CONFIG.leadTime));
          return <button type="button" key={index} className={`bass-fret ${slideEnd ? "is-slide-target" : ""} ${passing ? "is-slide-passing" : ""} ${active ? "is-charging" : ""} ${holding ? "is-holding" : ""} ${recentHit ? "is-hit" : ""}`}
            data-bass-fret={`${cell.string}-${cell.fret}`} data-midi={cell.midi} data-charge-note={active ? note?.id : undefined} data-charge={active ? charge.toFixed(3) : "0"}
            disabled={!enabled} aria-label={`${cell.string + 1}弦 ${cell.fret}フレット ${cell.name}${cell.octave}`} style={{ "--tone": cell.color, boxShadow: active ? `0 0 ${charge * 10}px #f2ce8766` : undefined } as CSSProperties}
            onPointerDown={event => {
              if (event.button !== 0 || !enabled) return;
              event.preventDefault();
              const rect = event.currentTarget.getBoundingClientRect();
              const input: BassPointerInput = { fretWidth: rect.width + 6, rowTop: rect.top, rowBottom: rect.bottom, id: event.pointerId, action: "down", midi: cell.midi, string: cell.string, fret: cell.fret, x: event.clientX, y: event.clientY, time: event.timeStamp };
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
            {slideEnd && <svg className="bass-slide-end-clock" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" data-slide-end={slideEnd.id} data-end-progress={endProgress.toFixed(3)}><rect x="9" y="9" width="82" height="82" rx="12" pathLength="100" strokeDasharray={`${Math.max(0, 1 - endProgress) * 100} 100`} /></svg>}
            <span className="bass-fret-name">{cell.name}<small>{cell.octave}</small></span>
            {(active || slideEnd) && <span className="bass-fret-technique" aria-hidden="true">{holding ? "HOLD" : note?.kind === "slap" ? "↕" : note?.kind === "slide" ? (note.endFret! > note.fret ? "→" : "←") : note?.kind === "hold" ? "―" : slideEnd ? "END" : ""}</span>}
          </button>;
        })}
        <SlidePaths snapshot={snapshot} time={time} />
      </div>
      {phase === "ready" && <div className="bass-setup">
        <label className="bass-song-select">曲<select aria-label="曲を選択" value={snapshot.songId} onChange={event => onSong(event.target.value as BassSongId)}>{BASS_TRACKS.map(track => <option key={track.id} value={track.id}>{track.title}{track.draft ? "（仮譜面）" : ""}</option>)}</select></label>
        {snapshot.importSummary ? <>
          <p className="bass-draft-summary">仮譜面 · {snapshot.importSummary.playableCount}音（0〜5F）<br />運指・奏法・原曲との一致は未確認</p>
          <label className="bass-offset">譜面調整<input aria-label="新曲の譜面オフセット（ミリ秒）" type="number" min="-750" max="5000" step="10" value={Math.round(snapshot.audioOffsetSec * 1000)} onChange={event => { const ms = Math.round(Number(event.target.value)); if (event.target.value !== "" && ms >= -750 && ms <= 5000) onOffset(ms / 1000); }} />ms</label>
        </> : <div className="bass-difficulty-selector" role="group" aria-label="難易度">{(["easy", "normal", "hard"] as const).map(value => <button key={value} data-bass-difficulty={value} aria-pressed={value === snapshot.difficulty} onClick={() => onDifficulty(value)}>{BASS_SONGS[value].label}</button>)}</div>}
        {!snapshot.importSummary && <p>{snapshot.songId === "technique-study" ? "タップ · 長押し · ↕フリック · ↔同じ弦をスライド" : "音名をタップ · 帯は長押し · ↕は上下フリック"}</p>}
        <button className="bass-start" onClick={onStart} disabled={busy}>{busy ? "曲を準備中…" : audioStatus === "error" ? "曲の読み込みを再試行" : audioStatus === "unavailable" ? "音声を再試行" : "演奏する"}</button>
      </div>}
      {enabled && (audioStatus === "unavailable" || audioStatus === "error") && <button className="bass-audio-resume" onClick={onStart}>音声を再開</button>}
    </div>
  </section>;
}
