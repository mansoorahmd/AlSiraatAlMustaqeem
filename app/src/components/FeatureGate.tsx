// A screen or section behind a plan feature (lib/features.ts). Two ways to be locked:
//
//   mode="lock"      a tool the plan doesn't include: a short explanation instead of the content
//   mode="readonly"  the reader's own records: the content stays, with a note that it can't be
//                    changed — the server refuses the writes, and says so in a toast
//
// Unlocked, it renders its children untouched.

import type { ReactNode } from "react";
import { useFeature, useFeatureCatalog, lockReason, type PlanFeature } from "../lib/features";
import { PlanLock } from "./PlanLock";

export function FeatureGate({ feature, mode, children }: {
  feature: PlanFeature; mode: "lock" | "readonly"; children: ReactNode;
}) {
  const ok = useFeature(feature);
  const catalog = useFeatureCatalog();
  if (ok) return <>{children}</>;
  const reason = lockReason(feature, catalog);
  if (mode === "lock") {
    return (
      <div className="sheet home">
        <section className="home-card">
          <p className="home-empty"><PlanLock feature={feature} /> {reason}.</p>
        </section>
      </div>
    );
  }
  return (
    <>
      <p className="plan-readonly-note plan-readonly-banner">
        <PlanLock feature={feature} /> Read-only — {reason.charAt(0).toLowerCase() + reason.slice(1)}.
        What you've already made stays here.
      </p>
      {children}
    </>
  );
}
