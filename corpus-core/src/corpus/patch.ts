// Corpus patch channel (Phase 2). Corpus corrections are *releases*, not rows: a signed,
// versioned patch file that the client verifies and applies in order. This is the whole
// contract — one-way (maintainer → everyone), no research schema, no auth.
//
// A patch is a set of upsert/delete ops addressed by NATURAL KEY (verse_key, root, segment
// position — never an internal rowid), so a patch stays valid across a full corpus rebuild.
// The envelope carries an Ed25519 signature over the canonical patch bytes; the client ships
// the maintainer's public key and refuses anything it can't verify.

import { createHash, sign as edSign, verify as edVerify, createPublicKey, createPrivateKey } from "node:crypto";
import type { Db } from "../db.js";

export interface PatchOp {
  op: "upsert" | "delete";
  table: string;
  key: Record<string, string | number | null>;   // natural key columns → values
  set?: Record<string, string | number | null>;   // columns to write (upsert only)
}

export interface Patch {
  id: string;
  schemaVersion: number;          // corpus schema this patch targets
  patchVersion: number;           // monotonic; applied in ascending order
  parent: number | null;          // required current corpus_version before applying (null = base)
  createdAt?: number;
  note?: string;
  ops: PatchOp[];
}

export interface SignedPatch {
  patch: Patch;
  sha256: string;                 // hex of canonical(patch) — a quick content check
  signature: string;              // base64 Ed25519 signature over canonical(patch) bytes
}

export interface ApplyResult {
  applied: boolean;
  from: number;
  to: number;
  ops: number;
  reason?: string;
}

// -- canonicalization + hashing ------------------------------------------------

function sortDeep(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortDeep);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) out[k] = sortDeep((v as any)[k]);
    return out;
  }
  return v;
}
/** Deterministic JSON (keys sorted, deep) so the hash & signature are stable. */
export function canonicalize(v: unknown): string {
  return JSON.stringify(sortDeep(v));
}
export const sha256Hex = (s: string): string => createHash("sha256").update(s, "utf8").digest("hex");

// -- signing (author side) + verification (client side) ------------------------

export function signPatch(patch: Patch, privateKeyPem: string): SignedPatch {
  const canon = canonicalize(patch);
  const signature = edSign(null, Buffer.from(canon, "utf8"), createPrivateKey(privateKeyPem));
  return { patch, sha256: sha256Hex(canon), signature: signature.toString("base64") };
}

/** Throws if the content hash or the signature doesn't check out. */
export function verifySignedPatch(signed: SignedPatch, publicKeyPem: string): void {
  const canon = canonicalize(signed.patch);
  if (sha256Hex(canon) !== signed.sha256) throw new Error("corpus patch: sha256 mismatch (content altered)");
  const ok = edVerify(null, Buffer.from(canon, "utf8"), createPublicKey(publicKeyPem), Buffer.from(signed.signature, "base64"));
  if (!ok) throw new Error("corpus patch: signature invalid (not from the trusted maintainer key)");
}

// -- corpus version (stored IN quran.db, so it travels with the file) ----------

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const ident = (name: string): string => {
  if (!IDENT.test(name)) throw new Error(`corpus patch: unsafe identifier ${JSON.stringify(name)}`);
  return name;
};

/** Read-only safe: returns 0 if the corpus has never been patched (no meta table yet). */
export function readCorpusVersion(db: Db): { version: number; schemaVersion: number } {
  try {
    const rows = db.query<{ key: string; value: string }>("SELECT key, value FROM corpus_meta");
    const m = new Map(rows.map((r) => [r.key, r.value]));
    return { version: Number(m.get("corpus_version") ?? 0), schemaVersion: Number(m.get("schema_version") ?? 0) };
  } catch {
    return { version: 0, schemaVersion: 0 }; // table absent → unpatched
  }
}

function ensureMeta(db: Db): void {
  db.exec("CREATE TABLE IF NOT EXISTS corpus_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
}
function setMeta(db: Db, key: string, value: string): void {
  db.run(
    "INSERT INTO corpus_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [key, value],
  );
}

// -- applying an op: upsert by natural key (UPDATE, else INSERT) / delete -------

function applyOp(db: Db, o: PatchOp): void {
  const table = ident(o.table);
  const keyCols = Object.keys(o.key).map(ident);
  if (keyCols.length === 0) throw new Error(`corpus patch: op on ${table} has no key`);
  const where = keyCols.map((c) => `${c} = ?`).join(" AND ");
  const keyVals = keyCols.map((c) => o.key[c] as unknown);

  if (o.op === "delete") {
    db.run(`DELETE FROM ${table} WHERE ${where}`, keyVals);
    return;
  }
  // upsert: try to UPDATE the existing row; if none, INSERT key+set together
  const setCols = Object.keys(o.set ?? {}).map(ident);
  if (setCols.length) {
    const assign = setCols.map((c) => `${c} = ?`).join(", ");
    const setVals = setCols.map((c) => (o.set as Record<string, unknown>)[c]);
    const res = db.run(`UPDATE ${table} SET ${assign} WHERE ${where}`, [...setVals, ...keyVals]);
    if (Number(res.changes) > 0) return;
  }
  const cols = [...keyCols, ...setCols];
  const vals = [...keyVals, ...setCols.map((c) => (o.set as Record<string, unknown>)[c])];
  db.run(`INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`, vals);
}

/**
 * Verify then apply a signed patch to a read-WRITE corpus db. Ordered and idempotent:
 * a patch already applied (patchVersion ≤ current) is a safe no-op; an out-of-order patch
 * (parent ≠ current) is refused so intermediates can't be skipped. All ops land in one
 * transaction — a patch applies whole or not at all.
 */
export function applyPatch(db: Db, signed: SignedPatch, publicKeyPem: string): ApplyResult {
  verifySignedPatch(signed, publicKeyPem);
  const p = signed.patch;
  ensureMeta(db);
  const current = readCorpusVersion(db).version;

  if (p.patchVersion <= current) {
    return { applied: false, from: current, to: current, ops: 0, reason: "already-applied" };
  }
  if (p.parent !== null && p.parent !== current) {
    throw new Error(`corpus patch: out of order — needs corpus at v${p.parent}, but it is at v${current}`);
  }

  db.exec("BEGIN");
  try {
    for (const o of p.ops) applyOp(db, o);
    setMeta(db, "corpus_version", String(p.patchVersion));
    setMeta(db, "schema_version", String(p.schemaVersion));
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return { applied: true, from: current, to: p.patchVersion, ops: p.ops.length };
}
