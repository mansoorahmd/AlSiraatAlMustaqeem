// Persistence layer. All research (cases, trails, notes, indications, comparisons,
// motifs) and device-independent UI prefs live in research.db on the backend, reached
// through the /research/* routes — a real SQLite file the user can back up by copying.
// The client is a thin fetch wrapper; there is no browser-side storage.

import type { CaseRecord, TrailRecord, NoteRecord, UserRootMeaning, Motif } from "./types";
import type { CompareSet, CompareItemRow, WordIndication, IndicationsForWord, IndicationGloss, Proposed, PeerIndication } from "../api/types";

const API = "/api/v1/research";

export function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// ---- server helpers ----------------------------------------------------------

async function srvGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`);
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}
async function srvPut<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PUT ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}
async function srvPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.json().then((b) => (b as { detail?: string }).detail).catch(() => undefined);
    throw new Error(detail ?? `POST ${path} → ${res.status}`);
  }
  return res.json() as Promise<T>;
}
async function srvDelete(path: string): Promise<void> {
  const res = await fetch(`${API}${path}`, { method: "DELETE" });
  if (!res.ok && res.status !== 404) throw new Error(`DELETE ${path} → ${res.status}`);
}

// ---- backup --------------------------------------------------------------------

export interface BackupResult { path: string; bytes: number; at: number }

export interface Owner {
  name: string;
  email: string;
  uuid: string;
  claimedAt: number;
  updatedAt: number;
}
export interface RecentDb { path: string; label: string; lastOpenedAt: number }

/** The open database: its path, and whose research it is (read from inside the file). */
export async function fetchIdentity(): Promise<{
  localId: string; databasePath?: string; owner: Owner | null;
}> {
  return srvGet("/identity");
}

/**
 * Whose research this database is. The answer lives INSIDE the file, so it travels with it —
 * copy the file to another machine and it is still yours. The uuid is derived from the email,
 * and is what a remote account binds to.
 */
export const owner = {
  /** Claim this database, or re-assign it (you hold the file, so you may correct it). */
  set(email: string, name?: string): Promise<Owner> {
    return srvPut<Owner>("/owner", { email, name });
  },
};

/** Which database file is open. Identity lives in each file; this is just the choosing. */
export const databases = {
  list(): Promise<{ current: { path: string; owner: Owner | null }; recent: RecentDb[] }> {
    return srvGet("/databases");
  },
  /**
   * Open another database. It is COPIED to the working location and you edit the copy, so a
   * backup stays an untouched backup; any database already open is moved aside (never
   * overwritten) and reported as `replaced`.
   */
  open(path: string, inPlace = false): Promise<{ path: string; owner: Owner | null; replaced: string | null }> {
    return srvPost("/databases/open", { path, inPlace });
  },
};

// ---- the group's readings, pulled from the remote (Phase 6) --------------------

export interface GroupReading {
  subjectKind: string; subjectValue: string; claimId: string; version: number;
  meaning: string; authorId: string; establishedAt: number; dissents: number;
}
export interface Divergence {
  lemma: string; root: string; caseId: string;
  mine: string; theirs: string;
  claimId: string; version: number; authorId: string; dissents: number;
}

/**
 * The group's established readings, kept in DERIVED tables so they can be dropped and re-pulled
 * at any time. Your own established meanings are never touched — where the two differ is shown,
 * not resolved.
 */
/** One position per stream — each remote table has its own sequence. */
export interface SyncCursors {
  globalForms: number;
  dissents: number;
  peerIndications: number;
}

export interface GroupState {
  cursors: SyncCursors;
  groupReadings: number;
  /** forms I have established */
  mine: number;
  /** readings the group has established */
  theirs: number;
  /** forms we have both settled — the only ones that CAN diverge */
  overlap: number;
}

export const group = {
  state(): Promise<GroupState> {
    return srvGet("/pull/state");
  },
  apply(page: unknown): Promise<{
    globalForms: number; dissents: number; peerIndications: number; cursors: SyncCursors;
  }> {
    return srvPost("/pull/apply", page);
  },
  reset(): Promise<{ ok: boolean; cursors: SyncCursors }> {
    return srvPost("/pull/reset", {});
  },
  reading(subjectValue: string, subjectKind = "form"): Promise<GroupReading | null> {
    return srvGet(`/group-reading?subjectKind=${subjectKind}&subjectValue=${encodeURIComponent(subjectValue)}`);
  },
  gloss(): Promise<{ subjectKind: string; subjectValue: string; meaning: string }[]> {
    return srvGet("/group-gloss");
  },
  /** Forms I established whose meaning differs from the group's. */
  divergences(): Promise<Divergence[]> {
    return srvGet("/divergences");
  },
  /** The community's FORM readings for these lemmas, keyed by lemma — the per-form view
   *  of a community root reading. */
  peerFormReadings(lemmas: string[]): Promise<Record<string, PeerIndication>> {
    if (lemmas.length === 0) return Promise.resolve({});
    return srvGet(`/peer-form-readings?lemmas=${encodeURIComponent(lemmas.join(","))}`);
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

/**
 * Back up research.db — the one irreplaceable file. On the desktop we ask the native
 * shell for a save location (a real folder the user picks); on the web build we let the
 * server write a timestamped copy into a sibling backups/ folder and report the path.
 * Either way the copy is complete (WAL folded in) and safe to take while working.
 */
export async function backupResearch(): Promise<BackupResult | { canceled: true }> {
  const desktop = (window as unknown as { desktop?: { backupResearch(): Promise<BackupResult | { canceled: true }> } }).desktop;
  if (desktop?.backupResearch) return desktop.backupResearch();
  const res = await fetch(`${API}/backup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  if (!res.ok) throw new Error(`backup failed → ${res.status}`);
  return res.json() as Promise<BackupResult>;
}

// ---- typed access ---------------------------------------------------------------

export const archive = {
  /** Cases — stored in research.db via the API. */
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

  /** Trails — stored in research.db via the API. */
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

  /** Notes & questions on ayahs/words — research.db via the API.
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

  /** The reader's own meaning per root — research.db, alongside the lexicons. */
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

  /** Motifs (بيوت) — reader-defined root collections, research.db. */
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
    forWord: async (lemma: string | null, root: string | null): Promise<IndicationsForWord> => {
      const q = new URLSearchParams();
      if (lemma) q.set("lemma", lemma);
      if (root) q.set("root", root);
      return srvGet<IndicationsForWord>(`/indications/for-word?${q.toString()}`);
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

  /** Comparisons (saveable boards of pinned āyāt & roots) — research.db. */
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

  /** UI prefs (font size, script, active comparison) — stored in research.db via the
   *  server so they persist with the reader's data and are shared between the web and
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
