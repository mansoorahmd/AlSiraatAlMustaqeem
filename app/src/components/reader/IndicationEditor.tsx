// The Indication Editor — a focused modal for the reader's own meanings of a root.
// Left: the root's indications (add / pick primary / delete / rename). Right: for the
// selected indication, EVERY form of the root with its own editable meaning
// (refinement) — so you can set the meaning for any form, not just the word you
// tapped. A dictionaries panel sits alongside for lookup while you write.

import { useEffect, useMemo, useState } from "react";
import { api } from "../../api/client";
import { archive, newId } from "../../persistence/db";
import { useAsync } from "../../hooks/useAsync";
import type { RootIndicationWithRefinement, WordIndication } from "../../api/types";
import { IndicationPromptPanel } from "./IndicationPromptPanel";

const spaced = (r: string) => r.split("").join(" ");

interface Props {
  root: string;
  /** the form the reader tapped, highlighted in the forms list */
  focusLemma?: string | null;
  onClose: () => void;
  onChanged?: () => void;
}

export function IndicationEditor({ root, focusLemma, onClose, onChanged }: Props) {
  const [version, setVersion] = useState(0);
  const bump = () => { setVersion((v) => v + 1); onChanged?.(); };

  const rootInfo = useAsync(() => api.root(root), [root]);
  const data = useAsync(() => archive.indications.forWord(null, root), [root, version]);
  const indications = data.data?.rootIndications ?? [];

  const [selectedId, setSelectedId] = useState<string | null>(null);
  // keep a valid selection: chosen → primary → first
  const selected =
    indications.find((s) => s.id === selectedId) ?? indications.find((s) => s.primary) ?? indications[0] ?? null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const [promptOpen, setPromptOpen] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const addIndication = async () => {
    const label = newLabel.trim();
    if (!label) return;
    const id = newId("indication");
    await archive.indications.save({ id, root, label, meaning: "" });
    setNewLabel("");
    setSelectedId(id);
    bump();
  };

  return (
    // close on click (not mousedown) so a focused field's blur-save runs first
    <div className="modal-overlay" onClick={onClose}>
      <div className="indication-editor" onClick={(e) => e.stopPropagation()}>
        <header className="ie-head">
          <div className="ie-title">
            <span className="ie-root quran">{spaced(root)}</span>
            {rootInfo.data?.meaning_en && <span className="ie-core">{rootInfo.data.meaning_en}</span>}
          </div>
          <div className="ie-head-actions">
            <button
              className="ctl"
              title="Build an AI prompt that tests an indication against every form of this root"
              onClick={() => setPromptOpen(true)}
            >⇱ Create prompt</button>
            <button className="ie-close" onClick={onClose} title="Close">✕</button>
          </div>
        </header>

        <div className="ie-body">
          {/* indications of the root */}
          <aside className="ie-indications">
            <p className="ie-section">Indications of this root</p>
            {indications.length === 0 && !data.loading && (
              <p className="indications-empty">None yet. Name the first indication below.</p>
            )}
            <div className="ie-indication-list">
              {indications.map((s) => (
                <IndicationChip
                  key={s.id}
                  indication={s}
                  active={selected?.id === s.id}
                  onSelect={() => setSelectedId(s.id)}
                  onPrimary={async () => { await archive.indications.setPrimary(s.id); bump(); }}
                  onDelete={async () => { await archive.indications.remove(s.id); if (selectedId === s.id) setSelectedId(null); bump(); }}
                />
              ))}
            </div>
            <div className="ie-add">
              <input
                className="board-input"
                placeholder="name an indication (e.g. attain / triumph)"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") addIndication(); }}
              />
              <button className="ctl establish-btn" disabled={!newLabel.trim()} onClick={addIndication}>＋ Add indication</button>
            </div>
          </aside>

          {/* the selected indication: its text + every form's own meaning */}
          <main className="ie-forms-wrap">
            {selected ? (
              <IndicationForms
                key={selected.id}
                indication={selected}
                forms={rootInfo.data?.forms ?? []}
                focusLemma={focusLemma ?? null}
                onChanged={bump}
              />
            ) : (
              <p className="indications-empty ie-pad">Pick or add an indication to give each form its meaning.</p>
            )}
          </main>

          {/* dictionaries for lookup while writing */}
          <aside className="ie-dict">
            <p className="ie-section">Dictionaries</p>
            {rootInfo.loading && <p className="loading">…</p>}
            {(rootInfo.data?.meanings ?? []).length === 0 && !rootInfo.loading && (
              <p className="indications-empty">No lexicon entries.</p>
            )}
            <div className="ie-dict-list">
              {(rootInfo.data?.meanings ?? []).map((m, i) => (
                <div key={i} className="ie-dict-entry">
                  <div className="ie-dict-src"><span className="stamp">{m.source}</span> <span className="ie-dict-lang">{m.language}</span></div>
                  <p className={`ie-dict-text${m.language === "arabic" ? " ref-ar quran" : ""}`} dir={m.language === "arabic" ? "rtl" : "ltr"}>{m.meaning}</p>
                </div>
              ))}
            </div>
          </aside>
        </div>

        {promptOpen && (
          <IndicationPromptPanel
            root={root}
            detail={rootInfo.data ?? null}
            initialIndication={[selected?.label, selected?.meaning].filter(Boolean).join(" — ")}
            onClose={() => setPromptOpen(false)}
          />
        )}
      </div>
    </div>
  );
}

