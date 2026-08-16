// App-level state: current tab (hash-routed), reading prefs, active case.
// Heavy user data (cases, vault, trails) lives in IndexedDB (persistence/db.ts);
// this store holds only the live session state.

import {
  createContext, useContext, useEffect, useReducer, useRef, type ReactNode, type Dispatch,
} from "react";
import type { Script, ExprTerm } from "../api/types";
import { archive } from "../persistence/db";

export type Tab = "home" | "read" | "search" | "investigate" | "vault" | "roots" | "motifs" | "compare" | "diverge";

export interface ReadingState {
  surahId: number;
  script: Script;
  translationOn: boolean;
  /** chosen translation resource id, or null = auto (first non-tafsir) */
  translationId: number | null;
  myGlossOn: boolean; // show the reader's own established meanings under words
  fontScale: number; // 0.5 – 2.0
  /** last ayah brought into view while reading — for "continue reading" */
  lastVerseKey: string | null;
}

export interface AppState {
  tab: Tab;
  reading: ReadingState;
  activeCaseId: string | null;
  /** breadcrumb of cases opened from within other cases (for ‹ back) */
  caseStack: string[];
  /** a case pinned as a reading lens (highlights its echoes on the page) */
  focusCaseId: string | null;
  /** an ad-hoc ayah pinned as a lens, no case required */
  focusAyahKey: string | null;
  activeTrailId: string | null;
  /** verse to scroll to in the reader (set by trails/jumps, cleared after) */
  jumpToVerseKey: string | null;
  /** the word a trail matched on — kept lit while on that hop */
  trailHighlight: { verseKey: string; wordPosition: number | null } | null;
  /** an echo phrase span to light where it lands — the echo lens */
  echoHighlight: { verseKey: string; start: number; end: number } | null;
  /** a root to open on the Roots tab's lexicon page (from Motifs, etc.) */
  openRoot: { buckwalter: string; arabic: string } | null;
  /** the active comparison (saved in research.db); pins land here */
  activeCompareSetId: string | null;
  /** bumped whenever a comparison changes, so views re-fetch */
  compareTick: number;
  /** a transient toast message (e.g. "Added to <comparison>") */
  toast: string | null;
  /** expression-search tray: picked words to find co-occurring (session-only) */
  expr: ExprTerm[];
  exprMode: "verbatim" | "roots";
  /** a query handed to the Search screen (e.g. from the command palette) */
  searchQuery: string | null;
}

export type Action =
  | { type: "setTab"; tab: Tab }
  | { type: "setSurah"; surahId: number }
  | { type: "setScript"; script: Script }
  | { type: "setTranslationOn"; on: boolean }
  | { type: "setTranslationId"; id: number | null }
  | { type: "setMyGlossOn"; on: boolean }
  | { type: "setFontScale"; scale: number }
  | { type: "setLastVerse"; verseKey: string }
  | { type: "setActiveCase"; caseId: string | null }
  | { type: "openCaseStacked"; caseId: string }
  | { type: "backCase" }
  | { type: "setActiveTrail"; trailId: string | null }
  | { type: "setFocusCase"; caseId: string | null }
  | { type: "setFocusAyah"; verseKey: string | null }
  | { type: "jumpToVerse"; verseKey: string; wordPosition?: number | null }
  | { type: "jumpToEcho"; verseKey: string; start: number; length: number }
  | { type: "openRoot"; root: { buckwalter: string; arabic: string } | null }
  | { type: "setActiveCompare"; id: string | null }
  | { type: "bumpCompare" }
  | { type: "toast"; message: string }
  | { type: "clearToast" }
  | { type: "pinExpr"; term: ExprTerm }
  | { type: "unpinExpr"; surface: string }
  | { type: "clearExpr" }
  | { type: "setExprMode"; mode: "verbatim" | "roots" }
  | { type: "setSearchQuery"; query: string | null }
  | { type: "clearJump" }
  | { type: "hydratePrefs"; reading: Partial<ReadingState> };

