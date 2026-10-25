import { useEffect, useRef, useState } from "react";
import type { Archive, Entry, Section } from "../data/model";
import { JapanMode } from "./JapanMode";
import { catalogs } from "../data/catalogs";
import { WorldMode } from "./WorldMode";
import { Collection } from "../components/Collection";
import { DetailPanel } from "../components/DetailPanel";
import "./collectionModes.css";

export type CollectionMode = "world" | "mountains" | "pokemon";
export const collectionMode = (section: Section): CollectionMode => section === "japan" ? "mountains" : section;

/** モードごとの一覧状態を保持し、非表示中の地図・WebGLを解放する。 */
export function CollectionModes({ archive, mode, onClose }: { archive: Archive; mode: CollectionMode | null; onClose: () => void }) {
  const [visited, setVisited] = useState<CollectionMode[]>([]);
  const [selected, setSelected] = useState<Entry>();
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (mode) {
      setVisited(previous => previous.includes(mode) ? previous : [...previous, mode]);
      close.current?.focus();
    }
    setSelected(undefined);
  }, [mode]);
  useEffect(() => {
    if (!mode) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector("dialog[open]")) onClose();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [mode, onClose]);
  return <>
    <div className={`collection-modes app-collection${mode === "world" ? " is-world-mode" : mode === "mountains" ? " is-japan-mode" : ""}`} hidden={!mode} role="region" aria-label="コレクションモード">
      <header className="mode-toolbar"><button ref={close} onClick={onClose}>← 部屋に戻る</button>{mode === "world" ? <><h1>WORLD</h1><div className="world-total page-count"><strong>{archive.achieved.world.size}</strong><span>国・地域を訪問</span></div></> : mode === "mountains" ? <><h1>JAPAN</h1><div className="japan-progress"><strong>{archive.achieved.mountains.size}</strong><small>/ {catalogs.mountains.length} 座</small><span className="prefecture-progress">訪問県 {archive.achieved.japan.size} / {catalogs.japan.length}</span></div></> : <><span>PERSONAL ATLAS / {mode?.toUpperCase()}</span><span className="mode-hint">ESC · CLOSE</span></>}</header>
      {visited.map(value => <div key={value} className={`mode-scroll${value === "world" ? " world-mode-host" : value === "mountains" ? " japan-mode-host" : ""}`} hidden={mode !== value}>
        {value === "world" ? <WorldMode archive={archive} active={mode === value} /> : value === "mountains" ? <JapanMode archive={archive} active={mode === value} /> : <Collection section={value} archive={archive} embedded active={mode === value} onSelect={setSelected} />}
      </div>)}
      {selected && mode === "pokemon" && <DetailPanel key={`pokemon-${selected.id}`} entry={selected} section="pokemon" archive={archive} onClose={() => setSelected(undefined)} />}
    </div>
  </>;
}
