// Persistence layer.
//
// PRECIOUS DATA (cases, trails) lives in research.db on the backend
// (/research/* routes) — a real SQLite file the user can back up by copying.
// DEVICE-LOCAL data (UI prefs, legacy vault) stays in IndexedDB.
//
// A one-time migration pushes any pre-existing IndexedDB cases/trails to the
// server the first time the app runs after this change.

import type { CaseRecord, VaultEntry, TrailRecord, PrefsRecord, NoteRecord, UserRootMeaning, Motif } from "./types";
import type { CompareSet, CompareItemRow, WordSense, SensesForWord, SenseGloss } from "../api/types";

const DB_NAME = "alsiraat-archive";
const DB_VERSION = 1;
const API = "/api/v1/research";

export type StoreName = "cases" | "vault" | "trails" | "prefs";

// ---- IndexedDB (prefs + legacy stores) --------------------------------------

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("cases")) {
        const s = db.createObjectStore("cases", { keyPath: "id" });
        s.createIndex("status", "status");
        s.createIndex("updatedAt", "updatedAt");
      }
      if (!db.objectStoreNames.contains("vault")) {
        const s = db.createObjectStore("vault", { keyPath: "rootArabic" });
        s.createIndex("confidence", "confidence");
      }
      if (!db.objectStoreNames.contains("trails")) {
        const s = db.createObjectStore("trails", { keyPath: "id" });
        s.createIndex("updatedAt", "updatedAt");
      }
      if (!db.objectStoreNames.contains("prefs")) {
        db.createObjectStore("prefs", { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx<T>(
  store: StoreName,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

function idbGet<T>(store: StoreName, key: IDBValidKey): Promise<T | undefined> {
  return tx<T | undefined>(store, "readonly", (s) => s.get(key) as IDBRequest<T | undefined>);
}
function idbGetAll<T>(store: StoreName): Promise<T[]> {
  return tx<T[]>(store, "readonly", (s) => s.getAll() as IDBRequest<T[]>);
}
function idbPut<T>(store: StoreName, value: T): Promise<IDBValidKey> {
  return tx<IDBValidKey>(store, "readwrite", (s) => s.put(value));
}
function idbDel(store: StoreName, key: IDBValidKey): Promise<undefined> {
  return tx<undefined>(store, "readwrite", (s) => s.delete(key));
}

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
async function srvDelete(path: string): Promise<void> {
  const res = await fetch(`${API}${path}`, { method: "DELETE" });
  if (!res.ok && res.status !== 404) throw new Error(`DELETE ${path} → ${res.status}`);
}

// ---- one-time migration: IndexedDB → research.db ------------------------------

let migration: Promise<void> | null = null;

function ensureMigrated(): Promise<void> {
  if (!migration) {
    migration = (async () => {
      const done = await idbGet<PrefsRecord>("prefs", "migrated_to_research_db");
      if (done?.value) return;
      try {
        const [cases, trails] = await Promise.all([
          idbGetAll<CaseRecord>("cases"),
          idbGetAll<TrailRecord>("trails"),
        ]);
        for (const c of cases) await srvPut(`/cases/${encodeURIComponent(c.id)}`, c);
        for (const t of trails) await srvPut(`/trails/${encodeURIComponent(t.id)}`, t);
        await idbPut("prefs", { key: "migrated_to_research_db", value: true });
        if (cases.length || trails.length) {
          console.info(
            `[archive] migrated ${cases.length} case(s), ${trails.length} trail(s) to research.db`,
          );
        }
      } catch (e) {
        migration = null; // retry next call — e.g. backend not running yet
        throw e;
      }
    })();
  }
  return migration;
}

// ---- typed access ---------------------------------------------------------------

export const archive = {
  /** Cases — stored in research.db via the API. */
  cases: {
    get: async (id: string): Promise<CaseRecord | undefined> => {
      await ensureMigrated();
      try {
        return await srvGet<CaseRecord>(`/cases/${encodeURIComponent(id)}`);
      } catch {
        return undefined;
      }
    },
    all: async (): Promise<CaseRecord[]> => {
      await ensureMigrated();
      return srvGet<CaseRecord[]>("/cases");
    },
    save: async (c: CaseRecord): Promise<CaseRecord> => {
      await ensureMigrated();
      return srvPut<CaseRecord>(`/cases/${encodeURIComponent(c.id)}`, {
        ...c,
        updatedAt: Date.now(),
      });
    },
    remove: async (id: string): Promise<void> => {
      await ensureMigrated();
      return srvDelete(`/cases/${encodeURIComponent(id)}`);
    },
  },

  /** Trails — stored in research.db via the API. */
  trails: {
    get: async (id: string): Promise<TrailRecord | undefined> => {
      await ensureMigrated();
      const all = await srvGet<TrailRecord[]>("/trails");
      return all.find((t) => t.id === id);
    },
    all: async (): Promise<TrailRecord[]> => {
      await ensureMigrated();
      return srvGet<TrailRecord[]>("/trails");
    },
    save: async (t: TrailRecord): Promise<TrailRecord> => {
      await ensureMigrated();
      return srvPut<TrailRecord>(`/trails/${encodeURIComponent(t.id)}`, {
        ...t,
        updatedAt: Date.now(),
      });
    },
    remove: async (id: string): Promise<void> => {
      await ensureMigrated();
      return srvDelete(`/trails/${encodeURIComponent(id)}`);
    },
  },

  /** Notes & questions on ayahs/words — research.db via the API.
   *  Shared between the reader and the investigation board. */
  notes: {
    all: async (): Promise<NoteRecord[]> => {
      await ensureMigrated();
      return srvGet<NoteRecord[]>("/notes");
    },
    forVerse: async (verseKey: string): Promise<NoteRecord[]> => {
      await ensureMigrated();
      return srvGet<NoteRecord[]>(`/notes?verse=${encodeURIComponent(verseKey)}`);
    },
    forRoot: async (root: string): Promise<NoteRecord[]> => {
      await ensureMigrated();
      return srvGet<NoteRecord[]>(`/notes?root=${encodeURIComponent(root)}`);
    },
    forLemma: async (lemma: string): Promise<NoteRecord[]> => {
      await ensureMigrated();
      return srvGet<NoteRecord[]>(`/notes?lemma=${encodeURIComponent(lemma)}`);
    },
    save: async (n: NoteRecord): Promise<NoteRecord> => {
      await ensureMigrated();
      return srvPut<NoteRecord>(`/notes/${encodeURIComponent(n.id)}`, {
        ...n,
        updatedAt: Date.now(),
      });
    },
    remove: async (id: string): Promise<void> => {
      await ensureMigrated();
      return srvDelete(`/notes/${encodeURIComponent(id)}`);
    },
  },

  /** The reader's own meaning per root — research.db, alongside the lexicons. */
  rootMeanings: {
    get: async (root: string): Promise<UserRootMeaning> => {
      await ensureMigrated();
      return srvGet<UserRootMeaning>(`/root-meanings/${encodeURIComponent(root)}`);
    },
    all: async (): Promise<UserRootMeaning[]> => {
      await ensureMigrated();
      return srvGet<UserRootMeaning[]>("/root-meanings");
    },
    set: async (root: string, meaning: string): Promise<UserRootMeaning> => {
      await ensureMigrated();
      return srvPut<UserRootMeaning>(`/root-meanings/${encodeURIComponent(root)}`, { meaning });
    },
    remove: async (root: string): Promise<void> => {
      await ensureMigrated();
      return srvDelete(`/root-meanings/${encodeURIComponent(root)}`);
    },
  },

  /** Motifs (بيوت) — reader-defined root collections, research.db. */
  motifs: {
    all: async (): Promise<Motif[]> => {
      await ensureMigrated();
      return srvGet<Motif[]>("/motifs");
    },
    forRoot: async (root: string): Promise<Motif[]> => {
      await ensureMigrated();
      return srvGet<Motif[]>(`/motifs/by-root/${encodeURIComponent(root)}`);
    },
    save: async (m: { id: string; name: string; note?: string; createdAt?: number }): Promise<Motif> => {
      await ensureMigrated();
      return srvPut<Motif>(`/motifs/${encodeURIComponent(m.id)}`, { note: "", ...m });
    },
    remove: async (id: string): Promise<void> => {
      await ensureMigrated();
      return srvDelete(`/motifs/${encodeURIComponent(id)}`);
    },
    addRoot: async (id: string, root: string): Promise<void> => {
      await ensureMigrated();
      await srvPut(`/motifs/${encodeURIComponent(id)}/roots/${encodeURIComponent(root)}`, {});
    },
    removeRoot: async (id: string, root: string): Promise<void> => {
      await ensureMigrated();
      return srvDelete(`/motifs/${encodeURIComponent(id)}/roots/${encodeURIComponent(root)}`);
    },
  },

  /** Word senses — meanings anchored at the ROOT (one primary per root), each
   *  with per-form refinements. Rootless words keep standalone lemma senses. */
  senses: {
    /** The word's root senses (each with THIS form's refinement) + rootless senses. */
    forWord: async (lemma: string | null, root: string | null): Promise<SensesForWord> => {
      await ensureMigrated();
      const q = new URLSearchParams();
      if (lemma) q.set("lemma", lemma);
      if (root) q.set("root", root);
      return srvGet<SensesForWord>(`/senses/for-word?${q.toString()}`);
    },
    /** Reader gloss data (primary root-sense text + refinements + rootless primaries). */
    gloss: async (): Promise<SenseGloss> => {
      await ensureMigrated();
      return srvGet<SenseGloss>("/senses/gloss");
    },
    /** All of a root sense's per-form refinements (one per form the user has filled). */
    refinements: async (senseId: string): Promise<WordSense[]> => {
      await ensureMigrated();
      return srvGet<WordSense[]>(`/senses/${encodeURIComponent(senseId)}/refinements`);
    },
    /** Create/update a root sense (pass root) or a standalone lemma sense (pass lemma, no root). */
    save: async (m: {
      id: string; root?: string | null; lemma?: string | null;
      label: string; meaning: string; primary?: boolean;
    }): Promise<WordSense> => {
      await ensureMigrated();
      return srvPut<WordSense>(`/senses/${encodeURIComponent(m.id)}`, m);
    },
    /** Create/update a per-form refinement of a root sense. */
    saveRefinement: async (m: {
      id: string; parentId: string; lemma: string; label: string; meaning: string;
    }): Promise<WordSense> => {
      await ensureMigrated();
      return srvPut<WordSense>(`/refinements/${encodeURIComponent(m.id)}`, m);
    },
    setPrimary: async (id: string): Promise<WordSense> => {
      await ensureMigrated();
      return srvPut<WordSense>(`/senses/${encodeURIComponent(id)}/primary`, {});
    },
    remove: async (id: string): Promise<void> => {
      await ensureMigrated();
      return srvDelete(`/senses/${encodeURIComponent(id)}`);
    },
    removeRefinement: async (id: string): Promise<void> => {
      await ensureMigrated();
      return srvDelete(`/refinements/${encodeURIComponent(id)}`);
    },
  },

  /** Comparisons (saveable boards of pinned āyāt & roots) — research.db. */
  compare: {
    sets: async (): Promise<CompareSet[]> => {
      await ensureMigrated();
      return srvGet<CompareSet[]>("/compare-sets");
    },
    saveSet: async (m: { id: string; title: string; createdAt?: number }): Promise<CompareSet> => {
      await ensureMigrated();
      return srvPut<CompareSet>(`/compare-sets/${encodeURIComponent(m.id)}`, m);
    },
    removeSet: async (id: string): Promise<void> => {
      await ensureMigrated();
      return srvDelete(`/compare-sets/${encodeURIComponent(id)}`);
    },
    items: async (setId: string): Promise<CompareItemRow[]> => {
      await ensureMigrated();
      return srvGet<CompareItemRow[]>(`/compare-sets/${encodeURIComponent(setId)}/items`);
    },
    addItem: async (
      setId: string,
      item: { id: string; kind: "ayah" | "root"; ref: string; label?: string | null },
    ): Promise<CompareItemRow> => {
      await ensureMigrated();
      return srvPut<CompareItemRow>(
        `/compare-sets/${encodeURIComponent(setId)}/items/${encodeURIComponent(item.id)}`,
        { kind: item.kind, ref: item.ref, label: item.label ?? null },
      );
    },
    removeItem: async (setId: string, itemId: string): Promise<void> => {
      await ensureMigrated();
      return srvDelete(`/compare-sets/${encodeURIComponent(setId)}/items/${encodeURIComponent(itemId)}`);
    },
    clear: async (setId: string): Promise<void> => {
      await ensureMigrated();
      return srvDelete(`/compare-sets/${encodeURIComponent(setId)}/items`);
    },
  },

  /** Legacy vault — device-local; V4 replaces it with family pages derived
   *  from established cases in research.db. */
  vault: {
    get: (rootArabic: string) => idbGet<VaultEntry>("vault", rootArabic),
    all: () => idbGetAll<VaultEntry>("vault"),
    save: (v: VaultEntry) => idbPut("vault", { ...v, updatedAt: Date.now() }),
    remove: (rootArabic: string) => idbDel("vault", rootArabic),
  },

  /** UI prefs — deliberately device-local (font size, script, position). */
  prefs: {
    get: async <T>(key: string): Promise<T | undefined> => {
      const rec = await idbGet<PrefsRecord>("prefs", key);
      return rec?.value as T | undefined;
    },
    set: (key: string, value: unknown) => idbPut("prefs", { key, value }),
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
