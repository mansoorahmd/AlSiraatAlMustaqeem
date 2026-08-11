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
  const [editingVerdict, setEditingVerdict] = useState(false);
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

  // accepting is the ONLY path from a proposal into the case's own conclusions —
  // the MCP server can never write verdict / status / formResearch itself.
  const acceptProposal = (p: NonNullable<CaseRecord["proposals"]>["entries"][number]) => {
    if (!caseRec) return;
    const rest = (caseRec.proposals?.entries ?? []).filter((e) => e.id !== p.id);
    let next: CaseRecord = { ...caseRec, proposals: { entries: rest } };
    if (p.kind === "verdict") {
      next = { ...next, verdict: p.text, ...(p.suggestedStatus ? { status: p.suggestedStatus } : {}) };
    } else if (p.form) {
      next = {
        ...next,
        formResearch: {
          ...next.formResearch,
          [p.form]: { status: "established", meaning: p.text, establishedAt: Date.now() },
        },
      };
    }
    mutate(next);
  };

  const discardProposal = (id: string) => {
    if (!caseRec) return;
    mutate({
      ...caseRec,
      proposals: { entries: (caseRec.proposals?.entries ?? []).filter((e) => e.id !== id) },
    });
  };

  const setStatus = (status: CaseRecord["status"]) => {
    if (!caseRec) return;
    mutate({ ...caseRec, status });
    if (status === "closed" && !caseRec.verdict) setEditingVerdict(true);
  };

  const discard = async () => {
    if (!caseRec) return;
    const ok = window.confirm(
      `Discard the case “${caseRec.title || "Untitled"}” permanently? This cannot be undone.`,
    );
    if (!ok) return;
    await archive.cases.remove(caseId);
    onBackToArchive();
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
        <span className={`desk-status status-${caseRec.status}`}>{caseRec.status}</span>

        <span className="desk-spacer" />
        {caseRec.status === "closed" ? (
          <button className="ctl" title="Reopen this case" onClick={() => setStatus("open")}>
            ↺ Reopen
          </button>
        ) : (
          <button className="ctl" title="Mark this case closed with a verdict" onClick={() => setStatus("closed")}>
            ✓ Close case
          </button>
        )}
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
        <button className="ctl danger" title="Delete this case permanently" onClick={discard}>
          🗑 Discard
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

      {caseRec.status === "closed" && (
        editingVerdict ? (
          <textarea
            className="board-input desk-verdict-input"
            autoFocus
            rows={2}
            placeholder="your verdict — what did you conclude?"
            value={caseRec.verdict ?? ""}
            onChange={(e) => setCaseRec({ ...caseRec, verdict: e.target.value })}
            onBlur={() => { setEditingVerdict(false); mutate(caseRec); }}
            onKeyDown={(e) => {
              if (e.key === "Escape") { setEditingVerdict(false); mutate(caseRec); }
            }}
          />
        ) : (
          <p
            className="desk-verdict editable"
            title="Click to edit the verdict"
            onClick={() => setEditingVerdict(true)}
          >
            <span className="desk-verdict-label">✓ verdict</span>{" "}
            {caseRec.verdict || "write your conclusion…"} <span className="edit-hint">✎</span>
          </p>
        )
      )}

      {/* conclusions an AI proposed through the MCP — inert until accepted here */}
      {(caseRec.proposals?.entries?.length ?? 0) > 0 && (
        <section className="desk-proposals">
          <h2 className="desk-proposals-head">
            ✦ Proposed conclusions
            <span className="desk-proposals-note">
              — suggested by an AI. Nothing is applied until you accept it.
            </span>
          </h2>
          {caseRec.proposals!.entries.map((p) => (
            <div key={p.id} className="desk-proposal">
              <div className="desk-proposal-what">
                <span className="desk-proposal-kind">
                  {p.kind === "verdict" ? "verdict" : `form · ${p.form}`}
                </span>
                <span className="desk-proposal-text">{p.text}</span>
                {p.reasoning && <span className="desk-proposal-why">{p.reasoning}</span>}
              </div>
              <div className="desk-proposal-acts">
                <button
                  className="ctl"
                  title={p.kind === "verdict" ? "Make this the case verdict" : "Mark this form established with this meaning"}
                  onClick={() => acceptProposal(p)}
                >✓ accept</button>
                <button className="ctl" title="Remove this proposal" onClick={() => discardProposal(p.id)}>
                  ✕ discard
                </button>
              </div>
            </div>
          ))}
        </section>
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
