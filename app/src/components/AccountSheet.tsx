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
import { remote, RemoteOffline, type Me, type Role, type RoleLevel, type InviteOut, type ApiToken } from "../api/remote";
import { cachedMe, refreshMe } from "../hooks/useMe";
import { REGIONS, ageFrom } from "../lib/regions";

type Status = "loading" | "offline" | "blocked" | "signed-out" | "signed-in";

/** What the fixed rungs mean; the learner rungs between them (student, scholar, …) are the ladder's. */
const ROLE_HELP: Record<string, string> = {
  reader: "reads the community's work",
  moderator: "reviews what's published",
  maintainer: "full authority, can invite",
};

/** Up to two initials — the conventional avatar fallback. */
function initials(me: Me): string {
  const src = me.displayName.trim() || me.email;
  const parts = src.split(/[\s@._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

/**
 * The hosted MCP (server/src/mcp-http.ts) — nothing to install. A client that takes only a URL
 * (Claude's custom connectors) gets the token in the path; one with a config file sends it as a
 * header.
 */
const mcpUrl = (token: string) => `${remote.url}/mcp/${token}`;
function mcpConfig(token: string): string {
  return JSON.stringify({
    mcpServers: {
      "Organic-Quranic-Methodology": {
        type: "http",
        url: `${remote.url}/mcp`,
        headers: { Authorization: `Bearer ${token}` },
      },
    },
  }, null, 2);
}

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : "never");

/**
 * "Connect an AI assistant": personal API tokens. The MCP runs headless, so it can't hold a
 * session cookie — it reads the corpus AS YOU with a token instead, and so sees exactly what
 * your plan allows. The secret is shown once, at creation; after that only its prefix.
 */
function AiAssistantSection() {
  const [tokens, setTokens] = useState<ApiToken[] | null>(null);
  const [label, setLabel] = useState("");
  const [fresh, setFresh] = useState<string | null>(null);
  const [copied, setCopied] = useState<"url" | "config" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    remote.tokens().then(setTokens).catch((e) => setErr((e as Error).message));
  }, []);
  useEffect(load, [load]);

  const act = async (fn: () => Promise<void>) => {
    setBusy(true); setErr(null);
    try { await fn(); load(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const live = (tokens ?? []).filter((t) => !t.revokedAt);

  return (
    <section className="acct-section">
      <h3>Connect an AI assistant</h3>
      <p className="acct-hint">
        The MCP server lets an AI (Claude, etc.) read the Qur’an and propose research as you. Give
        it a token — it then reads exactly what your plan allows. Revoke a token to cut it off.
      </p>
      {err && <p className="acct-error" role="alert">{err}</p>}

      {live.length > 0 && (
        <ul className="acct-tokens">
          {live.map((t) => (
            <li key={t.id}>
              <span className="acct-token-label">{t.label}</span>
              <code>{t.prefix}…</code>
              <span className="acct-muted">created {when(t.createdAt)} · last used {when(t.lastUsedAt)}</span>
              <button className="ctl" disabled={busy}
                onClick={() => act(async () => { await remote.revokeToken(t.id); })}>
                Revoke
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="acct-field">
        <label htmlFor="acct-token-label">Name it</label>
        <input id="acct-token-label" placeholder="e.g. Claude on my laptop"
          value={label} onChange={(e) => setLabel(e.target.value)} />
      </div>
      <div className="acct-actions">
        <button className="ctl primary" disabled={busy}
          onClick={() => act(async () => {
            const t = await remote.createToken(label.trim() || "MCP");
            setFresh(t.token); setCopied(null); setLabel("");
          })}>
          {busy ? "Creating…" : "Create token"}
        </button>
      </div>

      {fresh && (
        <div className="acct-code-box acct-token-fresh">
          <span className="acct-hint">
            Copy this now — it won’t be shown again. It works like a password: anyone with it can
            act as you.
          </span>
          <span className="acct-hint">
            <strong>Claude app</strong> (desktop or claude.ai): Settings → Connectors → Add custom
            connector, and paste this URL:
          </span>
          <pre>{mcpUrl(fresh)}</pre>
          <button className="ctl"
            onClick={() => { void navigator.clipboard?.writeText(mcpUrl(fresh)); setCopied("url"); }}>
            {copied === "url" ? "Copied" : "Copy URL"}
          </button>
          <span className="acct-hint">
            <strong>Claude Code, Cursor and other MCP clients</strong> — add this to the MCP config:
          </span>
          <pre>{mcpConfig(fresh)}</pre>
          <button className="ctl"
            onClick={() => { void navigator.clipboard?.writeText(mcpConfig(fresh)); setCopied("config"); }}>
            {copied === "config" ? "Copied" : "Copy config"}
          </button>
          <button className="ctl" onClick={() => setFresh(null)}>Done</button>
        </div>
      )}
    </section>
  );
}

export function AccountSheet() {
  const [status, setStatus] = useState<Status>("loading");
  const [me, setMe] = useState<Me | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // signed out: sign in, create an account (open sign-up), or redeem an invite
  const [mode, setMode] = useState<"signin" | "signup" | "redeem">("signin");
  const showRedeem = mode === "redeem";
  const creating = mode !== "signin";
  const [code, setCode] = useState("");
  // the sign-up profile (server/src/signup.ts checks it again)
  const [name, setName] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [region, setRegion] = useState("");
  const [gender, setGender] = useState<"" | "female" | "male">("");
  const age = ageFrom(birthDate);
  const profileOk = age != null && age >= 5 && age <= 120 && !!region;
  // forgotten password: true once the reset email has been requested
  const [resetSent, setResetSent] = useState(false);
  // profile editing — closed by default, opened with the pencil
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  // invites
  const [newRole, setNewRole] = useState<Role>("researcher");
  const [ladder, setLadder] = useState<RoleLevel[]>([]);
  useEffect(() => { remote.roles().then(setLadder).catch(() => {}); }, []);
  const [issued, setIssued] = useState<InviteOut | null>(null);
  const [copied, setCopied] = useState(false);

  const canSignIn = email.includes("@") && password.length >= 10;

  const refresh = useCallback(async () => {
    setErr(null);
    try {
      const who = await remote.me();
      setMe(who);
      // keep the app-wide account in step (sign-in/out changes the Admin tab, the banner, …)
      const key = (m: Me | null) => (m ? [m.id, m.role, m.plan, m.planActive, m.planExpiresAt].join("|") : "");
      if (key(who) !== key(cachedMe())) void refreshMe();
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
    await refresh();
  });

  const doRedeem = () => guard(async () => {
    await remote.redeem({
      code: code.trim(), email: email.trim(), password,
    });
    await remote.signIn(email.trim(), password);
    setMode("signin"); setCode(""); setPassword("");
    await refresh();
  });

  const doSignup = () => guard(async () => {
    await remote.signup({
      email: email.trim(), password, displayName: name.trim() || undefined,
      birthDate, region, gender: gender || undefined,
    });
    await remote.signIn(email.trim(), password);
    setMode("signin"); setPassword("");
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
            {mode === "redeem"
              ? "Your invite creates the account. Choose a password now — you’ll use it every time after."
              : mode === "signup"
                ? "Create your account. It starts on the free plan — a maintainer can upgrade it."
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
              autoComplete={creating ? "new-password" : "current-password"}
              placeholder={creating ? "at least 10 characters" : ""}
              value={password} onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !creating && canSignIn) doSignIn(); }}
            />
            {creating && <span className="acct-hint">At least 10 characters.</span>}
          </div>

          {mode === "signup" && (
            <>
              <div className="acct-field">
                <label htmlFor="acct-name">Name <span className="acct-muted">(optional)</span></label>
                <input id="acct-name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="acct-field">
                <label htmlFor="acct-dob">Date of birth</label>
                <input id="acct-dob" type="date" autoComplete="bday"
                  max={new Date().toISOString().slice(0, 10)}
                  value={birthDate} onChange={(e) => setBirthDate(e.target.value)} />
                {age != null && (
                  <span className="acct-hint">
                    {age >= 5 && age <= 120 ? `Age: ${age}` : "Check the date — that age isn’t possible."}
                  </span>
                )}
              </div>
              <div className="acct-field">
                <label htmlFor="acct-region">Region</label>
                <select id="acct-region" autoComplete="country" value={region}
                  onChange={(e) => setRegion(e.target.value)}>
                  <option value="">Choose…</option>
                  {REGIONS.map((r) => <option key={r.code} value={r.code}>{r.name}</option>)}
                </select>
              </div>
              <div className="acct-field">
                <label htmlFor="acct-gender">Gender <span className="acct-muted">(optional)</span></label>
                <select id="acct-gender" value={gender}
                  onChange={(e) => setGender(e.target.value as typeof gender)}>
                  <option value="">Prefer not to say</option>
                  <option value="female">Female</option>
                  <option value="male">Male</option>
                </select>
              </div>
            </>
          )}

          {showRedeem && (
            <div className="acct-field">
              <label htmlFor="acct-code">Invite code</label>
              <input
                id="acct-code" placeholder="paste the code you were sent"
                value={code} onChange={(e) => setCode(e.target.value)}
              />
            </div>
          )}

          <div className="acct-actions">
            {mode === "redeem" ? (
              <button className="ctl primary" disabled={busy || !code.trim() || !canSignIn} onClick={doRedeem}>
                {busy ? "Creating your account…" : "Create account"}
              </button>
            ) : mode === "signup" ? (
              <button className="ctl primary" disabled={busy || !canSignIn || !profileOk} onClick={doSignup}>
                {busy ? "Creating your account…" : "Create account"}
              </button>
            ) : (
              <button className="ctl primary" disabled={busy || !canSignIn} onClick={doSignIn}>
                {busy ? "Signing in…" : "Sign in"}
              </button>
            )}
          </div>

          <p className="acct-alt">
            {creating ? (
              <>Already have an account?{" "}
                <button className="linkish" onClick={() => setMode("signin")}>Sign in</button></>
            ) : (
              <>New here?{" "}
                <button className="linkish" onClick={() => setMode("signup")}>Create an account</button></>
            )}
          </p>
          {mode !== "redeem" && (
            <p className="acct-alt">
              Have an invite code?{" "}
              <button className="linkish" onClick={() => setMode("redeem")}>Use it</button>
            </p>
          )}

          {!creating && (
            resetSent ? (
              <p className="acct-hint" role="status">
                If <strong>{email.trim()}</strong> has an account, a reset link is on its way — it
                works once, for an hour. Check your spam folder if it doesn’t arrive.
              </p>
            ) : (
              <p className="acct-alt">
                Forgotten your password?{" "}
                <button className="linkish" disabled={busy || !email.includes("@")}
                  title={email.includes("@") ? undefined : "Type your email above first"}
                  onClick={() => guard(async () => {
                    await remote.requestPasswordReset(email.trim());
                    setResetSent(true);
                  })}>
                  Email me a reset link
                </button>
              </p>
            )
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
              <span className={`role-pill role-${me.role}`} title={ROLE_HELP[me.role] ?? ""}>{me.roleLabel || me.role}</span>
            </div>
          </header>

          <dl className="acct-rows">
            <div className="acct-row">
              <dt>Your research</dt>
              <dd><span className="acct-muted">kept privately in your account — only what you publish is shared</span></dd>
            </div>
          </dl>

          {me.role === "maintainer" && (
            <section className="acct-section">
              <h3>Invite a researcher</h3>
              <div className="acct-field">
                <label htmlFor="acct-role">They can</label>
                <select id="acct-role" value={newRole} onChange={(e) => setNewRole(e.target.value as Role)}>
                  {ladder.map((r) => (
                    <option key={r.name} value={r.name}>{r.label || r.name}{ROLE_HELP[r.name] ? ` — ${ROLE_HELP[r.name]}` : ""}</option>
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

          <AiAssistantSection />

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
