// What differs between two āyāt, word against word (GET /corpus/diff). The server aligns them on
// their words with vowels ignored and labels each row; this only shows it. Nothing here says
// why two āyāt differ: that is the reader's to work out.

import { api } from "../../api/client";
import { useAsync } from "../../hooks/useAsync";
import { useAppDispatch } from "../../state/store";
import type { DiffHow, DiffWord } from "../../api/types";

const HOW: Record<DiffHow, (a: string, b: string) => string> = {
  same: () => "same",
  marks: () => "other vowels",
  spelling: () => "other spelling",
  changed: () => "changed",
  "only-a": (a) => `only in ${a}`,
  "only-b": (_, b) => `only in ${b}`,
};

/** The labels in the order the summary lists them. */
const ORDER: DiffHow[] = ["same", "marks", "spelling", "changed", "only-a", "only-b"];

export function AyahDiff({ a, b, from }: {
  a: string;
  b: string;
  /** the āyah this was opened on, so a jump leaves a way back */
  from?: string;
}) {
  const dispatch = useAppDispatch();
  const diff = useAsync(() => api.diff(a, b), [a, b]);

  if (diff.loading) return <div className="ad loading">Setting the two āyāt side by side…</div>;
  if (diff.error) return <div className="ad-error" role="alert">Couldn't compare {a} and {b}: {diff.error.message}</div>;
  const d = diff.data;
  if (!d) return null;

  const word = (key: string, w: DiffWord | null) =>
    w ? (
      <button
        className="ad-word"
        dir="rtl"
        title={`Read ${key}, word ${w.word}`}
        onClick={() => dispatch({ type: "jumpToEcho", verseKey: key, start: w.word, length: 1, from })}
      >{w.text}</button>
    ) : <span className="ad-gap" aria-label="no word">·</span>;

  return (
    <div className="ad">
      <p className="ad-summary">
        {ORDER.filter((h) => d.counts[h] > 0).map((h) => (
          <span key={h} className={`ad-tag ad-${h}`}>{HOW[h](a, b)} {d.counts[h]}</span>
        ))}
      </p>
      <div className="ad-grid" role="table" aria-label={`${a} against ${b}, word by word`}>
        <div className="ad-row ad-head" role="row">
          <span role="columnheader">{a}</span>
          <span role="columnheader">difference</span>
          <span role="columnheader">{b}</span>
        </div>
        {d.rows.map((r, i) => (
          <div key={i} className={`ad-row ad-${r.how}`} role="row">
            <span role="cell" className="ad-cell">{word(a, r.a)}</span>
            <span role="cell" className="ad-how">{HOW[r.how](a, b)}</span>
            <span role="cell" className="ad-cell">{word(b, r.b)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
