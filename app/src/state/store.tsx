// App-level state: current tab (hash-routed), reading prefs, active case.
// Heavy user data (cases, vault, trails) lives in IndexedDB (persistence/db.ts);
// this store holds only the live session state.

import {
  createContext, useContext, useEffect, useReducer, useRef, type ReactNode, type Dispatch,
} from "react";
import type { Script, ExprTerm } from "../api/types";
import { archive, researchWriteCount } from "../persistence/db";

export type Tab = "home" | "read" | "search" | "investigate" | "vault" | "roots" | "motifs" | "compare" | "diverge" | "links" | "mylinks" | "spellings" | "rules" | "characters" | "dialogue" | "supplications" | "frame" | "admin" | "guide";

/** The parts of an āyah's Links panel (components/reader/LinksPanel.tsx). */
export type LinksTab = "links" | "speakers" | "characters" | "pronouns";

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
  /** the Read tab shows the reader (true) or the list of sūrahs (false). Kept here, and in the
   *  address as #/read/<sūrah>:<āyah>, so a refresh or a return to the tab lands where you were. */
  readerOpen: boolean;
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
  /** how that jump lands: "center" shows the āyah mid-page (going somewhere new); "top" puts it
   *  on the reading line, exactly where the address records it (a refresh, a return to the tab) */
  jumpAlign: "center" | "top";
  /** the āyāt jumps were made FROM, oldest first, so the reader can offer the way back;
   *  `panel` = the jump was made from that āyah's Links panel, which reopens on return */
  jumpBack: { verseKey: string; panel: boolean }[];
  /** after going back: the āyah whose Links panel should be open again */
  reopenLinksFor: string | null;
  /** which part of that panel to open on (a jump made to tag speech opens on Speakers) */
  reopenLinksTab: LinksTab | null;
  /** the word a trail matched on — kept lit while on that hop */
  trailHighlight: { verseKey: string; wordPosition: number | null } | null;
  /** an echo phrase span to light where it lands — the echo lens */
  echoHighlight: { verseKey: string; start: number; end: number } | null;
  /** a root to open on the Roots tab's lexicon page (from Motifs, etc.) */
  openRoot: { buckwalter: string; arabic: string } | null;
  /** the active comparison (saved in the account); pins land here */
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
  /** the one character or rule that is open on its screen (#/characters/<id>, #/rules/<id>);
   *  null = the screen's list */
  openItemId: string | null;
  /** the screen a jump into the reader was made from: it stays alive behind the reader, and the
   *  reader offers the way back to it, at the place the reader left */
  returnTo: { tab: Tab; itemId: string | null; scroll: number; writes: number } | null;
  /** bumped when a screen must be rebuilt on the way back (the research changed meanwhile) */
  screenEpoch: number;
  /** where to put the page once the screen come back to has drawn; null = nothing to restore */
  pendingScroll: number | null;
}

/** The screens a jump into the reader can be made from, with the name the way back shows. */
export const SCREEN_LABEL: Partial<Record<Tab, string>> = {
  search: "Search", investigate: "Investigate", vault: "Vault", roots: "Roots", motifs: "Motifs",
  compare: "Compare", diverge: "Where I stand apart", links: "Rare links", mylinks: "My links",
  spellings: "Spellings", rules: "Rule checks", characters: "Characters", dialogue: "Dialogue",
  supplications: "Supplications", frame: "Opening and close",
};

/** Leaving for the reader: note the screen and the place on it. A jump made inside the reader
 *  keeps the way back it already has. */
function leaving(state: AppState): AppState["returnTo"] {
  if (state.tab === "read") return state.returnTo;
  if (!SCREEN_LABEL[state.tab]) return null;
  const main = typeof document !== "undefined" ? document.querySelector(".main") : null;
  return { tab: state.tab, itemId: state.openItemId, scroll: main ? main.scrollTop : 0, writes: researchWriteCount() };
}

/** A jump that says where it was made from leaves a way back (the last 20 are kept). Walking a
 *  thread names the same starting āyah on every hop, so it is kept once, not once per hop. */
