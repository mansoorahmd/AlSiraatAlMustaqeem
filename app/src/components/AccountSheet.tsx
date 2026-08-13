// The research-community account panel: sign in, redeem an invite, issue invites
// (maintainer), link this device, sign out.
//
// The remote is OPTIONAL — if it isn't running we say so plainly and the reader carries on
// working offline, which is the whole premise (SHARED_RESEARCH.md §2). There are no passwords
// anywhere: sign-in is a single-use magic link.

import { useCallback, useEffect, useState } from "react";
import { remote, desktop, RemoteOffline, type Me, type Role, type InviteOut } from "../api/remote";
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
  const [linkSent, setLinkSent] = useState(false);
  const [pasteUrl, setPasteUrl] = useState("");
  const [nameDraft, setNameDraft] = useState("");
  const isDesktop = !!desktop()?.openSignIn;
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
    await remote.signIn(email.trim());
    setLinkSent(true);
  });

  /**
   * Desktop only. The magic-link token arrives by email, so the app can't construct the
   * verify URL itself — the reader pastes the link they received and we open it in an in-app
   * window, which shares this app's session. (Clicking the link in a mail client opens the
   * SYSTEM browser, which would sign that browser in and leave the app signed out.)
   */
  const doCompleteSignIn = () => guard(async () => {
    const url = pasteUrl.trim();
    if (!url.startsWith(remote.url)) {
      throw new Error(`that link doesn’t point at ${remote.url} — paste the whole sign-in link`);
    }
    const { ok } = await desktop()!.openSignIn!(url);
    if (!ok) {
      throw new Error("that link wasn’t accepted — it may be expired or already used; request a new one");
    }
    setPasteUrl(""); setLinkSent(false);
    await refresh();               // the window verified; pick up the new session
  });

  const doRedeem = () => guard(async () => {
    await remote.redeem({ code: code.trim(), email: email.trim(), localId: localId ?? undefined });
    setShowRedeem(false); setCode("");
    setLinkSent(false);
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
            There’s no password — we email you a single-use link.
          </p>
          <label className="acct-label" htmlFor="acct-email">Your email</label>
          <input
            id="acct-email" className="board-input" type="email" autoComplete="email"
            placeholder="you@example.org" value={email}
            onChange={(e) => { setEmail(e.target.value); setLinkSent(false); }}
          />
          <div className="acct-acts">
            <button className="ctl" disabled={busy || !email.includes("@")} onClick={doSignIn}>
              {busy ? "Sending…" : "✉ Send sign-in link"}
            </button>
            <button className="ctl" onClick={() => setShowRedeem((s) => !s)}>
              I have an invite code
            </button>
          </div>
          {linkSent && (
            <div className="acct-block">
              <p className="home-empty">
                If <strong>{email}</strong> has an account, a sign-in link is on its way.
                {" "}(Registration is invite-only, so no link is sent for an address that hasn’t
                been invited — for privacy we can’t say which.)
              </p>
              {isDesktop ? (
                <>
                  <label className="acct-label" htmlFor="acct-link">Paste the sign-in link</label>
                  <input
                    id="acct-link" className="board-input" placeholder={`${remote.url}/api/auth/magic-link/verify?...`}
                    value={pasteUrl} onChange={(e) => setPasteUrl(e.target.value)}
                  />
                  <p className="home-empty">
                    The desktop app needs the link itself: opening it from your mail client would
                    sign in your <em>browser</em> instead of the app.
                  </p>
                  <button className="ctl" disabled={busy || !pasteUrl.trim()} onClick={doCompleteSignIn}>
                    {busy ? "Signing in…" : "Finish signing in"}
                  </button>
                </>
              ) : (
                <p className="home-empty">
                  Open the link in this browser, then
                  <button className="ctl acct-inline" onClick={() => void refresh()}>refresh</button>.
                </p>
              )}
            </div>
          )}

          {showRedeem && (
            <div className="acct-block">
              <label className="acct-label" htmlFor="acct-code">Invite code</label>
              <input
                id="acct-code" className="board-input" placeholder="paste the code you were sent"
                value={code} onChange={(e) => setCode(e.target.value)}
              />
              <p className="home-empty">
                Redeeming creates your account{localId ? " and links this device’s research to it" : ""}.
                You’ll then sign in with a link.
              </p>
              <button className="ctl" disabled={busy || !code.trim() || !email.includes("@")} onClick={doRedeem}>
                {busy ? "Redeeming…" : "Redeem invite"}
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
