// The Indication Editor — a focused modal for the reader's own meanings of a root.
// Left: the root's indications (add / pick primary / delete / rename). Right: for the
// selected indication, EVERY form of the root with its own editable meaning
// (refinement) — so you can set the meaning for any form, not just the word you
// tapped. A dictionaries panel sits alongside for lookup while you write.

import { useEffect, useMemo, useState } from "react";
import { api } from "../../api/client";
import { archive, newId } from "../../persistence/db";
import { useAsync } from "../../hooks/useAsync";
import type { RootIndicationWithRefinement, WordIndication, PeerIndication } from "../../api/types";
import { IndicationPromptPanel } from "./IndicationPromptPanel";
import { ProposeReading } from "./ProposeReading";
import { remote } from "../../api/remote";
import { useMe } from "../../hooks/useMe";
import { proposals, readingHash, type Refinement } from "../../persistence/db";

const spaced = (r: string) => r.split("").join("\u00A0"); // nbsp: root letters must not wrap (ه د ي)

interface Props {
  root: string;
  /** the form the reader tapped, highlighted in the forms list */
  focusLemma?: string | null;
  onClose: () => void;
  onChanged?: () => void;
}

/** A distinct SURFACE form of the root (the word as written), with the lemma it inflects and
 *  how often it occurs. Refinements are keyed by `surface`. */
interface SurfaceForm {
  surface: string;
  lemma: string | null;
  pos: string | null;
  count: number;
}

