// Corpus patch tooling. Run via tsx:
//   npm run corpus -w server -- keygen [dir]        generate the maintainer keypair
//   npm run corpus -w server -- sign <patch.json> <priv.pem>   → signed envelope on stdout
//   npm run corpus -w server -- apply <signed.json>            apply to QF_QURAN_DB
//   npm run corpus -w server -- version                        print the corpus version
//
// keygen/sign never touch a database. apply/version open QF_QURAN_DB (read-write for apply).

import { generateKeyPairSync } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { Db } from "../db.js";
import { applyPatch, signPatch, readCorpusVersion, type Patch, type SignedPatch } from "./patch.js";
import { trustedPublicKey } from "./keys.js";

const [cmd, ...args] = process.argv.slice(2);
const quranPath = () => process.env.QF_QURAN_DB ?? resolve(process.cwd(), "quran.db");

function keygen(): void {
  const dir = args[0] ?? "corpus";
  mkdirSync(dir, { recursive: true });
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pub = resolve(dir, "trusted-key.pub.pem");
  const priv = resolve(dir, "maintainer-key.priv.pem");
  writeFileSync(pub, publicKey.export({ type: "spki", format: "pem" }) as string);
  writeFileSync(priv, privateKey.export({ type: "pkcs8", format: "pem" }) as string, { mode: 0o600 });
  console.log(`wrote ${pub}   (commit this — the client trusts it)`);
  console.log(`wrote ${priv}  (KEEP SECRET — gitignored; sign patches with it)`);
}

function sign(): void {
  const [patchFile, keyFile] = args;
  if (!patchFile || !keyFile) throw new Error("usage: sign <patch.json> <priv.pem>");
  const patch = JSON.parse(readFileSync(patchFile, "utf8")) as Patch;
  const signed = signPatch(patch, readFileSync(keyFile, "utf8"));
  console.log(JSON.stringify(signed, null, 2));
}

function apply(): void {
  const file = args[0];
  if (!file) throw new Error("usage: apply <signed.json>");
  const signed = JSON.parse(readFileSync(file, "utf8")) as SignedPatch;
  const db = new Db(quranPath()); // read-write
  const res = applyPatch(db, signed, trustedPublicKey());
  db.close();
  console.log(
    res.applied
      ? `✔ applied ${signed.patch.id}: corpus v${res.from} → v${res.to} (${res.ops} ops)`
      : `• skipped ${signed.patch.id}: ${res.reason} (corpus at v${res.from})`,
  );
}

function version(): void {
  const db = new Db(quranPath(), { readOnly: true });
  const { version, schemaVersion } = readCorpusVersion(db);
  db.close();
  console.log(`corpus_version=${version} schema_version=${schemaVersion}`);
}

try {
  switch (cmd) {
    case "keygen": keygen(); break;
    case "sign": sign(); break;
    case "apply": apply(); break;
    case "version": version(); break;
    default:
      console.error("usage: corpus <keygen|sign|apply|version> [...]");
      process.exit(2);
  }
} catch (e) {
  console.error(`corpus ${cmd}: ${(e as Error).message}`);
  process.exit(1);
}
