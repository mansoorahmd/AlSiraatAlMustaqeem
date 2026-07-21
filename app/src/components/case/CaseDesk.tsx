// The case desk (V2): pulled evidence on top, ledger at the side,
// the evidence drawer beneath. The free-form board arrives in V3.

import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../api/client";
import { archive, fetchFormStatus, type FormStatusRow } from "../../persistence/db";
import { useAsync } from "../../hooks/useAsync";
import { useAppState, useAppDispatch } from "../../state/store";
import type { RootOccurrence, Word } from "../../api/types";
import type { CaseRecord } from "../../persistence/types";
import {
  withCardAdded, withCardRemoved, withAyahCardAdded, cardIdFor, normalizeCase,
} from "../../cases/ops";
import { EvidenceDrawer } from "./EvidenceDrawer";
import { RelatedAyahsDrawer } from "./RelatedAyahsDrawer";
import { FormDossier } from "./FormDossier";
import { AyahDossier } from "./AyahDossier";
import { CaseBoard } from "./CaseBoard";
import { WordMenu, type WordMenuTarget } from "../reader/WordMenu";
import { openCaseReport, downloadCaseMarkdown, type ExportData } from "../../export/exportCase";

interface Props {
  caseId: string;
  onBackToArchive: () => void;
}

export function CaseDesk({ caseId, onBackToArchive }: Props) {
  const { reading, caseStack } = useAppState();
  const dispatch = useAppDispatch();
  const [caseRec, setCaseRec] = useState<CaseRecord | null>(null);
  const [missing, setMissing] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [editingDesc, setEditingDesc] = useState(false);
  const [wordMenu, setWordMenu] = useState<WordMenuTarget | null>(null);
  const wordsCache = useRef(new Map<string, Word[]>());

  // research status for the word menu (any root, not just this case's)
  const formStatusRows = useAsync(() => fetchFormStatus(), [caseId]);
  const formStatus = useMemo(() => {
    if (!formStatusRows.data) return null;
    const m = new Map<string, FormStatusRow>();
    for (const r of formStatusRows.data) m.set(r.lemma, r);
    return m;
  }, [formStatusRows.data]);

  const onBoardWordTap = async (
    verseKey: string, position: number, token: string, rect: DOMRect,
  ) => {
    let words = wordsCache.current.get(verseKey);
    if (!words) {
      try {
        words = await api.verseWords(verseKey);
        wordsCache.current.set(verseKey, words);
      } catch {
        words = [];
      }
    }
    const word = words.find((w) => w.position === position) ?? null;
    setWordMenu({
      verseKey, position, token, word,
      x: rect.left + rect.width / 2,
      y: rect.bottom,
      yTop: rect.top,
    });
  };

  useEffect(() => {
    let cancelled = false;
    archive.cases.get(caseId).then((c) => {
      if (cancelled) return;
      if (c) setCaseRec(normalizeCase(c));
      else setMissing(true);
    });
    return () => { cancelled = true; };
  }, [caseId]);

  const chapters = useAsync(() => api.chapters(), []);
  const root = caseRec?.subject.type === "root" ? caseRec.subject.value : null;
  const subjectAyah = caseRec?.subject.type === "ayah" ? caseRec.subject.value : null;
  const occs = useAsync(
    async () => (root ? api.rootOccurrences(root, reading.script) : null),
    [root, reading.script],
  );

  const mutate = (next: CaseRecord) => {
    setCaseRec(next);
    void archive.cases.save(next);
  };

  // verse texts for evidence added from outside the root's occurrences
  const occIds = new Set((occs.data ?? []).map((o) => cardIdFor(o)));
  const extraKeys = [
    ...new Set(
      (caseRec?.cards ?? [])
        .filter((c) => !occIds.has(c.id))
        .map((c) => c.verseKey),
    ),
  ];
  const extraVerses = useAsync(async () => {
    const out = new Map<string, string>();
    await Promise.all(
      extraKeys.map(async (k) => {
        try {
          const v = await api.verse(k, { script: reading.script });
          if (typeof v.text === "string") out.set(k, v.text);
        } catch { /* invalid key — ignore */ }
      }),
    );
    return out;
  }, [extraKeys.join(","), reading.script]);

  const addAyah = async (verseKey: string): Promise<boolean> => {
    if (!caseRec) return false;
    try {
      await api.verse(verseKey, { script: reading.script }); // validate it exists
    } catch {
      return false;
    }
    mutate(withAyahCardAdded(caseRec, verseKey));
    return true;
  };

  const exportData = async (): Promise<ExportData> => {
    let rootCoreEn: string | null = null;
    if (root) {
      try { rootCoreEn = (await api.root(root)).meaning_en; } catch { /* offline is fine */ }
    }
    return { occById: byId, extraTexts: extraVerses.data ?? new Map(), rootCoreEn };
  };

  const onToggle = (occ: RootOccurrence) => {
    if (!caseRec) return;
    const id = cardIdFor(occ);
    mutate(
      caseRec.cards.some((c) => c.id === id)
        ? withCardRemoved(caseRec, id)
        : withCardAdded(caseRec, occ),
    );
  };

  if (missing) {
    return (
      <div className="sheet">
        <p className="error-note">That case file is missing from the archive.</p>
        <button className="ctl" onClick={onBackToArchive}>⌂ Case archive</button>
      </div>
    );
  }
  if (!caseRec) return <p className="loading">Fetching the case file…</p>;

  // occurrences the desk cards refer to, for display
  const byId = new Map<string, RootOccurrence>();
  for (const o of occs.data ?? []) byId.set(cardIdFor(o), o);

  return (
    <div className={`case-desk script-${reading.script}`}>
      <div className="desk-controls">
        {caseStack.length > 0 && (
          <button
            className="ctl"
            title="Back to the case you came from"
            onClick={() => dispatch({ type: "backCase" })}
          >
            ‹ back
          </button>
        )}
        <button className="ctl" onClick={onBackToArchive}>⌂ Case archive</button>
        {editingTitle ? (
          <input
            className="board-input desk-title-input"
            autoFocus
            value={caseRec.title}
            onChange={(e) => setCaseRec({ ...caseRec, title: e.target.value })}
            onBlur={() => { setEditingTitle(false); mutate(caseRec); }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === "Escape") {
                setEditingTitle(false);
                mutate(caseRec);
              }
            }}
          />
        ) : (
          <h1
            className="desk-title editable"
            title="Click to rename this case"
            onClick={() => setEditingTitle(true)}
          >
            {caseRec.title || "Untitled case"} <span className="edit-hint">✎</span>
          </h1>
        )}

        <span className="desk-spacer" />
        <button
          className="ctl"
          title="Open a print-ready report (print → save as PDF)"
          onClick={async () => { if (caseRec) openCaseReport(caseRec, await exportData()); }}
        >
          ⇩ Report
        </button>
        <button
          className="ctl"
          title="Download the case as Markdown"
          onClick={async () => { if (caseRec) downloadCaseMarkdown(caseRec, await exportData()); }}
        >
          ⇩ MD
        </button>
      </div>

      {editingDesc ? (
        <textarea
          className="board-input desk-desc-input"
          autoFocus
          rows={2}
          placeholder="what is this case about? the question, the scope, the hunch…"
          value={caseRec.description ?? ""}
          onChange={(e) => setCaseRec({ ...caseRec, description: e.target.value })}
          onBlur={() => { setEditingDesc(false); mutate(caseRec); }}
          onKeyDown={(e) => {
            if (e.key === "Escape") { setEditingDesc(false); mutate(caseRec); }
          }}
        />
      ) : (
        <p
          className={`desk-desc editable${caseRec.description ? "" : " empty-desc"}`}
          title="Click to edit the case description"
          onClick={() => setEditingDesc(true)}
        >
          {caseRec.description || "add a description — the question this case is asking…"}{" "}
          <span className="edit-hint">✎</span>
        </p>
      )}

      <section className="desk-main">
        <h2>The board</h2>
        {caseRec.cards.length === 0 && caseRec.slips.length === 0 ? (
          <div className="empty">
            <span className="glyph">⚖</span>
            <p>No evidence pulled yet.</p>
            <p className="hint">
              Pull cards from the drawer below — or add any ayah of the Book
              with ＋ Ayah — and let the contexts speak.
            </p>
          </div>
        ) : null}
        <CaseBoard
          caseRec={caseRec}
          occById={byId}
          extraTexts={extraVerses.data ?? new Map()}
          onAddAyah={addAyah}
          onWordTap={onBoardWordTap}
          mutate={mutate}
        />
      </section>

      {subjectAyah ? (
        <AyahDossier caseRec={caseRec} mutate={mutate} />
      ) : (
        <FormDossier caseRec={caseRec} occById={byId} mutate={mutate} />
      )}

      {wordMenu && (
        <WordMenu
          target={wordMenu}
          formStatus={formStatus}
          onClose={() => setWordMenu(null)}
        />
      )}

      {root && chapters.data && (
        <EvidenceDrawer
          root={root}
          caseRec={caseRec}
          chapters={chapters.data}
          onToggle={onToggle}
        />
      )}

      {subjectAyah && (
        <RelatedAyahsDrawer
          verseKey={subjectAyah}
          caseRec={caseRec}
          onToggle={(vk) => {
            if (!caseRec) return;
            const existing = caseRec.cards.find((c) => c.verseKey === vk);
            mutate(
              existing
                ? withCardRemoved(caseRec, existing.id)
                : withAyahCardAdded(caseRec, vk),
            );
          }}
        />
      )}
    </div>
  );
}
