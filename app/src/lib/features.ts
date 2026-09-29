// Plan features — what the account's plan lets it use (server/src/plan-features.ts is the list, and
// the server enforces it). The app only mirrors it to show a lock instead of an error:
//
//   useFeature("notes")  → may I use it? (from /me.features)
//   useFeatureCatalog()  → every feature with its group, label and the plan it needs (/plan-features)
//
// A locked interaction or research feature is READ-ONLY: what you made stays visible; the
// controls that would add or change something show a lock.

import { useEffect, useState } from "react";
import { REMOTE_URL } from "../api/remote";
import { useMe } from "../hooks/useMe";

export type PlanFeature =
  | "text" | "translations" | "search" | "roots" | "meanings" | "follow-root" | "follow-word"
  | "echoes" | "similar" | "spelling" | "wazn" | "linkages" | "lens" | "compare"
  | "notes" | "indications" | "my-meanings" | "motifs"
  | "cases" | "publish" | "community" | "divergences" | "ai";

export interface FeatureInfo {
  key: PlanFeature; group: "read" | "interact" | "research";
  label: string; description: string; minPlan: string | null;
}
export interface FeatureCatalog { groups: { key: string; label: string }[]; features: FeatureInfo[] }

let catalog: FeatureCatalog | null = null;
let inflight: Promise<FeatureCatalog | null> | null = null;
const listeners = new Set<(c: FeatureCatalog | null) => void>();

function loadCatalog(): Promise<FeatureCatalog | null> {
  inflight ??= fetch(`${REMOTE_URL}/plan-features`, { credentials: "include" })
    .then((r) => (r.ok ? (r.json() as Promise<FeatureCatalog>) : null))
    .catch(() => null)
    .then((c) => { catalog = c; for (const fn of listeners) fn(c); return c; });
  return inflight;
}

/** Re-fetch after a maintainer changes a rule. */
export function refreshFeatureCatalog(): Promise<FeatureCatalog | null> {
  inflight = null;
  return loadCatalog();
}

export function useFeatureCatalog(): FeatureCatalog | null {
  const [c, setC] = useState(catalog);
  useEffect(() => {
    listeners.add(setC);
    if (!catalog) void loadCatalog();
    return () => { listeners.delete(setC); };
  }, []);
  return c;
}

/**
 * May this account use a feature? While the account is still loading this says yes, so nothing
 * flickers locked; the server has the final word either way.
 */
export function useFeature(key: PlanFeature): boolean {
  const { me, loading } = useMe();
  if (loading) return true;
  return me?.features?.[key] ?? false;
}

/** "Notes & questions needs the Pro plan" — for a lock's tooltip. */
export function lockReason(key: PlanFeature, c: FeatureCatalog | null): string {
  const f = c?.features.find((x) => x.key === key);
  const plan = f?.minPlan;
  const what = f?.label ?? "This feature";
  if (plan === "free") return `${what} needs you to sign in`;
  const label = plan ? plan.charAt(0).toUpperCase() + plan.slice(1) : "a higher";
  return `${what} needs the ${label} plan — a maintainer can upgrade your account`;
}
