// Word senses. Senses live on the ROOT — a root can hold several (its different
// "feels"); one is primary (the default gloss). Each root sense has a per-FORM
// refinement: the shade that sense takes in this exact word (lemma). A word's
// gloss is its form's refinement of the primary sense, else the sense's own text.
// Forms not yet refined show an empty slot asking to be completed (soft).
// Words with no root keep simple standalone senses.

import { useState } from "react";
import { api } from "../../api/client";
import { archive, newId } from "../../persistence/db";
import { useAsync } from "../../hooks/useAsync";
import type { RootSenseWithRefinement } from "../../api/types";

const spaced = (r: string) => r.split("").join(" ");

interface Props {
  lemma: string | null;
  root: string | null;
  onChanged?: () => void;
}

export function SensesPanel({ lemma, root, onChanged }: Props) {
  const [version, setVersion] = useState(0);
  const bump = () => { setVersion((v) => v + 1); onChanged?.(); };

  const data = useAsync(() => archive.senses.forWord(lemma, root), [lemma, root, version]);
  // the root's unique forms — the denominator for "N of M forms refined"
  const rootInfo = useAsync(() => (root ? api.root(root) : Promise.resolve(null)), [root]);
  const formCount = rootInfo.data ? new Set(rootInfo.data.forms.map((f) => f.lemma_arabic)).size : null;

  const rootSenses = data.data?.rootSenses ?? [];
  const lemmaSenses = data.data?.lemmaSenses ?? [];

  const [label, setLabel] = useState("");
  const [meaning, setMeaning] = useState("");
  const addRootSense = async () => {
    const l = label.trim(); const m = meaning.trim();
    if (!l && !m) return;
    await archive.senses.save({ id: newId("sense"), root, lemma, label: l, meaning: m });
    setLabel(""); setMeaning("");
    bump();
  };

  return (
    <div className="senses-panel">
      {root ? (
        <>
          {rootSenses.length === 0 && !data.loading && (
            <p className="senses-empty">
              No senses yet for the root <span className="quran">{spaced(root)}</span>. Add one below — then give
              each form its own shade of that meaning.
            </p>
          )}

          {rootSenses.map((s) => (
            <RootSenseRow
              key={s.id}
              sense={s}
              lemma={lemma}
              formCount={formCount}
              onChanged={bump}
            />
          ))}

          <div className="sense-add">
            <p className="sense-add-head">Add a sense of the root <span className="quran">{spaced(root)}</span></p>
            <input className="board-input sense-label-input" placeholder="short label (e.g. attain / triumph)" value={label} onChange={(e) => setLabel(e.target.value)} />
            <textarea className="board-input sense-meaning-input" rows={2} placeholder="the root's meaning in this sense, in your words…" value={meaning} onChange={(e) => setMeaning(e.target.value)} />
            <button className="ctl establish-btn" disabled={!label.trim() && !meaning.trim()} onClick={addRootSense}>✒ add root sense</button>
          </div>
        </>
      ) : (
        // rootless word (particle, name): plain standalone senses
        <StandaloneLemma lemma={lemma} senses={lemmaSenses} loading={data.loading} onChanged={bump} />
      )}
    </div>
  );
}

