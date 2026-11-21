// Rare links: every root, word, written form or phrase that exactly N āyāt share (2–5), across
// the whole Book (corpus-core/src/links.ts). A word found in only two āyāt ties exactly those two.
// It only finds and counts; tapping a place opens the reader there with the shared words lit.

import { useEffect, useState } from "react";
import { api } from "../api/client";
import { useAsync } from "../hooks/useAsync";
import { useAppDispatch } from "../state/store";
import type { ExclusiveItem, ExclusiveKind } from "../api/types";

const PAGE = 100;

const KINDS: { id: ExclusiveKind; label: string; noun: string; explain: string }[] = [
  { id: "root", label: "Roots", noun: "roots",
    explain: "Every word from this root occurs only in these āyāt." },
  { id: "lemma", label: "Words", noun: "words",
    explain: "The word occurs only in these āyāt, though its root is used elsewhere." },
  { id: "form", label: "Written forms", noun: "written forms",
    explain: "This exact spelling occurs only in these āyāt, though the word is used elsewhere." },
  { id: "phrase", label: "Phrases", noun: "phrases",
    explain: "The longest run of words that only these āyāt share, longest first." },
];

// nbsp: root letters must not wrap (ه د ي)
const spaced = (r: string) => r.split("").join(" ");

interface Query { kind: ExclusiveKind; n: number; cross: boolean; chapter: number; page: number }

export function RareLinks() {
  const dispatch = useAppDispatch();
  const chapters = useAsync(() => api.chapters(), []);
  const surahName = (key: string) => {
    const id = parseInt(key.split(":")[0] ?? "", 10);
    return chapters.data?.find((c) => c.id === id)?.name_simple ?? "";
  };

  const [q, setQ] = useState<Query>({ kind: "root", n: 2, cross: false, chapter: 0, page: 0 });
  // any filter change starts again at the first page
  const set = (patch: Partial<Omit<Query, "page">>) => setQ((cur) => ({ ...cur, ...patch, page: 0 }));

  const [items, setItems] = useState<ExclusiveItem[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr(null);
    if (q.page === 0) { setItems([]); setTotal(null); }
    api.exclusiveLinks({
      kind: q.kind, n: q.n, cross: q.cross, chapter: q.chapter || undefined,
      limit: PAGE, offset: q.page * PAGE,
    }).then(
      (r) => {
        if (cancelled) return;
        setTotal(r.total);
        setItems((prev) => (q.page === 0 ? r.items : [...prev, ...r.items]));
        setLoading(false);
      },
      (e: Error) => {
        if (cancelled) return;
        setErr(e.message);
        setLoading(false);
      },
    );
    return () => { cancelled = true; };
  }, [q]);

  const kind = KINDS.find((k) => k.id === q.kind)!;

  return (
    <div className="sheet rare-links">
      <header className="home-head">
        <h1>Rare links</h1>
        <p className="subtitle">
          Roots, words and phrases that only a few āyāt share. One found in only two āyāt ties exactly
          those two. Tap a place to read it with the shared words lit.
        </p>
      </header>

      <div className="rl-controls">
        <div className="rl-field">
          <span className="rl-label" id="rl-kind">Look for</span>
          <div className="rl-seg rl-seg-4" role="group" aria-labelledby="rl-kind">
            {KINDS.map((k) => (
              <button
                key={k.id}
                className={`ctl${q.kind === k.id ? " active" : ""}`}
                aria-pressed={q.kind === k.id}
                onClick={() => set({ kind: k.id })}
              >{k.label}</button>
            ))}
          </div>
        </div>
        <div className="rl-field">
          <span className="rl-label" id="rl-n">Shared by exactly</span>
          <div className="rl-seg rl-seg-4" role="group" aria-labelledby="rl-n">
            {[2, 3, 4, 5].map((n) => (
              <button
                key={n}
                className={`ctl${q.n === n ? " active" : ""}`}
                aria-pressed={q.n === n}
                title={`Shared by exactly ${n} āyāt`}
                onClick={() => set({ n })}
              >{n} āyāt</button>
            ))}
          </div>
        </div>
        <label className="rl-field">
          <span className="rl-label">Sūrah</span>
          <select
            className="rl-select"
            value={q.chapter}
            onChange={(e) => set({ chapter: Number(e.target.value) })}
          >
            <option value={0}>Any sūrah</option>
            {(chapters.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>{c.id}. {c.name_simple}</option>
            ))}
          </select>
        </label>
        <label className="rl-field rl-check">
          <span className="rl-label">Where</span>
          <span className="rl-check-box">
            <input type="checkbox" checked={q.cross} onChange={(e) => set({ cross: e.target.checked })} />
            Different sūrahs only
          </span>
        </label>
      </div>

      <p className="rl-explain">
        <strong>{kind.label}:</strong> {kind.explain}
      </p>

      {err && <p className="acct-error" role="alert">Could not load the rare links ({err}).</p>}

      {total !== null && (
        <p className="roots-count">
          {total} {kind.noun} shared by exactly {q.n} āyāt
          {q.cross ? " in different sūrahs" : ""}
          {q.chapter ? `, with one in ${q.chapter}. ${surahName(`${q.chapter}:1`)}` : ""}
          {items.length < total ? ` · showing ${items.length}` : ""}
        </p>
      )}

      {items.length > 0 && (
        <ul className="rl-list">
          {items.map((it) => (
            <li key={`${it.kind} ${it.key}`} className="rl-row">
              <span className="rl-places">
                {it.places.map((p) => {
                  const name = surahName(p.verseKey);
                  return (
                    <button
                      key={p.verseKey}
                      className="chip echo-chip"
                      title={`Read ${p.verseKey}${name ? ` · ${name}` : ""} with it lit`}
                      onClick={() =>
                        dispatch({ type: "jumpToEcho", verseKey: p.verseKey, start: p.start, length: it.length })
                      }
                    >
                      {p.verseKey}{name ? <span className="rl-surah"> {name}</span> : null}
                    </button>
                  );
                })}
              </span>
              <span className="rl-text" dir="rtl">{it.kind === "root" ? spaced(it.text) : it.text}</span>
            </li>
          ))}
        </ul>
      )}

      {loading && <p className="loading">Counting…</p>}
      {!loading && total === 0 && <p className="links-note">Nothing matches these choices.</p>}

      {!loading && total !== null && items.length < total && (
        <div className="rl-more">
          <button className="ctl rl-more-btn" onClick={() => setQ((cur) => ({ ...cur, page: cur.page + 1 }))}>
            Load {Math.min(PAGE, total - items.length)} more
          </button>
        </div>
      )}
    </div>
  );
}
