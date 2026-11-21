// The case verdict in the case details: a value with an Edit, not a standing form. Enter saves
// (Shift+Enter is a new line), Esc cancels. Beneath it, the earlier verdicts the reader replaced.
// The verdict is the reader's alone: an assistant can only propose one.

import { useState, type KeyboardEvent } from "react";
import type { CaseRecord } from "../../persistence/types";
import { useFeature } from "../../lib/features";
import { RevisionTrail } from "../research/RevisionTrail";

export function VerdictField({ caseRec, mutate }: { caseRec: CaseRecord; mutate: (next: CaseRecord) => void }) {
  const canEdit = useFeature("cases");
  const [draft, setDraft] = useState<string | null>(null);
  const value = caseRec.verdict ?? "";
  const labelId = `verdict-${caseRec.id}`;

  const save = () => {
    if (draft === null) return;
    const next = draft.trim();
    if (next !== value) mutate({ ...caseRec, verdict: next });
    setDraft(null);
  };
  const keys = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setDraft(null); }
    else if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); save(); }
  };

  return (
    <div className="verdict-field">
      <span className="sheet-label" id={labelId}>Verdict</span>
      {draft === null ? (
        <div className="falsifier-value">
          {value
            ? <p className="falsifier-text">{value}</p>
            : <p className="falsifier-text none">No verdict yet: what did you conclude?</p>}
          {canEdit && (
            <button className="ctl falsifier-edit" title="Edit the verdict" onClick={() => setDraft(value)}>
              <span className="falsifier-ic" aria-hidden="true">✎</span>Edit
            </button>
          )}
        </div>
      ) : (
        <>
          <textarea
            className="board-input"
            rows={3}
            autoFocus
            aria-labelledby={labelId}
            placeholder="your verdict — what did you conclude?"
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
      <RevisionTrail kind="verdict" target={caseRec.id} feature="cases" />
    </div>
  );
}
