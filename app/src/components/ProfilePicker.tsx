// Which research database is open, whose it is, and how to change either.
//
// Identity lives INSIDE each file (the `owner` table), so this panel reads it from whichever
// file is open — including a colleague's, or your own restored from a backup on a new machine.
// Moving machines is deliberately manual: back up the file, carry it, open it here.

import { useCallback, useEffect, useState } from "react";
import { databases, owner as ownerApi, type Owner, type RecentDb } from "../persistence/db";

/** Desktop bridge for the native "open a file" dialog. */
const desktopPickDb = (): (() => Promise<string | null>) | undefined =>
  (window as unknown as { desktop?: { pickResearchDb?(): Promise<string | null> } })
    .desktop?.pickResearchDb;

const fileName = (p: string) => p.replace(/^.*[/\\]/, "");

export function ProfilePicker({ onChanged }: { onChanged?: () => void }) {
  const [current, setCurrent] = useState<{ path: string; owner: Owner | null } | null>(null);
  const [recent, setRecent] = useState<RecentDb[]>([]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [nameDraft, setNameDraft] = useState("");
  const [opening, setOpening] = useState(false);
  const [pathDraft, setPathDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [replaced, setReplaced] = useState<string | null>(null);
  const pick = desktopPickDb();

  const refresh = useCallback(async () => {
    try {
      const { current: cur, recent: rec } = await databases.list();
      setCurrent(cur); setRecent(rec);
      setDraft(cur.owner?.email ?? ""); setNameDraft(cur.owner?.name ?? "");
    } catch (e) { setErr((e as Error).message); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const act = async (fn: () => Promise<unknown>, reload = false) => {
    setBusy(true); setErr(null);
    try {
      const out = await fn() as { replaced?: string | null } | undefined;
      if (out && "replaced" in out) setReplaced(out.replaced ?? null);
      await refresh();
      if (reload) onChanged?.();     // everything on screen came from the old file
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  if (!current) return null;

  const others = recent.filter((r) => r.path !== current.path);

  return (
    <div className="profile-picker">
      {editing ? (
        <>
          <div className="acct-field">
            <label htmlFor="owner-name">Name</label>
            <input
              id="owner-name" autoFocus value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
            />
          </div>
          <div className="acct-field">
            <label htmlFor="owner-email">Email</label>
            <input
              id="owner-email" type="email" value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && draft.includes("@")) {
                  act(() => ownerApi.set(draft, nameDraft), true).then(() => setEditing(false));
                }
                if (e.key === "Escape") setEditing(false);
              }}
            />
            <span className="acct-hint">
              Changing the email re-derives the id this research is attributed to.
            </span>
          </div>
          <div className="acct-actions">
            <button
              className="ctl primary" disabled={busy || !draft.includes("@")}
              onClick={() => act(() => ownerApi.set(draft, nameDraft), true).then(() => setEditing(false))}
            >Save</button>
            <button
              className="ctl"
              onClick={() => {
                setEditing(false);
                setDraft(current.owner?.email ?? ""); setNameDraft(current.owner?.name ?? "");
              }}
            >Cancel</button>
          </div>
        </>
      ) : (
        <div className="acct-row">
          <span className="acct-row-label">Belongs to</span>
          <span className="acct-row-value">
            <strong>{current.owner?.name || current.owner?.email || "nobody yet"}</strong>
            {current.owner?.name && (
              <span className="acct-muted"> · {current.owner.email}</span>
            )}
            <button
              className="icon-btn" title="Change who this database belongs to"
              aria-label="Change who this database belongs to"
              onClick={() => setEditing(true)}
            >✎</button>
          </span>
        </div>
      )}

      <div className="acct-row">
        <span className="acct-row-label">File</span>
        <span className="acct-row-value acct-muted" title={current.path}>{fileName(current.path)}</span>
      </div>

      {others.length > 0 && (
        <div className="acct-field">
          <label htmlFor="db-select">Recently opened</label>
          <select
            id="db-select" value="" disabled={busy}
            onChange={(e) => { if (e.target.value) act(() => databases.open(e.target.value), true); }}
          >
            <option value="">Choose a database…</option>
            {others.map((r) => (
              <option key={r.path} value={r.path}>{r.label} — {fileName(r.path)}</option>
            ))}
          </select>
        </div>
      )}

      {/* Desktop gets a native file dialog. The web build can't open one, so it asks for the
          path instead — the server can open any file, and without this the browser had no way
          to reach a backup or a colleague's database at all. */}
      {pick ? (
        <div className="acct-actions">
          <button
            className="ctl" disabled={busy}
            onClick={() => act(async () => {
              const path = await pick();
              if (path) await databases.open(path);
            }, true)}
          >
            Open a database file…
          </button>
        </div>
      ) : opening ? (
        <div className="acct-field">
          <label htmlFor="db-path">Path to the database file</label>
          <input
            id="db-path" autoFocus placeholder="C:\path\to\research.db"
            value={pathDraft} onChange={(e) => setPathDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && pathDraft.trim()) {
                act(() => databases.open(pathDraft.trim()), true).then(() => setOpening(false));
              }
              if (e.key === "Escape") setOpening(false);
            }}
          />
          <div className="acct-actions">
            <button
              className="ctl primary" disabled={busy || !pathDraft.trim()}
              onClick={() => act(() => databases.open(pathDraft.trim()), true).then(() => setOpening(false))}
            >Open</button>
            <button className="ctl" onClick={() => { setOpening(false); setPathDraft(""); }}>Cancel</button>
          </div>
        </div>
      ) : (
        <div className="acct-actions">
          <button className="ctl" disabled={busy} onClick={() => setOpening(true)}>
            Open a database file…
          </button>
        </div>
      )}

      {err && <p className="acct-error" role="alert">{err}</p>}

      {/* say what just happened to the file that was open — it was moved, not deleted */}
      {replaced && (
        <p className="acct-hint">
          Your previous database was kept as <code>{fileName(replaced)}</code>.
        </p>
      )}

      <p className="acct-hint">
        Opening a database copies it here and works on the copy, so a backup stays a backup.
        To work on another machine, back this file up and open it there.
      </p>
    </div>
  );
}
