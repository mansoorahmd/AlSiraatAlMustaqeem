// The account control in the top bar — where people expect to find it. Shows the reader's
// name (or "Sign in" when signed out) and opens the account side-sheet.
//
// The remote is optional, so this must stay quiet when it isn't there: no error, no red dot,
// just "Sign in". It re-checks whenever the sheet closes, so signing in/out updates the label.

import { useCallback, useEffect, useState } from "react";
import { remote, type Me } from "../api/remote";
import { SideSheet } from "./SideSheet";
import { AccountSheet } from "./AccountSheet";

/** First name, else the part before @ — enough to recognise yourself at a glance. */
function shortName(me: Me): string {
  const name = me.displayName.trim();
  if (name) return name.split(/\s+/)[0] ?? name;
  return me.email.split("@")[0] ?? "account";
}

export function AccountButton() {
  const [me, setMe] = useState<Me | null>(null);
  const [open, setOpen] = useState(false);

  const check = useCallback(async () => {
    try { setMe(await remote.me()); } catch { setMe(null); } // offline/blocked → treat as signed out
  }, []);

  useEffect(() => { void check(); }, [check]);

  return (
    <>
      <button
        className={`ctl account-btn${me ? " signed-in" : ""}`}
        title={me ? `${me.displayName || me.email} · ${me.role}` : "Sign in to the research community"}
        onClick={() => setOpen(true)}
      >
        <span className="account-ic" aria-hidden>{me ? "◕" : "◌"}</span>
        <span className="account-label">{me ? shortName(me) : "Sign in"}</span>
      </button>

      <SideSheet
        open={open}
        title="Research community"
        onClose={() => { setOpen(false); void check(); }}
      >
        <AccountSheet />
      </SideSheet>
    </>
  );
}
