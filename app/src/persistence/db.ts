// Persistence layer. All research (cases, trails, notes, indications, comparisons, motifs) and
// device-independent UI prefs live on the research server, in the signed-in account (private
// by row-level security), reached through /research/* with the session cookie. Nothing of it
// is shared unless the reader publishes it. There is no browser-side storage.

import type { CaseRecord, TrailRecord, NoteRecord, UserRootMeaning, Motif } from "./types";
import type { CompareSet, CompareItemRow, WordIndication, IndicationsForWord, IndicationGloss, Proposed } from "../api/types";
import { remote, REMOTE_URL } from "../api/remote";
import { announceAccess } from "../api/client";
import { cachedMe } from "../hooks/useMe";

const API = `${REMOTE_URL}/research`;

export function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// ---- server helpers ----------------------------------------------------------

/** Every research call: the session cookie says whose research; failures explain themselves. */
async function research(path: string, init: RequestInit = {}): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, { ...init, credentials: "include" });
  } catch {
    announceAccess({ kind: "offline", message: "Your research is kept on the research server, which can't be reached — you may be offline." });
    throw new Error(`cannot reach the research server at ${REMOTE_URL}`);
  }
  if (res.status === 401) {
    announceAccess({ kind: "signin", plan: null, message: "Sign in to see and save your research." });
  }
  return res;
}
async function fail(res: Response, what: string): Promise<never> {
  const detail = await res.json().then((b) => (b as { detail?: string }).detail).catch(() => undefined);
  throw new Error(detail ?? `${what} → ${res.status}`);
}
const json = (method: string, body: unknown): RequestInit =>
  ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

async function srvGet<T>(path: string): Promise<T> {
  const res = await research(path);
  if (!res.ok) return fail(res, `GET ${path}`);
  return res.json() as Promise<T>;
}
async function srvPut<T>(path: string, body: unknown): Promise<T> {
  const res = await research(path, json("PUT", body));
  if (!res.ok) return fail(res, `PUT ${path}`);
  return res.json() as Promise<T>;
}
async function srvPost<T>(path: string, body: unknown): Promise<T> {
  const res = await research(path, json("POST", body));
  if (!res.ok) return fail(res, `POST ${path}`);
  return res.json() as Promise<T>;
}
async function srvDelete(path: string): Promise<void> {
  const res = await research(path, { method: "DELETE" });
  if (!res.ok && res.status !== 404) return fail(res, `DELETE ${path}`);
}

// ---- the community layer: read LIVE from the remote, never mirrored locally ----
//
// Monetization: the group's readings are a PAID, ONLINE layer. They are fetched from the remote
// on demand and gated behind a plan (api/remote.ts + REMOTE.md); nothing of the group's is ever
// stored with the reader's research. A free, signed-out, or offline reader simply sees their own work — the
// boundary is now the network, not a local table.

export interface Divergence {
  lemma: string; root: string; caseId: string;
  mine: string; theirs: string;
  claimId: string; version: number; authorId: string; dissents: number;
}

export interface GroupState {
  /** forms I have established */
  mine: number;
  /** readings the group has established (globally) */
  theirs: number;
  /** forms we have both settled — the only ones that CAN diverge */
  overlap: number;
}

export const group = {
  /**
   * ⚖ Forms I established whose meaning differs from the group's — computed LIVE on the remote.
   * We send it the forms we have established (subject + our own meaning); it diffs them against
   * the group's current readings and returns the differences, enriched here with the local root
   * and case so a row can still link back into the board.
   *
   * Throws RemoteOffline / RemoteError(401|402) when not connected or not on a paid plan — the
   * caller shows a "connect / subscribe" state rather than a bare empty list.
   */
  async divergences(): Promise<{ rows: Divergence[]; state: GroupState }> {
    const established = (await fetchFormStatus()).filter((f) => f.status === "established");
    const byLemma = new Map(established.map((f) => [f.lemma, f]));
    const out = await remote.divergences(
      established.map((f) => ({ subjectValue: f.lemma, meaning: f.meaning })));
    const rows: Divergence[] = out.divergences.map((d) => {
      const local = byLemma.get(d.subjectValue);
      return {
        lemma: d.subjectValue, root: local?.root ?? "", caseId: local?.case_id ?? "",
        mine: d.mine, theirs: d.theirs,
        claimId: d.claimId, version: d.version, authorId: d.authorId, dissents: d.dissents,
      };
    });
    return { rows, state: { mine: established.length, theirs: out.globalTotal, overlap: out.overlap } };
  },
};

