// The Sense Editor — a focused modal for the reader's own meanings of a root.
// Left: the root's senses (add / pick primary / delete / rename). Right: for the
// selected sense, EVERY form of the root with its own editable meaning
// (refinement) — so you can set the meaning for any form, not just the word you
// tapped. A dictionaries panel sits alongside for lookup while you write.

import { useEffect, useMemo, useState } from "react";
import { api } from "../../api/client";
import { archive, newId } from "../../persistence/db";
import { useAsync } from "../../hooks/useAsync";
import type { RootSenseWithRefinement, WordSense } from "../../api/types";
import { SensePromptPanel } from "./SensePromptPanel";

const spaced = (r: string) => r.split("").join(" ");

interface Props {
  root: string;
  /** the form the reader tapped, highlighted in the forms list */
  focusLemma?: string | null;
  onClose: () => void;
  onChanged?: () => void;
}

export function SenseEditor({ root, focusLemma, onClose, onChanged }: Props) {
  const [version, setVersion] = useState(0);
  const bump = () => { setVersion((v) => v + 1); onChanged?.(); };

  const rootInfo = useAsync(() => api.root(root), [root]);
  const data = useAsync(() => archive.senses.forWord(null, root), [root, version]);
  const senses = data.data?.rootSenses ?? [];

  const [selectedId, setSelectedId] = useState<string | null>(null);
  // keep a valid selection: chosen → primary → first
  const selected =
    senses.find((s) => s.id === selectedId) ?? senses.find((s) => s.primary) ?? senses[0] ?? null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const [promptOpen, setPromptOpen] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const addSense = async () => {
    const label = newLabel.trim();
    if (!label) return;
    const id = newId("sense");
    await archive.senses.save({ id, root, label, meaning: "" });
    setNewLabel("");
    setSelectedId(id);
    bump();
  };

  return (
    // close on click (not mousedown) so a focused field's blur-save runs first
    <div className="modal-overlay" onClick={onClose}>
      <div className="sense-editor" onClick={(e) => e.stopPropagation()}>
        <header className="se-head">
          <div className="se-title">
            <span className="se-root quran">{spaced(root)}</span>
            {rootInfo.data?.meaning_en && <span className="se-core">{rootInfo.data.meaning_en}</span>}
          </div>
          <div className="se-head-actions">
            <button
              className="ctl"
              title="Build an AI prompt that tests a sense against every form of this root"
              onClick={() => setPromptOpen(true)}
            >⇱ Create prompt</button>
            <button className="se-close" onClick={onClose} title="Close">✕</button>
          </div>
        </header>

        <div className="se-body">
          {/* senses of the root */}
          <aside className="se-senses">
            <p className="se-section">Senses of this root</p>
            {senses.length === 0 && !data.loading && (
              <p className="senses-empty">None yet. Name the first sense below.</p>
            )}
            <div className="se-sense-list">
              {senses.map((s) => (
                <SenseChip
                  key={s.id}
                  sense={s}
                  active={selected?.id === s.id}
                  onSelect={() => setSelectedId(s.id)}
                  onPrimary={async () => { await archive.senses.setPrimary(s.id); bump(); }}
                  onDelete={async () => { await archive.senses.remove(s.id); if (selectedId === s.id) setSelectedId(null); bump(); }}
                />
              ))}
            </div>
            <div className="se-add">
              <input
                className="board-input"
                placeholder="name a sense (e.g. attain / triumph)"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") addSense(); }}
              />
              <button className="ctl establish-btn" disabled={!newLabel.trim()} onClick={addSense}>＋ Add sense</button>
            </div>
          </aside>

          {/* the selected sense: its text + every form's own meaning */}
          <main className="se-forms-wrap">
            {selected ? (
              <SenseForms
                key={selected.id}
                sense={selected}
                forms={rootInfo.data?.forms ?? []}
                focusLemma={focusLemma ?? null}
                onChanged={bump}
              />
            ) : (
              <p className="senses-empty se-pad">Pick or add a sense to give each form its meaning.</p>
            )}
          </main>

          {/* dictionaries for lookup while writing */}
          <aside className="se-dict">
            <p className="se-section">Dictionaries</p>
            {rootInfo.loading && <p className="loading">…</p>}
            {(rootInfo.data?.meanings ?? []).length === 0 && !rootInfo.loading && (
              <p className="senses-empty">No lexicon entries.</p>
            )}
            <div className="se-dict-list">
              {(rootInfo.data?.meanings ?? []).map((m, i) => (
                <div key={i} className="se-dict-entry">
                  <div className="se-dict-src"><span className="stamp">{m.source}</span> <span className="se-dict-lang">{m.language}</span></div>
                  <p className={`se-dict-text${m.language === "arabic" ? " ref-ar quran" : ""}`} dir={m.language === "arabic" ? "rtl" : "ltr"}>{m.meaning}</p>
                </div>
              ))}
            </div>
          </aside>
        </div>

        {promptOpen && (
          <SensePromptPanel
            root={root}
            detail={rootInfo.data ?? null}
            initialSense={[selected?.label, selected?.meaning].filter(Boolean).join(" — ")}
            onClose={() => setPromptOpen(false)}
          />
        )}
      </div>
    </div>
  );
}

