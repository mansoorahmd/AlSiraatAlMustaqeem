// A full lexicon page for one root: its dictionary meanings from every source,
// the reader's OWN meaning (saved alongside), the derived forms, and every ayah
// it occurs in (click to read). Reached from the Roots Explorer.

import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { useAsync } from "../hooks/useAsync";
import { archive, newId } from "../persistence/db";
import { useAppState, useAppDispatch } from "../state/store";
import { useAddToCompare } from "../compare/useAddToCompare";

const spaced = (r: string) => r.split("").join(" ");
const vsort = (k: string) => {
  const [c, v] = k.split(":").map((n) => parseInt(n, 10) || 0);
  return (c ?? 0) * 1000 + (v ?? 0);
};

// readable names for the dictionary source keys
const SOURCE_LABELS: Record<string, string> = {
  lanes_csv: "Lane's Lexicon",
  lanes_lexicon: "Lane's Lexicon",
  hans_wehr: "Hans Wehr",
  lisan_ul_arab: "Lisān al-ʿArab",
  maqayees: "Maqāyīs al-Lugha",
  mufradat: "Mufradāt al-Qurʾān",
  mujam_ghoni: "Muʿjam al-Ghanī",
  mujam_muhith: "Muʿjam al-Muḥīṭ",
  mujam_shihah: "Muʿjam al-Ṣiḥāḥ",
  mujam_wasith: "Muʿjam al-Wasīṭ",
  corpus: "Quranic Corpus",
};

interface Props {
  rootBuckwalter: string;
  rootArabic: string;
  onBack: () => void;
  onOpenRoot?: (buckwalter: string, arabic: string) => void;
}

