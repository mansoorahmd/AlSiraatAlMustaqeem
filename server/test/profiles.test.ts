// Research profiles: one database per person, so which file holds your work depends on WHO
// you are, not HOW you launched the app.
//
// The rules that matter: local study works before any account exists; signing in CLAIMS the
// work you already did (renames the file, never orphans it); a second person on the same
// machine gets their own file; the same email always resolves to the same name; and you can
// open any database explicitly.

import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Profiles, profileIdFor, uuidV5 } from "../src/profiles.js";

let dir: string;
let defaultDb: string;
let p: Profiles;

const ME = "mansoor@example.org";
const OTHER = "someone@example.org";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "alsiraat-profiles-"));
  defaultDb = join(dir, "research.db");
  writeFileSync(defaultDb, "not really sqlite, but a file to rename");
  p = new Profiles(defaultDb);
});

describe("the default profile", () => {
  it("exists before anyone signs in, pointing at the current file", () => {
    const active = p.active();
    expect(active.id).toBe("default");
    expect(active.email).toBeNull();
    expect(active.path).toBe(defaultDb);
    expect(p.activePath()).toBe(defaultDb);
  });
});

describe("claiming (first sign-in)", () => {
  it("adopts the work already done — renames the file, keeps the contents", () => {
    const before = readFileSync(defaultDb, "utf8");
    const claimed = p.claim(ME, "Mansoor");

    expect(claimed.email).toBe(ME);
    expect(claimed.id).toBe(profileIdFor(ME));
    expect(claimed.path).toBe(join(dir, `research-${profileIdFor(ME)}.db`));
    expect(existsSync(claimed.path)).toBe(true);
    expect(readFileSync(claimed.path, "utf8")).toBe(before); // the SAME research, not a new file
    expect(existsSync(defaultDb)).toBe(false);               // moved, not copied
    expect(p.active().id).toBe(claimed.id);
  });

  it("moves the WAL sidecars with it", () => {
    writeFileSync(`${defaultDb}-wal`, "wal");
    writeFileSync(`${defaultDb}-shm`, "shm");
    const claimed = p.claim(ME);
    expect(existsSync(`${claimed.path}-wal`)).toBe(true);
    expect(existsSync(`${claimed.path}-shm`)).toBe(true);
    expect(existsSync(`${defaultDb}-wal`)).toBe(false);
  });

  it("signing in again just reopens the same profile", () => {
    const first = p.claim(ME);
    const again = p.claim(ME);
    expect(again.id).toBe(first.id);
    expect(again.path).toBe(first.path);
    expect(p.list().filter((x) => x.email === ME)).toHaveLength(1);
  });

  it("is deterministic — the same email always maps to the same id", () => {
    expect(profileIdFor(ME)).toBe(profileIdFor(ME));
    expect(profileIdFor(" MANSOOR@example.org ")).toBe(profileIdFor(ME)); // trimmed + lowercased
    expect(profileIdFor(OTHER)).not.toBe(profileIdFor(ME));
    expect(uuidV5(ME)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe("a second researcher on the same machine", () => {
  it("gets their own file, leaving the first person's work alone", () => {
    const mine = p.claim(ME);
    const theirs = p.claim(OTHER);

    expect(theirs.id).not.toBe(mine.id);
    expect(theirs.path).not.toBe(mine.path);
    expect(existsSync(mine.path)).toBe(true);   // untouched
    expect(p.active().id).toBe(theirs.id);
    expect(p.list()).toHaveLength(2);
  });

  it("switching back returns to the first person's database", () => {
    const mine = p.claim(ME);
    p.claim(OTHER);
    const back = p.switchTo(mine.id);
    expect(back.path).toBe(mine.path);
    expect(p.activePath()).toBe(mine.path);
  });

  it("refuses to switch to a profile that doesn't exist", () => {
    expect(() => p.switchTo("nope")).toThrow(/no such profile/);
  });
});

describe("opening a database explicitly", () => {
  it("registers the file and makes it active", () => {
    const other = join(dir, "shared-study.db");
    writeFileSync(other, "x");
    const opened = p.openFile(other);
    expect(opened.path).toBe(other);
    expect(p.activePath()).toBe(other);
    expect(p.list().some((x) => x.path === other)).toBe(true);
  });

  it("opening the same file twice doesn't duplicate the entry", () => {
    const other = join(dir, "shared-study.db");
    writeFileSync(other, "x");
    p.openFile(other);
    p.openFile(other);
    expect(p.list().filter((x) => x.path === other)).toHaveLength(1);
  });

  it("insists on a .db file", () => {
    expect(() => p.openFile(join(dir, "notes.txt"))).toThrow(/\.db file/);
  });
});

describe("the index survives a restart", () => {
  it("a new Profiles instance sees the same profiles and active choice", () => {
    const claimed = p.claim(ME);
    const reopened = new Profiles(defaultDb);
    expect(reopened.active().id).toBe(claimed.id);
    expect(reopened.activePath()).toBe(claimed.path);
    expect(reopened.list()).toHaveLength(1);
  });
});
