// The corpus as the MCP's tools see it — exactly the reads they make, behind one interface, with
// two implementations:
//
//   remote (default)   HTTP to the research server's /corpus, as the user (REMOTE_TOKEN). The
//                      corpus is plan-gated there, so the AI reads exactly what its user may read.
//   local              the same services over quran.db (MQ_CORPUS=local) — offline work and the
//                      reference the tests compare the remote path against.
//
// Both return the same shapes, because /corpus is the same route code as the local services
// (corpus-core/src/corpus-services.ts). Where a route answers 404 for "nothing there", the remote
// client returns what the service would have: null / [] / undefined.

import type { Row } from "../../corpus-core/src/corpus-db.js";
import type { CorpusServices } from "../../corpus-core/src/corpus-services.js";
import type { Linkage } from "../../corpus-core/src/linkages.js";
import type { Echo } from "../../corpus-core/src/echoes.js";
import type { SpellingVariant, WordOccurrence, RelatedForm } from "../../corpus-core/src/spellings.js";
import type { CompositeMatch } from "../../corpus-core/src/similarity/compose.js";
import type { FreeTextResultDict } from "../../corpus-core/src/freetext.js";
import type { Wazn } from "../../corpus-core/src/wazn.js";
import type { ExprTerm, ExprMode, ExprHit } from "../../corpus-core/src/expressions.js";
import { waznForWord } from "../../corpus-core/src/wazn.js";
import { expressionSearch } from "../../corpus-core/src/expressions.js";

type Script = string;

export interface CorpusReads {
  content: {
    getVerse(key: string, opts?: { script?: Script; allScripts?: boolean; withWords?: boolean }): Promise<Row | undefined>;
    verseWords(key: string): Promise<Row[]>;
    phraseSearch(q: string, opts?: { script?: Script; limit?: number }): Promise<Row[]>;
    chapterVerses(ch: number, opts?: { script?: Script; limit?: number | null; offset?: number }): Promise<Row[]>;
  };
  roots: {
    getRoot(root: string): Promise<Row | null>;
    occurrences(root: string, opts?: { script?: Script; limit?: number | null; offset?: number }): Promise<Row[]>;
    listRoots(opts?: { orderBy?: string; descending?: boolean; limit?: number | null; offset?: number }): Promise<Row[]>;
  };
  linkages: {
    coOccurringRoots(root: string, opts?: { scope?: "ayah" | "adjacent"; limit?: number | null; sortBy?: "score" | "count" }): Promise<Linkage[]>;
    sharedVerses(a: string, b: string, script?: Script, limit?: number): Promise<{ verse_key: string; chapter_id: number; verse_number: number; text: string | null }[]>;
  };
  echoes: { echoesForVerse(key: string): Promise<Echo[]> };
  spellings: {
    chapterVariants(ch: number): Promise<{ verse_key: string; positions: number[] }[]>;
    variantsForWord(key: string, pos: number): Promise<SpellingVariant[]>;
  };
  wordForms: {
    total(surface: string): Promise<number>;
    occurrences(surface: string, limit?: number): Promise<WordOccurrence[]>;
    relatedForms(surface: string, limit?: number): Promise<RelatedForm[]>;
  };
  engine: { similarVerses(key: string, opts?: { topK?: number }): Promise<CompositeMatch[]> };
  freetext: { search(q: string, opts?: { topK?: number }): Promise<FreeTextResultDict> };
  /** the two function-shaped reads */
  wazn(key: string, pos: number): Promise<Wazn | null>;
  expressions(terms: ExprTerm[], mode: ExprMode, limit?: number): Promise<ExprHit[]>;
}

/** The local corpus: the services themselves. */
export function localReads(svc: CorpusServices): CorpusReads {
  return {
    content: svc.content, roots: svc.roots, linkages: svc.linkages, echoes: svc.echoes,
    spellings: svc.spellings, wordForms: svc.wordForms, engine: svc.engine, freetext: svc.freetext,
    wazn: (key, pos) => waznForWord(svc.corpus, key, pos),
    expressions: (terms, mode, limit) => expressionSearch(svc.corpus, terms, mode, limit),
  };
}

/** Why a remote read was refused, in words the model (and its user) can act on. */
export class CorpusAccessError extends Error {}

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * The remote corpus over HTTP. `base` is the research server (…/corpus is appended); `token` is
 * the user's personal API token, sent as a bearer — omit it only if the corpus is public.
 * `fetchImpl` is injectable so tests can route requests to an in-process app.
 */
