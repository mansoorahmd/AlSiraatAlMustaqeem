// Admin — the maintainer's console, in the app instead of a command line.
//
// One rule runs through it: FEATURES are role-based, RESOURCES are plan-based.
//   • Plan tiers        the ladder resources are measured against (free < … < scholar)
//   • Who can read      each resource's minimum: the corpus, the community's readings,
//                       each translation, each dictionary
//   • People            each account's role (what they may do) and plan (what they've paid for)
//
// Visible only to maintainers (TopBar), and guarded here too; every change is also enforced
// by the server, which refuses anyone else.

import { useCallback, useEffect, useMemo, useState } from "react";
import { admin, type Tier, type Rule, type AdminUser, type AdminResources, type Role, type RoleLevel } from "../api/admin";
import { useMe, refreshMe } from "../hooks/useMe";
import { regionName, ageFrom } from "../lib/regions";

/** What the fixed rungs do — the learner rungs between them are the maintainer's to define. */
const FIXED_HINT: Record<string, string> = {
  reader: "reads", moderator: "reviews", maintainer: "administers",
};

/** "none" = no per-item rule (the item needs only what the corpus needs). */
type Pick = string | null | "none";

function accessLabel(v: Pick | undefined, tiers: Tier[]): string {
  if (v === undefined) return "Unknown — couldn't load the rules";
  if (v === "none") return "No extra rule — same as the corpus";
  if (v === null) return "Anyone — no sign-in";
  if (v === "free") return "Any signed-in account";
  const t = tiers.find((x) => x.name === v);
  return `${t?.label || v} plan or higher`;
}

