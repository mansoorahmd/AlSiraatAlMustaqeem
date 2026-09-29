// The reader's research as the MCP's tools see it — exactly the reads and writes they make, in
// their account on the research server, over HTTP with REMOTE_TOKEN
// (server/src/research/routes.ts). The server applies the AI write boundary to every token
// request (tagged 'ai', add-only, never primary, no deletes), on top of the MCP's own guard
// (core.ts, cases.ts).

type Doc = Record<string, any>;

/** What the tools use of the reader's research. */
export interface McpResearch {
  listNotes(opts?: { verse?: string; root?: string; lemma?: string }): Promise<Doc[]>;
  getNote(id: string): Promise<Doc | undefined>;
  saveNote(doc: Doc): Promise<Doc>;
  listCases(): Promise<Doc[]>;
  getCase(id: string): Promise<Doc | undefined>;
  saveCase(doc: Doc): Promise<Doc>;
  getIndication(id: string): Promise<Doc | undefined>;
  indicationsForWord(lemma: string | null, root: string | null, surface?: string | null): Promise<Doc>;
  refinementsForParent(parentId: string): Promise<Doc[]>;
  saveIndication(doc: Doc): Promise<Doc>;
  saveRefinement(doc: Doc): Promise<Doc | undefined>;
  glossData(): Promise<Doc>;
  listProposed(): Promise<Doc>;
  getRootMeaning(root: string): Promise<Doc>;
  listMotifs(): Promise<Doc[]>;
  getMotif(id: string): Promise<Doc | undefined>;
  motifsForRoot(root: string): Promise<Doc[]>;
  saveMotif(doc: Doc): Promise<Doc>;
  addMotifRoot(id: string, root: string): Promise<void>;
  removeMotifRoot(id: string, root: string): Promise<void>;
}

/** The research server refused a write (the AI boundary) — the model should read and adapt. */
export class ResearchRefused extends Error {}
/** Couldn't reach, or sign in to, the research server — in words the model can pass on. */
export class ResearchAccessError extends Error {}

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export function remoteResearch(base: string, token?: string, fetchImpl: Fetch = fetch): McpResearch {
  const root = `${base.replace(/\/+$/, "")}/research`;
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  const k = encodeURIComponent;

  /** `missing`: what a 404 means for this read (the thing isn't there). */
  async function call<T>(method: string, path: string, body?: unknown, missing?: T): Promise<T> {
    let res: Response;
    try {
      res = await fetchImpl(`${root}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch {
      throw new ResearchAccessError(`Can't reach the research server at ${base} — is it running? (Set REMOTE_URL.)`);
    }
    if (res.status === 401) {
      throw new ResearchAccessError(token
        ? "The research server didn't accept this MCP's token — it may be revoked. Create a new one in the app (Account → Connect an AI assistant) and set REMOTE_TOKEN."
        : "The reader's research is in their account: create a token in the app (Account → Connect an AI assistant) and set REMOTE_TOKEN in this MCP's config.");
    }
    const detail = async () => ((await res.json().catch(() => ({}))) as { detail?: string }).detail;
    if (res.status === 403) throw new ResearchRefused((await detail()) ?? "the research server refused this write");
    // a feature this plan has read-only (server/src/plan-features.ts): say so, don't retry
    if (res.status === 402) throw new ResearchRefused(`${(await detail()) ?? "this needs a higher plan"} — the reader's plan has it read-only.`);
    if (res.status === 404 && missing !== undefined) {
      const d = await detail();
      if (typeof d === "string") return missing;   // the route's own "not found"
      throw new ResearchAccessError(`${base} doesn't serve research (${path} → 404). Check REMOTE_URL.`);
    }
    if (!res.ok) throw new Error((await detail()) ?? `${method} ${path} → ${res.status}`);
    return res.json() as Promise<T>;
  }
  const get = <T>(path: string, missing?: T) => call<T>("GET", path, undefined, missing);
  const put = <T>(path: string, body: unknown, missing?: T) => call<T>("PUT", path, body, missing);
  const qs = (p: Record<string, string | null | undefined>) => {
    const u = new URLSearchParams();
    for (const [key, v] of Object.entries(p)) if (v) u.set(key, v);
    const s = u.toString();
    return s ? `?${s}` : "";
  };
  // `null` stands in for "not there" (undefined can't be told apart from "no fallback")
  const orUndefined = async <T>(p: Promise<T | null>) => (await p) ?? undefined;

  return {
    listNotes: (o = {}) => get(`/notes${qs({ verse: o.verse, root: o.root, lemma: o.lemma })}`),
    getNote: (id) => orUndefined(get<Doc | null>(`/notes/${k(id)}`, null)),
    saveNote: (doc) => put(`/notes/${k(doc.id)}`, doc),
    listCases: () => get("/cases"),
    getCase: (id) => orUndefined(get<Doc | null>(`/cases/${k(id)}`, null)),
    saveCase: (doc) => put(`/cases/${k(doc.id)}`, doc),
    getIndication: (id) => orUndefined(get<Doc | null>(`/indications/${k(id)}`, null)),
    indicationsForWord: (lemma, rt, surface) => get(`/indications/for-word${qs({ lemma, root: rt, surface })}`),
    refinementsForParent: (id) => get(`/indications/${k(id)}/refinements`),
    saveIndication: (doc) => put(`/indications/${k(doc.id)}`, doc),
    saveRefinement: (doc) => orUndefined(put<Doc | null>(`/refinements/${k(doc.id)}`, doc, null)),
    glossData: () => get("/indications/gloss"),
    listProposed: () => get("/proposed"),
    getRootMeaning: (r) => get(`/root-meanings/${k(r)}`),
    listMotifs: () => get("/motifs"),
    getMotif: (id) => orUndefined(get<Doc | null>(`/motifs/${k(id)}`, null)),
    motifsForRoot: (r) => get(`/motifs/by-root/${k(r)}`),
    saveMotif: (doc) => put(`/motifs/${k(doc.id)}`, doc),
    addMotifRoot: async (id, r) => { await put(`/motifs/${k(id)}/roots/${k(r)}`, {}); },
    removeMotifRoot: async (id, r) => { await call("DELETE", `/motifs/${k(id)}/roots/${k(r)}`); },
  };
}
