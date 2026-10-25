import { Component, Suspense, lazy, useEffect, useState, type ReactNode } from "react";
import { catalogs, sections, labels, english } from "../data/catalogs";
import { pokemonCounts } from "../data/parser";
import type { Archive, Entry, Section } from "../data/model";
import { Map } from "../maps/Map";
const Globe = lazy(() => import("../maps/Globe"));
class GlobeBoundary extends Component<
  { children: ReactNode; onFail: () => void },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onFail();
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}
function canWebGL() {
  try {
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl2") || c.getContext("webgl");
    if (!gl) return false;
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return true;
  } catch {
    return false;
  }
}
export function Collection({
  section,
  archive,
  onSelect,
  embedded = false,
  active = true,
}: {
  section: Section;
  archive: Archive;
  onSelect: (entry: Entry) => void;
  embedded?: boolean;
  active?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [mode, setMode] = useState<"2d" | "3d">(embedded && section === "world" && canWebGL() ? "3d" : "2d");
  const [notice, setNotice] = useState("");
  const [generation, setGeneration] = useState("all");
  const [prefectures, setPrefectures] = useState(true);
  const [prefectureOnly, setPrefectureOnly] = useState(false);
  const [selected, setSelected] = useState<Entry>();
  const [sheet, setSheet] = useState("middle");
  const [sheetStart, setSheetStart] = useState<number>();
  const choose = (entry: Entry) => {
    if (!filtered.some(value => value.id === entry.id)) {
      setQuery(""); setFilter("all");
    }
    setSelected(entry);
    onSelect(entry);
  };
  const integrated = embedded && section === "mountains";
  const achieved = archive.achieved[section];
  const pokemon = section === "pokemon";
  const counts = pokemonCounts(archive);
  const all = catalogs[section];
  const filtered = all.filter((e) => {
    const q = query.trim().toLowerCase();
    const match =
      !q ||
      e.name.toLowerCase().includes(q) ||
      e.aliases.some((a) => a.toLowerCase().includes(q)) ||
      e.english?.toLowerCase().includes(q) ||
      (pokemon && /^\d+$/.test(q)
        ? e.id === String(Number(q))
        : e.id.toLowerCase() === q);
    const state =
      filter === "all" ||
      (filter === "done" && achieved.has(e.id)) ||
      (filter === "todo" && !achieved.has(e.id)) ||
      (filter === "normal" && archive.normal.has(e.id)) ||
      (filter === "shiny" && archive.shiny.has(e.id)) ||
      (filter === "both" && archive.normal.has(e.id) && archive.shiny.has(e.id));
    return (
      match &&
      state &&
      (!pokemon || generation === "all" || e.generation === Number(generation))
    );
  });
  useEffect(() => {
    if (selected && !pokemon) document.querySelector(`[data-entry-id="${selected.id}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selected, pokemon]);
  const pageSize = 60,
    totalPages = Math.ceil(filtered.length / pageSize);
  const visible = pokemon
    ? filtered.slice((page - 1) * pageSize, page * pageSize)
    : filtered;
  useEffect(() => {
    setPage(1);
  }, [query, filter, generation]);
  const fallback = () => {
    setMode("2d");
    setNotice("この環境では3Dを表示できないため、2D地図を表示しています。");
  };
  const toggle3D = () => {
    if (canWebGL()) {
      setMode("3d");
      setNotice("");
    } else fallback();
  };
  return (
    <div className={`collection-content ${embedded ? "embedded-collection" : ""} ${integrated ? "integrated-japan" : ""}`} data-sheet={sheet}>
      <section className="page-intro">
        {!embedded && <a className="back-link" href="#/">
          ← 部屋に戻る
        </a>}
        <div className="page-title-row">
          <div>
            <p className="eyebrow">
              0{sections.indexOf(section) + 1} / COLLECTION
            </p>
            <h1 className={`collection-title title-${section}`}>
              {integrated ? "Japan" : english[section]}
            </h1>
            <p className="collection-japanese">{integrated ? `日本百名山 · 訪問都道府県 ${archive.achieved.japan.size} / 47` : labels[section]}</p>
          </div>
          <div className="page-count">
            <strong>{achieved.size}</strong>
            <span>
              {section === "world"
                ? "か国 訪問"
                : `/ ${all.length} ${pokemon ? "種" : section === "mountains" ? "座" : "都道府県"}`}
            </span>
          </div>
        </div>
      </section>
      {pokemon ? (
        <div className="dex-stats">
          <div>
            <i className="normal">●</i> 通常色 <strong>{counts.normal}</strong>
          </div>
          <div>
            <i className="shiny">✦</i> 色違い <strong>{counts.shiny}</strong>
          </div>
          <div>
            両方 <strong>{counts.both}</strong>
          </div>
          <span>NORMAL / SHINY — INDEPENDENT RECORDS</span>
        </div>
      ) : active ? (
        <div className="map-panel">
          <div className="map-panel-top">
            <span className="eyebrow">
              {section === "world"
                ? "WORLD / NATURAL EARTH"
                : section === "japan"
                  ? "JAPAN / PREFECTURES"
                  : "JAPAN / SUMMITS"}
            </span>
            {section === "world" ? (
              <div className="segmented" aria-label="地図表示">
                <button
                  aria-pressed={mode === "2d"}
                  onClick={() => setMode("2d")}
                >
                  2D 地図
                </button>
                <button aria-pressed={mode === "3d"} onClick={toggle3D}>
                  3D 地球儀
                </button>
              </div>
            ) : (
              <span className="map-caption">
                {section === "japan"
                  ? "JAPAN / 47 PREFECTURES"
                  : "JAPAN / 100 SUMMITS"}
              </span>
            )}
          </div>
          {integrated && <div className="japan-layers">
            <label><input type="checkbox" checked={prefectures} onChange={e => setPrefectures(e.target.checked)} />県の訪問色</label>
            <label><input type="checkbox" checked={prefectureOnly} onChange={e => setPrefectureOnly(e.target.checked)} />県のみ表示</label>
          </div>}
          {notice && (
            <p className="map-notice" role="status">
              {notice}
            </p>
          )}
          {mode === "3d" ? (
            <GlobeBoundary onFail={fallback}>
              <Suspense
                fallback={
                  <div className="loading">地球儀を準備しています…</div>
                }
              >
                <Globe
                  achieved={achieved}
                  onSelect={choose}
                  focus={selected}
                  onFail={fallback}
                />
              </Suspense>
            </GlobeBoundary>
          ) : (
            <Map section={integrated && prefectureOnly ? "japan" : section} achieved={integrated && prefectureOnly ? archive.achieved.japan : achieved} prefectures={integrated && prefectures ? archive.achieved.japan : undefined} focus={selected} onSelect={choose} />
          )}
        </div>
      ) : null}
      <section className="catalog-section">
        {integrated && <div className="sheet-grip" onPointerDown={e => { setSheetStart(e.clientY); e.currentTarget.setPointerCapture(e.pointerId); }} onPointerUp={e => {
          if (sheetStart === undefined) return;
          const levels = ["min", "middle", "max"];
          const delta = e.clientY - sheetStart;
          setSheet(levels[Math.max(0, Math.min(2, levels.indexOf(sheet) + (delta < -20 ? 1 : delta > 20 ? -1 : 0)))]);
          setSheetStart(undefined);
        }}><span aria-hidden="true">━━</span>{[ ["min", "最小"], ["middle", "中間"], ["max", "最大"] ].map(([value, label]) => <button key={value} aria-pressed={sheet === value} onClick={() => setSheet(value)}>{label}</button>)}</div>}
        <div className="catalog-header">
          <h2>
            {pokemon
              ? "全国図鑑"
              : section === "mountains"
                ? "百名山一覧"
                : section === "japan"
                  ? "都道府県一覧"
                  : "国・地域一覧"}
          </h2>
          <span>
            {filtered.length}{" "}
            {pokemon
              ? "SPECIES"
              : section === "mountains"
                ? "SUMMITS"
                : "PLACES"}
          </span>
        </div>
        <div className="catalog-controls">
          <label className="search">
            <span>⌕</span>
            <input
              aria-label={pokemon ? "名前・図鑑番号を検索" : "名前を検索"}
              type="search"
              value={query}
              placeholder={pokemon ? "名前・図鑑番号で探す" : "名前で探す"}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <div className="segmented filters">
            {[
              ["all", "すべて"],
              [
                "done",
                pokemon
                  ? "捕獲済み"
                  : section === "mountains"
                    ? "登頂済み"
                    : "訪問済み",
              ],
              [
                "todo",
                pokemon
                  ? "未捕獲"
                  : section === "mountains"
                    ? "未登頂"
                    : "未訪問",
              ],
            ].map(([value, label]) => (
              <button
                key={value}
                aria-pressed={filter === value}
                onClick={() => setFilter(value)}
              >
                {label}
              </button>
            ))}
          </div>
          {pokemon && <div className="segmented filters" aria-label="色の収集状況">
            {[["normal", "通常色"], ["shiny", "色違い"], ["both", "両方"]].map(([value, label]) => <button key={value} aria-pressed={filter === value} onClick={() => setFilter(filter === value ? "all" : value)}>{label}</button>)}
          </div>}
          {pokemon && (
            <label className="generation">
              <span className="sr-only">世代</span>
              <select
                aria-label="世代"
                value={generation}
                onChange={(e) => setGeneration(e.target.value)}
              >
                <option value="all">すべての世代</option>
                {Array.from(new Set(all.map((e) => e.generation))).map((g) => (
                  <option key={g} value={g}>
                    第{g}世代
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        {visible.length === 0 ? (
          <p className="empty-results">該当する記録はありません。</p>
        ) : (
          <div className={pokemon ? "pokemon-grid" : "entry-list"}>
            {visible.map((e) =>
              pokemon ? (
                <button
                  className={`pokemon-card ${achieved.has(e.id) ? "collected" : ""}`}
                  key={e.id}
                  onClick={() => choose(e)}
                  aria-label={`${e.name} 通常色${archive.normal.has(e.id) ? "捕獲済み" : "未捕獲"} 色違い${archive.shiny.has(e.id) ? "捕獲済み" : "未捕獲"}`}
                >
                  <span className="dex-number">
                    NO. {e.id.padStart(4, "0")}
                  </span>
                  <span className="dex-placeholder" aria-hidden="true">{achieved.has(e.id) ? "◉" : "◇"}</span>
                  <span className="dex-name">{e.name}</span>
                  <span className="dex-english">{e.english}</span>
                  <div className="dex-flags">
                    <span
                      className={archive.normal.has(e.id) ? "normal owned" : ""}
                    >
                      {archive.normal.has(e.id) ? "●" : "○"} 通常色
                    </span>
                    <span
                      className={archive.shiny.has(e.id) ? "shiny owned" : ""}
                    >
                      {archive.shiny.has(e.id) ? "✦" : "◇"} 色違い
                    </span>
                  </div>
                </button>
              ) : (
                <button
                  key={e.id}
                  aria-pressed={selected?.id === e.id}
                  data-entry-id={e.id}
                  className={`entry ${achieved.has(e.id) ? "collected" : ""}`}
                  onClick={() => choose(e)}
                >
                  <span className="entry-id">
                    {section === "mountains" ? e.id.slice(1) : e.id}
                  </span>
                  <span className="entry-name">
                    {e.name}
                    {e.elevation && (
                      <small>{e.elevation.toLocaleString()} m</small>
                    )}
                  </span>
                  <span className="entry-status">
                    {achieved.has(e.id) ? "●" : "○"}
                    <span className="sr-only">
                      {achieved.has(e.id) ? "達成済み" : "未達成"}
                    </span>
                  </span>
                  <span className="entry-arrow">↗</span>
                </button>
              ),
            )}
          </div>
        )}
        {pokemon && totalPages > 1 && (
          <nav className="pagination" aria-label="図鑑ページ">
            <button disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
              ← 前へ
            </button>
            <span>
              {page} / {totalPages}
            </span>
            <button
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              次へ →
            </button>
          </nav>
        )}
        <p className="catalog-footnote">
          {pokemon
            ? "全国図鑑の基本種を収録。フォーム違いは別カウントしません。"
            : section === "mountains"
              ? "深田久弥「日本百名山」の100座。山塊は代表峰の位置に表示しています。"
              : section === "world"
                ? "ISO 3166-1 の国・地域を収録。小さな島や地図に形状のない地域も、一覧から閲覧できます。"
                : "都道府県ごとの訪問記録。山の登頂記録とは独立して集計しています。"}
        </p>
      </section>
    </div>
  );
}
