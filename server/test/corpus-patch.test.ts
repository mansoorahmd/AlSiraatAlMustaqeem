// Corpus patch channel (Phase 2): a signed, versioned patch verifies against the trusted
// key and applies in order, idempotently, in one transaction. Tampering or a wrong key is
// refused; ops address rows by natural key (upsert = update-or-insert, plus delete).

import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKeyPairSync } from "node:crypto";
import { Db } from "../src/db.js";
import { signPatch, applyPatch, readCorpusVersion, type Patch } from "../src/corpus/patch.js";

// the maintainer's keypair (author signs with priv; client trusts pub)
const kp = generateKeyPairSync("ed25519");
const PRIV = kp.privateKey.export({ type: "pkcs8", format: "pem" }) as string;
const PUB = kp.publicKey.export({ type: "spki", format: "pem" }) as string;
const OTHER_PRIV = generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" }) as string;

let db: Db;

beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), "alsiraat-corpus-"));
  db = new Db(join(dir, "quran.db")); // a tiny synthetic corpus, read-write
  db.exec("CREATE TABLE verses (verse_key TEXT PRIMARY KEY, text TEXT NOT NULL)");
  db.exec("CREATE TABLE roots (root TEXT PRIMARY KEY, meaning TEXT NOT NULL DEFAULT '')");
  db.run("INSERT INTO verses (verse_key, text) VALUES (?,?)", ["2:255", "old text"]);
  db.run("INSERT INTO roots (root, meaning) VALUES (?,?)", ["زقتل", "typo root"]);
});

const patch = (over: Partial<Patch> = {}): Patch => ({
  id: "corpus-test-001", schemaVersion: 1, patchVersion: 1, parent: 0,
  ops: [
    { op: "upsert", table: "verses", key: { verse_key: "2:255" }, set: { text: "corrected text" } },
    { op: "upsert", table: "verses", key: { verse_key: "112:1" }, set: { text: "brand new" } },
    { op: "delete", table: "roots", key: { root: "زقتل" } },
  ],
  ...over,
});

describe("corpus patch channel", () => {
  it("verifies and applies: upsert updates, upsert inserts, delete removes", () => {
    expect(readCorpusVersion(db).version).toBe(0);
    const res = applyPatch(db, signPatch(patch(), PRIV), PUB);
    expect(res).toMatchObject({ applied: true, from: 0, to: 1, ops: 3 });

    expect(db.scalar<string>("SELECT text FROM verses WHERE verse_key='2:255'")).toBe("corrected text");
    expect(db.scalar<string>("SELECT text FROM verses WHERE verse_key='112:1'")).toBe("brand new");
    expect(db.scalar<number>("SELECT COUNT(*) FROM roots WHERE root='زقتل'")).toBe(0);
    expect(readCorpusVersion(db)).toEqual({ version: 1, schemaVersion: 1 });
  });

  it("refuses a tampered patch (sha256 / signature mismatch)", () => {
    const signed = signPatch(patch(), PRIV);
    signed.patch.ops[0]!.set = { text: "malicious" }; // change content after signing
    expect(() => applyPatch(db, signed, PUB)).toThrow(/sha256|signature/i);
    expect(db.scalar<string>("SELECT text FROM verses WHERE verse_key='2:255'")).toBe("old text");
  });

  it("refuses a patch signed by an untrusted key", () => {
    const signed = signPatch(patch(), OTHER_PRIV);
    expect(() => applyPatch(db, signed, PUB)).toThrow(/signature/i);
  });

  it("is idempotent: re-applying the same patch is a no-op", () => {
    applyPatch(db, signPatch(patch(), PRIV), PUB);
    const again = applyPatch(db, signPatch(patch(), PRIV), PUB);
    expect(again).toMatchObject({ applied: false, reason: "already-applied", from: 1 });
  });

  it("enforces order: a patch whose parent isn't the current version is refused", () => {
    applyPatch(db, signPatch(patch(), PRIV), PUB); // → v1
    const skips = patch({ id: "c3", patchVersion: 3, parent: 2 }); // needs v2, corpus at v1
    expect(() => applyPatch(db, signPatch(skips, PRIV), PUB)).toThrow(/out of order/i);
    // and the next in sequence applies cleanly
    const next = patch({ id: "c2", patchVersion: 2, parent: 1, ops: [
      { op: "upsert", table: "verses", key: { verse_key: "1:1" }, set: { text: "bismillah" } },
    ] });
    expect(applyPatch(db, signPatch(next, PRIV), PUB)).toMatchObject({ applied: true, to: 2 });
  });

  it("applies a patch atomically — a bad op rolls the whole thing back", () => {
    const bad = patch({ ops: [
      { op: "upsert", table: "verses", key: { verse_key: "2:255" }, set: { text: "half" } },
      { op: "upsert", table: "no_such_table", key: { x: "1" }, set: { y: "2" } }, // throws
    ] });
    expect(() => applyPatch(db, signPatch(bad, PRIV), PUB)).toThrow();
    expect(db.scalar<string>("SELECT text FROM verses WHERE verse_key='2:255'")).toBe("old text"); // rolled back
    expect(readCorpusVersion(db).version).toBe(0); // version not advanced
  });
});
