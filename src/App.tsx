import {
  Suspense,
  lazy,
  useEffect,
  useState,
} from "react";
import { catalogs, sections, labels } from "./data/catalogs";
import { loadArchive, pokemonCounts } from "./data/parser";
import type { Archive, Entry, Section } from "./data/model";
import { Collection } from "./components/Collection";
import { Map } from "./maps/Map";
import { DetailPanel } from "./components/DetailPanel";
import { AtlasOrb } from "./components/AtlasOrb";
const RoomHome = lazy(() => import("./room/RoomHome"));
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
            <RoomHome archive={archive} />
          </Suspense>
        ) : (
          <Home archive={archive} />
        )}
      </main>
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
