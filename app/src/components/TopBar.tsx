import { useEffect, useRef, useState } from "react";
import { useAsync } from "../hooks/useAsync";
import { useAppState, useAppDispatch, type Tab } from "../state/store";
import { ActivityBell } from "./ActivityBell";
import { AccountButton } from "./AccountButton";
import { archive } from "../persistence/db";

// the rooms the reader inhabits — always visible
const PRIMARY: { id: Tab; label: string }[] = [
  { id: "home", label: "Home" },
  { id: "read", label: "Read" },
  { id: "investigate", label: "Investigate" },
];

// the reference tools — collected under one "Study" menu
const STUDY: { id: Tab; label: string; desc: string }[] = [
  { id: "roots", label: "Roots", desc: "Browse roots and their lexicon entries" },
  { id: "motifs", label: "Motifs", desc: "Recurring root groupings (بيوت)" },
  { id: "compare", label: "Compare", desc: "Set forms or roots side by side" },
  { id: "vault", label: "Vault", desc: "Roots you have established" },
];


export function TopBar() {
  const { tab, activeCompareSetId, compareTick } = useAppState();
  const dispatch = useAppDispatch();
  // badge = number of items in the active comparison
  const compareCount = useAsync(async () => {
    if (!activeCompareSetId) return 0;
    const s = (await archive.compare.sets()).find((x) => x.id === activeCompareSetId);
    return s?.count ?? 0;
  }, [activeCompareSetId, compareTick]);

  const [studyOpen, setStudyOpen] = useState(false);
  const studyRef = useRef<HTMLDivElement>(null);
  const studyActive = STUDY.some((s) => s.id === tab);


  useEffect(() => {
    if (!studyOpen) return;
    const onDown = (e: MouseEvent) => {
      if (studyRef.current && !studyRef.current.contains(e.target as Node)) setStudyOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setStudyOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [studyOpen]);


  return (
    <header className="topbar">
      {/* the wordmark goes Home, as it does in every web app */}
      <button
        className="brand"
        title="MQ Research Gate — home"
        onClick={() => dispatch({ type: "setTab", tab: "home" })}
      >
        {/* PLACEHOLDER mark — a neutral monogram until a real logo exists. */}
        <span className="brand-mark" aria-hidden>MQ</span>
        <span className="brand-name">MQ Research Gate</span>
      </button>

      <nav className="tabs" aria-label="Main">
        {PRIMARY.map((t) => (
          <button
            key={t.id}
            className={`tab${tab === t.id ? " active" : ""}`}
            aria-current={tab === t.id ? "page" : undefined}
            onClick={() => dispatch({ type: "setTab", tab: t.id })}
          >
            {t.label}
          </button>
        ))}

        {/* the reference tools, grouped */}
        <div className="study-wrap" ref={studyRef}>
          <button
            className={`tab study-tab${studyActive ? " active" : ""}${studyOpen ? " open" : ""}`}
            aria-haspopup="menu"
            aria-expanded={studyOpen}
            onClick={() => setStudyOpen((o) => !o)}
          >
            Study
            {(compareCount.data ?? 0) > 0 && <span className="tab-badge">{compareCount.data}</span>}
            <span className="study-caret" aria-hidden>▾</span>
          </button>
          {studyOpen && (
            <div className="study-menu" role="menu">
              {STUDY.map((s) => (
                <button
                  key={s.id}
                  className={`study-item${tab === s.id ? " active" : ""}`}
                  role="menuitem"
                  onClick={() => { dispatch({ type: "setTab", tab: s.id }); setStudyOpen(false); }}
                >
                  <span className="study-item-label">
                    {s.label}
                    {s.id === "compare" && (compareCount.data ?? 0) > 0 && (
                      <span className="tab-badge">{compareCount.data}</span>
                    )}
                  </span>
                  <span className="study-item-desc">{s.desc}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </nav>

      <div className="spacer" />

      {/* Looks like the search field people expect, though it opens the palette.
          A button, not an input — it never accepts typing in place. */}
      <button
        className="searchbar"
        title="Search or jump to anything (⌘K)"
        onClick={() => window.dispatchEvent(new CustomEvent("open-palette"))}
      >
        <span className="searchbar-ic" aria-hidden>⌕</span>
        <span className="searchbar-text">Search āyāt, roots, cases…</span>
        <kbd className="searchbar-kbd">⌘K</kbd>
      </button>

      {/* one place for everything awaiting the reader */}
      <ActivityBell />

      {/* who you are in the research community — conventional top-right placement */}
      <AccountButton />

    </header>
  );
}
