// Typed client for the Qur'an corpus.
//
// The corpus is read from the research server's `/corpus` (Postgres). Reading it is a plan-gated RESOURCE: the server may answer 401 (sign in) or 402
// (needs a plan), and without a network there is no corpus at all. Rather than every screen
// handling that, a refused or unreachable read announces itself once (`corpus-access` event) and
// CorpusAccessBanner explains it; the calling screen just sees an ApiError as before.

import type {
  Chapter, Verse, Word, Translation, TranslationResource, RootDetail, RootSummary, RootOccurrence,
  Linkage, CompositeMatch, FreeTextResult, Echo, Wazn, SpellingVariant, ExprTerm, ExprHit, Script, SimilarityWeights,
} from "./types";
import type { AyahLinks, ExclusiveKind, ExclusiveLinks } from "./types";
import type { ConstructionCatalog, ConstructionQuery, ConstructionResult } from "./types";
import type {
  OccurrenceKind, Occurrences, SpellingList, SpellingGroup, SpeechOpeners, AyahPronouns, WordingCheck, AyahDiff,
  RootSpread, Supplications, SupplicationOpening, SurahFrame,
} from "./types";
import { REMOTE_URL } from "./remote";

const CORPUS = `${REMOTE_URL}/corpus`;

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "ApiError";
  }
}

/** Why a corpus read didn't happen — what CorpusAccessBanner shows. */
export type CorpusAccessState =
  | { kind: "ok" }
  | { kind: "signin"; plan: string | null; message: string }
  | { kind: "upgrade"; plan: string | null; message: string }
  | { kind: "offline"; message: string };

export const CORPUS_ACCESS_EVENT = "corpus-access";

/** A feature this plan doesn't include was refused (a read-assist tool, or a write to a
 *  read-only feature) — PlanLockNotice shows it as a short toast. */
export const PLAN_LOCK_EVENT = "plan-lock";
let lastLock = { message: "", at: 0 };
export function announcePlanLock(message: string): void {
  // the reader fires several requests at once; say it once
  if (message === lastLock.message && Date.now() - lastLock.at < 4000) return;
  lastLock = { message, at: Date.now() };
  window.dispatchEvent(new CustomEvent<string>(PLAN_LOCK_EVENT, { detail: message }));
}
let last: CorpusAccessState["kind"] = "ok";
/** Also used by the research client (persistence/db.ts) for sign-in / offline — never for "ok". */
export function announceAccess(state: CorpusAccessState): void { announce(state); }
function announce(state: CorpusAccessState): void {
  if (state.kind === last && state.kind === "ok") return;   // don't spam a stream of successes
  last = state.kind;
  window.dispatchEvent(new CustomEvent<CorpusAccessState>(CORPUS_ACCESS_EVENT, { detail: state }));
}

function qs(params: Record<string, unknown>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) u.set(k, String(v));
  }
  const s = u.toString();
  return s ? `?${s}` : "";
}

async function corpusFetch(path: string, init: RequestInit = {}): Promise<Response> {
  let res: Response;
  try {
    // credentials: the session cookie decides which plan-gated resources this reader sees
    res = await fetch(`${CORPUS}${path}`, { ...init, credentials: "include" });
  } catch {
    announce({ kind: "offline", message: "The Qur'an text comes from the research server, which can't be reached — you may be offline." });
    throw new ApiError(0, `cannot reach the corpus at ${CORPUS}`);
  }
  if (res.status === 401 || res.status === 402) {
    const body = (await res.json().catch(() => ({}))) as { detail?: string; plan?: string | null; feature?: string };
    // One locked TOOL (search, echoes, …) is that tool's business: a short notice, not the banner
    // that says the Qur'an itself can't be read. Only the text (or an older server) is that.
    if (body.feature && body.feature !== "text") {
      announcePlanLock(body.detail ?? "This feature needs a higher plan.");
      throw new ApiError(res.status, body.detail ?? `${init.method ?? "GET"} ${path} → ${res.status}`);
    }
    announce({
      kind: res.status === 401 ? "signin" : "upgrade",
      plan: body.plan ?? null,
      message: body.detail ?? (res.status === 401 ? "Sign in to read the corpus." : "Reading this needs a plan."),
    });
    throw new ApiError(res.status, body.detail ?? `${init.method ?? "GET"} ${path} → ${res.status}`);
  }
  announce({ kind: "ok" });
  return res;
}

