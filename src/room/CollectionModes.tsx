import { useEffect, useRef, useState } from "react";
import type { Archive, Entry, Section } from "../data/model";
import { Collection } from "../components/Collection";
import { DetailPanel } from "../components/DetailPanel";
import "./collectionModes.css";

export type CollectionMode = "world" | "mountains" | "pokemon";
export const collectionMode = (section: Section): CollectionMode => section === "japan" ? "mountains" : section;

/** Keep filters and scroll in mounted catalogues; release maps/WebGL when inactive. */
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
  const section: Section | undefined = selected && mode === "mountains" && !selected.id.startsWith("m") ? "japan" : mode ?? undefined;
  return <>
    <div className="collection-modes app-collection" hidden={!mode} role="region" aria-label="コレクションモード">
      <header className="mode-toolbar"><button ref={close} onClick={onClose}>← 部屋に戻る</button><span>PERSONAL ATLAS / {mode === "mountains" ? "JAPAN" : mode?.toUpperCase()}</span><span className="mode-hint">ESC · CLOSE</span></header>
      {visited.map(value => <div key={value} className="mode-scroll" hidden={mode !== value}>
        <Collection section={value} archive={archive} embedded active={mode === value} onSelect={setSelected} />
      </div>)}
      {selected && section && <DetailPanel key={`${section}-${selected.id}`} entry={selected} section={section} archive={archive} onClose={() => setSelected(undefined)} />}
    </div>
  </>;
}
