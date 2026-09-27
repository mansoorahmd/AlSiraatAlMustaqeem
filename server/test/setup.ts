// Every test file gets its own, empty research database — in its own temp folder, so the
// recent-files index (databases.json, kept beside the file) is fresh too. Without this, a test
// that didn't set QF_RESEARCH_DB opened the default path, and databases.json then pointed it at
// the reader's REAL research.db. A file that sets QF_RESEARCH_DB itself (owner, backup, …) still
// wins: this runs first, before the file's own imports.

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.QF_RESEARCH_DB = join(mkdtempSync(join(tmpdir(), "alsiraat-test-")), "research.db");
