// The Reading Room's reader: one surah as a continuous manuscript page.
// Serene by default; every word quietly opens the ink-stamp menu.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../api/client";
import { useAsync } from "../../hooks/useAsync";
import { archive, fetchFormStatus, type FormStatusRow } from "../../persistence/db";
import { normalizeCase } from "../../cases/ops";
import { useAppState, useAppDispatch } from "../../state/store";
import type { Script, Word, Chapter } from "../../api/types";
import type { NoteRecord } from "../../persistence/types";
import { AyahBlock } from "./AyahBlock";
import { WordMenu, type WordMenuTarget } from "./WordMenu";
import { SenseEditor } from "./SenseEditor";
import { TrailStrip } from "./TrailStrip";
import { buildFocusSpec, buildAyahFocus } from "./focus";
import { FocusMap } from "./FocusMap";

const SCRIPTS: { id: Script; label: string; fontClass: string }[] = [
  { id: "uthmani", label: "عثماني", fontClass: "script-uthmani" },
  { id: "imlaei", label: "إملائي", fontClass: "script-imlaei" },
  { id: "indopak", label: "ہندی", fontClass: "script-indopak" },
];

interface Props {
  chapters: Chapter[];
  onBackToIndex: () => void;
}

export function Reader({ chapters, onBackToIndex }: Props) {
  const { reading, activeTrailId, jumpToVerseKey, trailHighlight, echoHighlight, focusCaseId, focusAyahKey } =
    useAppState();
  const dispatch = useAppDispatch();
  const { surahId, script, translationOn, myGlossOn, fontScale } = reading;

  const chapter = chapters.find((c) => c.id === surahId) ?? null;
  const verses = useAsync(
    () => api.chapterVerses(surahId, { script, words: true }),
    [surahId, script],
  );

  // ayahs that sit as evidence in cases: verseKey → cases
  const allCases = useAsync(() => archive.cases.all(), [surahId]);
  const evidenceMap = useMemo(() => {
    if (!allCases.data) return null;
    const m = new Map<string, {
      caseId: string; title: string; status: string;
      understanding: string | null; notes: string[];
    }[]>();
    for (const raw of allCases.data) {
      const c = normalizeCase(raw);
      // an ayah case carries the reader's own understanding + notes
      const isAyahCase = c.subject.type === "ayah";
      const understanding = isAyahCase
        ? c.formResearch[c.subject.value]?.status === "established"
          ? c.formResearch[c.subject.value].meaning
          : null
        : null;
      const notes = isAyahCase
        ? c.slips.filter((sl) => sl.kind === "comment" && sl.text.trim()).map((sl) => sl.text)
        : [];
      const seen = new Set<string>();
      for (const card of c.cards) {
        if (seen.has(card.verseKey)) continue;
        seen.add(card.verseKey);
        const list = m.get(card.verseKey) ?? [];
        list.push({
          caseId: c.id,
          title: c.title,
          status: c.status,
          // understanding/notes belong only on the subject ayah itself
          understanding: isAyahCase && card.verseKey === c.subject.value ? understanding : null,
          notes: isAyahCase && card.verseKey === c.subject.value ? notes : [],
        });
        m.set(card.verseKey, list);
      }
    }
    return m;
  }, [allCases.data]);

  // rare roots — the ⚲ detective bait (fetched once, tiny payload)
  const rootFreq = useAsync(async () => {
    const roots = await api.listRoots({ order_by: "count", limit: 2000 });
    const m = new Map<string, number>();
    for (const r of roots) m.set(r.root_arabic, r.total_occurrences);
    return m;
  }, []);

  // notes & questions on ayahs/words — loaded once, refreshed on edit
  const [notesVersion, setNotesVersion] = useState(0);
  const notesAll = useAsync(() => archive.notes.all(), [notesVersion]);
  const notesMap = useMemo(() => {
    const m = new Map<string, NoteRecord[]>();
    for (const n of notesAll.data ?? []) {
      const list = m.get(n.verseKey) ?? [];
      list.push(n);
      m.set(n.verseKey, list);
    }
    return m;
  }, [notesAll.data]);
  const bumpNotes = useCallback(() => setNotesVersion((v) => v + 1), []);

  // verbatim-echo marks: which ayahs in this surah carry a repeated phrase
  const echoKeys = useAsync(() => api.chapterEchoes(surahId), [surahId]);
  const echoSet = useMemo(() => new Set(echoKeys.data ?? []), [echoKeys.data]);

  // rasm-variant marks: ayahs with words written more than one way + positions
  const variantData = useAsync(() => api.chapterVariants(surahId), [surahId]);
  const variantMap = useMemo(() => {
    const m = new Map<string, number[]>();
    for (const v of variantData.data ?? []) m.set(v.verse_key, v.positions);
    return m;
  }, [variantData.data]);

  // remember the top-most ayah in view, so Home can "continue reading" there
  const lastSeen = useRef<string | null>(reading.lastVerseKey);
  useEffect(() => {
    if (!verses.data) return;
    const els = Array.from(
      document.querySelectorAll<HTMLElement>(".reader-sheet .ayah[data-key]"),
    );
    if (!els.length) return;
    const tops = new Map<string, number>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const key = (e.target as HTMLElement).dataset.key!;
          if (e.isIntersecting) tops.set(key, e.boundingClientRect.top);
          else tops.delete(key);
        }
        let best: string | null = null;
        let bestTop = Infinity;
        for (const [k, top] of tops) if (top < bestTop) { bestTop = top; best = k; }
        if (best && best !== lastSeen.current) {
          lastSeen.current = best;
          dispatch({ type: "setLastVerse", verseKey: best });
        }
      },
      // a thin band near the top of the page = "what I'm currently reading"
      { rootMargin: "-8% 0px -82% 0px" },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verses.data, surahId]);

  // scroll to a jumped-to verse once it is on the page
  useEffect(() => {
    if (!jumpToVerseKey || !verses.data) return;
    const el = document.querySelector(`[data-key="${jumpToVerseKey}"]`);
    if (!el) return;
    el.scrollIntoView({ block: "center" });
    el.classList.add("flash");
    window.setTimeout(() => el.classList.remove("flash"), 1800);
    dispatch({ type: "clearJump" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpToVerseKey, verses.data]);

  // the reader's research: form → status + established meaning
  const formStatusRows = useAsync(() => fetchFormStatus(), [surahId]);
  const formStatus = useMemo(() => {
    if (!formStatusRows.data) return null;
    const m = new Map<string, FormStatusRow>();
    for (const r of formStatusRows.data) m.set(r.lemma, r);
    return m;
  }, [formStatusRows.data]);

  // the reader's own word senses: primary sense per lemma (default gloss) +
  // per-occurrence overrides in this surah. bumped when edited in the word menu.
  const [senseTick, setSenseTick] = useState(0);
  const glossData = useAsync(() => archive.senses.gloss(), [senseTick]);
  // gloss resolution maps: a form's refinement of the root's primary sense beats
  // the root sense's own text; rootless words use their standalone primary
  const { senseRefine, senseRootText, senseLemmaText } = useMemo(() => {
    const refine = new Map<string, string>();   // `${root} ${lemma}` → text
    const rootText = new Map<string, string>(); // root → primary sense text
    const lemmaText = new Map<string, string>(); // lemma → standalone primary text
    const g = glossData.data;
    if (g) {
      for (const r of g.roots ?? []) rootText.set(r.root, r.text);
      for (const r of g.refinements ?? []) {
        // key must match AyahBlock's lookup exactly: root + single space + lemma.
        // Also index the NFC form so a lemma in the other Unicode normalisation matches.
        refine.set(`${r.root} ${r.lemma}`, r.text);
        refine.set(`${r.root} ${r.lemma.normalize("NFC")}`, r.text);
      }
      for (const l of g.lemmas ?? []) lemmaText.set(l.lemma, l.text);
    }
    return { senseRefine: refine, senseRootText: rootText, senseLemmaText: lemmaText };
  }, [glossData.data]);

  const [menu, setMenu] = useState<WordMenuTarget | null>(null);
  const [senseEdit, setSenseEdit] = useState<{ root: string; lemma: string | null } | null>(null);
  const [navOpen, setNavOpen] = useState(false);
  const [focusIdx, setFocusIdx] = useState(0);
  const [mapOpen, setMapOpen] = useState(false);

  const focus = useAsync(
    async () =>
      focusCaseId
        ? buildFocusSpec(focusCaseId, script)
        : focusAyahKey
        ? buildAyahFocus(focusAyahKey, script)
        : null,
    [focusCaseId, focusAyahKey, script],
  );
  useEffect(() => { setFocusIdx(0); }, [focusCaseId, focusAyahKey]);
  const focusSpec = focus.data ?? null;

  // surah name for any verse key, from the already-loaded chapter list
  const surahName = useCallback(
    (verseKey: string) => {
      const id = parseInt(verseKey.split(":")[0], 10);
      return chapters.find((c) => c.id === id)?.name_simple ?? "";
    },
    [chapters],
  );

  // the base ayah's own text, so it stays visible while hopping across surahs
  const baseVerse = useAsync(
    async () =>
      focusSpec?.base.kind === "ayah"
        ? api.verse(focusSpec.base.label, { script })
        : null,
    [focusSpec?.base.kind, focusSpec?.base.label, script],
  );
  const baseText =
    baseVerse.data && typeof baseVerse.data.text === "string" ? baseVerse.data.text : "";

  const stepFocus = (dir: 1 | -1) => {
    if (!focusSpec || focusSpec.jumpKeys.length === 0) return;
    const n = focusSpec.jumpKeys.length;
    const i = (focusIdx + dir + n) % n;
    setFocusIdx(i);
    dispatch({ type: "jumpToVerse", verseKey: focusSpec.jumpKeys[i] });
  };
  const jumpToFocus = (key: string) => {
    if (!focusSpec) return;
    const i = focusSpec.jumpKeys.indexOf(key);
    if (i >= 0) setFocusIdx(i);
    dispatch({ type: "jumpToVerse", verseKey: key });
    setMapOpen(false);
  };
  useEffect(() => { setMapOpen(false); }, [focusCaseId, focusAyahKey]);
  useEffect(() => {
    if (!mapOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMapOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [mapOpen]);
  const navRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!navOpen) return;
    const onDown = (e: MouseEvent) => {
      if (navRef.current && !navRef.current.contains(e.target as Node)) setNavOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setNavOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [navOpen]);

  const onWordTap = useCallback(
    (verseKey: string, position: number, token: string, word: Word | null, rect: DOMRect) => {
      setMenu({
        verseKey, position, token, word,
        x: rect.left + rect.width / 2,
        y: rect.bottom,
        yTop: rect.top,
      });
    },
    [],
  );

  const scriptDef = SCRIPTS.find((s) => s.id === script) ?? SCRIPTS[0];
  const showBismillah = chapter ? chapter.bismillah_pre !== 0 : surahId !== 1 && surahId !== 9;

  return (
    <div
      className={`reader${activeTrailId ? " trailing" : ""}`}
      style={{ ["--reader-scale" as string]: fontScale }}
    >
      {/* floating nav: a compact button that opens index + surah/ayah jump */}
      <div className="reader-fab" ref={navRef}>
        <button
          className="fab-btn"
          title="Navigate"
          onClick={() => setNavOpen((o) => !o)}
          aria-expanded={navOpen}
        >
          {navOpen ? "✕" : "☰"}
        </button>
        {navOpen && (
          <div className="fab-panel" role="menu">
            <button
              className="ctl"
              onClick={() => { onBackToIndex(); setNavOpen(false); }}
            >
              ⌂ Index
            </button>
            <div className="fab-row">
              <button
                className="ctl"
                disabled={surahId <= 1}
                title="Previous surah"
                onClick={() => dispatch({ type: "setSurah", surahId: surahId - 1 })}
              >‹</button>
              <span className="fab-surah">{chapter ? `${chapter.id} · ${chapter.name_simple}` : `Surah ${surahId}`}</span>
              <button
                className="ctl"
                disabled={surahId >= 114}
                title="Next surah"
                onClick={() => dispatch({ type: "setSurah", surahId: surahId + 1 })}
              >›</button>
            </div>
            {chapter && (
              <label className="fab-ayah">
                <span className="ctl-hint">go to ayah</span>
                <select
                  className="ayah-jump"
                  value=""
                  onChange={(e) => {
                    const n = e.target.value;
                    if (n) {
                      dispatch({ type: "jumpToVerse", verseKey: `${surahId}:${n}` });
                      setNavOpen(false);
                    }
                  }}
                >
                  <option value="">ayah…</option>
                  {Array.from({ length: chapter.verses_count }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              </label>
            )}

            {chapter && (
              <label className="fab-ayah">
                <span className="ctl-hint">focus an ayah (lens)</span>
                <select
                  className="ayah-jump"
                  value={focusAyahKey && focusAyahKey.startsWith(`${surahId}:`) ? focusAyahKey : ""}
                  onChange={(e) => {
                    dispatch({ type: "setFocusAyah", verseKey: e.target.value || null });
                    if (e.target.value) setNavOpen(false);
                  }}
                >
                  <option value="">none</option>
                  {Array.from({ length: chapter.verses_count }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={`${surahId}:${n}`}>ayah {n}</option>
                  ))}
                </select>
              </label>
            )}

            <label className="fab-ayah">
              <span className="ctl-hint">focus case (lens)</span>
              <select
                className="ayah-jump"
                value={focusCaseId ?? ""}
                onChange={(e) => dispatch({ type: "setFocusCase", caseId: e.target.value || null })}
              >
                <option value="">none</option>
                {(allCases.data ?? [])
                  .filter((c) => c.subject.type === "root" || c.subject.type === "ayah")
                  .map((c) => (
                    <option key={c.id} value={c.id}>{c.title}</option>
                  ))}
              </select>
            </label>
          </div>
        )}
      </div>

      {focusSpec && (
        <div className="focus-banner">
         <div className="fb-row">
          <span className="fb-eye">🔎 Focus</span>
          <span className="fb-label">
            {focusSpec.kind === "ayah"
              ? `ayah ${focusSpec.base.label}${surahName(focusSpec.base.label) ? ` · ${surahName(focusSpec.base.label)}` : ""}`
              : focusSpec.label}
          </span>
          {focusSpec.jumpKeys.length > 0 && (
            <span className="fb-step">
              <button className="ctl" onClick={() => stepFocus(-1)} title="Previous match">‹</button>
              <span className="fb-count">{focusIdx + 1} / {focusSpec.jumpKeys.length}</span>
              <button className="ctl" onClick={() => stepFocus(1)} title="Next match">›</button>
            </span>
          )}
          {focusSpec.kind === "ayah" && focusSpec.jumpKeys.length > 0 && (
            <button
              className="fb-order"
              title="Open the connections map — jump to any linked ayah"
              onClick={() => setMapOpen(true)}
            >
              ⊞ closest first · map
            </button>
          )}
          <span className="fb-legend">
            <span className="lg lg-shared">shared root</span>
            {focusSpec.kind === "root" && <span className="lg lg-linked">linked</span>}
            {focusSpec.patternKeys.size > 0 && <span className="lg lg-pattern">similar structure</span>}
          </span>
          <span className="spacer" />
          <button className="ctl" onClick={() => dispatch({ type: "setFocusCase", caseId: null })}>✕ clear</button>
         </div>
         {focusSpec.kind === "ayah" && baseText && (
           <button
             className={`fb-base-verse ${scriptDef.fontClass}`}
             title="Jump back to the ayah you're comparing against"
             onClick={() => dispatch({ type: "jumpToVerse", verseKey: focusSpec.base.label })}
           >
             <span className="fb-base-tag">comparing against</span>
             <span className="fb-base-text quran" dir="rtl">{baseText}</span>
           </button>
         )}
        </div>
      )}

      {/* the page */}
      <div className={`sheet reader-sheet ${scriptDef.fontClass}`}>
        {chapter && (
          <header className="surah-header">
            <div className="surah-head-line">
              <span className="surah-num">{chapter.id}</span>
              <div className="surah-title quran" dir="rtl">
                سُورَةُ {chapter.name_arabic}
              </div>
            </div>
            <div className="surah-meta">
              {chapter.name_simple} · {chapter.revelation_place} ·{" "}
              {chapter.verses_count} ayahs
            </div>
          </header>
        )}

        {showBismillah && (
          <p className="bismillah quran" dir="rtl">
            بِسْمِ ٱللَّهِ ٱلرَّحْمَـٰنِ ٱلرَّحِيمِ
          </p>
        )}

        {verses.loading && <p className="loading">Turning to the page…</p>}
        {verses.error && (
          <p className="error-note">Could not load the surah ({verses.error.message}).</p>
        )}

        {verses.data?.map((v) => (
          <AyahBlock
            key={v.verse_key}
            verse={v}
            translationOn={translationOn}
            translationId={reading.translationId}
            myGlossOn={myGlossOn}
            formStatus={formStatus}
            senseRefine={senseRefine}
            senseRootText={senseRootText}
            senseLemmaText={senseLemmaText}
            caseRefs={evidenceMap?.get(v.verse_key) ?? null}
            rareRoots={rootFreq.data ?? null}
            highlightWord={
              trailHighlight?.verseKey === v.verse_key ? trailHighlight.wordPosition : null
            }
            focusRoots={focusSpec?.roots ?? null}
            focusLinked={focusSpec?.linkedRoots ?? null}
            focusPattern={focusSpec?.patternKeys.has(v.verse_key) ?? false}
            focusTarget={focusSpec?.jumpSet.has(v.verse_key) ?? false}
            focusReason={focusSpec?.reasons.get(v.verse_key) ?? null}
            focusBase={focusSpec?.base ?? null}
            focusBaseSurah={focusSpec ? surahName(focusSpec.base.label) : null}
            focusThisSurah={surahName(v.verse_key)}
            surahName={surahName(v.verse_key)}
            verseNotes={notesMap.get(v.verse_key) ?? null}
            onNotesChanged={bumpNotes}
            hasEcho={echoSet.has(v.verse_key)}
            variantPositions={variantMap.get(v.verse_key) ?? null}
            echoHighlightRange={
              echoHighlight?.verseKey === v.verse_key
                ? { start: echoHighlight.start, end: echoHighlight.end }
                : null
            }
            onWordTap={onWordTap}
          />
        ))}
      </div>

      {mapOpen && focusSpec && (
        <FocusMap
          spec={focusSpec}
          currentKey={focusSpec.jumpKeys[focusIdx] ?? null}
          surahName={surahName}
          onJump={jumpToFocus}
          onClose={() => setMapOpen(false)}
        />
      )}

      {menu && (
        <WordMenu
          target={menu}
          formStatus={formStatus}
          onNotesChanged={bumpNotes}
          onSensesChanged={() => setSenseTick((t) => t + 1)}
          onEditSenses={(root, lemma) => setSenseEdit({ root, lemma })}
          onClose={() => setMenu(null)}
        />
      )}

      {activeTrailId && <TrailStrip trailId={activeTrailId} />}

      {senseEdit && (
        <SenseEditor
          root={senseEdit.root}
          focusLemma={senseEdit.lemma}
          onClose={() => setSenseEdit(null)}
          onChanged={() => setSenseTick((t) => t + 1)}
        />
      )}
    </div>
  );
}
