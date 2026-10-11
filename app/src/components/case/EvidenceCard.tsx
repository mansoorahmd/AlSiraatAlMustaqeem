// One occurrence of the subject, as an evidence card. The subject word is
// inked in gold. No glosses, no meanings — the seal discipline applies.

import { memo } from "react";
import type { RootOccurrence } from "../../api/types";
import { VerseText } from "../VerseText";

interface Props {
  occ: RootOccurrence;
  onDesk: boolean;
  onToggle: (occ: RootOccurrence) => void;
}

export const EvidenceCard = memo(function EvidenceCard({ occ, onDesk, onToggle }: Props) {
  return (
    <div
      className={`evidence-card${onDesk ? " on-desk" : ""}`}
      onClick={() => onToggle(occ)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggle(occ);
        }
      }}
      title={onDesk ? "Return this card to the drawer" : "Pull this card onto the desk"}
    >
      <div className="ec-head">
        <span className="stamp">{occ.verse_key}</span>
        {occ.form_arabic && <span className="ec-form quran">{occ.form_arabic}</span>}
        <span className="ec-pull">{onDesk ? "on the desk ✓" : "pull ➔"}</span>
      </div>
      <p className="ec-text quran" dir="rtl">
        <VerseText text={occ.verse_text ?? ""} highlightPosition={occ.word_position} />
      </p>
    </div>
  );
});
