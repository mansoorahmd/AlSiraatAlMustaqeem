// The verbatim phrases in an ayah that recur elsewhere. For each, you can:
//  • jump to an occurrence (the echo lens lights the phrase there), or
//  • "compare here" — pull the other ayahs inline, phrase highlighted, so you
//    can read them side by side without leaving your place in the surah.

import { useState } from "react";
import { api } from "../../api/client";
import { useAsync } from "../../hooks/useAsync";
import { useAppState, useAppDispatch } from "../../state/store";
import { useAddToCompare } from "../../compare/useAddToCompare";
import { VerseText } from "../VerseText";
import type { Echo } from "../../api/types";
import type { HighlightRange } from "../../persistence/types";

const ECHO_WASH = "#fde68a";

// A common phrase can recur in dozens of āyāt; fetching and rendering every one
// inline (each a full RTL verse) into the already-large reader can lock the tab,
// so we bound the inline view and offer the rest as jump chips.
const MAX_INLINE = 12;

function EchoCompare({ echo, surahName }: { echo: Echo; surahName: (k: string) => string }) {
  const { reading } = useAppState();
  const dispatch = useAppDispatch();
  const addToCompare = useAddToCompare();
  const script = reading.script;
  const shown = echo.occurrences.slice(0, MAX_INLINE);
  const overflow = echo.occurrences.slice(MAX_INLINE);
  // key the fetch on stable primitives (never the echo object) so it can't refetch in a loop
  const key = shown.map((o) => o.verseKey).join(",");
  const verses = useAsync(
    () => Promise.all(shown.map((o) => api.verse(o.verseKey, { script }))),
    [key, script],
  );
  if (verses.loading) return <div className="echo-compare loading">…</div>;
  const data = verses.data ?? [];
  return (
    <div className="echo-compare">
      {data.map((v, i) => {
        const o = shown[i]!;
        const ranges: HighlightRange[] = [
          { start: o.start, end: o.start + echo.length - 1, color: ECHO_WASH },
        ];
        const name = surahName(o.verseKey);
        return (
          <div key={o.verseKey} className="echo-compare-row">
            <span className="echo-compare-key">
              {o.verseKey}{name ? ` · ${name}` : ""}
              <button
                className="cmp-pin"
                title="Add this ayah to your active comparison"
                onClick={() => addToCompare("ayah", o.verseKey)}
              >⇋</button>
            </span>
            <p className="echo-compare-text quran" dir="rtl">
              <VerseText text={typeof v.text === "string" ? v.text : ""} highlightRanges={ranges} />
            </p>
          </div>
        );
      })}
      {overflow.length > 0 && (
        <div className="echo-compare-more">
          +{overflow.length} more:
          {overflow.map((o) => (
            <button
              key={o.verseKey}
              className="chip echo-chip"
              title={`Go to ${o.verseKey} and highlight this phrase`}
              onClick={() => dispatch({ type: "jumpToEcho", verseKey: o.verseKey, start: o.start, length: echo.length })}
            >
              {o.verseKey}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function EchoPanel({ echoes, loading }: { echoes: Echo[]; loading?: boolean }) {
  const dispatch = useAppDispatch();
  const [compare, setCompare] = useState<Record<number, boolean>>({});
  const chapters = useAsync(() => api.chapters(), []);
  const surahName = (key: string) => {
    const id = parseInt(key.split(":")[0] ?? "", 10);
    return chapters.data?.find((c) => c.id === id)?.name_simple ?? "";
  };

  if (loading) return <div className="echo-panel loading">…</div>;
  if (echoes.length === 0) return null;

  return (
    <div className="echo-panel">
      {echoes.map((e, i) => (
        <div key={i} className="echo-item">
          <div className="echo-phrase quran" dir="rtl">{e.phrase}</div>
          <div className="echo-meta">
            recurs in {e.occurrences.length} other ayah{e.occurrences.length > 1 ? "s" : ""}
            <button
              className="echo-compare-toggle"
              onClick={() => setCompare((c) => ({ ...c, [i]: !c[i] }))}
            >
              {compare[i] ? "hide" : "⊞ compare here"}
            </button>
          </div>

          {compare[i] ? (
            <EchoCompare echo={e} surahName={surahName} />
          ) : (
            <div className="echo-verses">
              {e.occurrences.map((o) => {
                const name = surahName(o.verseKey);
                return (
                  <button
                    key={o.verseKey}
                    className="chip echo-chip"
                    title={`Go to ${o.verseKey}${name ? ` · ${name}` : ""} and highlight this phrase`}
                    onClick={() =>
                      dispatch({ type: "jumpToEcho", verseKey: o.verseKey, start: o.start, length: e.length })
                    }
                  >
                    {o.verseKey}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
