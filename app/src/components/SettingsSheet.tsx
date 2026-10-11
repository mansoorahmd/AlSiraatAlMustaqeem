// Everything you configure, in one place — reached from the top bar, as people expect.
//
// It used to live on Home, which turned the workbench into a settings page. Home is now for
// what you're in the middle of; this is for how the app behaves and where your work is kept.

import { api } from "../api/client";
import { REMOTE_URL } from "../api/remote";
import { useAsync } from "../hooks/useAsync";
import { useMe } from "../hooks/useMe";
import { Preferences } from "./Preferences";

/** Your research: kept privately in your account on the research server. */
function YourResearch() {
  const { me } = useMe();
  if (!me) {
    return <p className="acct-hint">Sign in (Account, top right) to see your research — it’s kept in your account.</p>;
  }
  return (
    <p className="acct-hint">
      Kept privately in your account on the research server — nobody else can see it. Only what
      you publish is shared, and only once it’s approved.
    </p>
  );
}

export function SettingsSheet() {
  const health = useAsync(() => api.health(), []);

  return (
    <div className="acct">
      <section className="settings-group">
        <h3>Reading</h3>
        <Preferences />
      </section>

      <section className="settings-group">
        <h3>Your research</h3>
        <YourResearch />
      </section>

      <section className="settings-group">
        <h3>About</h3>
        <div className="acct-row">
          <span className="acct-row-label">Research server</span>
          <span className="acct-row-value" title={REMOTE_URL}>
            <span className={`dot ${health.loading ? "" : health.error ? "error" : "ok"}`} />{" "}
            {health.loading ? "connecting…" : health.error ? "unreachable" : "connected"}
          </span>
        </div>
      </section>
    </div>
  );
}
