// Shows the verbatim phrases in an ayah that recur elsewhere, each with the
// places it also appears. Jumping to an occurrence lights the phrase there too
// (the echo lens). Data is fetched by the parent so the span can be highlighted
// inline at the same time.

import { useAppDispatch } from "../../state/store";
import type { Echo } from "../../api/types";

export function EchoPanel({ echoes, loading }: { echoes: Echo[]; loading?: boolean }) {
  const dispatch = useAppDispatch();

  if (loading) return <div className="echo-panel loading">…</div>;
  if (echoes.length === 0) return null;

  return (
    <div className="echo-panel">
      {echoes.map((e, i) => (
        <div key={i} className="echo-item">
          <div className="echo-phrase quran" dir="rtl">{e.phrase}</div>
          <div className="echo-meta">
            recurs in {e.occurrences.length} other ayah{e.occurrences.length > 1 ? "s" : ""} — jump to light it there:
          </div>
          <div className="echo-verses">
            {e.occurrences.map((o) => (
              <button
                key={o.verseKey}
                className="chip echo-chip"
                title={`Go to ${o.verseKey} and highlight this phrase`}
                onClick={() =>
                  dispatch({ type: "jumpToEcho", verseKey: o.verseKey, start: o.start, length: e.length })
                }
              >
                {o.verseKey}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
