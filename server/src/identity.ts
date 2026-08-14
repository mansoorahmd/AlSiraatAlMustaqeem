// Deriving a stable id from an email.
//
// The owner's uuid is uuidv5(email), so the same person resolves to the same id on every
// machine, with no lookup and nothing to keep in sync. That id is what the remote account binds
// to (users.local_id), which is why it must be derived rather than random: back your research
// up, restore it on another machine, and it is still recognisably yours.

import { createHash } from "node:crypto";

/** Fixed namespace so the derivation is stable across machines and versions. */
const NAMESPACE = "6f9619ff-8b86-d011-b42d-00cf4fc964ff";

/** RFC 4122 v5 (SHA-1, name-based). */
export function uuidV5(name: string): string {
  const ns = Buffer.from(NAMESPACE.replace(/-/g, ""), "hex");
  const h = createHash("sha1").update(Buffer.concat([ns, Buffer.from(name, "utf8")])).digest();
  h[6] = (h[6]! & 0x0f) | 0x50; // version 5
  h[8] = (h[8]! & 0x3f) | 0x80; // RFC 4122 variant
  const hex = h.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export const normalizeEmail = (email: string): string => email.trim().toLowerCase();

/** The owner id for an email — the same value everywhere, forever. */
export const ownerIdFor = (email: string): string => uuidV5(normalizeEmail(email));