function pushBack(state: AppState, a: { verseKey: string; from?: string; fromPanel?: boolean }): AppState["jumpBack"] {
  if (!a.from || a.from === a.verseKey) return state.jumpBack;
  const last = state.jumpBack[state.jumpBack.length - 1];
  if (last?.verseKey === a.from) return state.jumpBack;
  return [...state.jumpBack, { verseKey: a.from, panel: !!a.fromPanel }].slice(-20);
}

export type Action =
  | { type: "setTab"; tab: Tab }
  /** open one character or rule on its screen; id null = back to the list */
  | { type: "openItem"; tab: "characters" | "rules"; id: string | null }
  /** go back to the screen the reader was reached from, at the place that was left */
  | { type: "returnToOrigin" }
  | { type: "clearReturn" }
  | { type: "scrollRestored" }
  | { type: "setSurah"; surahId: number }
  | { type: "setReaderOpen"; open: boolean }
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
  | { type: "jumpToVerse"; verseKey: string; wordPosition?: number | null; from?: string; fromPanel?: boolean; align?: "top"; openLinks?: LinksTab }
  | { type: "jumpToEcho"; verseKey: string; start: number; length: number; from?: string; fromPanel?: boolean }
  | { type: "jumpBack" }
  | { type: "clearJumpBack" }
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

/** The place the address named when the page loaded (#/read/19:47), if any. */
const INITIAL_PLACE = readPlaceFromHash();
const chapterOfPlace = (place: string) => parseInt(place.split(":")[0] ?? "", 10);

