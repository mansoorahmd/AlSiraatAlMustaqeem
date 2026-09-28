// Step 1 of moving the corpus to Postgres: load quran.db into the `corpus` schema and PROVE the
// copy is exact. Against real Postgres (PGlite, in-process), with a fixture SQLite file built from
// quran.db's actual DDL (test/fixtures/corpus-fixture.ts).
//
// What must hold:
//   • every table, the view, FKs and indexes arrive, and the verifier calls it exact
//   • re-running rebuilds to the same state (no duplicated rows)
//   • a single changed Arabic character is caught — counts alone would miss it
//   • a failed load ROLLS BACK and leaves the previous corpus intact (atomic)
//   • a non-UTF8 database is refused before anything is touched

import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import type { SqlRunner } from "../src/migrate.js";
import { migrateCorpus, assertUtf8, CorpusMigrationError } from "../src/corpus/load.js";
import { verifyCorpus } from "../src/corpus/verify.js";
import { makeFixture, pgliteRunner, BISMILLAH } from "./fixtures/corpus-fixture.js";

let r: SqlRunner;
let source: string;

beforeAll(() => {
  r = pgliteRunner().r;
  source = makeFixture("good.db");
});

beforeEach(async () => { await r.exec("DROP SCHEMA IF EXISTS corpus CASCADE"); });

describe("migrating quran.db into Postgres", () => {
  it("copies every table and the view, and the verifier calls it exact", async () => {
    const res = await migrateCorpus({ sqlitePath: source, runner: r });
    expect(res.tables.find((t) => t.name === "word_segments")?.rows).toBe(2);
    expect(res.totalRows).toBe(21);

    const rep = await verifyCorpus({ sqlitePath: source, runner: r });
    expect(rep.problems).toEqual([]);
    expect(rep.ok).toBe(true);
    expect(rep.tables.every((t) => t.columnsMatch && t.contentMatch)).toBe(true);
    expect(rep.view).toEqual({ sqliteRows: 1, pgRows: 1, contentMatch: true });   // only the STEM
    expect(rep.foreignKeys).toEqual({ expected: 9, found: 9 });
    expect(rep.indexes).toEqual({ expected: 29, found: 29 });
    expect(rep.arabicProbe).toMatchObject({ verseKey: "1:1", pg: BISMILLAH, equal: true });
    expect(rep.source.matches).toBe(true);
  });

  it("keeps Arabic, NULLs and BLOBs byte-exact", async () => {
    await migrateCorpus({ sqlitePath: source, runner: r });
    const [v] = await r.query("SELECT text_uthmani FROM corpus.verses WHERE verse_key = '1:1'");
    expect(v!.text_uthmani).toBe(BISMILLAH);
    const [m] = await r.query(`SELECT "value" FROM corpus._meta WHERE "key" = 'data_dir'`);
    expect(m!.value).toBeNull();
    const [e] = await r.query("SELECT embedding FROM corpus.verse_embeddings WHERE verse_id = 1");
    expect([...(e!.embedding as Uint8Array)]).toEqual([1, 2, 255, 0]);
  });

  it("is repeatable — a second run rebuilds to the same verified state, no duplicate rows", async () => {
    await migrateCorpus({ sqlitePath: source, runner: r });
    await migrateCorpus({ sqlitePath: source, runner: r });
    const [n] = await r.query("SELECT COUNT(*)::int AS n FROM corpus.verses");
    expect(n!.n).toBe(2);
    expect((await verifyCorpus({ sqlitePath: source, runner: r })).ok).toBe(true);
  });

  it("records the edition and where the copy came from", async () => {
    const res = await migrateCorpus({ sqlitePath: source, runner: r });
    const meta = Object.fromEntries((await r.query(`SELECT "key", "value" FROM corpus.corpus_meta`))
      .map((x) => [x.key, x.value]));
    expect(meta).toMatchObject({ corpus_version: "0", schema_version: "0", source_sha256: res.sourceSha256 });
  });

  it("advances identity sequences past the copied ids, so a later insert can't collide", async () => {
    await migrateCorpus({ sqlitePath: source, runner: r });
    const [row] = await r.query(
      `INSERT INTO corpus.roots (root_buckwalter, root_arabic) VALUES ('ktb', 'كتب') RETURNING id`);
    expect(row!.id).toBe(3);
  });

  it("gives the full-text index something to answer (English translations)", async () => {
    await migrateCorpus({ sqlitePath: source, runner: r });
    const rows = await r.query(
      `SELECT verse_key FROM corpus.verse_translations
        WHERE to_tsvector('simple', coalesce("text", '')) @@ plainto_tsquery('simple', 'praise')`);
    expect(rows.map((x) => x.verse_key)).toEqual(["1:2"]);
  });
});

describe("the verifier is not fooled", () => {
  it("catches a single changed Arabic character that row counts would miss", async () => {
    await migrateCorpus({ sqlitePath: source, runner: r });
    // strip the shadda (U+0651) from 1:1 — same row count, different text. By code point, not a
    // typed literal: the order combining marks were typed in would otherwise decide whether it matched.
    await r.query(`UPDATE corpus.verses SET text_uthmani = replace(text_uthmani, chr(1617), '') WHERE verse_key = '1:1'`);
    const rep = await verifyCorpus({ sqlitePath: source, runner: r });
    expect(rep.ok).toBe(false);
    const verses = rep.tables.find((t) => t.name === "verses")!;
    expect(verses.sqliteRows).toBe(verses.pgRows);                 // counts still agree…
    expect(verses.contentMatch).toBe(false);                       // …but the content doesn't
    expect(rep.arabicProbe.equal).toBe(false);
  });

  it("catches a missing row", async () => {
    await migrateCorpus({ sqlitePath: source, runner: r });
    await r.query(`DELETE FROM corpus.verse_translations WHERE id = 2`);
    const rep = await verifyCorpus({ sqlitePath: source, runner: r });
    expect(rep.problems.some((p) => p.includes("verse_translations: row count differs"))).toBe(true);
  });
});

describe("safety", () => {
  it("a failed load rolls back and leaves the previous corpus intact", async () => {
    await migrateCorpus({ sqlitePath: source, runner: r });
    const broken = makeFixture("broken.db", { breakChapters: true });
    await expect(migrateCorpus({ sqlitePath: broken, runner: r })).rejects.toThrow();
    // the good copy from the first run is still there, whole
    const rep = await verifyCorpus({ sqlitePath: source, runner: r });
    expect(rep.ok).toBe(true);
  });

  it("a source missing a table is refused before anything is touched", async () => {
    await migrateCorpus({ sqlitePath: source, runner: r });
    const partial = makeFixture("partial.db", { dropWords: true });
    await expect(migrateCorpus({ sqlitePath: partial, runner: r })).rejects.toThrow(/no table "words"/);
    expect((await verifyCorpus({ sqlitePath: source, runner: r })).ok).toBe(true);
  });

  it("refuses a database that isn't UTF8", async () => {
    const fake: SqlRunner = { exec: async () => {}, query: async () => [{ server_encoding: "WIN1252" }] };
    await expect(assertUtf8(fake)).rejects.toBeInstanceOf(CorpusMigrationError);
    await expect(assertUtf8(fake)).rejects.toThrow(/WIN1252, not UTF8/);
  });
});
