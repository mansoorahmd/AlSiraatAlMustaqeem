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
import { spacedRoot } from "./format";
import { NotesPanel } from "./NotesPanel";
import { RelatedNotes } from "./RelatedNotes";
import { SensesPanel } from "./SensesPanel";

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
  onSensesChanged?: () => void;
  /** open the full Sense Editor (rendered at the reader level, not in this menu) */
  onEditSenses?: (root: string, lemma: string | null) => void;
  onClose: () => void;
}

export function WordMenu({ target, formStatus, onNotesChanged, onSensesChanged, onEditSenses, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const dispatch = useAppDispatch();
  const { activeCaseId } = useAppState();
  const [added, setAdded] = useState<string | null>(null); // case id added to
  const [chosenCaseId, setChosenCaseId] = useState<string | null>(null);
  const [lexOpen, setLexOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [spellOpen, setSpellOpen] = useState(false);
  const [sensesOpen, setSensesOpen] = useState(false);

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

  // the reader's own senses for this word: the root's senses (with this form's
  // refinement) + any rootless standalone senses. The active reading = this
  // form's refinement of the primary root sense, else that sense's own text.
  const [senseVersion, setSenseVersion] = useState(0);
  const senses = useAsync(
    async () => ((lemma || root) ? archive.senses.forWord(lemma, root) : null),
    [lemma, root, senseVersion],
  );
  const rootSenses = senses.data?.rootSenses ?? [];
  const lemmaSenses = senses.data?.lemmaSenses ?? [];
  const senseCount = rootSenses.length + lemmaSenses.length;
  const primaryRoot = rootSenses.find((s) => s.primary) ?? null;
  const primaryLemma = lemmaSenses.find((s) => s.primary) ?? null;
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
          <div className="wm-head-root">
            <span className="wm-root-letters quran">{spacedRoot(root)}</span>
            {rootInfo.data && <span className="wm-occ">{rootInfo.data.total_occurrences}× in the Book</span>}
          </div>
        ) : isParticle ? (
          <span className="wm-occ">a particle — no root</span>
        ) : null}
      </div>

      {/* meaning + morphology, compact lines */}
      {root && rootInfo.data?.meaning_en && (
        <div className="wm-reference">root core: {rootInfo.data.meaning_en}</div>
      )}
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
                <span key={i} className={`wm-spell${i === 0 ? " common" : ""}`}>
                  <span className="quran">{v.surface}</span>
                  <span className="wm-spell-count">×{v.count}</span>
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* the reader's own reading of this word: the primary sense, refined for this form */}
      {activeText && (
        <div className="wm-verdict sense">
          ✒ <em>“{activeText}”</em>
          <span className="wm-verdict-note">
            — {activeIsRefined ? "this form" : primaryRoot ? "root sense" : "your meaning"}
            {rootSenses.length > 1 ? ` · 1 of ${rootSenses.length} senses` : ""}
          </span>
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
            className={`wm-act${sensesOpen ? " active" : ""}`}
            title="Your own meaning(s) for this word's root — several senses, one primary, refined per form"
            onClick={() => { if (root) { onEditSenses?.(root, lemma); onClose(); } else setSensesOpen((o) => !o); }}
          >✒ Senses{senseCount ? ` (${senseCount})` : ""}</button>
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
      {sensesOpen && !root && lemma && (
        <div className="wm-panel">
          <SensesPanel
            lemma={lemma}
            root={root}
            onChanged={() => { setSenseVersion((v) => v + 1); onSensesChanged?.(); }}
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
              <p className={`ref-entry-text${m.language === "arabic" ? " ref-ar" : ""}`} dir={m.language === "arabic" ? "rtl" : "ltr"}>
                {m.meaning}
              </p>
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
