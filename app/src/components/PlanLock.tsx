// The small "🔒 Pro" chip beside a control this plan doesn't include (lib/features.ts).

import { useFeatureCatalog, lockReason, type PlanFeature } from "../lib/features";

export function PlanLock({ feature }: { feature: PlanFeature }) {
  const catalog = useFeatureCatalog();
  const plan = catalog?.features.find((f) => f.key === feature)?.minPlan;
  const label = plan === "free" ? "Sign in" : plan ? plan.charAt(0).toUpperCase() + plan.slice(1) : "Pro";
  return <span className="plan-lock" title={lockReason(feature, catalog)}>🔒 {label}</span>;
}
