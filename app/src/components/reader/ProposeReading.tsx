// Propose a reading to the community — the app-side of the claim spine (Phase 5 was CLI-only).
//
// A claim is YOUR reading of one subject (a form or a root). It contends for the global slot;
// it never overwrites anyone else's. The one rule the form enforces is §12.1: a competing claim
// must carry its argument — a case, evidence, or reasoning — so reviewers have something to
// weigh. A bare meaning can't be submitted.
//
// Proposing writes upstream; it changes nothing locally. So on success we say so plainly and
// point the reader at Sync, rather than pretending the community list updated.

import { useState } from "react";
import { remote, RemoteOffline, RemoteError } from "../../api/remote";
import { useMe } from "../../hooks/useMe";

const spaced = (r: string) => r.split("").join(" ");

interface Props {
  subjectKind: "form" | "root";
  subjectValue: string;
  /** prefill from the reader's own indication, so proposing is one edit away */
  defaultMeaning?: string;
  /** if this reading came from a case, cite it — that satisfies "carry your argument" on its own */
  caseId?: string;
  onClose: () => void;
}

export function ProposeReading({ subjectKind, subjectValue, defaultMeaning, caseId, onClose }: Props) {
  const { me, loading } = useMe();
  const [meaning, setMeaning] = useState(defaultMeaning ?? "");
  const [argument, setArgument] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const hasArgument = !!caseId || !!argument.trim();
  const canSubmit = !!meaning.trim() && hasArgument && !busy;

  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      await remote.propose({
        subjectKind, subjectValue,
        payload: { meaning: meaning.trim(), argument: argument.trim() || undefined, caseId },
      });
      setDone(true);
    } catch (e) {
      setErr(
        e instanceof RemoteOffline ? "The research server isn't reachable — you may be offline, or not signed in."
        : e instanceof RemoteError && e.status === 401 ? "Sign in to the research community first."
        : (e as Error).message);
    } finally { setBusy(false); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="propose" onClick={(e) => e.stopPropagation()}>
        <header className="propose-head">
          <div>
            <p className="propose-title">Propose a reading to the community</p>
            <p className="propose-sub">
              {subjectKind === "root" ? "the root" : "the form"}{" "}
              <span className="quran">{subjectKind === "root" ? spaced(subjectValue) : subjectValue}</span>
            </p>
          </div>
          <button className="ie-close" onClick={onClose} title="Close">✕</button>
        </header>

        {done ? (
          <div className="propose-body">
            <p className="propose-ok">✓ Proposed. It now contends for the group's reading of this {subjectKind}.</p>
            <p className="acct-hint">
              It won't appear in your community list until you <strong>Sync with the group</strong> —
              proposing writes upstream and changes nothing here.
            </p>
            <div className="propose-actions"><button className="ctl primary" onClick={onClose}>Done</button></div>
          </div>
        ) : !loading && !me ? (
          <div className="propose-body">
            <p className="acct-error">Sign in to the research community to propose a reading.</p>
            <div className="propose-actions"><button className="ctl" onClick={onClose}>Close</button></div>
          </div>
        ) : (
          <div className="propose-body">
            <label className="propose-field">
              <span className="propose-label">Your reading</span>
              <textarea
                className="board-input" rows={2}
                placeholder="what this means, in your words…"
                value={meaning} onChange={(e) => setMeaning(e.target.value)}
              />
            </label>

            {caseId ? (
              <p className="acct-hint">Your argument is the case this reading came from — that travels with it.</p>
            ) : (
              <label className="propose-field">
                <span className="propose-label">
                  Your argument <span className="propose-req">— required</span>
                </span>
                <textarea
                  className="board-input" rows={4}
                  placeholder="why the Book's own usage supports this reading. Reviewers weigh this — a reading without it can't be submitted."
                  value={argument} onChange={(e) => setArgument(e.target.value)}
                />
              </label>
            )}

            {err && <p className="acct-error" role="alert">{err}</p>}
            <div className="propose-actions">
              <button className="ctl" onClick={onClose}>Cancel</button>
              <button className="ctl primary" disabled={!canSubmit} onClick={submit}>
                {busy ? "Proposing…" : "Propose"}
              </button>
            </div>
            {!hasArgument && meaning.trim() && (
              <p className="acct-hint">A reading needs its argument before it can be proposed.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
