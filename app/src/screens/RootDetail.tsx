// A full lexicon page for one root: its dictionary meanings from every source,
// the reader's OWN meaning (saved alongside), the derived forms, and every ayah
// it occurs in (click to read). Reached from the Roots Explorer.

import { useEffect, useState } from "react";
import { api } from "../api/client";
import { useAsync } from "../hooks/useAsync";
import { archive } from "../persistence/db";
import { useAppState, useAppDispatch } from "../state/store";

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
}

export function RootDetail({ rootBuckwalter, rootArabic, onBack }: Props) {
  const { reading } = useAppState();
  const dispatch = useAppDispatch();

  const detail = useAsync(() => api.root(rootBuckwalter), [rootBuckwalter]);
  const occ = useAsync(
    () => api.rootOccurrences(rootBuckwalter, reading.script, 800),
    [rootBuckwalter, reading.script],
  );
  const saved = useAsync(() => archive.rootMeanings.get(rootBuckwalter), [rootBuckwalter]);

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

  const verseKeys = [...new Set((occ.data ?? []).map((o) => o.verse_key))].sort(
    (a, b) => vsort(a) - vsort(b),
  );
  const posFor = (key: string) => (occ.data ?? []).find((o) => o.verse_key === key)?.word_position ?? null;

  return (
    <div className="sheet root-detail">
      <button className="ctl root-back" onClick={onBack}>‹ All roots</button>

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

      {/* occurrences — click a verse to read it */}
      <section>
        <h2 className="root-section-title">
          Occurrences{verseKeys.length ? ` · ${verseKeys.length} ayah${verseKeys.length === 1 ? "" : "s"}` : ""}
        </h2>
        {occ.loading && <p className="loading">Finding every occurrence…</p>}
        <div className="root-occ">
          {verseKeys.map((k) => (
            <button
              key={k}
              className="chip root-occ-chip"
              title={`Read ${k}`}
              onClick={() => dispatch({ type: "jumpToVerse", verseKey: k, wordPosition: posFor(k) })}
            >
              {k}
            </button>
          ))}
        </div>
        {detail.data && detail.data.total_occurrences > verseKeys.length && (
          <p className="home-empty">Showing the first {verseKeys.length} ayahs of {detail.data.total_occurrences} occurrences.</p>
        )}
      </section>
    </div>
  );
}
