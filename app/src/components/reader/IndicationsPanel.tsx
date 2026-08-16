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
import type { RootIndicationWithRefinement, PeerIndication } from "../../api/types";

const spaced = (r: string) => r.split("").join("\u00A0"); // nbsp: root letters must not wrap (ه د ي)

/**
 * The community's readings, in the same list as the reader's own.
 *
 * They are shown, never merged: no star (you cannot make someone else's reading your default
 * gloss), no delete, no edit. If you want to hold what they hold, you write it yourself — which
 * keeps every indication in your database something you actually chose.
 */
export function CommunityIndications({ items, subject }: { items: PeerIndication[]; subject: string }) {
  if (items.length === 0) return null;
  return (
    <div className="community-block">
      <p className="community-head">
        <span className="community-mark" aria-hidden>◈</span>
        From the community · {subject}
      </p>
      {items.map((p) => (
        <div key={p.id} className={`indication-row community st-${p.status}`}>
          <div className="indication-row-head">
            <span className="community-mark" aria-hidden title="a reading from the research community">◈</span>
            <span className="indication-label">
              {p.label || p.meaning || <em className="indication-unlabelled">(unlabelled)</em>}
            </span>
            <span className={`community-status ${p.status}`} title={STATUS_HINT[p.status]}>
              {p.status === "established" ? "established" : p.status}
            </span>
            {p.dissents > 0 && (
              <span className="community-dissent" title="objections filed against this reading">
                {p.dissents} dissent{p.dissents === 1 ? "" : "s"}
              </span>
            )}
          </div>
          {p.label && p.meaning && <p className="indication-meaning">{p.meaning}</p>}
        </div>
      ))}
    </div>
  );
}

const STATUS_HINT: Record<PeerIndication["status"], string> = {
  established: "the group's current reading — a majority of reviewers carried it",
  proposed: "argued and on record, but it has not carried a majority",
  superseded: "its author has since written a later version; this one stays citable",
};

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
  const communityRoot = data.data?.communityRoot ?? [];
  const communityLemma = data.data?.communityLemma ?? [];

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
              {communityRoot.length + communityLemma.length > 0
                ? <>None of your own yet for the root <span className="quran">{spaced(root)}</span> — the community's are below. Add yours, then give each form its own shade of that meaning.</>
                : <>No indications yet for the root <span className="quran">{spaced(root)}</span>. Add one below — then give each form its own shade of that meaning.</>}
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

          {/* others' readings of the same root, and of this exact form */}
          <CommunityIndications items={communityRoot} subject="this root" />
          {lemma && <CommunityIndications items={communityLemma} subject="this form" />}

          <div className="indication-add">
            <p className="indication-add-head">Add an indication of the root <span className="quran">{spaced(root)}</span></p>
            <input className="board-input indication-label-input" placeholder="short label (e.g. attain / triumph)" value={label} onChange={(e) => setLabel(e.target.value)} />
            <textarea className="board-input indication-meaning-input" rows={2} placeholder="the root's meaning in this indication, in your words…" value={meaning} onChange={(e) => setMeaning(e.target.value)} />
            <button className="ctl establish-btn" disabled={!label.trim() && !meaning.trim()} onClick={addRootIndication}>✒ add root indication</button>
          </div>
        </>
      ) : (
        // rootless word (particle, name): plain standalone indications
        <StandaloneLemma
          lemma={lemma}
          indications={lemmaIndications}
          community={communityLemma}
          loading={data.loading}
          onChanged={bump}
        />
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
  lemma, indications, community, loading, onChanged,
}: {
  lemma: string | null; indications: import("../../api/types").WordIndication[];
  community: PeerIndication[]; loading: boolean; onChanged: () => void;
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
      <CommunityIndications items={community} subject="this word" />
      <div className="indication-add">
        <input className="board-input indication-label-input" placeholder="short label" value={label} onChange={(e) => setLabel(e.target.value)} />
        <textarea className="board-input indication-meaning-input" rows={2} placeholder="the meaning, in your words…" value={meaning} onChange={(e) => setMeaning(e.target.value)} />
        <button className="ctl establish-btn" disabled={!label.trim() && !meaning.trim()} onClick={add}>✒ add indication</button>
      </div>
    </>
  );
}
