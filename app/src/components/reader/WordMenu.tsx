// The ink-stamp menu: appears when a word is pressed while reading.
// Research-first: nothing is hidden. Shows the root's core meaning as
// reference, and the reader's own research status for this word's form —
// no case yet / under investigation / established (your meaning).

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { api } from "../../api/client";
import { useAsync } from "../../hooks/useAsync";
import { useAppState, useAppDispatch } from "../../state/store";
import {
  openOrCreateRootCase, openOrCreateAyahCase, withAyahCardAdded, normalizeCase,
} from "../../cases/ops";
import { startTrail, startWordTrail } from "../../trails/ops";
import { archive } from "../../persistence/db";
import type { FormStatusRow } from "../../persistence/db";
import type { Word } from "../../api/types";
import { spacedRoot, tidyGloss } from "./format";
import { NotesPanel } from "./NotesPanel";
import { RelatedNotes } from "./RelatedNotes";
import { IndicationsPanel } from "./IndicationsPanel";

export interface WordMenuTarget {
  verseKey: string;
  position: number;
  token: string;
  x: number; // viewport coords of the tapped word
  y: number; // bottom of the word
  yTop: number; // top of the word (used to flip the menu above)
  word: Word | null; // matched word data, if positions aligned
}

interface Props {
  target: WordMenuTarget;
  formStatus: Map<string, FormStatusRow> | null;
  onNotesChanged?: () => void;
  onIndicationsChanged?: () => void;
  /** open the full Indication Editor (rendered at the reader level, not in this menu) */
  onEditIndications?: (root: string, lemma: string | null) => void;
  onClose: () => void;
}