function SenseChip({
  sense, active, onSelect, onPrimary, onDelete,
}: {
  sense: RootSenseWithRefinement; active: boolean; onSelect: () => void; onPrimary: () => void; onDelete: () => void;
}) {
  return (
    <div className={`se-chip${active ? " active" : ""}`}>
      <button className={`sense-primary${sense.primary ? " on" : ""}`} title={sense.primary ? "Primary (default gloss)" : "Make primary"} onClick={onPrimary}>
        {sense.primary ? "★" : "☆"}
      </button>
      <button className="se-chip-label" onClick={onSelect}>
        <span className="se-chip-name">{sense.label || "(unlabelled)"}</span>
        <span className="se-chip-meta">{sense.refinedCount} refined</span>
      </button>
      <button className="sense-del" title="Delete sense" onClick={onDelete}>✕</button>
    </div>
  );
}

function SenseForms({
  sense, forms, focusLemma, onChanged,
}: {
  sense: RootSenseWithRefinement; forms: { lemma_arabic: string | null; pos_english: string | null; occurrence_count: number }[];
  focusLemma: string | null; onChanged: () => void;
}) {
  // the sense's own text (the root-level meaning)
  const [label, setLabel] = useState(sense.label);
  const [meaning, setMeaning] = useState(sense.meaning);
  useEffect(() => { setLabel(sense.label); setMeaning(sense.meaning); }, [sense.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const saveSense = async () => {
    await archive.senses.save({ id: sense.id, root: sense.root, label: label.trim(), meaning: meaning.trim(), primary: sense.primary });
    onChanged();
  };

  // this sense's per-form refinements, keyed by lemma
  const refs = useAsync(() => archive.senses.refinements(sense.id), [sense.id]);
  const refByLemma = useMemo(() => {
    const m = new Map<string, WordSense>();
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
    <div className="se-forms">
      <div className="se-sense-edit">
        <input className="board-input se-sense-label" placeholder="sense label" value={label} onChange={(e) => setLabel(e.target.value)} onBlur={saveSense} />
        <textarea className="board-input" rows={2} placeholder="the root's meaning in this sense, in your words…" value={meaning} onChange={(e) => setMeaning(e.target.value)} onBlur={saveSense} />
      </div>

      <p className="se-section">Each form’s meaning in this sense</p>
      <div className="se-form-rows">
        {uniqueForms.map((f) => (
          <FormRow
            key={f.lemma}
            senseId={sense.id}
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
  senseId, lemma, pos, count, focused, refinement, onChanged,
}: {
  senseId: string; lemma: string; pos: string | null; count: number; focused: boolean;
  refinement: WordSense | null; onChanged: () => void;
}) {
  const [label, setLabel] = useState(refinement?.label ?? "");
  const [meaning, setMeaning] = useState(refinement?.meaning ?? "");
  const [dirty, setDirty] = useState(false);
  useEffect(() => { setLabel(refinement?.label ?? ""); setMeaning(refinement?.meaning ?? ""); setDirty(false); }, [refinement?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    if (!dirty) return;
    await archive.senses.saveRefinement({
      id: refinement?.id ?? newId("ref"), parentId: senseId, lemma, label: label.trim(), meaning: meaning.trim(),
    });
    setDirty(false);
    onChanged();
  };
  const clear = async () => {
    if (refinement) await archive.senses.removeRefinement(refinement.id);
    setLabel(""); setMeaning(""); setDirty(false);
    onChanged();
  };
  const filled = !!(refinement && (refinement.label || refinement.meaning));

  return (
    <div className={`se-form-row${focused ? " focused" : ""}${filled ? " filled" : ""}`}>
      <div className="se-form-head">
        <span className="se-form-ar quran">{spaced(lemma)}</span>
        <span className="se-form-meta">{pos ?? ""}{pos ? " · " : ""}{count}×</span>
        {focused && <span className="se-form-tag">tapped</span>}
        {!filled && <span className="se-form-todo">needs meaning</span>}
      </div>
      <input className="board-input" placeholder="short label for this form" value={label}
        onChange={(e) => { setLabel(e.target.value); setDirty(true); }} onBlur={save} />
      <textarea className="board-input" rows={2} placeholder={`what ${lemma} means in this sense…`} value={meaning}
        onChange={(e) => { setMeaning(e.target.value); setDirty(true); }} onBlur={save} />
      {filled && <button className="se-form-clear" onClick={clear}>clear</button>}
    </div>
  );
}
