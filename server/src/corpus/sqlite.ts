// node:sqlite, loaded the way corpus-core/src/db.ts loads it: through createRequire, not a static
// import. Vite (and so vitest) strips the `node:` prefix from a static import and then fails to
// resolve `sqlite`, because node:sqlite is a prefix-only built-in. The type import is erased.

import type * as SqliteNS from "node:sqlite";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export const { DatabaseSync } = require("node:sqlite") as typeof SqliteNS;
export type DatabaseSync = SqliteNS.DatabaseSync;
