// Which research database is open, and how to change it.
//
// One database per person: your work follows WHO you are, not how you launched the app. Signing
// in claims the file you've been working in; a second researcher on the same machine gets their
// own. You can also open any .db explicitly — useful for opening a backup or a colleague's file.

import { useCallback, useEffect, useState } from "react";
import { profiles, type Profile } from "../persistence/db";

/** Desktop bridge for the native "open a file" dialog. */
const desktopPickDb = (): (() => Promise<string | null>) | undefined =>
  (window as unknown as { desktop?: { pickResearchDb?(): Promise<string | null> } })
    .desktop?.pickResearchDb;

const fileName = (p: string) => p.replace(/^.*[/\\]/, "");

export function ProfilePicker({ onChanged }: { onChanged?: () => void }) {
  const [list, setList] = useState<Profile[]>([]);
  const [active, setActive] = useState<Profile | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const pick = desktopPickDb();

  const refresh = useCallback(async () => {
    try {
      const { active: a, profiles: all } = await profiles.list();
      setActive(a); setList(all);
    } catch (e) { setErr((e as Error).message); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true); setErr(null);
    try {
      await fn();
      await refresh();
      onChanged?.();          // everything on screen came from the old database — reload it
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  if (!active) return null;

  return (
    <div className="profile-picker">
      <div className="acct-row">
        <span className="acct-row-label">Database</span>
        <span className="acct-row-value" title={active.path}>
          <strong>{active.email ?? active.label}</strong>
          <span className="acct-muted"> · {fileName(active.path)}</span>
        </span>
      </div>

      {list.length > 1 && (
        <div className="acct-field">
          <label htmlFor="profile-select">Open a different one</label>
          <select
            id="profile-select" value={active.id} disabled={busy}
            onChange={(e) => act(() => profiles.switchTo(e.target.value))}
          >
            {list.map((p) => (
              <option key={p.id} value={p.id}>
                {p.email ?? p.label} — {fileName(p.path)}
              </option>
            ))}
          </select>
        </div>
      )}

      {pick && (
        <button
          className="ctl" disabled={busy}
          onClick={() => act(async () => {
            const path = await pick();
            if (path) await profiles.openFile(path);
          })}
        >
          Open a database file…
        </button>
      )}

      {err && <p className="acct-error" role="alert">{err}</p>}
      <p className="acct-hint">
        Signing in links the work you’ve already done to your account, so it follows you rather
        than the app you happened to open.
      </p>
    </div>
  );
}
