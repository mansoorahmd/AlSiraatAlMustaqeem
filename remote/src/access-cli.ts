// The maintainer's access console — plan tiers, the corpus policy, and per-translation locks.
// Out of band, like set-plan; the same changes are available over HTTP to a maintainer.
//
//   npm run access -w @alsiraat/remote -- show
//
//   npm run access -w @alsiraat/remote -- tier scholar 200 "Scholar"   # add / change a tier
//   npm run access -w @alsiraat/remote -- tier-remove student          # remove an unused tier
//
//   npm run access -w @alsiraat/remote -- corpus public                # anyone may read
//   npm run access -w @alsiraat/remote -- corpus signed_in             # any signed-in account
//   npm run access -w @alsiraat/remote -- corpus plan scholar          # scholar tier or higher
//
//   npm run access -w @alsiraat/remote -- translation 131 scholar      # lock translation 131
//   npm run access -w @alsiraat/remote -- translation 131 none         # unlock it

import { pool, pgRunner as r } from "./db.js";
import { loadTiers, setTier, removeTier } from "./plans.js";
import {
  getCorpusPolicy, setCorpusPolicy, getTranslationAccess, setTranslationAccess, isCorpusAccess,
  CORPUS_ACCESS,
} from "./corpus-access.js";

const [cmd, a, b, c] = process.argv.slice(2);

async function show(): Promise<void> {
  const tiers = [...(await loadTiers(r)).values()];
  console.log("plan tiers (lowest first):");
  for (const t of tiers) console.log(`  ${String(t.rank).padStart(5)}  ${t.name.padEnd(16)} ${t.label}`);
  const p = await getCorpusPolicy(r);
  console.log(`\ncorpus access: ${p.access}${p.access === "plan" ? ` (${p.minPlan} or higher)` : ""}`);
  const locked = [...(await getTranslationAccess(r))].sort((x, y) => x[0] - y[0]);
  console.log(locked.length
    ? `locked translations:\n${locked.map(([id, t]) => `  ${String(id).padStart(5)}  needs ${t}`).join("\n")}`
    : "locked translations: none");
}

try {
  switch (cmd) {
    case "show":
    case undefined:
      await show();
      break;
    case "tier": {
      if (!a || b == null) throw new Error('usage: access tier <name> <rank> ["label"]');
      const t = await setTier(r, { name: a, rank: Number(b), label: c });
      console.log(`✔ tier ${t.name} at rank ${t.rank}${t.label ? ` ("${t.label}")` : ""}`);
      break;
    }
    case "tier-remove":
      if (!a) throw new Error("usage: access tier-remove <name>");
      await removeTier(r, a);
      console.log(`✔ removed tier ${a}`);
      break;
    case "corpus": {
      if (!isCorpusAccess(a)) throw new Error(`usage: access corpus <${CORPUS_ACCESS.join("|")}> [min-tier]`);
      const p = await setCorpusPolicy(r, { access: a, minPlan: b });
      console.log(`✔ corpus access: ${p.access}${p.access === "plan" ? ` (${p.minPlan} or higher)` : ""}`);
      break;
    }
    case "translation": {
      const id = Number(a);
      if (!a || !b) throw new Error("usage: access translation <resource-id> <tier|none>");
      await setTranslationAccess(r, id, b === "none" ? null : b);
      console.log(b === "none" ? `✔ translation ${id} unlocked` : `✔ translation ${id} needs ${b} or higher`);
      break;
    }
    default:
      throw new Error(`unknown command "${cmd}" — try: show | tier | tier-remove | corpus | translation`);
  }
} catch (e) {
  console.error(`access: ${(e as Error).message}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
