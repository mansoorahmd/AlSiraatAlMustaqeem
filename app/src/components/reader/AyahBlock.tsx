// One ayah on the page: tappable word tokens + ornamental ayah number.
// Optional translation underlay, plus the reader's own research feedback:
// case marks on forms under investigation, interlinear gloss on established.

import { memo, useMemo, useState } from "react";
import { api } from "../../api/client";
import { useAsync } from "../../hooks/useAsync";
import { useAppDispatch } from "../../state/store";
import { useAddToCompare } from "../../compare/useAddToCompare";
import type { Verse, Word } from "../../api/types";
import type { FormStatusRow } from "../../persistence/db";
import { VerseText } from "../VerseText";
import { NotesPanel } from "./NotesPanel";
import { EchoPanel } from "./EchoPanel";
import { arabicIndic } from "./format";
import type { FocusReason, FocusBase } from "./focus";
import type { NoteRecord, HighlightRange } from "../../persistence/types";

const ECHO_WASH = "#fde68a"; // amber highlight for repeated phrase spans
const ROOT_ECHO_WASH = "#fcd34d"; // gold highlight for a root repeated in an āyah
const VARIANT_WASH = "#ddd6fe"; // violet highlight for rasm-variant words

// Root echo (↻): a root occurring 2+ times in one āyah. `adjacent` flags a tight
// repeat at neighbouring word positions (cognate accusative مفعول مطلق, emphatic).
function rootEcho(words: Word[] | null): { has: boolean; roots: Set<string>; adjacent: boolean } {
  const pos = new Map<string, number[]>();
  for (const w of words ?? []) {
    if (!w.root) continue;
    const a = pos.get(w.root);
    if (a) a.push(w.position);
    else pos.set(w.root, [w.position]);
  }
  const roots = new Set<string>();
  let adjacent = false;
  for (const [r, ps] of pos) {
    if (ps.length < 2) continue;
    roots.add(r);
    ps.sort((a, b) => a - b);
    for (let i = 1; i < ps.length; i++) if (ps[i]! - ps[i - 1]! === 1) adjacent = true;
  }
  return { has: roots.size > 0, roots, adjacent };
}

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
  /** "root lemma" → this form's refinement of the root's primary sense */
  senseRefine?: Map<string, string> | null;
  /** root → the root's primary sense text (fallback when the form isn't refined) */
  senseRootText?: Map<string, string> | null;
  /** lemma → standalone primary sense (rootless words) */
  senseLemmaText?: Map<string, string> | null;
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
  /** the surah's name — shown on hover over the ayah end mark */
  surahName?: string | null;
  /** notes/questions on this verse (ayah-level + word-level) */
  verseNotes?: NoteRecord[] | null;
  /** called when notes for this verse change, so the page refreshes marks */
  onNotesChanged?: () => void;
  /** this ayah contains a phrase repeated verbatim elsewhere (V10 echoes) */
  hasEcho?: boolean;
  /** word positions in this ayah whose spelling varies across the mushaf (✍) */
  variantPositions?: number[] | null;
  /** echo-lens: a word-position span to keep lit in this verse after a jump */
  echoHighlightRange?: { start: number; end: number } | null;
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

/** the surah number out of a "2:127" verse key */
const chapterOf = (verseKey: string) => parseInt(verseKey.split(":")[0] ?? "", 10);

// Roots read clearest as isolated letters (ض ل ل), so they don't ligature into
// an ambiguous blob. A hair space keeps the letters apart without joining.
const spacedRoot = (r: string) => r.split("").join(" ");

