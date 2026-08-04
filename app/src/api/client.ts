// Typed client for the quran_api FastAPI service.
// All paths are relative to /api/v1 (the TS backend), which the Vite dev
// server proxies to the Node API on :8000.

import type {
  Chapter, Verse, Word, Translation, TranslationResource, RootDetail, RootSummary, RootOccurrence,
  Linkage, CompositeMatch, FreeTextResult, Echo, Wazn, SpellingVariant, ExprTerm, ExprHit, Script, SimilarityWeights,
} from "./types";

const BASE = "/api/v1";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "ApiError";
  }
}

function qs(params: Record<string, unknown>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) u.set(k, String(v));
  }
  const s = u.toString();
  return s ? `?${s}` : "";
}

async function get<T>(path: string, params: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}${qs(params)}`);
  if (!res.ok) throw new ApiError(res.status, `GET ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new ApiError(res.status, `POST ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

export const api = {
  health: () => get<{ status: string; version: string }>("/health"),
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
