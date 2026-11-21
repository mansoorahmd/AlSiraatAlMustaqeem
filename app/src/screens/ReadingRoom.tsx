// The Reading Room: manuscript index of all 114 sūrahs ↔ the reader itself.

import { useEffect, useState } from "react";
import { api } from "../api/client";
import { archive } from "../persistence/db";
import { useAsync } from "../hooks/useAsync";
import { useAppState, useAppDispatch } from "../state/store";
import { Reader } from "../components/reader/Reader";

export function ReadingRoom() {
  const chapters = useAsync(() => api.chapters(), []);
  const { jumpToVerseKey, activeTrailId, readerOpen, reading } = useAppState();
  const dispatch = useAppDispatch();
  // index or reader lives in the app state (and the address), so it survives a refresh and a
  // visit to another tab
  const view = readerOpen ? "reader" : "index";
  const setView = (v: "index" | "reader") => dispatch({ type: "setReaderOpen", open: v === "reader" });
  const [trailsRefresh, setTrailsRefresh] = useState(0);
  const trails = useAsync(() => archive.trails.all(), [view, activeTrailId, trailsRefresh]);

  // coming back to the Read tab with the reader open: return to the āyah you were on
  // (a jump from elsewhere already says where to go, and opens the reader itself)
  useEffect(() => {
    const last = reading.lastVerseKey;
    if (readerOpen && !jumpToVerseKey && last && last.startsWith(`${reading.surahId}:`)) {
      dispatch({ type: "jumpToVerse", verseKey: last, align: "top" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (view === "reader" && chapters.data) {
    return <Reader chapters={chapters.data} onBackToIndex={() => setView("index")} />;
  }

  return (
    <div className="sheet">
      <h1>The Reading Room</h1>
      <p className="subtitle">Choose a sūrah — every word on its pages can open a case.</p>
      <div className="rule">۞</div>

      {chapters.loading && <p className="loading">Unrolling the index…</p>}
      {chapters.error && (
        <p className="error-note" role="alert">
          {chapters.error.message.startsWith("cannot reach")
            ? "The Qur'an text comes from the research server, which can't be reached right now. Check your connection and try again."
            : "The research server didn't send the list of sūrahs. If you're signed out, sign in (top right) and try again."}
          {" "}({chapters.error.message})
        </p>
      )}

      {chapters.data && (
        <ol className="archive-list">
          {chapters.data.map((c) => (
            <li
              key={c.id}
              className="archive-entry"
              onClick={() => {
                dispatch({ type: "setSurah", surahId: c.id });
                setView("reader");
              }}
              title={`${c.name_simple} — ${c.verses_count} āyāt`}
            >
              <span className="num">{c.id}</span>
              <span className="name-ar">{c.name_arabic}</span>
              <span className="dots" />
              <span className="name-en">{c.name_simple}</span>
            </li>
          ))}
        </ol>
      )}

      {trails.data && trails.data.length > 0 && (
        <>
          <div className="rule">➶</div>
          <h2 className="shelf-title">Saved trails</h2>
          <ul className="case-list">
            {trails.data.map((t) => (
              <li key={t.id} className="case-row">
                <span
                  className="trail-row-name"
                  onClick={() => {
                    dispatch({ type: "setActiveTrail", trailId: t.id });
                    const last = t.hops[t.hops.length - 1];
                    if (last) dispatch({ type: "jumpToVerse", verseKey: last.verseKey });
                    setView("reader");
                  }}
                >
                  ➶ {t.name}
                </span>
                {t.subject && <span className="case-root quran">{t.subject}</span>}
                <span className="dots" />
                <span className="case-meta">{t.hops.length} hops</span>
                <button
                  className="chip-x"
                  title="Delete this trail"
                  aria-label={`Delete the trail ${t.name}`}
                  onClick={async () => {
                    await archive.trails.remove(t.id);
                    if (activeTrailId === t.id)
                      dispatch({ type: "setActiveTrail", trailId: null });
                    setTrailsRefresh((n) => n + 1);
                  }}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
