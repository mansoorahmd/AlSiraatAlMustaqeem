// Client for the REMOTE research channel (a different service from the local API).
//
// Every call sends `credentials: "include"` so the Better Auth session cookie travels; the
// remote allows our origin explicitly (its TRUSTED_ORIGINS / CORS config). On the desktop the
// sign-in page is opened in an in-app window so the cookie lands in the app's own session —
// see `window.desktop.openSignIn` (electron/preload.cjs).
//
// The remote is OPTIONAL: local study never needs it. Every function here can fail with the
// service simply not running, and callers must treat that as "not connected", not an error.

const REMOTE = import.meta.env.VITE_REMOTE_URL ?? "http://localhost:8100";

export interface Me { id: string; role: Role; localId: string | null }
export type Role = "reader" | "researcher" | "moderator" | "maintainer";
export interface InviteOut { code: string; role: Role; expires_at: string | null }

export class RemoteError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
/**
 * Thrown when the request never got an answer. NOTE: a CORS rejection makes fetch() throw
 * exactly like an unreachable server, so this covers both "not running" and "running but not
 * allowing this origin" — the browser deliberately doesn't tell us which. `reachable()` below
 * separates them so we can say something true rather than guessing.
 */
export class RemoteOffline extends Error {}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${REMOTE}${path}`, {
      ...init,
      credentials: "include",
      headers: { "content-type": "application/json", ...(init.headers ?? {}) },
    });
  } catch {
    throw new RemoteOffline(`cannot reach the research server at ${REMOTE}`);
  }
  if (!res.ok) {
    const detail = await res.json().then((b) => (b as { detail?: string }).detail).catch(() => undefined);
    throw new RemoteError(detail ?? `${init.method ?? "GET"} ${path} → ${res.status}`, res.status);
  }
  return res.json() as Promise<T>;
}

export const remote = {
  url: REMOTE,

  /**
   * Is the service actually running? A `no-cors` probe gets an opaque response that succeeds
   * whenever the server answered at all — even if CORS would block a real read. So:
   *   probe fails  → the server is down / unreachable
   *   probe passes but /me threw → it's up, but rejecting this origin (CORS)
   */
  async reachable(): Promise<boolean> {
    try {
      await fetch(`${REMOTE}/health`, { mode: "no-cors", cache: "no-store" });
      return true;
    } catch {
      return false;
    }
  },

  /** The signed-in account, or null when signed out (401) / unreachable. */
  async me(): Promise<Me | null> {
    try {
      return await call<Me>("/me");
    } catch (e) {
      if (e instanceof RemoteError && e.status === 401) return null;
      throw e;
    }
  },

  /** Ask for a magic link. In dev the link is printed in the remote's server log. */
  signIn(email: string): Promise<unknown> {
    return call("/api/auth/sign-in/magic-link", {
      method: "POST",
      body: JSON.stringify({ email, callbackURL: "/signed-in" }),
    });
  },

  signOut(): Promise<unknown> {
    return call("/api/auth/sign-out", { method: "POST", body: "{}" });
  },

  /** Redeem an invite — creates the account. No session needed: the code is the credential. */
  redeem(opts: { code: string; email: string; displayName?: string; localId?: string }): Promise<Me> {
    return call<Me>("/invites/redeem", { method: "POST", body: JSON.stringify(opts) });
  },

  /** Issue an invite (maintainer only). */
  createInvite(opts: { role: Role; expiresInDays?: number }): Promise<InviteOut> {
    return call<InviteOut>("/invites", { method: "POST", body: JSON.stringify(opts) });
  },

  /** Link this device's research (its local_id) to the signed-in account. */
  bindLocalId(localId: string): Promise<unknown> {
    return call("/me/local-id", { method: "POST", body: JSON.stringify({ localId }) });
  },
};

/** Desktop bridge, when running inside Electron. */
export const desktop = (): { openSignIn?(url: string): Promise<void> } | undefined =>
  (window as unknown as { desktop?: { openSignIn?(url: string): Promise<void> } }).desktop;
