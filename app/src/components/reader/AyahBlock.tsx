// One ayah on the page: tappable word tokens + ornamental ayah number.
// Optional translation underlay, plus the reader's own research feedback:
// case marks on forms under investigation, interlinear gloss on established.

import { memo, useState } from "react";
import { api } from "../../api/client";
import { useAsync } from "../../hooks/useAsync";
import { useAppDispatch } from "../../state/store";
import type { Verse, Word } from "../../api/types";
import type { FormStatusRow } from "../../persistence/db";
import { VerseText } from "../VerseText";
import { NotesPanel } from "./NotesPanel";
import { arabicIndic } from "./format";
import type { FocusReason, FocusBase } from "./focus";
import type { NoteRecord } from "../../persistence/types";

export interface AyahCaseRef {
  caseId: string;
  title: string;
  status: string;
  /** the reader's established understanding, if this ayah has its own case */
  understanding: string | null;
  /** comment notes from the ayah's own case */
  notes: string[];
}

interface Props {
  verse: Verse;
  translationOn: boolean;
  translationId: number | null;
  myGlossOn: boolean;
  formStatus: Map<string, FormStatusRow> | null;
  /** cases in which this ayah sits as evidence */
  caseRefs: AyahCaseRef[] | null;
  /** root_arabic → total occurrences (for the rare-root ⚲ mark) */
  rareRoots: Map<string, number> | null;
  /** a trail-matched word position to light in gold, or null */
  highlightWord?: number | null;
  /** focus lens: roots to gold, roots to soft-tint, structure/target flags */
  focusRoots?: Set<string> | null;
  focusLinked?: Set<string> | null;
  focusPattern?: boolean;
  focusTarget?: boolean;
  focusReason?: FocusReason | null;
  /** the subject the lens compares everything against */
  focusBase?: FocusBase | null;
  /** human surah name for the base verse (e.g. "Al-Jumuʿah") */
  focusBaseSurah?: string | null;
  /** human surah name for this (the focused) verse */
  focusThisSurah?: string | null;
  /** notes/questions on this verse (ayah-level + word-level) */
  verseNotes?: NoteRecord[] | null;
  /** called when notes for this verse change, so the page refreshes marks */
  onNotesChanged?: () => void;
  onWordTap: (
    verseKey: string,
    position: number,
    token: string,
    word: Word | null,
    rect: DOMRect,
  ) => void;
}

function TranslationLine({ verseKey, resourceId }: { verseKey: string; resourceId: number | null }) {
  const tr = useAsync(() => api.verseTranslations(verseKey), [verseKey]);
  // chosen edition if set and present; else auto (first non-tafsir), else first
  const chosen = resourceId != null ? tr.data?.find((t) => t.resource_id === resourceId) : undefined;
  const shown = chosen ?? tr.data?.find((t) => t.resource_type !== "tafsir") ?? tr.data?.[0];
  if (tr.loading) return <div className="ayah-translation loading">…</div>;
  if (!shown) return null;
  return <div className="ayah-translation">{shown.text}</div>;
}

const RARE_MAX = 10;

// Roots read clearest as isolated letters (ض ل ل), so they don't ligature into
// an ambiguous blob. A hair space keeps the letters apart without joining.
const spacedRoot = (r: string) => r.split("").join(" ");

