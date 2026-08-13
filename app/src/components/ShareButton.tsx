// Offer one piece of local work to the research community (Phase 4).
//
// Deliberately quiet: the remote is optional, so this renders NOTHING unless you're signed in
// with permission to submit. A reader who never joins should never see an action they can't use.
//
// Three states, driven by the local submission ledger (research.db `derived_submissions`) so
// they survive a restart:
//   never submitted            → ↑        share it
//   submitted, unchanged since → Shared   nothing to do
//   submitted, then edited     → Update   re-share, chained to the previous submission via
//                                          `supersedes` (SHARED_RESEARCH.md §6) rather than
//                                          landing upstream as an orphaned duplicate
//
// What's sent is a frozen snapshot: editing the record afterwards never rewrites what a
// moderator is already reviewing.

import { useCallback, useEffect, useState } from "react";
import { remote, type AdditiveKind } from "../api/remote";
import { submissionLog, contentHash, type SubmissionRecord } from "../persistence/db";

interface Props {
  /** The local record's id — what the ledger keys on. */
  localRef: string;
  kind: AdditiveKind;
  payload: unknown;
  subjectKind?: string;
  subjectValue?: string;
  /** Accessible description of what sharing this does. */
  label: string;
}

type State = "idle" | "sending" | "error";

export function ShareButton({ localRef, kind, payload, subjectKind, subjectValue, label }: Props) {
  const [allowed, setAllowed] = useState(false);
  const [prior, setPrior] = useState<SubmissionRecord | null>(null);
  const [state, setState] = useState<State>("idle");
  const [detail, setDetail] = useState("");

  const hash = contentHash(payload);

  useEffect(() => {
    // only researchers and above may publish; readers (and the signed-out) see nothing
    remote.me()
      .then((me) => setAllowed(!!me && me.role !== "reader"))
      .catch(() => setAllowed(false));
  }, []);

  useEffect(() => { void submissionLog.get(localRef).then(setPrior); }, [localRef]);

  const share = useCallback(async () => {
    setState("sending");
    try {
      // chain to the previous submission so upstream knows this replaces it
      const out = await remote.submit(
        [{ kind, subjectKind, subjectValue, payload }],
        prior?.submissionId,
      );
      setPrior(await submissionLog.record(localRef, {
        submissionId: out.id, contentHash: hash, kind,
      }));
      setState("idle");
    } catch (e) {
      setDetail((e as Error).message);
      setState("error");
    }
  }, [kind, payload, subjectKind, subjectValue, prior, localRef, hash]);

  if (!allowed) return null;

  const shared = prior !== null;
  const changed = shared && prior.contentHash !== hash;

  if (shared && !changed && state !== "error") {
    return (
      <span className="share-done" title={`Sent for review · ${prior.submissionId}`}>Shared</span>
    );
  }

  return (
    <button
      className={`icon-btn share-btn${changed ? " share-update" : ""}`}
      title={state === "error" ? detail : changed ? "Edited since you shared it — send the update" : label}
      aria-label={changed ? "Share the updated version" : label}
      disabled={state === "sending"}
      onClick={share}
    >
      {state === "sending" ? "…" : state === "error" ? "!" : changed ? "Update" : "↑"}
    </button>
  );
}
