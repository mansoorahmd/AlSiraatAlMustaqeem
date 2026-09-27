// Typed client for the Qur'an corpus.
//
// The corpus is read from the research server's `/corpus` (the cloud, Postgres) — the same paths
// and JSON the local API used to serve at /api/v1, so every call below is unchanged except for
// its base URL. Reading it is a plan-gated RESOURCE: the server may answer 401 (sign in) or 402
// (needs a plan), and without a network there is no corpus at all. Rather than every screen
// handling that, a refused or unreachable read announces itself once (`corpus-access` event) and
// CorpusAccessBanner explains it; the calling screen just sees an ApiError as before.

import type {
  Chapter, Verse, Word, Translation, TranslationResource, RootDetail, RootSummary, RootOccurrence,
  Linkage, CompositeMatch, FreeTextResult, Echo, Wazn, SpellingVariant, ExprTerm, ExprHit, Script, SimilarityWeights,
} from "./types";
import { REMOTE_URL } from "./remote";

const CORPUS = `${REMOTE_URL}/corpus`;
/** The local API, still used for its own health check. */
const LOCAL = "/api/v1";

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
    const body = (await res.json().catch(() => ({}))) as { detail?: string; plan?: string | null };
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
  health: async () => {
    const res = await fetch(`${LOCAL}/health`);
    if (!res.ok) throw new ApiError(res.status, `GET /health → ${res.status}`);
    return res.json() as Promise<{ status: string; version: string }>;
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
    get<{ verse_key: string; positions: number[] }[]>(`/chapters/${id}/variants`),
  verseEchoes: (key: string) => get<Echo[]>(`/verses/${encodeURIComponent(key)}/echoes`),
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
};