export const AyahBlock = memo(function AyahBlock({
  verse, translationOn, translationId, myGlossOn, formStatus, senseRefine, senseRootText, senseLemmaText, caseRefs, rareRoots, highlightWord,
  focusRoots, focusLinked, focusPattern, focusTarget, focusReason, focusBase, focusBaseSurah,
  focusThisSurah, surahName, verseNotes, onNotesChanged, hasEcho, variantPositions, echoHighlightRange, onWordTap,
}: Props) {
  const text = typeof verse.text === "string" ? verse.text : "";
  const words = verse.words ?? null;
  const dispatch = useAppDispatch();
  const addToCompare = useAddToCompare();
  const [casesOpen, setCasesOpen] = useState(false);
  const [whyOpen, setWhyOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [echoOpen, setEchoOpen] = useState(false);
  const [rootEchoOpen, setRootEchoOpen] = useState(false);
  const [variantOpen, setVariantOpen] = useState(false);
  const echo = rootEcho(words);

  // echoes for this verse, fetched only while the panel is open
  const echoData = useAsync(
    () => (echoOpen ? api.verseEchoes(verse.verse_key) : Promise.resolve([])),
    [echoOpen, verse.verse_key],
  );
  // spans to wash amber: every repeated phrase while the panel is open, plus
  // the echo-lens span we followed here (persists after a jump). Positions come
  // straight from the index (word ordinals), which align with VerseText.
  const echoRanges: HighlightRange[] = [];
  if (echoOpen) {
    for (const e of echoData.data ?? []) {
      echoRanges.push({ start: e.start, end: e.start + e.length - 1, color: ECHO_WASH });
    }
  }
  if (echoHighlightRange) {
    echoRanges.push({ start: echoHighlightRange.start, end: echoHighlightRange.end, color: ECHO_WASH });
  }
  // root echo: light every word whose root repeats in this āyah
  if (rootEchoOpen && words) {
    for (const w of words) {
      if (w.root && echo.roots.has(w.root)) {
        echoRanges.push({ start: w.position, end: w.position, color: ROOT_ECHO_WASH });
      }
    }
  }
  // rasm variants: light every word written more than one way in the mushaf
  if (variantOpen && variantPositions) {
    for (const p of variantPositions) echoRanges.push({ start: p, end: p, color: VARIANT_WASH });
  }

  const noteCount = verseNotes?.length ?? 0;
  const notedWords = new Set(
    (verseNotes ?? []).filter((n) => n.wordPosition != null).map((n) => n.wordPosition as number),
  );
  // O(1) position → word lookup, built once. VerseText calls the *For helpers
  // once per token; a linear .find each time made rendering O(words²) per āyah,
  // which bites hard on long surahs once glosses/marks are on.
  const wordByPos = useMemo(() => {
    const m = new Map<number, Word>();
    for (const w of words ?? []) if (w.position != null) m.set(w.position, w);
    return m;
  }, [words]);

  const tokenFor = (position: number) => wordByPos.get(position)?.arabic ?? null;

  const rowFor = (position: number): FormStatusRow | null => {
    if (!formStatus) return null;
    const lemma = wordByPos.get(position)?.lemma;
    return lemma ? formStatus.get(lemma) ?? null : null;
  };

  return (
    <div className={`ayah${focusPattern ? " focus-pattern" : ""}`} data-key={verse.verse_key}>
      <p className="ayah-text quran" dir="rtl">
        <VerseText
          text={text}
          highlightPosition={highlightWord ?? null}
          highlightRanges={echoRanges.length ? echoRanges : undefined}
          focusFor={(position) => {
            const root = wordByPos.get(position)?.root;
            if (!root) return null;
            if (focusRoots?.has(root)) return "shared";
            if (focusLinked?.has(root)) return "linked";
            return null;
          }}
          hasNoteFor={(position) => notedWords.has(position)}
          onWordTap={(position, token, rect) => {
            onWordTap(verse.verse_key, position, token, wordByPos.get(position) ?? null, rect);
          }}
          glossFor={(position) => {
            if (!myGlossOn) return null;
            const w = wordByPos.get(position);
            // Roots you've given a sense are a small set, so one cheap lookup
            // decides whether any sense work is needed for this word at all.
            if (w?.root) {
              const rootText = senseRootText?.get(w.root);
              if (rootText !== undefined) {
                // 1) this form's refinement of the root's primary sense. Try the
                // key as-is, then NFC-normalised (Arabic can arrive composed or
                // decomposed from different endpoints — only checked on a miss).
                if (w.lemma) {
                  const r =
                    senseRefine?.get(`${w.root} ${w.lemma}`) ??
                    senseRefine?.get(`${w.root} ${w.lemma.normalize("NFC")}`);
                  if (r) return r;
                }
                // 2) else the root's primary sense text
                return rootText;
              }
            }
            // 3) rootless word: its standalone primary sense
            if (w && !w.root && w.lemma) {
              const lt = senseLemmaText?.get(w.lemma);
              if (lt) return lt;
            }
            // 4) else the established meaning from this ayah's own case
            const row = rowFor(position);
            return row?.status === "established" && row.meaning ? row.meaning : null;
          }}
          markFor={(position) => {
            const row = rowFor(position);
            if (row && row.status !== "established") return "open";
            const root = wordByPos.get(position)?.root;
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
        <span
          className="ayah-num"
          title={`${surahName ? `${surahName} · ` : ""}${verse.verse_key}`}
          aria-label={`${surahName ? `${surahName}, ` : ""}ayah ${verse.verse_key}`}
        >
          ﴿{arabicIndic(chapterOf(verse.verse_key))}:{arabicIndic(verse.verse_number)}﴾
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
        {hasEcho && (
          <button
            className={`echo-mark${echoOpen ? " active" : ""}`}
            title="This ayah contains a phrase repeated elsewhere in the Book"
            onClick={() => setEchoOpen((o) => !o)}
          >≡</button>
        )}
        {variantPositions && variantPositions.length > 0 && (
          <button
            className={`variant-mark${variantOpen ? " active" : ""}`}
            title={`${variantPositions.length} word${variantPositions.length > 1 ? "s are" : " is"} written more than one way in the mushaf. Tap to highlight; tap the word for details.`}
            onClick={() => setVariantOpen((o) => !o)}
          >✍</button>
        )}
        {echo.has && (
          <button
            className={`rootecho-mark${echo.adjacent ? " adjacent" : ""}${rootEchoOpen ? " active" : ""}`}
            title={
              echo.adjacent
                ? "A root repeats at adjacent words here — often a cognate accusative (مفعول مطلق) for emphasis. Tap to light every repeated root."
                : "A root repeats within this ayah. Tap to light every repeated root."
            }
            onClick={() => setRootEchoOpen((o) => !o)}
          >↻</button>
        )}
        <button
          className="cmp-pin"
          title="Add this ayah to your active comparison"
          onClick={() => addToCompare("ayah", verse.verse_key)}
        >⇋</button>
      </p>

      {echoOpen && <EchoPanel echoes={echoData.data ?? []} loading={echoData.loading} />}

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
