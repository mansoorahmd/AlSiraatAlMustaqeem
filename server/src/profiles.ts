// Research profiles — which research.db is "yours", and how to keep exactly one per person.
//
// The problem this solves: the file you work in used to depend on HOW you launched (web dev vs
// desktop), which silently forked a reader's research. A profile ties the file to WHO you are
// instead.
//
//   • Signed out → you work in the DEFAULT profile. Local study never requires an account
//     (SHARED_RESEARCH.md §2), so there must always be somewhere to work.
//   • First sign-in → that profile is CLAIMED by your email: renamed to research-<uuid>.db and
//     labelled. Your existing work is adopted, never orphaned — the same idea as binding
//     local_id to an account, applied to the file itself.
//   • Signing in as someone else → opens THEIR profile (created if new), so several researchers
//     can share one machine.
//   • You can also open any .db file explicitly.
//
// The id is uuidv5(email) so the same person always resolves to the same filename, on any
// machine, without a lookup.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

export interface Profile {
  id: string;
  label: string;
  email: string | null;
  path: string;
  createdAt: number;
  lastOpenedAt: number;
}

interface Index {
  version: 1;
  activeId: string | null;
  profiles: Profile[];
}

const DEFAULT_ID = "default";
/** Fixed namespace so uuidv5(email) is stable across machines and versions. */
const NAMESPACE = "6f9619ff-8b86-d011-b42d-00cf4fc964ff";

/** RFC 4122 v5 (SHA-1, name-based) — deterministic for a given email. */
export function uuidV5(name: string): string {
  const ns = Buffer.from(NAMESPACE.replace(/-/g, ""), "hex");
  const h = createHash("sha1").update(Buffer.concat([ns, Buffer.from(name, "utf8")])).digest();
  h[6] = (h[6]! & 0x0f) | 0x50; // version 5
  h[8] = (h[8]! & 0x3f) | 0x80; // RFC 4122 variant
  const hex = h.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export const profileIdFor = (email: string): string => uuidV5(email.trim().toLowerCase());

export class Profiles {
  readonly dir: string;
  private readonly indexPath: string;

  /** `defaultDbPath` is the research.db the app would otherwise open. */
  constructor(private readonly defaultDbPath: string) {
    this.dir = dirname(resolve(defaultDbPath));
    this.indexPath = join(this.dir, "profiles.json");
  }

  private read(): Index {
    try {
      const parsed = JSON.parse(readFileSync(this.indexPath, "utf8")) as Index;
      if (parsed?.version === 1 && Array.isArray(parsed.profiles)) return parsed;
    } catch { /* missing or unreadable → rebuild below */ }
    // First run (or a damaged index): adopt whatever file we were already using as the default
    // profile, so nothing is lost and nothing needs migrating.
    const now = Date.now();
    return {
      version: 1,
      activeId: DEFAULT_ID,
      profiles: [{
        id: DEFAULT_ID, label: basename(this.defaultDbPath), email: null,
        path: resolve(this.defaultDbPath), createdAt: now, lastOpenedAt: now,
      }],
    };
  }

  private write(ix: Index): void {
    mkdirSync(this.dir, { recursive: true });
    writeFileSync(this.indexPath, JSON.stringify(ix, null, 2));
  }

  list(): Profile[] {
    return this.read().profiles;
  }

  active(): Profile {
    const ix = this.read();
    return ix.profiles.find((p) => p.id === ix.activeId) ?? ix.profiles[0]!;
  }

  /** The path the server should open right now. */
  activePath(): string {
    const p = this.active();
    return existsSync(p.path) || p.id === DEFAULT_ID ? p.path : this.defaultDbPath;
  }

  /** Make `id` active. Throws if unknown. */
  switchTo(id: string): Profile {
    const ix = this.read();
    const p = ix.profiles.find((x) => x.id === id);
    if (!p) throw new Error(`no such profile: ${id}`);
    p.lastOpenedAt = Date.now();
    ix.activeId = id;
    this.write(ix);
    return p;
  }

  /** Register (or refresh) a profile for an explicit file, and make it active. */
  openFile(path: string, label?: string): Profile {
    const full = resolve(path);
    if (!full.endsWith(".db")) throw new Error("a research database must be a .db file");
    const ix = this.read();
    let p = ix.profiles.find((x) => resolve(x.path) === full);
    if (!p) {
      p = {
        id: `file_${uuidV5(full).slice(0, 8)}`, label: label ?? basename(full), email: null,
        path: full, createdAt: Date.now(), lastOpenedAt: Date.now(),
      };
      ix.profiles.push(p);
    }
    p.lastOpenedAt = Date.now();
    ix.activeId = p.id;
    this.write(ix);
    return p;
  }

  /**
   * Attach an email to a profile. If the ACTIVE profile is unclaimed, it is claimed in place —
   * the file is renamed to research-<uuid>.db and the work in it becomes this person's. If that
   * email already has a profile, we switch to it instead (a second researcher on one machine).
   */
  claim(email: string, label?: string): Profile {
    const clean = email.trim().toLowerCase();
    const id = profileIdFor(clean);
    const ix = this.read();

    const mine = ix.profiles.find((p) => p.id === id);
    if (mine) {                       // already known → just make it active
      mine.lastOpenedAt = Date.now();
      if (label) mine.label = label;
      ix.activeId = mine.id;
      this.write(ix);
      return mine;
    }

    const current = ix.profiles.find((p) => p.id === ix.activeId) ?? ix.profiles[0]!;
    if (current.email === null) {     // unclaimed → adopt it, keeping the work in it
      const target = join(this.dir, `research-${id}.db`);
      if (existsSync(current.path) && resolve(current.path) !== resolve(target)) {
        renameSync(current.path, target);
        for (const side of ["-wal", "-shm"]) {                 // move the WAL sidecars too
          if (existsSync(current.path + side)) renameSync(current.path + side, target + side);
        }
      }
      current.id = id; current.email = clean; current.label = label ?? clean;
      current.path = target; current.lastOpenedAt = Date.now();
      ix.activeId = id;
      this.write(ix);
      return current;
    }

    // the active profile belongs to someone else → start a fresh one for this person
    const fresh: Profile = {
      id, label: label ?? clean, email: clean,
      path: join(this.dir, `research-${id}.db`),
      createdAt: Date.now(), lastOpenedAt: Date.now(),
    };
    ix.profiles.push(fresh);
    ix.activeId = id;
    this.write(ix);
    return fresh;
  }
}
