import { useEffect, useRef, useState } from "react";
import { useAsync } from "../hooks/useAsync";
import { useMe } from "../hooks/useMe";
import { useAppState, useAppDispatch, type Tab } from "../state/store";
import { ActivityBell } from "./ActivityBell";
import { AccountButton } from "./AccountButton";
import { SideSheet } from "./SideSheet";
import { SettingsSheet } from "./SettingsSheet";
import { archive } from "../persistence/db";
import type { PlanFeature } from "../lib/features";
import { PlanLock } from "./PlanLock";

// the rooms the reader inhabits — always visible
const PRIMARY: { id: Tab; label: string }[] = [
  { id: "home", label: "Home" },
  { id: "read", label: "Read" },
  { id: "search", label: "Search" },
  { id: "investigate", label: "Investigate" },
];

// the reference tools — collected under one "Study" menu
/** the plan feature behind each Study screen (lib/features.ts) — the Vault is only a view */
const STUDY_FEATURE: Partial<Record<Tab, PlanFeature>> = {
  roots: "roots", motifs: "motifs", compare: "compare", diverge: "divergences", links: "lens", mylinks: "links",
  spellings: "spelling", rules: "rules", characters: "characters", dialogue: "speakers",
  supplications: "search", frame: "compare",
};

// two columns: what the Book itself holds, then what the reader has made of it
type StudyItem = { id: Tab; label: string; desc: string };
const STUDY_GROUPS: { title: string; items: StudyItem[] }[] = [
  { title: "In the Book", items: [
    { id: "roots", label: "Roots", desc: "Every root, its words, and the dictionaries" },
    { id: "links", label: "Rare links", desc: "What only a few āyāt share" },
    { id: "spellings", label: "Spellings", desc: "Words written more than one way" },
    { id: "supplications", label: "Supplications", desc: "Where the Lord is addressed, and in which words" },
    { id: "frame", label: "Opening and close", desc: "What a sūrah's first āyāt share with its last" },
  ] },
  { title: "Your study", items: [
    { id: "mylinks", label: "My links", desc: "Saved links, leads, tensions, speakers" },
    { id: "rules", label: "Rule checks", desc: "A rule set against every place it covers" },
    { id: "characters", label: "Characters", desc: "Who is named or meant, and where" },
    { id: "dialogue", label: "Dialogue", desc: "A sūrah as a script: who speaks to whom" },
    { id: "motifs", label: "Motifs", desc: "Your groups of roots that share a theme" },
    { id: "compare", label: "Compare", desc: "Forms, roots and āyāt side by side" },
    { id: "vault", label: "Vault", desc: "Roots whose meaning you established" },
    { id: "diverge", label: "Where I stand apart", desc: "Where you differ from the community" },
  ] },
];
const STUDY: StudyItem[] = STUDY_GROUPS.flatMap((g) => g.items);


export function TopBar() {
  const { tab, activeCompareSetId, compareTick } = useAppState();
  const dispatch = useAppDispatch();
  const { me } = useMe();
  // badge = number of items in the active comparison
  const compareCount = useAsync(async () => {
    if (!activeCompareSetId) return 0;
    const s = (await archive.compare.sets()).find((x) => x.id === activeCompareSetId);
    return s?.count ?? 0;
  }, [activeCompareSetId, compareTick]);

  const [studyOpen, setStudyOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
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

        {/* the maintainer's console — only for maintainers (the server enforces it too) */}
        {me?.role === "maintainer" && (
          <button
            className={`tab${tab === "admin" ? " active" : ""}`}
            aria-current={tab === "admin" ? "page" : undefined}
            onClick={() => dispatch({ type: "setTab", tab: "admin" })}
          >
            Admin
          </button>
        )}

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
              {STUDY_GROUPS.map((g) => (
                <div key={g.title} className="study-group" role="group" aria-label={g.title}>
                  <div className="study-group-title">{g.title}</div>
                  {g.items.map((s) => (
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
                        {STUDY_FEATURE[s.id] && me?.features && me.features[STUDY_FEATURE[s.id]!] === false && (
                          <> <PlanLock feature={STUDY_FEATURE[s.id]!} /></>
                        )}
                      </span>
                      <span className="study-item-desc">{s.desc}</span>
                    </button>
                  ))}
                </div>
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
        title="Jump to an āyah, sūrah, root, case or screen (⌘K)"
        onClick={() => window.dispatchEvent(new CustomEvent("open-palette"))}
      >
        <span className="searchbar-ic" aria-hidden>⌕</span>
        <span className="searchbar-text">Jump to āyah, root, case…</span>
        <kbd className="searchbar-kbd">⌘K</kbd>
      </button>

      {/* one place for everything awaiting the reader */}
      <ActivityBell />

      {/* the walkthrough (screens/Guide.tsx) — open to everyone, signed in or not */}
      <button
        className={`icon-btn topbar-icon${tab === "guide" ? " active" : ""}`}
        title="Guide — how to use the app"
        aria-label="Guide"
        onClick={() => dispatch({ type: "setTab", tab: "guide" })}
      >?</button>

      {/* how the app behaves and where the work is kept — not on the workbench */}
      <button
        className="icon-btn topbar-icon"
        title="Settings"
        aria-label="Settings"
        onClick={() => setSettingsOpen(true)}
      >⚙</button>

      {/* who you are in the research community — conventional top-right placement */}
      <AccountButton />

      <SideSheet open={settingsOpen} title="Settings" onClose={() => setSettingsOpen(false)}>
        <SettingsSheet />
      </SideSheet>

    </header>
  );
}
