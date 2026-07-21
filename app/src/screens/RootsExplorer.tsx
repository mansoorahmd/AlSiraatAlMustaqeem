// The Roots Explorer — every root in the Book, orderable rarest → most common,
// with its occurrence count, form count, and core meaning. The rarest roots are
// where the most distinctive language lives, so "unique first" is the default.
// Click a root to jump to its first occurrence in the reader.

import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { useAsync } from "../hooks/useAsync";
import { useAppState, useAppDispatch } from "../state/store";
import { RootDetail } from "./RootDetail";
import { ArabicKeyboard } from "../components/ArabicKeyboard";

const spaced = (r: string) => r.split("").join(" ");
const MAX_SHOWN = 200;

export function RootsExplorer() {
  const { openRoot } = useAppState();
  const dispatch = useAppDispatch();
  const roots = useAsync(() => api.listRoots({ limit: 2000 }), []);
  const [rarestFirst, setRarestFirst] = useState(true);
  const [query, setQuery] = useState("");
  const [kbOpen, setKbOpen] = useState(false);
  const [selected, setSelected] = useState<{ buckwalter: string; arabic: string } | null>(null);

  // opened from elsewhere (Motifs, collocations) → jump straight to the page
  useEffect(() => {
    if (openRoot) { setSelected(openRoot); dispatch({ type: "openRoot", root: null }); }
  }, [openRoot, dispatch]);

  const filtered = useMemo(() => {
    const all = roots.data ?? [];
    const q = query.trim().toLowerCase();
    const match = q
      ? all.filter(
          (r) =>
            r.root_buckwalter.toLowerCase().includes(q) ||
            (r.meaning_en ?? "").toLowerCase().includes(q) ||
            r.root_arabic.includes(query.trim()),
        )
      : all;
    const sorted = [...match].sort((a, b) =>
      rarestFirst
        ? a.total_occurrences - b.total_occurrences || a.root_buckwalter.localeCompare(b.root_buckwalter)
        : b.total_occurrences - a.total_occurrences || a.root_buckwalter.localeCompare(b.root_buckwalter),
    );
    return sorted;
  }, [roots.data, query, rarestFirst]);

  // all hooks are above this point — safe to branch now
  if (selected) {
    return (
      <RootDetail
        rootBuckwalter={selected.buckwalter}
        rootArabic={selected.arabic}
        onBack={() => setSelected(null)}
        onOpenRoot={(buckwalter, arabic) => setSelected({ buckwalter, arabic })}
      />
    );
  }

  const total = roots.data?.length ?? 0;
  const shown = filtered.slice(0, MAX_SHOWN);

  return (
    <div className="sheet roots-explorer">
      <header className="home-head">
        <h1>The Roots</h1>
        <p className="subtitle">
          Every trilateral and quadrilateral root in the Book — the rarest carry the most distinctive
          meaning. Tap one to read where it first appears.
        </p>
      </header>

      <div className="roots-toolbar">
        <input
          className="roots-filter"
          placeholder="filter — meaning (English) or root (Buckwalter / Arabic)…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button className="ctl" onClick={() => setKbOpen((o) => !o)} title="Arabic keyboard">⌨</button>
        <div className="roots-order">
          <button
            className={`ctl${rarestFirst ? " active" : ""}`}
            onClick={() => setRarestFirst(true)}
          >
            unique first
          </button>
          <button
            className={`ctl${!rarestFirst ? " active" : ""}`}
            onClick={() => setRarestFirst(false)}
          >
            common first
          </button>
        </div>
      </div>

      {kbOpen && (
        <ArabicKeyboard
          onInsert={(ch) => setQuery((s) => s + ch)}
          onBackspace={() => setQuery((s) => s.slice(0, -1))}
          onClear={() => setQuery("")}
        />
      )}

      {roots.loading && <p className="loading">Gathering the roots…</p>}
      {roots.error && <p className="error-note">Could not load roots ({roots.error.message}).</p>}

      {roots.data && (
        <>
          <p className="roots-count">
            {filtered.length === total
              ? `${total} roots`
              : `${filtered.length} of ${total} roots`}
            {filtered.length > MAX_SHOWN ? ` · showing first ${MAX_SHOWN}` : ""}
          </p>
          <ul className="roots-list">
            {shown.map((r) => (
              <li key={r.root_buckwalter}>
                <button
                  className="roots-row"
                  onClick={() => setSelected({ buckwalter: r.root_buckwalter, arabic: r.root_arabic })}
                  title="Open the lexicon page"
                >
                  <span className="roots-ar quran">{spaced(r.root_arabic)}</span>
                  <span className="roots-count-badge" title={`${r.total_occurrences} occurrences`}>
                    {r.total_occurrences}×
                  </span>
                  <span className="roots-forms">{r.form_count} form{r.form_count === 1 ? "" : "s"}</span>
                  <span className="roots-meaning">{r.meaning_en ?? "—"}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
