// A narrated walkthrough of the claim → review → establishment → dissent spine, run against
// the REAL Postgres so you can watch it happen (and inspect the rows afterwards).
//
//   npm run demo:claims -w @alsiraat/remote
//
// It creates temporary people (tagged, cleaned up at the end unless you pass --keep), because
// the majority rule needs several moderators and you are currently one person. Nothing it does
// touches your own account or any real research.

import { pool, pgRunner as r } from "./db.js";
import {
  proposeClaim, review, tallyFor, claimsFor, globalReading, dissentsFor, requiredApprovals,
} from "./claims.js";

const TAG = `demo-${Date.now()}`;
const keep = process.argv.includes("--keep");
const SUBJECT = "هُدًى";

const line = () => console.log("─".repeat(72));
const step = (n: number, s: string) => console.log(`\n${n}. ${s}`);
const show = (s: string) => console.log(`   ${s}`);

async function person(email: string, role: string): Promise<string> {
  const rows = await r.query(
    "INSERT INTO users (email, display_name, role) VALUES ($1,$2,$3) RETURNING id",
    [`${email}-${TAG}@demo.invalid`, email, role]);
  return (rows[0] as { id: string }).id;
}

console.log(`\nThe claim spine — a walkthrough on the subject  ${SUBJECT}`);
console.log(`Establishment rule: approvals ≥ ${requiredApprovals()} AND approvals > objections`);
line();

try {
  const amina = await person("Amina", "researcher");
  const bilal = await person("Bilal", "researcher");
  const m1 = await person("Moderator-1", "moderator");
  const m2 = await person("Moderator-2", "moderator");
  const m3 = await person("Moderator-3", "moderator");

  const arg = (why: string) => ({
    meaning: why, evidence: [{ verseKey: "2:2" }], argument: "from the occurrences read together",
  });

  step(1, "Amina offers her reading. A claim must carry its argument.");
  const a = await proposeClaim(r, {
    authorId: amina, subjectKind: "form", subjectValue: SUBJECT, payload: arg("guidance"),
  });
  show(`${a.claimId}@${a.version}  “guidance”`);

  step(2, "Bilal reads the same word differently. This is a SEPARATE claim — they contend,");
  show("neither overwrites the other.");
  const b = await proposeClaim(r, {
    authorId: bilal, subjectKind: "form", subjectValue: SUBJECT, payload: arg("a giving of direction"),
  });
  show(`${b.claimId}@${b.version}  “a giving of direction”`);
  show(`readings on record for ${SUBJECT}: ${(await claimsFor(r, "form", SUBJECT)).length}`);

  step(3, "A moderator objects to Amina's reading; another approves. 1 vs 1 is not a majority,");
  show("so nothing is established.");
  await review(r, { claimId: a.claimId, version: 1, moderatorId: m1, moderatorRole: "moderator", decision: "object", comment: "the evidence is thin" });
  let t = await review(r, { claimId: a.claimId, version: 1, moderatorId: m2, moderatorRole: "moderator", decision: "approve" });
  show(`approvals ${t.approvals} · objections ${t.objections} · established ${t.established}`);

  step(4, "A third moderator approves. Approvals now outnumber objections → established.");
  t = await review(r, { claimId: a.claimId, version: 1, moderatorId: m3, moderatorRole: "moderator", decision: "approve" });
  show(`approvals ${t.approvals} · objections ${t.objections} · established ${t.established}`);
  const g = await globalReading(r, "form", SUBJECT);
  show(`the group's reading: “${(g!.payload as { meaning: string }).meaning}”  (${g!.claimId}@${g!.version})`);

  step(5, "The dissenting moderator objects again, now that it IS established.");
  show("The objection is not discarded — it is FILED AS DISSENT against that version.");
  await review(r, {
    claimId: a.claimId, version: 1, moderatorId: m1, moderatorRole: "moderator",
    decision: "object", comment: "6:71 reads against this",
    payload: { comment: "6:71 reads against this", evidence: [{ verseKey: "6:71" }] },
  });
  for (const d of await dissentsFor(r, a.claimId, 1)) {
    show(`dissent ${d.id.slice(0, 16)}…  ${JSON.stringify(d.payload)}`);
  }
  show(`still the group's reading: ${(await globalReading(r, "form", SUBJECT))!.claimId === a.claimId}`);

  step(6, "Amina reconsiders. A revision is a new VERSION — the old one stays citable.");
  const a2 = await proposeClaim(r, {
    authorId: amina, subjectKind: "form", subjectValue: SUBJECT, payload: arg("guidance, as an act"),
  });
  show(`${a2.claimId}@${a2.version}  “guidance, as an act”   (v1 is still there, still cited by id@1)`);

  step(7, "Bilal's reading wins a majority. The slot moves; Amina's is NOT deleted.");
  await review(r, { claimId: b.claimId, version: 1, moderatorId: m1, moderatorRole: "moderator", decision: "approve" });
  const g2 = await globalReading(r, "form", SUBJECT);
  show(`the group's reading is now: “${(g2!.payload as { meaning: string }).meaning}”`);
  show(`readings still on record: ${(await claimsFor(r, "form", SUBJECT)).length} — nothing was destroyed`);

  line();
  console.log("\nThat is the whole point: the system records what was agreed AND what was");
  console.log("disagreed. It never forces the two into one.\n");

  if (keep) {
    console.log(`Rows kept (tagged ${TAG}). Inspect them, e.g.:`);
    console.log(`  psql -U postgres -d researchgate -c "select claim_id, version, established_at from claim_versions;"`);
    console.log(`  psql -U postgres -d researchgate -c "select claim_id, author_id, payload_json from dissents;"\n`);
  } else {
    await r.query("DELETE FROM dissents WHERE author_id IN (SELECT id FROM users WHERE email LIKE $1)", [`%${TAG}%`]);
    await r.query("DELETE FROM reviews WHERE moderator_id IN (SELECT id FROM users WHERE email LIKE $1)", [`%${TAG}%`]);
    await r.query("DELETE FROM global_forms WHERE claim_id IN (SELECT id FROM claims WHERE author_id IN (SELECT id FROM users WHERE email LIKE $1))", [`%${TAG}%`]);
    await r.query("DELETE FROM claim_versions WHERE claim_id IN (SELECT id FROM claims WHERE author_id IN (SELECT id FROM users WHERE email LIKE $1))", [`%${TAG}%`]);
    await r.query("DELETE FROM claims WHERE author_id IN (SELECT id FROM users WHERE email LIKE $1)", [`%${TAG}%`]);
    await r.query("DELETE FROM users WHERE email LIKE $1", [`%${TAG}%`]);
    console.log("Cleaned up. Pass --keep to leave the rows in place and inspect them.\n");
  }
} catch (e) {
  console.error(`\ndemo: ${(e as Error).message}`);
  console.error("If this mentions a missing column, run: npm run remote:migrate\n");
  process.exitCode = 1;
} finally {
  await pool.end();
}
