// Client for the REMOTE research channel (a different service from the local API).
//
// Every call sends `credentials: "include"` so the Better Auth session cookie travels; the
// remote allows our origin explicitly (its TRUSTED_ORIGINS / CORS config). On the desktop the
// sign-in page is opened in an in-app window so the cookie lands in the app's own session —
// see `window.desktop.openSignIn` (electron/preload.cjs).
//
// The remote is OPTIONAL: local study never needs it. Every function here can fail with the
// service simply not running, and callers must treat that as "not connected", not an error.

import type { SyncCursors } from "../persistence/db";

const REMOTE = import.meta.env.VITE_REMOTE_URL ?? "http://localhost:8100";

export interface Me {
  id: string;
  role: Role;
  email: string;
  displayName: string;
  localId: string | null;
}
export type Role = "reader" | "researcher" | "moderator" | "maintainer";
export interface InviteOut { code: string; role: Role; expires_at: string | null }

/** Kinds that can't conflict with anyone else's work — all that's submittable so far. */
export type AdditiveKind = "note" | "question" | "evidence";
export interface SubmissionItem {
  kind: AdditiveKind;
  subjectKind?: string | null;
  subjectValue?: string | null;
  payload: unknown;
}
export interface Submission {
  id: string;
  status: "submitted" | "approved" | "objected" | "withdrawn";
  targetKind: string;
  createdAt: string;
  supersedes: string | null;
  items: number;
}

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

  /** Everyday sign-in: email + password, session cookie straight back. No email needed. */
  signIn(email: string, password: string): Promise<unknown> {
    return call("/api/auth/sign-in/email", {
      method: "POST",
      body: JSON.stringify({ email, password, rememberMe: true }),
    });
  },

  /** Optional alternative, only useful once an email transport is configured. */
  signInWithLink(email: string): Promise<unknown> {
    return call("/api/auth/sign-in/magic-link", {
      method: "POST",
      body: JSON.stringify({ email, callbackURL: "/signed-in" }),
    });
  },

  /** Change your password (needs the current one). */
  changePassword(currentPassword: string, newPassword: string): Promise<unknown> {
    return call("/api/auth/change-password", {
      method: "POST",
      body: JSON.stringify({ currentPassword, newPassword, revokeOtherSessions: false }),
    });
  },

  signOut(): Promise<unknown> {
    return call("/api/auth/sign-out", { method: "POST", body: "{}" });
  },

  /**
   * Redeem an invite — creates the account with the password chosen here. No session needed:
   * the code is the credential. Afterwards you sign in with email + password.
   */
  redeem(opts: {
    code: string; email: string; password: string; displayName?: string; localId?: string;
  }): Promise<{ userId: string; email: string; role: Role }> {
    return call("/invites/redeem", { method: "POST", body: JSON.stringify(opts) });
  },

  /** Issue an invite (maintainer only). */
  createInvite(opts: { role: Role; expiresInDays?: number }): Promise<InviteOut> {
    return call<InviteOut>("/invites", { method: "POST", body: JSON.stringify(opts) });
  },

  /** Link this device's research (its local_id) to the signed-in account. */
  bindLocalId(localId: string): Promise<unknown> {
    return call("/me/local-id", { method: "POST", body: JSON.stringify({ localId }) });
  },

  /** Set your own display name — what other researchers see on your work. */
  setName(displayName: string): Promise<unknown> {
    return call("/me/name", { method: "POST", body: JSON.stringify({ displayName }) });
  },

  /**
   * Offer work upstream for review. The payload is frozen at submit time, so editing the local
   * record afterwards doesn't change what was submitted. Submitting the identical bundle twice
   * is idempotent — it returns the same submission rather than creating a duplicate.
   */
  submit(items: SubmissionItem[], supersedes?: string): Promise<Submission> {
    return call<Submission>("/submissions", {
      method: "POST",
      body: JSON.stringify({ items, supersedes: supersedes ?? null }),
    });
  },

  /** Your outbox — everything you've sent and where it stands. */
  submissions(): Promise<Submission[]> {
    return call<Submission[]>("/submissions");
  },

  /**
   * Ask the remote for everything new in each stream. A cursor walk: replayable, resumable,
   * and all-zeroes is a full resync — safe because it only ever lands in the app's derived
   * tables.
   *
   * One position PER STREAM: each remote table's `seq` is its own sequence, so a single shared
   * cursor would run one stream's counter ahead of another's and skip rows without erroring.
   */
  pull(since: SyncCursors): Promise<{
    cursors: SyncCursors; more: boolean; schemaVersion: number;
    globalForms: unknown[]; dissents: unknown[]; peerIndications: unknown[];
  }> {
    const q = new URLSearchParams();
    for (const [stream, at] of Object.entries(since)) q.set(stream, String(at));
    return call(`/pull?${q.toString()}`);
  },

  // --- the claim spine, from the app (Phase 5 was CLI-only) ---------------------
  //
  // Propose YOUR reading of a form or root. It contends for the global slot; it never
  // overwrites anyone else's. A competing claim must carry its argument (§12.1) — a case, an
  // evidence āyah, or reasoning — or reviewers have nothing to weigh.
  propose(opts: {
    subjectKind: "form" | "root"; subjectValue: string;
    payload: { meaning: string; argument?: string; caseId?: string; evidence?: unknown[] };
  }): Promise<ClaimVersion> {
    return call<ClaimVersion>("/claims", { method: "POST", body: JSON.stringify(opts) });
  },

  /** Every reading of a subject, and the group's current one — the review surface. */
  claims(subjectKind: "form" | "root", subjectValue: string): Promise<{
    claims: ClaimVersion[]; global: ClaimVersion | null;
  }> {
    const q = new URLSearchParams({ subjectKind, subjectValue });
    return call(`/claims?${q.toString()}`);
  },

  /** Approve or object to one version (moderator+). An objection never blocks; against an
   *  already-established reading it is filed as a dissent, kept permanently. */
  review(claimId: string, version: number, opts: {
    decision: "approve" | "object"; comment?: string; payload?: unknown;
  }): Promise<{ approvals: number; objections: number; established: boolean }> {
    return call(`/claims/${encodeURIComponent(claimId)}/versions/${version}/review`, {
      method: "POST", body: JSON.stringify(opts),
    });
  },

  /** Establish directly (maintainer only) — recorded as the maintainer's act. */
  establish(claimId: string, version: number, comment?: string): Promise<{ ok: boolean }> {
    return call(`/claims/${encodeURIComponent(claimId)}/versions/${version}/establish`, {
      method: "POST", body: JSON.stringify({ comment }),
    });
  },
};

export interface ClaimVersion {
  claimId: string;
  version: number;
  authorId: string;
  subjectKind: "form" | "root";
  subjectValue: string;
  payload: { meaning?: string; argument?: string; caseId?: string; evidence?: unknown[] } | null;
  establishedAt: string | null;
}

/** Desktop bridge, when running inside Electron. */
interface DesktopBridge {
  /** Loads a magic-link verify URL in an in-app window. `ok` is false if it wasn't verified. */
  openSignIn?(url: string): Promise<{ ok: boolean }>;
}
export const desktop = (): DesktopBridge | undefined =>
  (window as unknown as { desktop?: DesktopBridge }).desktop;
