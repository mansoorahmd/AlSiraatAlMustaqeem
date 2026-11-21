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
import { AyahDiff } from "./AyahDiff";
import type { Echo } from "../../api/types";
import type { HighlightRange } from "../../persistence/types";

const ECHO_WASH = "#fde68a";

// A common phrase can recur in dozens of āyāt; fetching and rendering every one
// inline (each a full RTL verse) into the already-large reader can lock the tab,
// so we bound the inline view and offer the rest as jump chips.
const MAX_INLINE = 12;

/** The other āyāt that carry a span (a repeated phrase, or a link from LinksPanel), shown inline
 *  with the span lit: `places` say where it starts in each, `length` how many words it covers. */
export function EchoCompare({ places, length, surahName, from, fromPanel }: {
  places: { verseKey: string; start: number }[];
  length: number;
  surahName: (k: string) => string;
  /** the āyah this was opened on, so a jump leaves a way back */
  from?: string;
  /** opened inside that āyah's Links panel, which should reopen on the way back */
  fromPanel?: boolean;
}) {
  const { reading } = useAppState();
  const dispatch = useAppDispatch();
  const addToCompare = useAddToCompare();
  const script = reading.script;
  // which compared āyāt are open word against word with the āyah this was opened on
  const [diffs, setDiffs] = useState<Record<string, boolean>>({});
  const shown = places.slice(0, MAX_INLINE);
  const overflow = places.slice(MAX_INLINE);
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
          { start: o.start, end: o.start + length - 1, color: ECHO_WASH },
        ];
        const name = surahName(o.verseKey);
        return (
          <div key={o.verseKey} className="echo-compare-row">
            <span className="echo-compare-key">
              {o.verseKey}{name ? ` · ${name}` : ""}
              <button
                className="cmp-pin"
                title="Add this ayah to your active comparison"
                aria-label={`Add ${o.verseKey} to your comparison`}
                onClick={() => addToCompare("ayah", o.verseKey)}
              >⇋</button>
              {from && from !== o.verseKey && (
                <button
                  className="ad-toggle"
                  aria-pressed={!!diffs[o.verseKey]}
                  title={`Set ${from} and ${o.verseKey} word against word`}
                  onClick={() => setDiffs((d) => ({ ...d, [o.verseKey]: !d[o.verseKey] }))}
                >{diffs[o.verseKey] ? "Hide differences" : "What differs"}</button>
              )}
            </span>
            <p className="echo-compare-text quran" dir="rtl">
              <VerseText text={typeof v.text === "string" ? v.text : ""} highlightRanges={ranges} />
            </p>
            {from && diffs[o.verseKey] && <AyahDiff a={from} b={o.verseKey} from={from} />}
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
              title={`Go to ${o.verseKey} and highlight it there`}
              onClick={() => dispatch({ type: "jumpToEcho", verseKey: o.verseKey, start: o.start, length, from, fromPanel })}
            >
              {o.verseKey}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function EchoPanel({ echoes, loading, from }: { echoes: Echo[]; loading?: boolean; from?: string }) {
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
            <EchoCompare places={e.occurrences} length={e.length} surahName={surahName} from={from} />
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
                      dispatch({ type: "jumpToEcho", verseKey: o.verseKey, start: o.start, length: e.length, from })
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
