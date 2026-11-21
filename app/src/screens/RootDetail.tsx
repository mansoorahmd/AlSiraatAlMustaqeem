// A full page for one root, in the order the methodology reads it: first the Book's own use of
// the root (its forms, every āyah each occurs in, the roots it keeps company with), then the
// reader's own meaning (with what their case on the root rests on, and the meanings they replaced),
// and last the dictionaries, which were all written after the Book, each with who wrote it and when.
// Reached from the Roots Explorer and from a word's root while reading.

import { useEffect, useMemo, useState } from "react";
import { api, announcePlanLock } from "../api/client";
import { useAsync } from "../hooks/useAsync";
import { archive, newId } from "../persistence/db";
import { useAppState, useAppDispatch } from "../state/store";
import { useAddToCompare } from "../compare/useAddToCompare";
import { useFeature, useFeatureCatalog, lockReason } from "../lib/features";
import { offerRuleScope } from "../lib/ruleHandoff";
import { PlanLock } from "../components/PlanLock";
import { RevisionTrail, revisionsMayHaveChanged } from "../components/research/RevisionTrail";
import { RestsOnLine } from "../components/case/EvidenceCount";
import { normalizeCase, restsOn, restsOnLine } from "../cases/ops";

const spaced = (r: string) => r.split("").join(" "); // nbsp: root letters must not wrap (ه د ي)
const vsort = (k: string) => {
  const [c, v] = k.split(":").map((n) => parseInt(n, 10) || 0);
  return (c ?? 0) * 1000 + (v ?? 0);
};

/** A dictionary as the corpus names it (root_meanings.source). Who wrote it and when is given
 *  only where the source key names one work beyond doubt; the others show their name alone. */
interface Lexicon { name: string; by?: string; when?: string; year?: number }
const LEXICONS: Record<string, Lexicon> = {
  maqayees: { name: "Maqāyīs al-Lugha", by: "Ibn Fāris", when: "d. 1004", year: 1004 },
  mufradat: { name: "Mufradāt alfāẓ al-Qurʾān", by: "al-Rāghib al-Iṣfahānī", when: "d. c. 1108", year: 1108 },
  lisan_ul_arab: { name: "Lisān al-ʿArab", by: "Ibn Manẓūr", when: "d. 1311", year: 1311 },
  lanes_lexicon: { name: "Lane's Arabic-English Lexicon", by: "E. W. Lane", when: "1863 to 1893", year: 1863 },
  lanes_csv: { name: "Lane's Arabic-English Lexicon", by: "E. W. Lane", when: "1863 to 1893", year: 1863 },
  hans_wehr: { name: "Hans Wehr", when: "1952 (English edition 1961)", year: 1952 },
  mujam_wasith: { name: "al-Muʿjam al-Wasīṭ", by: "Cairo Academy", when: "1960", year: 1960 },
  // named by the corpus without enough to say which work, so no author or date
  mujam_ghoni: { name: "Muʿjam al-Ghanī" },
  mujam_muhith: { name: "Muʿjam al-Muḥīṭ" },
  mujam_shihah: { name: "Muʿjam al-Ṣiḥāḥ" },
  corpus: { name: "Quranic Corpus" },
};
const lexiconOf = (source: string): Lexicon => LEXICONS[source] ?? { name: source };

interface Props {
  rootBuckwalter: string;
  rootArabic: string;
  onBack: () => void;
  onOpenRoot?: (buckwalter: string, arabic: string) => void;
}