export const AyahBlock = memo(function AyahBlock({
  verse, translationOn, translationId, myGlossOn, formStatus, caseRefs, rareRoots, highlightWord,
  focusRoots, focusLinked, focusPattern, focusTarget, focusReason, focusBase, focusBaseSurah,
  focusThisSurah, verseNotes, onNotesChanged, onWordTap,
}: Props) {
  const text = typeof verse.text === "string" ? verse.text : "";
  const words = verse.words ?? null;
  const dispatch = useAppDispatch();
  const [casesOpen, setCasesOpen] = useState(false);
  const [whyOpen, setWhyOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);

  const noteCount = verseNotes?.length ?? 0;
  const notedWords = new Set(
    (verseNotes ?? []).filter((n) => n.wordPosition != null).map((n) => n.wordPosition as number),
  );
  const tokenFor = (position: number) =>
    words?.find((w) => w.position === position)?.arabic ?? null;

  const rowFor = (position: number): FormStatusRow | null => {
    if (!formStatus || !words) return null;
    const lemma = words.find((w) => w.position === position)?.lemma;
    return lemma ? formStatus.get(lemma) ?? null : null;
  };

  return (
    <div className={`ayah${focusPattern ? " focus-pattern" : ""}`} data-key={verse.verse_key}>
      <p className="ayah-text quran" dir="rtl">
        <VerseText
          text={text}
          highlightPosition={highlightWord ?? null}
          focusFor={(position) => {
            if (!words) return null;
            const root = words.find((w) => w.position === position)?.root;
            if (!root) return null;
            if (focusRoots?.has(root)) return "shared";
            if (focusLinked?.has(root)) return "linked";
            return null;
          }}
          hasNoteFor={(position) => notedWords.has(position)}
          onWordTap={(position, token, rect) => {
            const word = words?.find((w) => w.position === position) ?? null;
            onWordTap(verse.verse_key, position, token, word, rect);
          }}
          glossFor={(position) => {
            if (!myGlossOn) return null;
            const row = rowFor(position);
            return row?.status === "established" && row.meaning ? row.meaning : null;
          }}
          markFor={(position) => {
            const row = rowFor(position);
            if (row && row.status !== "established") return "open";
            const root = words?.find((w) => w.position === position)?.root;
            if (
              root && rareRoots &&
              (rareRoots.get(root) ?? Infinity) <= RARE_MAX
            ) return "rare";
            return null;
          }}
        />
        {focusTarget && (
          <button
            className={`focus-mark${whyOpen ? " active" : ""}`}
            title="Why is this ayah in the focus?"
            onClick={() => setWhyOpen((o) => !o)}
          >⊙</button>
        )}
        <span className="ayah-num" aria-label={`ayah ${verse.verse_number}`}>
          ﴿{arabicIndic(verse.verse_number)}﴾
        </span>
        {caseRefs && caseRefs.length > 0 && (
          <button
            className={`evidence-mark${casesOpen ? " active" : ""}${
              caseRefs.some((r) => r.understanding) ? " has-understanding" : ""
            }`}
            title={
              caseRefs.some((r) => r.understanding)
                ? "You have an established understanding of this ayah"
                : `This ayah is evidence in ${caseRefs.length} case${caseRefs.length > 1 ? "s" : ""}`
            }
            onClick={() => setCasesOpen(!casesOpen)}
          >
            {caseRefs.some((r) => r.understanding) ? "✒" : "⚖"}
            {caseRefs.length > 1 ? caseRefs.length : ""}
          </button>
        )}
        <button
          className={`note-mark${notesOpen ? " active" : ""}${noteCount ? " has-notes" : ""}`}
          title={noteCount ? `${noteCount} note${noteCount > 1 ? "s" : ""} / question(s)` : "Add a note or question"}
          onClick={() => setNotesOpen((o) => !o)}
        >
          ✎{noteCount > 0 ? noteCount : ""}
        </button>
      </p>

      {notesOpen && (
        <div className="ayah-notes">
          <NotesPanel
            verseKey={verse.verse_key}
            tokenFor={tokenFor}
            onChanged={onNotesChanged}
          />
        </div>
      )}
      {whyOpen && focusReason && (
        <div className="focus-why">
          <span className="fw-label">in focus because</span>
          {focusBase && (
            <span className="fw-part fw-base">
              compared with{" "}
              {focusBase.kind === "root"
                ? <span className="fw-root quran">{spacedRoot(focusBase.label)}</span>
                : (
                  <span className="fw-key">
                    {focusBase.label}{focusBaseSurah ? ` · ${focusBaseSurah}` : ""}
                  </span>
                )}
            </span>
          )}
          {focusReason.run.length > 1 && (
            <span className="fw-part fw-phrase">
              <span className="fw-part-label">shared phrase</span>
              <span className="fw-run quran" dir="rtl">
                {focusReason.run.map((r, i) => (
                  <span key={i} className="fw-chip">{spacedRoot(r)}</span>
                ))}
              </span>
              <span className="fw-run-len">{focusReason.run.length} roots in a row</span>
            </span>
          )}
          {focusReason.shared.length > 0 && (
            <span className="fw-part fw-shared">
              <span className="fw-part-label">
                shares root{focusReason.shared.length > 1 ? "s" : ""}
              </span>
              <span className="fw-chips">
                {focusReason.shared.map((r, i) => (
                  <span key={i} className="fw-chip quran">{spacedRoot(r)}</span>
                ))}
              </span>
            </span>
          )}
          {focusReason.pattern.length > 0 && (
            <span className="fw-part fw-struct">
              <span className="fw-struct-label">same structure</span>
              {focusBase && focusBase.pattern.length > 0 && (
                <span className="fw-seq fw-seq-base">
                  <span className="fw-seq-tag">
                    {focusBase.label}{focusBaseSurah ? ` · ${focusBaseSurah}` : ""}
                  </span>
                  {focusBase.pattern.join(" · ")}
                </span>
              )}
              <span className="fw-seq">
                <span className="fw-seq-tag">
                  {verse.verse_key}{focusThisSurah ? ` · ${focusThisSurah}` : ""}
                </span>
                {focusReason.pattern.join(" · ")}
              </span>
            </span>
          )}
          {focusReason.shared.length === 0 && focusReason.pattern.length === 0 && (
            <span className="fw-part">overall similarity</span>
          )}
        </div>
      )}

      {/* my gloss ON → the ayah's established understanding shows itself */}
      {!casesOpen && myGlossOn && caseRefs?.some((r) => r.understanding) && (
        <div className="ayah-understanding inline">
          <span className="au-label">✒</span>
          <p className="au-text">
            “{caseRefs.find((r) => r.understanding)!.understanding}”
          </p>
        </div>
      )}

      {casesOpen && caseRefs && (
        <div className="ayah-research">
          {caseRefs.filter((r) => r.understanding).map((r) => (
            <div key={`u_${r.caseId}`} className="ayah-understanding">
              <span className="au-label">✒ your understanding</span>
              <p className="au-text">“{r.understanding}”</p>
            </div>
          ))}
          {caseRefs.flatMap((r) =>
            r.notes.map((n, i) => (
              <div key={`n_${r.caseId}_${i}`} className="ayah-note">✎ {n}</div>
            )),
          )}
          <div className="ayah-cases">
            <span className="ayah-cases-label">
              {caseRefs.some((r) => r.understanding || r.notes.length)
                ? "from:" : "evidence in:"}
            </span>
            {caseRefs.map((r) => (
              <button
                key={r.caseId}
                className="chip case-chip"
                onClick={() => {
                  dispatch({ type: "setActiveCase", caseId: r.caseId });
                  dispatch({ type: "setTab", tab: "investigate" });
                }}
              >
                {r.title} <span className="chip-status">({r.status})</span>
              </button>
            ))}
          </div>
        </div>
      )}
      {translationOn && <TranslationLine verseKey={verse.verse_key} resourceId={translationId} />}
    </div>
  );
});
