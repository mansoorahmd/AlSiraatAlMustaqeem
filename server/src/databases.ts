// Which database file to open — and only that.
//
// WHO a database belongs to lives INSIDE the file (the `owner` table), so it travels with the
// file: back it up, restore it on another machine, hand it to a colleague, and it still knows
// whose research it is. This module holds the one thing that can't live in the file — the list
// of files this machine knows about, and which was open last.
//
// Deliberately dumb: a path list. It is never the source of truth about identity, and deleting
// it costs nothing but the recent-files menu.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export interface RecentDb {
  path: string;
  /** Cached for the menu; the file itself is authoritative once opened. */
  label: string;
  lastOpenedAt: number;
}

interface Index { version: 2; currentPath: string | null; recent: RecentDb[] }

const fileName = (p: string) => p.replace(/^.*[/\\]/, "");

export class Databases {
  readonly dir: string;
  private readonly indexPath: string;

  /** `defaultDbPath` is what to open when this machine has no history. */
  constructor(private readonly defaultDbPath: string) {
    this.dir = dirname(resolve(defaultDbPath));
    this.indexPath = join(this.dir, "databases.json");
  }

  private read(): Index {
    try {
      const parsed = JSON.parse(readFileSync(this.indexPath, "utf8")) as Index;
      if (parsed?.version === 2 && Array.isArray(parsed.recent)) return parsed;
    } catch { /* missing, damaged, or an older format → start fresh below */ }
    return { version: 2, currentPath: null, recent: [] };
  }

  private write(ix: Index): void {
    mkdirSync(this.dir, { recursive: true });
    writeFileSync(this.indexPath, JSON.stringify(ix, null, 2));
  }

  /** The database the server should open now. */
  currentPath(): string {
    const ix = this.read();
    return ix.currentPath && existsSync(ix.currentPath) ? ix.currentPath : resolve(this.defaultDbPath);
  }

  recent(): RecentDb[] {
    return this.read().recent.filter((r) => existsSync(r.path));
  }

  /** Remember `path` as the open database (creating the entry if new). */
  use(path: string, label?: string): string {
    const full = resolve(path);
    if (!full.endsWith(".db")) throw new Error("a research database must be a .db file");
    const ix = this.read();
    const existing = ix.recent.find((r) => resolve(r.path) === full);
    if (existing) {
      existing.lastOpenedAt = Date.now();
      if (label) existing.label = label;
    } else {
      ix.recent.push({ path: full, label: label ?? fileName(full), lastOpenedAt: Date.now() });
    }
    ix.recent.sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
    ix.currentPath = full;
    this.write(ix);
    return full;
  }

  /** Update the cached label (called once a database is open and its owner is known). */
  label(path: string, label: string): void {
    const ix = this.read();
    const entry = ix.recent.find((r) => resolve(r.path) === resolve(path));
    if (entry && entry.label !== label) { entry.label = label; this.write(ix); }
  }

  forget(path: string): void {
    const ix = this.read();
    ix.recent = ix.recent.filter((r) => resolve(r.path) !== resolve(path));
    this.write(ix);
  }
}
