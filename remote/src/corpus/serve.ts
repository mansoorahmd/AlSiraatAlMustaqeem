// The Qur'an corpus, served from Postgres at /corpus — by the SAME route code the local server
// mounts at /api/v1 (server/src/routes/*), over the same services (server/src/corpus-services.ts),
// through the Postgres driver (pg-corpus.ts). One codebase, so the cloud API matches the local
// one by construction: a client moves by changing its base URL.
//
//   local   GET /api/v1/roots/hdy
//   cloud   GET /corpus/roots/hdy
//
// The one cloud-only difference is entitlement: translations and dictionaries whose resource rule
// the caller's plan doesn't reach are left out (resource-access.ts). The corpus as a whole is
// gated before this app, by requireResource("corpus").

import { Hono, type Context } from "hono";
import type { SqlRunner } from "../migrate.js";
import type { Env } from "../roles.js";
import { itemFilter } from "../resource-access.js";
import { HttpError } from "../../../server/src/content.js";
import type { CorpusServices, Entitlements } from "../../../server/src/corpus-services.js";
import { contentRoutes } from "../../../server/src/routes/content.js";
import { rootRoutes } from "../../../server/src/routes/roots.js";
import { similarityRoutes } from "../../../server/src/routes/similarity.js";
import { echoRoutes } from "../../../server/src/routes/echoes.js";
import { corpusRoutes as versionRoutes } from "../../../server/src/routes/corpus.js";

/**
 * `access` is the runner holding the resource rules and plan tiers (the public schema). Omit it
 * and nothing is filtered — how the parity check mounts the same app over each driver.
 */
export function corpusApp(svc: CorpusServices, access?: SqlRunner): Hono<Env> {
  const user = (c: Context) => (c as unknown as Context<Env>).get("user");
  const ent: Entitlements = !access ? {} : {
    translations: async (c) => {
      const f = await itemFilter(access, user(c), "translation");
      return (id: number) => f(id);
    },
    lexicons: async (c) => {
      const f = await itemFilter(access, user(c), "lexicon");
      return (source: string) => f(source);
    },
  };

  const app = new Hono<Env>();
  // same error contract as the local server's app.onError
  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ detail: err.message }, err.status as 400);
    console.error(err);
    return c.json({ detail: "internal error" }, 500);   // the details go to the log, not the caller
  });
  app.route("/", contentRoutes(svc, ent));
  app.route("/", rootRoutes(svc, ent));
  app.route("/", similarityRoutes(svc));
  app.route("/", echoRoutes(svc));
  app.route("/", versionRoutes(svc));
  return app;
}
