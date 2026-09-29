// Client for the maintainer's Admin screen — the plan ladder, who may read which resource, and
// each user's role and plan. Everything here is maintainer-only on the server (a 403 otherwise),
// except the two public reads (tiers, rules), which the app also uses to explain requirements.

import { REMOTE_URL, RemoteError, RemoteOffline } from "./remote";

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${REMOTE_URL}${path}`, {
      ...init,
      credentials: "include",
      headers: { "content-type": "application/json", ...(init.headers ?? {}) },
    });
  } catch {
    throw new RemoteOffline(`cannot reach the research server at ${REMOTE_URL}`);
  }
  if (!res.ok) {
    const detail = await res.json().then((b) => (b as { detail?: string }).detail).catch(() => undefined);
    throw new RemoteError(detail ?? `${init.method ?? "GET"} ${path} → ${res.status}`, res.status);
  }
  return res.json() as Promise<T>;
}
const send = (method: string, body?: unknown): RequestInit =>
  ({ method, body: body === undefined ? undefined : JSON.stringify(body) });

export interface Tier { name: string; rank: number; label: string }
export type ResourceKind = "feature" | "translation" | "lexicon";
export interface Rule { kind: ResourceKind; key: string; minPlan: string | null }
export type Role = string;
export interface RoleLevel { name: string; rank: number; label: string; fixed: boolean }
export interface AdminUser {
  id: string; email: string; displayName: string; role: Role;
  plan: string; planExpiresAt: string | null; createdAt: string;
  /** from the sign-up form — null for accounts made by invite or the CLIs */
  birthDate: string | null; region: string | null; gender: string | null;
}
export interface AdminResources {
  translations: { id: number; name: string; language: string; author: string; minPlan: string | null; ruled: boolean }[];
  lexicons: { source: string; entries: number; minPlan: string | null; ruled: boolean }[];
}

export const admin = {
  tiers: () => call<Tier[]>("/plan-tiers"),
  saveTier: (t: Tier) => call<Tier>(`/plan-tiers/${encodeURIComponent(t.name)}`, send("PUT", { rank: t.rank, label: t.label })),
  removeTier: (name: string) => call<{ ok: boolean }>(`/plan-tiers/${encodeURIComponent(name)}`, send("DELETE")),

  rules: () => call<Rule[]>("/resource-access"),
  /** minPlan: a tier, "free" (signed in), or null = public */
  setRule: (kind: ResourceKind, key: string, minPlan: string | null) =>
    call<Rule>(`/resource-access/${kind}/${encodeURIComponent(key)}`, send("PUT", { minPlan })),
  removeRule: (kind: ResourceKind, key: string) =>
    call<{ ok: boolean }>(`/resource-access/${kind}/${encodeURIComponent(key)}`, send("DELETE")),
  resources: () => call<AdminResources>("/admin/resources"),

  roles: () => call<RoleLevel[]>("/roles"),
  saveRole: (x: { name: string; rank?: number; label: string }) =>
    call<RoleLevel>(`/roles/${encodeURIComponent(x.name)}`, send("PUT", { rank: x.rank, label: x.label })),
  removeRole: (name: string) => call<{ ok: boolean }>(`/roles/${encodeURIComponent(name)}`, send("DELETE")),
  features: () => call<{ feature: "publish"; minRole: string }[]>("/feature-access"),
  setFeature: (feature: "publish", minRole: string) =>
    call<{ ok: boolean }>(`/feature-access/${feature}`, send("PUT", { minRole })),

  users: () => call<AdminUser[]>("/admin/users"),
  setUserRole: (id: string, role: Role) => call<{ ok: boolean }>(`/admin/users/${id}/role`, send("PUT", { role })),
  setUserPlan: (id: string, plan: string, expiresInDays: number | null) =>
    call<{ ok: boolean }>(`/admin/users/${id}/plan`, send("PUT", { plan, expiresInDays })),
};
