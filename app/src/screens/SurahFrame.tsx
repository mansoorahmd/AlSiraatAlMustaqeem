// Opening and close: what the first āyāt of a sūrah share with its last (GET /corpus/chapters/:n/frame).
// The two ends side by side (stacked on a narrow screen), the words whose root both ends carry lit
// by tokenizeVerse position (through VerseText), and under them the shared roots, the rarest in the
// Book first. It finds what is shared; what that means is the reader's to say.

import { useMemo, useState } from "react";
import { api } from "../api/client";
import { useAsync } from "../hooks/useAsync";
import { useVerseTexts } from "../hooks/useVerseTexts";
import { useAppDispatch, useAppState } from "../state/store";
import { VerseText } from "../components/VerseText";
import { SPAN_WASH, plural } from "../components/research/places";
import type { FramePlace, FrameShare } from "../api/types";

const ENDS = [1, 2, 3, 5, 10];
const spaced = (r: string) => r.split("").join(" "); // nbsp: root letters must not wrap (ه د ي)
const LEVEL: Record<FrameShare["level"], { label: string; hint: string }> = {
  form: { label: "same word", hint: "the same written word at both ends" },
  lemma: { label: "same lemma", hint: "the same dictionary form at both ends, written differently" },
  root: { label: "same root", hint: "only the root is shared" },
};

export function SurahFrame() {
  const dispatch = useAppDispatch();
  const { reading } = useAppState();
  const [chapter, setChapter] = useState<number>(reading.surahId || 1);
  const [n, setN] = useState(3);
  const chapters = useAsync(() => api.chapters(), []);
  const frame = useAsync(() => api.surahFrame(chapter, n), [chapter, n]);
  const f = frame.data?.chapter === chapter ? frame.data : null;
  const texts = useVerseTexts(f ? [...f.opening, ...f.close] : []);

  // the shared words of each āyah, by word position
  const lit = useMemo(() => {
    const m = new Map<string, Set<number>>();
    for (const s of f?.shares ?? []) {
      for (const p of [...s.opening, ...s.close]) {
        let set = m.get(p.verseKey);
        if (!set) { set = new Set(); m.set(p.verseKey, set); }
        set.add(p.word);
      }
    }
    return m;
  }, [f]);

  const open = (verseKey: string, word?: number) => dispatch({ type: "jumpToVerse", verseKey, wordPosition: word ?? null });

  const end = (title: string, keys: string[]) => (
    <section className="fr-end" aria-label={title}>
      <h2 className="fr-end-title">{title}</h2>
      {keys.map((k) => {
        const text = texts.get(k);
        return (
          <button key={k} className="fr-ayah" title={`Read ${k} in the reader`} onClick={() => open(k)}>
            <span className="dlg-ref">{k}</span>
            <span className="rx-line quran" dir="rtl">
              {text === undefined
                ? "…"
                : <VerseText text={text} highlightRanges={[...(lit.get(k) ?? [])].map((w) => ({ start: w, end: w, color: SPAN_WASH }))} />}
            </span>
          </button>
        );
      })}
    </section>
  );

  const placeChips = (places: FramePlace[]) => (
    <span className="fr-places">
      {places.map((p) => (
        <button
          key={`${p.verseKey}:${p.word}`}
          className="chip fr-place"
          title={`Read ${p.verseKey}, word ${p.word}`}
          onClick={() => open(p.verseKey, p.word)}
        >
          <span className="fr-place-ar" dir="rtl">{p.text}</span>
          <span className="fr-place-ref">{p.verseKey}</span>
        </button>
      ))}
    </span>
  );

  return (
    <div className="sheet fr">
      <header className="home-head">
        <h1>Opening and close</h1>
        <p className="subtitle">
          The roots a sūrah's first āyāt share with its last: for each, where it stands at both ends, how
          close the match is, and how often the root occurs in the whole Book, the rarest first.
        </p>
      </header>

      <div className="fr-controls">
        <div className="sp-field">
          <label htmlFor="fr-surah">Sūrah</label>
          <select id="fr-surah" className="fr-select" value={chapter} onChange={(e) => setChapter(Number(e.target.value))}>
            {(chapters.data ?? [{ id: chapter, name_simple: "" }]).map((c) => (
              <option key={c.id} value={c.id}>{c.id}. {c.name_simple}</option>
            ))}
          </select>
        </div>
        <div className="sp-field">
          <label htmlFor="fr-n">Āyāt at each end</label>
          <select id="fr-n" className="fr-select" value={n} onChange={(e) => setN(Number(e.target.value))}>
            {ENDS.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </div>
      </div>

      {frame.error && <p className="sp-error" role="alert">Couldn't load the opening and close: {frame.error.message}</p>}
      {frame.loading && !f && <p className="loading">Loading…</p>}

      {f && (
        <>
          <p className="search-count">
            {f.shares.length === 0
              ? `The first ${plural(f.n, "āyah", "āyāt")} and the last ${plural(f.n, "āyah", "āyāt")} share no root.`
              : `${plural(f.shares.length, "root", "roots")} found at both ends`}
            {f.n < n && ` · each end takes ${plural(f.n, "āyah", "āyāt")}, so the two ends do not overlap (the sūrah has ${f.verses})`}
          </p>

          <div className="fr-ends">
            {end(f.n === 1 ? "The opening āyah" : `The first ${f.n} āyāt`, f.opening)}
            {end(f.n === 1 ? "The closing āyah" : `The last ${f.n} āyāt`, f.close)}
          </div>

          {f.shares.length > 0 && (
            <ul className="fr-list">
              {f.shares.map((s) => (
                <li key={s.root} className="fr-row">
                  <div className="fr-head">
                    <span className="fr-root" dir="rtl" title="Root">{spaced(s.root)}</span>
                    <span className={`fr-level ${s.level}`} title={LEVEL[s.level].hint}>{LEVEL[s.level].label}</span>
                    <span className="fr-inbook">{plural(s.inBook, "time", "times")} in the Book</span>
                  </div>
                  <div className="fr-sides">
                    <div className="fr-side">
                      <span className="fr-side-label">Opening</span>
                      {placeChips(s.opening)}
                    </div>
                    <div className="fr-side">
                      <span className="fr-side-label">Close</span>
                      {placeChips(s.close)}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
