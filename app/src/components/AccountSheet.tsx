// The research-community account panel.
//
// Built to the pattern people already know from ordinary web apps (see the UI conventions in
// INSTRUCTIONS.md): an avatar + name + role badge header, values shown as TEXT with a pencil
// to edit rather than raw inputs left sitting open, labelled rows sharing one left edge, one
// primary action per section, and sign-out set apart at the end.
//
// The remote is OPTIONAL — if it isn't running we say so plainly and the reader carries on
// working offline, which is the whole premise (SHARED_RESEARCH.md §2).

import { useCallback, useEffect, useState } from "react";
import { remote, RemoteOffline, type Me, type Role, type InviteOut } from "../api/remote";
import { fetchIdentity, owner as ownerApi } from "../persistence/db";

/**
 * Tie the open database to this account. If the file has no owner yet, claim it for this email;
 * if it already belongs to someone else we leave it alone — that's a real situation (you opened
 * a colleague's file) and the share controls will refuse to publish it as yours.
 *
 * Best-effort: this must never block signing in.
 */
async function claimProfile(email: string): Promise<void> {
  try {
    const id = await fetchIdentity();
    if (!id.owner) await ownerApi.set(email);
  } catch { /* keep working in the current database */ }
}

type Status = "loading" | "offline" | "blocked" | "signed-out" | "signed-in";

const ROLE_HELP: Record<Role, string> = {
  reader: "can pull the group's readings",
  researcher: "can submit work for review",
  moderator: "can approve submissions",
  maintainer: "full authority, can invite",
};