export function RootDetail({ rootBuckwalter, rootArabic, onBack, onOpenRoot }: Props) {
  // your own meaning and motifs are read-only when the plan doesn't include them (lib/features.ts)
  const canMine = useFeature("my-meanings");
  const canMotifs = useFeature("motifs");
  const canRules = useFeature("rules");
  const catalog = useFeatureCatalog();
  const { reading } = useAppState();
  const dispatch = useAppDispatch();
  const addToCompare = useAddToCompare();

  const detail = useAsync(() => api.root(rootBuckwalter), [rootBuckwalter]);
  // every occurrence is the Follow root tool; the company a root keeps is Where roots meet
  const canOcc = useFeature("follow-root");
  const canLinks = useFeature("linkages");
  const occ = useAsync(
    async () => (canOcc ? api.rootOccurrences(rootBuckwalter, reading.script, 800) : []),
    [rootBuckwalter, reading.script, canOcc],
  );
  const saved = useAsync(() => archive.rootMeanings.get(rootBuckwalter), [rootBuckwalter]);
  const links = useAsync(
    async () => (canLinks ? api.rootLinkages(rootBuckwalter, { scope: "ayah", limit: 16 }) : []),
    [rootBuckwalter, canLinks],
  );
  // the reader's case on this root, if any: what it rests on sits beside their meaning
  const rootCase = useAsync(async () => {
    const all = await archive.cases.all();
    const c = all.find((k) => k.subject.type === "root" && k.subject.value === rootArabic);
    return c ? normalizeCase(c) : null;
  }, [rootArabic]);

  // motifs (بيوت) this root belongs to, + all motifs for the picker
  const [motifV, setMotifV] = useState(0);
  const refreshMotifs = () => setMotifV((v) => v + 1);
  const motifsIn = useAsync(() => archive.motifs.forRoot(rootBuckwalter), [rootBuckwalter, motifV]);
  const allMotifs = useAsync(() => archive.motifs.all(), [motifV]);
  const [newMotif, setNewMotif] = useState("");

  // a collocated root whose shared āyāt are being shown
  const [pairRoot, setPairRoot] = useState<string | null>(null);
  const pairArabic =
    (links.data ?? []).find((l) => l.root_buckwalter === pairRoot)?.root_arabic ?? pairRoot ?? "";
  const pairVerses = useAsync(
    () => (pairRoot ? api.rootPairVerses(rootBuckwalter, pairRoot, reading.script) : Promise.resolve([])),
    [rootBuckwalter, pairRoot, reading.script],
  );
  // a different root page resets the open pair
  useEffect(() => { setPairRoot(null); }, [rootBuckwalter]);

  const inIds = new Set((motifsIn.data ?? []).map((m) => m.id));
  const available = (allMotifs.data ?? []).filter((m) => !inIds.has(m.id));

  const addToMotif = async (id: string) => { await archive.motifs.addRoot(id, rootBuckwalter); refreshMotifs(); };
  const removeFromMotif = async (id: string) => { await archive.motifs.removeRoot(id, rootBuckwalter); refreshMotifs(); };
  const createMotif = async () => {
    const name = newMotif.trim();
    if (!name) return;
    const id = newId("motif");
    await archive.motifs.save({ id, name });
    await archive.motifs.addRoot(id, rootBuckwalter);
    setNewMotif("");
    refreshMotifs();
  };

  const [current, setCurrent] = useState("");   // the saved meaning shown read-only
  const [draft, setDraft] = useState("");         // the editor buffer
  const [editing, setEditing] = useState(false);
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");
  useEffect(() => {
    setCurrent(saved.data?.meaning ?? "");
  }, [saved.data]);

  const startEdit = () => { setDraft(current); setEditing(true); setStatus("idle"); };
  const cancel = () => { setEditing(false); setStatus("idle"); };
  const save = async () => {
    setStatus("saving");
    try {
      await archive.rootMeanings.set(rootBuckwalter, draft);
      setCurrent(draft.trim());
      setEditing(false);
      setStatus("idle");
      revisionsMayHaveChanged(); // the server may now keep the meaning this replaced
    } catch {
      setStatus("error");
    }
  };

  const checkAsRule = () => {
    if (!canRules) { announcePlanLock(lockReason("rules", catalog)); return; }
    offerRuleScope({ kind: "root", key: rootArabic, text: rootArabic });
    dispatch({ type: "setTab", tab: "rules" });
  };

  // group occurrences by the derived FORM (lemma), so the reader can compare
  // how the indication shifts across forms — the heart of organic root study
  const byForm = useMemo(() => {
    // one chip per āyah (dedupe by verse_key), but also keep the raw occurrence
    // count: a form can appear more than once in a single āyah, so occurrences ≥
    // āyāt. Counting occ from the rows we actually show keeps the two numbers
    // consistent with the list even when it is truncated.
    const groups = new Map<string, { verses: { key: string; pos: number }[]; occ: number }>();
    for (const o of occ.data ?? []) {
      const form = o.lemma_arabic ?? "—";
      let g = groups.get(form);
      if (!g) { g = { verses: [], occ: 0 }; groups.set(form, g); }
      g.occ += 1;
      if (!g.verses.some((x) => x.key === o.verse_key)) g.verses.push({ key: o.verse_key, pos: o.word_position });
    }
    const out = [...groups.entries()].map(([form, g]) => ({
      form,
      verses: g.verses.sort((a, b) => vsort(a.key) - vsort(b.key)),
      occ: g.occ,
    }));
    out.sort((a, b) => b.verses.length - a.verses.length);
    return out;
  }, [occ.data]);
  const shownCount = byForm.reduce((s, g) => s + g.verses.length, 0);
  const posOfForm = new Map((detail.data?.forms ?? []).map((f) => [f.lemma_arabic, f.pos_english]));

  // the dictionaries, oldest first; those with no date we can stand behind come last
  const lexicons = useMemo(() => {
    const list = (detail.data?.meanings ?? []).map((m, i) => ({ m, i, lex: lexiconOf(m.source) }));
    return list.sort((a, b) => (a.lex.year ?? 1e9) - (b.lex.year ?? 1e9) || a.i - b.i);
  }, [detail.data]);

  const caseRests = rootCase.data ? restsOn(rootCase.data, () => null, "case") : null;

  return (
    <div className="sheet root-detail">
      <div className="root-detail-bar">
        <button className="ctl root-back" onClick={onBack}>‹ All roots</button>
        <span className="root-detail-acts">
          <button
            className={`ctl root-detail-act${canRules ? "" : " plan-locked"}`}
            title="State a rule about this root and check it against every place it occurs"
            onClick={checkAsRule}
          ><span className="root-act-ic" aria-hidden="true">☑</span>Check as a rule{!canRules && <> <PlanLock feature="rules" /></>}</button>
          <button
            className="ctl root-detail-act"
            title="Add this root to your active comparison"
            onClick={() => addToCompare("root", rootBuckwalter, rootArabic)}
          ><span className="root-act-ic" aria-hidden="true">⇋</span>Compare</button>
        </span>
      </div>

      <header className="root-detail-head">
        <h1 className="root-detail-ar quran">{spaced(rootArabic)}</h1>
        <p className="subtitle">
          {rootBuckwalter}
          {detail.data ? ` · ${detail.data.total_occurrences} occurrences · ${detail.data.forms.length} forms` : ""}
        </p>
      </header>

      {/* ---- 1. the Book's own use of the root ---- */}
      <section className="root-group" aria-labelledby="root-g-book">
        <h2 className="root-group-title" id="root-g-book">In the Book</h2>

        {detail.data && detail.data.forms.length > 0 && (
          <section>
            <h3 className="root-section-title">Forms</h3>
            <div className="root-forms">
              {detail.data.forms.map((f, i) => (
                <span key={i} className="root-form-chip">
                  <span className="quran">{f.lemma_arabic ?? f.lemma_buckwalter}</span>
                  <span className="root-form-meta">{f.pos_english ?? f.pos} · {f.occurrence_count}×</span>
                </span>
              ))}
            </div>
          </section>
        )}

        {/* occurrences — grouped by form; click a verse to read it */}
        <section>
          <h3 className="root-section-title">
            Where each form occurs{shownCount ? ` · ${shownCount} ${shownCount === 1 ? "āyah" : "āyāt"}` : ""}
            {!canOcc && <> <PlanLock feature="follow-root" /></>}
          </h3>
          {occ.loading && <p className="loading">Finding every occurrence…</p>}
          {byForm.map((g) => (
            <div key={g.form} className="occ-form-group">
              <div className="occ-form-head">
                <span className="occ-form quran">{g.form}</span>
                {posOfForm.get(g.form) && <span className="occ-form-pos">{posOfForm.get(g.form)}</span>}
                <span
                  className="occ-form-count"
                  title={
                    g.occ === g.verses.length
                      ? `${g.verses.length} āyāt`
                      : `${g.occ} occurrences across ${g.verses.length} āyāt — this form appears more than once in some āyah`
                  }
                >
                  {g.verses.length}{g.occ !== g.verses.length ? ` āyāt · ${g.occ}×` : ""}
                </span>
              </div>
              <div className="root-occ">
                {g.verses.map((v) => (
                  <button
                    key={v.key}
                    className="chip root-occ-chip"
                    title={`Read ${v.key}`}
                    onClick={() => dispatch({ type: "jumpToVerse", verseKey: v.key, wordPosition: v.pos })}
                  >
                    {v.key}
                  </button>
                ))}
              </div>
            </div>
          ))}
          {detail.data && canOcc && detail.data.total_occurrences > shownCount && shownCount > 0 && (
            <p className="home-empty">Showing the first {shownCount} āyāt of {detail.data.total_occurrences} occurrences.</p>
          )}
        </section>

        {/* collocations — the roots this one keeps company with */}
        <section>
          <h3 className="root-section-title">The company it keeps{!canLinks && <> <PlanLock feature="linkages" /></>}</h3>
          {links.loading && <p className="loading">Weighing co-occurrences…</p>}
          {links.data && links.data.length === 0 && canLinks && (
            <p className="home-empty">No strong co-occurring roots.</p>
          )}
          <div className="root-colloc">
            {(links.data ?? []).map((l) => (
              <button
                key={l.root_buckwalter}
                className={`colloc-chip${pairRoot === l.root_buckwalter ? " active" : ""}`}
                title={`co-occurs ${l.cooccur}× · strength ${l.score.toFixed(2)} · show the shared āyāt`}
                onClick={() =>
                  setPairRoot((cur) => (cur === l.root_buckwalter ? null : l.root_buckwalter))
                }
              >
                <span className="quran">{spaced(l.root_arabic)}</span>
                <span className="colloc-strength">{l.cooccur}×</span>
              </button>
            ))}
          </div>

          {/* the āyāt where both roots meet — read the evidence for the collocation */}
          {pairRoot && (
            <div className="colloc-pair">
              <div className="colloc-pair-head">
                <span className="quran colloc-pair-roots">
                  {spaced(rootArabic)} <span className="colloc-pair-amp">+</span> {spaced(pairArabic)}
                </span>
                <span className="colloc-pair-count">
                  {pairVerses.data ? `${pairVerses.data.length} āyāt together` : "…"}
                </span>
                <span className="spacer" />
                {onOpenRoot && (
                  <button className="ctl" onClick={() => onOpenRoot(pairRoot, pairArabic)}>
                    open {pairArabic} →
                  </button>
                )}
                <button className="cmp-x" title="Close" aria-label="Close where the two roots meet" onClick={() => setPairRoot(null)}>✕</button>
              </div>
              {pairVerses.loading && <p className="loading">Finding where they meet…</p>}
              <div className="colloc-pair-list">
                {(pairVerses.data ?? []).map((v) => (
                  <button
                    key={v.verse_key}
                    className="colloc-pair-row"
                    title={`Read ${v.verse_key}`}
                    onClick={() => dispatch({ type: "jumpToVerse", verseKey: v.verse_key })}
                  >
                    <span className="colloc-pair-key">{v.verse_key}</span>
                    <span className="colloc-pair-text quran" dir="rtl">{v.text ?? ""}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>
      </section>

      {/* ---- 2. the reader's own reading ---- */}
      <section className="root-group" aria-labelledby="root-g-mine">
        <h2 className="root-group-title" id="root-g-mine">Your reading</h2>

        <section className="root-mine">
          <div className="root-mine-head">
            <h3 className="root-section-title">✒ My meaning</h3>
            {!editing && canMine && (
              <button className="ctl root-mine-edit" onClick={startEdit}>
                {current ? "✎ Edit" : "✎ Add meaning"}
              </button>
            )}
            {!canMine && <PlanLock feature="my-meanings" />}
          </div>

          {editing ? (
            <>
              <textarea
                className="root-mine-input"
                rows={4}
                autoFocus
                aria-label="My meaning of this root"
                placeholder="Write your own understanding of this root…"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); cancel(); } }}
              />
              {status === "error" && <p className="acct-error root-mine-error" role="alert">Couldn’t save your meaning. Check the connection and try again.</p>}
              <div className="root-mine-actions">
                <button className="ctl" onClick={cancel} disabled={status === "saving"}>Cancel</button>
                <button className="ink-action" onClick={save} disabled={status === "saving"}>
                  {status === "saving" ? "saving…" : "Save"}
                </button>
              </div>
            </>
          ) : current ? (
            <p className="root-mine-text">{current}</p>
          ) : (
            <p className="root-mine-empty">No meaning of your own yet — add one from the Book's use above.</p>
          )}

          {rootCase.data && caseRests && (
            <div className="root-case-rests">
              {restsOnLine(caseRests)
                ? <RestsOnLine rests={caseRests} />
                : <p className="rests-on">Your case on this root has nothing pinned or written yet.</p>}
              <button
                className="linkish root-case-link"
                onClick={() => { dispatch({ type: "setActiveCase", caseId: rootCase.data!.id }); dispatch({ type: "setTab", tab: "investigate" }); }}
              >Open the case “{rootCase.data.title || "Untitled case"}”</button>
            </div>
          )}

          <RevisionTrail kind="root-meaning" target={rootBuckwalter} feature="my-meanings" />
        </section>

        {/* motifs (بيوت) — reader-defined collections this root belongs to */}
        <section className="root-motifs">
          <h3 className="root-section-title">بيوت · Motifs</h3>
          <div className="root-motif-chips">
            {(motifsIn.data ?? []).map((m) => (
              <span key={m.id} className="motif-chip in">
                {m.name || "untitled"}
                {canMotifs && <button className="motif-x" title="Remove from motif" aria-label={`Remove from the motif ${m.name || "untitled"}`} onClick={() => removeFromMotif(m.id)}>✕</button>}
              </span>
            ))}
            {(motifsIn.data ?? []).length === 0 && (
              <span className="root-mine-empty">Not in any motif yet.</span>
            )}
          </div>
          {canMotifs && <div className="root-motif-add">
            {available.length > 0 && (
              <select
                className="settings-select"
                value=""
                aria-label="Add this root to a motif"
                onChange={(e) => { if (e.target.value) addToMotif(e.target.value); }}
              >
                <option value="">add to motif…</option>
                {available.map((m) => (
                  <option key={m.id} value={m.id}>{m.name || "untitled"}</option>
                ))}
              </select>
            )}
            <input
              className="motif-new-input"
              placeholder="new motif (بيت) name…"
              aria-label="New motif name"
              value={newMotif}
              onChange={(e) => setNewMotif(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") createMotif(); }}
            />
            <button className="ink-action" onClick={createMotif} disabled={!newMotif.trim()}>＋ Create</button>
          </div>}
        </section>
      </section>

      {/* ---- 3. the dictionaries, last ---- */}
      <section className="root-group" aria-labelledby="root-g-lex">
        <h2 className="root-group-title" id="root-g-lex">Dictionaries, written after the Book</h2>
        <p className="root-group-note">
          Every dictionary here was compiled after the Qur'an, listed oldest first, with who wrote it and when where that is known.
        </p>
        {detail.loading && <p className="loading">Opening the dictionaries…</p>}
        {detail.data && detail.data.meanings.length === 0 && (
          <p className="home-empty">No dictionary entries for this root.</p>
        )}
        <div className="root-lex-list">
          {lexicons.map(({ m, i, lex }) => (
            <div key={i} className="root-lex-entry">
              <div className="root-lex-head">
                <span className="stamp">{lex.name}</span>
                {(lex.by || lex.when) && (
                  <span className="root-lex-who">{[lex.by, lex.when].filter(Boolean).join(", ")}</span>
                )}
                <span className="root-lex-lang">{m.language}</span>
              </div>
              <p
                className={`root-lex-text${m.language === "arabic" ? " quran" : ""}`}
                dir={m.language === "arabic" ? "rtl" : "ltr"}
              >
                {m.meaning}
              </p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
