// Everything you configure, in one place — reached from the top bar, as people expect.
//
// It used to live on Home, which turned the workbench into a settings page. Home is now for
// what you're in the middle of; this is for how the app behaves and where your work is kept.

import { useState } from "react";
import { api } from "../api/client";
import { useAsync } from "../hooks/useAsync";
import { Preferences } from "./Preferences";
import { ProfilePicker } from "./ProfilePicker";
import { backupResearch, fetchIdentity, type BackupResult } from "../persistence/db";

const fileName = (p: string) => p.replace(/^.*[/\\]/, "");
const kb = (n: number) => `${(n / 1024).toFixed(0)} KB`;

export function SettingsSheet() {
  const identity = useAsync(() => fetchIdentity(), []);
  const health = useAsync(() => api.health(), []);

  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<BackupResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const backup = async () => {
    setBusy(true); setErr(null);
    try {
      const res = await backupResearch();
      if (!("canceled" in res)) setLast(res);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <div className="acct">
      <section className="settings-group">
        <h3>Reading</h3>
        <Preferences />
      </section>

      <section className="settings-group">
        <h3>Research database</h3>
        <ProfilePicker onChanged={() => window.location.reload()} />
      </section>

      <section className="settings-group">
        <h3>Backup</h3>
        <p className="acct-hint">
          All your research is in one file. A copy is complete and safe to take at any time,
          even while you work.
        </p>
        <div className="acct-actions">
          <button className="ctl" onClick={backup} disabled={busy}>
            {busy ? "Backing up…" : "Back up research"}
          </button>
        </div>
        {last && (
          <p className="acct-hint" title={last.path}>
            Saved <strong>{fileName(last.path)}</strong> · {kb(last.bytes)}
          </p>
        )}
        {err && <p className="acct-error" role="alert">{err}</p>}
      </section>

      <section className="settings-group">
        <h3>About</h3>
        <div className="acct-row">
          <span className="acct-row-label">Archive</span>
          <span className="acct-row-value">
            <span className={`dot ${health.loading ? "" : health.error ? "error" : "ok"}`} />{" "}
            {health.loading ? "connecting…"
              : health.error ? "unreachable"
              : `open · v${health.data?.version ?? "?"}`}
          </span>
        </div>
        {identity.data && (
          <div className="acct-row">
            <span className="acct-row-label">Your id</span>
            <span className="acct-row-value acct-muted" title={identity.data.localId}>
              <code>{identity.data.localId.slice(0, 8)}…</code>
            </span>
          </div>
        )}
      </section>
    </div>
  );
}