/** A reading's per-form shade, as it travels in a proposal payload and back in a peer reading. */
export interface Refinement { lemma: string; label: string; meaning: string }

/**
 * A stable fingerprint of a whole reading (root meaning + every form's shade), so the app can
 * tell "not proposed" from "proposed" from "changed since I proposed it". Order-independent:
 * refinements are sorted by lemma, so re-saving in a different order doesn't look like a change.
 */
export function readingHash(label: string, meaning: string, refinements: Refinement[]): string {
  const norm = {
    label: label.trim(),
    meaning: meaning.trim(),
    refinements: [...refinements]
      .map((r) => ({ lemma: r.lemma, label: r.label.trim(), meaning: r.meaning.trim() }))
      .filter((r) => r.label || r.meaning)
      .sort((a, b) => a.lemma.localeCompare(b.lemma)),
  };
  const json = JSON.stringify(norm);
  // small, dependency-free string hash — this is a change-detector, not a security digest
  let h = 5381;
  for (let i = 0; i < json.length; i++) h = ((h << 5) + h + json.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** Whether the reader has proposed a subject's reading upstream, and if it still matches. */
export const proposals = {
  get(subjectKind: "form" | "root", subjectValue: string): Promise<{ contentHash: string; proposedAt: number } | null> {
    const q = new URLSearchParams({ subjectKind, subjectValue });
    return srvGet(`/proposals?${q.toString()}`);
  },
  record(subjectKind: "form" | "root", subjectValue: string, contentHash: string): Promise<unknown> {
    return srvPost("/proposals", { subjectKind, subjectValue, contentHash });
  },
};

// ---- outbound submission ledger ------------------------------------------------

export interface SubmissionRecord {
  localRef: string;
  submissionId: string;
  contentHash: string;
  kind: string;
  status: string;
  submittedAt: number;
}

/**
 * Stable hash of what we submitted, so we can tell "unchanged" from "edited since sharing".
 * FNV-1a over canonical JSON — this only needs to detect change, not resist an adversary, and
 * being synchronous keeps the button's state simple (crypto.subtle is async).
 */
export function contentHash(value: unknown): string {
  const sorted = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sorted);
    if (v && typeof v === "object") {
      const o: Record<string, unknown> = {};
      for (const k of Object.keys(v as Record<string, unknown>).sort()) o[k] = sorted((v as any)[k]);
      return o;
    }
    return v;
  };
  const s = JSON.stringify(sorted(value));
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

export const submissionLog = {
  /** What was submitted for this local record, or null. Resilient: null when unavailable. */
  async get(localRef: string): Promise<SubmissionRecord | null> {
    try {
      return await srvGet<SubmissionRecord | null>(`/submission-log/${encodeURIComponent(localRef)}`);
    } catch { return null; }
  },
  all(): Promise<SubmissionRecord[]> {
    return srvGet<SubmissionRecord[]>("/submission-log");
  },
  record(localRef: string, doc: { submissionId: string; contentHash: string; kind?: string }): Promise<SubmissionRecord> {
    return srvPut<SubmissionRecord>(`/submission-log/${encodeURIComponent(localRef)}`, doc);
  },
};

// ---- typed access ---------------------------------------------------------------

export const archive = {
  /** Cases. */
  cases: {
    get: async (id: string): Promise<CaseRecord | undefined> => {
      try {
        return await srvGet<CaseRecord>(`/cases/${encodeURIComponent(id)}`);
      } catch {
        return undefined;
      }
    },
    all: async (): Promise<CaseRecord[]> => {
      return srvGet<CaseRecord[]>("/cases");
    },
    save: async (c: CaseRecord): Promise<CaseRecord> => {
      return srvPut<CaseRecord>(`/cases/${encodeURIComponent(c.id)}`, {
        ...c,
        updatedAt: Date.now(),
      });
    },
    remove: async (id: string): Promise<void> => {
      return srvDelete(`/cases/${encodeURIComponent(id)}`);
    },
  },

  /** Trails. */
  trails: {
    get: async (id: string): Promise<TrailRecord | undefined> => {
      const all = await srvGet<TrailRecord[]>("/trails");
      return all.find((t) => t.id === id);
    },
    all: async (): Promise<TrailRecord[]> => {
      return srvGet<TrailRecord[]>("/trails");
    },
    save: async (t: TrailRecord): Promise<TrailRecord> => {
      return srvPut<TrailRecord>(`/trails/${encodeURIComponent(t.id)}`, {
        ...t,
        updatedAt: Date.now(),
      });
    },
    remove: async (id: string): Promise<void> => {
      return srvDelete(`/trails/${encodeURIComponent(id)}`);
    },
  },

  /** Notes & questions on ayahs/words.
   *  Shared between the reader and the investigation board. */
  notes: {
    all: async (): Promise<NoteRecord[]> => {
      return srvGet<NoteRecord[]>("/notes");
    },
    forVerse: async (verseKey: string): Promise<NoteRecord[]> => {
      return srvGet<NoteRecord[]>(`/notes?verse=${encodeURIComponent(verseKey)}`);
    },
    forRoot: async (root: string): Promise<NoteRecord[]> => {
      return srvGet<NoteRecord[]>(`/notes?root=${encodeURIComponent(root)}`);
    },
    forLemma: async (lemma: string): Promise<NoteRecord[]> => {
      return srvGet<NoteRecord[]>(`/notes?lemma=${encodeURIComponent(lemma)}`);
    },
    save: async (n: NoteRecord): Promise<NoteRecord> => {
      return srvPut<NoteRecord>(`/notes/${encodeURIComponent(n.id)}`, {
        ...n,
        updatedAt: Date.now(),
      });
    },
    remove: async (id: string): Promise<void> => {
      return srvDelete(`/notes/${encodeURIComponent(id)}`);
    },
  },

  /** The reader's own meaning per root, alongside the lexicons. */
  rootMeanings: {
    get: async (root: string): Promise<UserRootMeaning> => {
      return srvGet<UserRootMeaning>(`/root-meanings/${encodeURIComponent(root)}`);
    },
    all: async (): Promise<UserRootMeaning[]> => {
      return srvGet<UserRootMeaning[]>("/root-meanings");
    },
    set: async (root: string, meaning: string): Promise<UserRootMeaning> => {
      return srvPut<UserRootMeaning>(`/root-meanings/${encodeURIComponent(root)}`, { meaning });
    },
    remove: async (root: string): Promise<void> => {
      return srvDelete(`/root-meanings/${encodeURIComponent(root)}`);
    },
  },

  /** Motifs (بيوت) — reader-defined root collections. */
  motifs: {
    all: async (): Promise<Motif[]> => {
      return srvGet<Motif[]>("/motifs");
    },
    forRoot: async (root: string): Promise<Motif[]> => {
      return srvGet<Motif[]>(`/motifs/by-root/${encodeURIComponent(root)}`);
    },
    save: async (m: { id: string; name: string; note?: string; createdAt?: number }): Promise<Motif> => {
      return srvPut<Motif>(`/motifs/${encodeURIComponent(m.id)}`, { note: "", ...m });
    },
    remove: async (id: string): Promise<void> => {
      return srvDelete(`/motifs/${encodeURIComponent(id)}`);
    },
    addRoot: async (id: string, root: string): Promise<void> => {
      await srvPut(`/motifs/${encodeURIComponent(id)}/roots/${encodeURIComponent(root)}`, {});
    },
    removeRoot: async (id: string, root: string): Promise<void> => {
      return srvDelete(`/motifs/${encodeURIComponent(id)}/roots/${encodeURIComponent(root)}`);
    },
  },

  /** Word indications — meanings anchored at the ROOT (one primary per root), each
   *  with per-form refinements. Rootless words keep standalone lemma indications. */
  indications: {
    /** The word's root indications (each with THIS form's refinement) + rootless indications. */
    forWord: async (
      lemma: string | null, root: string | null, surface?: string | null,
    ): Promise<IndicationsForWord> => {
      const q = new URLSearchParams();
      if (lemma) q.set("lemma", lemma);
      if (root) q.set("root", root);
      if (surface) q.set("surface", surface);   // the word as written — keys the per-form refinement
      const own = await srvGet<IndicationsForWord>(`/indications/for-word?${q.toString()}`);
      // The community's readings are a PAID, ONLINE layer, read live from the remote (the server
      // always returns them empty). Only attempt it when the cached account has an active plan,
      // and never let its failure (offline / lapsed / signed out) break the reader's own view.
      const me = cachedMe();
      if (me?.planActive && (root || lemma)) {
        try {
          const c = await remote.communityReadings({ root, lemma });
          return { ...own, communityRoot: c.communityRoot, communityLemma: c.communityLemma };
        } catch { /* fall through to own-only */ }
      }
      return { ...own, communityRoot: [], communityLemma: [] };
    },
    /** Reader gloss data (primary root-indication text + refinements + rootless primaries). */
    gloss: async (): Promise<IndicationGloss> => {
      return srvGet<IndicationGloss>("/indications/gloss");
    },
    /** All of a root indication's per-form refinements (one per form the user has filled). */
    refinements: async (indicationId: string): Promise<WordIndication[]> => {
      return srvGet<WordIndication[]>(`/indications/${encodeURIComponent(indicationId)}/refinements`);
    },
    /** Create/update a root indication (pass root) or a standalone lemma indication (pass lemma, no root). */
    save: async (m: {
      id: string; root?: string | null; lemma?: string | null;
      label: string; meaning: string; primary?: boolean;
    }): Promise<WordIndication> => {
      return srvPut<WordIndication>(`/indications/${encodeURIComponent(m.id)}`, m);
    },
    /** Create/update a per-form refinement of a root indication. */
    saveRefinement: async (m: {
      id: string; parentId: string; lemma: string; label: string; meaning: string;
    }): Promise<WordIndication> => {
      return srvPut<WordIndication>(`/refinements/${encodeURIComponent(m.id)}`, m);
    },
    setPrimary: async (id: string): Promise<WordIndication> => {
      return srvPut<WordIndication>(`/indications/${encodeURIComponent(id)}/primary`, {});
    },
    remove: async (id: string): Promise<void> => {
      return srvDelete(`/indications/${encodeURIComponent(id)}`);
    },
    removeRefinement: async (id: string): Promise<void> => {
      return srvDelete(`/refinements/${encodeURIComponent(id)}`);
    },
  },

  /** Proposals an AI made through the MCP server, for the reader to review. */
  proposed: {
    all: async (): Promise<Proposed> => {
      return srvGet<Proposed>("/proposed");
    },
    accept: async (kind: "note" | "indication", id: string): Promise<void> => {
      await srvPut(`/proposed/${kind}/${encodeURIComponent(id)}/accept`, {});
    },
  },

  /** Comparisons (saveable boards of pinned āyāt & roots). */
  compare: {
    sets: async (): Promise<CompareSet[]> => {
      return srvGet<CompareSet[]>("/compare-sets");
    },
    saveSet: async (m: { id: string; title: string; createdAt?: number }): Promise<CompareSet> => {
      return srvPut<CompareSet>(`/compare-sets/${encodeURIComponent(m.id)}`, m);
    },
    removeSet: async (id: string): Promise<void> => {
      return srvDelete(`/compare-sets/${encodeURIComponent(id)}`);
    },
    items: async (setId: string): Promise<CompareItemRow[]> => {
      return srvGet<CompareItemRow[]>(`/compare-sets/${encodeURIComponent(setId)}/items`);
    },
    addItem: async (
      setId: string,
      item: { id: string; kind: "ayah" | "root"; ref: string; label?: string | null },
    ): Promise<CompareItemRow> => {
      return srvPut<CompareItemRow>(
        `/compare-sets/${encodeURIComponent(setId)}/items/${encodeURIComponent(item.id)}`,
        { kind: item.kind, ref: item.ref, label: item.label ?? null },
      );
    },
    removeItem: async (setId: string, itemId: string): Promise<void> => {
      return srvDelete(`/compare-sets/${encodeURIComponent(setId)}/items/${encodeURIComponent(itemId)}`);
    },
    clear: async (setId: string): Promise<void> => {
      return srvDelete(`/compare-sets/${encodeURIComponent(setId)}/items`);
    },
  },

  /** UI prefs (font size, script, active comparison) — stored in the account so they persist with the reader's data and are shared between the web and
   *  desktop builds. */
  prefs: {
    get: async <T>(key: string): Promise<T | undefined> => {
      try {
        const { value } = await srvGet<{ value: T | null }>(`/settings/${encodeURIComponent(key)}`);
        return value == null ? undefined : (value as T);
      } catch {
        return undefined; // server not ready → fall back to defaults, no crash
      }
    },
    set: async (key: string, value: unknown): Promise<void> => {
      try { await srvPut(`/settings/${encodeURIComponent(key)}`, { value }); }
      catch { /* best-effort; a dropped prefs write is not worth surfacing */ }
    },
  },
};

/** Every researched form across all cases (status + established meaning). */
export interface FormStatusRow {
  lemma: string;
  root: string;
  status: "open" | "established";
  meaning: string;
  case_id: string;
  case_status: string;
}

export async function fetchFormStatus(): Promise<FormStatusRow[]> {
  return srvGet<FormStatusRow[]>("/form-status");
}

export interface FormRevision {
  meaning: string;
  replaced_at: number;
}

export async function fetchFormRevisions(
  caseId: string,
  lemma: string,
): Promise<FormRevision[]> {
  return srvGet<FormRevision[]>(
    `/cases/${encodeURIComponent(caseId)}/forms/${encodeURIComponent(lemma)}/revisions`,
  );
}