export function WordMenu({ target, formStatus, onNotesChanged, onIndicationsChanged, onEditIndications, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const dispatch = useAppDispatch();
  const { activeCaseId } = useAppState();
  const [added, setAdded] = useState<string | null>(null); // case id added to
  const [chosenCaseId, setChosenCaseId] = useState<string | null>(null);
  const [lexOpen, setLexOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [spellOpen, setSpellOpen] = useState(false);
  const [indicationsOpen, setIndicationsOpen] = useState(false);
  const [coreOpen, setCoreOpen] = useState(false);
  const [lexOpenIdx, setLexOpenIdx] = useState<Set<number>>(new Set());

  // every case that can still receive evidence (open or partial)
  const openCases = useAsync(async () => {
    const all = await archive.cases.all();
    return all.filter((c) => c.status !== "closed");
  }, []);

  const targetCaseId =
    chosenCaseId ??
    (openCases.data?.some((c) => c.id === activeCaseId) ? activeCaseId : null) ??
    openCases.data?.[0]?.id ??
    null;
  const targetCase = openCases.data?.find((c) => c.id === targetCaseId) ?? null;

  const addAyahToCase = async () => {
    if (!targetCaseId) return;
    const c = await archive.cases.get(targetCaseId);
    if (!c) return;
    await archive.cases.save(
      withAyahCardAdded(normalizeCase(c), target.verseKey, target.position),
    );
    setAdded(targetCaseId);
  };
  const root = target.word?.root ?? null;
  const lemma = target.word?.lemma ?? null;
  const research = lemma ? formStatus?.get(lemma) ?? null : null;

  const openCase = async () => {
    if (!root) return;
    const c = await openOrCreateRootCase(root, {
      verseKey: target.verseKey,
      wordPosition: target.position,
    });
    dispatch({ type: "setActiveCase", caseId: c.id });
    dispatch({ type: "setTab", tab: "investigate" });
    onClose();
  };

  const rootInfo = useAsync(
    async () => (root ? api.root(root) : null),
    [root],
  );

  // wazn (صرف pattern) of the tapped word
  const wazn = useAsync(
    async () => (target.word ? api.wazn(target.verseKey, target.position) : null),
    [target.verseKey, target.position, target.word !== null],
  );

  // rasm spelling variants of the tapped word (same word written ≥2 ways)
  const spelling = useAsync(
    async () => (target.word ? api.spelling(target.verseKey, target.position) : []),
    [target.verseKey, target.position, target.word !== null],
  );
  const variants = spelling.data ?? [];

  // jump to the FIRST place this exact spelling (rasm) is written — landing on the
  // word itself. wordOccurrences matches by rasm and returns mushaf order, so [0]
  // is the first occurrence; fall back to the variant's own verse list if needed.
  const jumpToSpelling = async (v: { surface: string; verses: string[] }) => {
    try {
      const occ = await api.wordOccurrences(v.surface, 1);
      if (occ[0]) {
        dispatch({ type: "jumpToVerse", verseKey: occ[0].verse_key, wordPosition: occ[0].word_position });
        onClose();
        return;
      }
    } catch { /* fall back to the verse list below */ }
    if (v.verses[0]) {
      dispatch({ type: "jumpToVerse", verseKey: v.verses[0] });
      onClose();
    }
  };

  // the reader's own indications for this word: the root's indications (with this form's
  // refinement) + any rootless standalone indications. The active reading = this
  // form's refinement of the primary root indication, else that indication's own text.
  const [indicationVersion, setIndicationVersion] = useState(0);
  const surface = target.word?.arabic ?? target.token ?? null;  // the word as written
  const indications = useAsync(
    async () => ((lemma || root) ? archive.indications.forWord(lemma, root, surface) : null),
    [lemma, root, surface, indicationVersion],
  );
  const rootIndications = indications.data?.rootIndications ?? [];
  const lemmaIndications = indications.data?.lemmaIndications ?? [];
  // the community's readings of this root / this form — theirs, shown but never counted as mine
  const community = [
    ...(indications.data?.communityRoot ?? []),
    ...(indications.data?.communityLemma ?? []),
  ];
  const communityEstablished = community.find((p) => p.status === "established") ?? null;
  const indicationCount = rootIndications.length + lemmaIndications.length;
  const primaryRoot = rootIndications.find((s) => s.primary) ?? null;
  const primaryLemma = lemmaIndications.find((s) => s.primary) ?? null;
  // what shows under the word here
  const activeText = primaryRoot
    ? (primaryRoot.refinement?.label || primaryRoot.refinement?.meaning || primaryRoot.label || primaryRoot.meaning)
    : (primaryLemma?.label || primaryLemma?.meaning || "");
  const activeIsRefined = !!primaryRoot?.refinement;

  // close on outside click / Esc
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  // clamp to the viewport: below the word, flipped above when cut off
  const width = Math.min(460, window.innerWidth - 16);
  const left = Math.max(8, Math.min(target.x - width / 2, window.innerWidth - width - 8));
  const [top, setTop] = useState(target.y + 10);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const clamp = () => {
      const h = el.offsetHeight;
      let t = target.y + 10;
      if (t + h > window.innerHeight - 8) t = target.yTop - h - 10;
      if (t < 8) t = Math.max(8, window.innerHeight - h - 8);
      setTop(t);
    };
    clamp();
    // re-clamp whenever async content (lexicons, case list) grows the menu
    const ro = new ResizeObserver(clamp);
    ro.observe(el);
    return () => ro.disconnect();
  }, [target]);

  const isParticle = target.word !== null && root === null;

  return (
    <div ref={ref} className="word-menu" role="menu" style={{ left, top, width }}>
      {/* header: the word, transliteration, and its root together */}
      <div className="wm-head">
        <div className="wm-head-word">
          <span className="wm-word quran">{target.token}</span>
          {target.word?.transliteration && <span className="wm-translit">{target.word.transliteration}</span>}
        </div>
        {root ? (
          <button
            className="wm-head-root"
            title={`Open the lexicon page for ${spacedRoot(root)}`}
            onClick={() => {
              dispatch({
                type: "openRoot",
                root: { buckwalter: target.word?.root_buckwalter ?? root, arabic: root },
              });
              onClose();
            }}
          >
            <span className="wm-root-letters quran">{spacedRoot(root)}</span>
            <span className="wm-occ">
              {rootInfo.data ? `${rootInfo.data.total_occurrences}× in the Book` : ""}
              <span className="wm-root-go">open root →</span>
            </span>
          </button>
        ) : isParticle ? (
          <span className="wm-occ">a particle — no root</span>
        ) : null}
      </div>

      {/* meaning + morphology, compact lines */}
      {root && rootInfo.data?.meaning_en && (() => {
        const core = tidyGloss(rootInfo.data.meaning_en);
        const long = core.length > 170;
        return (
          <div className="wm-reference">
            <p className={`wm-reference-text${long && !coreOpen ? " clamped" : ""}`}>
              <span className="wm-reference-label">root core</span> {core}
            </p>
            {long && (
              <button className="wm-reference-more" onClick={() => setCoreOpen((o) => !o)}>
                {coreOpen ? "show less" : "show all"}
              </button>
            )}
          </div>
        );
      })()}
      {wazn.data && (
        <div className="wm-morph" title={wazn.data.sense ?? undefined}>
          <span className="wm-morph-tag">صرف</span>
          <span>
            {wazn.data.label}
            {wazn.data.wazn ? <> · <span className="quran">{wazn.data.wazn}</span></> : null}
            {wazn.data.aspect || wazn.data.voice
              ? ` · ${[wazn.data.aspect, wazn.data.voice].filter(Boolean).join(" · ")}`
              : ""}
          </span>
        </div>
      )}
      {variants.length > 1 && (
        <div className="wm-morph">
          <button className="wm-morph-toggle" onClick={() => setSpellOpen((o) => !o)}>
            ✍ {spellOpen ? "hide spellings" : `written ${variants.length} ways`}
          </button>
          {spellOpen && (
            <div className="wm-spelling-list">
              {variants.map((v, i) => (
                <button
                  key={i}
                  type="button"
                  className={`wm-spell${i === 0 ? " common" : ""}`}
                  title={`Go to the first place written ${v.surface}`}
                  onClick={() => jumpToSpelling(v)}
                >
                  <span className="quran">{v.surface}</span>
                  <span className="wm-spell-count">×{v.count}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* the reader's own reading of this word: the primary indication, refined for this form */}
      {activeText && (
        <div className="wm-verdict indication">
          ✒ <em>“{activeText}”</em>
          <span className="wm-verdict-note">
            — {activeIsRefined ? "this form" : primaryRoot ? "root indication" : "your meaning"}
            {rootIndications.length > 1 ? ` · 1 of ${rootIndications.length} indications` : ""}
          </span>
        </div>
      )}

      {/* what the community holds — visible while reading, without opening the editor.
          Never replaces your gloss above it; it sits beneath, plainly marked as theirs. */}
      {community.length > 0 && (
        <div className="wm-verdict community">
          <span className="community-mark" aria-hidden>◈</span>{" "}
          {communityEstablished
            ? <><em>“{communityEstablished.label || communityEstablished.meaning}”</em>
                <span className="wm-verdict-note"> — the group's reading</span></>
            : <span className="wm-verdict-note">no group reading yet</span>}
          {community.length > 1 && (
            <span className="wm-verdict-note">
              {" "}· {community.length} community indication{community.length === 1 ? "" : "s"}
            </span>
          )}
        </div>
      )}

      {/* the reader's research status for this form */}
      {root && (
        research ? (
          research.status === "established" ? (
            <div className="wm-verdict">✒ <em>“{research.meaning}”</em> <span className="wm-verdict-note">— your meaning</span></div>
          ) : (
            <div className="wm-open-note">⚲ a case is in progress</div>
          )
        ) : (
          <div className="wm-open-note none">no research on this form yet</div>
        )
      )}

      {/* actions — a neat wrapping grid that uses the full width */}
      <div className="wm-actions-grid">
        {root && (
          <button className="wm-act" onClick={openCase}>
            ⚖ {research ? "Open case" : "Open a case"}
          </button>
        )}
        {root && (
          <button
            className="wm-act"
            title="Walk every form of this root, occurrence by occurrence"
            onClick={async () => {
              const t = await startTrail(root, target.verseKey, target.position);
              dispatch({ type: "setActiveTrail", trailId: t.id });
              dispatch({ type: "jumpToVerse", verseKey: target.verseKey, wordPosition: target.position });
              onClose();
            }}
          >➶ Follow root</button>
        )}
        {/* the exact written word — the only thread available for particles and names */}
        <button
          className="wm-act"
          title="Walk only this exact written spelling, occurrence by occurrence"
          onClick={async () => {
            const t = await startWordTrail(target.token, target.verseKey, target.position);
            dispatch({ type: "setActiveTrail", trailId: t.id });
            dispatch({ type: "jumpToVerse", verseKey: target.verseKey, wordPosition: target.position });
            onClose();
          }}
        >➶ Follow this word</button>
        <button
          className="wm-act"
          onClick={async () => {
            const c = await openOrCreateAyahCase(target.verseKey);
            dispatch({ type: "setActiveCase", caseId: c.id });
            dispatch({ type: "setTab", tab: "investigate" });
            onClose();
          }}
        >⚖ Case on {target.verseKey}</button>
        <button
          className="wm-act"
          title="Find āyāt where this word co-occurs with others"
          onClick={() => dispatch({ type: "pinExpr", term: { surface: target.token, root: target.word?.root ?? null } })}
        >⊕ Expression</button>
        {(lemma || root) && (
          <button
            className={`wm-act${indicationsOpen ? " active" : ""}`}
            title="Your own meaning(s) for this word's root — several indications, one primary, refined per form"
            onClick={() => { if (root) { onEditIndications?.(root, lemma); onClose(); } else setIndicationsOpen((o) => !o); }}
          >✒ Indications{indicationCount ? ` (${indicationCount})` : ""}</button>
        )}
        <button
          className={`wm-act${notesOpen ? " active" : ""}`}
          onClick={() => setNotesOpen((o) => !o)}
        >✎ Note</button>
        {root && rootInfo.data && rootInfo.data.meanings.length > 0 && (
          <button className={`wm-act${lexOpen ? " active" : ""}`} onClick={() => setLexOpen(!lexOpen)}>
            📖 Lexicons ({rootInfo.data.meanings.length})
          </button>
        )}
      </div>

      {/* rooted words → full modal editor (opened at reader level); rootless → inline */}
      {indicationsOpen && !root && lemma && (
        <div className="wm-panel">
          <IndicationsPanel
            lemma={lemma}
            root={root}
            onChanged={() => { setIndicationVersion((v) => v + 1); onIndicationsChanged?.(); }}
          />
        </div>
      )}

      {notesOpen && (
        <div className="wm-panel">
          <NotesPanel
            verseKey={target.verseKey}
            wordPosition={target.position}
            wordLemma={lemma}
            wordRoot={root}
            onChanged={onNotesChanged}
            compact
          />
        </div>
      )}

      {lexOpen && root && rootInfo.data && (
        <div className="root-ref-all wm-lex-list wm-panel">
          {rootInfo.data.meanings.map((m, i) => (
            <div key={i} className="ref-entry">
              <div className="ref-entry-head">
                <span className="stamp">{m.source}</span>
                <span className="ref-entry-lang">{m.language}</span>
              </div>
              <p
                className={`ref-entry-text${m.language === "arabic" ? " ref-ar" : ""}${
                  m.meaning.length > 320 && !lexOpenIdx.has(i) ? " clamped" : ""
                }`}
                dir={m.language === "arabic" ? "rtl" : "ltr"}
              >
                {m.language === "arabic" ? m.meaning : tidyGloss(m.meaning)}
              </p>
              {m.meaning.length > 320 && (
                <button
                  className="wm-reference-more"
                  onClick={() =>
                    setLexOpenIdx((prev) => {
                      const n = new Set(prev);
                      n.has(i) ? n.delete(i) : n.add(i);
                      return n;
                    })
                  }
                >{lexOpenIdx.has(i) ? "show less" : "show all"}</button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* file this ayah into an open case */}
      {openCases.data && openCases.data.length > 0 && targetCase && (
        <div className="wm-add-to-case wm-panel">
          {openCases.data.length > 1 ? (
            <select
              className="board-input wm-case-select"
              value={targetCaseId ?? ""}
              onChange={(e) => { setChosenCaseId(e.target.value); setAdded(null); }}
            >
              {openCases.data.map((c) => (
                <option key={c.id} value={c.id}>{c.title} ({c.status})</option>
              ))}
            </select>
          ) : (
            <span className="wm-case-name">{targetCase.title}</span>
          )}
          <button className="wm-act" onClick={addAyahToCase} disabled={added === targetCaseId}>
            {added === targetCaseId ? "✓ added" : `⊕ Add ${target.verseKey} as evidence`}
          </button>
        </div>
      )}

      {/* notes & open questions on this word / root elsewhere in the Book */}
      {root && (
        <RelatedNotes
          root={root}
          lemma={lemma}
          currentKey={target.verseKey}
          currentPosition={target.position}
          onJump={onClose}
        />
      )}
    </div>
  );
}