export function remoteReads(base: string, token?: string, fetchImpl: Fetch = fetch): CorpusReads {
  const root = `${base.replace(/\/+$/, "")}/corpus`;
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;

  const qs = (p: Record<string, unknown>) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries(p)) if (v !== undefined && v !== null) u.set(k, String(v));
    const s = u.toString();
    return s ? `?${s}` : "";
  };

  /** `missing` is what to return on a 404 ("nothing there"), mirroring the service. */
  async function call<T>(path: string, missing: T, init?: RequestInit): Promise<T> {
    let res: Response;
    try {
      res = await fetchImpl(`${root}${path}`, { ...init, headers });
    } catch {
      throw new CorpusAccessError(`Can't reach the research server at ${base} — is it running? (Set REMOTE_URL, or MQ_CORPUS=local to read quran.db offline.)`);
    }
    // "nothing there" is a corpus route's own 404, which carries a {detail}. A bare 404 means
    // the path itself doesn't exist — a wrong REMOTE_URL, or a server without /corpus — and
    // must not quietly read as "root not found".
    if (res.status === 404) {
      const body = (await res.json().catch(() => null)) as { detail?: unknown } | null;
      if (body && typeof body.detail === "string") return missing;
      throw new CorpusAccessError(`${base} doesn't serve the corpus (${path} → 404). Check REMOTE_URL, or set MQ_CORPUS=local.`);
    }
    if (res.status === 401) {
      throw new CorpusAccessError(token
        ? "The research server didn't accept this MCP's token — it may be revoked. Create a new one in the app (Account → Connect an AI assistant) and set REMOTE_TOKEN."
        : "Reading the corpus needs a sign-in. Create a token in the app (Account → Connect an AI assistant) and set REMOTE_TOKEN in this MCP's config.");
    }
    if (res.status === 402) {
      const body = (await res.json().catch(() => ({}))) as { plan?: string };
      throw new CorpusAccessError(`Reading the corpus needs the ${body.plan ?? "right"} plan, which this user doesn't have.`);
    }
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { detail?: string };
      throw new Error(body.detail ?? `${init?.method ?? "GET"} ${path} → ${res.status}`);
    }
    return res.json() as Promise<T>;
  }
  const post = <T>(path: string, body: unknown, missing: T) =>
    call<T>(path, missing, { method: "POST", body: JSON.stringify(body) });
  const k = encodeURIComponent;

  const full = (surface: string, limit: number, related: number) =>
    call<{ occurrences: WordOccurrence[]; total: number; related: RelatedForm[] }>(
      `/words/occurrences${qs({ surface, limit, related, full: 1 })}`, { occurrences: [], total: 0, related: [] });

  return {
    content: {
      getVerse: (key, o = {}) => call(`/verses/${k(key)}${qs({ script: o.script, all_scripts: o.allScripts ? 1 : undefined, words: o.withWords ? 1 : undefined })}`, undefined),
      verseWords: (key) => call(`/verses/${k(key)}/words`, []),
      phraseSearch: (q, o = {}) => call(`/phrase-search${qs({ q, script: o.script, limit: o.limit })}`, []),
      chapterVerses: (ch, o = {}) => call(`/chapters/${ch}/verses${qs({ script: o.script, limit: o.limit, offset: o.offset })}`, []),
    },
    roots: {
      getRoot: (r) => call(`/roots/${k(r)}`, null),
      occurrences: (r, o = {}) => call(`/roots/${k(r)}/occurrences${qs({ script: o.script, limit: o.limit, offset: o.offset })}`, []),
      listRoots: (o = {}) => call(`/roots${qs({ order_by: o.orderBy, descending: o.descending, limit: o.limit, offset: o.offset })}`, []),
    },
    linkages: {
      coOccurringRoots: (r, o = {}) => call(`/roots/${k(r)}/linkages${qs({ scope: o.scope, limit: o.limit, sort_by: o.sortBy })}`, []),
      sharedVerses: (a, b, script, limit) => call(`/roots/${k(a)}/with/${k(b)}${qs({ script, limit })}`, []),
    },
    echoes: { echoesForVerse: (key) => call(`/verses/${k(key)}/echoes`, []) },
    spellings: {
      chapterVariants: (ch) => call(`/chapters/${ch}/variants`, []),
      variantsForWord: (key, pos) => call(`/verses/${k(key)}/spelling${qs({ pos })}`, []),
    },
    wordForms: {
      total: async (s) => (await full(s, 1, 0)).total,
      occurrences: async (s, limit = 3000) => (await full(s, limit, 0)).occurrences,
      relatedForms: async (s, limit = 12) => (await full(s, 1, limit)).related,
    },
    engine: { similarVerses: (key, o = {}) => call(`/verses/${k(key)}/similar${qs({ top_k: o.topK })}`, []) },
    freetext: {
      search: (q, o = {}) => post("/search", { text: q, top_k: o.topK }, { query: q, resolved: [], unresolved: [], matches: [] }),
    },
    wazn: (key, pos) => call(`/verses/${k(key)}/wazn${qs({ pos })}`, null),
    expressions: (terms, mode, limit) =>
      post("/expression-search", { terms: terms.map((t) => ({ surface: t.surface, root: t.rootBuckwalter })), mode, limit }, []),
  };
}
