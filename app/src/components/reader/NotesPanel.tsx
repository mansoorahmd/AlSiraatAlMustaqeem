// Notes & questions on an ayah or a specific word. Self-contained: loads its
// target's notes from research.db, and lets the reader add / edit / resolve /
// delete them. The very same panel is used while reading and on the
// investigation board, so a note written in one place shows up in the other.

import { useState } from "react";
import { useAsync } from "../../hooks/useAsync";
import { archive, newId } from "../../persistence/db";
import type { NoteKind, NoteRecord } from "../../persistence/types";

interface Props {
  verseKey: string;
  /** undefined → whole-verse panel (shows every note); number → one word */
  wordPosition?: number | null;
  /** form + root of the word, stored so notes cross-reference across the Book */
  wordLemma?: string | null;
  wordRoot?: string | null;
  /** render a word's Arabic token for labelling verse-scope word notes */
  tokenFor?: (position: number) => string | null;
  /** notify the parent so it can refresh its note indicators */
  onChanged?: () => void;
  compact?: boolean;
}

export function NotesPanel({
  verseKey, wordPosition, wordLemma, wordRoot, tokenFor, onChanged, compact,
}: Props) {
  const wordScope = typeof wordPosition === "number";
  const [version, setVersion] = useState(0);
  const notes = useAsync(() => archive.notes.forVerse(verseKey), [verseKey, version]);

  const [draft, setDraft] = useState("");
  const [kind, setKind] = useState<NoteKind>("note");
  const [busy, setBusy] = useState(false);
  const [answering, setAnswering] = useState<string | null>(null);
  const [answerDraft, setAnswerDraft] = useState("");

  const reload = () => { setVersion((v) => v + 1); onChanged?.(); };

  const shown = (notes.data ?? []).filter((n) =>
    wordScope ? n.wordPosition === wordPosition : true,
  );

  const add = async () => {
    const text = draft.trim();
    if (!text || busy) return;
    setBusy(true);
    const now = Date.now();
    const rec: NoteRecord = {
      id: newId("note"),
      verseKey,
      wordPosition: wordScope ? (wordPosition as number) : null,
      kind,
      text,
      answer: "",
      resolved: false,
      lemma: wordScope ? wordLemma ?? null : null,
      root: wordScope ? wordRoot ?? null : null,
      createdAt: now,
      updatedAt: now,
    };
    try {
      await archive.notes.save(rec);
      setDraft("");
      reload();
    } finally {
      setBusy(false);
    }
  };

  const toggleResolved = async (n: NoteRecord) => {
    await archive.notes.save({ ...n, resolved: !n.resolved });
    reload();
  };
  const remove = async (n: NoteRecord) => {
    await archive.notes.remove(n.id);
    reload();
  };
  const openAnswer = (n: NoteRecord) => {
    setAnswering(n.id);
    setAnswerDraft(n.answer ?? "");
  };
  const saveAnswer = async (n: NoteRecord) => {
    const text = answerDraft.trim();
    // writing an answer resolves the question; clearing it reopens
    await archive.notes.save({ ...n, answer: text, resolved: text.length > 0 });
    setAnswering(null);
    setAnswerDraft("");
    reload();
  };

  const label = (n: NoteRecord) => {
    if (n.wordPosition == null) return null;
    const tok = tokenFor?.(n.wordPosition);
    return (
      <span className="note-target quran">{tok ?? `word ${n.wordPosition}`}</span>
    );
  };

  return (
    <div className={`notes-panel${compact ? " compact" : ""}`}>
      {shown.length > 0 && (
        <ul className="note-list">
          {shown.map((n) => (
            <li key={n.id} className={`note-item note-${n.kind}${n.resolved ? " resolved" : ""}`}>
              <span className="note-icon" title={n.kind}>{n.kind === "question" ? "❓" : "✎"}</span>
              <div className="note-body">
                <p className="note-text">{n.text}</p>

                {/* the answer to a question */}
                {n.kind === "question" && n.answer && answering !== n.id && (
                  <p className="note-answer-text">↳ {n.answer}</p>
                )}
                {n.kind === "question" && answering === n.id && (
                  <div className="note-answer-edit">
                    <textarea
                      className="note-input"
                      rows={2}
                      autoFocus
                      placeholder="Write your answer…"
                      value={answerDraft}
                      onChange={(e) => setAnswerDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); saveAnswer(n); }
                      }}
                    />
                    <div className="note-actions">
                      <button className="note-mini" onClick={() => setAnswering(null)}>cancel</button>
                      <button className="ink-action" onClick={() => saveAnswer(n)}>Save answer</button>
                    </div>
                  </div>
                )}

                <div className="note-meta">
                  {!wordScope && label(n)}
                  {n.kind === "question" && answering !== n.id && (
                    <button className="note-mini" onClick={() => openAnswer(n)}>
                      {n.answer ? "edit answer" : "✍ answer"}
                    </button>
                  )}
                  {n.kind === "question" && n.resolved && (
                    <button className="note-mini" onClick={() => toggleResolved(n)}>reopen</button>
                  )}
                </div>
              </div>
              <button className="note-del" title="Delete" onClick={() => remove(n)}>✕</button>
            </li>
          ))}
        </ul>
      )}

      <div className="note-compose">
        <div className="note-kind-toggle">
          <button
            className={`nk ${kind === "note" ? "active" : ""}`}
            onClick={() => setKind("note")}
          >✎ Note</button>
          <button
            className={`nk ${kind === "question" ? "active" : ""}`}
            onClick={() => setKind("question")}
          >❓ Question</button>
        </div>
        <textarea
          className="note-input"
          rows={compact ? 2 : 2}
          placeholder={
            kind === "question"
              ? wordScope ? "Ask a question about this word…" : "Ask a question about this ayah…"
              : wordScope ? "Add a note on this word…" : "Add a note on this ayah…"
          }
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); add(); }
          }}
        />
        <div className="note-actions">
          <span className="note-hint">⌘/Ctrl + ↵</span>
          <button className="ink-action" onClick={add} disabled={busy || !draft.trim()}>
            Add
          </button>
        </div>
      </div>
    </div>
  );
}
