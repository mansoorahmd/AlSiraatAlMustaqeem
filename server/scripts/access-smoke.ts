// End-to-end smoke of resource access through the REAL remote app (createApp, real Postgres, real
// corpus): the corpus gate, making it public, locking one translation — then it restores every
// rule it found. Run: npx tsx server/scripts/access-smoke.ts
import { createApp } from "../src/app.js";
import { pool, pgRunner } from "../src/db.js";
import { listRules, setRule, removeRule } from "../src/resource-access.js";

const app = createApp();
const get = async (path: string) => {
  const res = await app.request(path);
  return { status: res.status, body: await res.json() as Record<string, unknown> & unknown[] };
};

const before = await listRules(pgRunner);
try {
  console.log("rules now:", JSON.stringify(before));

  const gated = await get("/corpus/verses/1:1");
  console.log(`anonymous, corpus at its rule → ${gated.status} ${JSON.stringify(gated.body)}`);

  await setRule(pgRunner, "corpus", "*", null);
  const open = await get("/corpus/verses/1:1?translations=true");
  const trs = open.body.translations as { resource_id: number }[];
  console.log(`anonymous, corpus public     → ${open.status}  ${open.body.text}  (${trs.length} translations)`);

  const id = String(trs[0]!.resource_id);
  await setRule(pgRunner, "translation", id, "pro");
  const locked = await get("/corpus/verses/1:1?translations=true");
  console.log(`translation ${id} needs pro → anonymous sees ${(locked.body.translations as unknown[]).length} (was ${trs.length})`);

  const community = await get("/claims?subjectKind=form&subjectValue=x");
  console.log(`anonymous reading community claims → ${community.status} (the community resource's own rule)`);
} finally {
  // put back exactly what we found
  for (const rule of await listRules(pgRunner)) {
    if (!before.some((b) => b.kind === rule.kind && b.key === rule.key)) await removeRule(pgRunner, rule.kind, rule.key);
  }
  for (const b of before) await setRule(pgRunner, b.kind, b.key, b.minPlan);
  console.log("restored:", JSON.stringify(await listRules(pgRunner)));
  await pool.end();
}
