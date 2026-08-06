// Word indications. Indications live on the ROOT — a root can hold several (its different
// "feels"); one is primary (the default gloss). Each root indication has a per-FORM
// refinement: the shade that indication takes in this exact word (lemma). A word's
// gloss is its form's refinement of the primary indication, else the indication's own text.
// Forms not yet refined show an empty slot asking to be completed (soft).
// Words with no root keep simple standalone indications.

import { useState } from "react";
import { api } from "../../api/client";
import { archive, newId } from "../../persistence/db";
import { useAsync } from "../../hooks/useAsync";
import type { RootIndicationWithRefinement } from "../../api/types";

const spaced = (r: string) => r.split("").join(" ");

interface Props {
  lemma: string | null;
  root: string | null;
  onChanged?: () => void;
}

export function IndicationsPanel({ lemma, root, onChanged }: Props) {
  const [version, setVersion] = useState(0);
  const bump = () => { setVersion((v) => v + 1); onChanged?.(); };

  const data = useAsync(() => archive.indications.forWord(lemma, root), [lemma, root, version]);
  // the root's unique forms — the denominator for "N of M forms refined"
  const rootInfo = useAsync(() => (root ? api.root(root) : Promise.resolve(null)), [root]);
  const formCount = rootInfo.data ? new Set(rootInfo.data.forms.map((f) => f.lemma_arabic)).size : null;

  const rootIndications = data.data?.rootIndications ?? [];
  const lemmaIndications = data.data?.lemmaIndications ?? [];

  const [label, setLabel] = useState("");
  const [meaning, setMeaning] = useState("");
  const addRootIndication = async () => {
    const l = label.trim(); const m = meaning.trim();
    if (!l && !m) return;
    await archive.indications.save({ id: newId("indication"), root, lemma, label: l, meaning: m });
    setLabel(""); setMeaning("");
    bump();
  };

  return (
    <div className="indications-panel">
      {root ? (
        <>
          {rootIndications.length === 0 && !data.loading && (
            <p className="indications-empty">
              No indications yet for the root <span className="quran">{spaced(root)}</span>. Add one below — then give
              each form its own shade of that meaning.
            </p>
          )}

          {rootIndications.map((s) => (
            <RootIndicationRow
              key={s.id}
              indication={s}
              lemma={lemma}
              formCount={formCount}
              onChanged={bump}
            />
          ))}

          <div className="indication-add">
            <p className="indication-add-head">Add an indication of the root <span className="quran">{spaced(root)}</span></p>
            <input className="board-input indication-label-input" placeholder="short label (e.g. attain / triumph)" value={label} onChange={(e) => setLabel(e.target.value)} />
            <textarea className="board-input indication-meaning-input" rows={2} placeholder="the root's meaning in this indication, in your words…" value={meaning} onChange={(e) => setMeaning(e.target.value)} />
            <button className="ctl establish-btn" disabled={!label.trim() && !meaning.trim()} onClick={addRootIndication}>✒ add root indication</button>
          </div>
        </>
      ) : (
        // rootless word (particle, name): plain standalone indications
        <StandaloneLemma lemma={lemma} indications={lemmaIndications} loading={data.loading} onChanged={bump} />
      )}
    </div>
  );
}

