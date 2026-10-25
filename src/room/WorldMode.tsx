import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Archive, Entry } from "../data/model";
import { assetUrl, formatDate } from "../data/parser";
import { Map, type MapView } from "../maps/Map";
import type { GlobeView } from "../maps/Globe";
import { countryView, groupCountries, regionName } from "../maps/worldData";
import { GlobeBoundary, canWebGL } from "../components/GlobeBoundary";
import "./worldMode.css";
const Globe = lazy(() => import("../maps/Globe"));

/** 選択はこのモードだけが所有する。描画器・一覧は共通のselectCountryへ通知する。 */
export function WorldMode({ archive, active }: { archive: Archive; active: boolean }) {
  const [selection, setSelection] = useState<{ entry: Entry; origin: "list" | "map"; serial: number }>();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("done");
  const [display, setDisplay] = useState<"3d" | "2d">(() => canWebGL() ? "3d" : "2d");
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const [resetToken, setResetToken] = useState(0);
  const [notice, setNotice] = useState("");
  const list = useRef<HTMLDivElement>(null);
  const scrolledSelection = useRef<typeof selection>(undefined);
  const savedScroll = useRef(0);
  const mapView = useRef<MapView | undefined>(undefined);
  const globeView = useRef<GlobeView | undefined>(undefined);
  const mapFocus = useRef<string | undefined>(undefined);
  const globeFocus = useRef<string | undefined>(undefined);
  const achieved = archive.achieved.world;
  const groups = useMemo(() => groupCountries(query, filter, achieved), [query, filter, achieved]);
  const selected = selection?.entry;
  const view = selected ? countryView(selected) : undefined;
  const selectCountry = useCallback((entry: Entry, origin: "list" | "map" = "map") => {
    setSelection(previous => ({ entry, origin, serial: (previous?.serial ?? 0) + 1 }));
    setClosed(previous => { const next = new Set(previous); next.delete(countryView(entry).region); return next; });
    if (origin === "map" && !groups.some(group => group.entries.some(item => item.id === entry.id))) {
      setQuery("");
      setFilter("all");
    }
  }, [groups]);
  useLayoutEffect(() => {
    const viewport = window.visualViewport;
    const root = list.current?.closest<HTMLElement>(".collection-modes");
    if (!active || !viewport || !root) return;
    // Safariのキーボード・アドレスバーで可視領域が変わっても、文書全体をスクロールさせない。
    const resize = () => {
      root.style.setProperty("--world-viewport-height", `${viewport.height}px`);
      root.style.setProperty("--world-offset-top", `${viewport.offsetTop}px`);
    };
    resize();
    viewport.addEventListener("resize", resize);
    viewport.addEventListener("scroll", resize);
    return () => {
      viewport.removeEventListener("resize", resize);
      viewport.removeEventListener("scroll", resize);
      root.style.removeProperty("--world-viewport-height");
      root.style.removeProperty("--world-offset-top");
    };
  }, [active]);
  useLayoutEffect(() => {
    if (active && list.current) list.current.scrollTop = savedScroll.current;
  }, [active]);
  useEffect(() => {
    if (!active || selection?.origin !== "map" || scrolledSelection.current === selection || !list.current) return;
    const container = list.current;
    const row = container.querySelector<HTMLElement>(`[data-country-id="${selection.entry.id}"]`);
    if (!row) return;
    scrolledSelection.current = selection;
    // 上位要素を動かすscrollIntoViewは使わず、一覧自身のスクロール量だけを変える。
    const delta = row.getBoundingClientRect().top - container.getBoundingClientRect().top;
    container.scrollTo({ top: container.scrollTop + delta - container.clientHeight * .35,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
  }, [selection, active]);
  const fallback = useCallback(() => { setDisplay("2d"); setNotice("3Dを表示できないため、2D地図を表示しています。"); }, []);
  const reset = () => {
    setSelection(undefined);
    mapView.current = undefined;
    globeView.current = undefined;
    setResetToken(value => value + 1);
  };
  const records = selected ? archive.records.world.filter(record => record.id === selected.id) : [];
  return <section className="world-mode" aria-label="WORLD 探索" data-selected-country={selected?.id ?? ""}>
    <section className="world-visual-pane" aria-label="地球儀と地図">
      <div className="world-display-controls">
        <div className="segmented" aria-label="地図表示">
          <button aria-pressed={display === "3d"} onClick={() => { if (display === "3d") return; if (canWebGL()) { setDisplay("3d"); setNotice(""); } else fallback(); }}>3D 地球儀</button>
          <button aria-pressed={display === "2d"} onClick={() => setDisplay("2d")}>2D 地図</button>
        </div>
        <button className="world-reset" onClick={reset}>表示リセット</button>
      </div>
      <div className="world-viewport">
        {notice && <p className="world-notice" role="status">{notice}</p>}
        {active && (display === "3d" ? <GlobeBoundary onFail={fallback}>
          <Suspense fallback={<div className="loading">地球儀を準備しています…</div>}>
            <Globe paper achieved={achieved} focus={selected} focusToken={selection?.serial ?? 0} resetToken={resetToken} initialView={globeFocus.current === selected?.id ? globeView.current : undefined}
              onViewChange={value => { globeView.current = value; globeFocus.current = selected?.id; }} onSelect={selectCountry} onFail={fallback} />
          </Suspense>
        </GlobeBoundary> : <Map key={resetToken} section="world" achieved={achieved} focus={selected} focusToken={selection?.serial ?? 0} focusPoint={view?.point}
          initialView={mapFocus.current === selected?.id ? mapView.current : undefined} onViewChange={value => { mapView.current = value; mapFocus.current = selected?.id; }} onSelect={selectCountry} onReset={reset} />)}
      </div>
      <div className="world-selection" role="status">
        <strong>{selected?.name ?? "国を選択して探索"}</strong>
        <span>{view ? `${regionName(view.region)} · ${achieved.has(selected!.id) ? "訪問済み" : "未訪問"}` : "ドラッグで回転・移動 / ピンチ・ホイールでズーム"}</span>
        {view?.note && <small>{view.note}</small>}
      </div>
    </section>
    <section className="world-catalog" aria-label="国・地域一覧">
      <div className="world-catalog-controls">
        <label className="search"><span aria-hidden="true">⌕</span><input type="search" aria-label="国名を検索" placeholder="日本語・英語・国コードで探す" value={query} onChange={event => setQuery(event.target.value)} /></label>
        <div className="segmented" aria-label="訪問状態">
          {[["all", "すべて"], ["done", "訪問済み"], ["todo", "未訪問"]].map(([value, label]) => <button key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>)}
        </div>
        <span className="world-results">{groups.reduce((total, group) => total + group.entries.length, 0)}件</span>
      </div>
      <div className="world-country-list" ref={list} tabIndex={0} aria-label="地域別の国一覧" onScroll={event => {
        if (active && event.currentTarget.clientHeight > 0) savedScroll.current = event.currentTarget.scrollTop;
      }}>
        {selected && records.length > 0 && <details className="world-records"><summary>{selected.name}の訪問記録</summary>
          {records.map(record => <article key={record.line}>
            {record.date && <time dateTime={record.date}>{formatDate(record.date)}</time>}
            {record.photos.map(photo => <img key={photo} loading="lazy" src={assetUrl(`photos/${photo}`)} alt={`${selected.name}の記録写真`} />)}
          </article>)}
        </details>}
        {groups.filter(group => group.entries.length > 0).map(group => <section className="world-region" key={group.id}>
          <button className="world-region-heading" aria-expanded={!closed.has(group.id)} onClick={() => setClosed(previous => {
            const next = new Set(previous); if (next.has(group.id)) next.delete(group.id); else next.add(group.id); return next;
          })}><span>{closed.has(group.id) ? "▸" : "▾"} {group.name}</span><small>{group.entries.length}件 / 全{group.total}件</small></button>
          {!closed.has(group.id) && group.entries.map(entry => <button className={`country-row entry ${achieved.has(entry.id) ? "collected" : ""}`} key={entry.id}
            data-country-id={entry.id} aria-pressed={selected?.id === entry.id} onClick={() => selectCountry(entry, "list")}>
            <span className="country-name">{entry.name}<small lang="en">{entry.english}</small></span>
            <span className="country-status">{achieved.has(entry.id) ? "● 訪問済み" : "○ 未訪問"}</span>
          </button>)}
        </section>)}
        {!groups.some(group => group.entries.length > 0) && <p className="empty-results">該当する国・地域はありません。</p>}
      </div>
    </section>
  </section>;
}