async function get<T>(path: string, params: Record<string, unknown> = {}): Promise<T> {
  const res = await corpusFetch(`${path}${qs(params)}`);
  if (!res.ok) throw new ApiError(res.status, `GET ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await corpusFetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new ApiError(res.status, `POST ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

export const api = {
  /** The research server's own health check. */
  health: async () => {
    const res = await fetch(`${REMOTE_URL}/health`, { cache: "no-store" });
    if (!res.ok) throw new ApiError(res.status, `GET /health → ${res.status}`);
    return res.json() as Promise<{ status: string; service: string }>;
  },
  scripts: () => get<Script[]>("/scripts"),

  // content / metadata
  chapters: () => get<Chapter[]>("/chapters"),
  chapter: (id: number) => get<Chapter>(`/chapters/${id}`),
  chapterVerses: (id: number, opts: { script?: Script; words?: boolean; all_scripts?: boolean } = {}) =>
    get<Verse[]>(`/chapters/${id}/verses`, opts),
  verse: (key: string, opts: { script?: Script; all_scripts?: boolean; words?: boolean; translations?: boolean } = {}) =>
    get<Verse>(`/verses/${encodeURIComponent(key)}`, opts),
  verseWords: (key: string) => get<Word[]>(`/verses/${encodeURIComponent(key)}/words`),
  wazn: (key: string, pos: number) => get<Wazn | null>(`/verses/${encodeURIComponent(key)}/wazn`, { pos }),
  spelling: (key: string, pos: number) =>
    get<SpellingVariant[]>(`/verses/${encodeURIComponent(key)}/spelling`, { pos }),
  verseTranslations: (key: string) => get<Translation[]>(`/verses/${encodeURIComponent(key)}/translations`),
  translationResources: () => get<TranslationResource[]>(`/translation-resources`),
  /** every place a word is written exactly this way (rasm) — rootless words too */
  wordOccurrences: (surface: string, limit = 3000) =>
    get<{ verse_key: string; word_position: number }[]>("/words/occurrences", { surface, limit }),
  chapterEchoes: (id: number) => get<string[]>(`/chapters/${id}/echoes`),
  chapterVariants: (id: number) =>
    // positions: written the unusual way here; common: spelled other ways elsewhere, usual here
    get<{ verse_key: string; positions: number[]; common: number[] }[]>(`/chapters/${id}/variants`),
  verseEchoes: (key: string) => get<Echo[]>(`/verses/${encodeURIComponent(key)}/echoes`),
  /** everything this āyah shares with the rest of the Book, rarest first; `max`: the most āyāt a
   *  marker may be in to be listed with its places (more widespread ones are only counted) */
  verseLinks: (key: string, opts: { max?: number } = {}) =>
    get<AyahLinks>(`/verses/${encodeURIComponent(key)}/links`, opts),
  /** every root / word / written form / phrase carried by exactly `n` āyāt (2–5) */
  exclusiveLinks: (q: { kind: ExclusiveKind; n?: number; cross?: boolean; chapter?: number; limit?: number; offset?: number }) =>
    get<ExclusiveLinks>("/links/exclusive", { ...q, cross: q.cross ? 1 : undefined }),
  neighbours: (key: string, radius = 2, script: Script = "uthmani") =>
    get<Verse[]>(`/verses/${encodeURIComponent(key)}/neighbours`, { radius, script }),
  listVerses: (opts: { script?: Script; limit?: number; offset?: number; chapter?: number; juz?: number; page?: number } = {}) =>
    get<Verse[]>("/verses", opts),
  phraseSearch: (q: string, script: Script = "uthmani", limit = 50) =>
    get<Verse[]>("/phrase-search", { q, script, limit }),

  // roots
  listRoots: (opts: { order_by?: string; descending?: boolean; limit?: number; offset?: number } = {}) =>
    get<RootSummary[]>("/roots", opts),
  root: (root: string) => get<RootDetail>(`/roots/${encodeURIComponent(root)}`),
  rootOccurrences: (root: string, script: Script = "uthmani", limit = 3000) =>
    get<RootOccurrence[]>(`/roots/${encodeURIComponent(root)}/occurrences`, { script, limit }),
  /** the āyāt where two roots BOTH occur — the evidence behind a collocation */
  rootPairVerses: (root: string, other: string, script: Script = "uthmani", limit = 300) =>
    get<{ verse_key: string; chapter_id: number; verse_number: number; text: string | null }[]>(
      `/roots/${encodeURIComponent(root)}/with/${encodeURIComponent(other)}`, { script, limit }),
  rootLinkages: (root: string, opts: { scope?: string; window?: number; sort_by?: string; limit?: number } = {}) =>
    get<Linkage[]>(`/roots/${encodeURIComponent(root)}/linkages`, opts),

  // similarity
  similar: (key: string, opts: { top_k?: number; w_overlap?: number; w_phrase?: number; w_morphology?: number } = {}) =>
    get<CompositeMatch[]>(`/verses/${encodeURIComponent(key)}/similar`, opts),
  search: (text: string, opts: { top_k?: number } & SimilarityWeights = {}) =>
    post<FreeTextResult>("/search", { text, ...opts }),
  expressionSearch: (terms: ExprTerm[], mode: "verbatim" | "roots", limit = 300) =>
    post<ExprHit[]>("/expression-search", { terms, mode, limit }),

  // search by grammar (constructions)
  constructionPresets: () => get<ConstructionCatalog>("/construction-presets"),
  /** āyāt matching a row of word slots; a query the server can't run throws with its reason */
  constructionSearch: async (q: ConstructionQuery & { limit?: number; offset?: number }) => {
    const res = await corpusFetch("/construction-search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(q),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { detail?: string };
      throw new ApiError(res.status, body.detail ?? `POST /construction-search → ${res.status}`);
    }
    return res.json() as Promise<ConstructionResult>;
  },

  // ---- yt219 corpus tools ----
  /** every place a marker, a written shape or a grammar pattern occurs */
  occurrences: (scope: { kind: OccurrenceKind; key: string; query?: ConstructionQuery }, opts: { limit?: number; offset?: number } = {}) =>
    post<Occurrences>("/occurrences", { kind: scope.kind, key: scope.key, query: scope.query, ...opts }),
  /** words written more than one way; `kind` = one kind of difference, `q` = Arabic to look
   *  for, `sort` "alpha" = by the Arabic alphabet instead of most places first */
  spellings: (q: { kind?: string; q?: string; sort?: "alpha"; limit?: number; offset?: number } = {}) => get<SpellingList>("/spellings", q),
  spellingGroup: (key: string) => get<SpellingGroup>(`/spellings/${encodeURIComponent(key)}`),
  /** `roots` = extra opener roots the reader added (Arabic letters), beyond ق و ل and ن د و */
  speechOpeners: (chapter: number, roots: string[] = []) =>
    get<SpeechOpeners>(`/chapters/${chapter}/speech-openers`, { roots: roots.length ? roots.join(",") : undefined }),
  pronouns: (key: string, opts: { verbs?: boolean } = {}) =>
    get<AyahPronouns>(`/verses/${encodeURIComponent(key)}/pronouns`, { verbs: opts.verbs ? 1 : undefined }),
  wordingCheck: (text: string) => post<WordingCheck>("/wording-check", { text }),
  diff: (a: string, b: string) => get<AyahDiff>("/diff", { a, b }),

  // ---- yt218 corpus tools ----
  /** where these roots occur, by sūrah and by page (roots in Arabic letters or Buckwalter) */
  spread: (roots: string[]) => post<RootSpread>("/spread", { roots }),
  /** every place the Lord is addressed with رَبَّنَا, رَبِّ or ٱللَّهُمَّ */
  supplications: (opening?: SupplicationOpening) => get<Supplications>("/supplications", { opening }),
  /** what the first `n` āyāt of a sūrah share with its last `n` */
  surahFrame: (chapter: number, n?: number) => get<SurahFrame>(`/chapters/${chapter}/frame`, { n }),
};