export function RootDetail({ rootBuckwalter, rootArabic, onBack, onOpenRoot }: Props) {
  const { reading } = useAppState();
  const dispatch = useAppDispatch();
  const addToCompare = useAddToCompare();

  const detail = useAsync(() => api.root(rootBuckwalter), [rootBuckwalter]);
  const occ = useAsync(
    () => api.rootOccurrences(rootBuckwalter, reading.script, 800),
    [rootBuckwalter, reading.script],
  );
  const saved = useAsync(() => archive.rootMeanings.get(rootBuckwalter), [rootBuckwalter]);
  const links = useAsync(
    () => api.rootLinkages(rootBuckwalter, { scope: "ayah", limit: 16 }),
    [rootBuckwalter],
  );

  // motifs (بيوت) this root belongs to, + all motifs for the picker
  const [motifV, setMotifV] = useState(0);
  const refreshMotifs = () => setMotifV((v) => v + 1);
  const motifsIn = useAsync(() => archive.motifs.forRoot(rootBuckwalter), [rootBuckwalter, motifV]);
  const allMotifs = useAsync(() => archive.motifs.all(), [motifV]);
  const [newMotif, setNewMotif] = useState("");

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
    if (saved.data) setCurrent(saved.data.meaning);
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
    } catch {
      setStatus("error");
    }
  };

  // group occurrences by the derived FORM (lemma), so the reader can compare
  // how the indication shifts across forms — the heart of organic root study
  const byForm = useMemo(() => {
    const groups = new Map<string, { key: string; pos: number }[]>();
    for (const o of occ.data ?? []) {
      const form = o.lemma_arabic ?? "—";
      let arr = groups.get(form);
      if (!arr) { arr = []; groups.set(form, arr); }
      if (!arr.some((x) => x.key === o.verse_key)) arr.push({ key: o.verse_key, pos: o.word_position });
    }
    const out = [...groups.entries()].map(([form, verses]) => ({
      form,
      verses: verses.sort((a, b) => vsort(a.key) - vsort(b.key)),
    }));
    out.sort((a, b) => b.verses.length - a.verses.length);
    return out;
  }, [occ.data]);
  const shownCount = byForm.reduce((s, g) => s + g.verses.length, 0);
  const posOfForm = new Map((detail.data?.forms ?? []).map((f) => [f.lemma_arabic, f.pos_english]));

  return (
    <div className="sheet root-detail">
      <div className="root-detail-bar">
        <button className="ctl root-back" onClick={onBack}>‹ All roots</button>
        <button
          className="ctl"
          title="Add this root to your active comparison"
          onClick={() => addToCompare("root", rootBuckwalter, rootArabic)}
        >⇋ compare</button>
      </div>

      <header className="root-detail-head">
        <h1 className="root-detail-ar quran">{spaced(rootArabic)}</h1>
        <p className="subtitle">
          {rootBuckwalter}
          {detail.data ? ` · ${detail.data.total_occurrences} occurrences · ${detail.data.forms.length} forms` : ""}
        </p>
      </header>

      {/* the reader's own meaning — saved alongside the dictionaries */}
      <section className="root-mine">
        <div className="root-mine-head">
          <h2 className="root-section-title">✒ My meaning</h2>
          {!editing && (
            <button className="ctl root-mine-edit" onClick={startEdit}>
              {current ? "✎ Edit" : "✎ Add meaning"}
            </button>
          )}
        </div>

        {editing ? (
          <>
            <textarea
              className="root-mine-input"
              rows={4}
              autoFocus
              placeholder="Write your own understanding of this root…"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
            <div className="root-mine-actions">
              {status === "error" && <span className="root-error">couldn’t save — is the API running?</span>}
              <button className="ctl" onClick={cancel} disabled={status === "saving"}>Cancel</button>
              <button className="ink-action" onClick={save} disabled={status === "saving"}>
                {status === "saving" ? "saving…" : "Save"}
              </button>
            </div>
          </>
        ) : current ? (
          <p className="root-mine-text">{current}</p>
        ) : (
          <p className="root-mine-empty">No meaning of your own yet — add one to sit beside the lexicons.</p>
        )}
      </section>

      {/* motifs (بيوت) — reader-defined collections this root belongs to */}
      <section className="root-motifs">
        <h2 className="root-section-title">بيوت · Motifs</h2>
        <div className="root-motif-chips">
          {(motifsIn.data ?? []).map((m) => (
            <span key={m.id} className="motif-chip in">
              {m.name || "untitled"}
              <button className="motif-x" title="Remove from motif" onClick={() => removeFromMotif(m.id)}>✕</button>
            </span>
          ))}
          {(motifsIn.data ?? []).length === 0 && (
            <span className="root-mine-empty">Not in any motif yet.</span>
          )}
        </div>
        <div className="root-motif-add">
          {available.length > 0 && (
            <select
              className="settings-select"
              value=""
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
            value={newMotif}
            onChange={(e) => setNewMotif(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") createMotif(); }}
          />
          <button className="ink-action" onClick={createMotif} disabled={!newMotif.trim()}>＋ Create</button>
        </div>
      </section>

      {/* collocations — the roots this one keeps company with */}
      <section>
        <h2 className="root-section-title">Collocations · the company it keeps</h2>
        {links.loading && <p className="loading">Weighing co-occurrences…</p>}
        {links.data && links.data.length === 0 && (
          <p className="home-empty">No strong co-occurring roots.</p>
        )}
        <div className="root-colloc">
          {(links.data ?? []).map((l) => (
            <button
              key={l.root_buckwalter}
              className="colloc-chip"
              title={`co-occurs ${l.cooccur}× · strength ${l.score.toFixed(2)}${onOpenRoot ? " · open" : ""}`}
              onClick={() => onOpenRoot?.(l.root_buckwalter, l.root_arabic)}
            >
              <span className="quran">{spaced(l.root_arabic)}</span>
              <span className="colloc-strength">{l.cooccur}×</span>
            </button>
          ))}
        </div>
      </section>

      {/* dictionary lexicons */}
      <section>
        <h2 className="root-section-title">Lexicons</h2>
        {detail.loading && <p className="loading">Opening the dictionaries…</p>}
        {detail.data && detail.data.meanings.length === 0 && (
          <p className="home-empty">No dictionary entries for this root.</p>
        )}
        <div className="root-lex-list">
          {detail.data?.meanings.map((m, i) => (
            <div key={i} className="root-lex-entry">
              <div className="root-lex-head">
                <span className="stamp">{SOURCE_LABELS[m.source] ?? m.source}</span>
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

      {/* derived forms */}
      {detail.data && detail.data.forms.length > 0 && (
        <section>
          <h2 className="root-section-title">Forms</h2>
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
        <h2 className="root-section-title">
          Occurrences by form{shownCount ? ` · ${shownCount} ayah${shownCount === 1 ? "" : "s"}` : ""}
        </h2>
        {occ.loading && <p className="loading">Finding every occurrence…</p>}
        {byForm.map((g) => (
          <div key={g.form} className="occ-form-group">
            <div className="occ-form-head">
              <span className="occ-form quran">{g.form}</span>
              {posOfForm.get(g.form) && <span className="occ-form-pos">{posOfForm.get(g.form)}</span>}
              <span className="occ-form-count">{g.verses.length}</span>
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
        {detail.data && detail.data.total_occurrences > shownCount && (
          <p className="home-empty">Showing the first {shownCount} ayahs of {detail.data.total_occurrences} occurrences.</p>
        )}
      </section>
    </div>
  );
}
