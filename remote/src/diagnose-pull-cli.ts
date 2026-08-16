// What would a client actually receive right now?
//
//   npm run remote:diagnose
//
// Answers, against YOUR Postgres, the only question that matters when the app shows nothing:
// is there anything to send, and does the pull send it? Everything here is read-only.

import { pool, pgRunner as r } from "./db.js";
import { pullSince, ZERO_CURSORS } from "./pull.js";

const line = () => console.log("─".repeat(72));
const count = async (sql: string): Promise<number> =>
  Number((((await r.query(sql))[0] ?? {}) as { n?: number | string }).n ?? 0);

try {
  console.log("\nWhat the research server holds");
  line();

  // 0004 adds claim_versions.created_at; without it the pull query fails outright
  const hasCreatedAt = await count(
    `SELECT COUNT(*) AS n FROM information_schema.columns
      WHERE table_name = 'claim_versions' AND column_name = 'created_at'`);
  if (!hasCreatedAt) {
    console.log("\n  ✗ claim_versions.created_at is MISSING — migration 0004 has not run.");
    console.log("    The pull cannot work until it does:  npm run remote:migrate\n");
    process.exitCode = 1;
  }

  const rows = {
    users: await count("SELECT COUNT(*) AS n FROM users"),
    claims: await count("SELECT COUNT(*) AS n FROM claims"),
    claimVersions: await count("SELECT COUNT(*) AS n FROM claim_versions"),
    established: await count("SELECT COUNT(*) AS n FROM global_forms"),
    dissents: await count("SELECT COUNT(*) AS n FROM dissents"),
  };
  for (const [k, v] of Object.entries(rows)) console.log(`  ${k.padEnd(16)} ${v}`);

  if (rows.claimVersions === 0) {
    console.log("\n  Nothing has been proposed, so a client would correctly receive nothing.");
    console.log("  Create something to pull:  npm run remote:demo:keep\n");
  }

  if (hasCreatedAt) {
    line();
    console.log("\nA full pull (all cursors at zero) would send:\n");
    const page = await pullSince(r, ZERO_CURSORS);
    console.log(`  established readings   ${page.globalForms.length}`);
    console.log(`  community indications  ${page.peerIndications.length}`);
    console.log(`  dissents               ${page.dissents.length}`);
    console.log(`  cursors after          ${JSON.stringify(page.cursors)}`);

    for (const p of page.peerIndications as {
      subjectKind: string; subjectValue: string; status: string; meaning: string;
    }[]) {
      console.log(`    · ${p.subjectKind} ${p.subjectValue}  [${p.status}]  “${p.meaning}”`);
    }

    line();
    console.log("\nIf these numbers are non-zero and the app still shows nothing, the remote is");
    console.log("fine and the problem is client-side: check that the app is signed in, and that");
    console.log("the ⚖ screen's Sync reports the same counts.\n");
  }
} catch (e) {
  console.error(`\ndiagnose: ${(e as Error).message}`);
  console.error("If this mentions a missing column, run: npm run remote:migrate\n");
  process.exitCode = 1;
} finally {
  await pool.end();
}