export function IndicationEditor({ root, focusLemma, onClose, onChanged }: Props) {
  const [version, setVersion] = useState(0);
  const bump = () => { setVersion((v) => v + 1); onChanged?.(); };

  const rootInfo = useAsync(() => api.root(root), [root]);
  // SURFACE forms (the words as written) — one row per distinct form_arabic, not per lemma, so
  // a plural like أَصْلَٰب is listed and given its own meaning apart from its singular صُّلْب.
  const occs = useAsync(() => api.rootOccurrences(root, "uthmani"), [root]);
  const surfaceForms = useMemo<SurfaceForm[]>(() => {
    const seen = new Map<string, SurfaceForm>();
    for (const o of occs.data ?? []) {
      const surface = o.form_arabic;
      if (!surface) continue;
      const cur = seen.get(surface);
      if (cur) cur.count++;
      else seen.set(surface, { surface, lemma: o.lemma_arabic, pos: o.pos_english, count: 1 });
    }
    return [...seen.values()].sort((a, b) => b.count - a.count);
  }, [occs.data]);

  // pass the tapped form, so the community's readings of THIS form come back too
  const data = useAsync(
    () => archive.indications.forWord(focusLemma ?? null, root), [root, focusLemma, version]);
  const indications = data.data?.rootIndications ?? [];
  const communityRoot = data.data?.communityRoot ?? [];
  const communityLemma = data.data?.communityLemma ?? [];

  // A selection is either one of your indications or a community reading. The peer id space
  // is disjoint ("peer:…"), so one piece of state serves both.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const community = [...communityRoot, ...communityLemma];
  const selectedPeer = community.find((p) => p.id === selectedId) ?? null;
  // keep a valid selection among YOUR indications: chosen → primary → first (unless a peer is picked)
  const selected = selectedPeer
    ? null
    : indications.find((s) => s.id === selectedId) ?? indications.find((s) => s.primary) ?? indications[0] ?? null;

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

            {/* what others hold — selectable, so their per-form reading shows on the right */}
            <CommunityChips
              root={communityRoot}
              lemma={focusLemma ? communityLemma : []}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
          </aside>

          {/* the selection: your indication (editable) or a community reading (read-only) */}
          <main className="ie-forms-wrap">
            {selectedPeer ? (
              <CommunityForms
                key={selectedPeer.id}
                reading={selectedPeer}
                forms={surfaceForms}
                focusLemma={focusLemma ?? null}
              />
            ) : selected ? (
              <IndicationForms
                key={selected.id}
                indication={selected}
                forms={surfaceForms}
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

const STATUS_HINT: Record<PeerIndication["status"], string> = {
  established: "the group's current reading — a majority of reviewers carried it",
  proposed: "argued and on record, but it has not carried a majority",
  superseded: "its author has since written a later version; this one stays citable",
};

/**
 * Approve / object / establish — only for moderators and maintainers, and never on your own
 * reading (you can't approve yourself). An objection to something already established becomes a
 * dissent rather than removing it. All of this writes upstream, so we say "Sync to see it"
 * rather than mutating the local list.
 */
function ReviewControls({ reading }: { reading: PeerIndication }) {
  const { me, canReview, canEstablish } = useMe();
  const [busy, setBusy] = useState<null | "approve" | "object" | "establish">(null);
  const [note, setNote] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  if (!canReview) return null;
  // the claim's author_id is the remote user id (§ server self-approval guard uses the same)
  const mine = !!me && me.id === reading.authorId;

  const act = async (kind: "approve" | "object" | "establish") => {
    setBusy(kind); setErr(null); setNote(null);
    try {
      if (kind === "establish") {
        await remote.establish(reading.claimId, reading.version);
        setNote("Established. Sync to see it as the group's reading.");
      } else {
        const t = await remote.review(reading.claimId, reading.version, { decision: kind });
        setNote(kind === "approve"
          ? (t.established ? "Approved — it carried a majority and is now established. Sync to see it."
                           : `Approved. ${t.approvals} approval${t.approvals === 1 ? "" : "s"} · ${t.objections} objection${t.objections === 1 ? "" : "s"}.`)
          : "Objection recorded. If the reading is established, it's kept as a dissent.");
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally { setBusy(null); }
  };

  return (
    <div className="review">
      {mine ? (
        <p className="acct-hint">This is your own reading — you can't approve it yourself.</p>
      ) : (
        <div className="review-actions">
          <button className="ctl" disabled={!!busy} onClick={() => act("approve")}>
            {busy === "approve" ? "…" : "✓ Approve"}
          </button>
          <button className="ctl" disabled={!!busy} onClick={() => act("object")}>
            {busy === "object" ? "…" : "✕ Object"}
          </button>
          {canEstablish && reading.status !== "established" && (
            <button className="ctl" disabled={!!busy} title="Establish directly (maintainer)" onClick={() => act("establish")}>
              {busy === "establish" ? "…" : "★ Establish"}
            </button>
          )}
        </div>
      )}
      {note && <p className="acct-hint">{note}</p>}
      {err && <p className="acct-error" role="alert">{err}</p>}
    </div>
  );
}

/** Who submitted a community reading, and who approved it — attribution is the point (§1). */
function Attribution({ reading }: { reading: PeerIndication }) {
  return (
    <p className="community-attrib">
      <span className="community-attrib-by">
        submitted by <strong>{reading.authorName || "unknown"}</strong>
      </span>
      {reading.approvers.length > 0 && (
        <span className="community-attrib-approvers">
          {" "}· approved by {reading.approvers.join(", ")}
        </span>
      )}
      {reading.status === "established" && reading.approvers.length === 0 && (
        <span className="community-attrib-approvers"> · established by a maintainer</span>
      )}
    </p>
  );
}

/**
 * The community's readings, as selectable chips beneath your own. Picking one shows its
 * per-form view on the right, exactly as your own indications do — but read-only. No star and
 * no delete: you cannot promote or edit someone else's reading, only weigh it.
 */
function CommunityChips({
  root, lemma, selectedId, onSelect,
}: {
  root: PeerIndication[]; lemma: PeerIndication[];
  selectedId: string | null; onSelect: (id: string) => void;
}) {
  if (root.length === 0 && lemma.length === 0) return null;
  const chip = (p: PeerIndication) => (
    <button
      key={p.id}
      className={`ie-chip community${selectedId === p.id ? " active" : ""}`}
      onClick={() => onSelect(p.id)}
    >
      <span className="ie-chip-name">
        <span className="community-mark" aria-hidden>◈</span>{" "}
        {p.label || p.meaning || "(unlabelled)"}
      </span>
      <span className="ie-chip-meta">
        <span className={`community-status ${p.status}`} title={STATUS_HINT[p.status]}>{p.status}</span>
        {p.dissents > 0 && <span className="community-dissent">{p.dissents} dissent{p.dissents === 1 ? "" : "s"}</span>}
        {p.authorName && <span className="community-attrib-by">{p.authorName}</span>}
      </span>
    </button>
  );
  return (
    <div className="community-block">
      <p className="community-head"><span className="community-mark" aria-hidden>◈</span> From the community</p>
      {root.map(chip)}
      {lemma.map(chip)}
    </div>
  );
}

/**
 * A community reading's per-form view: the reading's own text, then every form of the root
 * paired with whatever the community has said about that exact form. Read-only throughout —
 * this is someone else's work, shown so you can weigh it against your own.
 */
function CommunityForms({
  reading, forms, focusLemma,
}: {
  reading: PeerIndication;
  forms: SurfaceForm[];
  focusLemma: string | null;
}) {
  const surfaces = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const f of forms) {
      if (f.surface && !seen.has(f.surface)) { seen.add(f.surface); out.push(f.surface); }
    }
    out.sort((a, b) => (a === focusLemma ? -1 : b === focusLemma ? 1 : 0));
    return out;
  }, [forms, focusLemma]);

  // this reading's OWN per-form shades, as its author proposed them — keyed by surface form.
  const map: Record<string, { label: string; meaning: string }> = {};
  for (const rf of reading.refinements ?? []) if (rf.lemma) map[rf.lemma] = rf;

  return (
    <div className="ie-forms">
      <div className="ie-indication-edit community-reading">
        <div className="community-reading-head">
          <span className="community-mark" aria-hidden>◈</span>
          {/* the reading in full — wraps, never truncated like a chip */}
          <span className="community-reading-title">{reading.label || reading.meaning || "(unlabelled)"}</span>
          <span className={`community-status ${reading.status}`} title={STATUS_HINT[reading.status]}>{reading.status}</span>
        </div>
        {reading.label && reading.meaning && <p className="indication-meaning">{reading.meaning}</p>}
        <Attribution reading={reading} />
        <p className="acct-hint">A reading held by the community. You can weigh it, not edit it — to hold it yourself, write your own indication.</p>
        <ReviewControls reading={reading} />
      </div>

      <p className="ie-section">Each form, as the community reads it</p>
      <div className="ie-form-rows">
        {surfaces.map((surface) => {
          const r = map[surface];
          return (
            <div key={surface} className={`ie-form-row community${surface === focusLemma ? " focused" : ""}${r ? " filled" : ""}`}>
              <div className="ie-form-head">
                <span className="ie-form-ar quran">{spaced(surface)}</span>
                {surface === focusLemma && <span className="ie-form-tag">tapped</span>}
                {!r && <span className="ie-form-todo">no community reading</span>}
              </div>
              {r && (
                <p className="indication-meaning">
                  {r.label && <strong>{r.label}{r.meaning ? " — " : ""}</strong>}{r.meaning}
                </p>
              )}
            </div>
          );
        })}
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
  indication: RootIndicationWithRefinement; forms: SurfaceForm[];
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

  // this indication's per-form refinements. `lemma` may hold a SURFACE form (new) or, for
  // refinements written before the switch, the lemma (legacy) — so we index by whatever it is.
  const [refsTick, setRefsTick] = useState(0);
  const refs = useAsync(() => archive.indications.refinements(indication.id), [indication.id, refsTick]);
  const reloadRefs = () => setRefsTick((t) => t + 1);
  const refByKey = useMemo(() => {
    const m = new Map<string, WordIndication>();
    for (const r of refs.data ?? []) if (r.lemma) m.set(r.lemma, r);
    return m;
  }, [refs.data]);

  // the refinement for a surface form: its own (by surface), else the legacy one by lemma
  const refFor = (f: SurfaceForm): WordIndication | null =>
    refByKey.get(f.surface) ?? (f.lemma ? refByKey.get(f.lemma) ?? null : null);

  const uniqueForms = useMemo(() => {
    const seen = new Set<string>();
    const out: SurfaceForm[] = [];
    for (const f of forms) {
      if (seen.has(f.surface)) continue;
      seen.add(f.surface);
      out.push(f);
    }
    // the tapped form first (focusLemma may be the surface or the lemma)
    out.sort((a, b) =>
      (a.surface === focusLemma || a.lemma === focusLemma ? -1 : b.surface === focusLemma || b.lemma === focusLemma ? 1 : 0));
    return out;
  }, [forms, focusLemma]);

  // One-time migration (§ user chose "carry them onto each surface form"): copy any legacy
  // lemma-keyed refinement onto each surface form of that lemma, so nothing written before the
  // switch is lost. Idempotent — once a surface has its own refinement, it's skipped.
  useEffect(() => {
    if (!refs.data || uniqueForms.length === 0) return;
    const have = new Set(refs.data.map((r) => r.lemma).filter(Boolean) as string[]);
    const toCopy = uniqueForms.filter((f) =>
      !have.has(f.surface) && f.lemma && refByKey.get(f.lemma) &&
      !!(refByKey.get(f.lemma)!.label || refByKey.get(f.lemma)!.meaning));
    if (toCopy.length === 0) return;
    (async () => {
      for (const f of toCopy) {
        const src = refByKey.get(f.lemma!)!;
        await archive.indications.saveRefinement({
          id: newId("ref"), parentId: indication.id, lemma: f.surface, label: src.label, meaning: src.meaning,
        });
      }
      reloadRefs();
    })();
  }, [refs.data, uniqueForms, indication.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // A proposal carries the WHOLE reading: the root meaning + every form's shade. So we gather
  // the refinements, and the forms still missing one — a reading may only be proposed complete.
  const refinements: Refinement[] = uniqueForms
    .map((f) => { const r = refFor(f); return r && (r.label || r.meaning) ? { lemma: f.surface, label: r.label, meaning: r.meaning } : null; })
    .filter((r): r is Refinement => !!r);
  const missingForms = uniqueForms
    .filter((f) => { const r = refFor(f); return !r || !(r.label || r.meaning); })
    .map((f) => f.surface);

  const [proposing, setProposing] = useState(false);

  // "not proposed" vs "proposed" vs "changed since I proposed it" — from the local outbox
  const [propTick, setPropTick] = useState(0);
  const proposal = useAsync(
    () => (indication.root ? proposals.get("root", indication.root) : Promise.resolve(null)),
    [indication.root, propTick]);
  const currentHash = readingHash(label.trim(), meaning.trim(), refinements);
  const proposedState: "none" | "current" | "changed" =
    !proposal.data ? "none" : proposal.data.contentHash === currentHash ? "current" : "changed";

  const proposeLabel =
    proposedState === "current" ? "◈ Proposed ✓"
    : proposedState === "changed" ? "◈ Propose the update"
    : "◈ Propose to community";

  return (
    <div className="ie-forms">
      <div className="ie-indication-edit">
        <input className="board-input ie-indication-label" placeholder="indication label" value={label} onChange={(e) => setLabel(e.target.value)} onBlur={saveIndication} />
        <textarea className="board-input" rows={2} placeholder="the root's meaning in this indication, in your words…" value={meaning} onChange={(e) => setMeaning(e.target.value)} onBlur={saveIndication} />
        {indication.root && (label.trim() || meaning.trim()) && (
          <div className="ie-propose-row">
            <button
              className={`ctl${proposedState === "current" ? " proposed" : ""}`}
              disabled={proposedState === "current"}
              title={proposedState === "current"
                ? "Already proposed. Change the reading to propose an update."
                : "Offer this reading of the root to the community"}
              onClick={() => setProposing(true)}
            >{proposeLabel}</button>
            {proposedState === "current" && (
              <span className="acct-hint">Sync to see it in the community list.</span>
            )}
          </div>
        )}
      </div>

      {proposing && indication.root && (
        <ProposeReading
          subjectKind="root"
          subjectValue={indication.root}
          defaultLabel={label.trim()}
          defaultMeaning={meaning.trim()}
          refinements={refinements}
          missingForms={missingForms}
          onClose={() => { setProposing(false); setPropTick((t) => t + 1); }}
        />
      )}

      <p className="ie-section">Each form’s meaning in this indication</p>
      <div className="ie-form-rows">
        {uniqueForms.map((f) => (
          <FormRow
            key={f.surface}
            indicationId={indication.id}
            formKey={f.surface}
            pos={f.pos}
            count={f.count}
            focused={f.surface === focusLemma || f.lemma === focusLemma}
            refinement={refFor(f)}
            onChanged={() => { reloadRefs(); onChanged(); }}
          />
        ))}
      </div>
    </div>
  );
}

function FormRow({
  indicationId, formKey, pos, count, focused, refinement, onChanged,
}: {
  indicationId: string; formKey: string; pos: string | null; count: number; focused: boolean;
  refinement: WordIndication | null; onChanged: () => void;
}) {
  const lemma = formKey; // the refinement key = the surface form (the word as written)
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
