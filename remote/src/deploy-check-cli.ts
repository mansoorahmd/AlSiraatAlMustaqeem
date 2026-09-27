// The container's first step (deploy/entrypoint.sh): refuse to go any further — migrations
// included — on an unsafe or broken production environment, naming everything to fix.
import { assertDeployable } from "./config.js";

try {
  assertDeployable();
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
