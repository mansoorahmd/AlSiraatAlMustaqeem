// Search — two ways into the Book, over the existing engine:
//   • Phrase — verbatim Arabic phrase (diacritic/alef-insensitive).
//   • Related — free-text Arabic → ayahs related by shared roots + structure.
// An on-screen Arabic keyboard lets you type without a system Arabic layout.

import { useEffect, useState } from "react";
import { api } from "../api/client";
import { useAsync } from "../hooks/useAsync";
import { useAppState, useAppDispatch } from "../state/store";
import { ArabicKeyboard } from "../components/ArabicKeyboard";
import { VerseText } from "../components/VerseText";
import { phraseSpans } from "../lib/arabic";

type Mode = "phrase" | "related";
const spaced = (r: string) => r.split("").join(" ");

export function Search() {
  const { reading, searchQuery } = useAppState();
  const dispatch = useAppDispatch();
  const script = reading.script;

  const [q, setQ] = useState(searchQuery ?? "");
  const [mode, setMode] = useState<Mode>("phrase");
  const [kbOpen, setKbOpen] = useState(true);
  const [debounced, setDebounced] = useState("");

  // a query handed over from the command palette — seed the box once, then clear it
  useEffect(() => {
    if (searchQuery != null) {
      setQ(searchQuery);
      dispatch({ type: "setSearchQuery", query: null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery]);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 350);
    return () => clearTimeout(t);
  }, [q]);

  const chapters = useAsync(() => api.chapters(), []);
  const surahName = (key: string) => {
    const id = parseInt(key.split(":")[0] ?? "", 10);
    return chapters.data?.find((c) => c.id === id)?.name_simple ?? "";
  };

  // a bare verse key like "2:255" → fetch that ayah directly
  const keyMatch = /^(\d{1,3}):(\d{1,3})$/.exec(debounced);
  const verseKey = keyMatch ? `${keyMatch[1]}:${keyMatch[2]}` : null;
  const direct = useAsync(
    async () => (verseKey ? api.verse(verseKey, { script }) : null),
    [verseKey, script],
  );

  const results = useAsync(async () => {
    if (!debounced || verseKey) return null; // a verse key is handled by `direct`
    if (mode === "phrase") {
      return { kind: "phrase" as const, verses: await api.phraseSearch(debounced, script, 60) };
    }
    return { kind: "related" as const, result: await api.search(debounced, { top_k: 40 }) };
  }, [debounced, mode, script, verseKey]);

  const jump = (key: string) => dispatch({ type: "jumpToVerse", verseKey: key });

  const Row = ({ verseKey, text, highlight }: { verseKey: string; text: string; highlight?: boolean }) => (
    <li>
      <button className="search-row" onClick={() => jump(verseKey)} title={`Read ${verseKey}`}>
        <span className="search-ref">
          {verseKey}
          {surahName(verseKey) ? ` · ${surahName(verseKey)}` : ""}
        </span>
        <span className="search-verse quran" dir="rtl">
          <VerseText text={text} highlightRanges={highlight ? phraseSpans(text, debounced) : undefined} />
        </span>
      </button>
    </li>
  );

  return (
    <div className="sheet search-screen">
      <header className="home-head">
        <h1>Search the Book</h1>
        <p className="subtitle">
          Find a verbatim phrase, or discover ayahs related by their roots and structure.
        </p>
      </header>

      <div className="search-bar">
        <input
          className="search-input quran"
          dir="rtl"
          placeholder="اكتب أو استعمل لوحة المفاتيح…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoFocus
        />
        <button className="ctl" onClick={() => setKbOpen((o) => !o)} title="Arabic keyboard">⌨</button>
      </div>

      <div className="search-modes">
        <button className={`ctl${mode === "phrase" ? " active" : ""}`} onClick={() => setMode("phrase")}>
          Phrase
        </button>
        <button className={`ctl${mode === "related" ? " active" : ""}`} onClick={() => setMode("related")}>
          Related
        </button>
        <span className="search-mode-hint">
          {mode === "phrase" ? "exact wording, anywhere in the Book" : "ayahs sharing this query's roots"}
          {" · or type a verse key like 2:255 to jump to it"}
        </span>
      </div>

      {kbOpen && (
        <ArabicKeyboard
          onInsert={(ch) => setQ((s) => s + ch)}
          onBackspace={() => setQ((s) => s.slice(0, -1))}
          onClear={() => setQ("")}
        />
      )}

      {verseKey && (
        <>
          {direct.loading && <p className="loading">Fetching {verseKey}…</p>}
          {direct.error && <p className="home-empty">No ayah {verseKey} — check the surah:ayah numbers.</p>}
          {direct.data && (
            <ul className="search-list">
              <Row verseKey={verseKey} text={typeof direct.data.text === "string" ? direct.data.text : ""} />
            </ul>
          )}
        </>
      )}

      {!verseKey && results.loading && debounced && <p className="loading">Searching…</p>}

      {results.data?.kind === "phrase" && (
        <>
          <p className="search-count">
            {results.data.verses.length} ayah{results.data.verses.length === 1 ? "" : "s"} contain this phrase
          </p>
          <ul className="search-list">
            {results.data.verses.map((v) => (
              <Row key={v.verse_key} verseKey={v.verse_key} text={typeof v.text === "string" ? v.text : ""} highlight />
            ))}
          </ul>
        </>
      )}

      {results.data?.kind === "related" && (
        <>
          {results.data.result.resolved.length > 0 && (
            <p className="search-resolved">
              matched roots:{" "}
              {results.data.result.resolved.map((r, i) => (
                <span key={i} className="search-root quran">{r.root ? spaced(r.root) : r.token}</span>
              ))}
              {results.data.result.unresolved.length > 0 && (
                <span className="search-unresolved"> · unrecognised: {results.data.result.unresolved.join(", ")}</span>
              )}
            </p>
          )}
          <ul className="search-list">
            {results.data.result.matches.map((m) => (
              <Row key={m.verse_key} verseKey={m.verse_key} text={m.text ?? ""} />
            ))}
          </ul>
        </>
      )}

      {results.data && ((results.data.kind === "phrase" && results.data.verses.length === 0) ||
        (results.data.kind === "related" && results.data.result.matches.length === 0)) && (
        <p className="home-empty">No results. Try the other mode, or a shorter query.</p>
      )}
    </div>
  );
}
