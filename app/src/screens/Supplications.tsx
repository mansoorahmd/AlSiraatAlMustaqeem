// Supplications: every place the Lord is addressed with رَبَّنَا, رَبِّ or ٱللَّهُمَّ (GET /corpus/supplications),
// found from the grammar of the words, in Book order. One row per āyah, the opening word lit (by
// tokenizeVerse position, through VerseText); a row opens the āyah in the reader. It lists where
// the address is written: whether a place is a supplication is the reader's to say.

import { useMemo, useState } from "react";
import { api } from "../api/client";
import { useAsync } from "../hooks/useAsync";
import { useVerseTexts } from "../hooks/useVerseTexts";
import { useAppDispatch } from "../state/store";
import { VerseText } from "../components/VerseText";
import { SPAN_WASH, plural } from "../components/research/places";
import { offerSearchMode } from "../lib/searchHandoff";
import type { Supplication, SupplicationOpening } from "../api/types";

const PAGE = 30;

interface Row { verseKey: string; items: Supplication[] }

export function Supplications() {
  const dispatch = useAppDispatch();
  const [opening, setOpening] = useState<SupplicationOpening | "">("");
  const [shown, setShown] = useState(PAGE);
  // every opening at once (the counts), filtered here: one request for the whole screen
  const all = useAsync(() => api.supplications(), []);
  const openings = all.data?.openings ?? [];
  const label = (id: SupplicationOpening) => openings.find((o) => o.id === id)?.label ?? id;

  const rows = useMemo(() => {
    const out: Row[] = [];
    for (const s of all.data?.items ?? []) {
      if (opening && s.opening !== opening) continue;
      const last = out[out.length - 1];
      if (last && last.verseKey === s.verseKey) last.items.push(s);
      else out.push({ verseKey: s.verseKey, items: [s] });
    }
    return out;
  }, [all.data, opening]);
  const places = rows.reduce((n, r) => n + r.items.length, 0);
  const visible = rows.slice(0, shown);
  const texts = useVerseTexts(visible.map((r) => r.verseKey));

  const choose = (o: SupplicationOpening | "") => { setOpening(o); setShown(PAGE); };
  const total = all.data?.total ?? 0;

  return (
    <div className="sheet sup">
      <header className="home-head">
        <h1>Supplications</h1>
        <p className="subtitle">
          Every place the Lord is addressed with <span className="sup-ar" dir="rtl">رَبَّنَا</span>,{" "}
          <span className="sup-ar" dir="rtl">رَبِّ</span> or <span className="sup-ar" dir="rtl">ٱللَّهُمَّ</span>,
          found from the grammar of the words. This lists where the address is written; whether a place
          is a supplication is yours to say.
        </p>
      </header>

      {all.error && <p className="sp-error" role="alert">Couldn't load the supplications: {all.error.message}</p>}

      <div className="sp-field">
        <span className="sp-label" id="sup-openings">Opening</span>
        <div className="sup-filter" role="group" aria-labelledby="sup-openings">
          <button className={`ctl sup-opt${opening === "" ? " active" : ""}`} aria-pressed={opening === ""} onClick={() => choose("")}>
            All <span className="sp-kind-n">{total}</span>
          </button>
          {openings.map((o) => (
            <button
              key={o.id}
              className={`ctl sup-opt${opening === o.id ? " active" : ""}`}
              aria-pressed={opening === o.id}
              title={`${plural(o.count, "place", "places")} in ${plural(o.ayahs, "āyah", "āyāt")}`}
              onClick={() => choose(o.id)}
            >
              <span className="sup-ar" dir="rtl">{o.label}</span> <span className="sp-kind-n">{o.count}</span>
            </button>
          ))}
        </div>
      </div>

      {all.data && (
        <p className="search-count">
          {rows.length === 0 ? "None found." : `${plural(places, "place", "places")} in ${plural(rows.length, "āyah", "āyāt")}`}
        </p>
      )}
      {all.loading && <p className="loading">Loading…</p>}

      <ul className="sup-list">
        {visible.map((r) => {
          const text = texts.get(r.verseKey);
          const first = r.items[0]!;
          return (
            <li key={r.verseKey} className="sup-row">
              <div className="sup-head">
                <span className="dlg-ref">{r.verseKey}</span>
                {r.items.map((s) => (
                  <span key={s.word} className="sup-chip" title={`word ${s.word}`}>
                    <span className="sup-ar" dir="rtl">{label(s.opening)}</span>
                  </span>
                ))}
              </div>
              <button
                className="sup-text"
                title={`Read ${r.verseKey} in the reader`}
                onClick={() => dispatch({ type: "jumpToVerse", verseKey: r.verseKey, wordPosition: first.word })}
              >
                <span className="rx-line quran" dir="rtl">
                  {text === undefined
                    ? "…"
                    : <VerseText text={text} highlightRanges={r.items.map((s) => ({ start: s.word, end: s.word, color: SPAN_WASH }))} />}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {rows.length > shown && (
        <div className="sp-more">
          <button className="ctl sp-secondary" onClick={() => setShown((n) => n + PAGE)}>
            Show {Math.min(PAGE, rows.length - shown)} more
          </button>
        </div>
      )}

      <p className="sup-note">
        To set a duʿā' of your own against the Book's words, word by word, open{" "}
        <button className="sp-link" onClick={() => { offerSearchMode("wording"); dispatch({ type: "setTab", tab: "search" }); }}>Check wording</button>{" "}
        in Search.
      </p>
    </div>
  );
}
