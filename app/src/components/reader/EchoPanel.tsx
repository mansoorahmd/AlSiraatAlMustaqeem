// Shows the verbatim phrases in an ayah that recur elsewhere, each with the
// places it also appears — a ready-made trail of the Book's own repetition.

import { api } from "../../api/client";
import { useAsync } from "../../hooks/useAsync";
import { useAppDispatch } from "../../state/store";

export function EchoPanel({ verseKey }: { verseKey: string }) {
  const dispatch = useAppDispatch();
  const echoes = useAsync(() => api.verseEchoes(verseKey), [verseKey]);

  if (echoes.loading) return <div className="echo-panel loading">…</div>;
  const data = echoes.data ?? [];
  if (data.length === 0) return null;

  return (
    <div className="echo-panel">
      {data.map((e, i) => (
        <div key={i} className="echo-item">
          <div className="echo-phrase quran" dir="rtl">{e.phrase}</div>
          <div className="echo-meta">
            recurs in {e.verses.length} other ayah{e.verses.length > 1 ? "s" : ""}:
          </div>
          <div className="echo-verses">
            {e.verses.map((k) => (
              <button
                key={k}
                className="chip echo-chip"
                title={`Go to ${k}`}
                onClick={() => dispatch({ type: "jumpToVerse", verseKey: k })}
              >
                {k}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
