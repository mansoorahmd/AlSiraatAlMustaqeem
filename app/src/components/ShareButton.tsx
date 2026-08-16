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
import { submissionLog, contentHash, fetchIdentity, type SubmissionRecord } from "../persistence/db";

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
  const [mismatch, setMismatch] = useState<string | null>(null);
  const [prior, setPrior] = useState<SubmissionRecord | null>(null);
  const [state, setState] = useState<State>("idle");
  const [detail, setDetail] = useState("");

  const hash = contentHash(payload);

  useEffect(() => {
    // Two conditions to publish. First the role: only researchers and above, so readers and the
    // signed-out see nothing. Second — and this is the important one — the signed-in account
    // must match the OWNER of the open database. Otherwise you'd be publishing someone else's
    // research (a colleague's file, or a backup you opened) under your own name.
    Promise.all([remote.me().catch(() => null), fetchIdentity().catch(() => null)])
      .then(([me, id]) => {
        if (!me || me.role === "reader") return setAllowed(false);
        const ownerEmail = id?.owner?.email;
        if (ownerEmail && ownerEmail !== me.email) {
          setMismatch(`This database belongs to ${ownerEmail}, but you're signed in as ${me.email}.`);
          return setAllowed(false);
        }
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
      setDetail((e as Error).message);
      setState("error");
    }
  }, [kind, payload, subjectKind, subjectValue, prior, localRef, hash]);

  const shared = prior !== null;
  const changed = shared && prior.contentHash !== hash;

  // "Shared" is a FACT about this record, recorded locally — not a permission. It must show
  // whether or not you can currently publish: signed out, remote down, or looking at someone
  // else's database, it's still true that this was sent. Only the ACTION below needs a role.
  if (shared && !changed && state !== "error") {
    return (
      <span className="share-done" title={`Sent for review · ${prior.submissionId}`}>Shared</span>
    );
  }

  // The database isn't yours: say so quietly rather than vanishing, so the reason is visible.
  if (mismatch) return <span className="share-blocked" title={mismatch}>not yours</span>;

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
