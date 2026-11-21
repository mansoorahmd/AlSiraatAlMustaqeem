// The Reading Room's reader: one surah as a continuous manuscript page.
// Serene by default; every word quietly opens the ink-stamp menu.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../api/client";
import { useAsync } from "../../hooks/useAsync";
import { useFeature } from "../../lib/features";
import { PlanLock } from "../PlanLock";
import { archive, fetchFormStatus, type FormStatusRow } from "../../persistence/db";
import { normalizeCase } from "../../cases/ops";
import { useAppState, useAppDispatch, SCREEN_LABEL } from "../../state/store";
import type { Script, Word, Chapter } from "../../api/types";
import type { NoteRecord, SavedLink } from "../../persistence/types";
import { AyahBlock } from "./AyahBlock";
import { WordMenu, type WordMenuTarget } from "./WordMenu";
import { IndicationEditor } from "./IndicationEditor";
import { TrailStrip } from "./TrailStrip";
import { buildFocusSpec, buildAyahFocus } from "./focus";
import { FocusMap } from "./FocusMap";

const SCRIPTS: { id: Script; label: string; fontClass: string }[] = [
  { id: "uthmani", label: "عثماني", fontClass: "script-uthmani" },
  { id: "imlaei", label: "إملائي", fontClass: "script-imlaei" },
  { id: "indopak", label: "ہندی", fontClass: "script-indopak" },
];

/** How far below the top of the scrolling page the reading line sits, in pixels. */
const READ_GAP = 40;

interface Props {
  chapters: Chapter[];
  onBackToIndex: () => void;
}