const initialState: AppState = {
  tab: tabFromHash(),
  reading: { surahId: 1, script: "uthmani", translationOn: false, translationId: null, myGlossOn: true, fontScale: 1, lastVerseKey: null },
  activeCaseId: null,
  caseStack: [],
  focusCaseId: null,
  focusAyahKey: null,
  activeTrailId: null,
  jumpToVerseKey: null,
  trailHighlight: null,
  echoHighlight: null,
  openRoot: null,
  activeCompareSetId: null,
  compareTick: 0,
  toast: null,
  expr: [],
  exprMode: "verbatim",
  searchQuery: null,
};

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "setTab":
      return { ...state, tab: action.tab };
    case "setSurah":
      return { ...state, reading: { ...state.reading, surahId: action.surahId }, echoHighlight: null };
    case "setScript":
      return { ...state, reading: { ...state.reading, script: action.script } };
    case "setTranslationOn":
      return { ...state, reading: { ...state.reading, translationOn: action.on } };
    case "setTranslationId":
      return { ...state, reading: { ...state.reading, translationId: action.id } };
    case "setMyGlossOn":
      return { ...state, reading: { ...state.reading, myGlossOn: action.on } };
    case "setLastVerse":
      if (state.reading.lastVerseKey === action.verseKey) return state;
      return { ...state, reading: { ...state.reading, lastVerseKey: action.verseKey } };
    case "setFontScale": {
      const fontScale = Math.min(2, Math.max(0.5, action.scale));
      return { ...state, reading: { ...state.reading, fontScale } };
    }
    case "setActiveCase":
      // direct open (archive list, reader) resets the breadcrumb
      return { ...state, activeCaseId: action.caseId, caseStack: [] };
    case "openCaseStacked":
      return {
        ...state,
        caseStack:
          state.activeCaseId && state.activeCaseId !== action.caseId
            ? [...state.caseStack, state.activeCaseId]
            : state.caseStack,
        activeCaseId: action.caseId,
        tab: "investigate",
      };
    case "backCase": {
      const prev = state.caseStack[state.caseStack.length - 1] ?? null;
      return {
        ...state,
        activeCaseId: prev,
        caseStack: state.caseStack.slice(0, -1),
      };
    }
    case "setActiveTrail":
      return {
        ...state,
        activeTrailId: action.trailId,
        trailHighlight: action.trailId ? state.trailHighlight : null,
      };
    case "setFocusCase":
      // a case lens and an ad-hoc ayah lens are mutually exclusive
      return { ...state, focusCaseId: action.caseId, focusAyahKey: null };
    case "setFocusAyah":
      return { ...state, focusAyahKey: action.verseKey, focusCaseId: null };
    case "jumpToVerse": {
      const chapter = parseInt(action.verseKey.split(":")[0], 10);
      return {
        ...state,
        tab: "read",
        jumpToVerseKey: action.verseKey,
        // word position present → trail hop: light the matched word;
        // a plain nav jump (no position) clears any prior highlight
        trailHighlight:
          action.wordPosition != null
            ? { verseKey: action.verseKey, wordPosition: action.wordPosition }
            : null,
        reading: Number.isFinite(chapter)
          ? { ...state.reading, surahId: chapter }
          : state.reading,
        // a plain jump clears any echo-lens highlight
        echoHighlight: null,
      };
    }
    case "jumpToEcho": {
      const chapter = parseInt(action.verseKey.split(":")[0], 10);
      return {
        ...state,
        tab: "read",
        jumpToVerseKey: action.verseKey,
        trailHighlight: null,
        echoHighlight: {
          verseKey: action.verseKey,
          start: action.start,
          end: action.start + action.length - 1,
        },
        reading: Number.isFinite(chapter)
          ? { ...state.reading, surahId: chapter }
          : state.reading,
      };
    }
    case "openRoot":
      return { ...state, openRoot: action.root, tab: action.root ? "roots" : state.tab };
    case "setActiveCompare":
      return { ...state, activeCompareSetId: action.id };
    case "bumpCompare":
      return { ...state, compareTick: state.compareTick + 1 };
    case "toast":
      return { ...state, toast: action.message };
    case "clearToast":
      return { ...state, toast: null };
    case "pinExpr": {
      const key = `${action.term.surface}|${action.term.root ?? ""}`;
      if (state.expr.some((t) => `${t.surface}|${t.root ?? ""}` === key)) return state;
      return { ...state, expr: [...state.expr, action.term].slice(-8) };
    }
    case "unpinExpr":
      return { ...state, expr: state.expr.filter((t) => t.surface !== action.surface) };
    case "clearExpr":
      return { ...state, expr: [] };
    case "setSearchQuery":
      return { ...state, searchQuery: action.query };
    case "setExprMode":
      return { ...state, exprMode: action.mode };
    case "clearJump":
      return { ...state, jumpToVerseKey: null };
    case "hydratePrefs":
      return { ...state, reading: { ...state.reading, ...action.reading } };
  }
}

export function tabFromHash(): Tab {
  const h = typeof window !== "undefined" ? window.location.hash.replace(/^#\/?/, "") : "";
  return h === "read" || h === "search" || h === "investigate" || h === "vault" || h === "diverge" ||
    h === "roots" || h === "motifs" || h === "compare"
    ? h
    : "home";
}

const StateCtx = createContext<AppState>(initialState);
const DispatchCtx = createContext<Dispatch<Action>>(() => {});

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  // hash <-> tab sync
  useEffect(() => {
    const onHash = () => dispatch({ type: "setTab", tab: tabFromHash() });
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  useEffect(() => {
    const want = `#/${state.tab}`;
    if (window.location.hash !== want) window.history.replaceState(null, "", want);
  }, [state.tab]);

  // hydrate + persist reading prefs.
  // Don't persist until hydration has run — otherwise the first save writes
  // defaults that the (async, same-queue) hydration read then reads back,
  // silently resetting saved settings on every refresh.
  const hydrated = useRef(false);
  useEffect(() => {
    archive.prefs.get<Partial<ReadingState>>("reading").then((saved) => {
      if (saved) dispatch({ type: "hydratePrefs", reading: saved });
      hydrated.current = true;
    });
    archive.prefs.get<string>("activeCompareSet").then((id) => {
      if (id) dispatch({ type: "setActiveCompare", id });
    });
  }, []);
  // Persist on a trailing debounce. lastVerseKey changes as you scroll, and an
  // un-debounced write hit IndexedDB on every tick — enough main-thread work to
  // stall the page when a burst arrives (e.g. a panel expanding shifts āyāt).
  const latestReading = useRef(state.reading);
  latestReading.current = state.reading;
  useEffect(() => {
    if (!hydrated.current) return;
    const t = window.setTimeout(() => { void archive.prefs.set("reading", latestReading.current); }, 500);
    return () => window.clearTimeout(t);
  }, [state.reading]);
  // don't lose the last change if the tab goes away mid-debounce
  useEffect(() => {
    const flush = () => { if (hydrated.current) void archive.prefs.set("reading", latestReading.current); };
    window.addEventListener("pagehide", flush);
    return () => { window.removeEventListener("pagehide", flush); flush(); };
  }, []);

  return (
    <StateCtx.Provider value={state}>
      <DispatchCtx.Provider value={dispatch}>{children}</DispatchCtx.Provider>
    </StateCtx.Provider>
  );
}

export function useAppState(): AppState { return useContext(StateCtx); }
export function useAppDispatch(): Dispatch<Action> { return useContext(DispatchCtx); }
