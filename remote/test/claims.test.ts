// Phase 5 — the spine. Against real Postgres (PGlite, in-process).
//
// The properties that define this system, and which no ordinary version-control model has:
//   • two researchers hold two SEPARATE claims on the same word; they contend, never overwrite
//   • revising your own reading is a new VERSION, and the old one stays citable
//   • establishment = approvals >= N AND approvals > objections — a majority OF VOTES CAST
//   • a losing objection is PRESERVED as dissent, not argued away
//   • you cannot approve your own claim; a maintainer can establish directly

import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runMigrations, type SqlRunner } from "../src/migrate.js";
import {
  proposeClaim, review, tallyFor, establishAsMaintainer, globalReading, claimsFor,
  dissentsFor, getVersion, ClaimError,
} from "../src/claims.js";

const MIGR = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

let db: PGlite;
let r: SqlRunner;
let amina: string, bilal: string, mod1: string, mod2: string, mod3: string, boss: string;

/** A claim always carries its argument — a bare assertion can't be reviewed (§12.1). */
const reading = (meaning: string) => ({
  meaning, evidence: [{ verseKey: "2:2" }], argument: "as the occurrences read together",
});

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
       ('amina@example.org','researcher'), ('bilal@example.org','researcher'),
       ('m1@example.org','moderator'), ('m2@example.org','moderator'),
       ('m3@example.org','moderator'), ('boss@example.org','maintainer')
     RETURNING id, email`,
  )) as { id: string; email: string }[];
  const by = (p: string) => rows.find((x) => x.email.startsWith(p))!.id;
  amina = by("amina"); bilal = by("bilal");
  mod1 = by("m1"); mod2 = by("m2"); mod3 = by("m3"); boss = by("boss");
});

describe("a claim is one author's reading", () => {
  it("two researchers on the same word hold separate claims", async () => {
    const a = await proposeClaim(r, { authorId: amina, subjectKind: "form", subjectValue: "هُدًى", payload: reading("guidance") });
    const b = await proposeClaim(r, { authorId: bilal, subjectKind: "form", subjectValue: "هُدًى", payload: reading("a giving of direction") });
    expect(b.claimId).not.toBe(a.claimId);          // they contend...
    expect(await claimsFor(r, "form", "هُدًى")).toHaveLength(2);  // ...neither is overwritten
  });

  it("revising your own reading is a new version; the old stays citable", async () => {
    const v1 = await proposeClaim(r, { authorId: amina, subjectKind: "form", subjectValue: "هُدًى", payload: reading("guidance") });
    const v2 = await proposeClaim(r, { authorId: amina, subjectKind: "form", subjectValue: "هُدًى", payload: reading("guidance, as an act") });
    expect(v2.claimId).toBe(v1.claimId);            // same claim
    expect(v2.version).toBe(2);
    expect((await getVersion(r, v1.claimId, 1))!.payload).toMatchObject({ meaning: "guidance" });
  });

  it("refuses a bare assertion with no argument (§12.1)", async () => {
    await expect(proposeClaim(r, {
      authorId: amina, subjectKind: "form", subjectValue: "هُدًى",
      payload: { meaning: "guidance" },
    })).rejects.toThrow(/must carry its argument/);
  });

  it("refuses a reading with no meaning", async () => {
    await expect(proposeClaim(r, {
      authorId: amina, subjectKind: "form", subjectValue: "هُدًى", payload: reading(""),
    })).rejects.toThrow(ClaimError);
  });
});

describe("establishment — majority of the votes cast", () => {
  const propose = () => proposeClaim(r, {
    authorId: amina, subjectKind: "form", subjectValue: "هُدًى", payload: reading("guidance"),
  });

  it("one approval, no objections, establishes (requiredApprovals = 1)", async () => {
    const c = await propose();
    const t = await review(r, { claimId: c.claimId, version: c.version, moderatorId: mod1, moderatorRole: "moderator", decision: "approve" });
    expect(t).toMatchObject({ approvals: 1, objections: 0, established: true });
    expect((await globalReading(r, "form", "هُدًى"))!.claimId).toBe(c.claimId);
  });

  it("does NOT establish while objections match or exceed approvals", async () => {
    const c = await propose();
    await review(r, { claimId: c.claimId, version: c.version, moderatorId: mod1, moderatorRole: "moderator", decision: "object", comment: "the evidence is thin" });
    const t = await review(r, { claimId: c.claimId, version: c.version, moderatorId: mod2, moderatorRole: "moderator", decision: "approve" });
    expect(t).toMatchObject({ approvals: 1, objections: 1, established: false }); // 1 is not > 1
    expect(await globalReading(r, "form", "هُدًى")).toBeNull();
  });

  it("establishes once approvals outnumber objections", async () => {
    const c = await propose();
    await review(r, { claimId: c.claimId, version: c.version, moderatorId: mod1, moderatorRole: "moderator", decision: "object" });
    await review(r, { claimId: c.claimId, version: c.version, moderatorId: mod2, moderatorRole: "moderator", decision: "approve" });
    const t = await review(r, { claimId: c.claimId, version: c.version, moderatorId: mod3, moderatorRole: "moderator", decision: "approve" });
    expect(t).toMatchObject({ approvals: 2, objections: 1, established: true });
  });

  it("a moderator may change their mind — verdicts replace, they don't stack", async () => {
    const c = await propose();
    await review(r, { claimId: c.claimId, version: c.version, moderatorId: mod1, moderatorRole: "moderator", decision: "object" });
    await review(r, { claimId: c.claimId, version: c.version, moderatorId: mod1, moderatorRole: "moderator", decision: "approve" });
    const t = await tallyFor(r, c.claimId, c.version);
    expect(t).toMatchObject({ approvals: 1, objections: 0, established: true });
  });

  it("you cannot approve your own claim", async () => {
    const c = await propose();
    await expect(review(r, {
      claimId: c.claimId, version: c.version, moderatorId: amina,
      moderatorRole: "moderator", decision: "approve",
    })).rejects.toThrow(/your own claim/);
  });

  it("a maintainer can establish directly, recorded as their act", async () => {
    const c = await propose();
    await establishAsMaintainer(r, { claimId: c.claimId, version: c.version, maintainerId: boss });
    expect((await globalReading(r, "form", "هُدًى"))!.claimId).toBe(c.claimId);
    const rows = await r.query("SELECT moderator_id, comment FROM reviews WHERE claim_id = $1", [c.claimId]);
    expect(rows[0]!.moderator_id).toBe(boss);
    expect(String(rows[0]!.comment)).toMatch(/maintainer/);
  });
});

describe("disagreement is preserved, not resolved", () => {
  it("an objection to an established reading becomes a dissent carrying its own payload", async () => {
    const c = await proposeClaim(r, { authorId: amina, subjectKind: "form", subjectValue: "هُدًى", payload: reading("guidance") });
    await review(r, { claimId: c.claimId, version: c.version, moderatorId: mod1, moderatorRole: "moderator", decision: "approve" });

    await review(r, {
      claimId: c.claimId, version: c.version, moderatorId: mod2, moderatorRole: "moderator",
      decision: "object", comment: "6:71 reads against this",
      payload: { comment: "6:71 reads against this", evidence: [{ verseKey: "6:71" }] },
    });

    const d = await dissentsFor(r, c.claimId, c.version);
    expect(d).toHaveLength(1);
    expect(d[0]!.authorId).toBe(mod2);
    expect(d[0]!.payload).toMatchObject({ evidence: [{ verseKey: "6:71" }] }); // stands alone (§12.4)

    // and the reading it objects to is still the group's — the objection didn't undo it
    expect((await globalReading(r, "form", "هُدًى"))!.claimId).toBe(c.claimId);
  });

  it("a superseded reading survives: the previous claim stays citable at its own id@v", async () => {
    const a = await proposeClaim(r, { authorId: amina, subjectKind: "form", subjectValue: "هُدًى", payload: reading("guidance") });
    await review(r, { claimId: a.claimId, version: a.version, moderatorId: mod1, moderatorRole: "moderator", decision: "approve" });

    const b = await proposeClaim(r, { authorId: bilal, subjectKind: "form", subjectValue: "هُدًى", payload: reading("a giving of direction") });
    await review(r, { claimId: b.claimId, version: b.version, moderatorId: mod2, moderatorRole: "moderator", decision: "approve" });

    // the slot moved to bilal's reading...
    expect((await globalReading(r, "form", "هُدًى"))!.claimId).toBe(b.claimId);
    // ...and amina's is still there, still marked as having been established
    const amina1 = await getVersion(r, a.claimId, 1);
    expect(amina1).not.toBeNull();
    expect(amina1!.establishedAt).not.toBeNull();
  });

  it("exactly one global reading per subject", async () => {
    const a = await proposeClaim(r, { authorId: amina, subjectKind: "form", subjectValue: "هُدًى", payload: reading("guidance") });
    await review(r, { claimId: a.claimId, version: a.version, moderatorId: mod1, moderatorRole: "moderator", decision: "approve" });
    const b = await proposeClaim(r, { authorId: bilal, subjectKind: "form", subjectValue: "هُدًى", payload: reading("direction") });
    await review(r, { claimId: b.claimId, version: b.version, moderatorId: mod2, moderatorRole: "moderator", decision: "approve" });

    const rows = await r.query("SELECT COUNT(*)::int AS n FROM global_forms WHERE subject_value = $1", ["هُدًى"]);
    expect(Number(rows[0]!.n)).toBe(1);
  });
});
