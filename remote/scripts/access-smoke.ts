// End-to-end smoke of corpus access through the REAL remote app (createApp, real Postgres, real
// corpus): the default gate, flipping to public, locking a translation — then it restores the
// settings it found. Run: npx tsx remote/scripts/access-smoke.ts
import { createApp } from "../src/app.js";
import { pool, pgRunner } from "../src/db.js";
import { getCorpusPolicy, setCorpusPolicy, getTranslationAccess, setTranslationAccess } from "../src/corpus-access.js";

const app = createApp();
const get = async (path: string) => {
  const res = await app.request(path);
  return { status: res.status, body: await res.json() as Record<string, unknown> & unknown[] };
};

const before = await getCorpusPolicy(pgRunner);
const lockedBefore = await getTranslationAccess(pgRunner);
try {
  console.log("policy now:", JSON.stringify((await get("/corpus-access")).body));

  const gated = await get("/corpus/verses/1:1");
  console.log(`anonymous, default policy → ${gated.status} ${JSON.stringify(gated.body)}`);

  await setCorpusPolicy(pgRunner, { access: "public" });
  const open = await get("/corpus/verses/1:1?translations=true");
  const trs = open.body.translations as { resource_id: number }[];
  console.log(`anonymous, public        → ${open.status}  ${open.body.text}  (${trs.length} translations)`);

  const id = trs[0]!.resource_id;
  await setTranslationAccess(pgRunner, id, "pro");
  const locked = await get("/corpus/verses/1:1?translations=true");
  const n = (locked.body.translations as unknown[]).length;
  console.log(`translation ${id} locked to pro → anonymous now sees ${n} (was ${trs.length})`);
  console.log("public policy says:", JSON.stringify((await get("/corpus-access")).body));
} finally {
  // put back exactly what we found
  for (const [rid] of await getTranslationAccess(pgRunner)) if (!lockedBefore.has(rid)) await setTranslationAccess(pgRunner, rid, null);
  await setCorpusPolicy(pgRunner, before);
  console.log("restored:", JSON.stringify(await getCorpusPolicy(pgRunner)));
  await pool.end();
}
