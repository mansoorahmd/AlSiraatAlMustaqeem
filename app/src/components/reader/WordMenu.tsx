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
import { startTrail } from "../../trails/ops";
import { archive } from "../../persistence/db";
import type { FormStatusRow } from "../../persistence/db";
import type { Word } from "../../api/types";
import { spacedRoot } from "./format";
import { NotesPanel } from "./NotesPanel";
import { RelatedNotes } from "./RelatedNotes";

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
  onClose: () => void;
}

export function WordMenu({ target, formStatus, onNotesChanged, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const dispatch = useAppDispatch();
  const { activeCaseId } = useAppState();
  const [added, setAdded] = useState<string | null>(null); // case id added to
  const [chosenCaseId, setChosenCaseId] = useState<string | null>(null);
  const [lexOpen, setLexOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);

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
  const width = 320;
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
      <div className="wm-word quran">{target.token}</div>
      {target.word?.transliteration && (
        <div className="wm-translit">{target.word.transliteration}</div>
      )}

      {root && (
        <div className="wm-root">
          <span className="wm-root-letters">{spacedRoot(root)}</span>
          {rootInfo.data && (
            <span className="wm-occ">
              {rootInfo.data.total_occurrences} occurrences in the Book
            </span>
          )}
        </div>
      )}
      {isParticle && (
        <div className="wm-root">
          <span className="wm-occ">a particle — no root to investigate</span>
        </div>
      )}

      {/* wazn — the morphological measure of this word's shape */}
      {wazn.data && (
        <div className="wm-wazn">
          <div className="wm-wazn-label">{wazn.data.label}</div>
          {wazn.data.wazn && (
            <div className="wm-wazn-pattern quran" dir="rtl">
              {wazn.data.wazn}
              {wazn.data.radicals ? <span className="wm-wazn-radicals"> · {wazn.data.radicals.join(" ")}</span> : null}
            </div>
          )}
          {(wazn.data.aspect || wazn.data.voice) && (
            <div className="wm-wazn-meta">{[wazn.data.aspect, wazn.data.voice].filter(Boolean).join(" · ")}</div>
          )}
          {wazn.data.sense && <div className="wm-wazn-sense">{wazn.data.sense}</div>}
        </div>
      )}

      {/* root core meaning — open reference evidence */}
      {root && rootInfo.data?.meaning_en && (
        <div className="wm-reference">root core: {rootInfo.data.meaning_en}</div>
      )}

      {/* full lexicon entries, by source */}
      {root && rootInfo.data && rootInfo.data.meanings.length > 0 && (
        <div className="wm-lexicons">
          <button className="ctl wm-lex-toggle" onClick={() => setLexOpen(!lexOpen)}>
            {lexOpen ? "hide lexicons" : `📖 full lexicons (${rootInfo.data.meanings.length})`}
          </button>
          {lexOpen && (
            <div className="root-ref-all wm-lex-list">
              {rootInfo.data.meanings.map((m, i) => (
                <div key={i} className="ref-entry">
                  <div className="ref-entry-head">
                    <span className="stamp">{m.source}</span>
                    <span className="ref-entry-lang">{m.language}</span>
                  </div>
                  <p
                    className={`ref-entry-text${m.language === "arabic" ? " ref-ar" : ""}`}
                    dir={m.language === "arabic" ? "rtl" : "ltr"}
                  >
                    {m.meaning}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* the reader's research status for this form */}
      {root && (
        research ? (
          research.status === "established" ? (
            <div className="wm-verdict">
              ✒ <em>“{research.meaning}”</em>
              <span className="wm-verdict-note">— your established meaning</span>
            </div>
          ) : (
            <div className="wm-open-note">⚲ a case is in progress on this form</div>
          )
        ) : (
          <div className="wm-open-note none">no research on this form yet</div>
        )
      )}

      {root && (
        <div className="wm-actions">
          <button className="ink-action" onClick={openCase}>
            ⚖ {research ? "Open the case" : "Open a case"}
          </button>
          <button
            className="ink-action"
            onClick={async () => {
              if (!root) return;
              const t = await startTrail(root, target.verseKey, target.position);
              dispatch({ type: "setActiveTrail", trailId: t.id });
              dispatch({ type: "jumpToVerse", verseKey: target.verseKey, wordPosition: target.position });
              onClose();
            }}
          >
            ➶ Follow the thread
          </button>
        </div>
      )}

      {/* a case on the whole ayah — its own board and understanding */}
      <div className="wm-actions">
        <button
          className="ink-action"
          onClick={async () => {
            const c = await openOrCreateAyahCase(target.verseKey);
            dispatch({ type: "setActiveCase", caseId: c.id });
            dispatch({ type: "setTab", tab: "investigate" });
            onClose();
          }}
        >
          ⚖ Open case on ayah {target.verseKey}
        </button>
      </div>

      {/* evidence can come from ANY ayah — file this one into a chosen case */}
      {openCases.data && openCases.data.length > 0 && targetCase && (
        <div className="wm-add-to-case">
          {openCases.data.length > 1 ? (
            <select
              className="board-input wm-case-select"
              value={targetCaseId ?? ""}
              onChange={(e) => { setChosenCaseId(e.target.value); setAdded(null); }}
            >
              {openCases.data.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title} ({c.status})
                </option>
              ))}
            </select>
          ) : (
            <span className="wm-case-name">{targetCase.title}</span>
          )}
          <button
            className="ink-action"
            onClick={addAyahToCase}
            disabled={added === targetCaseId}
          >
            {added === targetCaseId
              ? "✓ added"
              : `⊕ Add ${target.verseKey} as evidence`}
          </button>
        </div>
      )}

      {/* add this word to an expression search (co-occurrence) */}
      <div className="wm-actions">
        <button
          className="ink-action"
          title="Find āyāt where this word co-occurs with others"
          onClick={() =>
            dispatch({ type: "pinExpr", term: { surface: target.token, root: target.word?.root ?? null } })
          }
        >
          ⊕ Add to expression
        </button>
      </div>

      {/* a note or question on this word — visible in the reader and on the board */}
      <div className="wm-notes">
        <button className="ctl wm-notes-toggle" onClick={() => setNotesOpen((o) => !o)}>
          {notesOpen ? "hide notes" : "✎ Note / question on this word"}
        </button>
        {notesOpen && (
          <NotesPanel
            verseKey={target.verseKey}
            wordPosition={target.position}
            wordLemma={lemma}
            wordRoot={root}
            onChanged={onNotesChanged}
            compact
          />
        )}
      </div>

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
