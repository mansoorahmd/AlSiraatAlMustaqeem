// The outbound half of sync, against real Postgres (PGlite, in-process).
//
// pullSince had no test of its own until community indications were added — applyPull on the
// client was covered, but the query that feeds it was not. The properties that matter:
//   • EVERY reading is sent, not only the established one (that is the whole point of showing
//     the community's indications: a losing claim is still someone's argued reading)
//   • `status` is derived per pull, so a claim that gains or loses the global slot corrects
//     itself on the next walk without rewriting history upstream
//   • the cursor advances past everything returned, and errs toward re-delivery over skipping

import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runMigrations, type SqlRunner } from "../src/migrate.js";
import { proposeClaim, review, establishAsMaintainer } from "../src/claims.js";
import { pullSince, ZERO_CURSORS } from "../src/pull.js";

const MIGR = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");
const SUBJECT = "هُدًى";

let db: PGlite;
let r: SqlRunner;
let amina: string, bilal: string, mod: string;

const arg = (meaning: string) => ({ meaning, argument: "read together", evidence: [{ verseKey: "2:2" }] });

async function person(name: string, role = "researcher"): Promise<string> {
  const rows = await r.query(
    "INSERT INTO users (email, display_name, role) VALUES ($1,$2,$3) RETURNING id",
    [`${name}@t.invalid`, name, role]);
  return (rows[0] as { id: string }).id;
}

beforeAll(async () => {
  db = new PGlite();
  r = {
    exec: (sql) => db.exec(sql).then(() => undefined),
    query: async (sql, params = []) =>
      (await db.query(sql, params as unknown[])).rows as Record<string, unknown>[],
  };
  await runMigrations(r, MIGR);
});

beforeEach(async () => {
  await db.exec(`DELETE FROM dissents; DELETE FROM reviews; DELETE FROM global_forms;
                 DELETE FROM claim_versions; DELETE FROM claims; DELETE FROM users;`);
  amina = await person("amina");
  bilal = await person("bilal");
  mod = await person("mod", "moderator");
});

const peers = (p: { peerIndications: unknown[] }) =>
  p.peerIndications as { claimId: string; version: number; status: string; meaning: string; subjectKind: string }[];

describe("what a pull carries", () => {
  it("sends every reading, not only the established one", async () => {
    await proposeClaim(r, { authorId: amina, subjectKind: "form", subjectValue: SUBJECT, payload: arg("guidance") });
    await proposeClaim(r, { authorId: bilal, subjectKind: "form", subjectValue: SUBJECT, payload: arg("a giving of direction") });

    const page = await pullSince(r, ZERO_CURSORS);
    expect(peers(page)).toHaveLength(2);
    // nothing has been established, so the group holds no reading yet
    expect(page.globalForms).toHaveLength(0);
  });

  it("marks the established one, and only it", async () => {
    const a = await proposeClaim(r, { authorId: amina, subjectKind: "form", subjectValue: SUBJECT, payload: arg("guidance") });
    await proposeClaim(r, { authorId: bilal, subjectKind: "form", subjectValue: SUBJECT, payload: arg("direction") });
    await review(r, { claimId: a.claimId, version: 1, moderatorId: mod, moderatorRole: "moderator", decision: "approve" });

    const byStatus = Object.fromEntries(peers(await pullSince(r, ZERO_CURSORS)).map((p) => [p.meaning, p.status]));
    expect(byStatus["guidance"]).toBe("established");
    expect(byStatus["direction"]).toBe("proposed");
  });

  it("a reading that LOSES the slot stops calling itself established on the next pull", async () => {
    const a = await proposeClaim(r, { authorId: amina, subjectKind: "form", subjectValue: SUBJECT, payload: arg("guidance") });
    const b = await proposeClaim(r, { authorId: bilal, subjectKind: "form", subjectValue: SUBJECT, payload: arg("direction") });
    await review(r, { claimId: a.claimId, version: 1, moderatorId: mod, moderatorRole: "moderator", decision: "approve" });
    expect(peers(await pullSince(r, ZERO_CURSORS)).find((p) => p.meaning === "guidance")!.status).toBe("established");

    // the slot moves to Bilal
    await establishAsMaintainer(r, { claimId: b.claimId, version: 1, maintainerId: mod });

    const after = Object.fromEntries(peers(await pullSince(r, ZERO_CURSORS)).map((p) => [p.meaning, p.status]));
    expect(after["direction"]).toBe("established");
    expect(after["guidance"]).toBe("proposed");   // corrected, not left stale
  });

  it("an author's earlier version is marked superseded, and still sent", async () => {
    await proposeClaim(r, { authorId: amina, subjectKind: "form", subjectValue: SUBJECT, payload: arg("guidance") });
    await proposeClaim(r, { authorId: amina, subjectKind: "form", subjectValue: SUBJECT, payload: arg("guidance, as an act") });

    const all = peers(await pullSince(r, ZERO_CURSORS));
    expect(all).toHaveLength(2);                                  // v1 is NOT dropped
    expect(all.find((p) => p.version === 1)!.status).toBe("superseded");
    expect(all.find((p) => p.version === 2)!.status).toBe("proposed");
  });

  it("carries who submitted a reading, and who approved it", async () => {
    const a = await proposeClaim(r, { authorId: amina, subjectKind: "form", subjectValue: SUBJECT, payload: arg("guidance") });
    await review(r, { claimId: a.claimId, version: 1, moderatorId: mod, moderatorRole: "moderator", decision: "approve" });

    const found = peers(await pullSince(r, ZERO_CURSORS)).find((x) => x.meaning === "guidance");
    const p = found as unknown as { authorName: string; approvers: string[] };
    // person() sets display_name = the name passed in
    expect(p.authorName).toBe("amina");
    expect(p.approvers).toEqual(["mod"]);
  });

  it("a proposed reading has no approvers", async () => {
    await proposeClaim(r, { authorId: amina, subjectKind: "form", subjectValue: SUBJECT, payload: arg("guidance") });
    const p = peers(await pullSince(r, ZERO_CURSORS))[0] as unknown as { approvers: string[] };
    expect(p.approvers).toEqual([]);
  });

  it("carries root readings as well as form readings", async () => {
    await proposeClaim(r, { authorId: amina, subjectKind: "root", subjectValue: "هدي", payload: arg("to direct") });
    await proposeClaim(r, { authorId: bilal, subjectKind: "form", subjectValue: SUBJECT, payload: arg("guidance") });

    const kinds = peers(await pullSince(r, ZERO_CURSORS)).map((p) => p.subjectKind).sort();
    expect(kinds).toEqual(["form", "root"]);
  });
});