export function Reader({ chapters, onBackToIndex }: Props) {
  const { reading, activeTrailId, jumpToVerseKey, jumpAlign, trailHighlight, echoHighlight, focusCaseId,
    focusAyahKey, jumpBack, reopenLinksFor, returnTo } = useAppState();
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

  // the reader's saved links (and leads) — loaded once, refreshed after an edit in a Links panel;
  // each āyah gets the links with an end in it, so both ends stay marked while reading
  const [linksVersion, setLinksVersion] = useState(0);
  const linksAll = useAsync(() => archive.links.all(), [linksVersion]);
  const linksMap = useMemo(() => {
    const m = new Map<string, SavedLink[]>();
    const add = (key: string, l: SavedLink) => {
      const list = m.get(key);
      if (!list) m.set(key, [l]);
      else if (!list.includes(l)) list.push(l);
    };
    for (const l of linksAll.data ?? []) {
      add(l.a.verseKey, l);
      if (l.b) add(l.b.verseKey, l);
    }
    return m;
  }, [linksAll.data]);
  const bumpLinks = useCallback(() => setLinksVersion((v) => v + 1), []);

  // verbatim-echo marks: which ayahs in this surah carry a repeated phrase
  // a locked tool (lib/features.ts) isn't fetched at all: its marks simply don't appear
  const canEchoes = useFeature("echoes");
  const canSpelling = useFeature("spelling");
  const canLens = useFeature("lens");
  const echoKeys = useAsync(async () => (canEchoes ? api.chapterEchoes(surahId) : []), [surahId, canEchoes]);
  const echoSet = useMemo(() => new Set(echoKeys.data ?? []), [echoKeys.data]);

  // rasm-variant marks: ayahs with a word written unusually, and their other variant words
  const variantData = useAsync(async () => (canSpelling ? api.chapterVariants(surahId) : []), [surahId, canSpelling]);
  const variantMap = useMemo(() => {
    const m = new Map<string, { positions: number[]; common: number[] }>();
    for (const v of variantData.data ?? []) m.set(v.verse_key, { positions: v.positions, common: v.common ?? [] });
    return m;
  }, [variantData.data]);

  // Remember the āyah being read, so Home can "continue reading" there and the address can name
  // it. That is the first āyah still showing below the READING LINE: a line a little under the
  // top of the scrolling page (under the lens banner when one is pinned there). A refresh or a
  // return to the tab puts the remembered āyah back on that same line (see `land` below), so
  // what is restored is what was recorded and the place does not creep.
  const lastSeen = useRef<string | null>(reading.lastVerseKey);
  const settle = useRef<number | null>(null);
  const [topCover, setTopCover] = useState(0); // height of the pinned lens banner, 0 without one
  const readLine = useRef(READ_GAP);
  useEffect(() => {
    if (!verses.data) return;
    const els = Array.from(
      document.querySelectorAll<HTMLElement>(".reader-sheet .ayah[data-key]"),
    );
    if (!els.length) return;
    readLine.current = topCover + READ_GAP;
    // document order decides, not a measured position: positions go stale while off-screen
    // āyāt are still being laid out at their real height
    const order = new Map(els.map((el, i) => [el.dataset.key!, i]));
    const below = new Set<string>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const key = (e.target as HTMLElement).dataset.key!;
          if (e.isIntersecting) below.add(key);
          else below.delete(key);
        }
        let best: string | null = null;
        let bestAt = Infinity;
        for (const k of below) {
          const at = order.get(k) ?? Infinity;
          if (at < bestAt) { bestAt = at; best = k; }
        }
        if (best && best !== lastSeen.current) {
          lastSeen.current = best;
          // Collapse bursts into one dispatch. Expanding a panel (echo compare,
          // notes) reflows the page, so this callback can fire many times in a
          // frame; dispatching each one re-rendered and re-persisted every time.
          if (settle.current !== null) window.clearTimeout(settle.current);
          const nextKey = best; // captured: `best` is reassigned on later fires
          settle.current = window.setTimeout(() => {
            settle.current = null;
            dispatch({ type: "setLastVerse", verseKey: nextKey });
          }, 200);
        }
      },
      // everything on the page from the reading line down
      { root: els[0]!.closest(".main"), rootMargin: `-${readLine.current}px 0px 0px 0px` },
    );
    els.forEach((el) => io.observe(el));
    return () => {
      io.disconnect();
      if (settle.current !== null) window.clearTimeout(settle.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verses.data, surahId, topCover]);

  // The āyah the reader is on. After a jump that is the āyah jumped to, shown mid-page, for as
  // long as it is still on screen; otherwise the āyah on the reading line.
  const landedOn = useRef<string | null>(null);
  const whereIAm = (): string | null => {
    const el = landedOn.current
      ? document.querySelector<HTMLElement>(`.reader-sheet .ayah[data-key="${landedOn.current}"]`)
      : null;
    const page = el?.closest(".main");
    if (el && page) {
      const at = el.getBoundingClientRect().top, p = page.getBoundingClientRect();
      if (at >= p.top && at < p.bottom) return landedOn.current;
    }
    return lastSeen.current;
  };

  // scroll to a jumped-to verse once it is on the page
  const stopSettling = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (!jumpToVerseKey || !verses.data) return;
    const el = document.querySelector(`[data-key="${jumpToVerseKey}"]`);
    if (!el) return;
    // A jump to somewhere new shows the āyah mid-page. A restore (refresh, back to the tab, an
    // address typed in) puts it just on the reading line, where the address recorded it; the
    // first āyah goes back to the top of the page, heading and all.
    const restoring = jumpAlign === "top";
    const firstAyah = jumpToVerseKey.endsWith(":1");
    landedOn.current = restoring ? null : jumpToVerseKey;
    const land = () => {
      const page = el.closest<HTMLElement>(".main");
      if (!restoring || !page) el.scrollIntoView({ block: "center" });
      else if (firstAyah) page.scrollTop = 0;
      else page.scrollTop += el.getBoundingClientRect().top - (page.getBoundingClientRect().top + readLine.current - 2);
    };
    land();
    // Āyāt off screen are laid out at an ESTIMATED height (content-visibility: auto,
    // styles.css), so that first scroll lands on a guess. As the āyāt around the target
    // render at their real height the target drifts — in a surah of short āyāt, clean off
    // the top of the screen. Re-centre it until it holds still, unless the reader scrolls.
    // Not tied to this effect's cleanup: clearJump below re-runs the effect at once.
    stopSettling.current?.();
    let top = el.getBoundingClientRect().top, still = 0, raf = 0;
    const started = performance.now();
    const inputs = ["wheel", "touchstart", "keydown", "mousedown"] as const;
    const stop = () => {
      cancelAnimationFrame(raf);
      inputs.forEach((t) => window.removeEventListener(t, stop));
      stopSettling.current = null;
    };
    const settle = () => {
      const now = el.getBoundingClientRect().top;
      if (Math.abs(now - top) > 1) {
        land();
        top = el.getBoundingClientRect().top;
        still = 0;
      } else still++;
      if (still < 20 && performance.now() - started < 2000) raf = requestAnimationFrame(settle);
      else stop();
    };
    inputs.forEach((t) => window.addEventListener(t, stop, { passive: true }));
    raf = requestAnimationFrame(settle);
    stopSettling.current = stop;
    // the flash says "here is where you landed"; coming back to your own place needs none
    if (!restoring) {
      el.classList.add("flash");
      window.setTimeout(() => el.classList.remove("flash"), 1800);
    }
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

  // the reader's own word indications: primary indication per lemma (default gloss) +
  // per-occurrence overrides in this surah. bumped when edited in the word menu.
  const [indicationTick, setIndicationTick] = useState(0);
  const glossData = useAsync(() => archive.indications.gloss(), [indicationTick]);
  // gloss resolution maps: a form's refinement of the root's primary indication beats
  // the root indication's own text; rootless words use their standalone primary
  const { indicationRefine, indicationRootText, indicationLemmaText } = useMemo(() => {
    const refine = new Map<string, string>();   // `${root} ${lemma}` → text
    const rootText = new Map<string, string>(); // root → primary indication text
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
    return { indicationRefine: refine, indicationRootText: rootText, indicationLemmaText: lemmaText };
  }, [glossData.data]);

  const [menu, setMenu] = useState<WordMenuTarget | null>(null);
  const [indicationEdit, setIndicationEdit] = useState<{ root: string; lemma: string | null } | null>(null);
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

  // the pinned lens banner covers the top of the page, so the reading line sits under it
  const lensPinned = focusSpec !== null;
  useEffect(() => {
    const banner = document.querySelector<HTMLElement>(".reader .focus-banner");
    if (!banner) { setTopCover(0); return; }
    const ro = new ResizeObserver(() => setTopCover(banner.offsetHeight));
    ro.observe(banner);
    return () => ro.disconnect();
  }, [lensPinned]);

  // Walking the lens leaves a way back to where the walk began: the āyah that was being read
  // when the first step was taken. Every step names that same āyah, so it is kept once. A new
  // walk begins after going back, or with another lens.
  const lensOrigin = useRef<string | null>(null);
  const backDepth = useRef(jumpBack.length);
  useEffect(() => {
    if (jumpBack.length < backDepth.current) lensOrigin.current = null;
    backDepth.current = jumpBack.length;
  }, [jumpBack.length]);
  useEffect(() => { lensOrigin.current = null; }, [focusCaseId, focusAyahKey]);
  const lensJump = (verseKey: string) => {
    lensOrigin.current ??= whereIAm();
    dispatch({ type: "jumpToVerse", verseKey, from: lensOrigin.current ?? undefined });
  };

  const stepFocus = (dir: 1 | -1) => {
    if (!focusSpec || focusSpec.jumpKeys.length === 0) return;
    const n = focusSpec.jumpKeys.length;
    const i = (focusIdx + dir + n) % n;
    setFocusIdx(i);
    lensJump(focusSpec.jumpKeys[i]);
  };
  const jumpToFocus = (key: string) => {
    if (!focusSpec) return;
    const i = focusSpec.jumpKeys.indexOf(key);
    if (i >= 0) setFocusIdx(i);
    lensJump(key);
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
          title="Go to a surah or āyah, or set the āyah lens"
          aria-label={navOpen ? "Close navigation" : "Go to a surah or āyah, or set the āyah lens"}
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
                <span className="fab-section">Āyah lens{!canLens && <> <PlanLock feature="lens" /></>}</span>
                <span className="ctl-hint">use an āyah (or press Links on any āyah)</span>
                <select
                  disabled={!canLens}
                  className="ayah-jump"
                  value={focusAyahKey && focusAyahKey.startsWith(`${surahId}:`) ? focusAyahKey : ""}
                  onChange={(e) => {
                    dispatch({ type: "setFocusAyah", verseKey: e.target.value || null });
                    if (e.target.value) setNavOpen(false);
                  }}
                >
                  <option value="">no lens</option>
                  {Array.from({ length: chapter.verses_count }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={`${surahId}:${n}`}>āyah {surahId}:{n}</option>
                  ))}
                </select>
              </label>
            )}

            <label className="fab-ayah">
              <span className="ctl-hint">or one of your cases</span>
              <select
                disabled={!canLens}
                className="ayah-jump"
                value={focusCaseId ?? ""}
                onChange={(e) => dispatch({ type: "setFocusCase", caseId: e.target.value || null })}
              >
                <option value="">no lens</option>
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
          <span className="fb-eye">{focusSpec.kind === "ayah" ? "Āyah lens" : "Root lens"}</span>
          <span className="fb-label">
            {focusSpec.kind === "ayah"
              ? `${focusSpec.base.label}${surahName(focusSpec.base.label) ? ` · ${surahName(focusSpec.base.label)}` : ""}`
              : focusSpec.label}
          </span>
          {focusSpec.jumpKeys.length > 0 && (
            <span className="fb-step">
              <button
                className="ctl"
                onClick={() => stepFocus(-1)}
                title="Previous related āyah"
                aria-label="Previous related āyah"
              >‹</button>
              <span className="fb-count">
                {focusIdx + 1} of {focusSpec.jumpKeys.length}
                {focusSpec.kind === "ayah" ? " related, closest first" : ""}
              </span>
              <button
                className="ctl"
                onClick={() => stepFocus(1)}
                title="Next related āyah"
                aria-label="Next related āyah"
              >›</button>
            </span>
          )}
          {focusSpec.kind === "ayah" && focusSpec.jumpKeys.length > 0 && (
            <button
              className="fb-order"
              title="See every related āyah, grouped by sūrah, and jump to any of them"
              onClick={() => setMapOpen(true)}
            >
              Map of related āyāt
            </button>
          )}
          <span className="fb-legend">
            <span className="lg lg-shared">shared root</span>
            {focusSpec.kind === "root" && <span className="lg lg-linked">linked</span>}
            {focusSpec.patternKeys.size > 0 && <span className="lg lg-pattern">similar structure</span>}
          </span>
          <span className="spacer" />
          <button
            className="ctl"
            title="Stop using the lens"
            onClick={() => dispatch({ type: "setFocusCase", caseId: null })}
          >✕ Close lens</button>
         </div>
         {focusSpec.kind === "ayah" && baseText && (
           <button
             className={`fb-base-verse ${scriptDef.fontClass}`}
             title="Go back to the lens āyah"
             onClick={() => lensJump(focusSpec.base.label)}
           >
             <span className="fb-base-tag">lens āyah</span>
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
            indicationRefine={indicationRefine}
            indicationRootText={indicationRootText}
            indicationLemmaText={indicationLemmaText}
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
            variants={variantMap.get(v.verse_key) ?? null}
            echoHighlightRange={
              echoHighlight?.verseKey === v.verse_key
                ? { start: echoHighlight.start, end: echoHighlight.end }
                : null
            }
            savedLinks={linksMap.get(v.verse_key) ?? null}
            onLinksChanged={bumpLinks}
            openLinks={reopenLinksFor === v.verse_key}
            onWordTap={onWordTap}
          />
        ))}
      </div>

      {/* the ways back: to the screen the reader was reached from, and to the āyah a jump was made from */}
      {(jumpBack.length > 0 || returnTo) && (
        <div className="reader-back" role="status">
          {returnTo && (
            <>
              <button
                className="ctl reader-back-go"
                title={`Go back to ${SCREEN_LABEL[returnTo.tab]}, where you were`}
                onClick={() => dispatch({ type: "returnToOrigin" })}
              >
                <span aria-hidden>←</span> Back to {SCREEN_LABEL[returnTo.tab]}
              </button>
              <button
                className="ctl reader-back-x"
                title="Dismiss"
                aria-label={`Dismiss the way back to ${SCREEN_LABEL[returnTo.tab]}`}
                onClick={() => dispatch({ type: "clearReturn" })}
              >✕</button>
            </>
          )}
          {jumpBack.length > 0 && (
            <>
          <button
            className="ctl reader-back-go"
            title="Go back to the āyah you were reading before you jumped"
            onClick={() => dispatch({ type: "jumpBack" })}
          >
            <span aria-hidden>←</span> Back to {jumpBack[jumpBack.length - 1]!.verseKey}
            {surahName(jumpBack[jumpBack.length - 1]!.verseKey) ? ` · ${surahName(jumpBack[jumpBack.length - 1]!.verseKey)}` : ""}
          </button>
          <button
            className="ctl reader-back-x"
            title="Dismiss"
            aria-label="Dismiss the way back"
            onClick={() => dispatch({ type: "clearJumpBack" })}
          >✕</button>
            </>
          )}
        </div>
      )}

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
          onIndicationsChanged={() => setIndicationTick((t) => t + 1)}
          onEditIndications={(root, lemma) => setIndicationEdit({ root, lemma })}
          onClose={() => setMenu(null)}
        />
      )}

      {activeTrailId && <TrailStrip trailId={activeTrailId} />}

      {indicationEdit && (
        <IndicationEditor
          root={indicationEdit.root}
          focusLemma={indicationEdit.lemma}
          onClose={() => setIndicationEdit(null)}
          onChanged={() => setIndicationTick((t) => t + 1)}
        />
      )}
    </div>
  );
}
