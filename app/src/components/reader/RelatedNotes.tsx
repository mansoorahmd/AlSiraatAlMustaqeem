// Cross-references for the tapped word: notes & questions the reader has left
// on the SAME word (exact form) or on OTHER forms of the same root, anywhere
// in the Book. Lets you peek and jump straight there — so an open question on
// one form is visible from every other form of the root.

import { useState } from "react";
import { useAsync } from "../../hooks/useAsync";
import { archive } from "../../persistence/db";
import { useAppDispatch } from "../../state/store";
import type { NoteRecord } from "../../persistence/types";
import { spacedRoot } from "./format";

interface Props {
  root: string;
  lemma: string | null;
  currentKey: string;
  currentPosition: number;
  onJump?: () => void;
}

export function RelatedNotes({ root, lemma, currentKey, currentPosition, onJump }: Props) {
  const dispatch = useAppDispatch();
  const [open, setOpen] = useState(false);
  const notes = useAsync(() => archive.notes.forRoot(root), [root]);

  const all = (notes.data ?? []).filter(
    (n) => !(n.verseKey === currentKey && n.wordPosition === currentPosition),
  );
  if (notes.loading || all.length === 0) return null;

  const sameForm = all.filter((n) => lemma && n.lemma === lemma);
  const otherForms = all.filter((n) => !lemma || n.lemma !== lemma);
  const openQ = all.filter((n) => n.kind === "question" && !n.resolved).length;

  const jump = (n: NoteRecord) => {
    dispatch({ type: "jumpToVerse", verseKey: n.verseKey, wordPosition: n.wordPosition });
    onJump?.();
  };

  const row = (n: NoteRecord) => (
    <li key={n.id} className={`rn-item rn-${n.kind}${n.resolved ? " resolved" : ""}`}>
      <span className="rn-icon" title={n.kind}>
        {n.kind === "question" ? (n.resolved ? "✓" : "❓") : "✎"}
      </span>
      <div className="rn-main">
        <p className="rn-text">{n.text}</p>
        {n.kind === "question" && n.answer && <p className="rn-answer">↳ {n.answer}</p>}
      </div>
      <button className="rn-jump" onClick={() => jump(n)} title={`Go to ${n.verseKey}`}>
        {n.verseKey} →
      </button>
    </li>
  );

  return (
    <div className="wm-related">
      <button className="ctl wm-related-toggle" onClick={() => setOpen((o) => !o)}>
        {open
          ? "hide related notes"
          : `🔗 ${all.length} note${all.length > 1 ? "s" : ""} on this root${openQ ? ` · ${openQ} open ?` : ""}`}
      </button>
      {open && (
        <div className="rn-body">
          {sameForm.length > 0 && (
            <>
              <div className="rn-group-label">
                same word {lemma && <span className="quran rn-form">{lemma}</span>}
              </div>
              <ul className="rn-list">{sameForm.map(row)}</ul>
            </>
          )}
          {otherForms.length > 0 && (
            <>
              <div className="rn-group-label">
                other forms of root <span className="quran">{spacedRoot(root)}</span>
              </div>
              <ul className="rn-list">{otherForms.map(row)}</ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