const initialState: AppState = {
  tab: tabFromHash(),
  reading: {
    surahId: INITIAL_PLACE ? chapterOfPlace(INITIAL_PLACE) : 1, script: "uthmani", translationOn: false,
    translationId: null, myGlossOn: true, fontScale: 1, lastVerseKey: INITIAL_PLACE,
  },
  readerOpen: INITIAL_PLACE !== null,
  activeCaseId: null,
  caseStack: [],
  focusCaseId: null,
  focusAyahKey: null,
  activeTrailId: null,
  jumpToVerseKey: null,
  jumpAlign: "center",
  jumpBack: [],
  reopenLinksFor: null,
  reopenLinksTab: null,
  trailHighlight: null,
  echoHighlight: null,
  openRoot: null,
  activeCompareSetId: null,
  compareTick: 0,
  toast: null,
  expr: [],
  exprMode: "verbatim",
  searchQuery: null,
  openItemId: itemFromHash(),
  returnTo: null,
  screenEpoch: 0,
  pendingScroll: null,
};

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "setTab":
      return { ...state, tab: action.tab, openItemId: null, returnTo: null };
    case "openItem":
      return { ...state, tab: action.tab, openItemId: action.id, returnTo: null };
    case "returnToOrigin": {
      const r = state.returnTo;
      if (!r) return state;
      // what was done in the reader may show on that screen: rebuild it then, else keep it as it was
      const changed = researchWriteCount() !== r.writes;
      return { ...state, tab: r.tab, openItemId: r.itemId, returnTo: null, pendingScroll: r.scroll,
        screenEpoch: changed ? state.screenEpoch + 1 : state.screenEpoch };
    }
    case "clearReturn":
      return { ...state, returnTo: null };
    case "scrollRestored":
      return { ...state, pendingScroll: null };
    case "setReaderOpen":
      return { ...state, readerOpen: action.open };
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
        returnTo: leaving(state),
        jumpToVerseKey: action.verseKey,
        jumpAlign: action.align ?? "center",
        jumpBack: pushBack(state, action),
        // a jump made to work in the āyah's Links panel opens it there
        reopenLinksFor: action.openLinks ? action.verseKey : null,
        reopenLinksTab: action.openLinks ?? null,
        readerOpen: true,
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
    case "jumpBack": {
      const back = state.jumpBack[state.jumpBack.length - 1];
      if (!back) return state;
      const chapter = parseInt(back.verseKey.split(":")[0], 10);
      return {
        ...state,
        tab: "read",
        jumpToVerseKey: back.verseKey,
        jumpAlign: "center",
        jumpBack: state.jumpBack.slice(0, -1),
        reopenLinksFor: back.panel ? back.verseKey : null,
        reopenLinksTab: null,
        readerOpen: true,
        trailHighlight: null,
        echoHighlight: null,
        reading: Number.isFinite(chapter) ? { ...state.reading, surahId: chapter } : state.reading,
      };
    }
    case "clearJumpBack":
      return { ...state, jumpBack: [] };
    case "jumpToEcho": {
      const chapter = parseInt(action.verseKey.split(":")[0], 10);
      return {
        ...state,
        tab: "read",
        returnTo: leaving(state),
        jumpToVerseKey: action.verseKey,
        jumpAlign: "center",
        jumpBack: pushBack(state, action),
        reopenLinksFor: null,
        readerOpen: true,
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

/** The reading place in the address, as "sūrah:āyah": #/read/19:47, or #/read/19 for its first āyah. */
export function readPlaceFromHash(): string | null {
  if (typeof window === "undefined") return null;
  const m = /^#\/?read\/(\d{1,3})(?::(\d{1,3}))?$/.exec(window.location.hash);
  if (!m) return null;
  const surah = Number(m[1]);
  const ayah = Number(m[2] ?? 1);
  return surah >= 1 && surah <= 114 && ayah >= 1 ? `${surah}:${ayah}` : null;
}

export function tabFromHash(): Tab {
  // the first part names the screen; the Read tab may carry a place after it
  const h = typeof window !== "undefined" ? (window.location.hash.replace(/^#\/?/, "").split("/")[0] ?? "") : "";
  return h === "read" || h === "search" || h === "investigate" || h === "vault" || h === "diverge" ||
    h === "roots" || h === "motifs" || h === "compare" || h === "links" || h === "mylinks" || h === "spellings" || h === "rules" || h === "characters" || h === "dialogue" || h === "supplications" || h === "frame" || h === "admin" || h === "guide"
    ? h
    : "home";
}

/** The character or rule the address names (#/characters/<id>, #/rules/<id>), if any. */
export function itemFromHash(): string | null {
  if (typeof window === "undefined") return null;
  const [tab, id] = window.location.hash.replace(/^#\/?/, "").split("/");
  if ((tab !== "characters" && tab !== "rules") || !id) return null;
  try { return decodeURIComponent(id); } catch { return null; }
}

const StateCtx = createContext<AppState>(initialState);
const DispatchCtx = createContext<Dispatch<Action>>(() => {});

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  // hash <-> tab sync
  useEffect(() => {
    // fires when the reader edits the address or uses back / forward, not for our own updates
    const onHash = () => {
      const tab = tabFromHash();
      if (tab === "characters" || tab === "rules") dispatch({ type: "openItem", tab, id: itemFromHash() });
      else dispatch({ type: "setTab", tab });
      const place = readPlaceFromHash();
      if (place) dispatch({ type: "jumpToVerse", verseKey: place, align: "top" });
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  useEffect(() => {
    // in the reader the address carries the āyah at the top of the page
    const { surahId, lastVerseKey } = state.reading;
    const place = state.tab === "read" && state.readerOpen
      ? (lastVerseKey && lastVerseKey.startsWith(`${surahId}:`) ? lastVerseKey : `${surahId}:1`)
      : null;
    const item = (state.tab === "characters" || state.tab === "rules") && state.openItemId
      ? `/${encodeURIComponent(state.openItemId)}` : "";
    const want = place ? `#/read/${place}` : `#/${state.tab}${item}`;
    if (window.location.hash !== want) window.history.replaceState(null, "", want);
  }, [state.tab, state.readerOpen, state.reading.surahId, state.reading.lastVerseKey, state.openItemId]);

  // hydrate + persist reading prefs.
  // Don't persist until hydration has run — otherwise the first save writes
  // defaults that the (async, same-queue) hydration read then reads back,
  // silently resetting saved settings on every refresh.
  const hydrated = useRef(false);
  useEffect(() => {
    archive.prefs.get<Partial<ReadingState>>("reading").then((saved) => {
      // the address wins over the saved place: a refresh or a shared link opens where it says
      if (saved) {
        dispatch({
          type: "hydratePrefs",
          reading: INITIAL_PLACE ? { ...saved, surahId: chapterOfPlace(INITIAL_PLACE), lastVerseKey: INITIAL_PLACE } : saved,
        });
      }
      hydrated.current = true;
      // scroll there once the saved script and sizes are in, so the page does not shift after
      if (INITIAL_PLACE) dispatch({ type: "jumpToVerse", verseKey: INITIAL_PLACE, align: "top" });
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
