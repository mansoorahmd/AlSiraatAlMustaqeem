// "Check as a rule": any screen that holds a list of places (the Links panel's marker rows, and
// any later tool with an OccurrenceScope) hands the scope over here, then opens Rule checks, which
// takes it once and opens a new-rule form with "what it covers" already filled. Nothing is saved
// until the reader states the rule and saves it.

import type { OccurrenceScope } from "../api/types";

let pending: OccurrenceScope | null = null;

/** Offer a scope to the Rule checks screen (call, then switch to the "rules" tab). */
export function offerRuleScope(scope: OccurrenceScope): void {
  pending = { ...scope };
}

/** Look at the offered scope without taking it (safe in a state initialiser). */
export function peekRuleScope(): OccurrenceScope | null {
  return pending;
}

/** Take the offered scope, if any; it is handed over only once. */
export function takeRuleScope(): OccurrenceScope | null {
  const s = pending;
  pending = null;
  return s;
}
