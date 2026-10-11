// The expression-search tray: a floating bar that appears once you've added
// words (via the word menu). Pick more, toggle verbatim/by-roots, and expand to
// see every āyah where they co-occur — click one to read it.

import { useState } from "react";
import { api } from "../api/client";
import { useAsync } from "../hooks/useAsync";
import { useAppState, useAppDispatch } from "../state/store";

export function ExpressionBar() {
  const { expr, exprMode } = useAppState();
  const dispatch = useAppDispatch();
  const [open, setOpen] = useState(false);

  const chapters = useAsync(() => api.chapters(), []);
  const surahName = (key: string) => {
    const id = parseInt(key.split(":")[0] ?? "", 10);
    return chapters.data?.find((c) => c.id === id)?.name_simple ?? "";
  };

  const results = useAsync(
    async () => (open && expr.length ? api.expressionSearch(expr, exprMode, 300) : null),
    [open, exprMode, expr.map((t) => `${t.surface}|${t.root ?? ""}`).join(","), expr.length],
  );

  if (expr.length === 0) return null;

  return (
    <div className="expr-bar">
      <div className="expr-row">
        <span className="expr-label">expression</span>
        <div className="expr-chips">
          {expr.map((t) => (
            <span key={t.surface} className="expr-chip quran" dir="rtl">
              {t.surface}
              <button className="expr-x" onClick={() => dispatch({ type: "unpinExpr", surface: t.surface })}>✕</button>
            </span>
          ))}
        </div>
        <span className="expr-modes">
          <button
            className={`ctl${exprMode === "verbatim" ? " active" : ""}`}
            onClick={() => dispatch({ type: "setExprMode", mode: "verbatim" })}
          >verbatim</button>
          <button
            className={`ctl${exprMode === "roots" ? " active" : ""}`}
            onClick={() => dispatch({ type: "setExprMode", mode: "roots" })}
          >by roots</button>
        </span>
        <button className="ctl" onClick={() => setOpen((o) => !o)}>
          {open ? "hide" : "🔎 find"}
        </button>
        <button className="ctl" onClick={() => { dispatch({ type: "clearExpr" }); setOpen(false); }}>clear</button>
      </div>

      {open && (
        <div className="expr-results">
          {results.loading && <p className="loading">Searching…</p>}
          {results.data && results.data.length === 0 && (
            <p className="home-empty">No āyah has all of these together. Try “by roots”, or fewer words.</p>
          )}
          {results.data && results.data.length > 0 && (
            <>
              <p className="expr-count">{results.data.length} āyāt</p>
              <ul className="expr-list">
                {results.data.map((h) => (
                  <li key={h.verse_key}>
                    <button className="expr-hit" onClick={() => dispatch({ type: "jumpToVerse", verseKey: h.verse_key })}>
                      <span className="expr-ref">{h.verse_key}{surahName(h.verse_key) ? ` · ${surahName(h.verse_key)}` : ""}</span>
                      <span className="expr-verse quran" dir="rtl">{h.text}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
