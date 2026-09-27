// ⚖ Divergence, computed live against the remote — the monetized replacement for the old local
// `derived_global_forms` mirror. It must: report only forms where mine ≠ the group's; count the
// overlap; ignore forms the group hasn't settled; and never invent a divergence from a form I
// didn't send. Against real Postgres (PGlite, in-process).

import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runMigrations, type SqlRunner } from "../src/migrate.js";
import {
  proposeClaim, establishAsMaintainer, divergencesAgainstGlobal, communityReadingsFor,
} from "../src/claims.js";

const MIGR = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");
const reading = (meaning: string) => ({ meaning, argument: "as the occurrences read together" });

let db: PGlite;
let r: SqlRunner;
let amina: string, boss: string;

/** Establish `meaning` as the GROUP's reading of a form (an author proposes, the maintainer establishes). */
async function establishGroupForm(subjectValue: string, meaning: string) {
  const v = await proposeClaim(r, { authorId: amina, subjectKind: "form", subjectValue, payload: reading(meaning) });
  await establishAsMaintainer(r, { claimId: v.claimId, version: v.version, maintainerId: boss });
}

beforeAll(async () => {
  db = new PGlite();
  r = {
    exec: (sql) => db.exec(sql).then(() => undefined),
    query: async (sql, params = []) => (await db.query(sql, params as unknown[])).rows as Record<string, unknown>[],
  };
  await runMigrations(r, MIGR);
});

beforeEach(async () => {
  await db.exec(`DELETE FROM dissents; DELETE FROM reviews; DELETE FROM global_forms;
                 DELETE FROM claim_versions; DELETE FROM claims; DELETE FROM users;`);
  const rows = (await r.query(
    `INSERT INTO users (email, role) VALUES
       ('amina@example.org','researcher'), ('boss@example.org','maintainer')
     RETURNING id, email`,
  )) as { id: string; email: string }[];
  amina = rows.find((x) => x.email.startsWith("amina"))!.id;
  boss = rows.find((x) => x.email.startsWith("boss"))!.id;
});

describe("divergencesAgainstGlobal", () => {
  it("reports a form where my reading differs from the group's", async () => {
    await establishGroupForm("هُدًى", "a giving of direction");
    const out = await divergencesAgainstGlobal(r, [{ subjectValue: "هُدًى", meaning: "guidance" }]);
    expect(out.divergences).toHaveLength(1);
    expect(out.divergences[0]).toMatchObject({ subjectValue: "هُدًى", mine: "guidance", theirs: "a giving of direction" });
    expect(out.overlap).toBe(1);
    expect(out.globalTotal).toBe(1);
  });

  it("agreement is not a divergence, but still counts as overlap", async () => {
    await establishGroupForm("هُدًى", "guidance");
    const out = await divergencesAgainstGlobal(r, [{ subjectValue: "هُدًى", meaning: "guidance" }]);
    expect(out.divergences).toHaveLength(0);
    expect(out.overlap).toBe(1);
  });

  it("a form the group hasn't settled is neither overlap nor divergence", async () => {
    const out = await divergencesAgainstGlobal(r, [{ subjectValue: "نُور", meaning: "light" }]);
    expect(out.divergences).toHaveLength(0);
    expect(out.overlap).toBe(0);
    expect(out.globalTotal).toBe(0);
  });

  it("only forms I sent are considered — the group's other readings don't leak in", async () => {
    await establishGroupForm("هُدًى", "a giving of direction");
    await establishGroupForm("نُور", "radiance");
    const out = await divergencesAgainstGlobal(r, [{ subjectValue: "هُدًى", meaning: "guidance" }]);
    expect(out.divergences.map((d) => d.subjectValue)).toEqual(["هُدًى"]);
    expect(out.globalTotal).toBe(2); // the count is honest, but نُور is not returned
  });

  it("whitespace-only or empty subjects are skipped", async () => {
    await establishGroupForm("هُدًى", "a giving of direction");
    const out = await divergencesAgainstGlobal(r, [
      { subjectValue: "  ", meaning: "x" },
      { subjectValue: "هُدًى", meaning: "guidance" },
    ]);
    expect(out.divergences).toHaveLength(1);
  });
});

describe("communityReadingsFor", () => {
  it("returns the group's form reading, marked established", async () => {
    await establishGroupForm("هُدًى", "a giving of direction");
    const out = await communityReadingsFor(r, { lemma: "هُدًى", root: null });
    expect(out.communityLemma).toHaveLength(1);
    expect(out.communityLemma[0]).toMatchObject({
      lemma: "هُدًى", scope: "lemma", meaning: "a giving of direction", status: "established",
    });
    expect(out.communityLemma[0]!.id).toMatch(/^peer:clm_/);
    expect(out.communityRoot).toEqual([]);
  });

  it("an un-established reading shows as proposed", async () => {
    await proposeClaim(r, { authorId: amina, subjectKind: "form", subjectValue: "نُور", payload: reading("light") });
    const out = await communityReadingsFor(r, { lemma: "نُور" });
    expect(out.communityLemma).toHaveLength(1);
    expect(out.communityLemma[0]!.status).toBe("proposed");
  });

  it("establishing then revising leaves v1 established (global still points at it) and v2 proposed; established sorts first", async () => {
    const v1 = await proposeClaim(r, { authorId: amina, subjectKind: "root", subjectValue: "ه د ي", payload: reading("first reading") });
    await establishAsMaintainer(r, { claimId: v1.claimId, version: v1.version, maintainerId: boss });
    await proposeClaim(r, { authorId: amina, subjectKind: "root", subjectValue: "ه د ي", payload: reading("a revised reading") });
    const out = await communityReadingsFor(r, { root: "ه د ي" });
    expect(out.communityRoot.map((p) => p.status)).toEqual(["established", "proposed"]);
    expect(out.communityRoot[0]!.meaning).toBe("first reading"); // the established v1 sorts first
  });

  it("a non-established earlier version is marked superseded once a later one exists", async () => {
    await proposeClaim(r, { authorId: amina, subjectKind: "form", subjectValue: "صِرَٰط", payload: reading("a path") });
    await proposeClaim(r, { authorId: amina, subjectKind: "form", subjectValue: "صِرَٰط", payload: reading("the way") });
    const out = await communityReadingsFor(r, { lemma: "صِرَٰط" });
    // neither established; the current version is proposed, the earlier one superseded
    expect(out.communityLemma.map((p) => p.status).sort()).toEqual(["proposed", "superseded"]);
  });

  it("empty for a word the community hasn't touched", async () => {
    const out = await communityReadingsFor(r, { root: "ك ت ب", lemma: "كِتَاب" });
    expect(out).toEqual({ communityRoot: [], communityLemma: [] });
  });
});