/** Show the value; open a picker only to change it (Save / Cancel). */
function AccessPicker({ value, tiers, allowNone, onSave }: {
  value: Pick | undefined; tiers: Tier[]; allowNone?: boolean; onSave: (v: Pick) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // an unknown value never opens the editor (see below), so there is no default to fall into
  const enc = (v: Pick) => (v === "none" ? "__none" : v === null ? "__public" : v);
  const dec = (s: string): Pick => (s === "__none" ? "none" : s === "__public" ? null : s);

  const save = async () => {
    // only ever save a choice that is actually on the list — never a fallback
    const offered = draft === "__public" || draft === "free" || (allowNone && draft === "__none") ||
      tiers.some((t) => t.name === draft);
    if (!offered) { setErr("Pick an option first."); return; }
    setBusy(true); setErr(null);
    try { await onSave(dec(draft)); setEditing(false); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  if (!editing) {
    return (
      <div className="admin-access">
        <span className="admin-access-value">{accessLabel(value, tiers)}</span>
        <button className="ctl" disabled={value === undefined}
          onClick={() => { if (value !== undefined) { setDraft(enc(value)); setEditing(true); } }}>Change</button>
      </div>
    );
  }
  return (
    <div className="admin-access editing">
      <select className="board-input" value={draft} onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Escape") setEditing(false); if (e.key === "Enter") void save(); }}>
        {allowNone && <option value="__none">No extra rule — same as the corpus</option>}
        <option value="__public">Anyone — no sign-in</option>
        <option value="free">Any signed-in account</option>
        {tiers.filter((t) => t.name !== "free").map((t) => (
          <option key={t.name} value={t.name}>{t.label || t.name} plan or higher</option>
        ))}
      </select>
      <button className="ctl primary" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save"}</button>
      <button className="ctl" onClick={() => setEditing(false)}>Cancel</button>
      {err && <p className="acct-error" role="alert">{err}</p>}
    </div>
  );
}

// ---- plan tiers -------------------------------------------------------------------

function TierRow({ tier, onSaved }: { tier: Tier; onSaved: () => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [rank, setRank] = useState(String(tier.rank));
  const [label, setLabel] = useState(tier.label);
  const [err, setErr] = useState<string | null>(null);
  const free = tier.name === "free";

  const save = async () => {
    setErr(null);
    try { await admin.saveTier({ name: tier.name, rank: Number(rank), label }); setEditing(false); await onSaved(); }
    catch (e) { setErr((e as Error).message); }
  };
  const remove = async () => {
    setErr(null);
    try { await admin.removeTier(tier.name); await onSaved(); }
    catch (e) { setErr((e as Error).message); }
  };

  return (
    <li className="admin-row">
      {editing ? (
        <div className="admin-edit">
          <label className="admin-field"><span>Rank</span>
            <input className="board-input" type="number" min={free ? 0 : 1} value={rank} disabled={free}
              onChange={(e) => setRank(e.target.value)} /></label>
          <label className="admin-field grow"><span>Label</span>
            <input className="board-input" value={label} onChange={(e) => setLabel(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void save(); if (e.key === "Escape") setEditing(false); }} /></label>
          <div className="admin-actions">
            <button className="ctl primary" onClick={save}>Save</button>
            <button className="ctl" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <>
          <span className="admin-rank">{tier.rank}</span>
          <span className="admin-name"><strong>{tier.label || tier.name}</strong> <code>{tier.name}</code></span>
          <div className="admin-actions">
            <button className="ctl" onClick={() => setEditing(true)}>Edit</button>
            {!free && <button className="ctl" onClick={remove}>Remove</button>}
          </div>
        </>
      )}
      {err && <p className="acct-error" role="alert">{err}</p>}
    </li>
  );
}

function AddTier({ onAdded }: { onAdded: () => Promise<void> }) {
  const [name, setName] = useState("");
  const [rank, setRank] = useState("");
  const [label, setLabel] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const add = async () => {
    setErr(null);
    try {
      await admin.saveTier({ name: name.trim().toLowerCase(), rank: Number(rank), label: label.trim() });
      setName(""); setRank(""); setLabel(""); await onAdded();
    } catch (e) { setErr((e as Error).message); }
  };
  return (
    <div className="admin-add">
      <label className="admin-field"><span>Name</span>
        <input className="board-input" placeholder="premium" value={name} onChange={(e) => setName(e.target.value)} /></label>
      <label className="admin-field"><span>Rank</span>
        <input className="board-input" type="number" min={1} placeholder="200" value={rank} onChange={(e) => setRank(e.target.value)} /></label>
      <label className="admin-field grow"><span>Label</span>
        <input className="board-input" placeholder="Premium" value={label} onChange={(e) => setLabel(e.target.value)} /></label>
      <div className="admin-actions">
        <button className="ctl primary" disabled={!name.trim() || !rank} onClick={add}>Add tier</button>
      </div>
      {err && <p className="acct-error" role="alert">{err}</p>}
    </div>
  );
}

// ---- roles: the ladder (a person's standing — what they may DO) ------------------------

function RoleRow({ role, onSaved }: { role: RoleLevel; onSaved: () => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [rank, setRank] = useState(String(role.rank));
  const [label, setLabel] = useState(role.label);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    setErr(null);
    try {
      await admin.saveRole({ name: role.name, rank: role.fixed ? undefined : Number(rank), label });
      setEditing(false); await onSaved();
    } catch (e) { setErr((e as Error).message); }
  };
  const remove = async () => {
    setErr(null);
    try { await admin.removeRole(role.name); await onSaved(); } catch (e) { setErr((e as Error).message); }
  };
  return (
    <li className="admin-row">
      {editing ? (
        <div className="admin-edit">
          <label className="admin-field"><span>Rank</span>
            <input className="board-input" type="number" min={1} max={79} value={rank} disabled={role.fixed}
              onChange={(e) => setRank(e.target.value)} /></label>
          <label className="admin-field grow"><span>Label</span>
            <input className="board-input" value={label} onChange={(e) => setLabel(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void save(); if (e.key === "Escape") setEditing(false); }} /></label>
          <div className="admin-actions">
            <button className="ctl primary" onClick={save}>Save</button>
            <button className="ctl" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <>
          <span className="admin-rank">{role.rank}</span>
          <span className="admin-name"><strong>{role.label || role.name}</strong> <code>{role.name}</code>
            {FIXED_HINT[role.name] && <span className="admin-sub">fixed — {FIXED_HINT[role.name]}</span>}</span>
          <div className="admin-actions">
            <button className="ctl" onClick={() => setEditing(true)}>Edit</button>
            {!role.fixed && <button className="ctl" onClick={remove}>Remove</button>}
          </div>
        </>
      )}
      {err && <p className="acct-error" role="alert">{err}</p>}
    </li>
  );
}

function AddRole({ onAdded }: { onAdded: () => Promise<void> }) {
  const [name, setName] = useState("");
  const [rank, setRank] = useState("");
  const [label, setLabel] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const add = async () => {
    setErr(null);
    try {
      await admin.saveRole({ name: name.trim().toLowerCase(), rank: Number(rank), label: label.trim() });
      setName(""); setRank(""); setLabel(""); await onAdded();
    } catch (e) { setErr((e as Error).message); }
  };
  return (
    <div className="admin-add">
      <label className="admin-field"><span>Name</span>
        <input className="board-input" placeholder="senior-scholar" value={name} onChange={(e) => setName(e.target.value)} /></label>
      <label className="admin-field"><span>Rank (1–79)</span>
        <input className="board-input" type="number" min={1} max={79} placeholder="40" value={rank} onChange={(e) => setRank(e.target.value)} /></label>
      <label className="admin-field grow"><span>Label</span>
        <input className="board-input" placeholder="Senior scholar" value={label} onChange={(e) => setLabel(e.target.value)} /></label>
      <div className="admin-actions">
        <button className="ctl primary" disabled={!name.trim() || !rank} onClick={add}>Add role</button>
      </div>
      {err && <p className="acct-error" role="alert">{err}</p>}
    </div>
  );
}

/** Which role publishing needs — shown as text, changed with one picker. */
function PublishRule({ roles, current, onSaved }: { roles: RoleLevel[]; current: string | undefined; onSaved: () => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(current ?? "");
  const [err, setErr] = useState<string | null>(null);
  const label = (n?: string) => roles.find((r) => r.name === n)?.label || n || "…";
  const save = async () => {
    setErr(null);
    try { await admin.setFeature("publish", draft); setEditing(false); await onSaved(); }
    catch (e) { setErr((e as Error).message); }
  };
  return (
    <li className="admin-row">
      <span className="admin-name"><strong>Publishing</strong>
        <span className="admin-sub">submitting work and proposing readings to the community</span></span>
      {editing ? (
        <div className="admin-access editing">
          <select className="board-input" value={draft} onChange={(e) => setDraft(e.target.value)}>
            {roles.map((r) => <option key={r.name} value={r.name}>{r.label || r.name} or higher</option>)}
          </select>
          <button className="ctl primary" disabled={!draft} onClick={save}>Save</button>
          <button className="ctl" onClick={() => setEditing(false)}>Cancel</button>
        </div>
      ) : (
        <div className="admin-access">
          <span className="admin-access-value">{label(current)} or higher</span>
          <button className="ctl" disabled={!current} onClick={() => { setDraft(current ?? ""); setEditing(true); }}>Change</button>
        </div>
      )}
      {err && <p className="acct-error" role="alert">{err}</p>}
    </li>
  );
}

// ---- people -----------------------------------------------------------------------

function UserRow({ u, tiers, roles, meId, onSaved }: { u: AdminUser; tiers: Tier[]; roles: RoleLevel[]; meId: string; onSaved: () => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [role, setRole] = useState<Role>(u.role);
  const [plan, setPlan] = useState(u.plan);
  const [days, setDays] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const tierLabel = (n: string) => tiers.find((t) => t.name === n)?.label || n;
  const lapsed = u.planExpiresAt != null && new Date(u.planExpiresAt).getTime() < Date.now();

  const save = async () => {
    setErr(null);
    try {
      if (role !== u.role) await admin.setUserRole(u.id, role);
      if (plan !== u.plan || days) await admin.setUserPlan(u.id, plan, days ? Number(days) : null);
      setEditing(false); setDays(""); await onSaved();
      if (u.id === meId) void refreshMe();   // your own role/plan: the rest of the app follows
    } catch (e) { setErr((e as Error).message); }
  };

  return (
    <li className="admin-row">
      <span className="admin-name">
        <strong>{u.displayName || u.email}</strong>
        {u.displayName && <span className="admin-sub">{u.email}</span>}
        {u.id === meId && <span className="admin-sub">(you)</span>}
        {(u.region || u.birthDate || u.gender) && (
          <span className="admin-sub">
            {[u.region && regionName(u.region), u.birthDate && `age ${ageFrom(u.birthDate)}`, u.gender,
              `joined ${new Date(u.createdAt).toLocaleDateString()}`].filter(Boolean).join(" · ")}
          </span>
        )}
      </span>
      {editing ? (
        <div className="admin-edit">
          <label className="admin-field"><span>Role</span>
            <select className="board-input" value={role} onChange={(e) => setRole(e.target.value as Role)}>
              {roles.map((r) => <option key={r.name} value={r.name}>{r.label || r.name}{FIXED_HINT[r.name] ? ` — ${FIXED_HINT[r.name]}` : ""}</option>)}
            </select></label>
          <label className="admin-field"><span>Plan</span>
            <select className="board-input" value={plan} onChange={(e) => setPlan(e.target.value)}>
              {tiers.map((t) => <option key={t.name} value={t.name}>{t.label || t.name}</option>)}
            </select></label>
          <label className="admin-field"><span>For (days)</span>
            <input className="board-input" type="number" min={1} placeholder="no expiry" value={days}
              onChange={(e) => setDays(e.target.value)} disabled={plan === "free"} /></label>
          <div className="admin-actions">
            <button className="ctl primary" onClick={save}>Save</button>
            <button className="ctl" onClick={() => { setEditing(false); setRole(u.role); setPlan(u.plan); }}>Cancel</button>
          </div>
        </div>
      ) : (
        <>
          <span className="admin-meta">
            <span className="admin-pill">{u.role}</span>
            <span className={`admin-pill plan${lapsed ? " lapsed" : ""}`}>
              {tierLabel(u.plan)}{u.planExpiresAt && ` · ${lapsed ? "lapsed" : "until"} ${new Date(u.planExpiresAt).toLocaleDateString()}`}
            </span>
          </span>
          <div className="admin-actions"><button className="ctl" onClick={() => setEditing(true)}>Change</button></div>
        </>
      )}
      {err && <p className="acct-error" role="alert">{err}</p>}
    </li>
  );
}

// ---- the screen ---------------------------------------------------------------------

export function Admin() {
  const { me, loading } = useMe();
  const [tiers, setTiers] = useState<Tier[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [res, setRes] = useState<AdminResources | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [roles, setRoles] = useState<RoleLevel[]>([]);
  const [publishRole, setPublishRole] = useState<string | undefined>(undefined);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  const isAdmin = me?.role === "maintainer";

  const load = useCallback(async () => {
    setErr(null);
    // each part loads on its own, so one failure doesn't blank (or mislabel) the rest
    const [t, r, x, u, rl, f] = await Promise.allSettled([
      admin.tiers(), admin.rules(), admin.resources(), admin.users(), admin.roles(), admin.features(),
    ]);
    if (t.status === "fulfilled") setTiers(t.value);
    if (r.status === "fulfilled") setRules(r.value);
    if (x.status === "fulfilled") setRes(x.value);
    if (u.status === "fulfilled") setUsers(u.value);
    if (rl.status === "fulfilled") setRoles(rl.value);
    if (f.status === "fulfilled") setPublishRole(f.value.find((x) => x.feature === "publish")?.minRole);
    const failed = [t, r, x, u, rl, f].find((p) => p.status === "rejected") as PromiseRejectedResult | undefined;
    if (failed) setErr((failed.reason as Error)?.message ?? "couldn't load everything");
  }, []);
  useEffect(() => { if (isAdmin) void load(); }, [isAdmin, load]);

  /** undefined until the rules have loaded — the picker then refuses to open */
  const whole = (kind: "corpus" | "community") => rules.find((r) => r.kind === kind && r.key === "*")?.minPlan;
  const setWhole = (kind: "corpus" | "community") => async (v: Pick) => {
    if (v === "none") throw new Error("the corpus and the community always have a rule");
    await admin.setRule(kind, "*", v);
    await load();
  };
  const setItem = (kind: "translation" | "lexicon", key: string) => async (v: Pick) => {
    if (v === "none") await admin.removeRule(kind, key); else await admin.setRule(kind, key, v);
    await load();
  };

  const translations = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return (res?.translations ?? []).filter((t) =>
      !q || `${t.name} ${t.author} ${t.language}`.toLowerCase().includes(q));
  }, [res, filter]);

  if (loading) return <div className="sheet home"><p className="home-empty">Loading…</p></div>;
  if (!isAdmin) {
    return (
      <div className="sheet home">
        <section className="home-card">
          <p className="home-empty">The admin screen is for maintainers. Sign in with a maintainer account to use it.</p>
        </section>
      </div>
    );
  }

  return (
    <div className="sheet home admin">
      <header className="home-hero">
        <h1 className="admin-title">Admin</h1>
        <p className="acct-hint">
          <strong>Features</strong> are role-based — what someone may do. <strong>Resources</strong> are
          plan-based — what they may read. Changes apply at once.
        </p>
        {err && <p className="acct-error" role="alert">{err}</p>}
      </header>

      <section className="home-card">
        <h2 className="home-card-title">Roles</h2>
        <p className="acct-hint">A person's standing — what they may <em>do</em>. Reader, moderator (review) and
          maintainer (administer) are fixed; add learner rungs such as student or scholar between them (rank 1–79).
          A higher rank can do everything a lower one can.</p>
        <ul className="admin-list">
          {roles.map((r) => <RoleRow key={r.name} role={r} onSaved={load} />)}
        </ul>
        <AddRole onAdded={load} />
        <h3 className="admin-subhead">What each role may do</h3>
        <ul className="admin-list">
          <PublishRule roles={roles} current={publishRole} onSaved={load} />
        </ul>
        <p className="acct-hint">Each published result also carries its own audience — who may see it (a role and a plan) —
          proposed by its author and confirmed by the reviewer.</p>
      </section>

      <section className="home-card">
        <h2 className="home-card-title">Plan tiers</h2>
        <p className="acct-hint">The ladder every resource is measured against. A higher rank unlocks
          everything a lower one does; <code>free</code> is always rank 0.</p>
        <ul className="admin-list">
          {tiers.map((t) => <TierRow key={t.name} tier={t} onSaved={load} />)}
        </ul>
        <AddTier onAdded={load} />
      </section>

      <section className="home-card">
        <h2 className="home-card-title">Who can read</h2>
        <ul className="admin-list">
          <li className="admin-row">
            <span className="admin-name"><strong>The Qur'an corpus</strong>
              <span className="admin-sub">text, words, roots, dictionaries, search</span></span>
            <AccessPicker value={whole("corpus")} tiers={tiers}
              onSave={setWhole("corpus")} />
          </li>
          <li className="admin-row">
            <span className="admin-name"><strong>The community's readings</strong>
              <span className="admin-sub">readings, dissents, where you stand apart</span></span>
            <AccessPicker value={whole("community")} tiers={tiers}
              onSave={setWhole("community")} />
          </li>
        </ul>
      </section>

      <section className="home-card">
        <h2 className="home-card-title">Translations <span className="admin-count">{res?.translations.length ?? 0}</span></h2>
        <p className="acct-hint">A translation can need more than the corpus does. Below its tier it's left
          out of a reader's results; nothing else changes.</p>
        <input className="board-input admin-filter" placeholder="Filter by name, author or language…"
          value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter translations" />
        <ul className="admin-list scroll">
          {translations.map((t) => (
            <li key={t.id} className="admin-row">
              <span className="admin-name"><strong>{t.name || `#${t.id}`}</strong>
                <span className="admin-sub">{[t.author, t.language].filter(Boolean).join(" · ")}</span></span>
              <AccessPicker value={t.ruled ? t.minPlan : "none"} tiers={tiers} allowNone
                onSave={setItem("translation", String(t.id))} />
            </li>
          ))}
        </ul>
      </section>

      <section className="home-card">
        <h2 className="home-card-title">Dictionaries <span className="admin-count">{res?.lexicons.length ?? 0}</span></h2>
        <p className="acct-hint">Each lexicon's entries on a root page. Below its tier the entries are left out.</p>
        <ul className="admin-list">
          {(res?.lexicons ?? []).map((l) => (
            <li key={l.source} className="admin-row">
              <span className="admin-name"><strong>{l.source}</strong>
                <span className="admin-sub">{l.entries.toLocaleString()} entries</span></span>
              <AccessPicker value={l.ruled ? l.minPlan : "none"} tiers={tiers} allowNone
                onSave={setItem("lexicon", l.source)} />
            </li>
          ))}
        </ul>
      </section>

      <section className="home-card">
        <h2 className="home-card-title">People <span className="admin-count">{users.length}</span></h2>
        <p className="acct-hint">Role is what someone may do; plan is what they've paid for. New people join
          by invite (Account → Invite a researcher).</p>
        <ul className="admin-list">
          {users.map((u) => <UserRow key={u.id} u={u} tiers={tiers} roles={roles} meId={me!.id} onSaved={load} />)}
        </ul>
      </section>
    </div>
  );
}
