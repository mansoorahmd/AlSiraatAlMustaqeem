// The form dossier (replaces the sealed ledger): root core meaning open at
// top as reference evidence; one row per form with research status —
// untouched → under investigation → established. Establish/reopen per form,
// root verdict when every evidenced form is established.

import { useState } from "react";
import { api } from "../../api/client";
import { useAsync } from "../../hooks/useAsync";
import { IndicationEditor } from "../reader/IndicationEditor";
import { RevisionTrail } from "../research/RevisionTrail";
import type { RootOccurrence } from "../../api/types";
import type { CaseRecord } from "../../persistence/types";
import {
  caseCompletion, ayahsBehind, restsOn, withFormEstablished, withFormReopened,
  withCaseClosed, withCaseReopened,
} from "../../cases/ops";
import { EvidenceCount } from "./EvidenceCount";
import { FalsifierField } from "./FalsifierField";

function spaced(root: string): string {
  return root.split("").join("\u00A0"); // nbsp: root letters must not wrap
}

interface Props {
  caseRec: CaseRecord;
  occById: Map<string, RootOccurrence>;
  mutate: (next: CaseRecord) => void;
}

export function FormDossier({ caseRec, occById, mutate }: Props) {
  const root = caseRec.subject.type === "root" ? caseRec.subject.value : null;
  const info = useAsync(async () => (root ? api.root(root) : null), [root]);
  const [openForm, setOpenForm] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [verdictDraft, setVerdictDraft] = useState<string | null>(null);
  const [rootRefOpen, setRootRefOpen] = useState(false);
  const [editorLemma, setEditorLemma] = useState<string | null>(null);

  // evidence counts per lemma
  const cardCount = new Map<string, number>();
  for (const card of caseRec.cards) {
    const l = occById.get(card.id)?.lemma_arabic;
    if (l) cardCount.set(l, (cardCount.get(l) ?? 0) + 1);
  }
  const slipCount = new Map<string, number>();
  for (const s of caseRec.slips) {
    if (s.form) slipCount.set(s.form, (slipCount.get(s.form) ?? 0) + 1);
  }

  const lemmaOfCard = (cardId: string) => occById.get(cardId)?.lemma_arabic ?? null;
  const completion = caseCompletion(caseRec, lemmaOfCard);
  // separate āyāt behind each form and behind the case (two cards on one āyah count once)
  const behind = ayahsBehind(caseRec, lemmaOfCard);
  const ayahCount = (n: number) => `${n} ${n === 1 ? "āyah" : "āyāt"}`;

  // the family: forms from the root, merged with anything already researched
  // The corpus lists a (root × lemma × POS) row per grammatical role, so the
  // same written form can appear twice (e.g. نِصْف as Noun and Time adverb).
  // Our research unit is the FORM — merge rows sharing a lemma, summing
  // occurrences and keeping every grammatical role.
  const familyForms = (() => {
    const merged = new Map<string, { lemma_arabic: string | null; occurrence_count: number; pos_english: string | null }>();
    for (const f of info.data?.forms ?? []) {
      const key = f.lemma_arabic ?? f.lemma_buckwalter;
      const prev = merged.get(key);
      if (prev) {
        prev.occurrence_count += f.occurrence_count;
        if (f.pos_english && prev.pos_english && !prev.pos_english.includes(f.pos_english)) {
          prev.pos_english = `${prev.pos_english} · ${f.pos_english}`;
        } else if (f.pos_english && !prev.pos_english) {
          prev.pos_english = f.pos_english;
        }
      } else {
        merged.set(key, {
          lemma_arabic: f.lemma_arabic,
          occurrence_count: f.occurrence_count,
          pos_english: f.pos_english,
        });
      }
    }
    return [...merged.values()];
  })();
  const familyLemmas = familyForms
    .map((f) => f.lemma_arabic)
    .filter((l): l is string => !!l);

  const statusOf = (lemma: string): "untouched" | "open" | "established" => {
    const fr = caseRec.formResearch[lemma];
    if (fr?.status === "established") return "established";
    if (fr || cardCount.has(lemma) || slipCount.has(lemma)) return "open";
    return "untouched";
  };

  const establish = (lemma: string) => {
    const meaning = (drafts[lemma] ?? caseRec.formResearch[lemma]?.meaning ?? "").trim();
    if (!meaning) return;
    mutate(withFormEstablished(caseRec, lemma, meaning));
    setOpenForm(null);
  };

  const closeCase = () => {
    const v = (verdictDraft ?? caseRec.verdict).trim();
    if (!v) return;
    mutate(withCaseClosed(caseRec, v, familyLemmas));
    setVerdictDraft(null);
  };

  return (
    <aside className="ledger dossier">
      <h2>Form dossier</h2>

      <div className="ledger-subject">
        <div className="ledger-root quran">{root ? spaced(root) : caseRec.subject.value}</div>
        <span className="stamp">{caseRec.status.toUpperCase()}</span>
      </div>

      {/* root core meaning — open reference evidence, always by source */}
      {info.data && (
        <div className="root-reference">
          <div className="root-ref-head">
            <span className="root-ref-title">
              root core (reference) · {info.data.meanings.length} sources
            </span>
            <button className="ctl" onClick={() => setRootRefOpen(!rootRefOpen)}>
              {rootRefOpen ? "collapse" : "expand"}
            </button>
          </div>
          {rootRefOpen && (
            <div className="root-ref-all">
              {info.data.meanings.map((m, i) => (
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

      {/* per-form rows */}
      <div className="form-rows">
        {familyForms.map((f) => {
          const lemma = f.lemma_arabic;
          if (!lemma) return null;
          const st = statusOf(lemma);
          const fr = caseRec.formResearch[lemma];
          const expanded = openForm === lemma;
          return (
            <div key={lemma} className={`form-row st-${st}`}>
              <button className="form-row-head" onClick={() => setOpenForm(expanded ? null : lemma)}>
                <span className="form-lemma quran">{lemma}</span>
                <span className="form-meta">
                  ×{f.occurrence_count}
                  {behind.byForm.get(lemma) ? ` · ${ayahCount(behind.byForm.get(lemma)!)}` : ""}
                  {slipCount.get(lemma) ? ` · ${slipCount.get(lemma)}✎` : ""}
                </span>
                <span className={`form-status ${st}`}>
                  {st === "established" ? "✒ established" : st === "open" ? "⚲ investigating" : "—"}
                </span>
              </button>

              {st === "established" && !expanded && fr?.meaning && (
                <div className="form-established-meaning">“{fr.meaning}”</div>
              )}

              {expanded && (
                <div className="form-expand">
                  {f.pos_english && <p className="form-pos">{f.pos_english}</p>}
                  <textarea
                    className="board-input form-meaning-input"
                    rows={3}
                    placeholder="the meaning of this form, in your words — your research, your reading…"
                    value={drafts[lemma] ?? fr?.meaning ?? ""}
                    onChange={(e) => setDrafts({ ...drafts, [lemma]: e.target.value })}
                  />
                  <EvidenceCount rests={restsOn(caseRec, lemmaOfCard, { form: lemma })} of="form" />
                  <div className="form-actions">
                    {st === "established" ? (
                      <>
                        <button className="ctl" onClick={() => establish(lemma)}>
                          ✒ update meaning
                        </button>
                        <button className="ctl" onClick={() => mutate(withFormReopened(caseRec, lemma))}>
                          ↻ reopen
                        </button>
                      </>
                    ) : (
                      <button
                        className="ctl establish-btn"
                        disabled={!(drafts[lemma] ?? fr?.meaning ?? "").trim()}
                        onClick={() => establish(lemma)}
                      >
                        ✒ establish
                      </button>
                    )}
                  </div>
                  <RevisionTrail kind="form" target={`${caseRec.id}|${lemma}`} feature="cases" />

                  {root && (
                    <div className="form-indications">
                      <button className="ctl" onClick={() => setEditorLemma(lemma)}>
                        ✒ Indications &amp; meanings — open editor for <span className="quran">{lemma}</span>
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* verdict */}
      <div className="verdict-block">
        {completion.evidenced.length === 0 ? (
          <p className="ledger-line">Gather evidence to begin the research.</p>
        ) : completion.verdictUnlocked ? (
          caseRec.status === "open" ? (
            <>
              <p className="ledger-line"><strong>All evidenced forms established.</strong> Write the family verdict:</p>
              <textarea
                className="board-input form-meaning-input"
                rows={3}
                placeholder="the root family, synthesized…"
                value={verdictDraft ?? caseRec.verdict}
                onChange={(e) => setVerdictDraft(e.target.value)}
              />
              <EvidenceCount rests={restsOn(caseRec, lemmaOfCard, "case")} of="verdict" />
              <button
                className="ctl establish-btn"
                disabled={!(verdictDraft ?? caseRec.verdict).trim()}
                onClick={closeCase}
              >
                🔏 close the case
              </button>
            </>
          ) : (
            <>
              <p className="ledger-line verdict-final">“{caseRec.verdict}”</p>
              <RevisionTrail kind="verdict" target={caseRec.id} feature="cases" />
              <p className="ledger-line">
                {caseRec.status === "closed"
                  ? "Every form of the family established."
                  : "Closed partial — untouched forms remain."}
              </p>
              <button className="ctl" onClick={() => mutate(withCaseReopened(caseRec))}>
                ↻ reopen case
              </button>
            </>
          )
        ) : (
          <p className="ledger-line">
            {completion.pending.length} evidenced form
            {completion.pending.length > 1 ? "s" : ""} awaiting establishment
            before the verdict unlocks.
          </p>
        )}
        <FalsifierField caseRec={caseRec} mutate={mutate} />
      </div>

      {root && editorLemma && (
        <IndicationEditor root={root} focusLemma={editorLemma} onClose={() => setEditorLemma(null)} />
      )}
    </aside>
  );
}
