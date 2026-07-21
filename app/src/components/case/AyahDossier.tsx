// The ayah dossier: for a case whose subject is a whole ayah. Lists the
// ayah's words with their roots (each a doorway to a root case), and holds
// one "understanding" to establish, then the verdict.

import { useState } from "react";
import { api } from "../../api/client";
import { useAsync } from "../../hooks/useAsync";
import { useAppDispatch } from "../../state/store";
import type { CaseRecord } from "../../persistence/types";
import {
  openOrCreateRootCase, withFormEstablished, withFormReopened,
  withCaseClosed, withCaseReopened,
} from "../../cases/ops";
import { fetchFormRevisions, type FormRevision } from "../../persistence/db";

interface Props {
  caseRec: CaseRecord;
  mutate: (next: CaseRecord) => void;
}

function Revisions({ caseId, lemma }: { caseId: string; lemma: string }) {
  const revs = useAsync<FormRevision[]>(
    () => fetchFormRevisions(caseId, lemma),
    [caseId, lemma],
  );
  if (!revs.data || revs.data.length === 0) return null;
  return (
    <div className="revisions">
      <span className="rev-title">earlier readings:</span>
      {revs.data.map((r, i) => (
        <div key={i} className="rev-row">
          “{r.meaning}” <span className="rev-date">
            — {new Date(r.replaced_at).toLocaleDateString()}
          </span>
        </div>
      ))}
    </div>
  );
}

export function AyahDossier({ caseRec, mutate }: Props) {
  const dispatch = useAppDispatch();
  const verseKey = caseRec.subject.value;
  const words = useAsync(() => api.verseWords(verseKey), [verseKey]);
  const [draft, setDraft] = useState<string | null>(null);
  const [verdictDraft, setVerdictDraft] = useState<string | null>(null);

  const fr = caseRec.formResearch[verseKey];
  const established = fr?.status === "established";

  const establish = () => {
    const meaning = (draft ?? fr?.meaning ?? "").trim();
    if (!meaning) return;
    mutate(withFormEstablished(caseRec, verseKey, meaning));
    setDraft(null);
  };

  const closeCase = () => {
    const v = (verdictDraft ?? caseRec.verdict).trim();
    if (!v) return;
    mutate(withCaseClosed(caseRec, v, [verseKey]));
    setVerdictDraft(null);
  };

  const openRoot = async (root: string) => {
    const c = await openOrCreateRootCase(root);
    dispatch({ type: "openCaseStacked", caseId: c.id });
  };

  return (
    <aside className="ledger dossier">
      <h2>Ayah dossier</h2>

      <div className="ledger-subject">
        <div className="ledger-root">{verseKey}</div>
        <span className="stamp">{caseRec.status.toUpperCase()}</span>
      </div>

      {/* the ayah's words: each root is a doorway to its own case */}
      {words.data && (
        <div className="ayah-words">
          {words.data
            .filter((w) => w.arabic)
            .map((w) => (
              <div key={w.position} className="ayah-word-row">
                <span className="aw-arabic quran">{w.arabic}</span>
                {w.root ? (
                  <button
                    className="tbtn tiny aw-root"
                    title="Open this root's case"
                    onClick={() => void openRoot(w.root!)}
                  >
                    {w.root.split("").join(" ")}
                  </button>
                ) : (
                  <span className="aw-particle">particle</span>
                )}
                {w.transliteration && (
                  <span className="aw-translit">{w.transliteration}</span>
                )}
              </div>
            ))}
        </div>
      )}

      {/* the understanding of this ayah */}
      <div className="form-expand">
        {established && draft === null ? (
          <>
            <div className="form-established-meaning">“{fr!.meaning}”</div>
            <div className="form-actions">
              <button className="ctl" onClick={() => setDraft(fr!.meaning)}>✒ update</button>
              <button className="ctl" onClick={() => mutate(withFormReopened(caseRec, verseKey))}>
                ↻ reopen
              </button>
            </div>
          </>
        ) : (
          <>
            <textarea
              className="board-input form-meaning-input"
              rows={3}
              placeholder="your understanding of this ayah, from the evidence gathered…"
              value={draft ?? fr?.meaning ?? ""}
              onChange={(e) => setDraft(e.target.value)}
            />
            <div className="form-actions">
              <button
                className="ctl establish-btn"
                disabled={!(draft ?? fr?.meaning ?? "").trim()}
                onClick={establish}
              >
                ✒ establish understanding
              </button>
            </div>
          </>
        )}
        <Revisions caseId={caseRec.id} lemma={verseKey} />
      </div>

      {/* verdict */}
      <div className="verdict-block">
        {established ? (
          caseRec.status === "open" ? (
            <>
              <p className="ledger-line"><strong>Understanding established.</strong> Close with a verdict:</p>
              <textarea
                className="board-input form-meaning-input"
                rows={2}
                placeholder="the final word on this ayah…"
                value={verdictDraft ?? caseRec.verdict}
                onChange={(e) => setVerdictDraft(e.target.value)}
              />
              <button
                className="ctl establish-btn"
                disabled={!(verdictDraft ?? caseRec.verdict).trim()}
                onClick={closeCase}
              >
                🔏 close the case
              </button>
            </>
          ) : (
            <>
              <p className="ledger-line verdict-final">“{caseRec.verdict}”</p>
              <button className="ctl" onClick={() => mutate(withCaseReopened(caseRec))}>
                ↻ reopen case
              </button>
            </>
          )
        ) : (
          <p className="ledger-line">Establish your understanding to unlock the verdict.</p>
        )}
      </div>
    </aside>
  );
}
