// The maintainer's access console — plan tiers and resource access, out of band. The same changes
// are available to a maintainer in the app (Admin screen) and over HTTP. Resources are
// plan-based; a resource's minimum is a tier, `free` (any signed-in account) or `public`.
//
//   npm run access -w @alsiraat/remote -- show
//
//   npm run access -w @alsiraat/remote -- tier scholar 200 "Scholar"   # add / change a tier
//   npm run access -w @alsiraat/remote -- tier-remove student          # remove an unused tier
//
//   npm run access -w @alsiraat/remote -- corpus public                # anyone may read the Qur'an
//   npm run access -w @alsiraat/remote -- corpus free                  # any signed-in account
//   npm run access -w @alsiraat/remote -- community scholar            # scholar or higher
//   npm run access -w @alsiraat/remote -- translation 131 scholar      # one translation
//   npm run access -w @alsiraat/remote -- lexicon lane student         # one dictionary
//   npm run access -w @alsiraat/remote -- translation 131 none         # drop a per-item rule

import { pool, pgRunner as r } from "./db.js";
import { loadTiers, setTier, removeTier } from "./plans.js";
import { listRules, setRule, removeRule } from "./resource-access.js";

const [cmd, a, b, c] = process.argv.slice(2);
const tierArg = (v: string | undefined): string | null => (v === "public" ? null : (v ?? ""));
const show = (min: string | null) => (min === null ? "public (no sign-in)" : min === "free" ? "free (any signed-in account)" : `${min} or higher`);

try {
  switch (cmd) {
    case "show":
    case undefined: {
      console.log("plan tiers (lowest first):");
      for (const t of (await loadTiers(r)).values()) console.log(`  ${String(t.rank).padStart(5)}  ${t.name.padEnd(16)} ${t.label}`);
      console.log("\nresource access:");
      for (const rule of await listRules(r)) {
        console.log(`  ${`${rule.kind}${rule.key === "*" ? "" : ` ${rule.key}`}`.padEnd(22)} ${show(rule.minPlan)}`);
      }
      break;
    }
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
    case "corpus":
    case "community": {
      if (!a) throw new Error(`usage: access ${cmd} <public|free|tier>`);
      const rule = await setRule(r, cmd, "*", tierArg(a));
      console.log(`✔ ${cmd}: ${show(rule.minPlan)}`);
      break;
    }
    case "translation":
    case "lexicon": {
      if (!a || !b) throw new Error(`usage: access ${cmd} <${cmd === "translation" ? "resource-id" : "source"}> <public|free|tier|none>`);
      if (b === "none") {
        await removeRule(r, cmd, a);
        console.log(`✔ ${cmd} ${a}: no extra rule (needs only what the corpus needs)`);
      } else {
        const rule = await setRule(r, cmd, a, tierArg(b));
        console.log(`✔ ${cmd} ${a}: ${show(rule.minPlan)}`);
      }
      break;
    }
    default:
      throw new Error(`unknown command "${cmd}" — try: show | tier | tier-remove | corpus | community | translation | lexicon`);
  }
} catch (e) {
  console.error(`access: ${(e as Error).message}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
