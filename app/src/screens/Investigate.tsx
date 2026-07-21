// Investigate: the case archive (list of case files) ↔ the case desk.

import { archive } from "../persistence/db";
import { useAsync } from "../hooks/useAsync";
import { useAppState, useAppDispatch } from "../state/store";
import { CaseDesk } from "../components/case/CaseDesk";

function spaced(root: string): string {
  return root.split("").join(" ");
}

export function Investigate() {
  const { activeCaseId } = useAppState();
  const dispatch = useAppDispatch();
  const cases = useAsync(() => archive.cases.all(), [activeCaseId]);

  if (activeCaseId) {
    return (
      <CaseDesk
        caseId={activeCaseId}
        onBackToArchive={() => dispatch({ type: "setActiveCase", caseId: null })}
      />
    );
  }

  return (
    <div className="sheet">
      <h1>The Case Archive</h1>
      <p className="subtitle">Open investigations and closed verdicts, kept under seal.</p>
      <div className="rule">🔏</div>

      {cases.loading && <p className="loading">Opening the drawer…</p>}

      {cases.data && cases.data.length === 0 && (
        <div className="empty">
          <span className="glyph">⚲</span>
          <p>No cases yet.</p>
          <p className="hint">
            Go to the Reading Room, press on any word, and choose “Open a case.”
          </p>
        </div>
      )}

      {cases.data && cases.data.length > 0 && (
        <ul className="case-list">
          {[...cases.data]
            .sort((a, b) => b.updatedAt - a.updatedAt)
            .map((c) => (
              <li
                key={c.id}
                className="case-row"
                onClick={() => dispatch({ type: "setActiveCase", caseId: c.id })}
              >
                <span className="stamp">{c.status.toUpperCase()}</span>
                <span className="case-root quran">
                  {c.subject.type === "root" ? spaced(c.subject.value) : c.subject.value}
                </span>
                <span className="dots" />
                <span className="case-meta">
                  {c.description ? `${c.description.slice(0, 60)}${c.description.length > 60 ? "…" : ""} · ` : ""}
                  {c.cards.length} on desk
                  {c.subject.sparkVerseKey ? ` · sparked at ${c.subject.sparkVerseKey}` : ""}
                </span>
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}
