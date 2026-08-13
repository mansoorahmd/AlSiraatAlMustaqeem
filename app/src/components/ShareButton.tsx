// Offer one piece of local work to the research community (Phase 4).
//
// Deliberately quiet: the remote is optional, so this renders NOTHING unless you're signed in
// with permission to submit. A reader who never joins the community should never see an action
// they can't use.
//
// What's sent is a frozen snapshot — editing the note afterwards doesn't change what was
// submitted (SHARED_RESEARCH.md §6). Submitting the same thing twice is idempotent upstream,
// so a double-click can't create duplicates.

import { useEffect, useState } from "react";
import { remote, type AdditiveKind } from "../api/remote";

interface Props {
  kind: AdditiveKind;
  payload: unknown;
  subjectKind?: string;
  subjectValue?: string;
  /** Accessible description of what sharing this does. */
  label: string;
}

type State = "idle" | "sending" | "shared" | "error";

export function ShareButton({ kind, payload, subjectKind, subjectValue, label }: Props) {
  const [allowed, setAllowed] = useState(false);
  const [state, setState] = useState<State>("idle");
  const [detail, setDetail] = useState("");

  useEffect(() => {
    // only researchers and above may publish; readers (and the signed-out) see nothing
    remote.me()
      .then((me) => setAllowed(!!me && me.role !== "reader"))
      .catch(() => setAllowed(false));
  }, []);

  if (!allowed) return null;

  if (state === "shared") {
    return <span className="share-done" title="Sent for review">Shared</span>;
  }

  return (
    <button
      className="icon-btn share-btn"
      title={state === "error" ? detail : label}
      aria-label={label}
      disabled={state === "sending"}
      onClick={async () => {
        setState("sending");
        try {
          await remote.submit([{ kind, subjectKind, subjectValue, payload }]);
          setState("shared");
        } catch (e) {
          setDetail((e as Error).message);
          setState("error");
        }
      }}
    >
      {state === "sending" ? "…" : state === "error" ? "!" : "↑"}
    </button>
  );
}
