// The account control in the top bar — where people expect to find it. Shows the reader's
// name (or "Sign in" when signed out) and opens the account side-sheet.
//
// The remote is optional, so this must stay quiet when it isn't there: no error, no red dot,
// just "Sign in". It re-checks whenever the sheet closes, so signing in/out updates the label.

import { useCallback, useEffect, useState } from "react";
import { remote, type Me } from "../api/remote";
import { SideSheet } from "./SideSheet";
import { AccountSheet } from "./AccountSheet";

/** Up to two initials — the conventional avatar fallback, same as the panel's. */
function initials(me: Me): string {
  const src = me.displayName.trim() || me.email;
  const parts = src.split(/[\s@._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
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
      {/* Signed in → an avatar, as every app does. Signed out → a plain "Sign in" button,
          which is what a visitor expects to look for. */}
      {me ? (
        <button
          className="avatar-btn"
          title={`${me.displayName || me.email} · ${me.role}`}
          aria-label={`Account: ${me.displayName || me.email}`}
          onClick={() => setOpen(true)}
        >
          <span aria-hidden>{initials(me)}</span>
        </button>
      ) : (
        <button className="ctl" onClick={() => setOpen(true)}>Sign in</button>
      )}

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
