import { useEffect, useRef, useState } from "react";
import type { Archive, Entry, Section } from "../data/model";
import { assetUrl, formatDate } from "../data/parser";
export function DetailPanel({
  entry,
  section,
  archive,
  onClose,
}: {
  entry: Entry;
  section: Section;
  archive: Archive;
  onClose: () => void;
}) {
  const panel = useRef<HTMLDialogElement>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [indices, setIndices] = useState<Record<number, number>>({});
  const records = archive.records[section].filter((r) => r.id === entry.id);
  const done = archive.achieved[section].has(entry.id);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const dialog = panel.current;
    dialog?.showModal();
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = old;
      dialog?.close();
      previous?.focus();
    };
  }, []);
  return (
    <>
      <dialog
        ref={panel}
        className={`detail-dialog theme-${section}`}
        aria-labelledby="detail-title"
        onCancel={(e) => {
          e.preventDefault();
          if (lightbox) setLightbox(null);
          else onClose();
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <div className="detail-inner">
          <button
            className="close-button"
            aria-label="詳細を閉じる"
            onClick={onClose}
          >
            ×
          </button>
          <p className="eyebrow">
            PERSONAL RECORD /{" "}
            {section === "pokemon"
              ? `NO. ${entry.id.padStart(4, "0")}`
              : "ARCHIVE"}
          </p>
          <h2 id="detail-title">{entry.name}</h2>
          {section === "pokemon" ? (
            <div className="variant-status">
              <span
                className={archive.normal.has(entry.id) ? "normal owned" : ""}
              >
                {archive.normal.has(entry.id) ? "●" : "○"} 通常色
              </span>
              <span
                className={archive.shiny.has(entry.id) ? "shiny owned" : ""}
              >
                {archive.shiny.has(entry.id) ? "✦" : "◇"} 色違い
              </span>
            </div>
          ) : (
            <p className={`detail-state ${done ? "done" : ""}`}>
              {done ? "●" : "○"}{" "}
              {section === "mountains"
                ? done
                  ? "登頂済み"
                  : "未登頂"
                : done
                  ? "訪問済み"
                  : "未訪問"}
            </p>
          )}
          {entry.elevation && (
            <div className="peak-info">
              <strong>
                {entry.elevation.toLocaleString()}
                <small> m</small>
              </strong>
              <span>{entry.region}</span>
              <p>代表峰：{entry.representativePeak}</p>
            </div>
          )}
          {entry.hasGeometry === false && (
            <p className="quiet-note">
              この地域は地図の縮尺では表示されません。一覧と記録に含まれます。
            </p>
          )}
          {records.length > 0 && (
            <div className="record-heading">
              <span>記録</span>
              <span>{records.length} RECORDS</span>
            </div>
          )}
          {records.map((r, i) => {
            const index = indices[i] ?? 0;
            return (
              <article className="record" key={`${r.line}-${i}`}>
                <div className="record-date">
                  {r.date && (
                    <time dateTime={r.date}>{formatDate(r.date)}</time>
                  )}
                  {r.variant && (
                    <span>{r.variant === "normal" ? "通常色" : "色違い"}</span>
                  )}
                </div>
                {r.photos.length > 0 && (
                  <>
                    <button
                      className="photo-main"
                      onClick={() => setLightbox(r.photos[index])}
                      aria-label={`${entry.name}の写真を拡大`}
                    >
                      <img
                        src={assetUrl(`photos/${r.photos[index]}`)}
                        alt={`${entry.name}${r.date ? " " + formatDate(r.date) : ""} 写真${index + 1}`}
                        loading="lazy"
                      />
                    </button>
                    {r.photos.length > 1 && (
                      <div className="gallery-controls">
                        <button
                          aria-label="前の写真"
                          onClick={() =>
                            setIndices({
                              ...indices,
                              [i]:
                                (index + r.photos.length - 1) % r.photos.length,
                            })
                          }
                        >
                          ←
                        </button>
                        <span>
                          {index + 1} / {r.photos.length}
                        </span>
                        <button
                          aria-label="次の写真"
                          onClick={() =>
                            setIndices({
                              ...indices,
                              [i]: (index + 1) % r.photos.length,
                            })
                          }
                        >
                          →
                        </button>
                      </div>
                    )}
                  </>
                )}
              </article>
            );
          })}
          {entry.source && (
            <a
              className="source-link"
              href={entry.source}
              target="_blank"
              rel="noreferrer"
            >
              代表峰を地理院地図で確認 ↗
            </a>
          )}
        </div>
      </dialog>
      {lightbox && (
        <PhotoLightbox
          photo={lightbox}
          name={entry.name}
          onClose={() => setLightbox(null)}
        />
      )}
    </>
  );
}

function PhotoLightbox({
  photo,
  name,
  onClose,
}: {
  photo: string;
  name: string;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    ref.current?.showModal();
    return () => previous?.focus();
  }, []);
  return (
    <dialog
      ref={ref}
      className="lightbox"
      aria-label="拡大写真"
      onCancel={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <button
        autoFocus
        className="close-button"
        aria-label="拡大写真を閉じる"
        onClick={onClose}
      >
        ×
      </button>
      <img src={assetUrl(`photos/${photo}`)} alt={`${name}の拡大写真`} />
    </dialog>
  );
}
