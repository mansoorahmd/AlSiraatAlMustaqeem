// Day 0: whose research is this?
//
// The database carries its owner INSIDE the file, so it is self-describing — copy it to another
// machine and it is still yours. We ask once, before anything else, so nothing is ever written
// un-attributed and there is no "who wrote this?" to untangle later.
//
// This is NOT signing in. No account, no password, no network: the email simply names the
// research. Signing in to the research community comes later, and links to this same id.

import { useState } from "react";
import { owner } from "../persistence/db";

export function OwnerGate({ onClaimed }: { onClaimed: () => void }) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const claim = async () => {
    setBusy(true); setErr(null);
    try {
      await owner.set(email.trim());
      onClaimed();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="gate">
      <div className="gate-card">
        <h1 className="gate-title">Whose research is this?</h1>
        <p className="gate-lede">
          Your work is saved in one file on this computer. Naming it now means every note and
          case you write is attributed to you — and if you move the file to another machine, it
          stays yours.
        </p>

        <div className="acct-field">
          <label htmlFor="gate-email">Your email</label>
          <input
            id="gate-email" type="email" autoComplete="email" autoFocus
            placeholder="you@example.org" value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && email.includes("@")) void claim(); }}
          />
        </div>

        {err && <p className="acct-error" role="alert">{err}</p>}

        <div className="acct-actions">
          <button className="ctl primary" disabled={busy || !email.includes("@")} onClick={claim}>
            {busy ? "Saving…" : "Start researching"}
          </button>
        </div>

        <p className="acct-hint">
          This isn’t an account and nothing is sent anywhere. It only labels this file. You can
          change it later, or open a different file, under Home → Your data.
        </p>
      </div>
    </div>
  );
}
