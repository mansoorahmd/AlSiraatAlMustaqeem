// The signed-in research account, shared across the app.
//
// The remote is OPTIONAL, so this never throws to its callers: offline, blocked, or signed out
// all resolve to `null`. One in-flight fetch is shared and the result cached, so the many places
// that need "am I a moderator?" don't each hit /me. Call `refresh()` after sign-in/out.

import { useEffect, useState } from "react";
import { remote, type Me } from "../api/remote";

let cache: Me | null = null;
let inflight: Promise<Me | null> | null = null;
const listeners = new Set<(m: Me | null) => void>();

async function load(): Promise<Me | null> {
  if (!inflight) {
    inflight = remote.me()
      .then((m) => { cache = m; return m; })
      .catch(() => { cache = null; return null; })
      .finally(() => { inflight = null; });
  }
  const m = await inflight;
  for (const fn of listeners) fn(m);
  return m;
}

/** Force a re-fetch — call after sign-in, sign-out, or a role change. */
export function refreshMe(): Promise<Me | null> {
  inflight = null;
  return load();
}

export interface MeState {
  me: Me | null;
  loading: boolean;
  /** convenience: can this account approve/object? */
  canReview: boolean;
  /** convenience: can this account establish directly? */
  canEstablish: boolean;
}

export function useMe(): MeState {
  const [me, setMe] = useState<Me | null>(cache);
  const [loading, setLoading] = useState(cache === null);

  useEffect(() => {
    const on = (m: Me | null) => { setMe(m); setLoading(false); };
    listeners.add(on);
    if (cache === null) void load(); else setLoading(false);
    return () => { listeners.delete(on); };
  }, []);

  return {
    me,
    loading,
    canReview: me?.role === "moderator" || me?.role === "maintainer",
    canEstablish: me?.role === "maintainer",
  };
}
