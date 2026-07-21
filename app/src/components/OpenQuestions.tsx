// Global "open questions" — every unresolved question the reader has left,
// anywhere in the Book, in one place. A toolbar badge shows the count; the
// dropdown lists them with location and a jump-to-the-ayah action.

import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import { useAsync } from "../hooks/useAsync";
import { useAppDispatch } from "../state/store";
import { archive } from "../persistence/db";
import type { NoteRecord } from "../persistence/types";

const vsort = (k: string) => {
  const [c, v] = k.split(":").map((n) => parseInt(n, 10) || 0);
  return c * 1000 + v;
};

export function OpenQuestions() {
  const dispatch = useAppDispatch();
  const [open, setOpen] = useState(false);
  const [version, setVersion] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  const notes = useAsync(() => archive.notes.all(), [version]);
  const chapters = useAsync(() => api.chapters(), []);

  const surahName = (verseKey: string) => {
    const id = parseInt(verseKey.split(":")[0] ?? "", 10);
    return chapters.data?.find((c) => c.id === id)?.name_simple ?? "";
  };

  const questions = (notes.data ?? [])
    .filter((n) => n.kind === "question" && !n.resolved)
    .sort((a, b) => vsort(a.verseKey) - vsort(b.verseKey));
  const count = questions.length;

  // refresh the list whenever the panel is opened (answers may have changed)
  useEffect(() => {
    if (open) setVersion((v) => v + 1);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const jump = (n: NoteRecord) => {
    dispatch({ type: "jumpToVerse", verseKey: n.verseKey, wordPosition: n.wordPosition });
    setOpen(false);
  };

  return (
    <div className="oq-wrap" ref={ref}>
      <button
        className={`ctl oq-btn${open ? " active" : ""}${count > 0 ? " has-open" : ""}`}
        title={count > 0 ? `${count} open question${count > 1 ? "s" : ""}` : "Open questions"}
        onClick={() => setOpen((o) => !o)}
      >
        ❓{count > 0 ? <span className="oq-count">{count}</span> : ""}
      </button>

      {open && (
        <div className="oq-popover" role="menu">
          <div className="oq-head">
            <span className="oq-title">Open questions</span>
            <span className="oq-sub">{count} unanswered</span>
          </div>
          {count === 0 ? (
            <p className="oq-empty">No open questions — every question you've left is answered.</p>
          ) : (
            <ul className="oq-list">
              {questions.map((n) => (
                <li key={n.id} className="oq-item">
                  <button className="oq-jump" onClick={() => jump(n)} title="Go to this ayah">
                    <span className="oq-text">{n.text}</span>
                    <span className="oq-loc">
                      {n.verseKey}
                      {surahName(n.verseKey) ? ` · ${surahName(n.verseKey)}` : ""}
                      {n.wordPosition != null && n.lemma ? (
                        <span className="oq-word quran"> · {n.lemma}</span>
                      ) : n.wordPosition != null ? (
                        <span className="oq-word"> · word {n.wordPosition}</span>
                      ) : null}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
