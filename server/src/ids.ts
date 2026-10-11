// Content-addressed identifiers (SHARED_RESEARCH_SCHEMA.md §1).
//
//   canonical(obj) = JSON with keys sorted deeply, so the same claim always hashes the same
//   digest(obj)    = base32(sha256(canonical))  — lower-case, unpadded, URL-safe
//
//   claim_id      = "clm_" + digest({ author_id, subject_kind, subject_value })
//   submission_id = "sub_" + digest({ author_id, target_kind, items })
//   dissent_id    = "dsn_" + digest({ author_id, claim_id, claim_version, payload })
//
// Base32 (not base64url) so an ID survives being read aloud, written down, or lower-cased in a
// URL without ambiguity — these are meant to be citable in writing.

import { createHash } from "node:crypto";

const ALPHABET = "abcdefghijklmnopqrstuvwxyz234567"; // RFC 4648, lower-cased

export function base32(bytes: Uint8Array): string {
  let bits = 0, value = 0, out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function sortDeep(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortDeep);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      out[k] = sortDeep((v as Record<string, unknown>)[k]);
    }
    return out;
  }
  return v;
}

/** Deterministic JSON — the bytes an ID is derived from. */
export const canonical = (v: unknown): string => JSON.stringify(sortDeep(v));

/** Truncated to 26 chars (130 bits): plenty against collision, short enough to cite. */
export function digest(v: unknown): string {
  return base32(createHash("sha256").update(canonical(v), "utf8").digest()).slice(0, 26);
}

export const claimId = (author_id: string, subject_kind: string, subject_value: string): string =>
  `clm_${digest({ author_id, subject_kind, subject_value })}`;

export const submissionId = (author_id: string, target_kind: string, items: unknown): string =>
  `sub_${digest({ author_id, target_kind, items })}`;

export const dissentId = (
  author_id: string, claim_id: string, claim_version: number, payload: unknown,
): string => `dsn_${digest({ author_id, claim_id, claim_version, payload })}`;
