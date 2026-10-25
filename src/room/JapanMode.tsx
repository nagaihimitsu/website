import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Archive, Entry } from "../data/model";
import { catalogs } from "../data/catalogs";
import { assetUrl, formatDate } from "../data/parser";
import { Map, type MapView } from "../maps/Map";
import { mountainRegion } from "../maps/mountainData";
import "./japanMode.css";

/** 選択・フィルターはここで所有し、地図と一覧を同じ対象集合で表示する。 */
export function JapanMode({ archive, active }: { archive: Archive; active: boolean }) {
  const [filter, setFilter] = useState("all");
  const [selection, setSelection] = useState<{ entry: Entry; serial: number; origin: "map" | "list" }>();
  const [reset, setReset] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const savedScroll = useRef(0);
  const mapView = useRef<MapView | undefined>(undefined);
  const scrolled = useRef<typeof selection>(undefined);
  const achieved = archive.achieved.mountains;
  const visible = catalogs.mountains.filter(entry => filter === "all" || (filter === "done" ? achieved.has(entry.id) : !achieved.has(entry.id)));
  const select = (entry: Entry, origin: "map" | "list") => setSelection(previous => ({ entry, origin, serial: (previous?.serial ?? 0) + 1 }));
  useLayoutEffect(() => {
    const root = list.current?.closest<HTMLElement>(".collection-modes"), viewport = window.visualViewport;
    if (!active || !root || !viewport) return;
    // WORLDと同様にSafariの可視領域へ合わせる。WORLD側の状態・リスナーは変更しない。
    const resize = () => {
      root.style.setProperty("--japan-viewport-height", `${viewport.height}px`);
      root.style.setProperty("--japan-offset-top", `${viewport.offsetTop}px`);
    };
    resize(); viewport.addEventListener("resize", resize); viewport.addEventListener("scroll", resize);
    return () => { viewport.removeEventListener("resize", resize); viewport.removeEventListener("scroll", resize);
      root.style.removeProperty("--japan-viewport-height"); root.style.removeProperty("--japan-offset-top"); };
  }, [active]);
  useLayoutEffect(() => { if (active && list.current) list.current.scrollTop = savedScroll.current; }, [active]);
  useEffect(() => {
    if (!active || !selection || selection.origin !== "map" || scrolled.current === selection || !list.current) return;
    const container = list.current, row = container.querySelector<HTMLElement>(`[data-mountain-id="${selection.entry.id}"]`);
    if (!row) return;
    scrolled.current = selection;
    const delta = row.getBoundingClientRect().top - container.getBoundingClientRect().top;
    container.scrollTo({ top: container.scrollTop + delta - container.clientHeight * .35,
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
  }, [selection, active]);
  const selected = selection?.entry;
  const records = selected ? archive.records.mountains.filter(record => record.id === selected.id) : [];
  return <section className="japan-mode" aria-label="JAPAN 百名山マップ" data-selected-mountain={selected?.id ?? ""}>
    <section className="japan-map-pane" aria-label="日本地図と百名山">
      {active && <Map section="mountains" japanMode achieved={achieved} prefectures={archive.achieved.japan}
        mountainEntries={visible} focus={selected} focusToken={selection?.serial ?? 0} resetToken={reset}
        initialView={mapView.current} onViewChange={value => { mapView.current = value; }}
        onSelect={entry => select(entry, "map")} onReset={() => { setSelection(undefined); mapView.current = undefined; setReset(value => value + 1); }} />}
      <p className="japan-map-hint" role="status">{selected ? `${selected.name} · ${achieved.has(selected.id) ? "登頂済み" : "未登頂"}` : "山を選択 / ドラッグで移動・ピンチで拡大"}</p>
    </section>
    <section className="japan-catalog" aria-label="百名山一覧">
      <div className="japan-catalog-controls"><div className="segmented" aria-label="登頂状態">
        {[["all", "すべて"], ["done", "登頂済み"], ["todo", "未登頂"]].map(([value, name]) => <button key={value}
          aria-pressed={filter === value} onClick={() => { setFilter(value); if (selected && value !== "all" && achieved.has(selected.id) !== (value === "done")) setSelection(undefined); }}>{name}</button>)}
      </div><span>{visible.length}座</span></div>
      <div className="japan-mountain-list" ref={list} tabIndex={0} aria-label="百名山の一覧" onScroll={event => {
        if (active && event.currentTarget.clientHeight > 0) savedScroll.current = event.currentTarget.scrollTop;
      }}>
        {selected && records.length > 0 && <details className="japan-records"><summary>{selected.name}の登頂記録</summary>
          {records.map(record => <article key={record.line}>{record.date && <time dateTime={record.date}>{formatDate(record.date)}</time>}
            {record.photos.map(photo => <img key={photo} loading="lazy" src={assetUrl(`photos/${photo}`)} alt={`${selected.name}の記録写真`} />)}</article>)}
        </details>}
        {visible.map(entry => <button className="mountain-row entry" data-mountain-id={entry.id} key={entry.id}
          aria-pressed={selected?.id === entry.id} onClick={() => select(entry, "list")}>
          <span className="mountain-number">{entry.id.slice(1)}</span>
          <span className="mountain-description"><strong>{entry.name}</strong><span className="mountain-meta">{entry.elevation?.toLocaleString("ja-JP")}m<span> · </span>{mountainRegion(entry)}</span></span>
          <span className={`mountain-status${achieved.has(entry.id) ? " is-done" : ""}`}>{achieved.has(entry.id) ? "● 登頂済み" : "○ 未登頂"}</span>
        </button>)}
        {!visible.length && <p className="empty-results">該当する山はありません。</p>}
      </div>
    </section>
  </section>;
}