describe("the cursor", () => {
  it("advances past the peer stream, so a second pull is empty", async () => {
    await proposeClaim(r, { authorId: amina, subjectKind: "form", subjectValue: SUBJECT, payload: arg("guidance") });

    const first = await pullSince(r, ZERO_CURSORS);
    expect(peers(first)).toHaveLength(1);
    expect(first.cursors.peerIndications).toBeGreaterThan(0);

    const second = await pullSince(r, first.cursors);
    expect(peers(second)).toHaveLength(0);
    expect(second.cursors).toEqual(first.cursors);      // idle pull doesn't move it
  });

  it("all-zero is a full resync and returns everything again", async () => {
    await proposeClaim(r, { authorId: amina, subjectKind: "form", subjectValue: SUBJECT, payload: arg("guidance") });
    const first = await pullSince(r, ZERO_CURSORS);
    await pullSince(r, first.cursors);
    expect(peers(await pullSince(r, ZERO_CURSORS))).toHaveLength(1);
  });

  it("reports `more` when a page is full, so the client keeps walking", async () => {
    for (let i = 0; i < 3; i++) {
      const u = await person(`p${i}`);
      await proposeClaim(r, { authorId: u, subjectKind: "form", subjectValue: SUBJECT, payload: arg(`reading ${i}`) });
    }
    const page = await pullSince(r, ZERO_CURSORS, 2);
    expect(peers(page)).toHaveLength(2);
    expect(page.more).toBe(true);

    const rest = await pullSince(r, page.cursors, 2);
    expect(peers(rest)).toHaveLength(1);
    expect(rest.more).toBe(false);
  });

  it("carries a stable createdAt, so re-pulling never rewrites the date", async () => {
    await proposeClaim(r, { authorId: amina, subjectKind: "form", subjectValue: SUBJECT, payload: arg("guidance") });
    const a = peers(await pullSince(r, ZERO_CURSORS))[0] as unknown as { createdAt: string };
    const b = peers(await pullSince(r, ZERO_CURSORS))[0] as unknown as { createdAt: string };
    expect(a.createdAt).toBe(b.createdAt);
  });

  /**
   * THE BUG THIS FILE EXISTS FOR.
   *
   * Every table's `seq` is a `bigserial`, and each bigserial is an INDEPENDENT sequence. An
   * earlier version shared one cursor across all three streams by taking the max, which reads
   * as conservative but is the opposite: once one stream's counter ran ahead, rows in the
   * others whose seq fell below it were never delivered. Nothing errored — they just never
   * arrived, which is the worst failure mode a sync protocol can have.
   */
  it("one stream running ahead never skips rows in another", async () => {
    // drive claim_versions' sequence well past the others
    for (let i = 0; i < 6; i++) {
      const u = await person(`filler${i}`);
      await proposeClaim(r, { authorId: u, subjectKind: "form", subjectValue: `w${i}`, payload: arg(`r${i}`) });
    }
    // now the FIRST established reading — global_forms.seq is 1, far below peerIndications' 6
    const a = await proposeClaim(r, { authorId: amina, subjectKind: "form", subjectValue: SUBJECT, payload: arg("guidance") });
    await review(r, { claimId: a.claimId, version: 1, moderatorId: mod, moderatorRole: "moderator", decision: "approve" });

    const page = await pullSince(r, ZERO_CURSORS);
    expect(page.cursors.peerIndications).toBeGreaterThan(page.cursors.globalForms);
    expect(page.globalForms).toHaveLength(1);

    // a client that had already walked the peer stream must still receive the established
    // reading — under the shared cursor it never would have
    const behind = { ...ZERO_CURSORS, peerIndications: page.cursors.peerIndications };
    const second = await pullSince(r, behind);
    expect(second.globalForms).toHaveLength(1);
    expect(peers(second)).toHaveLength(0);
  });

  it("each stream advances only past its own rows", async () => {
    await proposeClaim(r, { authorId: amina, subjectKind: "form", subjectValue: SUBJECT, payload: arg("guidance") });
    const page = await pullSince(r, ZERO_CURSORS);
    // nothing established and nothing dissented, so those two stay where they were
    expect(page.cursors.globalForms).toBe(0);
    expect(page.cursors.dissents).toBe(0);
    expect(page.cursors.peerIndications).toBeGreaterThan(0);
  });
});
