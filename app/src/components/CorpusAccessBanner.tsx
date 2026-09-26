// Why the Qur'an text isn't showing — said once, at the top, instead of by every screen.
//
// The corpus is read from the research server and is plan-gated (api/client.ts). When a read is
// refused (sign in / needs a plan) or can't reach the server, the client announces it and this
// banner explains what to do. It hides again on the next successful read. The screens themselves
// just see an error and show their usual empty state underneath.

import { useEffect, useState } from "react";
import { CORPUS_ACCESS_EVENT, type CorpusAccessState } from "../api/client";

/** Ask the account button to open its sheet (it owns that state). */
export const OPEN_ACCOUNT_EVENT = "open-account";

export function CorpusAccessBanner() {
  const [state, setState] = useState<CorpusAccessState>({ kind: "ok" });

  useEffect(() => {
    const on = (e: Event) => setState((e as CustomEvent<CorpusAccessState>).detail);
    window.addEventListener(CORPUS_ACCESS_EVENT, on);
    return () => window.removeEventListener(CORPUS_ACCESS_EVENT, on);
  }, []);

  if (state.kind === "ok") return null;

  const title =
    state.kind === "offline" ? "The Qur'an text can't be loaded"
    : state.kind === "signin" ? "Sign in to read"
    : `Reading this needs the ${state.plan ?? "right"} plan`;

  return (
    <div className={`corpus-banner ${state.kind === "offline" ? "is-offline" : "is-gated"}`} role="alert">
      <div className="corpus-banner-text">
        <strong>{title}</strong>
        <span>{state.message}</span>
      </div>
      <div className="corpus-banner-actions">
        {state.kind !== "offline" && (
          <button className="ctl primary" onClick={() => window.dispatchEvent(new Event(OPEN_ACCOUNT_EVENT))}>
            {state.kind === "signin" ? "Sign in" : "Your account"}
          </button>
        )}
        <button className="ctl" onClick={() => window.location.reload()}>Try again</button>
      </div>
    </div>
  );
}
