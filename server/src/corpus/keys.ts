// The maintainer's public key the client trusts for corpus patches. Resolution order:
//   1. QF_CORPUS_PUBKEY — either the PEM text itself, or a path to a .pem file
//   2. corpus/trusted-key.pub.pem at the repo root (committed; generate with the keygen CLI)
// The matching private key stays with the maintainer and is never in the repo.

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..", "..");

export function trustedPublicKey(): string {
  const env = process.env.QF_CORPUS_PUBKEY;
  if (env && env.trim()) return env.includes("BEGIN") ? env : readFileSync(env, "utf8");
  const p = resolve(REPO_ROOT, "corpus", "trusted-key.pub.pem");
  if (existsSync(p)) return readFileSync(p, "utf8");
  throw new Error(
    "no trusted corpus public key — set QF_CORPUS_PUBKEY or add corpus/trusted-key.pub.pem " +
    "(generate a keypair with: npm run corpus -w server -- keygen)",
  );
}
