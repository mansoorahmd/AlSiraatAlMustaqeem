// Offer one piece of local work to the research community (Phase 4).
//
// Deliberately quiet: the remote is optional, so this renders NOTHING unless you're signed in
// with permission to submit. A reader who never joins should never see an action they can't use.
//
// Three states, driven by the submission ledger (`derived_submissions`, in the account) so
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
import { remote, RemoteError, type AdditiveKind } from "../api/remote";
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
  // Signed in as a publisher, but no active plan: publishing is a paid action, so
  // show a quiet upgrade nudge rather than a button that fails with 402. (The leader wants the
  // upsell; readers and the signed-out still see nothing.)
  const [needsPlan, setNeedsPlan] = useState(false);
  const [prior, setPrior] = useState<SubmissionRecord | null>(null);
  const [state, setState] = useState<State>("idle");
  const [detail, setDetail] = useState("");

  const hash = contentHash(payload);

  useEffect(() => {
    // Publishing needs the role the server sets for it (readers and the signed-out see nothing)
    // and an active plan. The research is always the signed-in account's own.
    remote.me().catch(() => null)
      .then((me) => {
        if (!me || me.canPublish !== true) return setAllowed(false);   // the server's rule, not a role name
        if (!me.planActive) { setNeedsPlan(true); return setAllowed(false); }
        setAllowed(true);
      })
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
      // The plan may have lapsed since we checked: turn a 402 into the upgrade nudge, not an error.
      if (e instanceof RemoteError && e.status === 402) { setNeedsPlan(true); setAllowed(false); return; }
      setDetail((e as Error).message);
      setState("error");
    }
  }, [kind, payload, subjectKind, subjectValue, prior, localRef, hash]);

  const shared = prior !== null;
  const changed = shared && prior.contentHash !== hash;

  // "Shared" is a FACT about this record, recorded locally — not a permission. It must show
  // whether or not you can currently publish: signed out or remote down, it's still true that
  // this was sent. Only the ACTION below needs a role.
  if (shared && !changed && state !== "error") {
    return (
      <span className="share-done" title={`Sent for review · ${prior.submissionId}`}>Shared</span>
    );
  }

  // A publisher without an active plan: a quiet upsell (publishing to the community is paid).
  if (needsPlan) {
    return (
      <span className="share-blocked" title="Publishing to the research community needs an active plan — upgrade to share your work.">
        {shared && changed ? "edited · upgrade" : "upgrade"}
      </span>
    );
  }

  // Edited since it was shared, but you can't publish right now — still worth saying.
  if (!allowed) {
    return shared
      ? <span className="share-blocked" title="Edited since you shared it">edited</span>
      : null;
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