function RootIndicationRow({
  indication, lemma, formCount, onChanged,
}: {
  indication: RootIndicationWithRefinement; lemma: string | null; formCount: number | null; onChanged: () => void;
}) {
  const [open, setOpen] = useState(!indication.refinement); // nudge: open when this form is unfilled
  const [label, setLabel] = useState(indication.refinement?.label ?? "");
  const [meaning, setMeaning] = useState(indication.refinement?.meaning ?? "");

  const setPrimary = async () => { await archive.indications.setPrimary(indication.id); onChanged(); };
  const remove = async () => { await archive.indications.remove(indication.id); onChanged(); };
  const saveRefinement = async () => {
    if (!lemma) return;
    await archive.indications.saveRefinement({
      id: indication.refinement?.id ?? newId("ref"),
      parentId: indication.id, lemma, label: label.trim(), meaning: meaning.trim(),
    });
    onChanged();
  };
  const clearRefinement = async () => {
    if (indication.refinement) await archive.indications.removeRefinement(indication.refinement.id);
    setLabel(""); setMeaning("");
    onChanged();
  };

  const done = formCount != null ? `${indication.refinedCount} of ${formCount} forms` : `${indication.refinedCount} forms`;

  return (
    <div className={`indication-row${indication.refinement ? " refined" : ""}`}>
      <div className="indication-row-head">
        <button className={`indication-primary${indication.primary ? " on" : ""}`} title={indication.primary ? "Primary indication (default gloss)" : "Make this the primary indication"} onClick={setPrimary}>
          {indication.primary ? "★" : "☆"}
        </button>
        <span className="indication-label">{indication.label || <em className="indication-unlabelled">(unlabelled)</em>}</span>
        <span className="indication-scope root" title="an indication of the whole root">root · {done}</span>
        <button className="indication-del" title="Delete this indication (and its refinements)" onClick={remove}>✕</button>
      </div>
      {indication.meaning && <p className="indication-meaning">{indication.meaning}</p>}

      {/* this form's refinement of the indication */}
      {lemma && (
        <div className="indication-refine">
          <button className="indication-refine-toggle" onClick={() => setOpen((o) => !o)}>
            {indication.refinement
              ? <>this form <span className="quran">{spaced(lemma)}</span>: “{indication.refinement.label || indication.refinement.meaning}” ✎</>
              : <span className="indication-refine-empty">✎ complete for this form <span className="quran">{spaced(lemma)}</span></span>}
          </button>
          {open && (
            <div className="indication-refine-edit">
              <input className="board-input" placeholder="this form's short label in this indication" value={label} onChange={(e) => setLabel(e.target.value)} />
              <textarea className="board-input" rows={2} placeholder="this form's shade of the indication, in your words…" value={meaning} onChange={(e) => setMeaning(e.target.value)} />
              <div className="indication-refine-actions">
                <button className="ctl" disabled={!label.trim() && !meaning.trim()} onClick={saveRefinement}>save form meaning</button>
                {indication.refinement && <button className="ctl subtle" onClick={clearRefinement}>clear</button>}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StandaloneLemma({
  lemma, indications, loading, onChanged,
}: {
  lemma: string | null; indications: import("../../api/types").WordIndication[]; loading: boolean; onChanged: () => void;
}) {
  const [label, setLabel] = useState("");
  const [meaning, setMeaning] = useState("");
  const add = async () => {
    const l = label.trim(); const m = meaning.trim();
    if ((!l && !m) || !lemma) return;
    await archive.indications.save({ id: newId("indication"), lemma, label: l, meaning: m });
    setLabel(""); setMeaning("");
    onChanged();
  };
  return (
    <>
      {indications.length === 0 && !loading && (
        <p className="indications-empty">No indications yet. This word has no root, so give it a plain meaning below.</p>
      )}
      {indications.map((s) => (
        <div key={s.id} className="indication-row">
          <div className="indication-row-head">
            <button className={`indication-primary${s.primary ? " on" : ""}`} onClick={async () => { await archive.indications.setPrimary(s.id); onChanged(); }}>
              {s.primary ? "★" : "☆"}
            </button>
            <span className="indication-label">{s.label || <em className="indication-unlabelled">(unlabelled)</em>}</span>
            <button className="indication-del" onClick={async () => { await archive.indications.remove(s.id); onChanged(); }}>✕</button>
          </div>
          {s.meaning && <p className="indication-meaning">{s.meaning}</p>}
        </div>
      ))}
      <div className="indication-add">
        <input className="board-input indication-label-input" placeholder="short label" value={label} onChange={(e) => setLabel(e.target.value)} />
        <textarea className="board-input indication-meaning-input" rows={2} placeholder="the meaning, in your words…" value={meaning} onChange={(e) => setMeaning(e.target.value)} />
        <button className="ctl establish-btn" disabled={!label.trim() && !meaning.trim()} onClick={add}>✒ add indication</button>
      </div>
    </>
  );
}