function RootSenseRow({
  sense, lemma, formCount, onChanged,
}: {
  sense: RootSenseWithRefinement; lemma: string | null; formCount: number | null; onChanged: () => void;
}) {
  const [open, setOpen] = useState(!sense.refinement); // nudge: open when this form is unfilled
  const [label, setLabel] = useState(sense.refinement?.label ?? "");
  const [meaning, setMeaning] = useState(sense.refinement?.meaning ?? "");

  const setPrimary = async () => { await archive.senses.setPrimary(sense.id); onChanged(); };
  const remove = async () => { await archive.senses.remove(sense.id); onChanged(); };
  const saveRefinement = async () => {
    if (!lemma) return;
    await archive.senses.saveRefinement({
      id: sense.refinement?.id ?? newId("ref"),
      parentId: sense.id, lemma, label: label.trim(), meaning: meaning.trim(),
    });
    onChanged();
  };
  const clearRefinement = async () => {
    if (sense.refinement) await archive.senses.removeRefinement(sense.refinement.id);
    setLabel(""); setMeaning("");
    onChanged();
  };

  const done = formCount != null ? `${sense.refinedCount} of ${formCount} forms` : `${sense.refinedCount} forms`;

  return (
    <div className={`sense-row${sense.refinement ? " refined" : ""}`}>
      <div className="sense-row-head">
        <button className={`sense-primary${sense.primary ? " on" : ""}`} title={sense.primary ? "Primary sense (default gloss)" : "Make this the primary sense"} onClick={setPrimary}>
          {sense.primary ? "★" : "☆"}
        </button>
        <span className="sense-label">{sense.label || <em className="sense-unlabelled">(unlabelled)</em>}</span>
        <span className="sense-scope root" title="a sense of the whole root">root · {done}</span>
        <button className="sense-del" title="Delete this sense (and its refinements)" onClick={remove}>✕</button>
      </div>
      {sense.meaning && <p className="sense-meaning">{sense.meaning}</p>}

      {/* this form's refinement of the sense */}
      {lemma && (
        <div className="sense-refine">
          <button className="sense-refine-toggle" onClick={() => setOpen((o) => !o)}>
            {sense.refinement
              ? <>this form <span className="quran">{spaced(lemma)}</span>: “{sense.refinement.label || sense.refinement.meaning}” ✎</>
              : <span className="sense-refine-empty">✎ complete for this form <span className="quran">{spaced(lemma)}</span></span>}
          </button>
          {open && (
            <div className="sense-refine-edit">
              <input className="board-input" placeholder="this form's short label in this sense" value={label} onChange={(e) => setLabel(e.target.value)} />
              <textarea className="board-input" rows={2} placeholder="this form's shade of the sense, in your words…" value={meaning} onChange={(e) => setMeaning(e.target.value)} />
              <div className="sense-refine-actions">
                <button className="ctl" disabled={!label.trim() && !meaning.trim()} onClick={saveRefinement}>save form meaning</button>
                {sense.refinement && <button className="ctl subtle" onClick={clearRefinement}>clear</button>}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StandaloneLemma({
  lemma, senses, loading, onChanged,
}: {
  lemma: string | null; senses: import("../../api/types").WordSense[]; loading: boolean; onChanged: () => void;
}) {
  const [label, setLabel] = useState("");
  const [meaning, setMeaning] = useState("");
  const add = async () => {
    const l = label.trim(); const m = meaning.trim();
    if ((!l && !m) || !lemma) return;
    await archive.senses.save({ id: newId("sense"), lemma, label: l, meaning: m });
    setLabel(""); setMeaning("");
    onChanged();
  };
  return (
    <>
      {senses.length === 0 && !loading && (
        <p className="senses-empty">No senses yet. This word has no root, so give it a plain meaning below.</p>
      )}
      {senses.map((s) => (
        <div key={s.id} className="sense-row">
          <div className="sense-row-head">
            <button className={`sense-primary${s.primary ? " on" : ""}`} onClick={async () => { await archive.senses.setPrimary(s.id); onChanged(); }}>
              {s.primary ? "★" : "☆"}
            </button>
            <span className="sense-label">{s.label || <em className="sense-unlabelled">(unlabelled)</em>}</span>
            <button className="sense-del" onClick={async () => { await archive.senses.remove(s.id); onChanged(); }}>✕</button>
          </div>
          {s.meaning && <p className="sense-meaning">{s.meaning}</p>}
        </div>
      ))}
      <div className="sense-add">
        <input className="board-input sense-label-input" placeholder="short label" value={label} onChange={(e) => setLabel(e.target.value)} />
        <textarea className="board-input sense-meaning-input" rows={2} placeholder="the meaning, in your words…" value={meaning} onChange={(e) => setMeaning(e.target.value)} />
        <button className="ctl establish-btn" disabled={!label.trim() && !meaning.trim()} onClick={add}>✒ add sense</button>
      </div>
    </>
  );
}
