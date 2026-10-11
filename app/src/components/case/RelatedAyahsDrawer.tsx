// Evidence drawer for AYAH cases: related ayahs from the similarity engine
// (shared roots / phrases / morphology), each pullable onto the board.

import { api } from "../../api/client";
import { useAsync } from "../../hooks/useAsync";
import type { CaseRecord } from "../../persistence/types";
import { VerseText } from "../VerseText";

interface Props {
  verseKey: string;
  caseRec: CaseRecord;
  onToggle: (verseKey: string) => void;
}

export function RelatedAyahsDrawer({ verseKey, caseRec, onToggle }: Props) {
  const matches = useAsync(() => api.similar(verseKey, { top_k: 60 }), [verseKey]);
  const onBoard = new Set(caseRec.cards.map((c) => c.verseKey));

  return (
    <section className="drawer">
      <header className="drawer-head">
        <h2>Related ayahs</h2>
        {matches.data && <span className="drawer-count">{matches.data.length} candidates</span>}
        <span className="spacer" />
        <span className="drawer-count">ranked by shared roots · phrases · patterns</span>
      </header>

      {matches.loading && <p className="loading">Consulting the similarity engine…</p>}
      {matches.error && (
        <p className="error-note">Could not fetch related ayahs ({matches.error.message}).</p>
      )}

      <div className="drawer-cards">
        {matches.data?.map((m) => (
          <div
            key={m.verse_key}
            className={`evidence-card${onBoard.has(m.verse_key) ? " on-desk" : ""}`}
            role="button"
            tabIndex={0}
            onClick={() => onToggle(m.verse_key)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(m.verse_key); }
            }}
            title={onBoard.has(m.verse_key) ? "Remove from the board" : "Pull onto the board"}
          >
            <div className="ec-head">
              <span className="stamp">{m.verse_key}</span>
              <span className="ec-form">{Math.round(m.score * 100)}%</span>
              <span className="ec-pull">{onBoard.has(m.verse_key) ? "on board ✓" : "pull ➔"}</span>
            </div>
            {m.text && (
              <p className="ec-text quran" dir="rtl">
                <VerseText text={m.text} />
              </p>
            )}
            {m.shared.length > 0 && (
              <div className="card-clusters" dir="rtl">{m.shared.join(" · ")}</div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
