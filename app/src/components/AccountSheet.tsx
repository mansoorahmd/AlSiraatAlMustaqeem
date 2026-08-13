// The research-community account panel: sign in, redeem an invite, issue invites
// (maintainer), link this device, sign out.
//
// The remote is OPTIONAL — if it isn't running we say so plainly and the reader carries on
// working offline, which is the whole premise (SHARED_RESEARCH.md §2). There are no passwords
// anywhere: sign-in is a single-use magic link.

import { useCallback, useEffect, useState } from "react";
import { remote, RemoteOffline, type Me, type Role, type InviteOut } from "../api/remote";
import { fetchIdentity } from "../persistence/db";

type Status = "loading" | "offline" | "blocked" | "signed-out" | "signed-in";

export function AccountSheet() {
  const [status, setStatus] = useState<Status>("loading");
  const [me, setMe] = useState<Me | null>(null);
  const [localId, setLocalId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // sign-in
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [nameDraft, setNameDraft] = useState("");
  // Better Auth is configured with minPasswordLength: 10
  const canSignIn = email.includes("@") && password.length >= 10;
  // invite redemption
  const [showRedeem, setShowRedeem] = useState(false);
  const [code, setCode] = useState("");
  // invite issuing
  const [newRole, setNewRole] = useState<Role>("researcher");
  const [issued, setIssued] = useState<InviteOut | null>(null);
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(async () => {
    setErr(null);
    try {
      const who = await remote.me();
      setMe(who);
      if (who) setNameDraft(who.displayName);
      setStatus(who ? "signed-in" : "signed-out");
    } catch (e) {
      if (e instanceof RemoteOffline) {
        // fetch throws identically for "down" and "CORS-blocked" — probe to tell them apart
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
    await refresh();
  });

  const doRedeem = () => guard(async () => {
    await remote.redeem({
      code: code.trim(), email: email.trim(), password,
      localId: localId ?? undefined,
    });
    // the account now exists with this password — sign straight in with it
    await remote.signIn(email.trim(), password);
    setShowRedeem(false); setCode(""); setPassword("");
    await refresh();
  });

  const doIssue = () => guard(async () => {
    setIssued(await remote.createInvite({ role: newRole, expiresInDays: 30 }));
    setCopied(false);
  });

  const doBind = () => guard(async () => {
    if (localId) { await remote.bindLocalId(localId); await refresh(); }
  });

  if (status === "loading") return <p className="home-empty">Checking…</p>;

  if (status === "offline") {
    return (
      <>
        <p className="home-empty">
          The research server isn’t reachable at <code>{remote.url}</code>. That’s fine — all your
          study works offline; only publishing and reviewing need it.
        </p>
        <button className="ctl" onClick={() => void refresh()}>Try again</button>
      </>
    );
  }

  if (status === "blocked") {
    return (
      <>
        <p className="home-empty">
          The research server at <code>{remote.url}</code> is running but refused this app’s
          origin (<code>{window.location.origin}</code>). Add it to the server’s{" "}
          <code>TRUSTED_ORIGINS</code> and restart it.
        </p>
        <button className="ctl" onClick={() => void refresh()}>Try again</button>
      </>
    );
  }

  return (
    <>
      {err && <p className="home-empty acct-err">{err}</p>}

      {status === "signed-out" && (
        <>
          <p className="home-empty">
            Sign in to publish research for review and pull the group’s established readings.
          </p>
          <label className="acct-label" htmlFor="acct-email">Email</label>
          <input
            id="acct-email" className="board-input" type="email" autoComplete="email"
            placeholder="you@example.org" value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <label className="acct-label" htmlFor="acct-pw">
            Password{showRedeem ? " — choose one (10+ characters)" : ""}
          </label>
          <input
            id="acct-pw" className="board-input" type="password"
            autoComplete={showRedeem ? "new-password" : "current-password"}
            placeholder={showRedeem ? "at least 10 characters" : "your password"}
            value={password} onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !showRedeem && canSignIn) doSignIn(); }}
          />
          <div className="acct-acts">
            {!showRedeem && (
              <button className="ctl" disabled={busy || !canSignIn} onClick={doSignIn}>
                {busy ? "Signing in…" : "Sign in"}
              </button>
            )}
            <button className="ctl" onClick={() => setShowRedeem((s) => !s)}>
              {showRedeem ? "← Back to sign in" : "I have an invite code"}
            </button>
          </div>
          {showRedeem && (
            <div className="acct-block">
              <label className="acct-label" htmlFor="acct-code">Invite code</label>
              <input
                id="acct-code" className="board-input" placeholder="paste the code you were sent"
                value={code} onChange={(e) => setCode(e.target.value)}
              />
              <p className="home-empty">
                This creates your account with the password above
                {localId ? ", and links this device’s research to it" : ""}. After this you just
                sign in with your email and password.
              </p>
              <button
                className="ctl"
                disabled={busy || !code.trim() || !canSignIn}
                onClick={doRedeem}
              >
                {busy ? "Creating your account…" : "Redeem invite"}
              </button>
            </div>
          )}
        </>
      )}

      {status === "signed-in" && me && (
        <>
          <p className="home-lex">
            <strong>{me.displayName || me.email}</strong> · {me.role}
          </p>
          {me.displayName && <p className="home-empty">{me.email}</p>}

          <label className="acct-label" htmlFor="acct-name">
            Display name — what other researchers see on your work
          </label>
          <div className="acct-acts">
            <input
              id="acct-name" className="board-input" placeholder="your name"
              value={nameDraft} onChange={(e) => setNameDraft(e.target.value)}
            />
            <button
              className="ctl"
              disabled={busy || !nameDraft.trim() || nameDraft.trim() === me.displayName}
              onClick={() => guard(async () => { await remote.setName(nameDraft); await refresh(); })}
            >Save</button>
          </div>
          <p className="home-empty">
            This device: {me.localId
              ? <>linked (<code>{me.localId.slice(0, 8)}…</code>)</>
              : <>not linked to your account yet</>}
          </p>
          {!me.localId && localId && (
            <button className="ctl" disabled={busy} onClick={doBind}>
              ⚭ Link this device’s research
            </button>
          )}

          {me.role === "maintainer" && (
            <div className="acct-block">
              <h3 className="acct-h3">Invite a researcher</h3>
              <div className="acct-acts">
                <select
                  className="board-input" value={newRole}
                  onChange={(e) => setNewRole(e.target.value as Role)}
                  title="What the invitee will be able to do"
                >
                  <option value="reader">reader — pull only</option>
                  <option value="researcher">researcher — may submit</option>
                  <option value="moderator">moderator — may approve</option>
                  <option value="maintainer">maintainer — full authority</option>
                </select>
                <button className="ctl" disabled={busy} onClick={doIssue}>
                  {busy ? "Creating…" : "＋ Create invite"}
                </button>
              </div>
              {issued && (
                <p className="home-empty">
                  Share this code (expires in 30 days, single use):{" "}
                  <code className="acct-code">{issued.code}</code>
                  <button
                    className="ctl acct-inline"
                    onClick={() => { void navigator.clipboard?.writeText(issued.code); setCopied(true); }}
                  >{copied ? "copied" : "copy"}</button>
                </p>
              )}
            </div>
          )}

          <div className="acct-block">
            <button className="ctl" disabled={busy} onClick={() => guard(async () => { await remote.signOut(); await refresh(); })}>
              Sign out
            </button>
          </div>
        </>
      )}
    </>
  );
}
