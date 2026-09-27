// Who may see a published result once it's approved: at least a role (student, scholar, …) and
// at least a plan. The author proposes it; the reviewer confirms or changes it. The rungs and
// tiers are the maintainer's (Admin), read live so the choices are always the real ones.

import { useEffect, useState } from "react";
import { remote, type Audience, type RoleLevel } from "../api/remote";

type Tier = { name: string; rank: number; label: string };
let ladders: Promise<{ roles: RoleLevel[]; tiers: Tier[] }> | null = null;
const loadLadders = () =>
  (ladders ??= Promise.all([remote.roles(), remote.planTiers()])
    .then(([roles, tiers]) => ({ roles, tiers }))
    .catch((e) => { ladders = null; throw e; }));

export const EVERYONE: Audience = { minRole: null, minPlan: null };

/** "Scholars and above, on Pro" — the audience in words. */
export function describeAudience(a: Audience | undefined, roles: RoleLevel[] = [], tiers: Tier[] = []): string {
  if (!a || (!a.minRole && !a.minPlan)) return "everyone in the community";
  const role = a.minRole ? `${roles.find((r) => r.name === a.minRole)?.label || a.minRole}s and above` : "anyone";
  const plan = a.minPlan ? ` on ${tiers.find((t) => t.name === a.minPlan)?.label || a.minPlan} or higher` : "";
  return `${role}${plan}`;
}

export function AudiencePicker({ value, onChange, label = "Who can see it once approved" }: {
  value: Audience; onChange: (a: Audience) => void; label?: string;
}) {
  const [data, setData] = useState<{ roles: RoleLevel[]; tiers: Tier[] } | null>(null);
  useEffect(() => { loadLadders().then(setData).catch(() => setData({ roles: [], tiers: [] })); }, []);
  if (!data) return null;
  const roles = data.roles.filter((r) => r.rank > 0);            // "reader" = anyone
  const tiers = data.tiers.filter((t) => t.rank > 0);            // "free" = any plan

  return (
    <div className="audience">
      <span className="propose-label">{label}</span>
      <div className="audience-row">
        <select className="board-input" aria-label="Minimum role" value={value.minRole ?? ""}
          onChange={(e) => onChange({ ...value, minRole: e.target.value || null })}>
          <option value="">Any role</option>
          {roles.map((r) => <option key={r.name} value={r.name}>{r.label || r.name} or higher</option>)}
        </select>
        <select className="board-input" aria-label="Minimum plan" value={value.minPlan ?? ""}
          onChange={(e) => onChange({ ...value, minPlan: e.target.value || null })}>
          <option value="">Any plan</option>
          {tiers.map((t) => <option key={t.name} value={t.name}>{t.label || t.name} or higher</option>)}
        </select>
      </div>
      <span className="acct-hint">Visible to {describeAudience(value, data.roles, data.tiers)}.</span>
    </div>
  );
}
