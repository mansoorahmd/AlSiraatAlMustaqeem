// "What would prove this wrong?": the case's falsifier, in the reader's own words, shown beside
// the conclusion. It is a value with an Edit, not a standing form; Enter saves (Shift+Enter is a
// new line), Esc cancels. Like the verdict, it is the reader's alone: an assistant never writes it.

import { useState, type KeyboardEvent } from "react";
import type { CaseRecord } from "../../persistence/types";

export function FalsifierField({ caseRec, mutate }: { caseRec: CaseRecord; mutate: (next: CaseRecord) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const value = caseRec.falsifier ?? "";

  const save = () => {
    if (draft === null) return;
    mutate({ ...caseRec, falsifier: draft.trim() });
    setDraft(null);
  };
  const keys = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Escape") { e.preventDefault(); setDraft(null); }
    else if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); save(); }
  };

  return (
    <div className="falsifier">
      <span className="falsifier-label" id={`falsifier-${caseRec.id}`}>What would prove this wrong?</span>
      {draft === null ? (
        <div className="falsifier-value">
          {value
            ? <p className="falsifier-text">{value}</p>
            : <p className="falsifier-text none">Not said yet: name the kind of āyah that, if you found it, would overturn this reading.</p>}
          <button className="ctl falsifier-edit" title="Edit what would prove this wrong" onClick={() => setDraft(value)}>
            <span className="falsifier-ic" aria-hidden="true">✎</span>Edit
          </button>
        </div>
      ) : (
        <>
          <textarea
            className="board-input form-meaning-input"
            rows={2}
            autoFocus
            aria-labelledby={`falsifier-${caseRec.id}`}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={keys}
          />
          <div className="form-actions">
            <button className="ctl falsifier-edit" onClick={() => setDraft(null)}>Cancel</button>
            <button className="ctl primary" onClick={save}>Save</button>
          </div>
        </>
      )}
    </div>
  );
}
