// "Earlier versions (n)": the texts the reader replaced (a form's meaning, a verdict, a root
// meaning, an indication), each with its date and, if they say, why they changed it. The server
// keeps a revision when a text that had stood for a while is replaced, so this re-reads after a
// save: whoever saves calls revisionsMayHaveChanged(). With no earlier versions it renders nothing.
// It records what the reader decided; it never compares the versions or rates them.

import { useCallback, useEffect, useState, type KeyboardEvent } from "react";
import { archive } from "../../persistence/db";
import type { Revision, RevisionKind } from "../../persistence/types";
import { useFeature, type PlanFeature } from "../../lib/features";

const listeners = new Set<() => void>();

/** Ask every open trail to re-read: call after a save that may have replaced one of these texts. */
export function revisionsMayHaveChanged(): void {
  for (const fn of listeners) fn();
}

const when = (t: number) =>
  new Date(t).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

interface Props {
  kind: RevisionKind;
  /** form: `${caseId}|${lemma}`; verdict: the case id; root-meaning: the root (Buckwalter);
   *  indication: the indication's id */
  target: string;
  /** the plan feature that lets the reader change this text; locked = read-only */
  feature: PlanFeature;
}

export function RevisionTrail({ kind, target, feature }: Props) {
  const canEdit = useFeature(feature);
  const [revs, setRevs] = useState<Revision[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    let cancelled = false;
    archive.revisions.list(kind, target).then(
      (r) => { if (!cancelled) setRevs([...r].sort((a, b) => b.replacedAt - a.replacedAt)); },
      // a trail that cannot be read stays out of the way; the text itself is unaffected
      () => { if (!cancelled) setRevs(null); },
    );
    return () => { cancelled = true; };
  }, [kind, target]);

  useEffect(() => {
    let cancel = load();
    const again = () => { cancel(); cancel = load(); };
    listeners.add(again);
    return () => { cancel(); listeners.delete(again); };
  }, [load]);

  if (!revs || revs.length === 0) return null;

  const replace = (next: Revision) => setRevs((rs) => (rs ?? []).map((r) => (r.id === next.id ? next : r)));
  const drop = (id: string) => setRevs((rs) => (rs ?? []).filter((r) => r.id !== id));

  return (
    <details className="rev-trail">
      <summary className="rev-trail-summary">Earlier versions ({revs.length})</summary>
      {error && <p className="acct-error rev-trail-error" role="alert">{error}</p>}
      <ol className="rev-trail-list">
        {revs.map((r) => (
          <RevisionEntry
            key={r.id}
            rev={r}
            canEdit={canEdit}
            onSaved={replace}
            onRemoved={drop}
            onError={setError}
          />
        ))}
      </ol>
    </details>
  );
}

function RevisionEntry({ rev, canEdit, onSaved, onRemoved, onError }: {
  rev: Revision;
  canEdit: boolean;
  onSaved: (r: Revision) => void;
  onRemoved: (id: string) => void;
  onError: (msg: string | null) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const reasonId = `rev-why-${rev.id}`;

  const save = async () => {
    if (draft === null) return;
    setBusy(true);
    onError(null);
    try {
      const saved = await archive.revisions.setReason(rev.id, draft.trim());
      onSaved({ ...rev, ...saved, reason: saved?.reason ?? draft.trim() });
      setDraft(null);
    } catch (e) {
      onError(`Couldn't save why you changed it: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    setBusy(true);
    onError(null);
    try {
      await archive.revisions.remove(rev.id);
      onRemoved(rev.id);
    } catch (e) {
      onError(`Couldn't remove that earlier version: ${(e as Error).message}`);
      setBusy(false);
      setConfirming(false);
    }
  };
  const keys = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setDraft(null); }
    else if (e.key === "Enter") { e.preventDefault(); void save(); }
  };

  return (
    <li className="rev-entry">
      <div className="rev-entry-head">
        <span className="rev-entry-date">Replaced {when(rev.replacedAt)}</span>
        {canEdit && !confirming && (
          <button
            className="ctl rev-remove"
            title="Remove this earlier version"
            aria-label={`Remove the version replaced ${when(rev.replacedAt)}`}
            onClick={() => setConfirming(true)}
          ><span className="rev-ic" aria-hidden="true">✕</span>Remove</button>
        )}
      </div>
      <p className="rev-entry-text">{rev.before || <em className="rev-none">(empty)</em>}</p>
      {confirming && (
        <div className="rx-confirm rev-confirm">
          <span className="rx-confirm-q">Remove this earlier version for good?</span>
          <button className="ctl rev-secondary" disabled={busy} onClick={() => setConfirming(false)}>Keep it</button>
          <button className="ctl primary" disabled={busy} onClick={() => void remove()}>Remove</button>
        </div>
      )}
      <div className="rev-why">
        <span className="rev-why-label" id={reasonId}>Why I changed it</span>
        {draft === null ? (
          <div className="rev-why-value">
            {rev.reason
              ? <p className="rev-why-text">{rev.reason}</p>
              : <p className="rev-why-text none">Not said.</p>}
            {canEdit && (
              <button
                className="ctl rev-secondary"
                title="Say why you changed it"
                aria-label="Edit why I changed it"
                onClick={() => setDraft(rev.reason)}
              ><span className="rev-ic" aria-hidden="true">✎</span>Edit</button>
            )}
          </div>
        ) : (
          <div className="rev-why-edit">
            <input
              className="board-input rev-why-input"
              autoFocus
              aria-labelledby={reasonId}
              value={draft}
              placeholder="what made you change it…"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={keys}
            />
            <div className="rev-why-actions">
              <button className="ctl rev-secondary" disabled={busy} onClick={() => setDraft(null)}>Cancel</button>
              <button className="ctl primary" disabled={busy} onClick={() => void save()}>Save</button>
            </div>
          </div>
        )}
      </div>
    </li>
  );
}
