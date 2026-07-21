// The Vault: family pages — the product of the research, derived from
// research.db. One entry per case: root, verdict, established forms.

import { archive } from "../persistence/db";
import { useAsync } from "../hooks/useAsync";
import { useAppDispatch } from "../state/store";
import { normalizeCase } from "../cases/ops";

function spaced(root: string): string {
  return root.split("").join(" ");
}

export function Vault() {
  const cases = useAsync(() => archive.cases.all(), []);
  const dispatch = useAppDispatch();

  const families = (cases.data ?? [])
    .map(normalizeCase)
    .map((c) => ({
      c,
      established: Object.entries(c.formResearch)
        .filter(([, fr]) => fr.status === "established"),
    }))
    .filter((f) => f.established.length > 0 || f.c.status !== "open");

  return (
    <div className="sheet">
      <h1>The Vault</h1>
      <p className="subtitle">
        Meanings you have established — your own lexicon, family by family.
      </p>
      <div className="rule">✦</div>

      {cases.loading && <p className="loading">Turning the key…</p>}

      {cases.data && families.length === 0 && (
        <div className="empty">
          <span className="glyph">✦</span>
          <p>Nothing established yet.</p>
          <p className="hint">
            Open a case, research a form on the board, and establish its
            meaning — it will be filed here, and appear under the words of
            the mushaf as your own gloss.
          </p>
        </div>
      )}

      {families.map(({ c, established }) => (
        <div key={c.id} className="family-page">
          <div className="family-head">
            <span
              className="case-root quran family-root"
              onClick={() => {
                dispatch({ type: "setActiveCase", caseId: c.id });
                dispatch({ type: "setTab", tab: "investigate" });
              }}
            >
              {c.subject.type === "root" ? spaced(c.subject.value) : c.subject.value}
            </span>
            <span className="stamp">{c.status.toUpperCase()}</span>
          </div>
          {c.verdict && <p className="family-verdict">“{c.verdict}”</p>}
          {established.length > 0 && (
            <dl className="family-forms">
              {established.map(([lemma, fr]) => (
                <div key={lemma} className="family-form-row">
                  <dt className="quran">{lemma}</dt>
                  <dd>{fr.meaning}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      ))}
    </div>
  );
}