/** Up to two initials — the conventional avatar fallback. */
function initials(me: Me): string {
  const src = me.displayName.trim() || me.email;
  const parts = src.split(/[\s@._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

export function AccountSheet() {
  const [status, setStatus] = useState<Status>("loading");
  const [me, setMe] = useState<Me | null>(null);
  const [localId, setLocalId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showRedeem, setShowRedeem] = useState(false);
  const [code, setCode] = useState("");
  // profile editing — closed by default, opened with the pencil
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  // invites
  const [newRole, setNewRole] = useState<Role>("researcher");
  const [issued, setIssued] = useState<InviteOut | null>(null);
  const [copied, setCopied] = useState(false);

  const canSignIn = email.includes("@") && password.length >= 10;

  const refresh = useCallback(async () => {
    setErr(null);
    try {
      const who = await remote.me();
      setMe(who);
      if (who) setNameDraft(who.displayName);
      setStatus(who ? "signed-in" : "signed-out");
    } catch (e) {
      if (e instanceof RemoteOffline) {
        setStatus((await remote.reachable()) ? "blocked" : "offline");
        return;
      }
      setStatus("signed-out");
      setErr((e as Error).message);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { fetchIdentity().then((i) => setLocalId(i.localId)).catch(() => {}); }, []);

  const guard = async (fn: () => Promise<void>) => {
    setBusy(true); setErr(null);
    try { await fn(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  const doSignIn = () => guard(async () => {
    await remote.signIn(email.trim(), password);
    setPassword("");
    // Your research follows YOU: claim the local database for this account. If it was
    // unclaimed, the work you've already done is adopted in place; if this account already
    // has a database on this machine, that one is opened instead.
    await claimProfile(email.trim());
    await refresh();
  });

  const doRedeem = () => guard(async () => {
    await remote.redeem({
      code: code.trim(), email: email.trim(), password, localId: localId ?? undefined,
    });
    await remote.signIn(email.trim(), password);
    await claimProfile(email.trim());
    setShowRedeem(false); setCode(""); setPassword("");
    await refresh();
  });

  const saveName = () => guard(async () => {
    await remote.setName(nameDraft);
    setEditingName(false);
    await refresh();
  });

  if (status === "loading") return <p className="acct-note">Checking…</p>;

  if (status === "offline" || status === "blocked") {
    return (
      <div className="acct">
        <p className="acct-note">
          {status === "offline" ? (
            <>The research server isn’t running at <code>{remote.url}</code>. That’s fine — all
            your study works offline; only publishing and reviewing need it.</>
          ) : (
            <>The research server is running but refused this app’s origin
            (<code>{window.location.origin}</code>). Add it to <code>TRUSTED_ORIGINS</code> and
            restart it.</>
          )}
        </p>
        <button className="ctl" onClick={() => void refresh()}>Try again</button>
      </div>
    );
  }

  return (
    <div className="acct">
      {err && <p className="acct-error" role="alert">{err}</p>}

      {status === "signed-out" && (
        <>
          <p className="acct-note">
            {showRedeem
              ? "Your invite creates the account. Choose a password now — you’ll use it every time after."
              : "Sign in to publish research for review and pull the group’s established readings."}
          </p>

          <div className="acct-field">
            <label htmlFor="acct-email">Email</label>
            <input
              id="acct-email" type="email" autoComplete="email"
              placeholder="you@example.org" value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div className="acct-field">
            <label htmlFor="acct-pw">Password</label>
            <input
              id="acct-pw" type="password"
              autoComplete={showRedeem ? "new-password" : "current-password"}
              placeholder={showRedeem ? "at least 10 characters" : ""}
              value={password} onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !showRedeem && canSignIn) doSignIn(); }}
            />
            {showRedeem && <span className="acct-hint">At least 10 characters.</span>}
          </div>

          {showRedeem && (
            <div className="acct-field">
              <label htmlFor="acct-code">Invite code</label>
              <input
                id="acct-code" placeholder="paste the code you were sent"
                value={code} onChange={(e) => setCode(e.target.value)}
              />
              {localId && <span className="acct-hint">This device’s research will be linked to the new account.</span>}
            </div>
          )}

          <div className="acct-actions">
            {showRedeem ? (
              <button className="ctl primary" disabled={busy || !code.trim() || !canSignIn} onClick={doRedeem}>
                {busy ? "Creating your account…" : "Create account"}
              </button>
            ) : (
              <button className="ctl primary" disabled={busy || !canSignIn} onClick={doSignIn}>
                {busy ? "Signing in…" : "Sign in"}
              </button>
            )}
          </div>

          <p className="acct-alt">
            {showRedeem ? (
              <>Already have an account?{" "}
                <button className="linkish" onClick={() => setShowRedeem(false)}>Sign in</button></>
            ) : (
              <>Have an invite code?{" "}
                <button className="linkish" onClick={() => setShowRedeem(true)}>Create your account</button></>
            )}
          </p>

          {!showRedeem && (
            <p className="acct-hint">
              Forgotten your password? There’s no reset email yet — ask a maintainer to set a new
              one for you.
            </p>
          )}
        </>
      )}

      {status === "signed-in" && me && (
        <>
          {/* identity header — avatar, name, role, email: the familiar arrangement */}
          <header className="acct-head">
            <div className="acct-avatar" aria-hidden>{initials(me)}</div>
            <div className="acct-who">
              {editingName ? (
                <div className="acct-name-edit">
                  <input
                    aria-label="Display name" autoFocus value={nameDraft}
                    onChange={(e) => setNameDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && nameDraft.trim()) saveName();
                      if (e.key === "Escape") { setEditingName(false); setNameDraft(me.displayName); }
                    }}
                  />
                  <button className="ctl primary" disabled={busy || !nameDraft.trim()} onClick={saveName}>Save</button>
                  <button className="ctl" onClick={() => { setEditingName(false); setNameDraft(me.displayName); }}>
                    Cancel
                  </button>
                </div>
              ) : (
                <div className="acct-name-row">
                  <span className="acct-name">{me.displayName || me.email.split("@")[0]}</span>
                  <button
                    className="icon-btn" title="Edit your name" aria-label="Edit your name"
                    onClick={() => { setNameDraft(me.displayName); setEditingName(true); }}
                  >✎</button>
                </div>
              )}
              <span className="acct-email">{me.email}</span>
              <span className={`role-pill role-${me.role}`} title={ROLE_HELP[me.role]}>{me.role}</span>
            </div>
          </header>

          <dl className="acct-rows">
            <div className="acct-row">
              <dt>This device</dt>
              <dd>
                {me.localId ? (
                  <span className="acct-ok">Linked <code>{me.localId.slice(0, 8)}…</code></span>
                ) : (
                  <>
                    <span className="acct-muted">Not linked</span>
                    {localId && (
                      <button className="ctl" disabled={busy}
                        onClick={() => guard(async () => { await remote.bindLocalId(localId); await refresh(); })}>
                        Link this device
                      </button>
                    )}
                  </>
                )}
              </dd>
            </div>
          </dl>

          {me.role === "maintainer" && (
            <section className="acct-section">
              <h3>Invite a researcher</h3>
              <div className="acct-field">
                <label htmlFor="acct-role">They can</label>
                <select id="acct-role" value={newRole} onChange={(e) => setNewRole(e.target.value as Role)}>
                  {(Object.keys(ROLE_HELP) as Role[]).map((r) => (
                    <option key={r} value={r}>{r} — {ROLE_HELP[r]}</option>
                  ))}
                </select>
              </div>
              <div className="acct-actions">
                <button className="ctl primary" disabled={busy}
                  onClick={() => guard(async () => {
                    setIssued(await remote.createInvite({ role: newRole, expiresInDays: 30 }));
                    setCopied(false);
                  })}>
                  {busy ? "Creating…" : "Create invite"}
                </button>
              </div>
              {issued && (
                <div className="acct-code-box">
                  <code>{issued.code}</code>
                  <button className="ctl"
                    onClick={() => { void navigator.clipboard?.writeText(issued.code); setCopied(true); }}>
                    {copied ? "Copied" : "Copy"}
                  </button>
                  <span className="acct-hint">Single use, expires in 30 days.</span>
                </div>
              )}
            </section>
          )}

          <div className="acct-footer">
            <button className="ctl" disabled={busy}
              onClick={() => guard(async () => { await remote.signOut(); await refresh(); })}>
              Sign out
            </button>
          </div>
        </>
      )}
    </div>
  );
}
