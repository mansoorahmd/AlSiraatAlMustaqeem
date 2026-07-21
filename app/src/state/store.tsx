// App-level state: current tab (hash-routed), reading prefs, active case.
// Heavy user data (cases, vault, trails) lives in IndexedDB (persistence/db.ts);
// this store holds only the live session state.

import {
  createContext, useContext, useEffect, useReducer, useRef, type ReactNode, type Dispatch,
} from "react";
import type { Script } from "../api/types";
import { archive } from "../persistence/db";

export type Tab = "home" | "read" | "investigate" | "vault" | "roots";

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
    case "clearJump":
      return { ...state, jumpToVerseKey: null };
    case "hydratePrefs":
      return { ...state, reading: { ...state.reading, ...action.reading } };
  }
}

export function tabFromHash(): Tab {
  const h = typeof window !== "undefined" ? window.location.hash.replace(/^#\/?/, "") : "";
  return h === "read" || h === "investigate" || h === "vault" || h === "roots" ? h : "home";
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
  }, []);
  useEffect(() => {
    if (!hydrated.current) return;
    void archive.prefs.set("reading", state.reading);
  }, [state.reading]);

  return (
    <StateCtx.Provider value={state}>
      <DispatchCtx.Provider value={dispatch}>{children}</DispatchCtx.Provider>
    </StateCtx.Provider>
  );
}

export function useAppState(): AppState { return useContext(StateCtx); }
export function useAppDispatch(): Dispatch<Action> { return useContext(DispatchCtx); }
