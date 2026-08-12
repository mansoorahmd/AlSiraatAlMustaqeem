import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import { useAsync } from "../hooks/useAsync";
import { useAppState, useAppDispatch, type Tab } from "../state/store";
import type { Script } from "../api/types";
import { ActivityBell } from "./ActivityBell";
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

const SCRIPTS: { id: Script; label: string }[] = [
  { id: "uthmani", label: "عثماني" },
  { id: "imlaei", label: "إملائي" },
  { id: "indopak", label: "ہندی" },
];

export function TopBar() {
  const { tab, reading, activeCompareSetId, compareTick } = useAppState();
  const dispatch = useAppDispatch();
  const health = useAsync(() => api.health(), []);
  // badge = number of items in the active comparison
  const compareCount = useAsync(async () => {
    if (!activeCompareSetId) return 0;
    const s = (await archive.compare.sets()).find((x) => x.id === activeCompareSetId);
    return s?.count ?? 0;
  }, [activeCompareSetId, compareTick]);
  const translations = useAsync(() => api.translationResources(), []);
  const { script, translationOn, translationId, myGlossOn, fontScale } = reading;

  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);
  const [studyOpen, setStudyOpen] = useState(false);
  const studyRef = useRef<HTMLDivElement>(null);
  const studyActive = STUDY.some((s) => s.id === tab);

  useEffect(() => {
    if (!settingsOpen) return;
    const onDown = (e: MouseEvent) => {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) setSettingsOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setSettingsOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [settingsOpen]);

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

  const dotClass = health.loading ? "" : health.error ? "error" : "ok";
  const statusText = health.loading
    ? "reaching the archive…"
    : health.error
      ? "archive unreachable"
      : `archive open · v${health.data?.version ?? "?"}`;

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-name">MQ Research Gate</span>
        <span className="brand-sub">The Investigation</span>
      </div>

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

      {/* command palette trigger — jump to anything, or search */}
      <button
        className="ctl palette-btn"
        title="Search or jump to anything (⌘K)"
        onClick={() => window.dispatchEvent(new CustomEvent("open-palette"))}
      >
        <span className="palette-ic" aria-hidden>⌕</span>
        <span className="palette-hint">Jump or search</span>
        <span className="palette-kbd">⌘K</span>
      </button>

      {/* one place for everything awaiting the reader */}
      <ActivityBell />

      {/* reading settings — always available in the top toolbar */}
      <div className="settings-wrap" ref={settingsRef}>
        <button
          className={`ctl settings-btn${settingsOpen ? " active" : ""}`}
          title="Reading settings"
          onClick={() => setSettingsOpen((o) => !o)}
        >
          ⚙ Settings
        </button>
        {settingsOpen && (
          <div className="settings-popover" role="menu">
            <div className="settings-row">
              <span className="settings-label">Script</span>
              <span className="ctl-group" role="radiogroup">
                {SCRIPTS.map((s) => (
                  <button
                    key={s.id}
                    className={`ctl${script === s.id ? " active" : ""}`}
                    onClick={() => dispatch({ type: "setScript", script: s.id })}
                  >
                    {s.label}
                  </button>
                ))}
              </span>
            </div>
            <div className="settings-row">
              <span className="settings-label">Size</span>
              <span className="ctl-group">
                <button className="ctl" onClick={() => dispatch({ type: "setFontScale", scale: fontScale - 0.1 })}>A−</button>
                <button className="ctl" onClick={() => dispatch({ type: "setFontScale", scale: 1 })}>A</button>
                <button className="ctl" onClick={() => dispatch({ type: "setFontScale", scale: fontScale + 0.1 })}>A+</button>
              </span>
            </div>
            <div className="settings-row">
              <span className="settings-label">Translation</span>
              <button
                className={`ctl${translationOn ? " active" : ""}`}
                onClick={() => dispatch({ type: "setTranslationOn", on: !translationOn })}
              >
                {translationOn ? "on" : "off"}
              </button>
            </div>
            {translationOn && (
              <div className="settings-row">
                <span className="settings-label">Edition</span>
                <select
                  className="settings-select"
                  value={translationId ?? ""}
                  onChange={(e) =>
                    dispatch({ type: "setTranslationId", id: e.target.value ? Number(e.target.value) : null })
                  }
                  disabled={!translations.data || translations.data.length === 0}
                >
                  <option value="">Auto</option>
                  {(translations.data ?? []).map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name ?? r.author_name ?? `#${r.id}`}
                      {r.language_name ? ` · ${r.language_name}` : ""}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="settings-row">
              <span className="settings-label">My gloss</span>
              <button
                className={`ctl${myGlossOn ? " active" : ""}`}
                onClick={() => dispatch({ type: "setMyGlossOn", on: !myGlossOn })}
              >
                {myGlossOn ? "on" : "off"}
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="status" title="quran_api status">
        <span className={`dot ${dotClass}`} />
        <span>{statusText}</span>
      </div>
    </header>
  );
}
