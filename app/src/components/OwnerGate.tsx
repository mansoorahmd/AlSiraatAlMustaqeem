// Day 0 — there is no usable research database yet, so make one.
//
// "Usable" means: a file exists AND it says who it belongs to. Either way the answer is the
// same two questions, asked once. The name and email are written INSIDE the file, so it is
// self-describing: copy it to another machine and it is still yours.
//
// This is NOT signing in. No account, no password, no network — it only names the research.
// Joining the research community comes later and links to the same id.

import { useState } from "react";
import { owner } from "../persistence/db";

export function OwnerGate({ onClaimed }: { onClaimed: () => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const ready = name.trim().length > 0 && email.includes("@");

  const create = async () => {
    setBusy(true); setErr(null);
    try {
      await owner.set(email.trim(), name.trim());
      onClaimed();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="gate">
      <div className="gate-card">
        <h1 className="gate-title">Set up your research</h1>
        <p className="gate-lede">
          Your work is kept in a single file on this computer. Naming it now means every note
          and case is attributed to you — and if you copy the file to another machine, it stays
          yours.
        </p>

        <div className="acct-field">
          <label htmlFor="gate-name">Your name</label>
          <input
            id="gate-name" autoFocus placeholder="Mansoor Ahmad" value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div className="acct-field">
          <label htmlFor="gate-email">Your email</label>
          <input
            id="gate-email" type="email" autoComplete="email"
            placeholder="you@example.org" value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && ready) void create(); }}
          />
        </div>

        {err && <p className="acct-error" role="alert">{err}</p>}

        <div className="acct-actions">
          <button className="ctl primary" disabled={busy || !ready} onClick={create}>
            {busy ? "Creating…" : "Start researching"}
          </button>
        </div>

        <p className="acct-hint">
          This isn’t an account and nothing is sent anywhere. Already have a research file from
          another machine? Start here, then open it under Home → Your data.
        </p>
      </div>
    </div>
  );
}
