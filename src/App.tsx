import {
  Component,
  Suspense,
  lazy,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { catalogs, sections, labels, english } from "./data/catalogs";
import { loadArchive, pokemonCounts } from "./data/parser";
import type { Archive, Entry, Section } from "./data/model";
import { Map } from "./maps/Map";
import { DetailPanel } from "./components/DetailPanel";
import { AtlasOrb } from "./components/AtlasOrb";
const Globe = lazy(() => import("./maps/Globe"));
const RoomHome = lazy(() => import("./room/RoomHome"));
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
function useRoute() {
  const read = () => window.location.hash.replace(/^#\/?/, "").split("/")[0];
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const onHash = () => {
      setRoute(read());
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  return route;
}
export default function App() {
  const route = useRoute();
  const section = sections.includes(route as Section)
    ? (route as Section)
    : undefined;
  const room = !section && route !== "index";
  const [archive, setArchive] = useState<Archive>();
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Entry>();
  const [roomMode, setRoomMode] = useState<Section>();
  useEffect(() => {
    loadArchive()
      .then(setArchive)
      .catch((e) => setError(String(e.message)));
  }, []);
  useEffect(() => {
    setSelected(undefined);
    document.title = `${section ? labels[section] + " — " : ""}Personal Atlas`;
  }, [section]);
  return (
    <div
      className={
        room
          ? "app-room theme-world"
          : section
            ? `app-collection theme-${section}`
            : "app-index theme-world"
      }
    >
      <a
        className="skip-link"
        href="#main-content"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById("main-content")?.focus();
        }}
      >
        コンテンツへ
      </a>
      {!room && (
        <header className="site-header">
          <a className="brand" href="#/" aria-label="Personal Atlas ホーム">
            <svg
              className="brand-mark"
              viewBox="0 0 32 32"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M3 27L16 4l13 23H3Z M10 27l6-11 6 11 M9 17h14"
                stroke="currentColor"
                strokeWidth="1.4"
              />
            </svg>
            <span>
              PERSONAL
              <br />
              ATLAS<span className="brand-period">.</span>
            </span>
          </a>
          <nav aria-label="コレクション">
            <a
              className={!section ? "current" : ""}
              aria-current={!section ? "page" : undefined}
              href="#/"
            >
              <span>00</span> Room
            </a>
            {sections.map((s, i) => (
              <a
                key={s}
                className={section === s ? "current" : ""}
                aria-current={section === s ? "page" : undefined}
                href={`#/${s}`}
              >
                <span>0{i + 1}</span>
                {s === "pokemon" ? "Pokédex" : s[0].toUpperCase() + s.slice(1)}
              </a>
            ))}
          </nav>
          <span className="header-note">
            <i aria-hidden="true" />
            PERSONAL ARCHIVE
          </span>
        </header>
      )}
      <main
        id="main-content"
        className={room ? "room-main" : undefined}
        tabIndex={-1}
      >
        {error ? (
          <div className="load-error" role="alert">
            <h1>記録を読み込めませんでした</h1>
            <p>公開データの内容を確認してください。</p>
            <pre>{error}</pre>
          </div>
        ) : !archive ? (
          <div className="loading">記録を読み込んでいます…</div>
        ) : section ? (
          <Collection
            key={section}
            section={section}
            archive={archive}
            onSelect={setSelected}
          />
        ) : room ? (
          <Suspense
            fallback={<div className="loading">部屋を準備しています…</div>}
          >
            <RoomHome archive={archive} onOpenMode={setRoomMode} modeActive={Boolean(roomMode)} />
          </Suspense>
        ) : (
          <Home archive={archive} />
        )}
      </main>
      {room && archive && roomMode && (
        <section className="room-collection-overlay" aria-label={`${english[roomMode]} モード`}>
          <div className="room-mode-bar">
            <button className="room-mode-back" onClick={() => { setRoomMode(undefined); setSelected(undefined); }}>← 3Dホーム</button>
            <nav aria-label="コレクションモード">
              {([['world', 'WORLD'], ['japan', 'JAPAN'], ['pokemon', 'POKÉDEX']] as const).map(([mode, label]) => (
                <button key={mode} aria-pressed={roomMode === mode || (mode === 'japan' && roomMode === 'mountains')} onClick={() => { setRoomMode(mode); setSelected(undefined); }}>{label}</button>
              ))}
              {roomMode === 'japan' || roomMode === 'mountains' ? (
                <span className="room-mode-subnav">
                  <button aria-pressed={roomMode === 'mountains'} onClick={() => setRoomMode('mountains')}>百名山</button>
                  <button aria-pressed={roomMode === 'japan'} onClick={() => setRoomMode('japan')}>都道府県</button>
                </span>
              ) : null}
            </nav>
          </div>
          <div className="room-mode-content">
            <Collection key={roomMode} section={roomMode} archive={archive} onSelect={setSelected} />
          </div>
          {selected && <DetailPanel key={`${roomMode}-${selected.id}`} section={roomMode} entry={selected} archive={archive} onClose={() => setSelected(undefined)} />}
        </section>
      )}
      {!room && (
        <footer className="site-footer">
          <a className="footer-brand" href="#/">
            PERSONAL ATLAS<span>© {new Date().getFullYear()}</span>
          </a>
          <span className="footer-index">INDEX / 04 COLLECTIONS</span>
          <a href={`${import.meta.env.BASE_URL}licenses/README.txt`}>
            CREDITS <span>↗</span>
          </a>
        </footer>
      )}
      {archive && section && selected && (
        <DetailPanel
          key={`${section}-${selected.id}`}
          section={section}
          entry={selected}
          archive={archive}
          onClose={() => setSelected(undefined)}
        />
      )}
    </div>
  );
}
function Home({ archive }: { archive: Archive }) {
  const poke = pokemonCounts(archive);
  const titles = {
    world: "World",
    japan: "Japan",
    mountains: "Mountains",
    pokemon: "Pokédex",
  };
  const descriptions = {
    world: "国・地域",
    japan: "都道府県",
    mountains: "日本百名山",
    pokemon: "全国図鑑",
  };
  return (
    <>
      <section className="home-intro" aria-labelledby="atlas-title">
        <div className="hero-kicker">
          <span>PERSONAL COLLECTION</span>
          <span className="hero-edition">INDEX — 00</span>
        </div>
        <div className="home-orb">
          <AtlasOrb achieved={archive.achieved.world} />
        </div>
        <div className="hero-title-block">
          <span className="hero-title-prefix">THE PERSONAL</span>
          <h1 id="atlas-title">
            ATLAS
            <span className="hero-asterisk" aria-hidden="true">
              <svg viewBox="0 0 32 32" fill="none">
                <path
                  d="M16 1v30M1 16h30M5.4 5.4l21.2 21.2M5.4 26.6 26.6 5.4"
                  stroke="currentColor"
                  strokeWidth="1.5"
                />
              </svg>
            </span>
          </h1>
        </div>
        <div className="hero-bottom">
          <div className="hero-descriptor">
            <span>TRAVEL / MOUNTAINS / POKÉMON</span>
            <span>個人の記録とコレクション</span>
          </div>
          <button
            className="index-scroll"
            aria-label="コレクション一覧へ"
            onClick={() =>
              document.getElementById("collection-index")?.scrollIntoView({
                behavior: window.matchMedia("(prefers-reduced-motion: reduce)")
                  .matches
                  ? "instant"
                  : "smooth",
              })
            }
          >
            <span>VIEW INDEX</span>
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M12 4v16m-6-6 6 6 6-6"
                stroke="currentColor"
                strokeWidth="1.2"
              />
            </svg>
          </button>
        </div>
      </section>
      <section
        className="collection-index"
        id="collection-index"
        aria-labelledby="collections-title"
      >
        <div className="section-rule">
          <h2 id="collections-title">
            Collections<span>(04)</span>
          </h2>
          <span className="index-label">
            SELECT AN ARCHIVE <span>↙</span>
          </span>
        </div>
        <div className="collection-grid">
          {sections.map((s, i) => (
            <a href={`#/${s}`} key={s} className={`collection-card theme-${s}`}>
              <div className="card-top">
                <span className="eyebrow">
                  <span className="card-index">0{i + 1}</span> {descriptions[s]}
                </span>
                <span className="card-link" aria-hidden="true">
                  ↗
                </span>
              </div>
              <div className="card-copy">
                <h3>{titles[s]}</h3>
              </div>
              <div className="card-art" aria-hidden="true">
                {s === "pokemon" ? (
                  <div className="dex-art">
                    <svg viewBox="0 0 400 300" fill="none">
                      <circle cx="200" cy="150" r="108" />
                      <circle cx="200" cy="150" r="84" />
                      <circle cx="200" cy="150" r="36" />
                      <path d="M80 150h83m74 0h83M200 30v84m0 72v84M120 70l54 54m52 52 54 54M280 70l-54 54m-52 52-54 54" />
                      <path
                        className="dex-symbol"
                        d="M200 98l13 39 39 13-39 13-13 39-13-39-39-13 39-13Z"
                      />
                    </svg>
                    <div className="specimen-reference">
                      SPECIES / 0001 —{" "}
                      {String(catalogs.pokemon.length).padStart(4, "0")}
                    </div>
                  </div>
                ) : (
                  <Map section={s} achieved={archive.achieved[s]} preview />
                )}
              </div>
              <div className="card-bottom">
                <div className="card-count">
                  <strong>{archive.achieved[s].size}</strong>
                  <span>
                    {s === "world" ? "VISITED" : `/ ${catalogs[s].length}`}
                    <small>
                      {s === "pokemon"
                        ? "SPECIES"
                        : s === "mountains"
                          ? "SUMMITS"
                          : s === "japan"
                            ? "PREFECTURES"
                            : "COUNTRIES"}
                    </small>
                  </span>
                </div>
                <span className="card-detail">
                  {s === "pokemon" ? (
                    <>
                      <span>通常色 {poke.normal}</span>
                      <span>色違い {poke.shiny}</span>
                    </>
                  ) : (
                    <>
                      <span>
                        {s === "world"
                          ? "2D MAP / 3D GLOBE"
                          : s === "japan"
                            ? "PREFECTURE MAP"
                            : "SUMMIT MAP"}
                      </span>
                      <span>VIEW COLLECTION →</span>
                    </>
                  )}
                </span>
              </div>
            </a>
          ))}
        </div>
      </section>
    </>
  );
}
function Collection({
  section,
  archive,
  onSelect,
}: {
  section: Section;
  archive: Archive;
  onSelect: (entry: Entry) => void;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [mode, setMode] = useState<"2d" | "3d">(section === "world" ? "3d" : "2d");
  const [notice, setNotice] = useState("");
  const [generation, setGeneration] = useState("all");
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
      (filter === "shiny" && archive.shiny.has(e.id));
    return (
      match &&
      state &&
      (!pokemon || generation === "all" || e.generation === Number(generation))
    );
  });
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
    <>
      <section className="page-intro">
        <a className="back-link" href="#/">
          ← 部屋に戻る
        </a>
        <div className="page-title-row">
          <div>
            <p className="eyebrow">
              0{sections.indexOf(section) + 1} / COLLECTION
            </p>
            <h1 className={`collection-title title-${section}`}>
              {english[section]}
            </h1>
            <p className="collection-japanese">{labels[section]}</p>
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
      ) : (
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
                  onSelect={onSelect}
                  onFail={fallback}
                />
              </Suspense>
            </GlobeBoundary>
          ) : (
            <Map section={section} achieved={achieved} onSelect={onSelect} />
          )}
        </div>
      )}
      <section className="catalog-section">
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
                  onClick={() => onSelect(e)}
                  aria-label={`${e.name} 通常色${archive.normal.has(e.id) ? "捕獲済み" : "未捕獲"} 色違い${archive.shiny.has(e.id) ? "捕獲済み" : "未捕獲"}`}
                >
                  <span className="dex-number">
                    NO. {e.id.padStart(4, "0")}
                  </span>
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
                  className={`entry ${achieved.has(e.id) ? "collected" : ""}`}
                  onClick={() => onSelect(e)}
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
    </>
  );
}