function IndicationChip({
  indication, active, onSelect, onPrimary, onDelete,
}: {
  indication: RootIndicationWithRefinement; active: boolean; onSelect: () => void; onPrimary: () => void; onDelete: () => void;
}) {
  return (
    <div className={`ie-chip${active ? " active" : ""}`}>
      <button className={`indication-primary${indication.primary ? " on" : ""}`} title={indication.primary ? "Primary (default gloss)" : "Make primary"} onClick={onPrimary}>
        {indication.primary ? "★" : "☆"}
      </button>
      <button className="ie-chip-label" onClick={onSelect}>
        <span className="ie-chip-name">{indication.label || "(unlabelled)"}</span>
        <span className="ie-chip-meta">
          {indication.refinedCount} refined
          {indication.source === "ai" && <span className="ai-badge" title="Proposed by an AI — accept it in ✦ Proposed">AI</span>}
        </span>
      </button>
      <button className="indication-del" title="Delete indication" onClick={onDelete}>✕</button>
    </div>
  );
}

function IndicationForms({
  indication, forms, focusLemma, onChanged,
}: {
  indication: RootIndicationWithRefinement; forms: { lemma_arabic: string | null; pos_english: string | null; occurrence_count: number }[];
  focusLemma: string | null; onChanged: () => void;
}) {
  // the indication's own text (the root-level meaning)
  const [label, setLabel] = useState(indication.label);
  const [meaning, setMeaning] = useState(indication.meaning);
  useEffect(() => { setLabel(indication.label); setMeaning(indication.meaning); }, [indication.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const saveIndication = async () => {
    await archive.indications.save({ id: indication.id, root: indication.root, label: label.trim(), meaning: meaning.trim(), primary: indication.primary });
    onChanged();
  };

  // this indication's per-form refinements, keyed by lemma
  const refs = useAsync(() => archive.indications.refinements(indication.id), [indication.id]);
  const refByLemma = useMemo(() => {
    const m = new Map<string, WordIndication>();
    for (const r of refs.data ?? []) if (r.lemma) m.set(r.lemma, r);
    return m;
  }, [refs.data]);

  const uniqueForms = useMemo(() => {
    const seen = new Set<string>();
    const out: { lemma: string; pos: string | null; count: number }[] = [];
    for (const f of forms) {
      const l = f.lemma_arabic;
      if (!l || seen.has(l)) continue;
      seen.add(l);
      out.push({ lemma: l, pos: f.pos_english, count: f.occurrence_count });
    }
    // the tapped form first
    out.sort((a, b) => (a.lemma === focusLemma ? -1 : b.lemma === focusLemma ? 1 : 0));
    return out;
  }, [forms, focusLemma]);

  return (
    <div className="ie-forms">
      <div className="ie-indication-edit">
        <input className="board-input ie-indication-label" placeholder="indication label" value={label} onChange={(e) => setLabel(e.target.value)} onBlur={saveIndication} />
        <textarea className="board-input" rows={2} placeholder="the root's meaning in this indication, in your words…" value={meaning} onChange={(e) => setMeaning(e.target.value)} onBlur={saveIndication} />
      </div>

      <p className="ie-section">Each form’s meaning in this indication</p>
      <div className="ie-form-rows">
        {uniqueForms.map((f) => (
          <FormRow
            key={f.lemma}
            indicationId={indication.id}
            lemma={f.lemma}
            pos={f.pos}
            count={f.count}
            focused={f.lemma === focusLemma}
            refinement={refByLemma.get(f.lemma) ?? null}
            onChanged={onChanged}
          />
        ))}
      </div>
    </div>
  );
}

function FormRow({
  indicationId, lemma, pos, count, focused, refinement, onChanged,
}: {
  indicationId: string; lemma: string; pos: string | null; count: number; focused: boolean;
  refinement: WordIndication | null; onChanged: () => void;
}) {
  const [label, setLabel] = useState(refinement?.label ?? "");
  const [meaning, setMeaning] = useState(refinement?.meaning ?? "");
  const [dirty, setDirty] = useState(false);
  useEffect(() => { setLabel(refinement?.label ?? ""); setMeaning(refinement?.meaning ?? ""); setDirty(false); }, [refinement?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    if (!dirty) return;
    await archive.indications.saveRefinement({
      id: refinement?.id ?? newId("ref"), parentId: indicationId, lemma, label: label.trim(), meaning: meaning.trim(),
    });
    setDirty(false);
    onChanged();
  };
  const clear = async () => {
    if (refinement) await archive.indications.removeRefinement(refinement.id);
    setLabel(""); setMeaning(""); setDirty(false);
    onChanged();
  };
  const filled = !!(refinement && (refinement.label || refinement.meaning));

  return (
    <div className={`ie-form-row${focused ? " focused" : ""}${filled ? " filled" : ""}`}>
      <div className="ie-form-head">
        <span className="ie-form-ar quran">{spaced(lemma)}</span>
        <span className="ie-form-meta">{pos ?? ""}{pos ? " · " : ""}{count}×</span>
        {focused && <span className="ie-form-tag">tapped</span>}
        {!filled && <span className="ie-form-todo">needs meaning</span>}
      </div>
      <input className="board-input" placeholder="short label for this form" value={label}
        onChange={(e) => { setLabel(e.target.value); setDirty(true); }} onBlur={save} />
      <textarea className="board-input" rows={2} placeholder={`what ${lemma} means in this indication…`} value={meaning}
        onChange={(e) => { setMeaning(e.target.value); setDirty(true); }} onBlur={save} />
      {filled && <button className="ie-form-clear" onClick={clear}>clear</button>}
    </div>
  );
}
