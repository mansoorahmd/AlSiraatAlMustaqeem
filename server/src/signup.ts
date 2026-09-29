// Open sign-up (POST /signup, app.ts). Anyone may create an account; it starts as a reader on the
// free plan — the column defaults — and a maintainer promotes it from the Admin screen. Invites
// still work, for granting a higher role from the first sign-in.
//
// What the form asks for, and how it is checked here (never trusted from the client):
//   • email + password — Better Auth creates the account and hashes the password
//   • date of birth    — a real, past date; age is derived from it, not asked twice
//   • region           — an ISO 3166-1 alpha-2 country code (the app's list names them)
//   • gender           — optional: female, male, or left out

import type { SqlRunner } from "./migrate.js";

export class SignupError extends Error {
  constructor(message: string, readonly status = 422) { super(message); }
}

export interface SignupProfile { birthDate: string; region: string; gender: "female" | "male" | null }

export const MIN_AGE = 5;
export const MAX_AGE = 120;

/** Whole years between a YYYY-MM-DD birth date and `today`. */
export function ageOn(birthDate: string, today = new Date()): number {
  const [y, m, d] = birthDate.split("-").map(Number) as [number, number, number];
  let age = today.getUTCFullYear() - y;
  const month = today.getUTCMonth() + 1;
  if (month < m || (month === m && today.getUTCDate() < d)) age--;
  return age;
}

/** Validate the profile half of a sign-up; throws a SignupError naming the field. */
export function validProfile(
  body: { birthDate?: unknown; region?: unknown; gender?: unknown },
  today = new Date(),
): SignupProfile {
  const birthDate = typeof body.birthDate === "string" ? body.birthDate.trim() : "";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthDate);
  const asDate = m ? new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!)) : null;
  // round-tripping catches impossible dates like 2001-02-30
  if (!asDate || asDate.toISOString().slice(0, 10) !== birthDate) {
    throw new SignupError("date of birth must be a real date (YYYY-MM-DD)");
  }
  const age = ageOn(birthDate, today);
  if (age < MIN_AGE || age > MAX_AGE) {
    throw new SignupError(`date of birth gives an age of ${age} — it must be between ${MIN_AGE} and ${MAX_AGE}`);
  }

  const region = typeof body.region === "string" ? body.region.trim().toUpperCase() : "";
  if (!/^[A-Z]{2}$/.test(region)) throw new SignupError("choose your region");

  const g = typeof body.gender === "string" ? body.gender.trim().toLowerCase() : "";
  if (g && g !== "female" && g !== "male") throw new SignupError("gender must be female, male, or left out");

  return { birthDate, region, gender: (g || null) as SignupProfile["gender"] };
}

/** Store the profile on an account Better Auth has just created. */
export async function saveProfile(r: SqlRunner, userId: string, p: SignupProfile): Promise<void> {
  await r.query(
    "UPDATE users SET birth_date = $1, region = $2, gender = $3, updated_at = now() WHERE id = $4",
    [p.birthDate, p.region, p.gender, userId],
  );
}

/**
 * A small per-address limit on sign-ups — the route is public, so this keeps one address from
 * minting accounts in bulk. In memory: a restart forgets it, which is fine for its purpose.
 */
export function signupLimiter(max = 5, windowMs = 60 * 60 * 1000) {
  const hits = new Map<string, number[]>();
  return (key: string, now = Date.now()): boolean => {
    const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
    if (recent.length >= max) { hits.set(key, recent); return false; }
    recent.push(now);
    hits.set(key, recent);
    if (hits.size > 10_000) for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k);
    return true;
  };
}
