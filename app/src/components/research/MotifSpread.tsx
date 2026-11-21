// Where a motif's roots occur: by sūrah and by page of the muṣḥaf. It counts and shows where;
// what a spread means is the reader's to say.

import { useState } from "react";
import { api } from "../../api/client";
import { useAsync } from "../../hooks/useAsync";
import { useAppDispatch } from "../../state/store";
import { plural } from "./places";

const MAX_RANGES = 12;

/** page numbers as compact ranges: "12–14, 30, 41–44" */
function ranges(pages: number[]): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < pages.length) {
    let j = i;
    while (j + 1 < pages.length && pages[j + 1] === pages[j]! + 1) j++;
    out.push(j > i ? `${pages[i]}–${pages[j]}` : `${pages[i]}`);
    i = j + 1;
  }
  return out;
}

const spaced = (r: string) => r.split("").join(" ");

export function MotifSpread({ roots }: { roots: string[] }) {
  const dispatch = useAppDispatch();
  const spread = useAsync(() => api.spread(roots), [roots.join(",")]);
  const chapters = useAsync(() => api.chapters(), []);
  const [withNone, setWithNone] = useState(false);

  if (spread.error) return <p className="ml-error" role="alert">Couldn't count the spread: {spread.error.message}</p>;
  if (!spread.data) return <p className="loading">Counting…</p>;
  const s = spread.data;
  const nameOf = (id: number) => chapters.data?.find((c) => c.id === id)?.name_simple ?? "";
  const withAny = s.chapters.filter((c) => c.places > 0);
  const shown = withNone ? s.chapters : withAny;
  const emptyPages = s.pages.filter((p) => p.places === 0).map((p) => p.page);
  const emptyRanges = ranges(emptyPages);
  const cut = emptyRanges.slice(0, MAX_RANGES);
  const filledPages = s.pages.length - emptyPages.length;

  return (
    <div className="spr">
      <p className="spr-totals">
        {plural(s.total, "place", "places")} · {plural(s.ayahs, "āyah", "āyāt")} · in {withAny.length} of {s.chapters.length} sūrahs · on {filledPages} of {s.pages.length} pages
      </p>
      {s.unknown.length > 0 && (
        <p className="ml-hint">
          Not in the Book: {s.unknown.map((r, i) => <span key={r}>{i ? ", " : ""}<span className="rx-ar" dir="rtl">{r}</span></span>)}.
        </p>
      )}

      <div className="spr-head">
        <h3 className="spr-title">By sūrah</h3>
        <label className="lp-verbs">
          <input type="checkbox" checked={withNone} onChange={(e) => setWithNone(e.target.checked)} />
          List the sūrahs with none
        </label>
      </div>
      <ul className="spr-list">
        {shown.map((c) => (
          <li key={c.chapter}>
            <button
              className="spr-row"
              title={`Open ${nameOf(c.chapter) || `sūrah ${c.chapter}`} in the reader`}
              onClick={() => dispatch({ type: "jumpToVerse", verseKey: `${c.chapter}:1` })}
            >
              <span className="spr-name">{c.chapter}. {nameOf(c.chapter)}</span>
              <span className="spr-bar" aria-hidden="true">
                <span className="spr-fill" style={{ width: `${c.verses ? Math.max(c.ayahs > 0 ? 2 : 0, Math.round((c.ayahs / c.verses) * 100)) : 0}%` }} />
              </span>
              <span className="spr-n">{c.ayahs} of {c.verses} āyāt</span>
            </button>
          </li>
        ))}
        {shown.length === 0 && <li className="home-empty">No sūrah has any of these roots.</li>}
      </ul>

      <div className="spr-head"><h3 className="spr-title">By page</h3></div>
      <div className="spr-strip" role="img" aria-label={`${filledPages} of ${s.pages.length} pages have these roots`}>
        {s.pages.map((p) => (
          <span key={p.page} className={`spr-cell${p.places > 0 ? " on" : ""}`}
            title={`Page ${p.page}: ${plural(p.places, "place", "places")}`} />
        ))}
      </div>
      <p className="ml-hint">
        {emptyPages.length === 0 ? "No empty pages." : (
          <>{plural(emptyPages.length, "empty page", "empty pages")}: {cut.join(", ")}{emptyRanges.length > cut.length ? ` and ${emptyRanges.length - cut.length} more` : ""}</>
        )}
      </p>
      <p className="spr-roots ml-hint">
        Roots counted: {s.roots.map((r, i) => <span key={r}>{i ? ", " : ""}<span className="rx-ar" dir="rtl">{spaced(r)}</span></span>)}
      </p>
    </div>
  );
}
